import { describe, expect, it } from "vitest";
import { normalizeWorkspacePath, readWorkspaceDirectory, readWorkspaceTree } from "./workspaceTree.js";

type TestHandle = FileSystemHandle & {
  children?: Map<string, TestHandle>;
  values?: () => AsyncIterable<FileSystemHandle>;
  getDirectoryHandle?: (name: string) => Promise<FileSystemDirectoryHandle>;
  getFileHandle?: (name: string) => Promise<FileSystemFileHandle>;
};

function file(name: string): TestHandle {
  return { kind: "file", name, isSameEntry: async () => false } as TestHandle;
}

function directory(name: string, children: TestHandle[] = []): FileSystemDirectoryHandle {
  const childMap = new Map(children.map((child) => [child.name, child]));
  const handle: TestHandle = {
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
  };
  return handle as FileSystemDirectoryHandle;
}

describe("workspace tree", () => {
  it("normalizes paths under the workspace root", () => {
    expect(normalizeWorkspacePath("/docs", "guide.md")).toEqual({ ok: true, value: "/docs/guide.md" });
    expect(normalizeWorkspacePath("/")).toEqual({ ok: true, value: "/" });
    expect(normalizeWorkspacePath("/docs/..", "secret.md").ok).toBe(false);
    expect(normalizeWorkspacePath("/docs", "../secret.md").ok).toBe(false);
  });

  it("loads one directory level with entry limits and serializable nodes", async () => {
    const root = directory("workspace", [file("b.md"), directory("src"), file("a.md")]);

    const result = await readWorkspaceDirectory(root, "/", 0, { maxDepth: 2, maxEntriesPerDirectory: 2 });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.truncated).toBe(true);
    expect(result.ok && result.value.entries).toEqual([
      { kind: "directory", name: "src", path: "/src", depth: 1, canLoadChildren: true },
      { kind: "file", name: "b.md", path: "/b.md", depth: 1, canLoadChildren: false },
    ]);
  });

  it("recursively reads a tree without exceeding max depth", async () => {
    const root = directory("workspace", [
      directory("src", [directory("deep", [file("hidden.md")]), file("index.ts")]),
    ]);

    const result = await readWorkspaceTree(root, { maxDepth: 1, maxEntriesPerDirectory: 10 });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toEqual({
      kind: "directory",
      name: "workspace",
      path: "/",
      depth: 0,
      canLoadChildren: true,
      children: [{ kind: "directory", name: "src", path: "/src", depth: 1, canLoadChildren: false }],
    });
  });

  it("does not enumerate directories at the configured max depth", async () => {
    const root = directory("workspace", [file("hidden.md")]);

    const result = await readWorkspaceDirectory(root, "/", 0, { maxDepth: 0, maxEntriesPerDirectory: 10 });

    expect(result).toEqual({ ok: true, value: { path: "/", depth: 0, entries: [], truncated: false } });
  });

  it("normalizes invalid entry limits to at least one entry", async () => {
    const root = directory("workspace", [file("a.md"), file("b.md")]);

    const result = await readWorkspaceDirectory(root, "/", 0, { maxDepth: 1, maxEntriesPerDirectory: 0 });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.entries).toEqual([
      { kind: "file", name: "a.md", path: "/a.md", depth: 1, canLoadChildren: false },
    ]);
    expect(result.ok && result.value.truncated).toBe(true);
  });
});
