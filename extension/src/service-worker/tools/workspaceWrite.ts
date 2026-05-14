/**
 * workspace_write_file tool - writes a file to the selected workspace using FileSystem Access API.
 *
 * This provides truly silent file writing without any download UI, using the workspace
 * directory handle that the user has already granted permission to via the side panel.
 *
 * Args:
 *   path (string, required): Workspace-relative path (e.g., "downloads/image.png")
 *   dataUrl (string, required): Data URL containing the file content
 *   createDirectories (boolean, optional): Create parent directories if they don't exist (default: true)
 *
 * Requires:
 *   - User must have selected a workspace folder in the side panel
 *   - User must have granted "readwrite" permission to the workspace
 */

import { loadSelectedDirectoryHandle } from "../../sidepanel/workspaceStorage.js";
import { normalizeWorkspacePath } from "../../sidepanel/workspaceTree.js";
import type { ToolContext, ToolHandler, ToolResult } from "../../types/messages.js";

type PermissionCapableHandle = FileSystemHandle & {
  queryPermission?: (descriptor?: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
};

function textResult(success: boolean, text: string): ToolResult {
  return { success, content: [{ type: "text", text }] };
}

function pathSegments(path: string): string[] | string {
  const normalized = normalizeWorkspacePath(path);
  if (!normalized.ok) return normalized.error;

  const segments = normalized.value.split("/").filter(Boolean);
  if (segments.length === 0) return "workspace_write_file path must point to a file inside the selected workspace.";
  return segments;
}

async function ensureWritableWorkspace(): Promise<FileSystemDirectoryHandle | string> {
  const loaded = await loadSelectedDirectoryHandle();
  if (!loaded.ok) return `Unable to load the selected workspace. Select a workspace folder in the side panel. ${loaded.error}`;
  if (!loaded.value) return "No workspace folder is selected. Select a workspace folder in the side panel, then retry.";

  const handle = loaded.value.handle as PermissionCapableHandle;
  
  // Check if we have readwrite permission
  if (typeof handle.queryPermission === "function") {
    let permission = await handle.queryPermission({ mode: "readwrite" });
    
    // If not granted, try to request it
    if (permission !== "granted" && typeof handle.requestPermission === "function") {
      permission = await handle.requestPermission({ mode: "readwrite" });
    }
    
    if (permission !== "granted") {
      return "Workspace write permission is not granted. The tool needs readwrite access to save files.";
    }
  }

  return loaded.value.handle;
}

async function ensureDirectory(
  root: FileSystemDirectoryHandle,
  segments: string[],
  createIfMissing: boolean,
): Promise<FileSystemDirectoryHandle | string> {
  let directory = root;
  
  try {
    for (const segment of segments) {
      if (createIfMissing) {
        directory = await directory.getDirectoryHandle(segment, { create: true });
      } else {
        directory = await directory.getDirectoryHandle(segment);
      }
    }
    return directory;
  } catch (error) {
    return `Unable to access directory path. ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob | string> {
  try {
    const response = await fetch(dataUrl);
    return await response.blob();
  } catch (error) {
    return `Failed to convert data URL to blob. ${error instanceof Error ? error.message : String(error)}`;
  }
}

export class WorkspaceWriteTool implements ToolHandler {
  async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    // --- Validate args ---
    const path = typeof args.path === "string" ? args.path : undefined;
    if (!path) {
      return textResult(false, "Missing required argument: path (string)");
    }

    const dataUrl = typeof args.dataUrl === "string" ? args.dataUrl : undefined;
    if (!dataUrl) {
      return textResult(false, "Missing required argument: dataUrl (string)");
    }

    const createDirectories = args.createDirectories !== false; // Default true

    // --- Ensure workspace is writable ---
    const workspace = await ensureWritableWorkspace();
    if (typeof workspace === "string") {
      return textResult(false, workspace);
    }

    // --- Parse path segments ---
    const segments = pathSegments(path);
    if (typeof segments === "string") {
      return textResult(false, segments);
    }

    const filename = segments[segments.length - 1];
    const dirSegments = segments.slice(0, -1);

    // --- Ensure parent directory exists ---
    const directory = await ensureDirectory(workspace, dirSegments, createDirectories);
    if (typeof directory === "string") {
      return textResult(false, directory);
    }

    // --- Convert data URL to blob ---
    const blob = await dataUrlToBlob(dataUrl);
    if (typeof blob === "string") {
      return textResult(false, blob);
    }

    // --- Write file ---
    try {
      const fileHandle = await directory.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      const fullPath = segments.join("/");
      return textResult(
        true,
        JSON.stringify(
          {
            path: `/${fullPath}`,
            size: blob.size,
            workspace: workspace.name,
            method: "filesystem-api",
          },
          null,
          2,
        ),
      );
    } catch (error) {
      return textResult(
        false,
        `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
