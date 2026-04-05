/**
 * Chrome Native Messaging Protocol (stdin/stdout)
 *
 * Chrome native messaging uses 4-byte little-endian length-prefixed JSON.
 * This module provides:
 *   - ChromeMessageReader: async reader that accumulates stdin chunks
 *   - sendChromeMessage: writes a length-prefixed message to stdout
 *   - encodeMessage: encodes data into a length-prefixed Node.js Buffer
 *   - tryExtractMessage: extracts one message from an accumulated Buffer
 *   - MessageProtocolError: error type for protocol violations
 *
 * The shared package (@opencode-chrome/shared) provides platform-agnostic
 * Uint8Array-based encode/decode. This module provides Buffer-based
 * equivalents needed for Node.js stdin/stdout and socket I/O.
 */

/** Maximum message size in bytes (Chrome native messaging limit) */
export const MAX_MESSAGE_SIZE = 1024 * 1024; // 1 MB

/** Length of the 4-byte header */
const HEADER_SIZE = 4;

/**
 * Protocol-level error for malformed messages.
 */
export class MessageProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageProtocolError";
  }
}

/**
 * Encode a message into a 4-byte LE length-prefixed Buffer.
 *
 * @param data - JSON-serializable value
 * @returns Buffer with 4-byte LE length prefix followed by UTF-8 JSON
 * @throws MessageProtocolError if the encoded message exceeds MAX_MESSAGE_SIZE
 */
export function encodeMessage(data: unknown): Buffer {
  const json = JSON.stringify(data);
  const jsonBytes = Buffer.from(json, "utf-8");

  if (jsonBytes.length > MAX_MESSAGE_SIZE) {
    throw new MessageProtocolError(
      `Message size ${jsonBytes.length} bytes exceeds maximum ${MAX_MESSAGE_SIZE} bytes`
    );
  }

  const lengthBuffer = Buffer.alloc(HEADER_SIZE);
  lengthBuffer.writeUInt32LE(jsonBytes.length, 0);

  return Buffer.concat([lengthBuffer, jsonBytes]);
}

/**
 * Write a length-prefixed JSON message to process.stdout.
 *
 * This is the Chrome native messaging output path: the extension reads
 * from the native host's stdout using the same 4-byte LE framing.
 *
 * @param message - JSON-serializable value to send
 * @throws MessageProtocolError if the encoded message exceeds MAX_MESSAGE_SIZE
 */
export function sendChromeMessage(message: unknown): void {
  const json =
    typeof message === "string" ? message : JSON.stringify(message);
  const jsonBytes = Buffer.from(json, "utf-8");

  if (jsonBytes.length > MAX_MESSAGE_SIZE) {
    throw new MessageProtocolError(
      `Message size ${jsonBytes.length} bytes exceeds maximum ${MAX_MESSAGE_SIZE} bytes`
    );
  }

  const lengthBuffer = Buffer.alloc(HEADER_SIZE);
  lengthBuffer.writeUInt32LE(jsonBytes.length, 0);

  process.stdout.write(lengthBuffer);
  process.stdout.write(jsonBytes);
}

/**
 * Try to extract one length-prefixed message from the front of a buffer.
 *
 * Returns a tuple of [parsed message, remaining buffer].
 * Returns [null, original buffer] if the buffer doesn't contain a complete message.
 *
 * This is useful for socket-based communication where data arrives in
 * arbitrary chunks that may contain partial or multiple messages.
 *
 * @param buffer - Accumulated bytes from a stream
 * @returns Tuple of [parsed message or null, remaining buffer]
 * @throws MessageProtocolError if the declared length exceeds MAX_MESSAGE_SIZE or JSON is invalid
 */
export function tryExtractMessage(
  buffer: Buffer
): [unknown | null, Buffer] {
  if (buffer.length < HEADER_SIZE) {
    return [null, buffer];
  }

  const length = buffer.readUInt32LE(0);

  if (length === 0 || length > MAX_MESSAGE_SIZE) {
    throw new MessageProtocolError(`Invalid message length: ${length}`);
  }

  if (buffer.length < HEADER_SIZE + length) {
    return [null, buffer];
  }

  const messageBytes = buffer.subarray(HEADER_SIZE, HEADER_SIZE + length);
  const remaining = buffer.subarray(HEADER_SIZE + length);

  try {
    const parsed: unknown = JSON.parse(messageBytes.toString("utf-8"));
    return [parsed, remaining];
  } catch (e) {
    throw new MessageProtocolError(
      `Invalid JSON in message: ${(e as Error).message}`
    );
  }
}

/**
 * Async reader for Chrome native messaging stdin.
 *
 * Chrome sends length-prefixed JSON messages to the native host's stdin.
 * This class accumulates stdin chunks and resolves promises as complete
 * messages become available.
 *
 * Usage:
 * ```ts
 * const reader = new ChromeMessageReader();
 * while (true) {
 *   const message = await reader.read();
 *   if (message === null) break; // stdin closed
 *   const parsed = JSON.parse(message);
 *   // handle parsed message
 * }
 * ```
 */
export class ChromeMessageReader {
  private buffer = Buffer.alloc(0);
  private pendingResolve: ((value: string | null) => void) | null = null;
  private closed = false;

  constructor(
    private readonly stdin: NodeJS.ReadableStream = process.stdin
  ) {
    this.stdin.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.tryProcessMessage();
    });

    this.stdin.on("end", () => {
      this.closed = true;
      if (this.pendingResolve) {
        this.pendingResolve(null);
        this.pendingResolve = null;
      }
    });

    this.stdin.on("error", () => {
      this.closed = true;
      if (this.pendingResolve) {
        this.pendingResolve(null);
        this.pendingResolve = null;
      }
    });
  }

  /**
   * Read the next complete message from stdin.
   *
   * @returns The JSON string of the next message, or null if stdin is closed
   */
  async read(): Promise<string | null> {
    if (this.closed && this.buffer.length < HEADER_SIZE) {
      return null;
    }

    // Check if there's already a complete message in the buffer
    if (this.buffer.length >= HEADER_SIZE) {
      const length = this.buffer.readUInt32LE(0);

      if (length > MAX_MESSAGE_SIZE) {
        throw new MessageProtocolError(
          `Message size ${length} bytes exceeds maximum ${MAX_MESSAGE_SIZE} bytes`
        );
      }

      if (this.buffer.length >= HEADER_SIZE + length) {
        const messageBytes = this.buffer.subarray(
          HEADER_SIZE,
          HEADER_SIZE + length
        );
        this.buffer = this.buffer.subarray(HEADER_SIZE + length);
        return messageBytes.toString("utf-8");
      }
    }

    if (this.closed) {
      return null;
    }

    return new Promise<string | null>((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  private tryProcessMessage(): void {
    if (!this.pendingResolve) return;

    if (this.buffer.length < HEADER_SIZE) return;

    const length = this.buffer.readUInt32LE(0);

    if (length > MAX_MESSAGE_SIZE) {
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      this.closed = true;
      // Reject via throwing from read() on next call; for current pending,
      // resolve null to signal closure (the oversized message is unrecoverable)
      resolve(null);
      return;
    }

    if (this.buffer.length < HEADER_SIZE + length) return;

    const messageBytes = this.buffer.subarray(
      HEADER_SIZE,
      HEADER_SIZE + length
    );
    this.buffer = this.buffer.subarray(HEADER_SIZE + length);

    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    resolve(messageBytes.toString("utf-8"));
  }
}
