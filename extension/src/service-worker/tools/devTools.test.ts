import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolResult } from "../../types/messages.js";

const sendCommand = vi.fn();
const attach = vi.fn(() => Promise.resolve());
const isAttached = vi.fn(() => true);
const enableDomain = vi.fn(() => Promise.resolve());

vi.mock("../cdp.js", () => ({
  cdpManager: { attach, isAttached, sendCommand, enableDomain },
}));

const { PerformanceMetricsTool } = await import("./performanceMetrics.js");
const { ScreenshotElementTool } = await import("./screenshotElement.js");
const { PrintToPdfTool } = await import("./printToPdf.js");
const { ExtractStructuredTool } = await import("./extractStructured.js");

function textOf(result: ToolResult): string {
  const block = result.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("no text block");
  return block.text;
}

beforeEach(() => {
  vi.clearAllMocks();
  isAttached.mockReturnValue(true);
  sendCommand.mockResolvedValue({});
  vi.stubGlobal("chrome", { downloads: { download: vi.fn(() => Promise.resolve(99)) } });
});

describe("PerformanceMetricsTool", () => {
  it("requires tabId", async () => {
    expect((await new PerformanceMetricsTool().execute({}, {})).success).toBe(false);
  });

  it("returns page + runtime metrics", async () => {
    sendCommand.mockImplementation(async (_t, method) => {
      if (method === "Runtime.evaluate") {
        return { result: { value: { url: "https://x.test", fcpMs: 120, lcpMs: 800, cls: 0.02 } } };
      }
      if (method === "Performance.getMetrics") {
        return { metrics: [{ name: "JSHeapUsedSize", value: 1234 }, { name: "Ignored", value: 5 }] };
      }
      return {};
    });
    const r = await new PerformanceMetricsTool().execute({ tabId: 1 }, {});
    expect(r.success).toBe(true);
    const payload = JSON.parse(textOf(r));
    expect(payload.lcpMs).toBe(800);
    expect(payload.runtime.JSHeapUsedSize).toBe(1234);
    expect(payload.runtime.Ignored).toBeUndefined();
  });
});

describe("ScreenshotElementTool", () => {
  it("requires selector", async () => {
    expect((await new ScreenshotElementTool().execute({ tabId: 1 }, {})).success).toBe(false);
  });

  it("fails when no element matches", async () => {
    sendCommand.mockResolvedValue({ result: { value: null } });
    const r = await new ScreenshotElementTool().execute({ tabId: 1, selector: "#x" }, {});
    expect(r.success).toBe(false);
    expect(textOf(r)).toContain("No element matched");
  });

  it("captures a clipped PNG of the element", async () => {
    sendCommand.mockImplementation(async (_t, method) => {
      if (method === "Runtime.evaluate") return { result: { value: { x: 10, y: 20, width: 100, height: 50 } } };
      if (method === "Page.captureScreenshot") return { data: "QUJD" };
      return {};
    });
    const r = await new ScreenshotElementTool().execute({ tabId: 1, selector: ".chart", padding: 5 }, {});
    expect(r.success).toBe(true);
    const img = r.content.find((b) => b.type === "image");
    expect(img && img.type === "image" ? img.source.data : null).toBe("QUJD");
    const clipCall = sendCommand.mock.calls.find((c) => c[1] === "Page.captureScreenshot");
    expect(clipCall?.[2].clip).toMatchObject({ x: 5, y: 15, width: 110, height: 60 });
  });
});

describe("PrintToPdfTool", () => {
  it("rejects an absolute outputPath", async () => {
    const r = await new PrintToPdfTool().execute({ tabId: 1, outputPath: "/etc/x.pdf" }, {});
    expect(r.success).toBe(false);
    expect(textOf(r)).toContain("workspace-relative");
  });

  it("downloads the PDF when no outputPath is given", async () => {
    sendCommand.mockImplementation(async (_t, method) => (method === "Page.printToPDF" ? { data: "JVBERi0=" } : {}));
    const r = await new PrintToPdfTool().execute({ tabId: 1, filename: "report.pdf" }, {});
    expect(r.success).toBe(true);
    expect(JSON.parse(textOf(r)).downloadId).toBe(99);
    expect(chrome.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "report.pdf", url: expect.stringContaining("data:application/pdf;base64,") }),
    );
  });
});

describe("ExtractStructuredTool", () => {
  it("requires selector", async () => {
    expect((await new ExtractStructuredTool().execute({ tabId: 1 }, {})).success).toBe(false);
  });

  it("returns extracted table data", async () => {
    sendCommand.mockResolvedValue({
      result: { value: { kind: "table", headers: ["a", "b"], rows: [{ a: "1", b: "2" }] } },
    });
    const r = await new ExtractStructuredTool().execute({ tabId: 1, selector: "table" }, {});
    expect(r.success).toBe(true);
    const payload = JSON.parse(textOf(r));
    expect(payload.data.kind).toBe("table");
    expect(payload.data.rows[0]).toEqual({ a: "1", b: "2" });
  });

  it("surfaces a no-match error", async () => {
    sendCommand.mockResolvedValue({ result: { value: { error: "no element matched selector" } } });
    const r = await new ExtractStructuredTool().execute({ tabId: 1, selector: "#none" }, {});
    expect(r.success).toBe(false);
  });
});
