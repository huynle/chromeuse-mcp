import type { WorkspaceResult } from "./workspaceTypes.js";

export interface WorkspaceTreeOptions {
  readonly maxDepth?: number;
  readonly maxEntriesPerDirectory?: number;
}

export interface WorkspaceTreeNode {
  readonly kind: FileSystemHandleKind;
  readonly name: string;
  readonly path: string;
  readonly depth: number;
  readonly canLoadChildren: boolean;
  readonly children?: readonly WorkspaceTreeNode[];
}

export interface WorkspaceTreeDirectory {
  readonly path: string;
  readonly depth: number;
  readonly entries: readonly WorkspaceTreeNode[];
  readonly truncated: boolean;
}

interface NormalizedTreeOptions {
  readonly maxDepth: number;
  readonly maxEntriesPerDirectory: number;
}

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values: () => AsyncIterable<FileSystemHandle>;
};

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_ENTRIES_PER_DIRECTORY = 100;

function success<T>(value: T): WorkspaceResult<T> {
  return { ok: true, value };
}

function failure<T>(error: string): WorkspaceResult<T> {
  return { ok: false, error };
}

function normalizeOptions(options: WorkspaceTreeOptions = {}): NormalizedTreeOptions {
  return {
    maxDepth: Math.max(0, Math.floor(options.maxDepth ?? DEFAULT_MAX_DEPTH)),
    maxEntriesPerDirectory: Math.max(1, Math.floor(options.maxEntriesPerDirectory ?? DEFAULT_MAX_ENTRIES_PER_DIRECTORY)),
  };
}

function normalizeSegment(segment: string): string | null {
  const normalized = segment.replaceAll("\\", "/").trim();
  if (!normalized || normalized === "." || normalized === "..") return null;
  if (normalized.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return normalized;
}

export function normalizeWorkspacePath(parentPath: string, name?: string): WorkspaceResult<string> {
  const parentParts = parentPath
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean);

  if (parentParts.some((part) => part === "." || part === "..")) {
    return failure("Workspace paths must stay under the selected workspace root.");
  }

  const parts = [...parentParts];
  if (name !== undefined) {
    const segment = normalizeSegment(name);
    if (!segment) return failure("Workspace entry names must stay under the selected workspace root.");
    parts.push(segment);
  }

  return success(parts.length === 0 ? "/" : `/${parts.join("/")}`);
}

function createNode(handle: FileSystemHandle, path: string, depth: number, maxDepth: number): WorkspaceTreeNode {
  return {
    kind: handle.kind,
    name: handle.name,
    path,
    depth,
    canLoadChildren: handle.kind === "directory" && depth < maxDepth,
  };
}

export async function readWorkspaceDirectory(
  directoryHandle: FileSystemDirectoryHandle,
  parentPath = "/",
  depth = 0,
  options: WorkspaceTreeOptions = {},
): Promise<WorkspaceResult<WorkspaceTreeDirectory>> {
  const normalizedOptions = normalizeOptions(options);
  const normalizedParentPath = normalizeWorkspacePath(parentPath);
  if (!normalizedParentPath.ok) return normalizedParentPath;

  if (depth >= normalizedOptions.maxDepth) {
    return success({ path: normalizedParentPath.value, depth, entries: [], truncated: false });
  }

  const iterableHandle = directoryHandle as IterableDirectoryHandle;
  if (typeof iterableHandle.values !== "function") {
    return failure("Workspace directory handles cannot be enumerated in this browser context.");
  }

  const entries: WorkspaceTreeNode[] = [];
  let truncated = false;

  try {
    for await (const childHandle of iterableHandle.values()) {
      if (entries.length >= normalizedOptions.maxEntriesPerDirectory) {
        truncated = true;
        break;
      }

      const childPath = normalizeWorkspacePath(normalizedParentPath.value, childHandle.name);
      if (!childPath.ok) return childPath;
      entries.push(createNode(childHandle, childPath.value, depth + 1, normalizedOptions.maxDepth));
    }
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Unable to read workspace directory.");
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return success({ path: normalizedParentPath.value, depth, entries, truncated });
}

export async function readWorkspaceTree(
  rootHandle: FileSystemDirectoryHandle,
  options: WorkspaceTreeOptions = {},
): Promise<WorkspaceResult<WorkspaceTreeNode>> {
  const normalizedOptions = normalizeOptions(options);

  async function readNode(handle: FileSystemHandle, path: string, depth: number): Promise<WorkspaceResult<WorkspaceTreeNode>> {
    const node = createNode(handle, path, depth, normalizedOptions.maxDepth);
    if (handle.kind !== "directory" || depth >= normalizedOptions.maxDepth) return success(node);

    const directory = await readWorkspaceDirectory(handle as FileSystemDirectoryHandle, path, depth, normalizedOptions);
    if (!directory.ok) return directory;

    const children: WorkspaceTreeNode[] = [];
    for (const child of directory.value.entries) {
      const childHandle = await getChildHandle(handle as FileSystemDirectoryHandle, child.name, child.kind);
      if (!childHandle.ok) return childHandle;
      const childNode = await readNode(childHandle.value, child.path, child.depth);
      if (!childNode.ok) return childNode;
      children.push(childNode.value);
    }

    return success({ ...node, children });
  }

  return readNode(rootHandle, "/", 0);
}

async function getChildHandle(
  directoryHandle: FileSystemDirectoryHandle,
  name: string,
  kind: FileSystemHandleKind,
): Promise<WorkspaceResult<FileSystemHandle>> {
  try {
    if (kind === "directory") return success(await directoryHandle.getDirectoryHandle(name));
    return success(await directoryHandle.getFileHandle(name));
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Unable to read workspace entry handle.");
  }
}
