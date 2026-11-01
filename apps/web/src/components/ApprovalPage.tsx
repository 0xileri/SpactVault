import { useCallback, useEffect, useState } from "react";

import { explainReason, type PaymentRequest, type ReasonCode, type Status } from "@spact/shared";

import { assess, buildApproveActions, buildRejectActions, reasonFromError } from "../approval.js";
import { explorerTxLink, type AppConfig } from "../config.js";
import { outcomeLine } from "../dashboard.js";
import { errorMessage, formatAmount, formatRelative, formatUtc, shortHash } from "../format.js";
import { loadSnapshot, waitForRequest, type VaultSnapshot } from "../near/vault.js";
import { SignError, type OwnerSigner } from "../signers/index.js";
import type { SignerState } from "../useSigner.js";
import { Button, Card, Field, Mono, Notice, StatusBadge, statusLabel } from "./ui.js";

type Action = "approve" | "reject";
type Phase =
  | { kind: "idle" }
  | { kind: "signing"; action: Action }
  | { kind: "confirming"; action: Action; txHash: string | null }
  | { kind: "done"; action: Action; txHash: string | null; status: Status | null }
  | { kind: "failed"; action: Action; message: string; reason: ReasonCode | null; txHash: string | null };

const FINAL_AFTER_PAY: Status[] = ["SETTLED", "TRANSFER_FAILED"];

function settledFor(action: Action, executeNow: boolean): (r: PaymentRequest) => boolean {
  if (action === "reject") return (r) => r.status === "DENIED";
  return executeNow ? (r) => FINAL_AFTER_PAY.includes(r.status) : (r) => r.status !== "AWAITING_APPROVAL";
}

export function ApprovalPage({
  config,
  requestId,
  signer,
  wallet,
}: {
  config: AppConfig;
  requestId: string;
  signer: OwnerSigner | null;
  wallet: SignerState;
}) {
  const [snapshot, setSnapshot] = useState<VaultSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [executeNow, setExecuteNow] = useState(true);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await loadSnapshot(config, requestId));
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, [config, requestId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loadError) {
    return (
      <Notice tone="bad" title="Could not read this request right now">
        <p>{loadError}</p>
        <p className="mt-2">Nothing was signed. Try again in a moment.</p>
      </Notice>
    );
  }
  if (!snapshot) return <p className="text-sm text-zinc-500">Reading the request…</p>;

  const a = assess({ config, snapshot, signerAvailable: signer !== null, signerAccountId: wallet.accountId, executeNow });
  const { request, token, budget, policy } = snapshot;
  const busy = phase.kind === "signing" || phase.kind === "confirming";

  async function decide(action: Action) {
    if (!signer || !request) return;
    const hash = a.computedHash;
    if (action === "approve" && !hash) return;
    const actions = action === "approve" && hash ? buildApproveActions(requestId, hash, executeNow) : buildRejectActions(requestId);
    setPhase({ kind: "signing", action });
    try {
      const { txHash } = await signer.signAndSend(config.vaultId, actions);
      setPhase({ kind: "confirming", action, txHash });
      const final = await waitForRequest(config, requestId, settledFor(action, executeNow));
      await refresh();
      setPhase({ kind: "done", action, txHash, status: final?.status ?? null });
    } catch (e) {
      const message = errorMessage(e);
      await refresh();
      setPhase({ kind: "failed", action, message, reason: reasonFromError(message), txHash: e instanceof SignError ? e.txHash : null });
    }
  }

  const tokenPolicy = request ? policy.tokens.find((t) => t.token === request.token) : undefined;
  const blocking = a.problems.filter((p) => p.blocksApprove || p.blocksReject);
  const warnings = a.problems.filter((p) => !p.blocksApprove && !p.blocksReject);
  const approveLabel = executeNow ? "Approve and pay" : "Approve only";
  const open = request !== null && (request.status === "AWAITING_APPROVAL" || request.status === "APPROVED");
  const problemList =
    blocking.length > 0 ? (
      <div className="space-y-2" data-testid="problems">
        {blocking.map((p) => (
          <Notice key={p.code} tone={p.code === "NOT_CONNECTED" ? "info" : p.code === "NOT_OPEN" ? "neutral" : "warn"} title={p.message} />
        ))}
      </div>
    ) : null;

  return (
    <div className="space-y-6">
      {request ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-sm font-medium text-zinc-500">{open ? "Your agent wants to pay" : "Your agent asked to pay"}</h1>
            <StatusBadge status={request.status} />
          </div>
          <p className="mt-3 font-display text-4xl font-semibold tracking-tight" data-testid="amount">
            {formatAmount(request.amount, token)}
          </p>
          <p className="mt-2 text-base text-zinc-600">
            to{" "}
            <span className="text-lg font-semibold text-ink" data-testid="recipient">
              <Mono>{request.recipient}</Mono>
            </span>
          </p>

          <div className="mt-5 rounded-xl bg-paper p-4" data-testid="reason">
            <p className="text-xs font-medium text-zinc-500">What it is for, in your agent&apos;s words</p>
            {request.reason ? (
              <p className="mt-1 text-base text-ink">&ldquo;{request.reason}&rdquo;</p>
            ) : (
              <p className="mt-1 text-sm text-zinc-400">Your agent did not say.</p>
            )}
            <p className="mt-2 text-xs text-zinc-500">Written by your agent. Nobody has checked it.</p>
          </div>

          <ul className="mt-5 space-y-1.5 text-sm text-zinc-600">
            {request.status === "AWAITING_APPROVAL" && tokenPolicy ? (
              <li data-testid="why-waiting">
                It is waiting for you because it is over your {formatAmount(tokenPolicy.auto_limit, token)} instant limit.
              </li>
            ) : null}
            {open ? (
              <li>
                {a.expiresInSec !== null && a.expiresInSec < 0 ? "Expired" : "Expires"} {a.expiresInSec !== null ? formatRelative(a.expiresInSec) : ""} (
                {formatUtc(request.expires_at_ns)}).
              </li>
            ) : (
              <li data-testid="outcome">{outcomeLine(request, snapshot.nowNs)}</li>
            )}
          </ul>

          <details className="group mt-5 border-t border-line pt-4">
            <summary className="cursor-pointer text-sm font-medium text-zinc-600 select-none hover:text-ink">Technical details</summary>
            <dl className="mt-2 divide-y divide-line">
              <Field label="Amount in raw units">
                <Mono>{request.amount}</Mono>
              </Field>
              <Field label="Token contract">
                <Mono>{request.token}</Mono>
              </Field>
              <Field label="Requested by">
                <Mono>{request.agent_id}</Mono>
              </Field>
              <Field label="Request ID">
                <Mono>{request.request_id}</Mono>
              </Field>
              <Field label="Fingerprint">
                <Mono>{request.request_hash}</Mono>
              </Field>
            </dl>
          </details>
        </Card>
      ) : null}

      {request && open && a.computedHash ? (
        a.hashMatches ? (
          <div data-testid="hash-check" data-ok="true">
            <Notice tone="good" title="Safety check passed">
              <p>
                What you see here is exactly what your agent asked for. Your approval only works for these exact terms, so if anything had been
                changed, the vault would refuse it.
              </p>
              <p className="mt-1 text-xs opacity-80">
                Fingerprint <Mono>{shortHash(a.computedHash)}</Mono>, checked in your browser.
              </p>
            </Notice>
          </div>
        ) : (
          <div data-testid="hash-check" data-ok="false">
            <Notice tone="bad" title="Safety check failed: do not approve">
              <p>What is shown here does not match what the vault saved. Someone may have changed it on its way to you.</p>
              <p className="mt-1 text-xs opacity-80">
                Fingerprint here <Mono>{shortHash(a.computedHash)}</Mono>, saved in the vault <Mono>{shortHash(request.request_hash)}</Mono>.
              </p>
            </Notice>
          </div>
        )
      ) : null}

      {open ? null : problemList}
      {warnings.map((p) => (
        <Notice key={p.code} tone="neutral" title={p.message} />
      ))}

      {request && open ? (
        <Card>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Your decision</h2>
          {tokenPolicy ? (
            <p className="mt-1 text-sm text-zinc-600">
              Left to spend today:{" "}
              <span className="font-semibold text-ink" data-testid="budget-left">
                {budget ? `${formatAmount(budget.available, token)} of ${formatAmount(budget.daily_limit, token)}` : "unknown"}
              </span>
            </p>
          ) : null}
          {problemList ? <div className="mt-4">{problemList}</div> : null}
          {request.status === "AWAITING_APPROVAL" ? (
            <label className="mt-4 flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-brand"
                checked={executeNow}
                onChange={(e) => setExecuteNow(e.target.checked)}
                disabled={busy}
                data-testid="execute-now"
              />
              <span>
                Pay right away
                <span className="block text-zinc-500">If you untick this, it is approved now and your agent sends it later, before it expires.</span>
              </span>
            </label>
          ) : null}
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            {wallet.accountId === null && signer ? (
              <Button onClick={() => void wallet.connect()} disabled={wallet.busy} variant="secondary" testId="connect-inline">
                Connect owner wallet
              </Button>
            ) : null}
            {request.status === "AWAITING_APPROVAL" ? (
              <Button onClick={() => void decide("approve")} disabled={!a.canApprove || busy} testId="approve">
                {approveLabel}
              </Button>
            ) : null}
            <Button onClick={() => void decide("reject")} disabled={!a.canReject || busy} variant="danger" testId="reject">
              Reject
            </Button>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-zinc-500">
            Your wallet will ask you to confirm. Approving needs your wallet&apos;s main key, so an app you have only partly connected cannot approve
            payments for you.
          </p>
        </Card>
      ) : null}

      <div aria-live="polite" data-testid="phase" data-phase={phase.kind}>
        <PhaseView phase={phase} config={config} />
      </div>
    </div>
  );
}

function TxLink({ config, txHash }: { config: AppConfig; txHash: string | null }) {
  if (!txHash) return null;
  const href = explorerTxLink(config, txHash);
  return (
    <p className="mt-1">
      Transaction{" "}
      {href ? (
        <a className="font-mono underline" href={href} target="_blank" rel="noreferrer">
          {shortHash(txHash)}
        </a>
      ) : (
        <Mono>{txHash}</Mono>
      )}
    </p>
  );
}

function PhaseView({ phase, config }: { phase: Phase; config: AppConfig }) {
  switch (phase.kind) {
    case "idle":
      return null;
    case "signing":
      return <Notice tone="info" title="Waiting for you to confirm in your wallet…" />;
    case "confirming":
      return (
        <Notice tone="info" title="Sent. Waiting for the vault to confirm…">
          <TxLink config={config} txHash={phase.txHash} />
        </Notice>
      );
    case "done": {
      const s = phase.status;
      const title =
        s === "SETTLED"
          ? "Done: approved and paid. The money has been sent."
          : s === "APPROVED"
            ? "Done: approved. Your agent can now send it."
            : s === "DENIED"
              ? "Done: rejected. Nothing was sent."
              : s === "TRANSFER_FAILED"
                ? "Approved, but the transfer failed, so nothing was spent."
                : `Sent, but not confirmed yet${s ? ` (the vault says: ${statusLabel(s)})` : ""}. Refresh in a moment.`;
      const tone = s === "SETTLED" || s === "APPROVED" || s === "DENIED" ? "good" : "warn";
      return (
        <Notice tone={tone} title={title}>
          <TxLink config={config} txHash={phase.txHash} />
        </Notice>
      );
    }
    case "failed":
      return (
        <Notice tone="bad" title={phase.reason ? `The vault refused this (${phase.reason})` : "It did not go through"}>
          <p>{phase.reason ? explainReason(phase.reason) : phase.message}</p>
          <p className="mt-1">Nothing changed, apart from a tiny network fee if your wallet sent anything.</p>
          <TxLink config={config} txHash={phase.txHash} />
        </Notice>
      );
  }
}
