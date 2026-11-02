import { securityReportSchema } from "@spact/shared";
import { describe, expect, it } from "vitest";

import { CASES, SUITES, type CatalogCase, type SuiteDef } from "../src/catalog.js";
import { buildReport } from "../src/report.js";

const suites: SuiteDef[] = [
  { id: "rust:spact_vault", layer: "unit", input: "cargo.txt", format: "cargo", rerun: "scripts/test-contracts.sh" },
  { id: "rust:sandbox", layer: "sandbox", input: "cargo.txt", format: "cargo", rerun: "scripts/test-contracts.sh" },
  { id: "playwright:web", layer: "browser", input: "playwright.json", format: "playwright", rerun: "pnpm e2e" },
];
const cases = [
  { id: "T01", attack: "a", expected: "e", tests: [["rust:spact_vault", "tests::unit_a"], ["rust:sandbox", "chain_a"]] },
  { id: "T02", attack: "a", expected: "e", tests: [["rust:spact_vault", "tests::unit_a"]] },
  { id: "T03", attack: "a", expected: "e", tests: [], note: "P1" },
  { id: "T04", attack: "a", expected: "e", tests: [["playwright:web", "renamed away"]] },
] as unknown as CatalogCase[];

const cargo = [
  "     Running unittests src/lib.rs (target/debug/deps/spact_vault-9b29d63b2c130414)",
  "test tests::unit_a ... ok",
  "     Running tests/sandbox.rs (target/debug/deps/sandbox-8b3986b9a1d1ff02)",
  "test chain_a ... ok",
].join("\n");
const playwright = JSON.stringify({ suites: [{ title: "x.spec.ts", specs: [{ title: "something else", tests: [{ status: "expected", results: [{ duration: 1 }] }] }] }] });
const options = {
  now: new Date("2026-10-24T12:00:00Z"),
  source: { kind: "local" as const, commit: null, commit_url: null, run_url: null, runner: "local run on linux x64" },
  toolchain: { node: "v22.22.0" },
  suites,
  cases,
};

describe("buildReport", () => {
  it("derives each case's status from the tests that ran", () => {
    const { report, problems } = buildReport(new Map([["cargo.txt", cargo], ["playwright.json", playwright]]), options);
    expect(report.cases.map((c) => [c.id, c.status])).toEqual([
      ["T01", "PASSED_ON_CHAIN"],
      ["T02", "PASSED_UNIT_ONLY"],
      ["T03", "NOT_COVERED"],
      ["T04", "FAILED"],
    ]);
    expect(report.cases[3]?.evidence[0]).toMatchObject({ layer: "browser", result: "missing" });
    expect(problems).toEqual(['T04: playwright:web "renamed away" missing']);
    expect(report.suites.find((s) => s.id === "rust:sandbox")).toMatchObject({ passed: 1, failed: 0, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(securityReportSchema.parse(report)).toEqual(report);
  });

  it("marks everything from a missing or unreadable input as not run", () => {
    const { report, problems } = buildReport(new Map([["cargo.txt", cargo], ["playwright.json", "{not json"]]), options);
    expect(report.suites.find((s) => s.id === "playwright:web")?.sha256).toBeNull();
    expect(problems).toContain("playwright:web: no output (playwright.json is missing or unreadable)");
    expect(problems.some((p) => p.startsWith("playwright.json: cannot read it"))).toBe(true);

    const none = buildReport(new Map(), options);
    expect(none.report.cases.map((c) => c.status)).toEqual(["FAILED", "FAILED", "NOT_COVERED", "FAILED"]);
  });

  it("reports failing tests even when no case names them", () => {
    // the extra line follows the sandbox binary's "Running" line, so it belongs to that suite
    const failing = `${cargo}\ntest unmapped ... FAILED`;
    const { problems } = buildReport(new Map([["cargo.txt", failing], ["playwright.json", playwright]]), options);
    expect(problems).toContain("rust:sandbox: 1 test(s) failed");
  });
});

describe("catalog", () => {
  it("covers T01 to T18 once each, with known suites and no repeated tests", () => {
    expect(CASES.map((c) => c.id)).toEqual(Array.from({ length: 18 }, (_, i) => `T${String(i + 1).padStart(2, "0")}`));
    const suiteIds = new Set(SUITES.map((s) => s.id));
    for (const c of CASES) {
      for (const [suite] of c.tests) expect(suiteIds.has(suite)).toBe(true);
      expect(new Set(c.tests.map(([s, t]) => `${s}:${t}`)).size).toBe(c.tests.length);
      // every case is backed by tests now that the P1 cross-chain route exists
      expect(c.tests.length, c.id).toBeGreaterThan(0);
    }
  });
});
