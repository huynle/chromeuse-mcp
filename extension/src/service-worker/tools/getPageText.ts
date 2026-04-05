/**
 * get_page_text tool - extract readable text content from a page.
 *
 * Uses chrome.scripting.executeScript to extract the visible innerText
 * of the page body, with whitespace normalization and truncation to a
 * reasonable size for LLM consumption.
 *
 * This is simpler and faster than read_page with format="text" because
 * it doesn't need to build the full accessibility tree. Use this when
 * you just need the text content of a page.
 *
 * Args:
 *   tabId (number, required): The tab to extract text from.
 *   maxLength (number, optional): Maximum characters to return.
 *     Default: 100,000. Absolute max: 500,000.
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";

/** Default maximum text length (~100KB) */
const DEFAULT_MAX_LENGTH = 100_000;

/** Absolute maximum to prevent memory issues */
const ABSOLUTE_MAX_LENGTH = 500_000;

export class GetPageTextTool implements ToolHandler {
  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    try {
      // Validate tabId
      const tabId = typeof args.tabId === "number" ? args.tabId : undefined;
      if (tabId === undefined) {
        return {
          success: false,
          content: [
            { type: "text", text: "Missing required argument: tabId (number)" },
          ],
        };
      }

      // Clamp maxLength between 1 and ABSOLUTE_MAX_LENGTH
      const maxLength = Math.min(
        typeof args.maxLength === "number" && args.maxLength > 0
          ? args.maxLength
          : DEFAULT_MAX_LENGTH,
        ABSOLUTE_MAX_LENGTH,
      );

      // Verify tab exists
      try {
        await chrome.tabs.get(tabId);
      } catch {
        return {
          success: false,
          content: [{ type: "text", text: `Tab ${tabId} not found` }],
        };
      }

      // Extract text via scripting API
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          if (!document.body) return { text: "", title: document.title || "" };

          // Get visible innerText (excludes script/style/hidden elements)
          let text = document.body.innerText || "";

          // Normalize whitespace: collapse multiple blank lines to one
          text = text.replace(/\n{3,}/g, "\n\n");

          // Collapse runs of spaces/tabs (but preserve newlines)
          text = text.replace(/[^\S\n]+/g, " ");

          // Trim leading/trailing whitespace per line
          text = text
            .split("\n")
            .map((line) => line.trim())
            .join("\n");

          // Remove leading/trailing blank lines
          text = text.trim();

          return {
            text,
            title: document.title || "",
            url: window.location.href,
          };
        },
      });

      const pageData = result?.result as {
        text: string;
        title: string;
        url?: string;
      } | null;

      if (!pageData) {
        return {
          success: false,
          content: [{ type: "text", text: "Failed to extract page text" }],
        };
      }

      let { text } = pageData;
      let truncated = false;
      const originalLength = text.length;

      if (text.length > maxLength) {
        text = text.slice(0, maxLength);
        truncated = true;

        // Try to truncate at a word boundary
        const lastSpace = text.lastIndexOf(" ", maxLength);
        const lastNewline = text.lastIndexOf("\n", maxLength);
        const breakPoint = Math.max(lastSpace, lastNewline);
        if (breakPoint > maxLength * 0.8) {
          text = text.slice(0, breakPoint);
        }
      }

      if (!text) {
        return {
          success: true,
          content: [{ type: "text", text: "(empty page)" }],
        };
      }

      // Build header with metadata
      const header = [
        pageData.title ? `Title: ${pageData.title}` : null,
        pageData.url ? `URL: ${pageData.url}` : null,
        `Characters: ${truncated ? `${text.length} of ${originalLength} (truncated)` : String(text.length)}`,
      ]
        .filter(Boolean)
        .join("\n");

      return {
        success: true,
        content: [
          {
            type: "text",
            text: `${header}\n\n---\n\n${text}`,
          },
        ],
      };
    } catch (error) {
      return {
        success: false,
        content: [
          {
            type: "text",
            text: `get_page_text failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
}
