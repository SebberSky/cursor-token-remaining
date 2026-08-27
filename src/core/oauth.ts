import * as crypto from "crypto";
import * as http from "http";

export type PkcePair = {
  verifier: string;
  challenge: string;
};

export function createPkce(): PkcePair {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function randomState(): string {
  return crypto.randomBytes(16).toString("hex");
}

export const CLAUDE_OAUTH = {
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  authorize: "https://claude.ai/oauth/authorize",
  token: "https://console.anthropic.com/v1/oauth/token",
  redirect: "https://console.anthropic.com/oauth/code/callback",
  scope: "org:create_api_key user:profile user:inference",
} as const;

export const CODEX_OAUTH = {
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  authorize: "https://auth.openai.com/oauth/authorize",
  token: "https://auth.openai.com/oauth/token",
  redirect: "http://localhost:1455/auth/callback",
  scope: "openid profile email offline_access",
  port: 1455,
  pathname: "/auth/callback",
} as const;

export const GEMINI_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
] as const;

export function claudeAuthorizeUrl(pkce: PkcePair): string {
  const url = new URL(CLAUDE_OAUTH.authorize);
  url.searchParams.set("code", "true");
  url.searchParams.set("client_id", CLAUDE_OAUTH.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", CLAUDE_OAUTH.redirect);
  url.searchParams.set("scope", CLAUDE_OAUTH.scope);
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", pkce.verifier);
  return url.toString();
}

export function parseClaudePasteCode(
  raw: string,
  verifier: string
): { code: string; state: string } {
  let text = raw.trim();
  try {
    const maybeUrl = new URL(text);
    text = maybeUrl.searchParams.get("code") ?? text;
  } catch {
    // pasted code, not a URL
  }
  const hash = text.indexOf("#");
  if (hash >= 0) {
    return {
      code: text.slice(0, hash).trim(),
      state: text.slice(hash + 1).trim() || verifier,
    };
  }
  return { code: text, state: verifier };
}

export function geminiAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GEMINI_OAUTH_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", opts.state);
  return url.toString();
}

export function codexAuthorizeUrl(pkce: PkcePair, state: string): string {
  const url = new URL(CODEX_OAUTH.authorize);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CODEX_OAUTH.clientId);
  url.searchParams.set("redirect_uri", CODEX_OAUTH.redirect);
  url.searchParams.set("scope", CODEX_OAUTH.scope);
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "codex_cli_rs");
  return url.toString();
}

export type OAuthCallback = {
  code: string;
  state: string | null;
};

export type OAuthListener = {
  port: number;
  result: Promise<OAuthCallback>;
  close: () => void;
};

export async function createOAuthListener(opts: {
  host: string;
  port: number;
  pathname: string;
  expectedState?: string;
  timeoutMs?: number;
}): Promise<OAuthListener> {
  const timeoutMs = opts.timeoutMs ?? 4 * 60_000;
  const server = http.createServer();

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.close();
      reject(err);
    };
    server.once("error", onError);
    server.listen(opts.port, opts.host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.port;

  let settled = false;
  let closeFn = () => undefined as void;

  const result = new Promise<OAuthCallback>((resolve, reject) => {
    const finish = (err?: Error, value?: OAuthCallback) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      server.close();
      if (err) {
        reject(err);
      } else if (value) {
        resolve(value);
      }
    };

    closeFn = () => finish(new Error("Login cancelled"));
    const timer = setTimeout(() => finish(new Error("Login timed out")), timeoutMs);

    server.on("request", (req, res) => {
      const requestUrl = new URL(req.url ?? "/", `http://${opts.host}:${port}`);
      if (requestUrl.pathname !== opts.pathname) {
        res.writeHead(404);
        res.end();
        return;
      }
      const error = requestUrl.searchParams.get("error");
      const code = requestUrl.searchParams.get("code");
      const state = requestUrl.searchParams.get("state");
      if (error || !code) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<html><body>Login failed. You can close this tab.</body></html>");
        finish(new Error(error || "OAuth callback missing code"));
        return;
      }
      if (opts.expectedState && state !== opts.expectedState) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<html><body>Login failed (state). You can close this tab.</body></html>");
        finish(new Error("OAuth state mismatch"));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><body>Login OK — close this tab.</body></html>");
      finish(undefined, { code, state });
    });
  });

  return { port, result, close: () => closeFn() };
}

export function isAddressInUse(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "EADDRINUSE";
}
