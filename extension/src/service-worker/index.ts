/**
 * Service Worker entry point for the ChromeUse MCP extension.
 *
 * Responsibilities:
 * 1. Initialize native messaging connection to the host process
 * 2. Register tool handlers with the message router
 * 3. Initialize CDP manager for debugger connections
 * 4. Set up lifecycle event listeners (install, startup)
 * 5. Wire side panel handler for UI state broadcasting
 *
 * The service worker is the central coordinator: it receives tool requests
 * from the native host (via native messaging), dispatches them to tool
 * handlers, and sends results back.
 */

import { nativeMessaging } from "./nativeMessaging.js";
import { webSocketConnection } from "./webSocketConnection.js";
import { messageRouter } from "./messageRouter.js";
import { updateBadge } from "./badge.js";
import { cdpManager } from "./cdp.js";
import { resolveBrowserTransportStatus } from "./connectionStatus.js";
import { ensureAutoConnect, initAutoConnect } from "./autoConnect.js";
import { initAutomationIndicator } from "./automationIndicator.js";
import {
  initSidePanelHandler,
  setConnectionStatus,
} from "./sidePanelHandler.js";
import { registerTools } from "./tools/index.js";

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

console.log("[ServiceWorker] ChromeUse MCP extension starting");

// --- Tool registration ---

registerTools(messageRouter);

// --- Side panel handler ---

initSidePanelHandler();
initAutomationIndicator();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || message.action !== "chromeuse_fetch_directory_listing") {
    return false;
  }

  const url = typeof message.url === "string" ? message.url : "";
  fetch(url)
    .then(async (response) => {
      if (!response.ok && !isFileUrl(url)) throw new Error(`HTTP ${response.status}`);
      sendResponse({ ok: true, html: await response.text() });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "Unable to load files" });
    });

  return true;
});

function isFileUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "file:";
  } catch {
    return false;
  }
}

// --- CDP manager ---

cdpManager.initialize().catch((err) => {
  console.error("[ServiceWorker] Failed to initialize CDP manager:", err);
});

// --- Browser transport connections ---

function syncBrowserTransportStatus(): void {
  setConnectionStatus(
    resolveBrowserTransportStatus(webSocketConnection.status, nativeMessaging.status),
  );
}

// Keep the side panel showing the combined state across WebSocket and native
// messaging, so managed-Chrome native failures do not hide a live WebSocket.
nativeMessaging.onConnectionStatusChange(syncBrowserTransportStatus);
webSocketConnection.onConnectionStatusChange(syncBrowserTransportStatus);

// Auto-connect to the gateway in the background so ChromeUse is ready to use
// without a manual Connect click. Respects an explicit user Disconnect, which
// persists an opt-out (see autoConnect.ts). The keepalive alarm re-establishes
// the connection whenever the service worker wakes after being suspended.
initAutoConnect();

// ---------------------------------------------------------------------------
// Lifecycle Events
// ---------------------------------------------------------------------------

/**
 * Handle extension install/update events.
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log("[ServiceWorker] Installed:", details.reason);

  if (details.reason === "install") {
    // First install - show disconnected status until the gateway is reachable.
    updateBadge("disconnected");
  }

  // Get ready in the background right after install/update.
  void ensureAutoConnect();
});

/**
 * Handle service worker startup (e.g., after being suspended or browser launch).
 * Re-establish the background gateway connection.
 */
chrome.runtime.onStartup.addListener(() => {
  console.log("[ServiceWorker] Starting up");
  void ensureAutoConnect();
});
