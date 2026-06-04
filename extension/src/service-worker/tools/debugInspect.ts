/**
 * debug_inspect tool - set a one-shot breakpoint, capture the program state
 * when it is hit, then resume.
 *
 * Sets a breakpoint by URL regex + line via the CDP Debugger domain, waits for
 * it to pause (up to a timeout), captures the top call frame and its local
 * variables (and optionally evaluates an expression in that frame), then
 * resumes execution and removes the breakpoint.
 *
 * Args:
 *   tabId (number, required)
 *   urlRegex (string, required): matches the script URL (e.g. "app\\.js").
 *   lineNumber (number, required): 0-based line.
 *   columnNumber (number, optional)
 *   condition (string, optional): only break when this expression is truthy.
 *   expression (string, optional): evaluate in the paused frame and return it.
 *   timeoutMs (number, optional): default 15000.
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";
import { cdpManager } from "../cdp.js";

interface ScopeRef {
  type: string;
  object: { objectId?: string };
}
interface CallFrame {
  callFrameId: string;
  functionName: string;
  location: { scriptId: string; lineNumber: number; columnNumber?: number };
  url?: string;
  scopeChain: ScopeRef[];
}
interface PausedParams {
  callFrames: CallFrame[];
  reason: string;
  hitBreakpoints?: string[];
}
interface PropertyDescriptor {
  name: string;
  value?: { type: string; value?: unknown; description?: string };
}

function fail(text: string): ToolResult {
  return { success: false, content: [{ type: "text", text }] };
}

export class DebugInspectTool implements ToolHandler {
  /** Per-tab resolver for the next Debugger.paused event. */
  private waiters = new Map<number, (params: PausedParams) => void>();

  constructor() {
    cdpManager.addEventListener((source, method, params) => {
      if (source.tabId === undefined || method !== "Debugger.paused") return;
      const waiter = this.waiters.get(source.tabId);
      if (waiter) {
        this.waiters.delete(source.tabId);
        waiter(params as unknown as PausedParams);
      }
    });

    chrome.tabs.onRemoved.addListener((tabId: number) => this.waiters.delete(tabId));
  }

  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    const tabId = typeof args.tabId === "number" ? args.tabId : undefined;
    if (tabId === undefined) return fail("Missing required argument: tabId (number)");
    const urlRegex = typeof args.urlRegex === "string" ? args.urlRegex : undefined;
    if (!urlRegex) return fail("Missing required argument: urlRegex (string)");
    const lineNumber = typeof args.lineNumber === "number" ? args.lineNumber : undefined;
    if (lineNumber === undefined) return fail("Missing required argument: lineNumber (number)");

    const columnNumber = typeof args.columnNumber === "number" ? args.columnNumber : undefined;
    const condition = typeof args.condition === "string" ? args.condition : undefined;
    const expression = typeof args.expression === "string" ? args.expression : undefined;
    const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : 15000;

    let breakpointId: string | undefined;
    try {
      if (!cdpManager.isAttached(tabId)) await cdpManager.attach(tabId);
      await cdpManager.enableDomain(tabId, "Debugger");

      const bp = await cdpManager.sendCommand<{ breakpointId?: string }>(
        tabId,
        "Debugger.setBreakpointByUrl",
        { urlRegex, lineNumber, ...(columnNumber !== undefined ? { columnNumber } : {}), ...(condition ? { condition } : {}) },
      );
      breakpointId = bp?.breakpointId;
      if (!breakpointId) return fail("Failed to set breakpoint (no breakpointId returned)");

      const paused = await this.waitForPause(tabId, timeoutMs);
      if (!paused) {
        return fail(`Breakpoint was not hit within ${timeoutMs}ms (it remains set until a matching line runs; removed now).`);
      }

      const frame = paused.callFrames[0];
      const locals = frame ? await this.readLocals(tabId, frame) : [];
      let evaluated: unknown;
      if (expression && frame) {
        const ev = await cdpManager.sendCommand<{ result?: { value?: unknown; description?: string } }>(
          tabId,
          "Debugger.evaluateOnCallFrame",
          { callFrameId: frame.callFrameId, expression, returnByValue: true },
        );
        evaluated = ev?.result?.value ?? ev?.result?.description;
      }

      return {
        success: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                tabId,
                reason: paused.reason,
                frame: frame
                  ? { functionName: frame.functionName || "(anonymous)", line: frame.location.lineNumber, column: frame.location.columnNumber }
                  : null,
                locals,
                ...(expression ? { evaluated } : {}),
                callStackDepth: paused.callFrames.length,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return fail(`debug_inspect failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      // Always resume and remove the breakpoint so the page is never left frozen.
      try {
        await cdpManager.sendCommand(tabId, "Debugger.resume", {});
      } catch {
        /* not paused */
      }
      if (breakpointId) {
        try {
          await cdpManager.sendCommand(tabId, "Debugger.removeBreakpoint", { breakpointId });
        } catch {
          /* already gone */
        }
      }
      this.waiters.delete(tabId);
    }
  }

  private waitForPause(tabId: number, timeoutMs: number): Promise<PausedParams | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(tabId);
        resolve(null);
      }, timeoutMs);
      this.waiters.set(tabId, (params) => {
        clearTimeout(timer);
        resolve(params);
      });
    });
  }

  private async readLocals(tabId: number, frame: CallFrame): Promise<Array<{ name: string; value: unknown }>> {
    const local = frame.scopeChain.find((s) => s.type === "local");
    if (!local?.object.objectId) return [];
    try {
      const res = await cdpManager.sendCommand<{ result?: PropertyDescriptor[] }>(
        tabId,
        "Runtime.getProperties",
        { objectId: local.object.objectId, ownProperties: true },
      );
      return (res?.result ?? []).slice(0, 30).map((p) => ({
        name: p.name,
        value: p.value?.value ?? p.value?.description ?? p.value?.type ?? null,
      }));
    } catch {
      return [];
    }
  }
}
