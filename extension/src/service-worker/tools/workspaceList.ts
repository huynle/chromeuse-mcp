import { loadSelectedDirectoryHandle } from "../../sidepanel/workspaceStorage.js";
import { readWorkspaceDirectory, type WorkspaceTreeNode } from "../../sidepanel/workspaceTree.js";
import type { ToolContext, ToolHandler, ToolResult } from "../../types/messages.js";

const DEFAULT_DEPTH = 1;
const DEFAULT_LIMIT = 100;

type PermissionCapableHandle = FileSystemHandle & {
  queryPermission?: (descriptor?: { mode: "read" }) => Promise<PermissionState>;
};

function textResult(success: boolean, text: string): ToolResult {
  return { success, content: [{ type: "text", text }] };
}

function numberArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function normalizeInputPath(value: unknown): string | null {
  if (value === undefined) return "/";
  if (typeof value !== "string") return null;
  const normalized = value.replaceAll("\\", "/").trim();
  return normalized.length > 0 ? normalized : "/";
}

function pathSegments(path: string): string[] | string {
  const segments = path.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return "Workspace paths must stay under the selected workspace root.";
  }
  return segments;
}

async function ensureSelectedWorkspace(): Promise<FileSystemDirectoryHandle | string> {
  const loaded = await loadSelectedDirectoryHandle();
  if (!loaded.ok) return `Unable to load the selected workspace. Select a workspace folder in the side panel. ${loaded.error}`;
  if (!loaded.value) return "No workspace folder is selected. Select a workspace folder in the side panel, then retry.";

  const handle = loaded.value.handle as PermissionCapableHandle;
  if (typeof handle.queryPermission === "function") {
    const permission = await handle.queryPermission({ mode: "read" });
    if (permission !== "granted") {
      return "Workspace permission is not currently granted. Open the side panel and reselect or restore access to the workspace folder.";
    }
  }

  return loaded.value.handle;
}

async function resolveDirectory(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle | string> {
  const segments = pathSegments(path);
  if (typeof segments === "string") return segments;

  let directory = root;
  try {
    for (const segment of segments) {
      directory = await directory.getDirectoryHandle(segment);
    }
  } catch (error) {
    return `Unable to read workspace directory "${path}". ${error instanceof Error ? error.message : String(error)}`;
  }

  return directory;
}

async function addChildren(
  node: WorkspaceTreeNode,
  directory: FileSystemDirectoryHandle,
  depthRemaining: number,
  limit: number,
): Promise<WorkspaceTreeNode | string> {
  if (node.kind !== "directory" || depthRemaining <= 1) return node;

  const directoryResult = await readWorkspaceDirectory(directory, node.path, node.depth, {
    maxDepth: node.depth + 1,
    maxEntriesPerDirectory: limit,
  });
  if (!directoryResult.ok) return directoryResult.error;

  const children: WorkspaceTreeNode[] = [];
  for (const child of directoryResult.value.entries) {
    if (child.kind !== "directory") {
      children.push(child);
      continue;
    }

    try {
      const childHandle = await directory.getDirectoryHandle(child.name);
      const childWithChildren = await addChildren(child, childHandle, depthRemaining - 1, limit);
      if (typeof childWithChildren === "string") return childWithChildren;
      children.push(childWithChildren);
    } catch (error) {
      return `Unable to read workspace directory "${child.path}". ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  return { ...node, children };
}

export class WorkspaceListTool implements ToolHandler {
  async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const inputPath = normalizeInputPath(args.path);
    if (inputPath === null) return textResult(false, "workspace_list_files path must be a string.");

    const depth = Math.max(1, numberArg(args, "depth", DEFAULT_DEPTH));
    const limit = Math.max(1, numberArg(args, "limit", DEFAULT_LIMIT));
    const workspace = await ensureSelectedWorkspace();
    if (typeof workspace === "string") return textResult(false, workspace);

    const directory = await resolveDirectory(workspace, inputPath);
    if (typeof directory === "string") return textResult(false, directory);

    const directoryResult = await readWorkspaceDirectory(directory, inputPath, 0, {
      maxDepth: depth + 1,
      maxEntriesPerDirectory: limit,
    });
    if (!directoryResult.ok) return textResult(false, directoryResult.error);

    const entries: WorkspaceTreeNode[] = [];
    for (const entry of directoryResult.value.entries) {
      if (entry.kind !== "directory") {
        entries.push(entry);
        continue;
      }

      try {
        const childHandle = await directory.getDirectoryHandle(entry.name);
        const entryWithChildren = await addChildren(entry, childHandle, depth, limit);
        if (typeof entryWithChildren === "string") return textResult(false, entryWithChildren);
        entries.push(entryWithChildren);
      } catch (error) {
        return textResult(false, `Unable to read workspace directory "${entry.path}". ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return textResult(
      true,
      JSON.stringify({
        path: directoryResult.value.path,
        depth,
        limit,
        truncated: directoryResult.value.truncated,
        entries,
      }),
    );
  }
}
