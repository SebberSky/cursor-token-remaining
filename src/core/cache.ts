import * as fs from "fs";
import * as path from "path";
import { xdgCacheDir } from "./paths";
import type { ProviderSnapshot } from "./types";

type CacheFile = {
  fetchedAt: number;
  snapshot: ProviderSnapshot;
};

function cacheFilePath(providerId: string): string {
  const safe = providerId.replace(/[^a-z0-9._-]+/gi, "_");
  return path.join(xdgCacheDir(), "token-remaining", `${safe}.json`);
}

function readFile(providerId: string): CacheFile | null {
  try {
    const raw = fs.readFileSync(cacheFilePath(providerId), "utf8");
    const parsed = JSON.parse(raw) as CacheFile;
    if (!parsed || typeof parsed.fetchedAt !== "number" || !parsed.snapshot) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function readFreshCache(
  providerId: string,
  ttlMs: number
): ProviderSnapshot | null {
  const cached = readFile(providerId);
  if (!cached) {
    return null;
  }
  if (Date.now() - cached.fetchedAt > ttlMs) {
    return null;
  }
  return cached.snapshot;
}

export function readStaleCache(providerId: string): ProviderSnapshot | null {
  return readFile(providerId)?.snapshot ?? null;
}

export function writeCache(snapshot: ProviderSnapshot): void {
  if (snapshot.skipped || snapshot.error) {
    return;
  }
  const filePath = cacheFilePath(snapshot.id);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload: CacheFile = {
    fetchedAt: snapshot.fetchedAt,
    snapshot,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(payload)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}
