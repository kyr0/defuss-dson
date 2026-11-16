// Test helper: writes the binary format's primitives into a growing buffer, so tests can build malformed input byte
// by byte. Production code writes through the encoder in binary-encode.ts, which sizes its buffer exactly.
export class Writer {
  private bytes = new Uint8Array(256);
  private position = 0;
  private reserve(length: number): number {
    if (this.position + length > this.bytes.length) {
      const grown = new Uint8Array(Math.max(this.bytes.length * 2, this.position + length));
      grown.set(this.bytes);
      this.bytes = grown;
    }
    const start = this.position;
    this.position += length;
    return start;
  }
  u8(value: number): void { this.bytes[this.reserve(1)] = value; }
  u32(value: number): void { const at = this.reserve(4); new DataView(this.bytes.buffer).setUint32(at, value, true); }
  f64(value: number): void { const at = this.reserve(8); new DataView(this.bytes.buffer).setFloat64(at, value, true); }
  raw(value: Uint8Array): void { this.bytes.set(value, this.reserve(value.length)); }
  string(value: string): void {
    this.u32(value.length);
    for (let i = 0; i < value.length; i++) { this.u8(value.charCodeAt(i) & 0xff); this.u8(value.charCodeAt(i) >>> 8); }
  }
  finish(): Uint8Array { return this.bytes.slice(0, this.position); }
}
