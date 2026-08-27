import * as nodePath from "path";
import { getJson, rethrowRateLimit } from "../http";
import { deleteFile, fileExists, homeDir, readJsonFile, writeJsonFile } from "../paths";
import {
  errorMessage,
  toMs,
  utilizationToPercent,
} from "../percent";
import { formatClaudePlan, titled } from "../plan";
import {
  failedSnapshot,
  okSnapshot,
  type FetchContext,
  type Meter,
  type Provider,
  type ProviderSnapshot,
} from "../types";

export const CLAUDE_ID = "claude";
export const CLAUDE_DISPLAY = "Claude";

type LimitEntry = {
  kind?: string;
  percent?: number;
  utilization?: number;
  used_percentage?: number;
  resets_at?: string | number;
  scope?: { model?: { display_name?: string } };
};

export type ClaudeUsageResponse = {
  five_hour?: LimitEntry;
  seven_day?: LimitEntry;
  seven_day_sonnet?: LimitEntry;
  limits?: LimitEntry[];
};

type ClaudeCredentials = {
  claudeAiOauth?: {
    accessToken?: string;
    access_token?: string;
  };
  accessToken?: string;
};

export function claudeCredentialsPath(): string {
  if (process.env.CLAUDE_CONFIG_DIR) {
    return nodePath.join(process.env.CLAUDE_CONFIG_DIR, ".credentials.json");
  }
  return nodePath.join(homeDir(), ".claude", ".credentials.json");
}

function credentialsPath(): string {
  return claudeCredentialsPath();
}

export function saveClaudeOAuth(tokens: {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}): void {
  writeJsonFile(credentialsPath(), {
    claudeAiOauth: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    },
  });
}

export function clearClaudeCredentials(): void {
  deleteFile(credentialsPath());
}

export function getClaudeToken(): string | null {
  const creds = readJsonFile<ClaudeCredentials>(credentialsPath());
  if (!creds) {
    return null;
  }
  const token =
    creds.claudeAiOauth?.accessToken ??
    creds.claudeAiOauth?.access_token ??
    creds.accessToken;
  return token && token.length > 0 ? token : null;
}

function percentOf(entry: LimitEntry | undefined): number | null {
  if (!entry) {
    return null;
  }
  if (entry.percent != null) {
    return utilizationToPercent(entry.percent);
  }
  if (entry.utilization != null) {
    return utilizationToPercent(entry.utilization);
  }
  if (entry.used_percentage != null) {
    return utilizationToPercent(entry.used_percentage);
  }
  return null;
}

function labelFor(kind: string | undefined, fallback: string): string {
  switch (kind) {
    case "session":
    case "five_hour":
      return "Session";
    case "weekly_all":
    case "seven_day":
      return "Weekly";
    case "weekly_scoped":
    case "seven_day_sonnet":
      return "Weekly Sonnet";
    default:
      return fallback;
  }
}

export function parseClaudeUsage(data: ClaudeUsageResponse): Meter[] {
  const meters: Meter[] = [];
  const seen = new Set<string>();

  const push = (
    idSuffix: string,
    label: string,
    entry: LimitEntry | undefined
  ) => {
    const usedPercent = percentOf(entry);
    if (usedPercent == null || seen.has(idSuffix)) {
      return;
    }
    seen.add(idSuffix);
    meters.push({
      id: `claude.${idSuffix}`,
      provider: CLAUDE_ID,
      label,
      usedPercent,
      resetsAt: toMs(entry?.resets_at ?? null) ?? undefined,
    });
  };

  if (Array.isArray(data.limits) && data.limits.length > 0) {
    data.limits.forEach((entry, index) => {
      const scoped = entry.scope?.model?.display_name;
      const kind = entry.kind || `limit${index}`;
      const suffix = scoped
        ? `${kind}.${scoped.replace(/\s+/g, "-").toLowerCase()}`
        : kind;
      push(suffix, scoped ? `${labelFor(kind, kind)} ${scoped}` : labelFor(kind, kind), entry);
    });
    return meters;
  }

  push("session", "Session", data.five_hour);
  push("weekly", "Weekly", data.seven_day);
  push("weekly-sonnet", "Weekly Sonnet", data.seven_day_sonnet);
  return meters;
}

async function detect(_ctx: FetchContext): Promise<boolean> {
  return fileExists(credentialsPath()) && getClaudeToken() != null;
}

async function fetchSnapshot(_ctx: FetchContext): Promise<ProviderSnapshot> {
  try {
    const token = getClaudeToken();
    if (!token) {
      return failedSnapshot(
        CLAUDE_ID,
        CLAUDE_DISPLAY,
        "Claude Code credentials not found."
      );
    }
    const headers = {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
      "Content-Type": "application/json",
    };
    const [data, profile] = await Promise.all([
      getJson("https://api.anthropic.com/api/oauth/usage", headers) as Promise<ClaudeUsageResponse>,
      getJson("https://api.anthropic.com/api/oauth/profile", headers).catch(
        () => null
      ) as Promise<{
        account?: { has_claude_max?: boolean; has_claude_pro?: boolean };
        organization?: { organization_type?: string; rate_limit_tier?: string };
      } | null>,
    ]);
    return okSnapshot(
      CLAUDE_ID,
      titled(CLAUDE_DISPLAY, profile ? formatClaudePlan(profile) : undefined),
      parseClaudeUsage(data)
    );
  } catch (err) {
    rethrowRateLimit(err);
    return failedSnapshot(CLAUDE_ID, CLAUDE_DISPLAY, errorMessage(err));
  }
}

export const claudeProvider: Provider = {
  id: CLAUDE_ID,
  displayName: CLAUDE_DISPLAY,
  detect,
  fetch: fetchSnapshot,
};
