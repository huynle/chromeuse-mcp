import { TOOL_NAMES } from "@chromeuse/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSelectedDirectoryHandle } from "../../sidepanel/workspaceStorage.js";
import type { ToolResult } from "../../types/messages.js";
import { MessageRouter } from "../messageRouter.js";
import { registerTools } from "./index.js";
import { WorkspaceListTool } from "./workspaceList.js";
import { WorkspaceReadTool } from "./workspaceRead.js";

vi.mock("../../sidepanel/workspaceStorage.js", () => ({
  loadSelectedDirectoryHandle: vi.fn(),
}));

const loadSelectedDirectoryHandleMock = vi.mocked(loadSelectedDirectoryHandle);

type TestFileHandle = FileSystemFileHandle & {
  readonly file: File;
};

type TestDirectoryHandle = FileSystemDirectoryHandle & {
  readonly children: Map<string, FileSystemHandle>;
};

function textFile(name: string, content: string, type = "text/plain"): TestFileHandle {
  const file = new File([content], name, { type });
  return {
    kind: "file",
    name,
    isSameEntry: async () => false,
    getFile: async () => file,
    file,
  } as unknown as TestFileHandle;
}

function binaryFile(name: string): TestFileHandle {
  const file = new File([new Uint8Array([0x00, 0x01, 0x02, 0x03])], name);
  return {
    kind: "file",
    name,
    isSameEntry: async () => false,
    getFile: async () => file,
    file,
  } as unknown as TestFileHandle;
}

function directory(name: string, children: FileSystemHandle[] = []): TestDirectoryHandle {
  const childMap = new Map(children.map((child) => [child.name, child]));
  return {
    kind: "directory",
    name,
    isSameEntry: async () => false,
    children: childMap,
    async *values() {
      for (const child of childMap.values()) yield child;
    },
    async getDirectoryHandle(childName: string) {
      const child = childMap.get(childName);
      if (!child || child.kind !== "directory") throw new Error(`Missing directory ${childName}`);
      return child as FileSystemDirectoryHandle;
    },
    async getFileHandle(childName: string) {
      const child = childMap.get(childName);
      if (!child || child.kind !== "file") throw new Error(`Missing file ${childName}`);
      return child as FileSystemFileHandle;
    },
  } as unknown as TestDirectoryHandle;
}

function resultText(result: ToolResult): string {
  const block = result.content[0];
  if (block.type !== "text") throw new Error("Expected text result");
  return block.text;
}

function directoryWithPermission(
  name: string,
  permission: PermissionState,
  children: FileSystemHandle[] = [],
): TestDirectoryHandle {
  return Object.assign(directory(name, children), {
    queryPermission: async () => permission,
  });
}

function selectWorkspace(handle: FileSystemDirectoryHandle): void {
  loadSelectedDirectoryHandleMock.mockResolvedValue({
    ok: true,
    value: { handle, metadata: { name: handle.name, lastSelectedAt: 1 } },
  });
}

describe("workspace file tools", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    loadSelectedDirectoryHandleMock.mockReset();
  });

  afterEach(() => {
    loadSelectedDirectoryHandleMock.mockReset();
  });

  it("registers workspace list and read handlers", () => {
    Object.assign(globalThis, {
      chrome: {
        tabs: {
          onRemoved: { addListener: vi.fn() },
          onUpdated: { addListener: vi.fn() },
        },
        webNavigation: {
          onCommitted: { addListener: vi.fn() },
        },
      },
    });
    const router = new MessageRouter();

    registerTools(router);

    expect(router.getRegisteredTools()).toContain(TOOL_NAMES.WORKSPACE_LIST_FILES);
    expect(router.getRegisteredTools()).toContain(TOOL_NAMES.WORKSPACE_READ_FILE);
  });

  it("lists directory entries inside the selected workspace", async () => {
    selectWorkspace(directory("workspace", [directory("src"), textFile("README.md", "# Readme")]));

    const result = await new WorkspaceListTool().execute({ path: "/" }, {});

    expect(result.success).toBe(true);
    const payload = JSON.parse(resultText(result));
    expect(payload.entries).toEqual([
      { kind: "directory", name: "src", path: "/src", depth: 1, canLoadChildren: true },
      { kind: "file", name: "README.md", path: "/README.md", depth: 1, canLoadChildren: false },
    ]);
  });

  it("reads text files with truncation metadata", async () => {
    selectWorkspace(directory("workspace", [directory("docs", [textFile("guide.md", "abcdef")])]));

    const result = await new WorkspaceReadTool().execute({ path: "docs/guide.md", limit: 3 }, {});

    expect(result.success).toBe(true);
    const payload = JSON.parse(resultText(result));
    expect(payload).toEqual({
      path: "/docs/guide.md",
      name: "guide.md",
      encoding: "utf-8",
      size: 6,
      truncated: true,
      content: "abc",
    });
  });

  it("refuses binary files and paths outside the workspace", async () => {
    selectWorkspace(directory("workspace", [binaryFile("image.bin")]));

    const binary = await new WorkspaceReadTool().execute({ path: "image.bin" }, {});
    const escaped = await new WorkspaceReadTool().execute({ path: "../secret.txt" }, {});

    expect(binary.success).toBe(false);
    expect(resultText(binary)).toContain("Binary files cannot be read");
    expect(escaped.success).toBe(false);
    expect(resultText(escaped)).toContain("selected workspace root");
  });

  it("refuses oversized files before reading content", async () => {
    selectWorkspace(directory("workspace", [textFile("large.txt", "a".repeat(1024 * 1024 + 1))]));

    const result = await new WorkspaceReadTool().execute({ path: "large.txt" }, {});

    expect(result.success).toBe(false);
    expect(resultText(result)).toContain("too large to read safely");
  });

  it("returns actionable errors when workspace permission is lost", async () => {
    selectWorkspace(directoryWithPermission("workspace", "denied", [textFile("notes.txt", "hello")]));

    const result = await new WorkspaceReadTool().execute({ path: "notes.txt" }, {});

    expect(result.success).toBe(false);
    expect(resultText(result)).toContain("restore access");
    expect(resultText(result)).toContain("side panel");
  });

  it("returns actionable errors when no workspace is selected", async () => {
    loadSelectedDirectoryHandleMock.mockResolvedValue({ ok: true, value: null });

    const result = await new WorkspaceListTool().execute({}, {});

    expect(result.success).toBe(false);
    expect(resultText(result)).toContain("Select a workspace folder in the side panel");
  });
});
