/**
 * MOCK 1Click API for the browser tests: an explicitly named stand-in (AGENTS.md section 0), never a
 * dummy success. It serves the three paths the site uses, shaped like the SDK's types (packages/intents):
 *
 *   GET  /v0/tokens   the demo token on NEAR and USDC on Solana
 *   POST /v0/quote    a quote for exactly what was asked (dry quotes have no deposit address)
 *   GET  /v0/status   1Click's "record" of a deposit address, built from the vault request that names it
 *
 * The real 1Click knows a deposit address because it made it; here the sandbox fixture made it, so the mock
 * reads the request from the local chain to answer like an honest 1Click would. Its answers have the shape of
 * the live answers recorded on 2026-11-03 (packages/intents/test/fixtures/live): HTTP 201 for quotes, the
 * fields 1Click adds to its echo of the request, null status fields before a deposit, and a quote deadline
 * three days after the requested one. It signs them as 1Click does, with the published mock key
 * (MOCK_SIGNER_SEED), which the site accepts only on a local sandbox.
 *
 * Tests make it lie through POST /__mock/override {depositAddress, patch, resign}: the patch is merged into
 * the next answers for that address, then signed again (a dishonest 1Click) unless `resign` is false (a
 * forger who cannot sign, such as a tampering proxy). DELETE /__mock/override clears every override.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { MOCK_SIGNER_SEED, mockQuoteSigner, signQuoteForMock } from "@spact/intents";
import type { PaymentRequest } from "@spact/shared";
import { JsonRpcProvider } from "near-api-js";

export const SOL_USDC = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";

interface Options {
  rpcUrl: string;
  vaultIds: () => string[];
  tokenId: string;
  port: number;
}

type Json = Record<string, unknown>;

function merge(base: Json, patch: Json): Json {
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const b = out[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && b && typeof b === "object" && !Array.isArray(b) ? merge(b as Json, v as Json) : v;
  }
  return out;
}

async function body(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Json) : {};
}

/** A Solana-looking transaction hash, derived from the deposit address so it is stable per request. */
function fakeSolHash(seed: string): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < 87; i++) out += alphabet[(seed.charCodeAt(i % seed.length) * (i + 7)) % 58];
  return out;
}

export function startMockOneClick(o: Options) {
  const provider = new JsonRpcProvider({ url: o.rpcUrl });
  const overrides = new Map<string, { patch: Json; resign: boolean }>();
  const signer = mockQuoteSigner(MOCK_SIGNER_SEED);
  const sign = <T extends Json>(quoteResponse: T) => signQuoteForMock(quoteResponse, signer.secretKey);
  const later = (iso: string) => new Date(Date.parse(iso) + 72 * 3600_000).toISOString();
  /** What the live API adds to its echo of a quote request. */
  const echoExtras = { confidentiality: "public", quoteWaitingTimeMs: 0, insured: false, appFees: [{ recipient: "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd", fee: 1 }] };
  const quotes: Json[] = [];

  async function findRequest(deposit: string): Promise<PaymentRequest | null> {
    for (const vault of o.vaultIds()) {
      const list = await provider
        .callFunction<PaymentRequest[]>({ contractId: vault, method: "list_requests", args: { from_index: 0, limit: 100 } })
        .catch(() => null);
      const hit = (list ?? []).find((r) => r.route === "ONE_CLICK_ORIGIN_NEAR" && r.recipient === deposit);
      if (hit) return hit;
    }
    return null;
  }

  function statusFor(r: PaymentRequest): Json {
    const t = r.cross_chain;
    if (!t) throw new Error("not cross-chain");
    const deadline = new Date(Number(BigInt(t.quote_expires_at_ns) / 1_000_000n)).toISOString();
    const paid = r.status === "CROSS_CHAIN_PENDING";
    return {
      status: paid ? "SUCCESS" : "PENDING_DEPOSIT",
      updatedAt: new Date().toISOString(),
      correlationId: "mock-oneclick",
      quoteResponse: {
        timestamp: new Date().toISOString(),
        signature: "",
        quoteRequest: {
          ...echoExtras,
          dry: false,
          swapType: "EXACT_INPUT",
          slippageTolerance: 100,
          originAsset: `nep141:${r.token}`,
          depositType: "ORIGIN_CHAIN",
          destinationAsset: t.destination_asset,
          amount: r.amount,
          refundTo: t.refund_to,
          refundType: "ORIGIN_CHAIN",
          recipient: t.destination_recipient,
          recipientType: "DESTINATION_CHAIN",
          deadline,
        },
        quote: {
          depositAddress: r.recipient,
          amountIn: r.amount,
          amountOut: r.amount,
          minAmountOut: t.min_amount_out,
          deadline: later(deadline),
          timeWhenInactive: later(deadline),
          amountOutFormatted: "mock",
          refundFee: "0",
          withdrawFee: "0",
        },
      },
      swapDetails: {
        intentHashes: [],
        nearTxHashes: [],
        originChainTxHashes: [],
        destinationChainTxHashes: paid ? [{ hash: fakeSolHash(r.recipient), explorerUrl: "https://evil.example/not-linked" }] : [],
        depositedAmount: paid ? r.amount : null,
        amountOut: paid ? r.amount : null,
        refundedAmount: "0",
        refundReason: null,
      },
    };
  }

  const server = createServer((req, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const send = (status: number, json: unknown) => {
        res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" });
        res.end(JSON.stringify(json));
      };
      try {
        if (req.method === "OPTIONS") return send(204, {});
        if (req.method === "GET" && url.pathname === "/v0/tokens") {
          return send(200, [
            { assetId: `nep141:${o.tokenId}`, decimals: 6, blockchain: "near", symbol: "TUSD", price: 1, priceUpdatedAt: new Date().toISOString() },
            { assetId: SOL_USDC, decimals: 6, blockchain: "sol", symbol: "USDC", price: 1, priceUpdatedAt: new Date().toISOString(), contractAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
          ]);
        }
        if (req.method === "POST" && url.pathname === "/v0/quote") {
          const q = await body(req);
          quotes.push(q);
          const amount = BigInt(String(q.amount));
          const out = (amount * 99n) / 100n;
          const min = (out * (10_000n - BigInt(Number(q.slippageTolerance ?? 0)))) / 10_000n;
          return send(201, sign({
            timestamp: new Date().toISOString(),
            signature: "",
            correlationId: "mock-oneclick",
            quoteRequest: { ...q, ...echoExtras },
            quote: {
              amountIn: amount.toString(),
              amountOut: out.toString(),
              minAmountOut: min.toString(),
              amountInUsd: (Number(amount) / 1e6).toFixed(4),
              amountOutUsd: (Number(out) / 1e6).toFixed(4),
              timeEstimate: 20,
              withdrawFee: "0",
              ...(q.dry ? {} : { depositAddress: "0".repeat(64), deadline: later(String(q.deadline)), timeWhenInactive: later(String(q.deadline)), refundFee: "0" }),
            },
          }));
        }
        if (req.method === "GET" && url.pathname === "/v0/status") {
          const deposit = url.searchParams.get("depositAddress") ?? "";
          const r = await findRequest(deposit);
          if (!r) return send(404, { message: "deposit address not found (mock 1Click)" });
          const honest = statusFor(r);
          honest.quoteResponse = sign(honest.quoteResponse as Json);
          const o = overrides.get(deposit);
          if (!o) return send(200, honest);
          const lied = merge(honest, o.patch);
          if (o.resign) lied.quoteResponse = sign(lied.quoteResponse as Json);
          return send(200, lied);
        }
        if (url.pathname === "/__mock/override") {
          if (req.method === "DELETE") {
            overrides.clear();
            return send(200, { ok: true });
          }
          const b = await body(req);
          overrides.set(String(b.depositAddress), { patch: (b.patch ?? {}) as Json, resign: b.resign !== false });
          return send(200, { ok: true });
        }
        if (url.pathname === "/__mock/quotes") return send(200, quotes);
        return send(404, { message: "not a 1Click path (mock)" });
      } catch (e) {
        return send(500, { message: (e as Error).message });
      }
    })();
  });
  return new Promise<{ close: () => Promise<void>; url: string }>((done) =>
    server.listen(o.port, "127.0.0.1", () =>
      done({ url: `http://127.0.0.1:${o.port}`, close: () => new Promise<void>((c) => server.close(() => c())) }),
    ),
  );
}
