/**
 * macro tool - record, replay, and schedule UI interaction macros.
 *
 * Actions:
 *   record_start (tabId)         Inject the recorder; start buffering steps.
 *   record_stop  (tabId, name)   Save buffered steps under a name.
 *   list                         List saved macros.
 *   get          (name)          Return a macro's steps.
 *   delete       (name)
 *   replay       (name, tabId)   Replay the steps in a tab.
 *   schedule     (name, periodMinutes)   Replay on a recurring alarm.
 *   unschedule   (name)
 *
 * Recording captures clicks and input changes (with generated selectors) plus
 * top-frame navigations. Replay navigates, clicks, and fills inputs with waits
 * between steps. Recording state is in-memory; finish a recording in one go.
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";

const STORAGE_KEY = "chromeuse:macros";
const RECORDER_FILE = "dist/content-scripts/macroRecorder.js";
const ALARM_PREFIX = "chromeuse-macro:";
const MAX_STEPS = 200;

interface MacroStep {
  type: "navigate" | "click" | "input";
  url?: string;
  selector?: string;
  value?: string;
  tag?: string;
  text?: string;
}
interface Macro {
  name: string;
  createdAt: number;
  startUrl?: string;
  steps: MacroStep[];
  lastRun?: { at: number; ok: boolean; error?: string };
  schedulePeriodMinutes?: number;
}

function ok(payload: Record<string, unknown>): ToolResult {
  return { success: true, content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
function fail(text: string): ToolResult {
  return { success: false, content: [{ type: "text", text }] };
}
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadMacros(): Promise<Record<string, Macro>> {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  return (res[STORAGE_KEY] as Record<string, Macro>) ?? {};
}
async function saveMacros(macros: Record<string, Macro>): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: macros });
}

export class MacroTool implements ToolHandler {
  /** tabId -> steps being recorded. */
  private recording = new Map<number, MacroStep[]>();

  constructor() {
    chrome.runtime?.onMessage?.addListener((message: { action?: string; step?: MacroStep }, sender) => {
      if (message?.action !== "macro-step" || !message.step) return;
      const tabId = sender.tab?.id;
      if (tabId === undefined) return;
      const steps = this.recording.get(tabId);
      if (!steps) return;
      if (steps.length < MAX_STEPS) steps.push(message.step);
    });

    if (chrome.webNavigation?.onCommitted) {
      chrome.webNavigation.onCommitted.addListener((details) => {
        if (details.frameId !== 0) return;
        const steps = this.recording.get(details.tabId);
        if (!steps) return;
        const last = steps[steps.length - 1];
        if (!(last?.type === "navigate" && last.url === details.url)) {
          steps.push({ type: "navigate", url: details.url });
        }
        // Re-inject the recorder into the freshly navigated page.
        void chrome.scripting.executeScript({ target: { tabId: details.tabId }, files: [RECORDER_FILE] }).catch(() => {});
      });
    }

    if (chrome.alarms?.onAlarm) {
      chrome.alarms.onAlarm.addListener((alarm) => {
        if (!alarm.name.startsWith(ALARM_PREFIX)) return;
        void this.runScheduled(alarm.name.slice(ALARM_PREFIX.length));
      });
    }
  }

  async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const action = args.action;
    const name = typeof args.name === "string" ? args.name : undefined;
    const tabId = typeof args.tabId === "number" ? args.tabId : undefined;

    try {
      switch (action) {
        case "record_start": {
          if (tabId === undefined) return fail('"record_start" requires a tabId');
          const tab = await chrome.tabs.get(tabId);
          const steps: MacroStep[] = [];
          if (tab.url) steps.push({ type: "navigate", url: tab.url });
          this.recording.set(tabId, steps);
          await chrome.scripting.executeScript({ target: { tabId }, files: [RECORDER_FILE] });
          return ok({ recording: true, tabId });
        }
        case "record_stop": {
          if (tabId === undefined) return fail('"record_stop" requires a tabId');
          if (!name) return fail('"record_stop" requires a name');
          const steps = this.recording.get(tabId) ?? [];
          this.recording.delete(tabId);
          const macros = await loadMacros();
          macros[name] = { name, createdAt: Date.now(), startUrl: steps.find((s) => s.type === "navigate")?.url, steps };
          await saveMacros(macros);
          return ok({ saved: name, stepCount: steps.length, steps });
        }
        case "list": {
          const macros = await loadMacros();
          return ok({ macros: Object.values(macros).map((m) => ({ name: m.name, steps: m.steps.length, scheduled: m.schedulePeriodMinutes ?? null, lastRun: m.lastRun })) });
        }
        case "get": {
          if (!name) return fail('"get" requires a name');
          const macros = await loadMacros();
          if (!macros[name]) return fail(`No macro named "${name}"`);
          return ok({ macro: macros[name] });
        }
        case "delete": {
          if (!name) return fail('"delete" requires a name');
          const macros = await loadMacros();
          const existed = name in macros;
          delete macros[name];
          await saveMacros(macros);
          await chrome.alarms.clear(ALARM_PREFIX + name);
          return ok({ deleted: existed, name });
        }
        case "replay": {
          if (!name) return fail('"replay" requires a name');
          if (tabId === undefined) return fail('"replay" requires a tabId');
          const macros = await loadMacros();
          const macro = macros[name];
          if (!macro) return fail(`No macro named "${name}"`);
          const result = await this.replay(macro, tabId);
          return ok({ replayed: name, ...result });
        }
        case "schedule": {
          if (!name) return fail('"schedule" requires a name');
          const periodMinutes = typeof args.periodMinutes === "number" ? args.periodMinutes : undefined;
          if (!periodMinutes || periodMinutes < 1) return fail('"schedule" requires periodMinutes >= 1');
          const macros = await loadMacros();
          if (!macros[name]) return fail(`No macro named "${name}"`);
          macros[name].schedulePeriodMinutes = periodMinutes;
          await saveMacros(macros);
          await chrome.alarms.create(ALARM_PREFIX + name, { periodInMinutes: periodMinutes, delayInMinutes: periodMinutes });
          return ok({ scheduled: name, periodMinutes });
        }
        case "unschedule": {
          if (!name) return fail('"unschedule" requires a name');
          await chrome.alarms.clear(ALARM_PREFIX + name);
          const macros = await loadMacros();
          if (macros[name]) {
            delete macros[name].schedulePeriodMinutes;
            await saveMacros(macros);
          }
          return ok({ unscheduled: name });
        }
        default:
          return fail('Invalid "action": expected record_start, record_stop, list, get, delete, replay, schedule, unschedule');
      }
    } catch (error) {
      return fail(`macro failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async replay(macro: Macro, tabId: number): Promise<{ stepsRun: number; ok: boolean; errors: string[] }> {
    const errors: string[] = [];
    let run = 0;
    for (const step of macro.steps) {
      try {
        if (step.type === "navigate" && step.url) {
          await chrome.tabs.update(tabId, { url: step.url });
          await this.waitForLoad(tabId, 15000);
        } else if (step.type === "click" && step.selector) {
          await this.execInPage(tabId, clickStep, step.selector);
        } else if (step.type === "input" && step.selector) {
          await this.execInPage(tabId, inputStep, step.selector, step.value ?? "");
        }
        run++;
        await delay(300);
      } catch (e) {
        errors.push(`step ${run + 1} (${step.type}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { stepsRun: run, ok: errors.length === 0, errors };
  }

  private async execInPage<A extends unknown[]>(
    tabId: number,
    func: (...args: A) => unknown,
    ...args: A
  ): Promise<void> {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    const out = res?.result as { ok?: boolean; error?: string } | undefined;
    if (out && out.ok === false) throw new Error(out.error ?? "step failed");
  }

  private waitForLoad(tabId: number, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, timeoutMs);
      const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
        if (updatedTabId === tabId && info.status === "complete") {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  private async runScheduled(name: string): Promise<void> {
    const macros = await loadMacros();
    const macro = macros[name];
    if (!macro || !macro.startUrl) return;
    let tab: chrome.tabs.Tab | undefined;
    try {
      tab = await chrome.tabs.create({ url: macro.startUrl, active: false });
      if (tab.id !== undefined) {
        await this.waitForLoad(tab.id, 15000);
        const result = await this.replay(macro, tab.id);
        macro.lastRun = { at: Date.now(), ok: result.ok, error: result.errors[0] };
      }
    } catch (e) {
      macro.lastRun = { at: Date.now(), ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      await saveMacros(macros);
      if (tab?.id !== undefined) await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

// --- Injected page functions (must be self-contained) ---

function clickStep(selector: string): { ok: boolean; error?: string } {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return { ok: false, error: `selector not found: ${selector}` };
  el.scrollIntoView({ block: "center" });
  el.click();
  return { ok: true };
}

function inputStep(selector: string, value: string): { ok: boolean; error?: string } {
  const el = document.querySelector(selector) as HTMLInputElement | null;
  if (!el) return { ok: false, error: `selector not found: ${selector}` };
  if (el.type === "checkbox") {
    el.checked = value === "true";
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true };
}
