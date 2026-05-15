/**
 * MessageRouter dispatches incoming tool requests to registered tool handlers.
 *
 * Each tool is registered by name and implements the ToolHandler interface.
 * The router validates that the requested tool exists before dispatching.
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../types/messages.js";
import { markAutomationTab, unmarkAutomationTab } from "./automationIndicator.js";
import {
  finishAutomationTabWorking,
  recordAutomationTab,
  setAutomationTabWorking,
} from "./sidePanelHandler.js";

export interface ToolRequest {
  method: string;
  params: {
    request_id: string;
    tool: string;
    args: Record<string, unknown>;
    client_id?: string;
    session_scope?: string;
  };
}

export class MessageRouter {
  private toolRegistry = new Map<string, ToolHandler>();
  private routeQueue: Promise<void> = Promise.resolve();

  /**
   * Register a tool handler by name.
   */
  register(toolName: string, handler: ToolHandler): void {
    this.toolRegistry.set(toolName, handler);
  }

  /**
   * Get the list of registered tool names.
   */
  getRegisteredTools(): string[] {
    return Array.from(this.toolRegistry.keys());
  }

  /**
   * Route a tool request to the appropriate handler.
   * Returns an error result if the tool is not registered.
   */
  async route(request: ToolRequest): Promise<ToolResult> {
    const previous = this.routeQueue;
    let releaseCurrent: () => void;
    this.routeQueue = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });

    await previous;
    try {
      return await this.routeNow(request);
    } finally {
      releaseCurrent!();
    }
  }

  private async routeNow(request: ToolRequest): Promise<ToolResult> {
    const { tool, args, session_scope } = request.params;

    const handler = this.toolRegistry.get(tool);
    if (!handler) {
      return {
        success: false,
        content: [
          {
            type: "text",
            text: `Unknown tool: ${tool}. Available tools: ${this.getRegisteredTools().join(", ")}`,
          },
        ],
      };
    }

    const context: ToolContext = {
      sessionScope: session_scope,
    };

    const activeAutomationTabId = typeof args.tabId === "number" ? args.tabId : undefined;

    try {
      if (activeAutomationTabId !== undefined) {
        try {
          recordAutomationTab(await chrome.tabs.get(activeAutomationTabId));
        } catch {
          // The underlying tool will return its own tab-not-found error if needed.
        }
        setAutomationTabWorking(activeAutomationTabId, true);
        await markAutomationTab(activeAutomationTabId);
      }
      return await handler.execute(args, context);
    } catch (error) {
      return {
        success: false,
        content: [
          {
            type: "text",
            text: `Tool "${tool}" failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    } finally {
      if (activeAutomationTabId !== undefined) {
        finishAutomationTabWorking(activeAutomationTabId);
        await unmarkAutomationTab(activeAutomationTabId);
      }
    }
  }
}

/** Singleton instance */
export const messageRouter = new MessageRouter();
