import * as fs from "fs";
import { readItemTableValue } from "../sqlite";
import { postJson, rethrowRateLimit } from "../http";
import { vscodeStateDb } from "../paths";
import {
  clampPercent,
  errorMessage,
  toMs,
} from "../percent";
import { titled } from "../plan";
import {
  failedSnapshot,
  okSnapshot,
  type FetchContext,
  type Meter,
  type Provider,
  type ProviderSnapshot,
} from "../types";

export interface AgentSpend {
  name: string;
  cents: number;
  tier: number | null;
  isFree: boolean;
}

export interface TokenUsage {
  freePercent: number;
  apiPercent: number;
  totalPercent: number | null;
  limitCents: number;
  includedSpendCents: number;
  freeUsedCents: number;
  apiUsedCents: number;
  agents: AgentSpend[];
  billingCycleStart: number | null;
  billingCycleEnd: number | null;
  fetchedAt: number;
  planName?: string;
}

interface PlanUsage {
  autoPercentUsed?: number;
  apiPercentUsed?: number;
  totalPercentUsed?: number;
  limit?: number;
  includedSpend?: number;
  totalSpend?: number;
}

export interface PeriodUsageResponse {
  billingCycleStart?: string | number;
  billingCycleEnd?: string | number;
  planUsage?: PlanUsage;
  autoBucketModels?: string[];
  individualUsage?: {
    plan?: PlanUsage & {
      used?: number;
      limit?: number;
    };
  };
}

export interface Aggregation {
  modelIntent?: string;
  totalCents?: number | null;
  tier?: number;
}

interface AggregatedResponse {
  aggregations?: Aggregation[];
  totalCostCents?: number | null;
}

export const CURSOR_ID = "cursor";
export const CURSOR_DISPLAY = "Cursor";

export function getCursorStateDbPath(): string {
  return vscodeStateDb("Cursor");
}

export async function getCursorAccessToken(): Promise<string> {
  const dbPath = getCursorStateDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error("Cursor state database not found. Sign in to Cursor first.");
  }
  const token = await readItemTableValue(dbPath, "cursorAuth/accessToken");
  if (token) {
    return token;
  }
  throw new Error("Could not read Cursor access token. Are you signed in?");
}

function buildAgents(
  aggregations: Aggregation[],
  autoBucket: Set<string>
): AgentSpend[] {
  return aggregations
    .map((row) => {
      const name = row.modelIntent?.trim() || "unknown";
      const cents = typeof row.totalCents === "number" ? row.totalCents : 0;
      const tier = typeof row.tier === "number" ? row.tier : null;
      const isFree = tier === 2 || autoBucket.has(name);
      return { name, cents, tier, isFree };
    })
    .filter((a) => a.cents > 0)
    .sort((a, b) => b.cents - a.cents);
}

export function parseCursorUsage(
  period: PeriodUsageResponse,
  aggregations: Aggregation[] = []
): TokenUsage {
  const plan = period.planUsage;
  if (!plan || (plan.autoPercentUsed == null && plan.apiPercentUsed == null)) {
    throw new Error("Usage response did not include free/api percentages.");
  }

  const freePercent = clampPercent(plan.autoPercentUsed ?? 0);
  const apiPercent = clampPercent(plan.apiPercentUsed ?? 0);
  const limitCents = Math.max(0, Math.round(plan.limit ?? 0));
  const includedSpendCents = Math.max(0, Math.round(plan.includedSpend ?? 0));
  const freeUsedCents = Math.round((limitCents * freePercent) / 100);
  const apiUsedCents = Math.round((limitCents * apiPercent) / 100);
  const autoBucket = new Set(period.autoBucketModels ?? []);
  const agents = buildAgents(aggregations, autoBucket);

  return {
    freePercent,
    apiPercent,
    totalPercent:
      plan.totalPercentUsed == null ? null : clampPercent(plan.totalPercentUsed),
    limitCents,
    includedSpendCents,
    freeUsedCents,
    apiUsedCents,
    agents,
    billingCycleStart: toMs(period.billingCycleStart ?? null),
    billingCycleEnd: toMs(period.billingCycleEnd ?? null),
    fetchedAt: Date.now(),
  };
}

function agentsFor(
  kind: "free" | "api",
  usage: TokenUsage
): { name: string; used: number }[] {
  return usage.agents
    .filter((a) => (kind === "free" ? a.isFree : !a.isFree))
    .map((a) => ({ name: a.name, used: a.cents }));
}

export function cursorUsageToSnapshot(usage: TokenUsage): ProviderSnapshot {
  const meters: Meter[] = [
    {
      id: "cursor.free",
      provider: CURSOR_ID,
      label: "FREE",
      usedPercent: usage.freePercent,
      used: usage.freeUsedCents,
      limit: usage.limitCents,
      unit: "cents",
      resetsAt: usage.billingCycleEnd ?? undefined,
      breakdown: agentsFor("free", usage),
    },
    {
      id: "cursor.api",
      provider: CURSOR_ID,
      label: "API",
      usedPercent: usage.apiPercent,
      used: usage.apiUsedCents,
      limit: usage.limitCents,
      unit: "cents",
      resetsAt: usage.billingCycleEnd ?? undefined,
      breakdown: agentsFor("api", usage),
    },
  ];
  return okSnapshot(CURSOR_ID, titled(CURSOR_DISPLAY, usage.planName), meters);
}

export async function fetchTokenUsage(): Promise<TokenUsage> {
  const token = await getCursorAccessToken();
  const auth = {
    Authorization: `Bearer ${token}`,
    "Connect-Protocol-Version": "1",
  };
  const [period, planName] = await Promise.all([
    postJson(
      "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage",
      auth,
      {}
    ) as Promise<PeriodUsageResponse>,
    fetchCursorPlanName(token),
  ]);

  const plan = period.planUsage;
  if (!plan || (plan.autoPercentUsed == null && plan.apiPercentUsed == null)) {
    throw new Error("Usage response did not include free/api percentages.");
  }

  const startMs = toMs(period.billingCycleStart ?? null) ?? Date.now() - 30 * 86400000;
  const endMs = toMs(period.billingCycleEnd ?? null) ?? Date.now();

  let aggregations: Aggregation[] = [];
  try {
    const agg = (await postJson(
      "https://api2.cursor.sh/aiserver.v1.DashboardService/GetAggregatedUsageEvents",
      auth,
      {
        startDate: String(startMs),
        endDate: String(Math.min(endMs, Date.now())),
      }
    )) as AggregatedResponse;
    aggregations = agg.aggregations ?? [];
  } catch {
    aggregations = [];
  }

  const usage = parseCursorUsage(period, aggregations);
  usage.planName = planName;
  return usage;
}

async function fetchCursorPlanName(token: string): Promise<string | undefined> {
  try {
    const data = (await postJson(
      "https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo",
      {
        Authorization: `Bearer ${token}`,
        "Connect-Protocol-Version": "1",
      },
      {}
    )) as { planInfo?: { planName?: string }; planName?: string };
    const name = data.planInfo?.planName ?? data.planName;
    return name?.trim() ? name.trim() : undefined;
  } catch {
    return undefined;
  }
}

async function detect(_ctx: FetchContext): Promise<boolean> {
  try {
    await getCursorAccessToken();
    return true;
  } catch {
    return false;
  }
}

async function fetchSnapshot(_ctx: FetchContext): Promise<ProviderSnapshot> {
  try {
    const usage = await fetchTokenUsage();
    return cursorUsageToSnapshot(usage);
  } catch (err) {
    rethrowRateLimit(err);
    return failedSnapshot(CURSOR_ID, CURSOR_DISPLAY, errorMessage(err));
  }
}

export const cursorProvider: Provider = {
  id: CURSOR_ID,
  displayName: CURSOR_DISPLAY,
  detect,
  fetch: fetchSnapshot,
};
