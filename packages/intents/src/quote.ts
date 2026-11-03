import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { ACCOUNT_ID_RE, CHAIN_RE, EXTERNAL_ID_RE, type CrossChainTerms } from "@spact/shared";

import { quoteResponseSchema, type QuoteRequest, type QuoteResponse } from "./schemas.js";

/**
 * Turning a 1Click quote into a vault request (AGENTS.md section 8, steps 3-6).
 *
 * Nothing here makes a quote trustworthy. These checks catch a quote that does not answer the
 * question that was asked, or that would need a deposit mechanism the vault does not use. What the
 * deposit address does afterwards is 1Click's promise, which the owner accepts by approving the
 * exact deposit address and destination in their wallet (AGENTS.md I8).
 */

/** The vault's QUOTE_SAFETY_MARGIN_SEC: a quote must have at least this long left when it is filed. */
export const QUOTE_SAFETY_MARGIN_MS = 60_000;
/** SpactVault refuses quotes that allow more than 5% slippage. 1Click counts in basis points. */
export const MAX_SLIPPAGE_BPS = 500;

export type QuoteErrorCode =
  | "BAD_PARAMS"
  | "MALFORMED"
  | "DRY_QUOTE"
  | "TERMS_CHANGED"
  | "DEPOSIT_MISSING"
  | "DEPOSIT_INVALID"
  | "MEMO_UNSUPPORTED"
  | "AMOUNT_CHANGED"
  | "MIN_OUT_INVALID"
  | "EXPIRED";

export class QuoteError extends Error {
  constructor(
    readonly code: QuoteErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

export interface QuoteParams {
  /** The vault: the only refund target SpactVault accepts. */
  vaultId: string;
  /** NEP-141 contract of the token that leaves the vault. */
  token: string;
  amount: bigint;
  destinationAsset: string;
  /** Final payee, in the destination chain's address format. */
  recipient: string;
  slippageBps: number;
  /** When 1Click starts refunding if the swap has not completed. */
  deadline: Date;
  dry: boolean;
}

/** The 1Click asset id of a NEP-141 token on NEAR. */
export function nearAssetId(token: string): string {
  return `nep141:${token}`;
}

/**
 * An EXACT_INPUT quote request for a deposit from the vault on NEAR (`ORIGIN_CHAIN`), refunded to
 * the vault on NEAR, paid out on the destination chain. Unsafe parameters fail before any request.
 */
export function buildQuoteRequest(p: QuoteParams): QuoteRequest {
  if (!ACCOUNT_ID_RE.test(p.vaultId) || !ACCOUNT_ID_RE.test(p.token)) throw new QuoteError("BAD_PARAMS", "vault and token must be NEAR account ids");
  if (p.amount <= 0n || p.amount >= 1n << 128n) throw new QuoteError("BAD_PARAMS", "amount must be a positive u128");
  if (!EXTERNAL_ID_RE.test(p.destinationAsset)) throw new QuoteError("BAD_PARAMS", "invalid destination asset id");
  if (!EXTERNAL_ID_RE.test(p.recipient)) throw new QuoteError("BAD_PARAMS", "invalid destination address");
  if (!Number.isInteger(p.slippageBps) || p.slippageBps < 0 || p.slippageBps > MAX_SLIPPAGE_BPS) {
    throw new QuoteError("BAD_PARAMS", `slippage must be 0-${MAX_SLIPPAGE_BPS} basis points`);
  }
  if (Number.isNaN(p.deadline.getTime())) throw new QuoteError("BAD_PARAMS", "invalid deadline");
  return {
    dry: p.dry,
    depositMode: "SIMPLE",
    swapType: "EXACT_INPUT",
    slippageTolerance: p.slippageBps,
    originAsset: nearAssetId(p.token),
    depositType: "ORIGIN_CHAIN",
    destinationAsset: p.destinationAsset,
    amount: p.amount.toString(),
    refundTo: p.vaultId,
    refundType: "ORIGIN_CHAIN",
    recipient: p.recipient,
    recipientType: "DESTINATION_CHAIN",
    // whole seconds: the live API echoes the deadline it was sent, and "…:50.000Z" is the form it was seen in
    deadline: new Date(Math.floor(p.deadline.getTime() / 1000) * 1000).toISOString(),
  };
}

/** JSON with object keys sorted at every level and no whitespace, so equal values hash equally. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const s = JSON.stringify(value);
    if (s === undefined) throw new TypeError("not JSON");
    return s;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/**
 * sha256 of the whole quote response as received, signature included, in canonical JSON. Stored in
 * the vault request as `quote_hash`: it pins which quote the owner approved, and the full response
 * should be kept for disputes (the SDK says to save it with its signature). It proves consistency
 * only, not that the quote is honest (AGENTS.md section 8).
 */
export function quoteHash(response: unknown): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(response))));
}

/** Arguments for the vault's `request_cross_chain_payment`, minus request id and reason. */
export interface CrossChainArgs {
  token: string;
  amount: string;
  deposit_account: string;
  terms: CrossChainTerms;
}

const ECHOED: (keyof QuoteRequest)[] = [
  "dry",
  "swapType",
  "slippageTolerance",
  "originAsset",
  "depositType",
  "destinationAsset",
  "amount",
  "refundTo",
  "refundType",
  "recipient",
  "recipientType",
  "deadline",
];

/**
 * Checks a live (non-dry) quote against the request that asked for it, and maps it to the vault's
 * cross-chain request. `destinationChain` comes from 1Click's token list (`blockchain` of the
 * destination asset), so the owner sees the chain by name, not only inside the asset id.
 */
export function crossChainArgs(asked: QuoteRequest, raw: unknown, destinationChain: string, now: Date): CrossChainArgs {
  const parsed = quoteResponseSchema.safeParse(raw);
  if (!parsed.success) throw new QuoteError("MALFORMED", parsed.error.issues[0]?.message ?? "invalid quote response");
  const res: QuoteResponse = parsed.data;
  if (asked.dry || res.quoteRequest.dry) throw new QuoteError("DRY_QUOTE", "a dry quote has no deposit address and cannot be paid");
  // The answer must be to the exact question: a quote for another payee, asset, amount or refund
  // target is refused even if it looks better.
  for (const field of ECHOED) {
    const same = field === "deadline" ? Date.parse(res.quoteRequest.deadline) === Date.parse(asked.deadline) : res.quoteRequest[field] === asked[field];
    if (!same) throw new QuoteError("TERMS_CHANGED", `quote answers a different ${field}`);
  }
  const deposit = res.quote.depositAddress;
  if (!deposit) throw new QuoteError("DEPOSIT_MISSING", "the quote has no deposit address");
  if (!ACCOUNT_ID_RE.test(deposit) || deposit.length < 2 || deposit.length > 64) {
    throw new QuoteError("DEPOSIT_INVALID", "the deposit address is not a NEAR account id");
  }
  if (deposit === asked.refundTo || nearAssetId(deposit) === asked.originAsset) {
    throw new QuoteError("DEPOSIT_INVALID", "the deposit address is the vault or the token itself");
  }
  if (res.quote.depositMemo !== undefined) {
    // The vault sends a plain ft_transfer with its own memo; a deposit that needs 1Click's memo would be lost.
    throw new QuoteError("MEMO_UNSUPPORTED", "this deposit address needs a memo, which the vault does not send");
  }
  if (res.quote.amountIn !== asked.amount) throw new QuoteError("AMOUNT_CHANGED", "EXACT_INPUT quote with a different input amount");
  if (BigInt(res.quote.minAmountOut) === 0n) throw new QuoteError("MIN_OUT_INVALID", "the quote guarantees no output");
  if (!res.quote.deadline) throw new QuoteError("EXPIRED", "the quote has no deadline");
  // Two deadlines: the one asked for, when 1Click starts refunding an unfinished swap, and the quote's own,
  // when the deposit address goes inactive. Live, the second is three days after the first
  // (test/fixtures/live/quote.ts). The vault must pay before the first, so it is bound to the earlier.
  const deadlineMs = Math.min(Date.parse(res.quote.deadline), Date.parse(asked.deadline));
  if (deadlineMs <= now.getTime() + QUOTE_SAFETY_MARGIN_MS) throw new QuoteError("EXPIRED", "the quote is at or near its deadline");
  if (!CHAIN_RE.test(destinationChain)) throw new QuoteError("BAD_PARAMS", "invalid destination chain");
  const token = asked.originAsset.slice("nep141:".length);
  return {
    token,
    amount: asked.amount,
    deposit_account: deposit,
    terms: {
      destination_chain: destinationChain,
      destination_asset: asked.destinationAsset,
      destination_recipient: asked.recipient,
      refund_to: asked.refundTo,
      min_amount_out: res.quote.minAmountOut,
      quote_hash: quoteHash(raw),
      quote_expires_at_ns: (BigInt(deadlineMs) * 1_000_000n).toString(),
    },
  };
}
