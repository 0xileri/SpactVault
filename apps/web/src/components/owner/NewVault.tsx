import { useEffect, useState } from "react";

import { ftMetadataSchema, parseUnits, policySchema, viewAccount, viewFunction, type FtMetadata, type Policy } from "@spact/shared";

import type { AppConfig } from "../../config.js";
import { fetchBuild, LATEST_BUILD } from "../../contracts.js";
import { errorMessage } from "../../format.js";
import { useLink } from "../../network.js";
import {
  createVaultAccountActions,
  formatNear,
  fundImplicitActions,
  implicitAccountId,
  parseNear,
  policyProblems,
  subAccountId,
  vaultStorageNeeded,
  YOCTO_PER_NEAR,
  type InitArgs,
} from "../../owner/actions.js";
import {
  cancelDeploy,
  checkDeployed,
  clearPending,
  deployAndLock,
  generateKey,
  initVault,
  inspectUntilLocked,
  inspectVault,
  loadPending,
  savePending,
  type DeployMode,
  type LockCheck,
  type PendingDeploy,
} from "../../owner/deploy.js";
import { lockProblem } from "../../contracts.js";
import type { OwnerSigner } from "../../signers/index.js";
import type { SignerState } from "../../useSigner.js";
import { Badge, Button, Card, Mono, Notice } from "../ui.js";
import { MainnetConfirm, SignReview, splitList, TextField, TxLink } from "./SignReview.js";

/** Native USDC on NEAR mainnet (docs/INTEGRATIONS.md, scripts/deploy-mainnet.sh). */
export const MAINNET_USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

interface Form {
  mode: DeployMode;
  name: string;
  agents: string;
  token: string;
  auto: string;
  cap: string;
  daily: string;
  recipients: string;
  ttlHours: string;
  maxOpen: string;
  perDay: string;
  near: string;
}

type Step =
  | { kind: "form" }
  | { kind: "review-account"; pending: PendingDeploy; fund: bigint; token: FtMetadata; wasm: Uint8Array | null }
  | { kind: "install"; pending: PendingDeploy; createTx: string | null }
  | { kind: "installing"; pending: PendingDeploy; createTx: string | null }
  | { kind: "done"; pending: PendingDeploy; check: LockCheck; installTx: string | null }
  | { kind: "cancelled"; vaultId: string; txHash: string | null };

const DEFAULT_NEAR = "3.2";

function defaults(owner: string | null): Form {
  return {
    // some NEAR wallets refuse the named way (they block websites from installing contract code, ADR-035)
    mode: "any-wallet",
    name: "vault2",
    agents: owner ? `agent2.${owner}` : "",
    token: "",
    auto: "1",
    cap: "3",
    daily: "5",
    recipients: "",
    ttlHours: "24",
    maxOpen: "3",
    perDay: "20",
    near: DEFAULT_NEAR,
  };
}

async function tokenMetadata(rpcUrl: string, token: string): Promise<FtMetadata> {
  const parsed = ftMetadataSchema.safeParse(await viewFunction(rpcUrl, token, "ft_metadata").catch(() => null));
  if (!parsed.success) throw new Error(`${token} did not answer ft_metadata like a NEP-141 token. Check the token account id.`);
  return parsed.data;
}

function positiveInt(text: string, what: string): number {
  if (!/^[1-9]\d{0,6}$/.test(text.trim())) throw new Error(`${what} must be a whole number above zero.`);
  return Number(text.trim());
}

/** Turns the form into what `new` gets for `vaultId`, or throws a sentence saying what to fix. */
async function buildInit(config: AppConfig, owner: string, form: Form, vaultId: string): Promise<{ init: InitArgs; fund: bigint; token: FtMetadata }> {
  const token = form.token.trim();
  const meta = await tokenMetadata(config.rpcUrl, token);
  const units = (v: string, what: string) => {
    try {
      return parseUnits(v.trim(), meta.decimals).toString();
    } catch {
      throw new Error(`${what}: enter an amount of ${meta.symbol} with at most ${meta.decimals} decimals.`);
    }
  };
  if (!/^\d+(\.\d+)?$/.test(form.ttlHours.trim())) throw new Error("How long a request may wait: enter hours, e.g. 24.");
  const policy: Policy = {
    tokens: [{ token, auto_limit: units(form.auto, "Paid instantly up to"), hard_tx_limit: units(form.cap, "Per-payment cap"), daily_limit: units(form.daily, "Daily limit") }],
    recipients: splitList(form.recipients),
    max_open_approvals: positiveInt(form.maxOpen, "Payments waiting at once"),
    max_requests_per_day: positiveInt(form.perDay, "Requests per day"),
    approval_ttl_sec: Math.round(Number(form.ttlHours) * 3600),
    cross_chain: [],
  };
  const problems = policyProblems(policySchema.parse(policy), vaultId);
  if (problems.length > 0) throw new Error(problems.join(" "));
  const agents = splitList(form.agents);
  for (const a of agents) {
    if (a === owner) throw new Error("The agent must not be your own account.");
    if (a === vaultId) throw new Error("The agent must not be the vault.");
  }
  if (new Set(agents).size !== agents.length) throw new Error("An agent is listed twice.");

  const fund = parseNear(form.near);
  const needed = vaultStorageNeeded(LATEST_BUILD.bytes ?? 0);
  if (fund < needed) throw new Error(`The vault needs at least ${formatNear(needed)} NEAR: about 1 NEAR per 100 kB of code, plus a little for its data.`);
  if (await viewAccount(config.rpcUrl, vaultId)) throw new Error(`${vaultId} already exists. Pick another name.`);
  const mine = await viewAccount(config.rpcUrl, owner);
  if (!mine || BigInt(mine.amount) < fund + YOCTO_PER_NEAR / 20n) {
    throw new Error(`${owner} has ${mine ? formatNear(BigInt(mine.amount)) : "no"} NEAR. Creating this vault needs ${formatNear(fund)} NEAR plus gas.`);
  }
  return { init: { owner, agents, network: config.network, policy }, fund, token: meta };
}

function Checklist({ check }: { check: LockCheck }) {
  return (
    <ul className="space-y-1 text-sm" data-testid="deploy-checks">
      {check.lines.map((l) => (
        <li key={l.text} className="flex gap-2" data-ok={l.ok}>
          <span aria-hidden="true">{l.ok ? "✓" : "✗"}</span>
          <span className={l.ok ? "text-zinc-800" : "font-medium text-rose-700"}>{l.text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Create a vault from the browser (ADR-033, ADR-035), in one of two ways:
 * - named (`name.<owner>`): the wallet creates the account, installs the published code and adds an init key
 *   that can only call `new`; this tab then calls `new` with it.
 * - any wallet (an implicit account): the wallet only sends NEAR; this tab installs the code, calls `new` and
 *   deletes its key.
 * Either way the vault ends with no key that could change its code (contracts.ts lockProblem).
 */
export function NewVault({ config, signer, wallet }: { config: AppConfig; signer: OwnerSigner | null; wallet: SignerState }) {
  const link = useLink();
  const owner = wallet.accountId;
  const [form, setForm] = useState<Form>(() => defaults(owner));
  const [step, setStep] = useState<Step>({ kind: "form" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [resumeNote, setResumeNote] = useState<string | null>(null);
  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  // default token: native USDC on mainnet, otherwise the token of this site's own vault
  useEffect(() => {
    let alive = true;
    if (config.network === "mainnet") {
      setForm((f) => (f.token ? f : { ...f, token: MAINNET_USDC }));
      return;
    }
    viewFunction(config.rpcUrl, config.vaultId, "get_policy")
      .then((raw) => {
        const p = policySchema.safeParse(raw);
        const first = p.success ? p.data.tokens[0]?.token : undefined;
        if (alive && first) setForm((f) => (f.token ? f : { ...f, token: first }));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [config]);

  useEffect(() => {
    if (owner) setForm((f) => (f.agents ? f : { ...f, agents: `agent2.${owner}` }));
  }, [owner]);

  // an unfinished setup from this tab (a reload, or a wallet that redirected): pick it up where it stopped
  useEffect(() => {
    const pending = loadPending(config.network);
    if (!pending) return;
    let alive = true;
    void inspectVault(config.rpcUrl, pending.vaultId)
      .then((found) => {
        if (!alive) return;
        const ourKey = found.keys.some((k) => k.publicKey === pending.key.publicKey);
        if (!found.account) {
          clearPending();
          setResumeNote(`An earlier setup of ${pending.vaultId} was never signed, so nothing was created.`);
        } else if (found.config !== null) {
          clearPending();
          setStep({ kind: "done", pending, check: checkDeployed(found, { build: LATEST_BUILD, init: pending.init, vaultId: pending.vaultId }), installTx: null });
        } else if (ourKey) {
          setStep({ kind: "install", pending, createTx: null });
        } else {
          clearPending();
          setResumeNote(`${pending.vaultId} exists but no longer has this tab's setup key, so this tab cannot finish it.`);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [config]);

  async function toReview() {
    if (!owner) return;
    setBusy(true);
    setError(null);
    try {
      const key = await generateKey();
      const vaultId = form.mode === "named" ? subAccountId(form.name.trim(), owner) : await implicitAccountId(key.publicKey);
      const built = await buildInit(config, owner, form, vaultId);
      // a named vault's code goes into the wallet's transaction, so it is downloaded and checked now
      const wasm = form.mode === "named" ? await fetchBuild(LATEST_BUILD) : null;
      const pending: PendingDeploy = {
        mode: form.mode,
        network: config.network,
        rpcUrl: config.rpcUrl,
        vaultId,
        owner,
        buildId: LATEST_BUILD.id,
        init: built.init,
        key,
        createdAt: Date.now(),
      };
      setStep({ kind: "review-account", pending, fund: built.fund, token: built.token, wasm });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function install(pending: PendingDeploy, createTx: string | null) {
    setStep({ kind: "installing", pending, createTx });
    setError(null);
    try {
      const sent = pending.mode === "named" ? await initVault(pending) : await deployAndLock(pending, await fetchBuild(LATEST_BUILD));
      if (sent.failure) throw new Error(`The vault refused to start: ${sent.failure}`);
      const found = await inspectUntilLocked(config.rpcUrl, pending.vaultId, LATEST_BUILD.codeHash);
      const check = checkDeployed(found, { build: LATEST_BUILD, init: pending.init, vaultId: pending.vaultId });
      if (found.config !== null && lockProblem(found.keys, pending.vaultId) === null) clearPending();
      setStep({ kind: "done", pending, check, installTx: sent.txHash });
    } catch (e) {
      setError(errorMessage(e));
      setStep({ kind: "install", pending, createTx });
    }
  }

  async function cancel(pending: PendingDeploy) {
    setBusy(true);
    setError(null);
    try {
      const sent = await cancelDeploy(pending);
      if (sent.failure) throw new Error(sent.failure);
      clearPending();
      setStep({ kind: "cancelled", vaultId: pending.vaultId, txHash: sent.txHash });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Create a vault</h1>
      <p className="text-sm text-zinc-600">
        Two steps, both from this page. First your wallet pays for the vault account. Then this tab starts the vault with a key only it holds, so the
        vault ends up with no key that could change its code, not even yours. Your agent gets its own key later.
      </p>
    </div>
  );

  if (step.kind === "cancelled") {
    return (
      <div className="space-y-6">
        {header}
        <Notice tone="info" title={`${step.vaultId} was deleted`}>
          <p>Its NEAR went back to your account.{step.txHash ? <> Transaction <TxLink config={config} txHash={step.txHash} />.</> : null}</p>
        </Notice>
      </div>
    );
  }

  if (step.kind === "done") {
    const v = encodeURIComponent(step.pending.vaultId);
    return (
      <div className="space-y-6">
        {header}
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">
              <Mono>{step.pending.vaultId}</Mono>
            </h2>
            <span data-testid="deploy-result" data-ok={step.check.ok}>
              <Badge tone={step.check.ok ? "good" : "bad"}>{step.check.ok ? "Running and locked" : "Check failed"}</Badge>
            </span>
          </div>
          <Checklist check={step.check} />
          {step.installTx ? (
            <p className="text-sm text-zinc-600">
              Install transaction <TxLink config={config} txHash={step.installTx} testId="install-tx" />
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3 text-sm font-medium">
            <a className="underline" href={link(`?page=manage&vault=${v}`)} data-testid="next-fund">
              Next: add money and give your agent a key
            </a>
            <a className="underline" href={link(`?page=overview&vault=${v}`)}>
              Open its dashboard
            </a>
          </div>
        </Card>
      </div>
    );
  }

  if (step.kind === "install" || step.kind === "installing") {
    const p = step.pending;
    return (
      <div className="space-y-6">
        {header}
        <Card className="space-y-4" >
          <div>
            <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Step 2 of 2: review before this tab signs</p>
            <h3 className="mt-1 text-base font-semibold">
              {p.mode === "named" ? (
                <>
                  Start the vault on <Mono>{p.vaultId}</Mono>
                </>
              ) : (
                <>
                  Install the vault code on <Mono>{p.vaultId}</Mono> and lock it
                </>
              )}
            </h3>
          </div>
          {step.createTx ? (
            <p className="text-sm text-zinc-600">
              Step 1 is on chain: <TxLink config={config} txHash={step.createTx} testId="create-tx" />
            </p>
          ) : (
            <p className="text-sm text-zinc-600">{p.vaultId} exists and still has this tab&apos;s setup key.</p>
          )}
          <dl className="grid gap-2 text-sm sm:grid-cols-[12rem_1fr]" data-testid="install-details">
            <dt className="text-zinc-500">Code</dt>
            <dd>
              {LATEST_BUILD.label}, <Mono>{LATEST_BUILD.file}</Mono> ({LATEST_BUILD.bytes?.toLocaleString("en-US")} bytes)
            </dd>
            <dt className="text-zinc-500">Code hash</dt>
            <dd>
              <Mono>
                <span data-testid="expected-code-hash">{LATEST_BUILD.codeHash}</span>
              </Mono>
              <span className="block text-xs text-zinc-500">The page checks the download against this before sending it, and the account after.</span>
            </dd>
            <dt className="text-zinc-500">Owner</dt>
            <dd>
              <Mono>{p.init.owner}</Mono>
            </dd>
            <dt className="text-zinc-500">Agents</dt>
            <dd>
              <Mono>{p.init.agents.join(", ") || "none yet"}</Mono>
            </dd>
            <dt className="text-zinc-500">{p.mode === "named" ? "How" : "Then"}</dt>
            <dd>
              {p.mode === "named" ? (
                <>
                  Calls <Mono>new</Mono> with the setup key <Mono>{p.key.publicKey.slice(0, 20)}…</Mono>, which can call nothing else. The code was installed in
                  step 1. After this the key is spent: the vault refuses <Mono>new</Mono> forever. If anything fails, nothing changes and you can try again.
                </>
              ) : (
                <>
                  Deletes the setup key <Mono>{p.key.publicKey.slice(0, 20)}…</Mono> in the same transaction. If anything fails, nothing changes and you can try again.
                </>
              )}
            </dd>
          </dl>
          <details>
            <summary className="cursor-pointer text-xs font-medium text-zinc-600">Exact settings sent to the vault</summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded bg-white p-3 text-xs ring-1 ring-line">{JSON.stringify(p.init, null, 2)}</pre>
          </details>
          {config.network === "mainnet" ? (
            <MainnetConfirm checked={confirmed} onChange={setConfirmed}>
              <p>This tab signs with the setup key, not your wallet, so there is no wallet prompt. The vault can never be changed afterwards.</p>
            </MainnetConfirm>
          ) : null}
          {error ? (
            <Notice tone="bad" title="Not installed">
              <p className="break-words">{error}</p>
            </Notice>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void install(p, step.createTx)} disabled={step.kind === "installing" || (config.network === "mainnet" && !confirmed)} testId="install">
              {step.kind === "installing" ? "Working…" : p.mode === "named" ? "Start the vault" : "Install and lock"}
            </Button>
            {p.mode === "any-wallet" ? (
              <Button variant="danger" onClick={() => void cancel(p)} disabled={step.kind === "installing" || busy} testId="cancel-deploy">
                Cancel: delete {p.vaultId.slice(0, 12)}… and return its NEAR
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-zinc-500">
            Keep this tab open until it says the vault is running. A reload is fine; closing the tab now strands the NEAR sent in step 1
            {p.mode === "named" ? ", because only this tab's setup key can start the vault." : "."}
          </p>
        </Card>
      </div>
    );
  }

  if (step.kind === "review-account") {
    const p = step.pending;
    return (
      <div className="space-y-6">
        {header}
        <SignReview
          config={config}
          signer={signer}
          wallet={wallet}
          title={`Step 1 of 2: create ${p.vaultId}`}
          receiverId={p.vaultId}
          signerId={p.owner}
          actions={p.mode === "named" && step.wasm ? createVaultAccountActions(p.vaultId, step.fund, step.wasm, p.key.publicKey) : fundImplicitActions(step.fund)}
          changes={[
            p.mode === "named"
              ? `Creates ${p.vaultId}, sends it ${formatNear(step.fund)} NEAR and installs the published vault code (code hash ${LATEST_BUILD.codeHash}, checked in this browser).`
              : `Sends ${formatNear(step.fund)} NEAR to ${p.vaultId}, a new account whose only key this tab made. Every wallet can sign a plain transfer.`,
            `All ${formatNear(step.fund)} NEAR stays in the vault for good: about ${formatNear(vaultStorageNeeded(LATEST_BUILD.bytes ?? 0) - YOCTO_PER_NEAR / 20n)} NEAR stores the code and the rest pays for stored requests. The vault has no way to send NEAR out, so none of it comes back to you. Tokens you add later can be taken out.`,
            p.mode === "named"
              ? "Adds a setup key that only this tab has. It can only call `new` on the vault, once. No full-access key is added."
              : "Step 2, signed by this tab, installs the code, starts the vault and deletes that key.",
            `Rules: ${step.token.symbol} paid instantly up to ${form.auto}, cap ${form.cap} per payment, ${form.daily} a day.`,
          ]}
          onCancel={() => setStep({ kind: "form" })}
          onDone={(txHash) => {
            setStep({ kind: "install", pending: p, createTx: txHash });
          }}
        >
          <SaveOnMount pending={p} />
          {p.mode === "named" ? (
            <p className="text-xs text-zinc-500" data-testid="wallet-refused-hint">
              If your wallet refuses this transaction, nothing is sent. Go back and choose <strong>Any wallet</strong>: the wallet then only sends NEAR.
            </p>
          ) : null}
        </SignReview>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      {resumeNote ? <Notice tone="info" title="Nothing to finish">{resumeNote}</Notice> : null}
      {!owner ? (
        <Notice tone="info" title="Connect your wallet first">
          <p>The vault is created as a sub-account of the account you connect, and that account becomes its owner.</p>
        </Notice>
      ) : null}
      <Card className="space-y-5">
        <fieldset className="space-y-2" data-testid="vault-mode">
          <legend className="text-sm font-medium text-zinc-800">How the vault is created</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="vault-mode" checked={form.mode === "any-wallet"} onChange={() => setForm((f) => ({ ...f, mode: "any-wallet" }))} className="mt-0.5" data-testid="mode-any-wallet" />
            <span>
              <span className="font-medium">Any wallet</span>, at a 64-character address. Works with any NEAR wallet.
              <span className="block text-xs text-zinc-500">Your wallet only sends NEAR, which every NEAR wallet can do. This tab does the rest, and the vault ends with no keys at all.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="vault-mode" checked={form.mode === "named"} onChange={() => setForm((f) => ({ ...f, mode: "named" }))} className="mt-0.5" data-testid="mode-named" />
            <span>
              <span className="font-medium">With a name under your account</span>, like <Mono>{`vault2.${owner ?? "you.near"}`}</Mono>.
              <span className="block text-xs text-zinc-500">
                Your wallet creates the account, installs the code and adds a one-use setup key. Some NEAR wallets refuse this: they block websites from installing contract
                code. Only for a wallet that allows it; if yours refuses, nothing is sent.
              </span>
            </span>
          </label>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          {form.mode === "named" ? (
          <TextField
            label="Vault name"
            value={form.name}
            onChange={set("name")}
            testId="vault-name"
            hint={owner ? <>Creates <Mono>{`${form.name || "…"}.${owner}`}</Mono></> : "Becomes name.your-account"}
          />
          ) : null}
          <TextField label="NEAR for storage" value={form.near} onChange={set("near")} testId="vault-near" inputMode="decimal" hint="At least 2.8 NEAR: the code alone is 274 kB. This NEAR stays in the vault for good." />
          <TextField label="Agent accounts" value={form.agents} onChange={set("agents")} testId="vault-agents" hint="Can only ask the vault to pay. It does not need to exist yet." />
          <TextField label="Token" value={form.token} onChange={set("token")} testId="vault-token" hint={config.network === "mainnet" ? "Native USDC on NEAR" : "NEP-141 token contract"} />
          <TextField label="Paid instantly up to" value={form.auto} onChange={set("auto")} testId="vault-auto" inputMode="decimal" />
          <TextField label="Per-payment cap" value={form.cap} onChange={set("cap")} testId="vault-cap" inputMode="decimal" hint="Anything above is refused, even with your OK." />
          <TextField label="Most per day" value={form.daily} onChange={set("daily")} testId="vault-daily" inputMode="decimal" />
          <TextField label="Who it may pay on NEAR" value={form.recipients} onChange={set("recipients")} testId="vault-recipients" hint="One account per line. Can be empty; cross-chain payees are added under Rules." multiline />
          <TextField label="A request may wait (hours)" value={form.ttlHours} onChange={set("ttlHours")} testId="vault-ttl" inputMode="decimal" />
          <TextField label="Payments waiting at once" value={form.maxOpen} onChange={set("maxOpen")} testId="vault-max-open" inputMode="numeric" />
          <TextField label="Requests per day" value={form.perDay} onChange={set("perDay")} testId="vault-per-day" inputMode="numeric" />
        </div>
        <p className="text-xs text-zinc-500">
          Cross-chain payments are always off for a new vault. Turn them on per destination under Rules once it runs. Code: {LATEST_BUILD.label}, hash{" "}
          <Mono>{LATEST_BUILD.codeHash}</Mono>.
        </p>
        {error ? (
          <Notice tone="bad" title="Fix this first">
            <p className="break-words" data-testid="form-error">
              {error}
            </p>
          </Notice>
        ) : null}
        <Button onClick={() => void toReview()} disabled={!owner || busy} testId="review-vault">
          {busy ? "Checking…" : "Review"}
        </Button>
      </Card>
    </div>
  );
}

/** Keeps step 2's data across a reload or a wallet redirect, from the moment step 1 is shown. */
function SaveOnMount({ pending }: { pending: PendingDeploy }) {
  useEffect(() => {
    savePending(pending);
  }, [pending]);
  return null;
}
