#!/usr/bin/env node

/**
 * OpenCode Chrome Extension - Native Host Manifest Installer
 *
 * Writes com.opencode.chrome_bridge.json to NativeMessagingHosts directories
 * for all Chromium browsers on macOS and Linux.
 *
 * Adapted from Claude Code's native-host installer with simplified
 * dependencies (no external imports beyond Node builtins).
 */

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ─── Constants ───────────────────────────────────────────────────────────────

export const NATIVE_HOST_NAME = 'com.opencode.chrome_bridge'
export const MANIFEST_FILENAME = `${NATIVE_HOST_NAME}.json`

/** Config directory for OpenCode wrapper scripts */
const CONFIG_DIR = join(homedir(), '.opencode', 'chrome')

// ─── Browser Configuration ──────────────────────────────────────────────────

export type ChromiumBrowser =
  | 'chrome'
  | 'brave'
  | 'arc'
  | 'edge'
  | 'chromium'
  | 'vivaldi'
  | 'opera'

interface BrowserPlatformPaths {
  macos: string[]
  linux: string[]
}

/**
 * NativeMessagingHosts directory path segments (relative to $HOME) for each
 * Chromium-based browser on macOS and Linux.
 */
export const BROWSER_NATIVE_MESSAGING_PATHS: Record<ChromiumBrowser, BrowserPlatformPaths> = {
  chrome: {
    macos: ['Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'],
    linux: ['.config', 'google-chrome', 'NativeMessagingHosts'],
  },
  brave: {
    macos: ['Library', 'Application Support', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'],
    linux: ['.config', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'],
  },
  arc: {
    macos: ['Library', 'Application Support', 'Arc', 'User Data', 'NativeMessagingHosts'],
    linux: [], // Arc not available on Linux
  },
  edge: {
    macos: ['Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts'],
    linux: ['.config', 'microsoft-edge', 'NativeMessagingHosts'],
  },
  chromium: {
    macos: ['Library', 'Application Support', 'Chromium', 'NativeMessagingHosts'],
    linux: ['.config', 'chromium', 'NativeMessagingHosts'],
  },
  vivaldi: {
    macos: ['Library', 'Application Support', 'Vivaldi', 'NativeMessagingHosts'],
    linux: ['.config', 'vivaldi', 'NativeMessagingHosts'],
  },
  opera: {
    macos: ['Library', 'Application Support', 'com.operasoftware.Opera', 'NativeMessagingHosts'],
    linux: ['.config', 'opera', 'NativeMessagingHosts'],
  },
}

// ─── Platform Detection ─────────────────────────────────────────────────────

export type SupportedPlatform = 'macos' | 'linux'

export function detectPlatform(): SupportedPlatform | null {
  const p = platform()
  if (p === 'darwin') return 'macos'
  if (p === 'linux') return 'linux'
  return null
}

// ─── Path Resolution ────────────────────────────────────────────────────────

/**
 * Get all NativeMessagingHosts directories for the current platform.
 * Returns browser name + absolute path pairs.
 */
export function getAllNativeMessagingDirs(
  currentPlatform: SupportedPlatform,
  home: string = homedir(),
): { browser: ChromiumBrowser; path: string }[] {
  const results: { browser: ChromiumBrowser; path: string }[] = []

  for (const [browser, paths] of Object.entries(BROWSER_NATIVE_MESSAGING_PATHS)) {
    const segments = paths[currentPlatform]
    if (segments && segments.length > 0) {
      results.push({
        browser: browser as ChromiumBrowser,
        path: join(home, ...segments),
      })
    }
  }

  return results
}

// ─── Manifest Generation ────────────────────────────────────────────────────

export interface ManifestOptions {
  /** Absolute path to the wrapper script that launches the native host */
  wrapperPath: string
  /** Chrome extension IDs to allow (without chrome-extension:// prefix) */
  extensionIds?: string[]
}

/**
 * Build the native messaging host manifest JSON object.
 */
export function buildManifest(options: ManifestOptions): Record<string, unknown> {
  const allowedOrigins = (options.extensionIds ?? []).map(
    id => `chrome-extension://${id}/`,
  )

  return {
    name: NATIVE_HOST_NAME,
    description: 'OpenCode Browser Extension Native Host',
    path: options.wrapperPath,
    type: 'stdio',
    allowed_origins: allowedOrigins,
  }
}

// ─── Wrapper Script ─────────────────────────────────────────────────────────

/**
 * Create a shell wrapper script that launches the native host binary.
 *
 * Chrome's native host manifest "path" field cannot contain arguments,
 * so we need a wrapper script that calls `exec <command>`.
 *
 * @returns Absolute path to the created wrapper script
 */
export async function createWrapperScript(
  command: string,
  configDir: string = CONFIG_DIR,
): Promise<string> {
  const wrapperPath = join(configDir, 'native-host')

  const scriptContent = `#!/bin/sh
# OpenCode Browser Extension - Native Host wrapper script
# Generated by opencode-native-host installer - do not edit manually
exec ${command}
`

  // Skip write if content hasn't changed
  const existing = await readFile(wrapperPath, 'utf-8').catch(() => null)
  if (existing === scriptContent) {
    return wrapperPath
  }

  await mkdir(configDir, { recursive: true })
  await writeFile(wrapperPath, scriptContent)
  await chmod(wrapperPath, 0o755)

  return wrapperPath
}

// ─── Manifest Installation ──────────────────────────────────────────────────

export interface InstallResult {
  installed: { browser: ChromiumBrowser; path: string }[]
  skipped: { browser: ChromiumBrowser; path: string; reason: string }[]
  wrapperPath: string
}

/**
 * Install native messaging host manifests to all Chromium browser directories.
 *
 * - Creates the wrapper script
 * - Writes the manifest JSON to each browser's NativeMessagingHosts directory
 * - Skips directories where the manifest is already up-to-date
 * - Warns (does not error) on non-writable directories
 */
export async function installManifests(options: {
  /** Command the wrapper script should exec (e.g. "node /path/to/dist/index.js") */
  command: string
  /** Chrome extension IDs to whitelist */
  extensionIds?: string[]
  /** Override platform detection (for testing) */
  platform?: SupportedPlatform
  /** Override home directory (for testing) */
  home?: string
  /** Override config directory (for testing) */
  configDir?: string
}): Promise<InstallResult> {
  const currentPlatform = options.platform ?? detectPlatform()
  if (!currentPlatform || (currentPlatform !== 'macos' && currentPlatform !== 'linux')) {
    throw new Error(
      `Unsupported platform: ${currentPlatform ?? platform()}. Only macOS and Linux are supported.`,
    )
  }

  const home = options.home ?? homedir()
  const configDir = options.configDir ?? CONFIG_DIR

  // Step 1: Create the wrapper script
  const wrapperPath = await createWrapperScript(options.command, configDir)

  // Step 2: Build the manifest
  const manifest = buildManifest({
    wrapperPath,
    extensionIds: options.extensionIds,
  })
  const manifestContent = JSON.stringify(manifest, null, 2) + '\n'

  // Step 3: Write to all browser directories
  const dirs = getAllNativeMessagingDirs(currentPlatform, home)
  const installed: InstallResult['installed'] = []
  const skipped: InstallResult['skipped'] = []

  for (const { browser, path: manifestDir } of dirs) {
    const manifestPath = join(manifestDir, MANIFEST_FILENAME)

    // Check if content matches to avoid unnecessary writes
    const existing = await readFile(manifestPath, 'utf-8').catch(() => null)
    if (existing === manifestContent) {
      skipped.push({ browser, path: manifestPath, reason: 'already up-to-date' })
      continue
    }

    try {
      await mkdir(manifestDir, { recursive: true })
      await writeFile(manifestPath, manifestContent)
      installed.push({ browser, path: manifestPath })
    } catch (error) {
      // Non-writable directories produce warnings, not errors
      const message = error instanceof Error ? error.message : String(error)
      skipped.push({ browser, path: manifestPath, reason: message })
    }
  }

  return { installed, skipped, wrapperPath }
}

// ─── CLI Entry Point ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const currentPlatform = detectPlatform()
  if (!currentPlatform) {
    console.error(`Error: Unsupported platform (${platform()}). Only macOS and Linux are supported.`)
    process.exit(1)
  }

  // Resolve the path to the native host entry point
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const nativeHostBin = resolve(__dirname, 'index.js')

  // Use the full path to the current Node.js binary.
  // Chrome launches native hosts with a minimal environment where PATH
  // may not include Homebrew, nvm, or other user-installed Node locations.
  const nodeBin = process.execPath
  const command = `"${nodeBin}" "${nativeHostBin}"`

  // Extension IDs - the unpacked extension ID will vary per developer,
  // so we allow passing extra IDs via CLI args or env var
  const extensionIds: string[] = []

  // Collect IDs from CLI arguments
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--extension-id=')) {
      extensionIds.push(arg.slice('--extension-id='.length))
    }
  }

  // Collect IDs from environment variable (comma-separated)
  const envIds = process.env.OPENCODE_EXTENSION_IDS
  if (envIds) {
    extensionIds.push(...envIds.split(',').map(id => id.trim()).filter(Boolean))
  }

  if (extensionIds.length === 0) {
    console.warn(
      'Warning: No extension IDs provided. The manifest will have an empty allowed_origins list.\n' +
      'Pass extension IDs via --extension-id=<id> or OPENCODE_EXTENSION_IDS env var.',
    )
  }

  console.log(`Installing native messaging host manifests for ${currentPlatform}...\n`)

  const result = await installManifests({
    command,
    extensionIds,
  })

  console.log(`Wrapper script: ${result.wrapperPath}\n`)

  if (result.installed.length > 0) {
    console.log('Installed:')
    for (const { browser, path } of result.installed) {
      console.log(`  ${browser}: ${path}`)
    }
  }

  if (result.skipped.length > 0) {
    console.log('\nSkipped:')
    for (const { browser, path, reason } of result.skipped) {
      console.log(`  ${browser}: ${reason}`)
    }
  }

  if (result.installed.length === 0 && result.skipped.every(s => s.reason === 'already up-to-date')) {
    console.log('\nAll manifests already up-to-date.')
  } else if (result.installed.length > 0) {
    console.log(`\nSuccessfully installed ${result.installed.length} manifest(s).`)
  }
}

// Run CLI if executed directly
const isDirectExecution = process.argv[1] &&
  resolve(process.argv[1]).includes('install')

if (isDirectExecution) {
  main().catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
}
