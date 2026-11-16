import { Reader, limits, type BinaryOptions, type EncodeOptions } from "./binary-io.js";
import { encodeInto } from "./binary-encode.js";
import { decodeValue } from "./binary-decode.js";
export type { BinaryOptions, EncodeOptions } from "./binary-io.js";

/** Encode one strict value graph. No toJSON calls, global settings, or I/O. */
export const encode = (value: unknown, options: EncodeOptions = {}): Uint8Array => encodeInto(value, options, 0);

/** Decode exactly one value. Trailing bytes, unsupported tags and invalid references fail explicitly. */
export const decode = (bytes: Uint8Array, options: BinaryOptions = {}): any => {
  const bound = limits(options);
  return decodeValue(new Reader(bytes), bound);
};
