import { ArrowRight } from "@phosphor-icons/react";
import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";

import type { FtMetadata, PaymentRequest } from "@spact/shared";

import { explorerAccountLink, type AppConfig } from "../config.js";
import { budgetResetNs, isLapsed, outcomeLine, usedPercent, waitingForOwner, type TokenSummary } from "../dashboard.js";
import { errorMessage, formatAmount, formatRelative, formatUtc } from "../format.js";
import { listRequests, loadDashboard, type DashboardSnapshot } from "../near/vault.js";
import { useLink } from "../network.js";
import { Badge, Button, Card, Mono, Notice, StatusBadge } from "./ui.js";

const PAGE = 50;
const REFRESH_MS = 15_000;

function requestLink(id: string): string {
  return `?request=${encodeURIComponent(id)}`;
}

function AccountLink({ config, account }: { config: AppConfig; account: string }) {
  const href = explorerAccountLink(config, account);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer noopener" className="underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-600">
      <Mono>{account}</Mono>
    </a>
  ) : (
    <Mono>{account}</Mono>
  );
}

function SectionHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
      {children ? <div className="text-xs text-zinc-500">{children}</div> : null}
    </div>
  );
}

function Stat({ label, children, testId, foot }: { label: string; children: ReactNode; testId?: string; foot?: ReactNode }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-zinc-500">{label}</p>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl" data-testid={testId}>
        {children}
      </div>
      {foot ? <div className="mt-2 text-xs text-zinc-500">{foot}</div> : null}
    </Card>
  );
}

/** Money in the vault and what is left of today's limit, for one token. */
function MoneyStats({ token, nowNs }: { token: TokenSummary; nowNs: bigint }) {
  const { policy, metadata, balance, budget, budgetProblem } = token;
  const fmt = (units: string | bigint) => formatAmount(units.toString(), metadata);
  const pct = budget && !budgetProblem ? usedPercent(budget) : null;
  const resetIn = budget ? Number((budgetResetNs(budget) - nowNs) / 1_000_000_000n) : null;
  return (
    <>
      <Stat label="Money in the vault" testId={`balance-${policy.token}`} foot={<Mono>{policy.token}</Mono>}>
        {balance === null ? "unknown" : fmt(balance)}
      </Stat>
      {budgetProblem ? (
        <div className="sm:col-span-2 lg:col-span-1">
          <Notice tone="warn" title="Today's spending numbers do not add up">
            <p>
              The server this page reads from sent numbers that contradict each other ({budgetProblem}), so they are not shown. The vault still
              enforces its own limits.
            </p>
          </Notice>
        </div>
      ) : budget && pct !== null ? (
        <Stat
          label="Left to spend today"
          foot={
            <>
              <span className="block h-1.5 overflow-hidden rounded-full bg-zinc-100" role="progressbar" aria-label="Share of today's limit used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                <span className={`block h-full rounded-full ${pct >= 90 ? "bg-blocked" : pct >= 60 ? "bg-waits" : "bg-paid"}`} style={{ width: `${pct}%` }} />
              </span>
              <span className="mt-2 block">
                {fmt(budget.executed)} spent{budget.pending !== "0" ? `, ${fmt(budget.pending)} being sent` : ""}. Resets{" "}
                {resetIn !== null ? formatRelative(resetIn) : ""} (midnight UTC).
              </span>
            </>
          }
        >
          <span data-testid={`available-${policy.token}`}>{fmt(budget.available)}</span>
          <span className="ml-2 text-sm font-normal tracking-normal text-zinc-500">of {fmt(budget.daily_limit)}</span>
        </Stat>
      ) : (
        <Stat label="Left to spend today">unknown</Stat>
      )}
    </>
  );
}

interface ActivityProps {
  requests: PaymentRequest[];
  metadataFor: (token: string) => FtMetadata | null;
  nowNs: bigint;
}

function RowStatus({ request, nowNs }: { request: PaymentRequest; nowNs: bigint }) {
  return isLapsed(request, nowNs) ? <Badge tone="neutral">Expired</Badge> : <StatusBadge status={request.status} />;
}

function Note({ request }: { request: PaymentRequest }) {
  return request.reason ? <span className="block text-xs text-zinc-500">for &ldquo;{request.reason}&rdquo;</span> : null;
}

function OpenLink({ request }: { request: PaymentRequest }) {
  const link = useLink();
  return (
    <a
      href={link(requestLink(request.request_id))}
      aria-label={`Open ${request.request_id}`}
      className="text-sm font-medium whitespace-nowrap text-ink underline decoration-zinc-300 underline-offset-4 hover:decoration-brand"
    >
      Open
    </a>
  );
}

/** Phones: one card per request, since a table does not fit. */
function ActivityList({ requests, metadataFor, nowNs }: ActivityProps) {
  return (
    <ul className="space-y-2 sm:hidden" data-testid="activity-list">
      {requests.map((r) => (
        <li key={r.request_id} className="rounded-xl border border-line p-4">
          <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
            <RowStatus request={r} nowNs={nowNs} />
            <span>{formatUtc(r.created_at_ns)}</span>
          </div>
          <p className="mt-2 text-sm">
            <span className="font-semibold">{formatAmount(r.amount, metadataFor(r.token))}</span> to <Mono>{r.recipient}</Mono>
            <Note request={r} />
          </p>
          <p className="mt-2 text-sm text-zinc-600">{outcomeLine(r, nowNs)}</p>
          <div className="mt-2 text-right">
            <OpenLink request={r} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ActivityTable({ requests, metadataFor, nowNs }: ActivityProps) {
  return (
    <div className="-mx-6 hidden overflow-x-auto sm:block">
      <table className="w-full min-w-[44rem] text-left text-sm" data-testid="activity">
        <thead className="text-xs text-zinc-500">
          <tr className="border-b border-line">
            <th className="px-6 py-2 font-medium">When (UTC)</th>
            <th className="px-2 py-2 font-medium">Payment</th>
            <th className="px-2 py-2 font-medium">Result</th>
            <th className="px-2 py-2 font-medium">Why</th>
            <th className="px-6 py-2 font-medium">
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.request_id} className="border-b border-zinc-50 align-top" data-request={r.request_id}>
              <td className="px-6 py-3 whitespace-nowrap text-zinc-600">{formatUtc(r.created_at_ns).replace(" UTC", "")}</td>
              <td className="px-2 py-3">
                <span className="font-semibold">{formatAmount(r.amount, metadataFor(r.token))}</span> to <Mono>{r.recipient}</Mono>
                <Note request={r} />
              </td>
              <td className="px-2 py-3">
                <RowStatus request={r} nowNs={nowNs} />
              </td>
              <td className="px-2 py-3 text-zinc-600">{outcomeLine(r, nowNs)}</td>
              <td className="px-6 py-3 text-right">
                <OpenLink request={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The vault's owner view: money, what waits for them, what the agent did, and the rules. Read only. */
export function Dashboard({ config }: { config: AppConfig }) {
  const link = useLink();
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [older, setOlder] = useState<PaymentRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshot(await loadDashboard(config, PAGE));
      setOlder([]);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (error && !snapshot) {
    return (
      <Notice tone="bad" title="Could not read the vault right now">
        <p>{error}</p>
      </Notice>
    );
  }
  if (!snapshot) return <p className="text-sm text-zinc-500">Reading your vault…</p>;

  const { config: vault, policy, tokens, nowNs } = snapshot;
  const requests = [...snapshot.requests, ...older];
  const waiting = waitingForOwner(requests, nowNs);
  const metadataFor = (token: string) => tokens.find((t) => t.policy.token === token)?.metadata ?? null;
  const canLoadMore = requests.length < vault.request_count;
  const first = tokens[0];
  const fmtFirst = (units: string) => formatAmount(units, first?.metadata ?? null);

  const loadMore = async () => {
    try {
      setOlder([...older, ...(await listRequests(config, requests.length, PAGE))]);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="space-y-10" data-testid="dashboard">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 font-display text-3xl font-bold tracking-tight">
            Your vault
            <span data-testid="vault-state">{vault.paused ? <Badge tone="bad">Paused</Badge> : <Badge tone="good">Active</Badge>}</span>
          </h1>
          <p className="mt-1 text-sm text-zinc-600">What your agent has spent, and what is waiting for you. Updates every {REFRESH_MS / 1000} seconds.</p>
        </div>
        <Button variant="secondary" onClick={() => void refresh()} disabled={loading} testId="refresh">
          {loading ? "Reading…" : "Refresh"}
        </Button>
      </div>

      {error ? (
        <Notice tone="bad" title="The last update failed, so this is the previous reading">
          <p>{error}</p>
        </Notice>
      ) : null}
      {vault.vault_id !== config.vaultId || vault.network !== config.network ? (
        <Notice tone="bad" title="This data is for a different vault or network">
          <p>
            Expected <Mono>{config.vaultId}</Mono> on {config.network}, got <Mono>{vault.vault_id}</Mono> on {vault.network}. Do not trust these numbers.
          </p>
        </Notice>
      ) : null}
      {vault.paused ? (
        <Notice tone="warn" title="The vault is paused">
          <p>It will not accept or pay anything until the owner unpauses it.</p>
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tokens.map((t) => (
          <MoneyStats key={t.policy.token} token={t} nowNs={nowNs} />
        ))}
        <Stat label="Waiting for your OK" testId="waiting-count" foot={`At most ${policy.max_open_approvals} can wait at once.`}>
          {waiting.length}
        </Stat>
      </div>

      <section className="space-y-4" aria-label="Waiting for your OK">
        <SectionHeading title="Waiting for your OK" />
        {waiting.length === 0 ? (
          <Card>
            <p className="text-sm text-zinc-600">
              Nothing is waiting for you.
              {first ? ` Payments up to ${fmtFirst(first.policy.auto_limit)} are paid without asking.` : ""}
            </p>
          </Card>
        ) : (
          <ul className="space-y-2" data-testid="pending-list">
            {waiting.map((r) => (
              <li key={r.request_id}>
                <a
                  href={link(requestLink(r.request_id))}
                  className="group flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-surface p-5 transition duration-300 ease-fluid hover:border-brand/40 focus-visible:outline-2 focus-visible:outline-brand"
                >
                  <span className="min-w-0">
                    <span className="block text-base">
                      <span className="font-semibold">{formatAmount(r.amount, metadataFor(r.token))}</span> to <Mono>{r.recipient}</Mono>
                    </span>
                    {r.reason ? <span className="mt-0.5 block text-sm text-zinc-600">for &ldquo;{r.reason}&rdquo;</span> : null}
                    <span className="mt-1 block text-xs text-zinc-500">
                      Expires {formatRelative(Number((BigInt(r.expires_at_ns) - nowNs) / 1_000_000_000n))} · <Mono>{r.request_id}</Mono>
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white transition duration-300 ease-fluid group-hover:bg-brand-strong">
                    Review
                    <ArrowRight size={14} weight="bold" aria-hidden="true" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4" aria-label="What your agent did">
        <SectionHeading title="What your agent did">
          {requests.length < vault.request_count ? `Newest ${requests.length} of ${vault.request_count}` : "Newest first"}
        </SectionHeading>
        <Card>
          {requests.length === 0 ? (
            <p className="text-sm text-zinc-600">Your agent has not asked for anything yet.</p>
          ) : (
            <>
              <ActivityTable requests={requests} metadataFor={metadataFor} nowNs={nowNs} />
              <ActivityList requests={requests} metadataFor={metadataFor} nowNs={nowNs} />
            </>
          )}
          {canLoadMore ? (
            <div className="mt-4">
              <Button variant="secondary" onClick={() => void loadMore()} testId="load-more">
                Show older payments
              </Button>
            </div>
          ) : null}
          <p className="mt-4 text-xs leading-relaxed text-zinc-500">Refused requests are never saved, so they do not show up here.</p>
        </Card>
      </section>

      <section className="space-y-4" aria-label="Your rules">
        <SectionHeading title="Your rules" />
        <Card>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {tokens.map((t) => {
              const fmt = (units: string) => formatAmount(units, t.metadata);
              return (
                <Fragment key={t.policy.token}>
                  <div>
                    <dt className="text-zinc-500">Paid instantly</dt>
                    <dd className="mt-0.5 font-semibold">up to {fmt(t.policy.auto_limit)}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Needs your OK</dt>
                    <dd className="mt-0.5 font-semibold">
                      over {fmt(t.policy.auto_limit)}, up to {fmt(t.policy.hard_tx_limit)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Most it can spend in a day</dt>
                    <dd className="mt-0.5 font-semibold">{fmt(t.policy.daily_limit)}</dd>
                  </div>
                </Fragment>
              );
            })}
            <div>
              <dt className="text-zinc-500">It can only pay</dt>
              <dd className="mt-0.5 space-y-0.5" data-testid="recipients">
                {policy.recipients.map((r) => (
                  <div key={r}>
                    <Mono>{r}</Mono>
                  </div>
                ))}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Requests that wait for you expire after</dt>
              <dd className="mt-0.5 font-semibold">{Math.round(policy.approval_ttl_sec / 60)} min</dd>
            </div>
            <div>
              <dt className="text-zinc-500">Most requests per day</dt>
              <dd className="mt-0.5 font-semibold">{policy.max_requests_per_day}</dd>
            </div>
          </dl>
        </Card>
      </section>

      <section className="space-y-4" aria-label="Who is who">
        <SectionHeading title="Who is who" />
        <Card>
          <dl className="grid grid-cols-1 gap-5 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-zinc-500">Owner: approves, rejects, pauses and changes the rules</dt>
              <dd className="mt-0.5">
                <AccountLink config={config} account={vault.owner} />
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">Agent: can only ask the vault to pay</dt>
              <dd className="mt-0.5 space-y-0.5">
                {vault.agents.map((a) => (
                  <div key={a}>
                    <AccountLink config={config} account={a} />
                  </div>
                ))}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">The vault itself</dt>
              <dd className="mt-0.5">
                <AccountLink config={config} account={vault.vault_id} />
              </dd>
            </div>
          </dl>
          <p className="mt-5 border-t border-line pt-4 text-xs text-zinc-500">
            Rules version {vault.policy_version} · {vault.request_count} requests saved · read at {formatUtc(nowNs.toString())}
          </p>
        </Card>
      </section>

      <p className="text-xs leading-relaxed text-zinc-500">
        Everything here is read straight from the NEAR blockchain. A bad connection could show wrong numbers, but it cannot move money: only the
        vault&apos;s own rules decide what is paid. Source: <Mono>{config.rpcUrl}</Mono>
      </p>
    </div>
  );
}
