import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { accountId, formatUnits, parseUnits, viewAccessKeyList, viewAccount, type AccessKeyEntry } from "@spact/shared";

import type { AppConfig } from "../../config.js";
import { errorMessage, formatAmount } from "../../format.js";
import { useLink } from "../../network.js";
import {
  addAgentActions,
  AGENT_METHODS,
  agentKeyFile,
  agentProblem,
  createAgentActions,
  formatNear,
  fundActions,
  fundImplicitActions,
  implicitAccountId,
  parseNear,
  removeAgentActions,
  setPausedActions,
  subAccountId,
  topUpNearActions,
  withdrawActions,
  registerWithTokenActions,
  type Decimals,
} from "../../owner/actions.js";
import {
  clearPendingAgent,
  generateKey,
  loadPendingAgent,
  savePendingAgent,
  swapToRestrictedKey,
  type PendingAgent,
} from "../../owner/deploy.js";
import { loadOwnerSnapshot, tokenStorage, type OwnerSnapshot } from "../../near/owner.js";
import type { OwnerSigner } from "../../signers/index.js";
import type { SignerState } from "../../useSigner.js";
import { Badge, Button, Card, Mono, Notice } from "../ui.js";
import { RulesEditor } from "./RulesEditor.js";
import { MainnetConfirm, SignReview, TextField, TxLink } from "./SignReview.js";

type Open = null | "fund" | "near" | "withdraw" | "pause" | "add-agent" | { remove: string } | "agent-key" | "rules";

interface Confirmed {
  section: string;
  txHash: string | null;
}

function Section({
  id,
  title,
  children,
  aside,
  confirmed,
  config,
}: {
  id: string;
  title: string;
  children: ReactNode;
  aside?: ReactNode;
  confirmed: Confirmed | null;
  config: AppConfig;
}) {
  return (
    <section id={id} aria-label={title} className="scroll-mt-28 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
        {aside ? <div className="text-xs text-zinc-500">{aside}</div> : null}
      </div>
      {confirmed?.section === id ? (
        <div data-testid={`confirmed-${id}`}>
          <Notice tone="good" title="Confirmed on chain">
            {confirmed.txHash ? (
              <p>
                Transaction <TxLink config={config} txHash={confirmed.txHash} />
              </p>
            ) : null}
          </Notice>
        </div>
      ) : null}
      {children}
    </section>
  );
}

interface Props {
  config: AppConfig;
  signer: OwnerSigner | null;
  wallet: SignerState;
}

/** Everything the owner does to a running vault, each step reviewed here and signed in the wallet (ADR-033). */
export function Manage({ config, signer, wallet }: Props) {
  const [snap, setSnap] = useState<OwnerSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSnap(await loadOwnerSnapshot(config, wallet.accountId));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [config, wallet.accountId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // jump to a section named in the link (e.g. #agent-key from the create-vault page)
  useEffect(() => {
    if (!snap) return;
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, [snap]);

  if (error) {
    return (
      <Notice tone="bad" title="Could not read this vault">
        <p className="break-words">{error}</p>
      </Notice>
    );
  }
  if (!snap) return <p className="text-sm text-zinc-500">Reading the vault…</p>;

  const { config: vault, policy } = snap;
  const owner = vault.owner;
  const isOwner = wallet.accountId === owner;
  const meta: Decimals = (token) => {
    const m = snap.tokens.find((t) => t.token === token)?.metadata;
    return m ? { decimals: m.decimals, symbol: m.symbol } : null;
  };
  /** After a signed change: close the form, say it is on chain in its section, and read the vault again. */
  const doneIn = (section: string) => (txHash: string | null) => {
    setConfirmed({ section, txHash });
    setOpen(null);
    // the RPC's final state can trail a just-signed transaction by a block or two
    void refresh();
    for (const ms of [2_000, 5_000]) setTimeout(() => void refresh(), ms);
  };
  const reopen = (o: Open) => {
    setConfirmed(null);
    setOpen(o);
  };
  const review = { config, signer, wallet };
  const sec = { confirmed, config };

  return (
    <div className="space-y-10" data-testid="manage">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Manage your vault</h1>
        <p className="text-sm text-zinc-600">
          Every change here is one transaction your wallet signs. You see exactly what it does first. Only the owner <Mono>{owner}</Mono> can sign changes;
          anyone can add money.
        </p>
        {wallet.accountId && !isOwner ? (
          <Notice tone="warn" title="You are not this vault's owner">
            <p>
              You are connected as <Mono>{wallet.accountId}</Mono>. Only <Mono>{owner}</Mono> can change the rules or take money out. You can still add money,
              but only the owner can ever withdraw it.
            </p>
          </Notice>
        ) : null}
      </div>

      <Section id="fund" title="Add money" {...sec}>
        <Card className="space-y-4">
          <ul className="space-y-1 text-sm">
            {snap.tokens.map((t) => (
              <li key={t.token}>
                <span className="font-semibold" data-testid={`manage-balance-${t.token}`}>
                  {t.vaultBalance === null ? "unknown" : formatAmount(t.vaultBalance.toString(), t.metadata)}
                </span>{" "}
                in the vault{t.ownerBalance !== null ? <>, {formatAmount(t.ownerBalance.toString(), t.metadata)} in your wallet</> : null}
                {t.vaultRegistered === false ? <span className="ml-2"><Badge tone="warn">vault not registered with this token yet</Badge></span> : null}
              </li>
            ))}
            <li className="text-zinc-600">
              {snap.account ? `${formatNear(BigInt(snap.account.amount))} NEAR for storage and gas` : "NEAR balance unknown"}
            </li>
          </ul>
          {open === "fund" ? (
            <FundForm snap={snap} {...review} onClose={() => setOpen(null)} onDone={doneIn("fund")} />
          ) : open === "near" ? (
            <NearForm snap={snap} {...review} onClose={() => setOpen(null)} onDone={doneIn("fund")} />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => reopen("fund")} testId="open-fund">
                Add tokens
              </Button>
              <Button variant="secondary" onClick={() => reopen("near")} testId="open-near">
                Add NEAR for storage
              </Button>
            </div>
          )}
        </Card>
      </Section>

      <Section id="withdraw" title="Take money out" {...sec}>
        <Card className="space-y-4">
          <p className="text-sm text-zinc-600">
            Sends tokens from the vault to an account you choose, your own by default. Only <Mono>{owner}</Mono> can sign this. NEAR cannot be taken out: the
            vault has no way to send it, so the NEAR that pays for its storage stays there for good.
          </p>
          {open === "withdraw" ? (
            <WithdrawForm snap={snap} {...review} onClose={() => setOpen(null)} onDone={doneIn("withdraw")} />
          ) : (
            <Button
              variant="secondary"
              onClick={() => reopen("withdraw")}
              disabled={!isOwner || !snap.tokens.some((t) => (t.vaultBalance ?? 0n) > 0n)}
              testId="open-withdraw"
            >
              Take tokens out
            </Button>
          )}
        </Card>
      </Section>

      <Section id="pause" title="Pause" {...sec}>
        <Card className="space-y-4">
          <p className="text-sm">
            {vault.paused ? (
              <span data-testid="paused-state" data-paused="true">
                <Badge tone="bad">Paused</Badge> The vault pays nothing, even payments you approve, until you unpause it.
              </span>
            ) : (
              <span data-testid="paused-state" data-paused="false">
                <Badge tone="good">Running</Badge> Pausing stops every payment at once. Requests still arrive and wait.
              </span>
            )}
          </p>
          {open === "pause" ? (
            <SignReview
              {...review}
              title={vault.paused ? "Unpause the vault" : "Pause the vault"}
              receiverId={vault.vault_id}
              signerId={owner}
              actions={setPausedActions(!vault.paused)}
              changes={[vault.paused ? "Payments within your rules go out again." : "No payment leaves the vault until you unpause it."]}
              onCancel={() => setOpen(null)}
              onDone={doneIn("pause")}
            />
          ) : (
            <Button variant={vault.paused ? "primary" : "danger"} onClick={() => reopen("pause")} disabled={!isOwner} testId="open-pause">
              {vault.paused ? "Unpause" : "Pause all payments"}
            </Button>
          )}
        </Card>
      </Section>

      <Section id="agents" title="Agents" {...sec}>
        <Card className="space-y-4">
          <ul className="space-y-2 text-sm" data-testid="agent-list">
            {vault.agents.length === 0 ? <li className="text-zinc-600">No agents. Nobody can ask this vault to pay.</li> : null}
            {vault.agents.map((a) => (
              <li key={a} className="flex flex-wrap items-center justify-between gap-2">
                <Mono>{a}</Mono>
                <Button variant="danger" onClick={() => reopen({ remove: a })} disabled={!isOwner} testId={`remove-agent-${a}`}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          {typeof open === "object" && open !== null ? (
            <SignReview
              {...review}
              title={`Remove ${open.remove}`}
              receiverId={vault.vault_id}
              signerId={owner}
              actions={removeAgentActions(open.remove)}
              changes={[`${open.remove} can no longer ask for payments. Its approved but unpaid requests can no longer be paid.`]}
              onCancel={() => setOpen(null)}
              onDone={doneIn("agents")}
            />
          ) : open === "add-agent" ? (
            <AddAgentForm snap={snap} {...review} onClose={() => setOpen(null)} onDone={doneIn("agents")} />
          ) : (
            <Button variant="secondary" onClick={() => reopen("add-agent")} disabled={!isOwner} testId="open-add-agent">
              Add an existing account as agent
            </Button>
          )}
        </Card>
      </Section>

      <Section id="agent-key" title="Give your agent a key" {...sec}>
        <Card className="space-y-4">
          <p className="text-sm text-zinc-600">
            Creates a new agent account under yours whose only key can call {AGENT_METHODS.join(", ")} on this vault, and nothing else. The key is made in this
            browser and saved to your computer as a file for the agent&apos;s MCP server. It is never sent anywhere.
          </p>
          {open === "agent-key" ? (
            <AgentKeyFlow snap={snap} {...review} onClose={() => setOpen(null)} onDone={() => void refresh()} />
          ) : (
            <Button onClick={() => reopen("agent-key")} disabled={!isOwner} testId="open-agent-key">
              Set up an agent key
            </Button>
          )}
        </Card>
      </Section>

      <Section id="rules" title="Rules" aside={`version ${vault.policy_version}`} {...sec}>
        <RulesEditor
          {...review}
          vault={vault}
          policy={policy}
          meta={meta}
          editing={open === "rules"}
          onEdit={() => reopen("rules")}
          onClose={() => setOpen(null)}
          onDone={doneIn("rules")}
          canEdit={isOwner}
        />
      </Section>
    </div>
  );
}

interface FormProps extends Props {
  snap: OwnerSnapshot;
  onClose: () => void;
  onDone: (txHash: string | null) => void;
}

function FundForm({ snap, config, signer, wallet, onClose, onDone }: FormProps) {
  const [token, setToken] = useState(snap.tokens[0]?.token ?? "");
  const [amount, setAmount] = useState("");
  const [reviewing, setReviewing] = useState<{ units: bigint; storage: bigint | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const holding = snap.tokens.find((t) => t.token === token);
  const from = wallet.accountId;

  function toReview() {
    setError(null);
    try {
      if (!holding?.metadata) throw new Error("The token's decimals are unknown, so the amount cannot be converted safely.");
      if (!from) throw new Error("Connect your wallet first.");
      const units = parseUnits(amount.trim(), holding.metadata.decimals);
      if (units === 0n) throw new Error("Enter an amount above zero.");
      if (holding.ownerBalance !== null && units > holding.ownerBalance) {
        throw new Error(`Your wallet holds ${formatAmount(holding.ownerBalance.toString(), holding.metadata)}.`);
      }
      if (holding.vaultRegistered === null) throw new Error("Could not check whether the vault is registered with the token.");
      if (!holding.vaultRegistered && holding.storageMin === null) throw new Error("Could not read what registering with the token costs.");
      setReviewing({ units, storage: holding.vaultRegistered ? null : holding.storageMin });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (reviewing && holding?.metadata && from) {
    const shown = `${formatUnits(reviewing.units, holding.metadata.decimals)} ${holding.metadata.symbol}`;
    return (
      <SignReview
        config={config}
        signer={signer}
        wallet={wallet}
        title={`Add ${shown} to the vault`}
        receiverId={token}
        signerId={from}
        actions={fundActions(snap.config.vault_id, reviewing.units, reviewing.storage)}
        changes={[
          ...(reviewing.storage !== null ? [`Registers ${snap.config.vault_id} with ${holding.metadata.symbol} first (${formatNear(reviewing.storage, 5)} NEAR, once).`] : []),
          `Moves ${shown} from ${from} into ${snap.config.vault_id}. Only ${snap.config.owner} can take it out again (owner_withdraw).`,
          "Uses ft_transfer, not ft_transfer_call: the vault does not implement ft_on_transfer, so a transfer call would bounce back.",
        ]}
        onCancel={() => setReviewing(null)}
        onDone={onDone}
      />
    );
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-zinc-800">Token</span>
          <select value={token} onChange={(e) => setToken(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" data-testid="fund-token">
            {snap.tokens.map((t) => (
              <option key={t.token} value={t.token}>
                {t.metadata?.symbol ?? t.token}
              </option>
            ))}
          </select>
        </label>
        <TextField label={`Amount${holding?.metadata ? ` in ${holding.metadata.symbol}` : ""}`} value={amount} onChange={setAmount} testId="fund-amount" inputMode="decimal" />
      </div>
      {error ? <p className="text-sm text-rose-700" data-testid="fund-error">{error}</p> : null}
      <div className="flex gap-2">
        <Button onClick={toReview} testId="review-fund">
          Review
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

type WithdrawStep = null | { units: bigint; receiver: string; register: bigint | null };

/**
 * Take tokens out (owner_withdraw). If the receiver is not registered with the token, the wallet first signs a
 * storage_deposit for it, because otherwise the vault's transfer would fail and the tokens would stay put.
 */
function WithdrawForm({ snap, config, signer, wallet, onClose, onDone }: FormProps) {
  const owner = snap.config.owner;
  const vaultId = snap.config.vault_id;
  const withMoney = snap.tokens.filter((t) => (t.vaultBalance ?? 0n) > 0n);
  const [token, setToken] = useState(withMoney[0]?.token ?? "");
  const [amount, setAmount] = useState("");
  const [receiver, setReceiver] = useState(owner);
  const [step, setStep] = useState<WithdrawStep>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const holding = snap.tokens.find((t) => t.token === token);
  const m = holding?.metadata ?? null;

  async function toReview() {
    setError(null);
    setBusy(true);
    try {
      if (!holding || !m) throw new Error("The token's decimals are unknown, so the amount cannot be converted safely.");
      if (holding.vaultBalance === null) throw new Error("Could not read the vault's balance of this token.");
      const units = parseUnits(amount.trim(), m.decimals);
      if (units === 0n) throw new Error("Enter an amount above zero.");
      if (units > holding.vaultBalance) throw new Error(`The vault holds ${formatAmount(holding.vaultBalance.toString(), m)}.`);
      const to = receiver.trim();
      if (!accountId.safeParse(to).success) throw new Error(`${to || "(empty)"} is not a NEAR account id.`);
      if (to === vaultId) throw new Error("That is the vault itself.");
      const storage = await tokenStorage(config.rpcUrl, token, to);
      if (storage.registered === null) throw new Error(`Could not check whether ${to} is registered with ${m.symbol}.`);
      if (!storage.registered && storage.min === null) throw new Error("Could not read what registering with the token costs.");
      setStep({ units, receiver: to, register: storage.registered ? null : storage.min });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (step && m) {
    const shown = `${formatUnits(step.units, m.decimals)} ${m.symbol}`;
    if (step.register !== null) {
      return (
        <SignReview
          config={config}
          signer={signer}
          wallet={wallet}
          key="withdraw-register"
          title={`First: register ${step.receiver} with ${m.symbol}`}
          receiverId={token}
          signerId={owner}
          actions={registerWithTokenActions(step.receiver, step.register)}
          changes={[
            `${step.receiver} is not registered with ${m.symbol} yet, so the vault's transfer to it would fail. This pays ${formatNear(step.register, 5)} NEAR, once, to register it.`,
            "Then you review the withdrawal itself.",
          ]}
          onCancel={() => setStep(null)}
          onDone={() => setStep({ ...step, register: null })}
        />
      );
    }
    return (
      <SignReview
        config={config}
        signer={signer}
        wallet={wallet}
        key="withdraw-send"
        title={`Take ${shown} out of the vault`}
        receiverId={vaultId}
        signerId={owner}
        actions={withdrawActions(token, step.units, step.receiver)}
        changes={[
          `Moves ${shown} from ${vaultId} to ${step.receiver}.`,
          ...(step.receiver === owner ? [] : [`${step.receiver} is not your account ${owner}. Check it: tokens sent there are not yours to take back.`]),
          ...(snap.config.open_approvals > 0
            ? [`${snap.config.open_approvals} payment(s) are waiting for your approval. If the vault runs short, paying one fails and nothing is sent.`]
            : []),
        ]}
        onCancel={() => setStep(null)}
        onDone={onDone}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-zinc-800">Token</span>
          <select value={token} onChange={(e) => setToken(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" data-testid="withdraw-token">
            {withMoney.map((t) => (
              <option key={t.token} value={t.token}>
                {t.metadata?.symbol ?? t.token}
              </option>
            ))}
          </select>
        </label>
        <TextField
          label={`Amount${m ? ` in ${m.symbol}` : ""}`}
          value={amount}
          onChange={setAmount}
          testId="withdraw-amount"
          inputMode="decimal"
          hint={
            holding?.vaultBalance != null && m ? (
              <button type="button" className="underline" onClick={() => setAmount(formatUnits(holding.vaultBalance ?? 0n, m.decimals))} data-testid="withdraw-all">
                All of it: {formatAmount(holding.vaultBalance.toString(), m)}
              </button>
            ) : undefined
          }
        />
        <TextField label="Send to" value={receiver} onChange={setReceiver} testId="withdraw-receiver" hint="Your own account by default." />
      </div>
      {error ? (
        <p className="text-sm break-words text-rose-700" data-testid="withdraw-error">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button onClick={() => void toReview()} disabled={busy} testId="review-withdraw">
          {busy ? "Checking…" : "Review"}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

function NearForm({ snap, config, signer, wallet, onClose, onDone }: FormProps) {
  const [amount, setAmount] = useState("0.2");
  const [yocto, setYocto] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const from = wallet.accountId;
  if (yocto !== null && from) {
    return (
      <SignReview
        config={config}
        signer={signer}
        wallet={wallet}
        title={`Send ${formatNear(yocto)} NEAR to the vault`}
        receiverId={snap.config.vault_id}
        signerId={from}
        actions={topUpNearActions(yocto)}
        changes={["The vault uses NEAR to store requests. It cannot be withdrawn: the vault has no key and no method that sends NEAR."]}
        onCancel={() => setYocto(null)}
        onDone={onDone}
      />
    );
  }
  return (
    <div className="space-y-3">
      <TextField label="NEAR" value={amount} onChange={setAmount} testId="near-amount" inputMode="decimal" hint="Each stored request uses about 0.005-0.01 NEAR of storage." />
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      <div className="flex gap-2">
        <Button
          onClick={() => {
            try {
              setYocto(parseNear(amount));
              setError(null);
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
          disabled={!from}
          testId="review-near"
        >
          Review
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

function AddAgentForm({ snap, config, signer, wallet, onClose, onDone }: FormProps) {
  const [agent, setAgent] = useState("");
  const [ready, setReady] = useState<string | null>(null);
  const problem = agent ? agentProblem(agent.trim(), snap.config.owner, snap.config.vault_id, snap.config.agents) : null;
  if (ready) {
    return (
      <SignReview
        config={config}
        signer={signer}
        wallet={wallet}
        title={`Add ${ready} as an agent`}
        receiverId={snap.config.vault_id}
        signerId={snap.config.owner}
        actions={addAgentActions(ready)}
        changes={[`${ready} may ask this vault to pay, within the rules. Give it only a function-call key for this vault, never a full-access key.`]}
        onCancel={() => setReady(null)}
        onDone={onDone}
      />
    );
  }
  return (
    <div className="space-y-3">
      <TextField label="Agent account" value={agent} onChange={setAgent} testId="add-agent-id" />
      {problem ? <p className="text-sm text-rose-700">{problem}</p> : null}
      <div className="flex gap-2">
        <Button onClick={() => setReady(agent.trim())} disabled={!agent || problem !== null} testId="review-add-agent">
          Review
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

type AgentMode = "named" | "any-wallet";

type KeyStep =
  | { kind: "form" }
  | { kind: "download"; agentId: string; fund: bigint; allowance: bigint; pending: PendingAgent | null }
  | { kind: "create"; agentId: string; fund: bigint; allowance: bigint }
  | { kind: "fund"; pending: PendingAgent }
  | { kind: "swap"; pending: PendingAgent }
  | { kind: "add"; agentId: string }
  | { kind: "done"; agentId: string };

/** True when `keys` is exactly the restricted agent key: one function-call key for the agent methods on `vaultId`. */
export function onlyRestrictedKey(keys: AccessKeyEntry[], publicKey: string, vaultId: string): boolean {
  const [k] = keys;
  return (
    keys.length === 1 &&
    k !== undefined &&
    k.publicKey === publicKey &&
    k.permission.kind === "FunctionCall" &&
    k.permission.receiverId === vaultId &&
    k.permission.methodNames.length === AGENT_METHODS.length &&
    AGENT_METHODS.every((m) => k.permission.kind === "FunctionCall" && k.permission.methodNames.includes(m))
  );
}

/** Saves `text` as a file through the browser's download, without any network request. */
function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Agent key setup. The key pair is made in this tab; the owner downloads the key file once; only then does
 * the wallet create the account with that public key, so a key is never put on chain before it is saved.
 * The secret is dropped from memory right after the download.
 *
 * Two ways (ADR-035):
 * - named (`agent2.<owner>`): the wallet creates the account with the restricted key.
 * - any wallet (64 hex characters): the wallet only sends NEAR to an implicit account whose temporary key this
 *   tab holds; the tab then adds the restricted key and deletes its own in one transaction.
 */
function AgentKeyFlow({ snap, config, signer, wallet, onClose, onDone }: FormProps) {
  const owner = snap.config.owner;
  const vaultId = snap.config.vault_id;
  const [mode, setMode] = useState<AgentMode>("named");
  const [name, setName] = useState("agent2");
  const [near, setNear] = useState("0.3");
  const [allowance, setAllowance] = useState("0.25");
  const [step, setStep] = useState<KeyStep>({ kind: "form" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const publicKey = useRef<string | null>(null);
  const secret = useRef<string | null>(null);

  const [note, setNote] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(
    () => () => {
      secret.current = null;
    },
    [],
  );

  // an any-wallet agent this tab started (a reload, or a wallet that redirected): pick it up where it stopped
  useEffect(() => {
    const pending = loadPendingAgent(config.network, vaultId);
    if (!pending) return;
    let alive = true;
    void (async () => {
      const account = await viewAccount(config.rpcUrl, pending.agentId);
      if (!alive) return;
      if (!account) {
        setStep({ kind: "fund", pending });
        return;
      }
      const keys = await viewAccessKeyList(config.rpcUrl, pending.agentId);
      if (!alive) return;
      if (keys.some((k) => k.publicKey === pending.temporary.publicKey)) {
        setStep({ kind: "swap", pending });
      } else if (onlyRestrictedKey(keys, pending.restrictedPublicKey, vaultId)) {
        clearPendingAgent();
        setStep(snap.config.agents.includes(pending.agentId) ? { kind: "done", agentId: pending.agentId } : { kind: "add", agentId: pending.agentId });
      } else {
        clearPendingAgent();
        setNote(`${pending.agentId} exists but no longer has this tab's temporary key, so this tab cannot finish it.`);
      }
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [config, vaultId, snap.config.agents]);

  async function prepare() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const fund = parseNear(near);
      const allow = parseNear(allowance);
      if (allow === 0n) throw new Error("The key needs some gas allowance.");
      if (allow >= fund) throw new Error("The account needs more NEAR than the key's gas allowance.");
      const key = await generateKey();
      let agentId: string;
      let pending: PendingAgent | null = null;
      if (mode === "named") {
        agentId = subAccountId(name.trim(), owner);
        if (agentId === vaultId) throw new Error("That is the vault's own name.");
      } else {
        const temporary = await generateKey();
        agentId = await implicitAccountId(temporary.publicKey);
        pending = {
          network: config.network,
          rpcUrl: config.rpcUrl,
          vaultId,
          agentId,
          temporary,
          restrictedPublicKey: key.publicKey,
          fundYocto: fund.toString(),
          allowanceYocto: allow.toString(),
          createdAt: Date.now(),
        };
      }
      if (await viewAccount(config.rpcUrl, agentId)) throw new Error(`${agentId} already exists. Pick another name.`);
      publicKey.current = key.publicKey;
      secret.current = key.secretKey;
      setStep({ kind: "download", agentId, fund, allowance: allow, pending });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function swap(pending: PendingAgent) {
    setBusy(true);
    setError(null);
    try {
      const sent = await swapToRestrictedKey(
        pending.rpcUrl,
        pending.agentId,
        pending.temporary,
        pending.restrictedPublicKey,
        vaultId,
        AGENT_METHODS,
        BigInt(pending.allowanceYocto),
      );
      if (sent.failure) throw new Error(`The key swap failed: ${sent.failure}`);
      const keys = await viewAccessKeyList(config.rpcUrl, pending.agentId);
      if (!onlyRestrictedKey(keys, pending.restrictedPublicKey, vaultId)) {
        throw new Error(`${pending.agentId} does not show exactly the restricted key yet. Reload the page in a few seconds to check again.`);
      }
      clearPendingAgent();
      onDone(sent.txHash);
      setStep(snap.config.agents.includes(pending.agentId) ? { kind: "done", agentId: pending.agentId } : { kind: "add", agentId: pending.agentId });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (step.kind === "download") {
    return (
      <div className="space-y-3" data-testid="agent-key-download">
        <Notice tone="warn" title="Save the key file first">
          <p>
            This file is the agent&apos;s key for <Mono>{step.agentId}</Mono>. It can only call {AGENT_METHODS.join(", ")} on <Mono>{snap.config.vault_id}</Mono>, with at
            most {formatNear(step.allowance)} NEAR of gas. It is shown once: this page forgets it after the download.
            {step.pending ? " The account name is 64 characters because your wallet only sends it NEAR; the file has it." : null}
          </p>
        </Notice>
        <p className="text-sm">
          Public key <Mono>{publicKey.current}</Mono>
        </p>
        <Button
          onClick={() => {
            if (!secret.current || !publicKey.current) return;
            download(`${step.agentId}.json`, agentKeyFile(step.agentId, publicKey.current, secret.current));
            secret.current = null;
            if (step.pending) {
              // kept in this tab's sessionStorage so a reload or a wallet redirect can still finish the swap
              savePendingAgent(step.pending);
              setStep({ kind: "fund", pending: step.pending });
            } else {
              setStep({ kind: "create", agentId: step.agentId, fund: step.fund, allowance: step.allowance });
            }
          }}
          testId="download-key"
        >
          Download {step.pending ? "the key file" : `${step.agentId}.json`}
        </Button>
      </div>
    );
  }

  if (step.kind === "fund") {
    const p = step.pending;
    return (
      <SignReview
        config={config}
        signer={signer}
        wallet={wallet}
        key="agent-fund"
        title="Send NEAR to the new agent account"
        receiverId={p.agentId}
        signerId={owner}
        actions={fundImplicitActions(BigInt(p.fundYocto))}
        changes={[
          `Sends ${formatNear(BigInt(p.fundYocto))} NEAR to ${p.agentId}. That creates the account, with a temporary key only this tab holds.`,
          "Next, this tab swaps that key for the one you saved, so the agent's only key is the restricted one.",
        ]}
        onDone={(txHash) => {
          setStep({ kind: "swap", pending: p });
          onDone(txHash);
        }}
      />
    );
  }

  if (step.kind === "swap") {
    const p = step.pending;
    const exact = {
      signer: p.agentId,
      receiverId: p.agentId,
      actions: [
        {
          type: "AddKey",
          params: { publicKey: p.restrictedPublicKey, accessKey: { permission: { receiverId: vaultId, allowance: p.allowanceYocto, methodNames: [...AGENT_METHODS] } } },
        },
        { type: "DeleteKey", params: { publicKey: p.temporary.publicKey } },
      ],
    };
    return (
      <Card className="space-y-4">
        <div data-testid="agent-swap">
          <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Review before this tab signs</p>
          <h3 className="mt-1 text-base font-semibold text-ink">Give {p.agentId.slice(0, 12)}… its restricted key</h3>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-800">
          <li>
            Adds the key you saved (<Mono>{p.restrictedPublicKey.slice(0, 16)}…</Mono>). It can only call {AGENT_METHODS.join(", ")} on <Mono>{vaultId}</Mono>, with at most{" "}
            {formatNear(BigInt(p.allowanceYocto))} NEAR of gas.
          </li>
          <li>Deletes this tab&apos;s temporary key, so nobody can move the account&apos;s NEAR or sign anything else as it.</li>
          <li>Your wallet is not asked: this tab signs with the temporary key, which never leaves it.</li>
        </ul>
        <details className="rounded-lg bg-zinc-50 p-4 text-sm ring-1 ring-line">
          <summary className="cursor-pointer text-xs font-medium text-zinc-600">Exact transaction</summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded bg-white p-3 text-xs ring-1 ring-line" data-testid="agent-swap-json">
            {JSON.stringify(exact, null, 2)}
          </pre>
        </details>
        {config.network === "mainnet" ? <MainnetConfirm checked={confirmed} onChange={setConfirmed} /> : null}
        {error ? (
          <p className="text-sm break-words text-rose-700" data-testid="agent-key-error">
            {error}
          </p>
        ) : null}
        <Button onClick={() => void swap(p)} disabled={busy || (config.network === "mainnet" && !confirmed)} testId="swap-key">
          {busy ? "Signing in this tab…" : "Swap the key"}
        </Button>
      </Card>
    );
  }

  if (step.kind === "create" && publicKey.current) {
    return (
      <SignReview
        config={config}
        signer={signer}
        wallet={wallet}
        key="agent-create"
        title={`Create ${step.agentId} with the restricted key`}
        receiverId={step.agentId}
        signerId={owner}
        actions={createAgentActions(snap.config.vault_id, step.fund, publicKey.current, step.allowance)}
        changes={[
          `Creates ${step.agentId} with ${formatNear(step.fund)} NEAR for gas.`,
          `Its only key is the one you just saved. It cannot move NEAR or tokens, change the rules, approve payments, or call any other contract.`,
        ]}
        onDone={(txHash) => {
          setStep(snap.config.agents.includes(step.agentId) ? { kind: "done", agentId: step.agentId } : { kind: "add", agentId: step.agentId });
          onDone(txHash);
        }}
      />
    );
  }

  if (step.kind === "add") {
    return (
      <SignReview
        config={config}
        signer={signer}
        wallet={wallet}
        key="agent-add"
        title={`Add ${step.agentId} to the vault`}
        receiverId={snap.config.vault_id}
        signerId={owner}
        actions={addAgentActions(step.agentId)}
        changes={[`${step.agentId} may ask this vault to pay, within the rules.`]}
        onDone={(txHash) => {
          setStep({ kind: "done", agentId: step.agentId });
          onDone(txHash);
        }}
      />
    );
  }

  if (step.kind === "done") {
    return <AgentReady config={config} vaultId={snap.config.vault_id} agentId={step.agentId} onClose={onClose} />;
  }

  return (
    <div className="space-y-3">
      {note ? <Notice tone="warn" title="An earlier setup could not be finished"><p>{note}</p></Notice> : null}
      <fieldset className="space-y-2" data-testid="agent-mode">
        <legend className="text-sm font-medium text-zinc-800">Agent account</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="agent-mode" checked={mode === "named"} onChange={() => setMode("named")} className="mt-0.5" data-testid="agent-mode-named" />
          <span>
            A name under yours, like <Mono>agent2.{owner}</Mono>. Your wallet creates it with the restricted key.
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="agent-mode" checked={mode === "any-wallet"} onChange={() => setMode("any-wallet")} className="mt-0.5" data-testid="agent-mode-any-wallet" />
          <span>
            Any wallet: your wallet only sends NEAR, to a new 64-character account. This tab then swaps in the restricted key. Use this if your wallet refuses the
            named way.
          </span>
        </label>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        {mode === "named" ? (
          <TextField label="Agent name" value={name} onChange={setName} testId="agent-name" hint={<>Creates <Mono>{`${name || "…"}.${owner}`}</Mono></>} />
        ) : null}
        <TextField label="NEAR for gas" value={near} onChange={setNear} testId="agent-near" inputMode="decimal" />
        <TextField label="Gas allowance of the key" value={allowance} onChange={setAllowance} testId="agent-allowance" inputMode="decimal" hint="The key stops working after spending this much on gas." />
      </div>
      {error ? <p className="text-sm text-rose-700" data-testid="agent-key-error">{error}</p> : null}
      <div className="flex gap-2">
        <Button onClick={() => void prepare()} disabled={busy} testId="make-agent-key">
          {busy ? "Checking…" : "Make the key"}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

function AgentReady({ config, vaultId, agentId, onClose }: { config: AppConfig; vaultId: string; agentId: string; onClose: () => void }) {
  const link = useLink();
  const site = typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}`;
  const env = [
    `SPACT_NETWORK=${config.network}`,
    `SPACT_RPC_URL=${config.rpcUrl}`,
    `SPACT_VAULT_ID=${vaultId}`,
    `SPACT_AGENT_ID=${agentId}`,
    `SPACT_AGENT_KEY_FILE=/path/to/${agentId}.json`,
    `SPACT_APPROVAL_URL=${site}`,
    ...(config.network === "mainnet" ? ["ENABLE_MAINNET_TRANSFERS=true"] : []),
    "ENABLE_1CLICK_LIVE=true",
  ].join("\n");
  return (
    <div className="space-y-3" data-testid="agent-ready">
      <Notice tone="good" title={`${agentId} is ready`}>
        <p>
          Put <Mono>{agentId}.json</Mono> on the machine that runs your agent, readable only by that user, and start the SpactVault MCP server there with
          these settings. That is the only part that is not in the browser.
        </p>
      </Notice>
      <pre className="overflow-auto rounded bg-zinc-50 p-3 text-xs ring-1 ring-line" data-testid="agent-env">
        {env}
      </pre>
      <div className="flex gap-3 text-sm">
        <a className="underline" href={link("?page=overview")}>
          Open the dashboard
        </a>
        <button type="button" className="underline" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
