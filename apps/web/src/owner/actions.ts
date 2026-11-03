/**
 * Transactions the owner signs from the website (ADR-033), built as plain data so the review screen can
 * show exactly what the wallet will be asked to sign. Nothing here signs or sends anything.
 */
import { accountId, CHAIN_RE, EXTERNAL_ID_RE, formatUnits, type Policy } from "@spact/shared";

import type { WalletAction } from "../signers/types.js";

export const ONE_YOCTO = "1";
const TGAS = 1_000_000_000_000n;
export const OWNER_CALL_GAS = (30n * TGAS).toString();
export const SET_POLICY_GAS = (50n * TGAS).toString();
export const TOKEN_CALL_GAS = (30n * TGAS).toString();
/** Gas for the vault's `new`. The deploy itself costs little gas but needs the code's storage paid for. */
export const INIT_GAS = 100n * TGAS;

export const YOCTO_PER_NEAR = 10n ** 24n;
/** NEAR's storage price: 10^19 yoctoNEAR per byte, 1 NEAR per 100 kB. */
export const YOCTO_PER_BYTE = 10n ** 19n;

/** The vault methods an agent key may call (AGENTS.md I1, plus P1's cross-chain request). Nothing else. */
export const AGENT_METHODS = ["request_direct_payment", "request_cross_chain_payment", "execute_request"] as const;

// Same bounds as validate_policy in contracts/spact-vault/src/lib.rs. The vault checks again on chain;
// checking here only gives a clear message before anything is signed.
export const POLICY_BOUNDS = {
  maxTokens: 8,
  maxRecipients: 64,
  maxOpenApprovals: 100,
  maxRequestsPerDay: 1_000,
  minTtlSec: 60,
  maxTtlSec: 7 * 24 * 60 * 60,
  maxRoutes: 4,
  maxRouteRecipients: 8,
  maxAgents: 8,
} as const;

export class OwnerInputError extends Error {}

function fn(methodName: string, args: Record<string, unknown>, gas: string, deposit: string): WalletAction {
  return { type: "FunctionCall", params: { methodName, args, gas, deposit } };
}

/** "3.25" NEAR -> yoctoNEAR. Plain decimals only, at most 24 places. */
export function parseNear(display: string): bigint {
  const m = /^(0|[1-9]\d*)(?:\.(\d{1,24}))?$/.exec(display.trim());
  if (!m) throw new OwnerInputError(`${JSON.stringify(display)} is not an amount of NEAR`);
  return BigInt((m[1] ?? "0") + (m[2] ?? "").padEnd(24, "0"));
}

export function formatNear(yocto: bigint, places = 4): string {
  const whole = yocto / YOCTO_PER_NEAR;
  const frac = (yocto % YOCTO_PER_NEAR).toString().padStart(24, "0").slice(0, places).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** `name.parent`, checked: a direct sub-account the parent can create. */
export function subAccountId(name: string, parent: string): string {
  if (!/^[a-z0-9]+([-_][a-z0-9]+)*$/.test(name)) {
    throw new OwnerInputError("Use lowercase letters and digits, with single - or _ between them, and no dots.");
  }
  const id = `${name}.${parent}`;
  if (!accountId.safeParse(id).success) throw new OwnerInputError(`${id} is not a valid NEAR account id (64 characters at most).`);
  return id;
}

/** What the vault's code needs to be stored, plus a margin for its state and the first requests. */
export function vaultStorageNeeded(wasmBytes: number): bigint {
  return BigInt(wasmBytes) * YOCTO_PER_BYTE + YOCTO_PER_NEAR / 20n;
}

/**
 * Transaction 1 of creating a vault, signed by the owner's wallet: create `vaultId` as its sub-account,
 * fund it, and give it one temporary full-access key that only this browser tab holds. Transaction 2
 * (owner/deploy.ts) uses that key once to deploy, initialize and delete the key.
 */
export function createVaultAccountActions(fundYocto: bigint, temporaryPublicKey: string): WalletAction[] {
  return [
    { type: "CreateAccount" },
    { type: "Transfer", params: { deposit: fundYocto.toString() } },
    { type: "AddKey", params: { publicKey: temporaryPublicKey, accessKey: { permission: "FullAccess" } } },
  ];
}

export interface InitArgs {
  owner: string;
  agents: string[];
  network: string;
  policy: Policy;
}

/**
 * Transaction to create an agent account `agentId` with a single function-call key: it may call only
 * AGENT_METHODS on `vaultId`, and spend at most `allowanceYocto` on gas. The account gets no full-access
 * key, so the key file the owner downloads is all anyone can ever sign with for it.
 */
export function createAgentActions(vaultId: string, fundYocto: bigint, publicKey: string, allowanceYocto: bigint): WalletAction[] {
  return [
    { type: "CreateAccount" },
    { type: "Transfer", params: { deposit: fundYocto.toString() } },
    {
      type: "AddKey",
      params: {
        publicKey,
        accessKey: { permission: { receiverId: vaultId, allowance: allowanceYocto.toString(), methodNames: [...AGENT_METHODS] } },
      },
    },
  ];
}

/**
 * Funds a vault with a NEP-141 token: registers the vault with the token first when it is not yet
 * (storage_deposit), then ft_transfer. Not ft_transfer_call: the vault has no ft_on_transfer, so the token
 * would call it, fail, and send everything back.
 */
export function fundActions(vaultId: string, amount: bigint, storageDepositYocto: bigint | null): WalletAction[] {
  if (amount <= 0n) throw new OwnerInputError("Enter an amount above zero.");
  const actions: WalletAction[] = [];
  if (storageDepositYocto !== null) {
    actions.push(fn("storage_deposit", { account_id: vaultId, registration_only: true }, TOKEN_CALL_GAS, storageDepositYocto.toString()));
  }
  actions.push(fn("ft_transfer", { receiver_id: vaultId, amount: amount.toString() }, TOKEN_CALL_GAS, ONE_YOCTO));
  return actions;
}

/** Registers any account (e.g. a 1Click deposit address) with a token, so a transfer to it can land. */
export function registerWithTokenActions(account: string, storageDepositYocto: bigint): WalletAction[] {
  return [fn("storage_deposit", { account_id: account, registration_only: true }, TOKEN_CALL_GAS, storageDepositYocto.toString())];
}

export function topUpNearActions(yocto: bigint): WalletAction[] {
  if (yocto <= 0n) throw new OwnerInputError("Enter an amount above zero.");
  return [{ type: "Transfer", params: { deposit: yocto.toString() } }];
}

export function setPolicyActions(policy: Policy): WalletAction[] {
  return [fn("set_policy", { policy }, SET_POLICY_GAS, ONE_YOCTO)];
}

export function setPausedActions(paused: boolean): WalletAction[] {
  return [fn("set_paused", { paused }, OWNER_CALL_GAS, ONE_YOCTO)];
}

export function addAgentActions(agentId: string): WalletAction[] {
  return [fn("add_agent", { agent_id: agentId }, OWNER_CALL_GAS, ONE_YOCTO)];
}

export function removeAgentActions(agentId: string): WalletAction[] {
  return [fn("remove_agent", { agent_id: agentId }, OWNER_CALL_GAS, ONE_YOCTO)];
}

/** A near-cli style key file, the format apps/mcp reads (SPACT_AGENT_KEY_FILE). */
export function agentKeyFile(agentId: string, publicKey: string, privateKey: string): string {
  return `${JSON.stringify({ account_id: agentId, public_key: publicKey, private_key: privateKey }, null, 2)}\n`;
}

function isU128(s: string): boolean {
  return /^(0|[1-9]\d*)$/.test(s) && BigInt(s) < 1n << 128n;
}

/** Why the vault would refuse this policy, in the order validate_policy checks. Empty: it would accept it. */
export function policyProblems(policy: Policy, vaultId: string): string[] {
  const out: string[] = [];
  const b = POLICY_BOUNDS;
  if (policy.tokens.length === 0) out.push("Add at least one token, or the agent cannot pay anything.");
  if (policy.tokens.length > b.maxTokens) out.push(`At most ${b.maxTokens} tokens.`);
  if (policy.recipients.length > b.maxRecipients) out.push(`At most ${b.maxRecipients} recipients.`);
  policy.tokens.forEach((t, i) => {
    if (!accountId.safeParse(t.token).success) out.push(`${t.token || "(empty)"} is not a token account id.`);
    if (policy.tokens.slice(0, i).some((o) => o.token === t.token)) out.push(`${t.token} is listed twice.`);
    if (t.token === vaultId) out.push("The token must not be the vault itself.");
    if (![t.auto_limit, t.hard_tx_limit, t.daily_limit].every(isU128)) {
      out.push(`${t.token}: limits must be whole numbers of the token's smallest unit.`);
      return;
    }
    const [auto, cap, daily] = [BigInt(t.auto_limit), BigInt(t.hard_tx_limit), BigInt(t.daily_limit)];
    if (cap === 0n || daily === 0n) out.push(`${t.token}: the per-payment cap and the daily limit must be above zero.`);
    if (auto > cap) out.push(`${t.token}: the instant limit must not be above the per-payment cap.`);
    if (cap > daily) out.push(`${t.token}: the per-payment cap must not be above the daily limit.`);
  });
  policy.recipients.forEach((r, i) => {
    if (!accountId.safeParse(r).success) out.push(`${r || "(empty)"} is not a NEAR account id.`);
    if (policy.recipients.slice(0, i).includes(r)) out.push(`${r} is listed twice.`);
    if (r === vaultId) out.push("The vault cannot pay itself.");
  });
  if (!Number.isInteger(policy.max_open_approvals) || policy.max_open_approvals < 1 || policy.max_open_approvals > b.maxOpenApprovals) {
    out.push(`Waiting approvals must be 1 to ${b.maxOpenApprovals}.`);
  }
  if (!Number.isInteger(policy.max_requests_per_day) || policy.max_requests_per_day < 1 || policy.max_requests_per_day > b.maxRequestsPerDay) {
    out.push(`Requests per day must be 1 to ${b.maxRequestsPerDay}.`);
  }
  if (!Number.isInteger(policy.approval_ttl_sec) || policy.approval_ttl_sec < b.minTtlSec || policy.approval_ttl_sec > b.maxTtlSec) {
    out.push("A request may wait between 1 minute and 7 days.");
  }
  if (policy.cross_chain.length > b.maxRoutes) out.push(`At most ${b.maxRoutes} cross-chain routes.`);
  policy.cross_chain.forEach((r, i) => {
    if (!policy.tokens.some((t) => t.token === r.token)) out.push(`Cross-chain route: ${r.token} is not one of the vault's tokens.`);
    if (!CHAIN_RE.test(r.destination_chain)) out.push(`Cross-chain route: ${r.destination_chain || "(empty)"} is not a chain name.`);
    if (!EXTERNAL_ID_RE.test(r.destination_asset)) out.push(`Cross-chain route: ${r.destination_asset || "(empty)"} is not a 1Click asset id.`);
    const dup = policy.cross_chain
      .slice(0, i)
      .some((o) => o.token === r.token && o.destination_chain === r.destination_chain && o.destination_asset === r.destination_asset);
    if (dup) out.push(`Cross-chain route to ${r.destination_asset} is listed twice.`);
    if (r.recipients.length < 1 || r.recipients.length > b.maxRouteRecipients) {
      out.push(`Each cross-chain route needs 1 to ${b.maxRouteRecipients} recipients.`);
    }
    r.recipients.forEach((a, j) => {
      if (!EXTERNAL_ID_RE.test(a)) out.push(`Cross-chain recipient ${a || "(empty)"} is not an address 1Click accepts.`);
      if (r.recipients.slice(0, j).includes(a)) out.push(`Cross-chain recipient ${a} is listed twice.`);
    });
  });
  return out;
}

/** Why the vault would refuse `agentId` as an agent, or null. */
export function agentProblem(agentId: string, owner: string, vaultId: string, agents: string[]): string | null {
  if (!accountId.safeParse(agentId).success) return `${agentId || "(empty)"} is not a NEAR account id.`;
  if (agentId === owner) return "The agent must not be the owner: an agent never holds the owner's keys.";
  if (agentId === vaultId) return "The agent must not be the vault itself.";
  if (agents.includes(agentId)) return `${agentId} is already an agent of this vault.`;
  if (agents.length >= POLICY_BOUNDS.maxAgents) return `A vault has at most ${POLICY_BOUNDS.maxAgents} agents.`;
  return null;
}

export type Decimals = (token: string) => { decimals: number; symbol: string } | null;

function amountLabel(units: string, token: string, meta: Decimals): string {
  const m = meta(token);
  if (!m || !isU128(units)) return `${units} units`;
  return `${formatUnits(BigInt(units), m.decimals)} ${m.symbol}`;
}

function ttlLabel(sec: number): string {
  if (sec % 86_400 === 0) return `${sec / 86_400} day${sec === 86_400 ? "" : "s"}`;
  if (sec % 3_600 === 0) return `${sec / 3_600} hour${sec === 3_600 ? "" : "s"}`;
  if (sec % 60 === 0) return `${sec / 60} minute${sec === 60 ? "" : "s"}`;
  return `${sec} seconds`;
}

/** What a new policy changes, one plain sentence per change. Empty: nothing changes. */
export function policyChanges(before: Policy, after: Policy, meta: Decimals): string[] {
  const out: string[] = [];
  for (const t of after.tokens) {
    const old = before.tokens.find((o) => o.token === t.token);
    const name = meta(t.token)?.symbol ?? t.token;
    if (!old) {
      out.push(
        `Adds ${name}: instant up to ${amountLabel(t.auto_limit, t.token, meta)}, cap ${amountLabel(t.hard_tx_limit, t.token, meta)}, daily ${amountLabel(t.daily_limit, t.token, meta)}.`,
      );
      continue;
    }
    const pairs: [string, string, string][] = [
      ["instant limit", old.auto_limit, t.auto_limit],
      ["per-payment cap", old.hard_tx_limit, t.hard_tx_limit],
      ["daily limit", old.daily_limit, t.daily_limit],
    ];
    for (const [label, from, to] of pairs) {
      if (from !== to) out.push(`${name} ${label}: ${amountLabel(from, t.token, meta)} → ${amountLabel(to, t.token, meta)}.`);
    }
  }
  for (const o of before.tokens) {
    if (!after.tokens.some((t) => t.token === o.token)) out.push(`Removes ${meta(o.token)?.symbol ?? o.token}: the agent can no longer pay with it.`);
  }
  for (const r of after.recipients) if (!before.recipients.includes(r)) out.push(`Allows paying ${r}.`);
  for (const r of before.recipients) if (!after.recipients.includes(r)) out.push(`No longer allows paying ${r}.`);
  if (before.max_open_approvals !== after.max_open_approvals) {
    out.push(`Payments waiting for you at once: ${before.max_open_approvals} → ${after.max_open_approvals}.`);
  }
  if (before.max_requests_per_day !== after.max_requests_per_day) {
    out.push(`Requests per day: ${before.max_requests_per_day} → ${after.max_requests_per_day}.`);
  }
  if (before.approval_ttl_sec !== after.approval_ttl_sec) {
    out.push(`A request may wait: ${ttlLabel(before.approval_ttl_sec)} → ${ttlLabel(after.approval_ttl_sec)}.`);
  }
  const routeKey = (r: Policy["cross_chain"][number]) => `${r.token}|${r.destination_chain}|${r.destination_asset}`;
  for (const r of after.cross_chain) {
    const old = before.cross_chain.find((o) => routeKey(o) === routeKey(r));
    if (!old) {
      out.push(`Allows cross-chain payments to ${r.destination_chain} (${r.destination_asset}) for ${r.recipients.join(", ")}.`);
      continue;
    }
    for (const a of r.recipients) if (!old.recipients.includes(a)) out.push(`Allows cross-chain payments to ${a} on ${r.destination_chain}.`);
    for (const a of old.recipients) if (!r.recipients.includes(a)) out.push(`No longer allows cross-chain payments to ${a} on ${r.destination_chain}.`);
  }
  for (const o of before.cross_chain) {
    if (!after.cross_chain.some((r) => routeKey(r) === routeKey(o))) out.push(`Turns off cross-chain payments to ${o.destination_chain} (${o.destination_asset}).`);
  }
  return out;
}

export interface ActionLine {
  /** Plain words, e.g. "Send 3.2 NEAR". */
  summary: string;
  /** The exact data the wallet receives for this action. */
  detail: Record<string, unknown>;
}

/** One line per action for the review screen, plus the raw data the wallet is asked to sign. */
export function describeActions(receiverId: string, actions: WalletAction[]): ActionLine[] {
  return actions.map((a) => {
    switch (a.type) {
      case "CreateAccount":
        return { summary: `Create the account ${receiverId}`, detail: { type: a.type } };
      case "Transfer":
        return { summary: `Send ${formatNear(BigInt(a.params.deposit))} NEAR to ${receiverId}`, detail: { type: a.type, ...a.params } };
      case "AddKey": {
        const p = a.params.accessKey.permission;
        const summary =
          p === "FullAccess"
            ? `Give ${receiverId} a temporary full-access key (${a.params.publicKey.slice(0, 16)}…), held only by this tab`
            : `Give ${receiverId} a key that can only call ${p.methodNames.join(", ")} on ${p.receiverId}${p.allowance ? `, with at most ${formatNear(BigInt(p.allowance))} NEAR of gas` : ""}`;
        return { summary, detail: { type: a.type, ...a.params } };
      }
      case "FunctionCall": {
        const deposit = BigInt(a.params.deposit);
        const attach = deposit === 0n ? "" : deposit === 1n ? " (with 1 yoctoNEAR, so only a full-access key can sign it)" : ` with ${formatNear(deposit, 5)} NEAR`;
        return { summary: `Call ${a.params.methodName} on ${receiverId}${attach}`, detail: { type: a.type, ...a.params } };
      }
    }
  });
}
