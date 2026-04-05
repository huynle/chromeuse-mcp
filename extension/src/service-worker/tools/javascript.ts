/**
 * javascript_tool — executes JavaScript code in a browser tab via CDP Runtime.evaluate.
 *
 * Args:
 *   tabId (number, required): The tab to execute code in.
 *   code (string, required): JavaScript expression or code to evaluate.
 *     The result of the last expression is returned (do NOT use 'return' statements).
 *   awaitPromise (boolean, optional): Whether to await the result if it's a Promise. Defaults to true.
 *   timeout (number, optional): Evaluation timeout in milliseconds. Defaults to 30000.
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";
import { cdpManager } from "../cdp.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default evaluation timeout in milliseconds */
const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** CDP Runtime.evaluate response shape */
interface EvaluateResult {
  result: {
    type: string;
    subtype?: string;
    value?: unknown;
    description?: string;
    className?: string;
    unserializableValue?: string;
  };
  exceptionDetails?: {
    text: string;
    exception?: {
      description?: string;
      value?: unknown;
    };
    lineNumber?: number;
    columnNumber?: number;
  };
}

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

export class JavaScriptTool implements ToolHandler {
  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    try {
      // --- Validate args ---
      const tabId = typeof args.tabId === "number" ? args.tabId : undefined;
      if (tabId === undefined) {
        return {
          success: false,
          content: [
            { type: "text", text: "Missing required argument: tabId (number)" },
          ],
        };
      }

      const code = typeof args.code === "string" ? args.code : undefined;
      if (!code) {
        return {
          success: false,
          content: [
            { type: "text", text: "Missing required argument: code (string)" },
          ],
        };
      }

      // Optional args
      const awaitPromise =
        typeof args.awaitPromise === "boolean" ? args.awaitPromise : true;
      const timeout =
        typeof args.timeout === "number" ? args.timeout : DEFAULT_TIMEOUT_MS;

      // --- Ensure CDP is attached ---
      if (!cdpManager.isAttached(tabId)) {
        await cdpManager.attach(tabId);
      }

      // --- Execute via Runtime.evaluate ---
      const evalResult = await cdpManager.sendCommand<EvaluateResult>(
        tabId,
        "Runtime.evaluate",
        {
          expression: code,
          returnByValue: true,
          awaitPromise,
          timeout,
          generatePreview: true,
          includeCommandLineAPI: true,
        },
      );

      // --- Check for exceptions ---
      if (evalResult.exceptionDetails) {
        const exc = evalResult.exceptionDetails;
        const errorMessage =
          exc.exception?.description ?? exc.text ?? "Unknown evaluation error";

        const location =
          exc.lineNumber !== undefined
            ? ` (line ${exc.lineNumber + 1}${exc.columnNumber !== undefined ? `, col ${exc.columnNumber + 1}` : ""})`
            : "";

        return {
          success: false,
          content: [
            {
              type: "text",
              text: `JavaScript error${location}: ${errorMessage}`,
            },
          ],
        };
      }

      // --- Format the result ---
      const result = evalResult.result;
      let resultText: string;

      if (result.type === "undefined") {
        resultText = "undefined";
      } else if (result.unserializableValue) {
        // Handles Infinity, -Infinity, NaN, -0, bigints
        resultText = result.unserializableValue;
      } else if (result.value !== undefined) {
        // returnByValue gives us the actual JS value
        resultText =
          typeof result.value === "string"
            ? result.value
            : JSON.stringify(result.value, null, 2);
      } else if (result.description) {
        // Fallback for objects that couldn't be serialized
        resultText = result.description;
      } else {
        resultText = `[${result.type}${result.subtype ? `:${result.subtype}` : ""}]`;
      }

      return {
        success: true,
        content: [{ type: "text", text: resultText }],
      };
    } catch (error) {
      return {
        success: false,
        content: [
          {
            type: "text",
            text: `Failed to evaluate JavaScript: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }
}
