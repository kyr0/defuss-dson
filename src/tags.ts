/**
 * Record tags of the DSON wire format.
 *
 * A serialized value is a flat array of records `[tag, payload]`; record 0 is the root, and containers refer to
 * their members by record index. Why a flat, indexed list instead of a nested JSON tree: an index can point back to
 * a record that is still being built, so circular and shared references cost one number instead of a copy, and
 * the result stays plain JSON that any JSON parser can read.
 *
 * Numeric tags name the structural kinds below. String tags name a constructor whose payload is a list of numbers
 * or a primitive: `ArrayBuffer`, `DataView`, the typed arrays and the wrapper objects `BigInt`, `Boolean`,
 * `Number` and `String`. The decoder accepts only that fixed list (see `deserialize.ts`), never an arbitrary name.
 *
 * VERIFIED: tags -1 to 8 are the format of defuss-dson 1.0 and 1.1; their numbers are part of the wire format and
 * never change. NUMBER (9) was added in 1.2.0; readers before 1.2.0 throw on it instead of misreading it.
 */

/** `undefined`. Payload: ignored (JSON writes `null`); the tag alone carries the value. */
export const VOID = -1;
/** string, finite number, boolean or null. Payload: the value itself. */
export const PRIMITIVE = 0;
/** Plain array. Payload: the record indices of its items. */
export const ARRAY = 1;
/** Plain object, class instance or unknown object. Payload: `[keyIndex, valueIndex]` pairs. */
export const OBJECT = 2;
/**
 * Date. Payload: `toISOString()`, always UTC, or `"Invalid Date"` for an invalid one. A Date is an instant without a
 * time zone, so the UTC text keeps everything it holds, to the millisecond.
 */
export const DATE = 3;
/** RegExp. Payload: `{ source, flags }`. */
export const REGEXP = 4;
/** Map. Payload: `[keyIndex, valueIndex]` pairs in insertion order. */
export const MAP = 5;
/** Set. Payload: the record indices of its members in insertion order. */
export const SET = 6;
/** Error and its subclasses. Payload: `{ name, message }`. */
export const ERROR = 7;
/** Primitive bigint. Payload: decimal string, because JSON has no integer type beyond 2^53. */
export const BIGINT = 8;
/** NaN, Infinity, -Infinity and -0, which JSON cannot represent. Payload: `"NaN"|"Infinity"|"-Infinity"|"-0"`. */
export const NUMBER = 9;

/** One entry of the serialized record list. */
export type SerializedRecord = [tag: number | string, payload: any];

/** Binary v1 tags. Separate payload grammar; never valid in the text record format. */
export const B_NULL = 10;
export const B_UNDEFINED = 11;
export const B_FALSE = 12;
export const B_TRUE = 13;
export const B_STRING = 14;
export const B_FLOAT64 = 15;
export const B_BIGINT = 16;
export const B_ARRAY = 17;
export const B_OBJECT = 18;
export const B_NULL_OBJECT = 19;
export const B_DATE = 20;
export const B_REGEXP = 21;
export const B_MAP = 22;
export const B_SET = 23;
export const B_ERROR = 24;
export const B_BUFFER = 25;
export const B_VIEW = 26;
export const B_BOX = 27;
