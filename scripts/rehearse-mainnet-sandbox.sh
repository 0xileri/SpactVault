#!/usr/bin/env bash
# Dress rehearsal for scripts/deploy-mainnet.sh: runs it unchanged against a fresh local sandbox node, with a
# stand-in USDC token (mock-ft named USDC, 6 decimals), then checks the resulting chain state. It also checks
# that the script refuses a wrong token, a deployer without the USDC float, a missing confirmation and a
# second run, each before building or spending anything. Mainnet-only parts (the real USDC contract, a
# wallet-created account, fees) are not covered.
#
# Needs near-cli-rs and the sandbox binary that scripts/test-contracts.sh downloads.
# near-cli-rs runs with a throwaway HOME and config, so your real ~/.near-credentials is untouched.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
RPC="http://127.0.0.1:3030"
SANDBOX_BIN="$(ls "$ROOT"/contracts/target/debug/build/near-sandbox-*/out/.near/near-sandbox-*/near-sandbox 2>/dev/null | head -1 || true)"
[ -x "$SANDBOX_BIN" ] || { echo "sandbox binary not found: run scripts/test-contracts.sh first" >&2; exit 1; }
WASM_DIR="$ROOT/contracts/target/wasm32-unknown-unknown/release"
[ -f "$WASM_DIR/mock_ft.wasm" ] || "$ROOT/scripts/build-contracts.sh" >&2

NEAR_BIN="$(command -v near)"
near() { HOME="$WORK" XDG_CONFIG_HOME="$WORK/.config" "$NEAR_BIN" "$@"; }
export -f near
export WORK NEAR_BIN

# shellcheck source=sandbox-env.sh
source "$ROOT/scripts/sandbox-env.sh"
PRELOAD=(${SANDBOX_LD_PRELOAD:+LD_PRELOAD="$SANDBOX_LD_PRELOAD"})
env "${PRELOAD[@]}" "$SANDBOX_BIN" --home "$WORK/sandbox" init >"$WORK/sandbox-init.log" 2>&1 \
  || { cat "$WORK/sandbox-init.log" >&2; exit 1; }
# `env` execs the node, so $! is the node itself and the EXIT trap's SIGINT reaches it.
env "${PRELOAD[@]}" "$SANDBOX_BIN" --home "$WORK/sandbox" run >"$WORK/sandbox.log" 2>&1 &
SANDBOX_PID=$!
trap 'kill -INT $SANDBOX_PID 2>/dev/null || true; wait $SANDBOX_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf "$RPC/status" >/dev/null && break; sleep 1; done
curl -sf "$RPC/status" >/dev/null || { echo "sandbox did not start; see $WORK/sandbox.log" >&2; exit 1; }

near config show-connections >/dev/null
cat >>"$WORK/.config/near-cli/config.toml" <<EOF

[network_connection.localnet-sandbox]
network_name = "localnet"
rpc_url = "$RPC/"
wallet_url = "http://localhost/"
explorer_transaction_url = "http://localhost/"
EOF

# Import the sandbox root account test.near into the legacy keychain; it plays the funded deployer.
node -e '
const fs = require("fs");
const k = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
fs.mkdirSync(process.argv[2], { recursive: true });
fs.writeFileSync(`${process.argv[2]}/${k.account_id}.json`, JSON.stringify({ account_id: k.account_id, public_key: k.public_key, private_key: k.secret_key }));
' "$WORK/sandbox/validator_key.json" "$WORK/.near-credentials/localnet"

send() { near "$@" network-config localnet-sandbox sign-with-legacy-keychain send >>"$WORK/setup.log" 2>&1; }
create() { send account create-account fund-myself "$1" "$2 NEAR" autogenerate-new-keypair save-to-legacy-keychain sign-as test.near; }
token() {
  create "$1" 5
  send contract deploy "$1" use-file "$WASM_DIR/mock_ft.wasm" with-init-call new \
    json-args "{\"owner_id\":\"test.near\",\"total_supply\":\"1000000000000\",\"symbol\":\"$2\",\"decimals\":6}" \
    prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR'
}
echo "==> Setting up: owner wallet stand-in, a stand-in USDC, a wrong token, a deployer without USDC"
create owner.test.near 5
create poor.test.near 10
token usdc.test.near USDC
token fake.test.near TUSD

AGENT_KEY_FILE="$WORK/agent-function-call-key.json"
deploy() {
  NETWORK_CONFIG=localnet-sandbox NETWORK_LABEL=sandbox RPC_URL="$RPC" USDC_TOKEN="${TOKEN:-usdc.test.near}" \
    NEAR_CREDENTIALS_DIR="$WORK/.near-credentials" NEAR_NETWORK_NAME=localnet AGENT_KEY_FILE="$AGENT_KEY_FILE" \
    CONFIRM="${CONFIRM-deploy to mainnet}" DEMO_REQUESTS=1 "$ROOT/scripts/deploy-mainnet.sh" "$@"
}
# Expects the deploy script to stop with $1 in its output before building or spending anything.
refused() {
  local want="$1"; shift
  if deploy "$@" >"$WORK/refused.log" 2>&1; then echo "FAIL deploy $* ran" >&2; exit 1; fi
  grep -q "$want" "$WORK/refused.log" || { cat "$WORK/refused.log" >&2; echo "FAIL expected: $want" >&2; exit 1; }
  ! grep -q "==> Building contracts" "$WORK/refused.log" || { echo "FAIL deploy $* got past the checks" >&2; exit 1; }
  echo "PASS refused before spending: $want"
}

echo "==> Checking the refusals"
TOKEN=fake.test.near refused "not USDC with 6" test.near owner.test.near
refused "the float needs 5000000" poor.test.near owner.test.near
CONFIRM="yes" refused "not confirmed; nothing was spent" test.near owner.test.near

echo
echo "==> Deploying"
deploy test.near owner.test.near

echo
echo "==> Checking that a second run is refused"
refused "vault.test.near already exists" test.near owner.test.near

echo
echo "==> Checking that the locked vault's code cannot be replaced"
if near contract deploy vault.test.near use-file "$WASM_DIR/mock_ft.wasm" without-init-call \
  network-config localnet-sandbox sign-with-legacy-keychain send >"$WORK/redeploy.log" 2>&1; then
  echo "FAIL the vault's code was replaced" >&2
  exit 1
fi
echo "PASS redeploy refused: the vault has no key to sign it"

echo
echo "==> Checking that the owner can still withdraw from the locked vault"
send contract call-function as-transaction usdc.test.near storage_deposit json-args '{"account_id":"owner.test.near"}' \
  prepaid-gas '30.0 Tgas' attached-deposit '0.01 NEAR' sign-as test.near
send contract call-function as-transaction vault.test.near owner_withdraw \
  json-args '{"token":"usdc.test.near","amount":"1000000","receiver_id":"owner.test.near"}' \
  prepaid-gas '100.0 Tgas' attached-deposit '1 yoctoNEAR' sign-as owner.test.near

echo
echo "==> Checking chain state"
node --input-type=module -e '
const [rpc, keyFile] = process.argv.slice(1);
async function query(params) {
  const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "x", method: "query", params: { finality: "final", ...params } }) });
  return (await res.json()).result;
}
async function view(contract, method, args) {
  const result = await query({ request_type: "call_function", account_id: contract, method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(result.result).toString());
}
const agentKey = JSON.parse((await import("fs")).readFileSync(keyFile, "utf8")).public_key;
const agentKeys = (await query({ request_type: "view_access_key_list", account_id: "agent.test.near" })).keys;
const fc = agentKeys.find((k) => k.public_key === agentKey)?.access_key.permission.FunctionCall;
const vaultKeys = (await query({ request_type: "view_access_key_list", account_id: "vault.test.near" })).keys;
const policy = await view("vault.test.near", "get_policy", {});
const config = await view("vault.test.near", "get_config", {});
const usdc = (id) => view("usdc.test.near", "ft_balance_of", { account_id: id });
const checks = [
  ["vault access keys (locked)", vaultKeys.length, 0],
  ["vault owner", config.owner, "owner.test.near"],
  ["vault network", config.network, "sandbox"],
  ["policy token", policy.tokens[0].token, "usdc.test.near"],
  ["paid at once up to", policy.tokens[0].auto_limit, "1000000"],
  ["waits up to", policy.tokens[0].hard_tx_limit, "3000000"],
  ["daily budget", policy.tokens[0].daily_limit, "5000000"],
  ["only payee", policy.recipients.join(","), "api.test.near"],
  ["agent key receiver", fc?.receiver_id, "vault.test.near"],
  ["agent key methods", fc?.method_names.join(","), "request_direct_payment,execute_request"],
  ["auto payment", (await view("vault.test.near", "get_request", { request_id: "demo-auto-1" })).status, "SETTLED"],
  ["approval request", (await view("vault.test.near", "get_request", { request_id: "demo-approve-1" })).status, "AWAITING_APPROVAL"],
  ["payee USDC", await usdc("api.test.near"), "1000000"],
  ["owner withdrew from the locked vault", await usdc("owner.test.near"), "1000000"],
  ["vault USDC after the payment and the withdrawal", await usdc("vault.test.near"), "3000000"],
];
let failed = 0;
for (const [name, got, want] of checks) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${got}${ok ? "" : ` (expected ${want})`}`);
}
process.exit(failed ? 1 : 0);
' "$RPC" "$AGENT_KEY_FILE"
