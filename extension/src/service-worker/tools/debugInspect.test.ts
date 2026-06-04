import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolResult } from "../../types/messages.js";

const sendCommand = vi.fn();
const attach = vi.fn(() => Promise.resolve());
const isAttached = vi.fn(() => true);
const enableDomain = vi.fn(() => Promise.resolve());
let cdpListener: ((source: { tabId?: number }, method: string, params: unknown) => void) | null = null;
const addEventListener = vi.fn((l: typeof cdpListener) => { cdpListener = l; });

vi.mock("../cdp.js", () => ({
  cdpManager: { attach, isAttached, sendCommand, enableDomain, addEventListener },
}));

Object.assign(globalThis, { chrome: { tabs: { onRemoved: { addListener: vi.fn() } } } });

const { DebugInspectTool } = await import("./debugInspect.js");

function text(r: ToolResult): string {
  const b = r.content[0];
  if (b.type !== "text") throw new Error("expected text");
  return b.text;
}

const PAUSED = {
  reason: "other",
  callFrames: [
    {
      callFrameId: "cf1",
      functionName: "handleClick",
      location: { scriptId: "1", lineNumber: 42, columnNumber: 4 },
      scopeChain: [{ type: "local", object: { objectId: "obj-local" } }, { type: "global", object: {} }],
    },
  ],
};

describe("DebugInspectTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAttached.mockReturnValue(true);
    sendCommand.mockImplementation(async (_t, method) => {
      if (method === "Debugger.setBreakpointByUrl") return { breakpointId: "bp1" };
      if (method === "Runtime.getProperties") return { result: [{ name: "count", value: { type: "number", value: 7 } }] };
      if (method === "Debugger.evaluateOnCallFrame") return { result: { value: "evaluated!" } };
      return {};
    });
  });

  it("validates required args", async () => {
    expect((await new DebugInspectTool().execute({}, {})).success).toBe(false);
    expect((await new DebugInspectTool().execute({ tabId: 1 }, {})).success).toBe(false);
    expect((await new DebugInspectTool().execute({ tabId: 1, urlRegex: "x" }, {})).success).toBe(false);
  });

  it("captures the frame, locals, and evaluated expression on pause", async () => {
    const tool = new DebugInspectTool();
    const promise = tool.execute(
      { tabId: 1, urlRegex: "app\\.js", lineNumber: 42, expression: "count * 2", timeoutMs: 1000 },
      {},
    );
    // Let execute() get past its awaits and register the pause waiter.
    await new Promise((r) => setTimeout(r, 10));
    cdpListener?.({ tabId: 1 }, "Debugger.paused", PAUSED);
    const r = await promise;

    expect(r.success).toBe(true);
    const payload = JSON.parse(text(r));
    expect(payload.frame.functionName).toBe("handleClick");
    expect(payload.frame.line).toBe(42);
    expect(payload.locals).toEqual([{ name: "count", value: 7 }]);
    expect(payload.evaluated).toBe("evaluated!");
    // Always resumes + removes the breakpoint.
    expect(sendCommand.mock.calls.find((c) => c[1] === "Debugger.resume")).toBeTruthy();
    expect(sendCommand.mock.calls.find((c) => c[1] === "Debugger.removeBreakpoint")).toBeTruthy();
  });

  it("times out cleanly when the breakpoint is never hit", async () => {
    const r = await new DebugInspectTool().execute(
      { tabId: 1, urlRegex: "app\\.js", lineNumber: 1, timeoutMs: 20 },
      {},
    );
    expect(r.success).toBe(false);
    expect(text(r)).toContain("not hit");
    expect(sendCommand.mock.calls.find((c) => c[1] === "Debugger.removeBreakpoint")).toBeTruthy();
  });
});
