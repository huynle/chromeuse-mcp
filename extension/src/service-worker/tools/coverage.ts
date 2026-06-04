/**
 * coverage tool - measure JavaScript and CSS usage via CDP, to find unused
 * code shipped to a page.
 *
 * Actions:
 *   start  Begin precise JS coverage + CSS rule-usage tracking.
 *   stop   Stop tracking and report per-URL used vs total functions (JS) and
 *          used vs total rules (CSS), with overall percentages.
 *
 * JS coverage is function-level (a function counts as "used" when executed at
 * least once). CSS coverage is rule-level.
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";
import { cdpManager } from "../cdp.js";

interface CoverageRange {
  startOffset: number;
  endOffset: number;
  count: number;
}
interface FunctionCoverage {
  ranges: CoverageRange[];
}
interface ScriptCoverage {
  scriptId: string;
  url: string;
  functions: FunctionCoverage[];
}
interface RuleUsage {
  styleSheetId: string;
  used: boolean;
}
interface StyleSheetAddedParams {
  header: { styleSheetId: string; sourceURL?: string };
}

function ok(payload: Record<string, unknown>): ToolResult {
  return { success: true, content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
function fail(text: string): ToolResult {
  return { success: false, content: [{ type: "text", text }] };
}

export class CoverageTool implements ToolHandler {
  /** styleSheetId -> source URL, captured from CSS.styleSheetAdded. */
  private styleSheetUrls = new Map<number, Map<string, string>>();
  private tracking = new Set<number>();

  constructor() {
    cdpManager.addEventListener((source, method, params) => {
      if (source.tabId === undefined || method !== "CSS.styleSheetAdded") return;
      const p = params as unknown as StyleSheetAddedParams;
      let map = this.styleSheetUrls.get(source.tabId);
      if (!map) {
        map = new Map();
        this.styleSheetUrls.set(source.tabId, map);
      }
      map.set(p.header.styleSheetId, p.header.sourceURL || "(inline)");
    });

    chrome.tabs.onRemoved.addListener((tabId: number) => {
      this.styleSheetUrls.delete(tabId);
      this.tracking.delete(tabId);
    });
  }

  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    const tabId = typeof args.tabId === "number" ? args.tabId : undefined;
    if (tabId === undefined) return fail("Missing required argument: tabId (number)");

    const action = args.action;
    if (action !== "start" && action !== "stop") {
      return fail('Invalid "action": expected "start" or "stop"');
    }

    try {
      if (!cdpManager.isAttached(tabId)) await cdpManager.attach(tabId);

      if (action === "start") {
        await cdpManager.enableDomain(tabId, "Profiler");
        await cdpManager.enableDomain(tabId, "DOM");
        await cdpManager.enableDomain(tabId, "CSS");
        this.styleSheetUrls.set(tabId, new Map());
        await cdpManager.sendCommand(tabId, "Profiler.startPreciseCoverage", {
          callCount: true,
          detailed: true,
        });
        await cdpManager.sendCommand(tabId, "CSS.startRuleUsageTracking", {});
        this.tracking.add(tabId);
        return ok({ tabId, tracking: true, note: "Interact with the page, then call coverage stop." });
      }

      // stop
      if (!this.tracking.has(tabId)) {
        return fail("Coverage is not running for this tab. Call coverage start first.");
      }

      const jsRes = await cdpManager.sendCommand<{ result?: ScriptCoverage[] }>(
        tabId,
        "Profiler.takePreciseCoverage",
        {},
      );
      await cdpManager.sendCommand(tabId, "Profiler.stopPreciseCoverage", {});

      const cssRes = await cdpManager.sendCommand<{ ruleUsage?: RuleUsage[] }>(
        tabId,
        "CSS.stopRuleUsageTracking",
        {},
      );
      this.tracking.delete(tabId);

      const js = summarizeJs(jsRes?.result ?? []);
      const css = summarizeCss(cssRes?.ruleUsage ?? [], this.styleSheetUrls.get(tabId));

      return ok({ tabId, javascript: js, css });
    } catch (error) {
      return fail(`coverage failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function summarizeJs(scripts: ScriptCoverage[]): Record<string, unknown> {
  const perUrl: Array<{ url: string; functionsTotal: number; functionsUsed: number; usedPct: number }> = [];
  let total = 0;
  let used = 0;
  for (const s of scripts) {
    if (!s.url) continue; // skip anonymous/eval scripts
    const fnTotal = s.functions.length;
    const fnUsed = s.functions.filter((f) => (f.ranges[0]?.count ?? 0) > 0).length;
    total += fnTotal;
    used += fnUsed;
    perUrl.push({ url: s.url, functionsTotal: fnTotal, functionsUsed: fnUsed, usedPct: pct(fnUsed, fnTotal) });
  }
  perUrl.sort((a, b) => a.usedPct - b.usedPct);
  return { functionsTotal: total, functionsUsed: used, usedPct: pct(used, total), scripts: perUrl.slice(0, 50) };
}

function summarizeCss(usage: RuleUsage[], urlMap?: Map<string, string>): Record<string, unknown> {
  const bySheet = new Map<string, { total: number; used: number }>();
  for (const r of usage) {
    const url = urlMap?.get(r.styleSheetId) ?? r.styleSheetId;
    const entry = bySheet.get(url) ?? { total: 0, used: 0 };
    entry.total += 1;
    if (r.used) entry.used += 1;
    bySheet.set(url, entry);
  }
  let total = 0;
  let used = 0;
  const perSheet: Array<{ url: string; rulesTotal: number; rulesUsed: number; usedPct: number }> = [];
  for (const [url, e] of bySheet) {
    total += e.total;
    used += e.used;
    perSheet.push({ url, rulesTotal: e.total, rulesUsed: e.used, usedPct: pct(e.used, e.total) });
  }
  perSheet.sort((a, b) => a.usedPct - b.usedPct);
  return { rulesTotal: total, rulesUsed: used, usedPct: pct(used, total), stylesheets: perSheet.slice(0, 50) };
}

function pct(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((used / total) * 1000) / 10;
}
