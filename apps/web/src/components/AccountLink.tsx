import { addressExplorerLink } from "@spact/intents";
import type { PaymentRequest } from "@spact/shared";

import { explorerAccountLink, type AppConfig } from "../config.js";
import { Mono } from "./ui.js";

const LINK = "underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-600";

/** A NEAR account id, linked to the network's explorer (nearblocks) when it has one. */
export function AccountLink({ config, account, testId }: { config: Pick<AppConfig, "explorerAccountUrl">; account: string; testId?: string }) {
  const href = explorerAccountLink(config, account);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer noopener" className={LINK} data-testid={testId}>
      <Mono>{account}</Mono>
    </a>
  ) : (
    <Mono>{account}</Mono>
  );
}

/** An address on a 1Click destination chain, linked to that chain's explorer when the site knows it. */
export function DestinationAddress({ chain, address }: { chain: string; address: string }) {
  const href = addressExplorerLink(chain, address);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer noopener" className={LINK}>
      <Mono>{address}</Mono>
    </a>
  ) : (
    <Mono>{address}</Mono>
  );
}

/**
 * Who a payment is for: the payee on NEAR, or the final recipient of a 1Click route, each linked. `plain` drops the
 * explorer links, for places that are themselves a link (a link inside a link is invalid HTML).
 */
export function Payee({ config, request, plain = false }: { config: Pick<AppConfig, "explorerAccountUrl">; request: PaymentRequest; plain?: boolean }) {
  const t = request.cross_chain;
  if (plain) {
    return t ? (
      <span>
        <Mono>{t.destination_recipient}</Mono> on {t.destination_chain} via 1Click
      </span>
    ) : (
      <Mono>{request.recipient}</Mono>
    );
  }
  return t ? (
    <span>
      <DestinationAddress chain={t.destination_chain} address={t.destination_recipient} /> on {t.destination_chain} via 1Click
    </span>
  ) : (
    <AccountLink config={config} account={request.recipient} />
  );
}
