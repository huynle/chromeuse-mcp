import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Server } from 'net'
import type { McpClient, SocketServerOptions } from './socketServer.js'

// ---------------------------------------------------------------------------
// Mocks - set up before importing the module under test
// ---------------------------------------------------------------------------

// Mock sendChromeMessage to capture outgoing Chrome messages
const sentMessages: unknown[] = []
vi.mock('./chromeMessageReader.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./chromeMessageReader.js')>()
  return {
    ...original,
    sendChromeMessage: (msg: unknown) => {
      sentMessages.push(typeof msg === 'string' ? JSON.parse(msg) : msg)
    },
  }
})

// Mock socketServer so we don't need real Unix sockets
let capturedOptions: SocketServerOptions | null = null
const mockStop = vi.fn().mockResolvedValue(undefined)

vi.mock('./socketServer.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./socketServer.js')>()
  return {
    ...original,
    getSocketPath: () => '/tmp/test-socket.sock',
    prepareSocketDir: vi.fn().mockResolvedValue(undefined),
    createSocketServer: async (opts: SocketServerOptions) => {
      capturedOptions = opts
      return {
        server: {} as Server,
        stop: mockStop,
      }
    },
  }
})

// Import after mocks are set up
const { ChromeNativeHost } = await import('./chromeNativeHost.js')
const { encodeMessage } = await import('./chromeMessageReader.js')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(id: number): McpClient {
  const chunks: Buffer[] = []
  return {
    id,
    socket: {
      write: (data: Buffer) => {
        chunks.push(Buffer.from(data))
        return true
      },
      destroy: vi.fn(),
      // expose captured writes for assertions
      _written: chunks,
    } as unknown as McpClient['socket'],
    buffer: Buffer.alloc(0),
  }
}

function simulateClientConnect(client: McpClient): void {
  capturedOptions!.onClientConnect(client)
}

function simulateClientData(client: McpClient, data: Buffer): void {
  capturedOptions!.onClientData(client, data)
}

function simulateClientDisconnect(client: McpClient): void {
  capturedOptions!.onClientDisconnect(client)
}

function simulateClientError(client: McpClient, err: Error): void {
  capturedOptions!.onClientError(client, err)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChromeNativeHost', () => {
  let host: InstanceType<typeof ChromeNativeHost>

  beforeEach(async () => {
    sentMessages.length = 0
    capturedOptions = null
    mockStop.mockClear()
    host = new ChromeNativeHost()
    await host.start()
  })

  afterEach(async () => {
    await host.stop()
  })

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  describe('start/stop lifecycle', () => {
    it('reports running after start', () => {
      expect(host.isRunning()).toBe(true)
    })

    it('reports not running after stop', async () => {
      await host.stop()
      expect(host.isRunning()).toBe(false)
    })

    it('start is idempotent', async () => {
      await host.start() // second call
      expect(host.isRunning()).toBe(true)
    })

    it('stop is idempotent', async () => {
      await host.stop()
      await host.stop() // second call
      expect(host.isRunning()).toBe(false)
    })

    it('stop calls server stop function', async () => {
      await host.stop()
      expect(mockStop).toHaveBeenCalledTimes(1)
    })

    it('stop destroys all connected clients', async () => {
      const client1 = makeClient(1)
      const client2 = makeClient(2)
      simulateClientConnect(client1)
      simulateClientConnect(client2)

      await host.stop()

      expect(client1.socket.destroy).toHaveBeenCalled()
      expect(client2.socket.destroy).toHaveBeenCalled()
      expect(host.getClientCount()).toBe(0)
    })

    it('getClientCount returns 0 initially', () => {
      expect(host.getClientCount()).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // handleMessage: ping
  // -------------------------------------------------------------------------

  describe('handleMessage - ping', () => {
    it('responds with pong and timestamp', async () => {
      await host.handleMessage(JSON.stringify({ type: 'ping' }))

      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0]).toMatchObject({
        type: 'pong',
      })
      expect((sentMessages[0] as Record<string, unknown>).timestamp).toBeTypeOf('number')
    })
  })

  // -------------------------------------------------------------------------
  // handleMessage: get_status
  // -------------------------------------------------------------------------

  describe('handleMessage - get_status', () => {
    it('responds with status_response containing version', async () => {
      await host.handleMessage(JSON.stringify({ type: 'get_status' }))

      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0]).toMatchObject({
        type: 'status_response',
        native_host_version: expect.any(String),
      })
    })
  })

  // -------------------------------------------------------------------------
  // handleMessage: tool_response
  // -------------------------------------------------------------------------

  describe('handleMessage - tool_response', () => {
    it('forwards to all connected MCP clients with type stripped', async () => {
      const client1 = makeClient(1)
      const client2 = makeClient(2)
      simulateClientConnect(client1)
      simulateClientConnect(client2)

      const toolResponse = {
        type: 'tool_response',
        result: { content: [{ type: 'text', text: 'OK' }] },
      }
      await host.handleMessage(JSON.stringify(toolResponse))

      // Both clients should receive the data (type stripped, length-prefixed)
      const written1 = (client1.socket as unknown as { _written: Buffer[] })._written
      const written2 = (client2.socket as unknown as { _written: Buffer[] })._written
      expect(written1.length).toBe(1)
      expect(written2.length).toBe(1)

      // Decode the written data - should be the message without 'type' field
      const buf1 = written1[0]
      const payloadLength = buf1.readUInt32LE(0)
      const payload = JSON.parse(buf1.subarray(4, 4 + payloadLength).toString('utf-8'))
      expect(payload).toEqual({ result: { content: [{ type: 'text', text: 'OK' }] } })
      expect(payload.type).toBeUndefined()
    })

    it('does nothing when no clients connected', async () => {
      const toolResponse = { type: 'tool_response', result: { content: [] } }
      // Should not throw
      await host.handleMessage(JSON.stringify(toolResponse))
      expect(sentMessages).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // handleMessage: notification
  // -------------------------------------------------------------------------

  describe('handleMessage - notification', () => {
    it('forwards to all connected MCP clients with type stripped', async () => {
      const client = makeClient(1)
      simulateClientConnect(client)

      await host.handleMessage(
        JSON.stringify({ type: 'notification', event: 'tab_updated', data: { tabId: 42 } }),
      )

      const written = (client.socket as unknown as { _written: Buffer[] })._written
      expect(written.length).toBe(1)

      const buf = written[0]
      const payloadLength = buf.readUInt32LE(0)
      const payload = JSON.parse(buf.subarray(4, 4 + payloadLength).toString('utf-8'))
      expect(payload).toEqual({ event: 'tab_updated', data: { tabId: 42 } })
      expect(payload.type).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // handleMessage: unknown type
  // -------------------------------------------------------------------------

  describe('handleMessage - unknown type', () => {
    it('sends error to Chrome', async () => {
      await host.handleMessage(JSON.stringify({ type: 'unknown_thing' }))

      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0]).toMatchObject({
        type: 'error',
        error: expect.stringContaining('Unknown message type'),
      })
    })
  })

  // -------------------------------------------------------------------------
  // handleMessage: invalid input
  // -------------------------------------------------------------------------

  describe('handleMessage - invalid input', () => {
    it('sends error for invalid JSON', async () => {
      await host.handleMessage('not-valid-json{{{')

      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0]).toMatchObject({
        type: 'error',
        error: 'Invalid message format',
      })
    })

    it('sends error for message without type field', async () => {
      await host.handleMessage(JSON.stringify({ foo: 'bar' }))

      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0]).toMatchObject({
        type: 'error',
        error: 'Invalid message format',
      })
    })
  })

  // -------------------------------------------------------------------------
  // Client lifecycle
  // -------------------------------------------------------------------------

  describe('client lifecycle', () => {
    it('tracks connected clients', () => {
      const client = makeClient(1)
      simulateClientConnect(client)
      expect(host.getClientCount()).toBe(1)
    })

    it('sends mcp_connected to Chrome on client connect', () => {
      const client = makeClient(1)
      simulateClientConnect(client)

      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0]).toMatchObject({ type: 'mcp_connected' })
    })

    it('sends mcp_disconnected to Chrome on client disconnect', () => {
      const client = makeClient(1)
      simulateClientConnect(client)
      sentMessages.length = 0

      simulateClientDisconnect(client)

      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0]).toMatchObject({ type: 'mcp_disconnected' })
      expect(host.getClientCount()).toBe(0)
    })

    it('ignores disconnect for already-removed client (idempotent)', () => {
      const client = makeClient(1)
      simulateClientConnect(client)
      simulateClientDisconnect(client)
      sentMessages.length = 0

      // Second disconnect should not send another message
      simulateClientDisconnect(client)
      expect(sentMessages).toHaveLength(0)
    })

    it('supports multiple concurrent clients', () => {
      simulateClientConnect(makeClient(1))
      simulateClientConnect(makeClient(2))
      simulateClientConnect(makeClient(3))
      expect(host.getClientCount()).toBe(3)
    })
  })

  // -------------------------------------------------------------------------
  // Client data: socket -> Chrome tool_request forwarding
  // -------------------------------------------------------------------------

  describe('client data forwarding (socket -> Chrome)', () => {
    it('forwards a complete length-prefixed message as tool_request', () => {
      const client = makeClient(1)
      simulateClientConnect(client)
      sentMessages.length = 0

      const request = { method: 'execute_tool', params: { tool: 'navigate' } }
      const encoded = encodeMessage(request)

      simulateClientData(client, encoded)

      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0]).toMatchObject({
        type: 'tool_request',
        method: 'execute_tool',
        params: { tool: 'navigate' },
      })
    })

    it('handles data arriving in multiple chunks', () => {
      const client = makeClient(1)
      simulateClientConnect(client)
      sentMessages.length = 0

      const request = { method: 'execute_tool', params: { tool: 'screenshot' } }
      const encoded = encodeMessage(request)

      // Split into two chunks
      const mid = Math.floor(encoded.length / 2)
      simulateClientData(client, encoded.subarray(0, mid))

      // No message yet
      expect(sentMessages).toHaveLength(0)

      simulateClientData(client, encoded.subarray(mid))

      // Now the full message should be forwarded
      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0]).toMatchObject({
        type: 'tool_request',
        method: 'execute_tool',
      })
    })

    it('handles multiple messages in a single data chunk', () => {
      const client = makeClient(1)
      simulateClientConnect(client)
      sentMessages.length = 0

      const req1 = { method: 'execute_tool', params: { tool: 'click' } }
      const req2 = { method: 'execute_tool', params: { tool: 'type' } }

      const combined = Buffer.concat([encodeMessage(req1), encodeMessage(req2)])
      simulateClientData(client, combined)

      expect(sentMessages).toHaveLength(2)
      expect(sentMessages[0]).toMatchObject({ type: 'tool_request', method: 'execute_tool', params: { tool: 'click' } })
      expect(sentMessages[1]).toMatchObject({ type: 'tool_request', method: 'execute_tool', params: { tool: 'type' } })
    })

    it('destroys client socket on protocol error (oversized message)', () => {
      const client = makeClient(1)
      simulateClientConnect(client)
      sentMessages.length = 0

      // Create a buffer claiming an oversized payload
      const buf = Buffer.alloc(8)
      buf.writeUInt32LE(0, 0) // zero-length = protocol error in tryExtractMessage
      simulateClientData(client, buf)

      expect(client.socket.destroy).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Client errors
  // -------------------------------------------------------------------------

  describe('client errors', () => {
    it('handles client error without crashing', () => {
      const client = makeClient(1)
      simulateClientConnect(client)

      // Should not throw
      simulateClientError(client, new Error('connection reset'))
    })
  })
})
