/**
 * console tool - reads console messages captured from a browser tab via CDP.
 *
 * Console messages are captured using Runtime.consoleAPICalled events and stored
 * per-tab. The tool returns accumulated messages on request, with optional filtering.
 *
 * Args:
 *   tabId (number, required): The tab to read console messages from.
 *   clear (boolean, optional): If true, clears stored messages after returning them. Defaults to false.
 *   level (string, optional): Filter by log level: "log", "debug", "info", "warning", "error". Returns all if omitted.
 *   limit (number, optional): Maximum number of messages to return (most recent). Defaults to 100.
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";
import { cdpManager } from "../cdp.js";

/** Maximum messages stored per tab */
const MAX_MESSAGES_PER_TAB = 1000;

/** Default number of messages returned */
const DEFAULT_LIMIT = 100;

/** Valid console log levels */
const VALID_LEVELS: ReadonlySet<string> = new Set([
  "log",
  "debug",
  "info",
  "warning",
  "error",
]);

/** A captured console message */
interface ConsoleMessage {
  level: string;
  text: string;
  timestamp: number;
  url?: string;
  lineNumber?: number;
}

/** CDP Runtime.consoleAPICalled event params */
interface ConsoleAPICalledParams {
  type: string;
  args: Array<{
    type: string;
    subtype?: string;
    value?: unknown;
    description?: string;
    unserializableValue?: string;
  }>;
  executionContextId?: number;
  timestamp: number;
  stackTrace?: {
    callFrames: Array<{
      url: string;
      lineNumber: number;
      columnNumber: number;
    }>;
  };
}

export class ConsoleTool implements ToolHandler {
  /** Per-tab console message storage */
  private messages = new Map<number, ConsoleMessage[]>();

  /** Tabs we've subscribed to events for */
  private subscribedTabs = new Set<number>();

  constructor() {
    // Register a single CDP event listener for all console events
    cdpManager.addEventListener((source, method, params) => {
      if (
        method === "Runtime.consoleAPICalled" &&
        source.tabId !== undefined
      ) {
        this.handleConsoleEvent(
          source.tabId,
          params as unknown as ConsoleAPICalledParams,
        );
      }
    });

    // Clean up messages when tabs are removed
    chrome.tabs.onRemoved.addListener((tabId: number) => {
      this.messages.delete(tabId);
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
      const level = typeof args.level === "string" ? args.level : undefined;
      const limit = typeof args.limit === "number" ? args.limit : DEFAULT_LIMIT;

      // Validate level if provided
      if (level && !VALID_LEVELS.has(level)) {
        return {
          success: false,
          content: [
            {
              type: "text",
              text: `Invalid level: "${level}". Must be one of: ${Array.from(VALID_LEVELS).join(", ")}`,
            },
          ],
        };
      }

      // Ensure CDP is attached and Runtime domain is enabled for this tab
      if (!cdpManager.isAttached(tabId)) {
        await cdpManager.attach(tabId);
      }

      // Enable Runtime domain to receive consoleAPICalled events
      if (!this.subscribedTabs.has(tabId)) {
        await cdpManager.enableDomain(tabId, "Runtime");
        this.subscribedTabs.add(tabId);
      }

      // Get stored messages for this tab
      let tabMessages = this.messages.get(tabId) ?? [];

      // Filter by level if specified
      if (level) {
        tabMessages = tabMessages.filter((msg) => msg.level === level);
      }

      // Apply limit (most recent messages)
      if (tabMessages.length > limit) {
        tabMessages = tabMessages.slice(-limit);
      }

      // Clear messages if requested
      if (clear) {
        this.messages.delete(tabId);
      }

      const result = {
        tabId,
        messageCount: tabMessages.length,
        messages: tabMessages.map((msg) => ({
          level: msg.level,
          text: msg.text,
          timestamp: msg.timestamp,
          ...(msg.url ? { url: msg.url } : {}),
          ...(msg.lineNumber !== undefined ? { lineNumber: msg.lineNumber } : {}),
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
            text: `Failed to read console messages: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  /**
   * Handle a Runtime.consoleAPICalled event from CDP.
   */
  private handleConsoleEvent(
    tabId: number,
    params: ConsoleAPICalledParams,
  ): void {
    if (!params) return;

    // Map CDP console type to our level names
    const level = this.mapConsoleType(params.type);

    // Format the console arguments into a text string
    const text = this.formatConsoleArgs(params.args);

    // Extract source location from stack trace
    const topFrame = params.stackTrace?.callFrames?.[0];

    const message: ConsoleMessage = {
      level,
      text,
      timestamp: params.timestamp,
      ...(topFrame?.url ? { url: topFrame.url } : {}),
      ...(topFrame?.lineNumber !== undefined
        ? { lineNumber: topFrame.lineNumber + 1 }
        : {}),
    };

    // Store the message
    let tabMessages = this.messages.get(tabId);
    if (!tabMessages) {
      tabMessages = [];
      this.messages.set(tabId, tabMessages);
    }
    tabMessages.push(message);

    // Trim to max storage
    if (tabMessages.length > MAX_MESSAGES_PER_TAB) {
      tabMessages.splice(0, tabMessages.length - MAX_MESSAGES_PER_TAB);
    }
  }

  /**
   * Map CDP Runtime.consoleAPICalled type to a standard level name.
   */
  private mapConsoleType(type: string): string {
    switch (type) {
      case "log":
        return "log";
      case "debug":
        return "debug";
      case "info":
        return "info";
      case "warning":
      case "warn":
        return "warning";
      case "error":
      case "assert":
        return "error";
      default:
        return "log";
    }
  }

  /**
   * Format console API arguments into a readable text string.
   */
  private formatConsoleArgs(args: ConsoleAPICalledParams["args"]): string {
    if (!args || args.length === 0) return "";

    return args
      .map((arg) => {
        if (arg.unserializableValue) {
          return arg.unserializableValue;
        }
        if (arg.value !== undefined) {
          return typeof arg.value === "string"
            ? arg.value
            : JSON.stringify(arg.value);
        }
        if (arg.description) {
          return arg.description;
        }
        return `[${arg.type}${arg.subtype ? `:${arg.subtype}` : ""}]`;
      })
      .join(" ");
  }
}
