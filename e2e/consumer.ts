import { existsSync } from "node:fs";

/**
 * The clean consumer project scripts/e2e.mjs creates: the packed tarball installed with `bun add`, nothing else.
 * Tests that run without it would test the source tree, which is what this suite must never do.
 * VERIFIED: importing this module throws unless DSON_CONSUMER holds an installed defuss-dson.
 */
export const consumer = process.env.DSON_CONSUMER ?? "";
if (!consumer || !existsSync(`${consumer}/node_modules/defuss-dson/package.json`)) {
  throw new Error("DSON_CONSUMER is not an installed consumer; run the e2e suite through `make e2e`");
}
export const tarball = process.env.DSON_TARBALL ?? "";

/** The two server-side runtimes the package supports; both run every e2e program. */
export const RUNTIMES = [
  { name: "node", command: process.env.NODE_BINARY ?? "node", args: ["--no-warnings"] },
  { name: "bun", command: process.env.BUN_BINARY ?? "bun", args: [] },
] as const;
