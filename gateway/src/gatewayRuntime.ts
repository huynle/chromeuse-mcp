import type { Server as HttpServer } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createMcpServer,
  WebSocketBridge,
  type BrowserTransport,
} from "@chromeuse/mcp-server";
import { createGatewayServer } from "./gatewayServer.js";
import { RequestQueueTransport } from "./requestQueue.js";

const DEFAULT_GATEWAY_HOST = "127.0.0.1";
const DEFAULT_GATEWAY_PORT = 8766;

export type GatewayMode = "stdio" | "server";

export interface GatewayConfig {
  readonly mode: GatewayMode;
  readonly gatewayHost: string;
  readonly gatewayPort: number;
}

interface McpServerLike {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void> | void;
}

interface RuntimeDependencies {
  readonly env?: NodeJS.ProcessEnv;
  readonly stderr?: Pick<NodeJS.WriteStream, "write">;
  readonly createMcpServerImpl?: (transport?: BrowserTransport) => Promise<McpServerLike>;
  readonly createStdioTransport?: () => unknown;
  readonly createWebSocketBridge?: (options: {
    env: Pick<NodeJS.ProcessEnv, "CHROMEUSE_WS_PORT">;
  }) => BrowserTransport;
  readonly createQueueTransport?: (transport: BrowserTransport) => BrowserTransport;
  readonly createGatewayServerImpl?: (options: { transport: BrowserTransport }) => HttpServer;
}

export interface GatewayRuntime {
  readonly mode: GatewayMode;
  readonly config: GatewayConfig;
  close(): Promise<void>;
}

export function resolveGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const mode = env.CHROMEUSE_GATEWAY_MODE?.toLowerCase() === "server" ? "server" : "stdio";

  return {
    mode,
    gatewayHost: env.CHROMEUSE_GATEWAY_HOST || DEFAULT_GATEWAY_HOST,
    gatewayPort: parsePort(env.CHROMEUSE_GATEWAY_PORT) ?? DEFAULT_GATEWAY_PORT,
  };
}

export async function startGateway(
  dependencies: RuntimeDependencies = {}
): Promise<GatewayRuntime> {
  const env = dependencies.env ?? process.env;
  const stderr = dependencies.stderr ?? process.stderr;
  const config = resolveGatewayConfig(env);
  const createMcp = dependencies.createMcpServerImpl ?? createMcpServer;
  const createStdio = dependencies.createStdioTransport ?? (() => new StdioServerTransport());

  if (config.mode === "server") {
    const createBridge =
      dependencies.createWebSocketBridge ?? ((options) => new WebSocketBridge(options));
    const createQueue =
      dependencies.createQueueTransport ?? ((transport) => new RequestQueueTransport(transport));
    const createHttpServer = dependencies.createGatewayServerImpl ?? createGatewayServer;

    const bridge = createBridge({ env: { CHROMEUSE_WS_PORT: env.CHROMEUSE_WS_PORT } });
    const queuedTransport = createQueue(bridge);
    await queuedTransport.connect();

    const mcpServer = await createMcp(queuedTransport);
    await mcpServer.connect(createStdio());

    const httpServer = createHttpServer({ transport: queuedTransport });
    await listen(httpServer, config.gatewayPort, config.gatewayHost);

    stderr.write(
      `ChromeUse MCP gateway started (server, http://${config.gatewayHost}:${config.gatewayPort})\n`
    );

    return {
      mode: config.mode,
      config,
      close: async () => {
        await closeHttpServer(httpServer);
        queuedTransport.disconnect();
        await mcpServer.close();
      },
    };
  }

  const mcpServer = await createMcp();
  await mcpServer.connect(createStdio());

  stderr.write("ChromeUse MCP gateway started (stdio)\n");

  return {
    mode: config.mode,
    config,
    close: async () => {
      await mcpServer.close();
    },
  };
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) return undefined;
  return port;
}

function listen(server: HttpServer, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
