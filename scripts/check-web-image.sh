#!/usr/bin/env bash
# Checks a running web server built from the Dockerfile (the Railway image): the page loads, every
# response carries the security headers, hashed assets are cached for good, and share tags are absolute.
# Usage: scripts/check-web-image.sh <base-url> [expected-site-url]
set -euo pipefail
BASE="${1:?usage: check-web-image.sh <base-url> [expected-site-url]}"
SITE="${2:-}"
failed=0
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*" >&2; failed=1; }

for _ in $(seq 1 30); do curl -sf -o /dev/null "$BASE/" && break; sleep 1; done
headers="$(curl -sS -D - -o /dev/null "$BASE/" | tr -d '\r')"
html="$(curl -sS "$BASE/")"

grep -q "^HTTP/[0-9.]* 200" <<<"$headers" && pass "page loads" || fail "page did not return 200"
for h in "X-Frame-Options: DENY" "X-Content-Type-Options: nosniff" "Referrer-Policy: no-referrer" \
  "Strict-Transport-Security: max-age=31536000" "Cache-Control: no-cache"; do
  grep -qi "^$h\$" <<<"$headers" && pass "header $h" || fail "missing header: $h"
done
grep -qi "^Permissions-Policy: camera=()" <<<"$headers" && pass "header Permissions-Policy" || fail "missing Permissions-Policy"
grep -qi "^Server:" <<<"$headers" && fail "Server header is sent" || pass "no Server header"

asset="$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' <<<"$html" | head -1)"
if [ -n "$asset" ]; then
  ah="$(curl -sS -D - -o /dev/null "$BASE/$asset" | tr -d '\r')"
  grep -qi "^Cache-Control: public, max-age=31536000, immutable\$" <<<"$ah" && pass "hashed asset cached for good" || fail "asset cache header"
  grep -qi "^X-Frame-Options: DENY\$" <<<"$ah" && pass "asset carries the security headers" || fail "asset lacks security headers"
else
  fail "no script asset in the page"
fi

for f in og-image.png favicon.svg; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/$f")"
  [ "$code" = 200 ] && pass "$f served" || fail "$f returned $code"
done
code="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/no-such-file")"
[ "$code" = 404 ] && pass "unknown path is 404" || fail "unknown path returned $code"
curl -sS "$BASE/no-such-file" | grep -q "This page does not exist" && pass "unknown path shows the branded 404 page" || fail "404 page is not the branded one"
code="$(curl -sS -o /dev/null -w '%{http_code}' --path-as-is "$BASE/../../etc/passwd")"
[ "$code" = 404 ] || [ "$code" = 400 ] && pass "path traversal refused ($code)" || fail "path traversal returned $code"

# The 1Click proxy (ADR-033) forwards only GET /v0/tokens, GET /v0/status and POST /v0/quote; these must not
# reach 1Click at all, so they are answered locally whatever 1Click's state.
for probe in "GET /1click/v0/deposit/submit" "POST /1click/v0/status" "GET /1click/v0/quote" "GET /1click/" "GET /1click/../index.html"; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --path-as-is -X "${probe%% *}" "$BASE${probe#* }")"
  [ "$code" = 404 ] || [ "$code" = 400 ] && pass "1Click proxy refuses $probe ($code)" || fail "1Click proxy answered $probe with $code"
done
code="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/contracts/spact_vault-p1.wasm")"
[ "$code" = 200 ] && pass "vault wasm served for the create-vault page" || fail "vault wasm returned $code"

if [ -n "$SITE" ]; then
  grep -q "<meta property=\"og:image\" content=\"${SITE%/}/og-image.png\">" <<<"$html" && pass "og:image is ${SITE%/}/og-image.png" || fail "og:image is not under $SITE"
fi
exit "$failed"
