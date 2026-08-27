import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export function homeDir(): string {
  return os.homedir();
}

export function xdgConfigDir(): string {
  if (process.platform === "win32") {
    return process.env.APPDATA || path.join(homeDir(), "AppData", "Roaming");
  }
  if (process.env.XDG_CONFIG_HOME) {
    return process.env.XDG_CONFIG_HOME;
  }
  if (process.platform === "darwin") {
    return path.join(homeDir(), "Library", "Application Support");
  }
  return path.join(homeDir(), ".config");
}

export function xdgCacheDir(): string {
  if (process.platform === "win32") {
    return (
      process.env.LOCALAPPDATA || path.join(homeDir(), "AppData", "Local")
    );
  }
  if (process.env.XDG_CACHE_HOME) {
    return process.env.XDG_CACHE_HOME;
  }
  if (process.platform === "darwin") {
    return path.join(homeDir(), "Library", "Caches");
  }
  return path.join(homeDir(), ".cache");
}

export function vscodeStateDb(appName: string): string {
  if (process.platform === "darwin") {
    return path.join(
      homeDir(),
      "Library",
      "Application Support",
      appName,
      "User",
      "globalStorage",
      "state.vscdb"
    );
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || "",
      appName,
      "User",
      "globalStorage",
      "state.vscdb"
    );
  }
  return path.join(
    homeDir(),
    ".config",
    appName,
    "User",
    "globalStorage",
    "state.vscdb"
  );
}

export function firstExisting(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

export function readJsonFile<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function deleteFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw err;
    }
  }
}
