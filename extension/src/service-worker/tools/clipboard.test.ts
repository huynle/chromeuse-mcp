import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolResult } from "../../types/messages.js";

const ensureOffscreenDocument = vi.fn(() => Promise.resolve());
vi.mock("../offscreenClient.js", () => ({ ensureOffscreenDocument }));

const { ClipboardTool } = await import("./clipboard.js");

const sendMessage = vi.fn();

function text(r: ToolResult): string {
  const b = r.content[0];
  if (b.type !== "text") throw new Error("expected text");
  return b.text;
}

describe("ClipboardTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
  });

  it("rejects an invalid action", async () => {
    const r = await new ClipboardTool().execute({ action: "nope" }, {});
    expect(r.success).toBe(false);
  });

  it("requires text for write", async () => {
    const r = await new ClipboardTool().execute({ action: "write" }, {});
    expect(r.success).toBe(false);
    expect(text(r)).toContain("text");
  });

  it("writes to the clipboard via the offscreen document", async () => {
    sendMessage.mockResolvedValue({ success: true });
    const r = await new ClipboardTool().execute({ action: "write", text: "hello" }, {});
    expect(r.success).toBe(true);
    expect(JSON.parse(text(r)).written).toBe(true);
    expect(ensureOffscreenDocument).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith({ action: "clipboard-write", text: "hello" });
  });

  it("reads from the clipboard", async () => {
    sendMessage.mockResolvedValue({ success: true, text: "copied!" });
    const r = await new ClipboardTool().execute({ action: "read" }, {});
    expect(r.success).toBe(true);
    expect(JSON.parse(text(r)).text).toBe("copied!");
    expect(sendMessage).toHaveBeenCalledWith({ action: "clipboard-read" });
  });

  it("surfaces a read failure clearly", async () => {
    sendMessage.mockResolvedValue({ success: false, error: "Document is not focused" });
    const r = await new ClipboardTool().execute({ action: "read" }, {});
    expect(r.success).toBe(false);
    expect(text(r)).toContain("not focused");
  });
});
