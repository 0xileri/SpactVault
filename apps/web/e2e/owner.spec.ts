import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";
import { Account, JsonRpcProvider, teraToGas, type KeyPairString } from "near-api-js";

import { P1_BUILD } from "../src/contracts.ts";
import { fixture, UNIT } from "./chain.ts";

// Every owner flow, the way the owner does it on the website, against the local sandbox: the dev signer
// stands in for the wallet (it signs only what these pages send, dev/dev-signer.ts), and everything else
// is the real page talking to the real local chain. The tests run in order and build on each other:
// create vault2, fund it, change its rules, pause it, manage agents, then give the agent a key and pay with it.
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

test("create a vault from the website: the wallet creates the account, the tab installs the published code and locks it", async ({ page }) => {
  const traffic = recordTraffic(page);
  await page.goto("/?page=new-vault");
  await connect(page);
  await page.getByTestId("vault-name").fill("vault2");
  await page.getByTestId("vault-agents").fill(AGENT2);
  await page.getByTestId("vault-recipients").fill(f.api_id);
  await expect(page.getByTestId("vault-token")).toHaveValue(f.token_id);
  await page.getByTestId("review-vault").click();

  // step 1: what the wallet signs, with the temporary key that only this tab has
  const actions = page.getByTestId("review-actions");
  await expect(actions).toContainText(`Create the account ${VAULT2}`);
  await expect(actions).toContainText(`Send 3.2 NEAR to ${VAULT2}`);
  await expect(actions).toContainText("temporary full-access key");
  const pending = JSON.parse((await page.evaluate(() => sessionStorage.getItem("spactvault.pending-deploy"))) ?? "{}") as { key: { secretKey: string; publicKey: string } };
  expect(pending.key.secretKey).toMatch(/^ed25519:/);
  await clickSign(page);

  // step 2: this tab installs the exact published build, then deletes the key
  await expect(page.getByTestId("create-tx")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("expected-code-hash")).toHaveText(P1_BUILD.codeHash);
  await expect(page.getByTestId("install-details")).toContainText(f.owner_id);
  await page.getByTestId("install").click();
  await expect(page.getByTestId("deploy-result")).toHaveAttribute("data-ok", "true", { timeout: 60_000 });
  await expect(page.getByTestId("deploy-checks")).toContainText(`matches the published build (${P1_BUILD.codeHash})`);
  await expect(page.getByTestId("deploy-checks")).toContainText("No access keys");

  // on chain: the published code, no keys, the owner's settings
  const account = await provider.viewAccount({ accountId: VAULT2 });
  expect(account.code_hash).toBe(P1_BUILD.codeHash);
  const keys = await provider.viewAccessKeyList({ accountId: VAULT2 });
  expect(keys.keys).toHaveLength(0);
  const cfg = await view<{ owner: string; agents: string[]; network: string }>(VAULT2, "get_config");
  expect(cfg).toMatchObject({ owner: f.owner_id, agents: [AGENT2], network: "sandbox" });
  expect(await page.evaluate(() => sessionStorage.getItem("spactvault.pending-deploy"))).toBeNull();

  // the temporary secret never left the tab: only signatures made with it did
  expect(traffic.some((t) => t.includes(pending.key.secretKey.slice("ed25519:".length)))).toBe(false);
});

test("a vault this site does not list opens only because it runs the published code and has no keys", async ({ page }) => {
  await page.goto(`/?page=overview&vault=${VAULT2}`);
  await expect(page.getByTestId("unlisted-vault")).toContainText("verified P1 code, no keys");
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
  await expect(page.getByTestId("xc-fee")).toHaveText("about $0.01");
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

test("a reload between the two steps picks the setup up again, and Cancel gives the NEAR back", async ({ page }) => {
  const vault3 = `vault3.${f.owner_id}`;
  await page.goto("/?page=new-vault");
  await connect(page);
  await page.getByTestId("vault-name").fill("vault3");
  await page.getByTestId("vault-recipients").fill(f.api_id);
  await page.getByTestId("review-vault").click();
  await clickSign(page);
  await expect(page.getByTestId("create-tx")).toBeVisible({ timeout: 60_000 });
  const funded = BigInt((await provider.viewAccount({ accountId: vault3 })).amount);
  expect(funded).toBeGreaterThan(3n * 10n ** 24n);

  // a reload (or a wallet that redirects) does not lose the temporary key: the page offers step 2 again
  await page.reload();
  await expect(page.getByText(`${vault3} exists and still has this tab's temporary key.`)).toBeVisible();
  const before = BigInt((await provider.viewAccount({ accountId: f.owner_id })).amount);
  await page.getByTestId("cancel-deploy").click();
  await expect(page.getByText(`${vault3} was deleted`)).toBeVisible({ timeout: 60_000 });
  await expect(provider.viewAccount({ accountId: vault3 })).rejects.toThrow();
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
