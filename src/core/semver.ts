export function parseSemver(version: string): [number, number, number] {
  const m = version.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) {
    return [0, 0, 0];
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) {
      return true;
    }
    if (a[i] < b[i]) {
      return false;
    }
  }
  return false;
}

export function normalizeTag(version: string): string {
  const trimmed = version.trim();
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}
