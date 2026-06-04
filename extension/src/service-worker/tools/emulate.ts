/**
 * emulate tool - emulate device and environment conditions via the CDP
 * Emulation and Network domains, for responsive and edge-case testing.
 *
 * Actions:
 *   device        Set viewport metrics + mobile/touch (explicit or a preset).
 *   user_agent    Override the User-Agent string.
 *   geolocation   Override geolocation (latitude/longitude/accuracy).
 *   color_scheme  Emulate prefers-color-scheme (light/dark/no-preference).
 *   network       Throttle the network (online/offline/slow-3g/fast-3g).
 *   cpu           Throttle CPU by a slowdown multiplier.
 *   reset         Clear all emulation overrides.
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";
import { cdpManager } from "../cdp.js";

interface DevicePreset {
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
  touch: boolean;
}

const DEVICE_PRESETS: Record<string, DevicePreset> = {
  "iphone-12": { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, touch: true },
  "pixel-5": { width: 393, height: 851, deviceScaleFactor: 2.75, mobile: true, touch: true },
  "ipad": { width: 820, height: 1180, deviceScaleFactor: 2, mobile: true, touch: true },
  "desktop": { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false, touch: false },
};

interface NetworkProfile {
  offline: boolean;
  latency: number;
  downloadThroughput: number;
  uploadThroughput: number;
}

const NETWORK_PROFILES: Record<string, NetworkProfile> = {
  online: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
  "slow-3g": { offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 },
  "fast-3g": { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
};

const ACTIONS = ["device", "user_agent", "geolocation", "color_scheme", "network", "cpu", "reset"] as const;
type Action = (typeof ACTIONS)[number];

function ok(payload: Record<string, unknown>): ToolResult {
  return { success: true, content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
function fail(text: string): ToolResult {
  return { success: false, content: [{ type: "text", text }] };
}

export class EmulateTool implements ToolHandler {
  async execute(
    args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    const tabId = typeof args.tabId === "number" ? args.tabId : undefined;
    if (tabId === undefined) return fail("Missing required argument: tabId (number)");

    const action = args.action;
    if (typeof action !== "string" || !ACTIONS.includes(action as Action)) {
      return fail(`Invalid "action": expected one of ${ACTIONS.join(", ")}`);
    }

    try {
      if (!cdpManager.isAttached(tabId)) await cdpManager.attach(tabId);

      switch (action as Action) {
        case "device":
          return await this.device(tabId, args);
        case "user_agent": {
          const ua = typeof args.userAgent === "string" ? args.userAgent : undefined;
          if (!ua) return fail('"user_agent" requires a "userAgent" string');
          await cdpManager.sendCommand(tabId, "Emulation.setUserAgentOverride", { userAgent: ua });
          return ok({ tabId, userAgent: ua });
        }
        case "geolocation": {
          const latitude = typeof args.latitude === "number" ? args.latitude : undefined;
          const longitude = typeof args.longitude === "number" ? args.longitude : undefined;
          if (latitude === undefined || longitude === undefined) {
            return fail('"geolocation" requires "latitude" and "longitude" numbers');
          }
          const accuracy = typeof args.accuracy === "number" ? args.accuracy : 100;
          await cdpManager.sendCommand(tabId, "Emulation.setGeolocationOverride", {
            latitude,
            longitude,
            accuracy,
          });
          return ok({ tabId, latitude, longitude, accuracy });
        }
        case "color_scheme": {
          const scheme = typeof args.scheme === "string" ? args.scheme : undefined;
          if (scheme !== "light" && scheme !== "dark" && scheme !== "no-preference") {
            return fail('"color_scheme" requires "scheme" of light, dark, or no-preference');
          }
          await cdpManager.sendCommand(tabId, "Emulation.setEmulatedMedia", {
            features: [{ name: "prefers-color-scheme", value: scheme }],
          });
          return ok({ tabId, colorScheme: scheme });
        }
        case "network": {
          const profileName = typeof args.profile === "string" ? args.profile : undefined;
          let conditions: NetworkProfile;
          if (profileName) {
            const preset = NETWORK_PROFILES[profileName];
            if (!preset) return fail(`Unknown network profile: ${profileName}. Use ${Object.keys(NETWORK_PROFILES).join(", ")}`);
            conditions = preset;
          } else {
            conditions = {
              offline: typeof args.offline === "boolean" ? args.offline : false,
              latency: typeof args.latency === "number" ? args.latency : 0,
              downloadThroughput: typeof args.downloadThroughput === "number" ? args.downloadThroughput : -1,
              uploadThroughput: typeof args.uploadThroughput === "number" ? args.uploadThroughput : -1,
            };
          }
          await cdpManager.enableDomain(tabId, "Network");
          await cdpManager.sendCommand(tabId, "Network.emulateNetworkConditions", { ...conditions });
          return ok({ tabId, network: profileName ?? conditions });
        }
        case "cpu": {
          const rate = typeof args.rate === "number" ? args.rate : undefined;
          if (rate === undefined || rate < 1) return fail('"cpu" requires a "rate" >= 1 (slowdown multiplier)');
          await cdpManager.sendCommand(tabId, "Emulation.setCPUThrottlingRate", { rate });
          return ok({ tabId, cpuThrottlingRate: rate });
        }
        case "reset":
          return await this.reset(tabId);
      }

      return fail(`Unsupported action: ${action}`);
    } catch (error) {
      return fail(`emulate failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async device(tabId: number, args: Record<string, unknown>): Promise<ToolResult> {
    const presetName = typeof args.preset === "string" ? args.preset : undefined;
    let metrics: DevicePreset;
    if (presetName) {
      const preset = DEVICE_PRESETS[presetName];
      if (!preset) return fail(`Unknown device preset: ${presetName}. Use ${Object.keys(DEVICE_PRESETS).join(", ")}`);
      metrics = preset;
    } else {
      const width = typeof args.width === "number" ? args.width : undefined;
      const height = typeof args.height === "number" ? args.height : undefined;
      if (width === undefined || height === undefined) {
        return fail('"device" requires a "preset" or explicit "width" and "height"');
      }
      metrics = {
        width,
        height,
        deviceScaleFactor: typeof args.deviceScaleFactor === "number" ? args.deviceScaleFactor : 1,
        mobile: typeof args.mobile === "boolean" ? args.mobile : false,
        touch: typeof args.touch === "boolean" ? args.touch : false,
      };
    }

    await cdpManager.sendCommand(tabId, "Emulation.setDeviceMetricsOverride", {
      width: metrics.width,
      height: metrics.height,
      deviceScaleFactor: metrics.deviceScaleFactor,
      mobile: metrics.mobile,
    });
    await cdpManager.sendCommand(tabId, "Emulation.setTouchEmulationEnabled", {
      enabled: metrics.touch,
    });
    return ok({ tabId, device: presetName ?? metrics });
  }

  private async reset(tabId: number): Promise<ToolResult> {
    const safe = async (method: string, params: Record<string, unknown>) => {
      try {
        await cdpManager.sendCommand(tabId, method, params);
      } catch {
        // best-effort per override
      }
    };
    await safe("Emulation.clearDeviceMetricsOverride", {});
    await safe("Emulation.setTouchEmulationEnabled", { enabled: false });
    await safe("Emulation.setUserAgentOverride", { userAgent: "" });
    await safe("Emulation.clearGeolocationOverride", {});
    await safe("Emulation.setEmulatedMedia", { features: [] });
    await safe("Emulation.setCPUThrottlingRate", { rate: 1 });
    await safe("Network.emulateNetworkConditions", { ...NETWORK_PROFILES.online });
    return ok({ tabId, reset: true });
  }
}
