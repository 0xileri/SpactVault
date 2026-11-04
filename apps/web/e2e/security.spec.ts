import { expect, test, type Page } from "@playwright/test";

import { evidence, REPORT, RUN } from "./report.ts";

async function serveReport(page: Page, body: string, status = 200) {
  await page.route("**/security-report.json", (route) => route.fulfill({ status, contentType: "application/json", body }));
}

test("the Security Lab shows each attack, the tests behind it, and where the results come from", async ({ page }) => {
  await serveReport(page, JSON.stringify(REPORT));
  await page.goto("/");
  // the Security Lab is the one proof link in the footer, not a main nav item (ADR-037)
  await expect(page.getByRole("navigation", { name: "Pages" }).getByRole("link", { name: /Security Lab/ })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Security Lab: how it was tested" }).click();

  await expect(page.getByTestId("security-lab")).toBeVisible();
  await expect(page.getByTestId("lab-source").getByRole("link", { name: "CI run on GitHub Actions" })).toHaveAttribute("href", RUN);
  await expect(page.getByTestId("lab-totals")).toHaveText("21 in 2 suites, 0 failed");
  await expect(page.getByTestId("count-PASSED_ON_CHAIN")).toContainText("1");
  await expect(page.getByTestId("count-NOT_COVERED")).toContainText("1");

  const t01 = page.locator('[data-case="T01"]');
  await expect(t01).toHaveAttribute("data-status", "PASSED_ON_CHAIN");
  await expect(t01).toContainText("Passed on a local chain");
  await expect(t01).toContainText("MCP tool on chain");
  await expect(t01).toContainText("is blocked above the hard cap, and nothing is stored or paid");
  await expect(page.locator('[data-case="T10"]')).toContainText("Passed in unit tests");
  await expect(page.locator('[data-case="T13"]')).toContainText("P1: no cross-chain route.");
  await expect(page.getByText("pnpm mcp:sandbox")).toBeVisible();
});

test("a report that contradicts its own evidence is not believed", async ({ page }) => {
  const [first, ...rest] = REPORT.cases;
  const edited = { ...REPORT, cases: [{ ...first, evidence: [evidence("mcp", "Spact MCP server on a sandbox chain > is blocked above the hard cap, and nothing is stored or paid", "failed")] }, ...rest] };
  await serveReport(page, JSON.stringify(edited));
  await page.goto("/?page=security");

  const t01 = page.locator('[data-case="T01"]');
  await expect(t01).toHaveAttribute("data-status", "FAILED");
  await expect(t01).toContainText("This report contradicts itself");
  await expect(t01).toContainText("failed");
});

test("a missing or broken report is reported as such", async ({ page }) => {
  await serveReport(page, "not found", 404);
  await page.goto("/?page=security");
  await expect(page.getByText("No Security Lab report here yet")).toBeVisible();

  await page.unrouteAll();
  await serveReport(page, JSON.stringify({ ...REPORT, schema: "something-else" }));
  await page.reload();
  await expect(page.getByText("This is not a valid SpactVault security report")).toBeVisible();
  await expect(page.getByTestId("security-lab")).toHaveCount(0);
});
