import { expect, test, type Page } from "@playwright/test";

import { digestInputFromRequest, requestHash, type PaymentRequest } from "@spact/shared";

import { chain, fixture, UNIT } from "./chain.ts";

// The fixture's cross-chain request (P1): 5 TUSD to a stand-in 1Click deposit account on NEAR, for
// a final recipient on Solana. Nothing here talks to 1Click. These tests run in order on one chain:
// the tampering tests leave the request waiting, and the last one approves and pays it.
const f = fixture();
const near = chain(f);
const ID = f.cross_chain_request_id;

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
  expect((await near.request(ID))?.status).toBe("AWAITING_APPROVAL");
});

test("a swapped 1Click deposit address is caught by the browser's hash check", async ({ page }) => {
  await tamper(page, (real) => ({ ...real, recipient: f.mallory_id }));
  await openAndConnect(page);
  await expect(page.getByTestId("recipient")).toHaveText(f.mallory_id); // what the attacker shows
  await expect(page.getByTestId("hash-check")).toHaveAttribute("data-ok", "false");
  await expect(page.getByTestId("approve")).toBeDisabled();
  expect((await near.request(ID))?.status).toBe("AWAITING_APPROVAL");
});

test("a swapped final recipient with a forged matching hash is refused by the vault", async ({ page }) => {
  const before = await near.balance(f.deposit_id);
  await tamper(page, (real) => {
    if (!real.cross_chain) throw new Error("fixture request is not cross-chain");
    const forged = { ...real, cross_chain: { ...real.cross_chain, destination_recipient: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" } };
    return { ...forged, request_hash: requestHash(digestInputFromRequest("sandbox", f.vault_id, forged)) };
  });
  await openAndConnect(page);
  await expect(page.getByTestId("cross-chain-recipient")).toHaveText("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
  await expect(page.getByTestId("hash-check")).toHaveAttribute("data-ok", "true");

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
});
