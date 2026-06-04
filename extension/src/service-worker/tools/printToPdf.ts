/**
 * print_to_pdf tool - render a tab to PDF via CDP Page.printToPDF and save it
 * to the selected workspace (when outputPath is given) or the Downloads folder.
 *
 * Args:
 *   tabId (number, required)
 *   outputPath (string, optional): workspace-relative path to save the PDF.
 *   filename (string, optional): used for the Downloads fallback (default page.pdf).
 *   landscape (boolean, optional)
 *   printBackground (boolean, optional): default true
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

export class PrintToPdfTool implements ToolHandler {
  async execute(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const tabId = typeof args.tabId === "number" ? args.tabId : undefined;
    if (tabId === undefined) return fail("Missing required argument: tabId (number)");

    const outputPath = typeof args.outputPath === "string" ? args.outputPath : undefined;
    if (outputPath && (outputPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(outputPath))) {
      return fail("outputPath must be workspace-relative (or omit it to save to Downloads).");
    }
    const filename = typeof args.filename === "string" ? args.filename : "page.pdf";
    const landscape = typeof args.landscape === "boolean" ? args.landscape : false;
    const printBackground = typeof args.printBackground === "boolean" ? args.printBackground : true;

    try {
      if (!cdpManager.isAttached(tabId)) await cdpManager.attach(tabId);

      const res = await cdpManager.sendCommand<{ data?: string }>(tabId, "Page.printToPDF", {
        landscape,
        printBackground,
        transferMode: "ReturnAsBase64",
      });
      if (!res?.data) return fail("Page.printToPDF returned no data");

      const dataUrl = `data:application/pdf;base64,${res.data}`;

      // Prefer silent workspace write when a path is provided.
      if (outputPath) {
        const writer = new WorkspaceWriteTool();
        const result = await writer.execute(
          { path: outputPath, dataUrl, createDirectories: true },
          context,
        );
        if (result.success) return result;
        // fall through to Downloads if workspace write failed
      }

      const downloadId = await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
      return {
        success: true,
        content: [{ type: "text", text: JSON.stringify({ method: "downloads-api", downloadId, filename }, null, 2) }],
      };
    } catch (error) {
      return fail(`print_to_pdf failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
