import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMcpServer, getToolSchemas } from "./server.js";
import { TOOL_NAMES, ALL_TOOL_NAMES } from "@opencode-chrome/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SocketClient } from "./socketClient.js";

// ---------------------------------------------------------------------------
// Tool schema tests
// ---------------------------------------------------------------------------

describe("getToolSchemas", () => {
  it("returns exactly 15 tool schemas", () => {
    const schemas = getToolSchemas();
    expect(schemas).toHaveLength(15);
  });

  it("includes all tool names from shared constants", () => {
    const schemas = getToolSchemas();
    const schemaNames = schemas.map((s) => s.name);

    for (const toolName of ALL_TOOL_NAMES) {
      expect(schemaNames).toContain(toolName);
    }
  });

  it("every schema has name, description, and inputSchema", () => {
    for (const schema of getToolSchemas()) {
      expect(schema.name).toBeTruthy();
      expect(schema.description).toBeTruthy();
      expect(schema.inputSchema).toBeDefined();
      expect(schema.inputSchema.type).toBe("object");
    }
  });

  it("navigate tool requires action", () => {
    const schema = getToolSchemas().find(
      (s) => s.name === TOOL_NAMES.NAVIGATE
    )!;
    expect(schema.inputSchema.required).toContain("action");
  });

  it("computer tool requires action", () => {
    const schema = getToolSchemas().find(
      (s) => s.name === TOOL_NAMES.COMPUTER
    )!;
    expect(schema.inputSchema.required).toContain("action");
  });

  it("javascript_tool requires code", () => {
    const schema = getToolSchemas().find(
      (s) => s.name === TOOL_NAMES.JAVASCRIPT
    )!;
    expect(schema.inputSchema.required).toContain("code");
  });

  it("resize_window requires width and height", () => {
    const schema = getToolSchemas().find(
      (s) => s.name === TOOL_NAMES.RESIZE_WINDOW
    )!;
    expect(schema.inputSchema.required).toContain("width");
    expect(schema.inputSchema.required).toContain("height");
  });

  it("tabs_close requires tabId", () => {
    const schema = getToolSchemas().find(
      (s) => s.name === TOOL_NAMES.TABS_CLOSE
    )!;
    expect(schema.inputSchema.required).toContain("tabId");
  });
});

// ---------------------------------------------------------------------------
// MCP server integration tests (using in-memory transport)
// ---------------------------------------------------------------------------

describe("createMcpServer", () => {
  let client: Client;
  let mockSocketClient: SocketClient;

  beforeEach(async () => {
    // Create a mock socket client
    mockSocketClient = new SocketClient();
    // Override connect to no-op
    vi.spyOn(mockSocketClient, "connect").mockResolvedValue(undefined);
    // Mark as connected
    Object.defineProperty(mockSocketClient, "connected", { get: () => true });

    const server = await createMcpServer(mockSocketClient);
    client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} }
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  it("lists all 15 tools via MCP protocol", async () => {
    const result = await client.listTools();
    expect(result.tools).toHaveLength(15);
  });

  it("tool names match shared constants", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    for (const toolName of ALL_TOOL_NAMES) {
      expect(names).toContain(toolName);
    }
  });

  it("returns error for unknown tool", async () => {
    const result = await client.callTool({
      name: "nonexistent_tool",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining("Unknown tool") }),
      ])
    );
  });

  it("forwards tool call to socket client", async () => {
    const sendSpy = vi.spyOn(mockSocketClient, "sendToolRequest").mockResolvedValue({
      content: [{ type: "text", text: "Navigated to: https://example.com" }],
    });

    const result = await client.callTool({
      name: "navigate",
      arguments: { action: "goto", url: "https://example.com" },
    });

    expect(sendSpy).toHaveBeenCalledWith("navigate", {
      action: "goto",
      url: "https://example.com",
    });
    expect(result.content).toEqual([
      { type: "text", text: "Navigated to: https://example.com" },
    ]);
  });

  it("returns error when socket client throws", async () => {
    vi.spyOn(mockSocketClient, "sendToolRequest").mockRejectedValue(
      new Error("Connection lost")
    );

    const result = await client.callTool({
      name: "computer",
      arguments: { action: "screenshot" },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining("Connection lost"),
        }),
      ])
    );
  });

  it("attempts reconnect when not connected", async () => {
    // Create a fresh socket client where we can control the connected state
    const freshClient = Object.create(SocketClient.prototype) as SocketClient;
    let isConnected = false;

    Object.defineProperty(freshClient, "connected", {
      get: () => isConnected,
      configurable: true,
    });

    const connectSpy = vi.fn(async () => {
      isConnected = true;
    });
    freshClient.connect = connectSpy;
    freshClient.sendToolRequest = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });

    // Create a server with the fresh client
    const server2 = await createMcpServer(freshClient);
    const client2 = new Client(
      { name: "test-client-2", version: "1.0.0" },
      { capabilities: {} }
    );
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([client2.connect(ct), server2.connect(st)]);

    await client2.callTool({
      name: "tabs_context",
      arguments: {},
    });

    expect(connectSpy).toHaveBeenCalled();
  });
});
