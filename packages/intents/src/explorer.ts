/**
 * Explorer links for the transactions 1Click reports, built here from the chain name and the hash. The
 * `explorerUrl` 1Click sends along is never used: it is text from an outside service, and a link the owner
 * clicks must go where the page says it goes.
 */
const EVM_TX = /^0x[0-9a-fA-F]{64}$/;
const BASE58_TX = /^[1-9A-HJ-NP-Za-km-z]{32,90}$/;

const EXPLORERS: Record<string, { url: string; hash: RegExp; name: string }> = {
  near: { url: "https://nearblocks.io/txns/{hash}", hash: BASE58_TX, name: "NEAR" },
  sol: { url: "https://solscan.io/tx/{hash}", hash: BASE58_TX, name: "Solana" },
  base: { url: "https://basescan.org/tx/{hash}", hash: EVM_TX, name: "Base" },
  eth: { url: "https://etherscan.io/tx/{hash}", hash: EVM_TX, name: "Ethereum" },
  arb: { url: "https://arbiscan.io/tx/{hash}", hash: EVM_TX, name: "Arbitrum" },
  pol: { url: "https://polygonscan.com/tx/{hash}", hash: EVM_TX, name: "Polygon" },
  bsc: { url: "https://bscscan.com/tx/{hash}", hash: EVM_TX, name: "BNB Chain" },
  op: { url: "https://optimistic.etherscan.io/tx/{hash}", hash: EVM_TX, name: "Optimism" },
};

/** "Solana" for `sol`; the 1Click chain name itself when this table does not know it. */
export function chainName(chain: string): string {
  return EXPLORERS[chain]?.name ?? chain;
}

/** A link to `hash` on `chain`'s explorer, or null for an unknown chain or a hash in the wrong format. */
export function txExplorerLink(chain: string, hash: string): string | null {
  const e = EXPLORERS[chain];
  if (!e || !e.hash.test(hash)) return null;
  return e.url.replace("{hash}", hash);
}
