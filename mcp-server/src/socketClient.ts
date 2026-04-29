/**
 * Socket client that connects to the native messaging host via Unix domain socket.
 *
 * The native host creates a socket at:
 *   /tmp/opencode-browser-bridge-{username}/{pid}.sock (Unix)
 *   \\.\pipe\opencode-browser-bridge-{username}-{pid} (Windows)
 *
 * Communication uses 4-byte LE length-prefixed JSON, matching the
 * shared `encode`/`decode` from @opencode-chrome/shared.
 */

import { connect, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { userInfo, platform } from "node:os";
import {
  encode,
  decode,
  type ToolRequest,
  type ToolResponse,
  type ContentBlock,
} from "@opencode-chrome/shared";

/** Default timeout for tool requests (60 seconds) */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Event types emitted by the socket client */
export interface SocketClientEvents {
  connected: () => void;
  disconnected: (error?: Error) => void;
  error: (error: Error) => void;
}

/**
 * Client for communicating with the native messaging host over a Unix domain socket.
 *
 * The client discovers an active native host socket, connects, and provides
 * a request/response interface for forwarding MCP tool calls.
 */
export class SocketClient {
  private socket: Socket | null = null;
  private buffer = new Uint8Array(0);
  private responseResolve: ((response: ToolResponse) => void) | null = null;
  private responseReject: ((error: Error) => void) | null = null;
  private responseTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  /**
   * Find the socket path of an active native host process.
   *
   * Scans the socket directory for .sock files, checks whether the
   * owning PID is still alive, and returns the first active one.
   */
  findActiveSocket(): string | null {
    const username = userInfo().username;

    if (platform() === "win32") {
      // Windows named pipes are discovered differently; for now we
      // return a conventional path and let connect() fail if absent.
      return `\\\\.\\pipe\\opencode-browser-bridge-${username}`;
    }

    const socketDir = join("/tmp", `opencode-browser-bridge-${username}`);

    try {
      const files = readdirSync(socketDir);
      for (const file of files) {
        if (!file.endsWith(".sock")) continue;

        const pid = parseInt(file.replace(".sock", ""), 10);
        if (Number.isNaN(pid)) continue;

        // Check if the process is still alive
        try {
          process.kill(pid, 0);
          return join(socketDir, file);
        } catch {
          // Process is dead — stale socket, skip it
        }
      }
    } catch {
      // Directory doesn't exist — no native host running
    }

    return null;
  }

  /**
   * Connect to the native host socket.
   *
   * @throws Error if no active socket is found
   */
  async connect(): Promise<void> {
    const socketPath = this.findActiveSocket();
    if (!socketPath) {
      throw new Error(
        "No active native host found. Is the Chrome extension running?"
      );
    }

    return this.connectToPath(socketPath);
  }

  /**
   * Connect to a specific socket path (useful for testing).
   */
  async connectToPath(socketPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = connect(socketPath, () => {
        this.socket = socket;
        this._connected = true;
        resolve();
      });

      socket.on("data", (data: Buffer) => {
        this.handleData(data);
      });

      socket.on("error", (err: Error) => {
        if (!this._connected) {
          reject(err);
        } else {
          this.handleDisconnect(err);
        }
      });

      socket.on("close", () => {
        this.handleDisconnect();
      });
    });
  }

  /**
   * Send a tool request to the native host and wait for the response.
   *
   * Only one request at a time is supported until downstream routing changes
   * use request IDs for multiple concurrent in-flight calls.
   *
   * @param tool - Tool name (e.g. "navigate", "computer")
   * @param args - Tool arguments
   * @param timeoutMs - Request timeout in milliseconds (default: 60s)
   * @returns MCP-formatted tool result
   */
  async sendToolRequest(
    tool: string,
    args: Record<string, unknown>,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<{ content: readonly ContentBlock[]; isError?: boolean }> {
    if (!this.socket || !this._connected) {
      throw new Error("Not connected to native host");
    }

    if (this.responseResolve) {
      throw new Error(
        "A request is already pending. Only one request at a time is supported."
      );
    }

    const requestId = randomUUID();
    const request: ToolRequest = {
      type: "tool_request",
      method: "execute_tool",
      params: { request_id: requestId, tool, args },
    };

    const encoded = encode(request);
    this.socket.write(encoded);

    return new Promise<{ content: readonly ContentBlock[]; isError?: boolean }>(
      (resolve, reject) => {
        this.responseTimer = setTimeout(() => {
          this.responseResolve = null;
          this.responseReject = null;
          this.responseTimer = null;
          reject(new Error(`Tool request timed out after ${timeoutMs}ms: ${tool}`));
        }, timeoutMs);

        this.responseResolve = (response: ToolResponse) => {
          if (this.responseTimer) {
            clearTimeout(this.responseTimer);
            this.responseTimer = null;
          }
          this.responseResolve = null;
          this.responseReject = null;

          if (response.error) {
            resolve({
              content: response.error.content,
              isError: true,
            });
          } else if (response.result) {
            resolve({
              content: response.result.content,
            });
          } else {
            resolve({
              content: [{ type: "text", text: "Empty response from extension" }],
              isError: true,
            });
          }
        };

        this.responseReject = (error: Error) => {
          if (this.responseTimer) {
            clearTimeout(this.responseTimer);
            this.responseTimer = null;
          }
          this.responseResolve = null;
          this.responseReject = null;
          reject(error);
        };
      }
    );
  }

  /**
   * Disconnect from the native host.
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this._connected = false;
    this.clearPending(new Error("Disconnected"));
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private handleData(data: Buffer): void {
    // Append incoming data to our buffer
    const combined = new Uint8Array(this.buffer.byteLength + data.byteLength);
    combined.set(this.buffer, 0);
    combined.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), this.buffer.byteLength);
    this.buffer = combined;

    // Try to decode complete messages
    this.processBuffer();
  }

  private processBuffer(): void {
    while (this.buffer.byteLength > 0) {
      let result: ReturnType<typeof decode>;
      try {
        result = decode(this.buffer);
      } catch (err) {
        // Protocol error — drop the connection
        this.disconnect();
        return;
      }

      if (result === null) {
        break; // Incomplete message, wait for more data
      }

      const { message, bytesConsumed } = result;
      this.buffer = this.buffer.subarray(bytesConsumed);

      this.handleMessage(message);
    }
  }

  private handleMessage(message: unknown): void {
    if (!message || typeof message !== "object") return;

    const msg = message as Record<string, unknown>;

    if (msg.type === "tool_response" && this.responseResolve) {
      this.responseResolve(msg as unknown as ToolResponse);
    }
  }

  private handleDisconnect(error?: Error): void {
    this._connected = false;
    this.socket = null;
    this.clearPending(error ?? new Error("Connection closed"));
  }

  private clearPending(error: Error): void {
    if (this.responseTimer) {
      clearTimeout(this.responseTimer);
      this.responseTimer = null;
    }
    if (this.responseReject) {
      this.responseReject(error);
      this.responseResolve = null;
      this.responseReject = null;
    }
  }
}
