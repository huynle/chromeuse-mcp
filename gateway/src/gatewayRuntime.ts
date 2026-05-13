import type { Server as HttpServer } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createMcpServer,
  WebSocketBridge,
  type BrowserTransport,
  type ToolRequestResult,
} from "@chromeuse/mcp-server";
import { createGatewayServer } from "./gatewayServer.js";
import { HttpGatewayTransport } from "./httpGatewayTransport.js";
import { RequestQueueTransport } from "./requestQueue.js";

const DEFAULT_GATEWAY_HOST = "127.0.0.1";
const DEFAULT_GATEWAY_PORT = 8766;

export type GatewayMode = "stdio" | "server" | "proxy";

export interface GatewayConfig {
  readonly mode: GatewayMode;
  readonly gatewayHost: string;
  readonly gatewayPort: number;
  readonly clientId: string;
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
  readonly createGatewayServerImpl?: (options: {
    transport: BrowserTransport;
    clientId: string;
    logger?: (message: string) => void;
  }) => HttpServer;
  readonly createHttpGatewayTransport?: (
    baseUrl: string,
    options?: { logger?: (message: string) => void }
  ) => BrowserTransport;
}

export interface GatewayRuntime {
  readonly mode: GatewayMode;
  readonly config: GatewayConfig;
  close(): Promise<void>;
}

export function resolveGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const requestedMode = env.CHROMEUSE_GATEWAY_MODE?.toLowerCase();
  const mode = requestedMode === "stdio" || requestedMode === "direct" ? "stdio" : "server";

  return {
    mode,
    gatewayHost: env.CHROMEUSE_GATEWAY_HOST || DEFAULT_GATEWAY_HOST,
    gatewayPort:
      parsePort(env.CHROMEUSE_GATEWAY_PORT) ??
      parsePort(env.CHROMEUSE_HTTP_PORT) ??
      DEFAULT_GATEWAY_PORT,
    clientId: env.CHROMEUSE_GATEWAY_CLIENT_ID || env.CHROMEUSE_CLIENT_ID || generateClientId(),
  };
}

export async function startGateway(
  dependencies: RuntimeDependencies = {}
): Promise<GatewayRuntime> {
  const env = dependencies.env ?? process.env;
  const stderr = dependencies.stderr ?? process.stderr;
  const config = resolveGatewayConfig(env);
  const logger = createStderrLogger(stderr);
  const createMcp = dependencies.createMcpServerImpl ?? createMcpServer;
  const createStdio = dependencies.createStdioTransport ?? (() => new StdioServerTransport());

  if (config.mode === "server") {
    const createBridge =
      dependencies.createWebSocketBridge ?? ((options) => new WebSocketBridge(options));
    const createQueue =
      dependencies.createQueueTransport ??
      ((transport) => new RequestQueueTransport(transport, { logger }));
    const createHttpServer = dependencies.createGatewayServerImpl ?? createGatewayServer;
    const createHttpGatewayTransport =
      dependencies.createHttpGatewayTransport ??
      ((baseUrl, options) => new HttpGatewayTransport(baseUrl, options));
    const baseUrl = `http://${config.gatewayHost}:${config.gatewayPort}`;

    const deferredTransport = new DeferredBrowserTransport();
    const httpServer = createHttpServer({
      transport: deferredTransport,
      clientId: config.clientId,
      logger,
    });

    try {
      await listen(httpServer, config.gatewayPort, config.gatewayHost);
    } catch (error) {
      if (isAddressInUse(error)) {
        const proxyTransport = createHttpGatewayTransport(baseUrl, { logger });
        try {
          await proxyTransport.connect();
        } catch (proxyError) {
          const message = errorMessage(proxyError);
          logger(
            `mode=PROXY event=probe_failure base_url=${baseUrl} error=${message}`
          );
          throw new Error(
            `Unable to start ChromeUse MCP gateway proxy: existing gateway at ${baseUrl} did not pass compatible /health probe. ${message}`
          );
        }

        let mcpServer: McpServerLike | undefined;
        try {
          mcpServer = await createMcp(proxyTransport);
          await mcpServer.connect(createStdio());
          const activeMcpServer = mcpServer;

          logger(formatStartupLog("PROXY", config, baseUrl, env));

          return {
            mode: "proxy",
            config: { ...config, mode: "proxy" },
            close: async () => {
              proxyTransport.disconnect();
              await activeMcpServer.close();
            },
          };
        } catch (proxyStartupError) {
          proxyTransport.disconnect();
          await mcpServer?.close();
          const message = errorMessage(proxyStartupError);
          logger(
            `mode=PROXY event=startup_failure reason="proxy startup failed after compatible /health" base_url=${baseUrl} error=${message}`
          );
          throw new Error(
            `Unable to start ChromeUse MCP gateway proxy: proxy startup failed after compatible /health at ${baseUrl}. ${message}`
          );
        }
      }

      const message = errorMessage(error);
      logger(`mode=SERVER event=startup_failure base_url=${baseUrl} error=${message}`);
      throw new Error(
        `Unable to start ChromeUse MCP gateway server: failed to bind HTTP ${baseUrl}. ${message}`
      );
    }

    const bridge = createBridge({ env: { CHROMEUSE_WS_PORT: env.CHROMEUSE_WS_PORT } });
    const queuedTransport = createQueue(bridge);
    deferredTransport.setDelegate(queuedTransport);

    let mcpServer: McpServerLike | undefined;
    try {
      await queuedTransport.connect();
      mcpServer = await createMcp(queuedTransport);
      await mcpServer.connect(createStdio());
    } catch (error) {
      await closeHttpServer(httpServer);
      queuedTransport.disconnect();
      await mcpServer?.close();
      const message = errorMessage(error);
      logger(`mode=SERVER event=startup_failure base_url=${baseUrl} error=${message}`);
      throw new Error(
        `Unable to start ChromeUse MCP gateway server: HTTP ${baseUrl} was bound, but WebSocket bridge startup failed; HTTP listener closed. ${message}`
      );
    }

    logger(formatStartupLog("SERVER", config, baseUrl, env));

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

  logger(`mode=STDIO event=startup pid=${process.pid} client_id=${config.clientId}`);

  return {
    mode: config.mode,
    config,
    close: async () => {
      await mcpServer.close();
    },
  };
}

class DeferredBrowserTransport implements BrowserTransport {
  private delegate: BrowserTransport | undefined;

  get connected(): boolean {
    return this.delegate?.connected ?? false;
  }

  setDelegate(delegate: BrowserTransport): void {
    this.delegate = delegate;
  }

  async connect(): Promise<void> {
    await this.requireDelegate().connect();
  }

  async sendToolRequest(
    tool: string,
    args: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<ToolRequestResult> {
    return this.requireDelegate().sendToolRequest(tool, args, timeoutMs);
  }

  disconnect(): void {
    this.delegate?.disconnect();
  }

  private requireDelegate(): BrowserTransport {
    if (!this.delegate) {
      throw new Error("ChromeUse gateway transport is not ready yet");
    }
    return this.delegate;
  }
}

function isAddressInUse(error: unknown): boolean {
  return isRecord(error) && error.code === "EADDRINUSE";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) return undefined;
  return port;
}

function generateClientId(): string {
  return `chromeuse-gateway-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
}

function createStderrLogger(stderr: Pick<NodeJS.WriteStream, "write">): (message: string) => void {
  return (message: string) => {
    stderr.write(message.endsWith("\n") ? message : `${message}\n`);
  };
}

function formatStartupLog(
  mode: "SERVER" | "PROXY",
  config: GatewayConfig,
  baseUrl: string,
  env: NodeJS.ProcessEnv
): string {
  return [
    `mode=${mode}`,
    "event=startup",
    `pid=${process.pid}`,
    `http_port=${config.gatewayPort}`,
    `ws_port=${parsePort(env.CHROMEUSE_WS_PORT) ?? 8765}`,
    `client_id=${config.clientId}`,
    `base_url=${baseUrl}`,
  ].join(" ");
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
