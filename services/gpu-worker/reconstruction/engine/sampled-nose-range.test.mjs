import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampledNoseRanges } from './sampled-nose-range.mjs';

test('중립 모델이 잘못되면 진단 범위를 만들지 않는다', () => {
  assert.throws(() => sampledNoseRanges(() => ({ valid: false })), /neutral/);
});

test('방향별 첫 실패에서 멈추고 다른 효과는 지원으로 추정하지 않는다', () => {
  const seen = [];
  const { ranges, firstFailures } = sampledNoseRanges((weights) => {
    const [code, value] = Object.entries(weights)[0] ?? [];
    if (!code) return { valid: true };
    seen.push([code, value]);
    if (code !== 'nose.bridge_height') throw Error('unsupported edit weight');
    return { valid: value >= -0.4 && value <= 0.6 };
  }, 10);
  assert.deepEqual(ranges, { 'nose.bridge_height': [-0.4, 0.6] });
  assert.ok(seen.some(([code, value]) => code === 'nose.bridge_height' && value === -0.5));
  assert.ok(!seen.some(([code, value]) => code === 'nose.bridge_height' && value === -0.6));
  assert.ok(!('nose.tip_height' in ranges));
  assert.equal(firstFailures['nose.bridge_height'][0].weight, -0.5);
  assert.equal(firstFailures['nose.bridge_height'][1].weight, 0.7);
  assert.equal(firstFailures['nose.tip_height'][0].reason, 'unsupported edit weight');
});

test('예상하지 못한 검사 오류는 정상 진단으로 숨기지 않는다', () => {
  assert.throws(() => sampledNoseRanges((weights) => {
    if (Object.keys(weights).length) throw Error('corrupt topology');
    return { valid: true };
  }), /corrupt topology/);
});

test('승인 근거는 1차 코 코드만 표본 검사할 수 있다', () => {
  const seen = [];
  const result = sampledNoseRanges((weights) => {
    seen.push(...Object.keys(weights));
    return { valid: true };
  }, 2, ['nose.bridge_height']);
  assert.deepEqual(result.ranges, { 'nose.bridge_height': [-1, 1] });
  assert.deepEqual([...new Set(seen)], ['nose.bridge_height']);
  assert.throws(() => sampledNoseRanges(() => ({ valid: true }), 1, ['toString']), /unknown/);
});
