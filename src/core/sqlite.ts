import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

async function readWithNodeSqlite(
  dbPath: string,
  sql: string
): Promise<string | null> {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db.prepare(sql).get() as Record<string, unknown> | undefined;
      if (!row) {
        return null;
      }
      const first = Object.values(row)[0];
      return first == null ? null : String(first);
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

async function readWithSqliteCli(
  dbPath: string,
  sql: string
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("sqlite3", [dbPath, sql], {
      maxBuffer: 2 * 1024 * 1024,
    });
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function sqliteFirstText(
  dbPath: string,
  sql: string
): Promise<string | null> {
  const fromNode = await readWithNodeSqlite(dbPath, sql);
  if (fromNode) {
    return fromNode;
  }
  return readWithSqliteCli(dbPath, sql);
}

export async function readItemTableValue(
  dbPath: string,
  key: string
): Promise<string | null> {
  const escaped = key.replace(/'/g, "''");
  return sqliteFirstText(
    dbPath,
    `SELECT value FROM ItemTable WHERE key = '${escaped}' LIMIT 1;`
  );
}
