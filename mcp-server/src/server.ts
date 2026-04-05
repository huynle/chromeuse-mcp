/**
 * MCP Server that exposes Chrome browser tools to OpenCode.
 *
 * Registers 15 tool schemas via the MCP protocol and forwards
 * tool calls to the Chrome extension through the native host socket.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOL_NAMES } from "@opencode-chrome/shared";
import { SocketClient } from "./socketClient.js";

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
        coordinate: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
          description: "[x, y] coordinates in screenshot pixel space",
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
        scroll_direction: {
          type: "string",
          enum: ["up", "down", "left", "right"],
          description: "Scroll direction",
        },
        scroll_amount: {
          type: "number",
          description: "Scroll distance in pixels",
        },
        start_coordinate: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
          description: 'Start coordinate for "drag" action',
        },
        end_coordinate: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
          description: 'End coordinate for "drag" action',
        },
      },
      required: ["action"],
    },
  },
  {
    name: TOOL_NAMES.READ_PAGE,
    description:
      "Read the current page content as an accessibility tree, HTML, or plain text",
    inputSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["a11y_tree", "html", "text"],
          description:
            'Output format (default: "a11y_tree"). The accessibility tree includes element references for targeting.',
        },
      },
    },
  },
  {
    name: TOOL_NAMES.FIND,
    description:
      "Find an element on the page using a natural language description. Returns element reference and bounds.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description:
            'Natural language description of the element (e.g. "the search button", "email input field")',
        },
      },
      required: ["description"],
    },
  },
  {
    name: TOOL_NAMES.FORM_INPUT,
    description:
      "Set form field values by element reference. Works with text inputs, selects, checkboxes, radio buttons.",
    inputSchema: {
      type: "object",
      properties: {
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
      required: ["ref", "value"],
    },
  },
  {
    name: TOOL_NAMES.GET_PAGE_TEXT,
    description:
      "Extract all visible text content from the current page. Useful for reading articles, getting page content without markup.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: TOOL_NAMES.JAVASCRIPT,
    description:
      "Execute JavaScript code in the page context. Code runs via CDP Runtime.evaluate. The result of the last expression is returned.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "JavaScript code to execute in the page context",
        },
      },
      required: ["code"],
    },
  },
  {
    name: TOOL_NAMES.FILE_UPLOAD,
    description: "Upload a file to a file input element on the page",
    inputSchema: {
      type: "object",
      properties: {
        ref: {
          type: "string",
          description: "Element reference for the file input",
        },
        filePath: {
          type: "string",
          description: "Absolute path to the file to upload",
        },
      },
      required: ["ref", "filePath"],
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
        width: { type: "number", description: "Window width in pixels" },
        height: { type: "number", description: "Window height in pixels" },
      },
      required: ["width", "height"],
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
      },
      required: ["tabId"],
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
      },
      required: ["action"],
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
 * to the Chrome extension via the native host socket.
 *
 * @param socketClient - Optional pre-configured socket client (for testing).
 *   If not provided, the server will create one and attempt to connect.
 */
export async function createMcpServer(
  socketClient?: SocketClient
): Promise<Server> {
  const server = new Server(
    { name: "opencode-chrome", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  // Use provided client or create a new one
  const client = socketClient ?? new SocketClient();

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

    // Ensure we're connected to the native host
    if (!client.connected) {
      try {
        await client.connect();
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to connect to native host: ${(err as Error).message}. Is the Chrome extension running?`,
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
