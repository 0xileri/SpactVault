#!/usr/bin/env bash
# Runs every test suite with machine-readable output, then builds the Security Lab report from it.
#   reports/                                 raw runner output, one file per suite
#   apps/web/public/security-report.json     the report the web app's Security Lab page shows
# Usage: scripts/security-report.sh [out.json]
#
# A suite that fails does not stop the run: its failures go into the report, and this script
# exits non-zero at the end. The report is generated, never edited by hand (packages/security-lab).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
R="$ROOT/reports"
OUT="${1:-$ROOT/apps/web/public/security-report.json}"
rm -rf "$R" && mkdir -p "$R"
failed=0
run() { echo "==> $*" >&2; "$@" || failed=1; }

cd "$ROOT"
run bash -c "scripts/test-contracts.sh 2>&1 | tee '$R/cargo.txt'"
(cd contracts && rustc --version) > "$R/rustc-version.txt" 2>/dev/null || true

for p in shared intents web mcp notifier; do
  run pnpm --filter "@spact/$p" exec vitest run --reporter=default --reporter=json --outputFile.json="$R/vitest-$p.json"
done
run pnpm mcp:sandbox --reporter=default --reporter=json --outputFile.json="$R/vitest-mcp-sandbox.json"
run pnpm notifier:sandbox --reporter=default --reporter=json --outputFile.json="$R/vitest-notifier-sandbox.json"
run env PLAYWRIGHT_JSON_OUTPUT_FILE="$R/playwright.json" pnpm e2e --reporter=list,json

run pnpm --filter "@spact/security-lab..." build
run node packages/security-lab/dist/cli.js "$R" "$OUT"
exit "$failed"
