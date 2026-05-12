#!/usr/bin/env node
/**
 * OpenCode MCP gateway entry point.
 *
 * Starts the ChromeUse MCP server with a stdio transport for OpenCode MCP
 * configuration. This imports the side-effect-free MCP server package export;
 * do not import side-effectful server entrypoints here.
 *
 * Usage:
 *   node gateway/dist/index.js
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "@chromeuse/mcp-server";

async function main(): Promise<void> {
  const server = await createMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol)
  process.stderr.write("ChromeUse MCP gateway started (stdio)\n");

  // Handle graceful shutdown
  const shutdown = async () => {
    process.stderr.write("ChromeUse MCP gateway shutting down\n");
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
