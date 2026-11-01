// The benchmark itself, shared by every runtime: scripts/bench.mjs runs it in Node.js and Bun, and
// scripts/bench-browser.mjs loads this file into Chromium and WebKit pages. Plain ES module, no runtime imports, so the
// same graphs, operations and timing run everywhere and the rows of the website compare like with like.
export const ROUNDS = 20;
export const USERS = 2000;

/** What DSON adds over JSON: Maps, Sets, Dates, typed arrays, BigInts and a cycle. */
export const typed = () => {
  const root = { users: [], index: new Map(), tags: new Set() };
  for (let i = 0; i < USERS; i++) {
    const user = { id: i, name: `user ${i}`, joined: new Date(i * 86_400_000), scores: new Float64Array([i, i / 2, i / 3]), big: BigInt(i) ** 3n };
    root.users.push(user);
    root.index.set(i, user);
    root.tags.add(`tag ${i % 50}`);
  }
  root.self = root;
  return root;
};

/** The same data as JSON-safe values, so DSON and the runtime's own JSON work on equal input. */
export const plain = () => {
  const root = { users: [], index: {}, tags: [] };
  for (let i = 0; i < USERS; i++) {
    const user = { id: i, name: `user ${i}`, joined: new Date(i * 86_400_000).toISOString(), scores: [i, i / 2, i / 3], big: String(BigInt(i) ** 3n) };
    root.users.push(user);
    root.index[i] = user.id;
    if (i < 50) root.tags.push(`tag ${i}`);
  }
  return root;
};

/** Every row of the table: the graph, the call, and what it needs (a: the graph, b: an equal graph, text: input). */
export const OPERATIONS = [
  ['typed', 'DSON.stringify', ({ DSON, a }) => DSON.stringify(a)],
  ['typed', 'DSON.parse', ({ DSON, text }) => DSON.parse(text)],
  ['typed', 'DSON.isEqual', ({ DSON, a, b }) => DSON.isEqual(a, b)],
  ['typed', 'DSON.clone', ({ DSON, a }) => DSON.clone(a)],
  ['plain', 'JSON.stringify', ({ a }) => JSON.stringify(a)],
  ['plain', 'DSON.stringify', ({ DSON, a }) => DSON.stringify(a)],
  ['plain', 'JSON.parse', ({ json }) => JSON.parse(json)],
  ['plain', 'DSON.parse', ({ DSON, text }) => DSON.parse(text)],
];

/**
 * The inputs of one graph. The texts are passed in, read from files the runner wrote, so that a process measured
 * for memory never runs stringify to produce its own input.
 */
export const inputs = (DSON, graph, texts) => {
  const make = graph === 'typed' ? typed : plain;
  return { DSON, a: make(), b: make(), text: texts[`${graph}.dson`], json: texts['plain.json'] };
};

/** Runs one operation as often as the memory measurement does: once per timing round, plus the warm-up. */
export const repeat = (input, graph, name) => {
  const run = OPERATIONS.find(([g, n]) => g === graph && n === name)?.[2];
  if (run) for (let i = 0; i <= ROUNDS; i++) run(input);
};

/**
 * Median time of one call in milliseconds. Why batches: browsers coarsen performance.now() (WebKit to whole
 * milliseconds, Chromium to 0.1 ms without cross-origin isolation), so each sample runs the call often enough to last
 * at least 20 ms and is divided by its count. The same method runs in Node.js and Bun, so all rows are comparable.
 * VERIFIED: (make bench, 2026-11-01) WebKit 26.6 timed JSON.parse of the plain graph at 0.55 ms, below its 1 ms step.
 */
export const time = (run) => {
  let start = performance.now();
  run();
  const once = Math.max(performance.now() - start, 0.01);
  const batch = Math.max(1, Math.ceil(20 / once));
  const samples = [];
  for (let i = 0; i < ROUNDS; i++) {
    start = performance.now();
    for (let j = 0; j < batch; j++) run();
    samples.push((performance.now() - start) / batch);
  }
  samples.sort((x, y) => x - y);
  return Number(samples[ROUNDS >> 1].toFixed(2));
};

/** Times every operation on prepared inputs: { typed, plain } from `inputs`. */
export const timeAll = (prepared) =>
  OPERATIONS.map(([graph, operation, run]) => ({ graph, operation, medianMs: time(() => run(prepared[graph])) }));
