import { describe, expect, it } from "vitest";
import {
  isMarkdownWorkspaceFile,
  renderMarkdownPreview,
  renderWorkspaceMarkdownFile,
} from "./markdownPreview.js";

describe("markdown preview", () => {
  it("detects workspace markdown file extensions", () => {
    expect(isMarkdownWorkspaceFile("notes/readme.md")).toBe(true);
    expect(isMarkdownWorkspaceFile("docs/spec.mdx")).toBe(true);
    expect(isMarkdownWorkspaceFile("docs/spec.markdown")).toBe(true);
    expect(isMarkdownWorkspaceFile("docs/spec.txt")).toBe(false);
  });

  it("renders safe minimal markdown and escapes raw HTML", () => {
    const html = renderMarkdownPreview(`# Title\n\nHello **world** and [docs](https://example.com).\n\n- one\n- two\n\n\`code\`\n\n<script>alert(1)</script>`);

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("Hello <strong>world</strong>");
    expect(html).toContain('<a href="https://example.com" rel="noreferrer noopener" target="_blank">docs</a>');
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<code>code</code>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");

    const unsafeLink = renderMarkdownPreview("[bad](javascript:alert(1))");
    expect(unsafeLink).not.toContain("href=");
    expect(unsafeLink).toContain("bad");
  });

  it("renders clear failures for unsupported, unreadable, and large files", () => {
    expect(renderWorkspaceMarkdownFile({ path: "notes.txt", content: "# no" })).toEqual({
      ok: false,
      message: "Markdown preview supports .md, .mdx, and .markdown files only.",
    });

    expect(renderWorkspaceMarkdownFile({ path: "notes.md", error: "permission denied" })).toEqual({
      ok: false,
      message: "Unable to read notes.md: permission denied",
    });

    expect(renderWorkspaceMarkdownFile({ path: "big.md", content: "x".repeat(500_001) })).toEqual({
      ok: false,
      message: "big.md is too large to preview safely. Open source instead.",
    });
  });
});
