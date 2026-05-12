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
  readonly logger?: (message: string) => void;
}

export class HttpGatewayTransport implements BrowserTransport {
  private readonly baseUrl: string;
  private readonly fetch: typeof globalThis.fetch;
  private readonly logger?: (message: string) => void;
  private _connected = false;

  constructor(baseUrl: string, options: HttpGatewayTransportOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.logger = options.logger;
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
      this.log(`mode=PROXY event=probe_failure base_url=${this.baseUrl} error=${errorMessage(error)}`);
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
    const start = Date.now();
    const timer = setTimeout(() => {
      didTimeout = true;
      abortController.abort();
    }, timeoutMs);

    let payload: ToolGatewayResponse;
    this.log(`mode=PROXY event=request_start tool=${tool} base_url=${this.baseUrl}`);
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
      this.log(
        `mode=PROXY event=request_end status=${response.status} tool=${tool} duration_ms=${Date.now() - start}`
      );
    } catch (error) {
      this._connected = false;
      if (didTimeout) {
        this.log(
          `mode=PROXY event=request_end status=timeout tool=${tool} duration_ms=${Date.now() - start}`
        );
        throw new Error(`Tool request timed out after ${timeoutMs}ms: ${tool}`);
      }
      this.log(
        `mode=PROXY event=request_end status=error tool=${tool} duration_ms=${Date.now() - start} error=${errorMessage(error)}`
      );
      throw error;
    } finally {
      clearTimeout(timer);
    }

    if (payload.error) {
      return { ...payload.error, isError: true };
    }

    if (payload.result) return payload.result;
    if (isToolRequestResult(payload)) return payload;

    return { content: [] };
  }

  disconnect(): void {
    this._connected = false;
  }

  private log(message: string): void {
    this.logger?.(message);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function isToolRequestResult(value: unknown): value is ToolRequestResult {
  return isRecord(value) && Array.isArray(value.content);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
