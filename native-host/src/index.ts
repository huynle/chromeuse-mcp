#!/usr/bin/env node

/**
 * ChromeUse MCP - Native Messaging Host
 *
 * Entry point for the native messaging host process.
 * Reads Chrome native messages from stdin, forwards them to Unix domain socket clients,
 * and vice versa.
 */

import { ChromeNativeHost } from './chromeNativeHost.js'
import { ChromeMessageReader } from './chromeMessageReader.js'
import { log } from './log.js'

async function main(): Promise<void> {
  log('Initializing...')

  const host = new ChromeNativeHost()
  const messageReader = new ChromeMessageReader()

  // Start the native host server
  await host.start()

  // Process messages from Chrome until stdin closes
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const message = await messageReader.read()
    if (message === null) {
      // stdin closed, Chrome disconnected
      break
    }

    await host.handleMessage(message)
  }

  // Stop the server
  await host.stop()
  log('Shut down cleanly.')
}

main().catch(err => {
  log('Fatal error:', err)
  process.exit(1)
})
