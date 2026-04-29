import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  encodeMessage,
  sendChromeMessage,
  tryExtractMessage,
  ChromeMessageReader,
  MessageProtocolError,
  MAX_MESSAGE_SIZE,
} from "./chromeMessageReader.js";

// ---------------------------------------------------------------------------
// encodeMessage
// ---------------------------------------------------------------------------

describe("encodeMessage", () => {
  it("produces 4-byte LE header + UTF-8 JSON payload", () => {
    const data = { hello: "world" };
    const buf = encodeMessage(data);

    const declaredLength = buf.readUInt32LE(0);
    const payload = buf.subarray(4).toString("utf-8");

    expect(JSON.parse(payload)).toEqual(data);
    expect(declaredLength).toBe(Buffer.byteLength(payload, "utf-8"));
    expect(buf.length).toBe(4 + declaredLength);
  });

  it("handles empty object", () => {
    const buf = encodeMessage({});
    const [parsed] = tryExtractMessage(buf);
    expect(parsed).toEqual({});
  });

  it("handles nested objects and arrays", () => {
    const data = { type: "tool_request", params: { request_id: "req-reader-0", tool: "navigate" }, list: [1, 2] };
    const buf = encodeMessage(data);
    const [parsed] = tryExtractMessage(buf);
    expect(parsed).toEqual(data);
  });

  it("handles unicode characters", () => {
    const data = { text: "Hello, world" };
    const buf = encodeMessage(data);
    const [parsed] = tryExtractMessage(buf);
    expect(parsed).toEqual(data);
  });

  it("handles string input", () => {
    const buf = encodeMessage("plain string");
    const payload = buf.subarray(4).toString("utf-8");
    expect(JSON.parse(payload)).toBe("plain string");
  });

  it("throws MessageProtocolError when message exceeds MAX_MESSAGE_SIZE", () => {
    const bigString = "x".repeat(MAX_MESSAGE_SIZE + 1);
    expect(() => encodeMessage({ data: bigString })).toThrow(
      MessageProtocolError
    );
    expect(() => encodeMessage({ data: bigString })).toThrow(/exceeds maximum/);
  });
});

// ---------------------------------------------------------------------------
// sendChromeMessage
// ---------------------------------------------------------------------------

describe("sendChromeMessage", () => {
  const originalWrite = process.stdout.write;
  let writes: Buffer[];

  beforeEach(() => {
    writes = [];
    process.stdout.write = ((chunk: unknown) => {
      writes.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  it("writes length header then JSON payload to stdout", () => {
    const msg = { type: "ping", timestamp: 123 };
    sendChromeMessage(msg);

    expect(writes).toHaveLength(2);

    // First write: 4-byte length header
    const header = writes[0];
    expect(header.length).toBe(4);

    // Second write: JSON payload
    const payload = writes[1];
    const json = payload.toString("utf-8");
    expect(JSON.parse(json)).toEqual(msg);

    // Header matches payload length
    expect(header.readUInt32LE(0)).toBe(payload.length);
  });

  it("accepts a pre-serialized string", () => {
    const json = '{"type":"pong"}';
    sendChromeMessage(json);

    expect(writes).toHaveLength(2);
    const payload = writes[1].toString("utf-8");
    expect(payload).toBe(json);
  });

  it("throws MessageProtocolError when message exceeds MAX_MESSAGE_SIZE", () => {
    const bigString = "x".repeat(MAX_MESSAGE_SIZE + 1);
    expect(() => sendChromeMessage({ data: bigString })).toThrow(
      MessageProtocolError
    );
  });
});

// ---------------------------------------------------------------------------
// tryExtractMessage
// ---------------------------------------------------------------------------

describe("tryExtractMessage", () => {
  it("returns [null, buffer] for buffer shorter than header", () => {
    const buf = Buffer.from([0x05]);
    const [msg, remaining] = tryExtractMessage(buf);
    expect(msg).toBeNull();
    expect(remaining).toBe(buf); // same reference
  });

  it("returns [null, buffer] for complete header but incomplete payload", () => {
    const buf = Buffer.alloc(4 + 2);
    buf.writeUInt32LE(100, 0); // says 100 bytes but only 2 available
    const [msg, remaining] = tryExtractMessage(buf);
    expect(msg).toBeNull();
    expect(remaining).toBe(buf);
  });

  it("extracts a valid message and returns remaining buffer", () => {
    const msg = { type: "ping", timestamp: 42 };
    const encoded = encodeMessage(msg);
    const trailing = Buffer.from([0xde, 0xad]);
    const combined = Buffer.concat([encoded, trailing]);

    const [parsed, remaining] = tryExtractMessage(combined);
    expect(parsed).toEqual(msg);
    expect(remaining.length).toBe(2);
    expect(remaining[0]).toBe(0xde);
  });

  it("extracts message with no remaining bytes", () => {
    const msg = { hello: "world" };
    const encoded = encodeMessage(msg);

    const [parsed, remaining] = tryExtractMessage(encoded);
    expect(parsed).toEqual(msg);
    expect(remaining.length).toBe(0);
  });

  it("throws MessageProtocolError for zero-length message", () => {
    const buf = Buffer.alloc(8);
    buf.writeUInt32LE(0, 0);
    expect(() => tryExtractMessage(buf)).toThrow(MessageProtocolError);
    expect(() => tryExtractMessage(buf)).toThrow(/Invalid message length: 0/);
  });

  it("throws MessageProtocolError when declared length exceeds MAX_MESSAGE_SIZE", () => {
    const buf = Buffer.alloc(8);
    buf.writeUInt32LE(MAX_MESSAGE_SIZE + 1, 0);
    expect(() => tryExtractMessage(buf)).toThrow(MessageProtocolError);
    expect(() => tryExtractMessage(buf)).toThrow(/Invalid message length/);
  });

  it("throws MessageProtocolError for invalid JSON", () => {
    const garbage = Buffer.from("not json!", "utf-8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(garbage.length, 0);
    const buf = Buffer.concat([header, garbage]);

    expect(() => tryExtractMessage(buf)).toThrow(MessageProtocolError);
    expect(() => tryExtractMessage(buf)).toThrow(/Invalid JSON/);
  });

  it("handles multiple messages extracted sequentially", () => {
    const msg1 = { type: "ping", ts: 1 };
    const msg2 = { type: "pong", ts: 2 };
    const msg3 = { type: "get_status" };

    let buf: Buffer = Buffer.concat([
      encodeMessage(msg1),
      encodeMessage(msg2),
      encodeMessage(msg3),
    ]);

    const results: unknown[] = [];
    while (buf.length > 0) {
      const [parsed, remaining] = tryExtractMessage(buf);
      if (parsed === null) break;
      results.push(parsed);
      buf = Buffer.from(remaining);
    }

    expect(results).toEqual([msg1, msg2, msg3]);
    expect(buf.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ChromeMessageReader
// ---------------------------------------------------------------------------

/**
 * Helper to create a mock readable stream (simulating process.stdin).
 */
function createMockStdin(): EventEmitter & { push(chunk: Buffer): void; end(): void; emitError(): void } {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    push(chunk: Buffer) {
      emitter.emit("data", chunk);
    },
    end() {
      emitter.emit("end");
    },
    emitError() {
      emitter.emit("error", new Error("stdin error"));
    },
  });
}

describe("ChromeMessageReader", () => {
  it("reads a single complete message", async () => {
    const mockStdin = createMockStdin();
    const reader = new ChromeMessageReader(mockStdin as unknown as NodeJS.ReadableStream);

    const msg = { type: "ping", timestamp: 1 };
    const encoded = encodeMessage(msg);

    // Start reading, then push data
    const readPromise = reader.read();
    mockStdin.push(encoded);

    const result = await readPromise;
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual(msg);
  });

  it("reads multiple messages sequentially", async () => {
    const mockStdin = createMockStdin();
    const reader = new ChromeMessageReader(mockStdin as unknown as NodeJS.ReadableStream);

    const msg1 = { type: "ping", timestamp: 1 };
    const msg2 = { type: "pong", timestamp: 2 };

    // Push both messages at once (they may arrive together)
    mockStdin.push(Buffer.concat([encodeMessage(msg1), encodeMessage(msg2)]));

    const result1 = await reader.read();
    expect(JSON.parse(result1!)).toEqual(msg1);

    const result2 = await reader.read();
    expect(JSON.parse(result2!)).toEqual(msg2);
  });

  it("handles partial reads (message split across chunks)", async () => {
    const mockStdin = createMockStdin();
    const reader = new ChromeMessageReader(mockStdin as unknown as NodeJS.ReadableStream);

    const msg = { type: "tool_request", params: { request_id: "req-reader-1", tool: "navigate", args: { url: "https://example.com" } } };
    const encoded = encodeMessage(msg);

    // Split the encoded message into multiple chunks
    const mid = Math.floor(encoded.length / 2);
    const chunk1 = encoded.subarray(0, mid);
    const chunk2 = encoded.subarray(mid);

    const readPromise = reader.read();

    // Send first chunk (incomplete message)
    mockStdin.push(chunk1);

    // The read should not resolve yet - use a short delay to check
    let resolved = false;
    readPromise.then(() => {
      resolved = true;
    });

    // Give the event loop a tick
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);

    // Send second chunk (completes the message)
    mockStdin.push(chunk2);

    const result = await readPromise;
    expect(JSON.parse(result!)).toEqual(msg);
  });

  it("handles header split across chunks", async () => {
    const mockStdin = createMockStdin();
    const reader = new ChromeMessageReader(mockStdin as unknown as NodeJS.ReadableStream);

    const msg = { hello: "world" };
    const encoded = encodeMessage(msg);

    // Split within the 4-byte header
    const readPromise = reader.read();
    mockStdin.push(encoded.subarray(0, 2)); // first 2 bytes of header
    await new Promise((r) => setTimeout(r, 10));

    mockStdin.push(encoded.subarray(2)); // rest of header + payload

    const result = await readPromise;
    expect(JSON.parse(result!)).toEqual(msg);
  });

  it("returns null when stdin closes", async () => {
    const mockStdin = createMockStdin();
    const reader = new ChromeMessageReader(mockStdin as unknown as NodeJS.ReadableStream);

    const readPromise = reader.read();
    mockStdin.end();

    const result = await readPromise;
    expect(result).toBeNull();
  });

  it("returns null when stdin errors", async () => {
    const mockStdin = createMockStdin();
    const reader = new ChromeMessageReader(mockStdin as unknown as NodeJS.ReadableStream);

    const readPromise = reader.read();
    mockStdin.emitError();

    const result = await readPromise;
    expect(result).toBeNull();
  });

  it("returns null immediately if already closed", async () => {
    const mockStdin = createMockStdin();
    const reader = new ChromeMessageReader(mockStdin as unknown as NodeJS.ReadableStream);

    mockStdin.end();
    // Give event handler a tick
    await new Promise((r) => setTimeout(r, 10));

    const result = await reader.read();
    expect(result).toBeNull();
  });

  it("reads buffered message before stdin was read", async () => {
    const mockStdin = createMockStdin();
    const reader = new ChromeMessageReader(mockStdin as unknown as NodeJS.ReadableStream);

    const msg = { type: "ping" };
    // Push data BEFORE calling read()
    mockStdin.push(encodeMessage(msg));

    // read() should immediately return the buffered message
    const result = await reader.read();
    expect(JSON.parse(result!)).toEqual(msg);
  });

  it("handles message followed by stdin close", async () => {
    const mockStdin = createMockStdin();
    const reader = new ChromeMessageReader(mockStdin as unknown as NodeJS.ReadableStream);

    const msg = { type: "final" };
    mockStdin.push(encodeMessage(msg));
    mockStdin.end();

    // Should get the message first
    const result1 = await reader.read();
    expect(JSON.parse(result1!)).toEqual(msg);

    // Then null
    const result2 = await reader.read();
    expect(result2).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Round-trip: encodeMessage <-> tryExtractMessage
// ---------------------------------------------------------------------------

describe("round-trip: encodeMessage <-> tryExtractMessage", () => {
  it("encode then extract returns the original message", () => {
    const messages = [
      { type: "ping", timestamp: Date.now() },
      { type: "tool_request", method: "execute_tool", params: { request_id: "req-reader-2", tool: "navigate", args: { url: "https://example.com" } } },
      { type: "tool_response", request_id: "req-reader-2", result: { content: [{ type: "text", text: "OK" }] } },
      { type: "pong", timestamp: 0 },
      { type: "status_response", version: "0.1.0" },
    ];

    for (const msg of messages) {
      const encoded = encodeMessage(msg);
      const [parsed, remaining] = tryExtractMessage(encoded);
      expect(parsed).toEqual(msg);
      expect(remaining.length).toBe(0);
    }
  });
});
