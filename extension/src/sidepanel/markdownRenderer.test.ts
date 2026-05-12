import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdownRenderer.js";

describe("renderMarkdown", () => {
  it("renders basic markdown features", () => {
    const html = renderMarkdown(`# Title

See [docs](https://example.com).

- first
- second

\`\`\`ts
const value = 1;
\`\`\`

| Name | Value |
| --- | --- |
| Alpha | 1 |`);

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain('<a href="https://example.com">docs</a>');
    expect(html).toContain("<li>first</li>");
    expect(html).toContain('<code class="language-ts">const value = 1;');
    expect(html).toContain("<table>");
    expect(html).toContain("<td>Alpha</td>");
  });

  it("does not render raw HTML", () => {
    const html = renderMarkdown('Hello <script>alert("x")</script><img src=x onerror=alert(1)>');

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
  });

  it("does not create links for unsafe protocols", () => {
    const html = renderMarkdown("[bad](javascript:alert(1))");

    expect(html).not.toContain("href");
    expect(html).toContain("bad");
  });
});
