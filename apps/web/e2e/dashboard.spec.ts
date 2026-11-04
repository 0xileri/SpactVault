import { expect, test } from "@playwright/test";

import { formatUnits } from "@spact/shared";

import { chain, fixture, UNIT } from "./chain.ts";

const f = fixture();
const near = chain(f);
const tusd = (units: bigint | string) => `${formatUnits(BigInt(units), 6)} TUSD`;

test("the dashboard shows what is on chain: balance, budget, waiting requests and activity", async ({ page }) => {
  await near.agentRequests("e2e-dash", 13n * UNIT, f.api_id, "CDN bandwidth");
  const [vaultBalance, budget] = await Promise.all([near.balance(f.vault_id), near.budget()]);

  await page.goto("/?page=overview");
  await expect(page.getByTestId("dashboard")).toBeVisible();
  await expect(page.getByTestId(`balance-${f.token_id}`)).toHaveText(tusd(vaultBalance));
  await expect(page.getByTestId(`available-${f.token_id}`)).toHaveText(tusd(budget.available));
  await expect(page.getByTestId("vault-state")).toHaveText("Active");

  const waiting = page.getByTestId("pending-list");
  await expect(waiting).toContainText("13 TUSD to api.test.near");
  await expect(waiting).toContainText("e2e-dash");
  // each waiting request is one link to its approval page, with no link nested inside it (invalid HTML)
  await expect(waiting.locator("a a")).toHaveCount(0);
  await expect(page.locator("a a")).toHaveCount(0);

  const activity = page.getByTestId("activity");
  // each row says what happened and why, in words
  await expect(activity.locator('[data-request="e2e-dash"]')).toContainText("Waiting for you");
  await expect(activity.locator('[data-request="e2e-dash"]')).toContainText("Over your instant limit, so it waits for your OK.");
  await expect(activity.locator('[data-request="e2e-dash"]')).toContainText("CDN bandwidth");
  await expect(activity.locator('[data-request="demo-auto-1"]')).toContainText("Paid");
  await expect(activity.locator('[data-request="demo-auto-1"]')).toContainText("3 TUSD");
  await expect(activity.locator('[data-request="demo-auto-1"]')).toContainText("sent without asking you");
  await expect(page.getByTestId("recipients")).toContainText(f.api_id);

  // a row opens that request's approval page
  await activity.getByRole("link", { name: "Open e2e-dash" }).click();
  await expect(page.getByTestId("amount")).toHaveText("13 TUSD");
});

test("budget numbers that do not add up are flagged, not shown", async ({ page }) => {
  const rpcOrigin = new URL(f.rpc_url).origin;
  await page.route(
    (url) => url.origin === rpcOrigin,
    async (route) => {
      const body = route.request().postDataJSON() as { params?: { method_name?: string } } | null;
      if (body?.params?.method_name !== "get_budget") return route.continue();
      const response = await route.fetch();
      const json = (await response.json()) as { result: { result: number[] } };
      const real = JSON.parse(Buffer.from(json.result.result).toString("utf8")) as Record<string, string>;
      // a lying RPC claims the whole daily limit is still available
      json.result.result = Array.from(Buffer.from(JSON.stringify({ ...real, available: real.daily_limit })));
      await route.fulfill({ response, json });
    },
  );

  await page.goto("/?page=overview");
  await expect(page.getByText("Today's spending numbers do not add up")).toBeVisible();
  await expect(page.getByTestId(`available-${f.token_id}`)).toHaveCount(0);
});
