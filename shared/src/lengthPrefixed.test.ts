import { describe, expect, it } from "vitest";
import { encode, decode, MAX_MESSAGE_SIZE } from "./lengthPrefixed.js";

describe("lengthPrefixed", () => {
  describe("encode", () => {
    it("produces 4-byte LE header + UTF-8 JSON payload", () => {
      const msg = { hello: "world" };
      const buf = encode(msg);

      // Read header
      const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const declaredLength = view.getUint32(0, true);

      // Payload should be valid JSON matching the input
      const decoder = new TextDecoder();
      const payload = decoder.decode(buf.subarray(4));
      expect(JSON.parse(payload)).toEqual(msg);

      // Header should match actual payload length
      expect(declaredLength).toBe(payload.length);

      // Total buffer = 4 header + payload
      expect(buf.byteLength).toBe(4 + declaredLength);
    });

    it("handles empty object", () => {
      const buf = encode({});
      const result = decode(buf);
      expect(result).not.toBeNull();
      expect(result!.message).toEqual({});
    });

    it("handles nested objects and arrays", () => {
      const msg = {
        type: "tool_request",
        params: { request_id: "req-1", tool: "navigate", args: { url: "https://example.com" } },
        list: [1, 2, 3],
      };
      const buf = encode(msg);
      const result = decode(buf);
      expect(result!.message).toEqual(msg);
    });

    it("handles unicode characters", () => {
      const msg = { text: "Hello, world" };
      const buf = encode(msg);
      const result = decode(buf);
      expect(result!.message).toEqual(msg);
    });

    it("throws when message exceeds MAX_MESSAGE_SIZE", () => {
      // Create an object whose JSON encoding exceeds 1 MB
      const bigString = "x".repeat(MAX_MESSAGE_SIZE + 1);
      expect(() => encode({ data: bigString })).toThrow(/exceeds maximum/);
    });
  });

  describe("decode", () => {
    it("returns null for empty buffer", () => {
      expect(decode(new Uint8Array(0))).toBeNull();
    });

    it("returns null for incomplete header (< 4 bytes)", () => {
      expect(decode(new Uint8Array([0x05]))).toBeNull();
      expect(decode(new Uint8Array([0x05, 0x00]))).toBeNull();
      expect(decode(new Uint8Array([0x05, 0x00, 0x00]))).toBeNull();
    });

    it("returns null for complete header but incomplete payload", () => {
      // Header says 100 bytes but we only provide 10
      const buf = new Uint8Array(4 + 10);
      const view = new DataView(buf.buffer);
      view.setUint32(0, 100, true);
      expect(decode(buf)).toBeNull();
    });

    it("decodes a valid message and reports bytesConsumed", () => {
      const msg = { type: "ping", timestamp: 12345 };
      const encoded = encode(msg);
      const result = decode(encoded);

      expect(result).not.toBeNull();
      expect(result!.message).toEqual(msg);
      expect(result!.bytesConsumed).toBe(encoded.byteLength);
    });

    it("throws when declared length exceeds MAX_MESSAGE_SIZE", () => {
      const buf = new Uint8Array(8);
      const view = new DataView(buf.buffer);
      view.setUint32(0, MAX_MESSAGE_SIZE + 1, true);
      expect(() => decode(buf)).toThrow(/exceeds maximum/);
    });
  });

  describe("round-trip", () => {
    it("encode then decode returns the original message", () => {
      const messages = [
        { type: "ping", timestamp: Date.now() },
        { type: "tool_request", method: "execute_tool", params: { request_id: "req-2", tool: "navigate", args: { url: "https://example.com" } } },
        { type: "tool_response", request_id: "req-2", result: { content: [{ type: "text", text: "OK" }] } },
        { type: "pong", timestamp: 0 },
        { type: "status_response", version: "0.1.0" },
      ];

      for (const msg of messages) {
        const encoded = encode(msg);
        const decoded = decode(encoded);
        expect(decoded).not.toBeNull();
        expect(decoded!.message).toEqual(msg);
        expect(decoded!.bytesConsumed).toBe(encoded.byteLength);
      }
    });

    it("handles multiple messages concatenated in a stream buffer", () => {
      const msg1 = { type: "ping", timestamp: 1 };
      const msg2 = { type: "pong", timestamp: 2 };
      const msg3 = { type: "get_status" };

      const enc1 = encode(msg1);
      const enc2 = encode(msg2);
      const enc3 = encode(msg3);

      // Concatenate into a single buffer (simulating stream accumulation)
      const combined = new Uint8Array(
        enc1.byteLength + enc2.byteLength + enc3.byteLength
      );
      combined.set(enc1, 0);
      combined.set(enc2, enc1.byteLength);
      combined.set(enc3, enc1.byteLength + enc2.byteLength);

      // Decode messages one at a time, advancing the cursor
      let offset = 0;
      const decoded: unknown[] = [];

      while (offset < combined.byteLength) {
        const result = decode(combined.subarray(offset));
        if (!result) break;
        decoded.push(result.message);
        offset += result.bytesConsumed;
      }

      expect(decoded).toEqual([msg1, msg2, msg3]);
      expect(offset).toBe(combined.byteLength);
    });
  });
});
