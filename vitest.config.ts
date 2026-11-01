import { defineConfig } from "vitest/config";

// Unit tests import src/ directly; the e2e suite (vitest.e2e.config.ts, Playwright) consumes the packed tarball.
// The same suite runs on Node.js (`vitest run`) and on Bun (`bun --bun vitest run`).
// VERIFIED: with --bun the workers run in Bun; a probe test printed process.versions.bun 1.4.3.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globals: true,
    // tests.json gives the website its test count (scripts/site.mjs), next to the coverage summary below
    reporters: ["default", ["json", { outputFile: "coverage/tests.json" }]],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.fixture.ts"],
      // skipFull: false keeps the `All files` row at 100 %, which the defuss-vae gate reads.
      reporter: [["text", { skipFull: false }], "json-summary"],
      reportsDirectory: "coverage",
      // 100 % is the measured state; a lower floor would let untested code in unnoticed.
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
