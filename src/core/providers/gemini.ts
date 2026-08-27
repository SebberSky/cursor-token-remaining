import * as nodePath from "path";
import { postJson, rethrowRateLimit } from "../http";
import {
  deleteFile,
  fileExists,
  homeDir,
  readJsonFile,
  writeJsonFile,
} from "../paths";
import {
  clampPercent,
  errorMessage,
  toMs,
} from "../percent";
import {
  failedSnapshot,
  okSnapshot,
  type FetchContext,
  type Meter,
  type Provider,
  type ProviderSnapshot,
} from "../types";

export const GEMINI_ID = "gemini";
export const GEMINI_DISPLAY = "Gemini";

type GeminiCreds = {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  id_token?: string;
};

type QuotaBucket = {
  modelId?: string;
  model_id?: string;
  remainingFraction?: number;
  remaining_fraction?: number;
  remainingAmount?: number;
  resetTime?: string | number;
  reset_time?: string | number;
};

export type GeminiQuotaResponse = Record<string, unknown>;

export function geminiCredsPath(): string {
  return nodePath.join(homeDir(), ".gemini", "oauth_creds.json");
}

function credsPath(): string {
  return geminiCredsPath();
}

export function geminiOAuthClient(): { id: string; secret: string } | null {
  const id = process.env.GEMINI_OAUTH_CLIENT_ID;
  const secret = process.env.GEMINI_OAUTH_CLIENT_SECRET;
  if (!id || !secret) {
    return null;
  }
  return { id, secret };
}

export function saveGeminiCreds(creds: GeminiCreds): void {
  writeJsonFile(credsPath(), creds);
}

export function clearGeminiCreds(): void {
  deleteFile(credsPath());
}

function collectBuckets(node: unknown, out: QuotaBucket[]): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectBuckets(item, out);
    }
    return;
  }
  if (!node || typeof node !== "object") {
    return;
  }
  const rec = node as Record<string, unknown>;
  if (
    "remainingFraction" in rec ||
    "remaining_fraction" in rec ||
    "remainingAmount" in rec
  ) {
    out.push(rec as QuotaBucket);
    return;
  }
  for (const value of Object.values(rec)) {
    collectBuckets(value, out);
  }
}

function modelLabel(bucket: QuotaBucket): string {
  const id = String(bucket.modelId ?? bucket.model_id ?? "model");
  return id.replace(/^models\//, "").replace(/^gemini-?/i, "Gemini ");
}

export function parseGeminiQuota(data: GeminiQuotaResponse): Meter[] {
  const buckets: QuotaBucket[] = [];
  collectBuckets(data, buckets);
  const meters: Meter[] = buckets
    .map((bucket, index) => {
      const fractionRaw = bucket.remainingFraction ?? bucket.remaining_fraction;
      if (typeof fractionRaw !== "number") {
        return null;
      }
      const modelId = String(bucket.modelId ?? bucket.model_id ?? `model${index}`);
      const meter: Meter = {
        id: `gemini.${modelId.replace(/[^\w.-]+/g, "-")}`,
        provider: GEMINI_ID,
        label: modelLabel(bucket),
        usedPercent: clampPercent((1 - fractionRaw) * 100),
        resetsAt: toMs(bucket.resetTime ?? bucket.reset_time ?? null) ?? undefined,
      };
      return meter;
    })
    .filter((row): row is Meter => row != null)
    .sort((a, b) => b.usedPercent - a.usedPercent)
    .slice(0, 4);
  return meters;
}

async function refreshAccessToken(creds: GeminiCreds): Promise<GeminiCreds> {
  if (!creds.refresh_token) {
    return creds;
  }
  const expired =
    typeof creds.expiry_date === "number" && creds.expiry_date < Date.now() + 60_000;
  if (!expired && creds.access_token) {
    return creds;
  }
  const client = geminiOAuthClient();
  if (!client) {
    return creds;
  }
  const body = new URLSearchParams({
    client_id: client.id,
    client_secret: client.secret,
    refresh_token: creds.refresh_token,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Gemini token refresh ${res.status}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    id_token?: string;
  };
  const next: GeminiCreds = {
    ...creds,
    access_token: json.access_token ?? creds.access_token,
    id_token: json.id_token ?? creds.id_token,
    expiry_date:
      typeof json.expires_in === "number"
        ? Date.now() + json.expires_in * 1000
        : creds.expiry_date,
  };
  writeJsonFile(credsPath(), next);
  return next;
}

export function getGeminiCreds(): GeminiCreds | null {
  if (!fileExists(credsPath())) {
    return null;
  }
  return readJsonFile<GeminiCreds>(credsPath());
}

async function detect(_ctx: FetchContext): Promise<boolean> {
  const creds = getGeminiCreds();
  return Boolean(creds?.access_token || creds?.refresh_token);
}

async function fetchSnapshot(_ctx: FetchContext): Promise<ProviderSnapshot> {
  try {
    const initial = getGeminiCreds();
    if (!initial) {
      return failedSnapshot(
        GEMINI_ID,
        GEMINI_DISPLAY,
        "Gemini CLI credentials not found."
      );
    }
    const creds = await refreshAccessToken(initial);
    const token = creds.access_token;
    if (!token) {
      return failedSnapshot(GEMINI_ID, GEMINI_DISPLAY, "Gemini access token missing.");
    }
    const data = (await postJson(
      "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
      { Authorization: `Bearer ${token}` },
      {}
    )) as GeminiQuotaResponse;
    return okSnapshot(GEMINI_ID, GEMINI_DISPLAY, parseGeminiQuota(data));
  } catch (err) {
    rethrowRateLimit(err);
    return failedSnapshot(GEMINI_ID, GEMINI_DISPLAY, errorMessage(err));
  }
}

export const geminiProvider: Provider = {
  id: GEMINI_ID,
  displayName: GEMINI_DISPLAY,
  detect,
  fetch: fetchSnapshot,
};
