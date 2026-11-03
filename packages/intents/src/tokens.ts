import { tokenListSchema, type OneClickToken } from "./schemas.js";
import { nearAssetId } from "./quote.js";

/**
 * Looks up a route in 1Click's live token list (AGENTS.md section 8, step 1): the NEP-141 token the
 * vault holds must be listed on NEAR, and the destination asset gives the destination chain's name.
 * Returns null when either is missing, so a route is never built on a token 1Click does not list.
 */
export function findRoute(raw: unknown, token: string, destinationAsset: string): { origin: OneClickToken; destination: OneClickToken } | null {
  const list = tokenListSchema.safeParse(raw);
  if (!list.success) return null;
  const origin = list.data.find((t) => t.assetId === nearAssetId(token) && t.blockchain === "near");
  const destination = list.data.find((t) => t.assetId === destinationAsset);
  return origin && destination ? { origin, destination } : null;
}
