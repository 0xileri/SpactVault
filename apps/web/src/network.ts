import { createContext, useContext } from "react";

import type { NetworkId, SiteConfig } from "./config.js";

export const NETWORK_LABEL: Record<NetworkId, string> = { sandbox: "Sandbox", testnet: "Testnet", mainnet: "Mainnet" };

const PAGES = new Set(["overview", "security", "legal"]);

/**
 * Which of the build's networks this page load shows. `network=` in the URL picks one by name. Without it,
 * a `vault=` naming one of the configured vaults picks that vault's network, so an approval link always
 * opens where its request lives. Anything else gets the main network (the first config).
 */
export function chooseConfig(configs: SiteConfig[], search: string): SiteConfig {
  const [main] = configs;
  if (!main) throw new Error("no site config");
  const params = new URLSearchParams(search);
  const byName = configs.find((c) => c.network === params.get("network"));
  if (byName) return byName;
  const vault = params.get("vault");
  return (vault !== null && configs.find((c) => c.vaultId === vault)) || main;
}

/** An internal link that stays on `network`; null means the main network, which needs no parameter. */
export function withNetwork(href: string, network: NetworkId | null): string {
  if (network === null || href.startsWith("#")) return href;
  const [path = "", query = ""] = href.startsWith("?") ? ["", href.slice(1)] : href.split("?");
  const params = new URLSearchParams(query);
  params.set("network", network);
  return `${path}?${params.toString()}`;
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

/** Rewrites internal links so they stay on the network this page shows. */
export const LinkContext = createContext<(href: string) => string>((href) => href);

export function useLink(): (href: string) => string {
  return useContext(LinkContext);
}
