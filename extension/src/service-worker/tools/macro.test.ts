import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolResult } from "../../types/messages.js";

function text(r: ToolResult): string {
  const b = r.content[0];
  if (b.type !== "text") throw new Error("expected text");
  return b.text;
}

let store: Record<string, unknown>;
let msgListener: ((m: { action?: string; step?: unknown }, sender: { tab?: { id?: number } }) => void) | null;
const executeScript = vi.fn((_opts: { func?: unknown; files?: string[] }) => Promise.resolve([{ result: { ok: true } }]));
const alarmsCreate = vi.fn(() => Promise.resolve());
const alarmsClear = vi.fn(() => Promise.resolve());
const tabsUpdate = vi.fn(() => Promise.resolve({}));

function setupChrome() {
  store = {};
  msgListener = null;
  Object.assign(globalThis, {
    chrome: {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: store[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => Object.assign(store, items)),
        },
      },
      runtime: { onMessage: { addListener: vi.fn((l) => { msgListener = l; }) } },
      webNavigation: { onCommitted: { addListener: vi.fn() } },
      alarms: { onAlarm: { addListener: vi.fn() }, create: alarmsCreate, clear: alarmsClear },
      scripting: { executeScript },
      tabs: {
        get: vi.fn(async (id: number) => ({ id, url: "https://app.test/" })),
        update: tabsUpdate,
        onUpdated: { addListener: vi.fn((l) => l(1, { status: "complete" })), removeListener: vi.fn() },
        create: vi.fn(async () => ({ id: 5 })),
        remove: vi.fn(async () => {}),
      },
    },
  });
}

const { MacroTool } = await import("./macro.js");

describe("MacroTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupChrome();
  });

  it("records, buffers steps, and saves a macro", async () => {
    const tool = new MacroTool();
    const started = await tool.execute({ action: "record_start", tabId: 1 }, {});
    expect(started.success).toBe(true);
    // recorder injected
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ files: ["dist/content-scripts/macroRecorder.js"] }));

    // simulate recorded steps from the content script
    msgListener?.({ action: "macro-step", step: { type: "click", selector: "#go" } }, { tab: { id: 1 } });
    msgListener?.({ action: "macro-step", step: { type: "input", selector: "#q", value: "hi" } }, { tab: { id: 1 } });

    const saved = await tool.execute({ action: "record_stop", tabId: 1, name: "search" }, {});
    expect(saved.success).toBe(true);
    const payload = JSON.parse(text(saved));
    // initial navigate (from tab.url) + 2 captured steps
    expect(payload.stepCount).toBe(3);
    expect(payload.steps[0]).toEqual({ type: "navigate", url: "https://app.test/" });
  });

  it("lists and gets saved macros", async () => {
    const tool = new MacroTool();
    await tool.execute({ action: "record_start", tabId: 1 }, {});
    await tool.execute({ action: "record_stop", tabId: 1, name: "m1" }, {});

    const listed = await tool.execute({ action: "list" }, {});
    expect(JSON.parse(text(listed)).macros[0].name).toBe("m1");
    const got = await tool.execute({ action: "get", name: "m1" }, {});
    expect(JSON.parse(text(got)).macro.name).toBe("m1");
  });

  it("replays navigate/click/input steps", async () => {
    const tool = new MacroTool();
    await tool.execute({ action: "record_start", tabId: 1 }, {});
    msgListener?.({ action: "macro-step", step: { type: "click", selector: "#go" } }, { tab: { id: 1 } });
    msgListener?.({ action: "macro-step", step: { type: "input", selector: "#q", value: "hi" } }, { tab: { id: 1 } });
    await tool.execute({ action: "record_stop", tabId: 1, name: "m" }, {});

    executeScript.mockClear();
    const replayed = await tool.execute({ action: "replay", name: "m", tabId: 1 }, {});
    expect(replayed.success).toBe(true);
    const payload = JSON.parse(text(replayed));
    expect(payload.ok).toBe(true);
    expect(payload.stepsRun).toBe(3);
    expect(tabsUpdate).toHaveBeenCalledWith(1, { url: "https://app.test/" });
    // click + input executed in-page
    expect(executeScript.mock.calls.filter((c) => typeof c[0].func === "function").length).toBe(2);
  });

  it("schedules and unschedules a macro", async () => {
    const tool = new MacroTool();
    await tool.execute({ action: "record_start", tabId: 1 }, {});
    await tool.execute({ action: "record_stop", tabId: 1, name: "m" }, {});

    const sched = await tool.execute({ action: "schedule", name: "m", periodMinutes: 30 }, {});
    expect(sched.success).toBe(true);
    expect(alarmsCreate).toHaveBeenCalledWith("chromeuse-macro:m", expect.objectContaining({ periodInMinutes: 30 }));

    const unsched = await tool.execute({ action: "unschedule", name: "m" }, {});
    expect(unsched.success).toBe(true);
    expect(alarmsClear).toHaveBeenCalledWith("chromeuse-macro:m");
  });

  it("validates actions and missing names", async () => {
    const tool = new MacroTool();
    expect((await tool.execute({ action: "nope" }, {})).success).toBe(false);
    expect((await tool.execute({ action: "replay", name: "x", tabId: 1 }, {})).success).toBe(false); // unknown macro
    expect((await tool.execute({ action: "get" }, {})).success).toBe(false);
  });
});
