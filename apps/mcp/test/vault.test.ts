import { KeyPair } from "near-api-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { McpConfig } from "../src/config.js";
import { createVaultClient } from "../src/vault.js";

const pair = KeyPair.fromRandom("ed25519");
const key = { accountId: "agent.test.near", publicKey: pair.getPublicKey().toString(), privateKey: pair.toString() };
const config: McpConfig = {
  network: "sandbox",
  rpcUrl: "http://127.0.0.1:3030",
  vaultId: "vault.test.near",
  agentId: "agent.test.near",
  agentKeyFile: "/unused",
  approvalUrl: null,
  explorerTxUrl: null,
  oneClick: null,
  quoteDir: null,
};

const fcKey = {
  FunctionCall: { allowance: "1", receiver_id: "vault.test.near", method_names: ["request_direct_payment", "execute_request"] },
};
const vaultConfig = {
  vault_id: "vault.test.near",
  owner: "owner.test.near",
  network: "sandbox",
  agents: ["agent.test.near"],
  paused: false,
  policy_version: 1,
  open_approvals: 0,
  request_count: 0,
};

/** Answers view_access_key and get_config the way a node would. */
function mockChain(permission: unknown, vault: object) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const { params } = JSON.parse(init.body as string) as { params: { request_type: string } };
      const result =
        params.request_type === "view_access_key"
          ? { nonce: 1, permission }
          : { result: Array.from(new TextEncoder().encode(JSON.stringify(vault))), logs: [] };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: "x", result }));
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("preflight", () => {
  it("passes for the agent's function-call key on a matching vault", async () => {
    mockChain(fcKey, vaultConfig);
    await expect(createVaultClient(config, key).preflight()).resolves.toBeUndefined();
  });

  it("fails for a full-access key, another network, or a removed agent", async () => {
    mockChain("FullAccess", vaultConfig);
    await expect(createVaultClient(config, key).preflight()).rejects.toThrow(/full-access/);
    mockChain(fcKey, { ...vaultConfig, network: "testnet" });
    await expect(createVaultClient(config, key).preflight()).rejects.toThrow(/network "testnet", not "sandbox"/);
    mockChain(fcKey, { ...vaultConfig, agents: ["other.test.near"] });
    await expect(createVaultClient(config, key).preflight()).rejects.toThrow(/not an agent/);
  });
});
