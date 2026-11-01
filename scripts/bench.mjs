import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { OPERATIONS, ROUNDS, USERS, inputs, plain, repeat, timeAll, typed } from './bench-core.mjs';

// Measures what the website shows for Node.js and Bun: the median time and the peak RSS of each operation, on the
// runtime that runs this file (`make bench` runs it with both, then scripts/bench-browser.mjs for the browsers). The
// graphs, operations and timing live in scripts/bench-core.mjs, shared with the browsers.
// Usage: node scripts/bench.mjs [path/to/index.mjs]; results in output/bench/<runtime>.json, which `make docs` copies
// to docs/data/bench.json when every runtime measured the current build.
// Why a fresh process per operation for RSS: peak RSS is the high-water mark of a whole process, so in one process
// the heaviest operation would set it for all others. Each child builds the same inputs, so the `none` child is the
// baseline every row compares with.
// VERIFIED: for isEqual, three interleaved runs on Node.js 26 (2026-11-01) gave medians of 26.9 to 35.3 ms for 1.1.2
// and 11.9 to 15.8 ms for 1.2.0. Absolute times follow the machine's load, so compare builds in alternating runs.
const bench = new URL('../output/bench/', import.meta.url);
const TEXTS = ['typed.dson', 'plain.dson', 'plain.json'];
const readTexts = () => Object.fromEntries(TEXTS.map((name) => [name, readFileSync(new URL(name, bench), 'utf8')]));

// child: `--rss <graph> <operation|none> <lib>` prints the process's peak RSS in bytes
if (process.argv[2] === '--rss') {
  const [, , , graph, name, lib] = process.argv;
  const { DSON } = await import(lib);
  const input = inputs(DSON, graph, readTexts());
  if (globalThis.gc) globalThis.gc();
  else globalThis.Bun?.gc(true);
  repeat(input, graph, name);
  // maxRSS is in kilobytes on both runtimes (probe: a 200 MB buffer read 235,024 on Node.js and 199,872 on Bun)
  console.log(process.resourceUsage().maxRSS * 1024);
  process.exit(0);
}

const lib = process.argv[2] ?? fileURLToPath(new URL('../dist/index.mjs', import.meta.url));
const { DSON } = await import(lib);
const runtime = process.versions.bun ? 'bun' : 'node';
const version = process.versions.bun ?? process.versions.node;

await mkdir(bench, { recursive: true });
await writeFile(new URL('typed.dson', bench), DSON.stringify(typed()));
await writeFile(new URL('plain.dson', bench), DSON.stringify(plain()));
await writeFile(new URL('plain.json', bench), JSON.stringify(plain()));

const peak = (graph, name) => {
  const args = [...(runtime === 'node' ? ['--expose-gc'] : []), fileURLToPath(import.meta.url), '--rss', graph, name, lib];
  const bytes = Number(execFileSync(process.execPath, args, { encoding: 'utf8' }).trim());
  return Math.round(bytes / 1e6);
};

const texts = readTexts();
const prepared = { typed: inputs(DSON, 'typed', texts), plain: inputs(DSON, 'plain', texts) };
const results = timeAll(prepared).map((row) => ({ ...row, peakRssMB: peak(row.graph, row.operation) }));

const result = {
  runtime, version,
  cpu: cpus()[0]?.model.trim() ?? 'unknown',
  platform: `${process.platform} ${process.arch}`,
  date: new Date().toISOString().slice(0, 10),
  lib: { version: JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version, sha256: createHash('sha256').update(await readFile(lib)).digest('hex') },
  rounds: ROUNDS,
  users: USERS,
  operations: OPERATIONS.length,
  bytes: { typed: texts['typed.dson'].length, plain: texts['plain.json'].length, plainDson: texts['plain.dson'].length },
  memory: 'peak RSS of a fresh process (maxRSS)',
  baselineRssMB: { typed: peak('typed', 'none'), plain: peak('plain', 'none') },
  results,
};
await writeFile(new URL(`${runtime}.json`, bench), `${JSON.stringify(result, null, 2)}\n`);
for (const row of results)
  console.log(`${new Date().toISOString()} INFO bench runtime=${runtime}@${version} graph=${row.graph} op=${row.operation} median_ms=${row.medianMs} peak_rss_mb=${row.peakRssMB}`);
