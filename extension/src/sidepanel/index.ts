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
import { getWindowDirectoryPicker, pickWorkspaceFolder } from "./workspacePanel.js";
import { queryWorkspacePermission, requestWorkspacePermission, type WorkspacePermissionRecovery } from "./workspacePermissions.js";
import { loadSelectedDirectoryHandle, saveSelectedDirectoryHandle } from "./workspaceStorage.js";
import { readWorkspaceDirectory, type WorkspaceTreeDirectory, type WorkspaceTreeNode } from "./workspaceTree.js";
import {
  createSelectedWorkspaceFile,
  describeWorkspaceTreeState,
  toWorkspaceTreeItems,
} from "./workspaceTreeView.js";
import type { WorkspaceFolderSelection, WorkspaceSelectedFile } from "./workspaceTypes.js";

// ---------------------------------------------------------------------------
// Types (mirrored from extension types to avoid import issues with esbuild)
// ---------------------------------------------------------------------------

type ConnectionStatus = "disconnected" | "connecting" | "waiting" | "connected" | "error";

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
  waiting: "Waiting for MCP server",
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
const workspaceSection = document.getElementById("workspace-section") as HTMLElement;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Map of tool entry ID → DOM element for efficient updates */
const entryElements = new Map<number, HTMLDivElement>();

let currentStatus: ConnectionStatus = "disconnected";
let markdownMode: "preview" | "source" = "preview";
let currentWorkspaceHandle: FileSystemDirectoryHandle | null = null;
let currentWorkspacePermission: WorkspacePermissionRecovery | null = null;
let selectedWorkspaceFile: WorkspaceSelectedFile | null = null;

const WORKSPACE_TREE_OPTIONS = {
  maxDepth: 6,
  maxEntriesPerDirectory: 100,
} as const;

interface LoadedWorkspaceDirectory {
  readonly handle: FileSystemDirectoryHandle;
  readonly directory: WorkspaceTreeDirectory;
  expanded: boolean;
  loading: boolean;
  error: string | null;
}

const loadedWorkspaceDirectories = new Map<string, LoadedWorkspaceDirectory>();

const workspaceTreeRoot = document.createElement("div");
workspaceTreeRoot.id = "workspace-tree-root";
workspaceTreeRoot.className = "workspace-tree-root hidden";
workspaceSection.appendChild(workspaceTreeRoot);

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
  disconnectBtn.disabled = status === "disconnected" || status === "waiting" || status === "error";
  connectionHint.classList.toggle(
    "hidden",
    status !== "disconnected" && status !== "waiting" && status !== "error",
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

  if (!selectedFolder) {
    currentWorkspaceHandle = null;
    currentWorkspacePermission = null;
    selectedWorkspaceFile = null;
    loadedWorkspaceDirectories.clear();
    renderWorkspaceTree();
    return;
  }

  workspaceFolderName.textContent = selectedFolder.metadata.name;
  workspaceSelectedAt.textContent = formatWorkspaceSelectedAt(selectedFolder.metadata.lastSelectedAt);
  workspacePermission.textContent = selectedFolder.permission;
  workspacePermission.className = `workspace-permission-${selectedFolder.permission}`;
}

function renderWorkspaceError(error: string): void {
  renderWorkspaceSelection(null, error);
}

function renderWorkspaceTreeMessage(message: string, action?: { readonly label: string; readonly onClick: () => void }): void {
  workspaceTreeRoot.classList.remove("hidden");
  workspaceTreeRoot.replaceChildren();

  const messageEl = document.createElement("div");
  messageEl.className = "workspace-tree-message";
  messageEl.textContent = message;
  workspaceTreeRoot.appendChild(messageEl);

  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "workspace-tree-action";
    button.textContent = action.label;
    button.addEventListener("click", action.onClick);
    workspaceTreeRoot.appendChild(button);
  }
}

function renderWorkspaceTree(): void {
  if (!currentWorkspaceHandle) {
    workspaceTreeRoot.classList.add("hidden");
    workspaceTreeRoot.replaceChildren();
    return;
  }

  if (currentWorkspacePermission && currentWorkspacePermission.action !== "none") {
    renderWorkspaceTreeMessage(
      describeWorkspaceTreeState({
        directory: null,
        permission: currentWorkspacePermission,
        selectedFile: selectedWorkspaceFile,
        isLoading: false,
        error: null,
      }),
      currentWorkspacePermission.canRequest
        ? { label: "Grant Access", onClick: restoreWorkspacePermissionFromGesture }
        : { label: "Reselect Folder", onClick: () => workspacePickBtn.click() },
    );
    return;
  }

  const rootDirectory = loadedWorkspaceDirectories.get("/");
  if (!rootDirectory) {
    renderWorkspaceTreeMessage("Loading workspace tree...");
    return;
  }

  workspaceTreeRoot.classList.remove("hidden");
  workspaceTreeRoot.replaceChildren();

  const summary = document.createElement("div");
  summary.className = "workspace-tree-summary";
  summary.textContent = describeWorkspaceTreeState({
    directory: rootDirectory.directory,
    permission: currentWorkspacePermission,
    selectedFile: selectedWorkspaceFile,
    isLoading: rootDirectory.loading,
    error: rootDirectory.error,
  });
  workspaceTreeRoot.appendChild(summary);

  const tree = document.createElement("ul");
  tree.className = "workspace-file-tree";
  tree.setAttribute("role", "tree");
  appendDirectoryEntries(tree, rootDirectory.directory);
  workspaceTreeRoot.appendChild(tree);

  if (rootDirectory.directory.truncated) {
    const truncated = document.createElement("div");
    truncated.className = "workspace-tree-truncated";
    truncated.textContent = `Showing first ${WORKSPACE_TREE_OPTIONS.maxEntriesPerDirectory} entries. Narrow the folder or use a deeper selection to browse more.`;
    workspaceTreeRoot.appendChild(truncated);
  }
}

function appendDirectoryEntries(parent: HTMLElement, directory: WorkspaceTreeDirectory): void {
  const items = toWorkspaceTreeItems(directory, selectedWorkspaceFile?.path ?? null);
  for (const item of items) {
    const node = directory.entries.find((entry) => entry.path === item.path);
    if (!node) continue;

    const entry = document.createElement("li");
    entry.className = `workspace-tree-entry workspace-tree-entry-${item.kind}`;
    entry.setAttribute("role", "treeitem");
    entry.setAttribute("aria-selected", String(item.selected));

    const button = document.createElement("button");
    button.type = "button";
    button.className = "workspace-tree-row";
    button.style.setProperty("--workspace-tree-depth", String(Math.max(0, item.depth - 1)));
    button.dataset.path = item.path;
    button.disabled = !item.selectable && !item.expandable;

    const disclosure = document.createElement("span");
    disclosure.className = "workspace-tree-disclosure";
    const loadedDirectory = loadedWorkspaceDirectories.get(item.path);
    disclosure.textContent = item.kind === "directory" ? (loadedDirectory?.expanded ? "v" : ">") : "";

    const icon = document.createElement("span");
    icon.className = "workspace-tree-icon";
    icon.textContent = item.kind === "directory" ? "[D]" : "[F]";

    const name = document.createElement("span");
    name.className = "workspace-tree-name";
    name.textContent = item.name;

    if (item.selected) button.classList.add("selected");
    button.append(disclosure, icon, name);
    button.addEventListener("click", () => handleWorkspaceTreeNodeClick(node));
    entry.appendChild(button);

    if (loadedDirectory?.loading) {
      const loading = document.createElement("div");
      loading.className = "workspace-tree-loading";
      loading.textContent = "Loading...";
      entry.appendChild(loading);
    }

    if (loadedDirectory?.error) {
      const error = document.createElement("div");
      error.className = "workspace-tree-error";
      error.textContent = loadedDirectory.error;
      entry.appendChild(error);
    }

    if (loadedDirectory?.expanded) {
      const childList = document.createElement("ul");
      childList.className = "workspace-file-tree";
      childList.setAttribute("role", "group");
      appendDirectoryEntries(childList, loadedDirectory.directory);
      entry.appendChild(childList);
    }

    parent.appendChild(entry);
  }
}

async function handleWorkspaceTreeNodeClick(node: WorkspaceTreeNode): Promise<void> {
  if (node.kind === "file") {
    selectedWorkspaceFile = createSelectedWorkspaceFile(node);
    renderWorkspaceTree();
    window.dispatchEvent(new CustomEvent("chromeuse:workspace-file-selected", { detail: selectedWorkspaceFile }));
    return;
  }

  const existing = loadedWorkspaceDirectories.get(node.path);
  if (existing) {
    existing.expanded = !existing.expanded;
    renderWorkspaceTree();
    return;
  }

  await loadWorkspaceDirectory(node.path, node.depth, true);
}

async function resolveWorkspaceDirectoryHandle(path: string): Promise<FileSystemDirectoryHandle | null> {
  if (!currentWorkspaceHandle) return null;
  if (path === "/") return currentWorkspaceHandle;

  let handle = currentWorkspaceHandle;
  for (const segment of path.split("/").filter(Boolean)) {
    handle = await handle.getDirectoryHandle(segment);
  }
  return handle;
}

async function loadWorkspaceDirectory(path: string, depth: number, expanded: boolean): Promise<void> {
  const placeholder = loadedWorkspaceDirectories.get(path);
  if (placeholder) {
    placeholder.loading = true;
    placeholder.error = null;
  }
  renderWorkspaceTree();

  try {
    const handle = await resolveWorkspaceDirectoryHandle(path);
    if (!handle) {
      renderWorkspaceTreeMessage("Workspace folder is unavailable. Reselect the folder to continue.", {
        label: "Reselect Folder",
        onClick: () => workspacePickBtn.click(),
      });
      return;
    }

    const result = await readWorkspaceDirectory(handle, path, depth, WORKSPACE_TREE_OPTIONS);
    if (!result.ok) {
      loadedWorkspaceDirectories.set(path, {
        handle,
        directory: { path, depth, entries: [], truncated: false },
        expanded,
        loading: false,
        error: result.error,
      });
      renderWorkspaceTree();
      return;
    }

    loadedWorkspaceDirectories.set(path, {
      handle,
      directory: result.value,
      expanded,
      loading: false,
      error: null,
    });
    renderWorkspaceTree();
  } catch (error) {
    loadedWorkspaceDirectories.set(path, {
      handle: currentWorkspaceHandle as FileSystemDirectoryHandle,
      directory: { path, depth, entries: [], truncated: false },
      expanded,
      loading: false,
      error: error instanceof Error ? error.message : "Unable to load workspace directory.",
    });
    renderWorkspaceTree();
  }
}

async function loadWorkspaceTreeForHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  currentWorkspaceHandle = handle;
  loadedWorkspaceDirectories.clear();
  selectedWorkspaceFile = null;
  renderWorkspaceTreeMessage("Loading workspace tree...");

  const permission = await queryWorkspacePermission(handle);
  if (!permission.ok) {
    currentWorkspacePermission = null;
    renderWorkspaceTreeMessage(permission.error, { label: "Reselect Folder", onClick: () => workspacePickBtn.click() });
    return;
  }

  currentWorkspacePermission = permission.value;
  if (permission.value.action !== "none") {
    renderWorkspaceTree();
    return;
  }

  await loadWorkspaceDirectory("/", 0, true);
}

async function restoreWorkspacePermissionFromGesture(): Promise<void> {
  if (!currentWorkspaceHandle) return;
  renderWorkspaceTreeMessage("Requesting workspace access…");
  const permission = await requestWorkspacePermission(currentWorkspaceHandle);
  if (!permission.ok) {
    renderWorkspaceTreeMessage(permission.error, { label: "Reselect Folder", onClick: () => workspacePickBtn.click() });
    return;
  }
  currentWorkspacePermission = permission.value;
  workspacePermission.textContent = permission.value.state;
  workspacePermission.className = `workspace-permission-${permission.value.state}`;
  workspaceMessage.textContent = permission.value.message ?? "";
  workspaceMessage.classList.toggle("hidden", !permission.value.message);
  if (permission.value.action !== "none") {
    renderWorkspaceTree();
    return;
  }
  await loadWorkspaceDirectory("/", 0, true);
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

  const loaded = await loadSelectedDirectoryHandle();
  if (!loaded.ok) {
    renderWorkspaceError(loaded.error);
    return;
  }

  if (!loaded.value) {
    renderWorkspaceSelection(null, null);
    return;
  }

  const permission = await queryWorkspacePermission(loaded.value.handle);
  if (!permission.ok) {
    renderWorkspaceError(permission.error);
    return;
  }

  currentWorkspaceHandle = loaded.value.handle;
  currentWorkspacePermission = permission.value;
  renderWorkspaceSelection(
    { metadata: loaded.value.metadata, permission: permission.value.state },
    permission.value.message ?? null,
  );
  await loadWorkspaceTreeForHandle(loaded.value.handle);
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
    let pickedHandle: FileSystemDirectoryHandle | null = null;
    const showDirectoryPicker = getWindowDirectoryPicker(
      window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> },
    );
    const result = await pickWorkspaceFolder({
      showDirectoryPicker: showDirectoryPicker
        ? async () => {
            const handle = await showDirectoryPicker();
            pickedHandle = handle;
            return handle;
          }
        : undefined,
      saveSelectedDirectoryHandle,
      queryWorkspacePermission,
    });

    if (result.ok) {
      renderWorkspaceSelection(result.value.selectedFolder, result.value.error);
      if (pickedHandle) await loadWorkspaceTreeForHandle(pickedHandle);
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
