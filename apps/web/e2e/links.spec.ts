import { expect, test } from "@playwright/test";

import { fixture } from "./chain.ts";

// Every NEAR account id and transaction hash the site shows links to the explorer. The dev server is built with
// VITE_EXPLORER_TX_URL / VITE_EXPLORER_ACCOUNT_URL as plain base URLs (e2e/global-setup.ts), the way the Railway
// settings write them; the page appends the hash or account. Addresses on other chains link to that chain's
// explorer (packages/intents explorer.ts). Nothing here loads an explorer page.
const f = fixture();
const account = (id: string) => `https://explorer.test/address/${id}`;

test("the vault, its owner and agents, and every payee link to the explorer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("live-explorer")).toHaveAttribute("href", account(f.vault_id));

  await page.goto("/?page=overview");
  await expect(page.getByTestId("vault-explorer")).toHaveAttribute("href", account(f.vault_id));
  const dashboard = page.getByTestId("dashboard");
  await expect(dashboard.locator(`a[href="${account(f.agent_id)}"]`).first()).toBeVisible();
  await expect(dashboard.locator(`a[href="${account(f.api_id)}"]`).first()).toBeAttached();
});

test("the approval page links the payee, the token and the agent; a cross-chain one links the deposit address and the final recipient", async ({ page }) => {
  await page.goto(`/?request=${f.demo_request_id}`);
  await expect(page.getByTestId("recipient").getByRole("link")).toHaveAttribute("href", account(f.api_id));
  await expect(page.locator(`a[href="${account(f.token_id)}"]`)).toBeAttached();
  await expect(page.locator(`a[href="${account(f.agent_id)}"]`)).toBeAttached();

  await page.goto(`/?request=${f.cross_chain_request_id}`);
  await expect(page.getByTestId("recipient").getByRole("link")).toHaveAttribute("href", account(f.deposit_id));
  // the final recipient on Solana links to Solana's explorer, built by the page
  await expect(page.getByTestId("cross-chain-recipient").getByRole("link")).toHaveAttribute("href", `https://solscan.io/account/${f.cross_chain_payee}`);
  await expect(page.getByTestId("cross-chain-refund").getByRole("link")).toHaveAttribute("href", account(f.vault_id));
});
