// CRC32C (Castagnoli) of the sequence frames. Internal module: not a package entry, so not public API.

/**
 * CRC32C tables for slicing-by-16: table k holds the CRC of a byte followed by k zero bytes, so sixteen independent
 * table lookups consume sixteen input bytes per step. Why not the plain one-table loop: each step there waits for the
 * previous one and handles one byte, and checksums cover every payload byte on both encode and decode. Why not 32-bit
 * word reads: faster on V8 but slower on JavaScriptCore, and they would depend on the platform's byte order.
 * VERIFIED: (probe, 2026-11-16) a 6 kB index page took 14.5 µs one byte at a time, 5.1 µs by 8 and 3.3 µs by 16 on
 * Node.js 26 (Bun 1.4: 12.2, 3.05, 2.6 µs); word reads took 2.9 µs on Node.js and 3.45 µs on Bun.
 * Why Int32Array instead of Uint32Array: half the entries are 2^31 or more, which a Uint32Array returns as numbers
 * outside the int32 range; JavaScriptCore then sometimes ran the loop with floating-point values for the whole
 * process. XOR and shifts only need the 32 bits, which an Int32Array holds as they are.
 * VERIFIED: (probe, 2026-11-16, Bun 1.4) with Uint32Array, 3 of 10 processes took 72-74 µs instead of 24-25 µs per
 * page, with checksum at 54 % of the time; with Int32Array, 12 of 12 took 20-24 µs. Node.js 26 measured the same.
 * src/sequence.test.ts checks this function against the one-byte definition and the standard check value.
 */
const CRC = new Int32Array(16 * 256);
for (let n = 0; n < 256; n++) {
  let crc = n;
  for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) * 0x82f63b78);
  CRC[n] = crc;
}
for (let n = 0; n < 256; n++)
  for (let k = 1; k < 16; k++) CRC[k * 256 + n] = (CRC[(k - 1) * 256 + n] >>> 8) ^ CRC[CRC[(k - 1) * 256 + n] & 255];

/** CRC32C of `bytes`, as the frame header stores it. */
export const checksum = (bytes: Uint8Array): number => {
  let crc = -1;
  let i = 0;
  const end = bytes.length - 15;
  for (; i < end; i += 16) {
    const low = crc ^ (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24));
    crc = CRC[3840 + (low & 255)] ^ CRC[3584 + ((low >>> 8) & 255)] ^ CRC[3328 + ((low >>> 16) & 255)] ^
      CRC[3072 + (low >>> 24)] ^ CRC[2816 + bytes[i + 4]] ^ CRC[2560 + bytes[i + 5]] ^ CRC[2304 + bytes[i + 6]] ^
      CRC[2048 + bytes[i + 7]] ^ CRC[1792 + bytes[i + 8]] ^ CRC[1536 + bytes[i + 9]] ^ CRC[1280 + bytes[i + 10]] ^
      CRC[1024 + bytes[i + 11]] ^ CRC[768 + bytes[i + 12]] ^ CRC[512 + bytes[i + 13]] ^ CRC[256 + bytes[i + 14]] ^
      CRC[bytes[i + 15]];
  }
  for (; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC[(crc ^ bytes[i]) & 255];
  return ~crc >>> 0;
};
