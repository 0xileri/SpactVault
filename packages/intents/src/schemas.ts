import { ACCOUNT_ID_RE, CHAIN_RE, EXTERNAL_ID_RE } from "@spact/shared";
import { z } from "zod";

/**
 * 1Click API shapes, as far as SpactVault uses them.
 *
 * Source: the generated types of `@defuse-protocol/one-click-sdk-typescript` 0.1.26 (published
 * 2026-09-22, read 2026-11-02), which the SDK builds from the API's OpenAPI spec. The docs site and
 * the API host were unreachable from the build environment, so nothing here was checked against a
 * live response (docs/INTEGRATIONS.md). Everything the API returns is untrusted until parsed here;
 * unknown extra fields are allowed so a new API version does not break parsing, but every field the
 * vault depends on is checked.
 */

const uintString = z.string().regex(/^(0|[1-9]\d*)$/, "not a canonical integer string");
const isoTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "not an ISO timestamp");

export const STATUSES = [
  "KNOWN_DEPOSIT_TX",
  "PENDING_DEPOSIT",
  "INCOMPLETE_DEPOSIT",
  "PROCESSING",
  "SUCCESS",
  "REFUNDED",
  "FAILED",
] as const;
export type OneClickStatus = (typeof STATUSES)[number];

/** `GET /v0/tokens` items. */
export const tokenSchema = z
  .object({
    assetId: z.string().regex(EXTERNAL_ID_RE, "invalid asset id"),
    decimals: z.number().int().min(0).max(36),
    blockchain: z.string().regex(CHAIN_RE, "invalid chain name"),
    symbol: z.string().min(1).max(32),
    contractAddress: z.string().max(128).optional(),
  })
  .loose();
export type OneClickToken = z.infer<typeof tokenSchema>;
export const tokenListSchema = z.array(tokenSchema).max(5000);

/** The `POST /v0/quote` body SpactVault sends. Only the fields it sets; the API defines more. */
export interface QuoteRequest {
  dry: boolean;
  depositMode: "SIMPLE";
  swapType: "EXACT_INPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  deadline: string;
}

export const quoteRequestEchoSchema = z
  .object({
    dry: z.boolean(),
    swapType: z.string(),
    slippageTolerance: z.number(),
    originAsset: z.string(),
    depositType: z.string(),
    destinationAsset: z.string(),
    amount: z.string(),
    refundTo: z.string(),
    refundType: z.string(),
    recipient: z.string(),
    recipientType: z.string(),
    deadline: z.string(),
  })
  .loose();

/** `POST /v0/quote` response. `depositAddress` and `deadline` are absent from dry quotes. */
export const quoteResponseSchema = z
  .object({
    timestamp: isoTime,
    signature: z.string().min(1).max(1024),
    quoteRequest: quoteRequestEchoSchema,
    quote: z
      .object({
        depositAddress: z.string().max(128).optional(),
        depositMemo: z.string().max(256).optional(),
        amountIn: uintString,
        minAmountIn: uintString.optional(),
        amountOut: uintString,
        minAmountOut: uintString,
        deadline: isoTime.optional(),
        timeWhenInactive: isoTime.optional(),
        timeEstimate: z.number().nonnegative().optional(),
      })
      .loose(),
  })
  .loose();
export type QuoteResponse = z.infer<typeof quoteResponseSchema>;

/** `GET /v0/status?depositAddress=...` response. Every value in it is 1Click's report, not chain state. */
export const statusResponseSchema = z
  .object({
    status: z.enum(STATUSES),
    updatedAt: isoTime,
    quoteResponse: quoteResponseSchema,
    swapDetails: z
      .object({
        nearTxHashes: z.array(z.string().max(128)).max(64).optional(),
        refundedAmount: uintString.optional(),
        depositedAmount: uintString.optional(),
        amountOut: uintString.optional(),
      })
      .loose()
      .optional(),
  })
  .loose();
export type StatusResponse = z.infer<typeof statusResponseSchema>;

export const nearAccountId = z.string().min(2).max(64).regex(ACCOUNT_ID_RE, "invalid NEAR account id");
