# DSON format

This page specifies the text `DSON.stringify` writes and `DSON.parse` reads, for anyone who writes a reader in another language, debugs a payload or reviews the trust model. VERIFIED: it describes defuss-dson 1.2.0; tags -1 to 8 are unchanged since 1.0.

## Shape

DSON text is a JSON array of records. Each record is a two-element array `[tag, payload]`. Record 0 is the root value; container payloads refer to other records by their index in the array.

```js
import { DSON } from "defuss-dson";

const node = { tags: new Set(["a"]) };
node.self = node;

console.log(DSON.stringify(node)); // [[2,[[1,2],[4,0]]],[0,"tags"],[6,[3]],[0,"a"],[0,"self"]]
```

Record 0 is an object (tag `2`) with two entries. The first maps key record 1 (`"tags"`) to record 2, a Set (tag `6`) whose member is record 3 (`"a"`). The second maps key record 4 (`"self"`) to record 0, the object itself.

Why a flat, indexed list instead of a nested tree: an index can point at a record that is still being decoded, so a cycle costs one number, and a value used in several places is stored once and decoded as one object. The list is ordinary JSON, so any JSON parser reads DSON text, and any transport that carries JSON carries DSON.

The encoder writes a value's record when it first meets the value and reuses the index afterwards. Equal strings and numbers therefore also share one record. The decoder creates every container before its members, which is how a member that points back finds its container.

## Record types

Numeric tags name the structural kinds:

| Tag | Name | Value | Payload |
| ---: | --- | --- | --- |
| -1 | VOID | `undefined` | ignored; JSON writes `null` |
| 0 | PRIMITIVE | string, finite number, boolean, `null` | the value |
| 1 | ARRAY | array | record indices of the items |
| 2 | OBJECT | plain object, class instance, other object | `[keyIndex, valueIndex]` pairs |
| 3 | DATE | `Date` | ISO-8601 string in UTC (`toISOString()`), or `"Invalid Date"` |
| 4 | REGEXP | `RegExp` | `{ "source": …, "flags": … }` |
| 5 | MAP | `Map` | `[keyIndex, valueIndex]` pairs in insertion order |
| 6 | SET | `Set` | record indices of the members in insertion order |
| 7 | ERROR | `Error` and subclasses | `{ "name": …, "message": … }` |
| 8 | BIGINT | `bigint` | decimal string |
| 9 | NUMBER | `NaN`, `Infinity`, `-Infinity`, `-0` | `"NaN"`, `"Infinity"`, `"-Infinity"` or `"-0"` |

String tags name a constructor whose payload is a list of items or a primitive:

| Tag | Payload |
| --- | --- |
| `"ArrayBuffer"` | the bytes, as numbers 0 to 255 |
| `"DataView"` | the bytes of the view's window (`byteOffset` to `byteOffset + byteLength`) |
| `"Int8Array"`, `"Uint8Array"`, `"Uint8ClampedArray"`, `"Int16Array"`, `"Uint16Array"`, `"Int32Array"`, `"Uint32Array"`, `"Float16Array"`, `"Float32Array"`, `"Float64Array"` | the items as numbers; `NaN`, `±Infinity` and `-0` as the strings of tag 9 |
| `"BigInt64Array"`, `"BigUint64Array"` | the items as decimal strings |
| `"BigInt"`, `"Boolean"`, `"Number"`, `"String"` | the primitive inside the wrapper object; a special number as a string |

Typed-array items that JSON cannot hold are strings because typed array constructors convert strings to numbers or bigints themselves. A reader therefore needs no extra rule for them, and readers older than 1.2.0 decode them correctly.

```js
import { DSON } from "defuss-dson";

console.log(DSON.stringify(new Float32Array([0.5, NaN]))); // [["Float32Array",[0.5,"NaN"]]]
console.log(DSON.stringify([NaN, -0, 10n])); // [[1,[1,2,3]],[9,"NaN"],[9,"-0"],[8,"10"]]
```

## What the encoder leaves out

- Functions and symbols: dropped from objects, Maps and Sets, written as `null` inside arrays, as `JSON.stringify` does.
- `toJSON()`: an object that has one is encoded as the method's result, as with `JSON.stringify`.
- Object keys: own enumerable string keys only, in their own order; symbol keys and the prototype are not written.
- Time zones: a `Date` is an instant without a zone. Its UTC text keeps the instant to the millisecond; an offset in the text the date was created from was never part of the `Date` and is not stored.
- Errors: `name` and `message` only. The stack describes the sending process and can leak its file paths.
- Objects of other kinds (`WeakMap`, iterators, DOM nodes): encoded as plain objects of their own enumerable properties, usually `{}`.

## Reading untrusted text

A tag is input data, so the decoder accepts only the tags of the tables above, from fixed lists, and throws a `TypeError` on any other tag, such as a tag from a newer writer or a tampered payload:

```js
import { DSON } from "defuss-dson";

try {
  DSON.parse('[["WebSocket","wss://example.invalid"]]');
} catch (error) {
  console.log(error.name, error.message); // TypeError DSON: unsupported record type "WebSocket"
}
```

The decoder also checks the shape of what it allocates and where it assigns:

- Typed arrays, `ArrayBuffer` and `DataView` are built only from a list payload. Their constructors also accept a number as a length, so the 22 characters `[["Float64Array",5e7]]` would otherwise allocate 400 MB.
- An object key is converted to a string before the `__proto__` check, as assignment converts it. A key `__proto__` becomes an own property, as with `JSON.parse`, instead of replacing the prototype of the decoded object, also when a crafted key record is a `String` object or an array.
- Containers are filled from a list of pending records, not by recursion, so the input's nesting depth does not reach the call stack.

Any other malformed record list, such as a missing record or a payload of the wrong shape, throws a `TypeError` whose `cause` is the error of the operation that failed. An error record with an unknown `name` becomes an `Error` that carries the name. A decoded value remains data from the sender: limit sizes before parsing, and treat a decoded `RegExp` as an untrusted pattern.

## Compatibility

- **Reading old text:** 1.2.0 reads all text written by 1.0 and 1.1. A VOID record now decodes to `undefined` as its tag says; 1.1 returned the `null` that JSON had written in its place.
- **Writing for old readers:** text written by 1.2.0 is readable by 1.0 and 1.1 unless it contains tag 9 (`NaN`, `±Infinity` or `-0` outside typed arrays). Such a reader throws on tag 9 instead of guessing a value.
- **Equality:** `DSON.isEqual` compares DSON text with `-0` written as `0`, so it follows the rules on this page except that `0` and `-0` compare equal.
