import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { asModule, collectExamples, type Example } from "./examples.js";
import { consumer, RUNTIMES } from "./consumer.js";

// Every published example runs as written against the installed tarball, in Node.js and in Bun, and must print
// exactly what its `// <output>` comments state. The browser half of the same list runs in e2e/site.spec.ts.
const examples = await collectExamples();
const work = join(consumer, "examples");

beforeAll(async () => {
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
});

describe("published examples", () => {
  it("are found in every source, so a broken extractor cannot pass silently", () => {
    const count = (prefix: string) => examples.filter((example) => example.name.startsWith(prefix)).length;
    expect(count("README.md#")).toBeGreaterThanOrEqual(6);
    expect(count("documentation/format.md#")).toBeGreaterThanOrEqual(2);
    expect(count("docs/index.html#")).toBe(5);
    expect(count("preset:")).toBe(10);
    for (const example of examples) expect(example.expected.length, `${example.name} states no output`).toBeGreaterThan(0);
  });

  for (const runtime of RUNTIMES) {
    describe(`on ${runtime.name}`, () => {
      it.each(examples.map((example): [string, Example] => [example.name, example]))("%s", async (name, example) => {
        const file = join(work, `${name.replace(/[^\w]+/g, "-")}-${runtime.name}.${example.typescript ? "mts" : "mjs"}`);
        await writeFile(file, asModule(example));
        const output = execFileSync(runtime.command, [...runtime.args, file], { cwd: consumer, encoding: "utf8" }).trimEnd();
        expect(output ? output.split("\n") : [], `${name} on ${runtime.name}:\n${example.code}`).toEqual(example.expected);
      });
    });
  }
});
