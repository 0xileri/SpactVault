/**
 * LIVE 1Click token list, recorded 2026-11-04 (about 10:40 UTC) by the owner with
 * `curl -s https://1click.chaindefuser.com/v0/tokens -o tokens.json` (no API key or JWT) and uploaded to the
 * session. `tokens.json` next to this file is that file byte for byte: 54705 bytes, sha256 below. 215 entries
 * on 38 chains; prices are 1Click's at the time and nothing here is secret.
 *
 * GET /v0/tokens -> HTTP 200
 */
import { readFileSync } from "node:fs";

export const SHA256 = "6488ddcb9fdf2afc46991a6819604169f37b3e776468b7b24da7960557521251";
export const BYTES = 54705;

/** The raw bytes as recorded. */
export const raw: Buffer = readFileSync(new URL("./tokens.json", import.meta.url));
/** The list as 1Click sent it. */
export const body: unknown = JSON.parse(raw.toString("utf8"));

/** USDC on Base and on NEAR, exactly as the list names them. */
export const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
export const NEAR_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
