import { execFileSync } from 'node:child_process';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Consumes the publishable tarball, never the source tree: build → pack → clean consumer → Vitest (the package and
// every published example on Node.js and Bun) → Playwright (library, examples and website in Chromium and WebKit).
// Leaves output/e2e/report.json, the Playwright HTML report and its JSON results.
// VERIFIED: the defuss-vae gate reads these files as the e2e evidence of a run.
const root = fileURLToPath(new URL('../', import.meta.url));
const consumer = join(root, 'tmp/e2e/consumer');
const output = join(root, 'output/e2e');
const log = (level, message) => console.log(`${new Date().toISOString()} ${level} ${message}`);
const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options });
const step = (command, args, env) => execFileSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });

await rm(consumer, { recursive: true, force: true });
await rm(output, { recursive: true, force: true });
await mkdir(consumer, { recursive: true });
await mkdir(output, { recursive: true });

log('INFO', 'build');
run('bun', ['run', 'build']);
// The pages must state the figures of this build (sizes, version, the library copy the website ships).
step('node', ['scripts/site.mjs', '--check']);

const packed = run('bun', ['pm', 'pack', '--destination', consumer, '--quiet']).trim().split('\n').at(-1);
const tarball = join(consumer, basename(packed));
await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
run('bun', ['add', tarball], { cwd: consumer });
log('INFO', `installed ${basename(tarball)} into ${consumer}`);

const env = {
  DSON_CONSUMER: consumer,
  DSON_TARBALL: tarball,
  DSON_LIB: join(consumer, 'node_modules/defuss-dson/dist/index.mjs'),
};
log('INFO', 'vitest e2e: tarball, ESM/CJS, types, published examples on Node.js and Bun');
step('bunx', ['vitest', 'run', '-c', 'vitest.e2e.config.ts'], env);
log('INFO', 'playwright: library, examples and website in Chromium and WebKit');
step('bunx', ['playwright', 'test'], env);

const report = {
  finishedAt: new Date().toISOString(),
  tarball: basename(tarball),
  bytes: (await stat(tarball)).size,
  node: process.version,
  bun: run('bun', ['--version']).trim(),
  browsers: ['chromium', 'webkit'],
  passed: [
    'tarball holds only package.json, README.md, LICENSE and dist/',
    'type matrix via ESM and CommonJS on Node.js and Bun',
    'binary and framed sequence matrix through both subpaths on Node.js, Bun, Chromium and WebKit',
    'type declarations under nodenext (ESM and CJS consumers)',
    'every README, documentation, website and playground example on Node.js and Bun',
    'type matrix and every example in Chromium and WebKit',
    'website: sections, figures, JSON vs DSON table, playground, theme, copy, phone layout',
  ],
};
await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
log('INFO', `e2e passed tarball=${report.tarball} bytes=${report.bytes} node=${report.node} bun=${report.bun}`);
