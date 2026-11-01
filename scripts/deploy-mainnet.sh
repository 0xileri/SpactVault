#!/usr/bin/env bash
# Deploys SpactVault to NEAR mainnet with near-cli-rs, with real USDC and small fixed limits (DECISIONS ADR-028):
#   vault.<parent>  the SpactVault contract, owned by <owner>. Deployed and initialized in one transaction, then
#                   its full-access key is deleted: nobody can change its code any more, and only the owner can
#                   move its USDC out (owner_withdraw).
#   agent.<parent>  the agent account. It gets a function-call key limited to request_direct_payment and
#                   execute_request on the vault, saved to its own file for the agent runtime. The account's
#                   full-access key stays in your keychain as the operator key; never give it to the agent.
#   api.<parent>    the demo payee. It is yours too, so USDC the demo pays stays with you.
# then registers USDC storage for the vault and the payee and moves the float from <parent> into the vault.
#
# Usage: scripts/deploy-mainnet.sh <parent-account> <owner-account>
#   parent-account  a named mainnet account in near-cli's legacy keychain, holding the NEAR below and the USDC
#                   float. Import it on your own machine (near-cli asks for the seed phrase itself):
#                     near account import-account using-seed-phrase network-config mainnet
#   owner-account   the wallet account that approves payments and can withdraw, e.g. alice.near
#
# Before spending anything it checks the network, the accounts, the token and your balances, prints what it
# will spend and the most you can lose, and waits for you to type "deploy to mainnet".
#
# Environment overrides:
#   USDC_TOKEN       token contract (default: native USDC, see USDC_DEFAULT below). The script refuses unless
#                    the token says symbol USDC with 6 decimals; still compare the id with Circle's list at
#                    https://developers.circle.com/stablecoins/usdc-contract-addresses before you confirm.
#   FLOAT_USDC / AUTO_USDC / CAP_USDC / DAILY_USDC  float and limits in USDC (defaults 5 / 1 / 3 / 5)
#   VAULT_NEAR / AGENT_NEAR / API_NEAR  initial NEAR (defaults 2.9 / 0.3 / 0.1). VAULT_NEAR pays the vault's
#                    storage: about 2.5 NEAR for the code, the rest for requests. It stays locked in the vault.
#   AGENT_ALLOWANCE  gas allowance of the agent's restricted key (default: 0.25 NEAR)
#   DEMO_REQUESTS    1 to file two demo requests after the deploy (default 0; the agent does that in the demo)
#   RPC_URL          RPC for the checks and the web app (default: https://rpc.mainnet.fastnear.com)
#   NETWORK_CONFIG / NETWORK_LABEL  near-cli connection and the network string stored in the vault (mainnet)
#   NEAR_CREDENTIALS_DIR / NEAR_NETWORK_NAME / AGENT_KEY_FILE  as in deploy-testnet.sh
#   CONFIRM          "deploy to mainnet" answers the prompt (scripts/rehearse-mainnet-sandbox.sh uses it)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Native USDC on NEAR, as given by Circle's announcement and NEAR token lists (docs/INTEGRATIONS.md).
USDC_DEFAULT=17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1

PARENT="${1:?usage: deploy-mainnet.sh <parent-account> <owner-account>}"
OWNER="${2:?usage: deploy-mainnet.sh <parent-account> <owner-account>}"
NET="${NETWORK_CONFIG:-mainnet}"
LABEL="${NETWORK_LABEL:-mainnet}"
RPC_URL="${RPC_URL:-https://rpc.mainnet.fastnear.com}"
TOKEN="${USDC_TOKEN:-$USDC_DEFAULT}"
VAULT="vault.$PARENT"
AGENT="agent.$PARENT"
API="api.$PARENT"
VAULT_NEAR="${VAULT_NEAR:-2.9}"
AGENT_NEAR="${AGENT_NEAR:-0.3}"
API_NEAR="${API_NEAR:-0.1}"
AGENT_METHODS='request_direct_payment, execute_request'
KEYCHAIN="${NEAR_CREDENTIALS_DIR:-$HOME/.near-credentials}/${NEAR_NETWORK_NAME:-mainnet}"
AGENT_KEY_FILE="${AGENT_KEY_FILE:-${NEAR_CREDENTIALS_DIR:-$HOME/.near-credentials}/spact/$AGENT.json}"

die() { echo "error: $*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*" >&2; }
command -v near >/dev/null || die "near-cli-rs not found (see https://docs.near.org/tools/cli#installation)"
for id in "$VAULT" "$AGENT" "$API"; do [ "$OWNER" != "$id" ] || die "owner must not be $id"; done
[ "$OWNER" != "$PARENT" ] || echo "warning: owner is the deployer account; a separate wallet account is safer" >&2

rpc() { curl -sS --fail -X POST "$RPC_URL" -H 'content-type: application/json' -d "$1"; }
# A JSON field of an RPC result, read with node; any RPC error stops the script.
rpc_field() {
  rpc "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);
      if (!r.result) { console.error(JSON.stringify(r.error)); process.exit(1); }
      console.log(new Function("r", "return " + process.argv[1])(r.result)); })' "$2"
}
# Prints yes or no; any other RPC answer is an error, so a flaky RPC cannot pass for a missing account.
account_exists() {
  rpc "{\"jsonrpc\":\"2.0\",\"id\":\"x\",\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);
        if (r.result) console.log("yes");
        else if (JSON.stringify(r.error ?? "").includes("UNKNOWN_ACCOUNT")) console.log("no");
        else { console.error(JSON.stringify(r.error)); process.exit(1); }})'
}
# A view call's JSON result, compacted.
view() {
  local args
  args="$(printf '%s' "$3" | base64 | tr -d '\n')"
  rpc_field "{\"jsonrpc\":\"2.0\",\"id\":\"x\",\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$args\"}}" \
    'JSON.stringify(JSON.parse(Buffer.from(r.result).toString()))'
}
# Decimal amount times 10^decimals, exactly; refuses anything that would need rounding.
units() {
  node -e 'const [v, d] = process.argv.slice(1); const m = /^(\d+)(?:\.(\d+))?$/.exec(v);
    if (!m || (m[2] ?? "").length > Number(d)) { console.error(`bad amount ${v}`); process.exit(1); }
    console.log((BigInt(m[1] + (m[2] ?? "").padEnd(Number(d), "0"))).toString());' "$1" "$2"
}
yocto() { units "$1" 24; }

step "Checking the network"
# The vault is built with rustc 1.97, whose wasm needs protocol version >= 84 (nearcore 2.12).
pv="$(rpc_field '{"jsonrpc":"2.0","id":"x","method":"status","params":[]}' 'r.protocol_version')"
chain="$(rpc_field '{"jsonrpc":"2.0","id":"x","method":"status","params":[]}' 'r.chain_id')"
echo "chain $chain, protocol version $pv" >&2
[ "$pv" -ge 84 ] || die "protocol version $pv < 84: rebuild the contracts with rustc <= 1.86"
if [ "$LABEL" = mainnet ] && [ "$chain" != mainnet ]; then die "RPC $RPC_URL serves $chain, not mainnet"; fi

step "Checking accounts"
state="$(account_exists "$PARENT")"
[ "$state" = yes ] || die "deployer $PARENT does not exist on $LABEL"
state="$(account_exists "$OWNER")"
[ "$state" = yes ] || die "owner $OWNER does not exist on $LABEL. Create it in your wallet first: only it can approve payments"
for id in "$VAULT" "$AGENT" "$API"; do
  state="$(account_exists "$id")"
  [ "$state" = no ] || die "$id already exists: $PARENT was used for a deploy before"
done
echo "deployer $PARENT and owner $OWNER exist; the three subaccounts are free" >&2

step "Checking the token $TOKEN"
meta="$(view "$TOKEN" ft_metadata '{}')"
symbol="$(node -e 'console.log(JSON.parse(process.argv[1]).symbol)' "$meta")"
decimals="$(node -e 'console.log(JSON.parse(process.argv[1]).decimals)' "$meta")"
name="$(node -e 'console.log(JSON.parse(process.argv[1]).name)' "$meta")"
echo "token says: $name ($symbol), $decimals decimals" >&2
[ "$symbol" = USDC ] && [ "$decimals" = 6 ] || die "$TOKEN is $symbol with $decimals decimals, not USDC with 6"
FLOAT="$(units "${FLOAT_USDC:-5}" 6)"
AUTO="$(units "${AUTO_USDC:-1}" 6)"
CAP="$(units "${CAP_USDC:-3}" 6)"
DAILY="$(units "${DAILY_USDC:-5}" 6)"
bounds="$(view "$TOKEN" storage_balance_bounds '{}')"
STORAGE_MIN="$(node -e 'console.log(JSON.parse(process.argv[1]).min)' "$bounds")"

step "Checking balances of $PARENT"
have_usdc="$(view "$TOKEN" ft_balance_of "{\"account_id\":\"$PARENT\"}" | tr -d '"')"
node -e 'const [h, n] = process.argv.slice(1).map(BigInt); process.exit(h >= n ? 0 : 1)' "$have_usdc" "$FLOAT" \
  || die "$PARENT holds $have_usdc USDC units; the float needs $FLOAT. Send USDC (native, not USDC.e) to $PARENT first"
have_near="$(rpc_field "{\"jsonrpc\":\"2.0\",\"id\":\"x\",\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$PARENT\"}}" 'r.amount')"
# Subaccount funding, two storage deposits and a 0.1 NEAR margin for gas.
need_near="$(node -e 'const a = process.argv.slice(1).map(BigInt); console.log(a.reduce((x, y) => x + y).toString())' \
  "$(yocto "$VAULT_NEAR")" "$(yocto "$AGENT_NEAR")" "$(yocto "$API_NEAR")" "$STORAGE_MIN" "$STORAGE_MIN" "$(yocto 0.1)")"
node -e 'const [h, n] = process.argv.slice(1).map(BigInt); process.exit(h >= n ? 0 : 1)' "$have_near" "$need_near" \
  || die "$PARENT has $have_near yoctoNEAR; this deploy needs about $need_near. Fund it first"
near_of() { node -e 'const y = BigInt(process.argv[1]); console.log(`${y / 10n**24n}.${(y % 10n**24n).toString().padStart(24, "0").slice(0, 3)}`)' "$1"; }

cat >&2 <<EOF

This deploys to $LABEL and spends real funds from $PARENT:
  NEAR    $VAULT_NEAR to $VAULT (contract storage; locked in the vault for good once its key is deleted)
          $AGENT_NEAR to $AGENT, $API_NEAR to $API, $(near_of "$STORAGE_MIN") NEAR twice for USDC storage, plus gas
          about $(near_of "$need_near") NEAR in all, including a 0.1 NEAR gas margin
  USDC    ${FLOAT_USDC:-5} USDC into $VAULT. Only $OWNER can withdraw it (owner_withdraw); the agent can spend it
          within the limits: paid at once up to ${AUTO_USDC:-1}, waits for $OWNER up to ${CAP_USDC:-3},
          ${DAILY_USDC:-5} a day, only to $API
  token   $TOKEN ($name)
  lock    $VAULT's full-access key is deleted after setup: its code can never change again

Most you can lose: the NEAR above, and the ${FLOAT_USDC:-5} USDC float if the unaudited contract has a flaw.
EOF
answer="${CONFIRM:-}"
if [ -z "$answer" ]; then read -r -p 'Type "deploy to mainnet" to continue: ' answer; fi
[ "$answer" = "deploy to mainnet" ] || die "not confirmed; nothing was spent"

step "Building contracts"
"$ROOT/scripts/build-contracts.sh" >&2
WASM_DIR="$ROOT/contracts/target/wasm32-unknown-unknown/release"

step "Creating subaccounts of $PARENT"
for spec in "$VAULT:$VAULT_NEAR" "$AGENT:$AGENT_NEAR" "$API:$API_NEAR"; do
  id="${spec%%:*}"
  amount="${spec##*:}"
  near account create-account fund-myself "$id" "$amount NEAR" autogenerate-new-keypair --signature-scheme ed25519 save-to-legacy-keychain \
    sign-as "$PARENT" network-config "$NET" sign-with-legacy-keychain send
done

step "Deploying and initializing the vault at $VAULT (one transaction, signed by the vault account)"
POLICY="{\"tokens\":[{\"token\":\"$TOKEN\",\"auto_limit\":\"$AUTO\",\"hard_tx_limit\":\"$CAP\",\"daily_limit\":\"$DAILY\"}],\"recipients\":[\"$API\"],\"max_open_approvals\":3,\"max_requests_per_day\":20,\"approval_ttl_sec\":86400}"
near contract deploy "$VAULT" use-file "$WASM_DIR/spact_vault.wasm" with-init-call new \
  json-args "{\"owner\":\"$OWNER\",\"agents\":[\"$AGENT\"],\"network\":\"$LABEL\",\"policy\":$POLICY}" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config "$NET" sign-with-legacy-keychain send

step "Giving the agent a restricted key: only $AGENT_METHODS on $VAULT"
before="$(ls "$KEYCHAIN/$AGENT" 2>/dev/null | sort || true)"
near account add-key "$AGENT" grant-function-call-access --allowance "${AGENT_ALLOWANCE:-0.25 NEAR}" \
  --contract-account-id "$VAULT" --function-names "$AGENT_METHODS" \
  autogenerate-new-keypair --signature-scheme ed25519 save-to-legacy-keychain network-config "$NET" sign-with-legacy-keychain send
new_key="$(comm -13 <(echo "$before") <(ls "$KEYCHAIN/$AGENT" | sort))"
[ "$(printf '%s\n' "$new_key" | grep -c .)" = 1 ] || die "could not find the new key in $KEYCHAIN/$AGENT"
mkdir -p "$(dirname "$AGENT_KEY_FILE")"
install -m 600 "$KEYCHAIN/$AGENT/$new_key" "$AGENT_KEY_FILE"
echo "agent's restricted key: $AGENT_KEY_FILE" >&2

step "Registering USDC storage for the vault and the payee, then moving ${FLOAT_USDC:-5} USDC into the vault"
for id in "$VAULT" "$API"; do
  near contract call-function as-transaction "$TOKEN" storage_deposit \
    json-args "{\"account_id\":\"$id\",\"registration_only\":true}" \
    prepaid-gas '30.0 Tgas' attached-deposit "$STORAGE_MIN yoctoNEAR" sign-as "$PARENT" network-config "$NET" sign-with-legacy-keychain send
done
near contract call-function as-transaction "$TOKEN" ft_transfer \
  json-args "{\"receiver_id\":\"$VAULT\",\"amount\":\"$FLOAT\"}" \
  prepaid-gas '30.0 Tgas' attached-deposit '1 yoctoNEAR' sign-as "$PARENT" network-config "$NET" sign-with-legacy-keychain send

step "Locking the vault: deleting its full-access key"
vault_key="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).public_key)' "$KEYCHAIN/$VAULT.json")"
near account delete-keys "$VAULT" public-keys "$vault_key" network-config "$NET" sign-with-legacy-keychain send
keys_left="$(rpc_field "{\"jsonrpc\":\"2.0\",\"id\":\"x\",\"method\":\"query\",\"params\":{\"request_type\":\"view_access_key_list\",\"finality\":\"final\",\"account_id\":\"$VAULT\"}}" 'r.keys.length')"
[ "$keys_left" = 0 ] || die "$VAULT still has $keys_left access keys; it is not locked"
echo "$VAULT has no access keys left" >&2

if [ "${DEMO_REQUESTS:-0}" = 1 ]; then
  step "Agent requests, signed with its restricted key: one paid at once, one that waits for $OWNER"
  request() {
    near contract call-function as-transaction "$VAULT" request_direct_payment \
      json-args "{\"request_id\":\"$1\",\"token\":\"$TOKEN\",\"amount\":\"$2\",\"recipient\":\"$API\",\"reason\":\"$3\"}" \
      prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' sign-as "$AGENT" network-config "$NET" \
      sign-with-access-key-file "$AGENT_KEY_FILE" send
  }
  request demo-auto-1 "$AUTO" "Weather API: 1,000 calls"
  request demo-approve-1 "$CAP" "Weather API: monthly plan upgrade"
fi

step "Done"
code_hash="$(rpc_field "{\"jsonrpc\":\"2.0\",\"id\":\"x\",\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$VAULT\"}}" 'r.code_hash')"
cat <<EOF
vault      $VAULT (code hash $code_hash, locked: no access keys)
token      $TOKEN ($name)
agent      $AGENT
           restricted key ($AGENT_METHODS on $VAULT): $AGENT_KEY_FILE
           full-access operator key: $KEYCHAIN/$AGENT.json (keep it away from the agent)
payee      $API
owner      $OWNER

Web app settings (Railway service variables, or apps/web/.env.local):
VITE_NEAR_NETWORK=$LABEL
VITE_NEAR_RPC_URL=$RPC_URL
VITE_VAULT_ID=$VAULT

To take the float back at any time, $OWNER calls owner_withdraw on $VAULT.
EOF
