#!/usr/bin/env node
/**
 * OpenCode MCP gateway entry point.
 *
 * Starts the ChromeUse MCP gateway in stdio mode by default. When
 * CHROMEUSE_GATEWAY_MODE=server is set, also starts the local HTTP gateway and
 * shares one queued WebSocket extension bridge between stdio and HTTP requests.
 *
 * Usage:
 *   node gateway/dist/index.js
 *   CHROMEUSE_GATEWAY_MODE=server CHROMEUSE_HTTP_PORT=8766 node gateway/dist/index.js
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
