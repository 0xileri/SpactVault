/**
 * Local "wallet" for the sandbox demo and browser tests.
 *
 * Holds the sandbox owner key from the demo-sandbox fixture and signs only what the site's owner pages
 * send (see parseSignRequest): decisions and settings on the demo vault or a vault the owner created from
 * the site, funding with the demo token, and creating sub-accounts of the owner. Listens on 127.0.0.1 only
 * and refuses to start unless the fixture points at a local sandbox. Real networks use a real wallet instead.
 *
 * Usage: node --experimental-strip-types dev/dev-signer.ts <fixture.json>
 */
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { Account, actions, JsonRpcProvider, PublicKey, type KeyPairString } from "near-api-js";

interface Fixture {
  network: string;
  rpc_url: string;
  vault_id: string;
  token_id: string;
  owner_id: string;
  owner_secret_key: string;
}

/** Owner methods on the demo vault and on vaults the owner creates from the site (sub-accounts of the owner). */
const OWNER_METHODS = new Set(["approve_request", "reject_request", "execute_request", "set_policy", "set_paused", "add_agent", "remove_agent"]);
/** Token methods for funding a vault and registering accounts with the demo token. */
const TOKEN_METHODS = new Set(["storage_deposit", "ft_transfer"]);
const MAX_GAS = 300_000_000_000_000n;
const MAX_BODY = 16 * 1024;
const MAX_NEAR = 10n * 10n ** 24n;
const MAX_STORAGE_DEPOSIT = 10n ** 23n; // 0.1 NEAR

const fixturePath = process.argv[2];
if (!fixturePath) throw new Error("usage: dev-signer.ts <fixture.json>");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
const rpcHost = new URL(fixture.rpc_url).hostname;
if (fixture.network !== "sandbox" || (rpcHost !== "127.0.0.1" && rpcHost !== "localhost")) {
  throw new Error("dev signer only runs against a local sandbox");
}

const owner = new Account(fixture.owner_id, new JsonRpcProvider({ url: fixture.rpc_url }), fixture.owner_secret_key as KeyPairString);
const port = Number(process.env.DEV_SIGNER_PORT ?? 8788);
const subAccount = new RegExp(`^[a-z0-9_-]+\\.${fixture.owner_id.replace(/\./g, "\\.")}$`);

type NearAction = ReturnType<typeof actions.transfer>;

function yocto(value: unknown, what: string): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error(`${what} must be a decimal string`);
  return BigInt(value);
}

function functionCall(params: Record<string, unknown> | undefined, allowed: Set<string>, maxDeposit: (method: string) => bigint): NearAction {
  const { methodName, args, gas, deposit } = params ?? {};
  if (typeof methodName !== "string" || !allowed.has(methodName)) throw new Error(`method ${String(methodName)} is not allowed`);
  if (typeof args !== "object" || args === null || Array.isArray(args)) throw new Error("args must be an object");
  const g = yocto(gas, "gas");
  if (g > MAX_GAS) throw new Error("bad gas");
  const d = yocto(deposit, "deposit");
  if (d > maxDeposit(methodName)) throw new Error(`deposit too large for ${methodName}`);
  return actions.functionCall(methodName, args as Record<string, unknown>, g, d);
}

/**
 * Accepts only what the site's owner flows send, in near-connect's action shape:
 * owner methods on the demo vault or an owner-created vault (deposit 0 or 1 yoctoNEAR); storage_deposit and
 * ft_transfer on the demo token; creating a direct sub-account of the owner (CreateAccount, Transfer, AddKey);
 * and a plain NEAR transfer of at most 10 NEAR to the demo vault or such a sub-account.
 */
function parseSignRequest(body: unknown): { receiverId: string; list: NearAction[] } {
  if (typeof body !== "object" || body === null) throw new Error("body must be an object");
  const { receiverId, actions: list } = body as { receiverId?: unknown; actions?: unknown };
  if (typeof receiverId !== "string") throw new Error("receiverId must be a string");
  if (!Array.isArray(list) || list.length < 1 || list.length > 3) throw new Error("expected 1 to 3 actions");
  const typed = list.map((a: unknown) => (a ?? {}) as { type?: unknown; params?: Record<string, unknown> });
  const types = typed.map((a) => a.type).join(",");

  if (receiverId === fixture.token_id) {
    return {
      receiverId,
      list: typed.map((a) => {
        if (a.type !== "FunctionCall") throw new Error("only function calls on the token");
        return functionCall(a.params, TOKEN_METHODS, (m) => (m === "ft_transfer" ? 1n : MAX_STORAGE_DEPOSIT));
      }),
    };
  }
  const ownVault = receiverId === fixture.vault_id || subAccount.test(receiverId);
  if (!ownVault) throw new Error(`receiverId must be ${fixture.vault_id}, the token, or a sub-account of ${fixture.owner_id}`);

  if (types === "CreateAccount,Transfer,AddKey") {
    if (!subAccount.test(receiverId)) throw new Error("only sub-accounts of the owner can be created");
    const [, transfer, addKey] = typed;
    const amount = yocto(transfer?.params?.deposit, "transfer");
    if (amount > MAX_NEAR) throw new Error("transfer too large");
    const key = addKey?.params as { publicKey?: unknown; accessKey?: { permission?: unknown } } | undefined;
    if (typeof key?.publicKey !== "string") throw new Error("AddKey needs a public key");
    const publicKey = PublicKey.fromString(key.publicKey);
    const permission = key.accessKey?.permission;
    let add: NearAction;
    if (permission === "FullAccess") {
      add = actions.addFullAccessKey(publicKey);
    } else {
      const p = (permission ?? {}) as { receiverId?: unknown; methodNames?: unknown; allowance?: unknown };
      if (typeof p.receiverId !== "string" || !Array.isArray(p.methodNames) || !p.methodNames.every((m) => typeof m === "string")) {
        throw new Error("bad function-call permission");
      }
      add = actions.addFunctionCallAccessKey(publicKey, p.receiverId, p.methodNames as string[], p.allowance === undefined ? undefined : yocto(p.allowance, "allowance"));
    }
    return { receiverId, list: [actions.createAccount(), actions.transfer(amount), add] };
  }
  if (types === "Transfer") {
    const amount = yocto(typed[0]?.params?.deposit, "transfer");
    if (amount > MAX_NEAR) throw new Error("transfer too large");
    return { receiverId, list: [actions.transfer(amount)] };
  }
  return { receiverId, list: typed.map((a) => {
    if (a.type !== "FunctionCall") throw new Error(`actions ${types} are not allowed`);
    return functionCall(a.params, OWNER_METHODS, () => 1n);
  }) };
}

function send(req: IncomingMessage, res: ServerResponse, status: number, body: unknown) {
  const origin = req.headers.origin;
  if (origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function txHashOf(result: unknown): string | null {
  const tx = (result as { transaction?: { hash?: unknown } } | null)?.transaction;
  return typeof tx?.hash === "string" ? tx.hash : null;
}

const server = createServer((req, res) => {
  void (async () => {
    if (req.method === "OPTIONS") return send(req, res, 204, {});
    if (req.method === "GET" && req.url === "/account") return send(req, res, 200, { accountId: fixture.owner_id });
    if (req.method !== "POST" || req.url !== "/sign") return send(req, res, 404, { ok: false, error: "not found" });

    let tx: { receiverId: string; list: NearAction[] };
    try {
      tx = parseSignRequest(await readJson(req));
    } catch (e) {
      return send(req, res, 400, { ok: false, error: (e as Error).message });
    }
    try {
      // FINAL, so the page's reads (finality "final") already see what this transaction did
      const result: unknown = await owner.signAndSendTransaction({ receiverId: tx.receiverId, actions: tx.list, throwOnFailure: false, waitUntil: "FINAL" });
      const status = (result as { status?: unknown } | null)?.status;
      const failure = typeof status === "object" && status !== null && "Failure" in status ? (status as { Failure: unknown }).Failure : null;
      if (failure) return send(req, res, 200, { ok: false, error: JSON.stringify(failure), txHash: txHashOf(result) });
      return send(req, res, 200, { ok: true, txHash: txHashOf(result) });
    } catch (e) {
      return send(req, res, 200, { ok: false, error: (e as Error).message });
    }
  })();
});

server.listen(port, "127.0.0.1", () => {
  console.log(`dev signer for ${fixture.owner_id} on http://127.0.0.1:${port} (sandbox only)`);
});
