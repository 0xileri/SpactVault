import type { BudgetView, PaymentRequest, TokenPolicy } from "@spact/shared";
import { describe, expect, it } from "vitest";

import { budgetProblem, budgetResetNs, isLapsed, outcomeLine, usedPercent, waitingForOwner } from "../src/dashboard.js";

const policy: TokenPolicy = { token: "token.test.near", auto_limit: "10000000", hard_tx_limit: "30000000", daily_limit: "50000000" };
const budget: BudgetView = { token: "token.test.near", day: 20393, daily_limit: "50000000", executed: "3000000", pending: "25000000", available: "22000000" };

function request(id: string, status: PaymentRequest["status"], expiresAtNs: bigint): PaymentRequest {
  return {
    request_id: id,
    agent_id: "agent.test.near",
    route: "NEAR_DIRECT",
    token: "token.test.near",
    amount: "25000000",
    recipient: "api.test.near",
    reason: "",
    created_at_ns: "0",
    expires_at_ns: expiresAtNs.toString(),
    policy_version: 1,
    cross_chain: null,
    request_hash: "a".repeat(64),
    status,
    reason_code: "REQUIRES_OWNER_APPROVAL",
    approved_by: null,
    reserved_day: null,
    updated_at_ns: "0",
  };
}

describe("budget", () => {
  it("accepts numbers that add up the way the vault computes them", () => {
    expect(budgetProblem(budget, policy)).toBeNull();
    // a lowered limit can leave used above it; available is then 0
    expect(budgetProblem({ ...budget, daily_limit: "20000000", available: "0" }, { ...policy, daily_limit: "20000000" })).toBeNull();
  });

  it("flags numbers that do not add up, or do not match the policy", () => {
    expect(budgetProblem({ ...budget, available: "47000000" }, policy)).toMatch(/available does not equal/);
    expect(budgetProblem({ ...budget, daily_limit: "500000000", available: "472000000" }, policy)).toMatch(/differs from the policy/);
    expect(budgetProblem({ ...budget, token: "other.test.near" }, policy)).toMatch(/different token/);
  });

  it("computes the used share and the next UTC midnight", () => {
    expect(usedPercent(budget)).toBe(56);
    expect(usedPercent({ ...budget, executed: "60000000", available: "0" })).toBe(100);
    expect(usedPercent({ ...budget, daily_limit: "0", available: "0" })).toBe(100);
    expect(budgetResetNs(budget)).toBe(20394n * 86_400n * 1_000_000_000n);
  });
});

describe("open requests", () => {
  const now = 1_000n;
  it("lists only requests the owner can still act on, oldest first", () => {
    // newest first, as the vault lists them
    const requests = [
      request("newest", "AWAITING_APPROVAL", 2_000n),
      request("paid", "SETTLED", 2_000n),
      request("lapsed", "AWAITING_APPROVAL", 999n),
      request("approved", "APPROVED", 1_000n),
    ];
    expect(waitingForOwner(requests, now).map((r) => r.request_id)).toEqual(["approved", "newest"]);
    expect(isLapsed(requests[2] as PaymentRequest, now)).toBe(true);
    expect(isLapsed(request("done", "EXPIRED", 1n), now)).toBe(false);
  });
});

describe("outcomeLine", () => {
  const now = 1_000n;
  const later = 2_000n;
  const settled = (approvedBy: string | null): PaymentRequest => ({
    ...request("r", "SETTLED", later),
    reason_code: "SETTLED",
    approved_by: approvedBy,
  });

  it("says in plain words why a request ended the way it did", () => {
    expect(outcomeLine(request("w", "AWAITING_APPROVAL", later), now)).toBe("Over your instant limit, so it waits for your OK.");
    expect(outcomeLine({ ...request("d", "DENIED", later), reason_code: "OWNER_DENIED" }, now)).toBe("You rejected it. Nothing was sent.");
    expect(outcomeLine({ ...request("f", "TRANSFER_FAILED", later), reason_code: "SOURCE_TRANSFER_FAILED" }, now)).toMatch(/nothing was spent/);
  });

  it("tells a payment the owner approved from one paid without asking", () => {
    expect(outcomeLine(settled("owner.test.near"), now)).toBe("You approved it, and it was sent.");
    expect(outcomeLine(settled(null), now)).toBe("Under your instant limit, so it was sent without asking you.");
  });

  it("says when time ran out, even if the vault still lists the request as open", () => {
    expect(outcomeLine(request("old", "AWAITING_APPROVAL", now - 1n), now)).toMatch(/^Time ran out/);
  });

  it("falls back to the vault's own explanation for anything else", () => {
    expect(outcomeLine({ ...request("x", "AWAITING_APPROVAL", later), reason_code: "INVALID_STATE" }, now)).toBe(
      "The request is not in a state that allows this action.",
    );
  });
});
