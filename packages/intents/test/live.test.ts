import type { PaymentRequest } from "@spact/shared";
import { describe, expect, it } from "vitest";

import {
  buildQuoteRequest,
  crossChainArgs,
  depositMismatches,
  oneClickOverHttp,
  OneClickHttpError,
  quoteHash,
  quoteResponseSchema,
  reconcile,
  statusResponseSchema,
  verifyQuoteSignature,
} from "../src/index.js";
import { errors } from "./fixtures/live/index.js";
import * as dry from "./fixtures/live/quote-dry.js";
import * as live from "./fixtures/live/quote.js";
import { LIVE, liveRequest } from "./fixtures/live/request.js";
import * as pending from "./fixtures/live/status-pending.js";

// Every answer here was recorded from the live 1Click API on 2026-11-03 (test/fixtures/live). Nothing in
// these tests talks to the network.
const REFUND = "vault.0xileri.near";
const DEPOSIT = "041951e133e32d3ab1fc32f2df4d1ea201c689c8736895fd239fb0f68e2087bc";
/** When the live quote came back. */
const QUOTED_AT = new Date("2026-11-03T10:54:16.072Z");
const ns = (iso: string) => (BigInt(Date.parse(iso)) * 1_000_000n).toString();

const params = (dryRun: boolean) => ({
  vaultId: REFUND,
  token: LIVE.usdc,
  amount: 1_000_000n,
  destinationAsset: LIVE.solUsdc,
  recipient: LIVE.recipient,
  slippageBps: 100,
  deadline: new Date(LIVE.deadline),
  dry: dryRun,
});

/** The vault request the agent would file from the live quote, waiting for the owner. */
function filed(): PaymentRequest {
  const args = crossChainArgs(buildQuoteRequest(params(false)), live.body, "sol", QUOTED_AT);
  return {
    request_id: "live-1",
    agent_id: "agent2.0xileri.near",
    route: "ONE_CLICK_ORIGIN_NEAR",
    token: args.token,
    amount: args.amount,
    recipient: args.deposit_account,
    reason: "recorded live quote",
    created_at_ns: ns(QUOTED_AT.toISOString()),
    expires_at_ns: (BigInt(args.terms.quote_expires_at_ns) - 60_000_000_000n).toString(),
    policy_version: 1,
    cross_chain: args.terms,
    request_hash: "0".repeat(64),
    status: "AWAITING_APPROVAL",
    reason_code: "REQUIRES_OWNER_APPROVAL",
    approved_by: null,
    reserved_day: null,
    updated_at_ns: ns(QUOTED_AT.toISOString()),
  };
}

describe("live 1Click answers (recorded 2026-11-03)", () => {
  it("the quote request this code builds is the one that was sent", () => {
    expect(buildQuoteRequest(params(true))).toEqual(liveRequest(true, REFUND));
    expect(buildQuoteRequest(params(false))).toEqual(liveRequest(false, REFUND));
    // and a deadline with milliseconds goes out in whole seconds, the form 1Click was seen to echo
    expect(buildQuoteRequest({ ...params(true), deadline: new Date("2026-11-03T12:49:50.987Z") }).deadline).toBe(LIVE.deadline);
  });

  it("1Click's signature on both live quotes verifies with the manager key, and any change breaks it", () => {
    expect(verifyQuoteSignature(dry.body)).toBe(true);
    expect(verifyQuoteSignature(live.body)).toBe(true);
    // the copy of the quote inside the status answer carries the same signature, and verifies too
    expect(verifyQuoteSignature(pending.body.quoteResponse)).toBe(true);
    const swapped = structuredClone(live.body);
    swapped.quote.depositAddress = "a".repeat(64);
    expect(verifyQuoteSignature(swapped)).toBe(false);
    const payee = structuredClone(live.body);
    payee.quoteRequest.recipient = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
    expect(verifyQuoteSignature(payee)).toBe(false);
    const lessOut = structuredClone(live.body);
    lessOut.quote.minAmountOut = "1";
    expect(verifyQuoteSignature(lessOut)).toBe(false);
    expect(verifyQuoteSignature({ ...live.body, signature: dry.body.signature })).toBe(false);
    expect(verifyQuoteSignature(live.body, "ed25519:8p7BqMmFBf8DUbH6GqVkN4kFJKiR8XWjEPRxPWnMLmAS")).toBe(false);
  });

  it("the dry quote parses and answers the question asked, but cannot be filed", () => {
    expect(dry.status).toBe(201);
    const parsed = quoteResponseSchema.parse(dry.body);
    expect(parsed.quote.depositAddress).toBeUndefined();
    expect(parsed.quote).toMatchObject({ amountIn: "1000000", amountOut: "989801", minAmountOut: "979902", withdrawFee: "10007" });
    // 1Click adds an app fee to its echo of the request even though none was asked for
    expect(parsed.quoteRequest.appFees).toEqual([{ recipient: "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd", fee: 1 }]);
    expect(() => crossChainArgs(buildQuoteRequest(params(true)), dry.body, "sol", QUOTED_AT)).toThrow(/DRY_QUOTE/);
  });

  it("the live quote becomes a vault request bound to the deposit address, the payee and the earlier deadline", () => {
    expect(live.status).toBe(201);
    const args = crossChainArgs(buildQuoteRequest(params(false)), live.body, "sol", QUOTED_AT);
    expect(args).toEqual({
      token: LIVE.usdc,
      amount: "1000000",
      deposit_account: DEPOSIT,
      terms: {
        destination_chain: "sol",
        destination_asset: LIVE.solUsdc,
        destination_recipient: LIVE.recipient,
        refund_to: REFUND,
        min_amount_out: "979928",
        quote_hash: quoteHash(live.body),
        // the requested deadline (12:49 on 3 Nov), not the quote's own, three days later
        quote_expires_at_ns: ns("2026-11-03T12:49:50.000Z"),
      },
    });
    expect(live.body.quote.deadline).toBe("2026-11-06T12:49:50.000Z");
    // a live quote for another payee is refused, whatever 1Click signed
    expect(() => crossChainArgs(buildQuoteRequest({ ...params(false), recipient: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" }), live.body, "sol", QUOTED_AT)).toThrow(/TERMS_CHANGED/);
    // and so is the same quote once the requested deadline is close
    expect(() => crossChainArgs(buildQuoteRequest(params(false)), live.body, "sol", new Date("2026-11-03T12:49:00.000Z"))).toThrow(/EXPIRED/);
  });

  it("1Click answers for an unused deposit address: PENDING_DEPOSIT with its full record, which matches the request", () => {
    expect(pending.status).toBe(200);
    const parsed = statusResponseSchema.parse(pending.body);
    expect(parsed.status).toBe("PENDING_DEPOSIT");
    expect(parsed.swapDetails?.depositedAmount).toBeNull();
    expect(parsed.quoteResponse.quote.depositAddress).toBe(DEPOSIT);
    expect(depositMismatches(filed(), pending.body)).toEqual([]);
    // a request naming another payee, or a lower minimum, does not match 1Click's record
    const other = filed();
    if (!other.cross_chain) throw new Error("not cross-chain");
    expect(depositMismatches({ ...other, cross_chain: { ...other.cross_chain, destination_recipient: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" } }, pending.body)).toEqual([
      `final recipient: 1Click has ${LIVE.recipient}, the vault request has 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin`,
    ]);
    expect(depositMismatches({ ...other, cross_chain: { ...other.cross_chain, min_amount_out: "1" } }, pending.body)).toHaveLength(1);
  });

  it("before the deposit, 1Click's status is pending and gives no budget back", () => {
    const r = reconcile({ ...filed(), status: "CROSS_CHAIN_PENDING", reason_code: "EXTERNAL_SETTLEMENT_PENDING" }, pending.body);
    expect(r).toMatchObject({ providerStatus: "PENDING_DEPOSIT", outcome: "pending", providerFinal: false, restoresBudget: false, reportedRefund: "0" });
  });

  it("1Click's error answers come through with their message", async () => {
    const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    const missingRefund = oneClickOverHttp(LIVE.baseUrl, { fetch: answer(errors.refundAccountMissing.status, errors.refundAccountMissing.bodies[0]) });
    const quoteError = await missingRefund.quote(buildQuoteRequest({ ...params(true), vaultId: "vault2.0xileri.near" })).catch((e: unknown) => e);
    expect(quoteError).toBeInstanceOf(OneClickHttpError);
    expect(String(quoteError)).toMatch(/HTTP 400: Internal server error \(one known cause: the refund account does not exist on NEAR\)/);
    const unknown = oneClickOverHttp(LIVE.baseUrl, { fetch: answer(errors.unknownDeposit.status, errors.unknownDeposit.body) });
    await expect(unknown.status("null")).rejects.toThrow("1Click /v0/status answered HTTP 404: Deposit address null not found");
  });
});

describe("mock signatures", () => {
  it("a mock signer's quotes verify with its own key and never with 1Click's", async () => {
    const { mockQuoteSigner, signQuoteForMock } = await import("../src/index.js");
    const signer = mockQuoteSigner();
    const signed = signQuoteForMock({ ...live.body, signature: "" }, signer.secretKey);
    expect(verifyQuoteSignature(signed, signer.publicKey)).toBe(true);
    expect(verifyQuoteSignature(signed)).toBe(false);
    const { MOCK_SIGNER_PUBLIC_KEY, MOCK_SIGNER_SEED } = await import("../src/index.js");
    expect(mockQuoteSigner(MOCK_SIGNER_SEED).publicKey).toBe(MOCK_SIGNER_PUBLIC_KEY);
  });
});
