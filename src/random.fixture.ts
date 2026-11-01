// Test fixture, not shipped (pkgroll builds from src/index.ts) and not counted in coverage (vitest.config.ts).
// Why a seeded generator instead of a property-testing library: the project has no runtime dependencies and keeps its
// dev dependencies few; 60 lines give reproducible random graphs, and a failing case names its seed.
// VERIFIED: (probe, 2026-11-01) of seeds 1 to 500, 325 graphs hold containers and 39 an array or Set member that
// points back to an earlier container; of the 3,000 fuzz inputs, 1,191 parse and 1,809 throw.

/** mulberry32: a small seeded PRNG; the same seed gives the same sequence on every runtime. */
export const prng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const TYPED = [
  "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array",
  "Float16Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
].filter((name) => typeof (globalThis as any)[name] === "function");

const ERRORS = [Error, TypeError, RangeError, SyntaxError, EvalError, ReferenceError, URIError];

/**
 * A random value graph of every type DSON carries, with shared references and cycles. It leaves out what DSON and
 * structuredClone treat differently by design (functions, class instances, custom Error names, views sharing one
 * buffer, sparse arrays), so the two can be compared value by value.
 */
export const randomValue = (next: () => number, depth = 4): any => {
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(list: readonly T[]): T => list[int(list.length)];
  const pool: object[] = [];

  const leaf = (): any => {
    switch (int(12)) {
      case 0: return pick([0, -0, 1, -1, 0.5, 1e21, Number.MAX_SAFE_INTEGER, NaN, Infinity, -Infinity]);
      case 1: return pick(["", "a", "__proto__", "constructor", "ünïcødé", " ", "line\nbreak", "0"]);
      case 2: return pick([true, false, null, undefined]);
      case 3: return pick([0n, -1n, 2n ** 70n]);
      case 4: return new Date(pick([0, 1.7e12, -1, NaN]));
      case 5: return new RegExp(pick(["a+", "^x$", ""]), pick(["", "g", "imsu", "y"]));
      case 6: return new (pick(ERRORS))(pick(["", "boom"]));
      case 7: {
        const name = pick(TYPED);
        const big = name.startsWith("Big");
        const float = name.startsWith("Float");
        const items = Array.from({ length: int(4) }, () =>
          big ? BigInt(int(100) - 50) : float ? pick([0, -0, 1.5, NaN, Infinity]) : int(300) - 100);
        return new (globalThis as any)[name](items);
      }
      case 8: return new Uint8Array([int(256), int(256)]).buffer;
      case 9: return new DataView(new Uint8Array([int(256), int(256), int(256)]).buffer, int(2));
      case 10: return pick([() => new Number(-0), () => new Number(NaN), () => new String("s"), () => new Boolean(false), () => Object(5n)])();
      default: return int(1000);
    }
  };

  const build = (level: number): any => {
    if (pool.length && next() < 0.15) return pick(pool);
    if (level <= 0 || next() < 0.35) return leaf();
    const width = int(4);
    switch (int(4)) {
      case 0: {
        const array: any[] = [];
        pool.push(array);
        for (let i = 0; i < width; i++) array.push(build(level - 1));
        return array;
      }
      case 1: {
        const object: any = {};
        pool.push(object);
        for (let i = 0; i < width; i++) {
          const key = pick(["a", "b", "__proto__", "0", "10", "x y"]);
          Object.defineProperty(object, key, { value: build(level - 1), writable: true, enumerable: true, configurable: true });
        }
        return object;
      }
      case 2: {
        const map = new Map();
        pool.push(map);
        for (let i = 0; i < width; i++) map.set(next() < 0.3 ? build(level - 1) : leaf(), build(level - 1));
        return map;
      }
      default: {
        const set = new Set();
        pool.push(set);
        for (let i = 0; i < width; i++) set.add(build(level - 1));
        return set;
      }
    }
  };
  return build(depth);
};

const brand = (value: object) => Object.prototype.toString.call(value).slice(8, -1);
const bytes = (view: ArrayBufferView) => Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));

/**
 * Compares two value graphs and returns the path of the first difference, or "" when they match. Why not
 * DSON.isEqual: the oracle must not share code with what it checks. Identity is part of the comparison: a pairing of
 * objects must be one-to-one, so a shared reference or a cycle on one side has to be the same on the other.
 */
export const difference = (a: any, b: any): string => {
  const pairs = new Map<object, object>();
  const reverse = new Map<object, object>();
  const todo: [any, any, string][] = [[a, b, "$"]];
  while (todo.length) {
    const [x, y, path] = todo.pop()!;
    if (typeof x !== typeof y) return `${path}: ${typeof x} vs ${typeof y}`;
    if (typeof x !== "object" || x === null || y === null) {
      if (!Object.is(x, y)) return `${path}: ${String(x)} vs ${String(y)}`;
      continue;
    }
    if (pairs.has(x) || reverse.has(y)) {
      if (pairs.get(x) !== y) return `${path}: reference shape differs`;
      continue;
    }
    pairs.set(x, y);
    reverse.set(y, x);
    const kind = brand(x);
    if (kind !== brand(y)) return `${path}: ${kind} vs ${brand(y)}`;
    switch (kind) {
      case "Array":
        if (x.length !== y.length) return `${path}: length ${x.length} vs ${y.length}`;
        x.forEach((item: any, i: number) => todo.push([item, y[i], `${path}[${i}]`]));
        break;
      case "Object": {
        if (Object.getPrototypeOf(y) !== Object.prototype) return `${path}: prototype replaced`;
        const keys = Object.keys(x);
        if (keys.join() !== Object.keys(y).join()) return `${path}: keys ${keys} vs ${Object.keys(y)}`;
        for (const key of keys) todo.push([x[key], y[key], `${path}.${key}`]);
        break;
      }
      case "Map": {
        if (x.size !== y.size) return `${path}: size ${x.size} vs ${y.size}`;
        const right = [...y];
        [...x].forEach(([key, value], i) => todo.push([key, right[i][0], `${path}<key ${i}>`], [value, right[i][1], `${path}<${i}>`]));
        break;
      }
      case "Set": {
        if (x.size !== y.size) return `${path}: size ${x.size} vs ${y.size}`;
        const right = [...y];
        [...x].forEach((value, i) => todo.push([value, right[i], `${path}{${i}}`]));
        break;
      }
      case "Date":
        if (!Object.is(x.getTime(), y.getTime())) return `${path}: ${x.getTime()} vs ${y.getTime()}`;
        break;
      case "RegExp":
        if (`${x}` !== `${y}`) return `${path}: ${x} vs ${y}`;
        break;
      case "Error":
        if (x.constructor !== y.constructor || x.name !== y.name || x.message !== y.message) return `${path}: ${x} vs ${y}`;
        break;
      case "ArrayBuffer":
        if (bytes(new Uint8Array(x)).join() !== bytes(new Uint8Array(y)).join()) return `${path}: bytes differ`;
        break;
      case "DataView":
        if (bytes(x).join() !== bytes(y).join()) return `${path}: bytes differ`;
        break;
      case "Number": case "String": case "Boolean": case "BigInt":
        if (!Object.is(x.valueOf(), y.valueOf())) return `${path}: ${x} vs ${y}`;
        break;
      default:
        // typed arrays: same class, same items (-0 and NaN included)
        if (x.constructor !== y.constructor || x.length !== y.length || ![...x].every((item, i) => Object.is(item, y[i])))
          return `${path}: ${kind} items differ`;
    }
  }
  return "";
};

/**
 * What a decoded value could do harm with: the largest byteLength of any ArrayBuffer or view in it, and how many plain
 * objects in it lost Object.prototype as their prototype.
 */
export const scan = (value: any): { largest: number; replaced: number } => {
  let largest = 0;
  let replaced = 0;
  const seen = new Set<object>();
  const todo = [value];
  while (todo.length) {
    const item = todo.pop();
    if (typeof item !== "object" || item === null || seen.has(item)) continue;
    seen.add(item);
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) largest = Math.max(largest, item.byteLength);
    else if (item instanceof Map) for (const [key, member] of item) todo.push(key, member);
    else if (item instanceof Set || Array.isArray(item)) todo.push(...item);
    else {
      if (brand(item) === "Object" && Object.getPrototypeOf(item) !== Object.prototype) replaced++;
      todo.push(...Object.values(item));
    }
  }
  return { largest, replaced };
};
