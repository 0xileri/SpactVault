import type { PaymentRequest, ReasonCode } from "@spact/shared";

import { nearAssetId } from "./quote.js";
import { statusResponseSchema, type OneClickStatus, type StatusResponse } from "./schemas.js";

/**
 * Reading 1Click's status for a request the vault already paid (AGENTS.md section 8, steps 9-10).
 *
 * The vault's own state for such a request is CROSS_CHAIN_PENDING with its budget spent. 1Click's
 * status is an off-chain report: it can say SUCCESS or REFUNDED, but neither is proof. A reported
 * refund is shown as unverified and never restores budget (AGENTS.md I9, Security Lab T13).
 */

export type Outcome = "pending" | "reported_delivered" | "reported_refund" | "reported_failure" | "deposit_anomaly";

export interface Reconciliation {
  provider: "1click";
  /** Exactly what 1Click said. */
  providerStatus: OneClickStatus;
  outcome: Outcome;
  reasonCode: Extract<ReasonCode, "EXTERNAL_SETTLEMENT_PENDING" | "REFUND_UNVERIFIED">;
  /** 1Click's claimed refund amount, unverified, in the origin token's smallest unit. */
  reportedRefund: string | null;
  /** Always false: no 1Click report gives budget back. */
  restoresBudget: false;
  /** Whether 1Click considers the swap finished. Says nothing about where the funds are. */
  providerFinal: boolean;
}

export class StatusError extends Error {}

const OUTCOMES: Record<OneClickStatus, Outcome> = {
  PENDING_DEPOSIT: "pending",
  KNOWN_DEPOSIT_TX: "pending",
  PROCESSING: "pending",
  SUCCESS: "reported_delivered",
  REFUNDED: "reported_refund",
  FAILED: "reported_failure",
  INCOMPLETE_DEPOSIT: "deposit_anomaly",
};

/**
 * Differences between what 1Click says a deposit address is for and the request the vault stored.
 * An empty list means 1Click's own record of the deposit address matches every term the owner
 * approved. Anything else means the deposit address belongs to some other quote: someone (an
 * agent, a lying RPC) substituted it, and the request must not be approved (Security Lab T14).
 */
export function depositMismatches(stored: PaymentRequest, raw: unknown): string[] {
  const parsed = statusResponseSchema.safeParse(raw);
  if (!parsed.success) return ["1Click's status answer is malformed"];
  const { quoteRequest: q, quote } = parsed.data.quoteResponse;
  const t = stored.cross_chain;
  if (stored.route !== "ONE_CLICK_ORIGIN_NEAR" || !t) return ["not a cross-chain request"];
  const out: string[] = [];
  const check = (what: string, theirs: unknown, ours: unknown) => {
    if (theirs !== ours) out.push(`${what}: 1Click has ${String(theirs)}, the vault request has ${String(ours)}`);
  };
  check("deposit address", quote.depositAddress, stored.recipient);
  check("origin asset", q.originAsset, nearAssetId(stored.token));
  check("amount", q.amount, stored.amount);
  check("deposit type", q.depositType, "ORIGIN_CHAIN");
  check("destination asset", q.destinationAsset, t.destination_asset);
  check("final recipient", q.recipient, t.destination_recipient);
  check("recipient type", q.recipientType, "DESTINATION_CHAIN");
  check("refund address", q.refundTo, t.refund_to);
  check("refund type", q.refundType, "ORIGIN_CHAIN");
  check("minimum output", quote.minAmountOut, t.min_amount_out);
  return out;
}

export function reconcile(stored: PaymentRequest, raw: unknown): Reconciliation {
  if (stored.route !== "ONE_CLICK_ORIGIN_NEAR") throw new StatusError("only cross-chain requests have a 1Click status");
  if (stored.status !== "CROSS_CHAIN_PENDING") {
    throw new StatusError(`the vault has not sent this deposit (status ${stored.status}); 1Click's status does not apply`);
  }
  const parsed = statusResponseSchema.safeParse(raw);
  if (!parsed.success) throw new StatusError("1Click's status answer is malformed");
  const res: StatusResponse = parsed.data;
  if (res.quoteResponse.quote.depositAddress !== stored.recipient) {
    throw new StatusError("this status is for another deposit address");
  }
  const outcome = OUTCOMES[res.status];
  return {
    provider: "1click",
    providerStatus: res.status,
    outcome,
    reasonCode: outcome === "reported_refund" ? "REFUND_UNVERIFIED" : "EXTERNAL_SETTLEMENT_PENDING",
    reportedRefund: res.swapDetails?.refundedAmount ?? null,
    restoresBudget: false,
    providerFinal: outcome === "reported_delivered" || outcome === "reported_refund" || outcome === "reported_failure",
  };
}
