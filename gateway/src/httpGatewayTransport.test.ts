import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { BrowserTransport, ToolRequestResult } from "@chromeuse/mcp-server";
import { createGatewayServer } from "./gatewayServer.js";
import { HttpGatewayTransport } from "./httpGatewayTransport.js";

class FakeTransport implements BrowserTransport {
  connected = true;
  readonly sendToolRequest = vi.fn(
    async (
      _tool: string,
      _args: Record<string, unknown>,
      _timeoutMs?: number
    ): Promise<ToolRequestResult> => ({
      content: [{ type: "text", text: "ok" }],
    })
  );

  async connect(): Promise<void> {}

  disconnect(): void {
    this.connected = false;
  }
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

async function startRealGatewayServer(
  transport = new FakeTransport()
): Promise<{ readonly baseUrl: string; readonly transport: FakeTransport }> {
  const server = createGatewayServer({ transport, clientId: "server-client" });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, transport };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function compatibleHealth(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gateway: "chromeuse-http-gateway",
    version: "1.0.0",
    protocol: "chromeuse-http-gateway",
    protocolVersion: "1.0.0",
    client_id: "server-client",
    ...overrides,
  };
}

describe("HttpGatewayTransport", () => {
  it("forwards through a real gateway server and preserves the raw ToolRequestResult shape", async () => {
    const { baseUrl, transport: serverTransport } = await startRealGatewayServer();
    serverTransport.sendToolRequest.mockResolvedValueOnce({
      content: [{ type: "text", text: "proxied" }],
      isError: true,
      metadata: { requestId: "abc", source: "extension" },
    });
    const proxyTransport = new HttpGatewayTransport(baseUrl);

    await proxyTransport.connect();
    const result = await proxyTransport.sendToolRequest("tabs_context", { includeClosed: false }, 321);

    expect(result).toEqual({
      content: [{ type: "text", text: "proxied" }],
      isError: true,
      metadata: { requestId: "abc", source: "extension" },
    });
    expect(serverTransport.sendToolRequest).toHaveBeenCalledWith(
      "tabs_context",
      { includeClosed: false },
      321
    );
  });

  it("uses the requested timeout for both HTTP abort and forwarded gateway timeout", async () => {
    const { baseUrl, transport: serverTransport } = await startRealGatewayServer();
    serverTransport.sendToolRequest.mockImplementationOnce(
      () => new Promise<ToolRequestResult>(() => {})
    );
    const proxyTransport = new HttpGatewayTransport(baseUrl);

    await proxyTransport.connect();
    // Use a comfortably large timeout so the request reliably reaches the
    // server (which forwards it and then hangs) before the proxy aborts. A
    // very small timeout races the localhost round-trip and is flaky on CI.
    await expect(proxyTransport.sendToolRequest("slow_tool", { tabId: 4 }, 200)).rejects.toThrow(
      "Tool request timed out after 200ms: slow_tool"
    );

    expect(proxyTransport.connected).toBe(false);
    await vi.waitFor(() =>
      expect(serverTransport.sendToolRequest).toHaveBeenCalledWith("slow_tool", { tabId: 4 }, 200)
    );
  });

  it("connects after compatible health and maps successful tool responses", async () => {
    const logger = vi.fn();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(compatibleHealth()))
      .mockResolvedValueOnce(
        jsonResponse({ content: [{ type: "text", text: "ok" }], metadata: { requestId: "abc" } })
      );
    const transport = new HttpGatewayTransport("http://127.0.0.1:34123/", {
      fetch,
      logger,
    });

    await transport.connect();
    const result = await transport.sendToolRequest("tabs_context", { tabId: 1 });

    expect(transport.connected).toBe(true);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:34123/health",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:34123/tool",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool: "tabs_context", args: { tabId: 1 }, timeoutMs: 60_000 }),
      })
    );
    expect(result).toEqual({
      content: [{ type: "text", text: "ok" }],
      metadata: { requestId: "abc" },
    });
    expect(logger).toHaveBeenCalledWith(expect.stringContaining("mode=PROXY event=request_start"));
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining("mode=PROXY event=request_end status=200")
    );
    expect(logger).toHaveBeenCalledWith(expect.stringContaining("tool=tabs_context"));
  });

  it("logs PROXY probe failures", async () => {
    const logger = vi.fn();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(compatibleHealth({ protocolVersion: "2.0.0" })));
    const transport = new HttpGatewayTransport("http://127.0.0.1:34123", { fetch, logger });

    await expect(transport.connect()).rejects.toThrow("Incompatible ChromeUse HTTP gateway");

    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining("mode=PROXY event=probe_failure")
    );
    expect(logger).toHaveBeenCalledWith(expect.stringContaining("base_url=http://127.0.0.1:34123"));
  });

  it("preserves raw gateway ToolRequestResult error responses", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(compatibleHealth()))
      .mockResolvedValueOnce(
        jsonResponse({ content: [{ type: "text", text: "bad tool" }], isError: true, code: "bad_tool" })
      );
    const transport = new HttpGatewayTransport("http://127.0.0.1:34123", { fetch });

    await transport.connect();
    const result = await transport.sendToolRequest("missing_tool", {});

    expect(result).toEqual({
      content: [{ type: "text", text: "bad tool" }],
      isError: true,
      code: "bad_tool",
    });
    expect(transport.connected).toBe(true);
  });

  it("rejects unavailable tool gateways and marks the transport disconnected", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(compatibleHealth()))
      .mockRejectedValueOnce(new Error("gateway unavailable"));
    const transport = new HttpGatewayTransport("http://127.0.0.1:34123", { fetch });

    await transport.connect();
    await expect(transport.sendToolRequest("tabs_context", {})).rejects.toThrow(
      "gateway unavailable"
    );

    expect(transport.connected).toBe(false);
  });

  it("aborts timed out tool requests and marks the transport disconnected", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(compatibleHealth()))
      .mockImplementationOnce((_url, init) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (!signal) return Promise.reject(new Error("missing abort signal"));
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      });
    const transport = new HttpGatewayTransport("http://127.0.0.1:34123", { fetch });

    await transport.connect();
    await expect(transport.sendToolRequest("tabs_context", {}, 1)).rejects.toThrow(
      "Tool request timed out after 1ms: tabs_context"
    );
    expect(transport.connected).toBe(false);
  });

  it("rejects incompatible health responses and remains disconnected", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(compatibleHealth({ protocolVersion: "2.0.0" })));
    const transport = new HttpGatewayTransport("http://127.0.0.1:34123", { fetch });

    await expect(transport.connect()).rejects.toThrow(
      "Incompatible ChromeUse HTTP gateway"
    );

    expect(transport.connected).toBe(false);
  });

  it("rejects health responses without gateway protocol identity", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse({ gateway: "chromeuse-http-gateway", version: "1.0.0" }));
    const transport = new HttpGatewayTransport("http://127.0.0.1:34123", { fetch });

    await expect(transport.connect()).rejects.toThrow("Incompatible ChromeUse HTTP gateway");

    expect(transport.connected).toBe(false);
  });

  it("disconnect is idempotent and prevents further tool requests", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(compatibleHealth()));
    const transport = new HttpGatewayTransport("http://127.0.0.1:34123", { fetch });

    await transport.connect();
    transport.disconnect();
    transport.disconnect();

    expect(transport.connected).toBe(false);
    await expect(transport.sendToolRequest("tabs_context", {})).rejects.toThrow(
      "Not connected to ChromeUse HTTP gateway"
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
