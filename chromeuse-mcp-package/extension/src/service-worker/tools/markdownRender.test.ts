import { TOOL_NAMES } from "@chromeuse/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageRouter } from "../messageRouter.js";
import type { ToolResult } from "../../types/messages.js";
import { MarkdownRenderTool } from "./markdownRender.js";
import { registerTools } from "./index.js";

function resultText(result: ToolResult): string {
  const block = result.content[0];
  if (block.type !== "text") throw new Error("Expected text result");
  return block.text;
}

describe("MarkdownRenderTool", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders direct markdown to safe HTML with source metadata", async () => {
    const tool = new MarkdownRenderTool();

    const result = await tool.execute(
      { markdown: "# Title\n\nHello <script>alert(1)</script>" },
      {},
    );

    expect(result.success).toBe(true);
    const payload = JSON.parse(resultText(result));
    expect(payload).toEqual({
      html: expect.stringContaining("<h1>Title</h1>"),
      source: { type: "markdown" },
      safety: {
        rawHtml: "disabled",
        sanitized: false,
      },
    });
    expect(payload.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(payload.html).not.toContain("<script>");
  });

  it("rejects raw HTML rendering requests because no sanitizer is available", async () => {
    const tool = new MarkdownRenderTool();

    const result = await tool.execute(
      { markdown: "<b>unsafe</b>", allowRawHtml: true },
      {},
    );

    expect(result.success).toBe(false);
    expect(resultText(result)).toContain("Raw HTML rendering is unsupported");
  });

  it("renders markdown fetched from a browser-accessible URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "## From file",
    });
    vi.stubGlobal("fetch", fetchMock);

    const tool = new MarkdownRenderTool();
    const result = await tool.execute({ filePath: "file:///tmp/doc.md" }, {});

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("file:///tmp/doc.md");
    const payload = JSON.parse(resultText(result));
    expect(payload.html).toContain("<h2>From file</h2>");
    expect(payload.source).toEqual({
      type: "filePath",
      value: "file:///tmp/doc.md",
    });
  });

  it("renders markdown fetched from a url source with safe defaults", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "[Example](https://example.com) <img src=x onerror=alert(1)>",
    });
    vi.stubGlobal("fetch", fetchMock);

    const tool = new MarkdownRenderTool();
    const result = await tool.execute({ url: "https://example.com/doc.md" }, {});

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/doc.md");
    const payload = JSON.parse(resultText(result));
    expect(payload.source).toEqual({
      type: "url",
      value: "https://example.com/doc.md",
    });
    expect(payload.safety).toEqual({
      rawHtml: "disabled",
      sanitized: false,
    });
    expect(payload.html).toContain('<a href="https://example.com">Example</a>');
    expect(payload.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(payload.html).not.toContain("<img");
  });

  it("returns actionable errors when url fetch returns a non-OK status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "not found",
      }),
    );

    const tool = new MarkdownRenderTool();
    const result = await tool.execute({ url: "https://example.com/missing.md" }, {});

    expect(result.success).toBe(false);
    expect(resultText(result)).toContain("Unable to read markdown from url");
    expect(resultText(result)).toContain("https://example.com/missing.md");
    expect(resultText(result)).toContain("404 Not Found");
    expect(resultText(result)).toContain("pass markdown text directly");
  });

  it("returns actionable errors when file content is inaccessible", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const tool = new MarkdownRenderTool();
    const result = await tool.execute({ filePath: "/tmp/doc.md" }, {});

    expect(result.success).toBe(false);
    expect(resultText(result)).toContain("Unable to read markdown from filePath");
    expect(resultText(result)).toContain("browser-accessible URL");
    expect(resultText(result)).toContain("side panel");
  });

  it("requires exactly one markdown source", async () => {
    const tool = new MarkdownRenderTool();

    const missing = await tool.execute({}, {});
    const conflicting = await tool.execute(
      { markdown: "# A", url: "https://example.com/a.md" },
      {},
    );

    expect(missing.success).toBe(false);
    expect(resultText(missing)).toContain("Provide exactly one markdown source");
    expect(conflicting.success).toBe(false);
    expect(resultText(conflicting)).toContain("Provide exactly one markdown source");
  });

  it("registers the markdown_render handler", () => {
    Object.assign(globalThis, {
      chrome: {
        tabs: {
          onRemoved: { addListener: vi.fn() },
          onUpdated: { addListener: vi.fn() },
        },
        webNavigation: {
          onCommitted: { addListener: vi.fn() },
        },
      },
    });
    const router = new MessageRouter();

    registerTools(router);

    expect(router.getRegisteredTools()).toContain(TOOL_NAMES.MARKDOWN_RENDER);
  });
});
