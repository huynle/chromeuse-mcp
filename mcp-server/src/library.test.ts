import { describe, expect, it } from "vitest";
import {
  WebSocketFirstTransport,
  createMcpServer,
  getToolSchemas,
} from "./library.js";
import type { BrowserTransport, ToolRequestResult } from "./library.js";

describe("library exports", () => {
  it("exports reusable server APIs without starting stdio", () => {
    expect(createMcpServer).toBeTypeOf("function");
    expect(WebSocketFirstTransport).toBeTypeOf("function");
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
});
