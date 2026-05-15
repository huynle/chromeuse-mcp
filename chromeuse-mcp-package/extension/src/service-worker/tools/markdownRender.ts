import type {
  ToolContext,
  ToolHandler,
  ToolResult,
} from "../../types/messages.js";
import MarkdownIt from "markdown-it";

const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});

type MarkdownSource =
  | { type: "markdown"; value: string }
  | { type: "url"; value: string }
  | { type: "filePath"; value: string };

function textResult(success: boolean, text: string): ToolResult {
  return {
    success,
    content: [{ type: "text", text }],
  };
}

function getStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getMarkdownSource(args: Record<string, unknown>): MarkdownSource | string {
  const sources: MarkdownSource[] = [];
  const markdown = getStringArg(args, "markdown");
  const url = getStringArg(args, "url");
  const filePath = getStringArg(args, "filePath");

  if (markdown !== undefined) sources.push({ type: "markdown", value: markdown });
  if (url !== undefined) sources.push({ type: "url", value: url });
  if (filePath !== undefined) sources.push({ type: "filePath", value: filePath });

  if (sources.length !== 1) {
    return "Provide exactly one markdown source: markdown, url, or filePath.";
  }

  return sources[0];
}

async function readMarkdownSource(source: MarkdownSource): Promise<string> {
  if (source.type === "markdown") {
    return source.value;
  }

  try {
    const response = await fetch(source.value);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`.trim());
    }
    return await response.text();
  } catch (error) {
    const sourceLabel = source.type === "filePath" ? "filePath" : "url";
    throw new Error(
      `Unable to read markdown from ${sourceLabel} "${source.value}". ` +
        `The extension can only fetch browser-accessible URL/file URL content or files granted through the side panel workspace. ` +
        `Select or reselect the workspace in the side panel, enable browser file access where required, or pass markdown text directly. ` +
        `Fetch error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export class MarkdownRenderTool implements ToolHandler {
  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    if (args.allowRawHtml === true) {
      return textResult(
        false,
        "Raw HTML rendering is unsupported for safety because no sanitizer is available. Omit allowRawHtml or pass false to render with raw HTML disabled.",
      );
    }

    const source = getMarkdownSource(args);
    if (typeof source === "string") {
      return textResult(false, source);
    }

    try {
      const markdown = await readMarkdownSource(source);
      const html = markdownRenderer.render(markdown);
      return textResult(
        true,
        JSON.stringify({
          html,
          source:
            source.type === "markdown"
              ? { type: "markdown" }
              : { type: source.type, value: source.value },
          safety: {
            rawHtml: "disabled",
            sanitized: false,
          },
        }),
      );
    } catch (error) {
      return textResult(
        false,
        error instanceof Error ? error.message : `markdown_render failed: ${String(error)}`,
      );
    }
  }
}
