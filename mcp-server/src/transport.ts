import type { ContentBlock } from "@chromeuse/shared";

export interface ToolRequestResult {
  readonly [key: string]: unknown;
  readonly content: readonly ContentBlock[];
  readonly isError?: boolean;
}

export interface ToolRequestMetadata {
  readonly clientId?: string;
  readonly sessionScope?: string;
}

export interface BrowserTransport {
  readonly connected: boolean;

  connect(): Promise<void>;

  sendToolRequest(
    tool: string,
    args: Record<string, unknown>,
    timeoutMs?: number,
    metadata?: ToolRequestMetadata
  ): Promise<ToolRequestResult>;

  disconnect(): void;
}
