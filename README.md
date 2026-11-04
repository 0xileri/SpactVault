# SpactVault

*Autonomous spending. Human rules.*

![SpactVault: give your AI agent a budget, not your wallet. Paid instantly, needs your OK, or refused.](apps/web/public/og-image.png)

SpactVault is a payment-policy firewall for AI agents on NEAR. An agent asks a vault contract to pay someone. The contract enforces the owner's limits on chain: small payments go through, bigger ones wait until the owner approves that exact payment in their wallet, and anything over the limit is refused. The vault can also pay a recipient on another chain through NEAR Intents, always with the owner's approval.

**Live site:** https://spactvault.xyz · **X:** https://x.com/spactvault · **Security report:** https://spactvault.xyz/?page=security · **License:** [MIT](LICENSE)

> **Unaudited hackathon prototype.** It runs on NEAR mainnet with small amounts of real USDC. Keep amounts small.

## Hackathon tracks

- **AI Security & Defense.** The agent never holds the money. Every payment passes a policy the agent cannot change: per-payment and daily limits, allowlists, pause. Approvals are bound to a hash of the exact request, so a lying backend or a prompt-injected agent cannot slip in different terms. The Security Lab runs 18 attack cases against a real NEAR node on every commit and publishes the results (17 pass on chain, 1 in unit tests).
- **Agent Economy.** An agent pays for what it needs, such as API calls, on its own within a budget, through an MCP server that Claude Code or Codex can call. Above its instant limit it gets a review link and waits for a human. Its key can only ask the vault to pay; it cannot move funds itself.
- **Unstoppable DeFi.** No backend sits in the money path. The vault is a NEAR mainnet contract with no access keys, so nobody can change its code or rules outside its own owner methods. It pays native USDC (NEP-141) and pays across chains through NEAR Intents 1Click. The site reads the chain directly, and every transaction it shows links to an explorer.

## It ran on mainnet: 1 USDC to Base through NEAR Intents (2026-11-04)

Not simulated. The owner set everything up on https://spactvault.xyz with Meteor Wallet, and the agent was Claude Code calling this repo's MCP server:
1. The agent asked for 1 USDC to the owner's Base address. The vault held it.
2. The owner approved it in Meteor.
3. The vault paid 1Click's deposit address once, with a plain `ft_transfer`.
4. **0.997398 USDC arrived on Base 38 seconds later**, exactly the quoted amount, and 1Click reports `SUCCESS`.

| Step (UTC) | Transaction |
|---|---|
| 08:51 Create the vault account (3.2 NEAR) | [`Ag4bxAfC…`](https://nearblocks.io/txns/Ag4bxAfCh7Xy8rpWNdeQjLwwJyb8Q5BjZyXRdio831EB) |
| 08:51 Install the published code, start it, delete the setup key | [`8z8hiDRi…`](https://nearblocks.io/txns/8z8hiDRiXN4pHRoUhtn8drDx14hgjSMnehF8zHKupKNu) |
| 11:23 Fund 1.2 USDC | [`J7MHK4pD…`](https://nearblocks.io/txns/J7MHK4pDkrdeyRZH82iCkASRP5Ybn52sYNiQfaQH1SH5) |
| 12:12 Create the agent account with its function-call key | [`87yu1vbF…`](https://nearblocks.io/txns/87yu1vbFM2JAB7fc3yqLof9JwWWLAuZvrJx79Px6HDHB) |
| 12:17 Allow the Base recipient in the rules | [`HaunTFDn…`](https://nearblocks.io/txns/HaunTFDntVVtCv8ub3CoSJ26TvUNauUk4zgdPFyUfL5t) |
| 12:38 The agent requests 1 USDC cross-chain (`xc-mainnet-1`) | [`EHup5SHo…`](https://nearblocks.io/txns/EHup5SHoUkjPacSVKjNSEukj7oSZJAcpoD2WoY5JWR53) |
| 12:46 Register 1Click's deposit address with USDC | [`mrmhp3xu…`](https://nearblocks.io/txns/mrmhp3xum4Y9VMzyCjNtPYuw8T5XoD1ouVcr4zqMh7y) |
| 12:46 The owner approves; the vault pays the deposit address | [`H6AjpNU5…`](https://nearblocks.io/txns/H6AjpNU5m8zdVFqE6TAE5uvQx4SVCT3ToYMBg8sstj8f) |
| 12:47 1Click delivers 0.997398 USDC on Base | [`0x679696f9…`](https://basescan.org/tx/0x679696f968b4083dcbca8556e9f64550788c004f8722cb14ddd38e18551b9b31) |

- **Vault:** [`9dc744e29f8a…a086c9`](https://nearblocks.io/address/9dc744e29f8a079c6888dbdaafa8fb618b08c3734d00f4f25c8b31050ea086c9), code hash `5HwAUrjKbx5qc7NNyka4ndkAsXUdA9CsQ1ya66zzNNve` (the build in `apps/web/public/contracts/`), no access keys.
- **Agent:** [`agent2.0xileri.near`](https://nearblocks.io/address/agent2.0xileri.near), whose only key can call three vault methods.
- **1Click deposit address:** [`afaef961…c886b0`](https://nearblocks.io/address/afaef9616107eb4b0bee5f666b5cbd3f05517f24fbb5034b0f3add6f89c886b0). **Recipient:** [`0xdF8e…b938`](https://basescan.org/address/0xdF8ec3262A4ED45fa024805B2305F0e5FE73b938) on Base.

1Click's final record and the live quotes are test fixtures in `packages/intents/test/fixtures/live`, with 1Click's signatures checked. The full record is in [docs/STATUS.md](docs/STATUS.md#mainnet-cross-chain-run-2026-11-04).

## Why not just give the agent a wallet

A wallet key can spend everything. A NEAR function-call key restricts which methods can be called, but its `allowance` caps gas, not dollars. SpactVault puts the rules in a contract the agent cannot change:

- **on-chain budgets:** a per-payment instant limit, a hard cap, and a UTC-day budget that counts in-flight transfers, so parallel requests cannot overspend
- **approval bound to exact terms:** the owner approves a hash of the stored request (recipient, amount, token, vault, network, policy version, and for a cross-chain payment the deposit address and the final recipient), signed with a full-access key. A backend or bot that shows different terms produces a hash the vault rejects.
- **no replay:** each request id executes at most once; the transfer callback settles exactly once
- **tests that attack it:** the Security Lab runs the bypass attempts against a real NEAR node, and its page shows each attack with the test results behind it

## What works today

| Piece | State |
|---|---|
| Vault contract (`contracts/spact-vault`) | 66 unit tests; running on mainnet with no access keys |
| Tests on a real NEAR node (`contracts/integration-tests`) | 19 passing: auto payment, approval, parallel split, failed transfer, private callback, agent bypass attempts, init front-run, pause, the agent's restricted key, expiry, wrong vault or policy, and the cross-chain route |
| Website (`apps/web`): front page, dashboard, approval page, and the owner's tools (create a vault, add and take out money, rules, pause, agents, agent key, cross-chain) | live at https://spactvault.xyz; **every owner step ran with Meteor on mainnet** on 2026-11-04 (vault, funding, agent key, rules, cross-chain approval); browser-tested end to end on a local chain |
| Agent MCP server for Claude Code / Codex (`apps/mcp`) | **ran on mainnet from Claude Code**: direct payments on 2026-11-03 (paid, held for approval, blocked) and the first cross-chain payment on 2026-11-04 |
| NEAR Intents / 1Click route (`packages/intents`, vault route, MCP tool, approval page) | **one live payment on mainnet: 1 USDC to Base, `SUCCESS`** (above); the approval page checks 1Click's signed record of the deposit address before allowing approval |
| Security Lab (`packages/security-lab`, `?page=security`) | 17 of 18 attack cases pass on a local chain, T10 in unit tests only, none uncovered; CI rebuilds it on every commit |
| Telegram alert for the owner (`apps/notifier`) | built and tested against a mock Bot API on a local chain; not yet tried with real Telegram |
| Local demo, no wallet or funds needed (`scripts/dev-sandbox.sh`) | works |

Details: [docs/STATUS.md](docs/STATUS.md). Security mapping: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md). Decisions: [docs/DECISIONS.md](docs/DECISIONS.md).

## Built with NEAR

- **A NEAR mainnet contract with no keys.** The vault (Rust, near-sdk 5.29.1) holds the policy, the budgets, the approvals and the request state machine. It is created from the website and its setup key is deleted in the same transaction that installs the code, so nobody can redeploy it, its owner included. Owner actions attach 1 yoctoNEAR, which only a full-access key can sign.
- **NEP-141 USDC.** The vault pays native USDC on NEAR with `ft_transfer` and checks each result in a private callback. Every state change emits a NEP-297 event.
- **Function-call access keys for the agent.** The agent's only key can call `request_direct_payment`, `request_cross_chain_payment` and `execute_request` on its vault, with a gas allowance. A leaked agent key cannot move NEAR, add keys or call anything else; sandbox tests show each rejection.
- **NEAR Intents 1Click API.** The vault pays a 1Click quote's deposit address only after the owner approves that exact deposit address and final recipient. The site and the MCP server check 1Click's signature on every quote, and a refund 1Click reports never restores budget.
- **Meteor Wallet through NEAR Connect.** Owners sign on the website with any wallet in the NEAR Connect selector (`@hot-labs/near-connect`), each running in a sandboxed iframe. Meteor signed every owner step of the mainnet run.
- **The MCP server.** `apps/mcp` gives an agent three tools backed by its function-call key, and refuses to start with a broader key, the wrong vault or the wrong network.
- **NEAR JSON-RPC.** The website reads the vault straight from the chain, with no backend in between.

## Run your own vault from the website

Everything the owner does happens on https://spactvault.xyz with a browser wallet such as Meteor. No terminal. The site shows what each step does before your wallet asks you to sign, and on mainnet the Sign button stays off until you tick that you checked it (DECISIONS ADR-033). The only part that is not in the browser is your agent, which runs the MCP server on its own machine. Mainnet uses real funds: keep amounts small.

1. **Connect.** Open https://spactvault.xyz (it runs on mainnet), click **Create your vault**, and click **Connect NEAR wallet**. You see your account (for example `0xileri.near`) in the page header.
2. **Create a vault.** Open the **New vault** tab and keep **Any wallet** (the default; Meteor refuses the named way, see DECISIONS ADR-036). Keep `agent2.<your account>` as the agent, native USDC as the token, 3.2 NEAR for storage and the limits 1 / 3 / 5. Click **Review**. You see **Step 1 of 2: create** a 64-character address, and one wallet action: *Send 3.2 NEAR* to it. All of that NEAR stays in the vault for good. Tick the mainnet box, click **Sign in your wallet**, check that Meteor shows the same address, and approve. Then you see **Step 2 of 2** with the code hash `5HwAUrjKbx5qc7NNyka4ndkAsXUdA9CsQ1ya66zzNNve`. Click **Install and lock**; this tab signs it, so there is no wallet prompt. You see **Running and locked**, with a check for the matching code hash and **No access keys**. Keep the tab open until then. With a wallet that allows websites to install contract code, **With a name under your account** gives the vault a name like `vault2.<your account>` instead (ADR-035).
3. **Add money.** Click **Next: add money and give your agent a key**. Under **Add money**, click **Add tokens**, enter `3`, and click **Review**. You see a `storage_deposit` (once) and an `ft_transfer` to the vault. Sign. You see **Confirmed on chain** and **3 USDC in the vault**.
4. **Give your agent a key.** Under **Give your agent a key**, click **Set up an agent key**, keep `agent2`, and click **Make the key**. (Meteor signs this one.) Click **Download agent2.….json**. Then review and sign the transaction that creates `agent2.<your account>` with a key that can only call `request_direct_payment`, `request_cross_chain_payment` and `execute_request` on the vault. You see **agent2.… is ready** and the MCP settings for your agent. If your wallet refuses that transaction, pick **Any wallet** instead: the wallet only sends NEAR to a new 64-character account, this tab swaps in the restricted key, and then you sign `add_agent`. Put the file on the agent's machine, readable only by that user (`chmod 600`), and start the MCP server there with those settings ([apps/mcp/README.md](apps/mcp/README.md)).
5. **Allow a cross-chain destination.** Open the **Cross-chain** tab. Pick **USDC on Base** (or Solana), paste the recipient's address, enter `1`, and click **Get a price**. You see what the vault sends, what arrives, the minimum, and the fee. Click **Allow this recipient in your rules**, review the one-line change, and sign.
6. **Let the agent pay, and approve.** Ask your agent to pay that address 1 USDC. It calls `request_cross_chain_payment`, which files a real 1Click quote with the vault, and you get an approval link (and a Telegram alert, if set up). Open it. You see the deposit address and the final recipient apart, and **1Click confirms this deposit address**. If the deposit address is not registered with USDC yet, the page asks for that first (**Step 1 of 2**, a small `storage_deposit`); it is not the approval. Then **Approve and pay** (step 2). If 1Click's record does not match, Approve stays off. Approve in Meteor.
7. **Follow it.** The same page then shows **1Click:** with its status, checked every 5 seconds, and links to the transactions on NEAR and on the destination chain once 1Click reports them.

Rules, pause, agents and withdrawals are under **Manage**: change the limits or recipients (the review lists each change in words), **Pause all payments**, add or remove agents, and **Take money out** (tokens only, to your account by default). Each is one wallet signature. The NEAR you send when creating a vault stays in it for good: the vault has no way to send NEAR out (DECISIONS ADR-036).

This is the path the mainnet run took, with Meteor ("It ran on mainnet" above). Wallet limits and their browser-only workarounds are in DECISIONS ADR-033, ADR-035 and ADR-036, with a table of what each step asks the wallet to allow.

## Let Claude Code or Codex pay

`apps/mcp` is an MCP server with three tools: `request_payment`, `request_cross_chain_payment` (through 1Click, only with `ENABLE_1CLICK_LIVE=true`, always waits for the owner) and `get_payment_status`. It signs with the agent's function-call key and refuses to start with a full-access key. `scripts/dev-sandbox.sh` prints the `claude mcp add` and `codex mcp add` commands for the local chain. Then ask the agent to pay `api.test.near` 5 TUSD (paid at once) or 20 TUSD (it gets an approval link and waits for you). For a vault made on the website, its agent key step ends with the exact settings; register the server with `claude mcp add --scope user …` so it loads from any folder. Setup details: [apps/mcp/README.md](apps/mcp/README.md). On testnet, Claude Code paid 5 TUSD at once, waited for the owner on 12 TUSD, and was blocked paying `evil.testnet` (docs/STATUS.md).

## Security Lab

The live report is at https://spactvault.xyz/?page=security (raw: https://0xileri.github.io/SpactVault/security-report.json), rebuilt by CI on every commit to main. To build it yourself:

```bash
scripts/security-report.sh
```

This runs every suite, then builds `apps/web/public/security-report.json` from the runners' own output. Open `http://localhost:5173/?page=security` while `scripts/dev-sandbox.sh` is running. Each attack from AGENTS.md section 10 is listed with the exact tests behind it, their results and where they ran. The page also shows the commit, the run, and a sha256 of each raw output file. A case passes on a local chain only if every listed test passed and at least one ran against a NEAR node. The page recomputes that itself instead of trusting the file. In CI the same report is the `security-report` artifact of each run.

## Live on mainnet

| | Account |
|---|---|
| Site | https://spactvault.xyz (also https://0xileri.github.io/SpactVault/) |
| Vault of the cross-chain run (P1 code, created from the website) | [`9dc744e29f8a079c6888dbdaafa8fb618b08c3734d00f4f25c8b31050ea086c9`](https://nearblocks.io/address/9dc744e29f8a079c6888dbdaafa8fb618b08c3734d00f4f25c8b31050ea086c9), no access keys |
| First vault (P0 code, deployed with `scripts/deploy-mainnet.sh` on 2026-11-01) | [`vault.0xileri.near`](https://nearblocks.io/address/vault.0xileri.near), no access keys |
| Owner (Meteor Wallet) | [`0xileri.near`](https://nearblocks.io/address/0xileri.near) |
| Agents | [`agent2.0xileri.near`](https://nearblocks.io/address/agent2.0xileri.near) (three methods, for the P1 vault), [`agent.0xileri.near`](https://nearblocks.io/address/agent.0xileri.near) (two methods, for the P0 vault) |
| Token | native USDC, [`17208628…36133a1`](https://nearblocks.io/address/17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1) |
| Limits (both vaults) | paid at once up to 1 USDC, waits up to 3, 5 a day |

**First mainnet payments (2026-11-03),** made by the agent from Claude Code through the MCP server on the P0 vault, to the owner's own payee `api.0xileri.near`:

| Request | What happened | Transaction |
|---|---|---|
| 0.5 USDC | paid at once (under the 1 USDC instant limit) | [`3ABgwMWy…`](https://nearblocks.io/txns/3ABgwMWyKiS24AYtHSXgzVggekiNx5cb6xi3EucNqiJP) |
| 2 USDC | waited; the owner approved and paid it with Meteor Wallet | request [`39dMJm5x…`](https://nearblocks.io/txns/39dMJm5xkDyqw5Mdjjm1JoNdLBkPrwwoJnQMPQaNN6HV), approval [`RqphTo2H…`](https://nearblocks.io/txns/RqphTo2Hy9ifsW7Y2PDXFM2A8gtcxu6GHdBuzfcP2oB) |
| 4 USDC | blocked (over the 3 USDC limit per payment); nothing sent | refused request [`dpwtTTim…`](https://nearblocks.io/txns/dpwtTTimLp3Sq4RJcXpa3S45zcLdUwZ2bABHRKe22Q3) |

The owner later took the P0 vault's remaining 2.5 USDC back with the site's Take money out ([`gxm1eTEN…`](https://nearblocks.io/txns/gxm1eTENWvyjJmZyte76WFe6txH6o22ZB7DawVDC4aK)). A testnet vault ([`vault.spact-ileri2.testnet`](https://testnet.nearblocks.io/address/vault.spact-ileri2.testnet), TUSD) ran the same flows from 2026-10-25 and still opens with `?network=testnet` (docs/STATUS.md).

## Hosted site

After every job passes on main, CI publishes the site to GitHub Pages at https://0xileri.github.io/SpactVault/, with the Security Lab report from that same run. `/` is the front page, with one action (Create your vault), the vault's limits as read from its policy and live numbers from chain; the owner dashboard is `?page=overview`, the Security Lab `?page=security`, Privacy and terms `?page=legal`, and approval links stay `?request=<id>`. Nobody uploads the report by hand. A build without a vault id is the Security Lab alone; the overview and approval links then say that no vault is connected.

Repository settings this needs: Settings → Pages → Source **GitHub Actions** (once), and repository variables under Settings → Secrets and variables → Actions → Variables:
- `VITE_NEAR_NETWORK`, `VITE_NEAR_RPC_URL` and `VITE_VAULT_ID` for the main network: `mainnet`, `https://rpc.mainnet.fastnear.com` and the vault of the mainnet cross-chain run, `9dc744e29f8a079c6888dbdaafa8fb618b08c3734d00f4f25c8b31050ea086c9`. Without them the build defaults to testnet and `https://test.rpc.fastnear.com`.
- Optional, for links to a second network (`?network=testnet`; there is no switch on the page, ADR-037): `VITE_TESTNET_VAULT_ID`, now `vault.spact-ileri2.testnet` (with `VITE_TESTNET_RPC_URL`, default `https://test.rpc.fastnear.com`). On a testnet-first site, use `VITE_MAINNET_VAULT_ID` and `VITE_MAINNET_RPC_URL` instead.
- Optional, explorer links: `VITE_EXPLORER_TX_URL` and `VITE_EXPLORER_ACCOUNT_URL`, as a template with `{hash}` / `{account}` or a plain base URL such as `https://nearblocks.io/txns/` (ADR-038). Empty means nearblocks on testnet and mainnet.
- Optional, for more than one vault on a network: `VITE_EXTRA_VAULTS` (comma-separated, each `account` or `account=label`), plus `VITE_VAULT_LABEL` for the default vault, here `VITE_VAULT_LABEL=P1 vault` and `VITE_EXTRA_VAULTS=vault.0xileri.near=P0 vault`. A picker in the page header then moves between them (ADR-033). A vault the site does not list still opens if it runs a SpactVault build the site knows and has no access keys.

After changing them, re-run the workflow on main. These are public values, not secrets.

On a `?network=testnet` link, every link on the page keeps `?network=testnet`. Approval links from the MCP server and the Telegram alert name their vault (`?request=<id>&vault=<vault>`), so they open on the right network on their own (DECISIONS ADR-031).

## Deploy to Railway

The root `Dockerfile` builds the site and serves it with Caddy, which sends security headers that GitHub Pages cannot, such as `X-Frame-Options: DENY` (DECISIONS ADR-025). CI builds and checks the same image on every push (`web-image` job).

1. At https://railway.com create a project from the GitHub repo. If Railway offers one service per package, keep a single service at the repository root. Its build log says `Using detected Dockerfile!`.
2. Under the service's **Variables**, set the main network: here `VITE_NEAR_NETWORK=mainnet`, `VITE_NEAR_RPC_URL=https://rpc.mainnet.fastnear.com`, `VITE_VAULT_ID=9dc744e29f8a079c6888dbdaafa8fb618b08c3734d00f4f25c8b31050ea086c9` (the vault of the mainnet cross-chain run) with `VITE_VAULT_LABEL=P1 vault`, and `VITE_EXTRA_VAULTS=vault.0xileri.near=P0 vault` to keep the first vault in the picker. Explorer links: `VITE_EXPLORER_TX_URL=https://nearblocks.io/txns/` and `VITE_EXPLORER_ACCOUNT_URL=https://nearblocks.io/address/` (ADR-038). `VITE_TESTNET_VAULT_ID` is optional: the site has no network switch, but `?network=testnet` links open that vault. The other settings have defaults in the `Dockerfile`: testnet, `https://test.rpc.fastnear.com`, the second network's RPC, the Security Lab report from the GitHub Pages site, and this repository's link.
   The same `VITE_VAULT_LABEL` / `VITE_EXTRA_VAULTS` work here. 1Click needs nothing: the image proxies it at `/1click` and the build points there by default (`VITE_ONECLICK_URL`).
3. Under **Settings → Networking**, generate a domain or add your own; this project uses `spactvault.xyz`. The share card uses the generated domain automatically (`RAILWAY_PUBLIC_DOMAIN`). For a custom domain, also set `VITE_SITE_URL=https://<your domain>`.
4. Under **Settings**, turn on **Wait for CI**, so Railway deploys a commit only after GitHub Actions passed on it.
5. When it is up, check it: `scripts/check-web-image.sh https://<domain> https://<domain>`.

Cost: Railway's trial is a one-time $5 for 30 days. After that the Free plan includes $1 a month, or Hobby is $5 a month.

## Get a Telegram alert

`apps/notifier` messages you when a payment waits for your approval: the exact terms plus a link to the approval page. It messages again when the payment is paid. The bot can't approve anything; your wallet does. Link your chat once with a code the notifier prints on its terminal. Setup: [apps/notifier/README.md](apps/notifier/README.md).

## Try the approval flow locally

No wallet, testnet or funds needed. One command starts a local NEAR chain with a funded vault, a local signer holding the sandbox owner key, and the approval page.

```bash
pnpm install --frozen-lockfile
scripts/dev-sandbox.sh
```

1. Wait for `Open http://localhost:5173/?request=demo-approve-1` and open it. You see **25 TUSD to api.test.near**, status **Waiting for you**, the agent's note, why it waits (over the **10 TUSD instant limit**), a green **Safety check passed** box, and **47 TUSD of 50** left to spend today.
2. Click **Connect Local sandbox signer**. The header shows `owner.test.near`.
3. Click **Approve and pay**. You see **Done: approved and paid** with a transaction hash, the status turns **Paid**, and the page says **You approved it, and it was sent.**
4. Open http://localhost:5173/?page=overview, the dashboard. The demo request shows as **Paid** under **What your agent did**, **Left to spend today** shows **22 TUSD of 50 TUSD**, and **Money in the vault** shows **972 TUSD**. One request is still **Waiting for your OK**: the cross-chain one below.
5. **Cross-chain route, locally.** Open http://localhost:5173/?request=demo-cross-chain-1. You see **5 TUSD to 7EcDh… on sol, through NEAR Intents 1Click**, with the **1Click deposit address on NEAR** (`deposit.test.near`) and the **final recipient** listed apart, **Refunds go to** `vault.test.near`, why it waits (cross-chain payments always do, whatever the amount), and **1Click confirms this deposit address**. Click **Approve and pay**. You see **Done: approved and sent to the 1Click deposit address**, the status turns **Sent to 1Click**, then **1Click: Delivered, says 1Click** with a Solana link, and the dashboard shows **17 TUSD of 50 TUSD** left. Locally there is no 1Click, so `deposit.test.near` stands in for its deposit address and a server on localhost answers in 1Click's place, signing with a published test key; nothing leaves the local chain. The vault's part (exact amount, exact deposit account, owner approval, budget spent) is the same code as on mainnet. The real thing, with 1Click delivering on Base, is in "It ran on mainnet" above.
6. **Owner tools.** Open the **New vault**, **Manage** and **Cross-chain** tabs. Everything in "Run your own vault from the website" works here against the local chain, with the local signer instead of a wallet.

To watch the attacks fail, run `pnpm e2e`. It drives Chromium against the same local setup, and you see `49 passed`, including every owner flow from "Run your own vault from the website" against the local chain. Three of those tests rewrite the RPC response on its way to the page:

- **Recipient changed, hash kept:** the page shows **Safety check failed: do not approve** and the approve button is disabled.
- **Recipient and hash both forged:** the page shows the attacker's terms with a passing check, the owner approves, and the vault refuses with `HASH_MISMATCH`. The test then reads the chain directly: nothing moved and the request still awaits approval.
- **Budget inflated:** the dashboard sees that the numbers don't add up and shows **Today's spending numbers do not add up** instead of them.

## Deploy from the command line (developers)

The website is the owner's way to create a vault (above). Before it existed, the testnet and mainnet vaults were deployed with `scripts/deploy-testnet.sh` (2026-10-25) and `scripts/deploy-mainnet.sh` (2026-11-01, `vault.0xileri.near`). Both still work, are rehearsed against a local node (`scripts/rehearse-deploy-sandbox.sh`, `scripts/rehearse-mainnet-sandbox.sh`), and explain themselves in their headers. They need bash, rustup, Node 22.12+ and near-cli-rs, and the mainnet one waits for you to type `deploy to mainnet`. They give the agent the older two-method key, which cannot file cross-chain requests.

## Run the tests

Prerequisites: rustup (run `rustup toolchain install` inside `contracts/` to get the pinned 1.97.0 toolchain and wasm target), Node 22.12+, pnpm 10, and a C compiler (only used in containers with a low open-file limit).

```bash
# everything, then the Security Lab report
scripts/security-report.sh

# or piece by piece
scripts/test-contracts.sh                      # vault unit, mock token, sandbox tests on a local NEAR node
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm e2e                                       # Chromium against a local chain
pnpm mcp:sandbox && pnpm notifier:sandbox      # the MCP server and the notifier against a local chain
```

Expected on 2026-11-04: vault unit `66 passed`, mock token `1`, sandbox `19`, shared `26`, intents `32`, web `79`, mcp `33`, notifier `28`, security-lab `9`, browser `49`, MCP over stdio `11`, notifier on a sandbox `4`. The first sandbox run downloads the NEAR sandbox node binary.

On testnet or mainnet the page uses a real wallet through NEAR Connect. Configure it with `apps/web/.env.example`.

## Built during the hackathon

The build window is 2026-11-01 to 2026-11-14. **This project started earlier, on 2026-10-23**, when the owner told the coding agent to begin; the commit history shows it, and DECISIONS ADR-000 records it and the open question of whether that is allowed. Before Nov 1: the vault contract and its sandbox tests, the approval page, the MCP server, the Telegram notifier, the Security Lab, the testnet deployment, Railway hosting and the brand.

From Nov 1 (merged pull requests):
- **Nov 1:** mainnet deploy script with a sandbox rehearsal and on-chain tests for expired approvals and wrong-vault approvals (#15); the first mainnet vault, `vault.0xileri.near`, deployed and verified (#16); plain-language front page, dashboard and approval page (#17, #18).
- **Nov 2:** one site for testnet and mainnet (#19, its switch later removed in #25).
- **Nov 3:** the P1 cross-chain route: owner-approved payments through NEAR Intents 1Click, in the contract, the MCP server and the site (#20); the first mainnet payments from Claude Code: paid, held for approval, blocked (#21); every owner step on the website, with live 1Click answers recorded and 1Click's quote signatures checked (#22); vault and agent setup that any NEAR wallet can sign (#23).
- **Nov 4:** Take money out for vault tokens (#24); a simpler site with one action (#25); **the first cross-chain payment on mainnet, 1 USDC to Base, `SUCCESS`** (#26); the site pointed at that vault, with every account and hash linked (#27).

## Repo map

```text
AGENTS.md                 canonical product + security spec (read first)
contracts/                Rust workspace: vault, mock token, sandbox tests
apps/web/                 the website: front page, dashboard, approval page, owner tools; dev signer; browser tests
apps/mcp/                 the agent's MCP server (stdio) and its sandbox tests
apps/notifier/            Telegram alerts for the owner, with a mock Bot API for tests
packages/shared/          TS types, request digest, amount helpers, JSON schemas, RPC client
packages/intents/         NEAR Intents 1Click client: quotes, signatures, status, explorer links; live fixtures
packages/security-lab/    builds the Security Lab report from test output; catalog of attacks
scripts/                  build, deploy and test scripts
docs/                     architecture, threat model, decisions, status, integrations
```

## License

[MIT](LICENSE).
