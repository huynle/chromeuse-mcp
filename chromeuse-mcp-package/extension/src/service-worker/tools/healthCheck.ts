/**
 * health_check tool - checks the health of ChromeUse MCP server components.
 *
 * Verifies CDP attachment status, keepalive state, and service worker health.
 * Returns a comprehensive health summary with diagnostics for troubleshooting
 * connection issues.
 */

import type {
  ToolHandler,
  ToolResult,
  ToolContext,
} from "../../types/messages.js";
import { cdpManager } from "../cdp.js";

/** Health status levels */
type HealthStatus = "healthy" | "degraded" | "unhealthy";

/** Service worker state (from ServiceWorkerRegistration) */
type ServiceWorkerState = "active" | "suspended" | "unknown";

/** Health check result structure */
interface HealthCheckResult {
  status: HealthStatus;
  timestamp: number;
  responseTimeMs: number;
  cdp: {
    attached: boolean;
    tabsAttached: number[];
    keepaliveActive: boolean;
  };
  serviceWorker: {
    state: ServiceWorkerState;
  };
  lastError?: string;
}

export class HealthCheckTool implements ToolHandler {
  async execute(
    _args: Record<string, unknown>,
    _context: ToolContext,
  ): Promise<ToolResult> {
    const startTime = performance.now();
    let lastError: string | undefined;

    try {
      // Check CDP state
      const attachedTabs = cdpManager.getAttachedTabs();
      const attached = attachedTabs.length > 0;

      // Check if keepalive is active by verifying CDP health on at least one tab
      let keepaliveActive = false;
      if (attached && attachedTabs.length > 0) {
        // Test the first attached tab
        try {
          keepaliveActive = await cdpManager.checkTabHealth(attachedTabs[0]);
        } catch (error) {
          lastError = `CDP health check failed: ${error instanceof Error ? error.message : String(error)}`;
          keepaliveActive = false;
        }
      }

      // Check service worker state
      // In a service worker context, we're always "active" if this code is running
      const serviceWorkerState: ServiceWorkerState = "active";

      // Calculate response time
      const responseTimeMs = Math.round(performance.now() - startTime);

      // Determine overall health status
      let status: HealthStatus;
      if (attached && keepaliveActive) {
        status = "healthy";
      } else if (!attached || !keepaliveActive) {
        status = "degraded";
        if (!attached) {
          lastError = lastError ?? "No tabs attached to CDP";
        } else if (!keepaliveActive) {
          lastError = lastError ?? "CDP keepalive inactive or unresponsive";
        }
      } else {
        status = "unhealthy";
        lastError = lastError ?? "Critical health check failure";
      }

      const result: HealthCheckResult = {
        status,
        timestamp: Date.now(),
        responseTimeMs,
        cdp: {
          attached,
          tabsAttached: attachedTabs,
          keepaliveActive,
        },
        serviceWorker: {
          state: serviceWorkerState,
        },
        ...(lastError && { lastError }),
      };

      return {
        success: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const responseTimeMs = Math.round(performance.now() - startTime);
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      const result: HealthCheckResult = {
        status: "unhealthy",
        timestamp: Date.now(),
        responseTimeMs,
        cdp: {
          attached: false,
          tabsAttached: [],
          keepaliveActive: false,
        },
        serviceWorker: {
          state: "unknown",
        },
        lastError: `Health check failed: ${errorMessage}`,
      };

      return {
        success: false,
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  }
}
