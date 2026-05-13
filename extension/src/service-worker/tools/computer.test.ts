import { beforeEach, describe, expect, it, vi } from "vitest";

const sendCommand = vi.fn();
const attach = vi.fn();
const isAttached = vi.fn(() => true);

vi.mock("../cdp.js", () => ({
  cdpManager: {
    attach,
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
});
