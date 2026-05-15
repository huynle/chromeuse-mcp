import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});

const defaultFence = markdown.renderer.rules.fence;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

markdown.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const language = token.info.trim().split(/\s+/, 1)[0]?.toLowerCase();
  if (language === "mermaid") {
    return `<div class="mermaid">${escapeHtml(token.content.trim())}</div>\n`;
  }
  return defaultFence ? defaultFence(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
};

export function renderMarkdown(source: string): string {
  return markdown.render(source);
}
