import { encode, decode } from 'defuss-dson/binary';
import { encodeFrame, inspectFrame, decodeFrame, SequenceDecoder, FRAME_HEADER_BYTES } from 'defuss-dson/sequence';

let checks = 0;
const assert = (condition) => { if (!condition) throw new Error(`binary matrix failed at ${checks}`); checks++; };
const reject = (run) => { let threw = false; try { run(); } catch { threw = true; } assert(threw); };
const buffer = new ArrayBuffer(32);
const root = { buffer, view: new Float64Array(buffer, 8, 2), data: new DataView(buffer, 1, 7), map: new Map(), set: new Set(),
  date: new Date(0), badDate: new Date(NaN), regex: /a/gi, values: [undefined, NaN, -0, Infinity, -Infinity, 12n, '\ud800\n😀'],
  boxes: [Object(true), Object(-0), Object('x'), Object(1n)], error: new TypeError('bad', { cause: { id: 1 } }) };
root.view[0] = -0; root.view[1] = NaN; root.self = root; root.map.set(root, root.view); root.set.add(root);
Object.defineProperty(root, '__proto__', { value: root, enumerable: true });
const bytes = encode(root); const back = decode(bytes);
assert(back.self === back && back.__proto__ === back && Object.getPrototypeOf(back) === Object.prototype);
assert(back.view.buffer === back.buffer && back.data.buffer === back.buffer && back.view.byteOffset === 8);
assert(Object.is(back.view[0], -0) && Number.isNaN(back.view[1]));
assert(back.map.get(back) === back.view && back.set.has(back));
assert(back.date.getTime() === 0 && Number.isNaN(back.badDate.getTime()) && back.regex.flags === 'gi');
assert(back.values.every((value, i) => Object.is(value, root.values[i])));
assert(back.boxes.every((value, i) => Object.is(value.valueOf(), root.boxes[i].valueOf())));
assert(back.error instanceof TypeError && back.error.cause.id === 1);
for (const value of [() => 1, Symbol(), new WeakMap(), { toJSON() { throw new Error('must not run'); } }]) reject(() => encode(value));
const frames = [encodeFrame(root), encodeFrame({ id: 'second' })];
const sequence = new Uint8Array(frames[0].length + frames[1].length); sequence.set(frames[0]); sequence.set(frames[1], frames[0].length);
assert(FRAME_HEADER_BYTES === 16 && inspectFrame(sequence).byteLength === frames[0].length);
assert(decodeFrame(sequence, frames[0].length).value.id === 'second');
for (let split = 0; split <= sequence.length; split++) {
  const decoder = new SequenceDecoder();
  const records = [...decoder.push(sequence.subarray(0, split)), ...decoder.push(sequence.subarray(split))]; decoder.finish();
  assert(records.length === 2 && records[1].offset === frames[0].length && records[1].index === 1);
  assert(records[0].value.self === records[0].value);
}
const small = encodeFrame(null);
for (let end = 1; end < small.length; end++) {
  const decoder = new SequenceDecoder(); assert(decoder.push(small.subarray(0, end)).length === 0); reject(() => decoder.finish());
}
for (let position = 0; position < small.length; position++) {
  const damaged = small.slice(); damaged[position] ^= 1; reject(() => decodeFrame(damaged));
}
reject(() => decode(bytes, { maxReferences: 1 })); reject(() => decode(bytes, { maxDepth: 0 }));
reject(() => new SequenceDecoder({ maxRecordBytes: 8 }).push(small));
if (typeof Buffer !== 'undefined') {
  const input = Buffer.from(encodeFrame(new Uint8Array([1, 2, 3]).buffer));
  const direct = decodeFrame(input).value; const streamed = new SequenceDecoder().push(input)[0].value;
  input.fill(255);
  assert(direct.byteLength === 3 && streamed.byteLength === 3);
  assert(new Uint8Array(direct)[0] === 1 && new Uint8Array(streamed)[2] === 3);
}
console.log(`binary matrix ok: ${checks} checks`);
