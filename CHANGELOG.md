# Changelog

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
