import type { ReactNode } from "react";

import type { SiteConfig } from "../config.js";
import { Card, PageHeader } from "./ui.js";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="sm:p-8">
      <h2 className="text-xl font-semibold text-ink">{title}</h2>
      <ul className="mt-4 list-disc space-y-3 pl-5 text-base leading-relaxed text-zinc-700 marker:text-brand/50">{children}</ul>
    </Card>
  );
}

/** Plain statements of what this site does with data, and what it promises. Not a legal opinion. */
export function Legal({ config }: { config: SiteConfig }) {
  const rpcHost = new URL(config.rpcUrl).host;
  return (
    <article className="mx-auto max-w-3xl space-y-6 pb-12" data-testid="legal">
      <PageHeader eyebrow="Plain words · not a legal opinion" title="Privacy and terms" lede="What this site does with your data, and what it does not promise." />
      <Section title="Privacy">
        <li>This site sets no cookies and runs no analytics or tracking scripts.</li>
        <li>
          Your browser reads the vault straight from a NEAR RPC endpoint ({rpcHost}) and loads the Security Lab report. Those services see your IP
          address, as any website would. The host serving this page keeps ordinary request logs.
        </li>
        <li>
          When you connect a wallet, the wallet selector loads wallet code from third parties, such as raw.githubusercontent.com and the
          wallet&apos;s own servers, and may remember the connection in your browser&apos;s storage.
        </li>
        <li>SpactVault never sees your keys. Your wallet signs; this page only hands it a transaction to show you.</li>
      </Section>
      <Section title="Terms">
        <li>SpactVault is an unaudited hackathon prototype, provided as is, without warranty of any kind.</li>
        <li>
          {config.network === "mainnet"
            ? "This deployment is on NEAR mainnet, where tokens have real value. Use only small amounts you can afford to lose."
            : `This deployment runs on ${config.network === "testnet" ? "NEAR testnet" : "a local NEAR sandbox"} with test tokens that have no value. Do not use it with real funds.`}
        </li>
        <li>Approvals you sign are transactions on a public blockchain. They are final, and anyone can read them.</li>
        {config.repoUrl ? (
          <li>
            The source code is public at{" "}
            <a href={config.repoUrl} className="underline underline-offset-2 hover:text-ink" target="_blank" rel="noreferrer noopener">
              {config.repoUrl.replace(/^https:\/\//, "")}
            </a>
            .
          </li>
        ) : null}
      </Section>
    </article>
  );
}
