import { describe, expect, it } from "vitest";

import { chainName, findRoute, liveOneClick, MockOneClick, oneClickOverHttp, txExplorerLink } from "../src/index.js";
import { asked, DEPOSIT, quoteFor, SOL_USDC, statusFor, TOKEN, TOKENS } from "./fixtures.js";

describe("1Click clients", () => {
  it("keeps the live client off unless ENABLE_1CLICK_LIVE is true, and https only", () => {
    expect(() => liveOneClick({ enabled: false })).toThrow(/ENABLE_1CLICK_LIVE/);
    expect(() => liveOneClick({ enabled: true, baseUrl: "http://1click.example" })).toThrow(/https/);
  });

  it("calls the documented 1Click paths and hands back the raw answer for the caller to validate", async () => {
    const seen: { url: string; method: string; body: unknown; auth: string | null }[] = [];
    const fakeFetch: typeof fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      seen.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null, auth: headers.get("authorization") });
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    };
    const api = liveOneClick({ enabled: true, jwt: "test-jwt", fetch: fakeFetch });
    await api.tokens();
    await api.quote(asked());
    await api.status(DEPOSIT);
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      "GET https://1click.chaindefuser.com/v0/tokens",
      "POST https://1click.chaindefuser.com/v0/quote",
      `GET https://1click.chaindefuser.com/v0/status?depositAddress=${DEPOSIT}`,
    ]);
    expect(seen[1]?.body).toEqual(asked());
    expect(seen.every((s) => s.auth === "Bearer test-jwt")).toBe(true);
    const failing = liveOneClick({ enabled: true, fetch: () => Promise.resolve(new Response("", { status: 503 })) });
    await expect(failing.tokens()).rejects.toThrow(/HTTP 503/);
  });

  it("MockOneClick serves fixtures, says it is a mock, and knows only the deposit addresses it was given", async () => {
    const mock = new MockOneClick({ tokens: TOKENS, quote: (r) => quoteFor(r), status: { [DEPOSIT]: statusFor(asked(), "PROCESSING") } });
    expect(mock.kind).toBe("mock");
    expect(findRoute(await mock.tokens(), TOKEN, SOL_USDC)?.destination.blockchain).toBe("sol");
    expect(findRoute(await mock.tokens(), "other.near", SOL_USDC)).toBeNull();
    expect(await mock.quote(asked())).toEqual(quoteFor(asked()));
    await expect(mock.status("unknown.near")).rejects.toThrow(/unknown deposit address/);
    expect(mock.calls.map((c) => c.method)).toEqual(["tokens", "tokens", "quote", "status"]);
  });
});

describe("oneClickOverHttp", () => {
  it("keeps a path prefix such as the web app's /1click proxy", async () => {
    const seen: string[] = [];
    const fake = (async (url: string) => {
      seen.push(url);
      return new Response("[]", { status: 200 });
    }) as unknown as typeof fetch;
    const api = oneClickOverHttp("/1click/", { fetch: fake });
    await api.tokens();
    await api.status("ab12");
    expect(seen).toEqual(["/1click/v0/tokens", "/1click/v0/status?depositAddress=ab12"]);
    const remote = oneClickOverHttp("https://spactvault.example/1click", { fetch: fake });
    await remote.tokens();
    expect(seen.at(-1)).toBe("https://spactvault.example/1click/v0/tokens");
  });
});

describe("txExplorerLink", () => {
  it("links known chains only, for hashes in that chain's format", () => {
    expect(txExplorerLink("sol", "5h3kZr8DQ9k8s1v3Cw2n4e6R8t1y3u5i7o9p1a3s5d7f9g1h3j5k7m9z1x3c5v7b9")).toMatch(/^https:\/\/solscan\.io\/tx\//);
    expect(txExplorerLink("base", `0x${"ab".repeat(32)}`)).toBe(`https://basescan.org/tx/0x${"ab".repeat(32)}`);
    expect(txExplorerLink("base", "5h3kZr8DQ9k8s1v3Cw2n4e6R8t1y3u5i7o9p1a3s")).toBeNull();
    expect(txExplorerLink("near", "RqphTo2Hy9ifsW7Y2PDXFM2A8gtcxu6GHdBuzfcP2oB")).toBe("https://nearblocks.io/txns/RqphTo2Hy9ifsW7Y2PDXFM2A8gtcxu6GHdBuzfcP2oB");
    expect(txExplorerLink("evilchain", `0x${"ab".repeat(32)}`)).toBeNull();
    expect(chainName("sol")).toBe("Solana");
    expect(chainName("zz")).toBe("zz");
  });
});
