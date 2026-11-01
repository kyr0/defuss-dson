/**
 * Encoder: one depth-first walk that turns a value graph into the record list of the DSON format (see tags.ts).
 * Pure and synchronous; JSON text is produced by json.ts, so this module also serves clone() and isEqual(), which
 * need the records with other options.
 */
import {
  VOID,
  PRIMITIVE,
  ARRAY,
  OBJECT,
  DATE,
  REGEXP,
  MAP,
  SET,
  ERROR,
  BIGINT,
  NUMBER,
  type SerializedRecord,
} from "./tags.js";

const EMPTY = "";

// Object.prototype.toString reads the internal brand ("[object Map]"), which survives subclassing and realms where
// `instanceof` fails (iframes, Node vm contexts).
const { toString: objectToString } = {};
const { keys: objectKeys } = Object;

/** [structural tag, constructor name or typeof result]; the name is EMPTY when the tag alone is enough. */
type TypeResult = [number, string];

/**
 * Classifies a value. Primitives by `typeof`; objects by their internal brand, so a subclass of Map is still a Map
 * and objects from another realm classify like local ones. Unknown brands fall back to OBJECT with the brand name,
 * which the encoder writes as a plain object.
 */
const getType = (value: any): TypeResult => {
  const type = typeof value;
  if (type !== "object" || !value) return [PRIMITIVE, type];

  const asString = objectToString.call(value).slice(8, -1);
  switch (asString) {
    case "Array":
      return [ARRAY, EMPTY];
    case "Object":
      return [OBJECT, EMPTY];
    case "Date":
      return [DATE, EMPTY];
    case "RegExp":
      return [REGEXP, EMPTY];
    case "Map":
      return [MAP, EMPTY];
    case "Set":
      return [SET, EMPTY];
    case "ArrayBuffer":
      return [ARRAY, asString];
  }

  // Typed arrays and DataView. Why not `asString.includes("Array")`: that also matched "Array Iterator", which then
  // serialized under a tag no decoder can construct, and "SharedArrayBuffer", whose spread throws.
  // VERIFIED: 1.1.2 stringified `[1, 2].values()` into text its parse rejected (src/regressions.test.ts).
  if (ArrayBuffer.isView(value)) return [ARRAY, asString];

  if (asString.includes("Error")) return [ERROR, asString];

  return [OBJECT, asString];
};

/** Functions and symbols: the values JSON.stringify drops, so non-strict encoding skips them too. */
const isIgnoredType = ([TYPE, type]: TypeResult): boolean =>
  TYPE === PRIMITIVE && (type === "function" || type === "symbol");

/** String() turns -0 into "0", so -0 is spelled out; the other special numbers print as `Number()` reads them back. */
const specialNumberToString = (value: number): string =>
  Object.is(value, -0) ? "-0" : String(value);

/**
 * Default for the deepest nesting serialize() accepts; the `maxDepth` option overrides it per call. Why a limit at
 * all: the walk keeps its path in an array, not on the call stack, so a getter that returns a new object on every
 * read (an endless graph) would grow that array until the process runs out of memory. JSON.stringify stops such a
 * graph with a catchable RangeError; so does DSON, here. Why 100,000: 43 times the depth at which the recursive walk
 * of 1.1 overflowed on Node.js, while an endless graph still stops within about 100 ms.
 * VERIFIED: before the explicit stack, Node.js 26 overflowed at 2,343 levels and Bun 1.4.3 at 18,779
 * (src/structure.test.ts round-trips 50,000). VERIFIED: (probe, 2026-11-01, Apple M5 Max) an endless getter graph
 * reached the default limit after 91 ms on Node.js 26 and 64 ms on Bun 1.4.3.
 */
export const MAX_DEPTH = 100_000;

/**
 * A container whose members are still being encoded. The frames form an explicit stack that replaces recursion, so
 * the nesting depth is bounded by `maxDepth` instead of the engine's call stack.
 */
interface Frame {
  /** ARRAY, OBJECT, MAP or SET. */
  kind: number;
  /** The container. */
  source: any;
  /** The record's payload being filled: member indices, or [key, value] index pairs. */
  out: any[];
  /** Next array index or object key. */
  position: number;
  /** An object's own enumerable keys, read when its record is opened. */
  keys: string[] | undefined;
  /** A Map's or Set's entries. */
  iterator: Iterator<any> | undefined;
  /** Index of a Map key whose value waits until the key's own members are written; -1 when none waits. */
  key: number;
  /** The value of that entry. */
  pending: any;
}

/**
 * Builds the encoder for one serialize() call.
 * @param strict throw on functions and symbols instead of dropping them; used by clone(), where silent loss would
 *  hide a bug, and off for stringify(), which mirrors JSON.stringify.
 * @param json call `toJSON()` where an object has one, as JSON.stringify does.
 * @param signedZero keep -0 apart from 0. Off only for isEqual(), which compares numbers like Map keys do.
 * @param maxDepth the deepest nesting of containers to accept; deeper throws a RangeError.
 * @param input value → record index of everything already encoded; this map is what makes shared and circular
 *  references collapse into one record.
 * @param result the record list being written.
 */
const serializer = (
  strict: boolean,
  json: boolean,
  signedZero: boolean,
  maxDepth: number,
  input: Map<any, number>,
  result: SerializedRecord[],
) => {
  /** NaN, ±Infinity and (with signedZero) -0: the numbers JSON writes as `null` or `0`. */
  const isSpecialNumber = (value: number): boolean =>
    !Number.isFinite(value) || (signedZero && Object.is(value, -0));

  /**
   * Item of a typed-array payload. bigint items (BigInt64Array) become decimal strings, because JSON.stringify throws
   * on bigint; NaN, ±Infinity and -0 (float arrays) become strings, because JSON writes them as null or 0. Why
   * strings and not a new tag: typed array constructors convert strings back with ToNumber/ToBigInt, so readers
   * older than 1.2.0 decode these payloads correctly, too.
   */
  const encodeTypedItem = (item: number | bigint): number | string =>
    typeof item === "bigint"
      ? String(item)
      : isSpecialNumber(item)
        ? specialNumberToString(item)
        : item;

  const getIndex = (out: SerializedRecord, value: any): number => {
    const index = result.push(out) - 1;
    // Map keys compare with SameValueZero, which treats -0 as 0: caching -0 would make every later 0 point at it.
    if (!Object.is(value, -0)) input.set(value, index);
    return index;
  };

  const stack: Frame[] = [];

  /**
   * Registers a container's record and schedules its members. The record gets its index before any member is
   * written, so a member that refers back to the container resolves to this index instead of looping forever, and
   * the records come out in the same depth-first order as the recursive encoder of 1.1 wrote them.
   */
  const open = (kind: number, source: any, out: any[], keys?: string[], iterator?: Iterator<any>): number => {
    if (stack.length >= maxDepth)
      throw new RangeError(`DSON: value nested deeper than ${maxDepth} levels`);
    const index = getIndex([kind, out], source);
    stack.push({ kind, source, out, position: 0, keys, iterator, key: -1, pending: undefined });
    return index;
  };

  /**
   * Writes one value and returns its record index. A leaf is written completely; a container only gets its record
   * and a frame, and the loop in `encode` writes its members.
   * @param toJSON whether an object's `toJSON()` may be called. False for the result of a `toJSON()` call: like
   *  JSON.stringify, DSON calls it once per value, so a `toJSON()` that returns `this` ends instead of looping.
   */
  const visit = (value: any, toJSON: boolean): number => {
    if (!signedZero && Object.is(value, -0)) value = 0;
    if (!Object.is(value, -0) && input.has(value)) return input.get(value)!;

    let [TYPE, type] = getType(value);
    switch (TYPE) {
      case PRIMITIVE: {
        let entry = value;
        switch (type) {
          case "number":
            if (isSpecialNumber(value)) {
              TYPE = NUMBER;
              entry = specialNumberToString(value);
            }
            break;
          case "bigint":
            TYPE = BIGINT;
            entry = value.toString();
            break;
          case "function":
          case "symbol":
            if (strict) throw new TypeError(`unable to serialize ${type}`);
            // Inside arrays a dropped item still needs a slot; null keeps the indices, as in JSON.stringify.
            entry = null;
            break;
          case "undefined":
            return getIndex([VOID, undefined], value);
        }
        return getIndex([TYPE, entry], value);
      }
      case ARRAY: {
        if (type) {
          // Binary data is stored as its bytes or items, not as records per item: one record per buffer keeps the
          // output linear in the buffer size. byteOffset and byteLength matter: a DataView or typed array may
          // cover only part of its buffer.
          let spread = value;
          if (type === "DataView") {
            spread = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
          } else if (type === "ArrayBuffer") {
            spread = new Uint8Array(value);
          }
          return getIndex([type, Array.from(spread, encodeTypedItem)], value);
        }
        return open(TYPE, value, []);
      }
      case OBJECT: {
        if (type) {
          switch (type) {
            case "BigInt":
              return getIndex([type, value.toString()], value);
            case "Number": {
              const number = value.valueOf();
              return getIndex([type, isSpecialNumber(number) ? specialNumberToString(number) : number], value);
            }
            case "Boolean":
            case "String":
              return getIndex([type, value.valueOf()], value);
          }
        }

        if (toJSON && "toJSON" in value) return visit(value.toJSON(), false);
        return open(TYPE, value, [], objectKeys(value));
      }
      case DATE:
        // toISOString() is UTC and exact to the millisecond, which is all a Date holds (it has no time zone). It
        // throws a RangeError on an invalid Date; `new Date("Invalid Date")` reads that string back in every version.
        return getIndex(
          [TYPE, Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString()],
          value,
        );
      case REGEXP: {
        const { source, flags } = value;
        return getIndex([TYPE, { source, flags }], value);
      }
      case MAP:
      case SET:
        return open(TYPE, value, [], undefined, value[Symbol.iterator]());
      default: {
        // ERROR: name and message only. A stack trace describes the sender's process and can leak its file paths.
        const { name, message } = value;
        return getIndex([ERROR, { name, message }], value);
      }
    }
  };

  /** Whether a member is written: everything when strict, else all but functions and symbols, as in JSON. */
  const keeps = (value: any): boolean => strict || !isIgnoredType(getType(value));

  /**
   * Writes the whole graph. Each turn writes one member of the innermost open container; a member that is itself a
   * container opens a frame on top, so it is finished before its parent's next member: depth-first, as recursion did.
   */
  const encode = (value: any): void => {
    visit(value, json);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const { source, out } = frame;
      if (frame.key >= 0) {
        // the key of this Map entry was a container and is written now; its value follows
        out.push([frame.key, visit(frame.pending, json)]);
        frame.key = -1;
        continue;
      }
      switch (frame.kind) {
        case ARRAY:
          // array items are never skipped: a dropped function or symbol becomes null, which keeps the indices
          if (frame.position < source.length) out.push(visit(source[frame.position++], json));
          else stack.pop();
          break;
        case OBJECT: {
          const keys = frame.keys!;
          let name: string | undefined;
          let member: any;
          while (frame.position < keys.length) {
            const key = keys[frame.position++];
            // read once: a getter runs once per key, and its value is the one both checked and written
            member = source[key];
            if (keeps(member)) {
              name = key;
              break;
            }
          }
          if (name === undefined) stack.pop();
          else out.push([visit(name, json), visit(member, json)]);
          break;
        }
        case MAP: {
          let step: IteratorResult<[any, any]>;
          while (!(step = frame.iterator!.next()).done && !(keeps(step.value[0]) && keeps(step.value[1])));
          if (step.done) {
            stack.pop();
            break;
          }
          const [key, member] = step.value;
          const depth = stack.length;
          const index = visit(key, json);
          // a container key opened a frame: its members come first, then this entry's value (key before value)
          if (stack.length > depth) {
            frame.key = index;
            frame.pending = member;
          } else out.push([index, visit(member, json)]);
          break;
        }
        default: {
          // SET
          let step: IteratorResult<any>;
          while (!(step = frame.iterator!.next()).done && !keeps(step.value));
          if (step.done) stack.pop();
          else out.push(visit(step.value, json));
        }
      }
    }
  };
  return encode;
};

/**
 * Encodes a value as a list of records (see `tags.ts`); record 0 is the root.
 * @param value any value; class instances are encoded as plain objects of their own enumerable string keys.
 * @param json `true` behaves like JSON.stringify: functions and symbols are dropped (`null` inside arrays) and
 *  `toJSON()` is honored. `false` (clone) throws a TypeError on functions and symbols instead.
 * @param signedZero `false` writes -0 as 0; isEqual() uses it so that 0 and -0 compare equal.
 * @param maxDepth the deepest nesting of containers to accept, at least 1; `Infinity` removes the limit.
 * @returns the record list; `JSON.stringify` of it is the DSON text.
 * @throws RangeError when `maxDepth` is not a number of at least 1, or the value nests deeper.
 */
export const serialize = (
  value: any,
  json = false,
  signedZero = true,
  maxDepth = MAX_DEPTH,
): SerializedRecord[] => {
  // checked up front: a wrong option should fail on every value, not only on the first deep one
  if (typeof maxDepth !== "number" || !(maxDepth >= 1))
    throw new RangeError(`DSON: maxDepth must be a number of at least 1, got ${String(maxDepth)}`);
  const result: SerializedRecord[] = [];
  serializer(!json, json, signedZero, maxDepth, new Map(), result)(value);
  return result;
};
