import { chromium, webkit } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';

const files = new Map([['/', '<!doctype html><title>binary benchmark</title>']]);
for (const path of ['scripts/bench-binary-core.mjs', 'dist/index.mjs', 'dist/binary.mjs', 'dist/sequence.mjs'])
  files.set(`/${path}`, await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
const hashes = Object.fromEntries(['index', 'binary', 'sequence'].map(name => [name, createHash('sha256').update(files.get(`/dist/${name}.mjs`)).digest('hex')]));
await mkdir(new URL('../output/bench/', import.meta.url), { recursive: true });
for (const [runtime, type] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await type.launch();
  try {
    const page = await browser.newPage();
    await page.route('http://binary-bench.invalid/**', route => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({ status: files.has(path) ? 200 : 404, body: files.get(path) ?? '', contentType: path === '/' ? 'text/html' : 'text/javascript' });
    });
    await page.goto('http://binary-bench.invalid/');
    const report = await page.evaluate(async () => {
      const { prepare, measure, RECORDS, SAMPLES } = await import('/scripts/bench-binary-core.mjs');
      const prepared = prepare();
      return { records: RECORDS, samples: SAMPLES, sizes: prepared.sizes, lookupTargetOrdinal: prepared.target, results: measure(prepared) };
    });
    Object.assign(report, { runtime, version: browser.version(), cpu: cpus()[0].model, platform: `${process.platform} ${process.arch}`,
      measuredAt: new Date().toISOString(), hashes, allocation: 'Unavailable: no common browser allocation sampler.',
      methodology: 'Median of nine warmed batches of at least approximately 10 ms; memory-resident records. Index setup excluded from lookup and measured separately.' });
    await writeFile(new URL(`../output/bench/binary-${runtime}.json`, import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
    for (const row of report.results) console.log(`${new Date().toISOString()} INFO binary-bench runtime=${runtime} operation=${row.operation} median_ms=${row.medianMs.toFixed(4)}`);
  } finally { await browser.close(); }
}
