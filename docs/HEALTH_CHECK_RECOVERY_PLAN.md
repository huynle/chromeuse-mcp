# Health Check & Connection Recovery Implementation Plan

## Problem Statement

Users are experiencing timeout errors (`MCP error -32001: Request timed out`) when the Chrome extension or browser becomes unresponsive. The current system waits the full 60-second timeout before failing, with no early detection or automatic recovery.

## Current Architecture

### Connection Flow
```
MCP Client (OpenCode)
    ↓ stdio
Gateway (SERVER/PROXY mode)
    ↓ HTTP (8766) + WebSocket (8765)
Extension Service Worker
    ↓ Chrome DevTools Protocol
Browser Tab
```

### Key Components

1. **WebSocketBridge** (`mcp-server/src/webSocketBridge.ts`)
   - Manages WebSocket server on port 8765
   - Routes tool requests to extension
   - 60s timeout per request (DEFAULT_TIMEOUT_MS)

2. **WebSocketConnection** (`extension/src/service-worker/webSocketConnection.ts`)
   - Extension-side WebSocket client
   - Handles reconnection with exponential backoff
   - Already implements basic ping/pong for keep-alive

3. **CDPManager** (`extension/src/service-worker/cdp.ts`)
   - Manages Chrome DevTools Protocol connections
   - Has keep-alive via Page.startScreencast
   - Has auto-reattach on unexpected detach (up to 3 attempts)

## Solution Design

### 1. Health Check / Ping Mechanism

#### Objective
Detect connection/browser health issues **before** attempting expensive operations, allowing for fast failure and recovery.

#### Design

**A. Extension-Side Health Check**
- Add `health_check` tool handler that returns immediately with status
- Check CDP connection status to target tab
- Check service worker state
- Return health metrics (response time, CDP state, etc.)

**B. Pre-Flight Health Check**
- Before executing tool requests, perform lightweight health check
- If health check times out (5s), fail fast with actionable error
- If health check succeeds but slow (>2s), warn about potential issues

**C. Periodic Background Health Monitor**
- Extension sends periodic heartbeat to MCP server
- MCP server tracks last heartbeat timestamp
- If heartbeat stops, mark connection as stale

#### Implementation Points

1. **Extension Service Worker** (`extension/src/service-worker/tools/`)
   - Add `healthCheck.ts` tool handler
   - Returns: `{ status: "healthy" | "degraded" | "unhealthy", cdpStatus: {...}, tabStatus: {...}, responseTime: number }`

2. **WebSocketBridge** (`mcp-server/src/webSocketBridge.ts`)
   - Add `healthCheck()` method that sends health_check tool request with 5s timeout
   - Track last successful health check timestamp
   - Expose `isHealthy()` method

3. **Tool Request Flow Enhancement**
   - Before expensive operations (navigate, screenshot, read_page), call `healthCheck()`
   - If unhealthy, fail immediately with recovery instructions
   - If degraded, log warning but proceed

#### Health Check Response Format
```typescript
{
  status: "healthy" | "degraded" | "unhealthy",
  timestamp: number,
  responseTimeMs: number,
  cdp: {
    attached: boolean,
    tabsAttached: number[],
    keepaliveActive: boolean
  },
  serviceWorker: {
    state: "active" | "suspended" | "unknown"
  },
  lastError?: string
}
```

### 2. Connection Recovery Mechanism

#### Objective
Automatically recover from connection failures without user intervention, with clear feedback when auto-recovery fails.

#### Design

**A. WebSocket Recovery** (Already partially implemented)
- Current: Exponential backoff reconnection (up to 10 attempts)
- Enhancement: Reset reconnection attempts on successful health check
- Enhancement: Notify MCP clients when reconnection succeeds after failure

**B. CDP Recovery Enhancement**
- Current: Auto-reattach on unexpected detach (up to 3 attempts)
- Enhancement: Detect "zombie" CDP sessions (attached but not responding)
- Enhancement: Force detach/reattach when health check detects stale CDP

**C. End-to-End Recovery Flow**
```
1. Tool request fails with timeout
2. Run health check with 5s timeout
3. If health check fails:
   a. Check WebSocket connection state
   b. If disconnected: attempt reconnection
   c. If connected but CDP unhealthy: force CDP reattach
   d. Retry original tool request (1 retry max)
4. If still failing: return error with recovery instructions
```

**D. Recovery State Machine**
```
States:
- HEALTHY: Normal operation
- DETECTING: Health check in progress
- RECOVERING_WS: Reconnecting WebSocket
- RECOVERING_CDP: Reattaching CDP to tabs
- FAILED: Auto-recovery exhausted

Transitions:
- HEALTHY → DETECTING (on tool timeout)
- DETECTING → RECOVERING_WS (if WS disconnected)
- DETECTING → RECOVERING_CDP (if CDP stale)
- RECOVERING_* → HEALTHY (on success)
- RECOVERING_* → FAILED (on max attempts)
- FAILED → HEALTHY (on manual user action: reload extension/reconnect)
```

#### Implementation Points

1. **WebSocketBridge Recovery Coordinator** (`mcp-server/src/webSocketBridge.ts`)
   ```typescript
   class RecoveryCoordinator {
     private state: RecoveryState = "HEALTHY";
     private recoveryAttempts = 0;
     private maxAttempts = 3;

     async attemptRecovery(): Promise<boolean> {
       // State machine logic
     }
   }
   ```

2. **CDPManager Zombie Detection** (`extension/src/service-worker/cdp.ts`)
   ```typescript
   // Add to CDPManager
   async checkTabHealth(tabId: number): Promise<boolean> {
     try {
       await this.sendCommand(tabId, 'Page.getLayoutMetrics', {});
       return true;
     } catch {
       return false;
     }
   }

   async forceReattach(tabId: number): Promise<void> {
     // Force detach and reattach even if we think we're connected
   }
   ```

3. **Tool Request Wrapper with Recovery** (`mcp-server/src/webSocketBridge.ts`)
   ```typescript
   async sendToolRequestWithRecovery(
     tool: string,
     args: Record<string, unknown>,
     timeoutMs: number
   ): Promise<ToolRequestResult> {
     try {
       return await this.sendToolRequest(tool, args, timeoutMs);
     } catch (error) {
       if (isTimeoutError(error)) {
         const recovered = await this.recoveryCoordinator.attemptRecovery();
         if (recovered) {
           // Retry once
           return await this.sendToolRequest(tool, args, timeoutMs);
         }
       }
       throw error;
     }
   }
   ```

### 3. Improved Error Messages

Instead of:
```
MCP error -32001: Request timed out
```

Provide:
```
Request timed out after 60s: computer (screenshot)

The extension appears unresponsive. Recovery attempted but failed.

Recommended actions:
1. Reload the extension in chrome://extensions
2. Refresh the target page
3. Reconnect via the side panel (if using WebSocket mode)
4. Try the operation again

Technical details:
- WebSocket: Connected
- CDP Status: Attached to tab 930824450 but not responding
- Last successful request: 3m 45s ago
```

## Implementation Phases

### Phase 1: Health Check Infrastructure (Priority: High)
**Files to modify:**
- `extension/src/service-worker/tools/healthCheck.ts` (NEW)
- `extension/src/service-worker/tools/index.ts` (add healthCheck handler)
- `mcp-server/src/webSocketBridge.ts` (add healthCheck() method)
- `shared/src/types.ts` (add HealthCheckResult type)

**Deliverable:** Basic health check tool that can be called to verify extension/CDP state

### Phase 2: Pre-Flight Health Checks (Priority: High)
**Files to modify:**
- `mcp-server/src/webSocketBridge.ts` (add pre-flight checks)
- `gateway/src/gatewayRuntime.ts` (integrate health checks)

**Deliverable:** Expensive operations automatically run health check first

### Phase 3: CDP Recovery Enhancement (Priority: High)
**Files to modify:**
- `extension/src/service-worker/cdp.ts` (add zombie detection + force reattach)
- `extension/src/service-worker/tools/healthCheck.ts` (integrate CDP health)

**Deliverable:** Automatic detection and recovery of stale CDP sessions

### Phase 4: WebSocket Recovery Enhancement (Priority: Medium)
**Files to modify:**
- `extension/src/service-worker/webSocketConnection.ts` (enhance reconnection)
- `mcp-server/src/webSocketBridge.ts` (track reconnection events)

**Deliverable:** Better WebSocket reconnection with progress feedback

### Phase 5: Recovery Coordinator (Priority: Medium)
**Files to modify:**
- `mcp-server/src/webSocketBridge.ts` (add RecoveryCoordinator class)
- `mcp-server/src/transport.ts` (add recovery hooks)

**Deliverable:** Unified recovery state machine with automatic retries

### Phase 6: Improved Error Messages (Priority: Low)
**Files to modify:**
- `mcp-server/src/webSocketBridge.ts` (enhanced error formatting)
- `gateway/src/gatewayRuntime.ts` (error message passthrough)

**Deliverable:** Actionable error messages with recovery instructions

## Testing Strategy

### Unit Tests
- Health check tool handler returns expected format
- RecoveryCoordinator state machine transitions
- CDP zombie detection logic

### Integration Tests
- Health check detects disconnected WebSocket
- Health check detects stale CDP session
- Recovery flow succeeds after WebSocket reconnection
- Recovery flow succeeds after CDP reattach

### Manual Testing Scenarios
1. **Frozen Page**: Load heavy page, trigger timeout, verify recovery
2. **Extension Crash**: Kill service worker, verify auto-recovery
3. **Network Interruption**: Disconnect/reconnect network, verify recovery
4. **Browser Hang**: Simulate slow browser, verify fast failure with health check

## Success Metrics

### Before Implementation
- Average time to failure: 60s (full timeout)
- Recovery requires manual user action: 100%
- User knows what to do: Unclear from error message

### After Implementation
- Average time to failure: 5s (health check timeout)
- Automatic recovery success rate: Target >70%
- User knows what to do: Clear recovery instructions in error

## Rollout Plan

1. **Phase 1-2**: Deploy health check infrastructure (low risk)
2. **Phase 3**: Deploy CDP recovery (medium risk - affects core browser automation)
3. **Test Period**: Gather metrics for 1 week
4. **Phase 4-6**: Deploy remaining features based on metrics

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Health checks add latency to every request | Medium | Only run health checks for expensive operations |
| Recovery attempts make failures slower | Low | Max 1 retry, 5s health check timeout |
| False positive "unhealthy" during normal operation | Medium | Tune health check thresholds based on real data |
| Recovery state machine adds complexity | High | Comprehensive unit tests, clear logging |

## Future Enhancements (Out of Scope)

1. **Configurable Timeouts**: Allow users to set per-tool timeout values
2. **Health Metrics Dashboard**: Visualize connection health in side panel
3. **Predictive Recovery**: Detect patterns before timeout occurs
4. **Circuit Breaker**: Stop sending requests when consistently failing
