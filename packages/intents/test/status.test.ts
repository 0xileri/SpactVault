import { describe, expect, it } from "vitest";

import { depositMismatches, reconcile, StatusError, STATUSES } from "../src/index.js";
import { asked, OTHER_PAYEE, statusFor, storedRequest } from "./fixtures.js";

describe("1Click status reconciliation", () => {
  it("marks a reported refund as unverified and never gives budget back", () => {
    const r = reconcile(storedRequest(), statusFor(asked(), "REFUNDED", { refundedAmount: "5000000", refundReason: "slippage" }));
    expect(r).toEqual({
      provider: "1click",
      providerStatus: "REFUNDED",
      outcome: "reported_refund",
      reasonCode: "REFUND_UNVERIFIED",
      reportedRefund: "5000000",
      restoresBudget: false,
      providerFinal: true,
    });
  });

  it("leaves the budget spent whatever 1Click reports", () => {
    for (const status of STATUSES) {
      const r = reconcile(storedRequest(), statusFor(asked(), status));
      expect(r.restoresBudget, status).toBe(false);
      expect(r.providerStatus).toBe(status);
    }
    expect(reconcile(storedRequest(), statusFor(asked(), "SUCCESS")).outcome).toBe("reported_delivered");
    expect(reconcile(storedRequest(), statusFor(asked(), "PROCESSING")).reasonCode).toBe("EXTERNAL_SETTLEMENT_PENDING");
  });

  it("refuses a status for another deposit address, or for a request the vault has not paid", () => {
    expect(() => reconcile(storedRequest(), statusFor(asked(), "SUCCESS", {}, { depositAddress: "other.near" }))).toThrow(StatusError);
    expect(() => reconcile(storedRequest({ status: "AWAITING_APPROVAL" }), statusFor(asked(), "REFUNDED"))).toThrow(StatusError);
    expect(() => reconcile(storedRequest({ route: "NEAR_DIRECT", cross_chain: null }), statusFor(asked(), "SUCCESS"))).toThrow(StatusError);
    expect(() => reconcile(storedRequest(), { status: "SUCCESS" })).toThrow(StatusError);
  });
});

describe("deposit address check", () => {
  it("confirms a deposit address whose 1Click record matches every term the owner sees", () => {
    expect(depositMismatches(storedRequest({ status: "AWAITING_APPROVAL" }), statusFor(asked(), "PENDING_DEPOSIT"))).toEqual([]);
  });

  it("flags a deposit address that 1Click issued for another payee or another refund target", () => {
    // The agent pasted a real deposit address, but from a quote that pays someone else.
    const other = depositMismatches(storedRequest({ status: "AWAITING_APPROVAL" }), statusFor(asked({ recipient: OTHER_PAYEE }), "PENDING_DEPOSIT"));
    expect(other).toEqual([`final recipient: 1Click has ${OTHER_PAYEE}, the vault request has 7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV`]);
    const refund = depositMismatches(storedRequest({ status: "AWAITING_APPROVAL" }), statusFor({ ...asked(), refundTo: "mallory.test.near" }, "PENDING_DEPOSIT"));
    expect(refund).toEqual(["refund address: 1Click has mallory.test.near, the vault request has vault.test.near"]);
    expect(depositMismatches(storedRequest(), { nope: true })).toEqual(["1Click's status answer is malformed"]);
  });
});
