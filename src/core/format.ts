import type { Meter, UsageReport } from "./types";
import { visibleProviders } from "./fetchAll";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function formatResetIn(resetsAt: number, now = Date.now()): string {
  const remaining = resetsAt - now;
  if (!Number.isFinite(resetsAt) || remaining <= 0) {
    return "Reset now";
  }
  const days = Math.floor(remaining / DAY_MS);
  const hours = Math.floor((remaining % DAY_MS) / HOUR_MS);
  return `Reset in ${days} days ${hours} hours`;
}

export function formatReportText(report: UsageReport): string {
  const visible = visibleProviders(report);
  if (visible.length === 0) {
    return "No signed-in providers found.";
  }
  const lines: string[] = [];
  for (const provider of visible) {
    lines.push(provider.displayName);
    if (provider.error) {
      lines.push(`  error: ${provider.error}`);
      continue;
    }
    if (provider.meters.length === 0) {
      lines.push("  (no meters)");
      continue;
    }
    for (const meter of provider.meters) {
      lines.push(`  ${formatMeterLine(meter)}`);
    }
  }
  return lines.join("\n");
}

function formatMeterLine(meter: Meter): string {
  const pct = `${Math.round(meter.usedPercent)}%`;
  const extra =
    meter.used != null && meter.limit != null
      ? `  ${Math.round(meter.used)}/${Math.round(meter.limit)}${meter.unit ? ` ${meter.unit}` : ""}`
      : "";
  const reset = meter.resetsAt ? `  ${formatResetIn(meter.resetsAt)}` : "";
  return `${meter.label.padEnd(12)} ${pct}${extra}${reset}`;
}

export function formatReportJson(report: UsageReport): string {
  return `${JSON.stringify(
    {
      fetchedAt: report.fetchedAt,
      providers: visibleProviders(report).map((provider) => ({
        id: provider.id,
        displayName: provider.displayName,
        error: provider.error ?? null,
        meters: provider.meters,
      })),
    },
    null,
    2
  )}\n`;
}
