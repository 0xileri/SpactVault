import type { QuoteRequest } from "./schemas.js";

/**
 * Talking to the 1Click API. Responses come back as `unknown`: callers validate them with the
 * schemas in this package before using any field.
 *
 * The live client is off unless ENABLE_1CLICK_LIVE is true (AGENTS.md section 14). It was never run
 * against the real API from the build environment, where the host is blocked.
 */
export interface OneClickApi {
  readonly kind: "live" | "mock";
  tokens(): Promise<unknown>;
  quote(request: QuoteRequest): Promise<unknown>;
  status(depositAddress: string): Promise<unknown>;
}

/** Base URL from AGENTS.md section 8 and the SDK's OpenAPI config. */
export const ONE_CLICK_BASE_URL = "https://1click.chaindefuser.com";

export interface LiveOptions {
  /** Must be true; anything else refuses to build a live client. */
  enabled: boolean;
  baseUrl?: string;
  /** Optional API key, sent as a Bearer token. Server side only: never ship it to a browser. */
  jwt?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function liveOneClick(options: LiveOptions): OneClickApi {
  if (options.enabled !== true) throw new Error("ENABLE_1CLICK_LIVE is not true: the live 1Click API is off");
  const base = new URL(options.baseUrl ?? ONE_CLICK_BASE_URL);
  if (base.protocol !== "https:") throw new Error("the 1Click base URL must use https");
  const headers: Record<string, string> = {};
  if (options.jwt) headers.authorization = `Bearer ${options.jwt}`;
  return oneClickOverHttp(base.toString(), { fetch: options.fetch, timeoutMs: options.timeoutMs, headers });
}

/**
 * A 1Click error answer. `apiMessage` is 1Click's own `message` field, cut to 160 printable characters.
 * Live, a quote refunding to a NEAR account that does not exist gets HTTP 400 "Internal server error"
 * (test/fixtures/live/errors.ts), so that case gets a hint.
 */
export class OneClickHttpError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    readonly apiMessage: string | null,
  ) {
    const hint = path === "/v0/quote" && status === 400 ? " (one known cause: the refund account does not exist on NEAR)" : "";
    super(`1Click ${path} answered HTTP ${status}${apiMessage ? `: ${apiMessage}` : ""}${hint}`);
  }
}

async function errorMessageOf(res: Response): Promise<string | null> {
  try {
    const body: unknown = await res.json();
    const message = typeof body === "object" && body !== null ? (body as Record<string, unknown>).message : undefined;
    // eslint-disable-next-line no-control-regex
    return typeof message === "string" ? message.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 160) : null;
  } catch {
    return null;
  }
}

export interface HttpOptions {
  fetch?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
  headers?: Record<string, string>;
}

/**
 * The 1Click API at `base`, which may carry a path prefix: `/1click` (the web app's same-origin proxy,
 * apps/web/Caddyfile), `https://1click.chaindefuser.com`, or a local mock. Paths are appended to the prefix,
 * never resolved against the host. Callers decide whether a base is allowed (liveOneClick, apps/web config).
 */
export function oneClickOverHttp(base: string, options: HttpOptions = {}): OneClickApi {
  const prefix = base.replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const headers: Record<string, string> = { accept: "application/json", ...options.headers };

  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await doFetch(`${prefix}${path}`, {
      ...init,
      headers: { ...headers, ...(init.body ? { "content-type": "application/json" } : {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new OneClickHttpError(path.split("?")[0] ?? path, res.status, await errorMessageOf(res));
    return res.json();
  }

  return {
    kind: "live",
    tokens: () => call("/v0/tokens"),
    quote: (request) => call("/v0/quote", { method: "POST", body: JSON.stringify(request) }),
    status: (depositAddress) => call(`/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`),
  };
}

export interface MockFixtures {
  tokens: unknown;
  /** Builds a quote answer for a request, as the mock 1Click would. */
  quote: (request: QuoteRequest) => unknown;
  /** Status answers by deposit address. */
  status: Record<string, unknown>;
}

/**
 * MockOneClick: an explicitly named stand-in for the 1Click API, serving fixtures shaped by the
 * SDK's types (AGENTS.md section 0: a mock adapter, never a dummy success). Tests and local demos only.
 */
export class MockOneClick implements OneClickApi {
  readonly kind = "mock";
  readonly calls: { method: string; arg: unknown }[] = [];

  constructor(private readonly fixtures: MockFixtures) {}

  tokens(): Promise<unknown> {
    this.calls.push({ method: "tokens", arg: null });
    return Promise.resolve(this.fixtures.tokens);
  }

  quote(request: QuoteRequest): Promise<unknown> {
    this.calls.push({ method: "quote", arg: request });
    return Promise.resolve(this.fixtures.quote(request));
  }

  status(depositAddress: string): Promise<unknown> {
    this.calls.push({ method: "status", arg: depositAddress });
    const answer = this.fixtures.status[depositAddress];
    return answer === undefined ? Promise.reject(new Error("mock 1Click: unknown deposit address")) : Promise.resolve(answer);
  }
}
