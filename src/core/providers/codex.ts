import * as nodePath from "path";
import { getJson, rethrowRateLimit } from "../http";
import { deleteFile, fileExists, homeDir, readJsonFile, writeJsonFile } from "../paths";
import {
  clampPercent,
  errorMessage,
  toMs,
  usedFromRemainingPercent,
} from "../percent";
import {
  formatCodexPlan,
  meterIdFromWindowLabel,
  titled,
  windowLabelFromSeconds,
} from "../plan";
import {
  failedSnapshot,
  okSnapshot,
  type FetchContext,
  type Meter,
  type Provider,
  type ProviderSnapshot,
} from "../types";

export const CODEX_ID = "codex";
export const CODEX_DISPLAY = "Codex";

type RateWindow = {
  used_percent?: number;
  usedPercent?: number;
  percent_left?: number;
  percentLeft?: number;
  reset_at?: string | number;
  resets_at?: string | number;
  resetsAt?: string | number;
  limit_window_seconds?: number;
  limitWindowSeconds?: number;
};

export type CodexUsageResponse = {
  plan_type?: string;
  planType?: string;
  rate_limit?: {
    primary_window?: RateWindow | null;
    secondary_window?: RateWindow | null;
    five_hour?: RateWindow | null;
    weekly?: RateWindow | null;
  };
  rate_limits?: {
    primary?: RateWindow | null;
    secondary?: RateWindow | null;
    primary_window?: RateWindow | null;
    secondary_window?: RateWindow | null;
    five_hour?: RateWindow | null;
    weekly?: RateWindow | null;
  };
  five_hour?: RateWindow;
  weekly?: RateWindow;
};

type CodexAuth = {
  tokens?: {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
  access_token?: string;
  account_id?: string;
  access?: string;
  accountId?: string;
  refresh?: string;
};

export function codexAuthPath(): string {
  return nodePath.join(homeDir(), ".codex", "auth.json");
}

function authPath(): string {
  return codexAuthPath();
}

export function chatgptAccountId(
  idToken?: string | null,
  accessToken?: string | null
): string | undefined {
  for (const token of [idToken, accessToken]) {
    if (!token) {
      continue;
    }
    const parts = token.split(".");
    if (parts.length < 2) {
      continue;
    }
    try {
      const padded = parts[1] + "=".repeat((4 - (parts[1].length % 4)) % 4);
      const payload = JSON.parse(
        Buffer.from(padded, "base64url").toString("utf8")
      ) as {
        chatgpt_account_id?: string;
        organizations?: Array<{ id?: string }>;
        "https://api.openai.com/auth"?: { chatgpt_account_id?: string };
      };
      const nested = payload["https://api.openai.com/auth"]?.chatgpt_account_id;
      const orgId = payload.organizations?.[0]?.id;
      const id = payload.chatgpt_account_id ?? nested ?? orgId;
      if (id) {
        return id;
      }
    } catch {
      // ignore malformed JWT
    }
  }
  return undefined;
}

export function parseCodexAuthData(
  data: CodexAuth | null
): { token: string; accountId?: string } | null {
  if (!data) {
    return null;
  }
  const token =
    data.tokens?.access_token ?? data.access_token ?? data.access;
  if (!token) {
    return null;
  }
  const accountId =
    data.tokens?.account_id ?? data.account_id ?? data.accountId;
  return { token, accountId: accountId || undefined };
}

export function getCodexAuth(): { token: string; accountId?: string } | null {
  return parseCodexAuthData(readJsonFile<CodexAuth>(authPath()));
}

export function saveCodexOAuth(tokens: {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  accountId?: string;
}): void {
  const accountId =
    tokens.accountId ??
    chatgptAccountId(tokens.idToken, tokens.accessToken);
  writeJsonFile(authPath(), {
    tokens: {
      id_token: tokens.idToken,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      account_id: accountId,
    },
    last_refresh: new Date().toISOString(),
  });
}

export function clearCodexAuth(): void {
  deleteFile(authPath());
}

function windowUsedPercent(win: RateWindow | undefined): number | null {
  if (!win) {
    return null;
  }
  if (win.used_percent != null || win.usedPercent != null) {
    return clampPercent(win.used_percent ?? win.usedPercent);
  }
  if (win.percent_left != null || win.percentLeft != null) {
    return usedFromRemainingPercent(win.percent_left ?? win.percentLeft);
  }
  return null;
}

function windowReset(win: RateWindow | undefined): number | undefined {
  return (
    toMs(win?.reset_at ?? win?.resets_at ?? win?.resetsAt ?? null) ?? undefined
  );
}

function windowSeconds(win: RateWindow | undefined): number | undefined {
  const value = win?.limit_window_seconds ?? win?.limitWindowSeconds;
  return typeof value === "number" ? value : undefined;
}

function collectWindows(data: CodexUsageResponse): {
  win: RateWindow;
  fallback: string;
}[] {
  const rate = data.rate_limit ?? data.rate_limits;
  const slots: { win: RateWindow; fallback: string }[] = [];
  const push = (win: RateWindow | null | undefined, fallback: string) => {
    if (win) {
      slots.push({ win, fallback });
    }
  };
  if (rate) {
    const rec = rate as Record<string, RateWindow | null | undefined>;
    push(rec.primary_window ?? rec.primary, "5h");
    push(rec.secondary_window ?? rec.secondary, "Weekly");
    if (slots.length === 0) {
      push(rec.five_hour, "5h");
      push(rec.weekly, "Weekly");
    }
  }
  if (slots.length === 0) {
    push(data.five_hour, "5h");
    push(data.weekly, "Weekly");
  }
  return slots;
}

export function parseCodexUsage(data: CodexUsageResponse): Meter[] {
  const usedIds = new Set<string>();
  const meters: Meter[] = [];
  for (const slot of collectWindows(data)) {
    const usedPercent = windowUsedPercent(slot.win);
    if (usedPercent == null) {
      continue;
    }
    const label = windowLabelFromSeconds(windowSeconds(slot.win), slot.fallback);
    let id = meterIdFromWindowLabel(CODEX_ID, label);
    if (usedIds.has(id)) {
      id = `${id}.${meters.length}`;
    }
    usedIds.add(id);
    meters.push({
      id,
      provider: CODEX_ID,
      label,
      usedPercent,
      resetsAt: windowReset(slot.win),
    });
  }
  return meters;
}

export function codexDisplayName(data: CodexUsageResponse): string {
  return titled(
    CODEX_DISPLAY,
    formatCodexPlan(data.plan_type ?? data.planType)
  );
}

async function detect(_ctx: FetchContext): Promise<boolean> {
  return fileExists(authPath()) && getCodexAuth() != null;
}

async function fetchSnapshot(_ctx: FetchContext): Promise<ProviderSnapshot> {
  try {
    const auth = getCodexAuth();
    if (!auth) {
      return failedSnapshot(CODEX_ID, CODEX_DISPLAY, "Codex auth.json not found.");
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${auth.token}`,
      Accept: "application/json",
      Origin: "https://chatgpt.com",
      Referer: "https://chatgpt.com/",
    };
    if (auth.accountId) {
      headers["ChatGPT-Account-Id"] = auth.accountId;
    }
    const data = (await getJson(
      "https://chatgpt.com/backend-api/wham/usage",
      headers
    )) as CodexUsageResponse;
    return okSnapshot(CODEX_ID, codexDisplayName(data), parseCodexUsage(data));
  } catch (err) {
    rethrowRateLimit(err);
    return failedSnapshot(CODEX_ID, CODEX_DISPLAY, errorMessage(err));
  }
}

export const codexProvider: Provider = {
  id: CODEX_ID,
  displayName: CODEX_DISPLAY,
  detect,
  fetch: fetchSnapshot,
};
