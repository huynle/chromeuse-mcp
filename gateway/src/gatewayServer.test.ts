import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { BrowserTransport, ToolRequestResult } from "@chromeuse/mcp-server";
import { createGatewayServer } from "./gatewayServer.js";

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

async function startServer(
  transport = new FakeTransport(),
  logger?: (message: string) => void
): Promise<{
  readonly baseUrl: string;
  readonly transport: FakeTransport;
}> {
  const server = createGatewayServer({ transport, clientId: "test-client", logger });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, transport };
}

describe("createGatewayServer", () => {
  it("exposes gateway health", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      gateway: "chromeuse-http-gateway",
      version: "1.0.0",
      protocol: "chromeuse-http-gateway",
      protocolVersion: "1.0.0",
      client_id: "test-client",
      extensionConnected: true,
    });
  });

  it("reports disconnected extension state from /health", async () => {
    const transport = new FakeTransport();
    transport.disconnect();
    const { baseUrl } = await startServer(transport);

    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      gateway: "chromeuse-http-gateway",
      extensionConnected: false,
    });
  });

  it("forwards POST /tool requests and returns the ToolRequestResult shape", async () => {
    const { baseUrl, transport } = await startServer();
    transport.sendToolRequest.mockResolvedValueOnce({
      content: [{ type: "text", text: "forwarded" }],
      metadata: { requestId: "abc" },
    });

    const response = await fetch(`${baseUrl}/tool`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tool: "tabs_context",
        args: { includeClosed: false },
        timeoutMs: 123,
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      content: [{ type: "text", text: "forwarded" }],
      metadata: { requestId: "abc" },
    });
    expect(transport.sendToolRequest).toHaveBeenCalledWith(
      "tabs_context",
      { includeClosed: false },
      123
    );
  });

  it("logs SERVER request start and end without writing stdout", async () => {
    const logger = vi.fn();
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const { baseUrl } = await startServer(new FakeTransport(), logger);

    const response = await fetch(`${baseUrl}/tool`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: "tabs_context", args: {} }),
    });

    expect(response.status).toBe(200);
    expect(logger).toHaveBeenCalledWith(expect.stringContaining("mode=SERVER event=request_start"));
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining("mode=SERVER event=request_end status=200")
    );
    expect(logger).toHaveBeenCalledWith(expect.stringContaining("tool=tabs_context"));
    expect(stdoutWrite).not.toHaveBeenCalled();
    stdoutWrite.mockRestore();
  });

  it("accepts name and arguments aliases for POST /tool", async () => {
    const { baseUrl, transport } = await startServer();

    const response = await fetch(`${baseUrl}/tool`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "read_page", arguments: { tabId: 7 } }),
    });

    expect(response.status).toBe(200);
    expect(transport.sendToolRequest).toHaveBeenCalledWith(
      "read_page",
      { tabId: 7 },
      undefined
    );
  });

  it("returns a clean ToolRequestResult error for invalid JSON", async () => {
    const { baseUrl, transport } = await startServer();

    const response = await fetch(`${baseUrl}/tool`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      content: [{ type: "text", text: "Invalid JSON request body" }],
      isError: true,
    });
    expect(transport.sendToolRequest).not.toHaveBeenCalled();
  });

  it("returns a clean ToolRequestResult error for invalid request bodies", async () => {
    const { baseUrl, transport } = await startServer();

    const response = await fetch(`${baseUrl}/tool`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: "tabs_context", args: [] }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      content: [{ type: "text", text: "Invalid tool request body" }],
      isError: true,
    });
    expect(transport.sendToolRequest).not.toHaveBeenCalled();
  });

  it("fails cleanly when no extension is connected", async () => {
    const transport = new FakeTransport();
    transport.connected = false;
    const { baseUrl } = await startServer(transport);

    const response = await fetch(`${baseUrl}/tool`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: "tabs_context", args: {} }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      content: [{ type: "text", text: "No extension connected" }],
      isError: true,
    });
  });
});
