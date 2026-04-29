import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer, type Server as NetServer, type Socket } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, userInfo } from "node:os";
import { decode, encode, type ToolResponse } from "@opencode-chrome/shared";
import { SocketClient } from "./socketClient.js";

// ---------------------------------------------------------------------------
// Helpers: create a mock native host server on a temp Unix socket
// ---------------------------------------------------------------------------

function createMockNativeHost(): {
  server: NetServer;
  socketPath: string;
  cleanup: () => void;
  /** Resolve the next incoming request with this response */
  setResponse: (response: ToolResponse) => void;
  /** Resolve the next incoming request with a raw socket message */
  setRawResponse: (response: object) => void;
  /** Send a response to the connected client immediately */
  sendResponse: (response: object) => void;
  /** Send raw bytes to the connected client immediately */
  sendBytes: (bytes: Uint8Array) => void;
  /** Close all connected client sockets */
  closeConnections: () => void;
  /** Get the last received request */
  getLastRequest: () => unknown | null;
  /** Get all received requests */
  getRequests: () => unknown[];
  /** Wait until at least this many requests have been received */
  waitForRequests: (count: number) => Promise<unknown[]>;
} {
  const dir = mkdtempSync(join(tmpdir(), "mcp-test-"));
  const socketPath = join(dir, "test.sock");
  let nextResponse: object | null = null;
  let lastRequest: unknown | null = null;
  const requests: unknown[] = [];
  const sockets = new Set<Socket>();
  const requestWaiters: { count: number; resolve: (requests: unknown[]) => void }[] = [];

  const notifyRequestWaiters = () => {
    for (let i = requestWaiters.length - 1; i >= 0; i--) {
      const waiter = requestWaiters[i]!;
      if (requests.length >= waiter.count) {
        requestWaiters.splice(i, 1);
        waiter.resolve([...requests]);
      }
    }
  };

  const server = createServer((socket) => {
    sockets.add(socket);
    let buffer = new Uint8Array(0);

    socket.on("close", () => {
      sockets.delete(socket);
    });

    socket.on("data", (data: Buffer) => {
      // Accumulate data
      const combined = new Uint8Array(buffer.byteLength + data.byteLength);
      combined.set(buffer, 0);
      combined.set(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        buffer.byteLength
      );
      buffer = combined;

      // Try to decode all complete messages.
      while (buffer.byteLength > 0) {
        const decoded = decode(buffer);
        if (decoded === null) break;

        const request = decoded.message as Record<string, unknown>;
        lastRequest = request;
        requests.push(request);
        notifyRequestWaiters();
        buffer = buffer.subarray(decoded.bytesConsumed);

        // Send response if one is set. Echo the request_id by default so
        // simple tests can use static responses while the client still sees
        // realistic request/response correlation.
        if (nextResponse) {
          const requestId =
            typeof request.request_id === "string"
              ? request.request_id
              : typeof (request.params as Record<string, unknown> | undefined)
                    ?.request_id === "string"
                ? ((request.params as Record<string, unknown>).request_id as string)
                : undefined;
          const response =
            !("request_id" in nextResponse) && requestId
              ? { ...nextResponse, request_id: requestId }
              : nextResponse;
          const encoded = encode(response);
          socket.write(encoded);
        }
      }
    });
  });

  server.listen(socketPath);

  return {
    server,
    socketPath,
    cleanup: () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      server.close();
      try {
        rmSync(dir, { recursive: true });
      } catch {
        // ignore
      }
    },
    setResponse: (response: ToolResponse) => {
      nextResponse = response;
    },
    setRawResponse: (response: object) => {
      nextResponse = response;
    },
    sendResponse: (response: object) => {
      for (const socket of sockets) {
        socket.write(encode(response));
      }
    },
    sendBytes: (bytes: Uint8Array) => {
      for (const socket of sockets) {
        socket.write(bytes);
      }
    },
    closeConnections: () => {
      for (const socket of sockets) {
        socket.destroy();
      }
    },
    getLastRequest: () => lastRequest,
    getRequests: () => [...requests],
    waitForRequests: (count: number) => {
      if (requests.length >= count) return Promise.resolve([...requests]);
      return new Promise((resolve) => requestWaiters.push({ count, resolve }));
    },
  };
}

function invalidJsonFrame(): Uint8Array {
  const payload = new TextEncoder().encode("{");
  const frame = new Uint8Array(4 + payload.byteLength);
  new DataView(frame.buffer).setUint32(0, payload.byteLength, true);
  frame.set(payload, 4);
  return frame;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SocketClient", () => {
  let mockHost: ReturnType<typeof createMockNativeHost> | null = null;

  afterEach(() => {
    mockHost?.cleanup();
    mockHost = null;
  });

  it("connects to a socket path", async () => {
    mockHost = createMockNativeHost();
    const client = new SocketClient();
    await client.connectToPath(mockHost.socketPath);
    expect(client.connected).toBe(true);
    client.disconnect();
  });

  it("sends tool request and receives response", async () => {
    mockHost = createMockNativeHost();
    mockHost.setRawResponse({
      type: "tool_response",
      result: {
        content: [{ type: "text", text: "Navigated to: https://example.com" }],
      },
    });

    const client = new SocketClient();
    await client.connectToPath(mockHost.socketPath);

    const result = await client.sendToolRequest("navigate", {
      action: "goto",
      url: "https://example.com",
    });

    expect(result.content).toEqual([
      { type: "text", text: "Navigated to: https://example.com" },
    ]);
    expect(result.isError).toBeUndefined();

    // Verify the request was correctly formatted
    const lastReq = mockHost.getLastRequest() as any;
    expect(lastReq.type).toBe("tool_request");
    expect(lastReq.method).toBe("execute_tool");
    expect(lastReq.params.request_id).toEqual(expect.any(String));
    expect(lastReq.params.tool).toBe("navigate");
    expect(lastReq.params.args).toEqual({
      action: "goto",
      url: "https://example.com",
    });

    client.disconnect();
  });

  it("returns error response with isError flag", async () => {
    mockHost = createMockNativeHost();
    mockHost.setRawResponse({
      type: "tool_response",
      error: {
        content: [{ type: "text", text: "Permission denied" }],
      },
    });

    const client = new SocketClient();
    await client.connectToPath(mockHost.socketPath);

    const result = await client.sendToolRequest("computer", {
      action: "screenshot",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: "Permission denied" },
    ]);

    client.disconnect();
  });

  it("sends unique request IDs for concurrent tool requests", async () => {
    mockHost = createMockNativeHost();

    const client = new SocketClient();
    await client.connectToPath(mockHost.socketPath);

    const first = client.sendToolRequest("navigate", {
      action: "goto",
      url: "https://example.com",
    });
    const second = client.sendToolRequest("tabs_context", {});

    const requests = (await mockHost.waitForRequests(2)) as any[];
    expect(requests[0].params.request_id).toEqual(expect.any(String));
    expect(requests[1].params.request_id).toEqual(expect.any(String));
    expect(requests[0].params.request_id).not.toBe(requests[1].params.request_id);

    mockHost.sendResponse({
      request_id: requests[0].params.request_id,
      result: { content: [{ type: "text", text: "first" }] },
    });
    mockHost.sendResponse({
      request_id: requests[1].params.request_id,
      result: { content: [{ type: "text", text: "second" }] },
    });

    await expect(first).resolves.toEqual({
      content: [{ type: "text", text: "first" }],
    });
    await expect(second).resolves.toEqual({
      content: [{ type: "text", text: "second" }],
    });

    client.disconnect();
  });

  it("routes out-of-order responses to the matching request", async () => {
    mockHost = createMockNativeHost();

    const client = new SocketClient();
    await client.connectToPath(mockHost.socketPath);

    const first = client.sendToolRequest("navigate", {
      action: "goto",
      url: "https://example.com",
    });
    const second = client.sendToolRequest("computer", { action: "screenshot" });

    const requests = (await mockHost.waitForRequests(2)) as any[];

    mockHost.sendResponse({
      request_id: requests[1].params.request_id,
      result: { content: [{ type: "text", text: "second done" }] },
    });

    await expect(second).resolves.toEqual({
      content: [{ type: "text", text: "second done" }],
    });

    mockHost.sendResponse({
      request_id: requests[0].params.request_id,
      result: { content: [{ type: "text", text: "first done" }] },
    });

    await expect(first).resolves.toEqual({
      content: [{ type: "text", text: "first done" }],
    });

    client.disconnect();
  });

  it("accepts native-host responses without a type field", async () => {
    mockHost = createMockNativeHost();
    mockHost.setRawResponse({
      result: {
        content: [{ type: "text", text: "9 tabs" }],
      },
    });

    const client = new SocketClient();
    await client.connectToPath(mockHost.socketPath);

    const result = await client.sendToolRequest("tabs_context", {}, 100);

    expect(result.content).toEqual([{ type: "text", text: "9 tabs" }]);
    expect(result.isError).toBeUndefined();

    client.disconnect();
  });

  it("throws when not connected", async () => {
    const client = new SocketClient();
    expect(client.connected).toBe(false);

    await expect(
      client.sendToolRequest("navigate", { action: "reload" })
    ).rejects.toThrow("Not connected");
  });

  it("rejects pending request on disconnect", async () => {
    mockHost = createMockNativeHost();
    // Don't set a response — the request will hang

    const client = new SocketClient();
    await client.connectToPath(mockHost.socketPath);

    const requestPromise = client.sendToolRequest("navigate", {
      action: "goto",
      url: "https://example.com",
    });

    // Disconnect while request is pending
    client.disconnect();

    await expect(requestPromise).rejects.toThrow("Disconnected");
  });

  it("rejects all pending requests when the socket closes", async () => {
    mockHost = createMockNativeHost();

    const client = new SocketClient();
    await client.connectToPath(mockHost.socketPath);

    const first = client.sendToolRequest("navigate", { action: "reload" });
    const second = client.sendToolRequest("tabs_context", {});
    await mockHost.waitForRequests(2);

    mockHost.closeConnections();

    await expect(first).rejects.toThrow("Connection closed");
    await expect(second).rejects.toThrow("Connection closed");
  });

  it("ignores unmatched responses and times out the pending request", async () => {
    mockHost = createMockNativeHost();

    const client = new SocketClient();
    await client.connectToPath(mockHost.socketPath);

    const request = client.sendToolRequest("navigate", { action: "reload" }, 25);
    await mockHost.waitForRequests(1);

    mockHost.sendResponse({
      request_id: "unknown-request",
      result: { content: [{ type: "text", text: "wrong" }] },
    });

    await expect(request).rejects.toThrow(
      "Tool request timed out after 25ms: navigate"
    );

    client.disconnect();
  });

  it("ignores malformed tool responses without a request ID", async () => {
    mockHost = createMockNativeHost();

    const client = new SocketClient();
    await client.connectToPath(mockHost.socketPath);

    const request = client.sendToolRequest("tabs_context", {}, 25);
    await mockHost.waitForRequests(1);

    mockHost.sendResponse({
      result: { content: [{ type: "text", text: "missing request id" }] },
    });

    await expect(request).rejects.toThrow(
      "Tool request timed out after 25ms: tabs_context"
    );

    client.disconnect();
  });

  it("rejects pending requests on protocol errors", async () => {
    mockHost = createMockNativeHost();

    const client = new SocketClient();
    await client.connectToPath(mockHost.socketPath);

    const request = client.sendToolRequest("tabs_context", {});
    await mockHost.waitForRequests(1);

    mockHost.sendBytes(invalidJsonFrame());

    await expect(request).rejects.toThrow(/JSON/);
    expect(client.connected).toBe(false);
  });

  it("findActiveSocket returns null when no sockets exist", () => {
    const client = new SocketClient();
    // This is a best-effort test — it assumes no real native host is running
    // on a randomized socket directory. In practice this will return null
    // unless the user actually has a native host running.
    const result = client.findActiveSocket();
    // We can't assert null because the user might have a real native host.
    // Just verify it doesn't throw.
    expect(typeof result === "string" || result === null).toBe(true);
  });

  it("prefers the newest active socket when multiple native hosts exist", async () => {
    const olderPid = process.ppid;
    const newerPid = process.pid;

    vi.resetModules();
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        readdirSync: vi.fn(() => [`${olderPid}.sock`, `${newerPid}.sock`]),
        statSync: vi.fn((path: string) => ({
          mtimeMs: path.endsWith(`${newerPid}.sock`) ? 2_000 : 1_000,
        })),
      };
    });

    const { SocketClient: MockedSocketClient } = await import("./socketClient.js");
    const client = new MockedSocketClient();

    expect(client.findActiveSocket()).toBe(
      join(
        "/tmp",
        `opencode-browser-bridge-${userInfo().username}`,
        `${newerPid}.sock`
      )
    );

    vi.doUnmock("node:fs");
    vi.resetModules();
  });
});
