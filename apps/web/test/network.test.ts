import { describe, expect, it } from "vitest";

import { parseSiteConfigs } from "../src/config.js";
import { chooseConfig, switchHref, withNetwork } from "../src/network.js";

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
