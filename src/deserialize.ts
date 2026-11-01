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

// Why fixed lists instead of `new globalThis[tag](payload)`: the tag comes from the input text. Looking it up on the
// global object let a crafted payload call any global constructor, such as Function (code from a string) or
// WebSocket (a network connection from the parsing process). Only the types the serializer writes can be built.
// VERIFIED: 1.1.2 returned a function for [["Function", "return 1"]]; src/regressions.test.ts pins the refusal.
const TYPED_ARRAYS = new Set([
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float16Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
]);

const NATIVE_ERRORS = new Map<string, ErrorConstructor>([
  ["Error", Error],
  ["EvalError", EvalError],
  ["RangeError", RangeError],
  ["ReferenceError", ReferenceError],
  ["SyntaxError", SyntaxError],
  ["TypeError", TypeError],
  ["URIError", URIError],
]);

/**
 * Rebuilds an Error. A native name gets its native class; any other name (a custom subclass of the sender) becomes an
 * Error carrying that name, since the receiver may not have the class and must not look it up globally.
 */
const createError = (name: string, message: string): Error => {
  // AggregateError takes (errors, message); `new AggregateError(message)` would iterate the message as the errors.
  const error =
    name === "AggregateError"
      ? new AggregateError([], message)
      : new (NATIVE_ERRORS.get(name) ?? Error)(message);
  if (error.name !== name) error.name = name;
  return error;
};

/**
 * Builds the decoder for one deserialize() call.
 * @param input record index → decoded value. A container is registered before its members are decoded, so a
 *  member that points back to its container gets the same object: this is how cycles are restored.
 * @param result the record list being read.
 */
const deserializer = (input: Map<number, any>, result: SerializedRecord[]) => {
  /** Indices of containers that exist but whose members are not decoded yet. Replaces recursion: see `decode`. */
  const stack: number[] = [];

  const getValue = (out: any, index: number): any => {
    input.set(index, out);
    return out;
  };

  /**
   * A list payload, required for binary data. Why check: the typed array constructors also take a number, as a
   * length, so the 22 characters `[["Float64Array",5e7]]` would allocate 400 MB. A list costs input text in
   * proportion to what it allocates.
   * VERIFIED: before this check, DSON.parse of that text returned a 400 MB Float64Array (src/regressions.test.ts).
   */
  const list = (type: string | number, value: any): any[] => {
    if (!Array.isArray(value))
      throw new TypeError(`DSON: the payload of a ${JSON.stringify(type)} record must be a list`);
    return value;
  };

  /**
   * The value of one record. A leaf is built completely; a container is created empty and registered, and its index
   * goes on the stack for `decode` to fill. Why not fill it here: filling calls this function for each member, so
   * the call depth would follow the nesting depth of the input, which the input chooses.
   */
  const valueOf = (index: number): any => {
    if (input.has(index)) return input.get(index);

    const [type, value] = result[index];
    switch (type) {
      case ARRAY:
        stack.push(index);
        return getValue([], index);
      case OBJECT:
        stack.push(index);
        return getValue({}, index);
      case MAP:
        stack.push(index);
        return getValue(new Map(), index);
      case SET:
        stack.push(index);
        return getValue(new Set(), index);
      case PRIMITIVE:
        return getValue(value, index);
      case VOID:
        // The payload is ignored on purpose: JSON writes undefined as null, so only the tag says "undefined".
        return getValue(undefined, index);
      case NUMBER:
        return getValue(Number(value), index);
      case DATE:
        return getValue(new Date(value), index);
      case REGEXP: {
        const { source, flags } = value;
        return getValue(new RegExp(source, flags), index);
      }
      case ERROR:
        return getValue(createError(value.name, value.message), index);
      case BIGINT:
        return getValue(BigInt(value), index);
      case "BigInt":
        return getValue(Object(BigInt(value)), index);
      case "Boolean":
        return getValue(new Boolean(value), index);
      case "Number":
        // The payload is a number, or a string for NaN, ±Infinity and -0; Number() converts both.
        return getValue(new Number(value), index);
      case "String":
        return getValue(new String(value), index);
      case "ArrayBuffer":
        return getValue(new Uint8Array(list(type, value)).buffer, index);
      case "DataView":
        return getValue(new DataView(new Uint8Array(list(type, value)).buffer), index);
    }
    const TypedArray = TYPED_ARRAYS.has(type as string)
      ? (globalThis as any)[type]
      : undefined;
    // Float16Array is listed but missing in older runtimes; an unknown or unavailable type fails loudly instead of
    // returning a value of the wrong type.
    if (typeof TypedArray !== "function")
      throw new TypeError(`DSON: unsupported record type ${JSON.stringify(type)}`);
    return getValue(new TypedArray(list(type, value)), index);
  };

  /** Fills one container created by `valueOf` with its members. */
  const fill = (index: number): void => {
    const container = input.get(index);
    const [type, value] = result[index];
    switch (type) {
      case ARRAY:
        for (const member of value) container.push(valueOf(member));
        break;
      case OBJECT:
        for (const [key, member] of value) {
          // String() first: assignment converts a key the same way, so a crafted key record such as
          // ["String", "__proto__"] or the array ["__proto__"] would otherwise pass the check below and still
          // reach the prototype setter.
          // VERIFIED: before String(), such a key set the parsed object's prototype (src/untrusted.test.ts).
          const name = String(valueOf(key));
          // Assigning "__proto__" would call the prototype setter and swap the object's prototype for input data.
          // JSON.parse creates an own property instead; so does DSON.
          if (name === "__proto__")
            Object.defineProperty(container, name, {
              value: valueOf(member),
              writable: true,
              enumerable: true,
              configurable: true,
            });
          else container[name] = valueOf(member);
        }
        break;
      case MAP:
        for (const [key, member] of value) container.set(valueOf(key), valueOf(member));
        break;
      default:
        // SET
        for (const member of value) container.add(valueOf(member));
    }
  };

  /**
   * Decodes the root and then every container reachable from it. Members are attached by reference, so a container
   * filled after its parent still ends up complete and in place; only the order of filling differs from recursion.
   */
  const decode = (root: number): any => {
    const value = valueOf(root);
    while (stack.length) fill(stack.pop()!);
    return value;
  };
  return decode;
};

/**
 * Rebuilds a value from its record list (the output of `serialize`).
 * @param serialized the records; record 0 is the root.
 * @returns the decoded value, with shared and circular references restored as shared objects.
 * @throws TypeError on a record tag outside the format, e.g. from a newer writer or a tampered input, and on binary
 *  data whose payload is not a list. Other malformed records throw whatever the failing operation throws; parse()
 *  turns those into a TypeError.
 */
export const deserialize = (serialized: SerializedRecord[]): any =>
  deserializer(new Map(), serialized)(0);
