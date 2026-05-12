import { describe, expect, it } from "vitest";
import {
  createMarkdownDocumentModel,
  extractMarkdownHeadings,
  getParentDirectoryUrl,
  parseDirectoryListing,
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

  it("extracts headings for a TOC side panel", () => {
    expect(extractMarkdownHeadings("# Title\n\n## Goal\n\n### Notes\n\n#### Hidden")).toEqual([
      { level: 1, text: "Title", id: "title" },
      { level: 2, text: "Goal", id: "goal" },
      { level: 3, text: "Notes", id: "notes" },
    ]);
  });

  it("finds the parent directory for local markdown documents", () => {
    expect(getParentDirectoryUrl("file:///Users/me/project/docs/README.md")).toBe("file:///Users/me/project/docs/");
    expect(getParentDirectoryUrl("https://example.com/docs/README.md")).toBeNull();
  });

  it("parses Chrome file directory listings into markdown files and folders", () => {
    const listing = `
      <script>
        addRow("guide.md", "guide.md", 0, "1 KB", "today");
        addRow("notes.txt", "notes.txt", 0, "1 KB", "today");
        addRow("specs", "specs/", 1, "", "today");
      </script>
    `;

    expect(parseDirectoryListing(listing, "file:///Users/me/project/docs/")).toEqual([
      { name: "specs", url: "file:///Users/me/project/docs/specs/", type: "directory" },
      { name: "guide.md", url: "file:///Users/me/project/docs/guide.md", type: "file" },
    ]);
  });
});
