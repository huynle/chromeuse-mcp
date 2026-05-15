/**
 * file_upload tool — sets files on a file input element via CDP DOM.setFileInputFiles.
 *
 * Uses CDP to locate a file input element by CSS selector and set its files,
 * simulating a file upload without requiring actual user interaction with the
 * file picker.
 *
 * Args:
 *   tabId    (number, required):   The tab containing the file input.
 *   selector (string, required):   CSS selector for the file input element.
 *   files    (string[], required): Array of absolute file paths to upload.
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";
import { cdpManager } from "../cdp.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** CDP DOM.getDocument response */
interface GetDocumentResult {
  root: {
    nodeId: number;
  };
}

/** CDP DOM.querySelector response */
interface QuerySelectorResult {
  nodeId: number;
}

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

export class FileUploadTool implements ToolHandler {
  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    try {
      // --- Validate tabId ---
      const tabId = typeof args.tabId === "number" ? args.tabId : undefined;
      if (tabId === undefined) {
        return {
          success: false,
          content: [
            { type: "text", text: "Missing required argument: tabId (number)" },
          ],
        };
      }

      // --- Validate selector ---
      const selector =
        typeof args.selector === "string" ? args.selector : undefined;
      if (!selector) {
        return {
          success: false,
          content: [
            {
              type: "text",
              text: "Missing required argument: selector (string)",
            },
          ],
        };
      }

      // --- Validate files ---
      const files = Array.isArray(args.files) ? args.files : undefined;
      if (!files || files.length === 0) {
        return {
          success: false,
          content: [
            {
              type: "text",
              text: "Missing required argument: files (non-empty string array)",
            },
          ],
        };
      }

      // Ensure all file paths are strings
      const filePaths = files.filter((f): f is string => typeof f === "string");
      if (filePaths.length !== files.length) {
        return {
          success: false,
          content: [
            {
              type: "text",
              text: "All entries in files array must be strings",
            },
          ],
        };
      }

      // --- Ensure CDP is attached ---
      if (!cdpManager.isAttached(tabId)) {
        await cdpManager.attach(tabId);
      }

      // --- Get the document root ---
      const doc = await cdpManager.sendCommand<GetDocumentResult>(
        tabId,
        "DOM.getDocument",
        { depth: 0 },
      );

      // --- Find the file input element ---
      const queryResult = await cdpManager.sendCommand<QuerySelectorResult>(
        tabId,
        "DOM.querySelector",
        {
          nodeId: doc.root.nodeId,
          selector,
        },
      );

      if (!queryResult.nodeId || queryResult.nodeId === 0) {
        return {
          success: false,
          content: [
            {
              type: "text",
              text: `No element found matching selector: "${selector}"`,
            },
          ],
        };
      }

      // --- Set the files on the input element ---
      await cdpManager.sendCommand(tabId, "DOM.setFileInputFiles", {
        nodeId: queryResult.nodeId,
        files: filePaths,
      });

      return {
        success: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                tabId,
                selector,
                filesSet: filePaths.length,
                files: filePaths,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        success: false,
        content: [
          {
            type: "text",
            text: `Failed to upload file: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
}
