import type { ReasonCode } from "./reasonCodes.js";

/** JSON shapes returned by the vault contract. Amounts and nanosecond timestamps are strings. */

export type Route = "NEAR_DIRECT" | "ONE_CLICK_ORIGIN_NEAR";

export type Status =
  | "BLOCKED"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "DENIED"
  | "EXPIRED"
  | "TRANSFER_PENDING"
  | "SETTLED"
  | "TRANSFER_FAILED"
  | "CROSS_CHAIN_PENDING";

export interface TokenPolicy {
  token: string;
  auto_limit: string;
  hard_tx_limit: string;
  daily_limit: string;
}

/** An owner-allowlisted 1Click route (P1). Vaults deployed before P1 report none. */
export interface CrossChainRoute {
  token: string;
  destination_chain: string;
  destination_asset: string;
  recipients: string[];
}

export interface Policy {
  tokens: TokenPolicy[];
  recipients: string[];
  max_open_approvals: number;
  max_requests_per_day: number;
  approval_ttl_sec: number;
  cross_chain: CrossChainRoute[];
}

/** The quote terms a ONE_CLICK_ORIGIN_NEAR request is bound to (off-chain data, see AGENTS.md I8). */
export interface CrossChainTerms {
  destination_chain: string;
  destination_asset: string;
  destination_recipient: string;
  refund_to: string;
  min_amount_out: string;
  quote_hash: string;
  quote_expires_at_ns: string;
}

export interface PaymentRequest {
  request_id: string;
  agent_id: string;
  route: Route;
  token: string;
  amount: string;
  recipient: string;
  reason: string;
  created_at_ns: string;
  expires_at_ns: string;
  policy_version: number;
  /** Set for ONE_CLICK_ORIGIN_NEAR, where `recipient` is the 1Click deposit account. */
  cross_chain: CrossChainTerms | null;
  request_hash: string;
  status: Status;
  reason_code: ReasonCode;
  approved_by: string | null;
  reserved_day: number | null;
  updated_at_ns: string;
}

export interface PaymentOutcome {
  request_id: string;
  status: Status;
  reason_code: ReasonCode;
  request_hash: string | null;
}

export interface BudgetView {
  token: string;
  day: number;
  daily_limit: string;
  executed: string;
  pending: string;
  available: string;
}

export interface ConfigView {
  vault_id: string;
  owner: string;
  network: string;
  agents: string[];
  paused: boolean;
  policy_version: number;
  open_approvals: number;
  request_count: number;
}
