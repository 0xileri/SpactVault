/**
 * LIVE 1Click response, recorded 2026-11-04 (after 12:47 UTC) by the owner with curl against
 * https://1click.chaindefuser.com (no API key or JWT). Verbatim body; nothing secret.
 *
 * GET /v0/status?depositAddress=afaef961…c886b0 -> HTTP 200
 * The first real deposit: vault 9dc744… paid 1 USDC to this deposit address with a plain ft_transfer
 * (NEAR tx H6AjpNU5…, the owner's approve_request + execute_request), and 1Click delivered 0.997398 USDC to
 * the owner's address on Base (tx 0x679696f9…9b31). `quoteResponse` is 1Click's signed copy of the quote the
 * agent's MCP server filed (request xc-mainnet-1, NEAR tx EHup5SHo…).
 */
export const DEPOSIT = "afaef9616107eb4b0bee5f666b5cbd3f05517f24fbb5034b0f3add6f89c886b0";
/** What the vault stored for request xc-mainnet-1 (the MCP tool's and get_payment_status's output). */
export const STORED = {
  request_id: "xc-mainnet-1",
  agent_id: "agent2.0xileri.near",
  vault: "9dc744e29f8a079c6888dbdaafa8fb618b08c3734d00f4f25c8b31050ea086c9",
  quote_hash: "200659799700d8da9c3a8c71b895776a75cbb2e97db05e0f9420cde6c584edbc",
  min_amount_out: "987424",
  quote_deadline: "2026-11-04T14:38:03.000Z",
  request_tx: "EHup5SHoUkjPacSVKjNSEukj7oSZJAcpoD2WoY5JWR53",
  payment_tx: "H6AjpNU5m8zdVFqE6TAE5uvQx4SVCT3ToYMBg8sstj8f",
  base_tx: "0x679696f968b4083dcbca8556e9f64550788c004f8722cb14ddd38e18551b9b31",
} as const;

export const status = 200;
export const body = {"status":"SUCCESS","updatedAt":"2026-11-04T12:47:13.000Z","correlationId":"2c9ed0a0-dc38-4d70-bc64-fbb18547003a","swapDetails":{"depositedAmount":"1000000","depositedAmountUsd":"0.999465000000","depositedAmountFormatted":"1.0","intentHashes":["3tAiaBMkTHm1gL1qvy7U95rapLqSoNzfFMpBKQ1Rbzks","87utFgXg2hnXkw9ZTJvTZ64BkcP3zqp3iQ1pXdn4efKy"],"nearTxHashes":["9AYSQHyPj9s838UvGFXkhfdnRCqruiYsFGfBFhjosoKY","FYTUvXP2zxg5KawBQf4DRMa1Sbe6QcaX3hKh417Uqkfn","619izDYvr1QB2wpBag6L1PtnanjJ9T7WWPPMCsQw8rRs","6hPCoWUFZ5qYCMbiGXeoMbUyUF6CNFANFJ7zyjRJJdpj"],"amountIn":"1000000","amountInFormatted":"1.0","amountInUsd":"0.999465000000","amountOut":"997398","amountOutFormatted":"0.997398","amountOutUsd":"0.996864392070","slippage":0,"refundedAmount":"0","refundedAmountFormatted":"0","refundedAmountUsd":"0","refundReason":null,"refundFee":"0","withdrawFee":"2400","originChainTxHashes":[{"hash":"H6AjpNU5m8zdVFqE6TAE5uvQx4SVCT3ToYMBg8sstj8f","explorerUrl":""}],"destinationChainTxHashes":[{"hash":"0x679696f968b4083dcbca8556e9f64550788c004f8722cb14ddd38e18551b9b31","explorerUrl":""}]},"quoteResponse":{"timestamp":"2026-11-04T12:38:03.781Z","signature":"ed25519:rQZqdPVVL8huLS3MoiDYdx2LeUEDTTMCpTY1pbwRihV45CL1o5iHKUcDvDHwsDT24tSEVVvwTZGJ2oEZmMcPeSH","quoteRequest":{"dry":false,"swapType":"EXACT_INPUT","depositMode":"SIMPLE","slippageTolerance":100,"originAsset":"nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","depositType":"ORIGIN_CHAIN","destinationAsset":"nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near","amount":"1000000","refundTo":"9dc744e29f8a079c6888dbdaafa8fb618b08c3734d00f4f25c8b31050ea086c9","refundType":"ORIGIN_CHAIN","recipient":"0xdF8ec3262A4ED45fa024805B2305F0e5FE73b938","recipientType":"DESTINATION_CHAIN","deadline":"2026-11-04T14:38:03.000Z","appFees":[{"limitOrderId":null,"recipient":"5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd","fee":1}],"virtualChainRecipient":null,"virtualChainRefundRecipient":null,"referral":null,"confidentiality":"public"},"quote":{"amountIn":"1000000","amountInFormatted":"1.0","amountInUsd":"0.999482000000","minAmountIn":"1000000","amountOut":"997398","amountOutFormatted":"0.997398","amountOutUsd":"0.996881347836","minAmountOut":"987424","timeWhenInactive":"2026-11-07T14:38:03.000Z","depositAddress":"afaef9616107eb4b0bee5f666b5cbd3f05517f24fbb5034b0f3add6f89c886b0","deadline":"2026-11-07T14:38:03.000Z","timeEstimate":22,"refundFee":"0","withdrawFee":"2400"}}};
