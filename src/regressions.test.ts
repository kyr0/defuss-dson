import { describe, it, expect, afterEach } from "vitest";
import { DSON } from "./index.js";
import { deserialize } from "./deserialize.js";
import { serialize } from "./serialize.js";

// Each case below was a verified defect of defuss-dson 1.1.2, reproduced against its build before the fix.
const roundTrip = <T>(value: T): T => DSON.parse(DSON.stringify(value));

describe("values JSON cannot carry", () => {
  it("restores undefined instead of turning it into null", () => {
    const parsed = roundTrip({ a: undefined, list: [undefined] });
    expect(Object.hasOwn(parsed, "a")).toBe(true);
    expect(parsed.a).toBeUndefined();
    expect(parsed.list).toEqual([undefined]);
    expect(DSON.isEqual({ a: undefined }, { a: null })).toBe(false);
  });

  it("restores NaN, Infinity, -Infinity and -0", () => {
    const [nan, inf, negInf, negZero, zero] = roundTrip([NaN, Infinity, -Infinity, -0, 0]);
    expect(nan).toBeNaN();
    expect(inf).toBe(Infinity);
    expect(negInf).toBe(-Infinity);
    expect(Object.is(negZero, -0)).toBe(true);
    expect(Object.is(zero, 0)).toBe(true);
    expect(Object.is(roundTrip([-0, 0])[1], 0)).toBe(true);
    expect(DSON.isEqual(NaN, null)).toBe(false);
    expect(DSON.isEqual(Infinity, null)).toBe(false);
  });

  it("writes special numbers under their own tag, so a 1.1 reader fails instead of reading null", () => {
    expect(DSON.stringify(NaN)).toBe('[[9,"NaN"]]');
    expect(DSON.stringify(-0)).toBe('[[9,"-0"]]');
  });

  it("compares 0 and -0 as equal and NaN as equal to itself (SameValueZero)", () => {
    expect(DSON.isEqual([0, -0], [0, 0])).toBe(true);
    expect(DSON.isEqual(new Float64Array([-0]), new Float64Array([0]))).toBe(true);
    expect(DSON.isEqual([NaN], [NaN])).toBe(true);
  });

  it("keeps special items of float arrays and wrapper numbers", () => {
    const parsed = roundTrip(new Float64Array([NaN, -0, Infinity, -Infinity, 1.5]));
    expect(parsed).toBeInstanceOf(Float64Array);
    expect(Array.from(parsed, (n) => (Object.is(n, -0) ? "-0" : String(n)))).toEqual([
      "NaN",
      "-0",
      "Infinity",
      "-Infinity",
      "1.5",
    ]);
    const wrapped = roundTrip(Object(NaN));
    expect(wrapped).toBeInstanceOf(Number);
    expect(wrapped.valueOf()).toBeNaN();
  });

  it("serializes BigInt64Array and BigUint64Array instead of throwing", () => {
    const signed = roundTrip(new BigInt64Array([-(2n ** 63n), 1n]));
    expect(signed).toBeInstanceOf(BigInt64Array);
    expect([...signed]).toEqual([-(2n ** 63n), 1n]);
    expect([...roundTrip(new BigUint64Array([2n ** 64n - 1n]))]).toEqual([2n ** 64n - 1n]);
  });

  it("serializes an invalid Date instead of throwing a RangeError", () => {
    const parsed = roundTrip({ when: new Date("not a date") });
    expect(parsed.when).toBeInstanceOf(Date);
    expect(parsed.when.getTime()).toBeNaN();
  });
});

describe("binary data", () => {
  it("restores one ArrayBuffer referenced twice as one buffer", () => {
    const buffer = new ArrayBuffer(4);
    const parsed = roundTrip({ a: buffer, b: buffer });
    expect(parsed.a).toBe(parsed.b);
  });

  it("restores one DataView referenced twice as one view", () => {
    const view = new DataView(new ArrayBuffer(4));
    const parsed = roundTrip([view, view]);
    expect(parsed[0]).toBe(parsed[1]);
  });

  it("encodes only the window of a DataView, not its whole buffer", () => {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setInt32(4, 42);
    const parsed = roundTrip(new DataView(buffer, 4, 4));
    expect(parsed.byteLength).toBe(4);
    expect(parsed.getInt32(0)).toBe(42);
  });
});

describe("objects", () => {
  it("keeps an own __proto__ key as data, as JSON.parse does", () => {
    const parsed = roundTrip(JSON.parse('{"__proto__":{"admin":true}}'));
    expect(Object.keys(parsed)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(parsed.admin).toBeUndefined();
  });

  it("restores AggregateError with its message", () => {
    const parsed = roundTrip(new AggregateError([new Error("inner")], "outer"));
    expect(parsed).toBeInstanceOf(AggregateError);
    expect(parsed.message).toBe("outer");
  });

  it("encodes iterators as plain objects, which parse back, instead of an unknown type", () => {
    expect(roundTrip([1, 2].values())).toEqual({});
  });
});

describe("untrusted input", () => {
  it("refuses record types outside the format instead of calling a global constructor", () => {
    expect(() => DSON.parse('[["Function","return 1"]]')).toThrow(
      'DSON: unsupported record type "Function"',
    );
    expect(() => DSON.parse('[["WebSocket","ws://127.0.0.1:9"]]')).toThrow(TypeError);
    expect(() => DSON.parse("[[42,null]]")).toThrow(TypeError);
  });

  it("builds an Error for any error name, never the global it names", () => {
    const parsed = DSON.parse('[[7,{"name":"Function","message":"return 1"}]]');
    expect(parsed).toBeInstanceOf(Error);
    expect(parsed.name).toBe("Function");
    expect(parsed.message).toBe("return 1");
  });

  it("does not let a __proto__ key replace the prototype of the parsed object", () => {
    const parsed = DSON.parse('[[2,[[1,2]]],[0,"__proto__"],[2,[[3,4]]],[0,"admin"],[0,true]]');
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(parsed.admin).toBeUndefined();
  });
});

describe("clone without structuredClone", () => {
  const native = globalThis.structuredClone;
  afterEach(() => {
    globalThis.structuredClone = native;
  });

  it("falls back to DSON records and keeps types and cycles", () => {
    // Runtimes without structuredClone exist (some embedded engines); removing it here runs that real code path.
    (globalThis as any).structuredClone = undefined;
    const source: any = { map: new Map([[1, new Set(["a"])]]), when: new Date(0), missing: undefined };
    source.self = source;
    const copy = DSON.clone(source);
    expect(copy).not.toBe(source);
    expect(copy.self).toBe(copy);
    expect(copy.map.get(1)).toEqual(new Set(["a"]));
    expect(copy.when.getTime()).toBe(0);
    expect(Object.hasOwn(copy, "missing")).toBe(true);
  });

  it("throws on functions like structuredClone does, instead of dropping them", () => {
    expect(() => deserialize(serialize({ run() {} }))).toThrow("unable to serialize function");
    expect(() => DSON.clone({ run() {} })).toThrow();
  });
});
