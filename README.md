# defuss-dson

[![CI](https://github.com/kyr0/defuss-dson/actions/workflows/verify.yml/badge.svg)](https://github.com/kyr0/defuss-dson/actions/workflows/verify.yml)
[![npm](https://img.shields.io/npm/v/defuss-dson)](https://www.npmjs.com/package/defuss-dson)
[![License](https://img.shields.io/github/license/kyr0/defuss-dson)](LICENSE)

The [defuss](https://github.com/kyr0/defuss) runtime's typed JSON: `Map`, `Set`, `Date`, `RegExp`, `BigInt`, typed arrays, `undefined`, `NaN` and circular references survive a trip through JSON text.

DSON (*D*efinitely-typed *S*erialized *O*bject *N*otation) writes plain JSON that remembers what each value was, and reads it back into the same types, cycles and shared references. Live site and playground: <https://dson.defuss.org>.

## TL;DR

`JSON.stringify` turns a `Map` into `{}`, a `Date` into a string, `NaN` into `null`, drops `undefined`, and throws on a `BigInt` or a cycle. You don't need a schema, a class registry or a binary format to fix that. Replace `JSON` with `DSON` at the call site: `DSON.stringify` returns JSON text, so it still fits into `fetch()`, `localStorage`, `postMessage`, files and log lines, and `DSON.parse` rebuilds the original value graph.

```js
import { DSON } from "defuss-dson";

const state = { visits: new Map([["/", 3]]), since: new Date("2026-01-01T00:00:00.000Z"), total: 2n ** 64n };
state.self = state;

const text = DSON.stringify(state); // JSON text, ready for fetch(), localStorage or a file
const back = DSON.parse(text);

console.log(back.visits.get("/")); // 3
console.log(back.since.toISOString()); // 2026-01-01T00:00:00.000Z
console.log(back.total); // 18446744073709551616n
console.log(back.self === back); // true
```

Features:
- 🔁 Drop-in for `JSON`: `DSON.parse` and `DSON.stringify` have the shape of their `JSON` twins, and the output is valid JSON
- 🧬 Types survive: `Map`, `Set`, `Date`, `RegExp`, `BigInt`, `Error`, typed arrays, `ArrayBuffer`, `DataView`, `undefined`, `NaN`, `±Infinity` and `-0`
- 🔗 Cycles and shared references: an object used twice is written once and restored as one object
- 🛡️ Safe to parse: the input can only name types from a fixed list, any other type name throws, binary data is built only from lists in the text, and a `__proto__` key stays data
- ⚖️ `DSON.isEqual` compares two values by content, cycles included, in one linear pass
- 🧪 `DSON.clone` deep-copies with the native `structuredClone`, and with DSON where a runtime lacks it
- 🌐 Browsers, Node.js and Bun; ESM and CommonJS builds with TypeScript declarations
- 🪶 Zero dependencies, 3.2 kB gzip
- ✅ Every example on this page, in the documentation and on the website runs in Node.js, Bun, Chromium and WebKit on each change

## Quick, CDN-based setup using ESM imports

`dist/index.mjs` has no imports of its own, so a browser loads it directly as a module:

```html
<script type="module">
  import { DSON } from "https://cdn.jsdelivr.net/npm/defuss-dson@1.2.0/dist/index.mjs";

  const text = DSON.stringify({ seen: new Set(["home"]) });
  console.log(DSON.parse(text).seen.has("home")); // true
</script>
```

- **Good for:** prototyping, demos and testing in the browser, without a build step.
- **Drawbacks:** doesn't work offline, depends on the CDN, no bundler optimizations.

## Quick, non-CDN setup

Download `dist/index.mjs` once from the package on [jsDelivr](https://www.jsdelivr.com/package/npm/defuss-dson), serve it with your own assets and import it from there:

```html no-run
<script type="module">
  import { DSON } from "./assets/js/defuss-dson.mjs";
</script>
```

- **Good for:** offline support, air-gapped environments and locking the exact version you ship.
- **Drawbacks:** manual updates, no bundler optimizations.

## For production: Install via package manager

A package manager gives you version pinning, offline installs and optimized production builds with tree-shaking and minification. We recommend [`bun`](https://bun.sh) as package manager and script runner:

```bash
bun add defuss-dson
# or: npm install defuss-dson
```

Then, in `.js` or `.ts` files, in Node.js, Bun or a bundled browser app:

```js
import { DSON } from "defuss-dson";

const text = DSON.stringify({ when: new Date(0), tags: new Set(["a", "b"]) });
console.log(text); // [[2,[[1,2],[3,4]]],[0,"when"],[3,"1970-01-01T00:00:00.000Z"],[0,"tags"],[6,[5,6]],[0,"a"],[0,"b"]]

const back = DSON.parse(text);
console.log(back.tags instanceof Set, back.when.getTime()); // true 0
```

CommonJS works the same way: `const { DSON } = require("defuss-dson")`.

## API

`DSON` is one object with four functions, shaped like `JSON` so that a call site can switch by changing one word.

| Function | Returns | What it does |
| --- | --- | --- |
| `DSON.stringify(value, options?)` | `string` | Writes `value` as DSON text, which is valid JSON. Functions and symbols are dropped and `toJSON()` is called once per value, as with `JSON.stringify`. Throws a `RangeError` when `value` nests deeper than `options.maxDepth` (default 100,000). |
| `DSON.parse(text)` | `any` | Rebuilds the value, with its types, cycles and shared references. Throws a `SyntaxError` on invalid JSON and a `TypeError` on JSON that is not valid DSON, such as an unknown record type. |
| `DSON.isEqual(a, b, options?)` | `boolean` | Compares the DSON texts of both values (details below); `options.maxDepth` as for `stringify`. |
| `DSON.clone(value)` | same type as `value` | Deep copy through `structuredClone`, or through DSON where the runtime lacks it. Throws on functions and symbols instead of dropping them. |

`isEqual` treats two values as equal when they hold the same data: same types and content, key order and `Map` or `Set` order included, functions ignored. Numbers compare like `Map` keys, so `NaN` equals `NaN` and `0` equals `-0`:

```js
import { DSON } from "defuss-dson";

console.log(DSON.isEqual({ at: new Date(0), ids: new Set([1]) }, { at: new Date(0), ids: new Set([1]) })); // true
console.log(DSON.isEqual({ a: 1, b: 2 }, { b: 2, a: 1 })); // false
console.log(DSON.isEqual(NaN, NaN), DSON.isEqual(0, -0)); // true true
```

`clone` gives an independent copy, so changing it leaves the original untouched:

```js
import { DSON } from "defuss-dson";

const original = { list: [new Map([["k", { deep: true }]])] };
const copy = DSON.clone(original);
copy.list[0].get("k").deep = false;
console.log(original.list[0].get("k").deep); // true
```

`maxDepth` limits how deeply arrays, objects, Maps and Sets may nest, 100,000 levels by default. The limit stops a value without end, such as a getter that returns a new object on every read, with a `RangeError` instead of running out of memory; `JSON.stringify` throws a `RangeError` on such a value, too. Raise it for deeper data, or pass `Infinity` to remove it. `parse` has no such limit: its work grows with the length of the text, at any depth.

```js
import { DSON } from "defuss-dson";

let list = null;
for (let i = 0; i < 150_000; i++) list = { next: list };

try {
  DSON.stringify(list);
} catch (error) {
  console.log(error.name, error.message); // RangeError DSON: value nested deeper than 100000 levels
}
console.log(DSON.stringify(list, { maxDepth: 200_000 }).startsWith("[[2,")); // true
```

## What survives a round trip

| Value | `JSON.parse(JSON.stringify(v))` | `DSON.parse(DSON.stringify(v))` |
| --- | --- | --- |
| `Map`, `Set` | `{}` | the same `Map` or `Set`, any key types |
| `Date` | ISO string | `Date` with the same instant, including an invalid one |
| `RegExp` | `{}` | `RegExp` with source and flags |
| `BigInt` | throws `TypeError` | `bigint` |
| `undefined` property | property removed | property kept with `undefined` |
| `NaN`, `Infinity`, `-Infinity` | `null` | the same number |
| `-0` | `0` | `-0` |
| typed arrays, `ArrayBuffer`, `DataView` | `{}` or index objects | the same class and bytes; a `DataView` keeps only its window |
| `Error` and its built-in subclasses | `{}` | the same class with `name` and `message` |
| `Boolean`, `Number`, `String` objects | primitive | the same wrapper object |
| `BigInt` object | throws `TypeError` | the same wrapper object |
| cycles | throws `TypeError` | restored |
| one object referenced twice | two copies | one object |
| class instance | plain object | plain object with its own enumerable properties |
| function, symbol | dropped (`null` in arrays) | dropped (`null` in arrays) |

**Dates keep their instant, not a time zone.** A JavaScript `Date` is a point in time (milliseconds since 1970 UTC) and holds no time zone. DSON writes it with `toISOString()`, which is always UTC, so the instant survives to the millisecond. An offset in the text you created the date from, such as `+02:00`, is not part of the `Date` and therefore not stored; the reader's time zone decides how the date displays. Keep the zone in its own field, for example `"Europe/Berlin"`, when you need it:

```js
import { DSON } from "defuss-dson";

const meeting = { at: new Date("2026-03-01T14:00:00+02:00"), zone: "Europe/Berlin" };
console.log(DSON.stringify(meeting)); // [[2,[[1,2],[3,4]]],[0,"at"],[3,"2026-03-01T12:00:00.000Z"],[0,"zone"],[0,"Europe/Berlin"]]
console.log(DSON.parse(DSON.stringify(meeting)).at.getTime() === meeting.at.getTime()); // true
```

The [format specification](documentation/format.md) describes every record type.

## Website

<https://dson.defuss.org> is the runnable example: a playground (it grew out of the former Vite and Monaco demo) where your code returns a value and the page shows its DSON text, its records, the parsed result and what `JSON.stringify` makes of it, plus a live JSON-vs-DSON table computed by the shipped build, an animated diagram of the round trip, and the benchmark and coverage figures. Every code example and the playground editor are highlighted with [Shiki](https://shiki.style/). Its source is [`docs/`](docs/), built on [defuss-shadcn](https://shadcn.defuss.org/).

Run it from a checkout with `make serve` and open <http://127.0.0.1:8080/>; it loads defuss-shadcn from jsDelivr, so it needs network access but no build. The page runs the library copy and a Shiki bundle in `docs/assets/lib/`; `make docs` regenerates both, the figures on the page and the size table below, and e2e fails while they differ. The benchmark figures come from `make bench` (Node.js, Bun, and Chromium and WebKit through Playwright), which `make docs` publishes to `docs/data/bench.json`; e2e fails when they measured another build than the current one, so after a code change run `make bench` before `make docs`. The coverage figures come from `make coverage`.

## Three things to know

**Classes stay on your side.** DSON stores data, not code. A class instance comes back as a plain object with its own enumerable properties; revive it where you need the class:

```js
import { DSON } from "defuss-dson";

class Point { constructor(x, y) { this.x = x; this.y = y; } }
const back = DSON.parse(DSON.stringify(new Point(1, 2)));
console.log(back instanceof Point, back.x, back.y); // false 1 2

const point = Object.assign(new Point(0, 0), back);
console.log(point instanceof Point, point.x); // true 1
```

**Parsing untrusted text is safe, the result is still untrusted.** `DSON.parse` builds only the types listed above from a fixed list and refuses any other record type, so a crafted payload cannot make it call `Function`, `WebSocket` or any other global. It builds binary data only from a list in the text, so a short text cannot allocate a large buffer, and it decodes any nesting depth without growing the call stack. A decoded value is still the sender's data: a `RegExp`, for instance, is the sender's pattern, and the size of the text is yours to limit.

```js
import { DSON } from "defuss-dson";

try {
  DSON.parse('[["Function","return process"]]');
} catch (error) {
  console.log(error.message); // DSON: unsupported record type "Function"
}
```

**Both ends need 1.2 for special numbers.** Since 1.2.0, `NaN`, `±Infinity` and `-0` have their own record type. A reader before 1.2.0 throws on such a payload instead of reading `null`; everything else stays readable in both directions. Details are in the [changelog](CHANGELOG.md).

## Size

<!-- bundle-size:start -->
| File | Size | Gzipped | Purpose |
| --- | ---: | ---: | --- |
| `index.mjs` | 11.6 kB | **3.2 kB** | ESM build: bundlers, Node.js, Bun, Deno and browsers via `<script type="module">` |
| `index.cjs` | 11.6 kB | 3.2 kB | CommonJS build for `require()` |
<!-- bundle-size:end -->

The builds are not minified, so a stack trace from the CDN file stays readable; a bundler minifies them in production.

## Development

```bash
make setup && make verify
```

`make verify` runs oxlint and strict TypeScript, the Vitest unit suite with coverage on Node.js and again on Bun, and the e2e suite on the packed tarball: the package contents, ESM and CommonJS consumers, the type declarations, every published example on Node.js and Bun, and with Playwright the library, every example and the website in Chromium and WebKit. [ARCH.md](ARCH.md) is the module map for contributors.

## Citation

If you use defuss-dson in research or want to reference it, cite it as:

```bibtex
@misc{homberg2026defussdson,
  author       = {Homberg, Aron},
  affiliation  = {Independent Researcher},
  title        = {defuss-dson: typed JSON serialization for JavaScript},
  year         = {2026},
  version      = {1.2.0},
  howpublished = {\url{https://github.com/kyr0/defuss-dson}},
  note         = {Serialization module of the defuss runtime, MIT License}
}
```

## License

[MIT](LICENSE)
