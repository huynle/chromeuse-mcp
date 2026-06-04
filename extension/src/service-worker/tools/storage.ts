/**
 * storage tool - read/write a tab's localStorage or sessionStorage via CDP
 * Runtime.evaluate. Handy for inspecting app state, seeding fixtures, or
 * clearing state between automation runs.
 *
 * Actions:
 *   get     Return one key, or all entries when "key" is omitted.
 *   set     Set "key" to "value".
 *   remove  Remove "key".
 *   clear   Remove all entries.
 *
 * Args:
 *   tabId (number, required)
 *   action (string, required)
 *   area (string, optional): "local" (default) or "session"
 *   key (string), value (string)
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";
import { cdpManager } from "../cdp.js";

function ok(payload: Record<string, unknown>): ToolResult {
  return { success: true, content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
function fail(text: string): ToolResult {
  return { success: false, content: [{ type: "text", text }] };
}

export class StorageTool implements ToolHandler {
  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    const tabId = typeof args.tabId === "number" ? args.tabId : undefined;
    if (tabId === undefined) return fail("Missing required argument: tabId (number)");

    const action = args.action;
    if (action !== "get" && action !== "set" && action !== "remove" && action !== "clear") {
      return fail('Invalid "action": expected one of get, set, remove, clear');
    }

    const area = args.area === "session" ? "sessionStorage" : "localStorage";
    const key = typeof args.key === "string" ? args.key : undefined;
    const value = typeof args.value === "string" ? args.value : undefined;

    if ((action === "set" || action === "remove") && !key) {
      return fail(`"${action}" requires a "key"`);
    }
    if (action === "set" && value === undefined) {
      return fail('"set" requires a "value"');
    }

    const expression = buildExpression(area, action, key, value);

    try {
      if (!cdpManager.isAttached(tabId)) await cdpManager.attach(tabId);
      const res = await cdpManager.sendCommand<{ result?: { value?: unknown }; exceptionDetails?: unknown }>(
        tabId,
        "Runtime.evaluate",
        { expression, returnByValue: true },
      );
      if (res?.exceptionDetails) {
        return fail(`storage evaluation failed in page: ${JSON.stringify(res.exceptionDetails)}`);
      }
      return ok({ tabId, area: args.area === "session" ? "session" : "local", action, result: res?.result?.value ?? null });
    } catch (error) {
      return fail(`storage failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function buildExpression(
  area: string,
  action: string,
  key?: string,
  value?: string,
): string {
  switch (action) {
    case "get":
      return key
        ? `${area}.getItem(${JSON.stringify(key)})`
        : `Object.fromEntries(Object.entries(${area}))`;
    case "set":
      return `(${area}.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)}), true)`;
    case "remove":
      return `(${area}.removeItem(${JSON.stringify(key)}), true)`;
    case "clear":
      return `(${area}.clear(), true)`;
    default:
      return "null";
  }
}
