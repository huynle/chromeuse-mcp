import { describe, expect, it, vi } from "vitest";
import { SaveResourceTool } from "./saveResource.js";

function textFrom(result: Awaited<ReturnType<SaveResourceTool["execute"]>>): string {
  const block = result.content[0];
  if (block.type !== "text") throw new Error("Expected text result");
  return block.text;
}

describe("SaveResourceTool", () => {
  it("rejects absolute output paths before fetching the resource", async () => {
    const executeScript = vi.fn();
    Object.assign(globalThis, {
      chrome: {
        scripting: { executeScript },
      },
    });

    const result = await new SaveResourceTool().execute(
      {
        tabId: 1,
        url: "https://example.com/report.pdf",
        outputPath: "/Users/me/report.pdf",
      },
      {},
    );

    expect(result.success).toBe(false);
    expect(textFrom(result)).toContain("workspace-relative");
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("rejects Windows-style absolute output paths before fetching the resource", async () => {
    const executeScript = vi.fn();
    Object.assign(globalThis, {
      chrome: {
        scripting: { executeScript },
      },
    });

    const result = await new SaveResourceTool().execute(
      {
        tabId: 1,
        url: "https://example.com/report.pdf",
        outputPath: "C:\\Users\\me\\report.pdf",
      },
      {},
    );

    expect(result.success).toBe(false);
    expect(textFrom(result)).toContain("workspace-relative");
    expect(executeScript).not.toHaveBeenCalled();
  });
});
