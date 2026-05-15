type ConnectionStatus = "disconnected" | "connecting" | "waiting" | "connected" | "error";

export interface ConnectionControlsState {
  readonly connectDisabled: boolean;
  readonly disconnectDisabled: boolean;
  readonly stopDisabled: boolean;
}

export function getConnectionControlsState(status: ConnectionStatus): ConnectionControlsState {
  return {
    connectDisabled: status === "connecting" || status === "waiting" || status === "connected",
    disconnectDisabled: status === "disconnected" || status === "error",
    stopDisabled: status !== "connected",
  };
}
