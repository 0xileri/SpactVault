import { describe, expect, it } from "vitest";

import { buildQuoteRequest, canonicalJson, crossChainArgs, quoteHash, QuoteError } from "../src/index.js";
import { asked, DEPOSIT, NOW, OTHER_PAYEE, PAYEE, quoteFor, SOL_USDC, TOKEN, VAULT } from "./fixtures.js";

function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof QuoteError) return e.code;
    throw e;
  }
  throw new Error("expected a QuoteError");
}

describe("1Click quote request", () => {
  it("builds an EXACT_INPUT, ORIGIN_CHAIN quote request that refunds to the vault on NEAR", () => {
    expect(asked()).toEqual({
      dry: false,
      depositMode: "SIMPLE",
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: `nep141:${TOKEN}`,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: SOL_USDC,
      amount: "5000000",
      refundTo: VAULT,
      refundType: "ORIGIN_CHAIN",
      recipient: PAYEE,
      recipientType: "DESTINATION_CHAIN",
      deadline: "2026-11-02T12:30:00.000Z",
    });
    expect(asked({ dry: true }).dry).toBe(true);
  });

  it("refuses unsafe quote parameters before asking", () => {
    const base = { vaultId: VAULT, token: TOKEN, amount: 1n, destinationAsset: SOL_USDC, recipient: PAYEE, slippageBps: 100, deadline: NOW, dry: true };
    for (const bad of [{ amount: 0n }, { slippageBps: 501 }, { slippageBps: 1.5 }, { recipient: `${PAYEE} ` }, { destinationAsset: "nep141:ässet" }, { vaultId: "Vault.near" }, { deadline: new Date("x") }]) {
      expect(() => buildQuoteRequest({ ...base, ...bad }), Object.keys(bad).join()).toThrow(QuoteError);
    }
  });
});

describe("quote hash", () => {
  it("hashes a quote response independently of key order, and any change changes the hash", () => {
    const quote = quoteFor(asked());
    const reordered = JSON.parse(JSON.stringify({ quote: quote.quote, signature: quote.signature, quoteRequest: quote.quoteRequest, timestamp: quote.timestamp, correlationId: quote.correlationId }));
    expect(quoteHash(reordered)).toBe(quoteHash(quote));
    expect(quoteHash(quote)).toMatch(/^[0-9a-f]{64}$/);
    expect(quoteHash({ ...quote, signature: "ed25519:other" })).not.toBe(quoteHash(quote));
    expect(quoteHash(quoteFor(asked(), { depositAddress: "mallory.test.near" }))).not.toBe(quoteHash(quote));
    expect(canonicalJson({ b: [1, { d: null, c: "x" }], a: true })).toBe('{"a":true,"b":[1,{"c":"x","d":null}]}');
  });
});

describe("quote to vault request", () => {
  it("turns a live quote into the vault's cross-chain request, with the deposit address and the final payee kept apart", () => {
    const request = asked();
    const quote = quoteFor(request);
    const args = crossChainArgs(request, quote, "sol", NOW);
    expect(args).toEqual({
      token: TOKEN,
      amount: "5000000",
      deposit_account: DEPOSIT,
      terms: {
        destination_chain: "sol",
        destination_asset: SOL_USDC,
        destination_recipient: PAYEE,
        refund_to: VAULT,
        min_amount_out: "4900000",
        quote_hash: quoteHash(quote),
        quote_expires_at_ns: "1793622600000000000",
      },
    });
    expect(args.deposit_account).not.toBe(args.terms.destination_recipient);
  });

  it("refuses a quote that answers a different question: another payee, refund target, asset or amount", () => {
    const request = asked();
    expect(refusal(() => crossChainArgs(request, quoteFor(asked({ recipient: OTHER_PAYEE })), "sol", NOW))).toBe("TERMS_CHANGED");
    expect(refusal(() => crossChainArgs(request, quoteFor({ ...request, refundTo: "mallory.test.near" }), "sol", NOW))).toBe("TERMS_CHANGED");
    expect(refusal(() => crossChainArgs(request, quoteFor({ ...request, destinationAsset: "nep141:eth.omft.near" }), "sol", NOW))).toBe("TERMS_CHANGED");
    expect(refusal(() => crossChainArgs(request, quoteFor({ ...request, recipientType: "INTENTS" } as never), "sol", NOW))).toBe("TERMS_CHANGED");
    expect(refusal(() => crossChainArgs(request, quoteFor(request, { amountIn: "4000000" }), "sol", NOW))).toBe("AMOUNT_CHANGED");
  });

  it("refuses a quote without a usable deposit address, with a memo, without output, or near its deadline", () => {
    const request = asked();
    const noDeposit: Record<string, unknown> = { ...quoteFor(request).quote };
    delete noDeposit.depositAddress;
    expect(refusal(() => crossChainArgs(request, { ...quoteFor(request), quote: noDeposit }, "sol", NOW))).toBe("DEPOSIT_MISSING");
    expect(refusal(() => crossChainArgs(request, quoteFor(request, { depositAddress: "0xAbC" }), "sol", NOW))).toBe("DEPOSIT_INVALID");
    expect(refusal(() => crossChainArgs(request, quoteFor(request, { depositAddress: VAULT }), "sol", NOW))).toBe("DEPOSIT_INVALID");
    expect(refusal(() => crossChainArgs(request, quoteFor(request, { depositMemo: "123" }), "sol", NOW))).toBe("MEMO_UNSUPPORTED");
    expect(refusal(() => crossChainArgs(request, quoteFor(request, { minAmountOut: "0" }), "sol", NOW))).toBe("MIN_OUT_INVALID");
    expect(refusal(() => crossChainArgs(request, quoteFor(request), "sol", new Date(NOW.getTime() + 29.5 * 60_000)))).toBe("EXPIRED");
    expect(refusal(() => crossChainArgs(asked({ dry: true }), quoteFor(asked({ dry: true })), "sol", NOW))).toBe("DRY_QUOTE");
    expect(refusal(() => crossChainArgs(request, { quote: "nope" }, "sol", NOW))).toBe("MALFORMED");
  });
});
