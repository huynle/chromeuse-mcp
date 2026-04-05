import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  NATIVE_HOST_NAME,
  MANIFEST_FILENAME,
  BROWSER_NATIVE_MESSAGING_PATHS,
  detectPlatform,
  getAllNativeMessagingDirs,
  buildManifest,
  createWrapperScript,
  installManifests,
} from './install.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('uses com.opencode.chrome_bridge as native host name', () => {
    expect(NATIVE_HOST_NAME).toBe('com.opencode.chrome_bridge')
  })

  it('manifest filename matches native host name', () => {
    expect(MANIFEST_FILENAME).toBe('com.opencode.chrome_bridge.json')
  })
})

// ---------------------------------------------------------------------------
// BROWSER_NATIVE_MESSAGING_PATHS
// ---------------------------------------------------------------------------

describe('BROWSER_NATIVE_MESSAGING_PATHS', () => {
  it('defines paths for all 7 browsers', () => {
    const browsers = Object.keys(BROWSER_NATIVE_MESSAGING_PATHS)
    expect(browsers).toEqual(['chrome', 'brave', 'arc', 'edge', 'chromium', 'vivaldi', 'opera'])
    expect(browsers).toHaveLength(7)
  })

  it('has macOS paths for all browsers', () => {
    for (const [browser, paths] of Object.entries(BROWSER_NATIVE_MESSAGING_PATHS)) {
      expect(paths.macos.length, `${browser} should have macOS paths`).toBeGreaterThan(0)
      expect(paths.macos[paths.macos.length - 1]).toBe('NativeMessagingHosts')
    }
  })

  it('has linux paths for all browsers except Arc', () => {
    for (const [browser, paths] of Object.entries(BROWSER_NATIVE_MESSAGING_PATHS)) {
      if (browser === 'arc') {
        expect(paths.linux).toHaveLength(0)
      } else {
        expect(paths.linux.length, `${browser} should have Linux paths`).toBeGreaterThan(0)
        expect(paths.linux[paths.linux.length - 1]).toBe('NativeMessagingHosts')
      }
    }
  })
})

// ---------------------------------------------------------------------------
// detectPlatform
// ---------------------------------------------------------------------------

describe('detectPlatform', () => {
  it('returns macos or linux on supported platforms', () => {
    const result = detectPlatform()
    // Running on macOS or Linux in CI/dev
    expect(result === 'macos' || result === 'linux').toBe(true)
  })
})

// ---------------------------------------------------------------------------
// getAllNativeMessagingDirs
// ---------------------------------------------------------------------------

describe('getAllNativeMessagingDirs', () => {
  it('returns 7 directories for macOS', () => {
    const dirs = getAllNativeMessagingDirs('macos', '/fake/home')
    expect(dirs).toHaveLength(7)
    for (const dir of dirs) {
      expect(dir.path).toContain('/fake/home/')
      expect(dir.path).toContain('NativeMessagingHosts')
    }
  })

  it('returns 6 directories for linux (no Arc)', () => {
    const dirs = getAllNativeMessagingDirs('linux', '/fake/home')
    expect(dirs).toHaveLength(6)
    const browsers = dirs.map(d => d.browser)
    expect(browsers).not.toContain('arc')
  })

  it('uses correct macOS Chrome path', () => {
    const dirs = getAllNativeMessagingDirs('macos', '/Users/test')
    const chrome = dirs.find(d => d.browser === 'chrome')!
    expect(chrome.path).toBe(
      '/Users/test/Library/Application Support/Google/Chrome/NativeMessagingHosts',
    )
  })

  it('uses correct linux Chrome path', () => {
    const dirs = getAllNativeMessagingDirs('linux', '/home/test')
    const chrome = dirs.find(d => d.browser === 'chrome')!
    expect(chrome.path).toBe('/home/test/.config/google-chrome/NativeMessagingHosts')
  })
})

// ---------------------------------------------------------------------------
// buildManifest
// ---------------------------------------------------------------------------

describe('buildManifest', () => {
  it('builds manifest with correct name and type', () => {
    const manifest = buildManifest({ wrapperPath: '/usr/local/bin/host' })
    expect(manifest.name).toBe('com.opencode.chrome_bridge')
    expect(manifest.type).toBe('stdio')
    expect(manifest.path).toBe('/usr/local/bin/host')
    expect(manifest.description).toBe('OpenCode Browser Extension Native Host')
  })

  it('formats allowed_origins from extension IDs', () => {
    const manifest = buildManifest({
      wrapperPath: '/path/to/host',
      extensionIds: ['abc123', 'def456'],
    })
    expect(manifest.allowed_origins).toEqual([
      'chrome-extension://abc123/',
      'chrome-extension://def456/',
    ])
  })

  it('produces empty allowed_origins when no IDs given', () => {
    const manifest = buildManifest({ wrapperPath: '/path/to/host' })
    expect(manifest.allowed_origins).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// createWrapperScript
// ---------------------------------------------------------------------------

describe('createWrapperScript', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'install-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('creates wrapper script with exec command', async () => {
    const wrapperPath = await createWrapperScript('node "/path/to/dist/index.js"', tempDir)

    expect(wrapperPath).toBe(join(tempDir, 'native-host'))

    const content = await readFile(wrapperPath, 'utf-8')
    expect(content).toContain('#!/bin/sh')
    expect(content).toContain('exec node "/path/to/dist/index.js"')
  })

  it('makes wrapper script executable', async () => {
    const wrapperPath = await createWrapperScript('node /test/index.js', tempDir)
    const stats = await stat(wrapperPath)
    // Check executable bit
    expect(stats.mode & 0o111).toBeGreaterThan(0)
  })

  it('skips write when content unchanged', async () => {
    // First write
    await createWrapperScript('node /test/index.js', tempDir)
    const firstStats = await stat(join(tempDir, 'native-host'))

    // Wait a tick to ensure mtime would differ
    await new Promise(r => setTimeout(r, 50))

    // Second write - should be skipped
    await createWrapperScript('node /test/index.js', tempDir)
    const secondStats = await stat(join(tempDir, 'native-host'))

    expect(secondStats.mtimeMs).toBe(firstStats.mtimeMs)
  })
})

// ---------------------------------------------------------------------------
// installManifests
// ---------------------------------------------------------------------------

describe('installManifests', () => {
  let tempDir: string
  let fakeHome: string
  let fakeConfigDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'install-test-'))
    fakeHome = join(tempDir, 'home')
    fakeConfigDir = join(tempDir, 'config')
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('installs manifests to all browser directories on macOS', async () => {
    const result = await installManifests({
      command: 'node /test/index.js',
      extensionIds: ['test-ext-id'],
      platform: 'macos',
      home: fakeHome,
      configDir: fakeConfigDir,
    })

    expect(result.wrapperPath).toBe(join(fakeConfigDir, 'native-host'))
    expect(result.installed).toHaveLength(7) // all 7 browsers on macOS
    expect(result.skipped).toHaveLength(0)

    // Verify one manifest's content
    const chromeManifest = result.installed.find(i => i.browser === 'chrome')!
    const content = JSON.parse(await readFile(chromeManifest.path, 'utf-8'))
    expect(content.name).toBe('com.opencode.chrome_bridge')
    expect(content.type).toBe('stdio')
    expect(content.allowed_origins).toEqual(['chrome-extension://test-ext-id/'])
  })

  it('installs manifests to 6 browser directories on linux (no Arc)', async () => {
    const result = await installManifests({
      command: 'node /test/index.js',
      platform: 'linux',
      home: fakeHome,
      configDir: fakeConfigDir,
    })

    expect(result.installed).toHaveLength(6)
    const browsers = result.installed.map(i => i.browser)
    expect(browsers).not.toContain('arc')
  })

  it('skips manifests that are already up-to-date', async () => {
    // First install
    await installManifests({
      command: 'node /test/index.js',
      extensionIds: ['test-id'],
      platform: 'macos',
      home: fakeHome,
      configDir: fakeConfigDir,
    })

    // Second install - should all be skipped
    const result = await installManifests({
      command: 'node /test/index.js',
      extensionIds: ['test-id'],
      platform: 'macos',
      home: fakeHome,
      configDir: fakeConfigDir,
    })

    expect(result.installed).toHaveLength(0)
    expect(result.skipped).toHaveLength(7)
    for (const s of result.skipped) {
      expect(s.reason).toBe('already up-to-date')
    }
  })

  it('throws on unsupported platform', async () => {
    await expect(
      installManifests({
        command: 'node /test/index.js',
        platform: 'windows' as never,
      }),
    ).rejects.toThrow('Unsupported platform')
  })

  it('creates wrapper script at configDir/native-host', async () => {
    const result = await installManifests({
      command: 'node "/path/to/dist/index.js"',
      platform: 'macos',
      home: fakeHome,
      configDir: fakeConfigDir,
    })

    const wrapperContent = await readFile(result.wrapperPath, 'utf-8')
    expect(wrapperContent).toContain('exec node "/path/to/dist/index.js"')
  })
})
