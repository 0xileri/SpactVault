import { expect, test, type Page } from "@playwright/test";

import { digestInputFromRequest, requestHash, type PaymentRequest } from "@spact/shared";

import { chain, fixture, UNIT } from "./chain.ts";

// The fixture's cross-chain request (P1): 5 TUSD to a stand-in 1Click deposit account on NEAR, for
// a final recipient on Solana. "1Click" here is the MOCK 1Click server (e2e/mock-oneclick.ts), which answers
// from the local chain like an honest 1Click and can be told to lie. These tests run in order on one chain:
// the tampering tests leave the request waiting, and the last one approves and pays it.
const f = fixture();
const near = chain(f);
const ID = f.cross_chain_request_id;
const MOCK = process.env.SPACT_MOCK_ONECLICK ?? "";

/**
 * Makes the mock 1Click's record of the fixture's deposit address say something else: signed again by the mock
 * 1Click (1Click itself says it), or with `resign: false`, left with a signature that no longer matches
 * (someone between the page and 1Click says it).
 */
async function oneClickSays(patch: Record<string, unknown>, resign = true) {
  await fetch(`${MOCK}/__mock/override`, { method: "POST", body: JSON.stringify({ depositAddress: f.deposit_id, patch, resign }) });
}

test.afterEach(async () => {
  await fetch(`${MOCK}/__mock/override`, { method: "DELETE" });
});

/** Rewrites what the RPC says about the cross-chain request on its way to the page. */
async function tamper(page: Page, forge: (real: PaymentRequest) => PaymentRequest) {
  const rpcOrigin = new URL(f.rpc_url).origin;
  await page.route(
    (url) => url.origin === rpcOrigin,
    async (route) => {
      const body = route.request().postDataJSON() as { method?: string; params?: { method_name?: string; args_base64?: string } } | null;
      if (body?.method !== "query" || body.params?.method_name !== "get_request") return route.continue();
      const args = JSON.parse(Buffer.from(body.params.args_base64 ?? "", "base64").toString("utf8")) as { request_id?: string };
      if (args.request_id !== ID) return route.continue();
      const response = await route.fetch();
      const json = (await response.json()) as { result: { result: number[] } };
      const real = JSON.parse(Buffer.from(json.result.result).toString("utf8")) as PaymentRequest;
      json.result.result = Array.from(Buffer.from(JSON.stringify(forge(real))));
      await route.fulfill({ response, json });
    },
  );
}

async function openAndConnect(page: Page) {
  await page.goto(`/?request=${ID}`);
  await expect(page.getByTestId("amount")).toBeVisible();
  await page.getByTestId("connect").click();
  await expect(page.getByTestId("wallet")).toContainText(f.owner_id);
}

test("a cross-chain request shows the 1Click deposit address and the final recipient apart, and waits for the owner", async ({ page }) => {
  await page.goto(`/?request=${ID}`);
  await expect(page.getByTestId("amount")).toHaveText("5 TUSD");
  await expect(page.getByTestId("cross-chain-recipient")).toHaveText(f.cross_chain_payee);
  await expect(page.getByTestId("cross-chain-chain")).toHaveText("sol");
  await expect(page.getByTestId("recipient")).toHaveText(f.deposit_id);
  await expect(page.getByTestId("cross-chain-refund")).toHaveText(f.vault_id);
  await expect(page.getByTestId("cross-chain-trust")).toContainText("cannot see delivery on sol");
  await expect(page.getByTestId("why-waiting")).toContainText("cross-chain payments always do, whatever the amount");
  await expect(page.getByTestId("hash-check")).toHaveAttribute("data-ok", "true");
  await expect(page.getByTestId("oneclick")).toHaveAttribute("data-state", "verified");
  await expect(page.getByTestId("oneclick")).toContainText("1Click confirms this deposit address");
  await expect(page.getByTestId("oneclick-signed")).toContainText("Signed by 1Click");
  await expect(page.getByTestId("oneclick-terms")).toContainText(`pays ${f.cross_chain_payee} on Solana at least 4.9 USDC`);
  expect((await near.request(ID))?.status).toBe("AWAITING_APPROVAL");
});

test("approve stays off while 1Click cannot be asked about the deposit address", async ({ page }) => {
  await page.route((url) => url.href.startsWith(MOCK), (route) => route.abort());
  await openAndConnect(page);
  await expect(page.getByTestId("oneclick")).toHaveAttribute("data-state", "error");
  await expect(page.getByTestId("problems")).toContainText("Could not check the deposit address with 1Click");
  await expect(page.getByTestId("approve")).toBeDisabled();
});

test("a deposit address 1Click knows for another payee is refused before the wallet is asked (T14)", async ({ page }) => {
  await oneClickSays({ quoteResponse: { quoteRequest: { recipient: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" } } });
  await openAndConnect(page);
  await expect(page.getByTestId("oneclick")).toHaveAttribute("data-state", "mismatch");
  await expect(page.getByTestId("oneclick")).toContainText(`final recipient: 1Click has 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin, the vault request has ${f.cross_chain_payee}`);
  await expect(page.getByTestId("approve")).toBeDisabled();
  await expect(page.getByTestId("reject")).toBeEnabled();
});

test("a matching 1Click record without 1Click's signature is refused: a forger between the page and 1Click", async ({ page }) => {
  // the terms still match the request; only a display field changed, which the signature covers
  await oneClickSays({ quoteResponse: { quote: { amountOutFormatted: "4.999" } } }, false);
  await openAndConnect(page);
  await expect(page.getByTestId("oneclick")).toHaveAttribute("data-state", "mismatch");
  await expect(page.getByTestId("oneclick")).toContainText("signature on this quote does not verify");
  await expect(page.getByTestId("approve")).toBeDisabled();
});

test("an unregistered deposit address must be registered with the token before approving", async ({ page }) => {
  const rpcOrigin = new URL(f.rpc_url).origin;
  await page.route(
    (url) => url.origin === rpcOrigin,
    async (route) => {
      const body = route.request().postDataJSON() as { params?: { method_name?: string; args_base64?: string } } | null;
      if (body?.params?.method_name !== "storage_balance_of") return route.continue();
      const args = JSON.parse(Buffer.from(body.params.args_base64 ?? "", "base64").toString("utf8")) as { account_id?: string };
      if (args.account_id !== f.deposit_id) return route.continue();
      const response = await route.fetch();
      const json = (await response.json()) as { result: { result: number[] } };
      json.result.result = Array.from(Buffer.from("null"));
      await route.fulfill({ response, json });
    },
  );
  await openAndConnect(page);
  await expect(page.getByTestId("problems")).toContainText("not registered with the token yet");
  await expect(page.getByTestId("approve")).toBeDisabled();
  await page.getByTestId("register-deposit").click();
  await expect(page.getByTestId("review-actions")).toContainText(`Call storage_deposit on ${f.token_id}`);
  await expect(page.getByTestId("review-json")).toContainText(f.deposit_id);
});

test("a swapped 1Click deposit address is caught by the browser's hash check", async ({ page }) => {
  await tamper(page, (real) => ({ ...real, recipient: f.mallory_id }));
  await openAndConnect(page);
  await expect(page.getByTestId("recipient")).toHaveText(f.mallory_id); // what the attacker shows
  await expect(page.getByTestId("hash-check")).toHaveAttribute("data-ok", "false");
  await expect(page.getByTestId("approve")).toBeDisabled();
  expect((await near.request(ID))?.status).toBe("AWAITING_APPROVAL");
});

function forgeRecipient(real: PaymentRequest): PaymentRequest {
  if (!real.cross_chain) throw new Error("fixture request is not cross-chain");
  const forged = { ...real, cross_chain: { ...real.cross_chain, destination_recipient: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" } };
  return { ...forged, request_hash: requestHash(digestInputFromRequest("sandbox", f.vault_id, forged)) };
}

test("a swapped final recipient with a forged matching hash is caught by 1Click's own record", async ({ page }) => {
  await tamper(page, forgeRecipient);
  await openAndConnect(page);
  await expect(page.getByTestId("cross-chain-recipient")).toHaveText("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
  await expect(page.getByTestId("hash-check")).toHaveAttribute("data-ok", "true");
  await expect(page.getByTestId("oneclick")).toHaveAttribute("data-state", "mismatch");
  await expect(page.getByTestId("approve")).toBeDisabled();
});

test("even if the RPC and 1Click both lie the same way, the vault refuses the forged terms", async ({ page }) => {
  const before = await near.balance(f.deposit_id);
  await tamper(page, forgeRecipient);
  await oneClickSays({ quoteResponse: { quoteRequest: { recipient: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" } } });
  await openAndConnect(page);
  await expect(page.getByTestId("cross-chain-recipient")).toHaveText("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
  await expect(page.getByTestId("hash-check")).toHaveAttribute("data-ok", "true");
  await expect(page.getByTestId("oneclick")).toHaveAttribute("data-state", "verified");

  // The owner signs the hash of what they saw; the vault compares it with what it stored.
  await page.getByTestId("approve").click();
  await expect(page.getByTestId("phase")).toHaveAttribute("data-phase", "failed", { timeout: 60_000 });
  await expect(page.getByTestId("phase")).toContainText("HASH_MISMATCH");
  expect((await near.request(ID))?.status).toBe("AWAITING_APPROVAL");
  expect(await near.balance(f.deposit_id)).toBe(before);
});

test("the owner approves the exact route, and the vault pays only the 1Click deposit address", async ({ page }) => {
  const before = await near.balance(f.deposit_id);
  await openAndConnect(page);
  await page.getByTestId("approve").click();
  await expect(page.getByTestId("phase")).toHaveAttribute("data-phase", "done", { timeout: 60_000 });
  await expect(page.getByTestId("phase")).toContainText("sent to the 1Click deposit address");
  await expect(page.getByTestId("request-status")).toHaveAttribute("data-status", "CROSS_CHAIN_PENDING");
  await expect(page.getByTestId("outcome")).toContainText("Delivery on sol is up to 1Click");

  expect((await near.request(ID))?.status).toBe("CROSS_CHAIN_PENDING");
  expect(await near.balance(f.deposit_id)).toBe(before + 5n * UNIT);

  // then the page follows 1Click: its report, with a Solana link this page built from the hash alone
  await expect(page.getByTestId("oneclick-status")).toHaveText("Delivered, says 1Click", { timeout: 30_000 });
  const sol = page.getByTestId("tx-sol");
  await expect(sol).toHaveAttribute("href", /^https:\/\/solscan\.io\/tx\/[1-9A-HJ-NP-Za-km-z]{80,90}$/);
  await expect(page.locator('a[href^="https://evil.example"]')).toHaveCount(0);
  await expect(page.getByTestId("oneclick-tracker")).toContainText("1Click's report, not something the vault checked");
});
