import type { BrowserTransport, ToolRequestResult } from "@chromeuse/mcp-server";

const DEFAULT_TIMEOUT_MS = 60_000;
const GATEWAY_IDENTITY = "chromeuse-http-gateway";
const COMPATIBLE_VERSION_PREFIX = "1.";

interface HealthResponse {
  readonly gateway?: unknown;
  readonly version?: unknown;
  readonly protocol?: unknown;
  readonly protocolVersion?: unknown;
  readonly client_id?: unknown;
}

interface ToolGatewayResponse {
  readonly result?: ToolRequestResult;
  readonly error?: ToolRequestResult;
}

export interface HttpGatewayTransportOptions {
  readonly fetch?: typeof globalThis.fetch;
}

export class HttpGatewayTransport implements BrowserTransport {
  private readonly baseUrl: string;
  private readonly fetch: typeof globalThis.fetch;
  private _connected = false;

  constructor(baseUrl: string, options: HttpGatewayTransportOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    try {
      const response = await this.fetch(`${this.baseUrl}/health`, {
        method: "GET",
      });
      if (!response.ok) {
        throw new Error(`ChromeUse HTTP gateway health failed: ${response.status}`);
      }

      const health = (await response.json()) as HealthResponse;
      if (!isCompatibleHealth(health)) {
        throw new Error("Incompatible ChromeUse HTTP gateway");
      }

      this._connected = true;
    } catch (error) {
      this._connected = false;
      throw error;
    }
  }

  async sendToolRequest(
    tool: string,
    args: Record<string, unknown>,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<ToolRequestResult> {
    if (!this._connected) {
      throw new Error("Not connected to ChromeUse HTTP gateway");
    }

    const abortController = new AbortController();
    let didTimeout = false;
    const timer = setTimeout(() => {
      didTimeout = true;
      abortController.abort();
    }, timeoutMs);

    let payload: ToolGatewayResponse;
    try {
      const response = await this.fetch(`${this.baseUrl}/tool`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool, args, timeoutMs }),
        signal: abortController.signal,
      });
      if (!response.ok) {
        throw new Error(`ChromeUse HTTP gateway tool request failed: ${response.status}`);
      }

      payload = (await response.json()) as ToolGatewayResponse;
    } catch (error) {
      this._connected = false;
      if (didTimeout) {
        throw new Error(`Tool request timed out after ${timeoutMs}ms: ${tool}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    if (payload.error) {
      return { content: payload.error.content, isError: true };
    }

    return { content: payload.result?.content ?? [] };
  }

  disconnect(): void {
    this._connected = false;
  }
}

function isCompatibleHealth(health: HealthResponse): boolean {
  return (
    health.gateway === GATEWAY_IDENTITY &&
    typeof health.version === "string" &&
    health.version.startsWith(COMPATIBLE_VERSION_PREFIX) &&
    health.protocol === GATEWAY_IDENTITY &&
    typeof health.protocolVersion === "string" &&
    health.protocolVersion.startsWith(COMPATIBLE_VERSION_PREFIX) &&
    typeof health.client_id === "string" &&
    health.client_id.length > 0
  );
}
