import { renderMarkdown } from "../sidepanel/markdownRenderer.js";

export interface MarkdownDocumentModel {
  readonly title: string;
  readonly source: string;
  readonly html: string;
}

const MARKDOWN_DOCUMENT_RE = /\.(?:md|mdx|markdown)(?:[?#].*)?$/i;
const MARKDOWN_CONTENT_TYPES = new Set([
  "text/markdown",
  "text/x-markdown",
  "text/mdx",
]);

const PLAIN_DOCUMENT_CONTENT_TYPES = new Set([
  "",
  "text/plain",
  "application/octet-stream",
]);

export function shouldRenderMarkdownDocument(url: string, contentType: string): boolean {
  const normalizedContentType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (MARKDOWN_CONTENT_TYPES.has(normalizedContentType)) return true;
  return MARKDOWN_DOCUMENT_RE.test(url) && PLAIN_DOCUMENT_CONTENT_TYPES.has(normalizedContentType);
}

export function createMarkdownDocumentModel(url: string, source: string): MarkdownDocumentModel {
  return {
    title: titleFromUrl(url),
    source,
    html: renderMarkdown(source),
  };
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.split("/").filter(Boolean).at(-1);
    return lastSegment ? decodeURIComponent(lastSegment) : "Markdown Document";
  } catch {
    const lastSegment = url.split(/[?#]/, 1)[0].split("/").filter(Boolean).at(-1);
    return lastSegment ? decodeURIComponent(lastSegment) : "Markdown Document";
  }
}

function readDocumentSource(doc: Document): string {
  const pre = doc.body.querySelector("pre");
  return (pre?.textContent ?? doc.body.textContent ?? "").trimEnd();
}

function createStyle(doc: Document): HTMLStyleElement {
  const style = doc.createElement("style");
  style.textContent = `
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0f172a;
      color: #e2e8f0;
    }

    body.chromeuse-markdown-document {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at top left, rgba(59, 130, 246, 0.18), transparent 30rem),
        #0f172a;
    }

    .chromeuse-markdown-shell {
      box-sizing: border-box;
      width: min(920px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 40px 0 64px;
    }

    .chromeuse-markdown-title {
      margin: 0 0 20px;
      color: #f8fafc;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .chromeuse-markdown-content {
      padding: 32px;
      border: 1px solid rgba(148, 163, 184, 0.24);
      border-radius: 22px;
      background: rgba(15, 23, 42, 0.82);
      box-shadow: 0 24px 80px rgba(15, 23, 42, 0.42);
      line-height: 1.7;
    }

    .chromeuse-markdown-content h1,
    .chromeuse-markdown-content h2,
    .chromeuse-markdown-content h3 {
      color: #f8fafc;
      line-height: 1.2;
    }

    .chromeuse-markdown-content a { color: #93c5fd; }
    .chromeuse-markdown-content code {
      border-radius: 6px;
      background: rgba(148, 163, 184, 0.14);
      padding: 0.15em 0.35em;
    }
    .chromeuse-markdown-content pre {
      overflow: auto;
      border-radius: 12px;
      background: rgba(2, 6, 23, 0.74);
      padding: 16px;
    }
    .chromeuse-markdown-content pre code { background: transparent; padding: 0; }
    .chromeuse-markdown-content blockquote {
      margin-inline: 0;
      border-left: 3px solid #60a5fa;
      padding-left: 16px;
      color: #cbd5e1;
    }
    .chromeuse-markdown-content table {
      width: 100%;
      border-collapse: collapse;
    }
    .chromeuse-markdown-content th,
    .chromeuse-markdown-content td {
      border: 1px solid rgba(148, 163, 184, 0.28);
      padding: 8px 10px;
    }

    @media (prefers-color-scheme: light) {
      :root { background: #f8fafc; color: #1e293b; }
      body.chromeuse-markdown-document { background: #f8fafc; }
      .chromeuse-markdown-title,
      .chromeuse-markdown-content h1,
      .chromeuse-markdown-content h2,
      .chromeuse-markdown-content h3 { color: #0f172a; }
      .chromeuse-markdown-content {
        background: #ffffff;
        border-color: #e2e8f0;
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.12);
      }
      .chromeuse-markdown-content pre { background: #f1f5f9; }
      .chromeuse-markdown-content code { background: #e2e8f0; }
    }
  `;
  return style;
}

export function renderCurrentMarkdownDocument(doc: Document = document, url: string = location.href): boolean {
  if (!doc.body || doc.getElementById("chromeuse-markdown-shell")) return false;
  if (!shouldRenderMarkdownDocument(url, doc.contentType)) return false;

  const model = createMarkdownDocumentModel(url, readDocumentSource(doc));
  doc.title = model.title;
  doc.head.appendChild(createStyle(doc));

  const shell = doc.createElement("main");
  shell.id = "chromeuse-markdown-shell";
  shell.className = "chromeuse-markdown-shell";

  const title = doc.createElement("div");
  title.className = "chromeuse-markdown-title";
  title.textContent = model.title;

  const content = doc.createElement("article");
  content.className = "chromeuse-markdown-content";
  content.innerHTML = model.html;

  shell.append(title, content);
  doc.body.className = `${doc.body.className} chromeuse-markdown-document`.trim();
  doc.body.replaceChildren(shell);
  return true;
}

if (typeof document !== "undefined") {
  renderCurrentMarkdownDocument();
}
