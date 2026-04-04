#!/usr/bin/env node
/**
 * MCP Server entry point.
 *
 * Starts the MCP server with a stdio transport, connecting OpenCode
 * to the Chrome extension via the native messaging host socket.
 *
 * Usage:
 *   node mcp-server/dist/index.js
 *
 * The server discovers and connects to an active native host socket
 * automatically when the first tool call arrives.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

async function main(): Promise<void> {
  const server = await createMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol)
  process.stderr.write("opencode-chrome MCP server started (stdio)\n");

  // Handle graceful shutdown
  const shutdown = async () => {
    process.stderr.write("opencode-chrome MCP server shutting down\n");
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${(err as Error).message}\n`);
  process.exit(1);
});
