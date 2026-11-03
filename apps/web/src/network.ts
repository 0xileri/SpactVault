import { createContext, useContext } from "react";

import type { NetworkId, SiteConfig } from "./config.js";

export const NETWORK_LABEL: Record<NetworkId, string> = { sandbox: "Sandbox", testnet: "Testnet", mainnet: "Mainnet" };

const PAGES = new Set(["overview", "security", "legal", "manage", "new-vault", "crosschain"]);

/**
 * Which of the build's vaults this page load shows. `network=` in the URL picks a network by name, and
 * `vault=` picks one of that network's listed vaults. Without `network=`, a `vault=` naming any listed vault
 * picks that vault and its network, so an approval link always opens where its request lives. Anything
 * else gets the network's default vault (its first config), and the main network when nothing matches.
 * A `vault=` that names no listed vault is left for the page to check (App.tsx: UnlistedVault).
 */
export function chooseConfig(configs: SiteConfig[], search: string): SiteConfig {
  const [main] = configs;
  if (!main) throw new Error("no site config");
  const params = new URLSearchParams(search);
  const vault = params.get("vault");
  const network = params.get("network");
  const onNetwork = configs.filter((c) => c.network === network);
  if (onNetwork.length > 0) return onNetwork.find((c) => c.vaultId === vault) ?? (onNetwork[0] as SiteConfig);
  const listed = configs.filter((c) => c.network === main.network).find((c) => c.vaultId === vault) ?? configs.find((c) => c.vaultId === vault);
  return listed ?? main;
}

/** Where a page is: a network other than the main one, and a vault other than that network's default. */
export interface Place {
  network: NetworkId | null;
  vault: string | null;
}

/** An internal link that stays at `place`. A link that already names a vault keeps its own. */
export function placeLink(href: string, place: Place): string {
  if ((place.network === null && place.vault === null) || href.startsWith("#")) return href;
  const [path = "", query = ""] = href.startsWith("?") ? ["", href.slice(1)] : href.split("?");
  const params = new URLSearchParams(query);
  if (place.network !== null) params.set("network", place.network);
  if (place.vault !== null && !params.has("vault")) params.set("vault", place.vault);
  return `${path}?${params.toString()}`;
}

/** An internal link that stays on `network`; null means the main network, which needs no parameter. */
export function withNetwork(href: string, network: NetworkId | null): string {
  return placeLink(href, { network, vault: null });
}

/** The place of `vaultId` on `network`, relative to the build's defaults. */
export function placeOf(configs: SiteConfig[], network: NetworkId, vaultId: string | null): Place {
  const mainNetwork = configs[0]?.network ?? network;
  const networkDefault = configs.find((c) => c.network === network)?.vaultId ?? null;
  return { network: network === mainNetwork ? null : network, vault: vaultId === null || vaultId === networkDefault ? null : vaultId };
}

/**
 * Where the network switch goes: the same page on the other network. A request or vault in the URL
 * belongs to the network being left, so they are dropped.
 */
export function switchHref(search: string, target: NetworkId, mainNetwork: NetworkId): string {
  const page = new URLSearchParams(search).get("page");
  const params = new URLSearchParams();
  if (page !== null && PAGES.has(page)) params.set("page", page);
  if (target !== mainNetwork) params.set("network", target);
  const query = params.toString();
  return query ? `./?${query}` : "./";
}

/** Rewrites internal links so they stay on the network and vault this page shows. */
export const LinkContext = createContext<(href: string) => string>((href) => href);

export function useLink(): (href: string) => string {
  return useContext(LinkContext);
}
