import { execFile } from "child_process";
import * as crypto from "crypto";
import { promisify } from "util";
import { readItemTableValue, writeItemTableValue } from "./sqlite";
import { postJson } from "./http";
import { vscodeStateDb } from "./paths";

const execFileAsync = promisify(execFile);

/** Public Cursor IDE OAuth client id used by Headroom / OpenUsage / agent. */
export const CURSOR_OAUTH_CLIENT_ID = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const SAFE_STORAGE_PREFIX = "cursor-safe-storage:v1:";
const SAFE_STORAGE_SERVICE = "Cursor Safe Storage";
const SAFE_STORAGE_ACCOUNT = "Cursor Key";

/** Account Cursor uses for CLI/agent Keychain items (not "Cursor"). */
const KEYCHAIN_ACCOUNT = "cursor-user";

export type CursorAuthSource = "sqlite" | "keychain" | "decrypted";

export type CursorCredentials = {
  accessToken: string;
  refreshToken?: string;
  source: CursorAuthSource;
  dbPath?: string;
};

export class CursorAuthError extends Error {
  readonly code:
    | "missing"
    | "encrypted_only"
    | "session_expired"
    | "refresh_failed";

  constructor(code: CursorAuthError["code"], message: string) {
    super(message);
    this.name = "CursorAuthError";
    this.code = code;
  }
}

export function isPlaintextCursorBearer(
  token: string | null | undefined
): boolean {
  if (!token) {
    return false;
  }
  const trimmed = token.trim();
  if (!trimmed || trimmed.startsWith(SAFE_STORAGE_PREFIX)) {
    return false;
  }
  return JWT_RE.test(trimmed);
}

export function isSealedCursorToken(
  token: string | null | undefined
): boolean {
  return !!token?.startsWith(SAFE_STORAGE_PREFIX);
}

export function jwtExpiresAt(token: string): number | null {
  if (!isPlaintextCursorBearer(token)) {
    return null;
  }
  try {
    const payload = token.split(".")[1];
    if (!payload) {
      return null;
    }
    const pad = "=".repeat((4 - (payload.length % 4)) % 4);
    const json = Buffer.from(
      payload.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    const data = JSON.parse(json) as { exp?: unknown };
    return typeof data.exp === "number" ? data.exp : null;
  } catch {
    return null;
  }
}

export function needsProactiveRefresh(
  token: string,
  bufferSec = 300,
  nowSec = Math.floor(Date.now() / 1000)
): boolean {
  const exp = jwtExpiresAt(token);
  if (exp == null) {
    return false;
  }
  return exp - nowSec <= bufferSec;
}

function isFreshAccessToken(token: string): boolean {
  return isPlaintextCursorBearer(token) && !needsProactiveRefresh(token, 0);
}

/**
 * Chromium/Electron OSCrypt `v10` envelope used by Cursor safeStorage on macOS.
 * Key material: Keychain service "Cursor Safe Storage" / account "Cursor Key".
 */
export function decryptCursorSafeStorageValue(
  sealed: string,
  password: string
): string | null {
  if (!isSealedCursorToken(sealed)) {
    return null;
  }
  try {
    const raw = Buffer.from(sealed.slice(SAFE_STORAGE_PREFIX.length), "base64");
    if (raw.subarray(0, 3).toString("utf8") !== "v10") {
      return null;
    }
    const key = crypto.pbkdf2Sync(
      password,
      Buffer.from("saltysalt"),
      1003,
      16,
      "sha1"
    );
    const iv = Buffer.alloc(16, 0x20);
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
    const plain = Buffer.concat([
      decipher.update(raw.subarray(3)),
      decipher.final(),
    ])
      .toString("utf8")
      .trim();
    return isPlaintextCursorBearer(plain) ? plain : null;
  } catch {
    return null;
  }
}

async function readCursorSafeStoragePassword(): Promise<string | null> {
  if (process.platform !== "darwin") {
    return null;
  }
  try {
    const { stdout } = await execFileAsync(
      "security",
      [
        "find-generic-password",
        "-s",
        SAFE_STORAGE_SERVICE,
        "-a",
        SAFE_STORAGE_ACCOUNT,
        "-w",
      ],
      { maxBuffer: 1024 * 1024 }
    );
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function readMacKeychain(
  service: "cursor-access-token" | "cursor-refresh-token"
): Promise<string | null> {
  if (process.platform !== "darwin") {
    return null;
  }
  try {
    const { stdout } = await execFileAsync(
      "security",
      ["find-generic-password", "-s", service, "-a", KEYCHAIN_ACCOUNT, "-w"],
      { maxBuffer: 1024 * 1024 }
    );
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    try {
      const { stdout } = await execFileAsync(
        "security",
        ["find-generic-password", "-s", service, "-w"],
        { maxBuffer: 1024 * 1024 }
      );
      const value = stdout.trim();
      return value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }
}

async function writeMacKeychain(
  service: "cursor-access-token" | "cursor-refresh-token",
  value: string
): Promise<void> {
  if (process.platform !== "darwin") {
    return;
  }
  try {
    await execFileAsync("security", [
      "add-generic-password",
      "-U",
      "-s",
      service,
      "-a",
      KEYCHAIN_ACCOUNT,
      "-w",
      value,
    ]);
  } catch {
    // Best-effort; in-memory bearer still works for this process.
  }
}

async function credentialsFromSqlite(
  dbPath: string
): Promise<CursorCredentials | null> {
  const sqliteAccess = await readItemTableValue(
    dbPath,
    "cursorAuth/accessToken"
  );
  const sqliteRefresh = await readItemTableValue(
    dbPath,
    "cursorAuth/refreshToken"
  );

  if (isPlaintextCursorBearer(sqliteAccess)) {
    return {
      accessToken: sqliteAccess!.trim(),
      refreshToken: isPlaintextCursorBearer(sqliteRefresh)
        ? sqliteRefresh!.trim()
        : undefined,
      source: "sqlite",
      dbPath,
    };
  }

  if (!isSealedCursorToken(sqliteAccess)) {
    return null;
  }

  const password = await readCursorSafeStoragePassword();
  if (!password) {
    return null;
  }

  const access = decryptCursorSafeStorageValue(sqliteAccess!, password);
  if (!access) {
    return null;
  }

  let refresh: string | undefined;
  if (isSealedCursorToken(sqliteRefresh)) {
    refresh =
      decryptCursorSafeStorageValue(sqliteRefresh!, password) ?? undefined;
  } else if (isPlaintextCursorBearer(sqliteRefresh)) {
    refresh = sqliteRefresh!.trim();
  }

  return {
    accessToken: access,
    refreshToken: refresh,
    // Never write plaintext back over sealed sqlite rows.
    source: "decrypted",
    dbPath,
  };
}

async function credentialsFromKeychain(
  dbPath: string
): Promise<CursorCredentials | null> {
  const keyAccess = await readMacKeychain("cursor-access-token");
  if (!isPlaintextCursorBearer(keyAccess)) {
    return null;
  }
  const keyRefresh = await readMacKeychain("cursor-refresh-token");
  return {
    accessToken: keyAccess!.trim(),
    refreshToken: isPlaintextCursorBearer(keyRefresh)
      ? keyRefresh!.trim()
      : undefined,
    source: "keychain",
    dbPath,
  };
}

export async function loadCursorCredentials(): Promise<CursorCredentials> {
  const dbPath = vscodeStateDb("Cursor");
  const candidates: CursorCredentials[] = [];

  const fromSqlite = await credentialsFromSqlite(dbPath);
  if (fromSqlite) {
    candidates.push(fromSqlite);
  }

  const fromKeychain = await credentialsFromKeychain(dbPath);
  if (fromKeychain) {
    candidates.push(fromKeychain);
  }

  const fresh = candidates.find((c) => isFreshAccessToken(c.accessToken));
  if (fresh) {
    return fresh;
  }
  if (candidates.length > 0) {
    return candidates[0]!;
  }

  const sealed = await readItemTableValue(dbPath, "cursorAuth/accessToken");
  if (isSealedCursorToken(sealed)) {
    throw new CursorAuthError(
      "encrypted_only",
      "Cursor token in state DB is encrypted; could not decrypt via Keychain Safe Storage."
    );
  }

  throw new CursorAuthError(
    "missing",
    "Could not read Cursor access token. Are you signed in?"
  );
}

export async function refreshCursorAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken?: string }> {
  if (!isPlaintextCursorBearer(refreshToken)) {
    throw new CursorAuthError(
      "refresh_failed",
      "Cursor refresh token is not usable (encrypted or missing)."
    );
  }

  const data = (await postJson(
    "https://api2.cursor.sh/oauth/token",
    {},
    {
      grant_type: "refresh_token",
      client_id: CURSOR_OAUTH_CLIENT_ID,
      refresh_token: refreshToken,
    }
  )) as {
    access_token?: string;
    refresh_token?: string;
    shouldLogout?: boolean;
  };

  if (data.shouldLogout) {
    throw new CursorAuthError(
      "session_expired",
      "Cursor session expired (refresh rejected)."
    );
  }

  const access = data.access_token?.trim();
  if (!isPlaintextCursorBearer(access)) {
    throw new CursorAuthError(
      "refresh_failed",
      "Cursor OAuth refresh did not return a usable access token."
    );
  }

  return {
    accessToken: access!,
    refreshToken: isPlaintextCursorBearer(data.refresh_token)
      ? data.refresh_token!.trim()
      : undefined,
  };
}

export async function persistCursorAccessToken(
  creds: CursorCredentials,
  accessToken: string,
  refreshToken?: string
): Promise<void> {
  if (!isPlaintextCursorBearer(accessToken)) {
    return;
  }

  if (creds.source === "sqlite" && creds.dbPath) {
    await writeItemTableValue(creds.dbPath, "cursorAuth/accessToken", accessToken);
    if (refreshToken && isPlaintextCursorBearer(refreshToken)) {
      await writeItemTableValue(
        creds.dbPath,
        "cursorAuth/refreshToken",
        refreshToken
      );
    }
    return;
  }

  // keychain + decrypted (keep sealed sqlite untouched)
  if (creds.source === "keychain" || creds.source === "decrypted") {
    await writeMacKeychain("cursor-access-token", accessToken);
    if (refreshToken && isPlaintextCursorBearer(refreshToken)) {
      await writeMacKeychain("cursor-refresh-token", refreshToken);
    }
  }
}

export async function resolveCursorBearer(): Promise<{
  token: string;
  creds: CursorCredentials;
}> {
  const creds = await loadCursorCredentials();
  let token = creds.accessToken;

  if (needsProactiveRefresh(token) && creds.refreshToken) {
    try {
      const next = await refreshCursorAccessToken(creds.refreshToken);
      token = next.accessToken;
      await persistCursorAccessToken(creds, next.accessToken, next.refreshToken);
      return {
        token,
        creds: {
          ...creds,
          accessToken: next.accessToken,
          refreshToken: next.refreshToken ?? creds.refreshToken,
        },
      };
    } catch (err) {
      if (err instanceof CursorAuthError && err.code === "session_expired") {
        // Access JWT may still be valid for a short window; keep using it.
        if (!needsProactiveRefresh(token, 0)) {
          return { token, creds };
        }
        throw err;
      }
      // Fall through with current access token if refresh fails for other reasons.
    }
  }

  return { token, creds };
}
