// The binary value format's fixed lists and its table walk, shared by the encoder and the decoder. Internal module.
import { invalid } from "./binary-io.js";

// These positions are wire subtypes, including the optional Float16Array slot.
const VIEW_NAMES = ["DataView", "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
  "Int32Array", "Uint32Array", "Float16Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array"] as const;
export const VIEWS = VIEW_NAMES.map((name) => (globalThis as any)[name]);
export const ERRORS = [Error, EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError, AggregateError];
export const BOXES = [Boolean, Number, String, BigInt];
export const ERROR_LOCATION = new Set(["stack", "line", "column", "sourceURL", "originalLine", "originalColumn"]);
export const BYTE_ORDER = new Uint8Array(new Uint16Array([1]).buffer)[0];
export const MAGIC = [68, 83, 66, 1];

/**
 * Explicit DFS bounds first visits, so cycles do not make depth infinite. Also rejects unreachable table entries.
 * Entry i lists its members as refs[starts[i]] to refs[starts[i + 1] - 1]; `starts` ends with refs.length.
 * The stack lives in three typed arrays instead of one object per frame: a frame either belongs to a first visit,
 * which happens once per entry, or is popped on the next turn, so count + 1 slots always suffice. Why: the object per
 * frame and the Set made this check a tenth of encodeFrame's time on an index page.
 * VERIFIED: (cpu profile, 2026-11-16, Node.js 26) checkGraph had 10 % of the self time after the Writer fix.
 */
export const checkGraph = (count: number, starts: number[], refs: number[], maxDepth: number): void => {
  const seen = new Uint8Array(count);
  const ids = new Int32Array(count + 1);
  const depths = new Int32Array(count + 1);
  const next = new Int32Array(count + 1).fill(-1);
  let visited = 0;
  let top = 0;
  while (top >= 0) {
    const id = ids[top];
    if (next[top] === -1) {
      if (seen[id]) { top--; continue; }
      if (depths[top] > maxDepth) throw new RangeError("DSON binary: maxDepth exceeded");
      seen[id] = 1;
      visited++;
      next[top] = 0;
    }
    if (next[top] === starts[id + 1] - starts[id]) { top--; continue; }
    const child = refs[starts[id] + next[top]++];
    top++;
    ids[top] = child;
    depths[top] = depths[top - 1] + 1;
    next[top] = -1;
  }
  if (visited !== count) invalid("unreachable value table entry");
};
