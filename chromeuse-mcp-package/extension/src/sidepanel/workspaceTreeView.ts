import type { WorkspacePermissionRecovery } from "./workspacePermissions.js";
import type { WorkspaceTreeDirectory, WorkspaceTreeNode } from "./workspaceTree.js";
import type { WorkspaceSelectedFile } from "./workspaceTypes.js";

export interface WorkspaceTreeViewState {
  readonly directory: WorkspaceTreeDirectory | null;
  readonly permission: WorkspacePermissionRecovery | null;
  readonly selectedFile: WorkspaceSelectedFile | null;
  readonly isLoading: boolean;
  readonly error: string | null;
}

export interface WorkspaceTreeItemViewModel {
  readonly kind: FileSystemHandleKind;
  readonly name: string;
  readonly path: string;
  readonly depth: number;
  readonly expandable: boolean;
  readonly selectable: boolean;
  readonly selected: boolean;
}

export function describeWorkspaceTreeState(state: WorkspaceTreeViewState): string {
  if (state.permission && state.permission.action !== "none") {
    const action = state.permission.action === "request-permission"
      ? "Grant access to continue."
      : state.permission.action === "select-workspace"
        ? "Reselect workspace to continue."
        : "Use a supported Chromium browser to continue.";
    return `${state.permission.message ?? "Workspace access is unavailable."} ${action}`;
  }

  if (state.error) return state.error;
  if (state.isLoading) return "Loading workspace tree...";
  if (!state.directory) return "No workspace tree loaded.";

  const entryLabel = state.directory.entries.length === 1 ? "entry" : "entries";
  const parts = [`${state.directory.entries.length} ${entryLabel} loaded`];
  if (state.directory.truncated) parts.push("more entries available");
  if (state.selectedFile) parts.push(`selected ${state.selectedFile.path}`);
  return parts.join(", ");
}

export function toWorkspaceTreeItems(
  directory: WorkspaceTreeDirectory,
  selectedFilePath: string | null = null,
): readonly WorkspaceTreeItemViewModel[] {
  return directory.entries.map((entry) => ({
    kind: entry.kind,
    name: entry.name,
    path: entry.path,
    depth: entry.depth,
    expandable: entry.kind === "directory" && entry.canLoadChildren,
    selectable: entry.kind === "file",
    selected: entry.kind === "file" && entry.path === selectedFilePath,
  }));
}

export function createSelectedWorkspaceFile(
  node: WorkspaceTreeNode,
  selectedAt = Date.now(),
): WorkspaceSelectedFile | null {
  if (node.kind !== "file") return null;
  return {
    path: node.path,
    name: node.name,
    selectedAt,
  };
}
