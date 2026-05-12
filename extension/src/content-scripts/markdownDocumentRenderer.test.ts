import { describe, expect, it } from "vitest";
import {
  createMarkdownDocumentModel,
  shouldRenderMarkdownDocument,
} from "./markdownDocumentRenderer.js";

describe("markdown document renderer", () => {
  it("recognizes markdown documents opened directly in a Chrome tab", () => {
    expect(shouldRenderMarkdownDocument("file:///Users/me/notes.md", "text/plain")).toBe(true);
    expect(shouldRenderMarkdownDocument("https://example.com/spec.markdown", "text/plain")).toBe(true);
    expect(shouldRenderMarkdownDocument("https://example.com/readme.mdx?raw=1", "text/markdown")).toBe(true);
    expect(shouldRenderMarkdownDocument("https://github.com/org/repo/blob/main/README.md", "text/html")).toBe(false);
    expect(shouldRenderMarkdownDocument("https://example.com/data.json", "application/json")).toBe(false);
  });

  it("creates a safe rendered markdown document model", () => {
    const model = createMarkdownDocumentModel(
      "file:///Users/me/project/README.md",
      "# Title\n\nHello <script>alert(1)</script>",
    );

    expect(model.title).toBe("README.md");
    expect(model.source).toContain("# Title");
    expect(model.html).toContain("<h1>Title</h1>");
    expect(model.html).not.toContain("<script>");
    expect(model.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
