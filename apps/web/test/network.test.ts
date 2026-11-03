import { describe, expect, it } from "vitest";

import { parseSiteConfigs } from "../src/config.js";
import { chooseConfig, placeLink, placeOf, switchHref, withNetwork } from "../src/network.js";

const configs = parseSiteConfigs({
  VITE_NEAR_NETWORK: "mainnet",
  VITE_NEAR_RPC_URL: "https://rpc.example",
  VITE_VAULT_ID: "vault.owner.near",
  VITE_TESTNET_VAULT_ID: "vault.owner.testnet",
  VITE_TESTNET_RPC_URL: "https://test.rpc.example",
});
const chosen = (search: string) => chooseConfig(configs, search).network;

describe("chooseConfig", () => {
  it("shows the main network unless the link asks for another one", () => {
    expect(chosen("")).toBe("mainnet");
    expect(chosen("?page=overview")).toBe("mainnet");
    expect(chosen("?network=testnet")).toBe("testnet");
    expect(chosen("?network=sandbox")).toBe("mainnet");
  });

  it("opens an approval link on the network of the vault it names", () => {
    expect(chosen("?request=r1&vault=vault.owner.testnet")).toBe("testnet");
    expect(chosen("?request=r1&vault=vault.owner.near")).toBe("mainnet");
    // an unknown vault stays on the main network, where the page then refuses the link
    expect(chosen("?request=r1&vault=evil.near")).toBe("mainnet");
  });

  it("lets an explicit network win, so a link for the other network's vault is refused rather than followed", () => {
    expect(chosen("?network=mainnet&vault=vault.owner.testnet")).toBe("mainnet");
  });
});

describe("links", () => {
  it("keeps internal links on a network that is not the main one", () => {
    expect(withNetwork("?page=overview", "testnet")).toBe("?page=overview&network=testnet");
    expect(withNetwork("./", "testnet")).toBe("./?network=testnet");
    expect(withNetwork("?request=a%3A1", "testnet")).toBe("?request=a%3A1&network=testnet");
    expect(withNetwork("#how", "testnet")).toBe("#how");
    expect(withNetwork("?page=overview", null)).toBe("?page=overview");
  });

  it("switches to the same page on the other network, dropping the request and vault of the old one", () => {
    expect(switchHref("?page=overview", "testnet", "mainnet")).toBe("./?page=overview&network=testnet");
    expect(switchHref("?page=overview&network=testnet", "mainnet", "mainnet")).toBe("./?page=overview");
    expect(switchHref("?request=r1&vault=vault.owner.near", "testnet", "mainnet")).toBe("./?network=testnet");
    expect(switchHref("", "mainnet", "mainnet")).toBe("./");
    expect(switchHref("?page=evil", "testnet", "mainnet")).toBe("./?network=testnet");
  });
});

describe("several vaults on one network", () => {
  const many = parseSiteConfigs({
    VITE_NEAR_NETWORK: "mainnet",
    VITE_NEAR_RPC_URL: "https://rpc.example",
    VITE_VAULT_ID: "vault2.owner.near",
    VITE_EXTRA_VAULTS: "vault.owner.near=P0 vault",
    VITE_TESTNET_VAULT_ID: "vault.owner.testnet",
    VITE_TESTNET_RPC_URL: "https://test.rpc.example",
  });
  const pick = (search: string) => {
    const c = chooseConfig(many, search);
    return `${c.network}:${c.vaultId}`;
  };

  it("opens the vault a link names, and the network's default otherwise", () => {
    expect(pick("")).toBe("mainnet:vault2.owner.near");
    expect(pick("?page=overview&vault=vault.owner.near")).toBe("mainnet:vault.owner.near");
    expect(pick("?request=r1&vault=vault.owner.testnet")).toBe("testnet:vault.owner.testnet");
    expect(pick("?network=mainnet&vault=vault.owner.near")).toBe("mainnet:vault.owner.near");
    // a vault the build does not list: the default config, and the page checks the vault's code itself
    expect(pick("?vault=vault3.owner.near")).toBe("mainnet:vault2.owner.near");
    expect(pick("?network=testnet&vault=vault.owner.near")).toBe("testnet:vault.owner.testnet");
  });

  it("keeps the vault in links unless it is the network's default", () => {
    expect(placeOf(many, "mainnet", "vault2.owner.near")).toEqual({ network: null, vault: null });
    expect(placeOf(many, "mainnet", "vault.owner.near")).toEqual({ network: null, vault: "vault.owner.near" });
    expect(placeOf(many, "testnet", "vault.owner.testnet")).toEqual({ network: "testnet", vault: null });
    expect(placeLink("?page=manage", { network: null, vault: "vault.owner.near" })).toBe("?page=manage&vault=vault.owner.near");
    expect(placeLink("?request=r1&vault=other.near", { network: "testnet", vault: "vault.owner.near" })).toBe("?request=r1&vault=other.near&network=testnet");
    expect(placeLink("./", { network: null, vault: null })).toBe("./");
  });
});
