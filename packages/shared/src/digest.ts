import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import { parseU128 } from "./amount.js";
import type { PaymentRequest, Route } from "./types.js";

/**
 * TypeScript port of contracts/spact-vault/src/digest.rs.
 *
 * The owner's client recomputes the request hash from the fields it displays and passes that
 * hash to `approve_request`. If a backend or indexer showed different terms than the vault
 * stored, the hashes differ and the vault rejects the approval.
 */

export const DIGEST_DOMAIN = "spact.request.v1";

const U64_MAX = (1n << 64n) - 1n;
const ROUTE_TAGS: Record<Route, number> = { NEAR_DIRECT: 0, ONE_CLICK_ORIGIN_NEAR: 1 };

/** Quote terms of a ONE_CLICK_ORIGIN_NEAR request, appended to the digest after the common fields. */
export interface CrossChainDigest {
  destinationChain: string;
  destinationAsset: string;
  destinationRecipient: string;
  refundTo: string;
  minAmountOut: bigint;
  quoteHash: string;
  quoteExpiresAtNs: bigint;
}

export interface DigestInput {
  network: string;
  vaultId: string;
  requestId: string;
  agentId: string;
  route: Route;
  token: string;
  amount: bigint;
  recipient: string;
  reason: string;
  expiresAtNs: bigint;
  policyVersion: bigint;
  /** Required for ONE_CLICK_ORIGIN_NEAR, absent for NEAR_DIRECT. */
  crossChain?: CrossChainDigest | null;
}

class Writer {
  private readonly parts: Uint8Array[] = [];

  str(s: string): void {
    const bytes = utf8ToBytes(s);
    this.u32(bytes.length);
    this.parts.push(bytes);
  }

  u8(n: number): void {
    this.parts.push(Uint8Array.of(n));
  }

  u32(n: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    this.parts.push(b);
  }

  u64(n: bigint): void {
    if (n < 0n || n > U64_MAX) throw new RangeError("u64 out of range");
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, n, true);
    this.parts.push(b);
  }

  u128(n: bigint): void {
    if (n < 0n || n >= 1n << 128n) throw new RangeError("u128 out of range");
    const b = new Uint8Array(16);
    const view = new DataView(b.buffer);
    view.setBigUint64(0, n & U64_MAX, true);
    view.setBigUint64(8, n >> 64n, true);
    this.parts.push(b);
  }

  bytes(): Uint8Array {
    const total = this.parts.reduce((sum, p) => sum + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of this.parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  }
}

export function encodeRequest(input: DigestInput): Uint8Array {
  const crossChain = input.crossChain ?? null;
  if ((input.route === "ONE_CLICK_ORIGIN_NEAR") !== (crossChain !== null)) {
    throw new RangeError("cross-chain terms must come with the 1Click route, and only with it");
  }
  const w = new Writer();
  w.str(DIGEST_DOMAIN);
  w.str(input.network);
  w.str(input.vaultId);
  w.str(input.requestId);
  w.str(input.agentId);
  w.u8(ROUTE_TAGS[input.route]);
  w.str(input.token);
  w.u128(input.amount);
  w.str(input.recipient);
  w.str(input.reason);
  w.u64(input.expiresAtNs);
  w.u64(input.policyVersion);
  if (crossChain) {
    w.str(crossChain.destinationChain);
    w.str(crossChain.destinationAsset);
    w.str(crossChain.destinationRecipient);
    w.str(crossChain.refundTo);
    w.u128(crossChain.minAmountOut);
    w.str(crossChain.quoteHash);
    w.u64(crossChain.quoteExpiresAtNs);
  }
  return w.bytes();
}

export function requestHash(input: DigestInput): string {
  return bytesToHex(sha256(encodeRequest(input)));
}

/** Builds the digest input from a request as returned by the vault's `get_request` view. */
export function digestInputFromRequest(network: string, vaultId: string, req: PaymentRequest): DigestInput {
  if (!/^(0|[1-9]\d*)$/.test(req.expires_at_ns)) {
    throw new RangeError("expires_at_ns is not a canonical u64 string");
  }
  if (!Number.isSafeInteger(req.policy_version) || req.policy_version < 0) {
    throw new RangeError("policy_version is not a safe non-negative integer");
  }
  return {
    network,
    vaultId,
    requestId: req.request_id,
    agentId: req.agent_id,
    route: req.route,
    token: req.token,
    amount: parseU128(req.amount),
    recipient: req.recipient,
    reason: req.reason,
    expiresAtNs: BigInt(req.expires_at_ns),
    policyVersion: BigInt(req.policy_version),
    crossChain: req.cross_chain
      ? {
          destinationChain: req.cross_chain.destination_chain,
          destinationAsset: req.cross_chain.destination_asset,
          destinationRecipient: req.cross_chain.destination_recipient,
          refundTo: req.cross_chain.refund_to,
          minAmountOut: parseU128(req.cross_chain.min_amount_out),
          quoteHash: req.cross_chain.quote_hash,
          quoteExpiresAtNs: BigInt(req.cross_chain.quote_expires_at_ns),
        }
      : null,
  };
}
