export class HttpStatusError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

export function isTooManyRequests(err: unknown): boolean {
  return err instanceof HttpStatusError && err.status === 429;
}

export function rethrowRateLimit(err: unknown): void {
  if (isTooManyRequests(err)) {
    throw err;
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

export async function getJson(
  url: string,
  headers: Record<string, string>
): Promise<unknown> {
  const res = await fetch(url, { method: "GET", headers });
  const body = await parseBody(res);
  if (!res.ok) {
    throw new HttpStatusError(res.status, `GET ${url} → ${res.status}`);
  }
  return body;
}

export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown = {}
): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body ?? {}),
  });
  const parsed = await parseBody(res);
  if (!res.ok) {
    throw new HttpStatusError(res.status, `POST ${url} → ${res.status}`);
  }
  return parsed;
}
