import { EventEmitter } from "node:events";
import { createServer as createHttpServer, type Server as NodeHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { BrowserTransport, ToolRequestResult } from "@chromeuse/mcp-server";
import { resolveGatewayConfig, startGateway } from "./gatewayRuntime.js";

class FakeBrowserTransport implements BrowserTransport {
  connected = false;
  readonly connect = vi.fn(async () => {
    this.connected = true;
  });
  readonly sendToolRequest = vi.fn(
    async (): Promise<ToolRequestResult> => ({ content: [{ type: "text", text: "ok" }] })
  );
  readonly disconnect = vi.fn(() => {
    this.connected = false;
  });
}

class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T) => void;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.resolve = resolve;
    });
  }
}

class FakeHttpServer extends EventEmitter {
  constructor(private readonly listenError?: Error) {
    super();
  }

  readonly listen = vi.fn((_port: number, _host: string) => {
    queueMicrotask(() => {
      if (this.listenError) {
        this.emit("error", this.listenError);
      } else {
        this.emit("listening");
      }
    });
    return this;
  });
  readonly close = vi.fn((callback?: (error?: Error) => void) => {
    callback?.();
    return this;
  });
}

async function getUnusedPort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Unable to allocate local test port");
  }
  const { port } = address;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function closeNodeHttpServer(server: NodeHttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function startIncompatibleHealthServer(port: number): Promise<NodeHttpServer> {
  const server = createHttpServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        gateway: "not-chromeuse-http-gateway",
        version: "9.0.0",
        protocol: "not-chromeuse-http-gateway",
        protocolVersion: "9.0.0",
        client_id: "incompatible-test-server",
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

describe("gateway runtime", () => {
  it("defaults to stdio mode unless server mode is explicit", () => {
    expect(resolveGatewayConfig({}).mode).toBe("stdio");
    expect(resolveGatewayConfig({ CHROMEUSE_GATEWAY_MODE: "stdio" }).mode).toBe("stdio");
    expect(resolveGatewayConfig({ CHROMEUSE_GATEWAY_MODE: "server" }).mode).toBe("server");
    expect(resolveGatewayConfig({ CHROMEUSE_GATEWAY_MODE: "SERVER" }).mode).toBe("server");
  });

  it("uses local HTTP gateway host and port env in server mode", () => {
    const config = resolveGatewayConfig({
      CHROMEUSE_GATEWAY_MODE: "server",
      CHROMEUSE_GATEWAY_HOST: "127.0.0.2",
      CHROMEUSE_HTTP_PORT: "9123",
      CHROMEUSE_CLIENT_ID: "configured-client",
    });

    expect(config).toEqual({
      mode: "server",
      gatewayHost: "127.0.0.2",
      gatewayPort: 9123,
      clientId: "configured-client",
    });
  });

  it("accepts documented client id and HTTP port environment overrides", () => {
    const config = resolveGatewayConfig({
      CHROMEUSE_GATEWAY_MODE: "server",
      CHROMEUSE_HTTP_PORT: "4455",
      CHROMEUSE_CLIENT_ID: "gateway-client",
    });

    expect(config.gatewayPort).toBe(4455);
    expect(config.clientId).toBe("gateway-client");
  });

  it("generates a client id when no environment override is provided", () => {
    const config = resolveGatewayConfig({});

    expect(config.clientId).toMatch(/^chromeuse-gateway-\d+-[a-z0-9]+$/);
  });

  it("starts default stdio without creating an HTTP server or injected queue", async () => {
    const mcpServer = { connect: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const stdioTransport = { kind: "stdio" };
    const createMcpServerImpl = vi.fn(async () => mcpServer);
    const createGatewayServerImpl = vi.fn();
    const createQueueTransport = vi.fn();

    const runtime = await startGateway({
      env: {},
      stderr: { write: vi.fn() },
      createMcpServerImpl,
      createStdioTransport: () => stdioTransport,
      createGatewayServerImpl,
      createQueueTransport,
    });

    expect(runtime.mode).toBe("stdio");
    expect(createMcpServerImpl).toHaveBeenCalledWith();
    expect(mcpServer.connect).toHaveBeenCalledWith(stdioTransport);
    expect(runtime.config.clientId).toMatch(/^chromeuse-gateway-\d+-[a-z0-9]+$/);
    expect(createGatewayServerImpl).not.toHaveBeenCalled();
    expect(createQueueTransport).not.toHaveBeenCalled();

    await runtime.close();
    expect(mcpServer.close).toHaveBeenCalledTimes(1);
  });

  it("shares one queued WebSocket transport between local stdio MCP and remote HTTP tool calls", async () => {
    const bridge = new FakeBrowserTransport();
    const queue = new FakeBrowserTransport();
    const httpServer = new FakeHttpServer();
    const mcpServer = { connect: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const stdioTransport = { kind: "stdio" };
    const createWebSocketBridge = vi.fn(() => bridge);
    const createQueueTransport = vi.fn(() => queue);
    const createMcpServerImpl = vi.fn(async () => mcpServer);
    const createGatewayServerImpl = vi.fn(() => httpServer as never);
    const env = {
      CHROMEUSE_GATEWAY_MODE: "server",
      CHROMEUSE_HTTP_PORT: "0",
      CHROMEUSE_CLIENT_ID: "runtime-client",
    };

    const stderr = { write: vi.fn() };
    const runtime = await startGateway({
      env,
      stderr,
      createWebSocketBridge,
      createQueueTransport,
      createMcpServerImpl,
      createStdioTransport: () => stdioTransport,
      createGatewayServerImpl,
    });

    expect(runtime.mode).toBe("server");
    expect(createWebSocketBridge).toHaveBeenCalledWith({
      env: { CHROMEUSE_WS_PORT: undefined },
    });
    expect(createQueueTransport).toHaveBeenCalledWith(bridge);
    expect(queue.connect).toHaveBeenCalledTimes(1);
    expect(createMcpServerImpl).toHaveBeenCalledWith(queue);
    expect(createGatewayServerImpl).toHaveBeenCalledWith({
      transport: expect.anything(),
      clientId: "runtime-client",
      logger: expect.any(Function),
    });
    expect(mcpServer.connect).toHaveBeenCalledWith(stdioTransport);
    const serverTransport = createGatewayServerImpl.mock.calls[0]?.[0].transport;
    expect(serverTransport).not.toBe(queue);
    expect(serverTransport.connected).toBe(true);
    expect(httpServer.listen).toHaveBeenCalledWith(0, "127.0.0.1");
    expect(stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("mode=SERVER event=startup")
    );
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining("pid="));
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining("http_port=0"));
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining("ws_port=8765"));
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining("client_id=runtime-client"));

    await runtime.close();
    expect(httpServer.close).toHaveBeenCalledTimes(1);
    expect(queue.disconnect).toHaveBeenCalledTimes(1);
    expect(mcpServer.close).toHaveBeenCalledTimes(1);
  });

  it("preserves FIFO ordering across local MCP and remote HTTP gateway requests", async () => {
    const gatewayPort = await getUnusedPort();
    const bridge = new FakeBrowserTransport();
    const localDeferred = new Deferred<ToolRequestResult>();
    const remoteDeferred = new Deferred<ToolRequestResult>();
    bridge.sendToolRequest
      .mockImplementationOnce(() => localDeferred.promise)
      .mockImplementationOnce(() => remoteDeferred.promise);
    let localTransport: BrowserTransport | undefined;
    const runtime = await startGateway({
      env: {
        CHROMEUSE_GATEWAY_MODE: "server",
        CHROMEUSE_HTTP_PORT: String(gatewayPort),
        CHROMEUSE_CLIENT_ID: "fifo-runtime",
      },
      stderr: { write: vi.fn() },
      createWebSocketBridge: vi.fn(() => bridge),
      createMcpServerImpl: vi.fn(async (transport?: BrowserTransport) => {
        localTransport = transport;
        return { connect: vi.fn(async () => {}), close: vi.fn(async () => {}) };
      }),
      createStdioTransport: () => ({ kind: "stdio:fifo" }),
    });

    try {
      if (!localTransport) throw new Error("local transport was not captured");

      const local = localTransport.sendToolRequest("local-first", { order: 1 }, 111);
      const remote = fetch(`http://127.0.0.1:${gatewayPort}/tool`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool: "remote-second", args: { order: 2 }, timeoutMs: 222 }),
      });

      await Promise.resolve();
      await Promise.resolve();
      expect(bridge.sendToolRequest).toHaveBeenCalledTimes(1);
      expect(bridge.sendToolRequest).toHaveBeenNthCalledWith(1, "local-first", { order: 1 }, 111);

      localDeferred.resolve({ content: [{ type: "text", text: "local" }] });
      await expect(local).resolves.toEqual({ content: [{ type: "text", text: "local" }] });

      await vi.waitFor(() => {
        expect(bridge.sendToolRequest).toHaveBeenCalledTimes(2);
      });
      expect(bridge.sendToolRequest).toHaveBeenNthCalledWith(2, "remote-second", { order: 2 }, 222);
      remoteDeferred.resolve({ content: [{ type: "text", text: "remote" }] });
      const remoteResponse = await remote;

      expect(remoteResponse.status).toBe(200);
      await expect(remoteResponse.json()).resolves.toEqual({
        content: [{ type: "text", text: "remote" }],
      });
    } finally {
      await runtime.close();
    }
  });

  it("becomes proxy after an existing compatible gateway owns the HTTP port without creating WebSocket bridge", async () => {
    const httpBindError = Object.assign(new Error("address already in use"), {
      code: "EADDRINUSE",
    });
    const httpServer = new FakeHttpServer(httpBindError);
    const proxyTransport = new FakeBrowserTransport();
    const mcpServer = { connect: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const stdioTransport = { kind: "stdio" };
    const createWebSocketBridge = vi.fn(() => new FakeBrowserTransport());
    const createMcpServerImpl = vi.fn(async () => mcpServer);
    const createGatewayServerImpl = vi.fn(() => httpServer as never);
    const createHttpGatewayTransport = vi.fn(() => proxyTransport);
    const stderr = { write: vi.fn() };

    const runtime = await startGateway({
      env: { CHROMEUSE_GATEWAY_MODE: "server", CHROMEUSE_HTTP_PORT: "8766" },
      stderr,
      createWebSocketBridge,
      createMcpServerImpl,
      createStdioTransport: () => stdioTransport,
      createGatewayServerImpl,
      createHttpGatewayTransport,
    });

    expect(runtime.mode).toBe("proxy");
    expect(createWebSocketBridge).not.toHaveBeenCalled();
    expect(proxyTransport.connect).toHaveBeenCalledTimes(1);
    expect(createHttpGatewayTransport).toHaveBeenCalledWith(
      "http://127.0.0.1:8766",
      expect.objectContaining({ logger: expect.any(Function) })
    );
    expect(createMcpServerImpl).toHaveBeenCalledWith(proxyTransport);
    expect(mcpServer.connect).toHaveBeenCalledWith(stdioTransport);
    expect(stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("mode=PROXY event=startup")
    );

    await runtime.close();
    expect(proxyTransport.disconnect).toHaveBeenCalledTimes(1);
    expect(mcpServer.close).toHaveBeenCalledTimes(1);
  });

  it("elects one real HTTP gateway server and proxies a second runtime through compatible /health", async () => {
    const gatewayPort = await getUnusedPort();
    const firstQueue = new FakeBrowserTransport();
    const secondMcpServer = { connect: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const firstRuntime = await startGateway({
      env: {
        CHROMEUSE_GATEWAY_MODE: "server",
        CHROMEUSE_HTTP_PORT: String(gatewayPort),
        CHROMEUSE_CLIENT_ID: "first-runtime",
      },
      stderr: { write: vi.fn() },
      createWebSocketBridge: vi.fn(() => new FakeBrowserTransport()),
      createQueueTransport: vi.fn(() => firstQueue),
      createMcpServerImpl: vi.fn(async () => ({
        connect: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
      })),
      createStdioTransport: () => ({ kind: "stdio:first" }),
    });

    let secondRuntime: Awaited<ReturnType<typeof startGateway>> | undefined;
    try {
      const secondBridgeFactory = vi.fn(() => new FakeBrowserTransport());
      secondRuntime = await startGateway({
        env: {
          CHROMEUSE_GATEWAY_MODE: "server",
          CHROMEUSE_HTTP_PORT: String(gatewayPort),
          CHROMEUSE_CLIENT_ID: "second-runtime",
        },
        stderr: { write: vi.fn() },
        createWebSocketBridge: secondBridgeFactory,
        createMcpServerImpl: vi.fn(async () => secondMcpServer),
        createStdioTransport: () => ({ kind: "stdio:second" }),
      });

      const healthResponse = await fetch(`http://127.0.0.1:${gatewayPort}/health`);

      expect(firstRuntime.mode).toBe("server");
      expect(secondRuntime.mode).toBe("proxy");
      expect(secondRuntime.config.mode).toBe("proxy");
      expect(secondBridgeFactory).not.toHaveBeenCalled();
      expect(secondMcpServer.connect).toHaveBeenCalledWith({ kind: "stdio:second" });
      await expect(healthResponse.json()).resolves.toMatchObject({
        gateway: "chromeuse-http-gateway",
        protocol: "chromeuse-http-gateway",
        client_id: "first-runtime",
      });
    } finally {
      await secondRuntime?.close();
      await firstRuntime.close();
    }
  });

  it("rejects proxy election against a real incompatible HTTP gateway health response", async () => {
    const gatewayPort = await getUnusedPort();
    const incompatibleServer = await startIncompatibleHealthServer(gatewayPort);
    const createWebSocketBridge = vi.fn(() => new FakeBrowserTransport());

    try {
      await expect(
        startGateway({
          env: {
            CHROMEUSE_GATEWAY_MODE: "server",
            CHROMEUSE_HTTP_PORT: String(gatewayPort),
          },
          stderr: { write: vi.fn() },
          createWebSocketBridge,
          createMcpServerImpl: vi.fn(),
          createStdioTransport: () => ({ kind: "stdio" }),
        })
      ).rejects.toThrow("did not pass compatible /health probe");

      expect(createWebSocketBridge).not.toHaveBeenCalled();
    } finally {
      await closeNodeHttpServer(incompatibleServer);
    }
  });

  it("releases the real HTTP port after partial server startup fails", async () => {
    const gatewayPort = await getUnusedPort();
    const queue = new FakeBrowserTransport();
    queue.connect.mockRejectedValueOnce(new Error("WebSocket bridge unavailable"));

    await expect(
      startGateway({
        env: {
          CHROMEUSE_GATEWAY_MODE: "server",
          CHROMEUSE_HTTP_PORT: String(gatewayPort),
        },
        stderr: { write: vi.fn() },
        createWebSocketBridge: vi.fn(() => new FakeBrowserTransport()),
        createQueueTransport: vi.fn(() => queue),
        createMcpServerImpl: vi.fn(),
        createStdioTransport: () => ({ kind: "stdio" }),
      })
    ).rejects.toThrow("HTTP listener closed");

    const replacementServer = createHttpServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => replacementServer.listen(gatewayPort, "127.0.0.1", resolve));

    try {
      const response = await fetch(`http://127.0.0.1:${gatewayPort}/health`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
    } finally {
      await closeNodeHttpServer(replacementServer);
    }
  });

  it("closes HTTP immediately when WebSocket bridge connection fails after winning election", async () => {
    const bridge = new FakeBrowserTransport();
    const queue = new FakeBrowserTransport();
    queue.connect.mockRejectedValueOnce(new Error("WebSocket port 8765 already in use"));
    const httpServer = new FakeHttpServer();
    const createGatewayServerImpl = vi.fn(() => httpServer as never);

    await expect(
      startGateway({
        env: { CHROMEUSE_GATEWAY_MODE: "server", CHROMEUSE_HTTP_PORT: "0" },
        stderr: { write: vi.fn() },
        createWebSocketBridge: vi.fn(() => bridge),
        createQueueTransport: vi.fn(() => queue),
        createMcpServerImpl: vi.fn(),
        createStdioTransport: () => ({ kind: "stdio" }),
        createGatewayServerImpl,
      })
    ).rejects.toThrow("Unable to start ChromeUse MCP gateway server");

    expect(httpServer.listen).toHaveBeenCalledWith(0, "127.0.0.1");
    expect(queue.connect).toHaveBeenCalledTimes(1);
    expect(httpServer.close).toHaveBeenCalledTimes(1);
  });

  it("reports proxy startup failures separately after compatible health succeeds", async () => {
    const httpBindError = Object.assign(new Error("address already in use"), {
      code: "EADDRINUSE",
    });
    const httpServer = new FakeHttpServer(httpBindError);
    const proxyTransport = new FakeBrowserTransport();
    const mcpServer = {
      connect: vi.fn(async () => {
        throw new Error("stdio refused");
      }),
      close: vi.fn(async () => {}),
    };
    const stderr = { write: vi.fn() };

    await expect(
      startGateway({
        env: { CHROMEUSE_GATEWAY_MODE: "server", CHROMEUSE_HTTP_PORT: "8766" },
        stderr,
        createWebSocketBridge: vi.fn(() => new FakeBrowserTransport()),
        createMcpServerImpl: vi.fn(async () => mcpServer),
        createStdioTransport: () => ({ kind: "stdio" }),
        createGatewayServerImpl: vi.fn(() => httpServer as never),
        createHttpGatewayTransport: vi.fn(() => proxyTransport),
      })
    ).rejects.toThrow("proxy startup failed after compatible /health");

    expect(proxyTransport.connect).toHaveBeenCalledTimes(1);
    expect(stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("proxy startup failed after compatible /health")
    );
    expect(mcpServer.close).toHaveBeenCalledTimes(1);
  });
});
