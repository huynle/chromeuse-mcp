import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolResult } from "../../types/messages.js";

const sendCommand = vi.fn();
const attach = vi.fn(() => Promise.resolve());
const isAttached = vi.fn(() => true);
const enableDomain = vi.fn(() => Promise.resolve());
let cdpListener: ((source: { tabId?: number }, method: string, params: unknown) => void) | null = null;
const addEventListener = vi.fn((l: typeof cdpListener) => {
  cdpListener = l;
});

vi.mock("../cdp.js", () => ({
  cdpManager: { attach, isAttached, sendCommand, enableDomain, addEventListener },
}));

const tabsOnRemoved = { addListener: vi.fn() };
Object.assign(globalThis, { chrome: { tabs: { onRemoved: tabsOnRemoved } } });

const { WaitForTool } = await import("./waitFor.js");

function text(result: ToolResult): string {
  const block = result.content[0];
  if (block.type !== "text") throw new Error("expected text");
  return block.text;
}

describe("WaitForTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAttached.mockReturnValue(true);
    sendCommand.mockResolvedValue({ result: { value: false } });
  });

  it("rejects a missing tabId", async () => {
    const r = await new WaitForTool().execute({ for: "text", text: "x" }, {});
    expect(r.success).toBe(false);
    expect(text(r)).toContain("tabId");
  });

  it("rejects an unknown condition", async () => {
    const r = await new WaitForTool().execute({ tabId: 1, for: "nope" }, {});
    expect(r.success).toBe(false);
    expect(text(r)).toContain("Invalid");
  });

  it("requires a selector for selector waits", async () => {
    const r = await new WaitForTool().execute({ tabId: 1, for: "selector" }, {});
    expect(r.success).toBe(false);
    expect(text(r)).toContain("selector");
  });

  it("resolves when the selector becomes visible", async () => {
    sendCommand.mockResolvedValue({ result: { value: true } });
    const r = await new WaitForTool().execute(
      { tabId: 1, for: "selector", selector: "#go", pollMs: 1, timeoutMs: 200 },
      {},
    );
    expect(r.success).toBe(true);
    const payload = JSON.parse(text(r));
    expect(payload.satisfied).toBe(true);
    expect(payload.selector).toBe("#go");
    expect(sendCommand).toHaveBeenCalledWith(1, "Runtime.evaluate", expect.objectContaining({ returnByValue: true }));
  });

  it("times out when the condition never holds", async () => {
    sendCommand.mockResolvedValue({ result: { value: false } });
    const r = await new WaitForTool().execute(
      { tabId: 1, for: "text", text: "never", pollMs: 1, timeoutMs: 30 },
      {},
    );
    expect(r.success).toBe(false);
    expect(text(r)).toContain("timed out");
  });

  it("resolves network_idle when no requests are in flight", async () => {
    const r = await new WaitForTool().execute(
      { tabId: 1, for: "network_idle", idleMs: 0, pollMs: 1, timeoutMs: 200 },
      {},
    );
    expect(r.success).toBe(true);
    expect(JSON.parse(text(r)).satisfied).toBe(true);
    expect(enableDomain).toHaveBeenCalledWith(1, "Network");
  });

  it("resolves console wait when a matching message arrives", async () => {
    const tool = new WaitForTool();
    const promise = tool.execute(
      { tabId: 7, for: "console", pattern: "ready:\\d+", pollMs: 1, timeoutMs: 500 },
      {},
    );
    // Simulate a console message via the registered CDP event listener.
    await Promise.resolve();
    cdpListener?.({ tabId: 7 }, "Runtime.consoleAPICalled", {
      args: [{ value: "app ready:42" }],
    });
    const r = await promise;
    expect(r.success).toBe(true);
    const payload = JSON.parse(text(r));
    expect(payload.satisfied).toBe(true);
    expect(payload.matched).toContain("ready:42");
  });
});
