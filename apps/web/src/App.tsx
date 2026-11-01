import { ArrowUpRight, GithubLogo } from "@phosphor-icons/react";
import { useMemo, type ReactNode } from "react";

import { ApprovalPage } from "./components/ApprovalPage.js";
import { Logo, MarkTile } from "./components/Brand.js";
import { Dashboard } from "./components/Dashboard.js";
import { Landing } from "./components/Landing.js";
import { Legal } from "./components/Legal.js";
import { SecurityLab } from "./components/SecurityLab.js";
import { Badge, Button, Mono, Notice } from "./components/ui.js";
import type { NetworkId, SiteConfig } from "./config.js";
import { createSigner } from "./signers/index.js";
import { useSigner } from "./useSigner.js";

const NETWORK_BADGE: Record<NetworkId, { tone: "neutral" | "warn" | "bad"; label: string }> = {
  sandbox: { tone: "neutral", label: "Local sandbox" },
  testnet: { tone: "warn", label: "Testnet" },
  mainnet: { tone: "bad", label: "Mainnet: real funds" },
};

function NoVault() {
  return (
    <Notice tone="info" title="No vault is connected to this site yet">
      <p>
        The dashboard and the approval page read one vault contract on chain, and this site was built without one. The Security Lab works: it shows the
        test results for the commit this site was built from.
      </p>
      <p className="mt-2">
        <a href="?page=security" className="font-medium underline">
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
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-8 px-6 py-12 text-sm">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-3 text-zinc-600">Autonomous spending. Human rules. A spending firewall for AI agents on NEAR.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-3">
          <FooterLink href="?page=overview">Dashboard</FooterLink>
          <FooterLink href="?page=security">Security Lab</FooterLink>
          {config.repoUrl ? (
            <FooterLink href={config.repoUrl} external>
              Source code
            </FooterLink>
          ) : null}
          <FooterLink href="?page=legal">Privacy and terms</FooterLink>
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

export function App({ config }: { config: SiteConfig }) {
  const signer = useMemo(() => (config.vaultId === null ? null : createSigner(config)), [config]);
  const wallet = useSigner(signer);
  const params = new URLSearchParams(window.location.search);
  const requestId = params.get("request");
  const linkVault = params.get("vault");
  const badge = NETWORK_BADGE[config.network];
  const page = params.get("page");
  const onSecurityLab = page === "security" && !requestId;
  const onDashboard = page === "overview" && !requestId;
  const onLegal = page === "legal" && !requestId;
  const onHome = !requestId && !onSecurityLab && !onDashboard && !onLegal;
  const foreignVault = config.vaultId !== null && linkVault !== null && linkVault !== config.vaultId;
  const landing = onHome && !foreignVault;
  const navClass = (active: boolean) =>
    `rounded-full px-3 py-1 transition-colors duration-300 ease-fluid ${active ? "bg-zinc-100 font-medium text-ink" : "text-zinc-600 hover:text-ink"}`;

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
    content = (
      <Notice tone="bad" title="This link is for a different vault">
        <p>
          The link names <Mono>{linkVault}</Mono>, but this page only approves payments for <Mono>{config.vaultId}</Mono>. Nothing was loaded.
        </p>
      </Notice>
    );
  } else if (onSecurityLab) {
    content = <SecurityLab reportUrl={config.securityReportUrl} />;
  } else if (requestId) {
    content = <ApprovalPage config={config} requestId={requestId} signer={signer} wallet={wallet} />;
  } else if (onDashboard) {
    content = <Dashboard config={config} />;
  } else {
    content = <Landing config={config} />;
  }

  return (
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
          className="pointer-events-auto mx-auto flex w-max max-w-full items-center gap-2 rounded-full border border-line bg-paper/80 py-2 pr-2 pl-4 text-sm shadow-lg shadow-zinc-900/5 backdrop-blur-xl sm:gap-4"
        >
          <a href="./" aria-label="SpactVault home" aria-current={onHome ? "page" : undefined} className="mr-2 flex items-center">
            <span className="flex sm:hidden">
              <MarkTile />
            </span>
            <span className="hidden sm:inline-flex">
              <Logo />
            </span>
          </a>
          <a href="?page=overview" className={navClass(onDashboard)} aria-current={onDashboard ? "page" : undefined}>
            Dashboard
          </a>
          <a href="?page=security" className={navClass(onSecurityLab)} aria-current={onSecurityLab ? "page" : undefined}>
            Security Lab
          </a>
          {config.repoUrl ? (
            <a
              href={config.repoUrl}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="GitHub repository"
              className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-600 transition-colors duration-300 ease-fluid hover:bg-zinc-100 hover:text-ink"
            >
              <GithubLogo size={18} aria-hidden="true" />
            </a>
          ) : null}
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
                      <span>
                        vault <Mono>{config.vaultId}</Mono>
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2" data-testid="wallet">
                  {walletControls}
                </div>
              </div>
            )}
            {content}
          </div>
        )}
      </main>

      <SiteFooter config={config} />
    </div>
  );
}
