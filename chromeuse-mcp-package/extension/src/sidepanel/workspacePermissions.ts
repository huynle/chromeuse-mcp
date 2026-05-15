import type { WorkspacePermissionState, WorkspaceResult } from "./workspaceTypes.js";

export type WorkspacePermissionAction = "none" | "request-permission" | "select-workspace" | "unsupported";
export type WorkspaceFilePermissionMode = "read" | "readwrite";

interface WorkspaceFilePermissionDescriptor {
  readonly mode: WorkspaceFilePermissionMode;
}

export interface WorkspacePermissionRecovery {
  readonly state: WorkspacePermissionState;
  readonly action: WorkspacePermissionAction;
  readonly canRequest: boolean;
  readonly message: string | null;
}

export interface WorkspacePermissionOptions {
  readonly mode?: WorkspaceFilePermissionMode;
}

type PermissionCapableHandle = FileSystemHandle & {
  queryPermission?: (descriptor?: WorkspaceFilePermissionDescriptor) => Promise<PermissionState>;
  requestPermission?: (descriptor?: WorkspaceFilePermissionDescriptor) => Promise<PermissionState>;
};

function success<T>(value: T): WorkspaceResult<T> {
  return { ok: true, value };
}

function failure<T>(error: string): WorkspaceResult<T> {
  return { ok: false, error };
}

function toWorkspacePermissionState(state: PermissionState): WorkspacePermissionState {
  if (state === "granted" || state === "denied" || state === "prompt") return state;
  return "unknown";
}

function descriptorFor(options: WorkspacePermissionOptions = {}): WorkspaceFilePermissionDescriptor {
  return { mode: options.mode ?? "read" };
}

function recoveryFor(state: WorkspacePermissionState, canRequest: boolean): WorkspacePermissionRecovery {
  if (state === "granted") {
    return { state, action: "none", canRequest: false, message: null };
  }

  if (state === "prompt") {
    return {
      state,
      action: canRequest ? "request-permission" : "select-workspace",
      canRequest,
      message: canRequest
        ? "Workspace access needs to be restored. Ask the user to grant access again."
        : "Workspace access needs to be restored by selecting the folder again.",
    };
  }

  if (state === "denied") {
    return {
      state,
      action: canRequest ? "request-permission" : "select-workspace",
      canRequest,
      message: canRequest
        ? "Workspace access was denied. Request permission again from a user gesture."
        : "Workspace access was denied. Ask the user to select the workspace folder again.",
    };
  }

  if (state === "unsupported") {
    return {
      state,
      action: "unsupported",
      canRequest: false,
      message: "File System Access permissions are unavailable in this browser context.",
    };
  }

  return {
    state,
    action: canRequest ? "request-permission" : "select-workspace",
    canRequest,
    message: "Workspace access could not be verified. Ask the user to restore access.",
  };
}

export async function queryWorkspacePermission(
  handle: FileSystemHandle,
  options: WorkspacePermissionOptions = {},
): Promise<WorkspaceResult<WorkspacePermissionRecovery>> {
  const permissionHandle = handle as PermissionCapableHandle;
  const canRequest = typeof permissionHandle.requestPermission === "function";

  if (typeof permissionHandle.queryPermission !== "function") {
    return success(recoveryFor("unsupported", canRequest));
  }

  try {
    const state = await permissionHandle.queryPermission(descriptorFor(options));
    return success(recoveryFor(toWorkspacePermissionState(state), canRequest));
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Unable to query workspace permission.");
  }
}

export async function requestWorkspacePermission(
  handle: FileSystemHandle,
  options: WorkspacePermissionOptions = {},
): Promise<WorkspaceResult<WorkspacePermissionRecovery>> {
  const permissionHandle = handle as PermissionCapableHandle;

  if (typeof permissionHandle.requestPermission !== "function") {
    return success(recoveryFor("unsupported", false));
  }

  try {
    const state = await permissionHandle.requestPermission(descriptorFor(options));
    return success(recoveryFor(toWorkspacePermissionState(state), true));
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Unable to request workspace permission.");
  }
}
