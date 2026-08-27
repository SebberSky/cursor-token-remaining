export function titled(base: string, plan?: string | null): string {
  const p = (plan ?? "").trim();
  if (!p) {
    return base;
  }
  if (p.toLowerCase() === base.toLowerCase()) {
    return base;
  }
  if (p.toLowerCase().startsWith(base.toLowerCase())) {
    return p;
  }
  return `${base} · ${p}`;
}

const CODEX_PLANS: Record<string, string> = {
  guest: "Guest",
  free: "Free",
  go: "Go",
  plus: "Plus",
  prolite: "Pro",
  pro: "Pro 20x",
  team: "Team",
  business: "Business",
  enterprise: "Enterprise",
  edu: "Edu",
  education: "Edu",
  free_workspace: "Free workspace",
  self_serve_business_usage_based: "Business",
  enterprise_cbp_usage_based: "Enterprise",
};

export function formatCodexPlan(planType?: string | null): string | undefined {
  if (!planType) {
    return undefined;
  }
  const key = planType.trim().toLowerCase();
  if (CODEX_PLANS[key]) {
    return CODEX_PLANS[key];
  }
  return titleCase(key);
}

const COPILOT_PLANS: Record<string, string> = {
  individual: "Individual",
  business: "Business",
  enterprise: "Enterprise",
  organization: "Org",
  student: "Student",
  free: "Free",
};

export function formatCopilotPlan(plan?: string | null): string | undefined {
  if (!plan) {
    return undefined;
  }
  const key = plan.trim().toLowerCase();
  if (COPILOT_PLANS[key]) {
    return COPILOT_PLANS[key];
  }
  return titleCase(key.replace(/_/g, " "));
}

export function formatClaudePlan(profile: {
  account?: { has_claude_max?: boolean; has_claude_pro?: boolean };
  organization?: { organization_type?: string; rate_limit_tier?: string };
}): string | undefined {
  const tier = profile.organization?.rate_limit_tier ?? "";
  const lower = tier.toLowerCase();
  if (lower.includes("max_20") || lower.includes("max20")) {
    return "Max 20x";
  }
  if (lower.includes("max_5") || lower.includes("max5")) {
    return "Max 5x";
  }
  if (lower.includes("max")) {
    return "Max";
  }
  if (lower.includes("pro")) {
    return "Pro";
  }
  const org = profile.organization?.organization_type?.toLowerCase() ?? "";
  if (org.includes("max") || profile.account?.has_claude_max) {
    return "Max";
  }
  if (org.includes("pro") || profile.account?.has_claude_pro) {
    return "Pro";
  }
  return undefined;
}

export function windowLabelFromSeconds(
  seconds: number | undefined,
  fallback: string
): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return fallback;
  }
  if (seconds === 5 * 3600) {
    return "5h";
  }
  if (seconds === 7 * 86400) {
    return "Weekly";
  }
  if (seconds === 86400) {
    return "Daily";
  }
  if (seconds % 86400 === 0) {
    return `${seconds / 86400}d`;
  }
  if (seconds % 3600 === 0) {
    return `${seconds / 3600}h`;
  }
  if (seconds % 60 === 0) {
    return `${seconds / 60}m`;
  }
  return fallback;
}

export function meterIdFromWindowLabel(provider: string, label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${provider}.${slug || "window"}`;
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
