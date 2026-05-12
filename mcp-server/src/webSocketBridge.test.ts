import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { WebSocketBridge } from "./webSocketBridge.js";

function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();

  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function waitForClose(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();

  return new Promise((resolve) => {
    socket.once("close", () => resolve());
  });
}

function waitForMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => {
      try {
        resolve(JSON.parse(data.toString()) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}

function createMessageReader(socket: WebSocket): () => Promise<Record<string, unknown>> {
  const queue: Record<string, unknown>[] = [];
  const waiting: Array<(message: Record<string, unknown>) => void> = [];

  socket.on("message", (data) => {
    const message = JSON.parse(data.toString()) as Record<string, unknown>;
    const resolve = waiting.shift();
    if (resolve) {
      resolve(message);
    } else {
      queue.push(message);
    }
  });

  return () => {
    const message = queue.shift();
    if (message) return Promise.resolve(message);

    return new Promise((resolve) => {
      waiting.push(resolve);
    });
  };
}

describe("WebSocketBridge", () => {
  const bridges: WebSocketBridge[] = [];
  const sockets: WebSocket[] = [];

  async function createBridge(port = 0): Promise<WebSocketBridge> {
    const bridge = new WebSocketBridge({ port });
    bridges.push(bridge);
    await bridge.connect();
    return bridge;
  }

  async function createExtension(bridge: WebSocketBridge): Promise<WebSocket> {
    const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
    sockets.push(socket);
    await waitForOpen(socket);
    return socket;
  }

  afterEach(async () => {
    vi.useRealTimers();

    for (const socket of sockets.splice(0)) {
      if (socket.readyState === WebSocket.OPEN) socket.close();
    }

    for (const bridge of bridges.splice(0)) {
      await bridge.close();
    }
  });

  it("uses 127.0.0.1 and port 8765 by default", () => {
    const bridge = new WebSocketBridge();

    expect(bridge.host).toBe("127.0.0.1");
    expect(bridge.port).toBe(8765);
  });

  it("uses CHROMEUSE_WS_PORT unless an injectable port is provided", () => {
    const envBridge = new WebSocketBridge({
      env: { CHROMEUSE_WS_PORT: "9876" },
    });
    const injectedBridge = new WebSocketBridge({
      env: { CHROMEUSE_WS_PORT: "9876" },
      port: 0,
    });

    expect(envBridge.port).toBe(9876);
    expect(injectedBridge.port).toBe(0);
  });

  it("sends tool requests and resolves matching responses", async () => {
    const bridge = await createBridge();
    const extension = await createExtension(bridge);

    const response = bridge.sendToolRequest("navigate", {
      action: "goto",
      url: "https://example.com",
    });

    const request = await waitForMessage(extension);
    expect(request).toMatchObject({
      type: "tool_request",
      method: "execute_tool",
      params: {
        request_id: expect.any(String),
        tool: "navigate",
        args: { action: "goto", url: "https://example.com" },
      },
    });

    const params = request.params as Record<string, unknown>;
    extension.send(
      JSON.stringify({
        type: "tool_response",
        request_id: params.request_id,
        result: { content: [{ type: "text", text: "navigated" }] },
      })
    );

    await expect(response).resolves.toEqual({
      content: [{ type: "text", text: "navigated" }],
    });
  });

  it("correlates concurrent requests by request_id", async () => {
    const bridge = await createBridge();
    const extension = await createExtension(bridge);
    const readMessage = createMessageReader(extension);

    const firstResponse = bridge.sendToolRequest("tabs_context", {});
    const secondResponse = bridge.sendToolRequest("tabs_create", {
      url: "https://example.com",
    });

    const firstRequest = await readMessage();
    const secondRequest = await readMessage();
    const firstRequestId = (firstRequest.params as Record<string, unknown>)
      .request_id;
    const secondRequestId = (secondRequest.params as Record<string, unknown>)
      .request_id;

    expect(firstRequestId).toEqual(expect.any(String));
    expect(secondRequestId).toEqual(expect.any(String));
    expect(secondRequestId).not.toBe(firstRequestId);

    extension.send(
      JSON.stringify({
        type: "tool_response",
        request_id: secondRequestId,
        result: { content: [{ type: "text", text: "second" }] },
      })
    );
    extension.send(
      JSON.stringify({
        type: "tool_response",
        request_id: firstRequestId,
        result: { content: [{ type: "text", text: "first" }] },
      })
    );

    await expect(firstResponse).resolves.toEqual({
      content: [{ type: "text", text: "first" }],
    });
    await expect(secondResponse).resolves.toEqual({
      content: [{ type: "text", text: "second" }],
    });
  });

  it("rejects tool requests when no extension is connected", async () => {
    const bridge = await createBridge();

    await expect(bridge.sendToolRequest("tabs_context", {})).rejects.toThrow(
      "No extension connected to WebSocket bridge"
    );
  });

  it("times out pending requests", async () => {
    const bridge = await createBridge();
    await createExtension(bridge);

    await expect(bridge.sendToolRequest("tabs_context", {}, 25)).rejects.toThrow(
      "Tool request timed out after 25ms: tabs_context"
    );
  });

  it("rejects and clears pending requests when the extension disconnects", async () => {
    const bridge = await createBridge();
    const extension = await createExtension(bridge);

    const request = bridge.sendToolRequest("tabs_context", {});
    await waitForMessage(extension);

    extension.close();

    await expect(request).rejects.toThrow("Extension disconnected");
    expect(bridge.connected).toBe(false);
  });

  it("ignores malformed and unmatched messages without crashing", async () => {
    const bridge = await createBridge();
    const extension = await createExtension(bridge);

    extension.send("{");

    const request = bridge.sendToolRequest("tabs_context", {}, 25);
    const toolRequest = await waitForMessage(extension);
    extension.send(
      JSON.stringify({
        type: "tool_response",
        request_id: "not-the-active-request",
        result: { content: [{ type: "text", text: "wrong" }] },
      })
    );

    expect((toolRequest.params as Record<string, unknown>).request_id).toEqual(
      expect.any(String)
    );
    await expect(request).rejects.toThrow(
      "Tool request timed out after 25ms: tabs_context"
    );
    expect(bridge.connected).toBe(true);
  });

  it("allows only one active extension connection", async () => {
    const bridge = await createBridge();
    const first = await createExtension(bridge);
    const second = await createExtension(bridge);

    await waitForClose(second);

    expect(first.readyState).toBe(WebSocket.OPEN);
    expect(bridge.connected).toBe(true);
  });

  it("rejects port-in-use errors without closing the existing bridge", async () => {
    const first = await createBridge();
    const second = new WebSocketBridge({ port: first.port });
    bridges.push(second);

    await expect(second.connect()).rejects.toThrow(/port .* already in use/i);

    const extension = await createExtension(first);
    expect(extension.readyState).toBe(WebSocket.OPEN);
  });
});
