/**
 * What the site asks 1Click, and what it makes of the answers (ADR-033). Everything 1Click says is an
 * outside report: it decides nothing on chain. The page uses it for two things only: to refuse an
 * approval when 1Click's own record of a deposit address disagrees with the request (Security Lab T14),
 * and to show the owner where a paid cross-chain request stands.
 */
import { useEffect, useState } from "react";

import {
  depositMismatches,
  oneClickOverHttp,
  reconcile,
  statusResponseSchema,
  tokenListSchema,
  type OneClickApi,
  type OneClickToken,
  type Reconciliation,
  type StatusResponse,
} from "@spact/intents";
import type { PaymentRequest } from "@spact/shared";

import type { AppConfig } from "./config.js";
import { errorMessage } from "./format.js";
import { tokenStorage } from "./near/owner.js";

const clients = new Map<string, OneClickApi>();

/** One client per 1Click URL, so its token list is fetched once per page. */
export function oneClickFor(config: Pick<AppConfig, "oneClickUrl">): OneClickApi | null {
  if (!config.oneClickUrl) return null;
  let api = clients.get(config.oneClickUrl);
  if (!api) {
    api = oneClickOverHttp(config.oneClickUrl, { timeoutMs: 15_000 });
    clients.set(config.oneClickUrl, api);
  }
  return api;
}

export type DepositCheck =
  | { state: "unavailable" }
  | { state: "checking" }
  | { state: "error"; message: string }
  | { state: "mismatch"; mismatches: string[] }
  | {
      state: "verified";
      status: StatusResponse;
      registered: boolean | null;
      storageMin: bigint | null;
      /** 1Click's token-list entry for the destination asset, for showing amounts; null if not listed. */
      destination: OneClickToken | null;
    };

const tokenLists = new WeakMap<OneClickApi, Promise<OneClickToken[]>>();

/** 1Click's token list, fetched once per client. Display only: an empty list just means raw units are shown. */
function tokensOf(api: OneClickApi): Promise<OneClickToken[]> {
  let list = tokenLists.get(api);
  if (!list) {
    list = api
      .tokens()
      .then((raw) => {
        const parsed = tokenListSchema.safeParse(raw);
        return parsed.success ? parsed.data : [];
      })
      .catch(() => []);
    tokenLists.set(api, list);
  }
  return list;
}

/** Compares 1Click's record of the request's deposit address with the request, and checks the address can receive the token. */
export async function checkDeposit(config: AppConfig, api: OneClickApi | null, request: PaymentRequest): Promise<DepositCheck> {
  if (!api) return { state: "unavailable" };
  let raw: unknown;
  try {
    raw = await api.status(request.recipient);
  } catch (e) {
    return { state: "error", message: errorMessage(e) };
  }
  const mismatches = depositMismatches(request, raw);
  if (mismatches.length > 0) return { state: "mismatch", mismatches };
  const status = statusResponseSchema.parse(raw);
  const [storage, tokens] = await Promise.all([tokenStorage(config.rpcUrl, request.token, request.recipient), tokensOf(api)]);
  const destination = tokens.find((t) => t.assetId === request.cross_chain?.destination_asset) ?? null;
  return { state: "verified", status, registered: storage.registered, storageMin: storage.min, destination };
}

export interface Tracking {
  check: DepositCheck;
  /** Only once the vault has sent the deposit (CROSS_CHAIN_PENDING). */
  reconciliation: Reconciliation | null;
}

const POLL_MS = 5_000;

/**
 * Polls 1Click for a cross-chain request while it is open or in flight, and stops once 1Click reports a
 * final outcome. `nonce` restarts it (after the owner registers the deposit address, say).
 */
export function useOneClick(config: AppConfig, request: PaymentRequest | null, nonce = 0): Tracking | null {
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const relevant = request?.cross_chain ? request : null;
  const key = relevant ? `${relevant.request_id}|${relevant.status}|${relevant.recipient}|${relevant.request_hash}` : null;

  useEffect(() => {
    if (!relevant) {
      setTracking(null);
      return;
    }
    const api = oneClickFor(config);
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setTracking({ check: { state: "checking" }, reconciliation: null });

    const tick = async () => {
      const check = await checkDeposit(config, api, relevant);
      let reconciliation: Reconciliation | null = null;
      if (check.state === "verified" && relevant.status === "CROSS_CHAIN_PENDING") {
        try {
          reconciliation = reconcile(relevant, check.status);
        } catch {
          reconciliation = null;
        }
      }
      if (!alive) return;
      setTracking({ check, reconciliation });
      const open = relevant.status === "AWAITING_APPROVAL" || relevant.status === "APPROVED";
      const inFlight = relevant.status === "CROSS_CHAIN_PENDING" && !reconciliation?.providerFinal;
      if (api && (open || inFlight)) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // `key` stands for every field of the request that matters here
  }, [config, key, nonce]);

  return tracking;
}

export const STATUS_WORDS: Record<StatusResponse["status"], string> = {
  PENDING_DEPOSIT: "Waiting for the deposit",
  KNOWN_DEPOSIT_TX: "Deposit seen",
  PROCESSING: "Swapping and sending",
  SUCCESS: "Delivered, says 1Click",
  REFUNDED: "Refunded, says 1Click (unverified)",
  FAILED: "Failed, says 1Click",
  INCOMPLETE_DEPOSIT: "Deposit incomplete, says 1Click",
};
