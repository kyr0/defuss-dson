// The binary decoder. Internal module: `decode` in binary.ts and the frame decoders in sequence.ts share it, and an
// export from an entry would be public API.
import * as T from "./tags.js";
import { invalid, type BinaryOptions, type Reader } from "./binary-io.js";
import { BOXES, BYTE_ORDER, ERRORS, ERROR_LOCATION, MAGIC, VIEWS, checkGraph } from "./binary-format.js";

/** An own, enumerable, writable, configurable data property, whatever the prototype chain holds. */
const define = (target: object, key: string, value: unknown): void => {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
};

/** Objects with at most this many keys check duplicates by scanning; see `pairs` in `decode`. */
const SMALL_OBJECT = 32;

/**
 * Decode exactly the one value in the reader's bytes [position, end), under limits the caller has validated.
 * Trailing bytes, unsupported tags and invalid references fail explicitly.
 */
export const decodeValue = (reader: Reader, bound: Required<BinaryOptions>): any => {
  const end = reader.end;
  if (end - reader.position > bound.maxRecordBytes) throw new RangeError("DSON binary: maxRecordBytes exceeded");
  for (const byte of MAGIC) if (reader.u8() !== byte) invalid("unsupported binary header/version");
  const count = reader.count(1);
  if (!count) invalid("empty value table");
  if (count > bound.maxReferences) throw new RangeError("DSON binary: maxReferences exceeded");
  // The same flat lists as in encode: tag, payload and the members' slice of refs, with names at the same positions.
  const tags: number[] = [];
  const payloads: any[] = [];
  const starts: number[] = [];
  const names: string[] = [];
  const refs: number[] = [];
  const values: any[] = [];
  const ref = (): number => {
    const id = reader.u32();
    if (id >= count) invalid("invalid reference");
    return id;
  };
  const link = (): void => { names.push(""); refs.push(ref()); };
  const pairs = (): void => {
    const size = reader.count(8);
    const start = names.length;
    // Why a scan of the earlier keys up to SMALL_OBJECT keys, and a Set above: a Set per small object cost five times
    // the scan, while the Set keeps a large object linear, so untrusted input cannot make this check quadratic.
    // VERIFIED: (probe, 2026-11-16) 64 three-key objects took 2.29 µs with a Set and 0.45 µs scanned on Node.js 26
    // (Bun 1.4: 2.28 and 0.26 µs); 32 keys took 0.58 and 0.30 µs (Bun: 0.49 and 0.35 µs).
    const keys = size > SMALL_OBJECT ? new Set<string>() : undefined;
    for (let i = 0; i < size; i++) {
      const key = reader.name();
      if (keys) {
        if (keys.has(key)) invalid("duplicate property");
        keys.add(key);
      } else for (let j = start; j < start + i; j++) if (names[j] === key) invalid("duplicate property");
      names.push(key);
      refs.push(ref());
    }
  };
  for (let i = 0; i < count; i++) {
    const tag = reader.u8();
    let value: any;
    let data: any;
    const start = refs.length;
    switch (tag) {
      case T.B_NULL: value = null; break;
      case T.B_UNDEFINED: break;
      case T.B_FALSE: value = false; break;
      case T.B_TRUE: value = true; break;
      case T.B_STRING: value = reader.string(); break;
      case T.B_BIGINT: {
        const text = reader.string();
        if (!/^(0|-?[1-9]\d*)$/.test(text)) invalid("invalid bigint");
        value = BigInt(text); break;
      }
      case T.B_FLOAT64: value = reader.f64(); break;
      case T.B_DATE: {
        const time = reader.f64(); value = new Date(time);
        if (!Object.is(value.getTime(), time)) invalid("invalid Date time");
        break;
      }
      case T.B_ARRAY: {
        const length = reader.u32();
        if (length > bound.maxRecordBytes) throw new RangeError("DSON binary: array length exceeds maxRecordBytes");
        value = []; value.length = length; pairs();
        for (let j = start; j < refs.length; j++) {
          const key = names[j];
          if (key === "length" || (/^(0|[1-9]\d*)$/.test(key) && Number(key) < 0xffffffff && Number(key) >= length))
            invalid("invalid array property");
        }
        break;
      }
      case T.B_OBJECT: case T.B_NULL_OBJECT: case T.B_ERROR: {
        if (tag === T.B_ERROR) {
          const type = reader.u8(); const name = reader.string(); const message = reader.string();
          if (type >= ERRORS.length) invalid("unknown Error subtype");
          value = type === 7 ? new AggregateError([], message) : new (ERRORS[type] as ErrorConstructor)(message);
          Object.defineProperty(value, "name", { value: name, writable: true, configurable: true });
        } else value = tag === T.B_OBJECT ? {} : Object.create(null);
        pairs();
        if (tag === T.B_ERROR) for (let j = start; j < refs.length; j++)
          if (names[j] === "name" || names[j] === "message" || ERROR_LOCATION.has(names[j])) invalid("invalid Error property");
        break;
      }
      case T.B_MAP: case T.B_SET: {
        const size = reader.count(4);
        if (tag === T.B_MAP && size % 2) invalid("odd Map reference count");
        for (let j = 0; j < size; j++) link();
        value = tag === T.B_MAP ? new Map() : new Set(); break;
      }
      case T.B_REGEXP: {
        const source = reader.string(); const flags = reader.string();
        try { value = new RegExp(source, flags); } catch { invalid("invalid RegExp"); }
        value.lastIndex = reader.u32(); break;
      }
      // Uint8Array construction copies Buffer inputs too; Buffer.slice() aliases the entire backing slab.
      case T.B_BUFFER: value = new Uint8Array(reader.raw()).buffer; break;
      case T.B_VIEW: data = [reader.u8(), reader.u8(), reader.u32(), reader.u32()]; link(); break;
      case T.B_BOX: data = reader.u8(); link(); break;
      default: invalid(`unknown tag ${tag}`);
    }
    tags.push(tag); payloads.push(data); starts.push(start); values.push(value);
  }
  if (reader.position !== end) invalid("trailing bytes");
  starts.push(refs.length);
  checkGraph(count, starts, refs, bound.maxDepth);
  // Leaves are allocated first; views can then share buffers even when those appear later in the table.
  for (let i = 0; i < count; i++) {
    const tag = tags[i];
    const data = payloads[i];
    if (tag === T.B_VIEW) {
      const [type, order, offset, length] = data;
      const ctor = VIEWS[type];
      const target = refs[starts[i]];
      if (!ctor || tags[target] !== T.B_BUFFER) invalid("invalid view type or buffer");
      const width = ctor.BYTES_PER_ELEMENT ?? 1;
      if ((order !== 0 && order !== 1) || (width > 1 && order !== BYTE_ORDER)) invalid("unsupported view byte order");
      const buffer = values[target];
      if (offset % width || length % width || offset + length > buffer.byteLength) invalid("invalid view range");
      values[i] = new ctor(buffer, offset, length / width);
    } else if (tag === T.B_BOX) {
      const member = values[refs[starts[i]]];
      if (data >= BOXES.length || typeof member !== ["boolean", "number", "string", "bigint"][data]) invalid("invalid boxed primitive");
      values[i] = Object(member);
    }
  }
  for (let i = 0; i < count; i++) {
    const tag = tags[i];
    const value = values[i];
    const start = starts[i];
    const end = starts[i + 1];
    if (tag === T.B_OBJECT || tag === T.B_ARRAY || tag === T.B_NULL_OBJECT) {
      const inherited = tag === T.B_OBJECT ? Object.prototype : tag === T.B_ARRAY ? Array.prototype : null;
      for (let j = start; j < end; j++) {
        const key = names[j];
        const id = refs[j];
        // Assignment creates the same own data property as defineProperty, unless the prototype chain holds the key:
        // then a setter would run (`__proto__` on every object) or a frozen prototype would refuse it, so such keys
        // are defined. Why not define every key: VERIFIED: (probe, 2026-11-16) filling 64 three-key objects took
        // 21.5 µs with defineProperty and 3.6 µs this way on Node.js 26 (Bun 1.4: 3.2 and 0.8 µs). The check trusts
        // the built-in prototypes of this realm; the input cannot change them.
        if (inherited !== null && key in inherited) define(value, key, values[id]);
        else value[key] = values[id];
      }
    } else if (tag === T.B_ERROR) {
      // Errors keep defineProperty: they are rare, and runtimes attach own non-enumerable properties to them (V8:
      // stack; JavaScriptCore: line, column, sourceURL) whose attributes an assignment would keep
      for (let j = start; j < end; j++) define(value, names[j], values[refs[j]]);
    } else if (tag === T.B_MAP) {
      for (let j = start; j < end; j += 2) {
        const key = values[refs[j]];
        if (value.has(key)) invalid("duplicate Map key");
        value.set(key, values[refs[j + 1]]);
      }
    } else if (tag === T.B_SET) {
      for (let j = start; j < end; j++) {
        if (value.has(values[refs[j]])) invalid("duplicate Set member");
        value.add(values[refs[j]]);
      }
    }
  }
  return values[0];
};
