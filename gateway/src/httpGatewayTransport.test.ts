import { describe, expect, it, vi } from "vitest";
import { HttpGatewayTransport } from "./httpGatewayTransport.js";

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
  it("connects after compatible health and maps successful tool responses", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(compatibleHealth()))
      .mockResolvedValueOnce(
        jsonResponse({ result: { content: [{ type: "text", text: "ok" }] } })
      );
    const transport = new HttpGatewayTransport("http://127.0.0.1:34123/", {
      fetch,
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
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
  });

  it("maps gateway tool error responses to MCP error results", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(compatibleHealth()))
      .mockResolvedValueOnce(
        jsonResponse({ error: { content: [{ type: "text", text: "bad tool" }] } })
      );
    const transport = new HttpGatewayTransport("http://127.0.0.1:34123", { fetch });

    await transport.connect();
    const result = await transport.sendToolRequest("missing_tool", {});

    expect(result).toEqual({
      content: [{ type: "text", text: "bad tool" }],
      isError: true,
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
