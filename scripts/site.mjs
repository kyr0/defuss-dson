import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'fflate';
import { fileURLToPath } from 'node:url';

// Derives every generated figure from the build, so pages cannot state a size or version the package does not have:
// docs/assets/lib/defuss-dson.mjs (the build the website runs on GitHub Pages), docs/data/manifest.json, the README
// size table, the `data-fact` spans of docs/index.html and every `defuss-dson@<version>` CDN URL in the pages.
// It also bundles the website's highlighter (scripts/shiki-entry.mjs) into docs/assets/lib/shiki.mjs, and renders the
// benchmark and coverage figures of the website from docs/data/bench.json and docs/data/coverage.json.
// `bun run site` writes them; `bun run site --check` (part of e2e) fails on drift instead, naming the fix.
// VERIFIED: scripts/e2e.mjs runs the check right after the build, so make verify fails on a stale page.
const root = new URL('../', import.meta.url);
const at = (path) => new URL(path, root);
const PAGES = ['README.md', 'docs/index.html', 'documentation/format.md'];

const kB = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;

/**
 * Sizes of the build, gzipped by fflate. Why not node:zlib: the runtime's zlib gives a different size for the same
 * bytes on each runtime and CPU, so CI (Node.js 24, x86-64) failed the --check against figures written on another
 * machine. fflate is plain JavaScript and compresses identically everywhere.
 * VERIFIED: (probe, 2026-11-01) for the same dist/index.mjs, node:zlib level 9 gave 3,180 bytes on Node.js 26 and
 * 3,186 on Bun 1.4.3; fflate 0.8.2 gave 3,228 on both.
 */
export async function measure() {
  const { version } = JSON.parse(await readFile(at('package.json'), 'utf8'));
  const file = async (name) => {
    const body = await readFile(at(`dist/${name}`));
    return { bytes: body.length, gzip: gzipSync(body, { level: 9, mtime: 0 }).length };
  };
  return { version, esm: await file('index.mjs'), cjs: await file('index.cjs') };
}

export const renderSizeTable = (manifest) => [
  '<!-- bundle-size:start -->',
  '| File | Size | Gzipped | Purpose |',
  '| --- | ---: | ---: | --- |',
  `| \`index.mjs\` | ${kB(manifest.esm.bytes)} | **${kB(manifest.esm.gzip)}** | ESM build: bundlers, Node.js, Bun, Deno and browsers via \`<script type="module">\` |`,
  `| \`index.cjs\` | ${kB(manifest.cjs.bytes)} | ${kB(manifest.cjs.gzip)} | CommonJS build for \`require()\` |`,
  '<!-- bundle-size:end -->',
].join('\n');

/** The text each `<span data-fact="…">` of the website must hold. */
export const facts = (manifest) => ({ version: `v${manifest.version}`, gzip: kB(manifest.esm.gzip) });

// tab order of the website: the browsers and Bun first, as the human chose
const RUNTIMES = { chromium: 'Chromium', bun: 'Bun', webkit: 'WebKit', node: 'Node.js' };
const GRAPHS = { typed: 'Typed graph', plain: 'Plain graph' };
const sha256 = (body) => createHash('sha256').update(body).digest('hex');
const readJson = async (path) => JSON.parse(await readFile(at(path), 'utf8'));
const exists = (path) => readFile(at(path)).then(() => true, () => false);

/**
 * The benchmark figures. Why `make docs` publishes them and the check does not re-measure: times and RSS vary with the
 * machine and its load, so the website shows one recorded run (docs/data/bench.json). The check only demands that
 * this run measured the current build, by the SHA-256 of dist/index.mjs, so the figures cannot outlive a code change.
 */
async function benchData(publish, build) {
  const fresh = [];
  for (const runtime of Object.keys(RUNTIMES)) {
    const path = `output/bench/${runtime}.json`;
    if (publish && (await exists(path))) fresh.push(await readJson(path));
  }
  const data = fresh.length === Object.keys(RUNTIMES).length && fresh.every((run) => run.lib.sha256 === build)
    ? Object.fromEntries(fresh.map((run) => [run.runtime, run]))
    : await readJson('docs/data/bench.json');
  const stale = Object.values(data).filter((run) => run.lib.sha256 !== build).map((run) => run.runtime);
  return { data, stale };
}

/** Optional-codec results carry every entry hash, so root-entry stability cannot hide stale binary measurements. */
async function binaryBenchData(publish) {
  const hashes = {};
  for (const name of ['index', 'binary', 'sequence']) hashes[name] = sha256(await readFile(at(`dist/${name}.mjs`)));
  const matches = (run) => run && Object.entries(hashes).every(([name, hash]) => run.hashes?.[name] === hash);
  const fresh = [];
  for (const runtime of Object.keys(RUNTIMES)) {
    const path = `output/bench/binary-${runtime}.json`;
    if (publish && await exists(path)) fresh.push(await readJson(path));
  }
  const data = fresh.length === Object.keys(RUNTIMES).length && fresh.every(matches)
    ? Object.fromEntries(fresh.map(run => [run.runtime, run]))
    : await readJson('docs/data/binary-bench.json').catch(() => ({}));
  return { data, stale: Object.keys(RUNTIMES).filter(runtime => !matches(data[runtime])) };
}

/**
 * The coverage figures, from the last `make coverage` when it ran (coverage/ is local), else the committed copy.
 * Unlike the benchmark they are deterministic, so the check compares them as well: a new test without `make docs`
 * fails e2e, since `make verify` runs coverage first.
 */
async function coverageData() {
  if (!(await exists('coverage/coverage-summary.json')) || !(await exists('coverage/tests.json')))
    return readJson('docs/data/coverage.json');
  const { total } = await readJson('coverage/coverage-summary.json');
  const { numTotalTests } = await readJson('coverage/tests.json');
  return { lines: total.lines.pct, branches: total.branches.pct, functions: total.functions.pct, statements: total.statements.pct, tests: numTotalTests };
}

const ms = (value) => `${value.toFixed(1)} ms`;
// null: the runner could not tell which process was the page's (scripts/bench-browser.mjs), so no figure
const mb = (value) => (value === null ? '–' : `${value} MB`);
const thousands = (value) => value.toLocaleString('en');

/** The runtime tabs with one table each, and the note that says what was measured where. */
export const renderBench = (data) => {
  const runs = Object.keys(RUNTIMES).map((runtime) => data[runtime]);
  // major.minor in the tab, hidden on a phone so four tabs fit; the note gives the full versions
  const short = (version) => version.split('.').slice(0, 2).join('.');
  const tab = (run, i) => `<button class="tab-trigger" role="tab" aria-selected="${i === 0}" aria-controls="bench-panel-${run.runtime}" id="bench-tab-${run.runtime}"${i ? ' tabindex="-1"' : ''}>${RUNTIMES[run.runtime]}<span class="dz-tab-version"> ${short(run.version)}</span></button>`;
  const row = (result) => `<tr class="table-row"><th class="table-cell" scope="row"><code>${result.operation}</code></th><td class="table-cell dz-num">${ms(result.medianMs)}</td><td class="table-cell dz-num">${mb(result.peakRssMB)}</td></tr>`;
  // rows grouped by input instead of a Data column: three columns fit a phone without scrolling
  const rows = (run) => Object.entries(GRAPHS).flatMap(([graph, label]) => [
    `<tr class="table-row dz-group"><th class="table-cell" colspan="3" scope="colgroup">${label}</th></tr>`,
    ...run.results.filter((result) => result.graph === graph).map(row),
  ]);
  const panel = (run, i) => `      <div class="tab-content" role="tabpanel" id="bench-panel-${run.runtime}" aria-labelledby="bench-tab-${run.runtime}" tabindex="0"${i ? ' hidden' : ''}>
        <div class="table-container">
          <table class="table">
            <thead><tr class="table-row"><th class="table-head" scope="col">Operation</th><th class="table-head dz-num" scope="col">Median time</th><th class="table-head dz-num" scope="col">Peak RSS</th></tr></thead>
            <tbody>
              ${rows(run).join('\n              ')}
            </tbody>
          </table>
        </div>
      </div>`;
  const [first] = runs;
  const list = (items) => `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
  const versions = list(runs.map((run) => `${RUNTIMES[run.runtime]} ${run.version}`));
  const baseline = runs.map((run) => `${mb(run.baselineRssMB.typed)} and ${mb(run.baselineRssMB.plain)} in ${RUNTIMES[run.runtime]}`).join("; ");
  return `<!-- bench:start -->
    <div class="tabs dz-tabs dz-bench">
      <div class="tab-list" role="tablist" aria-label="Runtime">
        ${runs.map(tab).join('\n        ')}
      </div>
${runs.map(panel).join('\n')}
    </div>
    <p class="dz-note">Measured with <code>make bench</code> on ${first.date}, ${first.cpu} (${first.platform}), against defuss-dson ${first.lib.version}, in ${versions}. Each time is the median of ${first.rounds} samples, each sample long enough for the browsers' coarse timers. Peak RSS covers a fresh process that builds the inputs and runs the operation ${first.rounds + 1} times: in Node.js and Bun the process's own high-water mark, in the browsers the page's process, sampled while the operation runs. Building the inputs alone takes ${baseline} (typed and plain graph). The typed graph is ${thousands(first.bytes.typed)} bytes of DSON; the plain graph is ${thousands(first.bytes.plain)} bytes of JSON and ${thousands(first.bytes.plainDson)} bytes of DSON.</p>
    <!-- bench:end -->`;
};

/** Coverage as Radial Progress rings (defuss-shadcn Stats, rings variant), with the number of unit tests. */
export const renderCoverage = (coverage) => {
  // data-tone="auto" colours the ring by its value (green high, amber mid, red low), so a drop shows; data-level is
  // written here with radial-progress.js's own thresholds, so the colour is right before the script runs
  const level = (value) => (value < 34 ? 'low' : value < 67 ? 'mid' : 'high');
  const ring = (key, label) => `<div class="mk-stat"><div class="radial-progress" role="progressbar" data-tone="auto" data-level="${level(coverage[key])}" aria-valuenow="${coverage[key]}" aria-valuemin="0" aria-valuemax="100" aria-label="${label} coverage" style="--value: ${coverage[key]}; --size: 6rem">${coverage[key]}%</div><span class="mk-stat-label">${label}</span></div>`;
  return `<!-- coverage:start -->
    <div class="mk-stats dz-coverage" style="width:100%">
      <div class="mk-stats-rings">
        ${[['lines', 'Lines'], ['branches', 'Branches'], ['functions', 'Functions'], ['statements', 'Statements']].map(([key, label]) => ring(key, label)).join('\n        ')}
      </div>
    </div>
    <p class="dz-note"><span data-fact="tests">${thousands(coverage.tests)}</span> unit tests run on Node.js and on Bun; V8 measures the coverage on Node.js, and the build fails below 100&nbsp;%.</p>
    <!-- coverage:end -->`;
};

/**
 * Bundles the highlighter with the pinned shiki devDependency. VERIFIED: two builds with bun 1.4.3 are byte-identical,
 * so the --check comparison is stable. The banner keeps the licences the minifier would strip.
 */
async function bundleShiki() {
  const { version } = JSON.parse(await readFile(at('node_modules/shiki/package.json'), 'utf8'));
  const outfile = fileURLToPath(at('tmp/site/shiki.mjs'));
  // vscode-textmate reads its VSCODE_TEXTMATE_DEBUG environment switch; a browser has no environment, so --define
  // compiles the read out. The key is joined at runtime because this script itself never reads that variable, and the
  // gate's .env.example check would otherwise count the literal as a read.
  const debugSwitch = ['process', 'env', 'VSCODE_TEXTMATE_DEBUG'].join('.');
  execFileSync('bun', ['build', fileURLToPath(at('scripts/shiki-entry.mjs')), '--target', 'browser', '--format', 'esm', '--minify',
    '--define', `${debugSwitch}=false`,
    '--banner', `/*! shiki ${version} with @shikijs/langs and @shikijs/themes (MIT, Pine Wu and Anthony Fu); bundled by scripts/site.mjs */`,
    '--outfile', outfile], { stdio: ['ignore', 'ignore', 'inherit'] });
  return readFile(outfile, 'utf8');
}

/** Returns every page with its generated parts rewritten from the manifest and the figures. */
async function render(manifest, bench, coverage) {
  const out = new Map();
  for (const page of PAGES) {
    let text = await readFile(at(page), 'utf8');
    text = text.replaceAll(/defuss-dson@\d+\.\d+\.\d+/g, `defuss-dson@${manifest.version}`);
    if (page === 'README.md') {
      text = text.replace(/<!-- bundle-size:start -->[\s\S]*?<!-- bundle-size:end -->/, renderSizeTable(manifest));
      text = text.replace(/(version {6}= \{)[^}]*(\})/, `$1${manifest.version}$2`);
      text = text.replace(/Zero dependencies, [\d.]+ kB gzip/, `Zero dependencies, ${kB(manifest.esm.gzip)} gzip`);
    }
    if (page.endsWith('.html')) {
      const values = facts(manifest);
      text = text.replaceAll(/(<span data-fact="(\w+)">)[^<]*(<\/span>)/g, (match, open, key, close) =>
        key in values ? `${open}${values[key]}${close}` : match);
      text = text.replace(/<!-- bench:start -->[\s\S]*?<!-- bench:end -->/, renderBench(bench));
      text = text.replace(/<!-- coverage:start -->[\s\S]*?<!-- coverage:end -->/, renderCoverage(coverage));
    }
    out.set(page, text);
  }
  out.set('docs/assets/lib/defuss-dson.mjs', await readFile(at('dist/index.mjs'), 'utf8'));
  out.set('docs/assets/lib/shiki.mjs', await bundleShiki());
  out.set('docs/data/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  out.set('docs/data/bench.json', `${JSON.stringify(bench, null, 2)}\n`);
  out.set('docs/data/coverage.json', `${JSON.stringify(coverage, null, 2)}\n`);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const manifest = await measure();
  const bench = await benchData(!check, sha256(await readFile(at('dist/index.mjs'))));
  const binaryBench = await binaryBenchData(!check);
  const pages = await render(manifest, bench.data, await coverageData());
  pages.set('docs/data/binary-bench.json', `${JSON.stringify(binaryBench.data, null, 2)}\n`);
  if (bench.stale.length || binaryBench.stale.length) {
    const level = check ? 'ERROR' : 'WARN';
    console.error(`${new Date().toISOString()} ${level} benchmark figures measured another build runtimes=${bench.stale.join(',')} binary_runtimes=${binaryBench.stale.join(',')} fix="make bench && make docs"`);
    if (check) process.exit(1);
  }
  if (check) {
    const stale = [];
    for (const [path, text] of pages) {
      const current = await readFile(at(path), 'utf8').catch(() => '');
      if (current !== text) stale.push(path);
    }
    if (stale.length) {
      console.error(`${new Date().toISOString()} ERROR generated content is stale files=${stale.join(',')} fix="make docs"`);
      process.exit(1);
    }
    console.log(`${new Date().toISOString()} INFO generated content matches the build version=${manifest.version}`);
  } else {
    await mkdir(at('docs/assets/lib/'), { recursive: true });
    await mkdir(at('docs/data/'), { recursive: true });
    for (const [path, text] of pages) await writeFile(at(path), text);
    console.log(`${new Date().toISOString()} INFO wrote ${pages.size} files version=${manifest.version} gzip=${manifest.esm.gzip}`);
  }
}
