/**
 * extract_structured tool - extract a table or a repeated list into structured
 * JSON. Optionally save the result to the selected workspace.
 *
 * Args:
 *   tabId (number, required)
 *   selector (string, required): a <table>, or a container/repeated element set.
 *   as (string, optional): "table" | "list" | "auto" (default auto).
 *   outputPath (string, optional): workspace-relative path to save JSON.
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";
import { cdpManager } from "../cdp.js";
import { WorkspaceWriteTool } from "./workspaceWrite.js";

function fail(text: string): ToolResult {
  return { success: false, content: [{ type: "text", text }] };
}

function extractExpression(selector: string, as: string): string {
  const sel = JSON.stringify(selector);
  const mode = JSON.stringify(as);
  return `(() => {
    const sel = ${sel};
    const as = ${mode};
    const text = (el) => (el ? (el.innerText || el.textContent || '').trim() : '');
    const parseTable = (table) => {
      const headerCells = Array.from(table.querySelectorAll('thead th, thead td'));
      const headers = headerCells.map(text);
      const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
      const rows = (bodyRows.length ? bodyRows : Array.from(table.querySelectorAll('tr')))
        .map((tr) => Array.from(tr.querySelectorAll('th, td')).map(text))
        .filter((cells) => cells.length > 0);
      if (headers.length) {
        return { kind: 'table', headers, rows: rows.map((cells) => {
          const obj = {};
          headers.forEach((h, i) => { obj[h || ('col' + i)] = cells[i] ?? ''; });
          return obj;
        }) };
      }
      return { kind: 'table', rows };
    };
    const first = document.querySelector(sel);
    if (!first) return { error: 'no element matched selector' };
    if ((as === 'table' || as === 'auto') && first.tagName === 'TABLE') {
      return parseTable(first);
    }
    const nodes = Array.from(document.querySelectorAll(sel));
    return { kind: 'list', count: nodes.length, items: nodes.map(text) };
  })()`;
}

export class ExtractStructuredTool implements ToolHandler {
  async execute(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const tabId = typeof args.tabId === "number" ? args.tabId : undefined;
    if (tabId === undefined) return fail("Missing required argument: tabId (number)");
    const selector = typeof args.selector === "string" ? args.selector : undefined;
    if (!selector) return fail("Missing required argument: selector (string)");
    const as = args.as === "table" || args.as === "list" ? args.as : "auto";
    const outputPath = typeof args.outputPath === "string" ? args.outputPath : undefined;
    if (outputPath && (outputPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(outputPath))) {
      return fail("outputPath must be workspace-relative.");
    }

    try {
      if (!cdpManager.isAttached(tabId)) await cdpManager.attach(tabId);
      const res = await cdpManager.sendCommand<{ result?: { value?: Record<string, unknown> } }>(
        tabId,
        "Runtime.evaluate",
        { expression: extractExpression(selector, as), returnByValue: true },
      );
      const data = res?.result?.value;
      if (!data || data.error) {
        return fail(`extract_structured: ${(data?.error as string) ?? "no data"} (selector: ${selector})`);
      }

      let saved: string | undefined;
      if (outputPath) {
        const json = JSON.stringify(data, null, 2);
        const dataUrl = `data:application/json;base64,${base64Encode(json)}`;
        const writer = new WorkspaceWriteTool();
        const result = await writer.execute({ path: outputPath, dataUrl, createDirectories: true }, context);
        if (result.success) saved = outputPath;
      }

      return {
        success: true,
        content: [{ type: "text", text: JSON.stringify({ selector, ...(saved ? { savedTo: saved } : {}), data }, null, 2) }],
      };
    } catch (error) {
      return fail(`extract_structured failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function base64Encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
