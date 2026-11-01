import { defineConfig } from "vitest/config";

// Node-side e2e: the tarball, both module systems and every documented code example, run against the package that
// scripts/e2e.mjs packed and installed into a clean consumer (DSON_CONSUMER). Never imports src/.
// VERIFIED: e2e/consumer.ts throws without that consumer, so this suite cannot fall back to the source tree.
export default defineConfig({
  test: {
    include: ["e2e/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
