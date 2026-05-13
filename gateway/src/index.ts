#!/usr/bin/env node
/**
 * OpenCode MCP gateway entry point.
 *
 * Starts automatic SERVER/PROXY gateway election by default. The first process
 * binds the local HTTP gateway and owns the queued WebSocket extension bridge;
 * later processes proxy stdio MCP tool requests through that SERVER.
 *
 * Usage:
 *   node gateway/dist/index.js
 *   CHROMEUSE_HTTP_PORT=8766 node gateway/dist/index.js
 *   CHROMEUSE_GATEWAY_MODE=stdio node gateway/dist/index.js
 */

import { startGateway } from "./gatewayRuntime.js";

async function main(): Promise<void> {
  const runtime = await startGateway();

  // Handle graceful shutdown
  const shutdown = async () => {
    process.stderr.write("ChromeUse MCP gateway shutting down\n");
    await runtime.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${(err as Error).message}\n`);
  process.exit(1);
});
