/**
 * The quote request the owner sent to the live 1Click API on 2026-11-03, with curl from their own machine
 * (no API key or JWT). It is exactly what `buildQuoteRequest` builds for these values; only `dry` and
 * `refundTo` differ between the recorded calls. Source: the owner's terminal output, pasted into the session.
 */
export const LIVE = {
  baseUrl: "https://1click.chaindefuser.com",
  recordedOn: "2026-11-03",
  /** Native USDC on NEAR (Circle), the vault's token on mainnet. */
  usdc: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  /** USDC on Solana as 1Click's own token list names it (`jq` on the live GET /v0/tokens). */
  solUsdc: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
  /** A placeholder Solana address. Nothing was ever deposited, so nothing went to it. */
  recipient: "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV",
  deadline: "2026-11-03T12:49:50.000Z",
} as const;

export function liveRequest(dry: boolean, refundTo: string) {
  return {
    dry,
    depositMode: "SIMPLE",
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: `nep141:${LIVE.usdc}`,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: LIVE.solUsdc,
    amount: "1000000",
    refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: LIVE.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: LIVE.deadline,
  } as const;
}
