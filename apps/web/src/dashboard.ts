import { explainReason, parseU128, type BudgetView, type FtMetadata, type PaymentRequest, type Status, type TokenPolicy } from "@spact/shared";

const NS_PER_DAY = 86_400_000_000_000n;

/** One allowlisted token, as the dashboard shows it. */
export interface TokenSummary {
  policy: TokenPolicy;
  /** null when ft_metadata could not be read or validated: amounts are then shown in base units. */
  metadata: FtMetadata | null;
  /** The vault's own balance of this token (ft_balance_of), or null if it could not be read. */
  balance: bigint | null;
  budget: BudgetView | null;
  /** Set when the RPC's budget numbers do not add up; the page then warns instead of trusting them. */
  budgetProblem: string | null;
}

/**
 * The vault computes available = max(0, daily_limit - (executed + pending)), with daily_limit from
 * the current policy. An RPC answer that breaks this is wrong or tampered with.
 */
export function budgetProblem(budget: BudgetView, policy: TokenPolicy): string | null {
  const limit = parseU128(budget.daily_limit);
  const used = parseU128(budget.executed) + parseU128(budget.pending);
  const expected = used >= limit ? 0n : limit - used;
  if (budget.token !== policy.token) return "the budget is for a different token";
  if (budget.daily_limit !== policy.daily_limit) return "the budget's daily limit differs from the policy";
  if (parseU128(budget.available) !== expected) return "available does not equal the daily limit minus executed and pending";
  return null;
}

/** Share of today's limit already used or reserved, 0-100. */
export function usedPercent(budget: BudgetView): number {
  const limit = parseU128(budget.daily_limit);
  if (limit === 0n) return 100;
  const used = parseU128(budget.executed) + parseU128(budget.pending);
  return used >= limit ? 100 : Number((used * 10_000n) / limit) / 100;
}

/** Start of the next UTC day: when the daily budget resets. */
export function budgetResetNs(budget: BudgetView): bigint {
  return (BigInt(budget.day) + 1n) * NS_PER_DAY;
}

const OPEN: ReadonlySet<Status> = new Set(["AWAITING_APPROVAL", "APPROVED"]);

/** Open on chain but past its expiry by chain time. It can no longer be approved or paid. */
export function isLapsed(request: PaymentRequest, nowNs: bigint): boolean {
  return OPEN.has(request.status) && nowNs > BigInt(request.expires_at_ns);
}

/** Requests the owner can still act on, oldest first so the most urgent is on top. */
export function waitingForOwner(requests: PaymentRequest[], nowNs: bigint): PaymentRequest[] {
  return requests.filter((r) => OPEN.has(r.status) && !isLapsed(r, nowNs)).reverse();
}

/** What happened to a stored request and why, in one plain sentence for the owner. */
export function outcomeLine(request: PaymentRequest, nowNs: bigint): string {
  if (isLapsed(request, nowNs)) return "Time ran out before it was paid. Nothing was sent.";
  switch (request.reason_code) {
    case "AUTO_WITHIN_POLICY":
      return "Under your instant limit, so it was paid without asking you.";
    case "REQUIRES_OWNER_APPROVAL":
      return request.cross_chain ? "A cross-chain payment, so it waits for your OK whatever the amount." : "Over your instant limit, so it waits for your OK.";
    case "OWNER_APPROVED":
      return "You approved it. Your agent can now send it.";
    case "OWNER_DENIED":
      return "You rejected it. Nothing was sent.";
    case "REQUEST_EXPIRED":
      return "Nobody approved it in time. Nothing was sent.";
    case "APPROVAL_EXPIRED":
      return "Approved, but not sent before it expired. Nothing was sent.";
    case "TRANSFER_PENDING":
      return "Being sent now.";
    case "SETTLED":
      return request.approved_by ? "You approved it, and it was sent." : "Under your instant limit, so it was sent without asking you.";
    case "SOURCE_TRANSFER_FAILED":
      return "The transfer failed, so nothing was spent.";
    case "EXTERNAL_SETTLEMENT_PENDING":
      return `Sent to 1Click's deposit address. Delivery on ${request.cross_chain?.destination_chain ?? "the other chain"} is up to 1Click; the vault cannot check it.`;
    case "POLICY_VERSION_CHANGED":
      return "Your rules changed after it was made, so it can no longer go through.";
    default:
      return explainReason(request.reason_code);
  }
}

