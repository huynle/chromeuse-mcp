/**
 * network_intercept tool - mock or block network requests via the CDP Fetch
 * domain, for frontend debugging (force error states, stub APIs, drop noise).
 *
 * Actions:
 *   mock   Add a rule that fulfills matching requests with a canned response.
 *   block  Add a rule that fails matching requests.
 *   list   List the active rules for a tab.
 *   clear  Remove all rules for a tab and disable interception.
 *
 * Rules match by URL substring, or by glob when the pattern contains "*", and
 * optionally by HTTP method. While any rule is active for a tab, the Fetch
 * domain is enabled and every matching request is paused; non-matching paused
 * requests are continued untouched so the page never hangs.
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";
import { cdpManager } from "../cdp.js";

type RuleKind = "mock" | "block";

interface InterceptRule {
  id: number;
  kind: RuleKind;
  urlPattern: string;
  method?: string;
  status?: number;
  body?: string;
  contentType?: string;
  headers?: Record<string, string>;
}

interface RequestPausedParams {
  requestId: string;
  request: { url: string; method: string };
}

let nextRuleId = 1;

function ok(payload: Record<string, unknown>): ToolResult {
  return { success: true, content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function fail(text: string): ToolResult {
  return { success: false, content: [{ type: "text", text }] };
}

function matches(rule: InterceptRule, url: string, method: string): boolean {
  if (rule.method && rule.method.toUpperCase() !== method.toUpperCase()) return false;
  if (rule.urlPattern.includes("*")) {
    const re = new RegExp(
      "^" + rule.urlPattern.split("*").map(escapeRegex).join(".*") + "$",
    );
    return re.test(url);
  }
  return url.includes(rule.urlPattern);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class NetworkInterceptTool implements ToolHandler {
  private rules = new Map<number, InterceptRule[]>();

  constructor() {
    cdpManager.addEventListener((source, method, params) => {
      if (source.tabId === undefined || method !== "Fetch.requestPaused") return;
      void this.handlePaused(source.tabId, params as unknown as RequestPausedParams);
    });

    chrome.tabs.onRemoved.addListener((tabId: number) => {
      this.rules.delete(tabId);
    });
  }

  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    const tabId = typeof args.tabId === "number" ? args.tabId : undefined;
    if (tabId === undefined) return fail("Missing required argument: tabId (number)");

    const action = args.action;
    if (action !== "mock" && action !== "block" && action !== "list" && action !== "clear") {
      return fail('Invalid "action": expected one of mock, block, list, clear');
    }

    try {
      if (action === "list") {
        return ok({ tabId, rules: this.rules.get(tabId) ?? [] });
      }

      if (action === "clear") {
        this.rules.delete(tabId);
        if (cdpManager.isAttached(tabId)) {
          try {
            await cdpManager.sendCommand(tabId, "Fetch.disable", {});
          } catch {
            // ignore - tab may have navigated/detached
          }
        }
        return ok({ tabId, cleared: true });
      }

      // mock | block - build a rule
      const urlPattern = typeof args.urlPattern === "string" ? args.urlPattern : undefined;
      if (!urlPattern) return fail(`"${action}" requires a "urlPattern" string`);

      const rule: InterceptRule = {
        id: nextRuleId++,
        kind: action,
        urlPattern,
        method: typeof args.method === "string" ? args.method : undefined,
      };

      if (action === "mock") {
        rule.status = typeof args.status === "number" ? args.status : 200;
        rule.body = typeof args.body === "string" ? args.body : "";
        rule.contentType = typeof args.contentType === "string" ? args.contentType : "application/json";
        if (args.headers && typeof args.headers === "object") {
          rule.headers = args.headers as Record<string, string>;
        }
      }

      const tabRules = this.rules.get(tabId) ?? [];
      tabRules.push(rule);
      this.rules.set(tabId, tabRules);

      // (Re)enable Fetch with patterns covering all current rules.
      if (!cdpManager.isAttached(tabId)) await cdpManager.attach(tabId);
      await this.enableFetch(tabId, tabRules);

      return ok({ tabId, added: rule, activeRules: tabRules.length });
    } catch (error) {
      return fail(`network_intercept failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async enableFetch(tabId: number, rules: InterceptRule[]): Promise<void> {
    const patterns = rules.map((r) => ({
      urlPattern: r.urlPattern.includes("*") ? r.urlPattern : `*${r.urlPattern}*`,
      requestStage: "Request",
    }));
    await cdpManager.sendCommand(tabId, "Fetch.enable", { patterns });
  }

  private async handlePaused(tabId: number, params: RequestPausedParams): Promise<void> {
    const rules = this.rules.get(tabId);
    const url = params.request?.url ?? "";
    const httpMethod = params.request?.method ?? "GET";
    const rule = rules?.find((r) => matches(r, url, httpMethod));

    try {
      if (!rule) {
        await cdpManager.sendCommand(tabId, "Fetch.continueRequest", {
          requestId: params.requestId,
        });
        return;
      }

      if (rule.kind === "block") {
        await cdpManager.sendCommand(tabId, "Fetch.failRequest", {
          requestId: params.requestId,
          errorReason: "BlockedByClient",
        });
        return;
      }

      // mock
      const headers = [
        { name: "Content-Type", value: rule.contentType ?? "application/json" },
        ...Object.entries(rule.headers ?? {}).map(([name, value]) => ({ name, value })),
      ];
      await cdpManager.sendCommand(tabId, "Fetch.fulfillRequest", {
        requestId: params.requestId,
        responseCode: rule.status ?? 200,
        responseHeaders: headers,
        body: base64Encode(rule.body ?? ""),
      });
    } catch {
      // Best-effort: if resolving fails (tab navigated), try to continue so the
      // page does not hang on a paused request.
      try {
        await cdpManager.sendCommand(tabId, "Fetch.continueRequest", {
          requestId: params.requestId,
        });
      } catch {
        // give up
      }
    }
  }
}

function base64Encode(text: string): string {
  // btoa handles Latin-1; encode UTF-8 first so non-ASCII bodies survive.
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
