import { describe, it, expect } from "vitest";
import { encode } from "./binary.js";
import { encodeFrame, decodeFrame, decodeFrames, inspectFrame, SequenceDecoder, FRAME_HEADER_BYTES } from "./sequence.js";
import { checksum } from "./crc32c.js";

const join = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};
// A bitwise reference implementation checks the production table-based CRC independently.
const crc = (bytes: Uint8Array): number => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0x82f63b78 : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
};
const repairHeader = (bytes: Uint8Array) => new DataView(bytes.buffer).setUint32(12, crc(bytes.subarray(0, 12)), true);

describe("framed sequences", () => {
  it("pins headers and checksums, with independent binary payloads", () => {
    expect(crc(new TextEncoder().encode("123456789"))).toBe(0xe3069283);
    const bytes = encodeFrame(new Uint8Array([10, 0, 255, 10]));
    expect([...bytes.subarray(0, 4)]).toEqual([68, 83, 81, 1]);
    expect(bytes.subarray(FRAME_HEADER_BYTES)).toEqual(encode(new Uint8Array([10, 0, 255, 10])));
    const info = inspectFrame(bytes.subarray(0, 16));
    expect(info).toEqual({ offset: 0, byteLength: bytes.length, payloadOffset: 16, payloadLength: bytes.length - 16,
      checksum: crc(bytes.subarray(16)) });
    expect(new DataView(bytes.buffer).getUint32(12, true)).toBe(crc(bytes.subarray(0, 12)));
    expect(decodeFrame(bytes).value).toEqual(new Uint8Array([10, 0, 255, 10]));
  });

  it("computes CRC32C for every length and alignment that the 16-byte steps and the byte tail meet", () => {
    expect(checksum(new TextEncoder().encode("123456789"))).toBe(0xe3069283);
    const bytes = Uint8Array.from({ length: 4099 }, (_, i) => (i * 131 + 7) & 255);
    for (let start = 0; start < 4; start++) for (let end = start; end <= 80; end++)
      expect(checksum(bytes.subarray(start, end)), `${start}..${end}`).toBe(crc(bytes.subarray(start, end)));
    expect(checksum(bytes)).toBe(crc(bytes));
  });

  it("decodes every two-way and three-way split, including empty chunks and exact boundaries", () => {
    const cyclic: any = {}; cyclic.self = cyclic;
    const first = encodeFrame(cyclic); const second = encodeFrame("\n"); const bytes = join(first, second);
    for (let a = 0; a <= bytes.length; a++) for (let b = a; b <= bytes.length; b++) {
      const decoder = new SequenceDecoder();
      const records = [...decoder.push(bytes.subarray(0, a)), ...decoder.push(bytes.subarray(a, b)), ...decoder.push(bytes.subarray(b))];
      decoder.finish();
      expect(records.length).toBe(2); expect(records[0].value.self).toBe(records[0].value); expect(records[1].value).toBe("\n");
      expect(records.map(r => r.offset)).toEqual([0, first.length]); expect(records.map(r => r.index)).toEqual([0, 1]);
      expect(records[1].byteLength).toBe(second.length);
    }
    const decoder = new SequenceDecoder({ startOffset: 500 });
    const result = [...bytes].flatMap(byte => decoder.push(new Uint8Array([byte])));
    decoder.finish(); expect(result[0].offset).toBe(500); expect(result[1].payloadOffset).toBe(500 + first.length + 16);
  });

  it("supports ordinal/key offset indexes and skips payloads without decoding", () => {
    const values = [{ id: "a", value: 1n }, { id: "b", value: new Map([[1, 2]]) }, { id: "c", value: undefined }];
    const bytes = join(...values.map(value => encodeFrame(value)));
    const decoder = new SequenceDecoder(); const records = decoder.push(bytes); decoder.finish();
    const keys = new Map(records.map(record => [record.value.id, record.offset]));
    for (const [index, record] of records.entries()) {
      expect(decodeFrame(bytes, record.offset).value).toEqual(values[index]);
      expect(inspectFrame(bytes, record.offset).byteLength).toBe(record.byteLength);
    }
    expect(decodeFrame(bytes, keys.get("b")!).value.value.get(1)).toBe(2);
    let offset = 0;
    for (const record of records) { expect(offset).toBe(record.offset); offset += inspectFrame(bytes, offset).byteLength; }
    expect(offset).toBe(bytes.length);
    const repeated: any = {}; repeated.self = repeated;
    const independent = new SequenceDecoder().push(join(encodeFrame(repeated), encodeFrame(repeated)));
    expect(independent[0].value).not.toBe(independent[1].value);
  });

  it("decodes a batch of frames at recorded offsets, in the given order, as decodeFrame does one by one", () => {
    const cyclic: any = { id: "c" }; cyclic.self = cyclic;
    const values = [{ id: "a", at: new Date(0) }, "\n", cyclic, new Map([[1n, new Uint8Array([7])]])];
    const frames = values.map(value => encodeFrame(value));
    const bytes = join(new Uint8Array(3), ...frames);
    const offsets: number[] = [];
    for (let offset = 3; offset < bytes.length; offset += inspectFrame(bytes, offset).byteLength) offsets.push(offset);
    const order = [offsets[2], offsets[0], offsets[3], offsets[2]];
    const batch = decodeFrames(bytes, order);
    expect(batch).toEqual(order.map(offset => decodeFrame(bytes, offset)));
    expect(batch.map(frame => frame.offset)).toEqual(order);
    expect(batch[0].value.self).toBe(batch[0].value);
    expect(batch[3].value).not.toBe(batch[0].value);
    expect(decodeFrames(bytes, Uint32Array.from(offsets)).map(frame => frame.value)).toEqual(values);
    expect(decodeFrames(bytes, [])).toEqual([]);
    // the limits apply to each frame, not to their sum
    const largest = Math.max(...frames.map(frame => frame.length)) - FRAME_HEADER_BYTES;
    expect(decodeFrames(bytes, offsets, { maxRecordBytes: largest })).toHaveLength(4);
    expect(() => decodeFrames(bytes, offsets, { maxRecordBytes: largest - 1 })).toThrow(/maxRecordBytes/);
  });

  it("rejects any invalid frame, offset or option of a batch", () => {
    const bytes = join(encodeFrame({ a: 1 }), encodeFrame([1, 2]));
    const second = inspectFrame(bytes).byteLength;
    for (let i = 0; i < bytes.length; i++) {
      const corrupted = bytes.slice(); corrupted[i] ^= 1;
      expect(() => decodeFrames(corrupted, [0, second])).toThrow(TypeError);
    }
    expect(() => decodeFrames(bytes, [0, 1])).toThrow(TypeError);
    expect(() => decodeFrames(bytes, [0, bytes.length])).toThrow(/truncated/);
    expect(() => decodeFrames(bytes.subarray(0, bytes.length - 1), [0, second])).toThrow(/truncated frame payload/);
    for (const offset of [-1, 0.5, NaN]) expect(() => decodeFrames(bytes, [0, offset])).toThrow(RangeError);
    expect(() => decodeFrames(bytes, [0], { maxDepth: -1 })).toThrow(RangeError);
    expect(() => decodeFrames(bytes, [0], { maxReferences: 1 })).toThrow(/maxReferences/);
    expect(() => decodeFrames([] as any, [])).toThrow(TypeError);
  });

  it("bounds each payload by its frame length, also when later frames follow in the same input", () => {
    // A payload whose last string claims more characters than the frame holds, with valid checksums:
    // the reader must stop at the frame's end instead of reading the next frame's bytes.
    const frame = encodeFrame("abcd");
    const short = frame.slice(0, frame.length - 2);
    new DataView(short.buffer).setUint32(4, short.length - FRAME_HEADER_BYTES, true);
    new DataView(short.buffer).setUint32(8, crc(short.subarray(FRAME_HEADER_BYTES)), true); repairHeader(short);
    const bytes = join(short, encodeFrame("next"));
    expect(() => decodeFrame(bytes)).toThrow(/truncated value|invalid length/);
    expect(() => decodeFrames(bytes, [0])).toThrow(/truncated value|invalid length/);
    expect(() => new SequenceDecoder().push(bytes)).toThrow(/truncated value|invalid length/);
  });

  it("copies incomplete fragments so the caller may reuse its chunk buffer", () => {
    const bytes = encodeFrame(new Uint8Array(100).fill(10));
    const decoder = new SequenceDecoder(); const first = bytes.slice(0, 20);
    expect(decoder.push(first)).toEqual([]); first.fill(255);
    const rest = bytes.slice(20); const result = decoder.push(rest); rest.fill(255);
    decoder.finish(); expect(result[0].value).toEqual(new Uint8Array(100).fill(10));
    const bufferInput = (globalThis as any).Buffer.from(encodeFrame(new Uint8Array([1, 2, 3]).buffer));
    const direct = decodeFrame(bufferInput).value;
    const streaming = new SequenceDecoder().push(bufferInput)[0].value;
    bufferInput.fill(99);
    expect([...new Uint8Array(direct)]).toEqual([1, 2, 3]);
    expect([...new Uint8Array(streaming)]).toEqual([1, 2, 3]);
  });

  it("waits for every partial frame and rejects it only at finalization", () => {
    const bytes = encodeFrame({ value: 1 });
    for (let end = 1; end < bytes.length; end++) {
      const decoder = new SequenceDecoder(); expect(decoder.push(bytes.subarray(0, end))).toEqual([]);
      expect(() => decoder.finish()).toThrow(/incomplete final frame/);
      expect(() => decoder.push(bytes)).toThrow(/closed/); expect(() => decoder.finish()).toThrow(/closed/);
      expect(() => decodeFrame(bytes.subarray(0, end))).toThrow(TypeError);
    }
    const empty = new SequenceDecoder(); expect(empty.push(new Uint8Array())).toEqual([]); empty.finish();
    expect(() => empty.push(bytes)).toThrow(/closed/); expect(() => empty.finish()).toThrow(/closed/);
    const tail = new SequenceDecoder(); expect(tail.push(join(bytes, bytes.subarray(0, 1)))).toHaveLength(1);
    expect(() => tail.finish()).toThrow(/incomplete/);
  });

  it("rejects corruption in every byte and fails closed", () => {
    const bytes = encodeFrame({ a: new Uint8Array([0, 10, 255]), b: 1n });
    for (let i = 0; i < bytes.length; i++) {
      const corrupted = bytes.slice(); corrupted[i] ^= 1;
      expect(() => decodeFrame(corrupted)).toThrow(TypeError);
      const decoder = new SequenceDecoder(); expect(() => decoder.push(corrupted)).toThrow(TypeError);
      expect(() => decoder.push(bytes)).toThrow(/closed/); expect(() => decoder.finish()).toThrow(/closed/);
    }
    const badPayload = bytes.slice(); badPayload[16] = 0;
    new DataView(badPayload.buffer).setUint32(8, crc(badPayload.subarray(16)), true); repairHeader(badPayload);
    expect(() => decodeFrame(badPayload)).toThrow(/binary header/);
  });

  it("bounds allocation from headers and validates offsets and options", () => {
    const bytes = encodeFrame(null);
    for (const length of [0, 8, 0xffffffff]) {
      const altered = bytes.slice(0, 16); new DataView(altered.buffer).setUint32(4, length, true); repairHeader(altered);
      expect(() => new SequenceDecoder().push(altered)).toThrow(/frame length|maxRecordBytes/);
    }
    expect(() => new SequenceDecoder({ maxRecordBytes: 8 }).push(bytes.subarray(0, 16))).toThrow(/maxRecordBytes/);
    expect(() => inspectFrame(bytes, 0, { maxDepth: -1 })).toThrow(RangeError);
    expect(() => new SequenceDecoder({ maxReferences: 0 }).push(bytes)).toThrow(/maxReferences/);
    for (const offset of [-1, 0.5, NaN, Infinity]) {
      expect(() => inspectFrame(bytes, offset)).toThrow(RangeError);
      expect(() => new SequenceDecoder({ startOffset: offset })).toThrow(RangeError);
    }
    expect(() => new SequenceDecoder({ startOffset: Number.MAX_SAFE_INTEGER }).push(bytes)).toThrow(/offset/);
    expect(() => inspectFrame([] as any)).toThrow(TypeError);
    expect(() => new SequenceDecoder().push([] as any)).toThrow(TypeError);
    expect(() => inspectFrame(bytes, bytes.length)).toThrow(TypeError);
    expect(() => encodeFrame(() => 0)).toThrow(TypeError);
  });
});
