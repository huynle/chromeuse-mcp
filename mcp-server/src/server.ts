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
  type CallToolResult,
  type ContentBlock as McpContentBlock,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOL_NAMES } from "@chromeuse/shared";
import { SocketClient } from "./socketClient.js";
import type { BrowserTransport, ToolRequestMetadata, ToolRequestResult } from "./transport.js";
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
    timeoutMs?: number,
    metadata?: ToolRequestMetadata
  ): Promise<ToolRequestResult> {
    if (this.webSocket.connected) {
      return metadata
        ? this.webSocket.sendToolRequest(tool, args, timeoutMs, metadata)
        : this.webSocket.sendToolRequest(tool, args, timeoutMs);
    }

    if (this.native.connected) {
      return metadata
        ? this.native.sendToolRequest(tool, args, timeoutMs, metadata)
        : this.native.sendToolRequest(tool, args, timeoutMs);
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

const INTERACTION_POLICY =
  "Default workflow: start with tabs_context to choose the target tab, read visible page text for understanding, use accessibility/read_page or find for user-visible controls, use javascript_tool only for exact state or geometry, then use computer for last-mile visual mouse/keyboard actions.";

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
      `Last-mile visual interaction tool for screenshots, mouse, keyboard, scroll, and drag. Prefer read_page/find refs before coordinates when possible; use count or move_path for repeated/precise mouse-heavy interactions instead of parallel calls. Coordinates are in screenshot pixel space. ${INTERACTION_POLICY}`,
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
            "move_path",
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
        count: {
          type: "number",
          description: "Number of repeated click actions to perform in one serialized request (max 100)",
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
        points: {
          type: "array",
          description: 'Ordered screenshot-coordinate waypoints for "move_path" action',
          items: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
            },
            required: ["x", "y"],
          },
        },
      },
      required: ["action", "tabId"],
    },
  },
  {
    name: TOOL_NAMES.READ_PAGE,
    description:
      `Read the current page content as an accessibility tree, HTML, or plain text. Use accessibility for controls/refs before clicking, text for visible content, and HTML only when structure matters. ${INTERACTION_POLICY}`,
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
      `Find a user-visible element by natural language. Prefer this before computer coordinate clicks; it returns refs and bounds for buttons, links, inputs, menus, and other controls. ${INTERACTION_POLICY}`,
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
      `Read first for most pages: extract visible text content without markup to understand headings, labels, articles, prompts, blockers, and login/cookie states before acting. ${INTERACTION_POLICY}`,
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
      `Execute JavaScript in the page context for exact state, DOM geometry, counters, selected values, hidden app state, or verification. Do not use as the first read when visible text/accessibility is enough. ${INTERACTION_POLICY}`,
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
      `Start here: get all open tabs and tab groups so you choose the right target tab before reading or acting. Returns tab IDs, titles, URLs, and group assignments. ${INTERACTION_POLICY}`,
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
  {
    name: TOOL_NAMES.WORKSPACE_LIST_FILES,
    description:
      "List files and directories under the workspace selected in the ChromeUse side panel. Requires current File System Access permission for the selected workspace.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Workspace-relative directory path to list. Defaults to the workspace root.",
        },
        depth: {
          type: "number",
          description:
            "Maximum recursive directory depth to include. Defaults to 1.",
        },
        limit: {
          type: "number",
          description:
            "Maximum number of entries to return before truncating the listing.",
        },
      },
    },
  },
  {
    name: TOOL_NAMES.WORKSPACE_READ_FILE,
    description:
      "Read a text-like file from the workspace selected in the ChromeUse side panel. Requires current File System Access permission for the selected workspace.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative path to the file to read.",
        },
        limit: {
          type: "number",
          description:
            "Maximum number of characters to return before truncating file content.",
        },
        encoding: {
          type: "string",
          enum: ["utf-8"],
          description: "Text encoding to use when reading the file. Defaults to utf-8.",
        },
      },
      required: ["path"],
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
  const clientId = `chromeuse-mcp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
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
        (args ?? {}) as Record<string, unknown>,
        undefined,
        { clientId }
      );
      return toMcpToolResult(result);
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

function toMcpToolResult(result: ToolRequestResult): CallToolResult & Record<string, unknown> {
  return {
    ...result,
    content: result.content.map(toMcpContentBlock),
  };
}

function toMcpContentBlock(content: unknown): McpContentBlock {
  if (isExtensionImageContent(content)) {
    return {
      type: "image",
      data: content.source.data,
      mimeType: content.source.media_type,
    };
  }

  return content as McpContentBlock;
}

function isExtensionImageContent(content: unknown): content is {
  readonly type: "image";
  readonly source: {
    readonly type: "base64";
    readonly media_type: string;
    readonly data: string;
  };
} {
  if (!isRecord(content) || content.type !== "image") return false;
  if (!isRecord(content.source)) return false;

  return (
    content.source.type === "base64" &&
    typeof content.source.media_type === "string" &&
    typeof content.source.data === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
