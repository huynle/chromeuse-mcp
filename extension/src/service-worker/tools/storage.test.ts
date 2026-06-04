import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolResult } from "../../types/messages.js";

const sendCommand = vi.fn();
const attach = vi.fn(() => Promise.resolve());
const isAttached = vi.fn(() => true);

vi.mock("../cdp.js", () => ({
  cdpManager: { attach, isAttached, sendCommand },
}));

const { StorageTool } = await import("./storage.js");

function text(result: ToolResult): string {
  const block = result.content[0];
  if (block.type !== "text") throw new Error("expected text");
  return block.text;
}

describe("StorageTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAttached.mockReturnValue(true);
    sendCommand.mockResolvedValue({ result: { value: null } });
  });

  it("rejects missing tabId and invalid action", async () => {
    expect((await new StorageTool().execute({ action: "get" }, {})).success).toBe(false);
    expect((await new StorageTool().execute({ tabId: 1, action: "nope" }, {})).success).toBe(false);
  });

  it("gets a single localStorage key", async () => {
    sendCommand.mockResolvedValue({ result: { value: "dark" } });
    const r = await new StorageTool().execute({ tabId: 1, action: "get", key: "theme" }, {});
    expect(r.success).toBe(true);
    expect(JSON.parse(text(r)).result).toBe("dark");
    const expr = sendCommand.mock.calls[0][2].expression as string;
    expect(expr).toContain("localStorage.getItem(\"theme\")");
  });

  it("gets all entries when key omitted", async () => {
    sendCommand.mockResolvedValue({ result: { value: { a: "1" } } });
    const r = await new StorageTool().execute({ tabId: 1, action: "get" }, {});
    const expr = sendCommand.mock.calls[0][2].expression as string;
    expect(expr).toContain("Object.entries(localStorage)");
    expect(JSON.parse(text(r)).result).toEqual({ a: "1" });
  });

  it("targets sessionStorage when area=session", async () => {
    await new StorageTool().execute({ tabId: 1, action: "clear", area: "session" }, {});
    const expr = sendCommand.mock.calls[0][2].expression as string;
    expect(expr).toContain("sessionStorage.clear()");
  });

  it("requires key for set/remove and value for set", async () => {
    expect((await new StorageTool().execute({ tabId: 1, action: "set", value: "x" }, {})).success).toBe(false);
    expect((await new StorageTool().execute({ tabId: 1, action: "remove" }, {})).success).toBe(false);
    expect((await new StorageTool().execute({ tabId: 1, action: "set", key: "k" }, {})).success).toBe(false);
  });

  it("sets a key/value", async () => {
    const r = await new StorageTool().execute({ tabId: 1, action: "set", key: "k", value: "v" }, {});
    expect(r.success).toBe(true);
    const expr = sendCommand.mock.calls[0][2].expression as string;
    expect(expr).toContain('localStorage.setItem("k", "v")');
  });

  it("surfaces page exceptions", async () => {
    sendCommand.mockResolvedValue({ exceptionDetails: { text: "boom" } });
    const r = await new StorageTool().execute({ tabId: 1, action: "get", key: "k" }, {});
    expect(r.success).toBe(false);
    expect(text(r)).toContain("evaluation failed");
  });
});
