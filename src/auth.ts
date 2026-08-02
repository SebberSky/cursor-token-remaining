import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export function getStateDbPath(): string {
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb"
    );
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || "",
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb"
    );
  }
  return path.join(
    os.homedir(),
    ".config",
    "Cursor",
    "User",
    "globalStorage",
    "state.vscdb"
  );
}

async function readTokenWithNodeSqlite(dbPath: string): Promise<string | null> {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db
        .prepare("SELECT value FROM ItemTable WHERE key = ? LIMIT 1")
        .get("cursorAuth/accessToken") as { value: string } | undefined;
      return row?.value ?? null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

async function readTokenWithSqliteCli(dbPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "sqlite3",
      [dbPath, "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken' LIMIT 1;"],
      { maxBuffer: 2 * 1024 * 1024 }
    );
    const token = stdout.trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export async function getAccessToken(): Promise<string> {
  const dbPath = getStateDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error("Cursor state database not found. Sign in to Cursor first.");
  }

  const fromNode = await readTokenWithNodeSqlite(dbPath);
  if (fromNode) {
    return fromNode;
  }

  const fromCli = await readTokenWithSqliteCli(dbPath);
  if (fromCli) {
    return fromCli;
  }

  throw new Error("Could not read Cursor access token. Are you signed in?");
}
