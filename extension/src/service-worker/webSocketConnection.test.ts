import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ConnectionStatus } from "../types/messages.js";

const sockets: MockWebSocket[] = [];

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  });

  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  receive(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: String(data) }));
  }

  serverClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }
}

const chromeStub = {
  runtime: {
    sendMessage: vi.fn(() => Promise.resolve()),
    getManifest: vi.fn(() => ({ version: "0.1.0" })),
  },
  action: {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
  },
};

Object.assign(globalThis, {
  chrome: chromeStub,
  WebSocket: MockWebSocket,
});

const { WebSocketConnection } = await import("./webSocketConnection.js");
const { messageRouter } = await import("./messageRouter.js");

function freshConnection() {
  return new WebSocketConnection();
}

function latestSocket() {
  const socket = sockets.at(-1);
  expect(socket).toBeDefined();
  return socket!;
}

describe("WebSocketConnection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    sockets.length = 0;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("connect", () => {
    it("opens the default local MCP WebSocket and updates status", () => {
      const statuses: ConnectionStatus[] = [];
      const conn = freshConnection();
      conn.onConnectionStatusChange((status) => statuses.push(status));

      conn.connect();
      expect(latestSocket().url).toBe("ws://127.0.0.1:8765");
      expect(conn.status).toBe("connecting");

      latestSocket().open();
      expect(conn.status).toBe("connected");
      expect(statuses).toEqual(["connecting", "connected"]);
    });

    it("opens a caller-provided URL", () => {
      const conn = freshConnection();
      conn.connect("ws://127.0.0.1:9999");
      expect(latestSocket().url).toBe("ws://127.0.0.1:9999");
    });
  });

  describe("disconnect", () => {
    it("cleanly closes the socket and cancels reconnect", () => {
      const conn = freshConnection();
      conn.connect();
      latestSocket().open();
      latestSocket().serverClose();

      conn.disconnect();
      vi.advanceTimersByTime(5000);

      expect(sockets).toHaveLength(1);
      expect(conn.status).toBe("disconnected");
    });

    it("closes an active socket", () => {
      const conn = freshConnection();
      conn.connect();
      latestSocket().open();

      conn.disconnect();

      expect(latestSocket().close).toHaveBeenCalledOnce();
      expect(conn.status).toBe("disconnected");
    });
  });

  describe("message handling", () => {
    it("responds to ping and get_status", () => {
      const conn = freshConnection();
      conn.connect();
      latestSocket().open();
      vi.setSystemTime(new Date(1700000000000));

      latestSocket().receive(JSON.stringify({ type: "ping", timestamp: 1 }));
      latestSocket().receive(JSON.stringify({ type: "get_status" }));

      expect(latestSocket().send).toHaveBeenCalledWith(
        JSON.stringify({ type: "pong", timestamp: 1700000000000 }),
      );
      expect(latestSocket().send).toHaveBeenCalledWith(
        JSON.stringify({ type: "status_response", version: "0.1.0" }),
      );
    });

    it("handles tool requests with shared ToolResponse shape", async () => {
      messageRouter.register("websocket_success", {
        async execute() {
          return {
            success: true,
            content: [{ type: "text", text: "ok" }],
          };
        },
      });

      const conn = freshConnection();
      conn.connect();
      latestSocket().open();
      latestSocket().receive(
        JSON.stringify({
          type: "tool_request",
          method: "execute_tool",
          params: {
            tool: "websocket_success",
            args: {},
            request_id: "req-ws-1",
          },
        }),
      );

      await vi.waitFor(() => {
        expect(latestSocket().send).toHaveBeenCalledWith(
          JSON.stringify({
            type: "tool_response",
            request_id: "req-ws-1",
            result: { content: [{ type: "text", text: "ok" }] },
          }),
        );
      });
    });

    it("handles connection notifications and malformed messages without crashing", () => {
      const conn = freshConnection();
      conn.connect();
      latestSocket().open();

      expect(() => latestSocket().receive("not json")).not.toThrow();
      latestSocket().receive(JSON.stringify({ type: "mcp_disconnected" }));
      expect(conn.status).toBe("connected");
      latestSocket().receive(JSON.stringify({ type: "mcp_connected" }));
      expect(conn.status).toBe("connected");
    });
  });

  describe("reconnect", () => {
    it("reconnects only after user-initiated connect using bounded backoff", () => {
      const conn = freshConnection();

      conn.disconnect();
      vi.advanceTimersByTime(30_000);
      expect(sockets).toHaveLength(0);

      conn.connect();
      latestSocket().open();
      latestSocket().serverClose();
      vi.advanceTimersByTime(999);
      expect(sockets).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(sockets).toHaveLength(2);

      latestSocket().serverClose();
      vi.advanceTimersByTime(1999);
      expect(sockets).toHaveLength(2);
      vi.advanceTimersByTime(1);
      expect(sockets).toHaveLength(3);
    });
  });
});
