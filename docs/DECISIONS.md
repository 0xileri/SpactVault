# Decisions

Short ADRs. Each records the date, the choice, and why.

## ADR-000: Implementation started on 2026-10-23, after the announcement (2026-10-23, settled 2026-11-04)

The owner told the coding agent to start building on 2026-10-23. NEAR HACKATHON was announced on 2026-10-19, and the live `HACKATHON.md` (synced into this repository on 2026-11-04) settles it in Q-001: code written from the announcement onward is allowed, and anything older is baseline. The first commit, `19d6119`, is from 2026-10-23 22:01 UTC, so every commit is in scope and there is no baseline. This is allowed, not a risk.

Provenance (Q-003): the README section "Built during NEAR HACKATHON" says so and lists the merged pull requests by date. The tag `pre-hackathon` marks the first commit and `hackathon-submission` main as submitted, so the compare view between them shows everything built. The owner creates and pushes both tags.

Before 2026-11-04 this ADR read the owner's copy of 2026-10-23, which gave the start as 2026-11-01 with no rule on earlier code, and left eligibility as an open question for the organizers.

## ADR-001: P0 supports direct NEP-141 payments on NEAR only (2026-10-23)

`Route` has a single variant, `NearDirect`. The 1Click route is a separate, owner-approved adapter (AGENTS.md section 8) and needs its own state and tests. It is not a generic withdrawal. (ADR-032 adds that route, as a separate request type.)

## ADR-002: Owner methods require exactly 1 yoctoNEAR (2026-10-23)

Function-call access keys cannot attach deposits, so `assert_one_yocto` means owner actions need a full-access key signature, typically a wallet confirmation. A function-call key the owner gave a dApp or backend cannot approve payments or change policy. Shown in sandbox (`DepositWithFunctionCall`).

## ADR-003: Build wasm with cargo flags instead of cargo-near; no wasm-opt (2026-10-23)

cargo-near was not installed in the build environment. `scripts/build-contracts.sh` uses cargo-near's default flags (`-C link-arg=-s --cfg near`), and the vault builds to about 248 KB without wasm-opt. **Revisit** before mainnet: reproducible builds (cargo-near docker) and a published code hash.

## ADR-004: Blocked requests are returned and logged, not stored (2026-10-23)

The vault pays storage for agent requests. Storing every blocked attempt would let a compromised agent drain the vault's NEAR balance through storage. Blocked requests return `BLOCKED` with a reason code and emit `request_blocked`. A blocked id can be retried because it never entered execution.

## ADR-005: Approval and execution are separate methods (2026-10-23)

`approve_request` changes no balances. `execute_request` rechecks pause, version, expiry, agent membership and budget at execution time, which is what T09 needs. A client can put both calls in one transaction when the owner wants a single signature.

## ADR-006: Policy limits (2026-10-23)

- `auto_limit` may be 0, meaning every payment needs approval. This differs from the spec's "all limits positive"; it is safe because amounts must be > 0.
- `hard_tx_limit <= daily_limit` is enforced, since a larger cap could never execute.
- Fixed bounds: 8 tokens, 64 recipients, 8 agents, 1-100 open approvals, 1-1000 stored requests per day, approval TTL of 60 seconds to 7 days.

## ADR-007: Atomic intermediate states are not stored (2026-10-23)

AUTO_AUTHORIZED -> RESERVED -> TRANSFER_PENDING happen within one receipt, so the stored status jumps straight to TRANSFER_PENDING. For direct NEAR payments SOURCE_CONFIRMED and SETTLED are the same moment, so only SETTLED is stored.

## ADR-008: Any policy change invalidates open requests (2026-10-23)

Requests record `policy_version`. Approval and execution require the current version. This is strict but simple, and it guarantees an approval never runs under limits the owner didn't see.

## ADR-009: Approval binds to a client-computed hash (2026-10-23)

The owner's client hashes the terms it displays and passes that hash to `approve_request`. Binding vault id, network and policy version into the hash covers T15. This needs no custom signature scheme: the NEAR transaction signature carries the authority.

## ADR-010: Init only by the vault account itself (2026-10-23)

`new` requires predecessor == current account, so a third party cannot initialize a deployed but uninitialized vault. Deploy and init should go in one batch transaction (as in the sandbox tests).

## ADR-011: TypeScript 6.0 (2026-10-23)

`typescript-eslint` 8.71.1 supports `typescript <6.1.0`. Move to 7.x when it is supported.

## ADR-012: Organizer rules on agent actions (2026-10-23)

`HACKATHON.md` requires explicit human confirmation before the agent submits, posts on X, makes the repo public, pushes, signs transactions, spends tokens or deploys to mainnet. This matches AGENTS.md. The owner approved pushes to the open PR branch while the agent watches it; everything else on that list still needs a fresh yes.

## ADR-013: The approval page reads the chain directly (2026-10-24)

There is no backend yet, and the approval page does not need one: it calls view methods over RPC and validates the JSON. It hashes the displayed terms with the network and vault id from its own build config, not from the RPC. A compromised RPC can mislead the owner about state, but cannot get them to approve different terms (THREAT_MODEL, approval page section).

## ADR-014: Approve and pay in one transaction by default (2026-10-24)

The page sends `approve_request` (1 yocto) and `execute_request` as two actions in one transaction, so the owner signs once. If execution fails (paused, budget), the whole transaction reverts, including the approval. Unticking "Pay immediately" sends only the approval, and the agent executes later.

## ADR-015: near-connect for wallets, a local dev signer for sandbox (2026-10-24)

`@hot-labs/near-connect` runs each wallet's code in a sandboxed iframe and has no dependencies. Wallets do not support a local sandbox, so sandbox uses `apps/web/dev/dev-signer.ts`: it holds the sandbox owner key in a separate local process, binds to 127.0.0.1, refuses non-local RPCs, and signs only approve/reject/execute calls to the demo vault with at most 1 yocto. The page refuses `VITE_DEV_SIGNER_URL` outside sandbox.

## ADR-016: Every sandbox account gets its own random key (2026-10-24)

near-workspaces gives every subaccount the same deterministic key unless one is passed. The PR #1 tests still proved the contract checks the predecessor account, but with shared keys the agent's key could also sign as the owner. `integration_tests::account` now creates each account with `SecretKey::from_random`.

## ADR-017: The agent signs with a function-call key limited to two vault methods (2026-10-24)

The agent's key can call only `request_direct_payment` and `execute_request` on the vault. The contract already checks the caller (I2, I5); the key adds a protocol-level limit, so a leaked agent key cannot transfer NEAR, add keys, delete the account, attach the 1 yocto owner methods need, or call any other contract or vault method (sandbox `t19_*`).

In sandbox tests `t19_*` and `t20_*` and in the local demo, the agent's full-access key is deleted. On testnet, `scripts/deploy-testnet.sh` adds the function-call key, writes it to a separate file for the agent runtime, and leaves the full-access key in the operator's keychain. The allowance is a gas budget that only goes down, and once it runs out only a full-access key can add a new key (NEAR docs, `protocol/accounts-contracts/access-keys.mdx`). Default allowance: 0.25 NEAR. In the deploy rehearsal, two requests (one paid, one waiting for approval) used 0.00092 NEAR of it. Whether to delete the full-access key on mainnet is open.

## ADR-018: The agent's MCP server (2026-10-24)

`apps/mcp` is a local stdio server with exactly the two tools AGENTS.md section 9 names.

- **SDK:** `@modelcontextprotocol/server` 2.3.1, the v2 line the SDK repo calls stable. Over stdio it serves both 2025-era clients (`initialize`) and 2026-07-28 clients. 2.4.0 came out the day before this decision, so the pin is the previous release.
- **Names:** `request_payment` and `get_payment_status`, without the `spact.` prefix in AGENTS.md. The server is named `spact`, and hosts already prefix tool names with the server name (Claude Code shows `mcp__spact__request_payment`).
- **Key:** the server signs with the agent's function-call key (ADR-017). It reads the key's permission from chain at startup and before every request, and refuses a full-access key, a key for another contract, a key with extra methods, a vault on another network, or an agent the vault does not list. The vault enforces the policy regardless.
- **Finality:** it waits for `FINAL` before answering, so a reported `SETTLED` is in final blocks. A sandbox test caught the earlier optimistic answer running ahead of final reads.
- **Untrusted text:** tool results use fixed sentences and reason-code explanations. The agent's `reason` goes to the owner and is never echoed back to the model.
- **No execute tool yet:** if the owner approves without paying (ADR-014, "Pay immediately" unticked), the agent cannot execute through MCP. The key allows `execute_request` for when that tool is added.

## ADR-019: The project is renamed Spact (2026-10-24)

The owner renamed the project from SpendPact to Spact and the GitHub repo to `0xileri/Spact`. Nothing is deployed yet, so the rename covers the on-chain identifiers too: the request-hash domain is now `spact.request.v1` (new test vector in INTEGRATIONS.md, recomputed with Python `hashlib`), the NEP-297 event standard is `spact`, and the transfer memos are `spact:<request_id>`. Packages are `@spact/*`, the crate is `spact-vault`, MCP environment variables are `SPACT_*`, and the MCP server is named `spact`. `HACKATHON.md` is the organizer's text and is unchanged. After a deploy, changing the hash domain or event standard would break approvals and indexers, so later renames should stay cosmetic.

## ADR-020: Telegram alerts from a polling notifier with no webhook (2026-10-24)

`apps/notifier` is a small Node process the owner runs. It polls the vault over RPC and sends Bot API `sendMessage` calls. AGENTS.md puts notifications in the Hono API on Workers, and that API is not built. The notifier is the smallest piece that delivers the alert, and it can move into the API later.

- **No webhook:** updates are read with `getUpdates` only while a chat is being linked. With no public endpoint there is no webhook secret to verify (AGENTS.md section 7, bot hardening).
- **Binding:** the notifier prints a one-time code (12 random characters, valid 10 minutes) on its own terminal. Only a private chat that sends exactly `/start <code>` is bound. This proves control of the machine running the notifier, which holds the bot token. It does not prove control of the owner wallet; a wallet-signed binding (NEP-413) is open. The bot cannot approve or move anything, so a wrong binding leaks alerts but cannot pay.
- **Message safety:** plain text with no `parse_mode`. The agent's note is labeled, cleaned and has its links defanged, so the approval link is the only link. URL buttons only for https links.
- **Scanning:** `list_requests` is newest first, so new requests are found from `request_count`, read before and after listing (the vault never removes requests). A first version assumed oldest-first and missed requests after the first pass. The sandbox test caught that.
- **Idempotency:** state is saved after each message. A crash between the send and the save can repeat one alert, never skip one.
- **Telegram API:** the Bot API docs and API were unreachable from the build environment. Request and response shapes were taken from Telegram's Bot API server source, and the client is tested against a mock. Real delivery is untested.

## ADR-021: The dashboard reads the chain directly, and shows no transaction hashes (2026-10-24)

The dashboard at `/` replaces the open-request list. Like the approval page (ADR-013), it reads the vault over RPC with no backend: `get_config`, `get_policy`, `list_requests` (50 at a time, newest first), and per token `get_budget`, `ft_metadata` and `ft_balance_of` for the vault. It shows no transaction hashes per request, because the vault does not store them and no indexer exists yet. It says so instead of guessing. Blocked requests are never stored, so they appear only as events, and the page says that too. Account links use the nearblocks address pattern from the NEAR docs; sandbox has none.

## ADR-022: The Security Lab report is generated from test runs, and the page re-derives it (2026-10-24)

AGENTS.md wants published results "generated by CI not editable by agent". The only hand-written part is the catalog (`packages/security-lab/src/catalog.ts`): which tests back which case. The generator reads raw runner output (libtest text, vitest and Playwright JSON reporters) and hashes each file. It writes `security-report.json` with the run, the commit and the toolchain, and exits non-zero if any named test failed or did not run. In CI the `security-report` job builds it from the other jobs' artifacts, and it runs even when a test job failed, so failures show up in it.

The report is never committed (gitignored). The page loads it from next to itself (`VITE_SECURITY_REPORT_URL`), validates it, and recomputes every status from its evidence. "Passed on a local chain" requires a test that runs on a NEAR node; unit tests alone show as "Passed in unit tests". A local run is labeled "not from CI, unverified". CI publishes the page with its own report (ADR-023).

## ADR-023: The site is published to GitHub Pages from main, with a frame guard instead of headers (2026-10-24)

AGENTS.md allows "Cloudflare Pages or another free static frontend tier". GitHub Pages needs no account, token or secret beyond the repository: the `pages` job in `ci.yml` runs on a push to main after every other job passed, builds `apps/web`, adds the `security-report.json` the `security-report` job just built, and deploys with `actions/deploy-pages`. So the published report always belongs to the published commit, and nobody can upload a report by hand. Vite builds with `base: "./"`, so one build works at `/` and under `/Spact/`; links are relative (`?page=security`, `?request=`).

No vault is deployed yet, so an empty `VITE_VAULT_ID` now builds a Security Lab-only site: the overview and approval links say that no vault is connected, and no wallet or RPC is touched. A malformed id is still an error. When the testnet vault exists, the repository variables `VITE_VAULT_ID`, and optionally `VITE_NEAR_NETWORK` and `VITE_NEAR_RPC_URL`, turn on the full site with no code change.

GitHub Pages cannot send response headers, so there is no `frame-ancestors` header. Instead, the page draws nothing but a notice and a new-tab link when it is inside a frame (`window.top !== window.self`). A frame that blocks scripts gets an empty page, since everything is rendered by script. The page sets no Content-Security-Policy either. A `<meta>` policy cannot carry `frame-ancestors`, and near-connect runs wallet code in `srcdoc` iframes, which inherit the page's policy, so a strict one could break the wallets, and real wallet signing cannot be tested from the build environment. The cost: an embedding wallet browser cannot frame Spact. Moving to Cloudflare Pages would allow real headers.

## ADR-024: A landing page at /, and a brand built on the three outcomes (2026-10-25)

Visitors and judges land on `/`, which used to open the owner dashboard with no explanation. `/` is now a landing page: what Spact is; the three outcomes in the configured vault's own limits, read from its policy so the page cannot overstate them; how it works; live numbers read from chain; and the Security Lab counts from the CI-built report. The dashboard moved to `?page=overview`. Approval links (`?request=`) are unchanged, so links from Telegram and the MCP server keep working. Claims on the page are backed elsewhere: "the agent cannot move funds by itself" by ADR-017 and the `t19`/`t20` sandbox tests.

The brand is ink on paper, with the outcomes as signal colors: paid (emerald), waits (amber), blocked (rose), the same hues the status badges already used. The logo is a gate: two posts and a payment passing between them. The display font is Space Grotesk (OFL-1.1), bundled from `@fontsource-variable/space-grotesk` 5.3.0, so the site still makes no request outside its own origin. The PNG icons and the share card are rendered from HTML by `apps/web/dev/render-brand.ts`. Share cards need absolute image URLs, so `VITE_SITE_URL` (set by CI from `actions/configure-pages`) adds those tags at build time; without it they are left out, and a bad value fails the build.

## ADR-025: Railway serves the site with real security headers; GitHub Pages stays (2026-10-25)

The owner asked for the site on Railway. A server, unlike GitHub Pages, can send response headers. The root `Dockerfile` builds `apps/web` and serves it with Caddy 2.11.7. `apps/web/Caddyfile` sends:
- `X-Frame-Options: DENY`;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: no-referrer`;
- a `Permissions-Policy` that turns off camera, microphone, location, payment and USB;
- HSTS.

Hashed assets are cached for a year, and the page itself is revalidated on every load. The header is `X-Frame-Options`, not CSP `frame-ancestors`, because near-connect runs wallet code in `srcdoc` iframes that inherit the page's CSP. Whether an inherited `frame-ancestors` would block them cannot be tested without a real wallet. The script frame guard (ADR-023) stays as a second layer.

**Where the Security Lab report comes from.** Railway builds from GitHub by itself, so no Railway token goes into GitHub Actions (AGENTS.md section 15), and the report is not built into the Railway image. Instead the page reads the CI-built `security-report.json` from the GitHub Pages site at runtime (`VITE_SECURITY_REPORT_URL`) and shows its commit. That commit can trail the Railway deploy by one CI run. GitHub Pages keeps publishing the same site.

**Setup.** Railway's `railway.json` config is deprecated for new services, so the setup is the root `Dockerfile` plus service variables set in Railway's dashboard. CI's `web-image` job builds the image, runs it and checks it with `scripts/check-web-image.sh`.

**Cost.** Railway's trial is a one-time $5 for 30 days. After that it is the Free plan's $1 a month or Hobby at $5 a month, inside AGENTS.md's $100 ceiling.

## ADR-026: Brand design values from the redesign skill, kept to the Spact palette (2026-10-25)

The owner pointed at [elayadesign/ai-design-skills](https://github.com/elayadesign/ai-design-skills) and asked for the best fit, in the Spact colors. `redesign-existing-projects` fits: it audits a site that already works and upgrades it in place, instead of starting a new design. Its audit, applied with the ADR-024 palette unchanged:

- **Type.** One typeface, Space Grotesk, for headings and body; Inter is gone. Numbers, hashes and code use Geist Mono. Sizes come from Tailwind's type scale only, and spacing snaps to 2, 4, 8, 12, 16, 24, 32, 40, 48, 64, 80 and 96 px.
- **Color.** Unchanged: ink `#0b0f14`, paper `#f7f6f2`, surface `#fffefb`, line `#e7e4dc`, and the three signals (paid `#10b981`, waits `#f59e0b`, blocked `#f43f5e`). The only additions are a light ink-to-stone gradient on the hero headline and a 5% grain overlay.
- **Motion.** One curve, `cubic-bezier(0.32, 0.72, 0, 1)`, for interface transitions. Sections fade up once as they are reached, via IntersectionObserver, never a scroll listener. With `prefers-reduced-motion`, everything is shown at once.
- **Icons.** Phosphor (`@phosphor-icons/react` 2.1.10), tree-shaken.
- **Missing pages.** A skip link, a Privacy and terms page (`?page=legal`) that says what the site does with data, and a branded 404 that Caddy serves for missing paths.

What it left out: stock photos, testimonials and logos we do not have, invented numbers, and anything that would add a third-party request. Every number on the landing page is still read from the vault or the Security Lab report, and the hero's proof line says "in CI" only when the report came from CI.

**Second pass: fewer sections, one moving graphic.** The owner found the first pass too busy, with too much on the page, and asked for one straightforward page with motion graphics. The skill's own scope lets the owner's explicit request win over its rules (the mandatory tagline and FAQ). The landing page is now three sections: the hero, the three rules, and the live vault. The comparison table, timeline, tagline, Security Lab band, FAQ, get-started terminal and closing call to action are gone. The Security Lab stays one link away, with its count in the hero.

The hero's visual is `GateFlow`, an SVG animation built the way `design-to-motion` (same repo) describes website sections:
- **The story.** It runs a 10 second loop of three requests. One is paid at once. One stops at the gate, the owner's wallet approves it, and it is paid. One meets a closed gate and is sent back.
- **The numbers.** The amounts are picked from the vault's own limits (`gateExample` in `apps/web/src/landing.ts`). The figure says when they are only an example, which is when there is no vault or the policy has no three outcomes.
- **How it runs.** The animation is CSS keyframes only, with no animation library. It pauses while off screen, through IntersectionObserver. With reduced motion it is a single still frame: the request waiting for the wallet.
- **On a phone.** The graphic drops its legend and crops its viewBox so its labels stay readable, and the caption under it states the rule instead.
- **The rule cards.** Each card acts out its own outcome on a short track (`OutcomeMotion`): paid passes straight through, waits is tapped Approve, blocked meets a closed gate. The loops run 3.2, 5.2 and 3.8 seconds, so the cards never move in step. They follow the same rules: CSS only, paused off screen, a still frame with reduced motion.

## ADR-027: The product is named SpactVault, with an S and V monogram in violet (2026-10-30)

The owner renamed the product SpactVault, after the `spactvault` domain they want, and asked for a brand built on it: a logo on white with the S and V intertwined, plus colors.

- **Name.** SpactVault is one word, with capital S and V, so the mark's two letters are the name's two capitals. "Spact" stays as the short form in prose. Code identifiers do not change: package names (`@spact/*`), the MCP server id `spact`, account names and the repository. The user-facing text changes: the site, its title and share card, the 404 page, the Telegram link message and the MCP tool titles.
- **Mark.** The S and V are Space Grotesk Bold outlines, the site's own typeface. The S is woven through the V, passing under its left arm and over its right. The gaps of the weave are cut in white, so the mark always sits on a white tile, which is the logo the owner asked for. Two concepts were drawn (a woven S, and an S knocked out of a solid V), and the owner chose the woven one.
- **Where the geometry lives.** It lives in `apps/web/src/brandMark.ts`. The React mark, `favicon.svg`, the rendered PNGs (`dev/render-brand.ts`) and `404.html` all come from it.
- **Colors.** The owner chose violet over cobalt and emerald: violet ink `#140f2b` and violet `#6a4cff`. The page background is a cool near-white `#f7f7fb` with white cards, and the grays are neutral zinc in place of warm stone. Violet is the color of the primary link, focus rings and the wallet's Approve button in the animations. White on violet is 5.1:1, which passes AA.
- **Status colors.** Paid, waits and blocked keep their emerald, amber and rose. The brand never uses them as decoration, and the approval page's "Approve and pay" button stays emerald because it pays.
- **Domain.** The owner bought `spactvault.xyz` and attached it to the Railway service, which verified it and issued its certificate. It is the site's primary address, and the Railway variable `VITE_SITE_URL=https://spactvault.xyz` points the share card at it. `spact.up.railway.app` and GitHub Pages keep serving the same build.
- **Repository.** The owner renamed the repository to `0xileri/SpactVault`. GitHub Pages now serves `https://0xileri.github.io/SpactVault/`, and the old `/Spact/` path no longer works. So the `Dockerfile` defaults now point there: the Security Lab report URL that the Railway site reads, and the repository link. The README and the MCP setup example use the new address too. Approval links from an MCP server configured with the old `SPACT_APPROVAL_URL` stop working until it is set to the new URL.

## ADR-028: Mainnet for the hackathon: native USDC, small fixed limits, a locked vault (2026-10-30)

The owner does not want to submit a testnet demo. AGENTS.md allows mainnet only with the owner's explicit authorization. It also asks for:
- a verified token;
- a fresh, low-balance vault;
- an upgrade policy decided first;
- confirmation of the exact amounts and the most that can be lost before anything moves.

The owner made these choices on 2026-10-30:

- **Scope.** NEAR-direct payments only. Cross-chain payments (P1, 1Click) stay off, so T13 and T14 do not apply.
- **Token: native USDC on NEAR.**
  - `scripts/deploy-mainnet.sh` defaults to `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`. That is the id in Circle's announcement and in NEAR token lists, and Circle's NEAR page shows it shortened to `1720...33a1`.
  - Circle's full address list could not be fetched from the build environment. So the script reads the token's metadata on chain and refuses unless it says USDC with 6 decimals, and the owner compares the id with Circle's list before confirming.
  - Bridged USDC.e (`a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near`) is a different token, and is not used.
- **Limits.**
  - Float: 5 USDC.
  - Outcomes: paid at once up to 1 USDC; waits for the owner up to 3 USDC; 5 USDC a day.
  - One payee: `api.<parent>`, the owner's own account, so paid USDC stays with the owner.
  - At most 3 open approvals and 20 requests a day; approvals expire after 24 hours.
- **Code lock.** After the deploy and init, the script deletes the vault's only full-access key and checks that none is left.
  - Nobody can change the vault's code after that, the owner included.
  - `owner_withdraw` still returns the USDC to the owner.
  - The cost is the vault's NEAR, about 2.9, which stays locked as contract storage. Anyone can still top it up.
  - This settles the open question "Vault account key policy".
- **Agent.** Its key is a function-call key limited to two methods, with a 0.25 NEAR gas allowance (ADR-017). The agent account's full-access key stays offline on the owner's machine. The MCP server refuses mainnet unless `ENABLE_MAINNET_TRANSFERS=true`.
- **Checks before spending.** The script stops before building or spending anything unless every check passes:
  - the RPC serves chain `mainnet` at protocol version 84 or later (the rustc 1.97 build needs that, see INTEGRATIONS.md);
  - the deployer and owner accounts exist, and the three subaccounts are free;
  - the token is USDC with 6 decimals;
  - the deployer holds the float and enough NEAR.

  It then prints the plan and the most you can lose, and waits for the owner to type "deploy to mainnet".
- **Accounts.**
  - `<parent>` is a named mainnet account the owner creates and funds in a wallet, and imports into near-cli on their own machine.
  - The vault, agent and payee are its subaccounts.
  - The owner is the owner's wallet account.
  - No key ever leaves the owner's machine.
- **Cost and most you can lose.**
  - NEAR: about 3.4 NEAR from `<parent>`: 2.9 locked in the vault, 0.3 to the agent, 0.1 to the payee, two USDC storage deposits and gas.
  - USDC: the 5 USDC float, which only the owner can withdraw.
  - Budget: this fits AGENTS.md's $100 ceiling while NEAR is below about $25.
- **Security gates.** Before mainnet, T07 (expired approvals) and T15 (approvals for another vault, network or policy version) gained on-chain sandbox tests.
  - T10 (a reservation across UTC midnight) stays unit-only: the transfer callback lands about a second after dispatch, and a sandbox cannot aim a transaction at a chosen instant.
  - Every NEAR-direct case passes. All but T10 pass on a real local chain.
- **RPC.** The scripts default to `https://rpc.mainnet.fastnear.com` from FASTNEAR, which runs the testnet endpoint the site has used since ADR-023. docs.near.org's current providers page lists NEAR's archival endpoint, dRPC and ZAN. Any of them can be set with `RPC_URL` and `VITE_NEAR_RPC_URL`. Which one browsers can reach (CORS) is checked on the live site.
- **Sites.** Switching a site to mainnet takes three variables: `VITE_NEAR_NETWORK`, `VITE_NEAR_RPC_URL` and `VITE_VAULT_ID`. Railway takes them as service variables, and GitHub Pages as repository variables. On mainnet the footer says real funds are involved.
- **Outcome (2026-11-01).** The owner deployed `vault.0xileri.near` with `0xileri.near` as deployer and owner. Read back the same day: no vault keys, network `mainnet`, 5 USDC (STATUS "Mainnet deployment").

## ADR-029: The landing page explains itself in plain words (2026-11-01)

The owner found the site confusing. The page leaned on terms a newcomer has to decode ("vault contract", "on chain", "RPC", "payee", "auto limit", "hard cap"). Its hero was an abstract gate with posts, a dotted track and rules in shorthand ("≤ 10 TUSD paid"). The rule cards then replayed the same idea in a second visual language.

- **Hero.** The headline says what the product does: "Give your AI agent a budget, not your wallet." The paragraph under it gives the three outcomes in one breath. "Autonomous spending. Human rules." stays as the brand tagline in the footer and on the share card.
- **Hero visual: `RequestFeed` replaces `GateFlow`.** It is a list of three example requests ("Pay 3 TUSD for a search API call"). Each one shows "Checking rules", then its outcome in words, with the reason underneath: "Under your 10 TUSD instant limit", "Over 10 TUSD, so it asks you first" (Approve is tapped, then it is paid), "Over your 30 TUSD limit per payment". It follows the ADR-026 motion rules: CSS keyframes only, a 12 second loop, paused off screen, and with reduced motion one still frame that shows all three outcomes. The amounts still come from the vault's limits (`exampleAmounts`, renamed from `gateExample`).
- **New "How it works" section.** Three numbered steps (you fill the vault, your agent asks, the vault checks your rules) say where the money sits and why the agent cannot skip the rules. The main button scrolls to it.
- **Rule cards are static.** `OutcomeMotion` is gone: the hero already animates the three outcomes, and a second animation of the same thing added noise. Each card has an icon, a plain title (Paid instantly, Needs your OK, Refused), the vault's numbers and one sentence on what happens next.
- **Words.** "Auto limit" becomes "instant limit", "hard cap" becomes "limit per payment", "payee" becomes "anyone on the list", and "blocked" becomes "refused". The live stats read "Money in the vault", "Spent today", "Payments made" and "Waiting for your OK". The Security Lab line counts the attacks that pass ("16 attacks tested automatically on every code change"), so it no longer reads like a failing score ("13 of 18").
- **Share card.** The subtitle, the outcome pills and the network note ("Live on NEAR mainnet") match. `og-image.png` and `brand/github-social-preview.png` are regenerated.

Unchanged: the brand, the palette, a short page (one small section added), and every number read from the chain. The dashboard, approval page and Security Lab are not part of this pass.

## ADR-030: The dashboard and approval page explain themselves in plain words too (2026-11-01)

After ADR-029 the owner asked for the same treatment on the dashboard and the approval page. Both still led with things only a developer needs (policy version, stored requests, base units, token contract, "hash", "1 yoctoNEAR", "RPC") and hid what the owner came for.

- **Dashboard ("Your vault").** It is ordered by the owner's questions:
  - how much is in the vault and how much is left today, with a progress bar and when it resets;
  - what waits for me: each item has the agent's note and a Review button;
  - what my agent did: each row says what happened and why, such as "Under your instant limit, so it was sent without asking you" or "Over your instant limit, so it waits for your OK", in place of reason codes like `REQUIRES_OWNER_APPROVAL`;
  - my rules, and who is who.
  - Rules version and the request count moved to a small line at the bottom.
- **`outcomeLine`** (`apps/web/src/dashboard.ts`) writes that sentence from the request's reason code. It tells a payment the owner approved (`approved_by` set) from one paid without asking. It says "Time ran out" for a request the vault still lists as open after its expiry. For any other code it falls back to the vault's own explanation. The MCP server keeps the shared explanations unchanged.
- **Approval page.** The order is:
  - "Your agent wants to pay", the amount and the recipient;
  - the agent's note, marked as unchecked;
  - why it waits ("over your 1 USDC instant limit") and when it expires;
  - a **Safety check** (the hash check, renamed and explained);
  - the decision, with the budget left today and the connect-wallet prompt next to the buttons.
  - Raw units, token contract, agent account, request ID and the full fingerprint sit in a closed "Technical details" section.
  - A request that is already decided says "asked to pay" and what happened, instead of showing an expiry and a safety check for a decision that no longer exists.
- **Words.** Status badges read Waiting for you, Paid, Rejected, Expired, Sending, Failed and Refused. "Pay immediately after approving" becomes "Pay right away". The 1 yoctoNEAR note says that the wallet's main key is needed, so a partly connected app cannot approve. The problem and result messages are rephrased; reason codes stay in brackets where the vault refused something, for debugging.
- **Buttons.** The primary button is violet like the rest of the site (ADR-027), not green.

The checks are unchanged: the hash comparison, owner and network checks, and every refusal path work as before, and the e2e attacks still pass.

## ADR-031: One site, two networks, with a switch (2026-11-01)

The owner wants to move between testnet and mainnet on the site. Until now a build served exactly one vault on one network.

- **Config.** The main network stays `VITE_NEAR_NETWORK`, `VITE_VAULT_ID` and `VITE_NEAR_RPC_URL`. A second public network is added only when its own vault is set: `VITE_TESTNET_VAULT_ID` with `VITE_TESTNET_RPC_URL`, or `VITE_MAINNET_VAULT_ID` with `VITE_MAINNET_RPC_URL`.
  - The second network gets its network's default explorer and never a dev signer.
  - The build refuses the second vault in four cases: without an https RPC, when it names the main network, when it is not an account id, or when there is no main vault.
  - The Dockerfile and the Pages job pass these through; empty means no switch, as before.
- **Choosing the network on each page load** (`chooseConfig` in `apps/web/src/network.ts`):
  - `network=` in the URL picks one by name;
  - without it, a `vault=` that names one of the configured vaults picks that vault's network;
  - anything else gets the main network.
  - An explicit `network=` wins over `vault=`, so a link that names one network and the other network's vault is refused by the existing foreign-vault check rather than followed.
- **The switch.** (Removed by ADR-037: the site shows its main network only; `?network=` links still work.) A small select in the top bar, shown only when there are two networks. Switching is a full page load to the same page (`page=` kept), dropping any `request=` or `vault=`, because those belong to the old network. While on the second network, every internal link carries `network=` (a `LinkContext` rewrites them), so the dashboard, approval and home links stay on it. The main network needs no parameter, so old links behave as before. The badge and footer already name the network, and mainnet's still says real funds.
- **Approval links.** The MCP server's `review_url` and the Telegram alert's link now add `vault=<vault>`. On a site with both networks, an agent on testnet sends the owner to the testnet vault, without the owner switching first. Old links without `vault=` open on the main network, where an unknown request says it was not found.
- **Phones.** To fit a 390 px screen with the switch, the top bar uses smaller gaps, "Security" instead of "Security Lab", and hides the GitHub icon (the footer links the source).
- **Safety.** Each page load still serves exactly one vault, and the approval hash still uses the selected network and vault, so nothing signed on one network can apply to the other. Wallet connections are per page load and per network.

Not done: a third network, or a switch on the MCP server (each agent stays configured for one vault).

## ADR-032: The P1 cross-chain route: owner-approved, bound to the quote, never re-credited (2026-11-02)

AGENTS.md P1 asks for a 1Click route from NEAR: a dry quote whose terms are captured and hashed, a human-approved payment, and quote mutation tests, with T13 and T14 covered. This change builds it up to the live call and stops there. No 1Click request, testnet or mainnet deploy, or real transfer was made. The docs and API hosts are unreachable from the build environment, so the API shapes come from the official TypeScript SDK's generated types (INTEGRATIONS.md).

- **A separate request type, not a withdrawal.** `request_cross_chain_payment` stores a `ONE_CLICK_ORIGIN_NEAR` request. Its `recipient` is the quote's deposit account on NEAR, and `cross_chain` holds the quote's destination tuple: chain, asset, final recipient, `refund_to`, minimum output, quote hash and quote deadline. Direct payments are unchanged.
- **Always the owner's decision (I8).** A cross-chain request is stored as AWAITING_APPROVAL whatever its amount; the auto limit applies only to direct NEAR payments. The vault cannot check what 1Click does with a deposit, so the owner approves the exact deposit account and destination together. The 1Click quote `signature` is kept in the hashed quote, but the SDK documents no way to verify it, so it is not treated as authority.
- **Bound into the approved hash.** The request digest appends the quote terms for route tag 1. Direct requests hash exactly as before, so the deployed vaults and their approval pages are unaffected. An independent Python vector checks Rust and TypeScript (INTEGRATIONS.md).
- **Allowlist.** The policy gets `cross_chain`: up to 4 routes of (token, destination chain, destination asset, up to 8 final recipients). Strings are compared byte for byte, in a restricted character set, so look-alikes and whitespace fail closed. An empty list (the default, and what older policies parse to) turns the route off. The token's per-payment cap and UTC-day budget apply as for direct payments.
- **Quote checks in the vault.** `refund_to` must be the vault. The deposit account must not be the vault, the owner, the token or an agent. The minimum output must be positive and the quote hash well formed (`INVALID_QUOTE`). A quote must have more than 60 s left when it is filed, approved and executed (`QUOTE_EXPIRED`), and the request expires 60 s before the quote does.
- **Quote checks off chain (`packages/intents`).** The adapter builds an EXACT_INPUT, ORIGIN_CHAIN quote request that refunds to the vault. It refuses a quote unless it echoes exactly the question asked: payee, refund target, assets, amount, types and deadline. It also refuses a quote with a missing or non-NEAR deposit address, a deposit memo (the vault cannot send 1Click's memo), zero output, or less than 60 s left. Its quote hash is sha256 of the canonical JSON of the whole response. That proves which quote was approved, not that it is honest.
- **Where the vault's part ends.** A delivered deposit moves the request to CROSS_CHAIN_PENDING (`EXTERNAL_SETTLEMENT_PENDING`) and its amount stays spent for its UTC day. No vault method takes a 1Click status. A SUCCESS or REFUNDED report is off-chain text, and the adapter's `reconcile` marks a reported refund `REFUND_UNVERIFIED` and never restores budget (I9). Tokens that do come back raise the vault's balance, which the owner can withdraw, but not today's budget. A definitive on-chain transfer failure (for example an unregistered deposit account) still releases the reservation once, as for direct payments.
- **Agent key unchanged.** The agent's function-call key still allows only `request_direct_payment` and `execute_request` (ADR-017), and the MCP server still exposes only its two tools. Filing cross-chain requests needs the key and a tool to include the new method. That is a separate, owner-approved change.
- **Deployed vaults.** The mainnet and testnet vaults run the earlier code: they have no cross-chain route, and the mainnet vault is locked (ADR-028), so it never will. The site and the shared schemas still read them: missing `cross_chain` fields parse as none.

Not done in this change: a live 1Click call, `POST /v0/deposit/submit`, polling in a service, a REFUND_OBSERVED state backed by on-chain evidence, and a deposit-address check against 1Click from the approval page. The check and recorded live answers came later (ADR-033, ADR-034); the others are still not done.

## ADR-033: The owner does everything from the website, signed in the browser wallet (2026-11-03)

The owner asked that every owner step run on spactvault.xyz with Meteor Wallet, with no terminal: create a vault, fund it, set its rules, pause it, manage agents, give the agent a key, and follow cross-chain payments. The only part that is not in the browser is the agent itself, running the MCP server. Each step shows a review screen (plain words, then the exact transaction under "Exact transaction") before the wallet is asked, and on mainnet the Sign button stays off until the owner ticks "I checked the details above" (`MainnetConfirm`). Nothing in this change signed or spent anything on testnet or mainnet: every flow was run on a local chain with the sandbox dev signer standing in for the wallet.

- **Creating a vault takes two transactions, and only the first goes through the wallet.** (Changed by ADR-035: Meteor refuses the full-access `AddKey` below, so a named vault now gets its code and a function-call key for `new` from the wallet, and the full-access path moved to implicit accounts.) `new` must be called by the vault account itself (ADR-010), which a wallet signing as the owner cannot do. So the wallet signs `CreateAccount + Transfer + AddKey(full access)` to `name.<owner>`, where the key is a temporary key pair the tab generated with the browser's CSPRNG. The tab then signs, with that key, `DeployContract + FunctionCall new + DeleteKey(itself)` as one transaction from the vault to itself, so a failed `new` reverts the deploy too and the key is never left behind on a working vault. After it, the page reads the account back and shows a checklist: the code hash matches the published build, no access keys are left, and owner, agents and network are what was asked. The 274 kB wasm never passes through the wallet, so wallet limits on transaction size do not apply to it (see "Wallet limits" below).
- **The temporary key lives in the tab only.** It is generated in the page, held in memory, and kept in `sessionStorage` (this tab, gone when it closes) between the two transactions, so a reload or a wallet that redirects does not strand the funded account. It is never sent anywhere: the browser tests record every request the page makes and check that no secret appears in any of them. If step 2 cannot go ahead, the same key can delete the half-made account and return its NEAR to the owner ("Cancel").
- **The site deploys a committed build.** `apps/web/public/contracts/spact_vault-p1.wasm` is the P1 vault built from `0f7480b` with `scripts/build-contracts.sh`, and `apps/web/src/contracts.ts` lists its size, sha256 and NEAR code hash (`5HwAUrjKbx5qc7NNyka4ndkAsXUdA9CsQ1ya66zzNNve`). The page refuses to deploy a download that does not match, and `test/contracts.test.ts` checks the committed file against the manifest. Builds are not reproducible across machines yet (STATUS), so this hash is the one this repository vouches for, not one anyone can rebuild.
- **Vaults the site does not list.** A `vault=` that is not in the build's config used to be refused outright. Now it is shown only if its code hash is a build in `contracts.ts` and it has no access keys, so nobody can change its code after the check; anything else is refused as before. That lets the owner fund, configure and approve for a vault created from the site before its config points at it. It is safe for the owner because a genuine vault only ever moves its own funds and only its stored owner can approve: a stranger's vault naming the owner cannot touch the owner's money.
- **Several vaults per network.** `VITE_EXTRA_VAULTS` (and `VITE_TESTNET_EXTRA_VAULTS` / `VITE_MAINNET_EXTRA_VAULTS`) list more vaults after a network's default, each with an optional label (`VITE_VAULT_LABEL`), e.g. `vault.0xileri.near=P0 vault`. A picker in the page header moves between them, and links keep `vault=` unless it is the network's default.
- **Funding uses `ft_transfer`, not `ft_transfer_call`.** The vault does not implement `ft_on_transfer`, so a transfer call would make the token call a missing method and send everything back. The page first registers the vault with the token (`storage_deposit`, the token's `storage_balance_bounds.min`) when `storage_balance_of` says it is not, then `ft_transfer`s, in one transaction to the token. The owner asked for `ft_transfer_call`; this does the same thing in the form the vault accepts.
- **The agent key is made in the browser and saved before it is used.** The tab generates the key pair, the owner downloads `<agent>.json` (the near-cli format `apps/mcp` reads), the page forgets the secret, and only then does the wallet create `name.<owner>` with that public key as its only key: a function-call key for `request_direct_payment`, `request_cross_chain_payment` and `execute_request` on the vault, with a gas allowance (0.25 NEAR by default). The account has no full-access key, so the key file is all that can ever sign for it. If the agent is not in the vault yet, an `add_agent` follows. Keys made before this change (two methods) keep working for direct payments; the MCP server's cross-chain tool tells the agent to ask for a new key.
- **1Click is reached through the site's own server.** The Railway image's Caddy proxies `/1click/` to `https://1click.chaindefuser.com` for exactly `GET /v0/tokens`, `GET /v0/status` and `POST /v0/quote` (16 KB bodies, no cookies, auth, origin or referrer forwarded, `no-store`). Nothing that submits or moves funds is forwarded, and no API key is involved: the browser never sees one, and quotes made without one carry 1Click's fee. GitHub Pages cannot proxy, so the Pages build has no 1Click features unless `VITE_ONECLICK_URL` names a 1Click URL that allows its origin.
- **The approval page asks 1Click before it allows approving a cross-chain payment.** The vault cannot tell whose deposit address it is told to pay; 1Click can. The page reads `GET /v0/status` for the deposit address and compares 1Click's record with the request (`depositMismatches`: deposit address, origin asset, amount, destination asset, final recipient, refund address, minimum output and the four types). Approve stays off until they match, and also while 1Click cannot be reached, or when the site has no 1Click access. This closes the hole ADR-032 left open: an agent that files a real quote's terms with someone else's deposit address is caught here, not only by the owner's eyes (Security Lab T14). The page also checks `storage_balance_of` for the deposit address and offers a `storage_deposit` first when it is not registered, since an unregistered receiver makes the vault's transfer fail.
- **Following a paid cross-chain payment.** Once the vault has paid the deposit address (CROSS_CHAIN_PENDING), the page polls 1Click every 5 seconds until it reports a final state, and shows the transactions 1Click names on NEAR and on the destination chain. Explorer links are built by the page from the chain name and the hash (`txExplorerLink`); the `explorerUrl` 1Click sends is never linked. A reported refund stays labelled unverified and never restores budget (ADR-032, I9).
- **The MCP server can file cross-chain requests.** `request_cross_chain_payment` (on only with `ENABLE_1CLICK_LIVE=true`) checks the owner's route allowlist, gets a real quote that refunds to the vault, refuses it unless it answers exactly the question asked (`crossChainArgs`), optionally saves the full quote with its signature (`SPACT_QUOTE_DIR`), and files it with the vault, which holds it for the owner. `get_payment_status` adds 1Click's status for a paid cross-chain request, labelled as 1Click's report. The key check now accepts the three agent methods and still refuses anything broader.
- **The sandbox dev signer signs the new flows, and only on a local chain.** `apps/web/dev/dev-signer.ts` now also signs sub-account creation for the owner, owner methods on vaults the owner made, and `storage_deposit` / `ft_transfer` on the demo token, so the browser tests drive every flow through the real pages. It still refuses to start unless the fixture points at a local sandbox, and `config.ts` still refuses it on testnet and mainnet.

**Answers from the live API (2026-11-03, ADR-034).** The docs host is blocked here, so the doc wording below comes from web search results of those pages, not from reading them directly.
- *Does `GET /v0/status` answer for an unused deposit address?* Yes. Right after the quote, `GET /v0/status?depositAddress=041951e1…87bc` answered HTTP 200 `PENDING_DEPOSIT`, with 1Click's full, signed record of the quote (`packages/intents/test/fixtures/live/status-pending.ts`). That is what the approval page's check needs. An address 1Click never issued gets HTTP 404 "Deposit address … not found". The docs describe PENDING_DEPOSIT as waiting for the deposit to arrive ([1Click quickstart](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart)).
- *Is a plain `ft_transfer` the deposit 1Click detects?* Not confirmed. The quickstart says to transfer the tokens to `depositAddress` and that the swap starts on receipt, without naming the NEAR call ([1Click quickstart](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart), [making a request](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request.md)). The FAQ's rule that only `ft_transfer_call` works is about depositing into `intents.near`, not into a 1Click deposit address ([FAQ](https://docs.near-intents.org/near-intents/faqs)). The live deposit address is a 64-hex implicit account with no contract. An `ft_transfer_call` to it would find no `ft_on_transfer` and be refunded, so a plain `ft_transfer`, which is what the vault sends, is the only NEP-141 transfer that can land there. Only a real deposit settles it, and the mainnet run will be the first. Whether that account is already registered with USDC is also unknown; the approval page checks and offers the `storage_deposit`.

**Wallet limits, and the closest browser-only workarounds.** These are untested with Meteor until the owner runs them on mainnet; the local tests use the dev signer.
- *Contract deploy through the wallet:* a named vault now sends the 274 kB wasm through the wallet (ADR-035); an any-wallet vault does not, the tab sends it straight to the RPC (NEAR's contract size limit is 4 MiB). Unverified: that Meteor carries it, and that the mainnet RPC (`rpc.mainnet.fastnear.com`) accepts a request body of about 370 kB. If the RPC does not, the workaround is another RPC in `VITE_NEAR_RPC_URL`.
- *A full-access `AddKey` to a new account:* **Meteor refuses it** ("Full access key request blocked", 2026-11-03). Replaced by ADR-035: a function-call key for `new` on a named vault, or an implicit account the wallet only sends NEAR to.
- *1 yoctoNEAR on owner calls:* every owner change attaches 1 yoctoNEAR so that only a full-access key can sign it (ADR-002). The wallet asks for confirmation each time; that is the point.
- *Two transactions in a row* (agent key plus `add_agent`, registration plus approval): the wallet asks twice. Nothing is batched across receivers.
- *Downloads on a phone:* a wallet's in-app browser may not save files. Set up the agent key from a desktop browser.
- *The agent side:* `apps/mcp` refuses a key file other users can read, so on the agent's machine the file needs `chmod 600`. That machine runs the agent anyway; it is the one part that is not the browser.

## ADR-034: Live 1Click answers, and quotes must carry 1Click's signature (2026-11-03)

The build environment still cannot reach `1click.chaindefuser.com` or `docs.near-intents.org` (the proxy answers 403). So the owner ran the requests with curl from their own machine, without an API key, and pasted the answers back. They are verbatim fixtures in `packages/intents/test/fixtures/live`, each with its request and HTTP code in a header comment. Nothing was deposited and nothing was signed by the owner.

**What the live API showed that the SDK types and the mocks did not:**
- **Null, not absent.** `GET /v0/status` for a fresh deposit address returns `swapDetails.depositedAmount: null`, `amountOut: null` and more. The schema allowed only absent fields, so every real status answer failed to parse, and the approval page would have kept Approve off for every cross-chain payment ("1Click's status answer is malformed"). The schema now accepts null; a check run against the previous schema fails on the recorded answer.
- **Two deadlines.** The quote's `deadline` and `timeWhenInactive` came back three days after the `deadline` asked for. The SDK describes the requested one as when "the user refund begins if the swap isn't completed by then", and the quote's as when "the deposit address becomes inactive". The vault request is now bound to the earlier of the two, so the vault can never pay a deposit after 1Click has started refunding. Before, it took the quote's, three days later.
- **The refund account must exist.** A quote refunding to `vault2.0xileri.near`, not yet created, got HTTP 400 "Internal server error", dry or not. The same request refunding to `vault.0xileri.near` worked. Every quote this project asks for refunds to its vault, which exists by then. The client now passes 1Click's error message through and, for a 400 on `/v0/quote`, names this cause.
- **Extra fields in the echo.** 1Click's echo of the request adds fields that were not sent: `confidentiality`, `quoteWaitingTimeMs`, `insured`, and an `appFees` entry of 1 basis point to `5880ad2b…47dd`. The quote checks compare only the fields SpactVault sends, so they pass. The cross-chain page and the MCP tool report the app fee. The quote also has `refundFee` and `withdrawFee` (already taken out of `amountOut`, per the SDK).
- **Small things.** Quotes answer HTTP 201, not 200 (harmless: the client checks `ok`). A deposit address is a 64-hex implicit NEAR account. The echoed `deadline` is exactly what was sent, in whole seconds; the builder now sends whole seconds and compares deadlines as instants.

**Quote signatures can be checked.** ADR-032 kept the quote's `signature` without checking it, because no verification method was documented. The SDK does have one in code, in `src/quote-signature.ts` of `@defuse-protocol/one-click-sdk-typescript` 0.1.26, read as data. 1Click signs base58(sha256(sorted-key JSON of the request and quote fields plus the timestamp)) with ed25519, using a manager key the SDK ships: `ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc`. `packages/intents` reimplements the check; no SDK code runs here. Both recorded quotes verify, and so does the copy of the quote inside the status answer. Changing any covered field breaks it. So now:
- the MCP tool files a quote only if 1Click signed it;
- the approval page accepts 1Click's record of a deposit address only if it carries 1Click's signature, so a record that matches the request but was not signed by 1Click (from a compromised proxy, say) keeps Approve off (browser test). This closes the gap ADR-033 left, where the check was only as good as the proxy;
- the cross-chain page shows a price only if it is signed.

The key is fixed in code. If 1Click rotates it, these checks fail closed until the key is updated from the SDK. On a local sandbox only, `VITE_ONECLICK_SIGNER_KEY` lets the mock 1Click sign its own answers with a published test key (`MOCK_SIGNER_SEED`), and `config.ts` refuses it on testnet and mainnet.

**Recorded on 2026-11-04** (STATUS "Mainnet cross-chain run"): the full token list (215 entries, all parse), a dry quote to Base, and the `SUCCESS` status after the first real deposit. Before that, **still not recorded:** 1Click's token list. The owner's `tokens.json` (53 KB) was not attached, so the route tests use two token entries written by hand and say so; only the USDC-on-Solana asset id is confirmed from it. Since one entry the schema refuses (a long symbol, an unusual chain name) would have hidden every route, the list parser now keeps the entries that parse and drops the rest. **Still never seen live:** a deposit, a status after one, `SUCCESS`, `REFUNDED`, and destination-chain tx hashes.

## ADR-035: Vault and agent setup any NEAR wallet can sign (2026-11-03)

On the first mainnet try, Meteor refused step 1 of creating `vault2.0xileri.near` with "Full access key request blocked" (owner's screenshot): it will not add a full-access key for a website. Nothing was sent. The owner chose an init-only key and asked that the setup work with any NEAR wallet, not only Meteor. Two ways now, picked on the New vault form; neither asks a wallet for a full-access key.

- **Named vault (`name.<owner>`, the default).** The wallet signs `CreateAccount + Transfer + DeployContract(the published wasm) + AddKey` to `name.<owner>`. The key is the tab's, as before, but now a function-call key: receiver the vault, methods `["new"]`, allowance 0.05 NEAR (`INIT_KEY_ALLOWANCE`). The tab then calls `new` with it, attaching 30 Tgas (`NAMED_INIT_GAS`): a function-call key's allowance has to cover all the gas a call attaches, not what it burns. The first browser-test run caught that: at 100 Tgas the sandbox's gas price (ten times mainnet's floor) asked 0.1 NEAR of the key and the call was refused. 30 Tgas costs at most 0.003 NEAR at mainnet's floor and 0.03 NEAR on the sandbox, and the test checks that `new` burns under 15 Tgas. The code is installed by the wallet's transaction, so the page downloads the wasm and checks its sha256 before it builds that transaction, and checks the account's code hash after. The key stays on the vault, spent: a function-call key cannot deploy code, add or delete keys, transfer NEAR or attach a deposit, and `#[init]` refuses `new` once the vault has state, so the only thing it can still do is spend what is left of its 0.05 NEAR on calls the vault refuses. A browser test signs both with that key after setup and checks that nothing changed.
- **Any wallet (an implicit account, 64 hex characters).** The wallet signs one plain `Transfer` to the hex of the tab's public key. Sending NEAR to such an id creates the account with that key as its full-access key, and every NEAR wallet can sign a transfer. The tab then signs `DeployContract + new + DeleteKey(itself)` in one transaction, as ADR-033 did, so the vault ends with no keys at all. If step 2 cannot go ahead, the same key deletes the account and returns its NEAR (Cancel).
- **"Locked" now means:** no keys, or only function-call keys for `new` on the vault itself (`lockProblem` in `src/contracts.ts`). Any full-access key, a key for other methods (an empty method list allows all), a key for another contract, or a key kind the page does not know (gas keys) fails it. The New vault checklist, the unlisted-vault badge ("verified P1 code, locked") and `inspectUntilLocked` all use that one function.
- **The agent key, the same two ways.** Named: the wallet creates `name.<owner>` with the restricted key, as in ADR-033. Any wallet: the tab makes two keys, the agent's restricted key (downloaded once, as before) and a temporary one. The wallet sends NEAR to the temporary key's implicit account; the tab then adds the restricted key (the three agent methods on the vault, with its gas allowance) and deletes the temporary key in one transaction, and checks the account has exactly the restricted key. The key file's `account_id` is the 64-hex id. Then `add_agent`, from the wallet, as before. The temporary key is kept in `sessionStorage` between the two steps, like the vault's setup key, so a reload or a wallet redirect resumes at the swap; the agent's own secret is never stored.

| Step | What the wallet signs | Needs the wallet to allow | If the wallet refuses |
|---|---|---|---|
| New vault, named | `CreateAccount, Transfer, DeployContract (274 kB), AddKey(function call: new)` | a contract deploy in a dApp transaction; a function-call key on a new account | nothing is sent; choose **Any wallet** |
| New vault, any wallet | `Transfer` to a 64-hex account | a plain NEAR transfer | (every NEAR wallet signs a transfer) |
| Agent key, named | `CreateAccount, Transfer, AddKey(function call: 3 methods)` | a function-call key on a new account (**Meteor signs it**, 2026-11-04) | nothing is sent; choose **Any wallet** |
| Agent key, any wallet | `Transfer` to a 64-hex account, then `add_agent` | a plain NEAR transfer; a 1 yoctoNEAR call | (every NEAR wallet signs both) |
| Fund, rules, pause, agents, approve | function calls with 1 yoctoNEAR (ADR-002) | a deposit-carrying call | no browser-only workaround: these must come from the owner's full-access key |

Tested on a local chain with the dev signer, which now also signs the named-vault shape (only with the published wasm, checked by sha256) and plain transfers to implicit accounts. Unverified with a real wallet when written: whether Meteor signs a 274 kB `DeployContract` in a dApp transaction (it does not: ADR-036), and whether it adds a function-call key to a new account for a website. Either refusal sends nothing, and the page's hint points to Any wallet. The cost of Any wallet is the name: the vault or agent is a 64-hex account, not `vault2.0xileri.near`, so the site config would list that id instead.

## ADR-036: Taking tokens out from the website, and saying plainly that vault NEAR stays (2026-11-04)

After the first website-made mainnet vault, the owner asked where their money went. The honest answer had two parts the site had not said clearly.

- **Meteor blocks the named way too.** Signing a named vault (ADR-035) on mainnet, Meteor showed "Contract deployment blocked: This app is trying to put contract code on your account, which could give it control of your account. Meteor blocks this for apps." (owner's screenshot, 2026-11-04). Nothing was sent. With the earlier "Full access key request blocked", Meteor refuses both ways a website could give a named sub-account its code, so with Meteor a vault can only be made the any-wallet way. New vault now offers **Any wallet** first and by default, and says Meteor refuses the named way. The named way stays for wallets that allow it. The owner then created the mainnet vault the any-wallet way; Meteor signed the plain 3.2 NEAR transfer, and the page's checks passed (the run is recorded separately).
- **Vault NEAR never comes back.** A vault has no keys and no method that sends NEAR, so everything sent to create it stays there: the code's storage and the rest. The review used to say only that "about 2.74 NEAR stays locked to store the code". It now says that all of it stays for good, and the NEAR fields say so too. Across the two mainnet vaults that is 2.9 + 3.2 NEAR. Locked code means each new contract version costs a new vault and its storage NEAR; that is the price of nobody being able to change a vault's rules, the owner included.
- **Tokens can come back: Take money out.** The vault always had `owner_withdraw(token, amount, receiver_id)` (owner only, 1 yoctoNEAR, then `ft_transfer`), in the P0 build on `vault.0xileri.near` as well as P1. The Manage page now has a **Take money out** section for it: pick the token, the amount (refused above the vault's balance) and the receiver (the owner by default; another account gets a warning in the review). If the receiver is not registered with the token, the vault's transfer would fail and the tokens would stay put, so the page first asks the wallet to sign a `storage_deposit` for it, then shows the withdrawal as a separate review. The review also says how many payments are waiting for approval, since taking money out can leave too little to pay them (paying one then fails and sends nothing).
- **A fix in passing.** Two review screens shown one after the other (register, then withdraw; or create the agent, then `add_agent`) reused the first screen's state, so the second opened as already "Confirmed on chain" with no Sign button. They now get their own keys. A browser test for the named agent that the vault does not list yet failed before the fix and passes after it.

Tested on a local chain: withdrawing to the owner (balance checks on both sides, an amount above the balance refused) and to an account that has to register first.

## ADR-037: A simpler site with one action: Create your vault (2026-11-04)

The owner asked for a simpler site where the main purpose is a legible action as soon as you land, easy to understand, with motion and color-graded sections, and nothing on it that is not needed. They chose the action (Create your vault), and what to keep and cut.

- **One action.** The hero says what SpactVault is in one sentence and has one large button, **Create your vault**, which opens New vault. A small text link under it opens the live vault. The nav ends in the same button; its other items are Dashboard, Cross-chain and Manage (Manage is hidden on phones, where it is one tab away).
- **Four short sections, each on its own color band.** The three answers a payment can get, in the live vault's limits (lilac). The live vault's numbers from chain, with nearblocks links to the vault and its transactions (mint); the owner kept these as the strongest proof that real funds sit in a real vault. The cross-chain route through NEAR Intents, linking to the Cross-chain page (sky); the owner kept that page in the nav because it is the one shown for the Unstoppable DeFi track. A dark final band repeats the button with the three setup steps.
- **Cut.** The "How it works" timeline (the hero and the three answers say it), the network switch (judges and users only need mainnet now; a `?network=` link from an MCP server or alert still opens its network, but there is no picker), the Security Lab and GitHub items in the nav. The Security Lab is now one proof link in the final band and the footer.
- **Color and motion.** This replaces ADR-026's "no background gradients" for the front page only; app pages stay plain paper. Soft gradients run from one band into the next (violet, lilac, mint, sky, ink), so there is no seam. Motion: two blurred lights drift behind the hero and fade out before its lower edge; the hero's parts rise in on load; the payment feed keeps its paid, waits, refused loop; sections fade up as they enter the viewport; cards lift under the pointer; the day's budget bar fills from zero; the cross-chain rings turn slowly; the live dot breathes. With `prefers-reduced-motion` nothing moves, and a browser test checks that no animation runs at all.
- **Explorer links.** Transaction hashes on the site already linked to nearblocks (and to Solana or Base explorers for 1Click's hashes). Account ids that were plain text now link too: the vault in each page's header and on the front page.

## ADR-038: The site shows the run's vault, and every id on it is a link (2026-11-04)

After the mainnet cross-chain run (STATUS "Mainnet cross-chain run"), the owner asked for the site to point at the run's vault, with the first vault still listed, explorer links set to nearblocks, and a check that every transaction hash and account on the site is a working link.

- **Which vault.** `VITE_VAULT_ID` becomes the run's vault, `9dc744e29f8a079c6888dbdaafa8fb618b08c3734d00f4f25c8b31050ea086c9` (label `VITE_VAULT_LABEL=P1 vault`), and `VITE_EXTRA_VAULTS=vault.0xileri.near=P0 vault` keeps the first one in the header's picker. On Railway and Pages the main network is mainnet, so these are the plain names; the `VITE_MAINNET_*` ones are only for a site whose main network is testnet. These are service and repository variables, set by the owner; nothing in the repository names the vault.
- **Explorer settings take a plain base URL.** `VITE_EXPLORER_TX_URL=https://nearblocks.io/txns/` and `VITE_EXPLORER_ACCOUNT_URL=https://nearblocks.io/address/` now work as written: the page appends the hash or the account. A template with `{hash}` or `{account}` still works. Before, the build refused a URL without the placeholder. Either form must now be an http(s) URL, so a setting cannot make every link a `javascript:` URL (it could before). The Pages job passes both through; empty means the network's default, which on mainnet is nearblocks anyway.
- **Every id is a link.** Transaction hashes already linked. Now every NEAR account the site shows links to the account explorer, including the payees in the dashboard's lists, the agents on Manage, and the deposit address and refund account on the approval page. Addresses on another chain (a 1Click route's final recipient) link to that chain's explorer, built by the page from the chain name and the address format (`addressExplorerLink` in `packages/intents`), never taken from 1Click: Solana, Base, Ethereum, Arbitrum, Polygon, BNB Chain, Optimism. An address in the wrong format, or on another chain, stays plain text. A browser test builds the site with a stand-in explorer written as base URLs and checks the links on the front page, the dashboard and both kinds of approval page.
- **Two things the run showed, fixed here.** The front page counted only `SETTLED` payments, so the run's vault, whose one payment is a cross-chain one (`CROSS_CHAIN_PENDING`, sent to 1Click), would have shown "Payments made: 0". A sent cross-chain payment now counts. And the approval page now says that registering the deposit address is step 1 of 2 and is not the approval, after the owner took the registration for the approval during the run.

## Open questions (from AGENTS.md section 17)

- [x] Official `HACKATHON.md`: at the repo root; owner copy of 2026-10-23, synced with the live version on 2026-11-04.
- [x] Eligibility of code written from 2026-10-23: allowed under HACKATHON.md Q-001, which counts code from the 2026-10-19 announcement (ADR-000).
- [x] Demo stablecoin: native USDC on mainnet, checked on chain by the deploy script (ADR-028). Open: 1Click support (P1).
- [x] Mainnet protocol version >= 84: `scripts/deploy-mainnet.sh` reads it from the RPC and stops below 84 (ADR-028). Testnet: protocol 88 (2026-10-25).
- [x] Vault account key policy: on mainnet the key is deleted after the deploy, so the code is locked (ADR-028).
- [x] Agent account full-access key on mainnet: kept offline on the owner's machine, as on testnet (ADR-017, ADR-028).
- [ ] Reconciliation for a stuck TRANSFER_PENDING (callback out of gas).
- [ ] Storage pruning for terminal requests.
- [x] 1Click quote authenticity (P1): checked against 1Click's manager key from its SDK, on both recorded live quotes (ADR-034). The route stays owner-approved: a signature proves 1Click issued the quote, not that it will honour it.
- [x] 1Click deposit semantics for a NEAR-origin quote: a plain `ft_transfer` to `depositAddress` is what 1Click detects, confirmed by the first real deposit on 2026-11-04 (STATUS "Mainnet cross-chain run": 1Click `SUCCESS`, origin transaction `H6AjpNU5…`). The deposit address needed a `storage_deposit` first. Before the run: Consistent with the docs, not confirmed by them; the first real deposit settles it (ADR-033). Storage registration: the approval page checks it and offers a `storage_deposit`.
- [x] `GET /v0/status` answers for a deposit address before anything is deposited: HTTP 200 PENDING_DEPOSIT with the signed quote (recorded 2026-11-03, ADR-034).
- [x] Telegram chat binding flow: one-time code on the operator's terminal (ADR-020). Open: a wallet-signed binding.
- [x] Hosting: GitHub Pages from main, with the CI-built report (ADR-023), and Railway with real security headers (ADR-025). Open: a Content-Security-Policy.
- [ ] A trusted RPC endpoint for testnet/mainnet. The site uses `https://test.rpc.fastnear.com` on testnet for now.
- [ ] Reproducible vault build, so anyone can match the deployed code hash to the source (STATUS: "Build reproducibility").
- [x] License: MIT (`LICENSE`, chosen by the owner, 2026-11-04).
- [x] Custom domain: `spactvault.xyz`, on Railway (ADR-027).
- [ ] NEAR payout account and project description for the form (owner-provided).
