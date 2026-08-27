import * as nodePath from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { getJson, rethrowRateLimit } from "../http";
import { firstExisting, homeDir, readJsonFile } from "../paths";
import { sqliteFirstText } from "../sqlite";
import { errorMessage, usedFromRemainingPercent } from "../percent";
import { formatCopilotPlan, titled } from "../plan";
import {
  failedSnapshot,
  okSnapshot,
  type FetchContext,
  type Meter,
  type Provider,
  type ProviderSnapshot,
} from "../types";

const execFileAsync = promisify(execFile);

export const COPILOT_ID = "copilot";
export const COPILOT_DISPLAY = "Copilot";

type QuotaCategory = {
  entitlement?: number;
  remaining?: number;
  quota_remaining?: number;
  percent_remaining?: number;
  unlimited?: boolean;
};

export type CopilotQuotaResponse = {
  copilot_plan?: string;
  quota_reset_date?: string;
  quota_reset_date_utc?: string;
  quota_snapshots?: Record<string, QuotaCategory>;
  limited_user_quotas?: Record<string, number>;
  monthly_quotas?: Record<string, number>;
};

const LABELS: Record<string, string> = {
  premium_interactions: "Premium",
  premium: "Premium",
  chat: "Chat",
  completions: "Completions",
};

function configDirs(): string[] {
  const home = homeDir();
  const dirs = [
    nodePath.join(home, ".config", "github-copilot"),
    nodePath.join(home, "Library", "Application Support", "github-copilot"),
  ];
  if (process.env.XDG_CONFIG_HOME) {
    dirs.unshift(nodePath.join(process.env.XDG_CONFIG_HOME, "github-copilot"));
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    dirs.unshift(nodePath.join(process.env.LOCALAPPDATA, "github-copilot"));
  }
  return dirs;
}

function tokenFromRecord(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const rec = value as Record<string, unknown>;
  const direct = rec.oauth_token ?? rec.oauthToken ?? rec.token;
  if (typeof direct === "string" && direct.length > 0) {
    return direct;
  }
  for (const nested of Object.values(rec)) {
    const found = tokenFromRecord(nested);
    if (found) {
      return found;
    }
  }
  return null;
}

function looksLikeGithubToken(value: string): boolean {
  return (
    value.startsWith("gho_") ||
    value.startsWith("ghp_") ||
    value.startsWith("github_pat_")
  );
}

async function tokenFromAuthDb(dbPath: string): Promise<string | null> {
  const queries = [
    "SELECT oauth_token FROM tokens LIMIT 1;",
    "SELECT json_extract(value, '$.oauth_token') FROM ItemTable WHERE value LIKE '%oauth_token%' LIMIT 1;",
    "SELECT value FROM ItemTable WHERE key LIKE '%oauth%' LIMIT 1;",
  ];
  for (const sql of queries) {
    const raw = await sqliteFirstText(dbPath, sql);
    if (!raw) {
      continue;
    }
    if (looksLikeGithubToken(raw)) {
      return raw;
    }
    try {
      const token = tokenFromRecord(JSON.parse(raw) as unknown);
      if (token) {
        return token;
      }
    } catch {
      if (raw.length > 20) {
        return raw;
      }
    }
  }
  return null;
}

async function tokenFromGh(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"], {
      timeout: 4000,
    });
    const token = stdout.trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export async function getCopilotToken(ctx: FetchContext): Promise<string | null> {
  if (ctx.githubToken?.trim()) {
    return ctx.githubToken.trim();
  }
  const envKeys = [
    "COPILOT_GITHUB_TOKEN",
    "GH_COPILOT_TOKEN",
    "GITHUB_COPILOT_TOKEN",
    "GH_TOKEN",
    "GITHUB_TOKEN",
  ];
  for (const key of envKeys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  for (const dir of configDirs()) {
    const jsonToken =
      tokenFromRecord(readJsonFile(nodePath.join(dir, "apps.json"))) ??
      tokenFromRecord(readJsonFile(nodePath.join(dir, "hosts.json")));
    if (jsonToken) {
      return jsonToken;
    }
    const dbPath = firstExisting([
      nodePath.join(dir, "auth.db"),
      nodePath.join(dir, "auth.sqlite"),
    ]);
    if (dbPath) {
      const dbToken = await tokenFromAuthDb(dbPath);
      if (dbToken) {
        return dbToken;
      }
    }
  }
  return tokenFromGh();
}

export function parseCopilotQuota(data: CopilotQuotaResponse): Meter[] {
  const meters: Meter[] = [];
  const snapshots = data.quota_snapshots ?? {};
  const reset = data.quota_reset_date || data.quota_reset_date_utc;
  const parsedReset = reset ? Date.parse(reset) : NaN;
  const resetMs = Number.isFinite(parsedReset) ? parsedReset : undefined;

  for (const [key, cat] of Object.entries(snapshots)) {
    if (!cat || cat.unlimited) {
      continue;
    }
    const remaining =
      typeof cat.remaining === "number"
        ? cat.remaining
        : typeof cat.quota_remaining === "number"
          ? cat.quota_remaining
          : undefined;
    const entitlement =
      typeof cat.entitlement === "number" ? cat.entitlement : undefined;
    const usedPercent =
      cat.percent_remaining != null
        ? usedFromRemainingPercent(cat.percent_remaining)
        : remaining != null && entitlement != null
          ? usedFromRemainingPercent((remaining / Math.max(entitlement, 1)) * 100)
          : 0;
    const used =
      remaining != null && entitlement != null
        ? Math.max(0, entitlement - remaining)
        : undefined;
    meters.push({
      id: `copilot.${key}`,
      provider: COPILOT_ID,
      label: LABELS[key] ?? key,
      usedPercent,
      used,
      limit: entitlement,
      unit: "requests",
      resetsAt: resetMs,
    });
  }

  if (meters.length === 0 && data.limited_user_quotas && data.monthly_quotas) {
    for (const [key, remaining] of Object.entries(data.limited_user_quotas)) {
      const limit = data.monthly_quotas[key];
      if (typeof remaining !== "number" || typeof limit !== "number") {
        continue;
      }
      meters.push({
        id: `copilot.${key}`,
        provider: COPILOT_ID,
        label: LABELS[key] ?? key,
        usedPercent: usedFromRemainingPercent(
          (remaining / Math.max(limit, 1)) * 100
        ),
        used: Math.max(0, limit - remaining),
        limit,
        unit: "requests",
        resetsAt: resetMs,
      });
    }
  }

  return meters;
}

async function detect(ctx: FetchContext): Promise<boolean> {
  return (await getCopilotToken(ctx)) != null;
}

async function fetchSnapshot(ctx: FetchContext): Promise<ProviderSnapshot> {
  try {
    const token = await getCopilotToken(ctx);
    if (!token) {
      return failedSnapshot(
        COPILOT_ID,
        COPILOT_DISPLAY,
        "No GitHub Copilot token found."
      );
    }
    const data = (await getJson("https://api.github.com/copilot_internal/user", {
      Authorization: `token ${token}`,
      Accept: "application/json",
      "Editor-Version": "vscode/1.96.2",
      "Editor-Plugin-Version": "copilot-chat/0.26.7",
      "User-Agent": "GitHubCopilotChat/0.26.7",
      "X-Github-Api-Version": "2025-04-01",
    })) as CopilotQuotaResponse;
    return okSnapshot(
      COPILOT_ID,
      titled(COPILOT_DISPLAY, formatCopilotPlan(data.copilot_plan)),
      parseCopilotQuota(data)
    );
  } catch (err) {
    rethrowRateLimit(err);
    return failedSnapshot(COPILOT_ID, COPILOT_DISPLAY, errorMessage(err));
  }
}

export const copilotProvider: Provider = {
  id: COPILOT_ID,
  displayName: COPILOT_DISPLAY,
  detect,
  fetch: fetchSnapshot,
};
