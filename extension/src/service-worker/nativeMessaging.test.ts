import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ConnectionStatus } from "../types/messages.js";

// ---------------------------------------------------------------------------
// Chrome API mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

const mockPort = {
  onMessage: { addListener: vi.fn() },
  onDisconnect: { addListener: vi.fn() },
  postMessage: vi.fn(),
  disconnect: vi.fn(),
};

const chromeStub = {
  runtime: {
    connectNative: vi.fn(() => mockPort),
    sendMessage: vi.fn(() => Promise.resolve()),
    lastError: null as { message: string } | null,
    getManifest: vi.fn(() => ({ version: "0.1.0" })),
  },
  action: {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(),
  },
};

// Assign to globalThis so the module sees `chrome.*`
Object.assign(globalThis, { chrome: chromeStub });

// Now import the module (after chrome global is set)
const { NativeMessagingConnection } = await import("./nativeMessaging.js");
const { messageRouter } = await import("./messageRouter.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshConnection() {
  return new NativeMessagingConnection();
}

/** Trigger the onMessage listener that was registered during connect() */
function fireMessage(msg: unknown) {
  const listener = mockPort.onMessage.addListener.mock.calls.at(-1)?.[0];
  expect(listener).toBeDefined();
  listener(msg);
}

/** Trigger the onDisconnect listener that was registered during connect() */
function fireDisconnect() {
  const listener = mockPort.onDisconnect.addListener.mock.calls.at(-1)?.[0];
  expect(listener).toBeDefined();
  listener();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NativeMessagingConnection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    chromeStub.runtime.lastError = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -- connect / disconnect ------------------------------------------------

  describe("connect", () => {
    it("connects to the correct native host", () => {
      const conn = freshConnection();
      conn.connect();
      expect(chromeStub.runtime.connectNative).toHaveBeenCalledWith(
        "com.chromeuse.mcp_bridge",
      );
    });

    it("sets status to connected on success", () => {
      const conn = freshConnection();
      conn.connect();
      expect(conn.status).toBe("connected");
    });

    it("creates keepalive alarm", () => {
      const conn = freshConnection();
      conn.connect();
      expect(chromeStub.alarms.create).toHaveBeenCalledWith("keepalive", {
        periodInMinutes: 0.4,
      });
    });

    it("registers message and disconnect listeners", () => {
      const conn = freshConnection();
      conn.connect();
      expect(mockPort.onMessage.addListener).toHaveBeenCalledOnce();
      expect(mockPort.onDisconnect.addListener).toHaveBeenCalledOnce();
    });
  });

  describe("disconnect", () => {
    it("disconnects the port and clears keepalive", () => {
      const conn = freshConnection();
      conn.connect();
      conn.disconnect();
      expect(mockPort.disconnect).toHaveBeenCalledOnce();
      expect(chromeStub.alarms.clear).toHaveBeenCalledWith("keepalive");
      expect(conn.status).toBe("disconnected");
    });

    it("cancels pending reconnect timer", () => {
      const conn = freshConnection();
      conn.connect();

      // Trigger disconnect to start reconnect timer
      fireDisconnect();
      expect(conn.status).toBe("disconnected");

      // Now explicitly disconnect — should cancel the timer
      conn.disconnect();

      // Advance time past the reconnect delay — should NOT reconnect
      vi.advanceTimersByTime(5000);
      // Only the initial connect call
      expect(chromeStub.runtime.connectNative).toHaveBeenCalledTimes(1);
    });
  });

  // -- sendMessage ---------------------------------------------------------

  describe("sendMessage", () => {
    it("posts message to the port", () => {
      const conn = freshConnection();
      conn.connect();
      const msg = { type: "pong" as const, timestamp: 123 };
      conn.sendMessage(msg);
      expect(mockPort.postMessage).toHaveBeenCalledWith(msg);
    });

    it("throws if not connected", () => {
      const conn = freshConnection();
      expect(() =>
        conn.sendMessage({ type: "pong", timestamp: 0 }),
      ).toThrow("Not connected to native host");
    });
  });

  // -- sendToolResponse ----------------------------------------------------

  describe("sendToolResponse", () => {
    it("sends success response", () => {
      const conn = freshConnection();
      conn.connect();
      conn.sendToolResponse(
        {
          success: true,
          content: [{ type: "text", text: "ok" }],
        },
        "req-success",
      );
      expect(mockPort.postMessage).toHaveBeenCalledWith({
        type: "tool_response",
        request_id: "req-success",
        result: { content: [{ type: "text", text: "ok" }] },
      });
    });

    it("sends error response", () => {
      const conn = freshConnection();
      conn.connect();
      conn.sendToolResponse(
        {
          success: false,
          content: [{ type: "text", text: "fail" }],
        },
        "req-error",
      );
      expect(mockPort.postMessage).toHaveBeenCalledWith({
        type: "tool_response",
        request_id: "req-error",
        error: { content: [{ type: "text", text: "fail" }] },
      });
    });
  });

  // -- reconnect with exponential backoff ----------------------------------

  describe("reconnect", () => {
    it("schedules reconnect on disconnect with exponential backoff", () => {
      const conn = freshConnection();
      conn.connect();

      const initialCalls = chromeStub.runtime.connectNative.mock.calls.length;

      // First disconnect -> 1s delay (attempt 0: 2^0 * 1000 = 1000ms)
      fireDisconnect();
      vi.advanceTimersByTime(999);
      expect(chromeStub.runtime.connectNative).toHaveBeenCalledTimes(
        initialCalls,
      );
      vi.advanceTimersByTime(1);
      expect(chromeStub.runtime.connectNative).toHaveBeenCalledTimes(
        initialCalls + 1,
      );

      // Successful reconnect resets the counter, so next disconnect
      // starts from attempt 0 again -> 1s delay
      fireDisconnect();
      vi.advanceTimersByTime(999);
      expect(chromeStub.runtime.connectNative).toHaveBeenCalledTimes(
        initialCalls + 1,
      );
      vi.advanceTimersByTime(1);
      expect(chromeStub.runtime.connectNative).toHaveBeenCalledTimes(
        initialCalls + 2,
      );
    });

    it("caps backoff at 30 seconds", () => {
      const conn = freshConnection();
      conn.connect();

      // After initial connect succeeds, make subsequent connects throw
      // so the attempt counter accumulates instead of resetting
      chromeStub.runtime.connectNative.mockImplementation(() => {
        throw new Error("host not found");
      });

      // Disconnect to start reconnect cycle
      fireDisconnect();
      // Attempts 1-5: delays are 1s, 2s, 4s, 8s, 16s
      vi.advanceTimersByTime(1000); // attempt 1 fires, throws, schedules attempt 2 at 2s
      vi.advanceTimersByTime(2000); // attempt 2 fires
      vi.advanceTimersByTime(4000); // attempt 3 fires
      vi.advanceTimersByTime(8000); // attempt 4 fires
      vi.advanceTimersByTime(16_000); // attempt 5 fires, schedules at min(32000, 30000) = 30s

      // Next reconnect should be capped at 30s
      const callsBefore = chromeStub.runtime.connectNative.mock.calls.length;
      vi.advanceTimersByTime(29_999);
      expect(chromeStub.runtime.connectNative.mock.calls.length).toBe(
        callsBefore,
      );
      vi.advanceTimersByTime(1);
      expect(chromeStub.runtime.connectNative.mock.calls.length).toBe(
        callsBefore + 1,
      );

      // Restore default mock
      chromeStub.runtime.connectNative.mockImplementation(() => mockPort);
    });

    it("gives up after max attempts and sets error status", () => {
      const conn = freshConnection();
      conn.connect();

      // Make subsequent connects throw so attempts accumulate
      chromeStub.runtime.connectNative.mockImplementation(() => {
        throw new Error("host not found");
      });

      // Initial disconnect triggers reconnect cycle
      fireDisconnect();

      // Fire through all 10 reconnect attempts
      // Each attempt throws, scheduling the next with increasing delay
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(30_000); // always enough for any backoff
      }

      // Should now be in error state — max attempts exhausted
      expect(conn.status).toBe("error");

      // No more reconnect attempts should be scheduled
      const callCount = chromeStub.runtime.connectNative.mock.calls.length;
      vi.advanceTimersByTime(60_000);
      expect(chromeStub.runtime.connectNative.mock.calls.length).toBe(
        callCount,
      );

      // Restore default mock
      chromeStub.runtime.connectNative.mockImplementation(() => mockPort);
    });

    it("resets attempt counter on successful connect", () => {
      const conn = freshConnection();
      conn.connect();

      // Disconnect once, reconnect succeeds
      fireDisconnect();
      vi.advanceTimersByTime(1000);
      // connect() resets reconnectAttempts to 0

      // Disconnect again — should use 1s delay (attempt 0 -> delay 1s)
      fireDisconnect();
      vi.advanceTimersByTime(999);
      const callsBefore = chromeStub.runtime.connectNative.mock.calls.length;
      vi.advanceTimersByTime(1);
      expect(chromeStub.runtime.connectNative.mock.calls.length).toBe(
        callsBefore + 1,
      );
    });
  });

  // -- message handling ----------------------------------------------------

  describe("handleMessage", () => {
    it("responds to ping with pong", () => {
      const conn = freshConnection();
      conn.connect();
      vi.setSystemTime(new Date(1700000000000));
      fireMessage({ type: "ping", timestamp: 1699999999999 });
      expect(mockPort.postMessage).toHaveBeenCalledWith({
        type: "pong",
        timestamp: 1700000000000,
      });
    });

    it("responds to get_status with version", () => {
      const conn = freshConnection();
      conn.connect();
      fireMessage({ type: "get_status" });
      expect(mockPort.postMessage).toHaveBeenCalledWith({
        type: "status_response",
        version: "0.1.0",
      });
    });

    it("sets connected on mcp_connected", () => {
      const conn = freshConnection();
      conn.connect();
      fireMessage({ type: "mcp_connected" });
      expect(conn.status).toBe("connected");
    });

    it("stays connected on mcp_disconnected", () => {
      const conn = freshConnection();
      conn.connect();
      fireMessage({ type: "mcp_disconnected" });
      // Should still be connected — native host is alive
      expect(conn.status).toBe("connected");
    });

    it("preserves request_id on successful tool responses", async () => {
      const routeSpy = vi.spyOn(messageRouter, "route");
      messageRouter.register("metadata_success", {
        async execute() {
          return {
            success: true,
            content: [{ type: "text", text: "ok" }],
          };
        },
      });

      const conn = freshConnection();
      conn.connect();
      fireMessage({
        type: "tool_request",
        method: "execute_tool",
        params: {
          tool: "metadata_success",
          args: {},
          request_id: "req-success-1",
        },
      });

      await vi.waitFor(() => {
        expect(routeSpy).toHaveBeenCalledWith({
          method: "execute_tool",
          params: {
            tool: "metadata_success",
            args: {},
            request_id: "req-success-1",
          },
        });
        expect(mockPort.postMessage).toHaveBeenCalledWith({
          type: "tool_response",
          request_id: "req-success-1",
          result: { content: [{ type: "text", text: "ok" }] },
        });
        expect(chromeStub.runtime.sendMessage).toHaveBeenCalledTimes(2);
        expect(chromeStub.runtime.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "tool_execution_update",
            entry: expect.objectContaining({
              tool: "metadata_success",
              status: "success",
            }),
          }),
        );
      });
    });

    it("preserves request_id on error tool responses", async () => {
      const conn = freshConnection();
      conn.connect();
      fireMessage({
        type: "tool_request",
        method: "execute_tool",
        params: {
          tool: "missing_tool",
          args: {},
          request_id: "req-error-1",
        },
      });

      await vi.waitFor(() => {
        expect(mockPort.postMessage).toHaveBeenCalledWith({
          type: "tool_response",
          request_id: "req-error-1",
          error: {
            content: [
              {
                type: "text",
                text: "Unknown tool: missing_tool. Available tools: metadata_success",
              },
            ],
          },
        });
      });
    });
  });

  // -- status change callback ----------------------------------------------

  describe("onConnectionStatusChange", () => {
    it("fires callback on status changes", () => {
      const conn = freshConnection();
      const statuses: ConnectionStatus[] = [];
      conn.onConnectionStatusChange((s) => statuses.push(s));
      conn.connect();
      expect(statuses).toEqual(["connecting", "connected"]);
    });
  });
});
