/**
 * screenshot_element tool - capture a single element by CSS selector, instead
 * of the whole viewport. Ideal for grabbing one chart/component.
 *
 * Args:
 *   tabId (number, required)
 *   selector (string, required)
 *   padding (number, optional): extra pixels around the element (default 0)
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";
import { cdpManager } from "../cdp.js";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectExpression(selector: string): string {
  const sel = JSON.stringify(selector);
  return `(() => {
    const el = document.querySelector(${sel});
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
  })()`;
}

export class ScreenshotElementTool implements ToolHandler {
  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    const tabId = typeof args.tabId === "number" ? args.tabId : undefined;
    if (tabId === undefined) {
      return { success: false, content: [{ type: "text", text: "Missing required argument: tabId (number)" }] };
    }
    const selector = typeof args.selector === "string" ? args.selector : undefined;
    if (!selector) {
      return { success: false, content: [{ type: "text", text: "Missing required argument: selector (string)" }] };
    }
    const padding = typeof args.padding === "number" ? args.padding : 0;

    try {
      if (!cdpManager.isAttached(tabId)) await cdpManager.attach(tabId);

      const rectRes = await cdpManager.sendCommand<{ result?: { value?: Rect | null } }>(
        tabId,
        "Runtime.evaluate",
        { expression: rectExpression(selector), returnByValue: true },
      );
      const rect = rectRes?.result?.value;
      if (!rect) {
        return { success: false, content: [{ type: "text", text: `No element matched selector: ${selector}` }] };
      }
      if (rect.width <= 0 || rect.height <= 0) {
        return { success: false, content: [{ type: "text", text: `Element matched but has zero size: ${selector}` }] };
      }

      const clip = {
        x: Math.max(0, rect.x - padding),
        y: Math.max(0, rect.y - padding),
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
        scale: 1,
      };

      const shot = await cdpManager.sendCommand<{ data?: string }>(
        tabId,
        "Page.captureScreenshot",
        { format: "png", clip, captureBeyondViewport: true },
      );
      if (!shot?.data) {
        return { success: false, content: [{ type: "text", text: "Screenshot capture returned no data" }] };
      }

      return {
        success: true,
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: shot.data } },
          { type: "text", text: JSON.stringify({ selector, clip: { width: Math.round(clip.width), height: Math.round(clip.height) } }) },
        ],
      };
    } catch (error) {
      return {
        success: false,
        content: [{ type: "text", text: `screenshot_element failed: ${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
}
