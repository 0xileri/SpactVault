import { SignError, type OwnerSigner, type WalletAction } from "./types.js";

/** JSON has no bytes: contract code travels to the dev signer as base64. */
function forJson(actions: WalletAction[]): unknown[] {
  return actions.map((a) => {
    if (a.type !== "DeployContract") return a;
    let binary = "";
    const code = a.params.code;
    for (let i = 0; i < code.length; i += 0x8000) binary += String.fromCharCode(...code.subarray(i, i + 0x8000));
    return { type: a.type, params: { code: btoa(binary) } };
  });
}

/**
 * Sandbox-only signer. Sends the unsigned transaction to apps/web/dev/dev-signer.ts on localhost,
 * which holds the sandbox owner key and signs allowlisted vault calls. The key never reaches the
 * browser. config.ts refuses this signer on testnet and mainnet.
 */
export function createDevSigner(baseUrl: string): OwnerSigner {
  let connected = false;

  async function fetchAccount(): Promise<string> {
    const res = await fetch(`${baseUrl}/account`);
    const body: unknown = await res.json();
    const id = typeof body === "object" && body !== null && "accountId" in body ? body.accountId : null;
    if (!res.ok || typeof id !== "string") throw new SignError("The dev signer did not return an account");
    return id;
  }

  return {
    label: "Local sandbox signer",

    async restore() {
      return connected ? fetchAccount() : null;
    },

    async connect() {
      const id = await fetchAccount();
      connected = true;
      return id;
    },

    async disconnect() {
      connected = false;
    },

    async signAndSend(receiverId, actions) {
      const res = await fetch(`${baseUrl}/sign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ receiverId, actions: forJson(actions) }),
      });
      const body: unknown = await res.json().catch(() => null);
      const rec = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
      const txHash = typeof rec.txHash === "string" ? rec.txHash : null;
      if (!res.ok || rec.ok !== true) {
        throw new SignError(typeof rec.error === "string" ? rec.error : `dev signer returned HTTP ${res.status}`, txHash);
      }
      return { txHash };
    },
  };
}
