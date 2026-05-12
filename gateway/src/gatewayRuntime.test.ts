import { EventEmitter } from "node:events";
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

describe("gateway runtime", () => {
  it("defaults to stdio mode unless server mode is explicit", () => {
    expect(resolveGatewayConfig({}).mode).toBe("stdio");
    expect(resolveGatewayConfig({ CHROMEUSE_GATEWAY_MODE: "stdio" }).mode).toBe("stdio");
    expect(resolveGatewayConfig({ CHROMEUSE_GATEWAY_MODE: "server" }).mode).toBe("server");
    expect(resolveGatewayConfig({ CHROMEUSE_GATEWAY_MODE: "SERVER" }).mode).toBe("server");
  });

  it("uses local HTTP gateway host and port env in server mode", () => {
    expect(
      resolveGatewayConfig({
        CHROMEUSE_GATEWAY_MODE: "server",
        CHROMEUSE_GATEWAY_HOST: "127.0.0.2",
        CHROMEUSE_GATEWAY_PORT: "9123",
      })
    ).toEqual({ mode: "server", gatewayHost: "127.0.0.2", gatewayPort: 9123 });
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

    const runtime = await startGateway({
      env: { CHROMEUSE_GATEWAY_MODE: "server", CHROMEUSE_GATEWAY_PORT: "0" },
      stderr: { write: vi.fn() },
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
    expect(mcpServer.connect).toHaveBeenCalledWith(stdioTransport);
    const serverTransport = createGatewayServerImpl.mock.calls[0]?.[0].transport;
    expect(serverTransport).not.toBe(queue);
    expect(serverTransport.connected).toBe(true);
    expect(httpServer.listen).toHaveBeenCalledWith(0, "127.0.0.1");

    await runtime.close();
    expect(httpServer.close).toHaveBeenCalledTimes(1);
    expect(queue.disconnect).toHaveBeenCalledTimes(1);
    expect(mcpServer.close).toHaveBeenCalledTimes(1);
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

    const runtime = await startGateway({
      env: { CHROMEUSE_GATEWAY_MODE: "server", CHROMEUSE_GATEWAY_PORT: "8766" },
      stderr: { write: vi.fn() },
      createWebSocketBridge,
      createMcpServerImpl,
      createStdioTransport: () => stdioTransport,
      createGatewayServerImpl,
      createHttpGatewayTransport,
    });

    expect(runtime.mode).toBe("proxy");
    expect(createWebSocketBridge).not.toHaveBeenCalled();
    expect(proxyTransport.connect).toHaveBeenCalledTimes(1);
    expect(createHttpGatewayTransport).toHaveBeenCalledWith("http://127.0.0.1:8766");
    expect(createMcpServerImpl).toHaveBeenCalledWith(proxyTransport);
    expect(mcpServer.connect).toHaveBeenCalledWith(stdioTransport);

    await runtime.close();
    expect(proxyTransport.disconnect).toHaveBeenCalledTimes(1);
    expect(mcpServer.close).toHaveBeenCalledTimes(1);
  });

  it("closes HTTP immediately when WebSocket bridge connection fails after winning election", async () => {
    const bridge = new FakeBrowserTransport();
    const queue = new FakeBrowserTransport();
    queue.connect.mockRejectedValueOnce(new Error("WebSocket port 8765 already in use"));
    const httpServer = new FakeHttpServer();
    const createGatewayServerImpl = vi.fn(() => httpServer as never);

    await expect(
      startGateway({
        env: { CHROMEUSE_GATEWAY_MODE: "server", CHROMEUSE_GATEWAY_PORT: "0" },
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
        env: { CHROMEUSE_GATEWAY_MODE: "server", CHROMEUSE_GATEWAY_PORT: "8766" },
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
