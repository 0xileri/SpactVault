# Status

Last updated 2026-11-03 (UTC). Network mode: **NEAR mainnet** since 2026-11-01, with a locked vault funded with 5 real USDC, of which the three demo payments on 2026-11-03 paid out 2.5 USDC (see "Mainnet deployment"). The testnet vault (since 2026-10-25) and the local sandbox stay for tests; testnet NEAR and the TUSD test token have no value.

## Milestone: AGENTS.md section 19 steps 1-5

| Step | State |
|---|---|
| 1. Verify rules and SDKs, write INTEGRATIONS.md | done; `HACKATHON.md` added from the owner's copy (live version not fetched) |
| 2. ARCHITECTURE, THREAT_MODEL, DECISIONS, STATUS | done |
| 3. Monorepo with lint/typecheck/test/build baseline | done (pnpm + cargo workspaces, CI workflow) |
| 4. Vault with owner/agent auth and policy validation, negative tests | done |
| 5. Mock NEP-141 + sandbox direct payment; reservation, failure, replay, concurrency, rollover | done (rollover in unit tests only) |
| 6. Dashboard, Telegram, wallet approval page, then P1 | dashboard, approval page and Telegram notifier built and tested on sandbox (Telegram against a mock Bot API); approval with a real wallet done on testnet; **P1 cross-chain route built and local tested (sandbox + mock 1Click); live 1Click quote and status answers recorded and tested (ADR-034); no live payment yet** (see "P1: NEAR Intents 1Click route") |

## P0 checklist (AGENTS.md section 4)

| # | Item | State |
|---|---|---|
| 1 | single owner + agent + one NEP-141 token | local tested (sandbox); deployed on testnet, and on **mainnet with native USDC** (see below) |
| 2 | policy with auto, daily and per-tx limits, allowlists, pause | local tested |
| 3 | agent requests via API/MCP; contract rejects unsafe requests | MCP server: local tested (sandbox, over stdio), **run on testnet from Claude Code** (paid, held for approval, blocked) and **run on mainnet from Claude Code on 2026-11-03** (the same three outcomes; see "Mainnet deployment"); **API not built** |
| 4 | auto payment executes with on-chain receipt | local tested (sandbox); on testnet the deploy script's `demo-auto-1` (3 TUSD) was paid by the agent's restricted key; **mainnet: `agent-mainnet-1` (0.5 USDC) was paid at once** ([`3ABgwMWy…`](https://nearblocks.io/txns/3ABgwMWyKiS24AYtHSXgzVggekiNx5cb6xi3EucNqiJP)) |
| 5 | larger payment awaits approval; Telegram notice | local tested: the notifier alerts on sandbox, then follows up when paid; **real Telegram delivery untested** (mock Bot API; api.telegram.org unreachable here) |
| 6 | owner wallet approves the exact request; executes once | local tested in a real browser (sandbox, dev signer); **testnet: the owner approved and paid `demo-approve-1` (25 TUSD) with Meteor Wallet on the hosted site**, and the page showed "Confirmed on chain" (owner's report, 2026-10-25); **mainnet: the owner approved and paid `agent-mainnet-2` (2 USDC) with Meteor Wallet on https://spactvault.xyz** ([`RqphTo2H…`](https://nearblocks.io/txns/RqphTo2Hy9ifsW7Y2PDXFM2A8gtcxu6GHdBuzfcP2oB), 2026-11-03). Other wallets untested |
| 7 | dashboard | local tested in a real browser (sandbox): balance, budget, open requests and activity match the chain; inconsistent budget data from the RPC is flagged; no tx hashes (no indexer) |
| 8 | Security Lab, at least 6 negative tests | local tested: generated report and page; 17 of 18 cases pass on a local chain, T10 in unit tests only, none uncovered (2026-11-02, with the P1 route; THREAT_MODEL.md); CI builds the report and publishes it with the site to GitHub Pages from main (ADR-023) |
| 9 | public app, README, video, submission | public repo; site live at https://spactvault.xyz (Railway) and https://0xileri.github.io/SpactVault/, both built for the mainnet vault, with a landing page and brand (ADR-024, ADR-027); README in progress; video and submission not started |

## P1: NEAR Intents 1Click route (2026-11-02)

DECISIONS ADR-032. **Local tested only:** a sandbox vault, a sandbox account standing in for a 1Click deposit address, and `MockOneClick` answers shaped by the official SDK's types. On 2026-11-03 the owner called the live 1Click API from their own machine (quotes and a status read, ADR-034), and those answers are now test fixtures. Nothing was deployed to testnet or mainnet, nothing was deposited and no funds moved. The deployed vaults run the earlier code and have no cross-chain route.

| AGENTS.md P1 item | State |
|---|---|
| 10. 1Click dry quote; token discovery; request parameters validated; quote terms captured and hashed | `packages/intents`: quote request builder (EXACT_INPUT, ORIGIN_CHAIN, refund to the vault), token-list route lookup, quote checks, canonical quote hash; mock-tested. The website's cross-chain page asks for a dry quote through the site's `/1click` proxy (ADR-033). A live dry quote and a live quote were recorded on 2026-11-03 from the owner's machine (this environment still cannot reach the host) and are tested, signatures included (ADR-034). The site's own `/1click` proxy has not called 1Click yet |
| 11. Human-approved NEAR-origin payment through 1Click, live statuses, refund state | vault `request_cross_chain_payment` (always owner-approved, deposit account and destination bound into the approved hash, quote deadline enforced, budget never re-credited), approval page and Telegram alert showing deposit address and final recipient apart, status reconciliation (`REFUND_UNVERIFIED`). The approval page now refuses to approve until 1Click's record of the deposit address matches, and follows 1Click's status with explorer links for both chains (ADR-033); **sandbox and mock 1Click only, no live payment yet** |
| 12. MCP bridge with a restricted spend-request capability | done: `request_payment` (ADR-018) and `request_cross_chain_payment` (ADR-033, live only with `ENABLE_1CLICK_LIVE=true`); the website makes agent keys for the three agent methods |
| 13. Approval expiry, idempotent retries, event reconciliation, quote mutation tests | quote expiry (QUOTE_EXPIRED) and quote mutation tests (T07, T14) added; event reconciliation and retries unchanged |

- **Vault:**
  - a new route `ONE_CLICK_ORIGIN_NEAR` with a `cross_chain` allowlist in the policy (off by default);
  - the request stores the quote's deposit account as its NEAR recipient, plus the destination tuple;
  - a delivered deposit ends at CROSS_CHAIN_PENDING with its budget spent; a failed one releases the reservation once.
- **Security Lab:**
  - T13: a 1Click refund report never restores budget, and tokens sent back to the vault do not either (sandbox);
  - T14: the review page shows the deposit address and the final payee apart; a swapped deposit address or payee fails the hash check or the vault (browser, sandbox and unit tests);
  - both are mapped in `packages/security-lab/src/catalog.ts`, and `scripts/security-report.sh` runs the new `vitest:intents` suite.
- **Unverified:**
  - the NEAR-origin deposit mechanics (plain `ft_transfer`; storage registration of the deposit account, which the approval page now checks and offers);
  - the live API's answers after a deposit (`SUCCESS`, `REFUNDED`, destination tx hashes); before a deposit they are recorded (ADR-034);
  - 1Click's token list (not recorded yet).
  - INTEGRATIONS.md has the sources.

### Live 1Click answers (2026-11-03)

DECISIONS ADR-034. Recorded by the owner with curl from their own machine (this environment cannot reach the host), no API key, nothing deposited. Fixtures: `packages/intents/test/fixtures/live`.

- **Does `/v0/status` answer for an unused deposit address?** Yes: HTTP 200 `PENDING_DEPOSIT`, with 1Click's full, signed record of the quote. The approval page's check works on it (web and intents tests on the recorded answer).
- **Is a plain `ft_transfer` the deposit 1Click detects?** Not confirmed. The docs say to transfer the tokens to the deposit address, without naming the NEAR call, and the deposit address is a contract-less implicit account, where only a plain `ft_transfer` can land. The first real deposit, in the mainnet run, settles it (ADR-033 has the citations).
- **Bugs the live answers exposed, now fixed:**
  - real status answers did not parse (null fields), which would have blocked every cross-chain approval;
  - the vault request was bound to the quote's deadline, three days after the one asked for, instead of the earlier one.
- **New, and checked:**
  - 1Click's ed25519 signature on a quote verifies with the manager key from its SDK;
  - the MCP tool, the approval page and the cross-chain page now refuse an unsigned or altered quote.
- **Not recorded:** the token list, and anything after a real deposit.

## Owner flows on the website (2026-11-03)

DECISIONS ADR-033. Everything the owner does now runs on the website with a browser wallet, each step shown on a review screen first, with a confirmation box on mainnet. **Tested on a local chain only**, with the sandbox dev signer standing in for the wallet; not yet run with Meteor on testnet or mainnet. 1Click's live answers are recorded (ADR-034), but the site's own `/1click` proxy has not called it yet.

| Flow | Where | State |
|---|---|---|
| Create a named vault (ADR-035): the wallet creates `name.<owner>` with the committed P1 wasm and a key that can only call `new`; the tab calls `new`; the page checks code hash, keys and settings | `?page=new-vault` | browser test on sandbox: code hash `5HwAUrjK…` on chain, one spent `new` key and no full-access key, owner and agents as asked; that key then fails to re-run `new` or deploy; resumes after a reload; the setup secret never sent |
| Create an any-wallet vault (ADR-035): the wallet only sends NEAR to a 64-hex account; the tab installs, starts and locks it in one transaction | `?page=new-vault` | browser test on sandbox: one wallet action (a transfer), no keys left, opens as a locked unlisted vault; reload then Cancel returns the NEAR |
| Fund: `storage_deposit` (if needed) + `ft_transfer`; top up NEAR | `?page=manage` | browser test: 10 TUSD in, no `ft_transfer_call` |
| Rules: limits, NEAR recipients, cross-chain routes, with a plain-language diff and the vault's own checks before signing | `?page=manage` | browser test: change signed and on chain (version 2); a policy the vault would refuse cannot be signed |
| Pause and unpause | `?page=manage` | browser test |
| Add and remove agents | `?page=manage` | browser test |
| Agent key: made in the browser, downloaded once, then the wallet creates the agent account with only a function-call key for three methods | `?page=manage` | browser test: one key on chain with exactly those methods and allowance, the secret never sent, and the agent pays with that key |
| Agent key, any wallet (ADR-035): the wallet sends NEAR to a 64-hex account; the tab adds the restricted key and deletes its temporary one; then `add_agent` | `?page=manage` | browser test: one wallet transfer, a reload before the swap resumes it, exactly the restricted key on chain, the agent pays with it |
| Cross-chain: dry quote, allow a recipient, list requests | `?page=crosschain` | browser test with the mock 1Click |
| Approval of a cross-chain request: checks the deposit address against 1Click, offers to register it with the token, then tracks 1Click's status | `?request=<id>` | browser tests with the mock 1Click: match, mismatch (T14), 1Click down, unregistered deposit, RPC and 1Click lying together (the vault still refuses), tracking with a Solana link built by the page |
| Several vaults per network, and unlisted vaults that run a known build and are locked (no keys, or only a spent `new` key) | header picker, `?vault=` | unit tests and a browser test |
| MCP `request_cross_chain_payment` and 1Click status in `get_payment_status` | `apps/mcp` | unit tests with `MockOneClick` |

**Wallet limits** (ADR-033, ADR-035): Meteor refuses a full-access `AddKey` for a website (owner's screenshot, 2026-11-03), so no step asks for one any more; a named vault sends the wasm through the wallet, an any-wallet vault or agent asks the wallet for a plain transfer only; `new` cannot be signed by a wallet, so the tab's setup key does it; every owner change is a separate wallet confirmation; key-file downloads may not work in a wallet's in-app browser. Unverified: that Meteor signs a named vault's 274 kB deploy and a function-call `AddKey` for a website (if not, **Any wallet** needs only a transfer), that the mainnet RPC accepts the ~370 kB any-wallet install transaction, and the other transaction shapes. ADR-035 has a table of what each step asks the wallet to allow.

## Mainnet deployment (2026-11-01)

Deployed by the owner with `scripts/deploy-mainnet.sh 0xileri.near 0xileri.near` from WSL Ubuntu (near-cli-rs 0.30.1), under DECISIONS ADR-028. The hosted sites read this vault: Railway (https://spactvault.xyz) through service variables, GitHub Pages through repository variables.

| | Account | Explorer |
|---|---|---|
| Vault | `vault.0xileri.near` | https://nearblocks.io/address/vault.0xileri.near |
| Owner and deployer (Meteor Wallet) | `0xileri.near` | https://nearblocks.io/address/0xileri.near |
| Agent | `agent.0xileri.near` | https://nearblocks.io/address/agent.0xileri.near |
| Payee | `api.0xileri.near` | https://nearblocks.io/address/api.0xileri.near |
| Token: native USDC, 6 decimals | `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` | https://nearblocks.io/address/17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1 |

Checked on 2026-11-01 with three read-only near-cli commands on the owner's machine (`network-config mainnet now`):
- **Vault keys** (`account list-keys`): none. The code is locked: nobody can redeploy it, the owner included.
- **`get_config`:** owner `0xileri.near`, agents `[agent.0xileri.near]`, network `mainnet`, `policy_version` 1, `request_count` 0, `open_approvals` 0, not paused. The view call ran the vault's wasm, so mainnet runs the rustc 1.97 build.
- **Balance** (`tokens view-ft-balance`): 5 USDC of the native USDC contract above.
- **Not checked yet:** the policy (`get_policy`), the agent's keys and the vault's code hash. Mainnet is unreachable from the build environment, so everything here comes from the owner's terminal output.
- **Agent:** the owner registered the MCP server in Claude Code with `SPACT_NETWORK=mainnet`, `ENABLE_MAINNET_TRANSFERS=true` and `SPACT_APPROVAL_URL=https://spactvault.xyz/`.

**Demo payments (2026-11-03).** The owner ran them from Claude Code 2.1.310 on their machine, through the repo's MCP server signing with `agent.0xileri.near`'s restricted key. All three went to `api.0xileri.near`, the owner's own payee account, in native USDC. Results are as the MCP tool and the approval page reported them, with hashes copied from the owner's screenshots and messages. The build environment cannot reach mainnet or nearblocks, so they were not re-read from chain here.

| Request | Amount | Result | Transaction |
|---|---|---|---|
| `agent-mainnet-1` | 0.5 USDC (500000) | `AUTO_APPROVED`, `SETTLED`: paid at once, under the 1 USDC instant limit | [`3ABgwMWy…`](https://nearblocks.io/txns/3ABgwMWyKiS24AYtHSXgzVggekiNx5cb6xi3EucNqiJP) |
| `agent-mainnet-2` | 2 USDC (2000000) | waited for the owner (over the instant limit, within the cap); the owner approved and paid it with Meteor Wallet on https://spactvault.xyz from the review link; `get_payment_status` then reported `SETTLED`, `approved_by: 0xileri.near` | request [`39dMJm5x…`](https://nearblocks.io/txns/39dMJm5xkDyqw5Mdjjm1JoNdLBkPrwwoJnQMPQaNN6HV); approval and payment [`RqphTo2H…`](https://nearblocks.io/txns/RqphTo2Hy9ifsW7Y2PDXFM2A8gtcxu6GHdBuzfcP2oB) |
| `agent-mainnet-3` | 4 USDC (4000000) | `BLOCKED`, `HARD_CAP_EXCEEDED`: over the 3 USDC limit per payment; nothing stored or sent (`get_payment_status` says not found) | refused request [`dpwtTTim…`](https://nearblocks.io/txns/dpwtTTimLp3Sq4RJcXpa3S45zcLdUwZ2bABHRKe22Q3) |

- **Total moved:** 2.5 USDC from the vault to the owner's own payee account. That should leave 2.5 USDC in the vault and 2.5 USDC of today's 5 USDC budget, neither read from chain here.
- **What it shows:** the three outcomes on mainnet with real funds. The vault paid the small request on its own, held the larger one until the owner's wallet signed the exact request, and refused the one over the cap.
- **Hash gap:** `get_payment_status` links only the request's own transaction. The vault stores no later transaction hashes and there is no indexer (ADR-021), so the approval hash came from the approval page.

## Testnet deployment (2026-10-25)

Deployed by the owner with `scripts/deploy-testnet.sh spact-ileri2.testnet 0xileri.testnet` from WSL Ubuntu (near-cli-rs 0.30.1, rustc 1.97.0). Testnet reported protocol version 88. The hosted site reads this vault (repository variable `VITE_VAULT_ID`).

| | Account | Explorer |
|---|---|---|
| Vault | `vault.spact-ileri2.testnet` | https://testnet.nearblocks.io/address/vault.spact-ileri2.testnet |
| Owner (Meteor Wallet) | `0xileri.testnet` | https://testnet.nearblocks.io/address/0xileri.testnet |
| Agent | `agent.spact-ileri2.testnet` | https://testnet.nearblocks.io/address/agent.spact-ileri2.testnet |
| Test token (TUSD, 6 decimals, no value) | `tusd.spact-ileri2.testnet` | https://testnet.nearblocks.io/address/tusd.spact-ileri2.testnet |
| Payee | `api.spact-ileri2.testnet` | https://testnet.nearblocks.io/address/api.spact-ileri2.testnet |

- **Vault code hash** (`view-account-summary`): `bb664f2a1b19734e5bbb8f01372d737fcc724ae008be284603c7dd4dc191c81c`, the same as the `spact_vault.wasm` the script built on the owner's machine from main at `824dac0`.
- **`get_config` after the deploy:** owner `0xileri.testnet`, agents `[agent.spact-ileri2.testnet]`, network `testnet`, `request_count` 2, `open_approvals` 1, not paused.
- **Agent keys** (`list-keys`): one full-access key, which stays with the operator, and one function-call key that can only call `request_direct_payment` and `execute_request` on the vault. That key's allowance went from 0.25 to 0.2490 NEAR for the two requests.
- **Vault keys:** one full-access key, in the operator's `~/.near-credentials`. Whoever holds it can redeploy the vault (THREAT_MODEL).
- **Approval:** `demo-approve-1` was approved and paid from https://0xileri.github.io/Spact/?request=demo-approve-1 with Meteor Wallet. The transaction hash is not recorded here yet; the vault's explorer page lists it.
- **Not checked from the build environment:** testnet is unreachable from here, so the facts above come from the owner's terminal output and wallet.
- **First attempt:** an earlier run with deployer `spact-ileri.testnet` used a placeholder owner name (`ileri-owner.testnet`) instead of the owner's wallet account. That vault cannot be approved by the owner and is abandoned; it holds only test tokens. The script now refuses an owner account that does not exist, and a deployer that was used before, before it builds or spends anything.
- **Agent on testnet (2026-10-25):** Claude Code 2.1.310 in WSL Ubuntu, with the MCP server registered by `claude mcp add` (local scope) using the restricted key file and `SPACT_APPROVAL_URL=https://0xileri.github.io/Spact/`. Results as reported by Claude Code and the owner:

  | Request | Amount | Result |
  |---|---|---|
  | `agent-auto-1` | 5 TUSD | `AUTO_APPROVED`, `SETTLED`: [`FCHU8BxD…`](https://testnet.nearblocks.io/txns/FCHU8BxDHkerijBpSKo8j7BVEZLdnppbixvYbDhU1Y1N). The tool was not loaded in that session (see below), so Claude started the built server from a script and called `request_payment` through it; the server's startup checks passed first |
  | `agent-approve-1` | 12 TUSD | through the MCP tool: `OWNER_APPROVAL_REQUIRED` with the review link, request transaction [`7VpgQUxR…`](https://testnet.nearblocks.io/txns/7VpgQUxRwkBt7na3w4w5EMkxGnjUZQYNF5na1koSrQKc); then `SETTLED` after the owner approved it as `0xileri.testnet` on the site |
  | `agent-blocked-1` | 5 TUSD to `evil.testnet` | `BLOCKED`, `RECIPIENT_NOT_ALLOWED`; nothing stored or sent |
  | `agent-pay-1` | 1 TUSD | `SETTLED` under the auto limit |

- **What the agent run showed:**
  - *Lost registration.* The first `claude mcp add` ran before Claude Code's first-run setup, and was gone after it (`claude mcp get spact` found nothing). Adding it again after the setup stuck. apps/mcp/README.md now says to finish the setup first.
  - *The vault is the boundary, not the tool.* Without the tool, Claude in auto mode reached the vault anyway by running the server from Bash. It could only do what the restricted key and the vault allow, which is the design (THREAT_MODEL).
  - *A confusing "Confirmed".* After the first approval attempt the owner saw "Confirmed on chain" while the vault still showed the request waiting. Reopening the link fresh, the approval went through. The page only prints that banner after reading the request as settled, so the likeliest cause is an older tab from `demo-approve-1`. This was not reproduced.
- **Build reproducibility:** the same source built in this environment gives `70803e02…` instead of `bb664f2a…`. The wasm embeds build-machine paths (e.g. `/root/.cargo/registry/...`). Remapping that one path did not reproduce the deployed hash, so another difference remains. Anyone checking the deployed code against the source cannot do it bit for bit yet.

## Tests (last full run 2026-11-03; deploy rehearsal 2026-10-25)

| Command | Result |
|---|---|
| `scripts/security-report.sh` (2026-11-03, any-wallet setup, ADR-035) | **336 tests in 11 suites passed, 0 failed**: vault unit 66, mock-ft 1, sandbox 19, shared 26, intents 25, web 79, mcp 33, notifier 28, mcp over stdio on sandbox 11, notifier on sandbox 4, browser 44 (14 owner flows: 3 new, 2 rewritten). Report: 17 cases passed on a local chain (T01-T09, T11-T18), T10 unit only, none uncovered. Two earlier runs failed and were fixed: the init key's allowance could not cover `new` at 100 Tgas (now 30 Tgas), and the sandbox owner ran out of NEAR for the extra vaults (now 40 NEAR) |
| `scripts/security-report.sh` (every suite, then the report; 2026-11-03, live 1Click answers and signature checks) | **329 tests in 11 suites passed, 0 failed**: vault unit 66, mock-ft 1, sandbox 19, shared 26, intents 24 (8 on the recorded live answers), web 76 (4 on them), mcp 33 (2 on them), notifier 28, mcp over stdio on sandbox 11, notifier on sandbox 4, browser 41. Report: 17 cases passed on a local chain (T01-T09, T11-T18), T10 unit only, none uncovered. The first report build stopped on a catalog note over 400 characters; the note is shorter and a Security Lab unit test now catches that. Afterwards, the token-list change (skip entries that do not parse) added one intents test, run with its suite, lint and typecheck: intents 25 |
| `scripts/security-report.sh` (2026-11-03, owner flows on the website) | **313 tests in 11 suites passed, 0 failed**: vault unit 66, mock-ft 1, sandbox 19, shared 26, intents 16, web 71, mcp 31, notifier 28, mcp over stdio on sandbox 11, notifier on sandbox 4, browser 40 (11 new owner-flow tests, 4 new cross-chain tests). Report: 17 cases passed on a local chain (T01-T09, T11-T18), T10 unit only, none uncovered |
| `scripts/security-report.sh` (2026-11-02, P1 branch) | **263 tests in 11 suites passed, 0 failed**: vault unit 66, mock-ft 1, sandbox 19, shared 23, intents 14, web 48, mcp 24, notifier 28, mcp over stdio on sandbox 11, notifier on sandbox 4, browser 25. Report: 17 cases passed on a local chain (T01-T09, T11-T18), T10 unit only, none uncovered |
| `scripts/test-contracts.sh` | vault unit 66 passed; mock-ft unit 1 passed; sandbox 19 passed (2026-11-02) |
| `cargo clippy --workspace --all-targets -- -D warnings` (in `contracts/`) | clean |
| `cargo fmt --all --check` | clean |
| `pnpm lint && pnpm typecheck && pnpm test && pnpm build` | clean; shared 23, intents 14, web 48, mcp 24, notifier 28, security-lab 8 passed (2026-11-02) |
| `pnpm notifier:sandbox` (built notifier, local sandbox, mock Bot API) | 4 passed: links only the private chat with the terminal's code (group, wrong code and forged button ignored); alert with exact terms and the approval page as the only link; follow-up after the owner approves and pays; after a restart no repeats, and a new request is alerted with the link in its note defanged |
| `pnpm mcp:sandbox` (built MCP server over stdio, local sandbox) | 11 passed: two tools only; auto payment settles; larger request waits, then is paid after the owner approves; hard cap blocked; T18 prompt-injected request to an unlisted account blocked; duplicate id not paid twice; bad input sends nothing; startup refused with a full-access key, a key for another contract, or a missing key |
| `pnpm e2e` (Chromium, local sandbox; the agent signs with its function-call key) | 19 passed: the landing page's headline, its hero example uses amounts from the vault's limits and says why each ends as it does, its main button leads to the three steps, the rules match the policy, its live numbers match the chain, and it fits a 390 px screen; the hero plays paid, waiting for Approve and refused in turn, pauses off screen, sections fade in as they are reached, and with reduced motion the hero is one still frame of all three outcomes and everything shows at once; the published site has a working skip link, a Privacy and terms page and a branded 404; the production build under `/Spact/` with no vault serves the landing page and the Security Lab, says no vault is connected elsewhere, carries share-card tags with absolute URLs, serves its image, and makes no request outside its own host; inside a frame neither site draws anything to click; the Security Lab page shows cases, evidence and the CI run link; a report that contradicts its own evidence is not believed; a missing or broken report is named as such; dashboard matches the chain (balance, budget, waiting request, activity rows that say what happened and why); a tampered budget is flagged instead of shown; approve and pay (the page says why it waits, and what happened once paid), reject, altered recipient flagged, forged hash refused by the vault, non-owner blocked, foreign-vault link refused, open-request list |

Manual check on a testnet build: the near-connect wallet selector opens with no page errors and lists Meteor, Intear, Ledger, Nightly, Ethereum wallets and NEAR CLI (2026-10-24).

GitHub Actions `ci` run 1 (commit `8b91f83`) passed both jobs. The contracts job ran all 8 sandbox tests on the hosted runner without the rlimit shim.

Measured: an auto payment (request + ft_transfer + callback) burnt about 7 Tgas in sandbox.

Mainnet preparation (2026-10-30), DECISIONS ADR-028. The owner deployed it on 2026-11-01 (see "Mainnet deployment").
- **Owner's choices:** native USDC, a 5 USDC float with limits of 1 / 3 / 5 USDC, and the vault's code locked after the deploy.
- **Security gates:**
  - T07 (expired approvals) and T15 (approvals for another vault, network or policy version) gained five on-chain sandbox tests, which pass.
  - T10 stays unit-only, and the Security Lab says why.
  - CI builds the next report from these.
- **`scripts/deploy-mainnet.sh`:**
  - checks the chain, protocol version, accounts, token metadata and balances before spending;
  - prints the cost and the most you can lose, and waits for a typed confirmation;
  - creates the vault, agent and payee and sets the limits;
  - registers USDC storage and moves the float into the vault;
  - deletes the vault's full-access key and checks that none is left.
- **`scripts/rehearse-mainnet-sandbox.sh`** runs that script unchanged on a local node with a stand-in USDC. All 20 checks passed:
  - refused before spending: a wrong token, no float, no confirmation, and a second run;
  - a redeploy of the locked vault was refused, and it has no access keys;
  - limits, payee, agent key, the paid and waiting demo requests, and the owner withdrawing 1 USDC from the locked vault.
- **USDC contract id:** confirmed by the deploy, which checks the token's metadata on chain before spending, and by the vault's 5 USDC balance (INTEGRATIONS "Mainnet").
- **Site:** on mainnet the footer says real funds are involved. Switching a site is three variables.

Network switch (2026-11-01), DECISIONS ADR-031:
- **What:** one site can show a second network's vault. The top bar gets a Mainnet/Testnet switch; links stay on the chosen network. Approval links from the MCP server and the Telegram alert now name their vault, so they open on the right network.
- **Settings:** `VITE_TESTNET_VAULT_ID` (or `VITE_MAINNET_VAULT_ID`) with its RPC, passed through the Dockerfile and the Pages job. The hosted sites need it set to show the switch.
- **Checked:**
  - lint and typecheck;
  - 45 web unit tests, 8 of them new for config and network choice;
  - MCP 24 and notifier 27 unit tests;
  - MCP 11 and notifier 4 sandbox tests, with the new link format;
  - 21 of 21 e2e tests: the switch moves the whole site and its links, an approval link opens on its vault's network, a self-contradicting link is refused, and the phone layout still fits.

Plain-language dashboard and approval page (2026-11-01), DECISIONS ADR-030:
- **Why:** the owner asked for the same treatment as the landing page.
- **Dashboard:**
  - money in the vault, money left today and the waiting count come first;
  - waiting requests have the agent's note and a Review button;
  - each activity row says what happened and why, instead of reason codes;
  - then the rules, and who is who.
- **Approval page:**
  - the ask and the agent's note come first, then why it waits and when it expires;
  - a "Safety check" box replaces the hash-check wording;
  - the decision card holds the budget left and the wallet prompt;
  - technical details are folded away;
  - a decided request says what happened.
- **Checked:**
  - lint, typecheck and 37 web unit tests (4 new for `outcomeLine`);
  - 19 of 19 e2e tests on a local sandbox, including the plain activity lines, why a request waits, and what a paid request says;
  - screenshots at 1280 and 390 px.

Plain-language landing page (2026-11-01), DECISIONS ADR-029:
- **Why:** the owner found the site confusing.
- **What changed:**
  - a new headline ("Give your AI agent a budget, not your wallet");
  - a hero that lists three example payments and says in words why each is paid, waits for Approve, or is refused;
  - a "How it works" section with three steps;
  - static rule cards in plain words, and plain labels on the live numbers;
  - an updated share card.
  - The gate animation and the per-card loops are gone.
- **Checked:**
  - lint, typecheck and 33 web unit tests;
  - 19 of 19 e2e tests on a local sandbox, including the hero's order (paid, then Approve, then refused), pausing off screen and the reduced-motion still frame;
  - screenshots at 1280 and 390 px, with no horizontal scroll on the phone.

SpactVault brand (2026-10-30), DECISIONS ADR-027:
- **Name:** the product is SpactVault. The site, share card, 404 page, Telegram link message and MCP tool titles say so; code and package names stay `spact`.
- **Mark:** a Space Grotesk Bold S woven through a V, on a white tile, in violet ink `#140f2b` and violet `#6a4cff`. The favicon, PNG icons and share card are regenerated from `apps/web/src/brandMark.ts`.
- **Palette:** a cool near-white page, white cards and zinc grays. Violet marks primary links, focus rings and the Approve button in the animations; the paid, waits and blocked colors are unchanged.
- **Repository renamed** to `0xileri/SpactVault` by the owner. GitHub Pages moved to https://0xileri.github.io/SpactVault/. The `Dockerfile` report and repo defaults, the README and the MCP setup example now point there.
- **Domain:** https://spactvault.xyz is live on Railway. Railway reports the DNS record propagated, the domain verified and its certificate valid (2026-10-30).
- **Rest of the repository:** current docs, package descriptions and file headers say SpactVault. History in DECISIONS and STATUS keeps the old name. Code identifiers, the `spact-vault` contract crate, `SPACT_*` variables, test names and the deployed token metadata are unchanged.
- **Brand kit:** `brand/` has the avatar, logo, icon and GitHub social preview, generated with the site's icons by `apps/web/dev/render-brand.ts` (see `brand/README.md`).

Redesign skill pass (2026-10-25/26), DECISIONS ADR-026:
- **What changed:** one typeface (Space Grotesk) plus Geist Mono, Phosphor icons, a spacing scale, one motion curve and a grain overlay, all in the ADR-024 colors. A floating pill nav, loading skeletons, a skip link, a Privacy and terms page and a branded 404.
- **Second pass:** the owner found the first pass too busy. The landing page is now three sections (hero, the three rules, the live vault), and the hero is an animated graphic of the vault's gate. In it, one request is paid, one waits for the wallet and is approved, and one is blocked. Its amounts are picked from the vault's own limits. Each rule card plays a short loop of its own outcome.
- **Motion:** the graphic and the cards loop while on screen and pause off screen; rules and live numbers fade up as they are reached. With reduced motion every loop is one still frame and everything shows at once. All of it is e2e-tested.
- **Checked:** `scripts/check-web-image.sh` now has 16 checks (the 404 page is the branded one) and passed all 16 against a local Caddy. Screenshots at 1280 and 390 px; the phone view has no horizontal scroll.

Railway and redesign (2026-10-25):
- **Owner check:** Railway serves the site at `spact.up.railway.app` with the testnet vault, and `scripts/check-web-image.sh` passed all 15 checks from the owner's machine.
- **Image:** a root `Dockerfile` serves the site with Caddy 2.11.7 and real security headers (DECISIONS ADR-025).
- **Local check:** Caddy's own release binary (checksum verified) served a production build here. `scripts/check-web-image.sh` passed all 15 checks: headers on the page and assets, a one-year cache for hashed assets, share tags, a 404 for unknown paths, and path traversal refused. Against a plain server without the headers it reports 9 failures.
- **Docker:** no daemon runs here, so the image itself is first built and run by CI's `web-image` job.
- **Not checked from here:** whether GitHub Pages lets other sites read the report (CORS), which the Railway site needs; `github.io` is unreachable from here.
- **Redesign:** the landing page got a hero with an example flow, the outcomes band, how it works, a wallet-versus-Spact comparison, the live vault, a Security Lab section, a get-started terminal and a footer. The skill pass above replaced its header, type and dark section.

Landing page and brand (2026-10-25): `/` is now a landing page (DECISIONS ADR-024). It says what Spact is, states the three outcomes in the configured vault's own limits read from its policy, shows live numbers from chain and the Security Lab counts from the CI report. The dashboard moved to `?page=overview`; approval links are unchanged. Brand: ink on paper, the outcomes as signal colors (paid, waits, blocked), a gate logo, Space Grotesk bundled with the site, favicons and a share card rendered by `apps/web/dev/render-brand.ts`. Checked by screenshot at 1280 and 390 px.

Deploy script checks (2026-10-25): before building or spending anything, `scripts/deploy-testnet.sh` now stops if the owner account does not exist or the deployer was used before. It also passes `--signature-scheme ed25519`, because near-cli-rs 0.30.1 asks in a terminal and the agent's MCP server reads only ed25519 keys. `scripts/rehearse-deploy-sandbox.sh` passed 12 checks: a missing owner refused before building, the full deploy, a second run with the same deployer refused before building, the refused NEAR transfer, and the eight chain checks. With a fake RPC that answers an error, the account check stops the script instead of reading the error as "no account".

Testnet deploy rehearsal (2026-10-24): `scripts/rehearse-deploy-sandbox.sh` ran `scripts/deploy-testnet.sh` unchanged with near-cli-rs 0.30.1 against a fresh sandbox node (protocol version 86). All six checks passed: vault owner and network set, the 3 TUSD request SETTLED, the 25 TUSD request AWAITING_APPROVAL, payee balance 3 TUSD, vault balance 997 TUSD. Commands come from the NEAR docs (`near/docs` @ `04d956c`, see INTEGRATIONS.md). Not covered: the faucet, the testnet network itself, and wallet signing.

GitHub Pages (2026-10-24): the `pages` job in `ci.yml` publishes the site from main after every job passed, with that run's Security Lab report (ADR-023). With no vault configured, the site is the Security Lab alone. The browser suite builds the site the same way and serves it under `/Spact/`. With the frame guard or `base: "./"` removed, the new tests fail. `actionlint` 1.7.12 passes the workflow. Live since 2026-10-24 at https://0xileri.github.io/Spact/; the first deploy failed until Pages was turned on (source: GitHub Actions), as expected. Since 2026-10-25 it is built with `VITE_VAULT_ID=vault.spact-ileri2.testnet`.

Security Lab (2026-10-24): the approval site has a Security Lab page (`?page=security`) built from a report that is generated from real test runs (DECISIONS ADR-022). The full local run matched every catalog entry to a test that ran and passed. CI builds the same report from its jobs' artifacts.

Dashboard (2026-10-24): `/` now shows the vault's balance and today's budget per token, the open requests, agent activity and who can do what, all read from chain (DECISIONS ADR-021). Checked at 1280 px and 390 px wide with no horizontal scroll; on phones the activity table becomes cards.

Telegram notifier (2026-10-24): `apps/notifier` alerts the owner when a payment waits and follows up when it settles (DECISIONS ADR-020). It is tested against a mock Bot API, because Telegram is unreachable from here. The sandbox test caught a real bug: the first version assumed `list_requests` is oldest first (it is newest first) and missed requests that came after its first pass.

Rename (2026-10-24): the project is now Spact (DECISIONS ADR-019), including the hash domain and event standard. After the rename all suites passed again: contracts (51 unit, 1 mock-ft, 10 sandbox), TypeScript (shared 19, web 14, mcp 24), `pnpm e2e` 7, `pnpm mcp:sandbox` 11, and the deploy rehearsal's 10 checks.

MCP server (2026-10-24; testnet 2026-10-25, see "Testnet deployment"): `apps/mcp` gives the agent `request_payment` and `get_payment_status` over stdio, signed with its function-call key (DECISIONS ADR-018). With an isolated config, `claude mcp add` plus `claude mcp list` (Claude Code 2.1.310) showed the sandbox server as `Connected`. Codex was not available here to try.

Agent key (2026-10-24): the agent now signs with a function-call key that reaches only the vault's `request_direct_payment` and `execute_request` (DECISIONS ADR-017). Sandbox tests `t19_*` and `t20_*` show that it works for requests and execution, and that the protocol rejects everything else: other contracts, other vault methods, deposits, NEAR transfers, adding keys, deleting the account, and use after the allowance runs out. The rehearsal now runs the deploy script's own key step and passes ten checks: the key's receiver, methods and allowance, a refused NEAR transfer, and the six earlier ones. Two agent requests used 0.00092 NEAR of the 0.25 NEAR allowance.

## Unresolved risks

- Eligibility of code written before 2026-11-01 (DECISIONS ADR-000).
- On testnet the vault account's full-access key can redeploy the code (THREAT_MODEL). The mainnet vault has no keys.
- The agent account's full-access key stays on the owner's machine, on testnet and on mainnet (ADR-017, ADR-028).
- No reconciliation path for a stuck TRANSFER_PENDING; no storage pruning.
- Only Meteor Wallet has signed an approval; other wallets are untested.
- The vault wasm is not reproducible across build machines, so the deployed code hash cannot yet be checked bit for bit against the source.
- No Content-Security-Policy, and framing is refused by script rather than a `frame-ancestors` header, which GitHub Pages cannot send (ADR-023).
- P1: after the deposit, 1Click is trusted; the vault cannot verify delivery or a refund (ADR-032, THREAT_MODEL).
- P1: the agent files the quote's deposit address. The approval page now checks it against 1Click's own record (ADR-033), but that check is only as good as 1Click's answer and the site's proxy.
- Website owner flows: tested on a local chain only; Meteor has not signed a vault creation, a funding, a rules change or an agent key yet. Its first try refused the old full-access key (ADR-035). Between the two vault-creation transactions a setup key sits in the tab, and the site has no Content-Security-Policy (THREAT_MODEL). A named vault keeps one spent function-call key for `new`.
- P1: NEAR-origin 1Click deposit mechanics are unverified: that 1Click detects a plain `ft_transfer`, and whether the implicit deposit account needs registering with USDC (the approval page offers it). The first real deposit settles both (ADR-033).
- P1: the 1Click manager key is fixed in code (ADR-034). If 1Click rotates it, cross-chain quotes and approvals fail closed until the key is updated from its SDK.

## Next smallest task

Record 1Click's token list as a fixture (the owner's `tokens.json` from 2026-11-03, or a fresh `GET /v0/tokens`) and run `findRoute` and the cross-chain page's destination list against it. Base was not quoted yet; one dry quote to USDC on Base would cover the second chain the owner may pick.

Then the mainnet run, on https://spactvault.xyz with Meteor, each step confirmed by the owner (README "Run your own vault from the website"): create `vault2.0xileri.near`, fund it with about 3 USDC, create `agent2.0xileri.near` with its key, allow one recipient, let the agent request 1 USDC cross-chain through the MCP server, approve it, and record every transaction hash, the deposit address and 1Click's final status here. Only after the owner confirms: point the site's mainnet config at vault2 with `vault.0xileri.near` listed as the P0 vault (`VITE_VAULT_ID=vault2.0xileri.near`, `VITE_EXTRA_VAULTS=vault.0xileri.near=P0 vault`).

Still open from before: the testnet approval transaction hashes for `demo-approve-1` and `agent-approve-1`, if the owner has them.

Then, on the owner's machine: with a bot from @BotFather, run the notifier (apps/notifier/README.md) against the testnet vault and check that the alert arrives on the phone.
