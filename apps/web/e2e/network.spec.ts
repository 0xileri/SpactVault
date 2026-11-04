import { expect, test, type Page } from "@playwright/test";

import { fixture } from "./chain.ts";

// This dev server shows two networks: the local sandbox (main) and a testnet vault whose RPC does not
// exist. The tests stay offline, so only what the page does with its own config is checked here.
const f = fixture();
const TESTNET_VAULT = "vault.e2e.testnet";

async function offline(page: Page) {
  await page.route(
    (url) => url.hostname !== "127.0.0.1",
    (route) => route.abort(),
  );
}

test("the site shows its main network with no switch, and a link to the other network still opens there and keeps it", async ({ page }) => {
  await offline(page);
  await page.goto("/?page=overview");
  const env = page.getByTestId("environment");
  // one network for visitors (ADR-037): no picker in the nav
  await expect(page.getByTestId("network-switch")).toHaveCount(0);
  await expect(env).toContainText("Local sandbox");
  await expect(env).toContainText(f.vault_id);

  // an approval or MCP link that names the other network still opens it
  await page.goto("/?page=overview&network=testnet");
  await expect(env).toContainText("Testnet");
  await expect(env).toContainText(TESTNET_VAULT);

  // links on the page keep the network
  const nav = page.getByRole("navigation", { name: "Pages", exact: true });
  await expect(nav.getByRole("link", { name: "Cross-chain" })).toHaveAttribute("href", "?page=crosschain&network=testnet");
  await nav.getByRole("link", { name: "SpactVault home" }).click();
  await expect(page).toHaveURL(/\/\?network=testnet$/);
  await expect(page.getByTestId("landing")).toContainText("Live on NEAR testnet");
});

test("an approval link opens on its vault's network, and a link that contradicts itself is refused", async ({ page }) => {
  await offline(page);
  await page.goto(`/?request=${f.demo_request_id}&vault=${f.vault_id}`);
  await expect(page.getByTestId("environment")).toContainText("Local sandbox");
  await expect(page.getByTestId("amount")).toHaveText("25 TUSD");

  await page.goto(`/?request=testnet-1&vault=${TESTNET_VAULT}`);
  await expect(page.getByTestId("environment")).toContainText("Testnet");
  await expect(page.getByTestId("environment")).toContainText(TESTNET_VAULT);

  // the network named in the link wins, and the vault named next to it is then a foreign one
  await page.goto(`/?network=testnet&request=${f.demo_request_id}&vault=${f.vault_id}`);
  await expect(page.getByText("This link is for a different vault")).toBeVisible();
  await expect(page.getByTestId("amount")).toHaveCount(0);
});
