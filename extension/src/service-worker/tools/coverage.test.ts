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

const { CoverageTool } = await import("./coverage.js");

function text(r: ToolResult): string {
  const b = r.content[0];
  if (b.type !== "text") throw new Error("expected text");
  return b.text;
}

describe("CoverageTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAttached.mockReturnValue(true);
    sendCommand.mockResolvedValue({});
  });

  it("rejects missing tabId / invalid action", async () => {
    expect((await new CoverageTool().execute({ action: "start" }, {})).success).toBe(false);
    expect((await new CoverageTool().execute({ tabId: 1, action: "nope" }, {})).success).toBe(false);
  });

  it("starts JS + CSS tracking", async () => {
    const r = await new CoverageTool().execute({ tabId: 1, action: "start" }, {});
    expect(r.success).toBe(true);
    expect(sendCommand.mock.calls.find((c) => c[1] === "Profiler.startPreciseCoverage")).toBeTruthy();
    expect(sendCommand.mock.calls.find((c) => c[1] === "CSS.startRuleUsageTracking")).toBeTruthy();
  });

  it("errors on stop without start", async () => {
    const r = await new CoverageTool().execute({ tabId: 2, action: "stop" }, {});
    expect(r.success).toBe(false);
    expect(text(r)).toContain("not running");
  });

  it("summarizes JS function coverage and CSS rule usage", async () => {
    const tool = new CoverageTool();
    await tool.execute({ tabId: 3, action: "start" }, {});

    // Provide a stylesheet URL mapping via the CDP event.
    cdpListener?.({ tabId: 3 }, "CSS.styleSheetAdded", { header: { styleSheetId: "ss1", sourceURL: "https://x.test/app.css" } });

    sendCommand.mockImplementation(async (_t, method) => {
      if (method === "Profiler.takePreciseCoverage") {
        return {
          result: [
            {
              scriptId: "1",
              url: "https://x.test/app.js",
              functions: [
                { ranges: [{ startOffset: 0, endOffset: 100, count: 2 }] },
                { ranges: [{ startOffset: 100, endOffset: 200, count: 0 }] },
              ],
            },
            { scriptId: "2", url: "", functions: [{ ranges: [{ startOffset: 0, endOffset: 10, count: 1 }] }] },
          ],
        };
      }
      if (method === "CSS.stopRuleUsageTracking") {
        return {
          ruleUsage: [
            { styleSheetId: "ss1", used: true },
            { styleSheetId: "ss1", used: false },
            { styleSheetId: "ss1", used: true },
          ],
        };
      }
      return {};
    });

    const r = await tool.execute({ tabId: 3, action: "stop" }, {});
    expect(r.success).toBe(true);
    const payload = JSON.parse(text(r));
    // JS: anonymous (url "") skipped; app.js has 1/2 functions used
    expect(payload.javascript.functionsTotal).toBe(2);
    expect(payload.javascript.functionsUsed).toBe(1);
    expect(payload.javascript.scripts[0].url).toBe("https://x.test/app.js");
    // CSS: 2/3 rules used, mapped to the stylesheet URL
    expect(payload.css.rulesTotal).toBe(3);
    expect(payload.css.rulesUsed).toBe(2);
    expect(payload.css.stylesheets[0].url).toBe("https://x.test/app.css");
  });
});
