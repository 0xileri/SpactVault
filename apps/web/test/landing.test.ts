import type { FtMetadata, PaymentRequest, TokenPolicy } from "@spact/shared";
import { describe, expect, it } from "vitest";

import { GENERIC_AMOUNTS, GENERIC_RULES, exampleAmounts, liveCounts, outcomeRules } from "../src/landing.js";
import { shareImageTags } from "../src/shareTags.js";

const TUSD: FtMetadata = { symbol: "TUSD", decimals: 6 };
const policy: TokenPolicy = { token: "tusd.test.near", auto_limit: "10000000", hard_tx_limit: "30000000", daily_limit: "50000000" };

function request(id: string, status: PaymentRequest["status"], expiresAtNs = 10n ** 30n): PaymentRequest {
  return {
    request_id: id,
    agent_id: "agent.test.near",
    route: "NEAR_DIRECT",
    token: policy.token,
    amount: "5000000",
    recipient: "api.test.near",
    reason: "",
    created_at_ns: "0",
    expires_at_ns: expiresAtNs.toString(),
    policy_version: 1,
    cross_chain: null,
    request_hash: "a".repeat(64),
    status,
    reason_code: "AUTO_WITHIN_POLICY",
    approved_by: null,
    reserved_day: null,
    updated_at_ns: "0",
  };
}

describe("outcomeRules", () => {
  it("states the three outcomes in the vault's own numbers", () => {
    expect(outcomeRules(policy, TUSD)).toEqual({
      paid: "Up to 10 TUSD",
      waits: "Over 10 TUSD, up to 30 TUSD",
      blocked: "Over 30 TUSD, more than 50 TUSD in one day, or to anyone not on the list",
    });
  });

  it("says so when nothing is automatic, or nothing waits", () => {
    expect(outcomeRules({ ...policy, auto_limit: "0" }, TUSD).paid).toMatch(/^Nothing: every payment waits/);
    expect(outcomeRules({ ...policy, auto_limit: "30000000" }, TUSD).waits).toMatch(/^Nothing: everything up to the limit/);
  });

  it("falls back to base units without token metadata, and to words without a vault", () => {
    expect(outcomeRules(policy, null).paid).toBe("Up to 10000000 base units");
    expect(GENERIC_RULES.blocked).toMatch(/not on your list/);
  });
});

describe("exampleAmounts", () => {
  it("picks one amount per outcome from the vault's own limits", () => {
    expect(exampleAmounts(policy, TUSD)).toEqual({ paid: "3 TUSD", waits: "12 TUSD", blocked: "45 TUSD", auto: "10 TUSD", cap: "30 TUSD", example: false });
  });

  it("keeps each amount inside its outcome when the limits are close together", () => {
    const tight = exampleAmounts({ ...policy, auto_limit: "10000000", hard_tx_limit: "11000000" }, TUSD);
    expect(tight).toMatchObject({ paid: "3 TUSD", waits: "10.5 TUSD", blocked: "16.5 TUSD" });
    const tiny = exampleAmounts({ ...policy, auto_limit: "1", hard_tx_limit: "2" }, { symbol: "T", decimals: 0 });
    expect(tiny).toMatchObject({ paid: "1 T", waits: "2 T", blocked: "3 T" });
  });

  it("falls back to the labeled example when the policy has no three outcomes or no metadata", () => {
    expect(exampleAmounts({ ...policy, auto_limit: "0" }, TUSD)).toBe(GENERIC_AMOUNTS);
    expect(exampleAmounts({ ...policy, auto_limit: "30000000" }, TUSD)).toBe(GENERIC_AMOUNTS);
    expect(exampleAmounts(policy, null)).toBe(GENERIC_AMOUNTS);
    expect(GENERIC_AMOUNTS.example).toBe(true);
  });
});

describe("liveCounts", () => {
  it("counts paid and still-approvable requests among the ones read", () => {
    const now = 1_000n;
    const requests = [
      request("a", "SETTLED"),
      request("b", "AWAITING_APPROVAL"),
      request("c", "AWAITING_APPROVAL", 999n), // lapsed: past its expiry by chain time
      request("d", "SETTLED"),
      request("e", "DENIED"),
    ];
    expect(liveCounts(requests, now, 7)).toEqual({ paid: 2, waiting: 1, read: 5, stored: 7 });
  });
});

describe("shareImageTags", () => {
  it("builds absolute image URLs from the site URL", () => {
    const tags = shareImageTags("https://0xileri.github.io/Spact");
    expect(tags.find((t) => t.key === "og:image")?.content).toBe("https://0xileri.github.io/Spact/og-image.png");
    expect(tags.find((t) => t.key === "og:url")?.content).toBe("https://0xileri.github.io/Spact/");
    expect(tags.find((t) => t.key === "twitter:image")?.attr).toBe("name");
  });

  it("adds nothing without a site URL, and fails the build on a bad one", () => {
    expect(shareImageTags(undefined)).toEqual([]);
    expect(() => shareImageTags("http://example.org")).toThrow(/https/);
    expect(() => shareImageTags("https://example.org/?q=1")).toThrow(/https/);
    expect(() => shareImageTags("not a url")).toThrow(/not a valid URL/);
  });
});
