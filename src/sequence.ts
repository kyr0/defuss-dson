import { encode, decode, type BinaryOptions } from "./binary.js";
import { invalid, limits, Reader } from "./binary-io.js";

/** Each frame has its own version, length, payload CRC32C, and header CRC32C. */
export const FRAME_HEADER_BYTES = 16;
const MAGIC = [68, 83, 81, 1];
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) * 0x82f63b78);
  return crc >>> 0;
});
const checksum = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
};

export interface FrameMetadata {
  /** Absolute frame-header offset, in bytes. */
  offset: number;
  /** Header and payload bytes; add to offset to skip this frame. */
  byteLength: number;
  payloadOffset: number;
  payloadLength: number;
  /** Unmasked CRC32C of the binary payload. Detects damage, not malicious tampering. */
  checksum: number;
}
export interface DecodedFrame extends FrameMetadata { value: any }
export interface SequenceRecord extends DecodedFrame { /** Zero-based ordinal within this decoder. */ index: number }
export interface SequenceOptions extends BinaryOptions {
  /** Absolute offset of the first input byte. Default: zero. */
  startOffset?: number;
}

const offsetCheck = (offset: number): void => {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError("DSON sequence: invalid offset");
};

const metadata = (header: Uint8Array, offset: number, maxRecordBytes: number): FrameMetadata => {
  offsetCheck(offset);
  const reader = new Reader(header);
  for (const byte of MAGIC) if (reader.u8() !== byte) invalid("unsupported sequence header/version");
  const payloadLength = reader.u32();
  const crc = reader.u32();
  if (reader.u32() !== checksum(header.subarray(0, 12))) invalid("header checksum mismatch");
  if (payloadLength > maxRecordBytes) throw new RangeError("DSON sequence: maxRecordBytes exceeded");
  if (payloadLength < 9) invalid("invalid frame length");
  const byteLength = FRAME_HEADER_BYTES + payloadLength;
  offsetCheck(offset + byteLength);
  return { offset, byteLength, payloadOffset: offset + FRAME_HEADER_BYTES, payloadLength, checksum: crc };
};

/** Encode a complete independent record; concatenating results creates a sequence. */
export const encodeFrame = (value: unknown, options: BinaryOptions = {}): Uint8Array => {
  const payload = encode(value, options);
  const bytes = new Uint8Array(FRAME_HEADER_BYTES + payload.length);
  bytes.set(MAGIC);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, payload.length, true);
  view.setUint32(8, checksum(payload), true);
  view.setUint32(12, checksum(bytes.subarray(0, 12)), true);
  bytes.set(payload, FRAME_HEADER_BYTES);
  return bytes;
};

/** Inspect a header without reading/decoding its payload. Payload integrity is checked by decodeFrame. */
export const inspectFrame = (bytes: Uint8Array, offset = 0, options: BinaryOptions = {}): FrameMetadata => {
  const bound = limits(options);
  new Reader(bytes);
  offsetCheck(offset);
  return metadata(bytes.subarray(offset, offset + FRAME_HEADER_BYTES), offset, bound.maxRecordBytes);
};

const readPayload = (payload: Uint8Array, info: FrameMetadata, options: BinaryOptions): DecodedFrame => {
  if (payload.length !== info.payloadLength) invalid("truncated frame payload");
  if (checksum(payload) !== info.checksum) invalid("payload checksum mismatch");
  return { ...info, value: decode(payload, options) };
};

/** Decode one frame at a recorded offset; later frames in bytes are left unread. */
export const decodeFrame = (bytes: Uint8Array, offset = 0, options: BinaryOptions = {}): DecodedFrame => {
  const info = inspectFrame(bytes, offset, options);
  return readPayload(bytes.subarray(info.payloadOffset, offset + info.byteLength), info, options);
};

/**
 * Retains at most one incomplete frame, copying input fragments so callers may reuse chunk buffers.
 * push() returns completed records. finish() rejects partial input. Any failure closes the decoder;
 * callers needing recovery choose the next trusted offset and create another decoder.
 */
export class SequenceDecoder {
  private readonly options: Required<BinaryOptions>;
  private readonly header = new Uint8Array(FRAME_HEADER_BYTES);
  private headerUsed = 0;
  private pending: Uint8Array | undefined;
  private payloadUsed = 0;
  private info: FrameMetadata | undefined;
  private offset: number;
  private index = 0;
  private closed = false;

  constructor({ startOffset = 0, ...options }: SequenceOptions = {}) {
    offsetCheck(startOffset);
    this.offset = startOffset;
    this.options = limits(options);
  }

  push(chunk: Uint8Array): SequenceRecord[] {
    if (this.closed) invalid("sequence decoder is closed");
    try {
      new Reader(chunk);
      const records: SequenceRecord[] = [];
      let position = 0;
      while (position < chunk.length) {
        if (!this.info) {
          const take = Math.min(FRAME_HEADER_BYTES - this.headerUsed, chunk.length - position);
          this.header.set(chunk.subarray(position, position + take), this.headerUsed);
          this.headerUsed += take;
          position += take;
          if (this.headerUsed < FRAME_HEADER_BYTES) break;
          this.info = metadata(this.header, this.offset, this.options.maxRecordBytes);
        }
        const info = this.info;
        const available = chunk.length - position;
        let payload: Uint8Array;
        if (!this.pending && available >= info.payloadLength) {
          payload = chunk.subarray(position, position + info.payloadLength);
          position += info.payloadLength;
        } else {
          this.pending ??= new Uint8Array(info.payloadLength);
          const take = Math.min(info.payloadLength - this.payloadUsed, available);
          this.pending.set(chunk.subarray(position, position + take), this.payloadUsed);
          this.payloadUsed += take;
          position += take;
          if (this.payloadUsed < info.payloadLength) break;
          payload = this.pending;
        }
        records.push({ ...readPayload(payload, info, this.options), index: this.index++ });
        this.offset += info.byteLength;
        this.headerUsed = 0;
        this.payloadUsed = 0;
        this.pending = undefined;
        this.info = undefined;
      }
      return records;
    } catch (error) {
      this.closed = true;
      this.pending = undefined;
      throw error;
    }
  }

  finish(): void {
    if (this.closed) invalid("sequence decoder is closed");
    this.closed = true;
    this.pending = undefined;
    if (this.headerUsed) invalid("incomplete final frame");
  }
}
