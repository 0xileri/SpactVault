/**
 * LIVE 1Click response, recorded 2026-11-04 11:19 UTC by the owner with curl against
 * https://1click.chaindefuser.com (no API key or JWT), from their own machine. Verbatim body; nothing secret.
 *
 * POST /v0/quote with the request below -> HTTP 201
 * A dry quote for the mainnet run: 1 native USDC on NEAR to USDC on Base, refunding to the run's vault
 * (9dc744…, created from the website on 2026-11-04) and paying the owner's Base address. Nothing was
 * deposited for it. Unlike the 2026-11-03 quote to Solana, this one has a non-zero refundFee.
 */
export const VAULT = "9dc744e29f8a079c6888dbdaafa8fb618b08c3734d00f4f25c8b31050ea086c9";
export const BASE_RECIPIENT = "0xdF8ec3262A4ED45fa024805B2305F0e5FE73b938";

export const request = {
  dry: true,
  depositMode: "SIMPLE",
  swapType: "EXACT_INPUT",
  slippageTolerance: 100,
  originAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  depositType: "ORIGIN_CHAIN",
  destinationAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  amount: "1000000",
  refundTo: VAULT,
  refundType: "ORIGIN_CHAIN",
  recipient: BASE_RECIPIENT,
  recipientType: "DESTINATION_CHAIN",
  deadline: "2026-11-04T12:19:02.000Z",
} as const;

export const status = 201;
export const body = {"quote":{"amountIn":"1000000","amountInFormatted":"1.0","amountInUsd":"0.999478000000","minAmountIn":"1000000","amountOut":"997398","amountOutFormatted":"0.997398","amountOutUsd":"0.996877358244","minAmountOut":"987424","timeEstimate":22,"refundFee":"5128","withdrawFee":"2400"},"quoteRequest":{"dry":true,"depositMode":"SIMPLE","swapType":"EXACT_INPUT","slippageTolerance":100,"originAsset":"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","depositType":"ORIGIN_CHAIN","destinationAsset":"nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near","amount":"1000000","refundTo":"9dc744e29f8a079c6888dbdaafa8fb618b08c3734d00f4f25c8b31050ea086c9","refundType":"ORIGIN_CHAIN","recipient":"0xdF8ec3262A4ED45fa024805B2305F0e5FE73b938","recipientType":"DESTINATION_CHAIN","deadline":"2026-11-04T12:19:02.000Z","confidentiality":"public","quoteWaitingTimeMs":0,"insured":false,"appFees":[{"recipient":"5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd","fee":1}]},"signature":"ed25519:3ZwyKR7QS6RNKBmaMp8Y8YWPqrspgTAbo5s2oQSArLF1YGXSvTFTjEepJ2iB5djvT6jZJhWngG61HsVZb73uEUFA","timestamp":"2026-11-04T11:19:03.769Z","correlationId":"0f5b78cc-a998-48d2-ad5b-73cd5aadbdc9"};
