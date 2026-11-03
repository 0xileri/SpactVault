import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { base58, buildForCodeHash, BuildMismatchError, fetchBuild, hashWasm, LATEST_BUILD, P1_BUILD } from "../src/contracts.js";

const wasm = new Uint8Array(readFileSync(resolve(import.meta.dirname, "../public", P1_BUILD.file ?? "")));

describe("vault build manifest", () => {
  it("matches the committed wasm byte for byte", async () => {
    expect(wasm.length).toBe(P1_BUILD.bytes);
    await expect(hashWasm(wasm)).resolves.toEqual({ sha256: P1_BUILD.sha256, codeHash: P1_BUILD.codeHash });
    expect(LATEST_BUILD).toBe(P1_BUILD);
    expect(buildForCodeHash(P1_BUILD.codeHash)).toBe(P1_BUILD);
    expect(buildForCodeHash("11111111111111111111111111111111")).toBeNull();
  });

  it("encodes base58 the way NEAR does, leading zero bytes included", () => {
    expect(base58(new Uint8Array(32))).toBe("11111111111111111111111111111111");
    expect(base58(new Uint8Array([0, 0, 1]))).toBe("112");
    expect(base58(new Uint8Array([255, 255]))).toBe("LUv");
  });

  it("refuses a download that is not the published build", async () => {
    const serve = (body: Uint8Array, status = 200) => (async () => new Response(body as BodyInit, { status })) as unknown as typeof fetch;
    await expect(fetchBuild(P1_BUILD, serve(wasm))).resolves.toHaveLength(P1_BUILD.bytes ?? 0);
    const tampered = wasm.slice();
    tampered[100] = (tampered[100] ?? 0) ^ 1;
    await expect(fetchBuild(P1_BUILD, serve(tampered))).rejects.toBeInstanceOf(BuildMismatchError);
    await expect(fetchBuild(P1_BUILD, serve(wasm.slice(1)))).rejects.toThrow(/does not match/);
    await expect(fetchBuild(P1_BUILD, serve(new Uint8Array(), 404))).rejects.toThrow(/HTTP 404/);
  });
});
