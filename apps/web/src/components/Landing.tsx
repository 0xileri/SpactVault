import { ArrowDown, ArrowRight, CheckCircle, Clock, Prohibit } from "@phosphor-icons/react";
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

/** Newest requests read for the live counts. */
const READ = 50;

const NETWORK_NAME = { sandbox: "a local NEAR sandbox", testnet: "NEAR testnet", mainnet: "NEAR mainnet" } as const;

type Live = { kind: "none" } | { kind: "loading" } | { kind: "ok"; snapshot: DashboardSnapshot } | { kind: "error"; message: string };

function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-6xl px-6 ${className}`}>{children}</div>;
}

/** The page's one primary action style: violet, semibold, with an arrow. */
function PrimaryLink({ href, children, down = false }: { href: string; children: ReactNode; down?: boolean }) {
  const Arrow = down ? ArrowDown : ArrowRight;
  return (
    <a
      href={href}
      className="group inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-base font-semibold text-white transition duration-300 ease-fluid hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:translate-y-px"
    >
      {children}
      <Arrow
        size={16}
        weight="bold"
        aria-hidden="true"
        className={`transition-transform duration-300 ease-fluid ${down ? "group-hover:translate-y-0.5" : "group-hover:translate-x-1"}`}
      />
    </a>
  );
}

/** Secondary actions are text links, not a second button. */
function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 text-base font-semibold text-ink underline decoration-zinc-300 underline-offset-4 transition-colors duration-300 ease-fluid hover:decoration-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {children}
    </a>
  );
}

function SectionTitle({ label, title, id, children }: { label: string; title: string; id: string; children?: ReactNode }) {
  return (
    <div className="max-w-2xl">
      <p className="font-mono text-xs text-zinc-500">{label}</p>
      <h2 id={id} className="mt-3 text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {children ? <div className="mt-4 text-base leading-relaxed text-zinc-600">{children}</div> : null}
    </div>
  );
}

const STEPS: { title: string; text: string }[] = [
  {
    title: "You fill the vault",
    text: "Put in a small amount of money and set your limits: what gets paid instantly, what needs your OK, and the most it can spend in a day.",
  },
  {
    title: "Your agent asks to pay",
    text: "When it needs to buy something, like an API call, it sends a request: how much, to whom and why. It can never touch the money itself.",
  },
  {
    title: "The vault checks your rules",
    text: "It pays, asks you to approve in your wallet, or refuses. The rules run on the NEAR blockchain, so nobody can skip them.",
  },
];

function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-28 py-24" aria-labelledby="how-title">
      <Container>
        <Reveal>
          <SectionTitle label="How it works" title="Your agent asks. The vault decides." id="how-title" />
        </Reveal>
        <ol className="mt-12 grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="steps">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <Reveal delay={i * 90} className="h-full">
                <div className="h-full rounded-2xl border border-line bg-surface p-6">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-ink text-sm font-semibold text-paper">{i + 1}</span>
                  <p className="mt-5 text-lg font-semibold text-ink">{step.title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-600">{step.text}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

const OUTCOMES: { signal: Signal; title: string; key: keyof OutcomeRules; after: string; icon: typeof CheckCircle; tint: string }[] = [
  { signal: "paid", title: "Paid instantly", key: "paid", after: "Nobody has to click anything.", icon: CheckCircle, tint: "bg-paid/10 text-emerald-700" },
  {
    signal: "waits",
    title: "Needs your OK",
    key: "waits",
    after: "You get a link, check the exact amount and who gets it, and approve in your wallet. If you don't, it expires.",
    icon: Clock,
    tint: "bg-waits/10 text-amber-700",
  },
  { signal: "blocked", title: "Refused", key: "blocked", after: "Nothing is sent and nothing is saved.", icon: Prohibit, tint: "bg-blocked/10 text-rose-700" },
];

function Outcomes({ rules, title, caption }: { rules: OutcomeRules; title: string; caption: string }) {
  return (
    <section className="pb-24" aria-labelledby="outcomes-title">
      <Container>
        <Reveal>
          <SectionTitle label="The rules" title={title} id="outcomes-title">
            <p>{caption}</p>
          </SectionTitle>
        </Reveal>
        <ul className="mt-12 grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="outcomes">
          {OUTCOMES.map((o, i) => (
            <li key={o.signal} data-outcome={o.signal}>
              <Reveal delay={i * 90} className="h-full">
                <div className="h-full rounded-2xl border border-line bg-surface p-6">
                  <p className="flex items-center gap-3 text-base font-semibold text-ink">
                    <span className={`grid h-9 w-9 place-items-center rounded-full ${o.tint}`}>
                      <o.icon size={20} weight="bold" aria-hidden="true" />
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
    <div className="h-full rounded-2xl border border-line bg-surface p-6">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <div className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl" data-testid={testId}>
        {children}
      </div>
    </div>
  );
}

function StatSkeleton() {
  return (
    <div className="rounded-2xl border border-line bg-surface p-6" aria-hidden="true">
      <div className="h-3 w-20 animate-pulse rounded bg-zinc-100" />
      <div className="mt-4 h-8 w-28 animate-pulse rounded bg-zinc-100" />
    </div>
  );
}

function LiveSection({ config, live }: { config: AppConfig; live: Live }) {
  const vaultLink = explorerAccountLink(config, config.vaultId);
  const link = useLink();

  let body: ReactNode;
  if (live.kind === "error") {
    body = (
      <Notice tone="warn" title="Could not read the vault right now">
        <p>{live.message}</p>
      </Notice>
    );
  } else if (live.kind !== "ok") {
    body = (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Reading the vault from the chain">
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
            <span className="mt-3 block h-1 overflow-hidden rounded-full bg-zinc-100" aria-hidden="true">
              <span className="block h-full rounded-full bg-paid" style={{ width: `${usedPercent(budget)}%` }} />
            </span>
          </>
        ) : (
          "unknown"
        ),
      ],
      [counts.read < counts.stored ? `Payments made, of the last ${counts.read}` : "Payments made", "live-paid", counts.paid],
      ["Waiting for your OK", "live-waiting", counts.waiting],
    ];
    body = (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="live">
        {stats.map(([label, testId, value], i) => (
          <Reveal key={testId} delay={i * 90} className="h-full">
            <Stat label={label} testId={testId}>
              {value}
            </Stat>
          </Reveal>
        ))}
      </div>
    );
  }

  return (
    <section className="pb-24" aria-labelledby="live">
      <Container>
        <Reveal>
          <SectionTitle label="Live vault" title={`Running now on ${NETWORK_NAME[config.network]}`} id="live">
            <p>
              These numbers come straight from the blockchain each time you open this page. Vault: <Mono>{config.vaultId}</Mono>.
            </p>
          </SectionTitle>
        </Reveal>
        <div className="mt-12">{body}</div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-xl text-xs text-zinc-500">
            Refused requests are never saved, so they don't show up here. Spending resets at midnight UTC.
            {vaultLink ? (
              <>
                {" "}
                <a href={vaultLink} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-ink">
                  See every transaction on the NEAR explorer
                </a>
                .
              </>
            ) : null}
          </p>
          <div className="flex flex-wrap gap-6">
            <TextLink href={link("?page=overview")}>Open the dashboard</TextLink>
            <TextLink href={link("?page=new-vault")}>Create your own vault</TextLink>
          </div>
        </div>
      </Container>
    </section>
  );
}

function NoVaultSection() {
  return (
    <section className="pb-24" aria-labelledby="live">
      <Container>
        <SectionTitle label="Live vault" title="No vault on this site yet" id="live" />
        <div className="mt-8">
          <Notice tone="info" title="No vault is connected to this site yet">
            <p>This build has no vault, so there is nothing live to show. The Security Lab works.</p>
          </Notice>
        </div>
      </Container>
    </section>
  );
}

function HeroProof({ lab }: { lab: LoadResult | null }) {
  const link = useLink();
  const view = lab?.kind === "ok" ? lab.view : null;
  if (!view) return null;
  const passed = view.counts.PASSED_ON_CHAIN + view.counts.PASSED_UNIT_ONLY;
  return (
    <p className="mt-10 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-6 text-sm text-zinc-600" data-testid="hero-proof">
      <SignalDot signal="paid" />
      <span>
        <span className="font-semibold text-ink">{passed} attacks</span> tested {view.report.source.kind === "ci" ? "automatically on every code change" : "in the last local run"}.
      </span>
      <a href={link("?page=security")} className="font-medium text-ink underline decoration-zinc-300 underline-offset-4 hover:decoration-brand">
        See the results
      </a>
    </p>
  );
}

/** The public front page: what SpactVault is, how it decides, and what the configured vault is doing. */
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
  const liveRules = Boolean(token && vaultConfig);
  const rulesTitle = liveRules ? "This vault's rules" : "Three possible answers";
  const caption = liveRules ? "Read live from the vault below. Every owner picks their own numbers." : "Every owner picks their own numbers.";
  const source = !example.example && vaultConfig ? "Example amounts, using this vault's real limits." : "Example amounts and limits. Every owner picks their own.";

  return (
    <div data-testid="landing">
      <section>
        <Container className="grid grid-cols-1 items-center gap-12 pt-16 pb-12 sm:pt-24 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-zinc-600">
              <SignalDot signal={vaultConfig ? "paid" : "waits"} className="h-2 w-2" />
              {vaultConfig ? `Live on ${NETWORK_NAME[vaultConfig.network]}` : "Unaudited hackathon prototype"}
            </p>
            <h1 className="mt-6 max-w-2xl bg-linear-to-r from-ink to-brand bg-clip-text pb-1 text-4xl leading-tight font-bold tracking-tight text-transparent sm:text-5xl">
              Give your AI agent a budget, not your wallet.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-600">
              SpactVault holds a small amount of money for your agent and checks every payment it asks to make. Small payments go through. Bigger ones
              wait for your OK. Anything over your limit is refused.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-6">
              <PrimaryLink href="#how" down>
                See how it works
              </PrimaryLink>
              {vaultConfig ? (
                <TextLink href={link("?page=overview")}>Open the dashboard</TextLink>
              ) : (
                <TextLink href={link("?page=security")}>See the Security Lab</TextLink>
              )}
            </div>
            <HeroProof lab={lab} />
          </div>
          <RequestFeed example={example} source={source} />
        </Container>
      </section>

      <HowItWorks />
      <Outcomes rules={rules} title={rulesTitle} caption={caption} />
      {vaultConfig ? <LiveSection config={vaultConfig} live={live} /> : <NoVaultSection />}
    </div>
  );
}
