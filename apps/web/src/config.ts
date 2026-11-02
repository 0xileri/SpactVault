import { accountId } from "@spact/shared";

export type NetworkId = "sandbox" | "testnet" | "mainnet";

export interface AppConfig {
  network: NetworkId;
  rpcUrl: string;
  /** The only vault this deployment approves payments for. */
  vaultId: string;
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
}

/** A build without a vault yet: only the Security Lab works. */
export type LabOnlyConfig = Omit<AppConfig, "vaultId"> & { vaultId: null };

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

function parseCommon(env: Record<string, string | undefined>): Omit<AppConfig, "vaultId"> {
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

  return { network, rpcUrl: rpc.toString(), explorerTxUrl, explorerAccountUrl, securityReportUrl, devSignerUrl, repoUrl };
}

export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const common = parseCommon(env);
  const vault = accountId.safeParse(env.VITE_VAULT_ID);
  if (!vault.success) throw new ConfigError("VITE_VAULT_ID must be a NEAR account id");
  return { ...common, vaultId: vault.data };
}

/** Like parseConfig, except that an empty VITE_VAULT_ID gives a Security Lab-only site instead of an error. */
export function parseSiteConfig(env: Record<string, string | undefined>): SiteConfig {
  return env.VITE_VAULT_ID ? parseConfig(env) : { ...parseCommon(env), vaultId: null };
}

const EXTRA_NETWORKS = ["mainnet", "testnet"] as const;

/**
 * Every network this build can show. The first entry is the main one (VITE_NEAR_NETWORK, VITE_VAULT_ID,
 * VITE_NEAR_RPC_URL). A second public network is added when its own vault is set: VITE_TESTNET_VAULT_ID
 * with VITE_TESTNET_RPC_URL, or VITE_MAINNET_VAULT_ID with VITE_MAINNET_RPC_URL. It shares the main
 * entry's report and repository links and uses its network's default explorer.
 */
export function parseSiteConfigs(env: Record<string, string | undefined>): SiteConfig[] {
  const main = parseSiteConfig(env);
  const configs: SiteConfig[] = [main];
  for (const network of EXTRA_NETWORKS) {
    const prefix = `VITE_${network.toUpperCase()}`;
    const vaultValue = env[`${prefix}_VAULT_ID`];
    if (!vaultValue) continue;
    if (network === main.network) throw new ConfigError(`${prefix}_VAULT_ID is for the main network; use VITE_VAULT_ID`);
    if (main.vaultId === null) throw new ConfigError(`${prefix}_VAULT_ID needs a main vault in VITE_VAULT_ID`);
    const vault = accountId.safeParse(vaultValue);
    if (!vault.success) throw new ConfigError(`${prefix}_VAULT_ID must be a NEAR account id`);
    const rpc = parseUrl(env[`${prefix}_RPC_URL`], `${prefix}_RPC_URL`);
    if (rpc.protocol !== "https:") throw new ConfigError(`${prefix}_RPC_URL must use https`);
    configs.push({
      ...main,
      network,
      vaultId: vault.data,
      rpcUrl: rpc.toString(),
      explorerTxUrl: DEFAULT_EXPLORERS[network],
      explorerAccountUrl: DEFAULT_ACCOUNT_EXPLORERS[network],
      devSignerUrl: null,
    });
  }
  return configs;
}

export function explorerAccountLink(config: Pick<AppConfig, "explorerAccountUrl">, account: string): string | null {
  if (!config.explorerAccountUrl || !accountId.safeParse(account).success) return null;
  return config.explorerAccountUrl.replace("{account}", encodeURIComponent(account));
}

export function explorerTxLink(config: AppConfig, txHash: string): string | null {
  if (!config.explorerTxUrl || !/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(txHash)) return null;
  return config.explorerTxUrl.replace("{hash}", txHash);
}
