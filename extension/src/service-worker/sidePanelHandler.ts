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
  AutomationTabEntry,
  ToolExecutionEntry,
} from "../types/messages.js";
import { updateBadge } from "./badge.js";
import { clearAutomationIndicators } from "./automationIndicator.js";
import { clearUserStop, stopActiveToolRequests } from "./toolRequestHandler.js";
import { webSocketConnection } from "./webSocketConnection.js";

/** Maximum number of tool execution entries to keep in memory */
const MAX_HISTORY = 200;
const AUTOMATION_IDLE_GRACE_MS = 3000;

/** Auto-incrementing ID for tool execution entries */
let nextToolId = 1;

/** Current tool execution history (newest appended at end) */
const toolHistory: ToolExecutionEntry[] = [];

/** Tabs created by ChromeUse automation tools. */
const automationTabs = new Map<number, AutomationTabEntry>();
const automationIdleTimers = new Map<number, ReturnType<typeof setTimeout>>();

/** Current connection status (updated by nativeMessaging via setConnectionStatus) */
let connectionStatus: ConnectionStatus = "disconnected";

/**
 * Update the connection status and broadcast to side panel.
 * Called from nativeMessaging when status changes.
 */
export function setConnectionStatus(status: ConnectionStatus): void {
  connectionStatus = status;
  updateBadge(status);
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

export function recordAutomationTab(tab: chrome.tabs.Tab): void {
  if (tab.id === undefined) return;

  automationTabs.set(tab.id, {
    tabId: tab.id,
    title: tab.title ?? tab.url ?? tab.pendingUrl ?? `Tab ${tab.id}`,
    url: tab.url ?? tab.pendingUrl ?? "",
    windowId: tab.windowId,
    active: tab.active,
    isAutomating: automationTabs.get(tab.id)?.isAutomating ?? false,
  });

  broadcastAutomationTabs();
}

function updateAutomationTab(tabId: number, tab: chrome.tabs.Tab): void {
  const existing = automationTabs.get(tabId);
  if (!existing) return;

  automationTabs.set(tabId, {
    tabId,
    title: tab.title ?? tab.url ?? tab.pendingUrl ?? existing.title,
    url: tab.url ?? tab.pendingUrl ?? existing.url,
    windowId: tab.windowId,
    active: tab.active,
    isAutomating: existing.isAutomating,
  });

  broadcastAutomationTabs();
}

function removeAutomationTab(tabId: number): void {
  clearAutomationIdleTimer(tabId);
  if (!automationTabs.delete(tabId)) return;
  broadcastAutomationTabs();
}

function getAutomationTabs(): AutomationTabEntry[] {
  return [...automationTabs.values()].sort((a, b) => a.tabId - b.tabId);
}

function broadcastAutomationTabs(): void {
  broadcast({ type: "automation_tabs_changed", tabs: getAutomationTabs() });
}

export function setAutomationTabWorking(tabId: number, isAutomating: boolean): void {
  clearAutomationIdleTimer(tabId);
  const existing = automationTabs.get(tabId);
  if (!existing) {
    automationTabs.set(tabId, {
      tabId,
      title: `Tab ${tabId}`,
      url: "",
      windowId: -1,
      active: false,
      isAutomating,
    });
    broadcastAutomationTabs();
    return;
  }

  automationTabs.set(tabId, { ...existing, isAutomating });
  broadcastAutomationTabs();
}

export function finishAutomationTabWorking(tabId: number): void {
  clearAutomationIdleTimer(tabId);
  automationIdleTimers.set(
    tabId,
    setTimeout(() => {
      automationIdleTimers.delete(tabId);
      setAutomationTabWorking(tabId, false);
    }, AUTOMATION_IDLE_GRACE_MS),
  );
}

function clearAutomationIdleTimer(tabId: number): void {
  const timer = automationIdleTimers.get(tabId);
  if (timer === undefined) return;

  clearTimeout(timer);
  automationIdleTimers.delete(tabId);
}

/**
 * Get the current state for the side panel.
 */
export function getSidePanelState(): SidePanelState {
  return {
    connectionStatus,
    toolHistory: [...toolHistory],
    automationTabs: getAutomationTabs(),
  };
}

async function focusAutomationTab(tabId: number): Promise<void> {
  const tab = automationTabs.get(tabId);
  if (!tab) throw new Error(`Automation tab ${tabId} is not tracked`);

  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

async function closeAutomationTab(tabId: number): Promise<void> {
  if (!automationTabs.has(tabId)) throw new Error(`Automation tab ${tabId} is not tracked`);

  await chrome.tabs.remove(tabId);
  removeAutomationTab(tabId);
}

function stopAutomation(tabId?: number): number {
  const stopped = stopActiveToolRequests(tabId);
  void clearAutomationIndicators();
  if (tabId !== undefined) setAutomationTabWorking(tabId, false);
  else {
    for (const tab of getAutomationTabs()) setAutomationTabWorking(tab.tabId, false);
  }

  return stopped;
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
    (message: { action?: string; tabId?: number }, _sender, sendResponse) => {
      if (!message.action) return false;

      switch (message.action) {
        case "sidepanel_get_state":
          if (webSocketConnection.status === "waiting") {
            void webSocketConnection.recoverFromActivity();
          }
          sendResponse(getSidePanelState());
          return false; // synchronous response

        case "sidepanel_connect":
          clearUserStop();
          webSocketConnection.connect();
          sendResponse({ success: true });
          return false;

        case "sidepanel_disconnect":
          webSocketConnection.disconnect();
          sendResponse({ success: true });
          return false;

        case "sidepanel_focus_tab":
          if (typeof message.tabId !== "number") {
            sendResponse({ success: false, error: "Missing tabId" });
            return false;
          }

          void focusAutomationTab(message.tabId)
            .then(() => sendResponse({ success: true }))
            .catch((error: unknown) => {
              sendResponse({
                success: false,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          return true;

        case "sidepanel_close_tab":
          if (typeof message.tabId !== "number") {
            sendResponse({ success: false, error: "Missing tabId" });
            return false;
          }

          void closeAutomationTab(message.tabId)
            .then(() => sendResponse({ success: true }))
            .catch((error: unknown) => {
              sendResponse({
                success: false,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          return true;

        case "sidepanel_stop_tab_automation":
          if (typeof message.tabId !== "number") {
            sendResponse({ success: false, error: "Missing tabId" });
            return false;
          }

          sendResponse({ success: true, stopped: stopAutomation(message.tabId) });
          return false;

        case "sidepanel_stop_automation":
        case "stop_automation":
          stopAutomation(
            typeof message.tabId === "number"
              ? message.tabId
              : typeof _sender.tab?.id === "number"
                ? _sender.tab.id
                : undefined,
          );
          sendResponse({ success: true });
          return false;

        default:
          return false; // not handled
      }
    },
  );

  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => {
      console.error("[SidePanelHandler] Failed to enable action side panel toggle:", err);
    });

  chrome.tabs.onRemoved.addListener((tabId) => removeAutomationTab(tabId));
  chrome.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => {
    updateAutomationTab(tabId, tab);
  });
}
