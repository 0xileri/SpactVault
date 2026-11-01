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

test("the network switch moves the whole site to the other vault, and its links stay there", async ({ page }) => {
  await offline(page);
  await page.goto("/?page=overview");
  const env = page.getByTestId("environment");
  await expect(page.getByTestId("network-switch")).toHaveValue("sandbox");
  await expect(env).toContainText(f.vault_id);

  await page.getByTestId("network-switch").selectOption("testnet");
  await expect(page).toHaveURL(/\/\?page=overview&network=testnet$/);
  await expect(page.getByTestId("network-switch")).toHaveValue("testnet");
  await expect(env).toContainText("Testnet");
  await expect(env).toContainText(TESTNET_VAULT);

  // links on the page keep the network
  const nav = page.getByRole("navigation", { name: "Pages" });
  await expect(nav.getByRole("link", { name: "Security Lab" })).toHaveAttribute("href", "?page=security&network=testnet");
  await nav.getByRole("link", { name: "SpactVault home" }).click();
  await expect(page).toHaveURL(/\/\?network=testnet$/);
  await expect(page.getByTestId("landing")).toContainText("Live on NEAR testnet");

  // and back to the main network, with no parameter left over
  await page.getByTestId("network-switch").selectOption("sandbox");
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  await expect(page.getByTestId("landing")).toContainText("Live on a local NEAR sandbox");
});

test("an approval link opens on its vault's network, and a link that contradicts itself is refused", async ({ page }) => {
  await offline(page);
  await page.goto(`/?request=${f.demo_request_id}&vault=${f.vault_id}`);
  await expect(page.getByTestId("network-switch")).toHaveValue("sandbox");
  await expect(page.getByTestId("amount")).toHaveText("25 TUSD");

  await page.goto(`/?request=testnet-1&vault=${TESTNET_VAULT}`);
  await expect(page.getByTestId("network-switch")).toHaveValue("testnet");
  await expect(page.getByTestId("environment")).toContainText(TESTNET_VAULT);

  // the network named in the link wins, and the vault named next to it is then a foreign one
  await page.goto(`/?network=testnet&request=${f.demo_request_id}&vault=${f.vault_id}`);
  await expect(page.getByText("This link is for a different vault")).toBeVisible();
  await expect(page.getByTestId("amount")).toHaveCount(0);
});
