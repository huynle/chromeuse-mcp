/**
 * esbuild configuration for ChromeUse MCP.
 *
 * Bundles four entry points for Chrome MV3:
 *   1. Service Worker (background script) — ESM, no splitting
 *   2. Content Scripts (injected into pages) — IIFE (no module support)
 *   3. Offscreen Document — ESM, no splitting
 *   4. Side Panel — ESM, no splitting
 *
 * Usage:
 *   npx tsx esbuild.config.ts          # Build once
 *   npx tsx esbuild.config.ts --watch   # Watch mode
 */

import * as esbuild from 'esbuild'
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const isWatch = process.argv.includes('--watch')

// ─── Shared options ─────────────────────────────────────────────────────────

const sharedOptions: esbuild.BuildOptions = {
  bundle: true,
  target: 'chrome120',
  format: 'esm',
  sourcemap: true,
  logLevel: 'info',
  outdir: join(__dirname, 'dist'),
  outbase: join(__dirname, 'src'),
}

// ─── Entry points ───────────────────────────────────────────────────────────

/** Service worker: single bundle for the background script */
const serviceWorkerOptions: esbuild.BuildOptions = {
  ...sharedOptions,
  entryPoints: [join(__dirname, 'src/service-worker/index.ts')],
  // Service workers cannot use dynamic imports in Chrome MV3
  splitting: false,
}

/** Content scripts: each must be a standalone file (no imports at runtime) */
const contentScriptOptions: esbuild.BuildOptions = {
  ...sharedOptions,
  entryPoints: [
    join(__dirname, 'src/content-scripts/accessibilityTree.ts'),
    join(__dirname, 'src/content-scripts/markdownDocumentRenderer.ts'),
    join(__dirname, 'src/content-scripts/visualIndicator.ts'),
  ],
  // Content scripts run in page context — no module support
  format: 'iife',
  splitting: false,
}

/** Heavy markdown helpers loaded only by markdownDocumentRenderer when needed. */
const markdownModuleOptions: esbuild.BuildOptions = {
  ...sharedOptions,
  entryPoints: [join(__dirname, 'src/content-scripts/mermaidRenderer.ts')],
  format: 'esm',
  splitting: false,
}

/** Offscreen document: loaded as ES module from offscreen.html */
const offscreenOptions: esbuild.BuildOptions = {
  ...sharedOptions,
  entryPoints: [join(__dirname, 'src/offscreen/offscreen.ts')],
  splitting: false,
}

/** Side panel: loaded as ES module from sidepanel.html */
const sidePanelOptions: esbuild.BuildOptions = {
  ...sharedOptions,
  entryPoints: [join(__dirname, 'src/sidepanel/index.ts')],
  splitting: false,
}

// ─── Static assets ──────────────────────────────────────────────────────────

function copyStaticAssets(): void {
  // Copy offscreen.html to dist/ if it exists
  const offscreenSrc = join(__dirname, 'src/offscreen/offscreen.html')
  const offscreenDest = join(__dirname, 'dist/offscreen/offscreen.html')
  if (existsSync(offscreenSrc)) {
    mkdirSync(dirname(offscreenDest), { recursive: true })
    copyFileSync(offscreenSrc, offscreenDest)
  }
}

// ─── Build ──────────────────────────────────────────────────────────────────

async function build(): Promise<void> {
  if (isWatch) {
    // Watch mode: use esbuild's incremental watch
    const contexts = await Promise.all([
      esbuild.context(serviceWorkerOptions),
      esbuild.context(contentScriptOptions),
      esbuild.context(offscreenOptions),
      esbuild.context(sidePanelOptions),
    ])

    copyStaticAssets()

    await Promise.all(contexts.map((ctx) => ctx.watch()))
    console.log('[esbuild] Watching for changes...')
  } else {
    // One-shot build
    await Promise.all([
      esbuild.build(serviceWorkerOptions),
      esbuild.build(contentScriptOptions),
      esbuild.build(markdownModuleOptions),
      esbuild.build(offscreenOptions),
      esbuild.build(sidePanelOptions),
    ])

    copyStaticAssets()
    console.log('[esbuild] Build complete.')
  }
}

build().catch((err) => {
  console.error(err)
  process.exit(1)
})
