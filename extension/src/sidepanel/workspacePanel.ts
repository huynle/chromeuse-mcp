import type { WorkspaceFolderMetadata, WorkspaceFolderSelection, WorkspaceResult } from "./workspaceTypes.js";

const UNSUPPORTED_PICKER_MESSAGE =
  "Folder selection is not supported in this browser. Use a Chromium browser with the File System Access API enabled.";

interface WorkspaceSelectionViewState {
  readonly selectedFolder: WorkspaceFolderSelection | null;
  readonly error: string | null;
}

type DirectoryPicker = () => Promise<FileSystemDirectoryHandle>;

interface PermissionResult {
  readonly state: WorkspaceFolderSelection["permission"];
  readonly message?: string | null;
}

export interface PickWorkspaceFolderDependencies {
  readonly showDirectoryPicker?: DirectoryPicker;
  readonly saveSelectedDirectoryHandle: (
    handle: FileSystemDirectoryHandle,
  ) => Promise<WorkspaceResult<WorkspaceFolderMetadata>>;
  readonly queryWorkspacePermission: (handle: FileSystemDirectoryHandle) => Promise<WorkspaceResult<PermissionResult>>;
}

export interface LoadWorkspaceSelectionDependencies {
  readonly loadSelectedDirectoryHandle: () => Promise<
    WorkspaceResult<{ readonly handle: FileSystemDirectoryHandle; readonly metadata: WorkspaceFolderMetadata } | null>
  >;
  readonly queryWorkspacePermission: (handle: FileSystemDirectoryHandle) => Promise<WorkspaceResult<PermissionResult>>;
}

function success(value: WorkspaceSelectionViewState): WorkspaceResult<WorkspaceSelectionViewState> {
  return { ok: true, value };
}

function stateFrom(
  metadata: WorkspaceFolderMetadata,
  permission: PermissionResult,
): WorkspaceSelectionViewState {
  return {
    selectedFolder: { metadata, permission: permission.state },
    error: permission.message ?? null,
  };
}

export async function pickWorkspaceFolder({
  showDirectoryPicker,
  saveSelectedDirectoryHandle,
  queryWorkspacePermission,
}: PickWorkspaceFolderDependencies): Promise<WorkspaceResult<WorkspaceSelectionViewState>> {
  if (!showDirectoryPicker) {
    return success({ selectedFolder: null, error: UNSUPPORTED_PICKER_MESSAGE });
  }

  const handle = await showDirectoryPicker();
  const saved = await saveSelectedDirectoryHandle(handle);
  if (!saved.ok) return saved;

  const permission = await queryWorkspacePermission(handle);
  if (!permission.ok) return permission;

  return success(stateFrom(saved.value, permission.value));
}

export async function loadWorkspaceSelection({
  loadSelectedDirectoryHandle,
  queryWorkspacePermission,
}: LoadWorkspaceSelectionDependencies): Promise<WorkspaceResult<WorkspaceSelectionViewState>> {
  const loaded = await loadSelectedDirectoryHandle();
  if (!loaded.ok) return loaded;
  if (!loaded.value) return success({ selectedFolder: null, error: null });

  const permission = await queryWorkspacePermission(loaded.value.handle);
  if (!permission.ok) return permission;

  return success(stateFrom(loaded.value.metadata, permission.value));
}
