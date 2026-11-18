import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPointStrokes } from './point-strokes.mjs';

const base = Float32Array.from([
  0, 0, 0, 0, 0, 0, // UV seam copies of the same nose vertex
  0.2, 0, 0, 1, 0, 0,
]);
const template = Uint32Array.from([0, 0, 1, 2]);
const mask = Float32Array.from([1, 0.5, 0]);

test('코 제어점은 같은 위치의 UV 경계를 함께 움직이고 코 밖은 보존한다', () => {
  const original = base.slice();
  const edited = applyPointStrokes(base, template, mask, [{ vertex: 0, delta: [0, 0.01, 0] }]);
  assert.equal(edited[1], edited[4]);
  assert.ok(edited[1] > 0);
  assert.equal(edited[10], 0);
  assert.deepEqual(base, original);
});

test('코 밖 앵커와 과도한 이동은 거절한다', () => {
  assert.throws(() => applyPointStrokes(base, template, mask, [{ vertex: 2, delta: [0, 0.01, 0] }]), /outside nose/);
  assert.throws(() => applyPointStrokes(base, template, mask, [{ vertex: 0, delta: [0, 0.011, 0] }]), /invalid point stroke/);
  assert.throws(() => applyPointStrokes(base, template, mask, [{ vertex: 0, delta: [0, 0, 0] }]), /invalid point stroke/);
});
