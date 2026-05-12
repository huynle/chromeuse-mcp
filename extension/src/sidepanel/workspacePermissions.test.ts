import { describe, expect, it, vi } from "vitest";
import { queryWorkspacePermission, requestWorkspacePermission } from "./workspacePermissions.js";

type TestPermissionHandle = FileSystemHandle & {
  queryPermission?: (descriptor?: { readonly mode: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { readonly mode: "read" | "readwrite" }) => Promise<PermissionState>;
};

function createHandle(overrides: Partial<TestPermissionHandle> = {}): FileSystemHandle {
  return {
    kind: "directory",
    name: "workspace",
    isSameEntry: vi.fn(),
    ...overrides,
  } as TestPermissionHandle;
}

describe("workspace permissions", () => {
  it("queries permission with a read descriptor", async () => {
    const queryPermission = vi.fn().mockResolvedValue("granted");
    const result = await queryWorkspacePermission(createHandle({ queryPermission }));

    expect(queryPermission).toHaveBeenCalledWith({ mode: "read" });
    expect(result).toEqual({ ok: true, value: { state: "granted", action: "none", canRequest: false, message: null } });
  });

  it("represents lost permission as an actionable recovery state", async () => {
    const handle = createHandle({
      queryPermission: vi.fn().mockResolvedValue("denied"),
      requestPermission: vi.fn().mockResolvedValue("granted"),
    });

    const result = await queryWorkspacePermission(handle);

    expect(result.ok && result.value.state).toBe("denied");
    expect(result.ok && result.value.action).toBe("request-permission");
    expect(result.ok && result.value.canRequest).toBe(true);
  });

  it("requests permission only through requestPermission", async () => {
    const requestPermission = vi.fn().mockResolvedValue("prompt");
    const result = await requestWorkspacePermission(createHandle({ requestPermission }), { mode: "readwrite" });

    expect(requestPermission).toHaveBeenCalledWith({ mode: "readwrite" });
    expect(result.ok && result.value.state).toBe("prompt");
    expect(result.ok && result.value.action).toBe("request-permission");
  });

  it("returns unsupported recovery when permission APIs are unavailable", async () => {
    const result = await queryWorkspacePermission(createHandle());

    expect(result).toEqual({
      ok: true,
      value: {
        state: "unsupported",
        action: "unsupported",
        canRequest: false,
        message: "File System Access permissions are unavailable in this browser context.",
      },
    });
  });
});
