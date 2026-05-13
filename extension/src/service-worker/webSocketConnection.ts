import type {
  ExtensionMessage,
  NativeMessage,
  ToolResult,
} from "@chromeuse/shared";
import type { ConnectionStatus } from "../types/messages.js";
import { updateBadge } from "./badge.js";
import { createToolResponse, handleToolRequest } from "./toolRequestHandler.js";

const DEFAULT_URL = "ws://127.0.0.1:8765";
const MAX_RECONNECT_ATTEMPTS = 10;
const MAX_BACKOFF_MS = 30_000;

export class WebSocketConnection {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private shouldReconnect = false;
  private currentUrl = DEFAULT_URL;
  private _status: ConnectionStatus = "disconnected";
  private onStatusChange: ((status: ConnectionStatus) => void) | null = null;

  get status(): ConnectionStatus {
    return this._status;
  }

  onConnectionStatusChange(cb: (status: ConnectionStatus) => void): void {
    this.onStatusChange = cb;
  }

  connect(url = DEFAULT_URL): void {
    this.shouldReconnect = true;
    this.currentUrl = url;
    this.clearReconnectTimer();

    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      const socket = this.socket;
      this.socket = null;
      socket.close();
    }

    this.setStatus("connecting");

    try {
      const socket = new WebSocket(url);
      this.socket = socket;

      socket.onopen = () => {
        this.reconnectAttempts = 0;
        this.setStatus("connected");
      };

      socket.onmessage = (event) => {
        this.handleRawMessage(event.data);
      };

      socket.onerror = () => {
        if (this.socket !== socket) return;
        this.setStatus("error");
      };

      socket.onclose = () => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.setStatus("disconnected");
        this.scheduleReconnect();
      };
    } catch (error) {
      console.error("[WebSocketConnection] Failed to connect:", error);
      this.socket = null;
      this.setStatus("error");
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();

    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      socket.close();
    }

    this.setStatus("disconnected");
  }

  sendMessage(message: ExtensionMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to WebSocket server");
    }
    this.socket.send(JSON.stringify(message));
  }

  sendToolResponse(result: ToolResult, requestId: string): void {
    this.sendMessage(createToolResponse(result, requestId));
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer !== null) {
      return;
    }

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[WebSocketConnection] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Waiting for MCP gateway.`,
      );
      this.setStatus("waiting");
      return;
    }

    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      MAX_BACKOFF_MS,
    );
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(this.currentUrl);
    }, delay);
  }

  private handleRawMessage(data: unknown): void {
    if (typeof data !== "string") {
      console.warn("[WebSocketConnection] Ignoring non-string message");
      return;
    }

    try {
      this.handleMessage(JSON.parse(data) as NativeMessage);
    } catch (error) {
      console.warn("[WebSocketConnection] Ignoring malformed message:", error);
    }
  }

  private handleMessage(message: NativeMessage): void {
    switch (message.type) {
      case "tool_request":
        void handleToolRequest(message, (response) => this.sendMessage(response));
        break;

      case "ping":
        this.sendMessage({ type: "pong", timestamp: Date.now() });
        break;

      case "get_status":
        this.sendMessage({
          type: "status_response",
          version: chrome.runtime.getManifest().version,
        });
        break;

      case "mcp_connected":
        this.setStatus("connected");
        break;

      case "mcp_disconnected":
        console.warn("[WebSocketConnection] MCP server disconnected");
        break;

      default:
        console.warn(
          "[WebSocketConnection] Unknown message type:",
          (message as Record<string, unknown>).type,
        );
    }
  }

  private setStatus(status: ConnectionStatus): void {
    this._status = status;
    updateBadge(status);
    this.onStatusChange?.(status);
  }
}

export const webSocketConnection = new WebSocketConnection();
