import { beforeEach, describe, expect, it, vi } from "vitest";

const sendCommand = vi.fn();
const attach = vi.fn();
const detach = vi.fn();
const isAttached = vi.fn(() => true);

vi.mock("../cdp.js", () => ({
  cdpManager: {
    attach,
    detach,
    isAttached,
    sendCommand,
  },
}));

const { ComputerTool } = await import("./computer.js");

describe("ComputerTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAttached.mockReturnValue(true);
    sendCommand.mockImplementation(async (_tabId, method) => {
      if (method === "Page.getLayoutMetrics") {
        return { cssLayoutViewport: { clientWidth: 1000, clientHeight: 800 } };
      }
      return {};
    });
  });

  it("performs repeated clicks in a single tool request", async () => {
    const tool = new ComputerTool();

    const result = await tool.execute(
      { action: "click", tabId: 1, x: 100, y: 200, count: 3 },
      {},
    );

    expect(result).toEqual({
      success: true,
      content: [{ type: "text", text: "Clicked 3 times at (100, 200)" }],
    });

    const mouseCommands = sendCommand.mock.calls.filter(
      ([, method]) => method === "Input.dispatchMouseEvent",
    );

    expect(mouseCommands.map(([, , params]) => params.type)).toEqual([
      "mouseMoved",
      "mousePressed",
      "mouseReleased",
      "mousePressed",
      "mouseReleased",
      "mousePressed",
      "mouseReleased",
    ]);
  });

  it("detaches after one-shot computer calls it attached for", async () => {
    isAttached.mockReturnValue(false);
    const tool = new ComputerTool();

    await tool.execute({ action: "click", tabId: 1, x: 100, y: 200 }, {});

    expect(attach).toHaveBeenCalledWith(1);
    expect(detach).toHaveBeenCalledWith(1);
  });

  it("preserves existing CDP attachments it did not create", async () => {
    isAttached.mockReturnValue(true);
    const tool = new ComputerTool();

    await tool.execute({ action: "click", tabId: 1, x: 100, y: 200 }, {});

    expect(attach).not.toHaveBeenCalled();
    expect(detach).not.toHaveBeenCalled();
  });

  it("moves through multiple points in one tool request", async () => {
    const tool = new ComputerTool();

    const result = await tool.execute(
      {
        action: "move_path",
        tabId: 1,
        points: [
          { x: 10, y: 20 },
          { x: 30, y: 40 },
          { x: 50, y: 60 },
        ],
      },
      {},
    );

    expect(result).toEqual({
      success: true,
      content: [{ type: "text", text: "Moved mouse through 3 points" }],
    });

    const mouseCommands = sendCommand.mock.calls.filter(
      ([, method]) => method === "Input.dispatchMouseEvent",
    );

    expect(mouseCommands.map(([, , params]) => params)).toEqual([
      expect.objectContaining({ type: "mouseMoved", x: 10, y: 20 }),
      expect.objectContaining({ type: "mouseMoved", x: 30, y: 40 }),
      expect.objectContaining({ type: "mouseMoved", x: 50, y: 60 }),
    ]);
  });

  it("dispatches CapsLock as a recognized keyboard key", async () => {
    const tool = new ComputerTool();

    const result = await tool.execute({ action: "key", tabId: 1, key: "CapsLock" }, {});

    expect(result).toEqual({
      success: true,
      content: [{ type: "text", text: "Pressed key: CapsLock" }],
    });

    const keyCommands = sendCommand.mock.calls.filter(
      ([, method]) => method === "Input.dispatchKeyEvent",
    );
    expect(keyCommands.map(([, , params]) => params)).toEqual([
      expect.objectContaining({
        type: "keyDown",
        key: "CapsLock",
        code: "CapsLock",
        windowsVirtualKeyCode: 20,
      }),
      expect.objectContaining({
        type: "keyUp",
        key: "CapsLock",
        code: "CapsLock",
        windowsVirtualKeyCode: 20,
      }),
    ]);
  });

  it("uses shifted printable key text for letter shortcuts", async () => {
    const tool = new ComputerTool();

    await tool.execute({ action: "key", tabId: 1, key: "shift+a" }, {});

    const keyDown = sendCommand.mock.calls.find(
      ([, method, params]) => method === "Input.dispatchKeyEvent" && params.type === "keyDown",
    )?.[2];

    expect(keyDown).toEqual(expect.objectContaining({
      key: "A",
      code: "KeyA",
      text: "A",
      modifiers: 8,
    }));
  });

  it("maps shifted digit punctuation and digit codes correctly", async () => {
    const tool = new ComputerTool();

    await tool.execute({ action: "key", tabId: 1, key: "shift+1" }, {});

    const keyDown = sendCommand.mock.calls.find(
      ([, method, params]) => method === "Input.dispatchKeyEvent" && params.type === "keyDown",
    )?.[2];

    expect(keyDown).toEqual(expect.objectContaining({
      key: "!",
      code: "Digit1",
      text: "!",
      windowsVirtualKeyCode: 49,
      modifiers: 8,
    }));
  });

  it("maps slash shortcuts to slash code instead of a letter code", async () => {
    const tool = new ComputerTool();

    await tool.execute({ action: "key", tabId: 1, key: "cmd+/" }, {});

    const keyDown = sendCommand.mock.calls.find(
      ([, method, params]) => method === "Input.dispatchKeyEvent" && params.type === "keyDown",
    )?.[2];

    expect(keyDown).toEqual(expect.objectContaining({
      key: "/",
      code: "Slash",
      windowsVirtualKeyCode: 191,
      modifiers: 4,
    }));
  });
});
