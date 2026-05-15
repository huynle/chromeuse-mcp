import { afterEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  clearSelectedDirectoryHandle,
  loadSelectedDirectoryHandle,
  saveSelectedDirectoryHandle,
} from "./workspaceStorage.js";

function createDirectoryHandle(name: string): FileSystemDirectoryHandle {
  return { kind: "directory", name } as FileSystemDirectoryHandle;
}

describe("workspace storage", () => {
  const databases: IDBFactory[] = [];

  afterEach(() => {
    databases.length = 0;
  });

  function createIndexedDB(): IDBFactory {
    const indexedDB = new IDBFactory();
    databases.push(indexedDB);
    return indexedDB;
  }

  it("persists and recovers the selected directory handle from IndexedDB", async () => {
    const indexedDB = createIndexedDB();
    const handle = createDirectoryHandle("workspace");

    const saved = await saveSelectedDirectoryHandle(handle, indexedDB);
    expect(saved.ok).toBe(true);
    expect(saved.ok && saved.value.name).toBe("workspace");

    const loaded = await loadSelectedDirectoryHandle(indexedDB);
    expect(loaded.ok).toBe(true);
    expect(loaded.ok && loaded.value?.handle).toStrictEqual(handle);
    expect(loaded.ok && loaded.value?.metadata.name).toBe("workspace");
  });

  it("returns null when no directory has been selected", async () => {
    const loaded = await loadSelectedDirectoryHandle(createIndexedDB());

    expect(loaded).toEqual({ ok: true, value: null });
  });

  it("clears the persisted directory handle", async () => {
    const indexedDB = createIndexedDB();
    await saveSelectedDirectoryHandle(createDirectoryHandle("workspace"), indexedDB);

    const cleared = await clearSelectedDirectoryHandle(indexedDB);
    expect(cleared).toEqual({ ok: true, value: undefined });
    expect(await loadSelectedDirectoryHandle(indexedDB)).toEqual({ ok: true, value: null });
  });

  it("fails gracefully when IndexedDB is unavailable", async () => {
    const originalIndexedDB = globalThis.indexedDB;
    Reflect.deleteProperty(globalThis, "indexedDB");

    const loaded = await loadSelectedDirectoryHandle();

    expect(loaded.ok).toBe(false);
    expect(!loaded.ok && loaded.error).toContain("IndexedDB is unavailable");

    if (originalIndexedDB) globalThis.indexedDB = originalIndexedDB;
  });

  it("fails gracefully when a directory handle is unavailable", async () => {
    const saved = await saveSelectedDirectoryHandle(
      { kind: "file", name: "notes.md" } as unknown as FileSystemDirectoryHandle,
      createIndexedDB(),
    );

    expect(saved.ok).toBe(false);
    expect(!saved.ok && saved.error).toContain("directory handles are unavailable");
  });
});
