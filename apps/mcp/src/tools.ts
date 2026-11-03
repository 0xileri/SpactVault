import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { McpServer } from "@modelcontextprotocol/server";
import {
  buildQuoteRequest,
  crossChainArgs,
  findRoute,
  MAX_SLIPPAGE_BPS,
  QuoteError,
  reconcile,
  ONE_CLICK_MANAGER_PUBLIC_KEY,
  quoteResponseSchema,
  statusResponseSchema,
  verifyQuoteSignature,
  type OneClickApi,
} from "@spact/intents";
import { accountId, EXTERNAL_ID_RE, explainReason, type PaymentOutcome, type PaymentRequest, type Status } from "@spact/shared";
import { z } from "zod";

import { explorerTxLink, reviewLink, type McpConfig } from "./config.js";
import type { SubmitResult, VaultClient } from "./vault.js";

export const SERVER_NAME = "spact";
export const SERVER_VERSION = "0.1.0";

const U128_MAX = (1n << 128n) - 1n;
const STATUSES = [
  "BLOCKED",
  "AWAITING_APPROVAL",
  "APPROVED",
  "DENIED",
  "EXPIRED",
  "TRANSFER_PENDING",
  "SETTLED",
  "TRANSFER_FAILED",
  "CROSS_CHAIN_PENDING",
] as const satisfies readonly Status[];

// Same rules as is_valid_request_id / is_valid_reason in the vault. The vault checks them again;
// checking here gives a clear error without spending gas.
const requestId = z
  .string()
  .regex(/^[A-Za-z0-9._:-]{1,64}$/, "1-64 characters: letters, digits, '.', '_', '-' or ':'");
const amountUnits = z
  .string()
  .regex(/^[1-9]\d*$/, "a positive integer in the token's smallest unit, without leading zeros")
  .refine((s) => !/^[1-9]\d*$/.test(s) || BigInt(s) <= U128_MAX, "too large");
const reason = z
  .string()
  .refine((s) => new TextEncoder().encode(s).length <= 256, "at most 256 bytes")
  // eslint-disable-next-line no-control-regex
  .refine((s) => !/[\u0000-\u001f\u007f-\u009f]/.test(s), "no control characters");

export const requestPaymentInput = z.object({
  token: accountId.describe("NEP-141 token contract on the vault's allowlist"),
  amount_units: amountUnits.describe(
    'Amount in the token\'s smallest unit, as a string. With 6 decimals, 3 tokens is "3000000".',
  ),
  recipient: accountId.describe("NEAR account to pay. Must be on the vault's recipient allowlist."),
  reason: reason.describe("Why you are paying. The owner sees this text, word for word, when approving."),
  request_id: requestId.describe(
    "Your unique id for this payment. To retry, reuse the same id: the vault never pays one id twice. Never retry with a new id.",
  ),
});

const policyDecision = z.enum(["AUTO_APPROVED", "OWNER_APPROVAL_REQUIRED", "BLOCKED"]);
type PolicyDecision = z.infer<typeof policyDecision>;

export const requestPaymentOutput = z.object({
  request_id: z.string(),
  policy_decision: policyDecision,
  onchain_status: z.enum(STATUSES),
  reason_code: z.string(),
  explanation: z.string(),
  tx_hash: z.string(),
  review_url: z.string().optional(),
  explorer_url: z.string().optional(),
});
type RequestPaymentOutput = z.infer<typeof requestPaymentOutput>;

const externalId = z.string().regex(EXTERNAL_ID_RE, "1-128 characters: letters, digits, ':', '.', '_' or '-'");

export const requestCrossChainInput = z.object({
  token: accountId.describe("NEP-141 token on NEAR that leaves the vault, e.g. native USDC"),
  amount_units: amountUnits.describe("Amount of that token in its smallest unit, as a string. With 6 decimals, 1 USDC is \"1000000\"."),
  destination_asset: externalId.describe("1Click asset id of what the recipient gets, e.g. nep141:sol-...omft.near for USDC on Solana"),
  recipient: externalId.describe("Final recipient on the destination chain, in that chain's address format. Must be on the owner's allowlist for this route."),
  reason: reason.describe("Why you are paying. The owner sees this text, word for word, when approving."),
  request_id: requestId.describe("Your unique id for this payment. To retry, reuse the same id; never retry with a new id."),
  slippage_bps: z.number().int().min(0).max(MAX_SLIPPAGE_BPS).default(100).describe("Most slippage accepted, in basis points (100 = 1%)"),
  deadline_minutes: z
    .number()
    .int()
    .min(10)
    .max(24 * 60)
    .default(120)
    .describe("How long the 1Click quote stays valid. The owner must approve before it ends; the vault refuses it 60 s before."),
});

export const requestCrossChainOutput = requestPaymentOutput.extend({
  deposit_address: z.string(),
  destination_chain: z.string(),
  destination_recipient: z.string(),
  min_amount_out: z.string(),
  quote_deadline: z.string(),
  quote_hash: z.string(),
  /** App fees 1Click put in the quote, in basis points of the amount (live, it adds one unasked). */
  app_fee_bps: z.number().optional(),
});
type RequestCrossChainOutput = z.infer<typeof requestCrossChainOutput>;

const crossChainStatus = z.object({
  deposit_address: z.string(),
  destination_chain: z.string(),
  destination_asset: z.string(),
  destination_recipient: z.string(),
  min_amount_out: z.string(),
  /** 1Click's own report. Never proof, and never restores budget. */
  provider_status: z.string().optional(),
  provider_final: z.boolean().optional(),
  reported_refund_units: z.string().optional(),
  destination_tx_hashes: z.array(z.string()).optional(),
  note: z.string(),
});

export const getPaymentStatusOutput = z.object({
  request_id: z.string(),
  source_status: z.enum([...STATUSES, "NOT_FOUND"]),
  reason_code: z.string(),
  explanation: z.string(),
  token: z.string().optional(),
  amount_units: z.string().optional(),
  recipient: z.string().optional(),
  agent_id: z.string().optional(),
  approved_by: z.string().optional(),
  expires_at: z.string().optional(),
  /** An open request whose expiry has passed by chain time. It can no longer be approved or paid. */
  expired: z.boolean().optional(),
  updated_at: z.string().optional(),
  review_url: z.string().optional(),
  explorer_url: z.string().optional(),
  cross_chain: crossChainStatus.optional(),
});
type GetPaymentStatusOutput = z.infer<typeof getPaymentStatusOutput>;

export function policyDecisionOf(outcome: PaymentOutcome): PolicyDecision {
  if (outcome.status === "BLOCKED") return "BLOCKED";
  if (outcome.status === "AWAITING_APPROVAL") return "OWNER_APPROVAL_REQUIRED";
  return "AUTO_APPROVED";
}

function isoFromNs(ns: string): string {
  return new Date(Number(BigInt(ns) / 1_000_000n)).toISOString();
}

function text(summary: string, data: object) {
  return [{ type: "text" as const, text: `${summary}\n${JSON.stringify(data, null, 2)}` }];
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/** One JSON line per tool call on stderr (stdout carries the protocol). Never includes key material. */
function log(event: Record<string, unknown>) {
  console.error(JSON.stringify({ ts: new Date().toISOString(), ...event }));
}

/** Fixed sentences only: nothing here repeats text an outside party could have written. */
function summarize(out: RequestPaymentOutput, amount: string, token: string, recipient: string): string {
  switch (out.onchain_status) {
    case "SETTLED":
      return `Paid ${amount} units of ${token} to ${recipient} (request ${out.request_id}).`;
    case "AWAITING_APPROVAL":
      return `Not paid yet: request ${out.request_id} is waiting for the owner to approve it in their wallet${out.review_url ? ` (${out.review_url})` : ""}. Check later with get_payment_status.`;
    case "BLOCKED":
      return out.reason_code === "DUPLICATE_REQUEST"
        ? `A request with id ${out.request_id} already exists. Nothing new was paid. Use get_payment_status to see it.`
        : `Blocked by the vault policy (${out.reason_code}): ${out.explanation} Nothing was paid.`;
    case "TRANSFER_FAILED":
      return `The policy allowed request ${out.request_id}, but the token transfer failed. Nothing was paid.`;
    default:
      return `Request ${out.request_id} is ${out.onchain_status}. Check later with get_payment_status.`;
  }
}

export interface ServerDeps {
  vault: VaultClient;
  config: Pick<McpConfig, "network" | "vaultId" | "agentId" | "approvalUrl" | "explorerTxUrl"> & Partial<Pick<McpConfig, "quoteDir">>;
  /** The 1Click API for cross-chain requests: live (ENABLE_1CLICK_LIVE=true) or, in tests, MockOneClick. null: off. */
  oneClick?: OneClickApi | null;
  /** The clock for quote deadlines. Tests pin it. */
  now?: () => Date;
  /** The key 1Click signs quotes with. Tests pass a mock signer's key; nothing else should. */
  quoteSignerKey?: string;
}

/** Keeps the full quote (with 1Click's signature) next to the request: what to show if 1Click ever disputes it. */
function saveQuote(dir: string, requestId: string, record: unknown) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${requestId}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

function crossChainNote(request: PaymentRequest): string {
  switch (request.status) {
    case "AWAITING_APPROVAL":
      return "Waiting for the owner. Cross-chain payments always need the owner's approval.";
    case "CROSS_CHAIN_PENDING":
      return "The vault paid the 1Click deposit address. Delivery on the destination chain is 1Click's report, not the vault's; a reported refund does not restore budget.";
    default:
      return `The vault's status is ${request.status}.`;
  }
}

export function createSpactServer({ vault, config, oneClick = null, now = () => new Date(), quoteSignerKey = ONE_CLICK_MANAGER_PUBLIC_KEY }: ServerDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { maxToolInputElements: 100 });
  // tx hashes of requests this process submitted, for explorer links in get_payment_status
  const txHashes = new Map<string, string>();

  server.registerTool(
    "request_payment",
    {
      title: "Request a SpactVault payment",
      description:
        `Ask the SpactVault contract ${config.vaultId} on NEAR ${config.network} to pay an allowlisted recipient. ` +
        "The vault's on-chain policy decides: small payments are paid at once, larger ones wait for the owner to approve them in their wallet, and anything outside the policy is blocked. " +
        "This tool cannot change the policy, approve payments, or move funds any other way.",
      inputSchema: requestPaymentInput,
      outputSchema: requestPaymentOutput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        await vault.preflight();
      } catch (e) {
        log({ tool: "request_payment", request_id: input.request_id, refused: (e as Error).message });
        return errorResult(`Refused before sending anything: ${(e as Error).message}`);
      }
      const result: SubmitResult = await vault.requestPayment({
        request_id: input.request_id,
        token: input.token,
        amount: input.amount_units,
        recipient: input.recipient,
        reason: input.reason,
      });

      if (result.kind === "unknown") {
        log({ tool: "request_payment", request_id: input.request_id, unknown: result.message, tx_hash: result.txHash });
        return errorResult(
          `The result of request ${input.request_id} is unknown (${result.message}). It may or may not have been sent. ` +
            "Call get_payment_status with the same request_id, and only retry with that same id.",
        );
      }
      if (result.kind === "rejected") {
        log({ tool: "request_payment", request_id: input.request_id, rejected: result.reasonCode, tx_hash: result.txHash });
        const why = result.reasonCode ? `${result.reasonCode}: ${explainReason(result.reasonCode)}` : result.message;
        return errorResult(`The vault refused request ${input.request_id} (${why}). Nothing was paid. Transaction ${result.txHash}.`);
      }

      const { outcome, txHash } = result;
      // the outcome must describe the request we sent; anything else is not trusted
      if (outcome.request_id !== input.request_id && outcome.request_id !== "<invalid>") {
        return errorResult(`The vault answered for a different request id. Check get_payment_status for ${input.request_id}.`);
      }
      // only stored requests get a link; a blocked duplicate must not replace the original's
      if (outcome.status !== "BLOCKED") {
        txHashes.set(input.request_id, txHash);
        if (txHashes.size > 1000) txHashes.delete(txHashes.keys().next().value as string);
      }
      const out: RequestPaymentOutput = {
        request_id: input.request_id,
        policy_decision: policyDecisionOf(outcome),
        onchain_status: outcome.status,
        reason_code: outcome.reason_code,
        explanation: explainReason(outcome.reason_code),
        tx_hash: txHash,
      };
      const review = outcome.status === "AWAITING_APPROVAL" ? reviewLink(config, input.request_id) : null;
      if (review) out.review_url = review;
      const explorer = explorerTxLink(config, txHash);
      if (explorer) out.explorer_url = explorer;

      log({ tool: "request_payment", request_id: input.request_id, status: out.onchain_status, reason_code: out.reason_code, tx_hash: txHash });
      return {
        content: text(summarize(out, input.amount_units, input.token, input.recipient), out),
        structuredContent: out,
      };
    },
  );

  server.registerTool(
    "request_cross_chain_payment",
    {
      title: "Request a cross-chain SpactVault payment (NEAR Intents 1Click)",
      description:
        `Ask the SpactVault contract ${config.vaultId} on NEAR ${config.network} to pay someone on another chain through NEAR Intents 1Click. ` +
        "This tool gets a 1Click quote for exactly the amount, destination asset and recipient given, checks it, and files it with the vault. " +
        "The vault never pays it on its own: it always waits for the owner to approve the exact deposit address and destination in their wallet, and only routes and recipients the owner allowlisted are accepted. " +
        "This tool cannot approve, change the policy, or move funds any other way.",
      inputSchema: requestCrossChainInput,
      outputSchema: requestCrossChainOutput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (input) => {
      const tool = "request_cross_chain_payment";
      if (!oneClick) {
        return errorResult("Cross-chain payments are off on this server: the operator has not set ENABLE_1CLICK_LIVE=true. Nothing was sent.");
      }
      try {
        await vault.preflight("request_cross_chain_payment");
      } catch (e) {
        log({ tool, request_id: input.request_id, refused: (e as Error).message });
        return errorResult(`Refused before sending anything: ${(e as Error).message}`);
      }

      // the owner's allowlist, checked here too so a payment it would refuse costs no 1Click quote or gas
      let chainName: string;
      try {
        const route = findRoute(await oneClick.tokens(), input.token, input.destination_asset);
        if (!route) return errorResult(`1Click does not list a route from ${input.token} on NEAR to ${input.destination_asset}. Nothing was sent.`);
        chainName = route.destination.blockchain;
        const policy = await vault.getPolicy();
        const allowed = policy.cross_chain.find(
          (r) => r.token === input.token && r.destination_chain === chainName && r.destination_asset === input.destination_asset,
        );
        if (!allowed?.recipients.includes(input.recipient)) {
          return errorResult(
            `The owner's rules do not allow paying ${input.recipient} on ${chainName} with ${input.destination_asset}. ` +
              "Ask the owner to allow it on the SpactVault site (Cross-chain page). Nothing was sent.",
          );
        }
      } catch (e) {
        return errorResult(`Could not check the route: ${(e as Error).message}. Nothing was sent.`);
      }

      let filed: ReturnType<typeof crossChainArgs>;
      let appFeeBps: number;
      try {
        const asked = buildQuoteRequest({
          vaultId: config.vaultId,
          token: input.token,
          amount: BigInt(input.amount_units),
          destinationAsset: input.destination_asset,
          recipient: input.recipient,
          slippageBps: input.slippage_bps,
          deadline: new Date(now().getTime() + input.deadline_minutes * 60_000),
          dry: false,
        });
        const raw = await oneClick.quote(asked);
        filed = crossChainArgs(asked, raw, chainName, now());
        // only a quote 1Click itself signed is filed (ADR-034); the owner's page checks the signature again
        if (!verifyQuoteSignature(raw, quoteSignerKey)) throw new Error("1Click's signature on the quote does not verify");
        appFeeBps = (quoteResponseSchema.parse(raw).quoteRequest.appFees ?? []).reduce((sum, a) => sum + a.fee, 0);
        if (config.quoteDir) saveQuote(config.quoteDir, input.request_id, { asked, response: raw, quote_hash: filed.terms.quote_hash });
      } catch (e) {
        const why = e instanceof QuoteError ? e.message : `1Click quote failed: ${(e as Error).message}`;
        log({ tool, request_id: input.request_id, quote_refused: why });
        return errorResult(`${why}. Nothing was sent to the vault.`);
      }

      const result = await vault.requestCrossChain({
        request_id: input.request_id,
        token: filed.token,
        amount: filed.amount,
        deposit_account: filed.deposit_account,
        reason: input.reason,
        terms: filed.terms,
      });
      if (result.kind === "unknown") {
        log({ tool, request_id: input.request_id, unknown: result.message, tx_hash: result.txHash });
        return errorResult(
          `The result of request ${input.request_id} is unknown (${result.message}). Call get_payment_status with the same request_id, and only retry with that same id.`,
        );
      }
      if (result.kind === "rejected") {
        log({ tool, request_id: input.request_id, rejected: result.reasonCode, tx_hash: result.txHash });
        const why = result.reasonCode ? `${result.reasonCode}: ${explainReason(result.reasonCode)}` : result.message;
        return errorResult(`The vault refused request ${input.request_id} (${why}). Nothing was paid. Transaction ${result.txHash}.`);
      }
      const { outcome, txHash } = result;
      if (outcome.request_id !== input.request_id && outcome.request_id !== "<invalid>") {
        return errorResult(`The vault answered for a different request id. Check get_payment_status for ${input.request_id}.`);
      }
      if (outcome.status !== "BLOCKED") {
        txHashes.set(input.request_id, txHash);
        if (txHashes.size > 1000) txHashes.delete(txHashes.keys().next().value as string);
      }
      const out: RequestCrossChainOutput = {
        request_id: input.request_id,
        policy_decision: policyDecisionOf(outcome),
        onchain_status: outcome.status,
        reason_code: outcome.reason_code,
        explanation: explainReason(outcome.reason_code),
        tx_hash: txHash,
        deposit_address: filed.deposit_account,
        destination_chain: filed.terms.destination_chain,
        destination_recipient: filed.terms.destination_recipient,
        min_amount_out: filed.terms.min_amount_out,
        quote_deadline: isoFromNs(filed.terms.quote_expires_at_ns),
        quote_hash: filed.terms.quote_hash,
      };
      if (appFeeBps > 0) out.app_fee_bps = appFeeBps;
      const review = outcome.status === "AWAITING_APPROVAL" ? reviewLink(config, input.request_id) : null;
      if (review) out.review_url = review;
      const explorer = explorerTxLink(config, txHash);
      if (explorer) out.explorer_url = explorer;
      log({ tool, request_id: input.request_id, status: out.onchain_status, reason_code: out.reason_code, deposit: out.deposit_address, tx_hash: txHash });
      const summary =
        outcome.status === "AWAITING_APPROVAL"
          ? `Not paid yet: request ${input.request_id} (${input.amount_units} units of ${input.token} to ${input.recipient} on ${out.destination_chain}, through 1Click deposit address ${out.deposit_address}) is waiting for the owner${out.review_url ? ` (${out.review_url})` : ""}. The quote ends ${out.quote_deadline}. Check later with get_payment_status.`
          : outcome.status === "BLOCKED"
            ? `Blocked by the vault policy (${out.reason_code}): ${out.explanation} Nothing was paid.`
            : `Request ${input.request_id} is ${out.onchain_status}.`;
      return { content: text(summary, out), structuredContent: out };
    },
  );

  server.registerTool(
    "get_payment_status",
    {
      title: "Get a SpactVault payment's status",
      description:
        `Read the current on-chain status of a payment request in the SpactVault contract ${config.vaultId}. ` +
        "Blocked requests are not stored, so they read as NOT_FOUND.",
      inputSchema: z.object({ request_id: requestId.describe("The request_id you used with request_payment") }),
      outputSchema: getPaymentStatusOutput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ request_id }) => {
      const [request, nowNs] = await Promise.all([vault.getRequest(request_id), vault.nowNs()]);
      if (request === null) {
        const out: GetPaymentStatusOutput = {
          request_id,
          source_status: "NOT_FOUND",
          reason_code: "REQUEST_NOT_FOUND",
          explanation: `${explainReason("REQUEST_NOT_FOUND")} Blocked requests are not stored.`,
        };
        return { content: text(`No stored request with id ${request_id}.`, out), structuredContent: out };
      }

      const code = request.reason_code;
      const open = request.status === "AWAITING_APPROVAL" || request.status === "APPROVED";
      const expired = open && nowNs > BigInt(request.expires_at_ns);
      const out: GetPaymentStatusOutput = {
        request_id: request.request_id,
        source_status: request.status,
        reason_code: code,
        explanation: expired ? explainReason("REQUEST_EXPIRED") : explainReason(code),
        token: request.token,
        amount_units: request.amount,
        recipient: request.recipient,
        agent_id: request.agent_id,
        expires_at: isoFromNs(request.expires_at_ns),
        updated_at: isoFromNs(request.updated_at_ns),
      };
      if (open) out.expired = expired;
      if (request.approved_by) out.approved_by = request.approved_by;
      const review = request.status === "AWAITING_APPROVAL" && !expired ? reviewLink(config, request_id) : null;
      if (review) out.review_url = review;
      const hash = txHashes.get(request_id);
      const explorer = hash ? explorerTxLink(config, hash) : null;
      if (explorer) out.explorer_url = explorer;
      if (request.cross_chain) {
        const t = request.cross_chain;
        const cc: NonNullable<GetPaymentStatusOutput["cross_chain"]> = {
          deposit_address: request.recipient,
          destination_chain: t.destination_chain,
          destination_asset: t.destination_asset,
          destination_recipient: t.destination_recipient,
          min_amount_out: t.min_amount_out,
          note: crossChainNote(request),
        };
        if (oneClick && request.status === "CROSS_CHAIN_PENDING") {
          try {
            const raw = await oneClick.status(request.recipient);
            const r = reconcile(request, raw);
            cc.provider_status = r.providerStatus;
            cc.provider_final = r.providerFinal;
            if (r.reportedRefund) cc.reported_refund_units = r.reportedRefund;
            const parsed = statusResponseSchema.parse(raw);
            const dest = (parsed.swapDetails?.destinationChainTxHashes ?? []).map((d) => d.hash);
            if (dest.length > 0) cc.destination_tx_hashes = dest;
          } catch (e) {
            cc.note = `${cc.note} 1Click's status could not be read: ${(e as Error).message}`;
          }
        }
        out.cross_chain = cc;
      }

      const summary = expired
        ? `Request ${request_id} expired before it was ${request.status === "APPROVED" ? "paid" : "approved"}. Nothing was paid.`
        : `Request ${request_id} is ${request.status} (${code}).`;
      return { content: text(summary, out), structuredContent: out };
    },
  );

  return server;
}
