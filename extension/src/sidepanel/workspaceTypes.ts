export type WorkspacePermissionState = "unknown" | "prompt" | "granted" | "denied" | "unsupported";

export interface WorkspaceFolderMetadata {
  readonly name: string;
  readonly lastSelectedAt: number;
}

export interface WorkspaceFolderSelection {
  readonly metadata: WorkspaceFolderMetadata;
  readonly permission: WorkspacePermissionState;
}

export interface WorkspaceSelectedFile {
  readonly path: string;
  readonly name: string;
  readonly sizeBytes?: number;
  readonly mimeType?: string;
  readonly selectedAt: number;
}

export interface WorkspaceState {
  readonly selectedFolder: WorkspaceFolderSelection | null;
  readonly selectedFile: WorkspaceSelectedFile | null;
  readonly isLoading: boolean;
  readonly error: string | null;
}

export type WorkspaceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export function createEmptyWorkspaceState(): WorkspaceState {
  return {
    selectedFolder: null,
    selectedFile: null,
    isLoading: false,
    error: null,
  };
}
