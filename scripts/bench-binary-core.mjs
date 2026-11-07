import { DSON } from '../dist/index.mjs';
import { encode, decode } from '../dist/binary.mjs';
import { encodeFrame, inspectFrame, decodeFrame, SequenceDecoder } from '../dist/sequence.mjs';

export const RECORDS = 256;
export const SAMPLES = 9;
export function prepare() {
  const records = Array.from({ length: RECORDS }, (_, id) => {
    const record = { id, key: `record-${id}`, at: new Date(id * 86400000), tags: new Set(['a', 'b']),
      data: new Uint8Array(256).fill(id), scores: new Float64Array([id / 3, -0, NaN]) };
    record.self = record;
    return record;
  });
  const binary = encode(records);
  const text = DSON.stringify(records);
  const textBytes = new TextEncoder().encode(text).length;
  const frames = records.map(record => encodeFrame(record));
  const sequence = new Uint8Array(frames.reduce((sum, frame) => sum + frame.length, 0));
  let offset = 0;
  const offsets = []; const keys = new Map();
  for (const [index, frame] of frames.entries()) {
    offsets.push(offset); keys.set(records[index].key, offset); sequence.set(frame, offset); offset += frame.length;
  }
  const target = Math.floor(RECORDS * 3 / 4);
  const targetKey = records[target].key;
  const scan = () => { const decoder = new SequenceDecoder(); const result = decoder.push(sequence); decoder.finish(); return result; };
  const operations = [
    { name: 'text.encode', bytes: textBytes, run: () => DSON.stringify(records) },
    { name: 'text.decode', bytes: textBytes, run: () => DSON.parse(text) },
    { name: 'binary.encode', bytes: binary.length, run: () => encode(records) },
    { name: 'binary.decode', bytes: binary.length, run: () => decode(binary) },
    { name: 'sequence.encode', bytes: sequence.length, run: () => records.map(record => encodeFrame(record)) },
    { name: 'sequence.scan', bytes: sequence.length, run: scan },
    { name: 'index.ordinal.build', bytes: sequence.length, run: () => {
      const result = []; let offset = 0;
      while (offset < sequence.length) { result.push(offset); offset += inspectFrame(sequence, offset).byteLength; }
      return result;
    } },
    { name: 'index.key.build', bytes: sequence.length, run: () => new Map(scan().map(record => [record.value.key, record.offset])) },
    { name: 'lookup.ordinal', bytes: frames[target].length, run: () => decodeFrame(sequence, offsets[target]).value },
    { name: 'lookup.key', bytes: frames[target].length, run: () => decodeFrame(sequence, keys.get(targetKey)).value },
    { name: 'lookup.linear', bytes: offsets[target] + frames[target].length, run: () => {
      let offset = 0;
      while (offset < sequence.length) {
        const record = decodeFrame(sequence, offset);
        if (record.value.key === targetKey) return record.value;
        offset += record.byteLength;
      }
    } },
  ];
  return { operations, sizes: { textBytes, binaryBytes: binary.length, sequenceBytes: sequence.length,
    frameHeaderBytes: RECORDS * 16, ordinalUint64IndexBytes: RECORDS * 8 }, target };
}

export function measure(prepared) {
  return prepared.operations.map(({ name, bytes, run }) => {
    for (let i = 0; i < 3; i++) run();
    const start = performance.now(); run();
    const batch = Math.min(1000, Math.max(1, Math.ceil(10 / Math.max(0.01, performance.now() - start))));
    const samples = [];
    for (let i = 0; i < SAMPLES; i++) {
      const start = performance.now();
      for (let j = 0; j < batch; j++) run();
      samples.push((performance.now() - start) / batch);
    }
    samples.sort((a, b) => a - b);
    const medianMs = samples[SAMPLES >> 1];
    return { operation: name, medianMs, operationsPerSecond: 1000 / medianMs, encodedMBPerSecond: bytes / medianMs / 1000 };
  });
}
