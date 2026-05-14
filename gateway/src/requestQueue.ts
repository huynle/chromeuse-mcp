import type { BrowserTransport, ToolRequestMetadata, ToolRequestResult } from "@chromeuse/mcp-server";

interface QueuedRequest {
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly timeoutMs?: number;
  readonly metadata?: ToolRequestMetadata;
  readonly resolve: (result: ToolRequestResult) => void;
  readonly reject: (error: Error) => void;
  settled: boolean;
}

export interface RequestQueueTransportOptions {
  readonly logger?: (message: string) => void;
}

export class RequestQueueTransport implements BrowserTransport {
  private readonly queue: QueuedRequest[] = [];
  private activeRequest: QueuedRequest | null = null;
  private disconnected = false;

  constructor(
    private readonly transport: BrowserTransport,
    private readonly options: RequestQueueTransportOptions = {}
  ) {}

  get connected(): boolean {
    return this.transport.connected;
  }

  connect(): Promise<void> {
    this.disconnected = false;
    return this.transport.connect();
  }

  sendToolRequest(
    tool: string,
    args: Record<string, unknown>,
    timeoutMs?: number,
    metadata?: ToolRequestMetadata
  ): Promise<ToolRequestResult> {
    if (this.disconnected || !this.transport.connected) {
      return Promise.reject(new Error("No extension connected"));
    }

    return new Promise<ToolRequestResult>((resolve, reject) => {
      this.queue.push({
        tool,
        args,
        timeoutMs,
        metadata,
        resolve,
        reject,
        settled: false,
      });
      this.logDepth();
      this.processNext();
    });
  }

  disconnect(): void {
    this.disconnected = true;
    this.transport.disconnect();
    this.rejectActiveAndQueued(new Error("Extension disconnected"));
  }

  private processNext(): void {
    if (this.activeRequest || this.disconnected) return;

    const request = this.queue.shift();
    if (!request) return;

    if (!this.transport.connected) {
      this.rejectRequest(request, new Error("No extension connected"));
      this.rejectQueued(new Error("No extension connected"));
      return;
    }

    this.activeRequest = request;
    this.logDepth();
    const result = request.metadata
      ? this.transport.sendToolRequest(
          request.tool,
          request.args,
          request.timeoutMs,
          request.metadata
        )
      : this.transport.sendToolRequest(request.tool, request.args, request.timeoutMs);

    result
      .then((result) => {
        if (request.settled) return;
        this.resolveRequest(request, result);
      })
      .catch((error: unknown) => {
        const requestError = error instanceof Error ? error : new Error(String(error));
        if (!request.settled) this.rejectRequest(request, requestError);
        if (!this.transport.connected) this.rejectQueued(requestError);
      })
      .finally(() => {
        if (this.activeRequest === request) this.activeRequest = null;
        this.logDepth();
        this.processNext();
      });
  }

  private resolveRequest(request: QueuedRequest, result: ToolRequestResult): void {
    request.settled = true;
    request.resolve(result);
  }

  private rejectRequest(request: QueuedRequest, error: Error): void {
    request.settled = true;
    request.reject(error);
  }

  private rejectActiveAndQueued(error: Error): void {
    if (this.activeRequest && !this.activeRequest.settled) {
      this.rejectRequest(this.activeRequest, error);
    }
    this.rejectQueued(error);
  }

  private rejectQueued(error: Error): void {
    const pending = this.queue.splice(0);
    for (const request of pending) {
      this.rejectRequest(request, error);
    }
    this.logDepth();
  }

  private logDepth(): void {
    this.options.logger?.(
      `mode=SERVER event=queue_depth depth=${this.queue.length + (this.activeRequest ? 1 : 0)}`
    );
  }
}
