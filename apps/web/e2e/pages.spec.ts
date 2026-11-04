import { expect, test } from "@playwright/test";

import { REPORT } from "./report.ts";

// The site as CI publishes it to GitHub Pages (built and served by e2e/global-setup.ts): a
// production build under /Spact/ with no vault configured.
const PAGES = "http://127.0.0.1:5198/Spact/";

test("the published site works under its subpath with no vault: the Security Lab loads, the rest says why it cannot", async ({ page }) => {
  const outside: string[] = [];
  const broken: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).host !== "127.0.0.1:5198") outside.push(r.url());
  });
  page.on("requestfailed", (r) => broken.push(r.url()));
  page.on("response", (r) => {
    if (r.status() >= 400) broken.push(`${r.status()} ${r.url()}`);
  });
  await page.route(`${PAGES}security-report.json`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(REPORT) }));

  await page.goto(PAGES);
  await expect(page.getByTestId("landing")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Give your AI agent a budget, not your wallet.");
  await expect(page.getByText("No vault is connected to this site yet")).toBeVisible();
  await expect(page.getByTestId("connect")).toHaveCount(0);
  // without a vault the outcomes are described in words, and the Security Lab numbers come from the report
  await expect(page.getByTestId("rule-paid")).toHaveText("Small payments, up to your instant limit");
  await expect(page.getByTestId("lab-proof")).toContainText("2 attacks tested on every code change.");
  // with no vault there is nothing to create or manage: the nav holds only the logo, and no Create button shows
  await expect(page.getByTestId("nav-create")).toHaveCount(0);
  await expect(page.getByTestId("create-vault-cta")).toHaveCount(0);
  await expect(page.getByTestId("feed-source")).toHaveText("Example amounts and limits. Every owner picks their own.");
  await expect(page.getByRole("link", { name: "Source code" })).toHaveAttribute("href", "https://example.test/repo");

  // the share card points at absolute URLs under the site, and its image is served
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://example.test/Spact/og-image.png");
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  expect((await page.request.get(`${PAGES}og-image.png`)).status()).toBe(200);
  expect((await page.request.get(`${PAGES}favicon.svg`)).status()).toBe(200);

  await page.goto(`${PAGES}?page=overview`);
  await expect(page.getByText("No vault is connected to this site yet")).toBeVisible();
  await expect(page.getByTestId("environment")).toHaveText("No vault connected");

  await page.getByRole("link", { name: "Open the Security Lab" }).click();
  await expect(page).toHaveURL(`${PAGES}?page=security`);
  await expect(page.locator('[data-case="T01"]')).toHaveAttribute("data-status", "PASSED_ON_CHAIN");

  await page.getByRole("link", { name: "SpactVault home" }).click();
  await expect(page).toHaveURL(PAGES);

  // an approval link loads nothing on a site that has no vault
  await page.goto(`${PAGES}?request=demo-approve-1&vault=vault.testnet`);
  await expect(page.getByText("No vault is connected to this site yet")).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(0);

  // styles and scripts all came from under the subpath, and nothing reached an RPC or wallet host
  expect(broken).toEqual([]);
  expect(outside).toEqual([]);
});

test("inside a frame, neither the vault site nor the published site draws anything to click", async ({ page }) => {
  for (const url of ["http://127.0.0.1:5199/?request=demo-approve-1", `${PAGES}?page=security`]) {
    await page.setContent(`<iframe src="${url}" width="900" height="600"></iframe>`);
    const frame = page.frameLocator("iframe");
    await expect(frame.getByTestId("framed")).toBeVisible();
    await expect(frame.getByRole("button")).toHaveCount(0);
    await expect(frame.getByRole("link")).toHaveText(["Open SpactVault in a new tab"]);
  }
});

test("the published site has a skip link, a privacy and terms page, and a branded 404", async ({ page }) => {
  await page.goto(PAGES);
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await skip.press("Enter");
  await expect(page.locator("#main")).toBeFocused();

  await page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Privacy and terms" }).click();
  await expect(page).toHaveURL(`${PAGES}?page=legal`);
  await expect(page.getByTestId("legal")).toContainText("This site sets no cookies and runs no analytics");
  await expect(page.getByTestId("legal")).toContainText("rpc.invalid");
  await expect(page.getByTestId("legal")).toContainText("test tokens that have no value");

  const missing = await page.goto(`${PAGES}no/such/page`);
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page does not exist.");
  await expect(page.getByRole("link", { name: "Back to SpactVault" })).toBeVisible();
});
