/**
 * LIVE 1Click response, recorded 2026-11-03 by the owner with curl against https://1click.chaindefuser.com
 * (no API key or JWT). Verbatim body; nothing secret in it.
 *
 * POST /v0/quote with liveRequest(false, "vault.0xileri.near") -> HTTP 201
 * A real quote with a deposit address on NEAR (a 64-hex implicit account). Nothing was deposited to it,
 * and nothing should be: it stays active until 2026-11-06T12:49:50Z and refunds to vault.0xileri.near.
 * Note `quote.deadline` is three days after the requested `deadline` (`quoteRequest.deadline`).
 */
export const status = 201;
export const body = {"quote":{"amountIn":"1000000","amountInFormatted":"1.0","amountInUsd":"0.999321000000","minAmountIn":"1000000","amountOut":"989827","amountOutFormatted":"0.989827","amountOutUsd":"0.989154907467","minAmountOut":"979928","timeEstimate":17,"refundFee":"0","withdrawFee":"9981","deadline":"2026-11-06T12:49:50.000Z","timeWhenInactive":"2026-11-06T12:49:50.000Z","depositAddress":"041951e133e32d3ab1fc32f2df4d1ea201c689c8736895fd239fb0f68e2087bc"},"quoteRequest":{"dry":false,"depositMode":"SIMPLE","swapType":"EXACT_INPUT","slippageTolerance":100,"originAsset":"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","depositType":"ORIGIN_CHAIN","destinationAsset":"nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near","amount":"1000000","refundTo":"vault.0xileri.near","refundType":"ORIGIN_CHAIN","recipient":"7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV","recipientType":"DESTINATION_CHAIN","deadline":"2026-11-03T12:49:50.000Z","confidentiality":"public","quoteWaitingTimeMs":0,"insured":false,"appFees":[{"recipient":"5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd","fee":1,"limitOrderId":null}]},"signature":"ed25519:63YNGHRojw3274KuirVR752uz5EhAmW8asaCdkNLbpwN7UoN5pLoAjbwmLQM7kp3nfUdRxuMytxCP5emufjzahgZ","timestamp":"2026-11-03T10:54:16.072Z","correlationId":"95558989-469e-4637-8007-213d2e32938a"};
