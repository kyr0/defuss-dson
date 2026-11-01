import { describe, it, expect } from "vitest";
import { DSON } from "./index.js";
import { deserialize } from "./deserialize.js";
import { serialize } from "./serialize.js";
import { difference, prng, randomValue } from "./random.fixture.js";

const chain = (depth: number) => {
  let node: any = null;
  for (let i = 0; i < depth; i++) node = { next: node };
  return node;
};

describe("deep nesting", () => {
  it("round-trips 50,000 levels through stringify, parse, isEqual and the clone fallback", () => {
    // VERIFIED: the recursive walk overflowed the call stack at 2,343 levels on Node.js 26 and 18,779 on Bun 1.4.3.
    const deep = chain(50_000);
    for (const back of [DSON.parse(DSON.stringify(deep)), deserialize(serialize(deep))]) {
      let depth = 0;
      for (let node = back; node; node = node.next) depth++;
      expect(depth).toBe(50_000);
      expect(DSON.isEqual(deep, back)).toBe(true);
    }
  });

  it("writes a Map key that is a container before that entry's value, at any depth", () => {
    // Map keys take the deferred path of the encoder: the key's members first, then the value.
    let map: any = new Map();
    for (let i = 0; i < 20_000; i++) map = new Map([[map, i]]);
    const back = DSON.parse(DSON.stringify(map));
    let depth = 0;
    for (let node = back; node.size; node = [...node.keys()][0]) {
      expect([...node.values()][0]).toBe(19_999 - depth);
      depth++;
    }
    expect(depth).toBe(20_000);
    expect(DSON.stringify(new Map([[[1], 2]]))).toBe("[[5,[[1,3]]],[1,[2]],[0,1],[0,2]]");
  });

  it("takes maxDepth per call: the limit counts nested containers, Infinity removes it, a bad value throws", () => {
    const ten = chain(10);
    expect(DSON.parse(DSON.stringify(ten, { maxDepth: 10 }))).toEqual(ten);
    expect(() => DSON.stringify(ten, { maxDepth: 9 })).toThrow(/^DSON: value nested deeper than 9 levels$/);
    expect(() => DSON.isEqual(ten, ten, { maxDepth: 9 })).toThrow(RangeError);
    expect(DSON.isEqual(ten, chain(10), { maxDepth: 10 })).toBe(true);
    const deep = chain(150_000);
    expect(() => DSON.stringify(deep)).toThrow(/^DSON: value nested deeper than 100000 levels$/);
    expect(DSON.isEqual(DSON.parse(DSON.stringify(deep, { maxDepth: Infinity })), deep, { maxDepth: 200_000 })).toBe(true);
    for (const maxDepth of [0, -1, NaN, "5", null])
      expect(() => DSON.stringify(1, { maxDepth } as any), String(maxDepth)).toThrow(/^DSON: maxDepth must be a number of at least 1/);
    // JSON habits pass a replacer and an indent; DSON has neither and ignores them
    expect(DSON.stringify([1], null as any)).toBe("[[1,[1]],[0,1]]");
  });

  it("stops a graph without end with a RangeError instead of exhausting memory", () => {
    // a getter that returns a new object on every read: JSON.stringify throws a RangeError on it, too
    const endless = (): any => ({ get next() { return endless(); } });
    expect(() => DSON.stringify(endless())).toThrow(/^DSON: value nested deeper than 100000 levels$/);
  });
});

describe("toJSON", () => {
  it("calls toJSON() once per value, as JSON.stringify does, so one that returns this ends", () => {
    // VERIFIED: the recursive encoder called toJSON() on its own result again and overflowed the call stack.
    const self = { a: 1, toJSON() { return this; } };
    expect(DSON.parse(DSON.stringify(self))).toEqual(JSON.parse(JSON.stringify(self)));
    const nested = { toJSON: () => ({ toJSON: () => "never called" , b: 2 }) };
    expect(DSON.parse(DSON.stringify(nested))).toEqual(JSON.parse(JSON.stringify(nested)));
  });
});

describe("random values against structuredClone", () => {
  // structuredClone is the platform's own deep copy; where both carry a type, DSON must give the same graph.
  it("round-trips 500 seeded random graphs like structuredClone, and stringifies them back to the same text", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const value = randomValue(prng(seed));
      const native = structuredClone(value);
      const text = DSON.stringify(value);
      const back = DSON.parse(text);
      expect(difference(native, back), `seed ${seed}`).toBe("");
      expect(difference(native, deserialize(serialize(value))), `seed ${seed} (clone fallback)`).toBe("");
      expect(DSON.stringify(back), `seed ${seed}`).toBe(text);
      expect(DSON.isEqual(value, back), `seed ${seed}`).toBe(true);
    }
  });
});
