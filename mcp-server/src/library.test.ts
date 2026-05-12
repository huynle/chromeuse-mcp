import { describe, expect, it } from "vitest";
import {
  WebSocketBridge,
  WebSocketFirstTransport,
  createMcpServer,
  getToolSchemas,
} from "./library.js";
import type {
  BrowserTransport,
  ToolRequestResult,
  WebSocketBridgeOptions,
} from "./library.js";

describe("library exports", () => {
  it("exports reusable server APIs without starting stdio", () => {
    expect(createMcpServer).toBeTypeOf("function");
    expect(WebSocketFirstTransport).toBeTypeOf("function");
    expect(WebSocketBridge).toBeTypeOf("function");
    expect(getToolSchemas().length).toBeGreaterThan(0);
  });

  it("exports browser transport types", () => {
    const transport: BrowserTransport = {
      connected: true,
      connect: async () => {},
      sendToolRequest: async (): Promise<ToolRequestResult> => ({
        content: [{ type: "text", text: "ok" }],
      }),
      disconnect: () => {},
    };

    expect(transport.connected).toBe(true);
  });

  it("exports WebSocket bridge configuration types", () => {
    const options: WebSocketBridgeOptions = { host: "127.0.0.1", port: 0 };

    expect(options.port).toBe(0);
  });
});
