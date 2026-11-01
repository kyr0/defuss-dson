// The text layer: JSON is only the carrier of the record list. Keeping JSON.parse/JSON.stringify here, and out of
// serialize.ts and deserialize.ts, lets clone() use the records without any text and isEqual() pick its own options.
import { deserialize } from "./deserialize.js";
import { serialize } from "./serialize.js";

/** Options of `stringify` and `isEqual`. */
export interface DSONOptions {
  /**
   * The deepest nesting of arrays, objects, Maps and Sets to accept; a deeper value throws a RangeError. Default
   * 100,000. Raise it for deeper data, or pass `Infinity` to remove the limit, which lets a getter that returns a new
   * object on every read run until memory is exhausted.
   */
  maxDepth?: number;
}

/**
 * Reads DSON text back into a value: `JSON.parse`, then the records are rebuilt into Maps, Dates, cycles and so on.
 *
 * Safe for untrusted text in the sense that it builds only the types listed in the format, throws on any other
 * type name, allocates binary data only from lists in the text, and keeps its call depth flat however deep the
 * input nests; the result is still untrusted data. A decoded RegExp, for example, is the sender's pattern.
 *
 * Why every failure after JSON.parse becomes a TypeError: a malformed record fails inside whatever builds it
 * (`BigInt("x")` throws a SyntaxError, `BigInt(1.5)` a RangeError, a missing record "undefined is not iterable"),
 * so without this the caller would have to expect any error class. Now SyntaxError means "not JSON" and TypeError
 * means "JSON, but not DSON"; the original error stays reachable as `cause`.
 * @param text DSON text, as written by `stringify`.
 * @returns the decoded value.
 * @throws SyntaxError when `text` is not JSON; TypeError when the records are not valid DSON.
 */
export const parse = (text: string): any => {
  const records = JSON.parse(text);
  try {
    return deserialize(records);
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith("DSON:")) throw error;
    throw new TypeError(`DSON: malformed record list: ${(error as Error).message}`, { cause: error });
  }
};

/**
 * Writes a value as DSON text. Why JSON as the carrier and not a binary format: the output travels wherever JSON
 * does (HTTP bodies, localStorage, postMessage, log lines) and stays readable in a debugger.
 *
 * It mirrors JSON.stringify where JSON has an answer (functions and symbols are dropped, `toJSON()` is honored)
 * and keeps the type where JSON loses it (see the README's type table).
 * @param value the value to encode; cycles and shared references are allowed.
 * @param options `maxDepth`; `null` and other non-objects count as no options, so `stringify(value, null, 2)`
 *  written for JSON still works.
 * @returns DSON text, which is valid JSON.
 * VERIFIED: src/json.test.ts reads the output with JSON.parse.
 */
export const stringify = (value: any, options?: DSONOptions): string =>
  JSON.stringify(serialize(value, true, true, options?.maxDepth));
