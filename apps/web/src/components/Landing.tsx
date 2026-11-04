import { ArrowRight, ArrowUpRight, CheckCircle, Clock, Globe, Prohibit, ShieldCheck } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";

import { explorerAccountLink, type AppConfig, type SiteConfig } from "../config.js";
import { usedPercent } from "../dashboard.js";
import { errorMessage, formatAmount } from "../format.js";
import { exampleAmounts, GENERIC_AMOUNTS, GENERIC_RULES, liveCounts, outcomeRules, type OutcomeRules } from "../landing.js";
import { loadDashboard, type DashboardSnapshot } from "../near/vault.js";
import { useLink } from "../network.js";
import { loadSecurityReport, type LoadResult } from "../securityLab.js";
import { SignalDot, type Signal } from "./Brand.js";
import { Reveal } from "./Motion.js";
import { RequestFeed } from "./RequestFeed.js";
import { Mono, Notice } from "./ui.js";

/**
 * The front page (ADR-037): one thing to do, said once. A hero with a single button (Create your vault),
 * then four short sections, each on its own color band: the three answers a payment can get, the live vault,
 * the cross-chain route, and the same button again with the Security Lab as the one proof link.
 */

/** Newest requests read for the live counts. */
const READ = 50;

const NETWORK_NAME = { sandbox: "a local NEAR sandbox", testnet: "NEAR testnet", mainnet: "NEAR mainnet" } as const;

type Live = { kind: "none" } | { kind: "loading" } | { kind: "ok"; snapshot: DashboardSnapshot } | { kind: "error"; message: string };

function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-6xl px-6 ${className}`}>{children}</div>;
}

/** The page's one action: a large violet button with an arrow that moves on hover. */
function CreateButton({ href, tone = "brand" }: { href: string; tone?: "brand" | "light" }) {
  const look =
    tone === "brand"
      ? "bg-brand text-white shadow-lg shadow-brand/30 hover:bg-brand-strong"
      : "bg-white text-ink shadow-lg shadow-black/20 hover:bg-violet-50";
  return (
    <a
      href={href}
      className={`group inline-flex items-center gap-3 rounded-2xl px-6 py-4 text-lg font-semibold transition duration-300 ease-fluid hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:translate-y-px ${look}`}
      data-testid="create-vault-cta"
    >
      Create your vault
      <ArrowRight size={20} weight="bold" aria-hidden="true" className="transition-transform duration-300 ease-fluid group-hover:translate-x-1" />
    </a>
  );
}

function SectionTitle({ label, title, id, children, invert = false }: { label: string; title: string; id: string; children?: ReactNode; invert?: boolean }) {
  return (
    <div className="max-w-2xl">
      <p className={`font-mono text-xs tracking-wide uppercase ${invert ? "text-violet-200" : "text-zinc-500"}`}>{label}</p>
      <h2 id={id} className={`mt-3 text-3xl leading-tight font-bold tracking-tight sm:text-4xl ${invert ? "text-white" : "text-ink"}`}>
        {title}
      </h2>
      {children ? <div className={`mt-4 text-base leading-relaxed ${invert ? "text-violet-100" : "text-zinc-600"}`}>{children}</div> : null}
    </div>
  );
}

const OUTCOMES: { signal: Signal; title: string; key: keyof OutcomeRules; after: string; icon: typeof CheckCircle; tint: string }[] = [
  { signal: "paid", title: "Paid at once", key: "paid", after: "Nobody has to click anything.", icon: CheckCircle, tint: "bg-paid/15 text-emerald-700" },
  {
    signal: "waits",
    title: "Waits for your OK",
    key: "waits",
    after: "You get a link, check who gets what, and approve in your wallet.",
    icon: Clock,
    tint: "bg-waits/15 text-amber-700",
  },
  { signal: "blocked", title: "Refused", key: "blocked", after: "Nothing is sent. The agent cannot argue with it.", icon: Prohibit, tint: "bg-blocked/15 text-rose-700" },
];

function Answers({ rules, live }: { rules: OutcomeRules; live: boolean }) {
  return (
    <section className="band band-lilac py-24" aria-labelledby="answers-title">
      <Container>
        <Reveal>
          <SectionTitle label="How it decides" title="Every payment gets one of three answers" id="answers-title">
            <p>
              Your agent asks the vault to pay. The vault checks your limits on the NEAR blockchain, where nobody can skip them, not even the agent.
              {live ? " These are the live vault's limits." : ""}
            </p>
          </SectionTitle>
        </Reveal>
        <ul className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3" data-testid="outcomes">
          {OUTCOMES.map((o, i) => (
            <li key={o.signal} data-outcome={o.signal}>
              <Reveal delay={i * 120} className="h-full">
                <div className="lift h-full rounded-3xl border border-white/70 bg-white/80 p-6 shadow-sm shadow-violet-900/5 backdrop-blur">
                  <p className="flex items-center gap-3 text-base font-semibold text-ink">
                    <span className={`grid h-10 w-10 place-items-center rounded-2xl ${o.tint}`}>
                      <o.icon size={22} weight="bold" aria-hidden="true" />
                    </span>
                    {o.title}
                  </p>
                  <p className="mt-5 text-xl font-semibold text-ink" data-testid={`rule-${o.signal}`}>
                    {rules[o.key]}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-600">{o.after}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

function Stat({ label, children, testId }: { label: string; children: ReactNode; testId: string }) {
  return (
    <div className="lift h-full rounded-3xl border border-white/70 bg-white/80 p-6 shadow-sm shadow-emerald-900/5 backdrop-blur">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl" data-testid={testId}>
        {children}
      </div>
    </div>
  );
}

function StatSkeleton() {
  return (
    <div className="rounded-3xl border border-white/70 bg-white/70 p-6" aria-hidden="true">
      <div className="h-3 w-20 animate-pulse rounded bg-zinc-200/70" />
      <div className="mt-4 h-8 w-28 animate-pulse rounded bg-zinc-200/70" />
    </div>
  );
}

/** Named accounts stay on one line; a 64-character implicit id may break anywhere. */
function idWrap(id: string): string {
  return id.length > 32 ? "break-all" : "whitespace-nowrap";
}

function ExternalLink({ href, children, testId }: { href: string; children: ReactNode; testId?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 font-medium text-ink underline decoration-zinc-300 underline-offset-4 transition-colors duration-300 ease-fluid hover:decoration-brand"
      data-testid={testId}
    >
      {children}
      <ArrowUpRight size={14} aria-hidden="true" />
    </a>
  );
}

function LiveProof({ config, live }: { config: AppConfig; live: Live }) {
  const link = useLink();
  const vaultLink = explorerAccountLink(config, config.vaultId);

  let body: ReactNode;
  if (live.kind === "error") {
    body = (
      <Notice tone="warn" title="Could not read the vault right now">
        <p>{live.message}</p>
      </Notice>
    );
  } else if (live.kind !== "ok") {
    body = (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Reading the vault from the chain">
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
      </div>
    );
  } else {
    const { snapshot } = live;
    const token = snapshot.tokens[0];
    const counts = liveCounts(snapshot.requests, snapshot.nowNs, snapshot.config.request_count);
    const budget = token?.budget && !token.budgetProblem ? token.budget : null;
    const stats: [string, string, ReactNode][] = [
      ["Money in the vault", "live-balance", token && token.balance !== null ? formatAmount(token.balance.toString(), token.metadata) : "unknown"],
      [
        "Spent today",
        "live-spent",
        budget && token ? (
          <>
            {formatAmount(budget.executed, token.metadata)}
            <span className="mt-1 block text-sm font-normal tracking-normal text-zinc-500">of {formatAmount(budget.daily_limit, token.metadata)}</span>
            <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-emerald-100" aria-hidden="true">
              <span className="grow-bar block h-full rounded-full bg-paid" style={{ width: `${usedPercent(budget)}%` }} />
            </span>
          </>
        ) : (
          "unknown"
        ),
      ],
      [counts.read < counts.stored ? `Payments made, of the last ${counts.read}` : "Payments made", "live-paid", counts.paid],
      ["Waiting for the owner", "live-waiting", counts.waiting],
    ];
    body = (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="live">
        {stats.map(([label, testId, value], i) => (
          <Reveal key={testId} delay={i * 100} className="h-full">
            <Stat label={label} testId={testId}>
              {value}
            </Stat>
          </Reveal>
        ))}
      </div>
    );
  }

  return (
    <section className="band band-mint py-24" aria-labelledby="live">
      <Container>
        <Reveal>
          <SectionTitle label="Live proof" title={`Real money, running now on ${NETWORK_NAME[config.network]}`} id="live">
            <p>
              Read straight from the blockchain when you opened this page. Vault{" "}
              {vaultLink ? (
                <a href={vaultLink} target="_blank" rel="noreferrer noopener" className="underline decoration-zinc-300 underline-offset-2 hover:decoration-brand">
                  <Mono className={idWrap(config.vaultId)}>{config.vaultId}</Mono>
                </a>
              ) : (
                <Mono className={idWrap(config.vaultId)}>{config.vaultId}</Mono>
              )}
              .
            </p>
          </SectionTitle>
        </Reveal>
        <div className="mt-12">{body}</div>
        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
          <a
            href={link("?page=overview")}
            className="inline-flex items-center gap-1 font-semibold text-ink underline decoration-zinc-300 underline-offset-4 transition-colors duration-300 ease-fluid hover:decoration-brand"
          >
            Open the dashboard
            <ArrowRight size={14} weight="bold" aria-hidden="true" />
          </a>
          {vaultLink ? (
            <ExternalLink href={vaultLink} testId="live-explorer">
              Every transaction on nearblocks
            </ExternalLink>
          ) : null}
        </div>
      </Container>
    </section>
  );
}

function CrossChain() {
  const link = useLink();
  const chains = ["Solana", "Base", "Ethereum", "Arbitrum"];
  return (
    <section className="band band-sky py-24" aria-labelledby="crosschain-title">
      <Container className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
        <Reveal>
          <SectionTitle label="Cross-chain" title="Pay on other chains, with the same rules" id="crosschain-title">
            <p>
              The vault can pay a recipient on Solana or Base through NEAR Intents. 1Click prices the swap, the vault holds the request, and nothing
              leaves until you approve it in your wallet.
            </p>
          </SectionTitle>
          <a
            href={link("?page=crosschain")}
            className="mt-8 inline-flex items-center gap-1 font-semibold text-ink underline decoration-zinc-300 underline-offset-4 transition-colors duration-300 ease-fluid hover:decoration-brand"
          >
            See a cross-chain price
            <ArrowRight size={14} weight="bold" aria-hidden="true" />
          </a>
        </Reveal>
        <Reveal delay={150}>
          <div className="relative mx-auto flex h-56 w-full max-w-sm items-center justify-center" aria-hidden="true">
            <span className="orbit absolute h-48 w-48 rounded-full border border-sky-300/60" />
            <span className="orbit orbit-slow absolute h-56 w-56 rounded-full border border-dashed border-sky-300/50" />
            <span className="grid h-20 w-20 place-items-center rounded-3xl bg-white text-sky-700 shadow-lg shadow-sky-900/10">
              <Globe size={36} weight="duotone" />
            </span>
            {chains.map((c, i) => (
              <span
                key={c}
                className="absolute rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-ink shadow-sm"
                style={{ transform: `rotate(${i * 90 - 45}deg) translateY(-6.5rem) rotate(${-(i * 90 - 45)}deg)` }}
              >
                {c}
              </span>
            ))}
          </div>
        </Reveal>
      </Container>
    </section>
  );
}

const START: string[] = ["Create the vault and set your limits", "Add a little USDC", "Give your agent its key"];

function FinalCall({ config, lab }: { config: SiteConfig; lab: LoadResult | null }) {
  const link = useLink();
  const view = lab?.kind === "ok" ? lab.view : null;
  const passed = view ? view.counts.PASSED_ON_CHAIN + view.counts.PASSED_UNIT_ONLY : null;
  return (
    <section className="band band-ink py-24 text-white" aria-labelledby="start-title">
      <Container>
        <Reveal>
          <SectionTitle label="Start" title="Set your agent's budget in three steps" id="start-title" invert>
            <p>All from this site, with your NEAR wallet. Mainnet uses real money, so start small.</p>
          </SectionTitle>
        </Reveal>
        <ol className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3" data-testid="start-steps">
          {START.map((s, i) => (
            <li key={s}>
              <Reveal delay={i * 120} className="h-full">
                <div className="lift flex h-full items-center gap-4 rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-sm font-bold text-ink">{i + 1}</span>
                  <span className="font-medium">{s}</span>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
        <Reveal delay={300}>
          <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-6">
            {config.vaultId !== null ? <CreateButton href={link("?page=new-vault")} tone="light" /> : null}
            {passed !== null && view ? (
              <p className="flex items-center gap-2 text-sm text-violet-100" data-testid="lab-proof">
                <ShieldCheck size={18} weight="duotone" aria-hidden="true" />
                <span>
                  <span className="font-semibold text-white">{passed} attacks</span> tested {view.report.source.kind === "ci" ? "on every code change" : "in the last local run"}.
                </span>
                <a href={link("?page=security")} className="font-semibold text-white underline decoration-white/40 underline-offset-4 hover:decoration-white">
                  See the Security Lab
                </a>
              </p>
            ) : null}
          </div>
        </Reveal>
      </Container>
    </section>
  );
}

function NoVaultNote() {
  const link = useLink();
  return (
    <section className="band band-mint py-24" aria-labelledby="live">
      <Container>
        <SectionTitle label="Live proof" title="No vault on this site yet" id="live" />
        <div className="mt-8 max-w-2xl">
          <Notice tone="info" title="No vault is connected to this site yet">
            <p>
              There is nothing live to show here. The{" "}
              <a href={link("?page=security")} className="font-medium underline">
                Security Lab
              </a>{" "}
              works: it shows the test results for this build.
            </p>
          </Notice>
        </div>
      </Container>
    </section>
  );
}

export function Landing({ config }: { config: SiteConfig }) {
  const link = useLink();
  const vaultConfig = config.vaultId === null ? null : config;
  const [live, setLive] = useState<Live>(vaultConfig ? { kind: "loading" } : { kind: "none" });
  const [lab, setLab] = useState<LoadResult | null>(null);

  useEffect(() => {
    if (!vaultConfig) return;
    let cancelled = false;
    loadDashboard(vaultConfig, READ).then(
      (snapshot) => !cancelled && setLive({ kind: "ok", snapshot }),
      (e: unknown) => !cancelled && setLive({ kind: "error", message: errorMessage(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [vaultConfig]);

  useEffect(() => {
    void loadSecurityReport(config.securityReportUrl).then(setLab);
  }, [config.securityReportUrl]);

  const token = live.kind === "ok" ? live.snapshot.tokens[0] : undefined;
  const rules = token ? outcomeRules(token.policy, token.metadata) : GENERIC_RULES;
  const example = token ? exampleAmounts(token.policy, token.metadata) : GENERIC_AMOUNTS;
  const source = !example.example && vaultConfig ? "Example amounts, using this vault's real limits." : "Example amounts and limits. Every owner picks their own.";

  return (
    <div data-testid="landing">
      <section className="band band-hero relative overflow-hidden" aria-labelledby="hero-title">
        <div className="aurora-field" aria-hidden="true">
          <span className="aurora aurora-a" />
          <span className="aurora aurora-b" />
        </div>
        <Container className="relative grid grid-cols-1 items-center gap-12 pt-36 pb-20 sm:pt-44 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:pb-28">
          <div>
            <p className="rise inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/70 px-3 py-1 text-xs font-medium text-zinc-700 backdrop-blur">
              <SignalDot signal={vaultConfig ? "paid" : "waits"} className="pulse-dot h-2 w-2" />
              {vaultConfig ? `Live on ${NETWORK_NAME[vaultConfig.network]}` : "Unaudited hackathon prototype"}
            </p>
            <h1
              id="hero-title"
              className="rise rise-1 mt-6 max-w-2xl bg-linear-to-r from-ink via-ink to-brand bg-clip-text pb-1 text-4xl leading-[1.05] font-bold tracking-tight text-transparent sm:text-6xl"
            >
              Give your AI agent a budget, not your wallet.
            </h1>
            <p className="rise rise-2 mt-6 max-w-xl text-lg leading-relaxed text-zinc-700">
              A vault on NEAR holds a little money for your agent. Small payments go through, bigger ones wait for your OK, and anything over your limit
              is refused.
            </p>
            <div className="rise rise-3 mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
              {vaultConfig ? (
                <CreateButton href={link("?page=new-vault")} />
              ) : (
                <a href={link("?page=security")} className="font-semibold text-ink underline underline-offset-4">
                  See the Security Lab
                </a>
              )}
              {vaultConfig ? (
                <a
                  href={link("?page=overview")}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-700 underline decoration-zinc-300 underline-offset-4 transition-colors duration-300 ease-fluid hover:text-ink hover:decoration-brand"
                >
                  or see the live vault
                </a>
              ) : null}
            </div>
            {vaultConfig ? <p className="rise rise-3 mt-4 text-sm text-zinc-600">Works with any NEAR wallet, such as Meteor. About two minutes.</p> : null}
          </div>
          <div className="rise rise-2">
            <RequestFeed example={example} source={source} />
          </div>
        </Container>
      </section>

      <Answers rules={rules} live={Boolean(token && vaultConfig)} />
      {vaultConfig ? <LiveProof config={vaultConfig} live={live} /> : <NoVaultNote />}
      {vaultConfig ? <CrossChain /> : null}
      <FinalCall config={config} lab={lab} />
    </div>
  );
}
