/**
 * GIF Encoder — runs inside an offscreen document.
 *
 * Listens for messages from the service worker:
 *   { action: 'encode', frames: string[], delay: number, width: number, height: number }
 *
 * Each frame is a base64-encoded PNG or JPEG image.
 * Returns a base64-encoded animated GIF.
 *
 * Uses a minimal GIF89a encoder with LZW compression — no external deps.
 */

// --- Types ---

export interface EncodeRequest {
  action: 'encode'
  frames: string[] // base64 image data (without data URI prefix)
  delay: number // frame delay in centiseconds (1/100th of a second)
  width: number
  height: number
}

export interface EncodeResponse {
  success: boolean
  data?: string // base64 GIF
  error?: string
}

// --- GIF89a Encoder ---

/** Maximum colors in GIF palette */
const MAX_COLORS = 256

/**
 * Quantize RGBA pixel data to a 256-color palette using median-cut-lite.
 * Returns the palette (flat RGB array) and indexed pixel data.
 */
function quantize(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): { palette: number[]; indexed: Uint8Array } {
  const pixelCount = width * height

  // Build frequency map of unique colors (sample if too many pixels)
  const colorMap = new Map<number, number>()
  const step = pixelCount > 100000 ? Math.floor(pixelCount / 50000) : 1

  for (let i = 0; i < pixelCount; i += step) {
    const offset = i * 4
    // Quantize to 5-bit per channel to reduce unique colors
    const r = rgba[offset] >> 3
    const g = rgba[offset + 1] >> 3
    const b = rgba[offset + 2] >> 3
    const key = (r << 10) | (g << 5) | b
    colorMap.set(key, (colorMap.get(key) ?? 0) + 1)
  }

  // Collect all unique quantized colors
  const colors = Array.from(colorMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_COLORS)
    .map(([key]) => [
      ((key >> 10) & 0x1f) << 3,
      ((key >> 5) & 0x1f) << 3,
      (key & 0x1f) << 3,
    ])

  // Pad palette to 256 entries
  while (colors.length < MAX_COLORS) {
    colors.push([0, 0, 0])
  }

  // Flatten palette
  const palette: number[] = []
  for (const [r, g, b] of colors) {
    palette.push(r, g, b)
  }

  // Map each pixel to nearest palette index
  const indexed = new Uint8Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4
    const r = rgba[offset]
    const g = rgba[offset + 1]
    const b = rgba[offset + 2]

    let bestDist = Infinity
    let bestIdx = 0
    for (let j = 0; j < MAX_COLORS; j++) {
      const pr = palette[j * 3]
      const pg = palette[j * 3 + 1]
      const pb = palette[j * 3 + 2]
      const dr = r - pr
      const dg = g - pg
      const db = b - pb
      const dist = dr * dr + dg * dg + db * db
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = j
        if (dist === 0) break
      }
    }
    indexed[i] = bestIdx
  }

  return { palette, indexed }
}

/**
 * LZW compress indexed pixel data for GIF.
 * Returns sub-blocks ready to be written to the GIF stream.
 */
function lzwEncode(indexed: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize
  const eoiCode = clearCode + 1

  const output: number[] = []
  let codeSize = minCodeSize + 1
  let nextCode = eoiCode + 1
  const maxCodeLimit = 4096

  // Initialize code table
  const codeTable = new Map<string, number>()
  for (let i = 0; i < clearCode; i++) {
    codeTable.set(String(i), i)
  }

  // Bit packing state
  let curByte = 0
  let curBit = 0

  function writeBits(code: number, bits: number): void {
    curByte |= code << curBit
    curBit += bits
    while (curBit >= 8) {
      output.push(curByte & 0xff)
      curByte >>= 8
      curBit -= 8
    }
  }

  // Write clear code
  writeBits(clearCode, codeSize)

  if (indexed.length === 0) {
    writeBits(eoiCode, codeSize)
    if (curBit > 0) output.push(curByte & 0xff)
    return packSubBlocks(output)
  }

  let buffer = String(indexed[0])

  for (let i = 1; i < indexed.length; i++) {
    const char = String(indexed[i])
    const combined = buffer + ',' + char

    if (codeTable.has(combined)) {
      buffer = combined
    } else {
      writeBits(codeTable.get(buffer)!, codeSize)

      if (nextCode < maxCodeLimit) {
        codeTable.set(combined, nextCode++)
        if (nextCode > (1 << codeSize) && codeSize < 12) {
          codeSize++
        }
      } else {
        // Reset table
        writeBits(clearCode, codeSize)
        codeTable.clear()
        for (let j = 0; j < clearCode; j++) {
          codeTable.set(String(j), j)
        }
        codeSize = minCodeSize + 1
        nextCode = eoiCode + 1
      }

      buffer = char
    }
  }

  // Write remaining
  writeBits(codeTable.get(buffer)!, codeSize)
  writeBits(eoiCode, codeSize)

  if (curBit > 0) {
    output.push(curByte & 0xff)
  }

  return packSubBlocks(output)
}

/**
 * Pack raw LZW data into GIF sub-blocks (max 255 bytes each).
 */
function packSubBlocks(data: number[]): Uint8Array {
  const blocks: number[] = []
  let offset = 0

  while (offset < data.length) {
    const size = Math.min(255, data.length - offset)
    blocks.push(size)
    for (let i = 0; i < size; i++) {
      blocks.push(data[offset + i])
    }
    offset += size
  }
  blocks.push(0) // Block terminator

  return new Uint8Array(blocks)
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Encode frames into an animated GIF.
 */
function encodeGif(
  frames: { indexed: Uint8Array; palette: number[] }[],
  width: number,
  height: number,
  delay: number,
): Uint8Array {
  const parts: Uint8Array[] = []

  // Use first frame's palette as global palette
  const globalPalette = frames[0].palette

  // --- Header ---
  parts.push(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) // GIF89a

  // --- Logical Screen Descriptor ---
  const lsd = new Uint8Array(7)
  lsd[0] = width & 0xff
  lsd[1] = (width >> 8) & 0xff
  lsd[2] = height & 0xff
  lsd[3] = (height >> 8) & 0xff
  lsd[4] = 0xf7 // Global Color Table flag + 256 colors (2^(7+1))
  lsd[5] = 0 // Background color index
  lsd[6] = 0 // Pixel aspect ratio
  parts.push(lsd)

  // --- Global Color Table (256 * 3 = 768 bytes) ---
  parts.push(new Uint8Array(globalPalette))

  // --- Application Extension (NETSCAPE2.0 for looping) ---
  parts.push(
    new Uint8Array([
      0x21,
      0xff,
      0x0b,
      0x4e,
      0x45,
      0x54,
      0x53,
      0x43,
      0x41,
      0x50,
      0x45, // NETSCAPE
      0x32,
      0x2e,
      0x30, // 2.0
      0x03,
      0x01,
      0x00,
      0x00, // Loop count = 0 (infinite)
      0x00, // Block terminator
    ]),
  )

  // --- Frames ---
  for (const frame of frames) {
    // Graphic Control Extension
    const gce = new Uint8Array(8)
    gce[0] = 0x21 // Extension introducer
    gce[1] = 0xf9 // Graphic control label
    gce[2] = 0x04 // Block size
    gce[3] = 0x00 // Packed: no disposal, no transparency
    gce[4] = delay & 0xff
    gce[5] = (delay >> 8) & 0xff
    gce[6] = 0x00 // Transparent color index
    gce[7] = 0x00 // Block terminator
    parts.push(gce)

    // Image Descriptor
    const id = new Uint8Array(10)
    id[0] = 0x2c // Image separator
    id[1] = 0
    id[2] = 0 // Left
    id[3] = 0
    id[4] = 0 // Top
    id[5] = width & 0xff
    id[6] = (width >> 8) & 0xff
    id[7] = height & 0xff
    id[8] = (height >> 8) & 0xff

    // If frame uses a different palette, use local color table
    const useLocalPalette =
      frame.palette !== globalPalette &&
      !arraysEqual(frame.palette, globalPalette)

    if (useLocalPalette) {
      id[9] = 0x87 // Local Color Table flag + 256 colors
    } else {
      id[9] = 0x00 // No local color table
    }
    parts.push(id)

    // Local Color Table (if different from global)
    if (useLocalPalette) {
      parts.push(new Uint8Array(frame.palette))
    }

    // LZW Minimum Code Size
    parts.push(new Uint8Array([8])) // min code size = 8 for 256 colors

    // LZW-compressed image data
    parts.push(lzwEncode(frame.indexed, 8))
  }

  // --- Trailer ---
  parts.push(new Uint8Array([0x3b]))

  // Concatenate all parts
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0)
  const gif = new Uint8Array(totalLength)
  let offset = 0
  for (const part of parts) {
    gif.set(part, offset)
    offset += part.length
  }

  return gif
}

// --- Image Loading Helpers ---

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = (e) => reject(new Error(`Failed to load image: ${e}`))
    img.src = src
  })
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

// --- Public encode handler ---

export async function handleEncode(
  request: EncodeRequest,
): Promise<EncodeResponse> {
  const { frames: frameData, delay, width, height } = request

  if (!frameData || frameData.length === 0) {
    return { success: false, error: 'No frames provided' }
  }

  const canvas = document.getElementById('canvas') as HTMLCanvasElement
  const ctx = canvas.getContext('2d')!
  canvas.width = width
  canvas.height = height

  // Decode each frame's base64 image to RGBA pixel data
  const decodedFrames: { indexed: Uint8Array; palette: number[] }[] = []

  for (const base64 of frameData) {
    const img = await loadImage(`data:image/jpeg;base64,${base64}`)
    ctx.drawImage(img, 0, 0, width, height)
    const imageData = ctx.getImageData(0, 0, width, height)

    const { palette, indexed } = quantize(imageData.data, width, height)
    decodedFrames.push({ indexed, palette })
  }

  // Encode animated GIF
  const gif = encodeGif(decodedFrames, width, height, delay)

  // Convert to base64
  const base64 = uint8ArrayToBase64(gif)

  return { success: true, data: base64 }
}
