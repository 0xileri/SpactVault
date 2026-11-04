import { useCallback, useEffect, useMemo, useState } from "react";

import { buildQuoteRequest, chainName, quoteResponseSchema, tokenListSchema, verifyQuoteSignature, type OneClickToken, type QuoteResponse } from "@spact/intents";
import { formatUnits, parseUnits, type PaymentRequest } from "@spact/shared";

import type { AppConfig } from "../config.js";
import { errorMessage, formatAmount } from "../format.js";
import { loadOwnerSnapshot, type OwnerSnapshot } from "../near/owner.js";
import { listRequests } from "../near/vault.js";
import { useLink } from "../network.js";
import { oneClickFor } from "../oneclick.js";
import type { Decimals } from "../owner/actions.js";
import type { OwnerSigner } from "../signers/index.js";
import type { SignerState } from "../useSigner.js";
import { DestinationAddress } from "./AccountLink.js";
import { PolicyReview, withRoute } from "./owner/RulesEditor.js";
import { splitList, TextField } from "./owner/SignReview.js";
import { Button, Card, Mono, Notice, StatusBadge } from "./ui.js";

interface Priced {
  quote: QuoteResponse;
  token: string;
  destination: OneClickToken;
  recipient: string;
  amount: bigint;
}

/** App fees 1Click puts in its echo of the request, in basis points of the amount. Live, it adds one unasked. */
function appFeeBps(q: QuoteResponse): number {
  return (q.quoteRequest.appFees ?? []).reduce((sum, a) => sum + a.fee, 0);
}

function usd(text: string | undefined): number | null {
  const n = text === undefined ? NaN : Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * Cross-chain payments (P1, ADR-032/033): price a route with a dry 1Click quote, allow it in the rules,
 * and follow the vault's cross-chain requests. The agent asks for the real quote itself (MCP
 * request_cross_chain_payment); nothing on this page can pay.
 */
export function CrossChainPage({ config, signer, wallet }: { config: AppConfig; signer: OwnerSigner | null; wallet: SignerState }) {
  const link = useLink();
  const api = useMemo(() => oneClickFor(config), [config]);
  const [snap, setSnap] = useState<OwnerSnapshot | null>(null);
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [destinations, setDestinations] = useState<OneClickToken[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [amount, setAmount] = useState("1");
  const [asset, setAsset] = useState("");
  const [recipient, setRecipient] = useState("");
  const [slippage, setSlippage] = useState("100");
  const [priced, setPriced] = useState<Priced | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [allowing, setAllowing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([loadOwnerSnapshot(config, wallet.accountId), listRequests(config, 0, 50)]);
      setSnap(s);
      setRequests(list.filter((r) => r.route === "ONE_CLICK_ORIGIN_NEAR"));
      setToken((t) => t || s.policy.tokens[0]?.token || "");
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [config, wallet.accountId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    api
      .tokens()
      .then((raw) => {
        const list = tokenListSchema.safeParse(raw);
        if (!alive) return;
        if (!list.success) {
          setQuoteError("1Click's token list did not parse.");
          return;
        }
        const out = list.data.filter((t) => t.blockchain !== "near").sort((a, b) => `${a.symbol}${a.blockchain}`.localeCompare(`${b.symbol}${b.blockchain}`));
        setDestinations(out);
        const preferred = out.find((t) => t.symbol === "USDC" && t.blockchain === "sol") ?? out[0];
        setAsset((a) => a || preferred?.assetId || "");
      })
      .catch((e: unknown) => alive && setQuoteError(`Could not load 1Click's token list: ${errorMessage(e)}`));
    return () => {
      alive = false;
    };
  }, [api]);

  if (error) {
    return (
      <Notice tone="bad" title="Could not read this vault">
        <p className="break-words">{error}</p>
      </Notice>
    );
  }
  if (!snap) return <p className="text-sm text-zinc-500">Reading the vault…</p>;

  const meta: Decimals = (t) => {
    const m = snap.tokens.find((x) => x.token === t)?.metadata;
    return m ? { decimals: m.decimals, symbol: m.symbol } : null;
  };
  const origin = snap.tokens.find((t) => t.token === token);
  const destination = destinations?.find((d) => d.assetId === asset) ?? null;

  async function price() {
    setQuoteError(null);
    setPriced(null);
    setAllowing(false);
    setBusy(true);
    try {
      if (!api) throw new Error("This copy of the site has no 1Click access.");
      if (!origin?.metadata) throw new Error("The token's decimals are unknown.");
      if (!destination) throw new Error("Pick where the money should arrive.");
      const to = recipient.trim();
      if (splitList(to).length !== 1) throw new Error("Enter one recipient address.");
      const units = parseUnits(amount.trim(), origin.metadata.decimals);
      const asked = buildQuoteRequest({
        vaultId: config.vaultId,
        token,
        amount: units,
        destinationAsset: destination.assetId,
        recipient: to,
        slippageBps: Number(slippage),
        deadline: new Date(Date.now() + 60 * 60 * 1000),
        dry: true,
      });
      const parsed = quoteResponseSchema.safeParse(await api.quote(asked));
      if (!parsed.success) throw new Error("1Click's answer did not parse as a quote.");
      const q = parsed.data;
      if (!verifyQuoteSignature(q, config.oneClickSignerKey)) throw new Error("1Click's signature on this price does not verify, so it is not shown.");
      if (q.quoteRequest.recipient !== to || q.quoteRequest.destinationAsset !== destination.assetId || q.quoteRequest.amount !== units.toString()) {
        throw new Error("1Click answered a different question (recipient, asset or amount changed).");
      }
      setPriced({ quote: q, token, destination, recipient: to, amount: units });
    } catch (e) {
      setQuoteError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const route = priced
    ? { token: priced.token, destination_chain: priced.destination.blockchain, destination_asset: priced.destination.assetId, recipients: [priced.recipient] }
    : null;
  const allowed =
    route !== null &&
    snap.policy.cross_chain.some(
      (r) => r.token === route.token && r.destination_chain === route.destination_chain && r.destination_asset === route.destination_asset && r.recipients.includes(priced?.recipient ?? ""),
    );
  const fee = priced ? (() => {
    const i = usd(priced.quote.quote.amountInUsd);
    const o = usd(priced.quote.quote.amountOutUsd);
    return i !== null && o !== null ? Math.max(0, i - o) : null;
  })() : null;

  return (
    <div className="space-y-10" data-testid="crosschain-page">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Cross-chain payments</h1>
        <p className="text-sm text-zinc-600">
          Your agent can pay someone on another chain through NEAR Intents 1Click, but only to destinations you allow here, and every such payment waits for
          your approval. The vault sends the tokens to 1Click&apos;s deposit address on NEAR; 1Click pays the recipient there.
        </p>
      </div>

      <section aria-label="Price a route" className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Price a route</h2>
        <Card className="space-y-4">
          {api === null ? (
            <Notice tone="warn" title="This copy of the site has no 1Click access">
              <p>Open the hosted site at spactvault.xyz, which reaches 1Click through its own server.</p>
            </Notice>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-zinc-800">Pay with</span>
              <select value={token} onChange={(e) => setToken(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" data-testid="xc-token">
                {snap.tokens.map((t) => (
                  <option key={t.token} value={t.token}>
                    {t.metadata?.symbol ?? t.token} on NEAR
                  </option>
                ))}
              </select>
            </label>
            <TextField label={`Amount${origin?.metadata ? ` in ${origin.metadata.symbol}` : ""}`} value={amount} onChange={setAmount} testId="xc-amount" inputMode="decimal" />
            <label className="block text-sm">
              <span className="font-medium text-zinc-800">Arrives as</span>
              <select value={asset} onChange={(e) => setAsset(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm" data-testid="xc-destination" disabled={!destinations}>
                {(destinations ?? []).map((d) => (
                  <option key={d.assetId} value={d.assetId}>
                    {d.symbol} on {chainName(d.blockchain)}
                  </option>
                ))}
              </select>
            </label>
            <TextField label="Recipient there" value={recipient} onChange={setRecipient} testId="xc-recipient" hint={destination ? `An address on ${chainName(destination.blockchain)}` : undefined} />
            <TextField label="Max slippage (basis points)" value={slippage} onChange={setSlippage} testId="xc-slippage" inputMode="numeric" hint="100 = 1%. The vault refuses quotes above 500." />
          </div>
          {quoteError ? <p className="text-sm text-rose-700 break-words" data-testid="xc-error">{quoteError}</p> : null}
          <Button onClick={() => void price()} disabled={busy || api === null || !destination} testId="xc-price">
            {busy ? "Asking 1Click…" : "Get a price"}
          </Button>

          {priced ? (
            <div className="space-y-3 rounded-xl bg-paper p-4 text-sm" data-testid="xc-quote">
              <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">1Click&apos;s price (a dry quote: nothing is reserved or paid)</p>
              <dl className="grid gap-2 sm:grid-cols-[12rem_1fr]">
                <dt className="text-zinc-500">The vault sends</dt>
                <dd data-testid="xc-in">{formatAmount(priced.quote.quote.amountIn, origin?.metadata ?? null)}</dd>
                <dt className="text-zinc-500">{priced.recipient.slice(0, 12)}… receives about</dt>
                <dd data-testid="xc-out">
                  {formatUnits(BigInt(priced.quote.quote.amountOut), priced.destination.decimals)} {priced.destination.symbol} on {chainName(priced.destination.blockchain)}
                </dd>
                <dt className="text-zinc-500">At least</dt>
                <dd data-testid="xc-min-out">
                  {formatUnits(BigInt(priced.quote.quote.minAmountOut), priced.destination.decimals)} {priced.destination.symbol}
                </dd>
                <dt className="text-zinc-500">Fees and price impact</dt>
                <dd data-testid="xc-fee">
                  {fee === null ? "not reported" : `about $${fee.toFixed(2)}`}
                  {appFeeBps(priced.quote) > 0 ? (
                    <span className="block text-xs text-zinc-500" data-testid="xc-app-fee">
                      includes an app fee 1Click added: {appFeeBps(priced.quote)} basis point(s) of the amount
                    </span>
                  ) : null}
                </dd>
                <dt className="text-zinc-500">Takes about</dt>
                <dd>{priced.quote.quote.timeEstimate !== undefined ? `${Math.round(priced.quote.quote.timeEstimate)} seconds` : "not reported"}</dd>
                <dt className="text-zinc-500">Deadline</dt>
                <dd>Set by the real quote your agent asks for; the vault refuses it 60 seconds before.</dd>
              </dl>
              {allowed ? (
                <p className="text-emerald-800" data-testid="xc-allowed">
                  Your rules already allow this recipient. Your agent can ask for this payment now.
                </p>
              ) : allowing && route ? (
                <PolicyReview
                  config={config}
                  signer={signer}
                  wallet={wallet}
                  vault={snap.config}
                  before={snap.policy}
                  after={withRoute(snap.policy, route)}
                  meta={meta}
                  title={`Allow cross-chain payments to ${priced.recipient} on ${chainName(priced.destination.blockchain)}`}
                  onCancel={() => setAllowing(false)}
                  onDone={() => {
                    void refresh();
                    for (const ms of [2_000, 5_000]) setTimeout(() => void refresh(), ms);
                  }}
                />
              ) : (
                <Button onClick={() => setAllowing(true)} testId="xc-allow">
                  Allow this recipient in your rules
                </Button>
              )}
            </div>
          ) : null}
        </Card>
      </section>

      <section aria-label="Cross-chain requests" className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Your agent&apos;s cross-chain requests</h2>
        <Card>
          {requests.length === 0 ? (
            <p className="text-sm text-zinc-600">None yet.</p>
          ) : (
            <ul className="divide-y divide-line" data-testid="xc-requests">
              {requests.map((r) => (
                <li key={r.request_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <span>
                    <span className="font-semibold">{formatAmount(r.amount, snap.tokens.find((t) => t.token === r.token)?.metadata ?? null)}</span> to{" "}
                    {r.cross_chain ? <DestinationAddress chain={r.cross_chain.destination_chain} address={r.cross_chain.destination_recipient} /> : null} on{" "}
                    {chainName(r.cross_chain?.destination_chain ?? "")}
                    <span className="block text-xs text-zinc-500">
                      <Mono>{r.request_id}</Mono>
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <StatusBadge status={r.status} />
                    <a className="font-medium underline" href={link(`?request=${encodeURIComponent(r.request_id)}`)}>
                      Open
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-zinc-500">Open a request to approve it, or to follow it on both chains once it is paid.</p>
        </Card>
      </section>
    </div>
  );
}
