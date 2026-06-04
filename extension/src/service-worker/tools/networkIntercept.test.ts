import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolResult } from "../../types/messages.js";

const sendCommand = vi.fn();
const attach = vi.fn(() => Promise.resolve());
const isAttached = vi.fn(() => true);
let cdpListener: ((source: { tabId?: number }, method: string, params: unknown) => void) | null = null;
const addEventListener = vi.fn((l: typeof cdpListener) => {
  cdpListener = l;
});

vi.mock("../cdp.js", () => ({
  cdpManager: { attach, isAttached, sendCommand, addEventListener },
}));

Object.assign(globalThis, { chrome: { tabs: { onRemoved: { addListener: vi.fn() } } } });

const { NetworkInterceptTool } = await import("./networkIntercept.js");

function text(result: ToolResult): string {
  const block = result.content[0];
  if (block.type !== "text") throw new Error("expected text");
  return block.text;
}
function pause(tool: unknown, tabId: number, url: string, method = "GET", requestId = "r1") {
  cdpListener?.({ tabId }, "Fetch.requestPaused", { requestId, request: { url, method } });
}

describe("NetworkInterceptTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAttached.mockReturnValue(true);
    sendCommand.mockResolvedValue({});
  });

  it("rejects missing tabId and invalid action", async () => {
    const tool = new NetworkInterceptTool();
    expect((await tool.execute({ action: "mock" }, {})).success).toBe(false);
    const bad = await tool.execute({ tabId: 1, action: "nope" }, {});
    expect(bad.success).toBe(false);
    expect(text(bad)).toContain("Invalid");
  });

  it("requires a urlPattern for mock/block", async () => {
    const r = await new NetworkInterceptTool().execute({ tabId: 1, action: "mock" }, {});
    expect(r.success).toBe(false);
    expect(text(r)).toContain("urlPattern");
  });

  it("adds a mock rule and enables Fetch with patterns", async () => {
    const tool = new NetworkInterceptTool();
    const r = await tool.execute(
      { tabId: 1, action: "mock", urlPattern: "/api/user", status: 201, body: "{\"ok\":true}" },
      {},
    );
    expect(r.success).toBe(true);
    expect(JSON.parse(text(r)).activeRules).toBe(1);
    const enableCall = sendCommand.mock.calls.find((c) => c[1] === "Fetch.enable");
    expect(enableCall).toBeTruthy();
    expect(enableCall?.[2].patterns[0].urlPattern).toBe("*/api/user*");
  });

  it("fulfills a matching mocked request", async () => {
    const tool = new NetworkInterceptTool();
    await tool.execute({ tabId: 5, action: "mock", urlPattern: "/api/data", status: 200, body: "x" }, {});
    sendCommand.mockClear();
    pause(tool, 5, "https://site.test/api/data?q=1");
    await new Promise((r) => setTimeout(r, 0));
    const fulfill = sendCommand.mock.calls.find((c) => c[1] === "Fetch.fulfillRequest");
    expect(fulfill).toBeTruthy();
    expect(fulfill?.[2].responseCode).toBe(200);
  });

  it("fails a matching blocked request", async () => {
    const tool = new NetworkInterceptTool();
    await tool.execute({ tabId: 6, action: "block", urlPattern: "ads.example" }, {});
    sendCommand.mockClear();
    pause(tool, 6, "https://ads.example/banner.js");
    await new Promise((r) => setTimeout(r, 0));
    const failCall = sendCommand.mock.calls.find((c) => c[1] === "Fetch.failRequest");
    expect(failCall).toBeTruthy();
    expect(failCall?.[2].errorReason).toBe("BlockedByClient");
  });

  it("continues a non-matching paused request", async () => {
    const tool = new NetworkInterceptTool();
    await tool.execute({ tabId: 8, action: "block", urlPattern: "ads.example" }, {});
    sendCommand.mockClear();
    pause(tool, 8, "https://site.test/main.js");
    await new Promise((r) => setTimeout(r, 0));
    const cont = sendCommand.mock.calls.find((c) => c[1] === "Fetch.continueRequest");
    expect(cont).toBeTruthy();
  });

  it("lists and clears rules", async () => {
    const tool = new NetworkInterceptTool();
    await tool.execute({ tabId: 9, action: "block", urlPattern: "x" }, {});
    const listed = await tool.execute({ tabId: 9, action: "list" }, {});
    expect(JSON.parse(text(listed)).rules).toHaveLength(1);

    sendCommand.mockClear();
    const cleared = await tool.execute({ tabId: 9, action: "clear" }, {});
    expect(JSON.parse(text(cleared)).cleared).toBe(true);
    expect(sendCommand.mock.calls.find((c) => c[1] === "Fetch.disable")).toBeTruthy();
    const after = await tool.execute({ tabId: 9, action: "list" }, {});
    expect(JSON.parse(text(after)).rules).toHaveLength(0);
  });

  it("honors method matching", async () => {
    const tool = new NetworkInterceptTool();
    await tool.execute({ tabId: 10, action: "block", urlPattern: "/api", method: "POST" }, {});
    sendCommand.mockClear();
    pause(tool, 10, "https://site.test/api", "GET");
    await new Promise((r) => setTimeout(r, 0));
    // GET does not match the POST-only rule -> continue
    expect(sendCommand.mock.calls.find((c) => c[1] === "Fetch.continueRequest")).toBeTruthy();
    expect(sendCommand.mock.calls.find((c) => c[1] === "Fetch.failRequest")).toBeFalsy();
  });
});
