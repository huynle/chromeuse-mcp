/**
 * Side Panel UI — Client-side script.
 *
 * Displays native host connection status, tool execution history,
 * and provides a stop button to cancel running automation.
 *
 * Communicates with the service worker via:
 *   - chrome.runtime.sendMessage({ action: "sidepanel_get_state" })
 *   - chrome.runtime.sendMessage({ action: "sidepanel_stop_automation" })
 *   - chrome.runtime.onMessage listener for SidePanelBroadcast events
 */

// ---------------------------------------------------------------------------
// Types (mirrored from extension types to avoid import issues with esbuild)
// ---------------------------------------------------------------------------

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface ToolExecutionEntry {
  readonly id: number;
  readonly tool: string;
  readonly timestamp: number;
  readonly status: "running" | "success" | "error";
  readonly durationMs?: number;
  readonly error?: string;
}

interface SidePanelState {
  readonly connectionStatus: ConnectionStatus;
  readonly toolHistory: readonly ToolExecutionEntry[];
}

type SidePanelBroadcast =
  | { readonly type: "connection_status_changed"; readonly status: ConnectionStatus }
  | { readonly type: "tool_execution_update"; readonly entry: ToolExecutionEntry };

// ---------------------------------------------------------------------------
// Status label map
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting\u2026",
  connected: "Connected",
  error: "Connection Error",
};

const TOOL_STATUS_ICONS: Record<ToolExecutionEntry["status"], string> = {
  running: "\u25F7", // circle with right half filled (spinner-like)
  success: "\u2713", // check mark
  error: "\u2717",   // cross mark
};

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const statusDot = document.getElementById("status-dot") as HTMLSpanElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;
const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;
const toolHistoryEl = document.getElementById("tool-history") as HTMLDivElement;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Map of tool entry ID → DOM element for efficient updates */
const entryElements = new Map<number, HTMLDivElement>();

let currentStatus: ConnectionStatus = "disconnected";

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function updateConnectionStatus(status: ConnectionStatus): void {
  currentStatus = status;

  // Update dot class
  statusDot.className = `dot ${status}`;

  // Update text
  statusText.textContent = STATUS_LABELS[status];

  // Stop button is only enabled when connected (automation may be running)
  stopBtn.disabled = status !== "connected";
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function clearEmptyState(): void {
  const empty = toolHistoryEl.querySelector(".empty-state");
  if (empty) empty.remove();
}

function renderToolEntry(entry: ToolExecutionEntry): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "tool-entry";
  el.dataset.id = String(entry.id);

  updateToolEntryContent(el, entry);
  return el;
}

function updateToolEntryContent(el: HTMLDivElement, entry: ToolExecutionEntry): void {
  const icon = TOOL_STATUS_ICONS[entry.status];
  const time = formatTime(entry.timestamp);
  const duration =
    entry.durationMs != null ? formatDuration(entry.durationMs) : "";

  let errorHtml = "";
  if (entry.error) {
    const escaped = entry.error
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    errorHtml = `<div class="tool-error">${escaped}</div>`;
  }

  el.innerHTML = `
    <span class="tool-status-icon ${entry.status}">${icon}</span>
    <div class="tool-info">
      <div class="tool-name">${entry.tool}</div>
      <div class="tool-meta">${time}</div>
      ${errorHtml}
    </div>
    ${duration ? `<span class="tool-duration">${duration}</span>` : ""}
  `;
}

function addOrUpdateToolEntry(entry: ToolExecutionEntry): void {
  clearEmptyState();

  const existing = entryElements.get(entry.id);
  if (existing) {
    updateToolEntryContent(existing, entry);
  } else {
    const el = renderToolEntry(entry);
    entryElements.set(entry.id, el);
    // Prepend so newest is at top
    toolHistoryEl.prepend(el);
  }
}

function renderFullHistory(entries: readonly ToolExecutionEntry[]): void {
  toolHistoryEl.innerHTML = "";
  entryElements.clear();

  if (entries.length === 0) {
    toolHistoryEl.innerHTML = '<p class="empty-state">No tool executions yet.</p>';
    return;
  }

  // Render newest first
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const el = renderToolEntry(entry);
    entryElements.set(entry.id, el);
    toolHistoryEl.appendChild(el);
  }
}

// ---------------------------------------------------------------------------
// Service worker communication
// ---------------------------------------------------------------------------

/** Request the full state snapshot from the service worker */
async function requestInitialState(): Promise<void> {
  try {
    const state: SidePanelState = await chrome.runtime.sendMessage({
      action: "sidepanel_get_state",
    });
    if (state) {
      updateConnectionStatus(state.connectionStatus);
      renderFullHistory(state.toolHistory);
    }
  } catch {
    // Service worker might not be ready yet — will get updates via broadcast
    console.warn("[SidePanel] Could not fetch initial state");
  }
}

/** Listen for real-time broadcast updates from the service worker */
function listenForBroadcasts(): void {
  chrome.runtime.onMessage.addListener(
    (message: SidePanelBroadcast) => {
      if (!message || typeof message !== "object") return;

      switch (message.type) {
        case "connection_status_changed":
          updateConnectionStatus(message.status);
          break;
        case "tool_execution_update":
          addOrUpdateToolEntry(message.entry);
          break;
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Stop button handler
// ---------------------------------------------------------------------------

stopBtn.addEventListener("click", async () => {
  stopBtn.disabled = true;
  try {
    await chrome.runtime.sendMessage({
      action: "sidepanel_stop_automation",
    });
  } catch {
    console.error("[SidePanel] Failed to send stop message");
  }
});

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

listenForBroadcasts();
requestInitialState();
