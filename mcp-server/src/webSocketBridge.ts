import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import type { ToolRequest, ToolResponse } from "@chromeuse/shared";
import type { BrowserTransport, ToolRequestMetadata, ToolRequestResult } from "./transport.js";
import { DEFAULT_TIMEOUT_MS } from "./socketClient.js";

interface PendingRequest {
  readonly resolve: (response: ToolResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface WebSocketBridgeOptions {
  readonly host?: string;
  readonly port?: number;
  readonly env?: Pick<NodeJS.ProcessEnv, "CHROMEUSE_WS_PORT">;
}

export class WebSocketBridge implements BrowserTransport {
  private readonly _host: string;
  private _port: number;
  private server: WebSocketServer | null = null;
  private extension: WebSocket | null = null;
  private pendingRequests = new Map<string, PendingRequest>();

  constructor(options: WebSocketBridgeOptions = {}) {
    const env = options.env ?? process.env;
    this._host = options.host ?? "127.0.0.1";
    this._port = options.port ?? parsePort(env.CHROMEUSE_WS_PORT) ?? 8765;
  }

  get host(): string {
    return this._host;
  }

  get port(): number {
    return this._port;
  }

  get connected(): boolean {
    return this.extension?.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    if (this.server) return;

    const server = new WebSocketServer({ host: this._host, port: this._port });
    this.server = server;

    server.on("connection", (socket) => {
      this.handleConnection(socket);
    });

    await new Promise<void>((resolve, reject) => {
      const onListening = () => {
        cleanup();
        const address = server.address();
        if (typeof address === "object" && address) this._port = address.port;
        resolve();
      };
      const onError = (error: NodeJS.ErrnoException) => {
        cleanup();
        this.server = null;
        server.close();
        if (error.code === "EADDRINUSE") {
          reject(
            new Error(
              `WebSocket bridge port ${this._port} already in use on ${this._host}`
            )
          );
        } else {
          reject(error);
        }
      };
      const cleanup = () => {
        server.off("listening", onListening);
        server.off("error", onError);
      };

      server.once("listening", onListening);
      server.once("error", onError);
    });
  }

  async sendToolRequest(
    tool: string,
    args: Record<string, unknown>,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    metadata: ToolRequestMetadata = {}
  ): Promise<ToolRequestResult> {
    if (!this.connected || !this.extension) {
      throw new Error("No extension connected to WebSocket bridge");
    }

    const requestId = randomUUID();
    const request: ToolRequest = {
      type: "tool_request",
      method: "execute_tool",
      params: {
        request_id: requestId,
        tool,
        args,
        ...(metadata.clientId ? { client_id: metadata.clientId } : {}),
        ...(metadata.sessionScope ? { session_scope: metadata.sessionScope } : {}),
      },
    };

    return new Promise<ToolRequestResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Tool request timed out after ${timeoutMs}ms: ${tool}`));
      }, timeoutMs);

      const pending: PendingRequest = {
        timer,
        resolve: (response) => {
          this.pendingRequests.delete(requestId);
          clearTimeout(timer);
          resolve(toToolRequestResult(response));
        },
        reject: (error) => {
          this.pendingRequests.delete(requestId);
          clearTimeout(timer);
          reject(error);
        },
      };

      this.pendingRequests.set(requestId, pending);

      try {
        this.extension?.send(JSON.stringify(request));
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  disconnect(): void {
    void this.close();
  }

  async close(): Promise<void> {
    const server = this.server;
    const extension = this.extension;

    this.server = null;
    this.extension = null;
    this.clearPending(new Error("Disconnected"));

    if (extension && extension.readyState !== extension.CLOSED) {
      extension.close();
    }

    if (!server) return;

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private handleConnection(socket: WebSocket): void {
    if (this.connected) {
      socket.close(1013, "Extension already connected");
      return;
    }

    this.extension = socket;

    socket.on("message", (data) => {
      this.handleMessage(data.toString());
    });

    socket.on("close", () => {
      if (this.extension === socket) {
        this.extension = null;
        this.clearPending(new Error("Extension disconnected"));
      }
    });

    socket.on("error", (error) => {
      if (this.extension === socket) {
        this.extension = null;
        this.clearPending(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleMessage(rawMessage: string): void {
    let message: unknown;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      return;
    }

    if (!message || typeof message !== "object") return;

    const response = message as Partial<ToolResponse>;
    if (response.type !== "tool_response" || typeof response.request_id !== "string") {
      return;
    }

    const pending = this.pendingRequests.get(response.request_id);
    if (!pending) return;

    pending.resolve(response as ToolResponse);
  }

  private clearPending(error: Error): void {
    const pendingRequests = [...this.pendingRequests.values()];
    this.pendingRequests.clear();

    for (const pending of pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) return undefined;
  return port;
}

function toToolRequestResult(response: ToolResponse): ToolRequestResult {
  if (response.error) {
    return {
      content: response.error.content,
      isError: true,
    };
  }

  if (response.result) {
    return {
      content: response.result.content,
    };
  }

  return {
    content: [{ type: "text", text: "Empty response from extension" }],
    isError: true,
  };
}
