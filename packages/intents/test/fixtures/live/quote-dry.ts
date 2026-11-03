/**
 * LIVE 1Click response, recorded 2026-11-03 by the owner with curl against https://1click.chaindefuser.com
 * (no API key or JWT). Verbatim body; nothing secret in it.
 *
 * POST /v0/quote with liveRequest(true, "vault.0xileri.near") -> HTTP 201
 * A dry quote: no deposit address, no deadline in `quote`. 1Click added `confidentiality`,
 * `quoteWaitingTimeMs`, `insured` and an `appFees` entry to its echo of the request, none of which were sent.
 */
export const status = 201;
export const body = {"quote":{"amountIn":"1000000","amountInFormatted":"1.0","amountInUsd":"0.999335000000","minAmountIn":"1000000","amountOut":"989801","amountOutFormatted":"0.989801","amountOutUsd":"0.989142782335","minAmountOut":"979902","timeEstimate":17,"refundFee":"0","withdrawFee":"10007"},"quoteRequest":{"dry":true,"depositMode":"SIMPLE","swapType":"EXACT_INPUT","slippageTolerance":100,"originAsset":"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","depositType":"ORIGIN_CHAIN","destinationAsset":"nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near","amount":"1000000","refundTo":"vault.0xileri.near","refundType":"ORIGIN_CHAIN","recipient":"7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV","recipientType":"DESTINATION_CHAIN","deadline":"2026-11-03T12:49:50.000Z","confidentiality":"public","quoteWaitingTimeMs":0,"insured":false,"appFees":[{"recipient":"5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd","fee":1}]},"signature":"ed25519:eoeCffm94Uc3Z6wymY9q2BB9A7EKtBKAQ5TgTeZcHBR3N6ouDRxT7c7cabWqn3vR35VZu2ojRzZBsktBBu3D4MT","timestamp":"2026-11-03T10:51:07.175Z","correlationId":"5bd9bb9d-9b71-4471-9cbf-5e695d148812"};
