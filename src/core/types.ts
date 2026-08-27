export type Meter = {
  id: string;
  provider: string;
  label: string;
  usedPercent: number;
  used?: number;
  limit?: number;
  unit?: string;
  resetsAt?: number;
  breakdown?: { name: string; used: number }[];
};

export type ProviderSnapshot = {
  id: string;
  displayName: string;
  skipped: boolean;
  error?: string;
  meters: Meter[];
  fetchedAt: number;
};

export type FetchContext = {
  githubToken?: string;
};

export type FetchAllOptions = FetchContext & {
  only?: string[];
  cacheTtlMs?: number;
};

export type UsageReport = {
  providers: ProviderSnapshot[];
  meters: Meter[];
  fetchedAt: number;
};

export type Provider = {
  id: string;
  displayName: string;
  detect(ctx: FetchContext): Promise<boolean>;
  fetch(ctx: FetchContext): Promise<ProviderSnapshot>;
};

export const DEFAULT_CACHE_TTL_MS = 60_000;

export function skippedSnapshot(
  id: string,
  displayName: string
): ProviderSnapshot {
  return {
    id,
    displayName,
    skipped: true,
    meters: [],
    fetchedAt: Date.now(),
  };
}

export function failedSnapshot(
  id: string,
  displayName: string,
  error: string
): ProviderSnapshot {
  return {
    id,
    displayName,
    skipped: false,
    error,
    meters: [],
    fetchedAt: Date.now(),
  };
}

export function okSnapshot(
  id: string,
  displayName: string,
  meters: Meter[]
): ProviderSnapshot {
  return {
    id,
    displayName,
    skipped: false,
    meters,
    fetchedAt: Date.now(),
  };
}
