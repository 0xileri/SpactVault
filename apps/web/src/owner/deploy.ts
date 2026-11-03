/**
 * Transaction 2 of creating a vault (ADR-033), signed in this browser tab with a temporary full-access key
 * of the new vault account: deploy the wasm, call `new`, delete the key, in one transaction. `new` must be
 * called by the vault account itself (ADR-010), which a wallet signing as the owner cannot do, so the owner's
 * wallet adds this key in transaction 1 and this tab uses it exactly once.
 *
 * The temporary key never leaves the tab: it is generated here, used here, and deleted on chain by the same
 * transaction that deploys. Between the two transactions it sits in sessionStorage (this tab only, gone when
 * the tab closes), so a reload or a wallet redirect does not strand the funded account. If the deploy cannot
 * go ahead, the same key can delete the new account and send its NEAR back to the owner instead.
 */
import {
  configViewSchema,
  NO_CODE_HASH,
  viewAccessKeyList,
  viewAccount,
  viewFunction,
  type AccessKeyEntry,
  type AccountView,
  type ConfigView,
} from "@spact/shared";

import { buildForCodeHash, type VaultBuild } from "../contracts.js";
import { INIT_GAS, type InitArgs } from "./actions.js";

export interface TemporaryKey {
  publicKey: string;
  secretKey: string;
}

/** What transaction 2 needs, kept until it succeeds or is cancelled. */
export interface PendingDeploy {
  network: string;
  rpcUrl: string;
  vaultId: string;
  owner: string;
  buildId: string;
  init: InitArgs;
  key: TemporaryKey;
  createdAt: number;
}

const STORAGE_KEY = "spactvault.pending-deploy";

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function savePending(p: PendingDeploy): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // no storage (private mode, blocked): the tab's memory still holds it
  }
}

export function loadPending(network: string): PendingDeploy | null {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingDeploy;
    return p.network === network && typeof p.key?.secretKey === "string" && typeof p.vaultId === "string" ? p : null;
  } catch {
    return null;
  }
}

export function clearPending(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // nothing stored
  }
}

/** A fresh ed25519 key pair from the browser's CSPRNG (near-api-js uses crypto.getRandomValues). */
export async function generateKey(): Promise<TemporaryKey> {
  const { KeyPair } = await import("near-api-js");
  const pair = KeyPair.fromRandom("ed25519");
  return { publicKey: pair.getPublicKey().toString(), secretKey: pair.toString() };
}

export interface SentTx {
  txHash: string | null;
  failure: string | null;
}

function outcomeOf(result: unknown): SentTx {
  const r = (result ?? {}) as { transaction?: { hash?: unknown }; status?: unknown };
  const txHash = typeof r.transaction?.hash === "string" ? r.transaction.hash : null;
  const status = r.status;
  const failure = typeof status === "object" && status !== null && "Failure" in status ? JSON.stringify((status as { Failure: unknown }).Failure) : null;
  return { txHash, failure };
}

/** Deploys `wasm`, calls `new`, deletes the temporary key: one transaction from the vault account to itself. */
export async function deployAndLock(p: PendingDeploy, wasm: Uint8Array): Promise<SentTx> {
  const near = await import("near-api-js");
  const account = new near.Account(p.vaultId, new near.JsonRpcProvider({ url: p.rpcUrl }), p.key.secretKey as `ed25519:${string}`);
  const result: unknown = await account.signAndSendTransaction({
    receiverId: p.vaultId,
    actions: [
      near.actions.deployContract(wasm),
      near.actions.functionCall("new", { ...p.init }, INIT_GAS, 0n),
      near.actions.deleteKey(near.PublicKey.fromString(p.key.publicKey)),
    ],
    throwOnFailure: false,
    // the checks that follow read final state, so wait until the install is final too
    waitUntil: "FINAL",
  });
  return outcomeOf(result);
}

/** Gives up on a half-created vault: deletes the account and sends what is left of its NEAR to the owner. */
export async function cancelDeploy(p: PendingDeploy): Promise<SentTx> {
  const near = await import("near-api-js");
  const account = new near.Account(p.vaultId, new near.JsonRpcProvider({ url: p.rpcUrl }), p.key.secretKey as `ed25519:${string}`);
  const result: unknown = await account.signAndSendTransaction({
    receiverId: p.vaultId,
    actions: [near.actions.deleteAccount(p.owner)],
    throwOnFailure: false,
    waitUntil: "FINAL",
  });
  return outcomeOf(result);
}

export interface VaultInspection {
  account: AccountView | null;
  keys: AccessKeyEntry[];
  /** The build this site knows for the account's code hash, or null. */
  build: VaultBuild | null;
  config: ConfigView | null;
}

/** Reads what is really on chain for a vault account: code hash, keys, and its own config. */
export async function inspectVault(rpcUrl: string, vaultId: string): Promise<VaultInspection> {
  const account = await viewAccount(rpcUrl, vaultId);
  if (!account) return { account: null, keys: [], build: null, config: null };
  const keys = await viewAccessKeyList(rpcUrl, vaultId);
  const build = buildForCodeHash(account.codeHash);
  let config: ConfigView | null = null;
  if (account.codeHash !== NO_CODE_HASH) {
    const parsed = configViewSchema.safeParse(await viewFunction(rpcUrl, vaultId, "get_config").catch(() => null));
    config = parsed.success ? parsed.data : null;
  }
  return { account, keys, build, config };
}

/**
 * inspectVault until the account shows `codeHash` and no keys, or `timeoutMs` passes: RPC nodes can lag a
 * block or two behind the transaction that just finished. Returns the last reading either way.
 */
export async function inspectUntilLocked(rpcUrl: string, vaultId: string, codeHash: string, timeoutMs = 20_000): Promise<VaultInspection> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await inspectVault(rpcUrl, vaultId);
    const settled = found.account?.codeHash === codeHash && found.keys.length === 0 && found.config !== null;
    if (settled || Date.now() >= deadline) return found;
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

export interface LockCheck {
  ok: boolean;
  lines: { ok: boolean; text: string }[];
}

/** The checks the create-vault page shows once the vault is up: right code, no keys, the owner's settings. */
export function checkDeployed(found: VaultInspection, expected: { build: VaultBuild; init: InitArgs; vaultId: string }): LockCheck {
  const lines: LockCheck["lines"] = [];
  const add = (ok: boolean, text: string) => lines.push({ ok, text });
  add(found.account !== null, found.account ? `${expected.vaultId} exists` : `${expected.vaultId} does not exist`);
  add(
    found.account?.codeHash === expected.build.codeHash,
    `Code hash ${found.account?.codeHash ?? "none"} ${found.account?.codeHash === expected.build.codeHash ? "matches" : "does not match"} the published build (${expected.build.codeHash})`,
  );
  add(found.keys.length === 0, found.keys.length === 0 ? "No access keys: nobody can change its code or sign as it" : `${found.keys.length} access key(s) left: not locked yet`);
  const c = found.config;
  add(c?.owner === expected.init.owner, `Owner is ${c?.owner ?? "unknown"}`);
  add(c?.vault_id === expected.vaultId && c?.network === expected.init.network, `Vault says it is ${c?.vault_id ?? "?"} on ${c?.network ?? "?"}`);
  const agentsMatch = c !== null && c.agents.length === expected.init.agents.length && c.agents.every((a, i) => a === expected.init.agents[i]);
  add(agentsMatch, `Agents: ${c?.agents.join(", ") || "none"}`);
  return { ok: lines.every((l) => l.ok), lines };
}
