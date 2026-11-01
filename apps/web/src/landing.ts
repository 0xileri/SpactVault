import { parseU128, type FtMetadata, type PaymentRequest, type TokenPolicy } from "@spact/shared";

import { waitingForOwner } from "./dashboard.js";
import { formatAmount } from "./format.js";

/** What happens to a payment, in one line per outcome. */
export interface OutcomeRules {
  paid: string;
  waits: string;
  blocked: string;
}

/** For a site with no vault: the rules in words, without numbers. */
export const GENERIC_RULES: OutcomeRules = {
  paid: "Small payments, up to your instant limit",
  waits: "Bigger payments, up to your limit per payment",
  blocked: "Over your limit per payment or per day, or to anyone not on your list",
};

/** The three outcomes in this vault's own numbers, for one token of its policy. */
export function outcomeRules(policy: TokenPolicy, metadata: FtMetadata | null): OutcomeRules {
  const fmt = (units: string) => formatAmount(units, metadata);
  const auto = parseU128(policy.auto_limit);
  const cap = parseU128(policy.hard_tx_limit);
  return {
    paid: auto === 0n ? "Nothing: every payment waits for you" : `Up to ${fmt(policy.auto_limit)}`,
    waits: auto >= cap ? "Nothing: everything up to the limit is paid instantly" : `Over ${fmt(policy.auto_limit)}, up to ${fmt(policy.hard_tx_limit)}`,
    blocked: `Over ${fmt(policy.hard_tx_limit)}, more than ${fmt(policy.daily_limit)} in one day, or to anyone not on the list`,
  };
}

export interface LiveCounts {
  /** Paid requests among the ones read. */
  paid: number;
  /** Requests the owner can still approve, among the ones read. */
  waiting: number;
  /** How many requests were read (the newest ones). */
  read: number;
  /** Requests the vault has stored in total. Blocked requests are never stored. */
  stored: number;
}

export function liveCounts(requests: PaymentRequest[], nowNs: bigint, stored: number): LiveCounts {
  return {
    paid: requests.filter((r) => r.status === "SETTLED").length,
    waiting: waitingForOwner(requests, nowNs).length,
    read: requests.length,
    stored,
  };
}

/** Amounts for the hero animation: one payment for each outcome, and the two limits that decide them. */
export interface ExampleAmounts {
  paid: string;
  waits: string;
  blocked: string;
  auto: string;
  cap: string;
  /** True when the numbers are a made up example, not this vault's limits. */
  example: boolean;
}

export const GENERIC_AMOUNTS: ExampleAmounts = { paid: "3 TUSD", waits: "12 TUSD", blocked: "45 TUSD", auto: "10 TUSD", cap: "30 TUSD", example: true };

/** One amount per outcome under this policy, or the generic example when the policy has no such three. */
export function exampleAmounts(policy: TokenPolicy, metadata: FtMetadata | null): ExampleAmounts {
  const auto = parseU128(policy.auto_limit);
  const cap = parseU128(policy.hard_tx_limit);
  if (!metadata || auto === 0n || auto >= cap) return GENERIC_AMOUNTS;
  const fmt = (units: bigint) => formatAmount(units.toString(), metadata);
  const paid = (auto * 3n) / 10n || auto;
  const above = (auto * 12n) / 10n;
  const waits = above > auto && above <= cap ? above : (auto + cap + 1n) / 2n;
  const over = (cap * 3n) / 2n;
  const blocked = over > cap ? over : cap + 1n;
  return { paid: fmt(paid), waits: fmt(waits), blocked: fmt(blocked), auto: fmt(auto), cap: fmt(cap), example: false };
}
