import type { PaymentRequest } from "@spact/shared";

import { buildQuoteRequest, type QuoteRequest } from "../src/index.js";

/**
 * Synthetic 1Click answers shaped by the SDK's generated types (one-click-sdk-typescript 0.1.26).
 * They were not recorded from the live API, which the build environment cannot reach; addresses
 * and signatures are made up.
 */

export const NOW = new Date("2026-11-02T12:00:00.000Z");
export const VAULT = "vault.test.near";
export const TOKEN = "token.test.near";
export const SOL_USDC = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
export const PAYEE = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
export const OTHER_PAYEE = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
export const DEPOSIT = "3e7c1b0f8a6d5c4b3a29180716f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3";

export const TOKENS = [
  { assetId: `nep141:${TOKEN}`, decimals: 6, blockchain: "near", symbol: "TUSD", price: 1, priceUpdatedAt: "2026-11-02T11:59:00.000Z", contractAddress: TOKEN },
  { assetId: SOL_USDC, decimals: 6, blockchain: "sol", symbol: "USDC", price: 1, priceUpdatedAt: "2026-11-02T11:59:00.000Z" },
];

export function asked(overrides: Partial<Parameters<typeof buildQuoteRequest>[0]> = {}): QuoteRequest {
  return buildQuoteRequest({
    vaultId: VAULT,
    token: TOKEN,
    amount: 5_000_000n,
    destinationAsset: SOL_USDC,
    recipient: PAYEE,
    slippageBps: 100,
    deadline: new Date(NOW.getTime() + 30 * 60_000),
    dry: false,
    ...overrides,
  });
}

/** A live quote answering `request`, as 1Click would per the SDK types. */
export function quoteFor(request: QuoteRequest, quote: Record<string, unknown> = {}) {
  return {
    correlationId: "9a1b2c3d-0000-4000-8000-000000000001",
    timestamp: NOW.toISOString(),
    signature: "ed25519:4qTZ6yVVtyfV5ZMzXhvPnETPRQyMCWbXvCjnznDWK8kv8uwE1oHfDu5e1ZmK2Nmmw2EeqzL5SjQhVBLswhnmQ6Rw",
    quoteRequest: request,
    quote: {
      ...(request.dry ? {} : { depositAddress: DEPOSIT, deadline: request.deadline, timeWhenInactive: request.deadline }),
      amountIn: request.amount,
      amountInFormatted: "5.0",
      amountInUsd: "5.00",
      minAmountIn: request.amount,
      amountOut: "4950000",
      amountOutFormatted: "4.95",
      amountOutUsd: "4.95",
      minAmountOut: "4900000",
      timeEstimate: 20,
      ...quote,
    },
  };
}

export function statusFor(request: QuoteRequest, status: string, swapDetails: Record<string, unknown> = {}, quote: Record<string, unknown> = {}) {
  return {
    correlationId: "9a1b2c3d-0000-4000-8000-000000000002",
    quoteResponse: quoteFor(request, quote),
    status,
    updatedAt: NOW.toISOString(),
    swapDetails: { intentHashes: [], nearTxHashes: [], originChainTxHashes: [], destinationChainTxHashes: [], ...swapDetails },
  };
}

/** The vault request filed from `quoteFor(asked())`, as `get_request` returns it once paid. */
export function storedRequest(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    request_id: "xc-1",
    agent_id: "agent.test.near",
    route: "ONE_CLICK_ORIGIN_NEAR",
    token: TOKEN,
    amount: "5000000",
    recipient: DEPOSIT,
    reason: "pay invoice 42 on solana",
    created_at_ns: "1793620800000000000",
    expires_at_ns: "1793622540000000000",
    policy_version: 1,
    cross_chain: {
      destination_chain: "sol",
      destination_asset: SOL_USDC,
      destination_recipient: PAYEE,
      refund_to: VAULT,
      min_amount_out: "4900000",
      quote_hash: "c".repeat(64),
      quote_expires_at_ns: "1793622600000000000",
    },
    request_hash: "d".repeat(64),
    status: "CROSS_CHAIN_PENDING",
    reason_code: "EXTERNAL_SETTLEMENT_PENDING",
    approved_by: "owner.test.near",
    reserved_day: 20759,
    updated_at_ns: "1793620900000000000",
    ...overrides,
  };
}
