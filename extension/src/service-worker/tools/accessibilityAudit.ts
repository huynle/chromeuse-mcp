/**
 * accessibility_audit tool - run an axe-core accessibility audit on a tab and
 * return WCAG violations.
 *
 * Injects a bundled axe-core into the page's isolated world, then runs
 * axe.run() against the document (or a scoped selector) and summarizes the
 * violations.
 *
 * Args:
 *   tabId (number, required)
 *   tags (string[], optional): rule tags, e.g. ["wcag2a","wcag2aa"]. Default: all.
 *   selector (string, optional): scope the audit to a CSS selector.
 *   maxViolations (number, optional): cap returned violations (default 50).
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";

const AXE_FILE = "dist/content-scripts/axeAudit.js";

function fail(text: string): ToolResult {
  return { success: false, content: [{ type: "text", text }] };
}

interface AxeRunResult {
  error?: string;
  url?: string;
  violations?: Array<{
    id: string;
    impact: string | null;
    help: string;
    helpUrl: string;
    tags: string[];
    nodes: number;
    sampleTargets: string[];
  }>;
}

export class AccessibilityAuditTool implements ToolHandler {
  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    const tabId = typeof args.tabId === "number" ? args.tabId : undefined;
    if (tabId === undefined) return fail("Missing required argument: tabId (number)");

    if (!chrome.scripting) {
      return fail('The "scripting" permission is not available.');
    }

    const tags = Array.isArray(args.tags) ? (args.tags as unknown[]).filter((t): t is string => typeof t === "string") : undefined;
    const selector = typeof args.selector === "string" ? args.selector : undefined;
    const maxViolations = typeof args.maxViolations === "number" ? args.maxViolations : 50;

    try {
      // 1. Load axe-core into the page's isolated world.
      await chrome.scripting.executeScript({ target: { tabId }, files: [AXE_FILE] });

      // 2. Run the audit and summarize.
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        args: [{ tags, selector }],
        func: runAxe,
      });

      const out = (results[0]?.result as AxeRunResult | undefined) ?? {};
      if (out.error) return fail(`accessibility_audit: ${out.error}`);

      const violations = (out.violations ?? []).slice(0, maxViolations);
      return {
        success: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                tabId,
                url: out.url,
                violationCount: out.violations?.length ?? 0,
                violations,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return fail(`accessibility_audit failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Runs inside the page (isolated world). Must be self-contained: no closure
 * over module scope is available after serialization.
 */
function runAxe(opts: { tags?: string[]; selector?: string }): Promise<AxeRunResult> {
  const axe = (window as unknown as { axe?: { run: (ctx: unknown, o: unknown) => Promise<unknown> } }).axe;
  if (!axe) return Promise.resolve({ error: "axe-core failed to load" });

  const context = opts.selector ? opts.selector : document;
  const runOptions = opts.tags && opts.tags.length ? { runOnly: { type: "tag", values: opts.tags } } : {};

  return axe
    .run(context, runOptions)
    .then((res) => {
      const r = res as {
        violations: Array<{
          id: string;
          impact: string | null;
          help: string;
          helpUrl: string;
          tags: string[];
          nodes: Array<{ target: string[] }>;
        }>;
      };
      return {
        url: location.href,
        violations: r.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          helpUrl: v.helpUrl,
          tags: v.tags,
          nodes: v.nodes.length,
          sampleTargets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
        })),
      };
    })
    .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
}
