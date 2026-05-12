/**
 * Side Panel UI — Client-side script.
 *
 * Displays native host connection status, tool execution history,
 * and provides a stop button to cancel running automation.
 *
 * Communicates with the service worker via:
 *   - chrome.runtime.sendMessage({ action: "sidepanel_get_state" })
 *   - chrome.runtime.sendMessage({ action: "sidepanel_connect" })
 *   - chrome.runtime.sendMessage({ action: "sidepanel_disconnect" })
 *   - chrome.runtime.sendMessage({ action: "sidepanel_stop_automation" })
 *   - chrome.runtime.onMessage listener for SidePanelBroadcast events
 */

import { renderDocumentViewer, type WorkspaceDocument } from "./documentViewer.js";
import {
  isMarkdownWorkspaceFile,
  renderWorkspaceMarkdownFile,
  type WorkspaceMarkdownFile,
} from "./markdownPreview.js";
import { loadWorkspaceSelection, pickWorkspaceFolder } from "./workspacePanel.js";
import { queryWorkspacePermission } from "./workspacePermissions.js";
import { loadSelectedDirectoryHandle, saveSelectedDirectoryHandle } from "./workspaceStorage.js";
import type { WorkspaceFolderSelection } from "./workspaceTypes.js";

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
  | { readonly type: "tool_execution_update"; readonly entry: ToolExecutionEntry }
  | { readonly type: "workspace_document_opened"; readonly document: WorkspaceDocument }
  | { readonly type: "workspace_markdown_file_opened"; readonly file: WorkspaceMarkdownFile };

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
const connectBtn = document.getElementById("connect-btn") as HTMLButtonElement;
const disconnectBtn = document.getElementById("disconnect-btn") as HTMLButtonElement;
const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;
const connectionHint = document.getElementById("connection-hint") as HTMLElement;
const toolHistoryEl = document.getElementById("tool-history") as HTMLDivElement;
const documentSection = document.getElementById("document-section") as HTMLElement;
const markdownSection = documentSection;
const workspacePickBtn = document.getElementById("workspace-pick-btn") as HTMLButtonElement;
const workspaceMessage = document.getElementById("workspace-message") as HTMLDivElement;
const workspaceEmpty = document.getElementById("workspace-empty") as HTMLDivElement;
const workspaceMetadata = document.getElementById("workspace-metadata") as HTMLDListElement;
const workspaceFolderName = document.getElementById("workspace-folder-name") as HTMLElement;
const workspaceSelectedAt = document.getElementById("workspace-selected-at") as HTMLElement;
const workspacePermission = document.getElementById("workspace-permission") as HTMLElement;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Map of tool entry ID → DOM element for efficient updates */
const entryElements = new Map<number, HTMLDivElement>();

let currentStatus: ConnectionStatus = "disconnected";
let markdownMode: "preview" | "source" = "preview";

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function updateConnectionStatus(status: ConnectionStatus): void {
  currentStatus = status;

  // Update dot class
  statusDot.className = `dot ${status}`;

  // Update text
  statusText.textContent = STATUS_LABELS[status];

  connectBtn.disabled = status === "connecting" || status === "connected";
  disconnectBtn.disabled = status === "disconnected" || status === "error";
  connectionHint.classList.toggle(
    "hidden",
    status !== "disconnected" && status !== "error",
  );

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

function formatWorkspaceSelectedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderWorkspaceSelection(selectedFolder: WorkspaceFolderSelection | null, error: string | null): void {
  workspacePickBtn.textContent = selectedFolder ? "Reselect Folder" : "Choose Folder";
  workspaceMessage.textContent = error ?? "";
  workspaceMessage.classList.toggle("hidden", !error);
  workspaceEmpty.classList.toggle("hidden", selectedFolder !== null);
  workspaceMetadata.classList.toggle("hidden", selectedFolder === null);

  if (!selectedFolder) return;

  workspaceFolderName.textContent = selectedFolder.metadata.name;
  workspaceSelectedAt.textContent = formatWorkspaceSelectedAt(selectedFolder.metadata.lastSelectedAt);
  workspacePermission.textContent = selectedFolder.permission;
  workspacePermission.className = `workspace-permission-${selectedFolder.permission}`;
}

function renderWorkspaceError(error: string): void {
  renderWorkspaceSelection(null, error);
}

function renderWorkspaceMarkdownPreview(file: WorkspaceMarkdownFile): void {
  const result = renderWorkspaceMarkdownFile(file);
  markdownSection.className = "markdown-section";
  markdownSection.replaceChildren();

  const header = document.createElement("div");
  header.className = "markdown-header";

  const title = document.createElement("h2");
  title.textContent = file.path;

  const toggle = document.createElement("div");
  toggle.className = "markdown-toggle";
  toggle.setAttribute("role", "group");
  toggle.setAttribute("aria-label", "Markdown view mode");

  const previewBtn = document.createElement("button");
  previewBtn.className = "markdown-toggle-btn";
  previewBtn.textContent = "Preview";

  const sourceBtn = document.createElement("button");
  sourceBtn.className = "markdown-toggle-btn";
  sourceBtn.textContent = "Source";
  sourceBtn.disabled = file.content == null;

  const message = document.createElement("div");
  message.className = "markdown-message hidden";
  message.setAttribute("role", "status");

  const preview = document.createElement("div");
  preview.className = "markdown-preview";

  const source = document.createElement("pre");
  source.className = "markdown-source";

  function setMode(mode: "preview" | "source"): void {
    markdownMode = mode;
    previewBtn.classList.toggle("active", mode === "preview");
    sourceBtn.classList.toggle("active", mode === "source");
    previewBtn.setAttribute("aria-pressed", String(mode === "preview"));
    sourceBtn.setAttribute("aria-pressed", String(mode === "source"));
    preview.classList.toggle("hidden", mode !== "preview");
    source.classList.toggle("hidden", mode !== "source");
  }

  previewBtn.addEventListener("click", () => setMode("preview"));
  sourceBtn.addEventListener("click", () => setMode("source"));

  toggle.append(previewBtn, sourceBtn);
  header.append(title, toggle);
  markdownSection.append(header, message, preview, source);

  if (!result.ok) {
    message.textContent = result.message;
    message.classList.remove("hidden");
    preview.classList.add("hidden");
    source.classList.add("hidden");
    previewBtn.disabled = true;
    sourceBtn.disabled = true;
    return;
  }

  preview.innerHTML = result.html;
  source.textContent = result.source;
  setMode(markdownMode);
}

export function openWorkspaceDocument(document: WorkspaceDocument): void {
  if (isMarkdownWorkspaceFile(document.name)) {
    renderWorkspaceMarkdownPreview({ path: document.name, content: document.contentText });
    return;
  }

  documentSection.classList.remove("hidden");
  renderDocumentViewer(documentSection, document);
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

async function restoreWorkspaceSelection(): Promise<void> {
  const pickerSupported = typeof (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
  if (!pickerSupported) {
    renderWorkspaceError(
      "Folder selection is not supported in this browser. Use a Chromium browser with the File System Access API enabled.",
    );
    return;
  }

  const result = await loadWorkspaceSelection({
    loadSelectedDirectoryHandle,
    queryWorkspacePermission,
  });

  if (result.ok) {
    renderWorkspaceSelection(result.value.selectedFolder, result.value.error);
  } else {
    renderWorkspaceError(result.error);
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
        case "workspace_document_opened":
          openWorkspaceDocument(message.document);
          break;
        case "workspace_markdown_file_opened":
          renderWorkspaceMarkdownPreview(message.file);
          break;
      }
    },
  );
}

window.addEventListener("chromeuse:workspace-file-open", (event) => {
  const file = (event as CustomEvent<WorkspaceDocument | { readonly path: string; readonly content?: string }>).detail;
  if (!file) return;
  if ("path" in file && typeof file.path === "string") {
    if (isMarkdownWorkspaceFile(file.path)) renderWorkspaceMarkdownPreview(file);
  } else if ("name" in file && typeof file.name === "string") {
    openWorkspaceDocument(file);
  }
});

// ---------------------------------------------------------------------------
// Button handlers
// ---------------------------------------------------------------------------

connectBtn.addEventListener("click", async () => {
  updateConnectionStatus("connecting");
  try {
    await chrome.runtime.sendMessage({
      action: "sidepanel_connect",
    });
  } catch {
    updateConnectionStatus("error");
    console.error("[SidePanel] Failed to send connect message");
  }
});

disconnectBtn.addEventListener("click", async () => {
  disconnectBtn.disabled = true;
  try {
    await chrome.runtime.sendMessage({
      action: "sidepanel_disconnect",
    });
  } catch {
    console.error("[SidePanel] Failed to send disconnect message");
  }
});

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

workspacePickBtn.addEventListener("click", async () => {
  workspacePickBtn.disabled = true;
  workspaceMessage.textContent = "Opening folder picker…";
  workspaceMessage.classList.remove("hidden");

  try {
    const result = await pickWorkspaceFolder({
      showDirectoryPicker: (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> })
        .showDirectoryPicker,
      saveSelectedDirectoryHandle,
      queryWorkspacePermission,
    });

    if (result.ok) {
      renderWorkspaceSelection(result.value.selectedFolder, result.value.error);
    } else {
      renderWorkspaceError(result.error);
    }
  } catch (error) {
    const cancelled = error instanceof DOMException && error.name === "AbortError";
    renderWorkspaceError(cancelled ? "Folder selection was cancelled." : "Unable to select workspace folder.");
  } finally {
    workspacePickBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

listenForBroadcasts();
requestInitialState();
restoreWorkspaceSelection();
