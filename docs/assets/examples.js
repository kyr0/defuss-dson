// Playground presets. Each `code` is the body of an async function that receives `DSON` and returns the value the
// playground encodes. Every `console.log(...); // <output>` line states what it prints: e2e runs every preset in
// Chromium and WebKit (the playground's console) and in Node.js and Bun (the installed package) and compares.
// Why one shared module instead of examples written into the page: a copy drifts; this file is the only source.
// VERIFIED: e2e/site.spec.ts and e2e/docs.test.ts fail when a printed line differs from its comment.
export const examples = [
  {
    id: 'everything',
    title: 'Everything at once',
    code: `const map = new Map([["name", "defuss"], ["age", 1]]);
const set = new Set(["name", "defuss"]);

// class instances are encoded as their data; the class itself stays on this side
class Foo {
  constructor(foo = 123) {
    this.foo = foo;
  }
}

const objects = { name: "defuss", age: 39 };
objects.circularReference = objects; // no problem

const everything = {
  maps: [map],
  sets: [set],
  regex: /[a-zA-Z0-9]/g,
  when: new Date("2026-01-01T00:00:00.000Z"),
  big: 2n ** 64n,
  objects: [objects, new Foo(345)],
};

const parsed = DSON.parse(DSON.stringify(everything));
console.log(parsed.maps[0].get("name")); // defuss
console.log(parsed.objects[0].circularReference === parsed.objects[0]); // true
console.log(parsed.objects[1] instanceof Foo, parsed.objects[1].foo); // false 345
console.log(DSON.isEqual(everything, parsed)); // true

return everything;`,
  },
  {
    id: 'collections',
    title: 'Map and Set',
    code: `const owner = { id: 1 };
const access = new Map([[owner, new Set(["read", "write"])]]);

const copy = DSON.parse(DSON.stringify(access));
const [[key, rights]] = copy;
console.log(key.id, rights.has("write")); // 1 true
console.log(JSON.stringify(access)); // {}

return access;`,
  },
  {
    id: 'numbers',
    title: 'NaN, -0, BigInt, undefined',
    code: `const values = { nan: NaN, negativeZero: -0, infinity: Infinity, missing: undefined };
console.log(JSON.stringify(values)); // {"nan":null,"negativeZero":0,"infinity":null}

const back = DSON.parse(DSON.stringify(values));
console.log(back.nan, Object.is(back.negativeZero, -0), back.infinity, "missing" in back); // NaN true Infinity true
console.log(DSON.parse(DSON.stringify(2n ** 70n))); // 1180591620717411303424n

return values;`,
  },
  {
    id: 'cycles',
    title: 'Circular references',
    code: `const team = { name: "core" };
const alice = { name: "Alice", team };
const bob = { name: "Bob", team };
team.members = [alice, bob];

const copy = DSON.parse(DSON.stringify(team));
console.log(copy.members[0].team === copy); // true
console.log(copy.members[0].team === copy.members[1].team); // true

return team;`,
  },
  {
    id: 'binary',
    title: 'Typed arrays and buffers',
    code: `const bytes = new Uint8Array([222, 173, 190, 239]);
const samples = new Float32Array([0.5, NaN, -Infinity]);

const copy = DSON.parse(DSON.stringify({ bytes, samples, buffer: bytes.buffer }));
console.log(copy.bytes instanceof Uint8Array, copy.bytes[0]); // true 222
console.log(copy.samples[1], copy.samples[2]); // NaN -Infinity
console.log(copy.buffer.byteLength); // 4

return { bytes, samples };`,
  },
  {
    id: 'dates',
    title: 'Date and RegExp',
    code: `const rule = { since: new Date("2026-03-01T12:00:00.000Z"), pattern: /^dson-\\d+$/i };

const copy = DSON.parse(DSON.stringify(rule));
console.log(copy.since.getUTCMonth(), copy.pattern.test("DSON-42")); // 2 true
console.log(typeof JSON.parse(JSON.stringify(rule)).since); // string

// a Date is an instant without a time zone: DSON stores it in UTC, exact to the millisecond
const local = new Date("2026-03-01T14:00:00+02:00");
console.log(DSON.stringify(local)); // [[3,"2026-03-01T12:00:00.000Z"]]
console.log(DSON.parse(DSON.stringify(local)).getTime() === local.getTime()); // true

return rule;`,
  },
  {
    id: 'errors',
    title: 'Errors',
    code: `class ValidationError extends Error {
  name = "ValidationError";
}

const failures = [new TypeError("expected a string"), new ValidationError("too short")];
const copy = DSON.parse(DSON.stringify(failures));
console.log(copy[0] instanceof TypeError, copy[0].message); // true expected a string
console.log(copy[1] instanceof Error, copy[1].name); // true ValidationError

return failures;`,
  },
  {
    id: 'equality',
    title: 'isEqual',
    code: `const a = { tags: new Set(["x", "y"]), at: new Date(0) };
const b = { tags: new Set(["x", "y"]), at: new Date(0) };
console.log(a === b, DSON.isEqual(a, b)); // false true

// order counts, as it does for iteration
console.log(DSON.isEqual(new Set(["x", "y"]), new Set(["y", "x"]))); // false
console.log(DSON.isEqual({ n: 0 }, { n: -0 }), DSON.isEqual(NaN, NaN)); // true true

return a;`,
  },
  {
    id: 'clone',
    title: 'clone',
    code: `const state = { todos: new Map([[1, { done: false }]]) };
state.self = state;

const copy = DSON.clone(state);
copy.todos.get(1).done = true;
console.log(state.todos.get(1).done, copy.self === copy); // false true

return state;`,
  },
  {
    id: 'json',
    title: 'JSON behaviour',
    code: `// like JSON.stringify: toJSON() is honoured, functions are dropped
const price = { amount: 5, toJSON() { return this.amount + " EUR"; } };
const parsed = DSON.parse(DSON.stringify({ price, run() {} }));
console.log(parsed.price, "run" in parsed); // 5 EUR false

// and DSON text is JSON: any JSON parser reads it
console.log(Array.isArray(JSON.parse(DSON.stringify(parsed)))); // true

return { price };`,
  },
];
