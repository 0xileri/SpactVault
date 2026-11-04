import { expect, test, type Page } from "@playwright/test";

import { formatUnits } from "@spact/shared";

import { chain, fixture } from "./chain.ts";
import { REPORT } from "./report.ts";

const f = fixture();
const near = chain(f);
const tusd = (units: bigint | string) => `${formatUnits(BigInt(units), 6)} TUSD`;

test("the landing page explains itself in plain words, states the vault's own limits and shows what is on chain", async ({ page }) => {
  await page.route("**/security-report.json", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(REPORT) }));
  const [policy, vaultBalance, budget] = await Promise.all([near.policy(), near.balance(f.vault_id), near.budget()]);

  await page.goto("/");
  await expect(page.getByTestId("landing")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Give your AI agent a budget, not your wallet.");

  // the hero example uses amounts picked from this vault's limits, and says why each one ends the way it does
  const feed = page.getByTestId("request-feed");
  await expect(feed).toContainText(`Under your ${tusd(policy.auto_limit)} instant limit`);
  await expect(feed).toContainText(`Over ${tusd(policy.auto_limit)}, so it asks you first`);
  await expect(feed).toContainText(`Over your ${tusd(policy.hard_tx_limit)} limit per payment`);
  await expect(page.getByTestId("feed-source")).toHaveText("Example amounts, using this vault's real limits.");

  // one main action, in the first screen: Create your vault (ADR-037)
  const cta = page.getByTestId("create-vault-cta").first();
  await expect(cta).toBeInViewport();
  await expect(cta).toHaveText("Create your vault");
  await expect(cta).toHaveAttribute("href", "?page=new-vault");
  // the nav has the same button, and no Security Lab or network switch
  const nav = page.getByRole("navigation", { name: "Pages", exact: true });
  await expect(nav.getByTestId("nav-create")).toHaveAttribute("href", "?page=new-vault");
  await expect(nav.getByRole("link", { name: /Security Lab/ })).toHaveCount(0);
  await expect(page.getByTestId("network-switch")).toHaveCount(0);

  // the three answers, in this vault's numbers as read from its policy
  await expect(page.getByRole("heading", { name: "Every payment gets one of three answers" })).toBeVisible();
  await expect(page.getByTestId("rule-paid")).toHaveText(`Up to ${tusd(policy.auto_limit)}`);
  await expect(page.getByTestId("rule-waits")).toHaveText(`Over ${tusd(policy.auto_limit)}, up to ${tusd(policy.hard_tx_limit)}`);
  await expect(page.getByTestId("rule-blocked")).toHaveText(
    `Over ${tusd(policy.hard_tx_limit)}, more than ${tusd(policy.daily_limit)} in one day, or to anyone not on the list`,
  );

  // live numbers match the chain
  await expect(page.getByTestId("live-balance")).toHaveText(tusd(vaultBalance));
  await expect(page.getByTestId("live-spent")).toContainText(`of ${tusd(budget.daily_limit)}`);
  // the cross-chain route has its own section, linking to its page
  await expect(page.getByRole("heading", { name: "Pay on other chains, with the same rules" })).toBeVisible();
  await expect(page.getByRole("link", { name: "See a cross-chain price" })).toHaveAttribute("href", "?page=crosschain");
  // the last band repeats the action, with the three steps and the one Security Lab proof link
  await expect(page.getByTestId("start-steps").getByRole("listitem")).toHaveCount(3);
  // passed on chain plus passed in unit tests only; the case that is not covered is not counted
  await expect(page.getByTestId("lab-proof")).toContainText("2 attacks tested on every code change.");
  await expect(page.getByTestId("lab-proof").getByRole("link", { name: "See the Security Lab" })).toHaveAttribute("href", "?page=security");

  await cta.click();
  await expect(page).toHaveURL(/\?page=new-vault$/);
  await expect(page.getByRole("heading", { name: "Create a vault" })).toBeVisible();
  await page.goBack();

  await page.getByRole("link", { name: "Open the dashboard" }).first().click();
  await expect(page).toHaveURL(/\?page=overview$/);
  await expect(page.getByTestId("dashboard")).toBeVisible();
  await page.getByRole("link", { name: "SpactVault home" }).click();
  await expect(page.getByTestId("landing")).toBeVisible();
});

test("on a phone the landing page fits the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("live-balance")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

/** Opacity of each outcome in the hero once every animation in it is moved to `ms` into its cycle. */
async function outcomesAt(page: Page, ms: number): Promise<Record<string, number>> {
  return page.getByTestId("request-feed").evaluate((el, t) => {
    for (const a of el.getAnimations({ subtree: true })) {
      a.pause();
      a.currentTime = t;
    }
    const opacity = (sel: string) => {
      const target = el.querySelector(sel);
      if (!target) throw new Error(`missing ${sel}`);
      return Number(getComputedStyle(target).opacity);
    };
    return { paid: opacity(".feed-done-a"), approve: opacity(".feed-approve"), approved: opacity(".feed-done-b"), refused: opacity(".feed-done-c"), third: opacity(".feed-row-c") };
  }, ms);
}

test("the hero plays its three requests in turn, and stops while off screen", async ({ page }) => {
  await page.goto("/");
  const feed = page.getByTestId("request-feed");
  await expect(feed).toHaveAttribute("data-playing", "true");
  const running = () => feed.evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length);
  expect(await running()).toBeGreaterThan(10);

  // the small payment is checked, then paid; the larger one waits for Approve, then is paid; the last is refused
  expect(await outcomesAt(page, 1_000)).toEqual({ paid: 0, approve: 0, approved: 0, refused: 0, third: 0 });
  expect(await outcomesAt(page, 2_000)).toEqual({ paid: 1, approve: 0, approved: 0, refused: 0, third: 0 });
  expect(await outcomesAt(page, 4_500)).toEqual({ paid: 1, approve: 1, approved: 0, refused: 0, third: 0 });
  expect(await outcomesAt(page, 6_500)).toEqual({ paid: 1, approve: 0, approved: 1, refused: 0, third: 0 });
  expect(await outcomesAt(page, 9_500)).toEqual({ paid: 1, approve: 0, approved: 1, refused: 1, third: 1 });

  // below the fold, sections wait for the reader, then fade in
  const firstStep = page.getByTestId("start-steps").locator(".reveal").first();
  await expect(firstStep).toHaveAttribute("data-shown", "false");
  await page.getByTestId("start-steps").scrollIntoViewIfNeeded();
  await expect(firstStep).toHaveAttribute("data-shown", "true");

  await page.getByRole("contentinfo").scrollIntoViewIfNeeded();
  await expect(feed).toHaveAttribute("data-playing", "false");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(feed).toHaveAttribute("data-playing", "true");
});

test("with reduced motion the hero is one still frame of all three outcomes and everything is shown at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const feed = page.getByTestId("request-feed");
  await expect(feed).toBeVisible();
  expect(await feed.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  // paid, waiting for Approve, refused; no "Checking rules" left on screen
  expect(
    await feed.evaluate((el) =>
      [".feed-done-a", ".feed-approve", ".feed-done-b", ".feed-done-c", ".feed-check-a", ".feed-check-b", ".feed-check-c"].map(
        (sel) => {
          const target = el.querySelector(sel);
          return target ? getComputedStyle(target).opacity : `missing ${sel}`;
        },
      ),
    ),
  ).toEqual(["1", "1", "0", "1", "0", "0", "0"]);
  await expect(page.locator(".reveal").first()).toHaveAttribute("data-shown", "true");
  await expect(page.locator('.reveal[data-shown="false"]')).toHaveCount(0);
  // nothing on the page moves: no drifting lights, no rising hero, no turning rings
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length)).toBe(0);
});
