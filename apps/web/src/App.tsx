import { ArrowUpRight, CaretDown, GithubLogo } from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { accountId as accountIdSchema, viewAccessKeyList, viewAccount } from "@spact/shared";

import { ApprovalPage } from "./components/ApprovalPage.js";
import { Logo, MarkTile } from "./components/Brand.js";
import { CrossChainPage } from "./components/CrossChainPage.js";
import { Dashboard } from "./components/Dashboard.js";
import { Landing } from "./components/Landing.js";
import { Legal } from "./components/Legal.js";
import { Manage } from "./components/owner/Manage.js";
import { NewVault } from "./components/owner/NewVault.js";
import { SecurityLab } from "./components/SecurityLab.js";
import { Badge, Button, Mono, Notice } from "./components/ui.js";
import { networksOf, type AppConfig, type NetworkId, type SiteConfig } from "./config.js";
import { buildForCodeHash, lockProblem, type VaultBuild } from "./contracts.js";
import { errorMessage } from "./format.js";
import { LinkContext, NETWORK_LABEL, placeLink, placeOf, switchHref, useLink } from "./network.js";
import { createSigner } from "./signers/index.js";
import { useSigner } from "./useSigner.js";

const NETWORK_BADGE: Record<NetworkId, { tone: "neutral" | "warn" | "bad"; label: string }> = {
  sandbox: { tone: "neutral", label: "Local sandbox" },
  testnet: { tone: "warn", label: "Testnet" },
  mainnet: { tone: "bad", label: "Mainnet: real funds" },
};

function NoVault() {
  const link = useLink();
  return (
    <Notice tone="info" title="No vault is connected to this site yet">
      <p>
        The dashboard and the approval page read one vault contract on chain, and this site was built without one. The Security Lab works: it shows the
        test results for the commit this site was built from.
      </p>
      <p className="mt-2">
        <a href={link("?page=security")} className="font-medium underline">
          Open the Security Lab
        </a>
      </p>
    </Notice>
  );
}

function FooterLink({ href, children, external = false }: { href: string; children: ReactNode; external?: boolean }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 text-zinc-600 transition-colors duration-300 ease-fluid hover:text-ink"
      {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
    >
      {children}
      {external ? <ArrowUpRight size={12} aria-hidden="true" /> : null}
    </a>
  );
}

function SiteFooter({ config }: { config: SiteConfig }) {
  const link = useLink();
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-8 px-6 py-12 text-sm">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-3 text-zinc-600">Autonomous spending. Human rules. A budget for your AI agent, enforced on NEAR.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-3">
          <FooterLink href={link("?page=overview")}>Dashboard</FooterLink>
          {config.vaultId !== null ? <FooterLink href={link("?page=manage")}>Manage</FooterLink> : null}
          {config.vaultId !== null ? <FooterLink href={link("?page=new-vault")}>Create a vault</FooterLink> : null}
          <FooterLink href={link("?page=security")}>Security Lab</FooterLink>
          {config.repoUrl ? (
            <FooterLink href={config.repoUrl} external>
              Source code
            </FooterLink>
          ) : null}
          <FooterLink href={link("?page=legal")}>Privacy and terms</FooterLink>
        </nav>
      </div>
      <p className="mx-auto max-w-6xl px-6 pb-8 text-xs leading-relaxed text-zinc-500">
        SpactVault is an unaudited hackathon prototype.{" "}
        {config.network === "mainnet" ? "It runs on NEAR mainnet with real funds: keep amounts small." : "Use test tokens only."} This page never holds keys:
        your wallet signs, and the vault contract enforces the rules.
      </p>
    </footer>
  );
}

/** Moves the whole site to another network: a fresh page load, so no state from the old one carries over. */
function NetworkSwitch({ current, networks }: { current: NetworkId; networks: NetworkId[] }) {
  const [main] = networks;
  return (
    <label className="relative flex items-center">
      <span className="sr-only">Network</span>
      <span aria-hidden="true" className={`pointer-events-none absolute left-2 h-2 w-2 rounded-full ${current === "mainnet" ? "bg-brand" : "bg-zinc-400"}`} />
      <select
        value={current}
        onChange={(e) => main && window.location.assign(switchHref(window.location.search, e.target.value as NetworkId, main))}
        className="cursor-pointer appearance-none rounded-full border border-line bg-surface py-1 pr-6 pl-5 text-sm font-medium text-ink transition-colors duration-300 ease-fluid hover:border-zinc-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        data-testid="network-switch"
      >
        {networks.map((n) => (
          <option key={n} value={n}>
            {NETWORK_LABEL[n]}
          </option>
        ))}
      </select>
      <CaretDown size={12} weight="bold" aria-hidden="true" className="pointer-events-none absolute right-2 text-zinc-500" />
    </label>
  );
}

function vaultsOn(configs: SiteConfig[], network: NetworkId): AppConfig[] {
  return configs.filter((c): c is AppConfig => c.network === network && c.vaultId !== null);
}

/** A picker is worth showing when this network lists several vaults, or the page shows one it does not list. */
function needsPicker(configs: SiteConfig[], current: AppConfig): boolean {
  const here = vaultsOn(configs, current.network);
  return here.length > 1 || !here.some((c) => c.vaultId === current.vaultId);
}

/** The vaults this build lists on the current network, to move between them. */
function VaultPicker({ configs, current }: { configs: SiteConfig[]; current: AppConfig }) {
  const here = vaultsOn(configs, current.network);
  const listed = here.some((c) => c.vaultId === current.vaultId);
  const go = (vaultId: string) => {
    const params = new URLSearchParams(window.location.search);
    params.delete("request");
    params.set("vault", vaultId);
    window.location.assign(`./?${params.toString()}`);
  };
  return (
    <label className="inline-flex items-center gap-1">
      <span className="sr-only">Vault</span>
      <select
        value={current.vaultId}
        onChange={(e) => go(e.target.value)}
        className="rounded-full border border-line bg-surface px-2 py-0.5 font-mono text-xs text-ink"
        data-testid="vault-picker"
      >
        {listed ? null : <option value={current.vaultId}>{current.vaultId} (not listed)</option>}
        {here.map((c) => (
          <option key={c.vaultId} value={c.vaultId}>
            {c.vaultId}
            {c.vaultLabel ? ` · ${c.vaultLabel}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

const OWNER_PAGES = [
  { page: "overview", label: "Dashboard" },
  { page: "manage", label: "Manage" },
  { page: "crosschain", label: "Cross-chain" },
  { page: "new-vault", label: "New vault" },
] as const;

function OwnerTabs({ page }: { page: string | null }) {
  const link = useLink();
  return (
    <nav aria-label="Owner pages" className="mb-8 flex flex-wrap gap-1 border-b border-line pb-3 text-sm" data-testid="owner-tabs">
      {OWNER_PAGES.map((p) => (
        <a
          key={p.page}
          href={link(`?page=${p.page}`)}
          aria-current={page === p.page ? "page" : undefined}
          className={`rounded-full px-3 py-1 transition-colors duration-300 ease-fluid ${page === p.page ? "bg-zinc-100 font-medium text-ink" : "text-zinc-600 hover:text-ink"}`}
        >
          {p.label}
        </a>
      ))}
    </nav>
  );
}

type UnlistedCheck = { state: "checking" } | { state: "ok"; build: VaultBuild } | { state: "refused"; why: string };

/**
 * A `vault=` that this build does not list: shown only if it runs a SpactVault build this site knows and
 * has no access keys, so nobody can swap its code later (ADR-033). Anything else is refused as before.
 */
function useUnlistedVault(config: SiteConfig, vaultId: string | null): UnlistedCheck | null {
  const [check, setCheck] = useState<UnlistedCheck | null>(null);
  useEffect(() => {
    if (vaultId === null) {
      setCheck(null);
      return;
    }
    if (!accountIdSchema.safeParse(vaultId).success) {
      setCheck({ state: "refused", why: "It is not a NEAR account id." });
      return;
    }
    let alive = true;
    setCheck({ state: "checking" });
    void (async () => {
      try {
        const account = await viewAccount(config.rpcUrl, vaultId);
        if (!account) return alive && setCheck({ state: "refused", why: `There is no account ${vaultId} on ${NETWORK_LABEL[config.network]}.` });
        const build = buildForCodeHash(account.codeHash);
        if (!build) return alive && setCheck({ state: "refused", why: `Its code (hash ${account.codeHash}) is not a SpactVault build this site knows.` });
        const keys = await viewAccessKeyList(config.rpcUrl, vaultId);
        const locked = lockProblem(keys, vaultId);
        if (locked) return alive && setCheck({ state: "refused", why: locked });
        if (alive) setCheck({ state: "ok", build });
      } catch (e) {
        if (alive) setCheck({ state: "refused", why: `Could not check it: ${errorMessage(e)}` });
      }
    })();
    return () => {
      alive = false;
    };
  }, [config.rpcUrl, config.network, vaultId]);
  return check;
}

export function App({ config: chosen, configs = [chosen] }: { config: SiteConfig; configs?: SiteConfig[] }) {
  const networks = networksOf(configs);
  const params = new URLSearchParams(window.location.search);
  const requestId = params.get("request");
  const linkVault = params.get("vault");
  const page = params.get("page");
  const unlistedId = chosen.vaultId !== null && linkVault !== null && linkVault !== chosen.vaultId ? linkVault : null;
  const unlisted = useUnlistedVault(chosen, unlistedId);
  // the vault this page shows: the chosen config, or an unlisted vault that passed the check above
  const unlistedOk = unlisted?.state === "ok";
  const config: SiteConfig = useMemo(
    () => (unlistedOk && unlistedId ? { ...chosen, vaultId: unlistedId, vaultLabel: null } : chosen),
    [chosen, unlistedOk, unlistedId],
  );
  const link = useMemo(() => {
    const place = placeOf(configs, config.network, config.vaultId);
    return (href: string) => placeLink(href, place);
  }, [configs, config.network, config.vaultId]);
  const signer = useMemo(() => (chosen.vaultId === null ? null : createSigner(chosen)), [chosen]);
  const wallet = useSigner(signer);
  const badge = NETWORK_BADGE[config.network];
  const onSecurityLab = page === "security" && !requestId;
  const onDashboard = page === "overview" && !requestId;
  const onLegal = page === "legal" && !requestId;
  const onManage = page === "manage" && !requestId;
  const onNewVault = page === "new-vault" && !requestId;
  const onCrossChain = page === "crosschain" && !requestId;
  const onOwnerPage = onDashboard || onManage || onNewVault || onCrossChain;
  const onHome = !requestId && !onSecurityLab && !onLegal && !onOwnerPage;
  const foreignVault = unlistedId !== null && unlisted?.state !== "ok";
  const landing = onHome && !foreignVault;
  const navClass = (active: boolean) =>
    `rounded-full px-2 py-1 transition-colors duration-300 ease-fluid sm:px-3 ${active ? "bg-zinc-100 font-medium text-ink" : "text-zinc-600 hover:text-ink"}`;

  const walletControls =
    config.vaultId === null ? null : signer === null ? (
      <span className="text-xs text-zinc-500">No signer configured</span>
    ) : wallet.accountId ? (
      <>
        <Mono className="text-sm">{wallet.accountId}</Mono>
        <Button onClick={() => void wallet.disconnect()} variant="secondary" disabled={wallet.busy}>
          Disconnect
        </Button>
      </>
    ) : (
      <Button onClick={() => void wallet.connect()} variant="secondary" disabled={wallet.busy} testId="connect">
        {wallet.busy ? "Connecting…" : `Connect ${signer.label}`}
      </Button>
    );

  let content: ReactNode;
  if (onLegal) {
    content = <Legal config={config} />;
  } else if (config.vaultId === null) {
    content = onSecurityLab ? <SecurityLab reportUrl={config.securityReportUrl} /> : onHome ? <Landing config={config} /> : <NoVault />;
  } else if (foreignVault) {
    content =
      unlisted?.state === "checking" || unlisted === null ? (
        <p className="text-sm text-zinc-500" data-testid="unlisted-checking">
          Checking <Mono>{linkVault}</Mono>…
        </p>
      ) : (
        <Notice tone="bad" title="This link is for a different vault">
          <p>
            The link names <Mono>{linkVault}</Mono>, which is not one of this site&apos;s vaults, and it does not pass the check for other vaults.{" "}
            {unlisted.state === "refused" ? unlisted.why : null} Nothing was loaded.
          </p>
        </Notice>
      );
  } else if (onSecurityLab) {
    content = <SecurityLab reportUrl={config.securityReportUrl} />;
  } else if (requestId) {
    content = <ApprovalPage config={config} requestId={requestId} signer={signer} wallet={wallet} />;
  } else if (onDashboard) {
    content = <Dashboard config={config} />;
  } else if (onManage) {
    content = <Manage config={config} signer={signer} wallet={wallet} />;
  } else if (onNewVault) {
    content = <NewVault config={config} signer={signer} wallet={wallet} />;
  } else if (onCrossChain) {
    content = <CrossChainPage config={config} signer={signer} wallet={wallet} />;
  } else {
    content = <Landing config={config} />;
  }

  return (
    <LinkContext.Provider value={link}>
      <div className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only z-50 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
        >
          Skip to content
        </a>

        <header className="pointer-events-none sticky top-0 z-40 px-4 pt-6">
          <nav
            aria-label="Pages"
            className="pointer-events-auto mx-auto flex w-max max-w-full items-center gap-1 rounded-full border border-line bg-paper/80 py-2 pr-2 pl-3 text-sm shadow-lg shadow-zinc-900/5 backdrop-blur-xl sm:gap-4 sm:pl-4"
          >
            <a href={link("./")} aria-label="SpactVault home" aria-current={onHome ? "page" : undefined} className="mr-2 flex items-center">
              <span className="flex sm:hidden">
                <MarkTile />
              </span>
              <span className="hidden sm:inline-flex">
                <Logo />
              </span>
            </a>
            <a href={link("?page=overview")} className={navClass(onDashboard)} aria-current={onDashboard ? "page" : undefined}>
              Dashboard
            </a>
            <a href={link("?page=security")} className={navClass(onSecurityLab)} aria-current={onSecurityLab ? "page" : undefined}>
              <span className="sm:hidden">Security</span>
              <span className="hidden sm:inline">Security Lab</span>
            </a>
            {config.repoUrl ? (
              <a
                href={config.repoUrl}
                target="_blank"
                rel="noreferrer noopener"
                aria-label="GitHub repository"
                className="hidden h-8 w-8 items-center justify-center rounded-full text-zinc-600 sm:flex transition-colors duration-300 ease-fluid hover:bg-zinc-100 hover:text-ink"
              >
                <GithubLogo size={18} aria-hidden="true" />
              </a>
            ) : null}
            {networks.length > 1 ? <NetworkSwitch current={config.network} networks={networks} /> : null}
          </nav>
        </header>

        <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
          {wallet.error ? (
            <div className="mx-auto mt-6 max-w-5xl px-6">
              <Notice tone="bad" title="Wallet error">
                {wallet.error}
              </Notice>
            </div>
          ) : null}
          {landing ? (
            content
          ) : (
            <div className={`mx-auto px-6 pt-8 ${requestId ? "max-w-2xl" : "max-w-5xl"}`}>
              {onLegal ? null : (
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500" data-testid="environment">
                    {config.vaultId === null ? (
                      <Badge tone="neutral">No vault connected</Badge>
                    ) : (
                      <>
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                        {!foreignVault && needsPicker(configs, config) ? (
                          <VaultPicker configs={configs} current={config} />
                        ) : (
                          <span className="inline-flex flex-wrap items-center gap-1">
                            vault <Mono>{config.vaultId}</Mono>
                            {config.vaultLabel ? <span>({config.vaultLabel})</span> : null}
                          </span>
                        )}
                        {unlisted?.state === "ok" ? (
                          <span data-testid="unlisted-vault" title={`Code hash ${unlisted.build.codeHash}`}>
                            <Badge tone="info">not listed by this site · verified {unlisted.build.id.toUpperCase()} code, locked</Badge>
                          </span>
                        ) : null}
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2" data-testid="wallet">
                    {walletControls}
                  </div>
                </div>
              )}
              {onOwnerPage && config.vaultId !== null && !foreignVault ? <OwnerTabs page={page} /> : null}
              {content}
            </div>
          )}
        </main>

        <SiteFooter config={config} />
      </div>
    </LinkContext.Provider>
  );
}
