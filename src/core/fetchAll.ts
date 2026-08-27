import { readFreshCache, readStaleCache, writeCache } from "./cache";
import { isTooManyRequests } from "./http";
import { errorMessage } from "./percent";
import { claudeProvider } from "./providers/claude";
import { codexProvider } from "./providers/codex";
import { copilotProvider } from "./providers/copilot";
import { cursorProvider } from "./providers/cursor";
import { geminiProvider } from "./providers/gemini";
import { windsurfProvider } from "./providers/windsurf";
import {
  DEFAULT_CACHE_TTL_MS,
  failedSnapshot,
  skippedSnapshot,
  type FetchAllOptions,
  type Provider,
  type ProviderSnapshot,
  type UsageReport,
} from "./types";

export const PROVIDERS: Provider[] = [
  cursorProvider,
  copilotProvider,
  claudeProvider,
  codexProvider,
  geminiProvider,
  windsurfProvider,
];

export const PROVIDER_IDS = PROVIDERS.map((p) => p.id);

function selectProviders(only?: string[]): Provider[] {
  if (!only || only.length === 0 || only.includes("auto")) {
    return PROVIDERS;
  }
  const wanted = new Set(only.map((id) => id.toLowerCase()));
  return PROVIDERS.filter((p) => wanted.has(p.id));
}

async function loadProvider(
  provider: Provider,
  options: FetchAllOptions,
  ttlMs: number
): Promise<ProviderSnapshot> {
  const available = await provider.detect(options);
  if (!available) {
    return skippedSnapshot(provider.id, provider.displayName);
  }

  const fresh = readFreshCache(provider.id, ttlMs);
  if (fresh) {
    return fresh;
  }

  try {
    const snapshot = await provider.fetch(options);
    if (!snapshot.skipped && !snapshot.error) {
      writeCache(snapshot);
    }
    return snapshot;
  } catch (err) {
    if (isTooManyRequests(err)) {
      const stale = readStaleCache(provider.id);
      if (stale) {
        return stale;
      }
    }
    return failedSnapshot(
      provider.id,
      provider.displayName,
      errorMessage(err)
    );
  }
}

export async function fetchAll(options: FetchAllOptions = {}): Promise<UsageReport> {
  const ttlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const selected = selectProviders(options.only);
  const providers = await Promise.all(
    selected.map((provider) => loadProvider(provider, options, ttlMs))
  );
  const meters = providers
    .filter((p) => !p.skipped && !p.error)
    .flatMap((p) => p.meters);
  return {
    providers,
    meters,
    fetchedAt: Date.now(),
  };
}

export function visibleProviders(report: UsageReport): ProviderSnapshot[] {
  return report.providers.filter((p) => !p.skipped);
}
