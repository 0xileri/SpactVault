import type { AppConfig } from "../config.js";
import { createDevSigner } from "./devSigner.js";
import type { OwnerSigner } from "./types.js";
import { createWalletSigner } from "./walletSigner.js";

export type { OwnerSigner, WalletAction } from "./types.js";
export { SignError } from "./types.js";

/** Wallets cannot sign on a local sandbox, so sandbox uses the dev signer or nothing. */
export function createSigner(config: AppConfig): OwnerSigner | null {
  if (config.network === "sandbox") {
    return config.devSignerUrl ? createDevSigner(config.devSignerUrl) : null;
  }
  return createWalletSigner(config.network);
}
