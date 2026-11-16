import { describe, it, expect } from "vitest";
import { encode, decode } from "./binary.js";
import { Reader, utf16Decoder } from "./binary-io.js";
import { Writer } from "./binary-writer.fixture.js";
import * as T from "./tags.js";
import { prng, randomValue } from "./random.fixture.js";

const sparse = (length: number): any[] => { const array: any[] = []; array.length = length; return array; };
const round = (value: any, options = {}) => decode(encode(value, options), options);
const wire = (count: number, build: (writer: Writer) => void): Uint8Array => {
  const writer = new Writer();
  writer.raw(new Uint8Array([68, 83, 66, 1])); writer.u32(count); build(writer);
  return writer.finish();
};
const fields = (w: Writer, key: string, ref = 0) => { w.string(key); w.u32(ref); };
/** One value of every kind the encoder sizes differently. */
const every = (): unknown[] => {
  const buffer = new ArrayBuffer(16);
  const regex = /a.b/gu; regex.lastIndex = 3;
  return [null, undefined, true, false, "", "a\ud800😀".repeat(20), 0, -0, NaN, 1.5, -12n, 2n ** 70n,
    { a: 1, "\u00e9": [2, 3] }, Object.assign(Object.create(null), { x: "y" }), Object.assign(sparse(3), { 0: 1, 2: 3, extra: 4 }),
    new Map<any, any>([["k", 1], [{}, []]]), new Set([1, "two"]), new Date(1e12), regex, buffer,
    new Uint16Array(buffer, 2, 3), new DataView(buffer, 1, 4), new Float64Array([1, -0, NaN]), new BigInt64Array([-1n]),
    Object(1), Object("str"), Object(false), Object(3n), new RangeError("r", { cause: { deep: 1 } }),
    new AggregateError([new Error("a")], "agg"), Object.assign(new TypeError("t"), { code: "E1" })];
};

describe("binary value graphs", () => {
  it("pins the version, byte order and basic tags with literal bytes", () => {
    expect([...encode(null)]).toEqual([68, 83, 66, 1, 1, 0, 0, 0, 10]);
    expect([...encode(1)]).toEqual([68, 83, 66, 1, 1, 0, 0, 0, 15, 0, 0, 0, 0, 0, 0, 240, 63]);
    expect(decode(new Uint8Array([68, 83, 66, 1, 1, 0, 0, 0, 14, 1, 0, 0, 0, 0xac, 0x20]))).toBe("€");
  });

  it("preserves primitives including lone surrogates and signed zero", () => {
    for (const value of [null, undefined, true, false, "", "a\n😀\ud800\udfff", "a".repeat(8193), 0, -0, NaN,
      Infinity, -Infinity, 1.25, -123, 0n, -1n, 2n ** 512n]) expect(Object.is(round(value), value)).toBe(true);
    const back = round([0, -0, 0, -0]);
    expect(back.map((v: number) => Object.is(v, -0))).toEqual([false, true, false, true]);
  });

  it("reads long strings exactly: a leading U+FEFF, lone and paired surrogates, and every length around the cutoffs", () => {
    const text = (length: number) => "abcdefghijklmnopqrstuvwxyz0123456789".repeat(Math.ceil(length / 36)).slice(0, length);
    for (const length of [0, 1, 4, 31, 32, 33, 47, 48, 49, 4096, 4097, 9000])
      for (const value of [text(length), "\uFEFF" + text(length), text(length) + "\ud800", "\udc00" + text(length),
        text(length) + "😀", text(length) + "é中"])
        expect(round(value), `${length}: ${JSON.stringify(value.slice(-3))}`).toBe(value);
    // views of a SharedArrayBuffer, which browsers' TextDecoder refuses, read the same
    if (typeof SharedArrayBuffer === "function") {
      const bytes = encode("\uFEFF" + text(100));
      const shared = new Uint8Array(new SharedArrayBuffer(bytes.length)); shared.set(bytes);
      expect(decode(shared)).toBe("\uFEFF" + text(100));
    }
    // a runtime without TextDecoder gets no decoder; its strings take the byte loop, as the shared view above did
    expect(utf16Decoder(undefined)).toBeUndefined();
    expect(utf16Decoder(globalThis.TextDecoder)?.decode(new Uint8Array([0xff, 0xfe, 0x41, 0]))).toBe("\uFEFFA");
  });

  it("reads property names exactly, whichever earlier names share their cache slot", () => {
    // 3,000 distinct names in 256 cache slots must collide; long names and names with lone surrogates as well
    const names = Array.from({ length: 3000 }, (_, i) => `n${i}`).concat(["x".repeat(32), "x".repeat(33), "\ud800", "a\udc00b"]);
    const wide = Object.fromEntries(names.map((name, i) => [name, i]));
    expect(round(wide)).toEqual(wide);
    for (let i = 0; i < names.length; i += 3) {
      const small = { [names[i]]: 1, [names[(i * 7) % names.length]]: 2, n0: 3 };
      expect(Object.keys(round(small))).toEqual(Object.keys(small));
    }
  });

  it("defines names that the prototype chain holds instead of assigning them", () => {
    let calls = 0;
    const patched: [object, string, PropertyDescriptor][] = [
      [Object.prototype, "dsonSetter", { set() { calls++; }, configurable: true }],
      [Object.prototype, "dsonReadOnly", { value: 0, writable: false, configurable: true }],
      [Array.prototype, "dsonSetter", { set() { calls++; }, configurable: true }],
    ];
    const bytes = [encode({ dsonSetter: 1, dsonReadOnly: 2, a: 3 }), encode(Object.assign([4, 5], { dsonSetter: 6 }))];
    try {
      for (const [target, key, descriptor] of patched) Object.defineProperty(target, key, descriptor);
      const [object, array] = bytes.map((b) => decode(b));
      expect(Object.getOwnPropertyDescriptor(object, "dsonSetter")).toEqual({ value: 1, writable: true, enumerable: true, configurable: true });
      expect(Object.getOwnPropertyDescriptor(object, "dsonReadOnly")?.value).toBe(2);
      expect([array[0], array[1], Object.getOwnPropertyDescriptor(array, "dsonSetter")?.value]).toEqual([4, 5, 6]);
      expect(calls).toBe(0);
    } finally {
      for (const [target, key] of patched) delete (target as any)[key];
    }
  });

  it("preserves sparse arrays, null prototypes, own __proto__, cycles and shared keys", () => {
    const child = Object.assign(Object.create(null), { x: undefined });
    const root: any = { child, again: child, map: new Map(), set: new Set(), array: sparse(3) };
    root.self = root; root.map.set(root, child); root.set.add(root);
    root.array[1] = undefined; root.array.extra = root;
    Object.defineProperty(root, "__proto__", { value: child, enumerable: true });
    const back = round(root);
    expect(back.self).toBe(back); expect(back.child).toBe(back.again);
    expect(Object.getPrototypeOf(back.child)).toBe(null); expect(Object.getPrototypeOf(back)).toBe(Object.prototype);
    expect(Object.hasOwn(back, "__proto__")).toBe(true); expect(back.__proto__).toBe(back.child);
    expect(back.map.get(back)).toBe(back.child); expect(back.set.has(back)).toBe(true);
    expect(back.array.length).toBe(3); expect(0 in back.array).toBe(false); expect(1 in back.array).toBe(true);
    expect(back.array.extra).toBe(back);
    expect(round(new Map())).toEqual(new Map()); expect(round(new Set())).toEqual(new Set());
  });

  it("keeps raw buffers, view windows, aliases and every available typed array", () => {
    const constructors = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array,
      (globalThis as any).Float16Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array].filter(Boolean);
    for (const Ctor of constructors) {
      const buffer = new ArrayBuffer(64);
      new Uint8Array(buffer).set([0, 10, 255, 128, 1, 2, 3, 4]);
      const view = new Ctor(buffer, Ctor.BYTES_PER_ELEMENT, 2);
      const data = new DataView(buffer, 1, 7);
      const back = round({ buffer, view, again: view, data });
      expect(back.view.constructor).toBe(Ctor); expect(back.view).toBe(back.again);
      expect(back.view.buffer).toBe(back.buffer); expect(back.data.buffer).toBe(back.buffer);
      expect(back.view.byteOffset).toBe(view.byteOffset); expect(back.data.byteOffset).toBe(1);
      expect(back.data.byteLength).toBe(7); expect(new Uint8Array(back.buffer)).toEqual(new Uint8Array(buffer));
    }
    expect(round(new ArrayBuffer(0)).byteLength).toBe(0);
    const source = new Float64Array([NaN, -0, Infinity, -Infinity]);
    expect([...round(source)].map((v, i) => Object.is(v, source[i]))).toEqual([true, true, true, true]);
    const bytes = encode(new Uint8Array(1024));
    expect(bytes.length).toBeLessThan(1100);
    const back = decode(bytes); bytes.fill(255); expect(back[0]).toBe(0);
  });

  it("preserves dates, regex state, boxes, native errors and Error reference fields", () => {
    for (const time of [0, -1, NaN, 8640000000000000]) expect(Object.is(round(new Date(time)).getTime(), time)).toBe(true);
    const regex = /a+b/gi; regex.lastIndex = 12;
    const r = round(regex); expect(r.source).toBe(regex.source); expect(r.flags).toBe(regex.flags); expect(r.lastIndex).toBe(12);
    for (const primitive of [true, false, -0, NaN, "hi", 1n]) {
      const box = Object(primitive); const back = round([box, box]);
      expect(Object.is(back[0].valueOf(), primitive)).toBe(true); expect(back[0]).toBe(back[1]);
    }
    for (const Ctor of [Error, EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError]) {
      const error = new Ctor("message", { cause: { id: 1 } });
      const back = round(error); expect(back.constructor).toBe(Ctor); expect(back.message).toBe("message");
      expect(back.cause).toEqual({ id: 1 });
    }
    const error: any = new AggregateError([], "many"); error.errors.push(error); error.cause = error;
    error.name = "NamedError"; error.extra = 2;
    const back = round(error); expect(back instanceof AggregateError).toBe(true);
    expect(back.name).toBe("NamedError"); expect(back.errors[0]).toBe(back); expect(back.cause).toBe(back); expect(back.extra).toBe(2);
    const diagnostic = new Error("private"); const before = encode(diagnostic);
    for (const key of ["stack", "line", "column", "sourceURL", "originalLine", "originalColumn"])
      Object.defineProperty(diagnostic, key, { get() { throw new Error("must not read diagnostic fields"); }, configurable: true });
    expect(encode(diagnostic)).toEqual(before);
  });

  it("refuses unsupported values and descriptors without invoking getters or toJSON", () => {
    let calls = 0;
    const getter = { get x() { calls++; return 1; } };
    const json = { toJSON() { calls++; return 1; } };
    class Custom { x = 1; }
    const bad: any[] = [() => 1, Symbol(), new WeakMap(), new WeakSet(), Promise.resolve(1), new Custom(), getter, json,
      { [Symbol()]: 1 }, Object.defineProperty({}, "x", { value: 1 }), Object.assign(new Date(), { x: 1 }),
      Object.assign(new Map(), { x: 1 }), Object.assign(new Set(), { x: 1 }), Object.assign(new Uint8Array(1), { x: 1 }),
      Object.assign(new Error(), { name: 1 }), Object.assign(new Error(), { message: 1 }),
      Object.assign(Object("hi"), { 100: "extra" }), Object.assign(new DataView(new ArrayBuffer(2)), { 0: "extra" }),
      Object.create(Array.prototype), Object.create(ArrayBuffer.prototype), Object.create(Error.prototype),
      new (class extends Uint8Array {})(1), new (class extends Map {})(),
      // an own `length` that claims more elements must not hide the custom property it is
      Object.defineProperty(new Uint8Array(2), "length", { value: 99, enumerable: true }),
      Object.assign(new Float64Array(2), { "01": 1 }), Object.assign(new Uint8Array(2), { [Symbol()]: 1 })];
    if (typeof SharedArrayBuffer === "function") bad.push(new SharedArrayBuffer(1), new Uint8Array(new SharedArrayBuffer(1)));
    for (const value of bad) expect(() => encode(value)).toThrow(TypeError);
    for (const value of [() => 1, Symbol()]) {
      for (const container of [[value], { value }, new Map([[value, 1]]), new Map([[1, value]]), new Set([value])])
        expect(() => encode(container)).toThrow(TypeError);
    }
    for (const lastIndex of [-1, 1.5, Infinity, 0x100000000]) {
      const regex = /x/; regex.lastIndex = lastIndex; expect(() => encode(regex)).toThrow(/lastIndex/);
    }
    expect(calls).toBe(0);
  });

  it("sizes every kind of entry exactly: maxRecordBytes equal to the output passes, one byte less fails", () => {
    const cause = new RangeError("r", { cause: 1 });
    const buffer = new ArrayBuffer(16);
    for (const [index, value] of every().entries()) {
      const bytes = encode(value);
      expect(encode(value, { maxRecordBytes: bytes.length }), `every()[${index}]`).toEqual(bytes);
      expect(() => encode(value, { maxRecordBytes: bytes.length - 1 })).toThrow(/maxRecordBytes/);
    }
    // a returned result is the caller's: later calls do not change it
    const first = encode({ cause, view: new Uint16Array(buffer, 2, 3) });
    const copy = first.slice();
    encode("x".repeat(3000));
    expect(first).toEqual(copy);
  });

  it("writes the same bytes with trusted for plain data, and skips the descriptor checks only there", () => {
    for (const value of every()) expect(encode(value, { trusted: true })).toEqual(encode(value));
    for (let seed = 1; seed <= 300; seed++) {
      const value = randomValue(prng(seed));
      let plain: Uint8Array | undefined;
      try { plain = encode(value); } catch { continue; }
      expect(encode(value, { trusted: true }), `seed ${seed}`).toEqual(plain);
    }
    // what trusted gives up, for a value that breaks its guarantee
    let reads = 0;
    const getter = { get x() { reads++; return 1; } };
    expect(decode(encode(getter, { trusted: true }))).toEqual({ x: 1 });
    expect(reads).toBe(1);
    expect(decode(encode(Object.defineProperty({ a: 1 }, "hidden", { value: 2 }), { trusted: true }))).toEqual({ a: 1 });
    expect(decode(encode({ a: 1, [Symbol()]: 2 }, { trusted: true }))).toEqual({ a: 1 });
    expect(decode(encode(Object.assign(new Map([[1, 2]]), { extra: 3 }), { trusted: true }))).toEqual(new Map([[1, 2]]));
    // Errors keep their checks, and the option is validated; decoding accepts and ignores it
    const error = Object.defineProperty(new Error("e"), "code", { get: () => 1, enumerable: true });
    expect(() => encode(error, { trusted: true })).toThrow(/accessors/);
    for (const trusted of [1, "yes", null]) expect(() => encode(1, { trusted } as any)).toThrow(/invalid trusted/);
    // a getter that encodes while trusted reads it gets lists of its own: both results match encoding them alone
    let inner: Uint8Array | undefined;
    const reentrant = { a: "x", get b() { inner = encode({ deep: ["y", 2] }, { trusted: true }); return 3; }, c: [4] };
    const outer = encode(reentrant, { trusted: true });
    expect(inner).toEqual(encode({ deep: ["y", 2] }));
    expect(outer).toEqual(encode({ a: "x", b: 3, c: [4] }));
    expect(decode(encode([1]), { trusted: true } as any)).toEqual([1]);
  });

  it("enforces size, depth and reference bounds without using the call stack", () => {
    const value = { child: { next: 1 } };
    expect(round(value, { maxDepth: 2 })).toEqual(value);
    // more entries than maxDepth + 1 make encode walk the graph; this one is wide, not deep
    expect(round({ a: 1, b: 2, c: 3 }, { maxDepth: 1 })).toEqual({ a: 1, b: 2, c: 3 });
    expect(() => encode(value, { maxDepth: 1 })).toThrow(/maxDepth/);
    expect(() => decode(encode(value), { maxDepth: 1 })).toThrow(/maxDepth/);
    const cycle: any = {}; cycle.self = cycle; expect(round(cycle, { maxDepth: 0 }).self.self).toBeDefined();
    for (const maxRecordBytes of [0, 8, 9]) {
      expect(() => encode("large", { maxRecordBytes })).toThrow(/maxRecordBytes/);
      expect(() => decode(encode("large"), { maxRecordBytes })).toThrow(/maxRecordBytes/);
    }
    for (const maxReferences of [0, 1]) {
      expect(() => encode([1], { maxReferences })).toThrow(/maxReferences/);
      expect(() => decode(encode([1]), { maxReferences })).toThrow(/maxReferences/);
    }
    for (const key of ["maxDepth", "maxRecordBytes", "maxReferences"]) for (const value of [-1, 1.5, NaN, Infinity, 0x100000000, "1", undefined]) {
      expect(() => encode(null, { [key]: value })).toThrow(RangeError);
      expect(() => decode(encode(null), { [key]: value })).toThrow(RangeError);
    }
    expect(() => encode(sparse(20), { maxRecordBytes: 19 })).toThrow(/array length/);
    // as in 1.3, any other option must be a bound too, and the three limits are reported first
    expect(encode(1, { other: 7 } as any)).toEqual(encode(1));
    expect(() => encode(1, { other: "x" } as any)).toThrow(/^DSON binary: invalid other$/);
    expect(() => decode(encode(1), { other: "x", maxDepth: -1 } as any)).toThrow(/^DSON binary: invalid maxDepth$/);
    let deep: any = null; for (let i = 0; i < 10_000; i++) deep = [deep];
    let back = round(deep, { maxDepth: 10_000 });
    for (let i = 0; i < 10_000; i++) back = back[0];
    expect(back).toBe(null);
  });
});

describe("untrusted binary input", () => {
  it("rejects every truncation and trailing data, including nonzero input byte offsets", () => {
    const bytes = encode({ a: ["long", 1, new Uint8Array([1, 2])] });
    for (let length = 0; length < bytes.length; length++) expect(() => decode(bytes.subarray(0, length))).toThrow(TypeError);
    const padded = new Uint8Array(bytes.length + 2); padded.set(bytes, 1);
    expect(decode(padded.subarray(1, -1)).a[0]).toBe("long");
    expect(() => decode(padded.subarray(1))).toThrow(/trailing/);
    expect(() => decode([] as any)).toThrow(/Uint8Array/);
    const badHeader = encode(1); badHeader[3] = 2; expect(() => decode(badHeader)).toThrow(/header/);
  });

  it("copies exactly the payload bytes from Node Buffer input, without exposing its backing slab", () => {
    const input = (globalThis as any).Buffer.from(encode(new Uint8Array([1, 2, 3]).buffer));
    const decoded = decode(input);
    expect(decoded.byteLength).toBe(3); expect([...new Uint8Array(decoded)]).toEqual([1, 2, 3]);
    input.fill(99); expect([...new Uint8Array(decoded)]).toEqual([1, 2, 3]);
  });

  it("rejects malformed counts, tags, references, strings, dates and regexes", () => {
    const cases: [number, (w: Writer) => void][] = [
      [0, () => {}], [2, w => w.u8(T.B_NULL)], [1, w => w.u8(255)],
      [2, w => { w.u8(T.B_NULL); w.u8(T.B_NULL); }],
      [1, w => { w.u8(T.B_SET); w.u32(1); w.u32(9); }],
      [1, w => { w.u8(T.B_STRING); w.u32(0xffffffff); }],
      [1, w => { w.u8(T.B_BUFFER); w.u32(0xffffffff); }],
      [1, w => { w.u8(T.B_BIGINT); w.string("01"); }],
      [1, w => { w.u8(T.B_DATE); w.f64(Infinity); }],
      [1, w => { w.u8(T.B_DATE); w.f64(0.5); }],
      [1, w => { w.u8(T.B_REGEXP); w.string("["); w.string(""); w.u32(0); }],
      [1, w => { w.u8(T.B_REGEXP); w.string("a"); w.string("gg"); w.u32(0); }],
      [1, w => { w.u8(T.B_MAP); w.u32(1); w.u32(0); }],
      [1, w => { w.u8(T.B_OBJECT); w.u32(2); fields(w, "x"); fields(w, "x"); }],
      // above 32 keys, duplicates are found by a Set instead of a scan
      [1, w => { w.u8(T.B_OBJECT); w.u32(34); for (let i = 0; i < 33; i++) fields(w, `k${i}`); fields(w, "k7"); }],
      [1, w => { w.u8(T.B_ARRAY); w.u32(0); w.u32(1); fields(w, "length"); }],
      [1, w => { w.u8(T.B_ARRAY); w.u32(0); w.u32(1); fields(w, "0"); }],
      [1, w => { w.u8(T.B_ERROR); w.u8(99); w.string(""); w.string(""); }],
      [1, w => { w.u8(T.B_ERROR); w.u8(0); w.string(""); w.string(""); w.u32(1); fields(w, "stack"); }],
      [1, w => { w.u8(T.B_ERROR); w.u8(0); w.string(""); w.string(""); w.u32(1); fields(w, "name"); }],
      [1, w => { w.u8(T.B_ERROR); w.u8(0); w.string(""); w.string(""); w.u32(1); fields(w, "message"); }],
      [1, w => { w.u8(T.B_SET); w.u32(2); w.u32(0); w.u32(0); }],
      [1, w => { w.u8(T.B_MAP); w.u32(4); for (let i = 0; i < 4; i++) w.u32(0); }],
    ];
    for (const [count, build] of cases) expect(() => decode(wire(count, build))).toThrow(TypeError);
    const largeArray = wire(1, w => { w.u8(T.B_ARRAY); w.u32(100); w.u32(0); });
    expect(() => decode(largeArray, { maxRecordBytes: 99 })).toThrow(/array length/);
    const oddKeys: any[] = []; (oddKeys as any)["4294967295"] = 1;
    expect(round(oddKeys)["4294967295"]).toBe(1);
  });

  it("rejects forged view and wrapper subtypes and ranges", () => {
    const view = (type: number, order: number, offset: number, length: number, bufferTag = T.B_BUFFER) =>
      wire(2, w => { w.u8(T.B_VIEW); w.u8(type); w.u8(order); w.u32(offset); w.u32(length); w.u32(1);
        w.u8(bufferTag); if (bufferTag === T.B_BUFFER) { w.u32(8); w.raw(new Uint8Array(8)); } });
    const order = new Uint8Array(new Uint16Array([1]).buffer)[0];
    for (const args of [[99, order, 0, 1], [4, 1 - order, 0, 2], [2, 3, 0, 1], [4, order, 1, 2],
      [4, order, 0, 1], [2, order, 8, 1], [2, order, 0, 1, T.B_NULL]]) {
      expect(() => decode(view(...args as [number, number, number, number, number?]))).toThrow(TypeError);
    }
    for (const subtype of [0, 1, 2, 3, 255]) {
      expect(() => decode(wire(2, w => { w.u8(T.B_BOX); w.u8(subtype); w.u32(1); w.u8(T.B_NULL); }))).toThrow(/boxed/);
    }
    // the Reader is bounded: a claimed length cannot read or allocate past the input
    expect(() => new Reader(new Uint8Array()).take(1)).toThrow(/truncated/);
  });

  it("decodes seeded mutations only within configured limits or throws a codec error", () => {
    const original = encode({ m: new Map([[1, "x"]]), s: new Set([1]), a: [new Uint16Array([1, 2]), null] });
    let seed = 1234;
    for (let i = 0; i < 1500; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const bytes = original.slice(); bytes[seed % bytes.length] ^= (seed >>> 24) || 1;
      try { decode(bytes, { maxRecordBytes: 4096, maxReferences: 100, maxDepth: 20 }); }
      catch (error) { expect(error instanceof TypeError || error instanceof RangeError).toBe(true); expect((error as Error).message).toMatch(/^DSON binary:/); }
    }
  });
});
