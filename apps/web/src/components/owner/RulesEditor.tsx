import { useState } from "react";

import { formatUnits, parseUnits, type ConfigView, type CrossChainRoute, type Policy } from "@spact/shared";

import type { AppConfig } from "../../config.js";
import { errorMessage } from "../../format.js";
import { policyChanges, policyProblems, setPolicyActions, type Decimals } from "../../owner/actions.js";
import type { OwnerSigner } from "../../signers/index.js";
import type { SignerState } from "../../useSigner.js";
import { Button, Card, Mono } from "../ui.js";
import { SignReview, splitList, TextField } from "./SignReview.js";

interface TokenRow {
  token: string;
  auto: string;
  cap: string;
  daily: string;
}

interface RouteRow {
  token: string;
  chain: string;
  asset: string;
  recipients: string;
}

interface Draft {
  tokens: TokenRow[];
  recipients: string;
  maxOpen: string;
  perDay: string;
  ttlHours: string;
  routes: RouteRow[];
}

function display(units: string, token: string, meta: Decimals): string {
  const m = meta(token);
  return m ? formatUnits(BigInt(units), m.decimals) : units;
}

function draftOf(policy: Policy, meta: Decimals): Draft {
  return {
    tokens: policy.tokens.map((t) => ({
      token: t.token,
      auto: display(t.auto_limit, t.token, meta),
      cap: display(t.hard_tx_limit, t.token, meta),
      daily: display(t.daily_limit, t.token, meta),
    })),
    recipients: policy.recipients.join("\n"),
    maxOpen: String(policy.max_open_approvals),
    perDay: String(policy.max_requests_per_day),
    ttlHours: String(policy.approval_ttl_sec / 3600),
    routes: policy.cross_chain.map((r) => ({ token: r.token, chain: r.destination_chain, asset: r.destination_asset, recipients: r.recipients.join("\n") })),
  };
}

function wholeNumber(text: string, what: string): number {
  if (!/^\d{1,7}$/.test(text.trim())) throw new Error(`${what}: enter a whole number.`);
  return Number(text.trim());
}

/** The policy the draft describes, in base units. Throws a sentence when a field cannot be converted. */
export function policyOf(draft: Draft, meta: Decimals): Policy {
  const units = (v: string, token: string, what: string) => {
    const m = meta(token);
    try {
      return m ? parseUnits(v.trim(), m.decimals).toString() : BigInt(v.trim()).toString();
    } catch {
      throw new Error(`${what} for ${m?.symbol ?? token}: enter an amount${m ? ` with at most ${m.decimals} decimals` : " in base units"}.`);
    }
  };
  if (!/^\d+(\.\d+)?$/.test(draft.ttlHours.trim())) throw new Error("How long a request may wait: enter hours, e.g. 24.");
  return {
    tokens: draft.tokens.map((t) => ({
      token: t.token.trim(),
      auto_limit: units(t.auto, t.token, "Paid instantly up to"),
      hard_tx_limit: units(t.cap, t.token, "Per-payment cap"),
      daily_limit: units(t.daily, t.token, "Most per day"),
    })),
    recipients: splitList(draft.recipients),
    max_open_approvals: wholeNumber(draft.maxOpen, "Payments waiting at once"),
    max_requests_per_day: wholeNumber(draft.perDay, "Requests per day"),
    approval_ttl_sec: Math.round(Number(draft.ttlHours.trim()) * 3600),
    cross_chain: draft.routes.map((r) => ({
      token: r.token.trim(),
      destination_chain: r.chain.trim(),
      destination_asset: r.asset.trim(),
      recipients: splitList(r.recipients),
    })),
  };
}

/** `policy` with `route` allowed: merged into an existing route to the same asset, or added. */
export function withRoute(policy: Policy, route: CrossChainRoute): Policy {
  const same = (r: CrossChainRoute) => r.token === route.token && r.destination_chain === route.destination_chain && r.destination_asset === route.destination_asset;
  const existing = policy.cross_chain.find(same);
  const cross_chain = existing
    ? policy.cross_chain.map((r) => (same(r) ? { ...r, recipients: [...r.recipients, ...route.recipients.filter((a) => !r.recipients.includes(a))] } : r))
    : [...policy.cross_chain, route];
  return { ...policy, cross_chain };
}

/** The review for a new policy, used by the editor and the cross-chain page. */
export function PolicyReview({
  config,
  signer,
  wallet,
  vault,
  before,
  after,
  meta,
  title = "Change the rules",
  onCancel,
  onDone,
}: {
  config: AppConfig;
  signer: OwnerSigner | null;
  wallet: SignerState;
  vault: ConfigView;
  before: Policy;
  after: Policy;
  meta: Decimals;
  title?: string;
  onCancel?: (() => void) | undefined;
  onDone?: (() => void) | undefined;
}) {
  const problems = policyProblems(after, vault.vault_id);
  const changes = policyChanges(before, after, meta);
  const waiting = vault.open_approvals;
  return (
    <SignReview
      config={config}
      signer={signer}
      wallet={wallet}
      title={title}
      receiverId={vault.vault_id}
      signerId={vault.owner}
      actions={setPolicyActions(after)}
      changes={[
        ...(changes.length > 0 ? changes : ["Nothing changes."]),
        `Rules become version ${vault.policy_version + 1}.${waiting > 0 ? ` The ${waiting} request(s) waiting for you can then no longer be approved; your agent has to ask again.` : ""}`,
      ]}
      blocked={problems.length > 0 ? `The vault would refuse these rules: ${problems.join(" ")}` : changes.length === 0 ? "Nothing to change." : null}
      onCancel={onCancel}
      onDone={onDone}
    />
  );
}

export function RulesEditor({
  config,
  signer,
  wallet,
  vault,
  policy,
  meta,
  editing,
  canEdit,
  onEdit,
  onClose,
  onDone,
}: {
  config: AppConfig;
  signer: OwnerSigner | null;
  wallet: SignerState;
  vault: ConfigView;
  policy: Policy;
  meta: Decimals;
  editing: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(policy, meta));
  const [after, setAfter] = useState<Policy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fmt = (units: string, token: string) => {
    const m = meta(token);
    return m ? `${formatUnits(BigInt(units), m.decimals)} ${m.symbol}` : `${units} base units`;
  };

  if (!editing) {
    return (
      <Card className="space-y-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-2" data-testid="rules-summary">
          {policy.tokens.map((t) => (
            <div key={t.token}>
              <dt className="text-zinc-500">{meta(t.token)?.symbol ?? t.token}</dt>
              <dd>
                instant up to {fmt(t.auto_limit, t.token)}, cap {fmt(t.hard_tx_limit, t.token)}, {fmt(t.daily_limit, t.token)} a day
              </dd>
            </div>
          ))}
          <div>
            <dt className="text-zinc-500">May pay on NEAR</dt>
            <dd>{policy.recipients.length === 0 ? "nobody" : policy.recipients.map((r) => <Mono key={r} className="block">{r}</Mono>)}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Cross-chain</dt>
            <dd data-testid="rules-routes">
              {policy.cross_chain.length === 0
                ? "off"
                : policy.cross_chain.map((r) => (
                    <span key={`${r.destination_chain}${r.destination_asset}`} className="block">
                      {r.destination_chain}: <Mono>{r.recipients.join(", ")}</Mono>
                    </span>
                  ))}
            </dd>
          </div>
        </dl>
        <Button
          onClick={() => {
            setDraft(draftOf(policy, meta));
            setAfter(null);
            onEdit();
          }}
          disabled={!canEdit}
          testId="open-rules"
        >
          Change the rules
        </Button>
      </Card>
    );
  }

  if (after) {
    return (
      <PolicyReview
        config={config}
        signer={signer}
        wallet={wallet}
        vault={vault}
        before={policy}
        after={after}
        meta={meta}
        onCancel={() => setAfter(null)}
        onDone={onDone}
      />
    );
  }

  const setToken = (i: number, k: keyof TokenRow) => (v: string) => setDraft((d) => ({ ...d, tokens: d.tokens.map((t, j) => (j === i ? { ...t, [k]: v } : t)) }));
  const setRoute = (i: number, k: keyof RouteRow) => (v: string) => setDraft((d) => ({ ...d, routes: d.routes.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));

  return (
    <Card className="space-y-6">
      {draft.tokens.map((t, i) => (
        <fieldset key={t.token || i} className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-1 text-sm font-semibold">
            {meta(t.token)?.symbol ?? "Token"} <Mono className="text-xs font-normal text-zinc-500">{t.token}</Mono>
          </legend>
          <TextField label="Paid instantly up to" value={t.auto} onChange={setToken(i, "auto")} testId={`rules-auto-${i}`} inputMode="decimal" />
          <TextField label="Per-payment cap" value={t.cap} onChange={setToken(i, "cap")} testId={`rules-cap-${i}`} inputMode="decimal" />
          <TextField label="Most per day" value={t.daily} onChange={setToken(i, "daily")} testId={`rules-daily-${i}`} inputMode="decimal" />
        </fieldset>
      ))}
      <TextField label="Who it may pay on NEAR" value={draft.recipients} onChange={(v) => setDraft((d) => ({ ...d, recipients: v }))} testId="rules-recipients" multiline hint="One account per line." />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="Payments waiting at once" value={draft.maxOpen} onChange={(v) => setDraft((d) => ({ ...d, maxOpen: v }))} testId="rules-max-open" inputMode="numeric" />
        <TextField label="Requests per day" value={draft.perDay} onChange={(v) => setDraft((d) => ({ ...d, perDay: v }))} testId="rules-per-day" inputMode="numeric" />
        <TextField label="A request may wait (hours)" value={draft.ttlHours} onChange={(v) => setDraft((d) => ({ ...d, ttlHours: v }))} testId="rules-ttl" inputMode="decimal" />
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold">Cross-chain payments (1Click)</p>
        <p className="text-xs text-zinc-500">
          Each route lets the agent ask for payments of one token to one asset on another chain, and only to the addresses listed. Every cross-chain payment
          still waits for your approval. The cross-chain page can price a route and fill this in for you.
        </p>
        {draft.routes.map((r, i) => (
          <fieldset key={i} className="grid gap-3 rounded-lg p-3 ring-1 ring-line sm:grid-cols-2" data-testid={`route-${i}`}>
            <TextField label="Token on NEAR" value={r.token} onChange={setRoute(i, "token")} testId={`route-token-${i}`} />
            <TextField label="Destination chain" value={r.chain} onChange={setRoute(i, "chain")} testId={`route-chain-${i}`} hint="As 1Click names it, e.g. sol or base" />
            <TextField label="Destination asset (1Click id)" value={r.asset} onChange={setRoute(i, "asset")} testId={`route-asset-${i}`} />
            <TextField label="Allowed recipients there" value={r.recipients} onChange={setRoute(i, "recipients")} testId={`route-recipients-${i}`} multiline />
            <div className="sm:col-span-2">
              <Button variant="danger" onClick={() => setDraft((d) => ({ ...d, routes: d.routes.filter((_, j) => j !== i) }))} testId={`route-remove-${i}`}>
                Remove this route
              </Button>
            </div>
          </fieldset>
        ))}
        <Button
          variant="secondary"
          onClick={() => setDraft((d) => ({ ...d, routes: [...d.routes, { token: policy.tokens[0]?.token ?? "", chain: "", asset: "", recipients: "" }] }))}
          testId="route-add"
        >
          Add a route
        </Button>
      </div>

      {error ? <p className="text-sm text-rose-700" data-testid="rules-error">{error}</p> : null}
      <div className="flex gap-2">
        <Button
          onClick={() => {
            try {
              setAfter(policyOf(draft, meta));
              setError(null);
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
          testId="review-rules"
        >
          Review
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Card>
  );
}
