import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { OPERATIONS, ROUNDS, USERS, plain, typed } from './bench-core.mjs';

// The benchmark of scripts/bench-core.mjs in Chromium and WebKit, through Playwright: the same graphs, operations and
// timing as in Node.js and Bun, run inside a page. Results in output/bench/<browser>.json for `make docs`.
// Why memory is sampled from outside: a page cannot read its process's memory (performance.memory is Chromium-only
// and covers the JS heap, not the process). So each operation runs in a fresh browser context, the runner finds that
// page's process, the renderer that appeared with it, and samples its RSS with `ps` while the operation runs.
// VERIFIED: (probe, 2026-11-01, macOS) Chromium's renderer is a child of the browser process; WebKit's WebContent
// process is a system service (parent pid 1), so the runner matches both by name among the processes new since the
// context opened. When none matches, the figure stays empty instead of measuring another process.
const run = promisify(execFile);
const root = new URL('../', import.meta.url);
const bench = new URL('output/bench/', root);
const ORIGIN = 'http://bench.invalid';
const PAGE_PROCESS = /--type=renderer|WebKit\.WebContent|WebKitWebProcess/;

const lib = fileURLToPath(new URL('dist/index.mjs', root));
const { DSON } = await import(lib);
await mkdir(bench, { recursive: true });
const texts = {
  'typed.dson': DSON.stringify(typed()),
  'plain.dson': DSON.stringify(plain()),
  'plain.json': JSON.stringify(plain()),
};
const files = {
  '/': ['text/html', '<!doctype html><title>bench</title>'],
  '/bench-core.mjs': ['text/javascript', await readFile(new URL('scripts/bench-core.mjs', root), 'utf8')],
  '/dson.mjs': ['text/javascript', await readFile(lib, 'utf8')],
  ...Object.fromEntries(Object.entries(texts).map(([name, body]) => [`/${name}`, ['text/plain', body]])),
};

/** Opens a page on the fake origin with the library, the shared benchmark and the input texts loaded. */
const open = async (context) => {
  await context.route(`${ORIGIN}/**`, (route) => {
    const [contentType, body] = files[new URL(route.request().url()).pathname] ?? ['text/plain', ''];
    return route.fulfill({ contentType, body });
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(async (names) => {
    const core = await import('/bench-core.mjs');
    const { DSON } = await import('/dson.mjs');
    const texts = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await (await fetch(`/${name}`)).text()])));
    globalThis.bench = { core, DSON, texts };
  }, Object.keys(texts));
  return page;
};

const processes = async () => {
  const { stdout } = await run('ps', ['-A', '-o', 'pid=,rss=,args=']);
  return stdout.trim().split('\n').map((line) => {
    const [pid, rss, ...args] = line.trim().split(/\s+/);
    return { pid: Number(pid), rss: Number(rss) * 1024, args: args.join(' ') };
  });
};

const rssOf = async (pid) => {
  const { stdout } = await run('ps', ['-o', 'rss=', '-p', String(pid)]).catch(() => ({ stdout: '0' }));
  return Number(stdout.trim()) * 1024;
};

/**
 * The page's process: among the page processes that appeared since `before`, the largest. A browser may also start a
 * spare page process for the next navigation; it holds no inputs, so the page that does is the largest.
 */
const pageProcess = async (before) => {
  const known = new Set(before.map((p) => p.pid));
  const fresh = (await processes()).filter((p) => !known.has(p.pid) && PAGE_PROCESS.test(p.args));
  return fresh.sort((x, y) => y.rss - x.rss)[0]?.pid;
};

/** Peak RSS of one page that builds the inputs of `graph` and runs `name` as often as the Node.js children do. */
const peak = async (browser, graph, name) => {
  const before = await processes();
  const context = await browser.newContext();
  try {
    const page = await open(context);
    await page.evaluate((graph) => {
      globalThis.bench.input = globalThis.bench.core.inputs(globalThis.bench.DSON, graph, globalThis.bench.texts);
      globalThis.gc?.();
    }, graph);
    const pid = await pageProcess(before);
    if (!pid) return null;
    let highest = await rssOf(pid);
    let running = true;
    const sampler = (async () => { while (running) highest = Math.max(highest, await rssOf(pid)); })();
    await page.evaluate(([graph, name]) => globalThis.bench.core.repeat(globalThis.bench.input, graph, name), [graph, name]);
    running = false;
    await sampler;
    highest = Math.max(highest, await rssOf(pid));
    return Math.round(highest / 1e6);
  } finally {
    await context.close();
  }
};

const sha256 = createHash('sha256').update(await readFile(lib)).digest('hex');
const { version: libVersion } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));

for (const [runtime, type, args] of [['chromium', chromium, ['--js-flags=--expose-gc']], ['webkit', webkit, []]]) {
  const browser = await type.launch({ args });
  try {
    const context = await browser.newContext();
    const page = await open(context);
    const timings = await page.evaluate(() => {
      const { core, DSON, texts } = globalThis.bench;
      return core.timeAll({ typed: core.inputs(DSON, 'typed', texts), plain: core.inputs(DSON, 'plain', texts) });
    });
    await context.close();
    const results = [];
    for (const row of timings) results.push({ ...row, peakRssMB: await peak(browser, row.graph, row.operation) });
    const result = {
      runtime, version: browser.version(),
      cpu: cpus()[0]?.model.trim() ?? 'unknown',
      platform: `${process.platform} ${process.arch}`,
      date: new Date().toISOString().slice(0, 10),
      lib: { version: libVersion, sha256 },
      rounds: ROUNDS,
      users: USERS,
      operations: OPERATIONS.length,
      bytes: { typed: texts['typed.dson'].length, plain: texts['plain.json'].length, plainDson: texts['plain.dson'].length },
      memory: "peak RSS of the page's process, sampled with ps during the runs",
      baselineRssMB: { typed: await peak(browser, 'typed', 'none'), plain: await peak(browser, 'plain', 'none') },
      results,
    };
    await writeFile(new URL(`${runtime}.json`, bench), `${JSON.stringify(result, null, 2)}\n`);
    for (const row of results)
      console.log(`${new Date().toISOString()} INFO bench runtime=${runtime}@${result.version} graph=${row.graph} op=${row.operation} median_ms=${row.medianMs} peak_rss_mb=${row.peakRssMB}`);
  } finally {
    await browser.close();
  }
}
