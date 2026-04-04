/**
 * Length-prefixed JSON encoding/decoding for the wire protocol.
 *
 * Format: 4-byte little-endian uint32 length prefix + UTF-8 JSON payload.
 *
 * Used for:
 *   - Native Host <-> MCP Server communication over Unix domain sockets
 *   - Chrome handles the Extension <-> Native Host leg automatically
 *
 * Chrome's native messaging imposes a 1 MB per-message limit.
 */

/** Maximum message size in bytes (Chrome native messaging limit) */
export const MAX_MESSAGE_SIZE = 1024 * 1024; // 1 MB

/** Length of the 4-byte header */
const HEADER_SIZE = 4;

/**
 * Encode a message object into a length-prefixed buffer.
 *
 * @param message - JSON-serializable object
 * @returns Buffer with 4-byte LE length prefix followed by UTF-8 JSON
 * @throws Error if the encoded message exceeds MAX_MESSAGE_SIZE
 */
export function encode(message: object): Uint8Array {
  const json = JSON.stringify(message);
  const encoder = new TextEncoder();
  const payload = encoder.encode(json);

  if (payload.byteLength > MAX_MESSAGE_SIZE) {
    throw new Error(
      `Message size ${payload.byteLength} bytes exceeds maximum ${MAX_MESSAGE_SIZE} bytes`
    );
  }

  const buffer = new Uint8Array(HEADER_SIZE + payload.byteLength);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, payload.byteLength, true); // little-endian
  buffer.set(payload, HEADER_SIZE);
  return buffer;
}

/**
 * Result of a successful decode operation.
 */
export interface DecodeResult {
  /** The decoded message object */
  readonly message: unknown;
  /** Total bytes consumed (header + payload), for advancing the read cursor */
  readonly bytesConsumed: number;
}

/**
 * Attempt to decode one length-prefixed message from the front of a buffer.
 *
 * Returns `null` if the buffer does not yet contain a complete message
 * (incomplete header or incomplete payload). This is expected during
 * streaming reads from a socket.
 *
 * @param buffer - Accumulated bytes from the stream
 * @returns Decoded message and bytes consumed, or null if incomplete
 * @throws Error if the declared length exceeds MAX_MESSAGE_SIZE
 */
export function decode(buffer: Uint8Array): DecodeResult | null {
  if (buffer.byteLength < HEADER_SIZE) {
    return null; // incomplete header
  }

  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );
  const payloadLength = view.getUint32(0, true); // little-endian

  if (payloadLength > MAX_MESSAGE_SIZE) {
    throw new Error(
      `Declared message size ${payloadLength} bytes exceeds maximum ${MAX_MESSAGE_SIZE} bytes`
    );
  }

  const totalLength = HEADER_SIZE + payloadLength;

  if (buffer.byteLength < totalLength) {
    return null; // incomplete payload
  }

  const decoder = new TextDecoder();
  const json = decoder.decode(buffer.subarray(HEADER_SIZE, totalLength));
  const message: unknown = JSON.parse(json);

  return { message, bytesConsumed: totalLength };
}
