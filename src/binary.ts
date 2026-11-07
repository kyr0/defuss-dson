import * as T from "./tags.js";
import { Reader, Writer, invalid, limits, type BinaryOptions } from "./binary-io.js";
export type { BinaryOptions } from "./binary-io.js";

// These positions are wire subtypes, including the optional Float16Array slot.
const VIEW_NAMES = ["DataView", "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
  "Int32Array", "Uint32Array", "Float16Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array"] as const;
const VIEWS = VIEW_NAMES.map((name) => (globalThis as any)[name]);
const ERRORS = [Error, EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError, AggregateError];
const BOXES = [Boolean, Number, String, BigInt];
const ERROR_LOCATION = new Set(["stack", "line", "column", "sourceURL", "originalLine", "originalColumn"]);
const BYTE_ORDER = new Uint8Array(new Uint16Array([1]).buffer)[0];
const MAGIC = [68, 83, 66, 1];
type Entry = [string, number];
interface Node { tag: number; data: any; refs: number[] }
const node = (tag: number, data: any = undefined, refs: number[] = []): Node => ({ tag, data, refs });

/** A fixed list of data properties avoids executing getters or losing symbol/non-enumerable state. */
const properties = (value: object, skip: (key: string) => boolean = () => false, omit?: ReadonlySet<string>): [string, any][] => {
  const entries: [string, any][] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") invalid("symbol keys are unsupported");
    // V8 has a lazy stack accessor; Bun/WebKit also attach non-enumerable source locations.
    // Omitting diagnostic fields without reading them avoids invoking getters or disclosing sender paths.
    if (omit?.has(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor)) invalid("accessors are unsupported");
    if (!skip(key)) {
      if (!descriptor.enumerable) invalid("non-enumerable properties are unsupported");
      entries.push([key, descriptor.value]);
    }
  }
  return entries;
};

const noExtras = (value: object, skip?: (key: string) => boolean): void => {
  if (properties(value, skip).length) invalid("custom properties on this built-in are unsupported");
};

/** Explicit DFS bounds first visits, so cycles do not make depth infinite. Also rejects unreachable table entries. */
const checkGraph = (nodes: Node[], maxDepth: number): void => {
  const seen = new Set<number>();
  const stack = [{ id: 0, depth: 0, next: -1 }];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.next === -1) {
      if (seen.has(frame.id)) { stack.pop(); continue; }
      if (frame.depth > maxDepth) throw new RangeError("DSON binary: maxDepth exceeded");
      seen.add(frame.id);
      frame.next = 0;
    }
    const refs = nodes[frame.id].refs;
    if (frame.next === refs.length) stack.pop();
    else stack.push({ id: refs[frame.next++], depth: frame.depth + 1, next: -1 });
  }
  if (seen.size !== nodes.length) invalid("unreachable value table entry");
};

/** Encode one strict value graph. No toJSON calls, global settings, or I/O. */
export const encode = (value: unknown, options: BinaryOptions = {}): Uint8Array => {
  const bound = limits(options);
  const source: any[] = [];
  const ids = new Map<any, number>();
  const reference = (item: any): number => {
    if (!Object.is(item, -0) && ids.has(item)) return ids.get(item)!;
    if (source.length >= bound.maxReferences) throw new RangeError("DSON binary: maxReferences exceeded");
    const id = source.push(item) - 1;
    if (!Object.is(item, -0)) ids.set(item, id);
    return id;
  };
  reference(value);
  const nodes: Node[] = [];
  const objectNode = (tag: number, entries: [string, any][], prefix?: any): Node => {
    const pairs = entries.map(([key, member]): Entry => [key, reference(member)]);
    return node(tag, { prefix, pairs }, pairs.map(([, id]) => id));
  };
  for (let i = 0; i < source.length; i++) {
    const item = source[i];
    if (item === null) { nodes.push(node(T.B_NULL)); continue; }
    switch (typeof item) {
      case "undefined": nodes.push(node(T.B_UNDEFINED)); continue;
      case "boolean": nodes.push(node(item ? T.B_TRUE : T.B_FALSE)); continue;
      case "string": nodes.push(node(T.B_STRING, item)); continue;
      case "number": nodes.push(node(T.B_FLOAT64, item)); continue;
      case "bigint": nodes.push(node(T.B_BIGINT, String(item))); continue;
      case "function": case "symbol": invalid("functions and symbols are unsupported");
    }
    const proto = Object.getPrototypeOf(item);
    if (proto === Object.prototype || proto === null) {
      nodes.push(objectNode(proto === null ? T.B_NULL_OBJECT : T.B_OBJECT, properties(item)));
    } else if (proto === Array.prototype) {
      if (!Array.isArray(item)) invalid("invalid Array instance");
      if (item.length > bound.maxRecordBytes) throw new RangeError("DSON binary: array length exceeds maxRecordBytes");
      nodes.push(objectNode(T.B_ARRAY, properties(item, (key) => key === "length"), item.length));
    } else if (proto === Map.prototype || proto === Set.prototype) {
      noExtras(item);
      const refs: number[] = [];
      if (proto === Map.prototype) for (const [key, member] of item) refs.push(reference(key), reference(member));
      else for (const member of item) refs.push(reference(member));
      nodes.push(node(proto === Map.prototype ? T.B_MAP : T.B_SET, undefined, refs));
    } else if (proto === ArrayBuffer.prototype) {
      noExtras(item);
      // Reading the native byteLength getter also rejects objects merely inheriting ArrayBuffer.prototype.
      nodes.push(node(T.B_BUFFER, new Uint8Array(item, 0, item.byteLength)));
    } else if (proto === Date.prototype) {
      noExtras(item);
      nodes.push(node(T.B_DATE, item.getTime()));
    } else if (proto === RegExp.prototype) {
      noExtras(item, (key) => key === "lastIndex");
      if (!Number.isSafeInteger(item.lastIndex) || item.lastIndex < 0 || item.lastIndex > 0xffffffff)
        invalid("RegExp lastIndex must be uint32");
      nodes.push(node(T.B_REGEXP, [item.source, item.flags, item.lastIndex]));
    } else if (ArrayBuffer.isView(item)) {
      const type = VIEWS.findIndex((ctor) => ctor && proto === ctor.prototype);
      if (type < 0) invalid("unsupported view prototype");
      noExtras(item, (key) => type !== 0 && /^(0|[1-9]\d*)$/.test(key));
      nodes.push(node(T.B_VIEW, [type, BYTE_ORDER, item.byteOffset, item.byteLength], [reference(item.buffer)]));
    } else {
      const error = ERRORS.findIndex((ctor) => proto === ctor.prototype);
      const box = BOXES.findIndex((ctor) => proto === ctor.prototype);
      if (error >= 0) {
        const entries = properties(item, (key) => ["name", "message", "cause", "errors"].includes(key), ERROR_LOCATION);
        if (Object.prototype.toString.call(item) !== "[object Error]") invalid("invalid Error instance");
        for (const key of ["cause", "errors"]) if (Object.hasOwn(item, key)) entries.push([key, item[key]]);
        if (typeof item.name !== "string" || typeof item.message !== "string") invalid("invalid Error fields");
        nodes.push(objectNode(T.B_ERROR, entries, [error, item.name, item.message]));
      } else if (box >= 0) {
        noExtras(item, (key) => box === 2 && (key === "length" || (/^(0|[1-9]\d*)$/.test(key) && Number(key) < item.length)));
        nodes.push(node(T.B_BOX, box, [reference((BOXES[box].prototype as any).valueOf.call(item))]));
      } else invalid("unsupported object prototype");
    }
  }
  checkGraph(nodes, bound.maxDepth);
  const writer = new Writer(bound.maxRecordBytes);
  writer.raw(new Uint8Array(MAGIC));
  writer.u32(nodes.length);
  const pairs = (entries: Entry[]): void => {
    writer.u32(entries.length);
    for (const [key, id] of entries) { writer.string(key); writer.u32(id); }
  };
  for (const { tag, data, refs } of nodes) {
    writer.u8(tag);
    switch (tag) {
      case T.B_STRING: case T.B_BIGINT: writer.string(data); break;
      case T.B_FLOAT64: case T.B_DATE: writer.f64(data); break;
      case T.B_ARRAY: writer.u32(data.prefix); pairs(data.pairs); break;
      case T.B_OBJECT: case T.B_NULL_OBJECT: pairs(data.pairs); break;
      case T.B_MAP: case T.B_SET:
        writer.u32(refs.length); for (const id of refs) writer.u32(id); break;
      case T.B_ERROR:
        writer.u8(data.prefix[0]); writer.string(data.prefix[1]); writer.string(data.prefix[2]); pairs(data.pairs); break;
      case T.B_REGEXP: writer.string(data[0]); writer.string(data[1]); writer.u32(data[2]); break;
      case T.B_BUFFER: writer.u32(data.length); writer.raw(data); break;
      case T.B_VIEW:
        writer.u8(data[0]); writer.u8(data[1]); writer.u32(data[2]); writer.u32(data[3]); writer.u32(refs[0]); break;
      case T.B_BOX: writer.u8(data); writer.u32(refs[0]); break;
    }
  }
  return writer.finish();
};

/** Decode exactly one value. Trailing bytes, unsupported tags and invalid references fail explicitly. */
export const decode = (bytes: Uint8Array, options: BinaryOptions = {}): any => {
  const bound = limits(options);
  const reader = new Reader(bytes);
  if (bytes.length > bound.maxRecordBytes) throw new RangeError("DSON binary: maxRecordBytes exceeded");
  for (const byte of MAGIC) if (reader.u8() !== byte) invalid("unsupported binary header/version");
  const count = reader.count(1);
  if (!count) invalid("empty value table");
  if (count > bound.maxReferences) throw new RangeError("DSON binary: maxReferences exceeded");
  const nodes: Node[] = [];
  const values: any[] = [];
  const ref = (): number => {
    const id = reader.u32();
    if (id >= count) invalid("invalid reference");
    return id;
  };
  const pairs = (): Entry[] => {
    const size = reader.count(8);
    const result: Entry[] = [];
    const keys = new Set<string>();
    for (let i = 0; i < size; i++) {
      const key = reader.string();
      if (keys.has(key)) invalid("duplicate property");
      keys.add(key);
      result.push([key, ref()]);
    }
    return result;
  };
  for (let i = 0; i < count; i++) {
    const tag = reader.u8();
    let value: any;
    let data: any;
    let refs: number[] = [];
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
        value = []; value.length = length; data = pairs();
        for (const [key] of data) if (key === "length" || (/^(0|[1-9]\d*)$/.test(key) && Number(key) < 0xffffffff && Number(key) >= length))
          invalid("invalid array property");
        refs = data.map((entry: Entry) => entry[1]); break;
      }
      case T.B_OBJECT: case T.B_NULL_OBJECT: case T.B_ERROR: {
        if (tag === T.B_ERROR) {
          const type = reader.u8(); const name = reader.string(); const message = reader.string();
          if (type >= ERRORS.length) invalid("unknown Error subtype");
          value = type === 7 ? new AggregateError([], message) : new (ERRORS[type] as ErrorConstructor)(message);
          Object.defineProperty(value, "name", { value: name, writable: true, configurable: true });
        } else value = tag === T.B_OBJECT ? {} : Object.create(null);
        data = pairs();
        if (tag === T.B_ERROR && data.some(([key]: Entry) => key === "name" || key === "message" || ERROR_LOCATION.has(key))) invalid("invalid Error property");
        refs = data.map((entry: Entry) => entry[1]); break;
      }
      case T.B_MAP: case T.B_SET: {
        const size = reader.count(4);
        if (tag === T.B_MAP && size % 2) invalid("odd Map reference count");
        for (let j = 0; j < size; j++) refs.push(ref());
        value = tag === T.B_MAP ? new Map() : new Set(); break;
      }
      case T.B_REGEXP: {
        const source = reader.string(); const flags = reader.string();
        try { value = new RegExp(source, flags); } catch { invalid("invalid RegExp"); }
        value.lastIndex = reader.u32(); break;
      }
      // Uint8Array construction copies Buffer inputs too; Buffer.slice() aliases the entire backing slab.
      case T.B_BUFFER: value = new Uint8Array(reader.raw()).buffer; break;
      case T.B_VIEW: data = [reader.u8(), reader.u8(), reader.u32(), reader.u32()]; refs = [ref()]; break;
      case T.B_BOX: data = reader.u8(); refs = [ref()]; break;
      default: invalid(`unknown tag ${tag}`);
    }
    nodes.push(node(tag, data, refs)); values.push(value);
  }
  if (reader.position !== bytes.length) invalid("trailing bytes");
  checkGraph(nodes, bound.maxDepth);
  // Leaves are allocated first; views can then share buffers even when those appear later in the table.
  for (let i = 0; i < count; i++) {
    const { tag, data, refs } = nodes[i];
    if (tag === T.B_VIEW) {
      const [type, order, offset, length] = data;
      const ctor = VIEWS[type];
      if (!ctor || nodes[refs[0]].tag !== T.B_BUFFER) invalid("invalid view type or buffer");
      const width = ctor.BYTES_PER_ELEMENT ?? 1;
      if ((order !== 0 && order !== 1) || (width > 1 && order !== BYTE_ORDER)) invalid("unsupported view byte order");
      const buffer = values[refs[0]];
      if (offset % width || length % width || offset + length > buffer.byteLength) invalid("invalid view range");
      values[i] = new ctor(buffer, offset, length / width);
    } else if (tag === T.B_BOX) {
      const member = values[refs[0]];
      if (data >= BOXES.length || typeof member !== ["boolean", "number", "string", "bigint"][data]) invalid("invalid boxed primitive");
      values[i] = Object(member);
    }
  }
  for (let i = 0; i < count; i++) {
    const { tag, data, refs } = nodes[i];
    const value = values[i];
    if ([T.B_ARRAY, T.B_OBJECT, T.B_NULL_OBJECT, T.B_ERROR].includes(tag)) {
      for (const [key, id] of data) Object.defineProperty(value, key, { value: values[id], enumerable: true, writable: true, configurable: true });
    } else if (tag === T.B_MAP) {
      for (let j = 0; j < refs.length; j += 2) {
        const key = values[refs[j]];
        if (value.has(key)) invalid("duplicate Map key");
        value.set(key, values[refs[j + 1]]);
      }
    } else if (tag === T.B_SET) {
      for (const id of refs) {
        if (value.has(values[id])) invalid("duplicate Set member");
        value.add(values[id]);
      }
    }
  }
  return values[0];
};
