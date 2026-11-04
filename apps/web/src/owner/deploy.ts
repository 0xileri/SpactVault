/**
 * Transaction 2 of creating a vault (ADR-033, ADR-035), signed in this browser tab with a key the tab made.
 * `new` must be called by the vault account itself (ADR-010), which a wallet signing as the owner cannot do,
 * so the wallet's transaction 1 gives the new account a key that only this tab holds, and the tab uses it once.
 *
 * Two ways, because wallets differ in what they let a website ask for:
 * - **named** (`name.<owner>`): the wallet creates the account, installs the code and adds an init key, a
 *   function-call key that can only call `new` on the vault. The tab calls `new` with it. The key stays, spent:
 *   `new` refuses forever once the vault runs. Some NEAR wallets refuse to add a full-access key for a website, which is
 *   why the earlier design (a full-access key the tab deleted) could not be signed there.
 * - **any wallet** (an implicit account, 64 hex characters): the wallet only sends NEAR, which every wallet can
 *   do. The tab's key is the account's full-access key; the tab installs the code, calls `new` and deletes the
 *   key in one transaction, and can instead delete the account and return the NEAR if needed.
 *
 * The tab's key never leaves the tab: it is generated here, used here, and kept in sessionStorage (this tab
 * only, gone when it closes) between the two transactions, so a reload or a wallet redirect does not strand
 * the funded account.
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

import { buildForCodeHash, lockProblem, type VaultBuild } from "../contracts.js";
import { INIT_GAS, NAMED_INIT_GAS, type InitArgs } from "./actions.js";

export interface TemporaryKey {
  publicKey: string;
  secretKey: string;
}

export type DeployMode = "named" | "any-wallet";

/** What transaction 2 needs, kept until it succeeds or is cancelled. */
export interface PendingDeploy {
  mode: DeployMode;
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
    const known = p.mode === "named" || p.mode === "any-wallet";
    return known && p.network === network && typeof p.key?.secretKey === "string" && typeof p.vaultId === "string" ? p : null;
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

/**
 * An agent account being set up the any-wallet way (ADR-035): funded by the wallet's transfer, still holding
 * the tab's temporary key until the swap. The agent's own secret key is never stored: the owner downloaded it.
 */
export interface PendingAgent {
  network: string;
  rpcUrl: string;
  vaultId: string;
  agentId: string;
  temporary: TemporaryKey;
  restrictedPublicKey: string;
  fundYocto: string;
  allowanceYocto: string;
  createdAt: number;
}

const AGENT_STORAGE_KEY = "spactvault.pending-agent";

export function savePendingAgent(p: PendingAgent): void {
  try {
    storage()?.setItem(AGENT_STORAGE_KEY, JSON.stringify(p));
  } catch {
    // no storage: the tab's memory still holds it
  }
}

export function loadPendingAgent(network: string, vaultId: string): PendingAgent | null {
  try {
    const raw = storage()?.getItem(AGENT_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingAgent;
    const ok =
      p.network === network &&
      p.vaultId === vaultId &&
      typeof p.agentId === "string" &&
      typeof p.temporary?.secretKey === "string" &&
      typeof p.restrictedPublicKey === "string" &&
      /^\d+$/.test(String(p.fundYocto)) &&
      /^\d+$/.test(String(p.allowanceYocto));
    return ok ? p : null;
  } catch {
    return null;
  }
}

export function clearPendingAgent(): void {
  try {
    storage()?.removeItem(AGENT_STORAGE_KEY);
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

async function tabAccount(p: Pick<PendingDeploy, "vaultId" | "rpcUrl" | "key">) {
  const near = await import("near-api-js");
  return { near, account: new near.Account(p.vaultId, new near.JsonRpcProvider({ url: p.rpcUrl }), p.key.secretKey as `ed25519:${string}`) };
}

/** Named vault, step 2: the init key calls `new` (the code is already installed by step 1). */
export async function initVault(p: PendingDeploy): Promise<SentTx> {
  const { near, account } = await tabAccount(p);
  const result: unknown = await account.signAndSendTransaction({
    receiverId: p.vaultId,
    actions: [near.actions.functionCall("new", { ...p.init }, NAMED_INIT_GAS, 0n)],
    throwOnFailure: false,
    // the checks that follow read final state, so wait until this is final too
    waitUntil: "FINAL",
  });
  return outcomeOf(result);
}

/** Any-wallet vault, step 2: deploys `wasm`, calls `new`, deletes the tab's key, in one transaction. */
export async function deployAndLock(p: PendingDeploy, wasm: Uint8Array): Promise<SentTx> {
  const { near, account } = await tabAccount(p);
  const result: unknown = await account.signAndSendTransaction({
    receiverId: p.vaultId,
    actions: [
      near.actions.deployContract(wasm),
      near.actions.functionCall("new", { ...p.init }, INIT_GAS, 0n),
      near.actions.deleteKey(near.PublicKey.fromString(p.key.publicKey)),
    ],
    throwOnFailure: false,
    waitUntil: "FINAL",
  });
  return outcomeOf(result);
}

/** Any-wallet vault only: gives up before step 2, deleting the account and sending its NEAR to the owner. */
export async function cancelDeploy(p: PendingDeploy): Promise<SentTx> {
  const { near, account } = await tabAccount(p);
  const result: unknown = await account.signAndSendTransaction({
    receiverId: p.vaultId,
    actions: [near.actions.deleteAccount(p.owner)],
    throwOnFailure: false,
    waitUntil: "FINAL",
  });
  return outcomeOf(result);
}

/**
 * Any-wallet agent (ADR-035): the tab holds the implicit account's full-access key, adds the agent's restricted
 * key and deletes its own in one transaction, so the account ends with only the restricted key.
 */
export async function swapToRestrictedKey(
  rpcUrl: string,
  agentId: string,
  temporary: TemporaryKey,
  restrictedPublicKey: string,
  vaultId: string,
  methods: readonly string[],
  allowanceYocto: bigint,
): Promise<SentTx> {
  const { near, account } = await tabAccount({ vaultId: agentId, rpcUrl, key: temporary });
  const result: unknown = await account.signAndSendTransaction({
    receiverId: agentId,
    actions: [
      near.actions.addFunctionCallAccessKey(near.PublicKey.fromString(restrictedPublicKey), vaultId, [...methods], allowanceYocto),
      near.actions.deleteKey(near.PublicKey.fromString(temporary.publicKey)),
    ],
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
 * inspectVault until the account shows `codeHash`, is locked and answers get_config, or `timeoutMs` passes: RPC
 * nodes can lag a block or two behind the transaction that just finished. Returns the last reading either way.
 */
export async function inspectUntilLocked(rpcUrl: string, vaultId: string, codeHash: string, timeoutMs = 20_000): Promise<VaultInspection> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await inspectVault(rpcUrl, vaultId);
    const settled = found.account?.codeHash === codeHash && lockProblem(found.keys, vaultId) === null && found.config !== null;
    if (settled || Date.now() >= deadline) return found;
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

export interface LockCheck {
  ok: boolean;
  lines: { ok: boolean; text: string }[];
}

/** The checks the create-vault page shows once the vault is up: right code, locked, the owner's settings. */
export function checkDeployed(found: VaultInspection, expected: { build: VaultBuild; init: InitArgs; vaultId: string }): LockCheck {
  const lines: LockCheck["lines"] = [];
  const add = (ok: boolean, text: string) => lines.push({ ok, text });
  add(found.account !== null, found.account ? `${expected.vaultId} exists` : `${expected.vaultId} does not exist`);
  add(
    found.account?.codeHash === expected.build.codeHash,
    `Code hash ${found.account?.codeHash ?? "none"} ${found.account?.codeHash === expected.build.codeHash ? "matches" : "does not match"} the published build (${expected.build.codeHash})`,
  );
  const locked = lockProblem(found.keys, expected.vaultId);
  add(
    locked === null,
    locked !== null
      ? `Not locked: ${locked}`
      : found.keys.length === 0
        ? "No access keys: nobody can change its code or sign as it"
        : "No full-access key: nobody can change its code. One spent setup key is left; it can only call `new`, which the vault now refuses",
  );
  const c = found.config;
  add(c?.owner === expected.init.owner, `Owner is ${c?.owner ?? "unknown"}`);
  add(c?.vault_id === expected.vaultId && c?.network === expected.init.network, `Vault says it is ${c?.vault_id ?? "?"} on ${c?.network ?? "?"}`);
  const agentsMatch = c !== null && c.agents.length === expected.init.agents.length && c.agents.every((a, i) => a === expected.init.agents[i]);
  add(agentsMatch, `Agents: ${c?.agents.join(", ") || "none"}`);
  return { ok: lines.every((l) => l.ok), lines };
}
