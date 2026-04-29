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

    try {
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
    }
  }
}

/** Singleton instance */
export const messageRouter = new MessageRouter();
