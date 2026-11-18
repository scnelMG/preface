import assert from 'node:assert/strict';
import { test } from 'node:test';
import { directionalCandidate } from './auto_nose_candidate.mjs';

const bridge = 'nose.bridge_height', tip = 'nose.tip_projection', rotation = 'nose.tip_rotation';
const safe = (weights) => ({ valid: true, protectedRegionsPresent: true,
  protectedAffectedVertices: 0, affectedVertices: Object.keys(weights).length });

test('중립과 각 방향만 검사하고 다른 방향의 실패와 무관하게 승인한다', () => {
  const checked = [];
  const tried = [];
  const selected = directionalCandidate((weights) => {
    assert.ok(Object.keys(weights).length <= 1, '복합 조합은 생성 중 검사하지 않는다');
    checked.push(weights);
    if (weights[bridge] < 0 || weights[tip] < -0.25) {
      return { ...safe(weights), valid: false, selfIntersections: 2 };
    }
    if (weights[rotation]) throw Error('unsupported edit direction');
    return safe(weights);
  }, tried);
  assert.deepEqual(selected.ranges[bridge], { min: 0, max: 1 });
  assert.deepEqual(selected.ranges[tip], { min: -0.25, max: 1 });
  assert.ok(!(rotation in selected.ranges));
  assert.equal(checked.filter((weights) => !Object.keys(weights).length).length, 1);
  assert.ok(!checked.some((weights) => weights[tip] < -0.5));
  assert.ok(tried.some(({ at, selfIntersections }) => at === 'nose.bridge_height=-0.1' && selfIntersections === 2));
  assert.ok(tried.some(({ at, selfIntersections }) => at === 'nose.tip_projection=-0.5' && selfIntersections === 2));
  assert.equal(checked.filter((weights) => weights[rotation] !== undefined).length, 2);
});

test('첫 실패 아래에서만 추가 검사하고 직접 합격한 코 범위를 넓힌다', () => {
  const checked = new Map();
  const selected = directionalCandidate((weights) => {
    const value = weights[bridge];
    if (value === undefined) return safe(weights);
    assert.equal(value, Number(value.toFixed(3)), '저장 검사기가 받는 정밀도로 검사한다');
    const valid = value >= -0.08 && value <= 0.42;
    checked.set(value, valid);
    return { ...safe(weights), valid, selfIntersections: valid ? 0 : 1 };
  });
  const { min, max } = selected.ranges[bridge];
  assert.ok(min < -0.05 && min >= -0.08);
  assert.ok(max > 0.4 && max <= 0.42);
  assert.equal(checked.get(min), true);
  assert.equal(checked.get(max), true);
  assert.ok([...checked.keys()].every((value) => value >= -0.1 && value <= 0.5));
  assert.equal(checked.size, 10); // four coarse samples and six boundary checks
});

test('중립 실패, 보호 정점 이동, 무변형은 해당 범위를 승인하지 않는다', () => {
  const tried = [];
  assert.equal(directionalCandidate((weights) => ({ ...safe(weights), protectedRegionsPresent: false }), tried), null);
  assert.equal(tried[0].at, 'neutral');
  assert.equal(tried.length, 1);
  assert.equal(directionalCandidate((weights) => ({ ...safe(weights), affectedVertices: 0 })), null);
  assert.equal(directionalCandidate((weights) => ({
    ...safe(weights), protectedAffectedVertices: Object.keys(weights).length,
  })), null);
});

test('안전한 모델은 열 방향의 끝값까지 검사한다', () => {
  let calls = 0;
  const selected = directionalCandidate((weights) => { calls++; return safe(weights); });
  assert.equal(calls, 51);
  assert.equal(Object.keys(selected.ranges).length, 5);
  for (const bounds of Object.values(selected.ranges)) assert.deepEqual(bounds, { min: -1, max: 1 });
});

test('예상 밖 검사 오류를 방향 미지원으로 숨기지 않는다', () => {
  assert.throws(() => directionalCandidate((weights) => {
    if (Object.keys(weights).length) throw Error('corrupt topology');
    return safe(weights);
  }), /corrupt topology/);
});
