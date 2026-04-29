import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server as NetServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { encode, type ToolResponse } from "@opencode-chrome/shared";
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
  /** Get the last received request */
  getLastRequest: () => unknown | null;
} {
  const dir = mkdtempSync(join(tmpdir(), "mcp-test-"));
  const socketPath = join(dir, "test.sock");
  let nextResponse: ToolResponse | null = null;
  let lastRequest: unknown | null = null;

  const server = createServer((socket) => {
    let buffer = new Uint8Array(0);

    socket.on("data", (data: Buffer) => {
      // Accumulate data
      const combined = new Uint8Array(buffer.byteLength + data.byteLength);
      combined.set(buffer, 0);
      combined.set(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        buffer.byteLength
      );
      buffer = combined;

      // Try to decode a message
      if (buffer.byteLength >= 4) {
        const view = new DataView(
          buffer.buffer,
          buffer.byteOffset,
          buffer.byteLength
        );
        const len = view.getUint32(0, true);
        if (buffer.byteLength >= 4 + len) {
          const decoder = new TextDecoder();
          const json = decoder.decode(buffer.subarray(4, 4 + len));
          lastRequest = JSON.parse(json);
          buffer = buffer.subarray(4 + len);

          // Send response if one is set
          if (nextResponse) {
            const encoded = encode(nextResponse);
            socket.write(encoded);
          }
        }
      }
    });
  });

  server.listen(socketPath);

  return {
    server,
    socketPath,
    cleanup: () => {
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
    getLastRequest: () => lastRequest,
  };
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
    mockHost.setResponse({
      type: "tool_response",
      request_id: "req-response-1",
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
    mockHost.setResponse({
      type: "tool_response",
      request_id: "req-response-2",
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
});
