import { loadSelectedDirectoryHandle } from "../../sidepanel/workspaceStorage.js";
import { normalizeWorkspacePath } from "../../sidepanel/workspaceTree.js";
import type { ToolContext, ToolHandler, ToolResult } from "../../types/messages.js";

const DEFAULT_LIMIT = 64 * 1024;
const MAX_READ_BYTES = 1024 * 1024;
const BINARY_SAMPLE_BYTES = 4096;

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

function pathSegments(path: string): string[] | string {
  const normalized = normalizeWorkspacePath(path);
  if (!normalized.ok) return normalized.error;

  const segments = normalized.value.split("/").filter(Boolean);
  if (segments.length === 0) return "workspace_read_file path must point to a file inside the selected workspace.";
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

async function resolveFile(root: FileSystemDirectoryHandle, path: string): Promise<{ handle: FileSystemFileHandle; normalizedPath: string } | string> {
  const segments = pathSegments(path);
  if (typeof segments === "string") return segments;

  let directory = root;
  try {
    for (const segment of segments.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(segment);
    }
    return {
      handle: await directory.getFileHandle(segments[segments.length - 1]),
      normalizedPath: `/${segments.join("/")}`,
    };
  } catch (error) {
    return `Unable to read workspace file "${path}". ${error instanceof Error ? error.message : String(error)}`;
  }
}

function looksBinary(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  let suspicious = 0;
  for (const byte of bytes) {
    if (byte === 0) return true;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) suspicious += 1;
  }
  return suspicious / bytes.length > 0.3;
}

async function readUtf8File(file: File): Promise<string | string[]> {
  if (file.size > MAX_READ_BYTES) {
    return [`Workspace file is too large to read safely (${file.size} bytes). Maximum supported size is ${MAX_READ_BYTES} bytes.`];
  }

  const sample = new Uint8Array(await file.slice(0, BINARY_SAMPLE_BYTES).arrayBuffer());
  if (looksBinary(sample)) return ["Binary files cannot be read by workspace_read_file. Select a UTF-8 text file instead."];

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  } catch (error) {
    return [`Unable to decode workspace file as utf-8 text. ${error instanceof Error ? error.message : String(error)}`];
  }
}

export class WorkspaceReadTool implements ToolHandler {
  async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    if (typeof args.path !== "string" || args.path.trim().length === 0) {
      return textResult(false, "workspace_read_file requires a workspace-relative path string.");
    }
    if (args.encoding !== undefined && args.encoding !== "utf-8") {
      return textResult(false, "workspace_read_file only supports utf-8 encoding.");
    }

    const limit = numberArg(args, "limit", DEFAULT_LIMIT);
    const workspace = await ensureSelectedWorkspace();
    if (typeof workspace === "string") return textResult(false, workspace);

    const resolved = await resolveFile(workspace, args.path);
    if (typeof resolved === "string") return textResult(false, resolved);

    try {
      const file = await resolved.handle.getFile();
      const content = await readUtf8File(file);
      if (Array.isArray(content)) return textResult(false, content[0]);

      return textResult(
        true,
        JSON.stringify({
          path: resolved.normalizedPath,
          name: file.name,
          encoding: "utf-8",
          size: file.size,
          truncated: content.length > limit,
          content: content.slice(0, limit),
        }),
      );
    } catch (error) {
      return textResult(false, `Unable to read workspace file "${args.path}". ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
