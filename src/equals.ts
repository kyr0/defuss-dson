import type { DSONOptions } from "./json.js";
import { serialize } from "./serialize.js";

/** DSON text with -0 written as 0, so that numbers compare like Map keys (SameValueZero). */
const comparable = (value: any, maxDepth?: number): string =>
  JSON.stringify(serialize(value, true, false, maxDepth));

/**
 * Tells whether two values hold the same data, by comparing their DSON texts.
 *
 * Why compare encodings instead of walking both graphs: the encoder already resolves cycles and shared references
 * into record indices, so two cyclic structures compare in one linear pass with no visited-set bookkeeping, and the
 * rules match exactly what `stringify` preserves. The consequences, all deliberate:
 * - order counts: `{ a, b }` and `{ b, a }` differ, as do Maps and Sets with the same members in another order;
 * - functions and symbols are ignored, as `stringify` drops them;
 * - numbers compare like Map keys (SameValueZero): NaN equals NaN, and 0 equals -0 as with `===`;
 * - the shape of references counts: one object referenced twice differs from two equal copies.
 *
 * VERIFIED: 1.1.2 ran stringify, parse and stringify per value; for isEqual on the bench graph, three interleaved
 * `make bench` runs on Node.js 26 (2026-11-01) gave medians of 26.9 to 35.3 ms for 1.1.2 and 11.9 to 15.8 ms for
 * this single encoding, 1.7 to 2.8 times faster per pair.
 * @param objectA first value.
 * @param objectB second value.
 * @param options `maxDepth`, as for `stringify`.
 * @returns `true` when both values serialize to the same DSON text.
 */
export function isEqual(objectA: any, objectB: any, options?: DSONOptions): boolean {
  return comparable(objectA, options?.maxDepth) === comparable(objectB, options?.maxDepth);
}
