/**
 * clipboard tool - read from or write to the system clipboard via the
 * offscreen document.
 *
 * Actions:
 *   write  Copy `text` to the clipboard (textarea + execCommand in offscreen).
 *   read   Read clipboard text (navigator.clipboard in offscreen).
 *
 * Note: clipboard *read* is restricted by the browser and can fail when the
 * offscreen document is not focused; the tool returns a clear error in that
 * case. Requires the "clipboardRead"/"clipboardWrite" and "offscreen"
 * permissions.
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";
import { ensureOffscreenDocument } from "../offscreenClient.js";

const CLIPBOARD_REASON = "CLIPBOARD" as chrome.offscreen.Reason;

function ok(payload: Record<string, unknown>): ToolResult {
  return { success: true, content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
function fail(text: string): ToolResult {
  return { success: false, content: [{ type: "text", text }] };
}

interface ClipboardResponse {
  success: boolean;
  text?: string;
  error?: string;
}

export class ClipboardTool implements ToolHandler {
  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    const action = args.action;
    if (action !== "read" && action !== "write") {
      return fail('Invalid "action": expected "read" or "write"');
    }
    if (action === "write" && typeof args.text !== "string") {
      return fail('"write" requires a "text" string');
    }

    try {
      await ensureOffscreenDocument(CLIPBOARD_REASON, "Read/write the system clipboard");

      const response = (await chrome.runtime.sendMessage(
        action === "write"
          ? { action: "clipboard-write", text: args.text }
          : { action: "clipboard-read" },
      )) as ClipboardResponse | undefined;

      if (!response) return fail("No response from the offscreen clipboard handler.");
      if (!response.success) {
        return fail(`clipboard ${action} failed: ${response.error ?? "unknown error"}`);
      }

      return action === "write"
        ? ok({ action: "write", written: true })
        : ok({ action: "read", text: response.text ?? "" });
    } catch (error) {
      return fail(`clipboard failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
