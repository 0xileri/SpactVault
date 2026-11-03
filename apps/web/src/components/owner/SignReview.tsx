import { useState, type ReactNode } from "react";

import { explorerTxLink, type AppConfig } from "../../config.js";
import { errorMessage, shortHash } from "../../format.js";
import { describeActions } from "../../owner/actions.js";
import { SignError, type OwnerSigner, type WalletAction } from "../../signers/index.js";
import type { SignerState } from "../../useSigner.js";
import { Button, Card, Mono, Notice } from "../ui.js";

export function TxLink({ config, txHash, testId = "tx-link" }: { config: Pick<AppConfig, "explorerTxUrl">; txHash: string; testId?: string }) {
  const href = explorerTxLink(config, txHash);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer noopener" className="font-mono underline" data-testid={testId} data-hash={txHash}>
      {shortHash(txHash)}
    </a>
  ) : (
    <Mono>
      <span data-testid={testId} data-hash={txHash}>
        {txHash}
      </span>
    </Mono>
  );
}

/** A mainnet transaction needs a tick in this box before the Sign button works (stop and confirm). */
export function MainnetConfirm({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children?: ReactNode }) {
  return (
    <div className="space-y-3">
      <Notice tone="bad" title="Mainnet: this uses real funds">
        {children ?? <p>Check every account name and amount above. A transaction cannot be undone once it is on chain.</p>}
      </Notice>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" data-testid="confirm-mainnet" />
        <span>I checked the details above and want to sign this on mainnet.</span>
      </label>
    </div>
  );
}

function pretty(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v), 2);
}

export type SignPhase = { kind: "review" } | { kind: "signing" } | { kind: "done"; txHash: string | null } | { kind: "failed"; message: string; txHash: string | null };

/**
 * The stop before every owner transaction: what it does in plain words, what the wallet will be asked to
 * sign (the exact data, under "Exact transaction"), and a Sign button that only works for `signerId`.
 */
export function SignReview({
  config,
  signer,
  wallet,
  title,
  receiverId,
  actions,
  signerId,
  changes = [],
  children,
  onDone,
  onCancel,
  signLabel = "Sign in your wallet",
  blocked = null,
}: {
  config: AppConfig;
  signer: OwnerSigner | null;
  wallet: SignerState;
  title: string;
  receiverId: string;
  actions: WalletAction[];
  /** The account that has to sign. The button stays off for any other. */
  signerId: string;
  changes?: string[];
  children?: ReactNode;
  onDone?: ((txHash: string | null) => void) | undefined;
  onCancel?: (() => void) | undefined;
  signLabel?: string;
  /** Why signing is not possible right now, if it is not. */
  blocked?: string | null;
}) {
  const [phase, setPhase] = useState<SignPhase>({ kind: "review" });
  const [confirmed, setConfirmed] = useState(false);
  const lines = describeActions(receiverId, actions);
  const mainnet = config.network === "mainnet";
  const problem =
    blocked ??
    (signer === null
      ? "No wallet is configured for this network."
      : wallet.accountId === null
        ? `Connect ${signerId} to sign.`
        : wallet.accountId !== signerId
          ? `You are connected as ${wallet.accountId}. Only ${signerId} can sign this.`
          : null);

  async function sign() {
    if (!signer) return;
    setPhase({ kind: "signing" });
    try {
      const { txHash } = await signer.signAndSend(receiverId, actions);
      setPhase({ kind: "done", txHash });
      onDone?.(txHash);
    } catch (e) {
      setPhase({ kind: "failed", message: errorMessage(e), txHash: e instanceof SignError ? e.txHash : null });
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Review before you sign</p>
        <h3 className="mt-1 text-base font-semibold text-ink">{title}</h3>
      </div>
      {changes.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-800" data-testid="review-changes">
          {changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}
      {children}
      <div className="rounded-lg bg-zinc-50 p-4 text-sm ring-1 ring-line">
        <p className="text-zinc-600">
          Your wallet will be asked to sign one transaction from <Mono>{signerId}</Mono> to <Mono>{receiverId}</Mono>:
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5" data-testid="review-actions">
          {lines.map((l, i) => (
            <li key={i}>{l.summary}</li>
          ))}
        </ol>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-zinc-600">Exact transaction</summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded bg-white p-3 text-xs ring-1 ring-line" data-testid="review-json">
            {pretty({ receiverId, actions: lines.map((l) => l.detail) })}
          </pre>
        </details>
      </div>

      {phase.kind === "done" ? (
        <Notice tone="good" title="Confirmed on chain">
          {phase.txHash ? (
            <p>
              Transaction <TxLink config={config} txHash={phase.txHash} />
            </p>
          ) : (
            <p>The wallet did not return a transaction hash. Check your wallet's history.</p>
          )}
        </Notice>
      ) : (
        <>
          {mainnet && phase.kind !== "signing" ? <MainnetConfirm checked={confirmed} onChange={setConfirmed} /> : null}
          {problem ? <p className="text-sm text-amber-800">{problem}</p> : null}
          {phase.kind === "failed" ? (
            <Notice tone="bad" title="Not signed, or the transaction failed">
              <p className="break-words">{phase.message}</p>
              {phase.txHash ? (
                <p className="mt-1">
                  Transaction <TxLink config={config} txHash={phase.txHash} />
                </p>
              ) : null}
            </Notice>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void sign()} disabled={problem !== null || phase.kind === "signing" || (mainnet && !confirmed)} testId="sign">
              {phase.kind === "signing" ? "Waiting for your wallet…" : signLabel}
            </Button>
            {onCancel ? (
              <Button variant="secondary" onClick={onCancel} disabled={phase.kind === "signing"} testId="cancel">
                Back
              </Button>
            ) : null}
          </div>
        </>
      )}
    </Card>
  );
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  testId,
  placeholder,
  inputMode,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  testId?: string;
  placeholder?: string;
  inputMode?: "decimal" | "numeric" | "text";
  multiline?: boolean;
}) {
  const cls =
    "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand";
  return (
    <label className="block text-sm">
      <span className="font-medium text-zinc-800">{label}</span>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} className={`${cls} min-h-20`} data-testid={testId} placeholder={placeholder} />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
          data-testid={testId}
          placeholder={placeholder}
          inputMode={inputMode}
          autoComplete="off"
          spellCheck={false}
        />
      )}
      {hint ? <span className="mt-1 block text-xs text-zinc-500">{hint}</span> : null}
    </label>
  );
}

/** Splits a list typed one per line or comma-separated. */
export function splitList(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
