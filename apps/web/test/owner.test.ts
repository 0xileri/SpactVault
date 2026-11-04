import type { Policy } from "@spact/shared";
import { describe, expect, it } from "vitest";

import { policyOf, withRoute } from "../src/components/owner/RulesEditor.js";
import { lockProblem, P1_BUILD } from "../src/contracts.js";
import {
  AGENT_METHODS,
  agentKeyFile,
  agentProblem,
  createAgentActions,
  createVaultAccountActions,
  describeActions,
  formatNear,
  fundActions,
  fundImplicitActions,
  implicitAccountId,
  INIT_KEY_ALLOWANCE,
  NAMED_INIT_GAS,
  OwnerInputError,
  parseNear,
  policyChanges,
  policyProblems,
  setPausedActions,
  setPolicyActions,
  subAccountId,
  vaultStorageNeeded,
  withdrawActions,
  YOCTO_PER_NEAR,
} from "../src/owner/actions.js";
import { checkDeployed, type VaultInspection } from "../src/owner/deploy.js";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const VAULT = "vault2.alice.near";
const SOL_USDC = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const PAYEE = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
const USDC_LIMITS = { token: USDC, auto_limit: "1000000", hard_tx_limit: "3000000", daily_limit: "5000000" };
const policy: Policy = {
  tokens: [USDC_LIMITS],
  recipients: ["api.alice.near"],
  max_open_approvals: 3,
  max_requests_per_day: 20,
  approval_ttl_sec: 86400,
  cross_chain: [],
};
const meta = (t: string) => (t === USDC ? { decimals: 6, symbol: "USDC" } : null);

describe("amounts and names", () => {
  it("converts NEAR exactly, without floating point", () => {
    expect(parseNear("3.2")).toBe(3_200_000_000_000_000_000_000_000n);
    expect(parseNear("0.000000000000000000000001")).toBe(1n);
    expect(() => parseNear("1e3")).toThrow(OwnerInputError);
    expect(() => parseNear("-1")).toThrow(OwnerInputError);
    expect(formatNear(3_200_000_000_000_000_000_000_000n)).toBe("3.2");
    expect(formatNear(12_500_000_000_000_000_000n, 5)).toBe("0.00001");
  });

  it("only makes direct sub-accounts with valid names", () => {
    expect(subAccountId("vault2", "alice.near")).toBe(VAULT);
    expect(() => subAccountId("Vault2", "alice.near")).toThrow(/lowercase/);
    expect(() => subAccountId("a.b", "alice.near")).toThrow(/no dots/);
    expect(() => subAccountId("x".repeat(60), "alice.near")).toThrow(/64 characters/);
  });

  it("asks for enough NEAR to store the vault code", () => {
    const needed = vaultStorageNeeded(P1_BUILD.bytes ?? 0);
    expect(needed).toBe(274_238n * 10n ** 19n + YOCTO_PER_NEAR / 20n);
    expect(formatNear(needed)).toBe("2.7923");
  });
});

describe("transactions the owner signs", () => {
  const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

  it("creates a named vault with its code and an init key that can only call new, never a full-access key", () => {
    const actions = createVaultAccountActions(VAULT, parseNear("3.2"), wasm, "ed25519:Temp1111111111111111111111111111111111111111");
    expect(actions).toEqual([
      { type: "CreateAccount" },
      { type: "Transfer", params: { deposit: "3200000000000000000000000" } },
      { type: "DeployContract", params: { code: wasm } },
      {
        type: "AddKey",
        params: {
          publicKey: "ed25519:Temp1111111111111111111111111111111111111111",
          accessKey: { permission: { receiverId: VAULT, allowance: "50000000000000000000000", methodNames: ["new"] } },
        },
      },
    ]);
    expect(INIT_KEY_ALLOWANCE).toBe(YOCTO_PER_NEAR / 20n);
    // the allowance must cover all the gas `new` attaches, priced at the sandbox's 10^9 yocto per gas with room for the
    // transaction's own conversion cost (mainnet's floor is 10^8)
    expect(NAMED_INIT_GAS * 10n ** 9n * 3n / 2n).toBeLessThan(INIT_KEY_ALLOWANCE);
    expect(JSON.stringify(actions, (_, v: unknown) => (v instanceof Uint8Array ? "<code>" : v))).not.toContain("FullAccess");
  });

  it("asks the wallet for nothing but a transfer on the any-wallet path", async () => {
    expect(fundImplicitActions(parseNear("3.2"))).toEqual([{ type: "Transfer", params: { deposit: "3200000000000000000000000" } }]);
    // the implicit account of a key is the hex of its 32 bytes (all-zero key -> 64 zeros)
    expect(await implicitAccountId("ed25519:11111111111111111111111111111111")).toBe("0".repeat(64));
  });

  it("gives the agent a key for the three agent methods on this vault only, with a gas allowance", () => {
    expect(AGENT_METHODS).toEqual(["request_direct_payment", "request_cross_chain_payment", "execute_request"]);
    const [, , addKey] = createAgentActions(VAULT, parseNear("0.3"), "ed25519:Agent", parseNear("0.25"));
    expect(addKey).toEqual({
      type: "AddKey",
      params: {
        publicKey: "ed25519:Agent",
        accessKey: { permission: { receiverId: VAULT, allowance: "250000000000000000000000", methodNames: [...AGENT_METHODS] } },
      },
    });
  });

  it("funds with storage_deposit then ft_transfer, never ft_transfer_call", () => {
    const actions = fundActions(VAULT, 3_000_000n, 1_250_000_000_000_000_000_000n);
    expect(actions.map((a) => (a.type === "FunctionCall" ? [a.params.methodName, a.params.deposit] : a.type))).toEqual([
      ["storage_deposit", "1250000000000000000000"],
      ["ft_transfer", "1"],
    ]);
    expect(actions[1]).toMatchObject({ params: { args: { receiver_id: VAULT, amount: "3000000" } } });
    expect(fundActions(VAULT, 1n, null)).toHaveLength(1);
    expect(() => fundActions(VAULT, 0n, null)).toThrow(OwnerInputError);
    expect(JSON.stringify(actions)).not.toContain("ft_transfer_call");
  });

  it("takes tokens out with owner_withdraw to the account given, and refuses zero", () => {
    expect(withdrawActions(USDC, 2_500_000n, "alice.near")).toEqual([
      {
        type: "FunctionCall",
        params: { methodName: "owner_withdraw", args: { token: USDC, amount: "2500000", receiver_id: "alice.near" }, gas: "30000000000000", deposit: "1" },
      },
    ]);
    expect(() => withdrawActions(USDC, 0n, "alice.near")).toThrow(OwnerInputError);
  });

  it("attaches exactly 1 yoctoNEAR to owner calls, so only a full-access key can sign them", () => {
    for (const a of [...setPolicyActions(policy), ...setPausedActions(true), ...withdrawActions(USDC, 1n, "alice.near")]) {
      expect(a).toMatchObject({ type: "FunctionCall", params: { deposit: "1" } });
    }
    expect(setPolicyActions(policy)[0]).toMatchObject({ params: { methodName: "set_policy", args: { policy } } });
  });

  it("describes each action in words for the review screen", () => {
    const lines = describeActions(VAULT, createVaultAccountActions(VAULT, parseNear("3.2"), wasm, "ed25519:TempKeyTempKeyTempKey"));
    expect(lines.map((l) => l.summary)).toEqual([
      `Create the account ${VAULT}`,
      `Send 3.2 NEAR to ${VAULT}`,
      `Install 8 bytes of contract code on ${VAULT}`,
      `Give ${VAULT} a key that can only call new on ${VAULT}, with at most 0.05 NEAR of gas`,
    ]);
    // the review shows the code's size, not 274 kB of numbers
    expect(lines[2]?.detail).toEqual({ type: "DeployContract", params: { code: "<8 bytes, checked against the published build>" } });
    expect(describeActions(VAULT, setPausedActions(true))[0]?.summary).toBe(`Call set_paused on ${VAULT} (with 1 yoctoNEAR, so only a full-access key can sign it)`);
  });

  it("writes the key file in the format the MCP server reads", () => {
    expect(JSON.parse(agentKeyFile("agent2.alice.near", "ed25519:Pub", "ed25519:Secret"))).toEqual({
      account_id: "agent2.alice.near",
      public_key: "ed25519:Pub",
      private_key: "ed25519:Secret",
    });
  });
});

describe("rules", () => {
  it("finds what the vault would refuse before anything is signed", () => {
    expect(policyProblems(policy, VAULT)).toEqual([]);
    const bad: Policy = {
      ...policy,
      tokens: [{ token: USDC, auto_limit: "4000000", hard_tx_limit: "3000000", daily_limit: "2000000" }],
      recipients: [VAULT, "api.alice.near", "api.alice.near"],
      approval_ttl_sec: 30,
      cross_chain: [{ token: "other.near", destination_chain: "Sol!", destination_asset: SOL_USDC, recipients: [] }],
    };
    const problems = policyProblems(bad, VAULT).join(" | ");
    expect(problems).toMatch(/instant limit must not be above the per-payment cap/);
    expect(problems).toMatch(/per-payment cap must not be above the daily limit/);
    expect(problems).toMatch(/cannot pay itself/);
    expect(problems).toMatch(/listed twice/);
    expect(problems).toMatch(/between 1 minute and 7 days/);
    expect(problems).toMatch(/not one of the vault's tokens/);
    expect(problems).toMatch(/not a chain name/);
    expect(problems).toMatch(/needs 1 to 8 recipients/);
  });

  it("says what a new policy changes, in plain words", () => {
    const after = withRoute({ ...policy, tokens: [{ ...USDC_LIMITS, auto_limit: "2000000" }], recipients: [] }, {
      token: USDC,
      destination_chain: "sol",
      destination_asset: SOL_USDC,
      recipients: [PAYEE],
    });
    expect(policyChanges(policy, after, meta)).toEqual([
      "USDC instant limit: 1 USDC → 2 USDC.",
      "No longer allows paying api.alice.near.",
      `Allows cross-chain payments to sol (${SOL_USDC}) for ${PAYEE}.`,
    ]);
    expect(policyChanges(policy, policy, meta)).toEqual([]);
  });

  it("adds a cross-chain recipient to an existing route instead of a second route", () => {
    const one = withRoute(policy, { token: USDC, destination_chain: "sol", destination_asset: SOL_USDC, recipients: [PAYEE] });
    const two = withRoute(one, { token: USDC, destination_chain: "sol", destination_asset: SOL_USDC, recipients: ["9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", PAYEE] });
    expect(two.cross_chain).toHaveLength(1);
    expect(two.cross_chain[0]?.recipients).toEqual([PAYEE, "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"]);
  });

  it("converts the form in display units to base units exactly", () => {
    const p = policyOf(
      { tokens: [{ token: USDC, auto: "1.5", cap: "3", daily: "5" }], recipients: "api.alice.near\n", maxOpen: "3", perDay: "20", ttlHours: "0.5", routes: [] },
      meta,
    );
    expect(p.tokens[0]).toEqual({ token: USDC, auto_limit: "1500000", hard_tx_limit: "3000000", daily_limit: "5000000" });
    expect(p.approval_ttl_sec).toBe(1800);
    expect(() => policyOf({ tokens: [{ token: USDC, auto: "1.0000001", cap: "3", daily: "5" }], recipients: "", maxOpen: "3", perDay: "20", ttlHours: "1", routes: [] }, meta)).toThrow(/at most 6 decimals/);
  });

  it("refuses agents the vault would refuse", () => {
    expect(agentProblem("agent2.alice.near", "alice.near", VAULT, [])).toBeNull();
    expect(agentProblem("alice.near", "alice.near", VAULT, [])).toMatch(/not be the owner/);
    expect(agentProblem(VAULT, "alice.near", VAULT, [])).toMatch(/not be the vault/);
    expect(agentProblem("a.near", "alice.near", VAULT, ["a.near"])).toMatch(/already/);
  });
});

describe("after the deploy", () => {
  const init = { owner: "alice.near", agents: ["agent2.alice.near"], network: "mainnet", policy };
  const account = { amount: "1", locked: "0", codeHash: P1_BUILD.codeHash, storageUsage: 280_000 };
  const config = { vault_id: VAULT, owner: "alice.near", network: "mainnet", agents: ["agent2.alice.near"], paused: false, policy_version: 1, open_approvals: 0, request_count: 0 };
  const good: VaultInspection = { account, keys: [], build: P1_BUILD, config };

  it("passes only with the published code, no keys left and the owner's settings", () => {
    expect(checkDeployed(good, { build: P1_BUILD, init, vaultId: VAULT }).ok).toBe(true);
    const keyLeft = checkDeployed({ ...good, keys: [{ publicKey: "ed25519:x", permission: { kind: "FullAccess" } }] }, { build: P1_BUILD, init, vaultId: VAULT });
    expect(keyLeft.ok).toBe(false);
    expect(keyLeft.lines.find((l) => !l.ok)?.text).toMatch(/1 full-access key/);
    const otherCode = checkDeployed({ ...good, account: { ...account, codeHash: "11111111111111111111111111111111" } }, { build: P1_BUILD, init, vaultId: VAULT });
    expect(otherCode.ok).toBe(false);
    const otherOwner = checkDeployed({ ...good, config: { ...config, owner: "mallory.near" } }, { build: P1_BUILD, init, vaultId: VAULT });
    expect(otherOwner.ok).toBe(false);
  });

  const initKey = { publicKey: "ed25519:init", permission: { kind: "FunctionCall" as const, receiverId: VAULT, methodNames: ["new"], allowance: "1" } };

  it("accepts the spent init key of a named vault, and nothing more", () => {
    const named = checkDeployed({ ...good, keys: [initKey] }, { build: P1_BUILD, init, vaultId: VAULT });
    expect(named.ok).toBe(true);
    expect(named.lines.map((l) => l.text)).toContain(
      "No full-access key: nobody can change its code. One spent setup key is left; it can only call `new`, which the vault now refuses",
    );
    const fc = (receiverId: string, methodNames: string[]) => ({ publicKey: "ed25519:k", permission: { kind: "FunctionCall" as const, receiverId, methodNames, allowance: null } });
    for (const extra of [
      { publicKey: "ed25519:full", permission: { kind: "FullAccess" as const } },
      fc(VAULT, []), // an empty method list allows every method
      fc(VAULT, ["new", "set_policy"]),
      fc(VAULT, ["set_policy"]),
      fc("other.near", ["new"]),
      { publicKey: "ed25519:gas", permission: { kind: "Other" as const, name: "GasKeyFullAccess" } },
    ]) {
      expect(checkDeployed({ ...good, keys: [initKey, extra] }, { build: P1_BUILD, init, vaultId: VAULT }).ok).toBe(false);
    }
  });
});

describe("lockProblem", () => {
  it("calls a vault locked only with no keys or only init keys", () => {
    expect(lockProblem([], VAULT)).toBeNull();
    expect(lockProblem([{ permission: { kind: "FunctionCall", receiverId: VAULT, methodNames: ["new"] } }], VAULT)).toBeNull();
    expect(lockProblem([{ permission: { kind: "FullAccess" } }], VAULT)).toMatch(/1 full-access key/);
    expect(lockProblem([{ permission: { kind: "FunctionCall", receiverId: VAULT, methodNames: [] } }], VAULT)).toMatch(/1 access key/);
    expect(lockProblem([{ permission: { kind: "FunctionCall", receiverId: "x.near", methodNames: ["new"] } }], VAULT)).toMatch(/1 access key/);
  });
});
