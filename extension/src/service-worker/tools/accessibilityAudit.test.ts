import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolResult } from "../../types/messages.js";
import { AccessibilityAuditTool } from "./accessibilityAudit.js";

const executeScript = vi.fn();

function text(r: ToolResult): string {
  const b = r.content[0];
  if (b.type !== "text") throw new Error("expected text");
  return b.text;
}

describe("AccessibilityAuditTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("chrome", { scripting: { executeScript } });
  });

  it("requires tabId", async () => {
    vi.stubGlobal("chrome", { scripting: { executeScript } });
    const r = await new AccessibilityAuditTool().execute({}, {});
    expect(r.success).toBe(false);
  });

  it("loads axe then runs the audit and summarizes violations", async () => {
    executeScript
      .mockResolvedValueOnce([{ result: undefined }]) // file injection
      .mockResolvedValueOnce([
        {
          result: {
            url: "https://x.test/",
            violations: [
              { id: "image-alt", impact: "critical", help: "Images need alt", helpUrl: "h", tags: ["wcag2a"], nodes: 2, sampleTargets: ["img.logo"] },
            ],
          },
        },
      ]);

    const r = await new AccessibilityAuditTool().execute({ tabId: 5, tags: ["wcag2a"] }, {});
    expect(r.success).toBe(true);
    const payload = JSON.parse(text(r));
    expect(payload.violationCount).toBe(1);
    expect(payload.violations[0].id).toBe("image-alt");

    // First call injects the axe file; second runs the audit with tags.
    expect(executeScript.mock.calls[0][0].files).toEqual(["dist/content-scripts/axeAudit.js"]);
    expect(executeScript.mock.calls[1][0].args[0].tags).toEqual(["wcag2a"]);
  });

  it("surfaces an in-page error", async () => {
    executeScript
      .mockResolvedValueOnce([{ result: undefined }])
      .mockResolvedValueOnce([{ result: { error: "axe-core failed to load" } }]);
    const r = await new AccessibilityAuditTool().execute({ tabId: 5 }, {});
    expect(r.success).toBe(false);
    expect(text(r)).toContain("failed to load");
  });

  it("caps the number of returned violations", async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: "r" + i, impact: "minor", help: "", helpUrl: "", tags: [], nodes: 1, sampleTargets: [] }));
    executeScript
      .mockResolvedValueOnce([{ result: undefined }])
      .mockResolvedValueOnce([{ result: { url: "u", violations: many } }]);
    const r = await new AccessibilityAuditTool().execute({ tabId: 5, maxViolations: 10 }, {});
    const payload = JSON.parse(text(r));
    expect(payload.violationCount).toBe(80);
    expect(payload.violations).toHaveLength(10);
  });
});
