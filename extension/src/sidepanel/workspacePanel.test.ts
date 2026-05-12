import { describe, expect, it, vi } from "vitest";
import { getWindowDirectoryPicker, loadWorkspaceSelection, pickWorkspaceFolder } from "./workspacePanel.js";
import type { WorkspaceFolderMetadata, WorkspaceResult } from "./workspaceTypes.js";

function directoryHandle(name = "project"): FileSystemDirectoryHandle {
  return { kind: "directory", name } as FileSystemDirectoryHandle;
}

function metadata(name = "project"): WorkspaceFolderMetadata {
  return { name, lastSelectedAt: 1_700_000_000_000 };
}

describe("workspace panel folder picking", () => {
  it("calls the browser directory picker with the window receiver intact", async () => {
    const handle = directoryHandle("workspace");
    const pickerWindow = {
      showDirectoryPicker: vi.fn(function (this: unknown) {
        if (this !== pickerWindow) throw new TypeError("Illegal invocation");
        return Promise.resolve(handle);
      }),
    };

    const picker = getWindowDirectoryPicker(pickerWindow);

    await expect(picker?.()).resolves.toBe(handle);
    expect(pickerWindow.showDirectoryPicker).toHaveBeenCalledTimes(1);
  });

  it("returns a clear fallback when directory picking is unsupported", async () => {
    const saveSelectedDirectoryHandle = vi.fn();

    const result = await pickWorkspaceFolder({
      showDirectoryPicker: undefined,
      saveSelectedDirectoryHandle,
      queryWorkspacePermission: vi.fn(),
    });

    expect(result).toEqual({
      ok: true,
      value: {
        selectedFolder: null,
        error: "Folder selection is not supported in this browser. Use a Chromium browser with the File System Access API enabled.",
      },
    });
    expect(saveSelectedDirectoryHandle).not.toHaveBeenCalled();
  });

  it("launches the browser directory picker, saves the handle, and returns metadata", async () => {
    const handle = directoryHandle("workspace");
    const savedMetadata = metadata("workspace");
    const showDirectoryPicker = vi.fn().mockResolvedValue(handle);
    const saveSelectedDirectoryHandle = vi.fn<
      (handle: FileSystemDirectoryHandle) => Promise<WorkspaceResult<WorkspaceFolderMetadata>>
    >().mockResolvedValue({ ok: true, value: savedMetadata });
    const queryWorkspacePermission = vi.fn().mockResolvedValue({ ok: true, value: { state: "granted" } });

    const result = await pickWorkspaceFolder({
      showDirectoryPicker,
      saveSelectedDirectoryHandle,
      queryWorkspacePermission,
    });

    expect(showDirectoryPicker).toHaveBeenCalledTimes(1);
    expect(saveSelectedDirectoryHandle).toHaveBeenCalledWith(handle);
    expect(queryWorkspacePermission).toHaveBeenCalledWith(handle);
    expect(result.ok && result.value.selectedFolder).toEqual({ metadata: savedMetadata, permission: "granted" });
  });

  it("represents restored handles with lost permission as recoverable UI state", async () => {
    const handle = directoryHandle("workspace");
    const result = await loadWorkspaceSelection({
      loadSelectedDirectoryHandle: vi.fn().mockResolvedValue({ ok: true, value: { handle, metadata: metadata("workspace") } }),
      queryWorkspacePermission: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          state: "denied",
          message: "Workspace access was denied. Request permission again from a user gesture.",
        },
      }),
    });

    expect(result).toEqual({
      ok: true,
      value: {
        selectedFolder: { metadata: metadata("workspace"), permission: "denied" },
        error: "Workspace access was denied. Request permission again from a user gesture.",
      },
    });
  });
});
