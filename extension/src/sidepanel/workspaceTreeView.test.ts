import { describe, expect, it } from "vitest";
import {
  createSelectedWorkspaceFile,
  describeWorkspaceTreeState,
  toWorkspaceTreeItems,
  type WorkspaceTreeViewState,
} from "./workspaceTreeView.js";

function baseState(overrides: Partial<WorkspaceTreeViewState> = {}): WorkspaceTreeViewState {
  return {
    directory: null,
    permission: { state: "granted", action: "none", canRequest: false, message: null },
    selectedFile: null,
    isLoading: false,
    error: null,
    ...overrides,
  };
}

describe("workspace tree view state", () => {
  it("describes a lazily loaded selected workspace directory with file selection", () => {
    const description = describeWorkspaceTreeState(baseState({
      directory: {
        path: "/",
        depth: 0,
        truncated: true,
        entries: [
          { kind: "directory", name: "src", path: "/src", depth: 1, canLoadChildren: true },
          { kind: "file", name: "README.md", path: "/README.md", depth: 1, canLoadChildren: false },
        ],
      },
      selectedFile: { path: "/README.md", name: "README.md", selectedAt: 1_700_000_000_000 },
    }));

    expect(description).toBe("2 entries loaded, more entries available, selected /README.md");
  });

  it("describes actionable permission recovery before enumeration", () => {
    const description = describeWorkspaceTreeState(baseState({
      directory: null,
      permission: {
        state: "denied",
        action: "select-workspace",
        canRequest: false,
        message: "Workspace access was denied. Ask the user to select the workspace folder again.",
      },
    }));

    expect(description).toBe("Workspace access was denied. Ask the user to select the workspace folder again. Reselect workspace to continue.");
  });

  it("marks directories as expandable and files as selectable view items", () => {
    const items = toWorkspaceTreeItems({
      path: "/",
      depth: 0,
      truncated: false,
      entries: [
        { kind: "directory", name: "src", path: "/src", depth: 1, canLoadChildren: true },
        { kind: "file", name: "README.md", path: "/README.md", depth: 1, canLoadChildren: false },
      ],
    }, "/README.md");

    expect(items).toEqual([
      {
        kind: "directory",
        name: "src",
        path: "/src",
        depth: 1,
        expandable: true,
        selectable: false,
        selected: false,
      },
      {
        kind: "file",
        name: "README.md",
        path: "/README.md",
        depth: 1,
        expandable: false,
        selectable: true,
        selected: true,
      },
    ]);
  });

  it("creates selected file state for future document viewers", () => {
    expect(createSelectedWorkspaceFile({
      kind: "file",
      name: "README.md",
      path: "/docs/README.md",
      depth: 2,
      canLoadChildren: false,
    }, 1_700_000_000_000)).toEqual({
      path: "/docs/README.md",
      name: "README.md",
      selectedAt: 1_700_000_000_000,
    });
  });
});
