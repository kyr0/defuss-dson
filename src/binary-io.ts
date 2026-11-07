/** Per-value limits; the sequence codec applies them separately to each payload. */
export interface BinaryOptions {
  /** Maximum encoded value size, including its header. Default: 64 MiB. */
  maxRecordBytes?: number;
  /** Maximum first-visit reference path from the root (root depth is zero). Default: 512. */
  maxDepth?: number;
  /** Maximum value-table entries, including primitives. Default: 1,000,000. */
  maxReferences?: number;
}

export const limits = (options: BinaryOptions): Required<BinaryOptions> => {
  const result = { maxRecordBytes: 64 * 1024 * 1024, maxDepth: 512, maxReferences: 1_000_000, ...options };
  for (const [key, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)
      throw new RangeError(`DSON binary: invalid ${key}`);
  }
  return result;
};

export function invalid(message: string): never { throw new TypeError(`DSON binary: ${message}`); }

/** Growth is capped before allocation, including temporary capacity. */
export class Writer {
  bytes = new Uint8Array(0);
  position = 0;
  constructor(readonly maximum: number) {}
  reserve(length: number): number {
    const end = this.position + length;
    if (end > this.maximum) throw new RangeError("DSON binary: maxRecordBytes exceeded");
    if (end > this.bytes.length) {
      const grown = new Uint8Array(Math.min(this.maximum, Math.max(end, 256, this.bytes.length * 2)));
      grown.set(this.bytes);
      this.bytes = grown;
    }
    const start = this.position;
    this.position = end;
    return start;
  }
  u8(value: number): void { const offset = this.reserve(1); this.bytes[offset] = value; }
  u32(value: number): void {
    const offset = this.reserve(4);
    new DataView(this.bytes.buffer).setUint32(offset, value, true);
  }
  f64(value: number): void {
    const offset = this.reserve(8);
    new DataView(this.bytes.buffer).setFloat64(offset, value, true);
  }
  raw(value: Uint8Array): void {
    const offset = this.reserve(value.length);
    this.bytes.set(value, offset);
  }
  string(value: string): void {
    this.u32(value.length);
    const start = this.reserve(value.length * 2);
    const view = new DataView(this.bytes.buffer);
    for (let i = 0; i < value.length; i++) view.setUint16(start + i * 2, value.charCodeAt(i), true);
  }
  finish(): Uint8Array { return this.bytes.slice(0, this.position); }
}

export class Reader {
  position = 0;
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    if (!(bytes instanceof Uint8Array)) invalid("expected Uint8Array");
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  take(length: number): number {
    const start = this.position;
    if (length > this.bytes.length - start) invalid("truncated value");
    this.position += length;
    return start;
  }
  u8(): number { return this.view.getUint8(this.take(1)); }
  u32(): number { return this.view.getUint32(this.take(4), true); }
  f64(): number { return this.view.getFloat64(this.take(8), true); }
  count(width: number): number {
    const count = this.u32();
    if (count > (this.bytes.length - this.position) / width) invalid("invalid length");
    return count;
  }
  raw(): Uint8Array {
    const length = this.count(1);
    return this.bytes.subarray(this.take(length), this.position);
  }
  string(): string {
    const length = this.count(2);
    const start = this.take(length * 2);
    // Bounded pieces avoid argument-count limits without losing lone UTF-16 surrogates.
    const parts: string[] = [];
    for (let i = 0; i < length; i += 4096) {
      const codes: number[] = [];
      for (let j = i; j < Math.min(i + 4096, length); j++) codes.push(this.view.getUint16(start + j * 2, true));
      parts.push(String.fromCharCode(...codes));
    }
    return parts.join("");
  }
}
