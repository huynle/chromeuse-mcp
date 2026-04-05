/**
 * Chrome Native Host
 *
 * Bridges Chrome's native messaging protocol (stdin/stdout length-prefixed JSON)
 * to Unix domain sockets for MCP server communication.
 *
 * Message routing:
 *   - Chrome stdin -> handleMessage() -> dispatch by type
 *   - Socket client data -> handleClientData() -> tool_request to Chrome stdout
 *   - tool_response/notification from Chrome -> forward to all socket clients
 *   - ping -> pong, get_status -> status_response
 */

import { z } from 'zod'
import { log } from './log.js'
import {
  encodeMessage,
  sendChromeMessage,
  tryExtractMessage,
  MessageProtocolError,
} from './chromeMessageReader.js'
import {
  createSocketServer,
  getSocketPath,
  prepareSocketDir,
  type McpClient,
} from './socketServer.js'
import type { Server } from 'net'

const VERSION = '1.0.0'

const messageSchema = z
  .object({
    type: z.string(),
  })
  .passthrough()

type ToolRequest = {
  method: string
  params?: unknown
}

export class ChromeNativeHost {
  private mcpClients = new Map<number, McpClient>()
  private server: Server | null = null
  private stopServer: (() => Promise<void>) | null = null
  private running = false
  private socketPath: string | null = null

  async start(): Promise<void> {
    if (this.running) {
      return
    }

    this.socketPath = getSocketPath()

    await prepareSocketDir()

    log(`Creating socket listener: ${this.socketPath}`)

    const { server, stop } = await createSocketServer({
      socketPath: this.socketPath,
      onClientConnect: client => this.handleClientConnect(client),
      onClientData: (client, data) => this.handleClientData(client, data),
      onClientDisconnect: client => this.handleClientDisconnect(client),
      onClientError: (client, err) => this.handleClientError(client, err),
    })

    this.server = server
    this.stopServer = stop
    this.running = true
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return
    }

    // Close all MCP clients
    for (const [, client] of this.mcpClients) {
      client.socket.destroy()
    }
    this.mcpClients.clear()

    // Close server and clean up socket
    if (this.stopServer) {
      await this.stopServer()
      this.stopServer = null
    }
    this.server = null
    this.running = false
  }

  isRunning(): boolean {
    return this.running
  }

  getClientCount(): number {
    return this.mcpClients.size
  }

  async handleMessage(messageJson: string): Promise<void> {
    let rawMessage: unknown
    try {
      rawMessage = JSON.parse(messageJson)
    } catch (e) {
      log('Invalid JSON from Chrome:', (e as Error).message)
      sendChromeMessage({
        type: 'error',
        error: 'Invalid message format',
      })
      return
    }

    const parsed = messageSchema.safeParse(rawMessage)
    if (!parsed.success) {
      log('Invalid message from Chrome:', parsed.error.message)
      sendChromeMessage({
        type: 'error',
        error: 'Invalid message format',
      })
      return
    }
    const message = parsed.data

    log(`Handling Chrome message type: ${message.type}`)

    switch (message.type) {
      case 'ping':
        log('Responding to ping')
        sendChromeMessage({
          type: 'pong',
          timestamp: Date.now(),
        })
        break

      case 'get_status':
        sendChromeMessage({
          type: 'status_response',
          native_host_version: VERSION,
        })
        break

      case 'tool_response': {
        if (this.mcpClients.size > 0) {
          log(
            `Forwarding tool response to ${this.mcpClients.size} MCP clients`,
          )

          // Extract the data portion (everything except 'type')
          const { type: _, ...data } = message
          const encoded = encodeMessage(data)

          for (const [id, client] of this.mcpClients) {
            try {
              client.socket.write(encoded)
            } catch (e) {
              log(`Failed to send to MCP client ${id}:`, (e as Error).message)
            }
          }
        }
        break
      }

      case 'notification': {
        if (this.mcpClients.size > 0) {
          log(
            `Forwarding notification to ${this.mcpClients.size} MCP clients`,
          )

          const { type: _, ...data } = message
          const encoded = encodeMessage(data)

          for (const [id, client] of this.mcpClients) {
            try {
              client.socket.write(encoded)
            } catch (e) {
              log(
                `Failed to send notification to MCP client ${id}:`,
                (e as Error).message,
              )
            }
          }
        }
        break
      }

      default:
        log(`Unknown message type: ${message.type}`)
        sendChromeMessage({
          type: 'error',
          error: `Unknown message type: ${message.type}`,
        })
    }
  }

  private handleClientConnect(client: McpClient): void {
    this.mcpClients.set(client.id, client)
    log(
      `MCP client ${client.id} connected. Total clients: ${this.mcpClients.size}`,
    )

    // Notify Chrome of connection
    sendChromeMessage({
      type: 'mcp_connected',
    })
  }

  private handleClientData(client: McpClient, data: Buffer): void {
    client.buffer = Buffer.concat([client.buffer, data])

    // Process complete messages
    while (client.buffer.length >= 4) {
      try {
        const [message, remaining] = tryExtractMessage(client.buffer)
        if (message === null) {
          break // Incomplete message, wait for more data
        }

        client.buffer = remaining
        const request = message as ToolRequest

        log(
          `Forwarding tool request from MCP client ${client.id}: ${request.method}`,
        )

        // Forward to Chrome
        sendChromeMessage({
          type: 'tool_request',
          method: request.method,
          params: request.params,
        })
      } catch (e) {
        if (e instanceof MessageProtocolError) {
          log(
            `Invalid message from MCP client ${client.id}: ${e.message}`,
          )
          client.socket.destroy()
          return
        }
        log(
          `Failed to parse tool request from MCP client ${client.id}:`,
          (e as Error).message,
        )
        break
      }
    }
  }

  private handleClientDisconnect(client: McpClient): void {
    if (!this.mcpClients.has(client.id)) {
      return // Already removed (e.g. during stop())
    }
    this.mcpClients.delete(client.id)
    log(
      `MCP client ${client.id} disconnected. Remaining clients: ${this.mcpClients.size}`,
    )

    // Notify Chrome of disconnection
    sendChromeMessage({
      type: 'mcp_disconnected',
    })
  }

  private handleClientError(client: McpClient, err: Error): void {
    log(`MCP client ${client.id} error: ${err.message}`)
  }
}
