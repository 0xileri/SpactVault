import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";
import { Account, actions as nearActions, JsonRpcProvider, teraToGas, type KeyPairString } from "near-api-js";

import { P1_BUILD } from "../src/contracts.ts";
import { fixture, UNIT } from "./chain.ts";

// Every owner flow, the way the owner does it on the website, against the local sandbox: the dev signer
// stands in for the wallet (it signs only what these pages send, dev/dev-signer.ts), and everything else
// is the real page talking to the real local chain. The tests run in order and build on each other:
// create vault2, fund it, change its rules, pause it, manage agents, then give the agent a key and pay with it.
// Then the other ways: an any-wallet agent, a named vault finished after a reload, and an any-wallet vault
// (the wallet only sends NEAR, ADR-035), finished or cancelled.
test.describe.configure({ mode: "serial" });

const f = fixture();
const provider = new JsonRpcProvider({ url: f.rpc_url });
const VAULT2 = `vault2.${f.owner_id}`;
const AGENT2 = `agent2.${f.owner_id}`;
const SOL_USDC = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const SOL_PAYEE = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

/** Everything the page sends anywhere: URLs and bodies, to prove no secret key leaves it. */
function recordTraffic(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (r) => seen.push(`${r.url()} ${r.postData() ?? ""}`));
  return seen;
}

async function connect(page: Page) {
  await page.getByTestId("connect").click();
  await expect(page.getByTestId("wallet")).toContainText(f.owner_id);
}

async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction({ contractId, method, args })) as unknown as T;
}

interface StoredDeploy {
  vaultId: string;
  key: { secretKey: string; publicKey: string };
  init: Record<string, unknown>;
}

/** The setup the review screen saved in this tab's sessionStorage, once it has saved it. */
async function storedDeploy(page: Page): Promise<StoredDeploy> {
  const read = () => page.evaluate(() => sessionStorage.getItem("spactvault.pending-deploy"));
  await expect.poll(read).not.toBeNull();
  return JSON.parse((await read()) ?? "{}") as StoredDeploy;
}

/** Total gas a transaction and its receipts burnt, read from the RPC. */
async function gasBurnt(txHash: string, sender: string): Promise<number> {
  const res = await fetch(f.rpc_url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tx", params: { tx_hash: txHash, sender_account_id: sender, wait_until: "FINAL" } }),
  });
  const body = (await res.json()) as { result: { transaction_outcome: { outcome: { gas_burnt: number } }; receipts_outcome: { outcome: { gas_burnt: number } }[] } };
  return body.result.receipts_outcome.reduce((sum, r) => sum + r.outcome.gas_burnt, body.result.transaction_outcome.outcome.gas_burnt);
}

const keyCount = async (accountId: string) => (await provider.viewAccessKeyList({ accountId })).keys.length;

async function clickSign(page: Page) {
  const button = page.getByTestId("sign");
  await expect(button).toBeEnabled();
  await button.click();
}

/** Signs a change on the Manage page and waits until its section says it is on chain. */
async function sign(page: Page) {
  await clickSign(page);
  await expect(page.getByText("Confirmed on chain")).toBeVisible({ timeout: 60_000 });
}

test("create a named vault: the wallet creates it with the published code and a key that can only call new; the tab starts it", async ({ page }) => {
  const traffic = recordTraffic(page);
  await page.goto("/?page=new-vault");
  await connect(page);
  await page.getByTestId("vault-name").fill("vault2");
  await page.getByTestId("vault-agents").fill(AGENT2);
  await page.getByTestId("vault-recipients").fill(f.api_id);
  await expect(page.getByTestId("vault-token")).toHaveValue(f.token_id);
  await page.getByTestId("review-vault").click();

  // step 1: what the wallet signs. No full-access key: Meteor refuses to add one for a website.
  const actions = page.getByTestId("review-actions");
  await expect(actions).toContainText(`Create the account ${VAULT2}`);
  await expect(actions).toContainText(`Send 3.2 NEAR to ${VAULT2}`);
  await expect(actions).toContainText(`Install ${P1_BUILD.bytes?.toLocaleString("en-US")} bytes of contract code on ${VAULT2}`);
  await expect(actions).toContainText(`a key that can only call new on ${VAULT2}, with at most 0.05 NEAR of gas`);
  await expect(page.getByTestId("review-json")).not.toContainText("FullAccess");
  await expect(page.getByTestId("wallet-refused-hint")).toBeVisible();
  const pending = await storedDeploy(page);
  expect(pending.key.secretKey).toMatch(/^ed25519:/);
  await clickSign(page);

  // step 2: this tab calls new with that key
  await expect(page.getByTestId("create-tx")).toBeVisible({ timeout: 60_000 });
  expect((await provider.viewAccount({ accountId: VAULT2 })).code_hash).toBe(P1_BUILD.codeHash);
  await expect(page.getByTestId("expected-code-hash")).toHaveText(P1_BUILD.codeHash);
  await expect(page.getByTestId("install-details")).toContainText(f.owner_id);
  await expect(page.getByTestId("cancel-deploy")).toHaveCount(0);
  await page.getByTestId("install").click();
  await expect(page.getByTestId("deploy-result")).toHaveAttribute("data-ok", "true", { timeout: 60_000 });
  await expect(page.getByTestId("deploy-checks")).toContainText(`matches the published build (${P1_BUILD.codeHash})`);
  await expect(page.getByTestId("deploy-checks")).toContainText("No full-access key");

  // `new` burns far less than the 30 Tgas the init key attaches, so the 0.05 NEAR allowance has room
  const initTx = (await page.getByTestId("install-tx").getAttribute("data-hash")) ?? "";
  expect(await gasBurnt(initTx, VAULT2)).toBeLessThan(15_000_000_000_000);

  // on chain: the published code, the owner's settings, and only the spent init key
  const account = await provider.viewAccount({ accountId: VAULT2 });
  expect(account.code_hash).toBe(P1_BUILD.codeHash);
  const keys = await provider.viewAccessKeyList({ accountId: VAULT2 });
  expect(keys.keys).toHaveLength(1);
  expect(keys.keys[0]?.public_key).toBe(pending.key.publicKey);
  expect(keys.keys[0]?.access_key.permission).toMatchObject({ FunctionCall: { receiver_id: VAULT2, method_names: ["new"] } });
  const cfg = await view<{ owner: string; agents: string[]; network: string }>(VAULT2, "get_config");
  expect(cfg).toMatchObject({ owner: f.owner_id, agents: [AGENT2], network: "sandbox" });
  expect(await page.evaluate(() => sessionStorage.getItem("spactvault.pending-deploy"))).toBeNull();

  // the leftover key is spent: it cannot start the vault again with another owner, or install other code
  const leftover = new Account(VAULT2, provider, pending.key.secretKey as KeyPairString);
  await expect(
    leftover.callFunction({ contractId: VAULT2, methodName: "new", args: { ...pending.init, owner: f.mallory_id }, gas: teraToGas("100") }),
  ).rejects.toThrow();
  await expect(leftover.signAndSendTransaction({ receiverId: VAULT2, actions: [nearActions.deployContract(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))] })).rejects.toThrow();
  expect((await view<{ owner: string }>(VAULT2, "get_config")).owner).toBe(f.owner_id);
  expect((await provider.viewAccount({ accountId: VAULT2 })).code_hash).toBe(P1_BUILD.codeHash);

  // the setup secret never left the tab: only signatures made with it did
  expect(traffic.some((t) => t.includes(pending.key.secretKey.slice("ed25519:".length)))).toBe(false);
});

test("a vault this site does not list opens only because it runs the published code and is locked", async ({ page }) => {
  await page.goto(`/?page=overview&vault=${VAULT2}`);
  await expect(page.getByTestId("unlisted-vault")).toContainText("verified P1 code, locked");
  await expect(page.getByTestId("environment")).toContainText(VAULT2);
  // the token contract is a real account with other code: refused
  await page.goto(`/?page=overview&vault=${f.token_id}`);
  await expect(page.getByText("This link is for a different vault")).toBeVisible();
  await expect(page.getByText("is not a SpactVault build this site knows")).toBeVisible();
});

test("fund the vault: it is registered with the token first, then the tokens move with ft_transfer", async ({ page }) => {
  await page.goto(`/?page=manage&vault=${VAULT2}`);
  await connect(page);
  await expect(page.getByTestId("manage")).toContainText("vault not registered with this token yet");
  await page.getByTestId("open-fund").click();
  await page.getByTestId("fund-amount").fill("10");
  await page.getByTestId("review-fund").click();
  await expect(page.getByTestId("review-actions")).toContainText(`Call storage_deposit on ${f.token_id}`);
  await expect(page.getByTestId("review-actions")).toContainText(`Call ft_transfer on ${f.token_id}`);
  await expect(page.getByTestId("review-json")).not.toContainText("ft_transfer_call");
  await sign(page);
  expect(BigInt(await view<string>(f.token_id, "ft_balance_of", { account_id: VAULT2 }))).toBe(10n * UNIT);
  await expect(page.getByTestId(`manage-balance-${f.token_id}`)).toHaveText("10 TUSD");
});

test("change the rules: the review says what changes, and the vault gets the new version", async ({ page }) => {
  await page.goto(`/?page=manage&vault=${VAULT2}`);
  await connect(page);
  await page.getByTestId("open-rules").click();
  await page.getByTestId("rules-auto-0").fill("2");
  await page.getByTestId("review-rules").click();
  await expect(page.getByTestId("review-changes")).toContainText("TUSD instant limit: 1 TUSD → 2 TUSD.");
  await expect(page.getByTestId("review-changes")).toContainText("Rules become version 2.");
  await sign(page);
  const p = await view<{ tokens: { auto_limit: string }[] }>(VAULT2, "get_policy");
  expect(p.tokens[0]?.auto_limit).toBe("2000000");
  expect((await view<{ policy_version: number }>(VAULT2, "get_config")).policy_version).toBe(2);
});

test("rules the vault would refuse cannot be signed", async ({ page }) => {
  await page.goto(`/?page=manage&vault=${VAULT2}`);
  await connect(page);
  await page.getByTestId("open-rules").click();
  await page.getByTestId("rules-auto-0").fill("4");
  await page.getByTestId("review-rules").click();
  await expect(page.getByText("The vault would refuse these rules")).toBeVisible();
  await expect(page.getByTestId("sign")).toBeDisabled();
});

test("pause and unpause", async ({ page }) => {
  await page.goto(`/?page=manage&vault=${VAULT2}`);
  await connect(page);
  await expect(page.getByTestId("paused-state")).toHaveAttribute("data-paused", "false");
  await page.getByTestId("open-pause").click();
  await sign(page);
  await expect(page.getByTestId("paused-state")).toHaveAttribute("data-paused", "true");
  expect((await view<{ paused: boolean }>(VAULT2, "get_config")).paused).toBe(true);
  await page.getByTestId("open-pause").click();
  await sign(page);
  await expect(page.getByTestId("paused-state")).toHaveAttribute("data-paused", "false");
  expect((await view<{ paused: boolean }>(VAULT2, "get_config")).paused).toBe(false);
});

test("add and remove an agent", async ({ page }) => {
  await page.goto(`/?page=manage&vault=${VAULT2}`);
  await connect(page);
  await page.getByTestId("open-add-agent").click();
  await page.getByTestId("add-agent-id").fill(f.owner_id);
  await expect(page.getByText("must not be the owner")).toBeVisible();
  await page.getByTestId("add-agent-id").fill(f.mallory_id);
  await page.getByTestId("review-add-agent").click();
  await sign(page);
  expect((await view<{ agents: string[] }>(VAULT2, "get_config")).agents).toEqual([AGENT2, f.mallory_id]);
  await expect(page.getByTestId("agent-list")).toContainText(f.mallory_id);
  await page.getByTestId(`remove-agent-${f.mallory_id}`).click();
  await sign(page);
  expect((await view<{ agents: string[] }>(VAULT2, "get_config")).agents).toEqual([AGENT2]);
});

test("allow a cross-chain recipient from a 1Click price (mock 1Click)", async ({ page }) => {
  await page.goto(`/?page=crosschain&vault=${VAULT2}`);
  await connect(page);
  await expect(page.getByTestId("xc-destination")).toHaveValue(SOL_USDC);
  await page.getByTestId("xc-recipient").fill(SOL_PAYEE);
  await page.getByTestId("xc-price").click();
  await expect(page.getByTestId("xc-in")).toHaveText("1 TUSD");
  await expect(page.getByTestId("xc-out")).toHaveText("0.99 USDC on Solana");
  await expect(page.getByTestId("xc-min-out")).toHaveText("0.9801 USDC");
  await expect(page.getByTestId("xc-fee")).toContainText("about $0.01");
  // like the live API, the mock adds a 1 basis point app fee nobody asked for, and the page says so
  await expect(page.getByTestId("xc-app-fee")).toContainText("1 basis point");
  await page.getByTestId("xc-allow").click();
  await expect(page.getByTestId("review-changes")).toContainText(`Allows cross-chain payments to sol (${SOL_USDC}) for ${SOL_PAYEE}.`);
  await clickSign(page);
  await expect(page.getByTestId("xc-allowed")).toBeVisible({ timeout: 60_000 });
  const p = await view<{ cross_chain: { destination_chain: string; recipients: string[] }[] }>(VAULT2, "get_policy");
  expect(p.cross_chain).toEqual([{ token: f.token_id, destination_chain: "sol", destination_asset: SOL_USDC, recipients: [SOL_PAYEE] }]);
});

test("agent key: made in the browser, saved once, put on a new agent account that can only call the agent methods", async ({ page }) => {
  const traffic = recordTraffic(page);
  await page.goto(`/?page=manage&vault=${VAULT2}`);
  await connect(page);
  await page.getByTestId("open-agent-key").click();
  await page.getByTestId("agent-name").fill("agent2");
  await page.getByTestId("make-agent-key").click();

  // the key file is downloaded before anything is signed, and the page forgets the secret
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-key").click()]);
  expect(download.suggestedFilename()).toBe(`${AGENT2}.json`);
  const file = JSON.parse(readFileSync((await download.path()) ?? "", "utf8")) as { account_id: string; public_key: string; private_key: string };
  expect(file.account_id).toBe(AGENT2);
  expect(file.private_key).toMatch(/^ed25519:/);
  await expect(page.getByTestId("download-key")).toHaveCount(0);

  await expect(page.getByTestId("review-actions")).toContainText(`Create the account ${AGENT2}`);
  await expect(page.getByTestId("review-actions")).toContainText(`can only call request_direct_payment, request_cross_chain_payment, execute_request on ${VAULT2}`);
  await expect(page.getByTestId("review-json")).toContainText(file.public_key);
  await clickSign(page);
  // agent2 was named when the vault was created, so no add_agent step is needed
  await expect(page.getByTestId("agent-ready")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("agent-env")).toContainText(`SPACT_AGENT_ID=${AGENT2}`);
  await expect(page.getByTestId("agent-env")).not.toContainText(file.private_key);

  // on chain: one key, function-call only, for the three methods on vault2
  const keys = await provider.viewAccessKeyList({ accountId: AGENT2 });
  expect(keys.keys).toHaveLength(1);
  expect(keys.keys[0]?.public_key).toBe(file.public_key);
  expect(keys.keys[0]?.access_key.permission).toEqual({
    FunctionCall: { allowance: "250000000000000000000000", receiver_id: VAULT2, method_names: ["request_direct_payment", "request_cross_chain_payment", "execute_request"] },
  });

  // the private key went to the download only: no request the page made carried it
  expect(traffic.some((t) => t.includes(file.private_key.slice("ed25519:".length)))).toBe(false);

  // and it works: the agent pays within the new instant limit with exactly that key
  const agent = new Account(AGENT2, provider, file.private_key as KeyPairString);
  const before = BigInt(await view<string>(f.token_id, "ft_balance_of", { account_id: f.api_id }));
  await agent.callFunction({
    contractId: VAULT2,
    methodName: "request_direct_payment",
    args: { request_id: "agent2-first", token: f.token_id, amount: (2n * UNIT).toString(), recipient: f.api_id, reason: "First payment with the browser-made key" },
    gas: teraToGas("100"),
  });
  expect((await view<{ status: string }>(VAULT2, "get_request", { request_id: "agent2-first" })).status).toBe("SETTLED");
  expect(BigInt(await view<string>(f.token_id, "ft_balance_of", { account_id: f.api_id }))).toBe(before + 2n * UNIT);
});

test("agent key, any wallet: the wallet only sends NEAR, the tab swaps in the restricted key, and a reload in between is fine", async ({ page }) => {
  const traffic = recordTraffic(page);
  await page.goto(`/?page=manage&vault=${VAULT2}`);
  await connect(page);
  await page.getByTestId("open-agent-key").click();
  await page.getByTestId("agent-mode-any-wallet").check();
  await expect(page.getByTestId("agent-name")).toHaveCount(0);
  await page.getByTestId("make-agent-key").click();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-key").click()]);
  const file = JSON.parse(readFileSync((await download.path()) ?? "", "utf8")) as { account_id: string; public_key: string; private_key: string };
  const agentId = file.account_id;
  expect(agentId).toMatch(/^[0-9a-f]{64}$/);
  expect(download.suggestedFilename()).toBe(`${agentId}.json`);

  // the wallet is asked for one plain transfer, nothing else
  await expect(page.getByTestId("review-actions").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("review-actions")).toContainText(`Send 0.3 NEAR to ${agentId}`);
  await clickSign(page);
  await expect(page.getByTestId("agent-swap")).toBeVisible({ timeout: 60_000 });
  expect(await keyCount(agentId)).toBe(1); // the tab's temporary key

  // a reload (or a wallet that redirects) keeps the temporary key in this tab, so the swap is offered again
  await page.reload();
  await connect(page);
  await page.getByTestId("open-agent-key").click();
  await expect(page.getByTestId("agent-swap")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("agent-swap-json")).toContainText(file.public_key);
  await page.getByTestId("swap-key").click();

  // not an agent of vault2 yet, so the owner adds it
  await expect(page.getByTestId("review-actions")).toContainText(`Call add_agent on ${VAULT2}`, { timeout: 60_000 });
  await clickSign(page);
  await expect(page.getByTestId("agent-ready")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("agent-env")).toContainText(`SPACT_AGENT_ID=${agentId}`);
  expect(await page.evaluate(() => sessionStorage.getItem("spactvault.pending-agent"))).toBeNull();

  // on chain: exactly the restricted key, and the agent is on the vault
  const keys = await provider.viewAccessKeyList({ accountId: agentId });
  expect(keys.keys).toHaveLength(1);
  expect(keys.keys[0]?.public_key).toBe(file.public_key);
  expect(keys.keys[0]?.access_key.permission).toEqual({
    FunctionCall: { allowance: "250000000000000000000000", receiver_id: VAULT2, method_names: ["request_direct_payment", "request_cross_chain_payment", "execute_request"] },
  });
  expect((await view<{ agents: string[] }>(VAULT2, "get_config")).agents).toEqual([AGENT2, agentId]);
  expect(traffic.some((t) => t.includes(file.private_key.slice("ed25519:".length)))).toBe(false);

  // and the key works
  const agent = new Account(agentId, provider, file.private_key as KeyPairString);
  await agent.callFunction({
    contractId: VAULT2,
    methodName: "request_direct_payment",
    args: { request_id: "implicit-first", token: f.token_id, amount: UNIT.toString(), recipient: f.api_id, reason: "First payment from the any-wallet agent" },
    gas: teraToGas("100"),
  });
  expect((await view<{ status: string }>(VAULT2, "get_request", { request_id: "implicit-first" })).status).toBe("SETTLED");
});

test("named vault: a reload between the two steps picks the setup up again and finishes it", async ({ page }) => {
  const vault3 = `vault3.${f.owner_id}`;
  await page.goto("/?page=new-vault");
  await connect(page);
  await page.getByTestId("vault-name").fill("vault3");
  await page.getByTestId("vault-recipients").fill(f.api_id);
  await page.getByTestId("review-vault").click();
  await clickSign(page);
  await expect(page.getByTestId("create-tx")).toBeVisible({ timeout: 60_000 });

  // a reload (or a wallet that redirects) does not lose the setup key: the page offers step 2 again
  await page.reload();
  await expect(page.getByText(`${vault3} exists and still has this tab's setup key.`)).toBeVisible();
  await page.getByTestId("install").click();
  await expect(page.getByTestId("deploy-result")).toHaveAttribute("data-ok", "true", { timeout: 60_000 });
  expect((await view<{ owner: string }>(vault3, "get_config")).owner).toBe(f.owner_id);
  expect(await page.evaluate(() => sessionStorage.getItem("spactvault.pending-deploy"))).toBeNull();
});

test("any-wallet vault: the wallet only sends NEAR; the tab installs, starts and locks it, leaving no keys", async ({ page }) => {
  const traffic = recordTraffic(page);
  await page.goto("/?page=new-vault");
  await connect(page);
  await page.getByTestId("mode-any-wallet").check();
  await expect(page.getByTestId("vault-name")).toHaveCount(0);
  await page.getByTestId("vault-recipients").fill(f.api_id);
  await page.getByTestId("review-vault").click();
  const pending = await storedDeploy(page);
  expect(pending.vaultId).toMatch(/^[0-9a-f]{64}$/);
  await expect(page.getByTestId("review-actions").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("review-actions")).toContainText(`Send 3.2 NEAR to ${pending.vaultId}`);
  await clickSign(page);
  await expect(page.getByTestId("create-tx")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("install").click();
  await expect(page.getByTestId("deploy-result")).toHaveAttribute("data-ok", "true", { timeout: 60_000 });
  await expect(page.getByTestId("deploy-checks")).toContainText("No access keys");
  expect((await provider.viewAccount({ accountId: pending.vaultId })).code_hash).toBe(P1_BUILD.codeHash);
  expect(await keyCount(pending.vaultId)).toBe(0);
  expect((await view<{ owner: string; vault_id: string }>(pending.vaultId, "get_config")).vault_id).toBe(pending.vaultId);
  expect(traffic.some((t) => t.includes(pending.key.secretKey.slice("ed25519:".length)))).toBe(false);
  // and the site opens it as a locked vault it does not list
  await page.goto(`/?page=overview&vault=${pending.vaultId}`);
  await expect(page.getByTestId("unlisted-vault")).toContainText("verified P1 code, locked");
});

test("any-wallet vault: a reload keeps the setup, and Cancel deletes the account and gives the NEAR back", async ({ page }) => {
  await page.goto("/?page=new-vault");
  await connect(page);
  await page.getByTestId("mode-any-wallet").check();
  await page.getByTestId("vault-recipients").fill(f.api_id);
  await page.getByTestId("review-vault").click();
  const { vaultId } = await storedDeploy(page);
  await clickSign(page);
  await expect(page.getByTestId("create-tx")).toBeVisible({ timeout: 60_000 });
  expect(BigInt((await provider.viewAccount({ accountId: vaultId })).amount)).toBeGreaterThan(3n * 10n ** 24n);

  await page.reload();
  await expect(page.getByText(`${vaultId} exists and still has this tab's setup key.`)).toBeVisible();
  const before = BigInt((await provider.viewAccount({ accountId: f.owner_id })).amount);
  await page.getByTestId("cancel-deploy").click();
  await expect(page.getByText(`${vaultId} was deleted`)).toBeVisible({ timeout: 60_000 });
  await expect(provider.viewAccount({ accountId: vaultId })).rejects.toThrow();
  const after = BigInt((await provider.viewAccount({ accountId: f.owner_id })).amount);
  expect(after - before).toBeGreaterThan(3n * 10n ** 24n);
  expect(await page.evaluate(() => sessionStorage.getItem("spactvault.pending-deploy"))).toBeNull();
});

test("the owner pages fit a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/?page=new-vault", `/?page=manage&vault=${VAULT2}`, `/?page=crosschain&vault=${VAULT2}`]) {
    await page.goto(path);
    await expect(page.getByTestId("owner-tabs")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
