import { DSON } from './lib/defuss-dson.mjs';
import { examples } from './examples.js';

// The website's only script: the playground (adapted from the former Vite + Monaco demo, now a textarea so the page
// needs no editor download), the live JSON-vs-DSON table, theme and copy buttons. Everything DSON shows here is
// computed by the build in ./lib/, so the page cannot claim behaviour the library does not have.
// VERIFIED: e2e/site.spec.ts compares every preset's console with its comments in Chromium and WebKit.

const $ = (id) => document.getElementById(id);
const TAGS = { '-1': 'VOID', 0: 'PRIMITIVE', 1: 'ARRAY', 2: 'OBJECT', 3: 'DATE', 4: 'REGEXP', 5: 'MAP', 6: 'SET', 7: 'ERROR', 8: 'BIGINT', 9: 'NUMBER' };
const TYPED = /^(?:Big)?(?:Int|Uint|Float)(?:8|16|32|64)(?:Clamped)?Array$/;
const IDENT = /^[A-Za-z_$][\w$]*$/;

/**
 * Renders a value the way Node's console.log does for the cases the examples use, so a line printed in the
 * playground reads exactly as the example's `// output` comment, which e2e also checks under Node.js and Bun.
 */
export function inspect(value, nested = false, path = new Set(), depth = 0) {
  switch (typeof value) {
    case 'string': return nested ? `'${value.replaceAll("'", "\\'")}'` : value;
    case 'number': return Object.is(value, -0) ? '-0' : String(value);
    case 'bigint': return `${value}n`;
    case 'symbol': return value.toString();
    case 'function': return `[Function: ${value.name || '(anonymous)'}]`;
    case 'undefined': return 'undefined';
    case 'boolean': return String(value);
  }
  if (value === null) return 'null';
  if (path.has(value)) return '[Circular]';
  if (depth > 5) return '[Object]';
  const next = new Set(path).add(value);
  const show = (item) => inspect(item, true, next, depth + 1);
  const brand = Object.prototype.toString.call(value).slice(8, -1);
  const list = (open, items, close) => (items.length ? `${open} ${items.join(', ')} ${close}` : `${open}${close}`);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  if (value instanceof RegExp) return String(value);
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value instanceof Map) return list(`Map(${value.size}) {`, [...value].map(([k, v]) => `${show(k)} => ${show(v)}`), '}');
  if (value instanceof Set) return list(`Set(${value.size}) {`, [...value].map(show), '}');
  if (value instanceof ArrayBuffer || value instanceof DataView) return `${brand} { byteLength: ${value.byteLength} }`;
  if (TYPED.test(brand)) return list(`${brand}(${value.length}) [`, Array.from(value, show), ']');
  if (Array.isArray(value)) return list('[', value.map(show), ']');
  if (['Number', 'String', 'Boolean', 'BigInt'].includes(brand)) return `[${brand}: ${show(value.valueOf())}]`;
  const name = Object.getPrototypeOf(value)?.constructor?.name;
  const prefix = name && name !== 'Object' ? `${name} ` : '';
  const entries = Object.keys(value).map((key) => `${IDENT.test(key) ? key : `'${key}'`}: ${show(value[key])}`);
  return prefix + list('{', entries, '}');
}

// ---- playground -------------------------------------------------------------------------------------------------
const AsyncFunction = (async () => {}).constructor;
const el = {
  code: $('pg-code'), preset: $('pg-preset'), error: $('pg-error'), errorText: $('pg-error-text'),
  console: $('pg-console'), text: $('pg-text'), records: $('pg-records'), decoded: $('pg-decoded'), json: $('pg-json'),
  status: $('pg-status'), equal: $('pg-equal'), sizes: $('pg-sizes'),
};

for (const { id, title } of examples) el.preset.add(new Option(title, id));

let run = 0;
// Set by the highlighting section below: repaint the output panes after each run, and the editor layer.
let afterRun = () => {};
let refreshEditor = () => {};
/** Runs the editor's code with DSON and a console that writes into the Console tab, then shows the round trip. */
async function execute() {
  const ticket = ++run;
  const lines = [];
  const capture = { log: (...args) => lines.push(args.map((arg) => inspect(arg)).join(' ')) };
  capture.info = capture.warn = capture.error = capture.debug = capture.log;
  try {
    // The visitor's own code in the visitor's own tab: the same trust as typing into the browser console.
    const value = await new AsyncFunction('DSON', 'console', el.code.value)(DSON, capture);
    if (ticket !== run) return;
    const text = DSON.stringify(value);
    const decoded = DSON.parse(text);
    const records = JSON.parse(text);
    el.text.textContent = records.length > 1
      ? `[\n  ${records.map((record) => JSON.stringify(record)).join(',\n  ')}\n]`
      : text;
    el.records.replaceChildren(...records.map(([tag, payload], index) => {
      const row = document.createElement('tr');
      row.className = 'table-row';
      for (const [cell, content] of [['index', String(index)], ['tag', TAGS[tag] ? `${tag} · ${TAGS[tag]}` : tag], ['payload', JSON.stringify(payload)]]) {
        const td = document.createElement('td');
        td.className = `table-cell dz-${cell}`;
        td.textContent = content;
        row.append(td);
      }
      return row;
    }));
    el.decoded.textContent = inspect(decoded);
    let json;
    try { json = JSON.stringify(value) ?? 'undefined'; } catch (error) { json = `JSON.stringify throws: ${error.name}: ${error.message}`; }
    el.json.textContent = json;
    const equal = DSON.isEqual(value, decoded);
    el.equal.textContent = equal ? 'round trip: equal' : 'round trip: differs';
    el.equal.dataset.variant = equal ? 'default' : 'destructive';
    el.sizes.textContent = `${text.length.toLocaleString('en')} characters, ${records.length} records`;
    el.error.hidden = true;
  } catch (error) {
    if (ticket !== run) return;
    el.errorText.textContent = `${error?.name ?? 'Error'}: ${error?.message ?? error}`;
    el.error.hidden = false;
  }
  el.console.textContent = lines.join('\n');
  afterRun();
  el.status.textContent = el.error.hidden ? 'Ran' : 'Failed';
}

const load = (id) => {
  const example = examples.find((entry) => entry.id === id) ?? examples[0];
  el.preset.value = example.id;
  el.code.value = example.code;
  refreshEditor();
  execute();
};
el.preset.addEventListener('change', () => load(el.preset.value));
let timer;
el.code.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(execute, 250); });
// Tab inserts two spaces instead of leaving the editor; Escape then Tab still moves focus on.
let escaped = false;
el.code.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { escaped = true; return; }
  if (event.key !== 'Tab' || event.shiftKey || escaped) { escaped = false; return; }
  event.preventDefault();
  el.code.setRangeText('  ', el.code.selectionStart, el.code.selectionEnd, 'end');
  el.code.dispatchEvent(new Event('input'));
});
load(new URLSearchParams(location.search).get('example'));

// ---- JSON vs DSON ------------------------------------------------------------------------------------------------
const rows = [
  { label: 'Map', make: () => new Map([['a', 1]]), keeps: (v) => v instanceof Map && v.get('a') === 1 },
  { label: 'Set', make: () => new Set([1, 2]), keeps: (v) => v instanceof Set && v.has(2) },
  { label: 'Date', make: () => new Date(0), keeps: (v) => v instanceof Date && v.getTime() === 0 },
  { label: 'RegExp', make: () => /dson/gi, keeps: (v) => v instanceof RegExp && v.flags === 'gi' },
  { label: 'BigInt', make: () => 2n ** 64n, keeps: (v) => v === 2n ** 64n },
  { label: 'undefined', make: () => ({ value: undefined }), keeps: (v) => 'value' in v && v.value === undefined },
  { label: 'NaN', make: () => NaN, keeps: (v) => Number.isNaN(v) },
  { label: '-0', make: () => -0, keeps: (v) => Object.is(v, -0) },
  { label: 'Infinity', make: () => Infinity, keeps: (v) => v === Infinity },
  { label: 'Uint8Array', make: () => new Uint8Array([1, 2]), keeps: (v) => v instanceof Uint8Array && v[1] === 2 },
  { label: 'ArrayBuffer', make: () => new Uint8Array([1, 2]).buffer, keeps: (v) => v instanceof ArrayBuffer && v.byteLength === 2 },
  { label: 'TypeError', make: () => new TypeError('nope'), keeps: (v) => v instanceof TypeError && v.message === 'nope' },
  { label: 'Circular reference', make: () => { const o = { name: 'o' }; o.self = o; return o; }, keeps: (v) => v.self === v },
  { label: 'Shared reference', make: () => { const s = { n: 1 }; return [s, s]; }, keeps: (v) => v[0] === v[1] },
];

const cell = (format, row) => {
  const td = document.createElement('td');
  td.className = 'table-cell';
  let kept = false;
  let shown;
  try {
    const result = format.parse(format.stringify(row.make()));
    kept = row.keeps(result);
    shown = inspect(result, true);
  } catch (error) {
    shown = `throws ${error.name}`;
  }
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.dataset.variant = kept ? 'default' : 'destructive';
  badge.dataset.size = 'sm';
  badge.textContent = kept ? 'kept' : 'lost';
  const code = document.createElement('code');
  code.textContent = shown;
  td.append(badge, ' ', code);
  td.dataset.kept = String(kept);
  return td;
};

$('compare-rows').replaceChildren(...rows.map((row) => {
  const tr = document.createElement('tr');
  tr.className = 'table-row';
  const head = document.createElement('th');
  head.className = 'table-cell';
  head.scope = 'row';
  const original = document.createElement('code');
  original.textContent = row.label;
  head.append(original);
  tr.append(head, cell(JSON, row), cell(DSON, row));
  return tr;
}));

// ---- syntax highlighting --------------------------------------------------------------------------------------
// The page holds plain code text (readable without script, and what e2e extracts and runs). Code blocks are split
// into the one-span-per-line markup defuss-shadcn numbers right away; Shiki (./lib/shiki.mjs, bundled by
// scripts/site.mjs) colours them once it has loaded, so the first paint never waits for the 100 kB highlighter.
// Every token carries both theme colours as CSS variables; site.css picks one, so dark mode needs no re-highlight.
let tokenize = null;
const styleOf = (token) => Object.entries(token.htmlStyle ?? {}).map(([name, value]) => `${name}:${value}`).join(';');
const tokenSpan = (token) => {
  const span = document.createElement('span');
  span.textContent = token.content;
  span.setAttribute('style', styleOf(token));
  return span;
};
const linesOf = (text, lang) => (tokenize ? tokenize(text, lang) : text.split('\n').map((line) => [{ content: line }]));

/** Code blocks: one span per line (numbered by defuss-shadcn), tokens inside. */
const paintBlock = (code) => {
  const lang = code.parentElement.dataset.lang;
  code.replaceChildren(...linesOf(code.dataset.source, lang).map((tokens) => {
    const line = document.createElement('span');
    line.append(...tokens.map((token) => (token.htmlStyle ? tokenSpan(token) : token.content)));
    return line;
  }));
  if (tokenize) code.dataset.shiki = 'true';
};

/** Free text (editor layer, output panes): tokens with newlines between lines, no line spans. */
const paintText = (node, text) => {
  const lang = node.closest('[data-lang]')?.dataset.lang;
  const parts = [];
  linesOf(text, lang).forEach((tokens, index) => {
    if (index) parts.push('\n');
    for (const token of tokens) parts.push(token.htmlStyle ? tokenSpan(token) : token.content);
  });
  node.replaceChildren(...parts);
  if (tokenize) node.dataset.shiki = 'true';
};

const blocks = [...document.querySelectorAll('.mk-code-block pre[data-lang] > code')];
for (const code of blocks) {
  // Copy reads this, not innerText: an empty line's span has no text, so innerText would drop blank lines.
  code.dataset.source = code.textContent.replace(/^\n|\n$/g, '');
  paintBlock(code);
}

// The editor: a transparent textarea over a highlighted layer of the same text, font and box. Why not a code editor
// component: the textarea keeps native editing, undo, selection and accessibility, and the layer only paints.
const layer = $('pg-highlight');
const paintEditor = () => {
  // The trailing newline keeps the layer as tall as the textarea when the code ends with an empty line.
  paintText(layer, `${el.code.value}\n`);
  layer.parentElement.scrollTop = el.code.scrollTop;
  layer.parentElement.scrollLeft = el.code.scrollLeft;
};
el.code.addEventListener('input', paintEditor);
el.code.addEventListener('scroll', () => {
  layer.parentElement.scrollTop = el.code.scrollTop;
  layer.parentElement.scrollLeft = el.code.scrollLeft;
});
$('pg-editor').dataset.highlight = 'true';
refreshEditor = paintEditor;
paintEditor();

const paintOutputs = () => { for (const pane of [el.text, el.decoded, el.json]) paintText(pane, pane.textContent); };
afterRun = paintOutputs;
paintOutputs();

import('./lib/shiki.mjs').then((module) => {
  tokenize = module.tokenize;
  for (const code of blocks) paintBlock(code);
  paintEditor();
  paintOutputs();
  document.documentElement.dataset.highlighted = 'true';
}, (error) => console.error('syntax highlighting unavailable', error));

// ---- theme, copy ---------------------------------------------------------------------------------------------------
const theme = $('theme-toggle');
const setTheme = (dark) => {
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  theme.checked = dark;
  try { localStorage.setItem('defuss-shadcn-theme', JSON.stringify(dark ? 'dark' : 'light')); } catch {}
};
theme.checked = document.documentElement.classList.contains('dark');
theme.addEventListener('change', () => setTheme(theme.checked));

const copy = async (text, status) => {
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = 'Copied';
  } catch {
    status.textContent = 'Copy failed';
  }
  setTimeout(() => { status.textContent = ''; }, 2000);
};
for (const button of document.querySelectorAll('.mk-code-block-copy')) {
  button.addEventListener('click', () => {
    const figure = button.closest('.mk-code-block');
    const pre = [...figure.querySelectorAll('pre')].find((node) => node.checkVisibility());
    copy(pre.querySelector('code').dataset.source, figure.querySelector('.mk-code-block-status'));
  });
}
$('copy-prompt').addEventListener('click', () => copy(
  [...document.querySelectorAll('#agent-prompt pre:not([data-tone]) code')].map((code) => code.textContent).join('\n'),
  $('copy-prompt-status')));

document.documentElement.dataset.ready = 'true';
