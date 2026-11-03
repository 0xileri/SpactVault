#!/usr/bin/env node
/**
 * SpactVault MCP server (stdio). Gives an AI agent three tools, request_payment,
 * request_cross_chain_payment (only with ENABLE_1CLICK_LIVE=true) and get_payment_status, backed by the
 * agent's function-call key. It refuses to start with a full-access key, a key for another contract or
 * extra methods, or a vault on another network.
 *
 * Configuration comes from environment variables; see apps/mcp/README.md.
 */
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { liveOneClick } from "@spact/intents";

import { loadAgentKey } from "./agentKey.js";
import { parseConfig } from "./config.js";
import { createSpactServer } from "./tools.js";
import { createVaultClient } from "./vault.js";

async function main() {
  const config = parseConfig(process.env);
  const key = loadAgentKey(config.agentKeyFile, config.agentId);
  const vault = createVaultClient(config, key);
  await vault.preflight();
  console.error(
    `spact-mcp: ${key.accountId} (function-call key ${key.publicKey}) -> vault ${config.vaultId} on ${config.network}`,
  );

  const oneClick = config.oneClick
    ? liveOneClick({ enabled: true, baseUrl: config.oneClick.baseUrl, ...(config.oneClick.jwt ? { jwt: config.oneClick.jwt } : {}) })
    : null;
  if (oneClick) console.error(`spact-mcp: cross-chain payments on, 1Click at ${config.oneClick?.baseUrl}`);

  const handle = serveStdio(() => createSpactServer({ vault, config, oneClick }));
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void handle.close().finally(() => process.exit(0)));
  }
}

main().catch((e: unknown) => {
  console.error(`spact-mcp: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
