import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { prepare, measure, RECORDS, SAMPLES } from './bench-binary-core.mjs';

const prepared = prepare();
const runtime = process.versions.bun ? 'bun' : 'node';
const results = measure(prepared);
if (runtime === 'node') {
  const { Session } = await import('node:inspector/promises');
  const session = new Session(); session.connect();
  try {
    for (const [index, operation] of prepared.operations.entries()) {
      globalThis.gc?.();
      await session.post('HeapProfiler.startSampling', {
        samplingInterval: 512, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true,
      });
      const iterations = 10;
      for (let i = 0; i < iterations; i++) operation.run();
      const { profile } = await session.post('HeapProfiler.stopSampling');
      const pending = [profile.head]; let allocated = 0;
      while (pending.length) { const node = pending.pop(); allocated += node.selfSize; pending.push(...node.children); }
      results[index].sampledAllocatedBytesPerOperation = Math.round(allocated / iterations);
    }
  } finally { session.disconnect(); }
}
const hashes = {};
for (const name of ['index', 'binary', 'sequence']) hashes[name] = createHash('sha256').update(await readFile(new URL(`../dist/${name}.mjs`, import.meta.url))).digest('hex');
const report = {
  runtime, version: process.versions.bun ?? process.versions.node, cpu: cpus()[0].model,
  platform: `${process.platform} ${process.arch}`, measuredAt: new Date().toISOString(), hashes,
  records: RECORDS, samples: SAMPLES, sizes: prepared.sizes, lookupTargetOrdinal: prepared.target,
  methodology: 'Median of nine warmed batches of at least approximately 10 ms; memory-resident records. Index setup is excluded from lookup and measured separately.',
  allocation: runtime === 'node'
    ? 'V8 sampling heap profiler, 512-byte sampling interval, ten calls per operation, includes objects collected by minor and major GC; JavaScript-heap estimates include profiler overhead and exclude external ArrayBuffer backing stores; not exact allocation counts.'
    : 'Unavailable: no equivalent V8 allocation sampler in this runtime.',
  results,
};
await mkdir(new URL('../output/bench/', import.meta.url), { recursive: true });
await writeFile(new URL(`../output/bench/binary-${runtime}.json`, import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
for (const row of results) console.log(`${new Date().toISOString()} INFO binary-bench runtime=${runtime} operation=${row.operation} median_ms=${row.medianMs.toFixed(4)} sampled_allocated_bytes=${row.sampledAllocatedBytesPerOperation ?? 'unavailable'}`);
