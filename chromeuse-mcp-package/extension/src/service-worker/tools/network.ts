/**
 * network tool - reads network requests captured from a browser tab via CDP.
 *
 * Network requests are captured using Network.requestWillBeSent and
 * Network.responseReceived CDP events. Stored per-tab with URL filtering support.
 *
 * Args:
 *   tabId (number, required): The tab to read network requests from.
 *   clear (boolean, optional): If true, clears stored requests after returning them. Defaults to false.
 *   urlPattern (string, optional): Filter requests by URL substring match.
 *   method (string, optional): Filter by HTTP method (e.g., "GET", "POST").
 *   limit (number, optional): Maximum number of requests to return (most recent). Defaults to 100.
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";
import { cdpManager } from "../cdp.js";

/** Maximum requests stored per tab */
const MAX_REQUESTS_PER_TAB = 500;

/** Default number of requests returned */
const DEFAULT_LIMIT = 100;

/** A captured network request with optional response */
interface NetworkEntry {
  requestId: string;
  url: string;
  method: string;
  type: string;
  timestamp: number;
  /** Set when response is received */
  status?: number;
  statusText?: string;
  mimeType?: string;
  /** Response timing in ms (from request start) */
  responseTime?: number;
  /** True if the request failed */
  failed?: boolean;
  failureReason?: string;
}

/** CDP Network.requestWillBeSent params (subset) */
interface RequestWillBeSentParams {
  requestId: string;
  request: {
    url: string;
    method: string;
  };
  timestamp: number;
  type?: string;
}

/** CDP Network.responseReceived params (subset) */
interface ResponseReceivedParams {
  requestId: string;
  response: {
    url: string;
    status: number;
    statusText: string;
    mimeType: string;
  };
  timestamp: number;
}

/** CDP Network.loadingFailed params (subset) */
interface LoadingFailedParams {
  requestId: string;
  errorText: string;
  timestamp: number;
}

export class NetworkTool implements ToolHandler {
  /** Per-tab network request storage */
  private requests = new Map<number, NetworkEntry[]>();

  /** Index for quick lookup by requestId per tab */
  private requestIndex = new Map<number, Map<string, NetworkEntry>>();

  /** Tabs we've subscribed to events for */
  private subscribedTabs = new Set<number>();

  constructor() {
    // Register CDP event listener for network events
    cdpManager.addEventListener((source, method, params) => {
      if (source.tabId === undefined) return;

      switch (method) {
        case "Network.requestWillBeSent":
          this.handleRequest(
            source.tabId,
            params as unknown as RequestWillBeSentParams,
          );
          break;
        case "Network.responseReceived":
          this.handleResponse(
            source.tabId,
            params as unknown as ResponseReceivedParams,
          );
          break;
        case "Network.loadingFailed":
          this.handleFailure(
            source.tabId,
            params as unknown as LoadingFailedParams,
          );
          break;
      }
    });

    // Clean up when tabs are removed
    chrome.tabs.onRemoved.addListener((tabId: number) => {
      this.requests.delete(tabId);
      this.requestIndex.delete(tabId);
      this.subscribedTabs.delete(tabId);
    });
  }

  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    try {
      // Validate tabId
      const tabId = typeof args.tabId === "number" ? args.tabId : undefined;
      if (tabId === undefined) {
        return {
          success: false,
          content: [
            { type: "text", text: "Missing required argument: tabId (number)" },
          ],
        };
      }

      // Optional args
      const clear = typeof args.clear === "boolean" ? args.clear : false;
      const urlPattern =
        typeof args.urlPattern === "string" ? args.urlPattern : undefined;
      const methodFilter =
        typeof args.method === "string" ? args.method.toUpperCase() : undefined;
      const limit = typeof args.limit === "number" ? args.limit : DEFAULT_LIMIT;

      // Ensure CDP is attached and Network domain is enabled
      if (!cdpManager.isAttached(tabId)) {
        await cdpManager.attach(tabId);
      }

      if (!this.subscribedTabs.has(tabId)) {
        await cdpManager.enableDomain(tabId, "Network");
        this.subscribedTabs.add(tabId);
      }

      // Get stored requests for this tab
      let tabRequests = this.requests.get(tabId) ?? [];

      // Apply filters
      if (urlPattern) {
        tabRequests = tabRequests.filter((req) => req.url.includes(urlPattern));
      }
      if (methodFilter) {
        tabRequests = tabRequests.filter((req) => req.method === methodFilter);
      }

      // Apply limit (most recent)
      if (tabRequests.length > limit) {
        tabRequests = tabRequests.slice(-limit);
      }

      // Clear if requested
      if (clear) {
        this.requests.delete(tabId);
        this.requestIndex.delete(tabId);
      }

      const result = {
        tabId,
        requestCount: tabRequests.length,
        requests: tabRequests.map((req) => ({
          url: req.url,
          method: req.method,
          type: req.type,
          ...(req.status !== undefined ? { status: req.status } : {}),
          ...(req.statusText ? { statusText: req.statusText } : {}),
          ...(req.mimeType ? { mimeType: req.mimeType } : {}),
          ...(req.responseTime !== undefined
            ? { responseTimeMs: Math.round(req.responseTime * 1000) }
            : {}),
          ...(req.failed
            ? { failed: true, failureReason: req.failureReason }
            : {}),
        })),
      };

      return {
        success: true,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        success: false,
        content: [
          {
            type: "text",
            text: `Failed to read network requests: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  /**
   * Handle a Network.requestWillBeSent event.
   */
  private handleRequest(
    tabId: number,
    params: RequestWillBeSentParams,
  ): void {
    if (!params?.request) return;

    const entry: NetworkEntry = {
      requestId: params.requestId,
      url: params.request.url,
      method: params.request.method,
      type: params.type ?? "Other",
      timestamp: params.timestamp,
    };

    // Initialize per-tab storage if needed
    let tabRequests = this.requests.get(tabId);
    if (!tabRequests) {
      tabRequests = [];
      this.requests.set(tabId, tabRequests);
    }

    let tabIndex = this.requestIndex.get(tabId);
    if (!tabIndex) {
      tabIndex = new Map();
      this.requestIndex.set(tabId, tabIndex);
    }

    tabRequests.push(entry);
    tabIndex.set(params.requestId, entry);

    // Trim to max storage
    if (tabRequests.length > MAX_REQUESTS_PER_TAB) {
      const removed = tabRequests.splice(
        0,
        tabRequests.length - MAX_REQUESTS_PER_TAB,
      );
      for (const r of removed) {
        tabIndex.delete(r.requestId);
      }
    }
  }

  /**
   * Handle a Network.responseReceived event.
   */
  private handleResponse(
    tabId: number,
    params: ResponseReceivedParams,
  ): void {
    if (!params?.response) return;

    const tabIndex = this.requestIndex.get(tabId);
    const entry = tabIndex?.get(params.requestId);
    if (!entry) return;

    entry.status = params.response.status;
    entry.statusText = params.response.statusText;
    entry.mimeType = params.response.mimeType;
    entry.responseTime = params.timestamp - entry.timestamp;
  }

  /**
   * Handle a Network.loadingFailed event.
   */
  private handleFailure(
    tabId: number,
    params: LoadingFailedParams,
  ): void {
    if (!params) return;

    const tabIndex = this.requestIndex.get(tabId);
    const entry = tabIndex?.get(params.requestId);
    if (!entry) return;

    entry.failed = true;
    entry.failureReason = params.errorText;
  }
}
