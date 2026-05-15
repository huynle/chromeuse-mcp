import { describe, expect, it } from "vitest";
import { createEmptyWorkspaceState } from "./workspaceTypes.js";

describe("workspace types", () => {
  it("creates an empty workspace state with loading and error fields", () => {
    expect(createEmptyWorkspaceState()).toEqual({
      selectedFolder: null,
      selectedFile: null,
      isLoading: false,
      error: null,
    });
  });
});
