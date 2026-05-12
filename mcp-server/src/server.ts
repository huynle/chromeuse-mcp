/**
 * MCP Server that exposes Chrome browser tools for ChromeUse MCP.
 *
 * Registers 16 tool schemas via the MCP protocol and forwards
 * tool calls to the Chrome extension through WebSocket-first browser transport.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOL_NAMES } from "@chromeuse/shared";
import { SocketClient } from "./socketClient.js";
import type { BrowserTransport, ToolRequestResult } from "./transport.js";
import { WebSocketBridge } from "./webSocketBridge.js";

const NO_EXTENSION_CONNECTED_MESSAGE =
  "No extension connected. Open the ChromeUse side panel and click Connect, or keep a native host session running for fallback.";

type ClosableTransport = BrowserTransport & {
  close?: () => void | Promise<void>;
};

export class WebSocketFirstTransport implements BrowserTransport {
  private lastWebSocketError: Error | null = null;
  private lastNativeError: Error | null = null;

  constructor(
    private readonly webSocket: BrowserTransport = new WebSocketBridge(),
    private readonly native: BrowserTransport = new SocketClient()
  ) {}

  get connected(): boolean {
    return this.webSocket.connected || this.native.connected;
  }

  async connect(): Promise<void> {
    try {
      await this.webSocket.connect();
      this.lastWebSocketError = null;
    } catch (error) {
      this.lastWebSocketError = toError(error);
    }

    if (this.webSocket.connected || this.native.connected) return;

    try {
      await this.native.connect();
      this.lastNativeError = null;
    } catch (error) {
      this.lastNativeError = toError(error);
    }
  }

  async sendToolRequest(
    tool: string,
    args: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<ToolRequestResult> {
    if (this.webSocket.connected) {
      return this.webSocket.sendToolRequest(tool, args, timeoutMs);
    }

    if (this.native.connected) {
      return this.native.sendToolRequest(tool, args, timeoutMs);
    }

    throw new Error(this.unavailableMessage());
  }

  disconnect(): void {
    this.webSocket.disconnect();
    this.native.disconnect();
  }

  async close(): Promise<void> {
    await Promise.all([
      closeTransport(this.webSocket),
      closeTransport(this.native),
    ]);
  }

  private unavailableMessage(): string {
    const details = [
      this.lastWebSocketError?.message,
      this.lastNativeError?.message,
    ].filter(Boolean);

    if (details.length === 0) return NO_EXTENSION_CONNECTED_MESSAGE;
    return `${NO_EXTENSION_CONNECTED_MESSAGE} (${details.join("; ")})`;
  }
}

// ---------------------------------------------------------------------------
// Tool schema definitions
// ---------------------------------------------------------------------------

const TOOL_SCHEMAS: Tool[] = [
  {
    name: TOOL_NAMES.NAVIGATE,
    description: "Navigate to a URL, go back/forward, or reload",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["goto", "back", "forward", "reload"],
          description: "Navigation action to perform",
        },
        url: {
          type: "string",
          description: 'URL to navigate to (required for "goto" action)',
        },
        tabId: {
          type: "number",
          description: "Target tab ID (optional, defaults to active tab)",
        },
      },
      required: ["action"],
    },
  },
  {
    name: TOOL_NAMES.COMPUTER,
    description:
      "Take screenshots, click, type, scroll, drag in the browser. Coordinates are in screenshot pixel space.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "screenshot",
            "click",
            "double_click",
            "right_click",
            "type",
            "key",
            "scroll",
            "drag",
            "move",
          ],
          description: "The action to perform",
        },
        tabId: {
          type: "number",
          description: "Target tab ID",
        },
        x: {
          type: "number",
          description: "X coordinate in screenshot pixel space",
        },
        y: {
          type: "number",
          description: "Y coordinate in screenshot pixel space",
        },
        ref: {
          type: "string",
          description: "Element reference from read_page/find for ref-based clicks",
        },
        text: {
          type: "string",
          description: 'Text to type (for "type" action)',
        },
        key: {
          type: "string",
          description:
            'Key name or combo like "Enter", "ctrl+a" (for "key" action)',
        },
        direction: {
          type: "string",
          enum: ["up", "down", "left", "right"],
          description: "Scroll direction",
        },
        amount: {
          type: "number",
          description: "Scroll distance in pixels",
        },
        startX: {
          type: "number",
          description: 'Start X coordinate for "drag" action',
        },
        startY: {
          type: "number",
          description: 'Start Y coordinate for "drag" action',
        },
        endX: {
          type: "number",
          description: 'End X coordinate for "drag" action',
        },
        endY: {
          type: "number",
          description: 'End Y coordinate for "drag" action',
        },
      },
      required: ["action", "tabId"],
    },
  },
  {
    name: TOOL_NAMES.READ_PAGE,
    description:
      "Read the current page content as an accessibility tree, HTML, or plain text",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "Target tab ID",
        },
        format: {
          type: "string",
          enum: ["accessibility", "html", "text"],
          description:
            'Output format (default: "accessibility"). The accessibility tree includes element references for targeting.',
        },
      },
      required: ["tabId"],
    },
  },
  {
    name: TOOL_NAMES.FIND,
    description:
      "Find an element on the page using a natural language description. Returns element reference and bounds.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "Target tab ID",
        },
        query: {
          type: "string",
          description:
            'Natural language description of the element (e.g. "the search button", "email input field")',
        },
        maxResults: {
          type: "number",
          description: "Maximum number of matching elements to return (default: 5)",
        },
      },
      required: ["tabId", "query"],
    },
  },
  {
    name: TOOL_NAMES.FORM_INPUT,
    description:
      "Set form field values by element reference. Works with text inputs, selects, checkboxes, radio buttons.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "Target tab ID",
        },
        ref: {
          type: "string",
          description:
            "Element reference from accessibility tree (e.g. ref_42)",
        },
        value: {
          type: "string",
          description: "Value to set on the form element",
        },
      },
      required: ["tabId", "ref", "value"],
    },
  },
  {
    name: TOOL_NAMES.GET_PAGE_TEXT,
    description:
      "Extract all visible text content from the current page. Useful for reading articles, getting page content without markup.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "Target tab ID",
        },
        maxLength: {
          type: "number",
          description: "Maximum characters to return (default: 100000, max: 500000)",
        },
      },
      required: ["tabId"],
    },
  },
  {
    name: TOOL_NAMES.JAVASCRIPT,
    description:
      "Execute JavaScript code in the page context. Code runs via CDP Runtime.evaluate. The result of the last expression is returned.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "Target tab ID",
        },
        code: {
          type: "string",
          description: "JavaScript code to execute in the page context",
        },
        awaitPromise: {
          type: "boolean",
          description: "Whether to await Promise results (default: true)",
        },
        timeout: {
          type: "number",
          description: "Evaluation timeout in milliseconds (default: 30000)",
        },
      },
      required: ["tabId", "code"],
    },
  },
  {
    name: TOOL_NAMES.FILE_UPLOAD,
    description: "Upload a file to a file input element on the page",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "Target tab ID",
        },
        selector: {
          type: "string",
          description: "CSS selector for the file input element",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Absolute file paths to upload",
        },
      },
      required: ["tabId", "selector", "files"],
    },
  },
  {
    name: TOOL_NAMES.READ_CONSOLE,
    description:
      "Read browser console messages captured via CDP. Messages include level, text, timestamp, source URL, and line number. Captured since CDP attachment.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "The tab to read console messages from",
        },
        clear: {
          type: "boolean",
          description:
            "If true, clears stored messages after returning them (default: false)",
        },
        level: {
          type: "string",
          enum: ["log", "debug", "info", "warning", "error"],
          description: "Filter by log level. Returns all levels if omitted.",
        },
        limit: {
          type: "number",
          description:
            "Maximum number of messages to return, most recent first (default: 100)",
        },
      },
      required: ["tabId"],
    },
  },
  {
    name: TOOL_NAMES.READ_NETWORK,
    description:
      "Read captured network requests via CDP. Shows URL, method, resource type, status, mimeType, and response timing.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "The tab to read network requests from",
        },
        clear: {
          type: "boolean",
          description:
            "If true, clears stored requests after returning them (default: false)",
        },
        urlPattern: {
          type: "string",
          description: "Filter requests by URL substring match",
        },
        method: {
          type: "string",
          description:
            'Filter by HTTP method (e.g., "GET", "POST"). Case-insensitive.',
        },
        limit: {
          type: "number",
          description:
            "Maximum number of requests to return, most recent first (default: 100)",
        },
      },
      required: ["tabId"],
    },
  },
  {
    name: TOOL_NAMES.RESIZE_WINDOW,
    description: "Resize the browser window to specific dimensions",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "Target tab ID whose window should be resized",
        },
        width: { type: "number", description: "Window width in pixels" },
        height: { type: "number", description: "Window height in pixels" },
      },
      required: ["tabId", "width", "height"],
    },
  },
  {
    name: TOOL_NAMES.TABS_CONTEXT,
    description:
      "Get information about all open tabs and tab groups. Returns tab IDs, titles, URLs, and group assignments.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: TOOL_NAMES.TABS_CREATE,
    description: "Create a new browser tab, optionally with a URL",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to open in the new tab" },
        active: {
          type: "boolean",
          description: "Whether to make the tab active (default: true)",
        },
      },
      required: ["url"],
    },
  },
  {
    name: TOOL_NAMES.TABS_CLOSE,
    description: "Close a browser tab by its ID",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "ID of the tab to close" },
        tabIds: {
          type: "array",
          items: { type: "number" },
          description: "IDs of tabs to close; takes precedence over tabId",
        },
      },
    },
  },
  {
    name: TOOL_NAMES.GIF_CREATOR,
    description:
      'Record browser actions as an animated GIF. Use "start" to begin recording, "screenshot" to capture frames, and "stop" to finish and return the GIF.',
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start", "screenshot", "stop"],
          description: "Recording action to perform",
        },
        tabId: {
          type: "number",
          description: "Target tab ID for the recording session",
        },
        delay: {
          type: "number",
          description: "Frame delay in centiseconds for stop action (default: 50)",
        },
      },
      required: ["action", "tabId"],
    },
  },
  {
    name: TOOL_NAMES.MARKDOWN_RENDER,
    description:
      "Render markdown text or accessible workspace file content to safe HTML. Raw HTML is disabled by default.",
    inputSchema: {
      type: "object",
      properties: {
        markdown: {
          type: "string",
          description:
            "Markdown text to render. Provide this, filePath, or url.",
        },
        filePath: {
          type: "string",
          description:
            "Workspace file path containing markdown to render when file access is available.",
        },
        url: {
          type: "string",
          description:
            "Accessible file: or extension-accessible URL containing markdown to render when direct workspace file access is unavailable.",
        },
        allowRawHtml: {
          type: "boolean",
          description:
            "Allow raw HTML in markdown input. Disabled by default; unsafe HTML is escaped unless explicitly enabled by the handler.",
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

/**
 * Create and configure the MCP server.
 *
 * The server registers all tool schemas and forwards tool/call requests
 * to the Chrome extension via WebSocket-first browser transport.
 *
 * @param browserTransport - Optional pre-configured browser transport (for testing).
 *   If not provided, the server will create one and attempt to connect.
 */
export async function createMcpServer(
  browserTransport?: BrowserTransport
): Promise<Server> {
  const server = new Server(
    { name: "chromeuse-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  const client = browserTransport ?? new WebSocketFirstTransport();
  if (!browserTransport) await client.connect();

  const closeServer = server.close.bind(server);
  let closing = false;
  server.close = async () => {
    if (closing) return;
    closing = true;
    try {
      await closeServer();
    } finally {
      await closeTransport(client);
    }
  };

  // ---------------------------------------------------------------------------
  // tools/list handler
  // ---------------------------------------------------------------------------

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_SCHEMAS,
  }));

  // ---------------------------------------------------------------------------
  // tools/call handler
  // ---------------------------------------------------------------------------

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Validate tool name
    const validToolNames = TOOL_SCHEMAS.map((t) => t.name);
    if (!validToolNames.includes(name)) {
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    // Ensure transport resources are started and a browser connection is available.
    if (!client.connected) {
      try {
        await client.connect();
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to connect to Chrome extension: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }

    // Forward the tool call to the extension via native host
    try {
      const result = await client.sendToolRequest(
        name,
        (args ?? {}) as Record<string, unknown>
      );
      return result;
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Tool execution failed: ${(err as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Get the list of tool schemas (useful for testing / introspection).
 */
export function getToolSchemas(): readonly Tool[] {
  return TOOL_SCHEMAS;
}

async function closeTransport(transport: BrowserTransport): Promise<void> {
  const closable = transport as ClosableTransport;
  if (typeof closable.close === "function") {
    await closable.close();
  } else {
    transport.disconnect();
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
