import type { ConnectionStatus } from "../types/messages.js";

export function resolveBrowserTransportStatus(
  websocketStatus: ConnectionStatus,
  nativeStatus: ConnectionStatus,
): ConnectionStatus {
  if (websocketStatus !== "disconnected") {
    return websocketStatus;
  }

  return nativeStatus;
}
