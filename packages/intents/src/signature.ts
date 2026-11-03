import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

import { canonicalJson } from "./quote.js";

/**
 * Checking 1Click's signature on a quote (ADR-034). 1Click signs each quote with one ed25519 key, the
 * "manager" key. The official SDK, `@defuse-protocol/one-click-sdk-typescript` 0.1.26, ships the key and the
 * algorithm (`verifyQuoteSignature` in its `src/quote-signature.ts`, read 2026-11-03), reimplemented here:
 *
 *   message   = base58(sha256(stable JSON of { ...signed request fields, ...signed quote fields, timestamp }))
 *   signature = ed25519 over the UTF-8 bytes of that message, base58 after an `ed25519:` prefix
 *
 * A valid signature proves 1Click issued this quote, with this deposit address, for these terms. It does
 * not prove 1Click will honour it. The recorded live quotes verify (test/live.test.ts).
 */
export const ONE_CLICK_MANAGER_PUBLIC_KEY = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(text: string): Uint8Array {
  let n = 0n;
  for (const ch of text) {
    const i = BASE58.indexOf(ch);
    if (i < 0) throw new Error("not base58");
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of text) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

type Json = Record<string, unknown>;

function rec(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {};
}

/** The SDK sends falsy optional fields as absent (`x ? x : undefined`), and so does this. */
function ifTruthy(value: unknown): unknown {
  return value ? value : undefined;
}

/** The fields 1Click signs, in the SDK's `buildSignedQuoteRequest` / `buildSignedQuote`. Absent ones drop out. */
function signedFields(response: Json): Json {
  const q = rec(response.quoteRequest);
  const quote = rec(response.quote);
  const request: Json = {
    dry: q.dry,
    swapType: q.swapType,
    slippageTolerance: q.slippageTolerance,
    originAsset: q.originAsset,
    depositType: q.depositType,
    destinationAsset: q.destinationAsset,
    amount: q.amount,
    refundTo: q.refundTo,
    refundType: q.refundType,
    recipient: q.recipient,
    recipientType: q.recipientType,
    deadline: q.deadline,
    quoteWaitingTimeMs: ifTruthy(q.quoteWaitingTimeMs),
    referral: ifTruthy(q.referral),
    virtualChainRecipient: ifTruthy(q.virtualChainRecipient),
    virtualChainRefundRecipient: ifTruthy(q.virtualChainRefundRecipient),
    customRecipientMsg: ifTruthy(q.customRecipientMsg),
  };
  const amounts: Json = {
    amountIn: quote.amountIn,
    amountInFormatted: quote.amountInFormatted,
    amountInUsd: quote.amountInUsd,
    minAmountIn: quote.minAmountIn,
    amountOut: quote.amountOut,
    amountOutFormatted: quote.amountOutFormatted,
    amountOutUsd: quote.amountOutUsd,
    minAmountOut: quote.minAmountOut,
  };
  const live: Json =
    q.dry === true
      ? {}
      : {
          depositAddress: ifTruthy(quote.depositAddress),
          depositMemo: ifTruthy(quote.depositMemo),
          deadline: ifTruthy(quote.deadline),
          timeWhenInactive: ifTruthy(quote.timeWhenInactive),
          timeEstimate: ifTruthy(quote.timeEstimate),
          refundFee: ifTruthy(quote.refundFee),
          withdrawFee: ifTruthy(quote.withdrawFee),
        };
  // the quote's own `deadline` overrides the request's, as the SDK's object spread does
  return { ...request, ...amounts, ...live, timestamp: response.timestamp };
}

/** The message 1Click signs for a quote response (the SDK's `quoteHash`). */
export function signedQuoteMessage(response: unknown): string {
  return base58Encode(sha256(utf8ToBytes(canonicalJson(signedFields(rec(response))))));
}

/**
 * True only when `response.signature` is 1Click's ed25519 signature over this response's terms. Works on a
 * quote response and on the `quoteResponse` inside a status answer, which carries the same signature.
 */
export function verifyQuoteSignature(response: unknown, publicKey: string = ONE_CLICK_MANAGER_PUBLIC_KEY): boolean {
  try {
    const signature = rec(response).signature;
    if (typeof signature !== "string" || !signature.startsWith("ed25519:")) return false;
    const sig = base58Decode(signature.slice("ed25519:".length));
    const key = base58Decode(publicKey.replace(/^ed25519:/, ""));
    if (sig.length !== 64 || key.length !== 32) return false;
    return ed25519.verify(sig, utf8ToBytes(signedQuoteMessage(response)), key);
  } catch {
    return false;
  }
}

/**
 * Signs a quote response the way 1Click does, with a key the caller supplies. For mocks and tests only
 * (MockOneClick, apps/web/e2e/mock-oneclick.ts): nothing that takes a real decision ever verifies against
 * a key other than ONE_CLICK_MANAGER_PUBLIC_KEY, except on a local sandbox (apps/web config.ts).
 */
export function signQuoteForMock<T extends object>(response: T, secretKey: Uint8Array): T & { signature: string } {
  const sig = ed25519.sign(utf8ToBytes(signedQuoteMessage(response)), secretKey);
  return { ...response, signature: `ed25519:${base58Encode(sig)}` };
}

/** The seed of the published mock signer that the local demo and the browser tests use. Sandbox only. */
export const MOCK_SIGNER_SEED = "SpactVault mock 1Click signer: local sandbox only, never trusted elsewhere";

/** Its public key, for the local demo's config (scripts/dev-sandbox.sh). A test keeps it equal to the derived one. */
export const MOCK_SIGNER_PUBLIC_KEY = "ed25519:9Q3HteLhC8T2gBVNWETCZh5uR8svhy4Ze7oFL5mgAyjt";

/** A mock signer: random, or derived from `seed`. Returns its secret key and the public key in `ed25519:` form. */
export function mockQuoteSigner(seed?: string): { secretKey: Uint8Array; publicKey: string } {
  const secretKey = seed === undefined ? ed25519.utils.randomSecretKey() : sha256(utf8ToBytes(seed));
  return { secretKey, publicKey: `ed25519:${base58Encode(ed25519.getPublicKey(secretKey))}` };
}
