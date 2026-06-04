/**
 * wait_for tool - block until a page condition holds, instead of snapshotting.
 *
 * Reliable multi-step automation needs synchronization: after a click, wait for
 * the next element/text/navigation rather than guessing a delay. This tool
 * supports several conditions:
 *
 *   - selector          CSS selector matches a *visible* element
 *   - selector_hidden   CSS selector is absent or not visible
 *   - text              page body contains the given text
 *   - network_idle      no in-flight network requests for `idleMs`
 *   - console           a console message matches `pattern` (regex)
 *
 * Args:
 *   tabId (number, required)
 *   for (string, required): one of the conditions above
 *   selector (string): required for selector / selector_hidden
 *   text (string): required for text
 *   pattern (string): required for console (JS regex source)
 *   timeoutMs (number, optional): overall timeout, default 10000
 *   idleMs (number, optional): idle window for network_idle, default 500
 *   pollMs (number, optional): poll interval, default 200
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";
import { cdpManager } from "../cdp.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_IDLE_MS = 500;
const DEFAULT_POLL_MS = 200;

type WaitCondition =
  | "selector"
  | "selector_hidden"
  | "text"
  | "network_idle"
  | "console";

const CONDITIONS: readonly WaitCondition[] = [
  "selector",
  "selector_hidden",
  "text",
  "network_idle",
  "console",
];

interface ConsoleApiParams {
  args?: Array<{ value?: unknown; description?: string }>;
}

function ok(payload: Record<string, unknown>): ToolResult {
  return { success: true, content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function fail(text: string): ToolResult {
  return { success: false, content: [{ type: "text", text }] };
}

export class WaitForTool implements ToolHandler {
  /** Per-tab count of in-flight network requests. */
  private inflight = new Map<number, number>();
  /** Per-tab timestamp (ms) of the most recent network activity. */
  private lastActivity = new Map<number, number>();
  /** Console messages captured during an active console wait, per tab. */
  private consoleListeners = new Map<number, (text: string) => void>();

  constructor() {
    cdpManager.addEventListener((source, method, params) => {
      const tabId = source.tabId;
      if (tabId === undefined) return;

      if (method === "Network.requestWillBeSent") {
        this.inflight.set(tabId, (this.inflight.get(tabId) ?? 0) + 1);
        this.lastActivity.set(tabId, Date.now());
      } else if (
        method === "Network.loadingFinished" ||
        method === "Network.loadingFailed"
      ) {
        this.inflight.set(tabId, Math.max(0, (this.inflight.get(tabId) ?? 0) - 1));
        this.lastActivity.set(tabId, Date.now());
      } else if (method === "Runtime.consoleAPICalled") {
        const handler = this.consoleListeners.get(tabId);
        if (handler) handler(consoleText(params as ConsoleApiParams));
      }
    });

    chrome.tabs.onRemoved.addListener((tabId: number) => {
      this.inflight.delete(tabId);
      this.lastActivity.delete(tabId);
      this.consoleListeners.delete(tabId);
    });
  }

  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    const tabId = typeof args.tabId === "number" ? args.tabId : undefined;
    if (tabId === undefined) return fail("Missing required argument: tabId (number)");

    const condition = args.for;
    if (typeof condition !== "string" || !CONDITIONS.includes(condition as WaitCondition)) {
      return fail(`Invalid "for": expected one of ${CONDITIONS.join(", ")}`);
    }

    const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : DEFAULT_TIMEOUT_MS;
    const idleMs = typeof args.idleMs === "number" ? args.idleMs : DEFAULT_IDLE_MS;
    const pollMs = typeof args.pollMs === "number" ? args.pollMs : DEFAULT_POLL_MS;

    try {
      if (!cdpManager.isAttached(tabId)) await cdpManager.attach(tabId);

      switch (condition as WaitCondition) {
        case "selector":
        case "selector_hidden": {
          const selector = typeof args.selector === "string" ? args.selector : undefined;
          if (!selector) return fail(`"${condition}" requires a "selector" string`);
          const want = condition === "selector";
          return await this.poll(
            tabId,
            timeoutMs,
            pollMs,
            () => this.evalBoolean(tabId, selectorVisibleExpression(selector, want)),
            { for: condition, selector },
          );
        }
        case "text": {
          const text = typeof args.text === "string" ? args.text : undefined;
          if (!text) return fail(`"text" requires a "text" string`);
          return await this.poll(
            tabId,
            timeoutMs,
            pollMs,
            () => this.evalBoolean(tabId, textPresentExpression(text)),
            { for: "text", text },
          );
        }
        case "network_idle": {
          await cdpManager.enableDomain(tabId, "Network");
          if (!this.lastActivity.has(tabId)) this.lastActivity.set(tabId, Date.now());
          return await this.poll(
            tabId,
            timeoutMs,
            pollMs,
            async () => {
              const pending = this.inflight.get(tabId) ?? 0;
              const since = Date.now() - (this.lastActivity.get(tabId) ?? 0);
              return pending <= 0 && since >= idleMs;
            },
            { for: "network_idle", idleMs },
          );
        }
        case "console": {
          const pattern = typeof args.pattern === "string" ? args.pattern : undefined;
          if (!pattern) return fail(`"console" requires a "pattern" string`);
          let regex: RegExp;
          try {
            regex = new RegExp(pattern);
          } catch (error) {
            return fail(`Invalid regex pattern: ${error instanceof Error ? error.message : String(error)}`);
          }
          await cdpManager.enableDomain(tabId, "Runtime");
          let matchedText: string | null = null;
          this.consoleListeners.set(tabId, (text) => {
            if (matchedText === null && regex.test(text)) matchedText = text;
          });
          try {
            const result = await this.poll(
              tabId,
              timeoutMs,
              pollMs,
              async () => matchedText !== null,
              { for: "console", pattern },
              () => (matchedText !== null ? { matched: matchedText } : {}),
            );
            return result;
          } finally {
            this.consoleListeners.delete(tabId);
          }
        }
      }

      return fail(`Unsupported condition: ${condition}`);
    } catch (error) {
      return fail(`wait_for failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Poll `check` until it resolves true or the timeout elapses. */
  private async poll(
    _tabId: number,
    timeoutMs: number,
    pollMs: number,
    check: () => Promise<boolean>,
    meta: Record<string, unknown>,
    extra?: () => Record<string, unknown>,
  ): Promise<ToolResult> {
    const start = Date.now();
    for (;;) {
      if (await check()) {
        return ok({ ...meta, satisfied: true, waitedMs: Date.now() - start, ...(extra ? extra() : {}) });
      }
      if (Date.now() - start >= timeoutMs) {
        return fail(
          `wait_for timed out after ${timeoutMs}ms (condition: ${String(meta.for)})`,
        );
      }
      await delay(pollMs);
    }
  }

  /** Evaluate a boolean JS expression in the page; false on any error. */
  private async evalBoolean(tabId: number, expression: string): Promise<boolean> {
    try {
      const res = await cdpManager.sendCommand<{ result?: { value?: unknown } }>(
        tabId,
        "Runtime.evaluate",
        { expression, returnByValue: true },
      );
      return res?.result?.value === true;
    } catch {
      return false;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function consoleText(params: ConsoleApiParams): string {
  if (!params?.args) return "";
  return params.args
    .map((a) => (typeof a.value === "string" ? a.value : (a.description ?? String(a.value ?? ""))))
    .join(" ");
}

function selectorVisibleExpression(selector: string, wantVisible: boolean): string {
  const sel = JSON.stringify(selector);
  return `(() => {
    const el = document.querySelector(${sel});
    const visible = (() => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
    })();
    return ${wantVisible ? "visible" : "!visible"};
  })()`;
}

function textPresentExpression(text: string): string {
  const t = JSON.stringify(text);
  return `(() => !!(document.body && document.body.innerText && document.body.innerText.includes(${t})))()`;
}
