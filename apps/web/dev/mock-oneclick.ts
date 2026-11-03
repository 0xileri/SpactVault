/**
 * Runs the MOCK 1Click server (e2e/mock-oneclick.ts) for the local demo, so the cross-chain pages work
 * without the real 1Click: it answers from the local chain and never reaches the internet.
 *
 * Usage: node --experimental-strip-types dev/mock-oneclick.ts <fixture.json>
 */
import { readFileSync } from "node:fs";

import { startMockOneClick } from "../e2e/mock-oneclick.ts";

const fixturePath = process.argv[2];
if (!fixturePath) throw new Error("usage: mock-oneclick.ts <fixture.json>");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { network: string; rpc_url: string; vault_id: string; token_id: string };
if (fixture.network !== "sandbox") throw new Error("the mock 1Click only runs next to a local sandbox");
const port = Number(process.env.MOCK_ONECLICK_PORT ?? 8787);
const mock = await startMockOneClick({ rpcUrl: fixture.rpc_url, vaultIds: () => [fixture.vault_id], tokenId: fixture.token_id, port });
console.log(`MOCK 1Click (not the real service) on ${mock.url}`);
