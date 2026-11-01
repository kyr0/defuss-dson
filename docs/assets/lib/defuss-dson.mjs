const VOID = -1;
const PRIMITIVE = 0;
const ARRAY = 1;
const OBJECT = 2;
const DATE = 3;
const REGEXP = 4;
const MAP = 5;
const SET = 6;
const ERROR = 7;
const BIGINT = 8;
const NUMBER = 9;

const EMPTY = "";
const { toString: objectToString } = {};
const { keys: objectKeys } = Object;
const getType = (value) => {
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
  if (ArrayBuffer.isView(value)) return [ARRAY, asString];
  if (asString.includes("Error")) return [ERROR, asString];
  return [OBJECT, asString];
};
const isIgnoredType = ([TYPE, type]) => TYPE === PRIMITIVE && (type === "function" || type === "symbol");
const specialNumberToString = (value) => Object.is(value, -0) ? "-0" : String(value);
const MAX_DEPTH = 1e5;
const serializer = (strict, json, signedZero, maxDepth, input, result) => {
  const isSpecialNumber = (value) => !Number.isFinite(value) || signedZero && Object.is(value, -0);
  const encodeTypedItem = (item) => typeof item === "bigint" ? String(item) : isSpecialNumber(item) ? specialNumberToString(item) : item;
  const getIndex = (out, value) => {
    const index = result.push(out) - 1;
    if (!Object.is(value, -0)) input.set(value, index);
    return index;
  };
  const stack = [];
  const open = (kind, source, out, keys, iterator) => {
    if (stack.length >= maxDepth)
      throw new RangeError(`DSON: value nested deeper than ${maxDepth} levels`);
    const index = getIndex([kind, out], source);
    stack.push({ kind, source, out, position: 0, keys, iterator, key: -1, pending: void 0 });
    return index;
  };
  const visit = (value, toJSON) => {
    if (!signedZero && Object.is(value, -0)) value = 0;
    if (!Object.is(value, -0) && input.has(value)) return input.get(value);
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
            entry = null;
            break;
          case "undefined":
            return getIndex([VOID, void 0], value);
        }
        return getIndex([TYPE, entry], value);
      }
      case ARRAY: {
        if (type) {
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
        return getIndex(
          [TYPE, Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString()],
          value
        );
      case REGEXP: {
        const { source, flags } = value;
        return getIndex([TYPE, { source, flags }], value);
      }
      case MAP:
      case SET:
        return open(TYPE, value, [], void 0, value[Symbol.iterator]());
      default: {
        const { name, message } = value;
        return getIndex([ERROR, { name, message }], value);
      }
    }
  };
  const keeps = (value) => strict || !isIgnoredType(getType(value));
  const encode = (value) => {
    visit(value, json);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const { source, out } = frame;
      if (frame.key >= 0) {
        out.push([frame.key, visit(frame.pending, json)]);
        frame.key = -1;
        continue;
      }
      switch (frame.kind) {
        case ARRAY:
          if (frame.position < source.length) out.push(visit(source[frame.position++], json));
          else stack.pop();
          break;
        case OBJECT: {
          const keys = frame.keys;
          let name;
          let member;
          while (frame.position < keys.length) {
            const key = keys[frame.position++];
            member = source[key];
            if (keeps(member)) {
              name = key;
              break;
            }
          }
          if (name === void 0) stack.pop();
          else out.push([visit(name, json), visit(member, json)]);
          break;
        }
        case MAP: {
          let step;
          while (!(step = frame.iterator.next()).done && !(keeps(step.value[0]) && keeps(step.value[1]))) ;
          if (step.done) {
            stack.pop();
            break;
          }
          const [key, member] = step.value;
          const depth = stack.length;
          const index = visit(key, json);
          if (stack.length > depth) {
            frame.key = index;
            frame.pending = member;
          } else out.push([index, visit(member, json)]);
          break;
        }
        default: {
          let step;
          while (!(step = frame.iterator.next()).done && !keeps(step.value)) ;
          if (step.done) stack.pop();
          else out.push(visit(step.value, json));
        }
      }
    }
  };
  return encode;
};
const serialize = (value, json = false, signedZero = true, maxDepth = MAX_DEPTH) => {
  if (typeof maxDepth !== "number" || !(maxDepth >= 1))
    throw new RangeError(`DSON: maxDepth must be a number of at least 1, got ${String(maxDepth)}`);
  const result = [];
  serializer(!json, json, signedZero, maxDepth, /* @__PURE__ */ new Map(), result)(value);
  return result;
};

const comparable = (value, maxDepth) => JSON.stringify(serialize(value, true, false, maxDepth));
function isEqual(objectA, objectB, options) {
  return comparable(objectA, options?.maxDepth) === comparable(objectB, options?.maxDepth);
}

const TYPED_ARRAYS = /* @__PURE__ */ new Set([
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
  "BigUint64Array"
]);
const NATIVE_ERRORS = /* @__PURE__ */ new Map([
  ["Error", Error],
  ["EvalError", EvalError],
  ["RangeError", RangeError],
  ["ReferenceError", ReferenceError],
  ["SyntaxError", SyntaxError],
  ["TypeError", TypeError],
  ["URIError", URIError]
]);
const createError = (name, message) => {
  const error = name === "AggregateError" ? new AggregateError([], message) : new (NATIVE_ERRORS.get(name) ?? Error)(message);
  if (error.name !== name) error.name = name;
  return error;
};
const deserializer = (input, result) => {
  const stack = [];
  const getValue = (out, index) => {
    input.set(index, out);
    return out;
  };
  const list = (type, value) => {
    if (!Array.isArray(value))
      throw new TypeError(`DSON: the payload of a ${JSON.stringify(type)} record must be a list`);
    return value;
  };
  const valueOf = (index) => {
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
        return getValue(/* @__PURE__ */ new Map(), index);
      case SET:
        stack.push(index);
        return getValue(/* @__PURE__ */ new Set(), index);
      case PRIMITIVE:
        return getValue(value, index);
      case VOID:
        return getValue(void 0, index);
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
        return getValue(new Number(value), index);
      case "String":
        return getValue(new String(value), index);
      case "ArrayBuffer":
        return getValue(new Uint8Array(list(type, value)).buffer, index);
      case "DataView":
        return getValue(new DataView(new Uint8Array(list(type, value)).buffer), index);
    }
    const TypedArray = TYPED_ARRAYS.has(type) ? globalThis[type] : void 0;
    if (typeof TypedArray !== "function")
      throw new TypeError(`DSON: unsupported record type ${JSON.stringify(type)}`);
    return getValue(new TypedArray(list(type, value)), index);
  };
  const fill = (index) => {
    const container = input.get(index);
    const [type, value] = result[index];
    switch (type) {
      case ARRAY:
        for (const member of value) container.push(valueOf(member));
        break;
      case OBJECT:
        for (const [key, member] of value) {
          const name = String(valueOf(key));
          if (name === "__proto__")
            Object.defineProperty(container, name, {
              value: valueOf(member),
              writable: true,
              enumerable: true,
              configurable: true
            });
          else container[name] = valueOf(member);
        }
        break;
      case MAP:
        for (const [key, member] of value) container.set(valueOf(key), valueOf(member));
        break;
      default:
        for (const member of value) container.add(valueOf(member));
    }
  };
  const decode = (root) => {
    const value = valueOf(root);
    while (stack.length) fill(stack.pop());
    return value;
  };
  return decode;
};
const deserialize = (serialized) => deserializer(/* @__PURE__ */ new Map(), serialized)(0);

const parse = (text) => {
  const records = JSON.parse(text);
  try {
    return deserialize(records);
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith("DSON:")) throw error;
    throw new TypeError(`DSON: malformed record list: ${error.message}`, { cause: error });
  }
};
const stringify = (value, options) => JSON.stringify(serialize(value, true, true, options?.maxDepth));

const clone = (value) => typeof structuredClone === "function" ? structuredClone(value) : deserialize(serialize(value));
const DSON = {
  parse,
  stringify,
  isEqual,
  clone
};

export { DSON };
