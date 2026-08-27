export function clampPercent(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(n * 10000) / 10000));
}

export function utilizationToPercent(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  if (n >= 0 && n <= 1) {
    return clampPercent(n * 100);
  }
  return clampPercent(n);
}

export function usedFromRemainingPercent(remaining: unknown): number {
  return clampPercent(100 - clampPercent(remaining));
}

export function ratioToUsedPercent(used: number, limit: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
    return 0;
  }
  return clampPercent((used / limit) * 100);
}

export function toMs(value: string | number | undefined | null): number | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    return value < 1e12 ? value * 1000 : value;
  }
  const n = Number(value);
  if (Number.isFinite(n) && /^\d+(\.\d+)?$/.test(String(value).trim())) {
    return n < 1e12 ? n * 1000 : n;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
