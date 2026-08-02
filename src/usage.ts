import { getAccessToken } from "./auth";

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
}

interface PlanUsage {
  autoPercentUsed?: number;
  apiPercentUsed?: number;
  totalPercentUsed?: number;
  limit?: number;
  includedSpend?: number;
  totalSpend?: number;
}

interface PeriodUsageResponse {
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

interface Aggregation {
  modelIntent?: string;
  totalCents?: number | null;
  tier?: number;
}

interface AggregatedResponse {
  aggregations?: Aggregation[];
  totalCostCents?: number | null;
}

function clampPercent(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.min(100, n));
}

function toMs(value: string | number | undefined): number | null {
  if (value == null) {
    return null;
  }
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchPeriodRaw(token: string): Promise<PeriodUsageResponse> {
  const res = await fetch(
    "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
      },
      body: "{}",
    }
  );
  if (!res.ok) {
    throw new Error(`Usage API ${res.status}`);
  }
  return (await res.json()) as PeriodUsageResponse;
}

async function fetchAggregations(
  token: string,
  startMs: number,
  endMs: number
): Promise<AggregatedResponse> {
  const res = await fetch(
    "https://api2.cursor.sh/aiserver.v1.DashboardService/GetAggregatedUsageEvents",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
      },
      body: JSON.stringify({
        startDate: String(startMs),
        endDate: String(endMs),
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`Aggregated usage API ${res.status}`);
  }
  return (await res.json()) as AggregatedResponse;
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

export async function fetchTokenUsage(): Promise<TokenUsage> {
  const token = await getAccessToken();
  const period = await fetchPeriodRaw(token);
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

  const startMs = toMs(period.billingCycleStart) ?? Date.now() - 30 * 86400000;
  const endMs = toMs(period.billingCycleEnd) ?? Date.now();
  const autoBucket = new Set(period.autoBucketModels ?? []);

  let agents: AgentSpend[] = [];
  try {
    const agg = await fetchAggregations(token, startMs, Math.min(endMs, Date.now()));
    agents = buildAgents(agg.aggregations ?? [], autoBucket);
  } catch {
    agents = [];
  }

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
    billingCycleStart: toMs(period.billingCycleStart),
    billingCycleEnd: toMs(period.billingCycleEnd),
    fetchedAt: Date.now(),
  };
}
