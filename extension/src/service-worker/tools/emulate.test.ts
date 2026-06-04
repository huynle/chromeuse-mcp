import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolResult } from "../../types/messages.js";

const sendCommand = vi.fn();
const attach = vi.fn(() => Promise.resolve());
const isAttached = vi.fn(() => true);
const enableDomain = vi.fn(() => Promise.resolve());

vi.mock("../cdp.js", () => ({
  cdpManager: { attach, isAttached, sendCommand, enableDomain },
}));

const { EmulateTool } = await import("./emulate.js");

function text(result: ToolResult): string {
  const block = result.content[0];
  if (block.type !== "text") throw new Error("expected text");
  return block.text;
}
function called(method: string) {
  return sendCommand.mock.calls.find((c) => c[1] === method);
}

describe("EmulateTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAttached.mockReturnValue(true);
    sendCommand.mockResolvedValue({});
  });

  it("rejects missing tabId and invalid action", async () => {
    expect((await new EmulateTool().execute({ action: "device" }, {})).success).toBe(false);
    expect((await new EmulateTool().execute({ tabId: 1, action: "nope" }, {})).success).toBe(false);
  });

  it("applies a device preset (metrics + touch)", async () => {
    const r = await new EmulateTool().execute({ tabId: 1, action: "device", preset: "iphone-12" }, {});
    expect(r.success).toBe(true);
    expect(called("Emulation.setDeviceMetricsOverride")?.[2]).toMatchObject({ width: 390, height: 844, mobile: true });
    expect(called("Emulation.setTouchEmulationEnabled")?.[2]).toEqual({ enabled: true });
  });

  it("requires width/height when no preset", async () => {
    const r = await new EmulateTool().execute({ tabId: 1, action: "device", width: 500 }, {});
    expect(r.success).toBe(false);
  });

  it("overrides the user agent", async () => {
    await new EmulateTool().execute({ tabId: 1, action: "user_agent", userAgent: "MyBot/1.0" }, {});
    expect(called("Emulation.setUserAgentOverride")?.[2]).toEqual({ userAgent: "MyBot/1.0" });
  });

  it("sets geolocation", async () => {
    await new EmulateTool().execute({ tabId: 1, action: "geolocation", latitude: 51.5, longitude: -0.12 }, {});
    expect(called("Emulation.setGeolocationOverride")?.[2]).toMatchObject({ latitude: 51.5, longitude: -0.12, accuracy: 100 });
  });

  it("emulates dark color scheme", async () => {
    await new EmulateTool().execute({ tabId: 1, action: "color_scheme", scheme: "dark" }, {});
    expect(called("Emulation.setEmulatedMedia")?.[2]).toEqual({ features: [{ name: "prefers-color-scheme", value: "dark" }] });
  });

  it("applies an offline network profile", async () => {
    await new EmulateTool().execute({ tabId: 1, action: "network", profile: "offline" }, {});
    expect(enableDomain).toHaveBeenCalledWith(1, "Network");
    expect(called("Network.emulateNetworkConditions")?.[2]).toMatchObject({ offline: true });
  });

  it("rejects an unknown network profile", async () => {
    const r = await new EmulateTool().execute({ tabId: 1, action: "network", profile: "ultra" }, {});
    expect(r.success).toBe(false);
  });

  it("throttles CPU and rejects rate < 1", async () => {
    await new EmulateTool().execute({ tabId: 1, action: "cpu", rate: 4 }, {});
    expect(called("Emulation.setCPUThrottlingRate")?.[2]).toEqual({ rate: 4 });
    expect((await new EmulateTool().execute({ tabId: 1, action: "cpu", rate: 0 }, {})).success).toBe(false);
  });

  it("resets all overrides", async () => {
    const r = await new EmulateTool().execute({ tabId: 1, action: "reset" }, {});
    expect(r.success).toBe(true);
    expect(called("Emulation.clearDeviceMetricsOverride")).toBeTruthy();
    expect(called("Emulation.clearGeolocationOverride")).toBeTruthy();
  });
});
