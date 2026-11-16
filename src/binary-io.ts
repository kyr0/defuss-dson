/** Per-value limits; the sequence codec applies them separately to each payload. */
export interface BinaryOptions {
  /** Maximum encoded value size, including its header. Default: 64 MiB. */
  maxRecordBytes?: number;
  /** Maximum first-visit reference path from the root (root depth is zero). Default: 512. */
  maxDepth?: number;
  /** Maximum value-table entries, including primitives. Default: 1,000,000. */
  maxReferences?: number;
}

/** Options of `encode` and `encodeFrame`; decoding accepts and ignores `trusted`, so one object can serve both. */
export interface EncodeOptions extends BinaryOptions {
  /**
   * The caller guarantees that the value holds only plain data: every object and array has own enumerable data
   * properties with string keys and nothing else, as object literals and JSON.parse make them, and Maps, Sets, Dates,
   * buffers, views, RegExps and wrapper objects carry no own properties. The encoder then reads keys with Object.keys
   * and values by property access instead of checking each property's descriptor. A value that breaks the guarantee
   * is not rejected: getters run, and non-enumerable properties, symbol keys and extra properties of built-ins are
   * left out. Errors are checked either way. Output for a value that keeps the guarantee is byte-identical.
   * Default: false.
   */
  trusted?: boolean;
}

const bounded = (value: unknown, key: string): void => {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 0xffffffff)
    throw new RangeError(`DSON binary: invalid ${key}`);
};
const LIMITS = ["maxRecordBytes", "maxDepth", "maxReferences"] as const;

/**
 * The three limits with their defaults. Every other own enumerable option except `trusted` must be a bound as well,
 * and the limits are checked first, so a call with several invalid options reports the same one as 1.3.
 * Why field by field instead of spreading the options and walking Object.entries: that took about 100 ns per call,
 * this about 10 ns, and a frame of a small record takes 1.5 µs. VERIFIED: (probe, 2026-11-16, Node.js 26 and Bun 1.4)
 */
export const limits = (options: EncodeOptions): Required<BinaryOptions> => {
  const { trusted } = options;
  if (trusted !== undefined && typeof trusted !== "boolean") throw new RangeError("DSON binary: invalid trusted");
  const result = { maxRecordBytes: 64 * 1024 * 1024, maxDepth: 512, maxReferences: 1_000_000 };
  const keys = Object.keys(options);
  for (const key of keys)
    if (key === "maxRecordBytes" || key === "maxDepth" || key === "maxReferences") result[key] = (options as any)[key];
  for (const key of LIMITS) bounded(result[key], key);
  for (const key of keys)
    if (key !== "trusted" && key !== "maxRecordBytes" && key !== "maxDepth" && key !== "maxReferences") bounded((options as any)[key], key);
  return result;
};

export function invalid(message: string): never { throw new TypeError(`DSON binary: ${message}`); }

/**
 * A UTF-16LE decoder for long strings. `ignoreBOM: true` keeps a leading U+FEFF, which the default would strip.
 * Undefined where TextDecoder or the encoding is missing; strings then take the byte loop. Takes the constructor so
 * the test can pass what a runtime without TextDecoder has: undefined.
 */
export const utf16Decoder = (Decoder: typeof TextDecoder | undefined): TextDecoder | undefined => {
  try { return new Decoder!("utf-16le", { ignoreBOM: true }); } catch { return undefined; }
};
const utf16 = utf16Decoder(globalThis.TextDecoder);
/**
 * From this length on, TextDecoder beats the byte loop. VERIFIED: (probe, 2026-11-16) at 48 ASCII characters the
 * byte loop took 0.182 µs and TextDecoder 0.160 µs on Node.js 26 (Bun 1.4: 0.216 and 0.143 µs); at 1,024 characters
 * 3.1 and 1.5 µs (Bun: 4.2 and 1.6 µs). Below 16 characters the byte loop wins on both.
 */
const LONG_STRING = 48;

/**
 * Recently decoded property names, at most NAME_CHARS code units each, in NAME_SLOTS slots chosen by a hash of their
 * bytes. Why: a runtime interns a string before it uses it as a property key, and an index page repeats the same few
 * names in every entry. A cached name is the string the runtime has already interned, and reading it skips building
 * a new one. Only names are cached, not string values, which rarely repeat and are the caller's data.
 * VERIFIED: (probe, 2026-11-16) reading the 160 names of a 32-entry page and filling objects with them took 11.3 µs
 * with new strings and 7.8 µs from this cache on Node.js 26 (Bun 1.4: 15.5 and 8.0 µs).
 */
const NAME_CHARS = 32;
const NAME_SLOTS = 256;
const names: (string | undefined)[] = Array.from({ length: NAME_SLOTS });

/** The string of the UTF-16LE code units in bytes[start, end), in pieces that keep fromCharCode below argument limits. */
const fromBytes = (bytes: Uint8Array, start: number, end: number): string => {
  let result = "";
  for (let piece = start; piece < end; piece += 8192) {
    const codes: number[] = [];
    for (let at = piece, stop = Math.min(piece + 8192, end); at < stop; at += 2) codes.push(bytes[at] | (bytes[at + 1] << 8));
    result += String.fromCharCode.apply(null, codes);
  }
  return result;
};

export class Reader {
  position = 0;
  /**
   * Reads stop here. Why a movable bound instead of a Reader per subarray: a batch of frames shares one Reader, which
   * moves `position` and `end` to each header and payload, so a frame costs no DataView and no option check.
   * VERIFIED: (probe, 2026-11-17) 32 decodeFrame calls on 48-byte frames took 11.0 µs with the shared reader and 17.5 µs
   * with a reader per header and payload on Node.js 26 (Bun 1.4: 8.4 and 11.4 µs).
   */
  end: number;
  readonly view: DataView;
  /** Whether TextDecoder may read these bytes: browsers refuse views of a SharedArrayBuffer. */
  private readonly decodable: boolean;
  constructor(readonly bytes: Uint8Array) {
    if (!(bytes instanceof Uint8Array)) invalid("expected Uint8Array");
    this.end = bytes.length;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.decodable = utf16 !== undefined && bytes.buffer instanceof ArrayBuffer;
  }
  take(length: number): number {
    const start = this.position;
    if (length > this.end - start) invalid("truncated value");
    this.position += length;
    return start;
  }
  u8(): number { return this.view.getUint8(this.take(1)); }
  u32(): number { return this.view.getUint32(this.take(4), true); }
  f64(): number { return this.view.getFloat64(this.take(8), true); }
  count(width: number): number {
    const count = this.u32();
    if (count > (this.end - this.position) / width) invalid("invalid length");
    return count;
  }
  raw(): Uint8Array {
    const length = this.count(1);
    return this.bytes.subarray(this.take(length), this.position);
  }
  /**
   * UTF-16LE code units as written, lone surrogates included. Why two paths: TextDecoder is fastest for long strings
   * but replaces every lone surrogate with U+FFFD, so it only reads strings without any surrogate; the byte loop
   * reads everything else. Why bytes instead of view.getUint16 per character: VERIFIED: (probe, 2026-11-16) 64 index
   * keys took 11.1 µs with getUint16 and 4.3 µs from the bytes on Node.js 26 (Bun 1.4: 6.9 and 4.3 µs).
   */
  string(): string { return this.text(this.count(2)); }
  private text(length: number): string {
    const start = this.take(length * 2);
    const end = start + length * 2;
    const bytes = this.bytes;
    if (length >= LONG_STRING && this.decodable) {
      let at = start + 1;
      while (at < end && (bytes[at] < 0xd8 || bytes[at] > 0xdf)) at += 2;
      if (at >= end) return utf16!.decode(bytes.subarray(start, end));
    }
    return fromBytes(bytes, start, end);
  }
  /** A property name: the same code units as `string()`, from the name cache when it holds them. */
  name(): string {
    const length = this.count(2);
    if (length > NAME_CHARS) return this.text(length);
    const start = this.take(length * 2);
    const end = start + length * 2;
    const bytes = this.bytes;
    let hash = length;
    for (let at = start; at < end; at += 2) hash = Math.imul(hash ^ (bytes[at] | (bytes[at + 1] << 8)), 0x9e3779b1);
    const slot = hash >>> 24; // the top 8 bits: one of the NAME_SLOTS = 256 slots
    const cached = names[slot];
    if (cached !== undefined && cached.length === length) {
      let i = 0;
      for (let at = start; i < length && cached.charCodeAt(i) === (bytes[at] | (bytes[at + 1] << 8)); at += 2) i++;
      if (i === length) return cached;
    }
    return (names[slot] = fromBytes(bytes, start, end));
  }
}
