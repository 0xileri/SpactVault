import { describe, expect, it } from "vitest";

import { ConfigError, explorerAccountLink, explorerTxLink, parseConfig, parseSiteConfig, parseSiteConfigs } from "../src/config.js";

const BASE = {
  VITE_NEAR_NETWORK: "testnet",
  VITE_NEAR_RPC_URL: "https://rpc.example.org",
  VITE_VAULT_ID: "vault.testnet",
};

describe("parseConfig", () => {
  it("accepts a testnet config and defaults the explorer", () => {
    const cfg = parseConfig(BASE);
    expect(cfg).toMatchObject({ network: "testnet", vaultId: "vault.testnet", devSignerUrl: null });
    expect(explorerTxLink(cfg, "8K4qJ3d5Wq8g5M8gS3o8v8xTqP4mT3o1g7y1J7kq5fX1")).toBe(
      "https://testnet.nearblocks.io/txns/8K4qJ3d5Wq8g5M8gS3o8v8xTqP4mT3o1g7y1J7kq5fX1",
    );
    expect(explorerTxLink(cfg, "not a hash")).toBeNull();
    expect(explorerAccountLink(cfg, "vault.testnet")).toBe("https://testnet.nearblocks.io/address/vault.testnet");
    expect(explorerAccountLink(cfg, "../evil")).toBeNull();
    expect(explorerAccountLink(parseConfig({ ...BASE, VITE_NEAR_NETWORK: "sandbox", VITE_NEAR_RPC_URL: "http://127.0.0.1:3030" }), "vault.testnet")).toBeNull();
    expect(() => parseConfig({ ...BASE, VITE_EXPLORER_ACCOUNT_URL: "https://x.example/a" })).toThrow(/\{account\}/);
    expect(cfg.securityReportUrl).toBe("security-report.json");
    expect(parseConfig({ ...BASE, VITE_SECURITY_REPORT_URL: "https://ci.example/report.json" }).securityReportUrl).toBe("https://ci.example/report.json");
    expect(() => parseConfig({ ...BASE, VITE_SECURITY_REPORT_URL: "http://evil.example/r.json" })).toThrow(/https/);
    expect(() => parseConfig({ ...BASE, VITE_SECURITY_REPORT_URL: "javascript:alert(1)" })).toThrow();
  });

  it("accepts an https repository link, and nothing else", () => {
    expect(parseConfig(BASE).repoUrl).toBeNull();
    expect(parseConfig({ ...BASE, VITE_REPO_URL: "https://github.com/0xileri/Spact/" }).repoUrl).toBe("https://github.com/0xileri/Spact");
    expect(() => parseConfig({ ...BASE, VITE_REPO_URL: "http://github.com/x/y" })).toThrow(/https/);
    expect(() => parseConfig({ ...BASE, VITE_REPO_URL: "javascript:alert(1)" })).toThrow();
  });

  it("refuses the dev signer outside sandbox", () => {
    expect(() => parseConfig({ ...BASE, VITE_DEV_SIGNER_URL: "http://127.0.0.1:8788" })).toThrow(ConfigError);
    expect(() => parseConfig({ ...BASE, VITE_NEAR_NETWORK: "mainnet", VITE_DEV_SIGNER_URL: "http://127.0.0.1:8788" })).toThrow(
      /only allowed/,
    );
  });

  it("requires the dev signer to be on localhost", () => {
    const sandbox = { ...BASE, VITE_NEAR_NETWORK: "sandbox", VITE_NEAR_RPC_URL: "http://127.0.0.1:3030" };
    expect(parseConfig({ ...sandbox, VITE_DEV_SIGNER_URL: "http://127.0.0.1:8788" }).devSignerUrl).toBe("http://127.0.0.1:8788");
    expect(() => parseConfig({ ...sandbox, VITE_DEV_SIGNER_URL: "http://evil.example:8788" })).toThrow(/localhost/);
  });

  it("rejects bad networks, vault ids and insecure RPC outside sandbox", () => {
    expect(() => parseConfig({ ...BASE, VITE_NEAR_NETWORK: "devnet" })).toThrow(ConfigError);
    expect(() => parseConfig({ ...BASE, VITE_VAULT_ID: "Vault.testnet" })).toThrow(ConfigError);
    expect(() => parseConfig({ ...BASE, VITE_NEAR_RPC_URL: "http://rpc.example.org" })).toThrow(/https/);
    expect(() => parseConfig({ ...BASE, VITE_EXPLORER_TX_URL: "https://x.example/tx" })).toThrow(/\{hash\}/);
  });
});

describe("parseSiteConfig", () => {
  it("builds a Security Lab-only site when no vault is set", () => {
    expect(parseSiteConfig({ ...BASE, VITE_VAULT_ID: undefined })).toMatchObject({ vaultId: null, network: "testnet", securityReportUrl: "security-report.json" });
    expect(parseSiteConfig({ ...BASE, VITE_VAULT_ID: "" }).vaultId).toBeNull();
    expect(parseSiteConfig(BASE).vaultId).toBe("vault.testnet");
    // parseConfig itself still requires one
    expect(() => parseConfig({ ...BASE, VITE_VAULT_ID: "" })).toThrow(/VITE_VAULT_ID/);
  });

  it("treats a malformed vault id as an error, not as no vault, and still checks everything else", () => {
    expect(() => parseSiteConfig({ ...BASE, VITE_VAULT_ID: "Vault.testnet" })).toThrow(ConfigError);
    expect(() => parseSiteConfig({ ...BASE, VITE_VAULT_ID: "", VITE_NEAR_NETWORK: "devnet" })).toThrow(ConfigError);
    expect(() => parseSiteConfig({ ...BASE, VITE_VAULT_ID: "", VITE_NEAR_RPC_URL: "http://rpc.example.org" })).toThrow(/https/);
    expect(() => parseSiteConfig({ ...BASE, VITE_VAULT_ID: "", VITE_SECURITY_REPORT_URL: "http://evil.example/r.json" })).toThrow(/https/);
    expect(() => parseSiteConfig({ ...BASE, VITE_VAULT_ID: "", VITE_DEV_SIGNER_URL: "http://127.0.0.1:8788" })).toThrow(/only allowed/);
  });
});

describe("parseSiteConfigs", () => {
  const MAINNET = { ...BASE, VITE_NEAR_NETWORK: "mainnet", VITE_VAULT_ID: "vault.owner.near", VITE_REPO_URL: "https://example.test/repo" };

  it("is just the main network when no second vault is set", () => {
    expect(parseSiteConfigs(MAINNET).map((c) => c.network)).toEqual(["mainnet"]);
  });

  it("adds testnet next to mainnet, with its own vault, RPC and explorer", () => {
    const [main, test] = parseSiteConfigs({ ...MAINNET, VITE_TESTNET_VAULT_ID: "vault.owner.testnet", VITE_TESTNET_RPC_URL: "https://test.rpc.example" });
    expect(main).toMatchObject({ network: "mainnet", vaultId: "vault.owner.near" });
    expect(test).toMatchObject({
      network: "testnet",
      vaultId: "vault.owner.testnet",
      rpcUrl: "https://test.rpc.example/",
      explorerTxUrl: "https://testnet.nearblocks.io/txns/{hash}",
      repoUrl: "https://example.test/repo",
      devSignerUrl: null,
    });
  });

  it("refuses a second vault that is unclear, unsafe or has nothing to sit next to", () => {
    const testnet = { VITE_TESTNET_VAULT_ID: "vault.owner.testnet", VITE_TESTNET_RPC_URL: "https://test.rpc.example" };
    expect(() => parseSiteConfigs({ ...MAINNET, VITE_TESTNET_VAULT_ID: "vault.owner.testnet" })).toThrow(/VITE_TESTNET_RPC_URL is required/);
    expect(() => parseSiteConfigs({ ...MAINNET, ...testnet, VITE_TESTNET_RPC_URL: "http://test.rpc.example" })).toThrow(/https/);
    expect(() => parseSiteConfigs({ ...MAINNET, ...testnet, VITE_TESTNET_VAULT_ID: "Not An Account" })).toThrow(/account id/);
    expect(() => parseSiteConfigs({ ...MAINNET, VITE_MAINNET_VAULT_ID: "other.near", VITE_MAINNET_RPC_URL: "https://rpc.example" })).toThrow(/main network/);
    expect(() => parseSiteConfigs({ ...MAINNET, ...testnet, VITE_VAULT_ID: "" })).toThrow(/needs a main vault/);
  });
});

describe("more than one vault per network", () => {
  const MAINNET = { ...BASE, VITE_NEAR_NETWORK: "mainnet", VITE_VAULT_ID: "vault2.owner.near", VITE_VAULT_LABEL: "P1 vault" };

  it("lists extra vaults after the default, with their labels, and each network once", () => {
    const configs = parseSiteConfigs({
      ...MAINNET,
      VITE_EXTRA_VAULTS: "vault.owner.near=P0 vault (direct only), old.owner.near",
      VITE_TESTNET_VAULT_ID: "vault.owner.testnet",
      VITE_TESTNET_RPC_URL: "https://test.rpc.example",
    });
    expect(configs.map((c) => [c.network, c.vaultId, c.vaultLabel])).toEqual([
      ["mainnet", "vault2.owner.near", "P1 vault"],
      ["mainnet", "vault.owner.near", "P0 vault (direct only)"],
      ["mainnet", "old.owner.near", null],
      ["testnet", "vault.owner.testnet", null],
    ]);
    expect(configs[1]).toMatchObject({ rpcUrl: "https://rpc.example.org/", explorerTxUrl: "https://nearblocks.io/txns/{hash}" });
  });

  it("refuses extra vaults that are malformed, listed twice, unlabeled safely or without a default", () => {
    expect(() => parseSiteConfigs({ ...MAINNET, VITE_EXTRA_VAULTS: "Vault.near" })).toThrow(/account id/);
    expect(() => parseSiteConfigs({ ...MAINNET, VITE_EXTRA_VAULTS: "vault2.owner.near" })).toThrow(/listed twice/);
    expect(() => parseSiteConfigs({ ...MAINNET, VITE_EXTRA_VAULTS: "vault.owner.near=<script>" })).toThrow(/letters/);
    expect(() => parseSiteConfigs({ ...MAINNET, VITE_VAULT_ID: "", VITE_EXTRA_VAULTS: "vault.owner.near" })).toThrow(/needs a main vault/);
    expect(() => parseSiteConfigs({ ...MAINNET, VITE_TESTNET_EXTRA_VAULTS: "x.testnet" })).toThrow(/needs VITE_TESTNET_VAULT_ID/);
  });
});

describe("1Click URL", () => {
  it("accepts a same-origin path or an https URL, and http only for a local sandbox", () => {
    expect(parseConfig(BASE).oneClickUrl).toBeNull();
    expect(parseConfig({ ...BASE, VITE_ONECLICK_URL: "/1click/" }).oneClickUrl).toBe("/1click");
    expect(parseConfig({ ...BASE, VITE_ONECLICK_URL: "https://1click.chaindefuser.com" }).oneClickUrl).toBe("https://1click.chaindefuser.com");
    expect(() => parseConfig({ ...BASE, VITE_ONECLICK_URL: "http://1click.example" })).toThrow(/https/);
    expect(() => parseConfig({ ...BASE, VITE_ONECLICK_URL: "//evil.example/1click" })).toThrow();
    expect(() => parseConfig({ ...BASE, VITE_ONECLICK_URL: "https://1click.example/?jwt=x" })).toThrow(/query/);
    const sandbox = { ...BASE, VITE_NEAR_NETWORK: "sandbox", VITE_NEAR_RPC_URL: "http://127.0.0.1:3030" };
    expect(parseConfig({ ...sandbox, VITE_ONECLICK_URL: "http://127.0.0.1:8797" }).oneClickUrl).toBe("http://127.0.0.1:8797");
  });
});


describe("1Click signer key", () => {
  it("is 1Click's own manager key, and only a local sandbox may use another", () => {
    expect(parseConfig(BASE).oneClickSignerKey).toBe("ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc");
    const mock = "ed25519:9Q3HteLhC8T2gBVNWETCZh5uR8svhy4Ze7oFL5mgAyjt";
    expect(() => parseConfig({ ...BASE, VITE_ONECLICK_SIGNER_KEY: mock })).toThrow(/only allowed/);
    expect(() => parseConfig({ ...BASE, VITE_NEAR_NETWORK: "mainnet", VITE_ONECLICK_SIGNER_KEY: mock })).toThrow(/only allowed/);
    const sandbox = { ...BASE, VITE_NEAR_NETWORK: "sandbox", VITE_NEAR_RPC_URL: "http://127.0.0.1:3030" };
    expect(parseConfig({ ...sandbox, VITE_ONECLICK_SIGNER_KEY: mock }).oneClickSignerKey).toBe(mock);
    expect(() => parseConfig({ ...sandbox, VITE_ONECLICK_SIGNER_KEY: "not-a-key" })).toThrow(/ed25519/);
  });
});
