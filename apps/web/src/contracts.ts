/**
 * Vault builds this site knows (ADR-033). The P1 wasm is committed next to the page
 * (public/contracts/), and the create-vault page deploys exactly those bytes after checking them
 * against `sha256` below. `codeHash` is what NEAR reports for an account running that build
 * (view_account code_hash: base58 of the sha256). A vault whose code hash is not listed here is
 * not treated as a SpactVault.
 *
 * Rust wasm builds are not byte-for-byte reproducible across machines (ADR-003), so a fresh
 * `scripts/build-contracts.sh` elsewhere can give another hash. test/contracts.test.ts checks the
 * committed file against this manifest.
 */
export interface VaultBuild {
  id: string;
  label: string;
  /** Path of the wasm relative to the page, or null when this site does not serve that build. */
  file: string | null;
  bytes: number | null;
  /** hex sha256 of the wasm, null when the build is only known by its code hash. */
  sha256: string | null;
  /** base58 sha256, as view_account reports it. */
  codeHash: string;
  /** Last commit that changed contracts/spact-vault before the build. */
  sourceCommit: string;
  /** Has the 1Click cross-chain route (P1). */
  crossChain: boolean;
}

export const P1_BUILD: VaultBuild = {
  id: "p1",
  label: "SpactVault P1 (direct and cross-chain payments)",
  file: "contracts/spact_vault-p1.wasm",
  bytes: 274_238,
  sha256: "3fc54891027a5ffbc329bc20b3a7e934fa77187106cab5677422b525e9fabb53",
  codeHash: "5HwAUrjKbx5qc7NNyka4ndkAsXUdA9CsQ1ya66zzNNve",
  sourceCommit: "0f7480b88bf44206fe6a05f905f31336b97b2645",
  crossChain: true,
};

/** The build the create-vault page deploys. */
export const LATEST_BUILD = P1_BUILD;

export const VAULT_BUILDS: readonly VaultBuild[] = [P1_BUILD];

export function buildForCodeHash(codeHash: string): VaultBuild | null {
  return VAULT_BUILDS.find((b) => b.codeHash === codeHash) ?? null;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** sha256 of a wasm, as hex and as the code hash NEAR reports. */
export async function hashWasm(wasm: Uint8Array): Promise<{ sha256: string; codeHash: string }> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", wasm as BufferSource));
  return { sha256: hex(digest), codeHash: base58(digest) };
}

export class BuildMismatchError extends Error {}

/** Downloads a build's wasm and refuses it unless its size and sha256 match the manifest. */
export async function fetchBuild(build: VaultBuild, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  if (!build.file || build.sha256 === null) throw new BuildMismatchError(`${build.label} is not served by this site`);
  const res = await fetchImpl(build.file);
  if (!res.ok) throw new BuildMismatchError(`could not download ${build.file} (HTTP ${res.status})`);
  const wasm = new Uint8Array(await res.arrayBuffer());
  const { sha256 } = await hashWasm(wasm);
  if (wasm.length !== build.bytes || sha256 !== build.sha256) {
    throw new BuildMismatchError(`${build.file} does not match the published build (sha256 ${sha256}, expected ${build.sha256})`);
  }
  return wasm;
}

/** The only kind of key a locked vault may still have: a function-call key for `new` on the vault itself. */
interface KeyLike {
  permission: { kind: string; receiverId?: string; methodNames?: string[] };
}

/**
 * Why a vault account is not locked, or null when it is (ADR-035). Locked means nobody can change its code
 * or sign as it: no access keys at all, or only spent init keys, function-call keys that can call nothing but
 * `new` on the vault, which the vault refuses once it runs. A named vault created through a wallet keeps one
 * such key, because a wallet may not add a full-access key that the vault could delete.
 */
export function lockProblem(keys: KeyLike[], vaultId: string): string | null {
  const other = keys.filter(
    (k) => !(k.permission.kind === "FunctionCall" && k.permission.receiverId === vaultId && k.permission.methodNames?.length === 1 && k.permission.methodNames[0] === "new"),
  );
  if (other.length === 0) return null;
  const full = other.filter((k) => k.permission.kind === "FullAccess").length;
  return full > 0
    ? `It has ${full} full-access key(s), so whoever holds them could change its code.`
    : `It has ${other.length} access key(s) that can do more than call \`new\` on it.`;
}
