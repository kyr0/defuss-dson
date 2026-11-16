// The binary encoder. Internal module: `encode` in binary.ts and `encodeFrame` in sequence.ts are its public faces.
import * as T from "./tags.js";
import { invalid, limits, type EncodeOptions } from "./binary-io.js";
import { BOXES, BYTE_ORDER, ERRORS, ERROR_LOCATION, MAGIC, VIEWS, checkGraph } from "./binary-format.js";

/**
 * A fixed list of data properties avoids executing getters or losing symbol/non-enumerable state. Writes the names to
 * `names` from index `at` on and the values to `members` from index 0 on, and returns their count.
 * `from` skips that many leading own keys; see the typed array branch of `encode`.
 * Why string names and symbols in two calls instead of Reflect.ownKeys: V8 lists the names of a plain object from a
 * cache but builds Reflect.ownKeys anew each time. Symbols are checked after the names, as Reflect.ownKeys lists them
 * last, so a value with several faults reports the same one as before.
 * VERIFIED: (probe, 2026-11-16) for the 64 small objects of an index page, Reflect.ownKeys took 6.1 µs and the two
 * calls 1.6 µs on Node.js 26; on Bun 1.4 both took 0.4 µs.
 */
const properties = (value: object, names: string[], at: number, members: unknown[], skip?: (key: string) => boolean,
  omit?: ReadonlySet<string>, from = 0): number => {
  const keys = Object.getOwnPropertyNames(value);
  let count = 0;
  for (let i = from; i < keys.length; i++) {
    const key = keys[i];
    // V8 has a lazy stack accessor; Bun/WebKit also attach non-enumerable source locations.
    // Omitting diagnostic fields without reading them avoids invoking getters or disclosing sender paths.
    if (omit?.has(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor)) invalid("accessors are unsupported");
    if (skip === undefined || !skip(key)) {
      if (!descriptor.enumerable) invalid("non-enumerable properties are unsupported");
      names[at + count] = key;
      members[count++] = descriptor.value;
    }
  }
  if (Object.getOwnPropertySymbols(value).length) invalid("symbol keys are unsupported");
  return count;
};

const noExtras = (value: object, skip?: (key: string) => boolean, from = 0): void => {
  if (properties(value, [], 0, [], skip, undefined, from)) invalid("custom properties on this built-in are unsupported");
};

/**
 * The element count of a typed array from the %TypedArray%.prototype getter. Why not `item.length`: an own `length`
 * property could claim more elements than exist and hide custom properties from the check.
 */
const elementCount = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Int8Array.prototype), "length")!.get!;

/** The encoder's working lists; see `encodeInto`. */
interface Lists { source: any[]; tags: number[]; payloads: any[]; starts: number[]; names: string[]; refs: number[]; members: unknown[] }
const lists = (): Lists => ({ source: [], tags: [], payloads: [], starts: [], names: [], refs: [], members: [] });
/** Lists a finished call left for the next one, and the most entries they may keep. */
let spare: Lists | undefined = lists();
const SPARE_ENTRIES = 4096;

/**
 * Encode one strict value graph after `header` zero bytes, which `encodeFrame` fills with its frame header, so a
 * frame needs no second buffer and copy. No toJSON calls, global settings, or I/O.
 * The value table lives in flat lists, one slot per entry: its tag, its payload, its size in bytes is summed as the
 * walk goes, and its members are the slice [starts[i], starts[i + 1]) of `refs`, with property names at the same
 * positions of `names`. The bytes are then written into one buffer of exactly that size, through local functions
 * without bounds checks: the size is exact, and src/binary.test.ts pins it for every kind of entry. Why not one object
 * per entry, a growing buffer and a writer object that checks every write: those were the remaining costs per value,
 * and a module of the database built this way encoded index pages 10 to 45 % faster.
 * VERIFIED: (probe, 2026-11-16) that module took 30 µs per 32-entry page on Node.js 26 and 20 µs on Bun 1.4, against
 * 33 and 28 µs here before the flat lists, and 18.2 against 22.3 µs on Bun (medians of 5) before this writing scheme.
 * Why one DataView per buffer instead of one per write: allocating a view for every u32 and f64 took a fifth of the
 * time of encodeFrame on an index page, more than any other function. VERIFIED: (cpu profile, 2026-11-16, Node.js 26)
 * Writer.u32 had 20 % of the self time, and Writer.string, which also built a view per call, 12 %.
 * Why the lists outlive a call: growing seven new arrays per call was the last difference to that module on Bun.
 * A call takes the spare lists, so a nested call from a getter or a Proxy trap gets new ones, writes them by index
 * from 0, and on success empties every slot that held a value or a name of the caller before it hands them back; a
 * failed call drops them. Lists that grew past SPARE_ENTRIES are dropped too, so one large value does not pin memory.
 * VERIFIED: (probe, 2026-11-16, Bun 1.4, medians of 9 alternating processes) a 32-entry page took 23.5 µs with new
 * arrays per call and 20.6 µs with reused lists; the module took 20.3 µs. Node.js 26 measured no difference.
 */
export const encodeInto = (value: unknown, options: EncodeOptions, header: number): Uint8Array => {
  const bound = limits(options);
  const work = spare ?? lists();
  spare = undefined;
  const { source, tags, payloads, starts, names, refs, members } = work;
  const trusted = options.trusted === true;
  let used = 0; // entries in source
  let top = 0; // entries in refs and names
  let width = 0; // most members one object had
  const ids = new Map<any, number>();
  const reference = (item: any): number => {
    // one lookup instead of has() and get(); -0 finds the entry of 0 there (SameValueZero), so it is excluded
    const known = ids.get(item);
    if (known !== undefined && !Object.is(item, -0)) return known;
    if (used >= bound.maxReferences) throw new RangeError("DSON binary: maxReferences exceeded");
    const id = used++;
    source[id] = item;
    if (!Object.is(item, -0)) ids.set(item, id);
    return id;
  };
  reference(value);
  let size = 8; // magic and entry count
  const entry = (i: number, tag: number, payload: unknown, start: number, bytes: number): void => {
    tags[i] = tag; payloads[i] = payload; starts[i] = start;
    size += 1 + bytes;
  };
  // A trusted object's own enumerable string keys in the order Object.getOwnPropertyNames gives them.
  const own = (item: any): number => {
    const keys = Object.keys(item);
    for (let i = 0; i < keys.length; i++) { names[top + i] = keys[i]; members[i] = item[keys[i]]; }
    return keys.length;
  };
  // Member references are taken after all names were read, as before, so the table order is unchanged.
  const pairs = (i: number, tag: number, payload: unknown, count: number, bytes: number): void => {
    const start = top;
    if (count > width) width = count;
    bytes += 4;
    for (let j = 0; j < count; j++) {
      refs[start + j] = reference(members[j]);
      bytes += 8 + names[start + j].length * 2;
    }
    top += count;
    entry(i, tag, payload, start, bytes);
  };
  // Members without a name (Map, Set, view, wrapper) keep `names` aligned with `refs` through an empty slot.
  const link = (id: number): void => { names[top] = ""; refs[top++] = id; };
  const textSize = (value: string): number => 4 + value.length * 2;
  for (let i = 0; i < used; i++) {
    const item = source[i];
    const start = top;
    if (item === null) { entry(i, T.B_NULL, undefined, start, 0); continue; }
    switch (typeof item) {
      case "undefined": entry(i, T.B_UNDEFINED, undefined, start, 0); continue;
      case "boolean": entry(i, item ? T.B_TRUE : T.B_FALSE, undefined, start, 0); continue;
      case "string": entry(i, T.B_STRING, item, start, textSize(item)); continue;
      case "number": entry(i, T.B_FLOAT64, item, start, 8); continue;
      case "bigint": { const digits = String(item); entry(i, T.B_BIGINT, digits, start, textSize(digits)); continue; }
      case "function": case "symbol": invalid("functions and symbols are unsupported");
    }
    const proto = Object.getPrototypeOf(item);
    if (proto === Object.prototype || proto === null) {
      pairs(i, proto === null ? T.B_NULL_OBJECT : T.B_OBJECT, undefined, trusted ? own(item) : properties(item, names, top, members), 0);
    } else if (proto === Array.prototype) {
      if (!Array.isArray(item)) invalid("invalid Array instance");
      if (item.length > bound.maxRecordBytes) throw new RangeError("DSON binary: array length exceeds maxRecordBytes");
      const count = trusted ? own(item) : properties(item, names, top, members, (key) => key === "length");
      pairs(i, T.B_ARRAY, item.length, count, 4);
    } else if (proto === Map.prototype || proto === Set.prototype) {
      if (!trusted) noExtras(item);
      if (proto === Map.prototype) for (const [key, member] of item) { link(reference(key)); link(reference(member)); }
      else for (const member of item) link(reference(member));
      entry(i, proto === Map.prototype ? T.B_MAP : T.B_SET, undefined, start, 4 + (top - start) * 4);
    } else if (proto === ArrayBuffer.prototype) {
      if (!trusted) noExtras(item);
      // Reading the native byteLength getter also rejects objects merely inheriting ArrayBuffer.prototype.
      const bytes = new Uint8Array(item, 0, item.byteLength);
      entry(i, T.B_BUFFER, bytes, start, 4 + bytes.length);
    } else if (proto === Date.prototype) {
      if (!trusted) noExtras(item);
      entry(i, T.B_DATE, item.getTime(), start, 8);
    } else if (proto === RegExp.prototype) {
      if (!trusted) noExtras(item, (key) => key === "lastIndex");
      if (!Number.isSafeInteger(item.lastIndex) || item.lastIndex < 0 || item.lastIndex > 0xffffffff)
        invalid("RegExp lastIndex must be uint32");
      entry(i, T.B_REGEXP, [item.source, item.flags, item.lastIndex], start, textSize(item.source) + textSize(item.flags) + 4);
    } else if (ArrayBuffer.isView(item)) {
      const type = VIEWS.findIndex((ctor) => ctor && proto === ctor.prototype);
      if (type < 0) invalid("unsupported view prototype");
      // A typed array lists its element indices first, in order (ECMA-262, TypedArray [[OwnPropertyKeys]]), so only
      // the keys after them can be custom properties. Why not test every key: that read one descriptor and ran one
      // regex per element. VERIFIED: (cpu profile, 2026-11-16, Node.js 26) it took 79 % of encoding 256 records that
      // each hold a 256-byte Uint8Array.
      if (!trusted) noExtras(item, undefined, type === 0 ? 0 : elementCount.call(item));
      const payload = [type, BYTE_ORDER, item.byteOffset, item.byteLength];
      link(reference(item.buffer));
      entry(i, T.B_VIEW, payload, start, 14);
    } else {
      const error = ERRORS.findIndex((ctor) => proto === ctor.prototype);
      const box = BOXES.findIndex((ctor) => proto === ctor.prototype);
      if (error >= 0) {
        let count = properties(item, names, top, members, (key) => ["name", "message", "cause", "errors"].includes(key), ERROR_LOCATION);
        if (Object.prototype.toString.call(item) !== "[object Error]") invalid("invalid Error instance");
        for (const key of ["cause", "errors"]) if (Object.hasOwn(item, key)) { names[top + count] = key; members[count++] = item[key]; }
        if (typeof item.name !== "string" || typeof item.message !== "string") invalid("invalid Error fields");
        pairs(i, T.B_ERROR, [error, item.name, item.message], count, 1 + textSize(item.name) + textSize(item.message));
      } else if (box >= 0) {
        if (!trusted) noExtras(item, (key) => box === 2 && (key === "length" || (/^(0|[1-9]\d*)$/.test(key) && Number(key) < item.length)));
        link(reference((BOXES[box].prototype as any).valueOf.call(item)));
        entry(i, T.B_BOX, box, start, 5);
      } else invalid("unsupported object prototype");
    }
  }
  const count = used;
  starts[count] = top;
  // A first visit's depth is at most the number of other entries, and encode creates no unreachable entry, so only a
  // table with more than maxDepth + 1 entries needs the walk. Index pages and records stay below the default 512.
  if (count > bound.maxDepth + 1) checkGraph(count, starts, refs, bound.maxDepth);
  if (size > bound.maxRecordBytes) throw new RangeError("DSON binary: maxRecordBytes exceeded");
  const bytes = new Uint8Array(header + size);
  const view = new DataView(bytes.buffer);
  let at = header;
  const u32 = (value: number): void => { view.setUint32(at, value, true); at += 4; };
  /**
   * UTF-16LE code units, lone surrogates included, written byte by byte: no view call per character. Four characters
   * per step: JavaScript engines do not vectorize this loop, but unrolling saves loop overhead.
   * VERIFIED: (probe, 2026-11-16) 64 index keys took 1.93 µs one character per step and 1.62 µs four per step on
   * Node.js 26 (Bun 1.4: 0.96 and 0.65 µs; 20,000 characters 15.0 and 8.4 µs).
   */
  const text = (value: string): void => {
    const length = value.length;
    u32(length);
    let i = 0;
    for (const end = length - 3; i < end; i += 4) {
      const a = value.charCodeAt(i), b = value.charCodeAt(i + 1), c = value.charCodeAt(i + 2), d = value.charCodeAt(i + 3);
      bytes[at] = a & 0xff; bytes[at + 1] = a >>> 8; bytes[at + 2] = b & 0xff; bytes[at + 3] = b >>> 8;
      bytes[at + 4] = c & 0xff; bytes[at + 5] = c >>> 8; bytes[at + 6] = d & 0xff; bytes[at + 7] = d >>> 8;
      at += 8;
    }
    for (; i < length; i++) {
      const code = value.charCodeAt(i);
      bytes[at++] = code & 0xff;
      bytes[at++] = code >>> 8;
    }
  };
  const named = (start: number, end: number): void => {
    u32(end - start);
    for (let j = start; j < end; j++) { text(names[j]); u32(refs[j]); }
  };
  bytes.set(MAGIC, at); at += 4;
  u32(count);
  for (let i = 0; i < count; i++) {
    const tag = tags[i];
    const data = payloads[i];
    const start = starts[i];
    const end = starts[i + 1];
    bytes[at++] = tag;
    switch (tag) {
      case T.B_STRING: case T.B_BIGINT: text(data); break;
      case T.B_FLOAT64: case T.B_DATE: view.setFloat64(at, data, true); at += 8; break;
      case T.B_ARRAY: u32(data); named(start, end); break;
      case T.B_OBJECT: case T.B_NULL_OBJECT: named(start, end); break;
      case T.B_MAP: case T.B_SET: u32(end - start); for (let j = start; j < end; j++) u32(refs[j]); break;
      case T.B_ERROR: bytes[at++] = data[0]; text(data[1]); text(data[2]); named(start, end); break;
      case T.B_REGEXP: text(data[0]); text(data[1]); u32(data[2]); break;
      case T.B_BUFFER: u32(data.length); bytes.set(data, at); at += data.length; break;
      case T.B_VIEW: bytes[at++] = data[0]; bytes[at++] = data[1]; u32(data[2]); u32(data[3]); u32(refs[start]); break;
      case T.B_BOX: bytes[at++] = data; u32(refs[start]); break;
    }
  }
  // this call succeeded: empty what held the caller's values and names, then keep the lists if they stayed small
  source.fill(undefined, 0, used);
  payloads.fill(undefined, 0, used);
  names.fill("", 0, top);
  members.fill(undefined, 0, width);
  if (used <= SPARE_ENTRIES && top <= SPARE_ENTRIES) spare = work;
  return bytes;
};
