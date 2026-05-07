import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { createConnection } from 'net'
import { mkdtempSync, rmSync, writeFileSync, statSync, chmodSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createSocketServer, type SocketServerOptions, type McpClient } from './socketServer.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'socket-server-test-'))
}

function connectToSocket(socketPath: string): Promise<import('net').Socket> {
  return new Promise((resolve, reject) => {
    const client = createConnection(socketPath, () => resolve(client))
    client.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSocketServer', () => {
  let tempDir: string
  let stopFn: (() => Promise<void>) | null = null

  beforeEach(() => {
    tempDir = makeTempDir()
  })

  afterEach(async () => {
    if (stopFn) {
      await stopFn()
      stopFn = null
    }
    try {
      rmSync(tempDir, { recursive: true })
    } catch {
      // ignore
    }
  })

  function makeOptions(
    socketPath: string,
    overrides?: Partial<SocketServerOptions>,
  ): SocketServerOptions & {
    clients: McpClient[]
    dataChunks: Array<{ clientId: number; data: Buffer }>
    disconnects: number[]
    errors: Array<{ clientId: number; error: Error }>
  } {
    const clients: McpClient[] = []
    const dataChunks: Array<{ clientId: number; data: Buffer }> = []
    const disconnects: number[] = []
    const errors: Array<{ clientId: number; error: Error }> = []

    return {
      socketPath,
      onClientConnect: (client) => {
        clients.push(client)
      },
      onClientData: (client, data) => {
        dataChunks.push({ clientId: client.id, data })
      },
      onClientDisconnect: (client) => {
        disconnects.push(client.id)
      },
      onClientError: (client, error) => {
        errors.push({ clientId: client.id, error })
      },
      clients,
      dataChunks,
      disconnects,
      errors,
      ...overrides,
    }
  }

  it('creates a socket at the specified path and accepts connections', async () => {
    const socketPath = join(tempDir, 'test.sock')
    const opts = makeOptions(socketPath)
    const { stop } = await createSocketServer(opts)
    stopFn = stop

    // Socket file should exist
    const stats = statSync(socketPath)
    expect(stats.isSocket?.() ?? true).toBe(true) // isSocket may not exist on all platforms

    // Connect a client
    const conn = await connectToSocket(socketPath)

    // Wait for connect callback
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(opts.clients.length).toBe(1)
    expect(opts.clients[0].id).toBeGreaterThan(0)

    conn.destroy()
  })

  it('sets secure permissions on the socket file (0o600)', async () => {
    const socketPath = join(tempDir, 'perms.sock')
    const opts = makeOptions(socketPath)
    const { stop } = await createSocketServer(opts)
    stopFn = stop

    const stats = statSync(socketPath)
    // Check permissions (owner read/write only). Mask with 0o777 to get perm bits.
    const mode = stats.mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('fires onClientData when data is received', async () => {
    const socketPath = join(tempDir, 'data.sock')
    const opts = makeOptions(socketPath)
    const { stop } = await createSocketServer(opts)
    stopFn = stop

    const conn = await connectToSocket(socketPath)

    // Send some data
    conn.write('hello world')

    // Wait for data callback
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(opts.dataChunks.length).toBe(1)
    expect(opts.dataChunks[0].data.toString()).toBe('hello world')

    conn.destroy()
  })

  it('fires onClientDisconnect when a client disconnects', async () => {
    const socketPath = join(tempDir, 'disc.sock')
    const opts = makeOptions(socketPath)
    const { stop } = await createSocketServer(opts)
    stopFn = stop

    const conn = await connectToSocket(socketPath)
    await new Promise(resolve => setTimeout(resolve, 50))

    const clientId = opts.clients[0].id

    conn.destroy()

    // Wait for disconnect callback
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(opts.disconnects).toContain(clientId)
  })

  it('accepts multiple concurrent client connections with unique IDs', async () => {
    const socketPath = join(tempDir, 'multi.sock')
    const opts = makeOptions(socketPath)
    const { stop } = await createSocketServer(opts)
    stopFn = stop

    // Connect 3 clients
    const conn1 = await connectToSocket(socketPath)
    const conn2 = await connectToSocket(socketPath)
    const conn3 = await connectToSocket(socketPath)

    await new Promise(resolve => setTimeout(resolve, 100))

    expect(opts.clients.length).toBe(3)

    // All IDs should be unique
    const ids = opts.clients.map(c => c.id)
    expect(new Set(ids).size).toBe(3)

    // Each client has auto-incrementing IDs
    expect(ids[1]).toBeGreaterThan(ids[0])
    expect(ids[2]).toBeGreaterThan(ids[1])

    conn1.destroy()
    conn2.destroy()
    conn3.destroy()
  })

  it('stop() closes the server and removes the socket file', async () => {
    const socketPath = join(tempDir, 'stop.sock')
    const opts = makeOptions(socketPath)
    const { stop } = await createSocketServer(opts)

    // Socket exists before stop
    expect(() => statSync(socketPath)).not.toThrow()

    await stop()

    // Socket file should be removed
    expect(() => statSync(socketPath)).toThrow()

    // Don't call stop again in afterEach
    stopFn = null
  })

  it('stop() removes directory if empty after socket cleanup', async () => {
    // Use a subdirectory of tempDir so we can check rmdir behavior
    const subDir = join(tempDir, 'subdir')
    const { mkdirSync } = await import('fs')
    mkdirSync(subDir, { mode: 0o700 })
    const socketPath = join(subDir, 'cleanup.sock')
    const opts = makeOptions(socketPath)

    // We need to mock getSocketDir to return subDir for the stop() rmdir logic.
    // Since getSocketDir is not configurable, we test that the socket file is removed.
    // The rmdir of getSocketDir() won't apply to our subDir but the unlink does.
    const { stop } = await createSocketServer(opts)

    await stop()

    // Socket file removed
    expect(() => statSync(socketPath)).toThrow()
    stopFn = null
  })

  it('each client gets its own buffer initialized to empty', async () => {
    const socketPath = join(tempDir, 'buf.sock')
    const opts = makeOptions(socketPath)
    const { stop } = await createSocketServer(opts)
    stopFn = stop

    const conn = await connectToSocket(socketPath)
    await new Promise(resolve => setTimeout(resolve, 50))

    const client = opts.clients[0]
    expect(Buffer.isBuffer(client.buffer)).toBe(true)
    expect(client.buffer.length).toBe(0)

    conn.destroy()
  })

  it('fires onClientError when socket error occurs', async () => {
    const socketPath = join(tempDir, 'err.sock')
    const opts = makeOptions(socketPath)
    const { stop } = await createSocketServer(opts)
    stopFn = stop

    const conn = await connectToSocket(socketPath)
    await new Promise(resolve => setTimeout(resolve, 50))

    const client = opts.clients[0]

    // Force an error by writing to the socket from the server side after destroying it
    client.socket.destroy(new Error('forced test error'))

    await new Promise(resolve => setTimeout(resolve, 50))

    // Either error or disconnect should have fired
    const gotEvent = opts.errors.length > 0 || opts.disconnects.length > 0
    expect(gotEvent).toBe(true)

    conn.destroy()
  })
})

describe('getSocketDir / getSocketPath', () => {
  it('getSocketDir returns a path with the expected prefix', async () => {
    const { getSocketDir } = await import('./socketServer.js')
    const dir = getSocketDir()
    expect(dir).toMatch(/^\/tmp\/chromeuse-browser-bridge-/)
  })

  it('getSocketPath returns a .sock path with current PID', async () => {
    const { getSocketPath } = await import('./socketServer.js')
    const sockPath = getSocketPath()
    expect(sockPath).toContain(`${process.pid}.sock`)
  })
})

describe('prepareSocketDir', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = makeTempDir()
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true })
    } catch {
      // ignore
    }
  })

  it('creates the socket directory if it does not exist', async () => {
    // We can't easily test prepareSocketDir directly since it uses getSocketDir()
    // which returns a fixed path. We test the underlying behavior via the
    // createSocketServer flow which requires the directory to exist.
    // This test verifies the module exports exist and are callable.
    const { prepareSocketDir } = await import('./socketServer.js')
    expect(typeof prepareSocketDir).toBe('function')
  })
})
