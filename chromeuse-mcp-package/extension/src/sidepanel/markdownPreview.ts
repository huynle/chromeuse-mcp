export interface WorkspaceMarkdownFile {
  readonly path: string;
  readonly content?: string;
  readonly error?: string;
}

export type MarkdownPreviewResult =
  | { readonly ok: true; readonly html: string; readonly source: string }
  | { readonly ok: false; readonly message: string };

const MAX_PREVIEW_BYTES = 500_000;
const MARKDOWN_FILE_RE = /\.(?:md|mdx|markdown)$/i;
const SAFE_URL_RE = /^(?:https?:|mailto:|#|\/)/i;

export function isMarkdownWorkspaceFile(path: string): boolean {
  return MARKDOWN_FILE_RE.test(path);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInlineMarkdown(source: string): string {
  let html = escapeHtml(source);

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) => {
    if (!SAFE_URL_RE.test(url)) return label;
    return `<a href="${url}" rel="noreferrer noopener" target="_blank">${label}</a>`;
  });

  return html;
}

export function renderMarkdownPreview(source: string): string {
  const blocks = source.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const html: string[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const lines = trimmed.split("\n");
    if (lines.every((line) => /^[-*]\s+/.test(line))) {
      html.push(
        `<ul>${lines
          .map((line) => `<li>${renderInlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>`)
          .join("")}</ul>`,
      );
      continue;
    }

    html.push(`<p>${renderInlineMarkdown(trimmed).replace(/\n/g, "<br>")}</p>`);
  }

  return html.join("\n");
}

export function renderWorkspaceMarkdownFile(file: WorkspaceMarkdownFile): MarkdownPreviewResult {
  if (!isMarkdownWorkspaceFile(file.path)) {
    return {
      ok: false,
      message: "Markdown preview supports .md, .mdx, and .markdown files only.",
    };
  }

  if (file.error) {
    return { ok: false, message: `Unable to read ${file.path}: ${file.error}` };
  }

  const source = file.content ?? "";
  if (new TextEncoder().encode(source).byteLength > MAX_PREVIEW_BYTES) {
    return {
      ok: false,
      message: `${file.path} is too large to preview safely. Open source instead.`,
    };
  }

  return { ok: true, html: renderMarkdownPreview(source), source };
}
