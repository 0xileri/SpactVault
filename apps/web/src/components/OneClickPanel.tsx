import { useState } from "react";

import { chainName, txExplorerLink } from "@spact/intents";
import { formatUnits, type PaymentRequest } from "@spact/shared";

import type { AppConfig } from "../config.js";
import { formatUtc } from "../format.js";
import { formatNear, registerWithTokenActions } from "../owner/actions.js";
import { STATUS_WORDS, type Tracking } from "../oneclick.js";
import type { OwnerSigner } from "../signers/index.js";
import type { SignerState } from "../useSigner.js";
import { SignReview } from "./owner/SignReview.js";
import { Badge, Button, Mono, Notice } from "./ui.js";

function ExternalTx({ chain, hash }: { chain: string; hash: string }) {
  const href = txExplorerLink(chain, hash);
  return (
    <li>
      {chainName(chain)}:{" "}
      {href ? (
        <a href={href} target="_blank" rel="noreferrer noopener" className="font-mono underline" data-testid={`tx-${chain}`}>
          {hash.length > 20 ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : hash}
        </a>
      ) : (
        <Mono>{hash}</Mono>
      )}
    </li>
  );
}

/**
 * What 1Click says about a cross-chain request's deposit address: before approval, whether its record
 * matches the request; once paid, where the swap stands, with explorer links built by this page for both chains.
 */
export function OneClickPanel({
  config,
  request,
  tracking,
  signer,
  wallet,
  owner,
  onRegistered,
}: {
  config: AppConfig;
  request: PaymentRequest;
  tracking: Tracking | null;
  signer: OwnerSigner | null;
  wallet: SignerState;
  owner: string;
  onRegistered: () => void;
}) {
  const [registering, setRegistering] = useState(false);
  const terms = request.cross_chain;
  if (!terms || !tracking) return null;
  const { check, reconciliation } = tracking;
  const open = request.status === "AWAITING_APPROVAL" || request.status === "APPROVED";

  if (check.state === "unavailable") {
    return (
      <div data-testid="oneclick" data-state="unavailable">
        <Notice tone="warn" title="1Click is not reachable from this copy of the site">
          <p>It cannot confirm the deposit address or follow the payment. The hosted site at spactvault.xyz can.</p>
        </Notice>
      </div>
    );
  }
  if (check.state === "checking") {
    return (
      <p className="text-sm text-zinc-500" data-testid="oneclick" data-state="checking">
        Asking 1Click about the deposit address…
      </p>
    );
  }
  if (check.state === "error") {
    return (
      <div data-testid="oneclick" data-state="error">
        <Notice tone="warn" title="Could not reach 1Click">
          <p className="break-words">{check.message}</p>
        </Notice>
      </div>
    );
  }
  if (check.state === "mismatch") {
    return (
      <div data-testid="oneclick" data-state="mismatch">
        <Notice tone="bad" title="1Click's record of this deposit address does not match: do not approve">
          <ul className="list-disc pl-5">
            {check.mismatches.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <p className="mt-1">The deposit address may belong to someone else&apos;s quote. Reject the request.</p>
        </Notice>
      </div>
    );
  }

  const q = check.status.quoteResponse.quote;
  const status = check.status.status;
  const details = check.status.swapDetails;
  const nearHashes = [...new Set([...(details?.nearTxHashes ?? []), ...(details?.originChainTxHashes ?? []).map((t) => t.hash)])];
  const destHashes = (details?.destinationChainTxHashes ?? []).map((t) => t.hash);

  return (
    <div className="space-y-3" data-testid="oneclick" data-state="verified" data-status={status}>
      {open ? (
        <Notice tone="good" title="1Click confirms this deposit address">
          <p data-testid="oneclick-terms">
            1Click&apos;s own record of this address matches the request: it pays <Mono>{terms.destination_recipient}</Mono> on{" "}
            {chainName(terms.destination_chain)} at least{" "}
            {check.destination
              ? `${formatUnits(BigInt(q.minAmountOut), check.destination.decimals)} ${check.destination.symbol}`
              : `${q.minAmountOut} of the smallest unit of ${terms.destination_asset}`}
            , and refunds go to <Mono>{terms.refund_to}</Mono>.
          </p>
          <p className="mt-1 text-xs opacity-80" data-testid="oneclick-signed">
            Signed by 1Click: its signature on this quote was checked in your browser.
          </p>
          {q.deadline ? <p className="mt-1 text-xs opacity-80">Quote deadline {formatUtc((BigInt(Date.parse(q.deadline)) * 1_000_000n).toString())}.</p> : null}
        </Notice>
      ) : null}

      {open && check.registered === false ? (
        registering ? (
          <SignReview
            config={config}
            signer={signer}
            wallet={wallet}
            title="Register the deposit address with the token"
            receiverId={request.token}
            signerId={owner}
            actions={registerWithTokenActions(request.recipient, check.storageMin ?? 0n)}
            changes={[
              `Pays ${formatNear(check.storageMin ?? 0n, 5)} NEAR so ${request.recipient} can hold ${request.token}. Without it the vault's transfer fails and nothing is paid.`,
            ]}
            blocked={check.storageMin === null ? "Could not read what registering costs." : null}
            onCancel={() => setRegistering(false)}
            onDone={() => {
              setRegistering(false);
              onRegistered();
            }}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-amber-800">The deposit address is not registered with the token yet.</p>
            <Button variant="secondary" onClick={() => setRegistering(true)} testId="register-deposit">
              Register it
            </Button>
          </div>
        )
      ) : null}

      {request.status === "CROSS_CHAIN_PENDING" ? (
        <div className="rounded-xl border border-line p-4 text-sm" data-testid="oneclick-tracker">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">1Click:</span>
            <Badge tone={status === "SUCCESS" ? "good" : status === "REFUNDED" || status === "FAILED" || status === "INCOMPLETE_DEPOSIT" ? "warn" : "info"}>
              <span data-testid="oneclick-status">{STATUS_WORDS[status]}</span>
            </Badge>
            {reconciliation?.providerFinal ? null : <span className="text-xs text-zinc-500">checking every 5 seconds</span>}
          </p>
          {nearHashes.length + destHashes.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {nearHashes.map((h) => (
                <ExternalTx key={`near${h}`} chain="near" hash={h} />
              ))}
              {destHashes.map((h) => (
                <ExternalTx key={`dest${h}`} chain={terms.destination_chain} hash={h} />
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-xs text-zinc-500">
            {status === "REFUNDED"
              ? `1Click reports a refund${reconciliation?.reportedRefund ? ` of ${reconciliation.reportedRefund} raw units` : ""} to the vault. Check the vault's balance: the report is not proof, and today's limit stays used.`
              : "This is 1Click's report, not something the vault checked. The vault's part ended when it paid the deposit address."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
