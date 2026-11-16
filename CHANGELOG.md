# Changelog

## 1.4.0

- VERIFIED: `encode` and `encodeFrame` take `{ trusted: true }` for values that hold only plain data, such as index pages a program builds itself. The encoder then reads keys with `Object.keys` and values by property access instead of checking each property's descriptor, and skips the check for extra properties on built-ins. Output for such values is byte-identical; a value with getters, non-enumerable properties or symbol keys is not rejected but encoded without those checks. Errors are checked either way. Decoding accepts the option and ignores it. The new `EncodeOptions` type describes it.
- VERIFIED: `encodeFrame` and binary `encode` run four to five times as fast on small values. On a 32-entry index page (6,149 bytes), `encodeFrame` took a median of 26.6 µs instead of 106 µs on Node.js 26 and 20.3 µs instead of 107 µs on Bun 1.4, five processes each; with `trusted`, 22.6 and 15.1 µs. 256 records that each hold a 256-byte `Uint8Array` took about a third of the time.
- VERIFIED: the encoder keeps its value table in flat lists that it reuses between calls, sums the output size as it walks, and writes into one buffer of exactly that size; `encodeFrame` has it leave room for the frame header, so a frame needs no second buffer. It writes through one `DataView` per buffer and local functions without per-write checks, lists keys with `Object.getOwnPropertyNames`, checks a typed array's custom properties without visiting each element, validates options field by field, and skips the depth walk for a table of at most `maxDepth + 1` entries, which cannot exceed the limit. CRC32C runs 16 bytes per step on `Int32Array` tables; with `Uint32Array` tables, Bun ran some processes three times slower. These steps follow an application's specialized index-page encoder, which this encoder now matches on Bun (20.3 against 20.1 µs) and beats on Node.js (26.6 against 32.6 µs).
- VERIFIED: `decodeFrame` and binary `decode` run about two and a half times as fast. On the same index page, `decodeFrame` took 28 to 33 µs instead of 72 to 84 µs. Decoding reads strings from the bytes, and long strings without surrogates through `TextDecoder`. It assigns properties that no prototype holds instead of defining each one, scans small objects for duplicate names instead of building a `Set`, and keeps up to 256 recently decoded property names, so a repeated name comes back as the same string.
- VERIFIED: the bytes and errors are unchanged. 3,028 values, generated and hand-picked, gave identical output or the same error as 1.3.0, and 2,081 values with 12,486 mutations of them decoded to equal values or the same error, on Node.js and Bun. The wire formats are unchanged.

## 1.3.0

- VERIFIED: add optional `defuss-dson/binary` and `defuss-dson/sequence` entry points for strict binary values and independently checksummed frames, incremental decoding, bounded input and offset metadata.
- VERIFIED: append binary-only wire tags 10 through 27. Binary value v1 uses `DSB` plus version 1; sequence frames use `DSQ` plus version 1. These formats are separate from text DSON; text tags and `stringify`/`parse` behavior remain unchanged. Older packages do not expose the optional entries and cannot read these binary formats.
- VERIFIED: raw buffers and view aliases, sparse arrays, null prototypes, Error causes and aggregate errors round-trip. Unsupported values fail explicitly. Persistent indexes, recovery, compression and field-level access are outside this milestone.
- VERIFIED: build each public entry independently to preserve the standalone root CDN module. Add packed-consumer checks across Node.js, Bun, Chromium and WebKit, and separate binary size, throughput, allocation and indexed-lookup measurements.
- VERIFIED: add a website section for binary values and framed sequences, with runnable examples, offset lookup, API links and benchmark results.

## 1.2.0

Wire format:
- `NaN`, `Infinity`, `-Infinity` and `-0` round-trip exactly under the new record tag 9 (`NUMBER`). They used to become `null` or `0`. A reader before 1.2.0 throws on tag 9; text without these values stays readable by every version.
- Inside typed arrays and `Number` objects these values are written as strings (`"NaN"`, `"-0"`), which every reader version converts back correctly.

Fixes:
- `undefined` survives `stringify`/`parse`; it used to become `null`. `isEqual({ a: undefined }, { a: null })` and `isEqual(NaN, null)` are `false`.
- Security: `parse` no longer constructs a global named by the input. `[["Function", "…"]]` returned a function, and tags such as `WebSocket` could open connections while parsing. Unknown tags throw a `TypeError`.
- Security: a `__proto__` key in the input becomes an own property, as with `JSON.parse`, instead of replacing the prototype of the decoded object. Objects from `JSON.parse` with that key round-trip.
- Security: `parse` builds typed arrays, `ArrayBuffer` and `DataView` only from a list in the text. A number there was taken as a length: the 22 characters `[["Float64Array",5e7]]` allocated 400 MB. Such a record now throws a `TypeError`.
- Security: an object key record that converts to `"__proto__"`, such as a `String` object or the array `["__proto__"]`, becomes an own property. It used to set the prototype of the decoded object.
- `parse` throws a `SyntaxError` only for text that is not JSON, and a `TypeError` for every record list that is not valid DSON, with the failing operation's error as `cause`. Malformed records used to throw whatever failed inside, such as a `RangeError` from `BigInt(1.5)`.
- Nesting depth no longer depends on the call stack. The recursive walk overflowed at 2,343 levels on Node.js 26 and 18,779 on Bun 1.4.3. `parse` decodes any depth; `stringify` and `isEqual` accept 100,000 levels by default and take `{ maxDepth }` as a new optional argument (`Infinity` removes the limit), and the DSON fallback of `clone` accepts the default. A deeper value, such as a getter that returns a new object on every read, throws a `RangeError`.
- `stringify` calls `toJSON()` once per value, as `JSON.stringify` does. A `toJSON()` that returned `this` overflowed the call stack.
- `BigInt64Array`, `BigUint64Array` and invalid `Date` values serialize instead of throwing.
- A `DataView` over part of a buffer keeps only its window; it used to carry the whole buffer with offset 0.
- One `ArrayBuffer` or `DataView` referenced twice is restored as one object.
- `AggregateError` keeps its message.
- Iterators and other objects whose brand contains "Array" serialize as plain objects; they used to produce text that `parse` rejected.
- `isEqual` encodes each value once; it used to stringify, parse and stringify each value again. On a mixed graph of 2,000 objects with Maps, Sets, Dates and typed arrays, three interleaved `make bench` runs on Node.js 26 (2026-11-01) gave medians of 26.9 to 35.3 ms for 1.1.2 and 11.9 to 15.8 ms for 1.2.0, 1.7 to 2.8 times faster per pair; the absolute times follow the machine's load.

Project:
- The package builds standalone (the tsconfig no longer extends the former monorepo) and is tested on Node.js, Bun, Chromium and WebKit, including every example in the README, the documentation and on the website.
- New website with a playground at <https://dson.defuss.org>, replacing the Vite demo: Shiki highlighting for every code example, the CLI commands and the playground editor, an animated diagram of the round trip, and benchmark (time, peak RSS) and coverage figures.
- `make bench` measures the median time and peak RSS of each operation on Node.js, Bun, Chromium and WebKit, against native `JSON` on JSON-safe data.
- The README and the format specification state that a `Date` keeps its instant in UTC, not a time zone.
- Published type declarations document every `DSON` method.
