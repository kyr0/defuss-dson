import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { asModule, collectExamples } from "./examples.js";

// The website and the library in real browsers (Chromium and WebKit, see playwright.config.ts). The page is served
// from docs/ with its library replaced by the installed tarball's build (scripts/server.mjs, DSON_LIB), so what is
// tested here is what npm users and the published page get. Every test fails on page errors, console errors,
// failed requests and HTTP errors, including the defuss-shadcn CDN files and their integrity checks.

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("docs/data/manifest.json", root), "utf8"));
const bench = JSON.parse(await readFile(new URL("docs/data/bench.json", root), "utf8"));
const coverage = JSON.parse(await readFile(new URL("docs/data/coverage.json", root), "utf8"));
const examples = await collectExamples();
const matrix = await readFile(new URL("e2e/fixtures/matrix.mjs", root), "utf8");
const binaryMatrix = await readFile(new URL("e2e/fixtures/binary-matrix.mjs", root), "utf8");

const watch = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  page.on("requestfailed", (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("response", (response) => { if (response.status() >= 400) errors.push(`${response.url()}: HTTP ${response.status()}`); });
  return errors;
};

/**
 * Runs an ES module in the page that imports the bare "defuss-dson", resolved by an import map to the build under
 * test, and returns the lines it logged, formatted like Node's console.log for the primitives examples print.
 */
async function runModule(page: Page, code: string): Promise<string[]> {
  await page.goto("/__blank__");
  return page.evaluate(async (source) => {
    const map = document.createElement("script");
    map.type = "importmap";
    map.textContent = JSON.stringify({ imports: {
      "defuss-dson": new URL("/assets/lib/defuss-dson.mjs", location.href).href,
      "defuss-dson/binary": new URL("/__package__/binary.mjs", location.href).href,
      "defuss-dson/sequence": new URL("/__package__/sequence.mjs", location.href).href,
    } });
    document.head.append(map);
    const lines: string[] = [];
    const format = (value: unknown) =>
      typeof value === "bigint" ? `${value}n` : Object.is(value, -0) ? "-0" : typeof value === "string" ? value : String(value);
    const log = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(format).join(" ")); };
    try {
      await import(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
    } finally {
      console.log = log;
    }
    return lines;
  }, code);
}

test.describe("library in the browser", () => {
  test("passes the binary and sequence matrix from the packed subpaths", async ({ page }) => {
    const errors = watch(page);
    const lines = await runModule(page, binaryMatrix);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^binary matrix ok: \d+ checks$/);
    expect(errors).toEqual([]);
  });
  test("passes the type matrix", async ({ page }) => {
    const errors = watch(page);
    const lines = await runModule(page, matrix);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^matrix ok: \d+ checks$/);
    expect(errors).toEqual([]);
  });

  for (const example of examples.filter((entry) => !entry.typescript)) {
    test(`example ${example.name} prints what it states`, async ({ page }) => {
      const errors = watch(page);
      expect(await runModule(page, asModule(example))).toEqual(example.expected);
      expect(errors).toEqual([]);
    });
  }
});

test.describe("website", () => {
  let errors: string[];
  // The version badges ask jsDelivr for npm's latest version. The tests answer for it, so they do not depend on what
  // npm serves; by default with the build's version, which the static badges hold, too.
  const LATEST = "https://data.jsdelivr.com/v1/packages/npm/defuss-dson/resolved?specifier=latest";
  const answer = (version: string) => ({ json: { version }, headers: { "access-control-allow-origin": "*" } });
  test.beforeEach(async ({ page }) => {
    errors = watch(page);
    await page.route(LATEST, (route) => route.fulfill(answer(manifest.version)));
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
  });
  test.afterEach(() => expect(errors).toEqual([]));

  test("has one h1, every section, and figures that match the build", async ({ page }) => {
    await expect(page.locator("h1")).toHaveCount(1);
    for (const id of ["intro", "playground", "compare", "how", "binary", "faq", "numbers", "use"]) await expect(page.locator(`#${id}`)).toHaveCount(1);
    // every FAQ card shows its question and its answer, with no disclosure widget to open
    const faq = page.locator("#faq .mk-faq-item");
    await expect(faq).toHaveCount(7);
    for (const item of await faq.all()) {
      await expect(item.locator(".mk-faq-question")).toBeVisible();
      await expect(item.locator(".mk-faq-answer")).toBeVisible();
    }
    const versions = await page.locator('[data-fact="version"]').allTextContents();
    expect(versions.length).toBeGreaterThanOrEqual(3);
    for (const text of versions) expect(text).toBe(`v${manifest.version}`);
    for (const text of await page.locator('[data-fact="gzip"]').allTextContents()) expect(text).toBe(`${(manifest.esm.gzip / 1000).toFixed(1)} kB`);
  });

  test("version badges show npm's latest version from jsDelivr, and keep the build's version when it fails", async ({ page }) => {
    const badges = page.locator('[data-fact="version"]');
    await page.route(LATEST, (route) => route.fulfill(answer("9.9.9")));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-version", "9.9.9");
    for (const badge of await badges.all()) await expect(badge).toHaveText("v9.9.9");
    await page.route(LATEST, (route) => route.fulfill({ status: 503, body: "down", headers: { "access-control-allow-origin": "*" } }));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
    await expect(page.locator("html")).not.toHaveAttribute("data-version", /./);
    for (const badge of await badges.all()) await expect(badge).toHaveText(`v${manifest.version}`);
    // the 503 is the case under test, not a defect of the page; the browser also logs it to the console
    errors.splice(0, errors.length, ...errors.filter((error) => !/data\.jsdelivr\.com|status of 503/.test(error)));
  });

  test("Benchmarks: one table per runtime and the coverage rings show the recorded figures", async ({ page }) => {
    const numbers = page.locator("#numbers");
    for (const runtime of ["node", "bun", "chromium", "webkit"]) {
      const run = bench[runtime];
      await numbers.locator(`#bench-tab-${runtime}`).click();
      const panel = numbers.locator(`#bench-panel-${runtime}`);
      await expect(panel).toBeVisible();
      const rows = panel.locator("tbody tr:not(.dz-group)");
      await expect(rows).toHaveCount(run.results.length);
      for (const [i, result] of run.results.entries()) {
        await expect(rows.nth(i).locator("th")).toHaveText(result.operation);
        await expect(rows.nth(i).locator("td").nth(0)).toHaveText(`${result.medianMs.toFixed(1)} ms`);
        await expect(rows.nth(i).locator("td").nth(1)).toHaveText(result.peakRssMB === null ? "–" : `${result.peakRssMB} MB`);
      }
    }
    const rings = numbers.locator(".radial-progress");
    await expect(rings).toHaveCount(4);
    for (const [i, key] of ["lines", "branches", "functions", "statements"].entries())
      await expect(rings.nth(i)).toHaveAttribute("aria-valuenow", String(coverage[key]));
    await expect(numbers.locator('[data-fact="tests"]')).toHaveText(coverage.tests.toLocaleString("en"));
  });

  test("JSON vs DSON: DSON keeps every row, JSON none", async ({ page }) => {
    const rows = page.locator("#compare-rows tr");
    await expect(rows).toHaveCount(14);
    for (let i = 0; i < 14; i++) {
      await expect(rows.nth(i).locator("td").nth(0)).toHaveAttribute("data-kept", "false");
      await expect(rows.nth(i).locator("td").nth(1)).toHaveAttribute("data-kept", "true");
    }
  });

  test("binary section explains both entries, links their evidence and fits both themes and a phone", async ({ page }, testInfo) => {
    await expect(page.locator("html")).toHaveAttribute("data-highlighted", "true");
    await page.locator('.nav-menu-link[href="#binary"]').click();
    const section = page.locator("#binary");
    await expect(section.locator("h2")).toBeVisible();
    await expect(section.locator("article")).toHaveCount(2);
    await expect(section.locator("dt")).toHaveText(["Strict values", "Independent frames", "Incremental input"]);
    await expect(section.locator('a[href$="documentation/binary.md"]')).toBeVisible();
    const report = await page.request.get("/data/binary-bench.json");
    expect(report.ok()).toBe(true);
    expect(Object.keys(await report.json()).sort()).toEqual(["bun", "chromium", "node", "webkit"]);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const dark of [false, true]) {
        if (await page.locator("#theme-toggle").isChecked() !== dark) await page.locator(".swap").click();
        await section.scrollIntoViewIfNeeded();
        for (const article of await section.locator("article").all()) {
          await expect(article.locator("h3")).toBeVisible();
          expect(await article.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await section.screenshot({ path: testInfo.outputPath(`binary-${width}-${dark ? "dark" : "light"}.png`), animations: "disabled" });
      }
    }
  });

  test("playground runs every preset and prints what each states", async ({ page }) => {
    for (const example of examples.filter((entry) => entry.kind === "preset")) {
      const id = example.name.slice("preset:".length);
      await page.selectOption("#pg-preset", id);
      await expect(page.locator("#pg-console")).toHaveText(example.expected.join("\n"));
      await expect(page.locator("#pg-error")).toBeHidden();
      await expect(page.locator("#pg-equal")).toHaveText("round trip: equal");
      await page.locator("#pg-tab-records").click();
      expect(await page.locator("#pg-records tr").count()).toBeGreaterThan(0);
      await page.locator("#pg-tab-console").click();
    }
  });

  test("playground shows the records, the parsed value and JSON's result", async ({ page }) => {
    await page.selectOption("#pg-preset", "numbers");
    await page.locator("#pg-tab-text").click();
    await expect(page.locator("#pg-text")).toContainText('[9,"NaN"]');
    await page.locator("#pg-tab-records").click();
    await expect(page.locator("#pg-records")).toContainText("9 · NUMBER");
    await page.locator("#pg-tab-decoded").click();
    await expect(page.locator("#pg-decoded")).toHaveText("{ nan: NaN, negativeZero: -0, infinity: Infinity, missing: undefined }");
    await page.locator("#pg-tab-json").click();
    await expect(page.locator("#pg-json")).toHaveText('{"nan":null,"negativeZero":0,"infinity":null}');
  });

  test("playground reports errors from the visitor's code and recovers", async ({ page }) => {
    await page.fill("#pg-code", 'throw new RangeError("boom");');
    await expect(page.locator("#pg-error")).toBeVisible();
    await expect(page.locator("#pg-error-text")).toHaveText("RangeError: boom");
    await page.fill("#pg-code", "return new Map([[1, 2]]);");
    await expect(page.locator("#pg-error")).toBeHidden();
    await page.locator("#pg-tab-decoded").click();
    await expect(page.locator("#pg-decoded")).toHaveText("Map(1) { 1 => 2 }");
  });

  test("Shiki highlights every code block without changing its text", async ({ page }) => {
    await expect(page.locator("html")).toHaveAttribute("data-highlighted", "true");
    const blocks = page.locator(".mk-code-block pre > code");
    expect(await blocks.count()).toBe(7);
    for (let i = 0; i < 7; i++) {
      const block = blocks.nth(i);
      await expect(block.locator("xpath=..")).toHaveAttribute("data-lang", /^(javascript|html|shellscript)$/);
      await expect(block).toHaveAttribute("data-shiki", "true");
      expect(await block.locator('span[style*="--shiki-dark"]').count()).toBeGreaterThan(0);
      const [text, source] = await block.evaluate((code: HTMLElement) => [code.textContent, code.dataset.source!.replaceAll("\n", "")]);
      expect(text).toBe(source);
    }
    // the CLI blocks are shell code: the command is a token of its own colour
    const cli = page.locator('pre[data-tab="bun"] code span[style]').first();
    await expect(cli).toHaveText("bun");
  });

  test("the editor paints highlighted code exactly under the textarea", async ({ page }) => {
    const layer = page.locator("#pg-highlight");
    await expect(layer).toHaveAttribute("data-shiki", "true");
    const value = await page.locator("#pg-code").inputValue();
    expect(await layer.textContent()).toBe(`${value}\n`);
    await page.locator("#pg-code").fill('const label = "typed";\nreturn label;');
    await expect(layer).toHaveText('const label = "typed";\nreturn label;\n');
    await expect(layer.locator("span", { hasText: '"typed"' })).toHaveAttribute("style", /--shiki-light/);
    const boxes = await page.evaluate(() => {
      const metrics = (node: Element) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return [rect.x, rect.y, rect.width, rect.height, style.fontSize, style.lineHeight, style.paddingTop, style.paddingLeft, style.borderTopWidth, style.fontFamily];
      };
      return [metrics(document.getElementById("pg-code")!), metrics(document.querySelector(".dz-editor-layer")!)];
    });
    expect(boxes[1]).toEqual(boxes[0]);
    // the textarea's own glyphs are invisible; only the layer paints text
    expect(await page.locator("#pg-code").evaluate((node) => getComputedStyle(node).color)).toBe("rgba(0, 0, 0, 0)");
  });

  test("token colours follow dark mode, and the output panes are highlighted", async ({ page }) => {
    const keyword = page.locator("#pg-highlight span", { hasText: /^const$/ }).first();
    const light = await keyword.evaluate((node) => getComputedStyle(node).color);
    await page.locator(".swap").click();
    await expect.poll(() => keyword.evaluate((node) => getComputedStyle(node).color)).not.toBe(light);
    await page.locator("#pg-tab-text").click();
    await expect(page.locator("#pg-text")).toHaveAttribute("data-shiki", "true");
    expect(await page.locator('#pg-text span[style*="--shiki"]').count()).toBeGreaterThan(0);
  });

  test("How it works: badge labels, step icons and the animated diagram", async ({ page }) => {
    await expect(page.locator(".dz-eyebrow")).toHaveCount(7);
    for (const badge of await page.locator(".dz-eyebrow").all()) await expect(badge.locator("svg")).toHaveCount(1);
    await expect(page.locator(".dz-steps .dz-step-icon svg")).toHaveCount(4);
    const flow = page.locator("#dz-flow");
    await flow.scrollIntoViewIfNeeded();
    await expect(flow.locator(".diagram-controls")).toBeVisible();
    await flow.locator('.diagram-controls [data-action="prev"]').waitFor();
    await flow.evaluate((figure: any) => figure.api.setState("paused", { step: 2 }));
    await expect(flow).toHaveAttribute("data-step-current", "2");
    await flow.evaluate((figure: any) => figure.api.setState("default"));
    await expect(flow).not.toHaveAttribute("data-step-current", /.*/);
    await expect(flow.locator(".diagram-node")).toHaveCount(8);
    for (const node of await flow.locator(".diagram-node").all()) await expect(node).toBeVisible();
    // the wires are drawn from the edge list: one path per edge at least
    expect(await flow.locator("svg path").count()).toBeGreaterThanOrEqual(7);
  });

  test("a preset can be linked with ?example=", async ({ page }) => {
    await page.goto("/?example=cycles");
    await expect(page.locator("#pg-preset")).toHaveValue("cycles");
  });

  test("the theme switch toggles dark mode and remembers it", async ({ page }) => {
    const dark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));
    const before = await dark();
    await page.locator(".swap").click();
    expect(await dark()).toBe(!before);
    await page.reload();
    expect(await dark()).toBe(!before);
  });

  test("copy buttons copy the code exactly as shown", async ({ page, context, browserName }) => {
    // VERIFIED: Playwright grants clipboard permissions only in Chromium; WebKit runs every other test.
    test.skip(browserName !== "chromium", "clipboard permissions are Chromium-only in Playwright");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const figure = page.locator("figure.mk-code-block", { hasText: "session.js" });
    await figure.locator(".mk-code-block-copy").click();
    await expect(figure.locator(".mk-code-block-status")).toHaveText("Copied");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(await figure.locator("code").getAttribute("data-source"));
    for (const binary of await page.locator("#binary figure.mk-code-block").all()) {
      await binary.locator(".mk-code-block-copy").click();
      await expect(binary.locator(".mk-code-block-status")).toHaveText("Copied");
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await binary.locator("code").getAttribute("data-source"));
    }
    const install = page.locator("figure.mk-code-block", { hasText: "bun add defuss-dson" });
    await install.locator(".mk-code-block-copy").click();
    await expect(install.locator(".mk-code-block-status")).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("bun add defuss-dson");
    await install.locator(".mk-code-block-tabs label", { hasText: "npm" }).click();
    await install.locator(".mk-code-block-copy").click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("npm install defuss-dson");
    await page.locator("#copy-prompt").click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("https://github.com/kyr0/defuss-dson");
  });

  test("fits a phone screen and opens the menu", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    // the diagram switches to two columns instead of scrolling inside its figure
    const flow = page.locator("#dz-flow");
    await flow.scrollIntoViewIfNeeded();
    await expect.poll(() => flow.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(0);
    await page.locator(".mk-header-menu").click();
    await expect(page.locator("#dz-menu")).toBeVisible();
    await page.locator('#dz-menu a[href="#binary"]').click();
    await expect(page.locator("#dz-menu")).toBeHidden();
    await expect(page.locator("#binary h2")).toBeVisible();
  });
});
