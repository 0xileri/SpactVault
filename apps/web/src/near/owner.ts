import {
  configViewSchema,
  ftMetadataSchema,
  parseU128,
  policySchema,
  viewAccount,
  viewFunction,
  type AccountView,
  type ConfigView,
  type FtMetadata,
  type Policy,
} from "@spact/shared";

import type { AppConfig } from "../config.js";

export interface TokenHolding {
  token: string;
  metadata: FtMetadata | null;
  /** The vault's balance, null when unreadable. */
  vaultBalance: bigint | null;
  /** The connected wallet's balance, null when unreadable or not connected. */
  ownerBalance: bigint | null;
  /** Whether the vault is registered with the token (storage_balance_of), null when unreadable. */
  vaultRegistered: boolean | null;
  /** storage_balance_bounds.min: what registering an account costs, in yoctoNEAR. */
  storageMin: bigint | null;
}

/** Everything the Manage page shows, read from chain. */
export interface OwnerSnapshot {
  config: ConfigView;
  policy: Policy;
  account: AccountView | null;
  tokens: TokenHolding[];
}

function u128OrNull(raw: unknown): bigint | null {
  try {
    return typeof raw === "string" ? parseU128(raw) : null;
  } catch {
    return null;
  }
}

/** Whether `account` is registered with `token`, and what registering costs. */
export async function tokenStorage(rpcUrl: string, token: string, account: string): Promise<{ registered: boolean | null; min: bigint | null }> {
  const [balance, bounds] = await Promise.all([
    viewFunction(rpcUrl, token, "storage_balance_of", { account_id: account }).catch(() => undefined),
    viewFunction(rpcUrl, token, "storage_balance_bounds").catch(() => null),
  ]);
  const min = typeof bounds === "object" && bounds !== null && "min" in bounds ? u128OrNull((bounds as { min: unknown }).min) : null;
  return { registered: balance === undefined ? null : balance !== null, min };
}

async function holding(cfg: AppConfig, token: string, owner: string | null): Promise<TokenHolding> {
  const [metadataRaw, vaultRaw, ownerRaw, storage] = await Promise.all([
    viewFunction(cfg.rpcUrl, token, "ft_metadata").catch(() => null),
    viewFunction(cfg.rpcUrl, token, "ft_balance_of", { account_id: cfg.vaultId }).catch(() => null),
    owner ? viewFunction(cfg.rpcUrl, token, "ft_balance_of", { account_id: owner }).catch(() => null) : Promise.resolve(null),
    tokenStorage(cfg.rpcUrl, token, cfg.vaultId),
  ]);
  const metadata = ftMetadataSchema.safeParse(metadataRaw);
  return {
    token,
    metadata: metadata.success ? metadata.data : null,
    vaultBalance: u128OrNull(vaultRaw),
    ownerBalance: u128OrNull(ownerRaw),
    vaultRegistered: storage.registered,
    storageMin: storage.min,
  };
}

export async function loadOwnerSnapshot(cfg: AppConfig, owner: string | null): Promise<OwnerSnapshot> {
  const [configRaw, policyRaw, account] = await Promise.all([
    viewFunction(cfg.rpcUrl, cfg.vaultId, "get_config"),
    viewFunction(cfg.rpcUrl, cfg.vaultId, "get_policy"),
    viewAccount(cfg.rpcUrl, cfg.vaultId),
  ]);
  const config = configViewSchema.parse(configRaw);
  const policy = policySchema.parse(policyRaw);
  const tokens = await Promise.all(policy.tokens.map((t) => holding(cfg, t.token, owner)));
  return { config, policy, account, tokens };
}
