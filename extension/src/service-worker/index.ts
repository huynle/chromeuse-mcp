/**
 * Service Worker entry point for the OpenCode Browser extension.
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

import { TOOL_NAMES } from "@opencode-chrome/shared";
import { nativeMessaging } from "./nativeMessaging.js";
import { messageRouter } from "./messageRouter.js";
import { updateBadge } from "./badge.js";
import { cdpManager } from "./cdp.js";
import { initSidePanelHandler } from "./sidePanelHandler.js";

// Tool handlers
import { FileUploadTool } from "./tools/fileUpload.js";
import { FindTool } from "./tools/find.js";
import { FormInputTool } from "./tools/formInput.js";
import { GetPageTextTool } from "./tools/getPageText.js";
import { JavaScriptTool } from "./tools/javascript.js";
import { NavigateTool } from "./tools/navigate.js";
import { ReadPageTool } from "./tools/readPage.js";

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

console.log("[ServiceWorker] OpenCode Browser extension starting");

// --- Tool registration ---

messageRouter.register(TOOL_NAMES.FILE_UPLOAD, new FileUploadTool());
messageRouter.register(TOOL_NAMES.FIND, new FindTool());
messageRouter.register(TOOL_NAMES.FORM_INPUT, new FormInputTool());
messageRouter.register(TOOL_NAMES.GET_PAGE_TEXT, new GetPageTextTool());
messageRouter.register(TOOL_NAMES.JAVASCRIPT, new JavaScriptTool());
messageRouter.register(TOOL_NAMES.NAVIGATE, new NavigateTool());
messageRouter.register(TOOL_NAMES.READ_PAGE, new ReadPageTool());

console.log(
  "[ServiceWorker] Tools registered:",
  messageRouter.getRegisteredTools().join(", "),
);

// --- Side panel handler ---

initSidePanelHandler();

// --- CDP manager ---

cdpManager.initialize().catch((err) => {
  console.error("[ServiceWorker] Failed to initialize CDP manager:", err);
});

// --- Native messaging connection ---

nativeMessaging.connect();

// ---------------------------------------------------------------------------
// Lifecycle Events
// ---------------------------------------------------------------------------

/**
 * Handle extension install/update events.
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log("[ServiceWorker] Installed:", details.reason);

  if (details.reason === "install") {
    // First install - show disconnected status
    updateBadge("disconnected");
  }
});

/**
 * Handle service worker startup (e.g., after being suspended).
 * Re-establish native messaging connection.
 */
chrome.runtime.onStartup.addListener(() => {
  console.log("[ServiceWorker] Starting up");
  nativeMessaging.connect();
});
