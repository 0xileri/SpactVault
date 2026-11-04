import { explorerAccountLink, type AppConfig } from "../config.js";
import { Mono } from "./ui.js";

/** A NEAR account id, linked to the network's explorer (nearblocks) when it has one. */
export function AccountLink({ config, account, testId }: { config: Pick<AppConfig, "explorerAccountUrl">; account: string; testId?: string }) {
  const href = explorerAccountLink(config, account);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer noopener" className="underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-600" data-testid={testId}>
      <Mono>{account}</Mono>
    </a>
  ) : (
    <Mono>{account}</Mono>
  );
}
