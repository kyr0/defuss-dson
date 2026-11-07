import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { consumer, RUNTIMES, tarball } from "./consumer.js";

// The published artifact as a user gets it: the tarball's contents, both module systems in both server runtimes,
// and the type declarations under the strictest module resolution.
const root = fileURLToPath(new URL("../", import.meta.url));
const installed = join(consumer, "node_modules/defuss-dson");
const run = (command: string, args: string[]) =>
  execFileSync(command, args, { cwd: consumer, encoding: "utf8" }).trim();

describe("tarball", () => {
  it("holds package.json, README.md, LICENSE and the three standalone entry builds, nothing else", () => {
    const files = run("tar", ["-tzf", tarball]).split("\n").map((file) => file.replace(/^package\//, "")).sort();
    expect(files).toEqual([
      "LICENSE",
      "README.md",
      ...["binary", "index", "sequence"].flatMap(name => ["cjs", "d.cts", "d.mts", "mjs"].map(ext => `dist/${name}.${ext}`)),
      "package.json",
    ]);
  });

  it("has no runtime dependencies and every export target exists", async () => {
    const manifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
    expect(manifest.dependencies ?? {}).toEqual({});
    const targets = JSON.stringify(manifest.exports).match(/\.\/dist\/[^"]+/g)!;
    expect(targets.length).toBe(12);
    for (const target of targets) await readFile(join(installed, target));
  });
});

describe.each(RUNTIMES)("on $name", (runtime) => {
  it("consumes both optional codecs through ESM and CommonJS", async () => {
    const matrix = await readFile(join(root, "e2e/fixtures/binary-matrix.mjs"), "utf8");
    await writeFile(join(consumer, "binary-matrix.mjs"), matrix);
    await writeFile(join(consumer, "binary-matrix.cjs"), matrix.replace(/import (\{[^\n]+\}) from ('[^']+');/g, "const $1 = require($2);"));
    for (const file of ["binary-matrix.mjs", "binary-matrix.cjs"])
      expect(run(runtime.command, [...runtime.args, file])).toMatch(/^binary matrix ok: \d+ checks$/);
  });
  it("passes the type matrix through the ESM entry", async () => {
    await copyFile(join(root, "e2e/fixtures/matrix.mjs"), join(consumer, "matrix.mjs"));
    expect(run(runtime.command, [...runtime.args, "matrix.mjs"])).toMatch(/^matrix ok: \d+ checks$/);
  });

  it("loads through require() with the same API", async () => {
    await writeFile(
      join(consumer, "require.cjs"),
      `const { DSON } = require("defuss-dson");
const back = DSON.parse(DSON.stringify({ when: new Date(0), big: 1n, set: new Set([1]) }));
if (!(back.when instanceof Date) || back.big !== 1n || !back.set.has(1)) throw new Error("CommonJS round trip failed");
console.log(Object.keys(DSON).join(","));
`,
    );
    expect(run(runtime.command, [...runtime.args, "require.cjs"])).toBe("parse,stringify,isEqual,clone");
  });
});

describe("type declarations", () => {
  it("type-check from ESM and CommonJS consumers under nodenext resolution", async () => {
    const source = `import { DSON, type DSONOptions } from "defuss-dson";
const copy: Map<string, number> = DSON.clone(new Map([["a", 1]]));
const options: DSONOptions = { maxDepth: 1_000 };
const text: string = DSON.stringify(copy, options);
import { encode, decode, type BinaryOptions } from "defuss-dson/binary";
import { encodeFrame, inspectFrame, decodeFrame, SequenceDecoder, type FrameMetadata, type SequenceRecord } from "defuss-dson/sequence";
const binaryOptions: BinaryOptions = { maxRecordBytes: 1000, maxDepth: 20, maxReferences: 100 };
const bytes: Uint8Array = encode(copy, binaryOptions);
const decoded: unknown = decode(bytes, binaryOptions);
const frame: Uint8Array = encodeFrame(decoded, binaryOptions);
const meta: FrameMetadata = inspectFrame(frame);
const record: FrameMetadata = decodeFrame(frame, meta.offset);
const sequence = new SequenceDecoder({ ...binaryOptions, startOffset: record.offset });
const records: SequenceRecord[] = sequence.push(frame);
sequence.finish();
export const offset: number = records[0].offset;
// @ts-expect-error decode accepts bytes
decode("text");
// @ts-expect-error startOffset is a number
new SequenceDecoder({ startOffset: "zero" });
export const equal: boolean = DSON.isEqual(copy, DSON.parse(text), options);
// @ts-expect-error parse() takes DSON text
DSON.parse(42);
// @ts-expect-error maxDepth is a number
DSON.stringify(copy, { maxDepth: "deep" });
`;
    await writeFile(join(consumer, "types.mts"), source);
    await writeFile(join(consumer, "types.cts"), source);
    await writeFile(
      join(consumer, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { module: "nodenext", moduleResolution: "nodenext", strict: true, noEmit: true, types: [] },
        files: ["types.mts", "types.cts"],
      }),
    );
    run(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"]);
  });
});
