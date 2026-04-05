/**
 * Side Panel Handler for the service worker.
 *
 * Manages state that the side panel displays:
 * - Connection status (forwarded from nativeMessaging)
 * - Tool execution history (tracked from message router)
 *
 * Handles incoming messages from the side panel and broadcasts
 * state changes to all extension pages.
 */

import type {
  ConnectionStatus,
  SidePanelState,
  SidePanelBroadcast,
  ToolExecutionEntry,
} from "../types/messages.js";

/** Maximum number of tool execution entries to keep in memory */
const MAX_HISTORY = 200;

/** Auto-incrementing ID for tool execution entries */
let nextToolId = 1;

/** Current tool execution history (newest appended at end) */
const toolHistory: ToolExecutionEntry[] = [];

/** Current connection status (updated by nativeMessaging via setConnectionStatus) */
let connectionStatus: ConnectionStatus = "disconnected";

/**
 * Update the connection status and broadcast to side panel.
 * Called from nativeMessaging when status changes.
 */
export function setConnectionStatus(status: ConnectionStatus): void {
  connectionStatus = status;
  broadcast({ type: "connection_status_changed", status });
}

/**
 * Record the start of a tool execution.
 * Returns the entry ID for later updates.
 */
export function recordToolStart(toolName: string): number {
  const id = nextToolId++;
  const entry: ToolExecutionEntry = {
    id,
    tool: toolName,
    timestamp: Date.now(),
    status: "running",
  };
  toolHistory.push(entry);

  // Trim oldest entries if over limit
  while (toolHistory.length > MAX_HISTORY) {
    toolHistory.shift();
  }

  broadcast({ type: "tool_execution_update", entry });
  return id;
}

/**
 * Record the completion of a tool execution.
 */
export function recordToolComplete(
  id: number,
  success: boolean,
  error?: string,
): void {
  const entry = toolHistory.find((e) => e.id === id);
  if (!entry) return;

  // ToolExecutionEntry fields are readonly in the type but we own the mutable
  // backing objects here, so cast for internal mutation.
  (entry as { status: string }).status = success ? "success" : "error";
  (entry as { durationMs?: number }).durationMs =
    Date.now() - entry.timestamp;
  if (error) {
    (entry as { error?: string }).error = error;
  }

  broadcast({ type: "tool_execution_update", entry });
}

/**
 * Get the current state for the side panel.
 */
export function getSidePanelState(): SidePanelState {
  return {
    connectionStatus,
    toolHistory: [...toolHistory],
  };
}

/**
 * Broadcast a message to all extension pages (side panel, popup, etc.).
 * Silently ignores errors (side panel may not be open).
 */
function broadcast(message: SidePanelBroadcast): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // No listeners - side panel is probably closed. This is expected.
  });
}

/**
 * Set up the chrome.runtime.onMessage listener for side panel requests.
 * Also handles the stop_automation action from the content script's stop button.
 */
export function initSidePanelHandler(): void {
  chrome.runtime.onMessage.addListener(
    (message: { action?: string }, _sender, sendResponse) => {
      if (!message.action) return false;

      switch (message.action) {
        case "sidepanel_get_state":
          sendResponse(getSidePanelState());
          return false; // synchronous response

        case "sidepanel_stop_automation":
        case "stop_automation":
          // Disconnect native messaging to stop all automation
          // Import is async in ES modules, so handle dynamically
          import("./nativeMessaging.js").then(({ nativeMessaging }) => {
            nativeMessaging.disconnect();
            // Immediately reconnect so the extension is ready for next session
            setTimeout(() => nativeMessaging.connect(), 500);
          });
          sendResponse({ success: true });
          return false;

        default:
          return false; // not handled
      }
    },
  );

  // Open side panel when the extension action (toolbar icon) is clicked
  chrome.action.onClicked.addListener((tab) => {
    if (tab.id != null) {
      chrome.sidePanel.open({ tabId: tab.id }).catch((err: unknown) => {
        console.error("[SidePanelHandler] Failed to open side panel:", err);
      });
    }
  });
}
