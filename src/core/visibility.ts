import type { Meter, ProviderSnapshot, UsageReport } from "./types";

export function snapshotHasData(provider: ProviderSnapshot): boolean {
  return !provider.skipped && !provider.error && provider.meters.length > 0;
}

export function isHiddenId(id: string, hidden: Set<string>): boolean {
  return hidden.has(id);
}

export function filterVisible(
  report: UsageReport,
  hidden: Set<string>
): { groups: ProviderSnapshot[]; meters: Meter[] } {
  const groups = report.providers
    .filter(snapshotHasData)
    .map((provider) => ({
      ...provider,
      meters: provider.meters.filter(
        (meter) => !hidden.has(meter.id) && !hidden.has(provider.id)
      ),
    }))
    .filter((provider) => provider.meters.length > 0);
  return {
    groups,
    meters: groups.flatMap((provider) => provider.meters),
  };
}

export function dataMeters(report: UsageReport): Meter[] {
  return report.providers.filter(snapshotHasData).flatMap((p) => p.meters);
}

export function hiddenFromPicked(
  all: Meter[],
  pickedIds: Set<string>
): Set<string> {
  return new Set(all.filter((meter) => !pickedIds.has(meter.id)).map((m) => m.id));
}
