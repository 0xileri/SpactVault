import { describe, expect, it } from "vitest";
import { bytesToHex } from "@noble/hashes/utils.js";

import { digestInputFromRequest, encodeRequest, requestHash, type DigestInput } from "../src/digest.js";
import type { PaymentRequest } from "../src/types.js";

// Same vector as `digest_matches_independent_test_vector` in the Rust vault tests, computed
// independently with Python's hashlib. Rust, TypeScript and Python must all agree.
const VECTOR: DigestInput = {
  network: "sandbox",
  vaultId: "vault.test.near",
  requestId: "req-001",
  agentId: "agent.test.near",
  route: "NEAR_DIRECT",
  token: "token.test.near",
  amount: 25_000_000n,
  recipient: "api.test.near",
  reason: "pay for weather API",
  expiresAtNs: 1_762_000_000_000_000_000n,
  policyVersion: 1n,
};
const VECTOR_BYTES =
  "1000000073706163742e726571756573742e76310700000073616e64626f780f0000007661756c742e746573742e" +
  "6e656172070000007265712d3030310f0000006167656e742e746573742e6e656172000f000000746f6b656e2e74" +
  "6573742e6e65617240787d010000000000000000000000000d0000006170692e746573742e6e6561721300000070" +
  "617920666f7220776561746865722041504900003d1eaae173180100000000000000";
const VECTOR_HASH = "2d4708a7e377bb80a417f78393fea4ac8c40e2a4a2710b0fc713971a7804186a";

// Same vector as `digest_matches_independent_cross_chain_test_vector` in the Rust vault tests, also
// computed with Python's hashlib. The quote terms follow the common fields (route tag 1).
const CROSS_VECTOR: DigestInput = {
  network: "sandbox",
  vaultId: "vault.test.near",
  requestId: "xc-001",
  agentId: "agent.test.near",
  route: "ONE_CLICK_ORIGIN_NEAR",
  token: "token.test.near",
  amount: 5_000_000n,
  recipient: "deposit.test.near",
  reason: "pay invoice 42 on solana",
  expiresAtNs: 1_762_000_000_000_000_000n,
  policyVersion: 1n,
  crossChain: {
    destinationChain: "sol",
    destinationAsset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
    destinationRecipient: "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV",
    refundTo: "vault.test.near",
    minAmountOut: 4_900_000n,
    quoteHash: "6327245c3a45d3d9ea72b70fbb671926e7b80f63d311bfd73dde876d5df02b26",
    quoteExpiresAtNs: 1_762_000_600_000_000_000n,
  },
};
const CROSS_VECTOR_HASH = "04940b54db8f43847767b0169b57a67f80ec6e8851fe470516c72a3c178bebb2";

describe("request digest", () => {
  it("matches the cross-language test vector byte for byte", () => {
    const bytes = encodeRequest(VECTOR);
    expect(bytes.length).toBe(172);
    expect(bytesToHex(bytes)).toBe(VECTOR_BYTES);
    expect(requestHash(VECTOR)).toBe(VECTOR_HASH);
  });

  it("matches the cross-chain test vector, and binds the deposit account and every quote term", () => {
    expect(encodeRequest(CROSS_VECTOR).length).toBe(410);
    expect(requestHash(CROSS_VECTOR)).toBe(CROSS_VECTOR_HASH);
    const terms = CROSS_VECTOR.crossChain;
    if (!terms) throw new Error("vector has terms");
    const changes: Partial<DigestInput>[] = [
      { recipient: "mallory.test.near" },
      { crossChain: { ...terms, destinationRecipient: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" } },
      { crossChain: { ...terms, destinationAsset: "nep141:other.near" } },
      { crossChain: { ...terms, destinationChain: "eth" } },
      { crossChain: { ...terms, refundTo: "mallory.test.near" } },
      { crossChain: { ...terms, minAmountOut: 1n } },
      { crossChain: { ...terms, quoteHash: "0".repeat(64) } },
      { crossChain: { ...terms, quoteExpiresAtNs: terms.quoteExpiresAtNs + 1n } },
    ];
    for (const change of changes) {
      expect(requestHash({ ...CROSS_VECTOR, ...change })).not.toBe(CROSS_VECTOR_HASH);
    }
  });

  it("binds every material field", () => {
    const changes: Partial<DigestInput>[] = [
      { network: "mainnet" },
      { vaultId: "other-vault.test.near" },
      { requestId: "req-002" },
      { agentId: "agent2.test.near" },
      { token: "token2.test.near" },
      { amount: 25_000_001n },
      { recipient: "mallory.test.near" },
      { reason: "pay for weather API!" },
      { expiresAtNs: 1_762_000_000_000_000_001n },
      { policyVersion: 2n },
    ];
    for (const change of changes) {
      expect(requestHash({ ...VECTOR, ...change })).not.toBe(VECTOR_HASH);
    }
  });

  it("builds the digest input from contract JSON", () => {
    const req: PaymentRequest = {
      request_id: "req-001",
      agent_id: "agent.test.near",
      route: "NEAR_DIRECT",
      token: "token.test.near",
      amount: "25000000",
      recipient: "api.test.near",
      reason: "pay for weather API",
      created_at_ns: "1761996400000000000",
      expires_at_ns: "1762000000000000000",
      policy_version: 1,
      cross_chain: null,
      request_hash: VECTOR_HASH,
      status: "AWAITING_APPROVAL",
      reason_code: "REQUIRES_OWNER_APPROVAL",
      approved_by: null,
      reserved_day: null,
      updated_at_ns: "1761996400000000000",
    };
    expect(requestHash(digestInputFromRequest("sandbox", "vault.test.near", req))).toBe(VECTOR_HASH);
  });

  it("rejects a route and terms that do not belong together", () => {
    expect(() => encodeRequest({ ...VECTOR, route: "ONE_CLICK_ORIGIN_NEAR" })).toThrow(RangeError);
    expect(() => encodeRequest({ ...CROSS_VECTOR, route: "NEAR_DIRECT" })).toThrow(RangeError);
  });

  it("rejects malformed numeric fields instead of guessing", () => {
    const base = { ...VECTOR };
    expect(() => encodeRequest({ ...base, amount: -1n })).toThrow(RangeError);
    expect(() => encodeRequest({ ...base, amount: 1n << 128n })).toThrow(RangeError);
    expect(() => encodeRequest({ ...base, expiresAtNs: 1n << 64n })).toThrow(RangeError);
  });
});
