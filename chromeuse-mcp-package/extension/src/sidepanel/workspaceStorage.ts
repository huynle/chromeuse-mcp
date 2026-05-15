import type { WorkspaceFolderMetadata, WorkspaceResult } from "./workspaceTypes.js";

const DATABASE_NAME = "chromeuse-workspace";
const DATABASE_VERSION = 1;
const STORE_NAME = "directory-handles";
const SELECTED_DIRECTORY_KEY = "selected-directory";

interface StoredDirectoryHandle {
  readonly key: typeof SELECTED_DIRECTORY_KEY;
  readonly handle: FileSystemDirectoryHandle;
  readonly metadata: WorkspaceFolderMetadata;
}

export interface StoredWorkspaceDirectory {
  readonly handle: FileSystemDirectoryHandle;
  readonly metadata: WorkspaceFolderMetadata;
}

function failure<T>(error: string): WorkspaceResult<T> {
  return { ok: false, error };
}

function success<T>(value: T): WorkspaceResult<T> {
  return { ok: true, value };
}

function getIndexedDB(indexedDBOverride?: IDBFactory): IDBFactory | null {
  return indexedDBOverride ?? globalThis.indexedDB ?? null;
}

function isDirectoryHandle(handle: unknown): handle is FileSystemDirectoryHandle {
  return (
    typeof handle === "object" &&
    handle !== null &&
    "kind" in handle &&
    (handle as FileSystemHandle).kind === "directory" &&
    "name" in handle &&
    typeof (handle as FileSystemHandle).name === "string"
  );
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function openWorkspaceDatabase(indexedDBFactory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDBFactory.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open IndexedDB"));
    request.onblocked = () => reject(new Error("IndexedDB upgrade was blocked"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
  indexedDBOverride?: IDBFactory,
): Promise<WorkspaceResult<T>> {
  const indexedDBFactory = getIndexedDB(indexedDBOverride);
  if (!indexedDBFactory) return failure("IndexedDB is unavailable in this environment.");

  let database: IDBDatabase | undefined;
  try {
    database = await openWorkspaceDatabase(indexedDBFactory);
    const transaction = database.transaction(STORE_NAME, mode);
    const result = await requestToPromise(operation(transaction.objectStore(STORE_NAME)));
    return success(result);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "IndexedDB operation failed.");
  } finally {
    database?.close();
  }
}

export async function saveSelectedDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  indexedDBOverride?: IDBFactory,
): Promise<WorkspaceResult<WorkspaceFolderMetadata>> {
  if (!isDirectoryHandle(handle)) return failure("File System Access directory handles are unavailable.");

  const metadata: WorkspaceFolderMetadata = {
    name: handle.name,
    lastSelectedAt: Date.now(),
  };

  const result = await withStore(
    "readwrite",
    (store) =>
      store.put({
        key: SELECTED_DIRECTORY_KEY,
        handle,
        metadata,
      } satisfies StoredDirectoryHandle),
    indexedDBOverride,
  );

  return result.ok ? success(metadata) : result;
}

export async function loadSelectedDirectoryHandle(
  indexedDBOverride?: IDBFactory,
): Promise<WorkspaceResult<StoredWorkspaceDirectory | null>> {
  const result = await withStore<StoredDirectoryHandle | undefined>(
    "readonly",
    (store) => store.get(SELECTED_DIRECTORY_KEY),
    indexedDBOverride,
  );

  if (!result.ok) return result;
  if (!result.value) return success(null);
  if (!isDirectoryHandle(result.value.handle)) return failure("Stored directory handle is unavailable.");

  return success({
    handle: result.value.handle,
    metadata: result.value.metadata,
  });
}

export async function clearSelectedDirectoryHandle(
  indexedDBOverride?: IDBFactory,
): Promise<WorkspaceResult<void>> {
  const result = await withStore("readwrite", (store) => store.delete(SELECTED_DIRECTORY_KEY), indexedDBOverride);
  return result.ok ? success(undefined) : result;
}
