import { describe, it, expect } from "vitest";
import { parse, stringify } from "./json.js";

// stringify mirrors JSON.stringify wherever JSON has an answer; these cases pin that half of the contract.
describe("JSON-compatible behaviour", () => {
  it("drops functions and symbols from objects, Maps and Sets, and writes null for them inside arrays", () => {
    const fn = () => 1;
    const sym = Symbol("s");
    const parsed = parse(
      stringify({ keep: 1, fn, sym, list: [fn, sym, 2], map: new Map<any, any>([["a", fn], [fn, "b"], ["c", 3]]), set: new Set([fn, 4]) }),
    );
    expect(Object.keys(parsed)).toEqual(["keep", "list", "map", "set"]);
    expect(parsed.list).toEqual([null, null, 2]);
    expect([...parsed.map]).toEqual([["c", 3]]);
    expect([...parsed.set]).toEqual([4]);
    expect(JSON.parse(JSON.stringify({ list: [fn, sym, 2] })).list).toEqual(parsed.list);
  });

  it("encodes an object with toJSON() as that method's result", () => {
    const money = { amount: 5, toJSON: () => "5 EUR" };
    expect(parse(stringify({ money })).money).toBe("5 EUR");
  });

  it("keeps Boolean, Number and String wrapper objects as wrappers", () => {
    const [flag, count, label] = parse(stringify([Object(false), Object(7), Object("x")]));
    expect(flag).toBeInstanceOf(Boolean);
    expect(flag.valueOf()).toBe(false);
    expect(count).toBeInstanceOf(Number);
    expect(count.valueOf()).toBe(7);
    expect(label).toBeInstanceOf(String);
    expect(label.valueOf()).toBe("x");
  });

  it("writes valid JSON that JSON.parse reads", () => {
    expect(Array.isArray(JSON.parse(stringify({ at: new Date(0), n: NaN })))).toBe(true);
  });

  it("throws a SyntaxError on text that is not JSON", () => {
    expect(() => parse("not json")).toThrow(SyntaxError);
  });
});
