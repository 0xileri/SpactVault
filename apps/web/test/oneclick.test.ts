import { buildQuoteRequest, crossChainArgs, MockOneClick, mockQuoteSigner, signQuoteForMock } from "@spact/intents";
import { digestInputFromRequest, requestHash, type PaymentRequest } from "@spact/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

// Recorded from the live 1Click API on 2026-11-03 (packages/intents/test/fixtures/live). No network here:
// 1Click is a MockOneClick serving those exact answers, and the NEAR RPC is a stub.
import { body as liveQuote } from "../../../packages/intents/test/fixtures/live/quote.ts";
import { LIVE } from "../../../packages/intents/test/fixtures/live/request.ts";
import { body as livePending } from "../../../packages/intents/test/fixtures/live/status-pending.ts";
import { assess } from "../src/approval.js";
import { parseConfig, type AppConfig } from "../src/config.js";
import type { VaultSnapshot } from "../src/near/vault.js";
import { checkDeposit } from "../src/oneclick.js";

const VAULT = "vault.0xileri.near";
const DEPOSIT = "041951e133e32d3ab1fc32f2df4d1ea201c689c8736895fd239fb0f68e2087bc";
const QUOTED_AT = new Date("2026-11-03T10:54:16.072Z");
const NOW_NS = BigInt(QUOTED_AT.getTime()) * 1_000_000n;

const config: AppConfig = parseConfig({
  VITE_NEAR_NETWORK: "mainnet",
  VITE_NEAR_RPC_URL: "https://rpc.example",
  VITE_VAULT_ID: VAULT,
  VITE_ONECLICK_URL: "/1click",
});

/** The request the agent files from the live quote, as the vault stores it while it waits for the owner. */
function filed(): PaymentRequest {
  const args = crossChainArgs(
    buildQuoteRequest({ vaultId: VAULT, token: LIVE.usdc, amount: 1_000_000n, destinationAsset: LIVE.solUsdc, recipient: LIVE.recipient, slippageBps: 100, deadline: new Date(LIVE.deadline), dry: false }),
    liveQuote,
    "sol",
    QUOTED_AT,
  );
  const r: PaymentRequest = {
    request_id: "live-1",
    agent_id: "agent2.0xileri.near",
    route: "ONE_CLICK_ORIGIN_NEAR",
    token: args.token,
    amount: args.amount,
    recipient: args.deposit_account,
    reason: "recorded live quote",
    created_at_ns: NOW_NS.toString(),
    expires_at_ns: (BigInt(args.terms.quote_expires_at_ns) - 60_000_000_000n).toString(),
    policy_version: 1,
    cross_chain: args.terms,
    request_hash: "",
    status: "AWAITING_APPROVAL",
    reason_code: "REQUIRES_OWNER_APPROVAL",
    approved_by: null,
    reserved_day: null,
    updated_at_ns: NOW_NS.toString(),
  };
  return { ...r, request_hash: requestHash(digestInputFromRequest("mainnet", VAULT, r)) };
}

/** A NEAR RPC whose only contract answers are USDC's storage views for the deposit address. */
function stubRpc(registered: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const params = (JSON.parse(String(init?.body)) as { params: { method_name: string } }).params;
      const value = params.method_name === "storage_balance_of" ? (registered ? { total: "1250000000000000000000", available: "0" } : null) : { min: "1250000000000000000000", max: "1250000000000000000000" };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "x", result: { result: Array.from(new TextEncoder().encode(JSON.stringify(value))) } }));
    }),
  );
}

const oneClick = (status: unknown, tokens: unknown = []) => new MockOneClick({ tokens, quote: () => ({}), status: { [DEPOSIT]: status } });

afterEach(() => vi.unstubAllGlobals());

describe("the approval page's 1Click check, on live answers", () => {
  it("1Click's live record of an unused deposit address confirms the request, signature included", async () => {
    stubRpc(true);
    const check = await checkDeposit(config, oneClick(livePending), filed());
    expect(check.state).toBe("verified");
    if (check.state !== "verified") return;
    expect(check.status.status).toBe("PENDING_DEPOSIT");
    expect(check.registered).toBe(true);
  });

  it("refuses the record when its terms differ from the request", async () => {
    stubRpc(true);
    const r = filed();
    if (!r.cross_chain) throw new Error("not cross-chain");
    const check = await checkDeposit(config, oneClick(livePending), { ...r, cross_chain: { ...r.cross_chain, destination_recipient: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" } });
    expect(check).toMatchObject({ state: "mismatch", mismatches: [expect.stringMatching(/^final recipient: 1Click has 7EcDh/)] });
  });

  it("refuses a record that matches but is not signed by 1Click: a forger between the page and 1Click", async () => {
    stubRpc(true);
    // same terms, a different display amount: the signature no longer covers what is shown
    const forged = structuredClone(livePending);
    forged.quoteResponse.quote.amountOutFormatted = "0.999999";
    expect((await checkDeposit(config, oneClick(forged), filed())).state).toBe("mismatch");
    // and a record signed with another key is not 1Click's either
    const other = { ...livePending, quoteResponse: signQuoteForMock({ ...livePending.quoteResponse, signature: "" }, mockQuoteSigner().secretKey) };
    const check = await checkDeposit(config, oneClick(other), filed());
    expect(check).toMatchObject({ state: "mismatch", mismatches: [expect.stringMatching(/signature on this quote does not verify/)] });
  });

  it("Approve works only once 1Click's record checks out and the deposit address can receive USDC", async () => {
    const snapshot: VaultSnapshot = {
      config: { vault_id: VAULT, owner: "0xileri.near", network: "mainnet", agents: ["agent2.0xileri.near"], paused: false, policy_version: 1, open_approvals: 1, request_count: 1 },
      policy: { tokens: [], recipients: [], max_open_approvals: 3, max_requests_per_day: 20, approval_ttl_sec: 86400, cross_chain: [] },
      request: filed(),
      budget: null,
      token: { symbol: "USDC", decimals: 6 },
      nowNs: NOW_NS,
    };
    const decide = (deposit: Awaited<ReturnType<typeof checkDeposit>>) =>
      assess({ config, snapshot, signerAvailable: true, signerAccountId: "0xileri.near", executeNow: true, deposit });

    stubRpc(true);
    const ok = decide(await checkDeposit(config, oneClick(livePending), filed()));
    expect(ok.problems.map((p) => p.code)).toEqual([]);
    expect(ok.canApprove).toBe(true);

    stubRpc(false);
    const unregistered = decide(await checkDeposit(config, oneClick(livePending), filed()));
    expect(unregistered.problems.map((p) => p.code)).toEqual(["DEPOSIT_NOT_REGISTERED"]);
    expect(unregistered.canApprove).toBe(false);

    const down = decide(await checkDeposit(config, new MockOneClick({ tokens: [], quote: () => ({}), status: {} }), filed()));
    expect(down.problems.map((p) => p.code)).toEqual(["DEPOSIT_UNVERIFIED"]);
    expect(down.canReject).toBe(true);
  });
});
