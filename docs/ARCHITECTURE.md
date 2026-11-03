# Architecture

Status labels: **built** (code plus passing tests in this repo), **planned** (in AGENTS.md, no code yet).

```text
                    HUMAN OWNER  (NEAR wallet, full-access key)
                         | set_policy / set_paused / approve_request(id, hash)
                         | reject_request / owner_withdraw        [built, contract side]
                         v
 AI AGENT --request_direct_payment / execute_request--> SPACT VAULT (Rust, near-sdk)  [built]
 (own NEAR account,                                     - policy + version
  restricted key)                                       - immutable requests + hash
                                                        - UTC-day ledger: executed + pending
                                                        - single dispatch point
                                                             |
                                          ft_transfer (1 yocto) | then on_transfer_result (#[private])
                                                             v
                                                    NEP-141 token contract
                                                             |
                                                         recipient

 OWNER BROWSER: approval page (apps/web) [built]
   reads vault + token over NEAR RPC -> hashes displayed terms -> wallet signs approve_request(id, hash)

 AGENT HOST (Claude Code, Codex): MCP server (apps/mcp) [built]
   request_payment / get_payment_status -> signs with the agent's function-call key

 OWNER PHONE: Telegram notifier (apps/notifier) [built]
   polls the vault -> plain-text alert with the exact terms + approval link -> follow-up when paid

 1Click adapter (packages/intents) [built; tested on recorded live answers]
   quote request -> checked quote -> request_cross_chain_payment terms; status -> reconciliation (never re-credits)

 planned: API/indexer
```

## Vault contract (`contracts/spact-vault`) [built]

**State:** owner, network label, agents (max 8), paused flag, policy (tokens, recipient allowlist, limits), `policy_version`, open-approval counter, requests (`IterableMap<String, PaymentRequest>`), ledgers keyed by `(token, utc_day)`, stored-request counts per day.

**Request lifecycle**

```text
request_direct_payment (agent)
  |-- policy check fails ----------------------------> BLOCKED (returned + event, not stored)
  |-- amount <= auto_limit --> reserve + ft_transfer --> TRANSFER_PENDING
  '-- amount >  auto_limit ---------------------------> AWAITING_APPROVAL
AWAITING_APPROVAL --approve_request(id, hash) by owner--> APPROVED
AWAITING_APPROVAL | APPROVED --reject_request by owner--> DENIED
AWAITING_APPROVAL | APPROVED --expire_request after TTL--> EXPIRED
APPROVED --execute_request (owner or agent), rechecks--> reserve + ft_transfer --> TRANSFER_PENDING
TRANSFER_PENDING --callback: transfer ok-----> SETTLED          (pending -> executed)
TRANSFER_PENDING --callback: transfer failed-> TRANSFER_FAILED  (pending released)

request_cross_chain_payment (agent; P1, ADR-032)
  |-- policy or route check fails ----------------------> BLOCKED (returned + event, not stored)
  '-- otherwise, whatever the amount -------------------> AWAITING_APPROVAL
  ... approve / execute as above, plus: quote has > 60 s left (else QUOTE_EXPIRED)
TRANSFER_PENDING --callback: transfer ok-----> CROSS_CHAIN_PENDING  (pending -> executed; final on chain)
```

A cross-chain request's NEAR recipient is the 1Click deposit account. The final recipient, destination chain and asset, refund target, minimum output, quote hash and quote deadline are stored in `cross_chain` and covered by the request hash. CROSS_CHAIN_PENDING is where the vault's part ends: 1Click's later SUCCESS or REFUNDED is an off-chain report that the vault never reads, so the budget is never re-credited.

The spec's AUTO_AUTHORIZED, RESERVED and SOURCE_CONFIRMED states happen inside one receipt, so they are never observable and not stored (ADR-007).

**Checks for a new request, in order:** paused, request id format, duplicate id, amount > 0, reason (at most 256 bytes, no control characters), token in policy, recipient allowlisted, amount <= hard cap, amount <= today's available budget, open-approval cap (approval path only), stored-requests-per-day cap.

**Execution rechecks:** caller is the owner or the requesting agent, status is APPROVED, not paused, policy version unchanged, not expired, agent still allowed, budget available.

**Budget:** `available = daily_limit - (executed + pending)` for `(token, floor(block_timestamp / 1 day))`. Reservation happens in `dispatch`, the only place a payment transfer is created, before the promise is sent. The callback moves the amount from pending to executed on success, or releases it on failure. It does this only if the request is still TRANSFER_PENDING, so it runs at most once, and always on the day recorded at dispatch.

**Request hash:** sha256 over a versioned, borsh-compatible encoding of domain, network, vault id, request id, agent, route, token, amount, recipient, reason, expiry and policy version (`src/digest.rs`, mirrored in `packages/shared/src/digest.ts`).

**Events:** NEP-297 `EVENT_JSON` with standard `spact` for policy, pause, agent changes, blocked requests, status transitions and owner withdrawals. Indexers read events; contract state is the source of truth.

## Mock token (`contracts/mock-ft`) [built, test only]

A wrapper around `near-contract-standards` `FungibleToken`. It exists so tests use real NEP-141 semantics: storage registration, 1 yocto on transfer, and a failed transfer to an unregistered account.

## Shared TS package (`packages/shared`) [built]

Contract JSON types, reason codes with user-facing text, exact BigInt amount parsing, and the request digest. This is what the approval page will use to hash the terms it displays.

## Approval page (`apps/web`) [built]

React 19 + Vite 8 + Tailwind 4. No backend: it reads the vault directly over NEAR JSON-RPC (`get_config`, `get_policy`, `get_request`, `get_budget`, token `ft_metadata`, latest final block time) and validates every response with the zod schemas in `@spact/shared`.

```text
?request=<id>  -> loadSnapshot -> assess():
                    vault id + network match this deployment's config
                    request open, not expired, same policy version
                    hash(displayed terms, configured network, configured vault) == stored hash
                    connected account == vault owner
                    (pay now) not paused, enough budget left today
               -> signer.signAndSend(vault, [approve_request(id, hash) + 1 yocto, execute_request(id)?])
               -> poll get_request until the chain shows the result; only then report success
```

- **Signers.** testnet/mainnet: `@hot-labs/near-connect` (wallets run in sandboxed iframes). sandbox: `dev/dev-signer.ts`, a localhost process holding the sandbox owner key that signs only what the owner pages send on the local chain (ADR-033).
- **Routes.** `/` is the landing page (ADR-024); `?page=overview` is the dashboard; `?page=manage` is the owner's tools (fund, pause, agents, agent key, rules); `?page=new-vault` creates a vault; `?page=crosschain` prices and allows 1Click routes; `?page=security` is the Security Lab; `?request=<id>` is the approval page (the Telegram and MCP deep link target); `?page=legal` is Privacy and terms. Missing paths get a branded `404.html` from Caddy (ADR-026). `vault=` picks one of the build's vaults; a vault the build does not list is shown only if it runs a known build (`src/contracts.ts`) with no access keys, otherwise refused.
- **Owner pages (ADR-033).** Every transaction is built as data (`src/owner/actions.ts`) and shown on a review screen (`SignReview`) before the wallet is asked; on mainnet a confirmation box gates the Sign button. Creating a vault:

```text
named vault (ADR-035):
wallet (owner):  fetch public/contracts/spact_vault-p1.wasm, check sha256 against src/contracts.ts
                 CreateAccount + Transfer + DeployContract(wasm) + AddKey(function call: new, made in this tab) -> name.<owner>
this tab:        FunctionCall new(owner, agents, network, policy), signed with that key, waits for FINAL
any wallet (ADR-035):
wallet (owner):  Transfer -> hex(public key made in this tab), which creates that implicit account
this tab:        DeployContract + FunctionCall new(...) + DeleteKey(its key), signed with that key
page:            view_account code_hash == manifest, keys: none or only `new` keys (lockProblem), get_config as asked
```

- **1Click from the page.** Through the Railway image's same-origin proxy `/1click/` (three paths only). The approval page compares 1Click's record of a cross-chain request's deposit address with the request before Approve works, checks the address's token registration, and after the deposit polls `GET /v0/status` every 5 s, linking both chains' transactions to explorers it picks itself.
- **Dashboard.** Overview cards (waiting count, paused, policy version, stored requests); one card per allowlisted token with the vault's balance, today's budget (left, paid, reserved, reset time) and the limits; the open requests; agent activity (newest first, 50 per page, cards on phones); who can do what. It re-reads the chain every 15 s and signs nothing (ADR-021).
- **Local demo.** `scripts/dev-sandbox.sh` runs `demo-sandbox` (a Rust binary in `contracts/integration-tests` that deploys a funded vault on a local node), the dev signer and the dev server.
- **Browser tests.** `apps/web/e2e`, Playwright + Chromium against that same local setup, plus the production build served under `/Spact/` with no vault, the way GitHub Pages serves it.
- **Hosting.** Railway builds the root `Dockerfile` (Caddy, with security headers; ADR-025). The `pages` job in `ci.yml` publishes the same site from main to GitHub Pages after every job passed, with that run's `security-report.json` (ADR-023). With no `VITE_VAULT_ID` the site is the landing page and the Security Lab. Inside a frame the page renders nothing to click.

## MCP server (`apps/mcp`) [built]

A local stdio server for the agent's host, on `@modelcontextprotocol/server` 2.3.1 (ADR-018). Three tools (`request_cross_chain_payment` since ADR-033):

```text
request_payment(token, amount_units, recipient, reason, request_id)
  -> validate input (same rules as the vault)
  -> preflight: view_access_key is a function-call key for the vault, limited to the agent methods;
                get_config network and agent list match
  -> sign request_direct_payment with that key, wait for FINAL
  -> {policy_decision, onchain_status, reason_code, explanation, tx_hash, review_url?}
request_cross_chain_payment(token, amount_units, destination_asset, recipient, reason, request_id)
  -> off unless ENABLE_1CLICK_LIVE=true; preflight also needs request_cross_chain_payment on the key
  -> 1Click token list has the route; the owner's policy allows this route and recipient
  -> live quote (refund to the vault) -> crossChainArgs: refuse unless it answers exactly what was asked
  -> sign request_cross_chain_payment -> always AWAITING_APPROVAL, with the deposit address and review_url
get_payment_status(request_id)
  -> get_request + final block time -> {source_status | NOT_FOUND, reason_code, expiry by chain time}
  -> cross-chain and paid: + 1Click's status (reconcile), labelled as 1Click's report
```

The same preflight runs at startup, and the server exits if it fails. Tool results use fixed sentences; the agent's `reason` text is never echoed back.

## Telegram notifier (`apps/notifier`) [built]

A Node process with no NEAR keys and no webhook (ADR-020).

```text
every SPACT_POLL_SECONDS:
  count = get_config.request_count; fresh = list_requests(newest count - seen); recheck count
  for each fresh request, oldest first: AWAITING_APPROVAL and not expired by chain time -> alert
  for each alerted open request: status changed -> follow-up (paid / rejected / expired / failed)
link once: print a code on the terminal -> getUpdates until "/start <code>" from a private chat
```

The Bot API client validates every reply, waits for `retry_after` on 429, and never puts the bot token (part of the URL) in an error.

## Security Lab (`packages/security-lab`, `?page=security`) [built]

```text
test runners (cargo, vitest, Playwright) -> raw output in reports/ (one file per suite, hashed)
catalog.ts: T01..T18 -> exact test names
security-lab cli -> security-report.json: per case, the evidence and a status derived from it
web ?page=security -> validates the file, recomputes each status, flags contradictions
```

CI uploads every job's raw output as `report-*` artifacts. The `security-report` job merges them, builds the report and fails on any failed or missing test (ADR-022).

## Planned (not built)

| Component | Role | Authority |
|---|---|---|
| API (Hono on Workers) | relay agent requests, index events, send notifications | none: on-chain state wins |
| 1Click live use (P1) | the MCP tool, the cross-chain page and the approval page's check and tracking are built and tested against a mock 1Click and against live answers recorded on 2026-11-03; no live payment yet | trusted off-chain quote, signed by 1Click, disclosed |
