import { DSON } from "defuss-dson";

// The supported-type matrix, written without node:assert so the identical module runs in Node.js, Bun (e2e/package.test.ts)
// and in Chromium and WebKit (e2e/site.spec.ts). It prints one line; any failed check throws with its name.
// VERIFIED: it passes in all four runtimes in `make e2e` (Node.js 26, Bun 1.4.3, Playwright 1.63 browsers).
const failures = [];
let checks = 0;
const check = (ok, what) => {
  checks++;
  if (!ok) failures.push(what);
};
const roundTrip = (value) => DSON.parse(DSON.stringify(value));

const map = roundTrip(new Map([[{ id: 1 }, new Set(["x"])]]));
check(map instanceof Map && [...map.keys()][0].id === 1 && [...map.values()][0].has("x"), "Map with object key and Set value");
check(roundTrip(new Date(86_400_000)).getTime() === 86_400_000, "Date");
check(Number.isNaN(roundTrip(new Date("invalid")).getTime()), "invalid Date");
const regexp = roundTrip(/a.b/gimsuy);
check(regexp instanceof RegExp && regexp.source === "a.b" && regexp.flags === "gimsuy", "RegExp with every flag");
check(roundTrip(2n ** 100n) === 2n ** 100n && roundTrip(-(2n ** 100n)) === -(2n ** 100n), "BigInt");
check(Number.isNaN(roundTrip(NaN)) && roundTrip(Infinity) === Infinity && roundTrip(-Infinity) === -Infinity, "NaN and ±Infinity");
check(Object.is(roundTrip(-0), -0) && Object.is(roundTrip([-0, 0])[1], 0), "-0 apart from 0");
const holder = roundTrip({ missing: undefined });
check("missing" in holder && holder.missing === undefined, "undefined property");
for (const Type of [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array]) {
  const copy = roundTrip(new Type([1, 2, 3]));
  check(copy instanceof Type && copy[2] === 3, Type.name);
}
const floats = roundTrip(new Float64Array([NaN, -0, Infinity]));
check(Number.isNaN(floats[0]) && Object.is(floats[1], -0) && floats[2] === Infinity, "Float64Array special items");
for (const Type of [BigInt64Array, BigUint64Array]) {
  const copy = roundTrip(new Type([1n, 2n ** 40n]));
  check(copy instanceof Type && copy[1] === 2n ** 40n, Type.name);
}
const buffer = new Uint8Array([7, 8, 9]).buffer;
const binary = roundTrip({ a: buffer, b: buffer, view: new DataView(buffer, 1, 2) });
check(binary.a instanceof ArrayBuffer && binary.a === binary.b && new Uint8Array(binary.a)[2] === 9, "shared ArrayBuffer");
check(binary.view instanceof DataView && binary.view.byteLength === 2 && binary.view.getUint8(0) === 8, "DataView window");
for (const Type of [Error, TypeError, RangeError, SyntaxError, ReferenceError, EvalError, URIError]) {
  const copy = roundTrip(new Type("m"));
  check(copy instanceof Type && copy.message === "m", Type.name);
}
check(roundTrip(new AggregateError([], "all")).message === "all", "AggregateError");
check(roundTrip(Object(1n)) instanceof BigInt && roundTrip(Object("s")) instanceof String && roundTrip(Object(true)) instanceof Boolean, "wrapper objects");
check(Number.isNaN(roundTrip(Object(NaN)).valueOf()), "Number wrapper of NaN");
const cyclic = { list: [] };
cyclic.list.push(cyclic);
cyclic.self = cyclic;
const cyclicCopy = roundTrip(cyclic);
check(cyclicCopy.self === cyclicCopy && cyclicCopy.list[0] === cyclicCopy, "cycles");
const shared = { n: 1 };
const sharedCopy = roundTrip([shared, shared]);
check(sharedCopy[0] === sharedCopy[1], "shared reference");
const dropped = roundTrip({ keep: 1, fn() {}, sym: Symbol("s"), list: [() => 1] });
check(!("fn" in dropped) && !("sym" in dropped) && dropped.list[0] === null && dropped.keep === 1, "functions and symbols dropped like JSON");
check(Object.keys(roundTrip(JSON.parse('{"__proto__":1}'))).join() === "__proto__", "own __proto__ key");
let refused = false;
try {
  DSON.parse('[["Function","return 1"]]');
} catch {
  refused = true;
}
check(refused, "unknown record type refused");
check(DSON.isEqual({ a: new Set([1]) }, { a: new Set([1]) }) && !DSON.isEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), "isEqual");
const original = { when: new Date(0), tags: new Set(["t"]) };
original.self = original;
const clone = DSON.clone(original);
check(clone !== original && clone.self === clone && clone.tags.has("t") && clone.when.getTime() === 0, "clone");

if (failures.length) throw new Error(`DSON matrix failed: ${failures.join("; ")}`);
console.log(`matrix ok: ${checks} checks`);
