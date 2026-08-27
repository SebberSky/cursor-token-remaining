import * as vscode from "vscode";
import { PROVIDERS } from "./core/fetchAll";
import {
  CLAUDE_OAUTH,
  CODEX_OAUTH,
  claudeAuthorizeUrl,
  codexAuthorizeUrl,
  createOAuthListener,
  createPkce,
  geminiAuthorizeUrl,
  isAddressInUse,
  parseClaudePasteCode,
  randomState,
  type OAuthListener,
} from "./core/oauth";
import {
  clearClaudeCredentials,
  saveClaudeOAuth,
} from "./core/providers/claude";
import {
  clearCodexAuth,
  saveCodexOAuth,
} from "./core/providers/codex";
import {
  clearGeminiCreds,
  geminiOAuthClient,
  saveGeminiCreds,
} from "./core/providers/gemini";
import { ensureCli, findBinary, loginCommand, type CliTool } from "./cliTools";

export type SignInResult = "refreshed" | "pending" | "cancelled";

const LOGIN_DETAIL: Record<string, string> = {
  cursor: "ล็อกอินผ่าน Accounts ใน IDE",
  copilot: "ล็อกอิน GitHub ในเบราว์เซอร์",
  claude: "เปิดเบราว์เซอร์ claude.ai",
  codex: "เปิดเบราว์เซอร์ ChatGPT",
  gemini: "เปิดเบราว์เซอร์ Google",
  windsurf: "ล็อกอินในแอป Windsurf",
};

export async function pickAndSignIn(activeIds: string[]): Promise<SignInResult> {
  const signedIn = new Set(activeIds);
  type Item = vscode.QuickPickItem & { id: string; already: boolean };
  const items: Item[] = PROVIDERS.map((provider) => {
    const already = signedIn.has(provider.id);
    return {
      id: provider.id,
      already,
      label: already
        ? `$(sign-out) ${provider.displayName}`
        : `$(plug) ${provider.displayName}`,
      description: already ? "ล็อกอินอยู่แล้ว — คลิกเพื่อล็อกเอาต์" : "ยังไม่ล็อกอิน",
      detail: already ? "ล็อกเอาต์" : LOGIN_DETAIL[provider.id],
    };
  });

  const unsigned = items.filter((item) => !item.already);
  const ordered = [...unsigned, ...items.filter((item) => item.already)];

  const picked = await vscode.window.showQuickPick(ordered, {
    title: "ล็อกอิน / ล็อกเอาต์",
    placeHolder:
      unsigned.length === 0
        ? "ล็อกอินครบแล้ว — เลือกเจ้าเพื่อล็อกเอาต์"
        : "เลือกเจ้าที่ยังไม่มี หรือคลิกอันที่ล็อกอินอยู่เพื่อออก",
  });
  if (!picked) {
    return "cancelled";
  }
  if (picked.already) {
    return startSignOut(picked.id);
  }
  return startSignIn(picked.id);
}

async function startSignOut(providerId: string): Promise<SignInResult> {
  if (providerId === "cursor" || providerId === "windsurf" || providerId === "copilot") {
    const label =
      providerId === "copilot" ? "GitHub / Copilot" : providerId;
    const next = await vscode.window.showWarningMessage(
      `ล็อกเอาต์ ${label} จากบัญชีใน IDE นี้`,
      { modal: true },
      "ล็อกเอาต์"
    );
    if (next !== "ล็อกเอาต์") {
      return "cancelled";
    }
    await openAccounts();
    if (providerId === "copilot") {
      await tryGithubSignOut();
    }
    return "pending";
  }

  if (providerId === "claude") {
    await runCliIfPresent("claude", ["auth", "logout"]);
    clearClaudeCredentials();
    return "refreshed";
  }
  if (providerId === "codex") {
    await runCliIfPresent("codex", ["logout"]);
    clearCodexAuth();
    return "refreshed";
  }
  if (providerId === "gemini") {
    await runCliIfPresent("gemini", ["auth", "logout"]);
    clearGeminiCreds();
    return "refreshed";
  }
  return "cancelled";
}

async function startSignIn(providerId: string): Promise<SignInResult> {
  const app = vscode.env.appName.toLowerCase();
  if (providerId === "windsurf" && !app.includes("windsurf")) {
    return askRefresh("เปิดแอป Windsurf แล้ว Sign in จากนั้นกลับมา Refresh");
  }
  if (providerId === "cursor" && !app.includes("cursor")) {
    return askRefresh("เปิดแอป Cursor แล้ว Sign in จากนั้นกลับมา Refresh");
  }

  if (providerId === "copilot") {
    try {
      await vscode.authentication.getSession("github", ["read:user"], {
        createIfNone: true,
      });
      return "refreshed";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`GitHub sign-in failed: ${message}`);
      return "cancelled";
    }
  }

  if (providerId === "cursor" || providerId === "windsurf") {
    await openAccounts();
    return askRefresh(`ล็อกอิน ${providerId} จาก Accounts แล้วกด Refresh`);
  }

  try {
    if (providerId === "claude") {
      const ok = await loginClaudeWeb();
      return ok ? "refreshed" : "cancelled";
    }
    if (providerId === "gemini") {
      if (!geminiOAuthClient()) {
        return loginViaCli("gemini");
      }
      await loginGeminiWeb();
      return "refreshed";
    }
    if (providerId === "codex") {
      return loginCodexWeb();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (providerId === "claude" || providerId === "codex" || providerId === "gemini") {
      const fallback = await vscode.window.showWarningMessage(
        `ล็อกอินเว็บไม่สำเร็จ: ${message}`,
        "ติดตั้ง CLI แล้วล็อกอิน"
      );
      if (fallback === "ติดตั้ง CLI แล้วล็อกอิน") {
        return loginViaCli(providerId);
      }
    } else {
      void vscode.window.showErrorMessage(message);
    }
    return "cancelled";
  }

  return "cancelled";
}

async function loginClaudeWeb(): Promise<boolean> {
  const pkce = createPkce();
  await vscode.env.openExternal(vscode.Uri.parse(claudeAuthorizeUrl(pkce)));
  const pasted = await vscode.window.showInputBox({
    title: "Claude login",
    prompt: "ล็อกอินในเบราว์เซอร์แล้ววางโค้ดที่ได้นี่ (รูปแบบ code#state)",
    ignoreFocusOut: true,
  });
  if (pasted == null || pasted.trim() === "") {
    return false;
  }
  const { code, state } = parseClaudePasteCode(pasted, pkce.verifier);
  const res = await fetch(CLAUDE_OAUTH.token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      state,
      grant_type: "authorization_code",
      client_id: CLAUDE_OAUTH.clientId,
      redirect_uri: CLAUDE_OAUTH.redirect,
      code_verifier: pkce.verifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`Claude token ${res.status}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) {
    throw new Error("Claude token response missing access_token");
  }
  saveClaudeOAuth({
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt:
      typeof json.expires_in === "number"
        ? Date.now() + json.expires_in * 1000
        : undefined,
  });
  return true;
}

async function loginGeminiWeb(): Promise<void> {
  const client = geminiOAuthClient();
  if (!client) {
    throw new Error("Gemini OAuth client env vars are not set");
  }
  const state = randomState();
  const listener = await createOAuthListener({
    host: "127.0.0.1",
    port: 0,
    pathname: "/oauth2callback",
    expectedState: state,
  });
  void listener.result.catch(() => undefined);
  const redirectUri = `http://127.0.0.1:${listener.port}/oauth2callback`;
  try {
    await vscode.env.openExternal(
      vscode.Uri.parse(
        geminiAuthorizeUrl({ clientId: client.id, redirectUri, state })
      )
    );
    const callback = await withLoginProgress(
      "รอการล็อกอิน Gemini ในเบราว์เซอร์",
      listener.result
    );
    const body = new URLSearchParams({
      client_id: client.id,
      client_secret: client.secret,
      code: callback.code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      throw new Error(`Gemini token ${res.status}`);
    }
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
      id_token?: string;
    };
    if (!json.access_token) {
      throw new Error("Gemini token response missing access_token");
    }
    saveGeminiCreds({
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      token_type: json.token_type,
      id_token: json.id_token,
      expiry_date:
        typeof json.expires_in === "number"
          ? Date.now() + json.expires_in * 1000
          : undefined,
    });
  } finally {
    listener.close();
  }
}

async function loginCodexWeb(): Promise<SignInResult> {
  const pkce = createPkce();
  const state = randomState();
  let listener: OAuthListener;
  try {
    listener = await createOAuthListener({
      host: "localhost",
      port: CODEX_OAUTH.port,
      pathname: CODEX_OAUTH.pathname,
      expectedState: state,
    });
  } catch (err) {
    if (isAddressInUse(err)) {
      return loginViaCli("codex");
    }
    throw err;
  }
  void listener.result.catch(() => undefined);
  try {
    await vscode.env.openExternal(
      vscode.Uri.parse(codexAuthorizeUrl(pkce, state))
    );
    const callback = await withLoginProgress(
      "รอการล็อกอิน Codex ในเบราว์เซอร์",
      listener.result
    );
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CODEX_OAUTH.clientId,
      code: callback.code,
      redirect_uri: CODEX_OAUTH.redirect,
      code_verifier: pkce.verifier,
    });
    const res = await fetch(CODEX_OAUTH.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      throw new Error(`Codex token ${res.status}`);
    }
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      id_token?: string;
    };
    if (!json.access_token) {
      throw new Error("Codex token response missing access_token");
    }
    saveCodexOAuth({
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      idToken: json.id_token,
    });
    return "refreshed";
  } finally {
    listener.close();
  }
}

async function loginViaCli(tool: CliTool): Promise<SignInResult> {
  const bin = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `กำลังหา/ติดตั้ง ${tool} CLI...`,
    },
    () => ensureCli(tool)
  );
  const term = vscode.window.createTerminal({ name: `Tokens — ${tool}` });
  term.show();
  term.sendText(loginCommand(tool, bin));
  return askRefresh(`ล็อกอิน ${tool} ในเบราว์เซอร์/เทอร์มินัลให้เสร็จ แล้วกด Refresh`);
}

async function withLoginProgress<T>(title: string, pending: Promise<T>): Promise<T> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: false,
    },
    () => pending
  );
}

async function runCliIfPresent(tool: CliTool, args: string[]): Promise<void> {
  const bin = await findBinary(tool);
  if (!bin) {
    return;
  }
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);
  try {
    await execFileAsync(bin, args, { timeout: 20_000 });
  } catch {
    // file delete still runs
  }
}

async function openAccounts(): Promise<void> {
  try {
    await vscode.commands.executeCommand("workbench.action.manageAccounts");
  } catch {
    try {
      await vscode.commands.executeCommand("workbench.action.showAccounts");
    } catch {
      // ignore missing command
    }
  }
}

async function tryGithubSignOut(): Promise<void> {
  for (const cmd of ["github.signout", "github.accounts.signOut"]) {
    try {
      await vscode.commands.executeCommand(cmd);
      return;
    } catch {
      // try next
    }
  }
}

async function askRefresh(message: string): Promise<SignInResult> {
  const next = await vscode.window.showInformationMessage(message, "Refresh");
  return next === "Refresh" ? "refreshed" : "pending";
}
