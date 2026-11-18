import test from 'node:test';
import assert from 'node:assert/strict';
import { scanComposedMesh, scanContourDirection, scanWeightShape } from './audit_weight_shape.mjs';

const square = {
  base: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
  negative: [0, 0, 0, -0.05, 0, 0, -0.05, 0, 0, 0, 0, 0],
  positive: [0, 0, 0, 0.05, 0, 0, 0.05, 0, 0, 0, 0, 0],
  index: [0, 1, 2, 0, 2, 3],
  template: [0, 1, 2, 3],
  regions: { left_eye: [0], right_eye: [0], upper_lip: [3], lower_lip: [3], nose_region: [0], ears: [3] },
};

test('safe reversible shape gets both directions', () => {
  const result = scanWeightShape(square);
  assert.equal(result.eligible, true);
  assert.equal(result.negativeLimit, 1);
  assert.equal(result.positiveLimit, 1);
});

test('missing protected regions and motion into a protected part stay locked', () => {
  assert.equal(scanWeightShape({ ...square, regions: {} }).eligible, false);
  const negative = [...square.negative];
  negative[0] = 0.1;
  assert.equal(scanWeightShape({ ...square, negative }).eligible, false);
  assert.equal(scanWeightShape({ ...square, positive: [NaN, ...square.positive.slice(1)] }).eligible, false);
});

test('unsafe later geometry narrows the model-specific positive end', () => {
  const positive = [...square.positive];
  positive[6] = -3;
  const result = scanWeightShape({ ...square, positive });
  assert.equal(result.eligible, true);
  assert.ok(result.positiveLimit > 0 && result.positiveLimit < 1);
  assert.ok(result.positiveReason);
});

test('윤곽과 체중은 첫 표본이 접혀도 더 작은 변위가 통과하면 방향을 유지한다', () => {
  const { base, index } = square;
  const positive = square.positive.slice();
  positive[6] = -12;
  assert.deepEqual(scanContourDirection({ base, index, delta: positive }), { limit: 0.05 });
  const result = scanWeightShape({ ...square, positive });
  assert.equal(result.eligible, true);
  assert.equal(result.positiveLimit, 0.05);
});

test('two individually valid displacements can fold the combined surface', () => {
  const one = [...square.base], two = [...square.base], combined = [...square.base];
  one[7] -= 0.6;
  two[7] -= 0.6;
  combined[7] -= 1.2;
  assert.equal(scanComposedMesh({ base: square.base, edited: one, index: square.index }).valid, true);
  assert.equal(scanComposedMesh({ base: square.base, edited: two, index: square.index }).valid, true);
  assert.equal(scanComposedMesh({ base: square.base, edited: combined, index: square.index }).valid, false);
  assert.equal(scanComposedMesh({ base: square.base, edited: combined, index: square.index }).flips > 0, true);
});

test('composed audit rejects missing faces and non-finite geometry', () => {
  assert.equal(scanComposedMesh({ base: square.base, edited: square.positive, index: [] }).valid, false);
  assert.equal(scanComposedMesh({ base: square.base, edited: [NaN, ...square.base.slice(1)], index: square.index }).valid, false);
});

test('윤곽 방향은 저장될 변위가 만드는 첫 형상 실패 직전 표본까지만 사용한다', () => {
  const { base, index, positive } = square;
  assert.deepEqual(scanContourDirection({ base, index, delta: positive }), { limit: 1 });
  const delta = positive.slice();
  delta[6] = -3;
  assert.deepEqual(scanContourDirection({ base, index, delta }), { limit: 0.1 });
  assert.deepEqual(scanContourDirection({ base, index, delta: base.map(() => 1e-7) }), { limit: 0 });
});
