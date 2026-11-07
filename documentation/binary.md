# Binary values and record sequences

VERIFIED: since defuss-dson 1.3.0, `defuss-dson/binary` encodes one strict value graph; `defuss-dson/sequence` frames independent graphs and reports byte offsets. Both are optional, dependency-free entry points with ESM, CommonJS and TypeScript declarations. The root `DSON.stringify()` and `DSON.parse()` APIs and their text format are unchanged. The tests in `src/binary.test.ts`, `src/sequence.test.ts` and the packed-consumer matrix exercise these contracts.

## API

| Export | Result | Contract |
| --- | --- | --- |
| `encode(value, options?)` | `Uint8Array` | One binary value, including its version header. Unsupported values throw. |
| `decode(bytes, options?)` | decoded value | Exactly one value; rejects truncation and trailing bytes. |
| `encodeFrame(value, options?)` | `Uint8Array` | One independent frame. Concatenate frames to form a sequence. |
| `inspectFrame(bytes, offset = 0, options?)` | `FrameMetadata` | Reads only the 16-byte header at the offset and verifies its checksum. The payload need not be present. |
| `decodeFrame(bytes, offset = 0, options?)` | `DecodedFrame` | Verifies and decodes one frame, leaving later bytes unread. |
| `new SequenceDecoder(options?)` | decoder | Retains incomplete frame state across `push(chunk)` calls. |
| `decoder.push(chunk)` | `SequenceRecord[]` | Returns every complete record in this call, in order. Empty chunks are valid. |
| `decoder.finish()` | `void` | Closes the decoder; throws if the last frame is incomplete. |
| `FRAME_HEADER_BYTES` | `16` | Header size for this framing version. |

VERIFIED: byte inputs must be `Uint8Array` instances, including Node.js Buffer inputs. An input subarray's byte offset is respected. Malformed input and unsupported values throw `TypeError`; exceeded or invalid limits throw `RangeError`. A decoder closes after any failure or finalization; create another decoder to resume at a trusted offset. A failed `push` throws without returning its batch, including earlier valid records in that same call. Records from successful calls remain usable.

```js
import { encode, decode } from "defuss-dson/binary";

const value = { seen: new Set(["home"]), bytes: new Uint8Array([0, 10, 255]) };
value.self = value;
const back = decode(encode(value));
console.log(back.seen.has("home"), back.bytes[1], back.self === back); // true 10 true
```

## Strict storage semantics

VERIFIED: the codec preserves `undefined`, null, booleans, all number values including negative zero, strings including lone UTF-16 surrogates, and bigints. Containers include arrays with holes and enumerable extra properties, ordinary objects, objects with null prototypes, Maps and Sets. It preserves cycles, insertion order and shared object identity within a value.

VERIFIED: supported built-ins are Date (including invalid dates), RegExp (source, flags and uint32 `lastIndex`), the native Error classes including AggregateError, ArrayBuffer, DataView, the typed arrays listed in the format table, and boxed Boolean, Number, String and BigInt primitives. Views preserve their offsets, lengths, complete backing buffers and buffer sharing. Encoding a small view therefore includes bytes outside its window; copy the intended window first if those bytes must remain private. Buffers decode as independent, fixed-length snapshots, with no alias to the encoded input bytes.

VERIFIED: Error records preserve their native class, name, message, cause, aggregate errors and enumerable custom properties, including reference cycles. Sender stacks and source-location fields (`stack`, `line`, `column`, `sourceURL`, `originalLine`, `originalColumn`) are deliberately omitted because they can disclose paths. Decoded property descriptors are normalized to writable, configurable data properties; object and array properties are enumerable. Descriptor flags, frozen/sealed state and resizable-buffer capacity are not stored.

VERIFIED: functions, symbols (including symbol keys), accessors, non-enumerable custom properties, custom class instances, built-in subclasses, cross-realm prototypes, WeakMap/WeakSet, SharedArrayBuffer and other unsupported object kinds fail explicitly. Node.js Buffer values are subclasses and must be converted to a supported Uint8Array before encoding. Extra own properties on built-ins other than arrays and Errors are rejected. The encoder never calls `toJSON`. An Error's diagnostic-field accessors are omitted without reading them. As with ordinary JavaScript reflection, a Proxy can execute its traps during encoding; only decoding is an untrusted-input boundary.

## Bounds

VERIFIED: both codecs accept these per-record options. Options must be integers from zero through 4,294,967,295; infinity is not accepted. A zero bound can intentionally reject all records or all nested values.

| Option | Default | Meaning |
| --- | ---: | --- |
| `maxRecordBytes` | 67,108,864 | Binary payload bytes including its 8-byte header, excluding the 16-byte frame header. Also caps sparse-array length. |
| `maxDepth` | 512 | Maximum depth on an ordered depth-first traversal's first visits, with root depth zero. Back references and already visited values do not add depth. |
| `maxReferences` | 1,000,000 | Value-table entries, including primitives; references must name an entry in the same table. |

VERIFIED: sequence options also accept `startOffset` (default zero), the absolute offset of the first byte supplied to that decoder. Offsets and their sums must be nonnegative safe integers. `index` starts at zero for each decoder. Size, reference and depth limits bound encoded input and graph traversal, not exact JavaScript heap usage. The returned batch grows with the number of complete frames in a supplied chunk; callers control chunk size and backpressure. The decoder retains at most one partial frame and copies incomplete fragments so the caller can reuse its input buffers.

## Binary value format, version 1

VERIFIED: all integers below are unsigned little-endian, and scalar numbers use IEEE-754 float64 little-endian. Every value begins with bytes `44 53 42 01` (hex, `DSB` and version 1), followed by a uint32 count and that many tagged table entries. Entry zero is the root. Each entry begins with its one-byte tag. There is no padding or trailing data.

VERIFIED: a reference is a uint32 table index. Forward and backward references are valid. An entry's tag determines its payload; tags 10 through 27 are frozen in [the tag table](format.md#binary-v1-tags). Text tags are not valid in a binary table. Equal primitives may share entries; negative zero stays separate from positive zero. Unknown tags, out-of-range references, duplicate properties, duplicate Map keys/Set members and unreachable entries are rejected.

| Payload term | Byte grammar |
| --- | --- |
| string | uint32 UTF-16 code-unit count, then that many uint16 code units; preserves lone surrogates |
| bigint | string containing canonical decimal: `0`, or optional minus and a nonzero-leading integer |
| property pairs | uint32 pair count, then repeated string key and uint32 value reference |
| array | uint32 logical length, then property pairs; absent index properties are holes |
| Map / Set | uint32 reference count, then references; Map count is even with alternating key/value references |
| Date | float64 milliseconds; an integer accepted by Date, or NaN for invalid Date |
| RegExp | source string, flags string, uint32 lastIndex |
| Error | uint8 native subtype, name string, message string, property pairs |
| ArrayBuffer | uint32 byte length, then unchanged raw bytes |
| view | uint8 subtype, uint8 byte order, uint32 byte offset, uint32 byte length, uint32 backing-buffer reference |
| boxed primitive | uint8 subtype and uint32 primitive reference |

VERIFIED: a view's backing reference must point directly to an ArrayBuffer entry, its offset and length must be aligned for its element size, and its range must fit the buffer. View byte order is 1 for little-endian and 0 for big-endian. Raw buffer bytes remain unchanged to preserve overlapping views. A multi-byte typed view from the opposite-endian host is rejected explicitly; DataView and byte arrays work with either marker. This avoids silently changing numeric values or breaking overlapping aliases. Scalars and strings remain little-endian on every host.

| Subtype | View | Box | Error |
| ---: | --- | --- | --- |
| 0 | DataView | Boolean | Error |
| 1 | Int8Array | Number | EvalError |
| 2 | Uint8Array | String | RangeError |
| 3 | Uint8ClampedArray | BigInt | ReferenceError |
| 4 | Int16Array | | SyntaxError |
| 5 | Uint16Array | | TypeError |
| 6 | Int32Array | | URIError |
| 7 | Uint32Array | | AggregateError |
| 8 | Float16Array | | |
| 9 | Float32Array | | |
| 10 | Float64Array | | |
| 11 | BigInt64Array | | |
| 12 | BigUint64Array | | |

VERIFIED: subtype positions never change. A runtime lacking Float16Array rejects that subtype; its reserved slot remains in place. Constructors come from fixed lists. An Error name is data and never selects a global constructor. A decoded `__proto__` key is an own property.

## Framed sequence format, version 1

VERIFIED: a sequence is zero or more concatenated frames, without a stream header, terminator or newline delimiter. Every frame is independently versioned and contains exactly one complete binary value. An empty sequence is valid. References reset for each frame; cross-record relationships use application IDs.

| Offset within frame | Bytes | Meaning |
| ---: | ---: | --- |
| 0 | 4 | `44 53 51 01` (hex, `DSQ` and version 1) |
| 4 | 4 | uint32 binary payload length |
| 8 | 4 | uint32 unmasked CRC32C of payload bytes |
| 12 | 4 | uint32 unmasked CRC32C of header bytes 0 through 11 |
| 16 | payload length | binary value including its `DSB` header |

VERIFIED: CRC32C uses the Castagnoli polynomial (reflected polynomial `0x82f63b78`), initial value `0xffffffff`, and final XOR `0xffffffff`. The check value for ASCII `123456789` is `0xe3069283`. Header integrity and payload bounds are checked before a fragmented payload is allocated. Payload integrity is checked before binary decoding. Checksums detect accidental damage; they do not authenticate data.

VERIFIED: this format uses length/checksum framing as in [LevelDB's log format](https://github.com/google/leveldb/blob/main/doc/log_format.md), but is not compatible with it. DSON frames have no fixed blocks, fragmentation types, padding or automatic resynchronization. A corrupted frame, truncated final frame or unsupported version stops decoding. Choosing recovery offsets, committing writes and discarding partial records belong to the storage layer.

## Offset metadata and direct lookup

VERIFIED: `FrameMetadata` contains `offset`, `byteLength`, `payloadOffset`, `payloadLength` and `checksum`. `DecodedFrame` adds `value`; `SequenceRecord` adds `index`. Add `byteLength` to `offset` to skip a record using its header alone. An ordinal or application-key index must store those offsets for direct access. Seeking locates one record; decoding it still materializes that record's entire graph.

```js
import { encodeFrame, SequenceDecoder, decodeFrame, inspectFrame } from "defuss-dson/sequence";

const first = encodeFrame({ id: "a", score: 1 });
const second = encodeFrame({ id: "b", score: 2 });
const bytes = new Uint8Array(first.length + second.length);
bytes.set(first);
bytes.set(second, first.length);

const decoder = new SequenceDecoder();
console.log(decoder.push(bytes.subarray(0, 7)).length); // 0
const records = decoder.push(bytes.subarray(7));
decoder.finish();
const offsets = new Map(records.map(record => [record.value.id, record.offset]));
console.log(records.length, records[1].index); // 2 1
console.log(decodeFrame(bytes, offsets.get("b")).value.score); // 2
console.log(inspectFrame(bytes).byteLength === records[1].offset); // true
```

VERIFIED: DSON performs no I/O and builds no persistent indexes. `defuss-dbsonl` owns persistent ordinal/key indexes, updates, tombstones, commits, recovery and compaction. There are no compression or field-offset tables in version 1. A future compression extension needs independent units per record to retain direct access.

## Measurement

VERIFIED: `make bench` writes separate binary benchmark reports under `output/bench/binary-*.json`; `make docs` publishes the [recorded results](../docs/data/binary-bench.json), and e2e rejects results whose three entry hashes differ from the build. They separate encoded size, encode/decode throughput, full sequence scans and lookup through a prebuilt ordinal/key offset index. Index construction is measured separately from lookup.

VERIFIED: Node.js reports sampled allocation bytes per operation using [V8's allocation sampler](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/js_protocol.json), separately from timings; those JavaScript-heap estimates include collected objects and sampling overhead but exclude external ArrayBuffer backing stores. Bun and browsers report no allocation figure where the same sampler is unavailable. These are memory-resident serialization measurements, not filesystem/database performance claims.

VERIFIED: `ordinalUint64IndexBytes` is a calculated storage budget of eight bytes per offset for a hypothetical packed index. It does not measure the resident size of the benchmark's JavaScript arrays or Maps.
