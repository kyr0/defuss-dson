import { describe, it, expect } from "vitest";
import { DSON } from "./index.js";
import { prng, randomValue, scan } from "./random.fixture.js";

// DSON.parse reads text from other processes. These cases pin what such text can and cannot make it do.
const parse = (records: unknown[]) => DSON.parse(JSON.stringify(records));

describe("binary data from untrusted text", () => {
  it("builds typed arrays, ArrayBuffer and DataView only from a list, never from a length", () => {
    // VERIFIED: before the list check, [["Float64Array",5e7]] (22 characters) returned a 400 MB Float64Array.
    for (const record of [
      ["Float64Array", 5e7],
      ["BigInt64Array", { length: 1e9 }],
      ["ArrayBuffer", 1e9],
      ["DataView", 1e9],
      ["Uint8Array", "abc"],
    ]) {
      expect(() => parse([record]), JSON.stringify(record)).toThrow(/^DSON: the payload of a .* record must be a list$/);
    }
    expect(parse([["Uint8Array", [1, 2]]])).toEqual(new Uint8Array([1, 2]));
  });
});

describe("__proto__ keys from untrusted text", () => {
  it("keeps a key record that converts to \"__proto__\" an own property", () => {
    // VERIFIED: before String(key), both inputs set the parsed object's prototype to { polluted: true }.
    const wrapper = parse([[2, [[1, 2]]], ["String", "__proto__"], [2, [[3, 4]]], [0, "polluted"], [0, true]]);
    // the key array is filled before the object that uses it, so it reads "__proto__" when converted
    const [viaArray] = parse([[1, [1, 2]], [2, [[2, 3]]], [1, [4]], [2, [[5, 6]]], [0, "__proto__"], [0, "polluted"], [0, true]]);
    for (const object of [wrapper, viaArray]) {
      expect(Object.getPrototypeOf(object)).toBe(Object.prototype);
      expect(Object.hasOwn(object, "__proto__")).toBe(true);
      expect(object.polluted).toBeUndefined();
    }
  });
});

describe("errors from malformed text", () => {
  it("throws SyntaxError for text that is not JSON and TypeError for JSON that is not DSON", () => {
    expect(() => DSON.parse("not json")).toThrow(SyntaxError);
    const cases: [string, (new (...args: any[]) => Error) | undefined][] = [
      ["[]", TypeError],
      ["{}", TypeError],
      ["[null]", TypeError],
      ["[[1,[7]]]", TypeError],
      ["[[2,5]]", TypeError],
      ['[[4,{"source":"(","flags":""}]]', SyntaxError],
      ['[[8,"x"]]', SyntaxError],
      ["[[8,1.5]]", RangeError],
      ['[["Function","return 1"]]', undefined],
    ];
    for (const [text, cause] of cases) {
      let error: any;
      try {
        DSON.parse(text);
      } catch (thrown) {
        error = thrown;
      }
      expect(error, text).toBeInstanceOf(TypeError);
      expect(error.message, text).toMatch(/^DSON: /);
      // the error of the operation that failed stays reachable; DSON's own checks have none
      if (cause) expect(error.cause, text).toBeInstanceOf(cause);
      else expect(error.cause, text).toBeUndefined();
    }
  });
});

describe("fuzzing", () => {
  const TAGS = [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1.5, null, "Function", "WebSocket", "__proto__", "constructor",
    "Uint8Array", "Float64Array", "BigInt64Array", "ArrayBuffer", "DataView", "BigInt", "Number", "String", "Boolean"];
  const JUNK = [0, -1, 1.5, 5e7, 1e9, 1e300, "", "abc", "__proto__", "Invalid Date", true, null, [], [0], [0, 0], [[0, 0]],
    [1e9], ["__proto__"], {}, { length: 1e9 }, { source: "(", flags: "zz" }, { name: {}, message: 5 }];

  /** One random edit of a record list: a tag, a payload, a member index, the list's length or a whole record. */
  const mutate = (records: any[], next: () => number) => {
    const int = (n: number) => Math.floor(next() * n);
    // a copy per pick: mutating a shared junk array could otherwise make the list circular
    const pick = <T>(list: readonly T[]): T => structuredClone(list[int(list.length)]);
    const record = records[int(records.length)];
    switch (int(6)) {
      case 0: if (Array.isArray(record)) record[0] = pick(TAGS); break;
      case 1: if (Array.isArray(record)) record[1] = pick(JUNK); break;
      case 2:
        if (Array.isArray(record) && Array.isArray(record[1]) && record[1].length)
          record[1][int(record[1].length)] = pick([-1, 1.5, 1e9, "0", "__proto__", null, [0], int(records.length + 3)]);
        break;
      case 3: records.length = int(records.length + 1); break;
      case 4: records.push([pick(TAGS), pick(JUNK)]); break;
      default: records[int(records.length)] = pick(JUNK);
    }
  };

  it("parses 3,000 mutated record lists into data or a DSON TypeError, never a big buffer or a swapped prototype", () => {
    for (let seed = 1; seed <= 3000; seed++) {
      const next = prng(seed);
      const records = JSON.parse(DSON.stringify(randomValue(next, 3)));
      for (let edits = 1 + Math.floor(next() * 3); edits > 0; edits--) mutate(records, next);
      const text = JSON.stringify(records);
      let value: unknown;
      try {
        value = DSON.parse(text);
      } catch (error: any) {
        expect(error, `seed ${seed}: ${text}`).toBeInstanceOf(TypeError);
        expect(error.message, `seed ${seed}`).toMatch(/^DSON: /);
        continue;
      }
      // a list item costs at least two characters of text and builds at most eight bytes
      const { largest, replaced } = scan(value);
      expect(largest, `seed ${seed}: ${text}`).toBeLessThanOrEqual(8 * text.length);
      expect(replaced, `seed ${seed}: ${text}`).toBe(0);
    }
  });
});
