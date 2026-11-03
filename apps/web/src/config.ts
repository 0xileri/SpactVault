import { ONE_CLICK_MANAGER_PUBLIC_KEY } from "@spact/intents";
import { accountId } from "@spact/shared";

export type NetworkId = "sandbox" | "testnet" | "mainnet";

export interface AppConfig {
  network: NetworkId;
  rpcUrl: string;
  /** The vault this page shows. A build can list more than one (VITE_EXTRA_VAULTS): one config each. */
  vaultId: string;
  /** Short name for the vault in the vault picker, e.g. "P0 vault". null: just the account id. */
  vaultLabel: string | null;
  /** Explorer URL template with a `{hash}` placeholder, or null when there is no explorer. */
  explorerTxUrl: string | null;
  /** Explorer URL template with an `{account}` placeholder, or null when there is no explorer. */
  explorerAccountUrl: string | null;
  /** Where the Security Lab report is served: relative to the page, or an https URL. */
  securityReportUrl: string;
  /** Local dev signer, sandbox only. */
  devSignerUrl: string | null;
  /** Public source repository, linked from the landing page; https only. null hides the links. */
  repoUrl: string | null;
  /**
   * Base URL of the NEAR Intents 1Click API as this page reaches it: a same-origin path such as `/1click`
   * (the Railway image proxies it, ADR-033) or an https URL. null: no 1Click features on this build.
   */
  oneClickUrl: string | null;
  /**
   * The key 1Click signs quotes with. Always the manager key from 1Click's SDK, except on a local sandbox,
   * where VITE_ONECLICK_SIGNER_KEY lets the mock 1Click sign its own answers (ADR-034).
   */
  oneClickSignerKey: string;
}

/** A build without a vault yet: only the Security Lab works. */
export type LabOnlyConfig = Omit<AppConfig, "vaultId" | "vaultLabel"> & { vaultId: null; vaultLabel: null };

/** What a build serves: the full site for one vault, or the Security Lab alone. */
export type SiteConfig = AppConfig | LabOnlyConfig;

export class ConfigError extends Error {}

const DEFAULT_EXPLORERS: Record<NetworkId, string | null> = {
  sandbox: null,
  testnet: "https://testnet.nearblocks.io/txns/{hash}",
  mainnet: "https://nearblocks.io/txns/{hash}",
};

// account pages as linked from the NEAR docs (e.g. protocol/accounts-contracts/account-id.mdx)
const DEFAULT_ACCOUNT_EXPLORERS: Record<NetworkId, string | null> = {
  sandbox: null,
  testnet: "https://testnet.nearblocks.io/address/{account}",
  mainnet: "https://nearblocks.io/address/{account}",
};

function isLocalHost(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}

function parseUrl(value: string | undefined, name: string): URL {
  if (!value) throw new ConfigError(`${name} is required`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`${name} is not a valid URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ConfigError(`${name} must be http(s)`);
  }
  return url;
}

type CommonConfig = Omit<AppConfig, "vaultId" | "vaultLabel">;

const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9 ().,_-]{0,39}$/;

function parseLabel(value: string | undefined, name: string): string | null {
  if (!value) return null;
  if (!LABEL_RE.test(value)) throw new ConfigError(`${name} must be 1-40 letters, digits, spaces or ().,_-`);
  return value;
}

/** `VITE_EXTRA_VAULTS=vault.alice.near=P0 vault,old.alice.near`: more vaults on one network, each with an optional label. */
function parseExtraVaults(value: string | undefined, name: string): { vaultId: string; vaultLabel: string | null }[] {
  if (!value) return [];
  return value.split(",").map((entry) => {
    const [id = "", ...rest] = entry.trim().split("=");
    const vault = accountId.safeParse(id.trim());
    if (!vault.success) throw new ConfigError(`${name}: ${JSON.stringify(id)} is not a NEAR account id`);
    return { vaultId: vault.data, vaultLabel: parseLabel(rest.join("=").trim() || undefined, name) };
  });
}

function parseOneClickUrl(value: string | undefined, network: NetworkId): string | null {
  if (!value) return null;
  // a same-origin path: the page's own host proxies 1Click (apps/web/Caddyfile)
  if (/^\/[A-Za-z0-9/_-]*$/.test(value) && !value.startsWith("//")) return value.replace(/\/$/, "");
  const url = parseUrl(value, "VITE_ONECLICK_URL");
  if (url.protocol !== "https:" && !(network === "sandbox" && isLocalHost(url))) {
    throw new ConfigError("VITE_ONECLICK_URL must be a path or an https URL (http only for localhost on sandbox)");
  }
  if (url.search || url.hash) throw new ConfigError("VITE_ONECLICK_URL must not have a query or fragment");
  return url.toString().replace(/\/$/, "");
}

function parseCommon(env: Record<string, string | undefined>): CommonConfig {
  const network = env.VITE_NEAR_NETWORK;
  if (network !== "sandbox" && network !== "testnet" && network !== "mainnet") {
    throw new ConfigError("VITE_NEAR_NETWORK must be sandbox, testnet or mainnet");
  }

  const rpc = parseUrl(env.VITE_NEAR_RPC_URL, "VITE_NEAR_RPC_URL");
  if (network !== "sandbox" && rpc.protocol !== "https:") {
    throw new ConfigError("VITE_NEAR_RPC_URL must use https outside sandbox");
  }

  let devSignerUrl: string | null = null;
  if (env.VITE_DEV_SIGNER_URL) {
    if (network !== "sandbox") {
      throw new ConfigError("VITE_DEV_SIGNER_URL is only allowed with VITE_NEAR_NETWORK=sandbox");
    }
    const url = parseUrl(env.VITE_DEV_SIGNER_URL, "VITE_DEV_SIGNER_URL");
    if (!isLocalHost(url)) throw new ConfigError("VITE_DEV_SIGNER_URL must point at localhost");
    devSignerUrl = url.toString().replace(/\/$/, "");
  }

  const explorerTxUrl = env.VITE_EXPLORER_TX_URL || DEFAULT_EXPLORERS[network];
  if (explorerTxUrl !== null && !explorerTxUrl.includes("{hash}")) {
    throw new ConfigError("VITE_EXPLORER_TX_URL must contain {hash}");
  }

  const explorerAccountUrl = env.VITE_EXPLORER_ACCOUNT_URL || DEFAULT_ACCOUNT_EXPLORERS[network];
  if (explorerAccountUrl !== null && !explorerAccountUrl.includes("{account}")) {
    throw new ConfigError("VITE_EXPLORER_ACCOUNT_URL must contain {account}");
  }

  const securityReportUrl = env.VITE_SECURITY_REPORT_URL || "security-report.json";
  if (/^[a-z][a-z0-9+.-]*:/i.test(securityReportUrl)) {
    const url = parseUrl(securityReportUrl, "VITE_SECURITY_REPORT_URL");
    if (url.protocol !== "https:" && !isLocalHost(url)) throw new ConfigError("VITE_SECURITY_REPORT_URL must use https");
  }

  let repoUrl: string | null = null;
  if (env.VITE_REPO_URL) {
    const url = parseUrl(env.VITE_REPO_URL, "VITE_REPO_URL");
    if (url.protocol !== "https:") throw new ConfigError("VITE_REPO_URL must use https");
    repoUrl = url.toString().replace(/\/$/, "");
  }

  const oneClickUrl = parseOneClickUrl(env.VITE_ONECLICK_URL, network);

  let oneClickSignerKey: string = ONE_CLICK_MANAGER_PUBLIC_KEY;
  if (env.VITE_ONECLICK_SIGNER_KEY) {
    if (network !== "sandbox") throw new ConfigError("VITE_ONECLICK_SIGNER_KEY is only allowed with VITE_NEAR_NETWORK=sandbox");
    if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(env.VITE_ONECLICK_SIGNER_KEY)) throw new ConfigError("VITE_ONECLICK_SIGNER_KEY must be an ed25519: public key");
    oneClickSignerKey = env.VITE_ONECLICK_SIGNER_KEY;
  }

  return { network, rpcUrl: rpc.toString(), explorerTxUrl, explorerAccountUrl, securityReportUrl, devSignerUrl, repoUrl, oneClickUrl, oneClickSignerKey };
}

export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const common = parseCommon(env);
  const vault = accountId.safeParse(env.VITE_VAULT_ID);
  if (!vault.success) throw new ConfigError("VITE_VAULT_ID must be a NEAR account id");
  return { ...common, vaultId: vault.data, vaultLabel: parseLabel(env.VITE_VAULT_LABEL, "VITE_VAULT_LABEL") };
}

/** Like parseConfig, except that an empty VITE_VAULT_ID gives a Security Lab-only site instead of an error. */
export function parseSiteConfig(env: Record<string, string | undefined>): SiteConfig {
  return env.VITE_VAULT_ID ? parseConfig(env) : { ...parseCommon(env), vaultId: null, vaultLabel: null };
}

const EXTRA_NETWORKS = ["mainnet", "testnet"] as const;

/**
 * Every vault this build can show, one config each. The first entry is the main one (VITE_NEAR_NETWORK,
 * VITE_VAULT_ID, VITE_NEAR_RPC_URL), and VITE_EXTRA_VAULTS adds more vaults on the main network. A second
 * public network is added when its own vault is set: VITE_TESTNET_VAULT_ID with VITE_TESTNET_RPC_URL, or
 * VITE_MAINNET_VAULT_ID with VITE_MAINNET_RPC_URL, plus VITE_TESTNET_EXTRA_VAULTS or
 * VITE_MAINNET_EXTRA_VAULTS. Every network's first vault is its default. The others share the main entry's
 * report, repository and 1Click links and use their network's default explorer.
 */
export function parseSiteConfigs(env: Record<string, string | undefined>): SiteConfig[] {
  const main = parseSiteConfig(env);
  const configs: SiteConfig[] = [main];
  const extras = parseExtraVaults(env.VITE_EXTRA_VAULTS, "VITE_EXTRA_VAULTS");
  if (extras.length > 0 && main.vaultId === null) throw new ConfigError("VITE_EXTRA_VAULTS needs a main vault in VITE_VAULT_ID");
  if (main.vaultId !== null) for (const extra of extras) configs.push({ ...main, ...extra });

  for (const network of EXTRA_NETWORKS) {
    const prefix = `VITE_${network.toUpperCase()}`;
    const vaultValue = env[`${prefix}_VAULT_ID`];
    if (!vaultValue) {
      if (env[`${prefix}_EXTRA_VAULTS`]) throw new ConfigError(`${prefix}_EXTRA_VAULTS needs ${prefix}_VAULT_ID`);
      continue;
    }
    if (network === main.network) throw new ConfigError(`${prefix}_VAULT_ID is for the main network; use VITE_VAULT_ID`);
    if (main.vaultId === null) throw new ConfigError(`${prefix}_VAULT_ID needs a main vault in VITE_VAULT_ID`);
    const vault = accountId.safeParse(vaultValue);
    if (!vault.success) throw new ConfigError(`${prefix}_VAULT_ID must be a NEAR account id`);
    const rpc = parseUrl(env[`${prefix}_RPC_URL`], `${prefix}_RPC_URL`);
    if (rpc.protocol !== "https:") throw new ConfigError(`${prefix}_RPC_URL must use https`);
    const base: AppConfig = {
      ...main,
      network,
      vaultId: vault.data,
      vaultLabel: parseLabel(env[`${prefix}_VAULT_LABEL`], `${prefix}_VAULT_LABEL`),
      rpcUrl: rpc.toString(),
      explorerTxUrl: DEFAULT_EXPLORERS[network],
      explorerAccountUrl: DEFAULT_ACCOUNT_EXPLORERS[network],
      devSignerUrl: null,
    };
    configs.push(base);
    for (const extra of parseExtraVaults(env[`${prefix}_EXTRA_VAULTS`], `${prefix}_EXTRA_VAULTS`)) configs.push({ ...base, ...extra });
  }

  const seen = new Set<string>();
  for (const c of configs) {
    if (c.vaultId === null) continue;
    const key = `${c.network}:${c.vaultId}`;
    if (seen.has(key)) throw new ConfigError(`${c.vaultId} is listed twice for ${c.network}`);
    seen.add(key);
  }
  return configs;
}

/** The networks a build serves, main network first, each once. */
export function networksOf(configs: SiteConfig[]): NetworkId[] {
  return [...new Set(configs.map((c) => c.network))];
}

export function explorerAccountLink(config: Pick<AppConfig, "explorerAccountUrl">, account: string): string | null {
  if (!config.explorerAccountUrl || !accountId.safeParse(account).success) return null;
  return config.explorerAccountUrl.replace("{account}", encodeURIComponent(account));
}

export function explorerTxLink(config: Pick<AppConfig, "explorerTxUrl">, txHash: string): string | null {
  if (!config.explorerTxUrl || !/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(txHash)) return null;
  return config.explorerTxUrl.replace("{hash}", txHash);
}
