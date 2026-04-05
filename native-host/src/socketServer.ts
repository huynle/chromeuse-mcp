/**
 * Unix Domain Socket Server
 *
 * Manages a secure Unix domain socket for MCP client connections.
 * Socket path: /tmp/opencode-browser-bridge-{user}/{pid}.sock
 * Security: directory 0o700, socket 0o600, stale socket cleanup.
 */

import {
  chmod,
  mkdir,
  readdir,
  rmdir,
  stat,
  unlink,
} from 'fs/promises'
import { createServer, type Server, type Socket } from 'net'
import { platform, userInfo } from 'os'
import { join } from 'path'
import { log } from './log.js'

const SOCKET_DIR_PREFIX = 'opencode-browser-bridge'

function getUsername(): string {
  try {
    return userInfo().username || 'default'
  } catch {
    return process.env.USER || process.env.USERNAME || 'default'
  }
}

/**
 * Get the socket directory path.
 */
export function getSocketDir(): string {
  return `/tmp/${SOCKET_DIR_PREFIX}-${getUsername()}`
}

/**
 * Get the socket path for this process.
 */
export function getSocketPath(): string {
  if (platform() === 'win32') {
    return `\\\\.\\pipe\\${SOCKET_DIR_PREFIX}-${getUsername()}`
  }
  return join(getSocketDir(), `${process.pid}.sock`)
}

/**
 * Prepare the socket directory with secure permissions and clean stale sockets.
 */
export async function prepareSocketDir(): Promise<void> {
  if (platform() === 'win32') {
    return
  }

  const socketDir = getSocketDir()

  // Migrate legacy socket: if socket dir path exists as a file/socket, remove it
  try {
    const dirStats = await stat(socketDir)
    if (!dirStats.isDirectory()) {
      await unlink(socketDir)
    }
  } catch {
    // Doesn't exist, that's fine
  }

  // Create socket directory with secure permissions
  await mkdir(socketDir, { recursive: true, mode: 0o700 })

  // Fix perms if directory already existed
  await chmod(socketDir, 0o700).catch(() => {
    // Ignore
  })

  // Clean up stale sockets
  await cleanupStaleSockets(socketDir)
}

/**
 * Remove socket files for processes that are no longer running.
 */
async function cleanupStaleSockets(socketDir: string): Promise<void> {
  try {
    const files = await readdir(socketDir)
    for (const file of files) {
      if (!file.endsWith('.sock')) {
        continue
      }
      const pid = parseInt(file.replace('.sock', ''), 10)
      if (isNaN(pid)) {
        continue
      }
      try {
        process.kill(pid, 0)
        // Process is alive, leave it
      } catch {
        // Process is dead, remove stale socket
        await unlink(join(socketDir, file)).catch(() => {
          // Ignore
        })
        log(`Removed stale socket for PID ${pid}`)
      }
    }
  } catch {
    // Ignore errors scanning directory
  }
}

export type McpClient = {
  id: number
  socket: Socket
  buffer: Buffer
}

export type SocketServerOptions = {
  socketPath: string
  onClientConnect: (client: McpClient) => void
  onClientData: (client: McpClient, data: Buffer) => void
  onClientDisconnect: (client: McpClient) => void
  onClientError: (client: McpClient, error: Error) => void
}

/**
 * Create and start a Unix domain socket server.
 */
export async function createSocketServer(
  options: SocketServerOptions,
): Promise<{
  server: Server
  stop: () => Promise<void>
}> {
  const { socketPath, onClientConnect, onClientData, onClientDisconnect, onClientError } = options

  const server = createServer(socket => {
    const clientId = nextClientId++
    const client: McpClient = {
      id: clientId,
      socket,
      buffer: Buffer.alloc(0),
    }

    onClientConnect(client)

    socket.on('data', (data: Buffer) => {
      onClientData(client, data)
    })

    socket.on('error', (err: Error) => {
      onClientError(client, err)
    })

    socket.on('close', () => {
      onClientDisconnect(client)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.listen(socketPath, () => {
      log('Socket server listening for connections')
      resolve()
    })

    server.on('error', (err: Error) => {
      log('Socket server error:', err.message)
      reject(err)
    })
  })

  // Set permissions on Unix (after listen resolves so socket file exists)
  if (platform() !== 'win32') {
    try {
      await chmod(socketPath, 0o600)
      log('Socket permissions set to 0600')
    } catch (e) {
      log('Failed to set socket permissions:', (e as Error).message)
    }
  }

  const stop = async (): Promise<void> => {
    await new Promise<void>(resolve => {
      server.close(() => resolve())
    })

    // Cleanup socket file
    if (platform() !== 'win32') {
      try {
        await unlink(socketPath)
        log('Cleaned up socket file')
      } catch {
        // ENOENT is fine
      }

      // Remove directory if empty
      try {
        const socketDir = getSocketDir()
        const remaining = await readdir(socketDir)
        if (remaining.length === 0) {
          await rmdir(socketDir)
          log('Removed empty socket directory')
        }
      } catch {
        // Ignore
      }
    }
  }

  return { server, stop }
}

let nextClientId = 1
