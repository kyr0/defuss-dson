import { readFile, readdir } from "node:fs/promises";

/**
 * Every runnable code example the project publishes, read from the pages themselves.
 *
 * Why read the pages instead of copying their examples into tests: a copy drifts, and a drifted example is exactly
 * what a reader pastes. The sources are the README, documentation/*.md, the website's `data-example` blocks and the
 * playground presets (docs/assets/examples.js). Each example states what it prints with
 * `console.log(...); // <output>` comments; the runners compare those with what really printed.
 * VERIFIED: e2e/docs.test.ts asserts a minimum count per source, so an extractor that finds nothing fails.
 */
export interface Example {
  /** Where it comes from, e.g. `README.md#3`; names the failing example in test output. */
  name: string;
  /**
   * `module`: an ES module importing "defuss-dson" (README, documentation, website), run in Node.js, Bun and browsers.
   * `preset`: an async function body receiving `DSON` (playground), run the same way.
   */
  kind: "module" | "preset";
  /** `ts` blocks run only in Node.js and Bun, which strip types; browsers get the `js` ones. */
  typescript: boolean;
  code: string;
  expected: string[];
}

const root = new URL("../", import.meta.url);
const OUTPUT = /^\s*console\.log\(.*\);\s*\/\/ (.*)$/gm;
const expectedOf = (code: string) => [...code.matchAll(OUTPUT)].map((match) => match[1]!);
const CDN = /https:\/\/cdn\.jsdelivr\.net\/npm\/defuss-dson@[\d.]+\/dist\/index\.mjs/g;
const decode = (html: string) =>
  html.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&");

/**
 * A `<script type="module">` page example becomes a module importing the bare "defuss-dson": the runners map that
 * specifier to the build under test, never to the CDN, so an example is tested before its version is published.
 */
const fromHtml = (html: string) => {
  const script = /<script type="module">\n([\s\S]*?)<\/script>/.exec(html);
  if (!script) return undefined;
  return script[1]!.replace(CDN, "defuss-dson").replace(/^ {2}/gm, "");
};

async function fromMarkdown(path: string): Promise<Example[]> {
  const text = await readFile(new URL(path, root), "utf8");
  const examples: Example[] = [];
  let index = 0;
  for (const [, lang, info, body] of text.matchAll(/^```(\w+)([^\n]*)\n([\s\S]*?)^```$/gm)) {
    index++;
    if (info!.includes("no-run")) continue;
    let code: string | undefined;
    if (lang === "js" || lang === "ts") code = body!;
    else if (lang === "html" && body!.includes("defuss-dson")) code = fromHtml(body!);
    if (!code || !code.includes("defuss-dson")) continue;
    examples.push({ name: `${path}#${index}`, kind: "module", typescript: lang === "ts", code, expected: expectedOf(code) });
  }
  return examples;
}

async function fromSite(): Promise<Example[]> {
  const html = await readFile(new URL("docs/index.html", root), "utf8");
  return [...html.matchAll(/<pre[^>]*data-example="(node|browser)"[^>]*><code>([\s\S]*?)<\/code><\/pre>/g)].map(
    ([, kind, body], i) => {
      const code = kind === "browser" ? fromHtml(decode(body!))! : decode(body!);
      return { name: `docs/index.html#${i + 1}`, kind: "module", typescript: false, code, expected: expectedOf(code) };
    },
  );
}

async function fromPresets(): Promise<Example[]> {
  const { examples } = (await import(new URL("docs/assets/examples.js", root).href)) as {
    examples: { id: string; code: string }[];
  };
  return examples.map(({ id, code }) => ({ name: `preset:${id}`, kind: "preset", typescript: false, code, expected: expectedOf(code) }));
}

export async function collectExamples(): Promise<Example[]> {
  const pages = ["README.md", ...(await readdir(new URL("documentation/", root))).filter((f) => f.endsWith(".md")).map((f) => `documentation/${f}`)];
  const lists = await Promise.all([...pages.map(fromMarkdown), fromSite(), fromPresets()]);
  return lists.flat();
}

/** The module a runner executes: modules as written, presets wrapped into a module that passes `DSON` in. */
export const asModule = (example: Example): string =>
  example.kind === "module"
    ? example.code
    : `import { DSON } from "defuss-dson";\nawait new (async () => {}).constructor("DSON", ${JSON.stringify(example.code)})(DSON);\n`;
