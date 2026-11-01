import { isEqual } from "./equals.js";
import { parse, stringify, type DSONOptions } from "./json.js";

export type { DSONOptions };
import { deserialize } from "./deserialize.js";
import { serialize } from "./serialize.js";

/**
 * Deep-copies a value in memory.
 *
 * Why `structuredClone` first: it is native and keeps what a text format cannot, such as Error stacks and one
 * ArrayBuffer shared by several views. The DSON fallback covers runtimes that lack it (some embedded JavaScript
 * engines). Both paths throw on functions and symbols instead of dropping them, because a clone that silently loses
 * members hides bugs.
 */
const clone = <T>(value: T): T =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : deserialize(serialize(value));

/**
 * The DSON API. Declared as an interface so that the published type declarations carry each method's
 * documentation to editors; an inferred object type would drop it.
 * VERIFIED: with the inferred type, dist/index.d.mts had no comment on parse, stringify or clone.
 */
interface DSONApi {
  /**
   * Reads DSON text back into a value, restoring types, cycles and shared references.
   *
   * Builds only the types of the DSON format, from fixed lists, and throws on any other type name, so untrusted
   * text cannot make it construct `Function`, `WebSocket` or any other global while it is parsed. Binary data is
   * built only from lists in the text, and deep nesting cannot overflow the call stack. The result is still data
   * from the sender.
   * @param text DSON text, as written by `DSON.stringify`.
   * @returns the decoded value.
   * @throws SyntaxError when `text` is not JSON; TypeError when the records are not valid DSON (an unknown tag, a
   *  missing record, a payload of the wrong shape), with the underlying error as `cause`.
   * @example DSON.parse(DSON.stringify(new Map([["a", 1]]))).get("a") // 1
   */
  parse(text: string): any;
  /**
   * Writes a value as DSON text, which is valid JSON.
   *
   * Behaves like `JSON.stringify` where JSON has an answer (functions and symbols are dropped, `toJSON()` is
   * honoured, once per value) and keeps the type where JSON loses it: Map, Set, Date, RegExp, BigInt, Error, typed
   * arrays, ArrayBuffer, DataView, undefined, NaN, ±Infinity and -0. Cycles and shared references are allowed.
   * @param value the value to encode.
   * @param options `maxDepth`: the deepest nesting to accept, default 100,000.
   * @returns DSON text.
   * @throws RangeError when the value nests deeper than `maxDepth`, e.g. a getter that returns a new object on
   *  every read, or when `maxDepth` is not a number of at least 1.
   * @example DSON.stringify(deepTree, { maxDepth: 1_000_000 })
   */
  stringify(value: any, options?: DSONOptions): string;
  /**
   * Tells whether two values hold the same data, by comparing their DSON texts: key, Map and Set order count,
   * functions and symbols are ignored, NaN equals NaN and 0 equals -0.
   * @param options `maxDepth`, as for `stringify`.
   * @returns `true` when both values serialize to the same DSON text.
   */
  isEqual(objectA: any, objectB: any, options?: DSONOptions): boolean;
  /**
   * Deep-copies a value with `structuredClone`, or with DSON records where the runtime lacks it.
   * Cycles and shared references are preserved; class instances come back as plain objects.
   * @throws on functions and symbols (DataCloneError or TypeError) instead of dropping them. The DSON fallback also
   *  throws a RangeError beyond the default `maxDepth` of 100,000 levels.
   */
  clone<T>(value: T): T;
}

/** The public API: a JSON-shaped object, so `JSON` can be swapped for `DSON` at a call site. */
export const DSON: DSONApi = {
  parse,
  stringify,
  isEqual,
  clone,
};
