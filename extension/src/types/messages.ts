/**
 * Extension-local type definitions for the Chrome extension.
 *
 * Wire protocol types (ContentBlock, NativeMessage, ExtensionMessage, etc.)
 * live in @chromeuse/shared. This file defines types that are internal
 * to the extension: tool handler interface, connection status, badge config,
 * side panel state, and tool execution tracking.
 */

import type { ContentBlock, ToolResult, ToolContext } from "@chromeuse/shared";

// Re-export shared types used extensively within the extension
export type { ContentBlock, ToolResult, ToolContext };

// ---------------------------------------------------------------------------
// Tool handler interface
// ---------------------------------------------------------------------------

/** Interface that all tool handlers must implement */
export interface ToolHandler {
  execute(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult>;
}

// ---------------------------------------------------------------------------
// Connection status
// ---------------------------------------------------------------------------

/** Native messaging connection state */
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/** Badge colors corresponding to connection states */
export const BADGE_COLORS: Record<ConnectionStatus, string> = {
  disconnected: "#9CA3AF", // gray
  connecting: "#F59E0B", // amber
  connected: "#10B981", // green
  error: "#EF4444", // red
};

/** Badge text corresponding to connection states */
export const BADGE_TEXT: Record<ConnectionStatus, string> = {
  disconnected: "",
  connecting: "...",
  connected: "ON",
  error: "ERR",
};

// ---------------------------------------------------------------------------
// Tool execution tracking
// ---------------------------------------------------------------------------

/** A record of a tool execution for display in the side panel */
export interface ToolExecutionEntry {
  readonly id: number;
  readonly tool: string;
  readonly timestamp: number;
  readonly status: "running" | "success" | "error";
  readonly durationMs?: number;
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// Side panel types
// ---------------------------------------------------------------------------

/** Messages FROM the side panel to the service worker */
export type SidePanelRequest =
  | { readonly action: "sidepanel_get_state" }
  | { readonly action: "sidepanel_connect" }
  | { readonly action: "sidepanel_disconnect" }
  | { readonly action: "sidepanel_stop_automation" };

/** Full state snapshot sent to the side panel */
export interface SidePanelState {
  readonly connectionStatus: ConnectionStatus;
  readonly toolHistory: readonly ToolExecutionEntry[];
}

/** Broadcast from service worker to all extension pages when state changes */
export type SidePanelBroadcast =
  | {
      readonly type: "connection_status_changed";
      readonly status: ConnectionStatus;
    }
  | {
      readonly type: "tool_execution_update";
      readonly entry: ToolExecutionEntry;
    };
