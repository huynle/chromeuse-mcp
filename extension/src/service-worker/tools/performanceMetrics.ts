/**
 * performance_metrics tool - capture load timings, Core Web Vitals, and a
 * resource summary for a tab, plus a few CDP runtime metrics (heap, nodes).
 *
 * Args:
 *   tabId (number, required)
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";
import { cdpManager } from "../cdp.js";

const PAGE_METRICS_EXPRESSION = `(() => {
  const navEntries = performance.getEntriesByType('navigation');
  const nav = navEntries && navEntries[0];
  const paint = performance.getEntriesByType('paint') || [];
  const fcp = paint.find((p) => p.name === 'first-contentful-paint');
  const lcpEntries = performance.getEntriesByType('largest-contentful-paint') || [];
  const lcp = lcpEntries.length ? lcpEntries[lcpEntries.length - 1] : null;
  const shifts = performance.getEntriesByType('layout-shift') || [];
  const cls = shifts.reduce((sum, e) => (e.hadRecentInput ? sum : sum + (e.value || 0)), 0);
  const resources = performance.getEntriesByType('resource') || [];
  const totalTransferBytes = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0);
  const round = (n) => (typeof n === 'number' ? Math.round(n) : null);
  return {
    url: location.href,
    navigation: nav ? {
      type: nav.type,
      ttfbMs: round(nav.responseStart),
      domInteractiveMs: round(nav.domInteractive),
      domContentLoadedMs: round(nav.domContentLoadedEventEnd),
      loadMs: round(nav.loadEventEnd),
      transferBytes: nav.transferSize || null,
    } : null,
    fcpMs: fcp ? round(fcp.startTime) : null,
    lcpMs: lcp ? round(lcp.startTime) : null,
    cls: Number(cls.toFixed(4)),
    resources: { count: resources.length, totalTransferBytes },
  };
})()`;

/** CDP runtime metrics worth surfacing. */
const RUNTIME_METRIC_KEYS = new Set([
  "JSHeapUsedSize",
  "JSHeapTotalSize",
  "Nodes",
  "Documents",
  "JSEventListeners",
  "LayoutCount",
  "RecalcStyleCount",
]);

interface CdpMetric {
  name: string;
  value: number;
}

export class PerformanceMetricsTool implements ToolHandler {
  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    const tabId = typeof args.tabId === "number" ? args.tabId : undefined;
    if (tabId === undefined) {
      return { success: false, content: [{ type: "text", text: "Missing required argument: tabId (number)" }] };
    }

    try {
      if (!cdpManager.isAttached(tabId)) await cdpManager.attach(tabId);

      const pageRes = await cdpManager.sendCommand<{ result?: { value?: unknown } }>(
        tabId,
        "Runtime.evaluate",
        { expression: PAGE_METRICS_EXPRESSION, returnByValue: true },
      );
      const page = (pageRes?.result?.value as Record<string, unknown>) ?? {};

      let runtime: Record<string, number> = {};
      try {
        await cdpManager.enableDomain(tabId, "Performance");
        const metricsRes = await cdpManager.sendCommand<{ metrics?: CdpMetric[] }>(
          tabId,
          "Performance.getMetrics",
          {},
        );
        for (const m of metricsRes?.metrics ?? []) {
          if (RUNTIME_METRIC_KEYS.has(m.name)) runtime[m.name] = m.value;
        }
      } catch {
        runtime = {};
      }

      return {
        success: true,
        content: [{ type: "text", text: JSON.stringify({ tabId, ...page, runtime }, null, 2) }],
      };
    } catch (error) {
      return {
        success: false,
        content: [{ type: "text", text: `performance_metrics failed: ${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }
}
