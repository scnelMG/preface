import assert from 'node:assert/strict';
import { test } from 'node:test';
import { introducedSelfIntersectionCount, introducedSelfIntersectionFaces, newSelfIntersections } from './mesh-audit.mjs';

const fixed = [0, 0, 0, 2, 0, 0, 0, 2, 0];
const triangles = [0, 1, 2, 3, 4, 5];

test('편집으로 새로 생긴 교차만 찾는다', () => {
  const before = Float32Array.from([...fixed, .5, .5, 1, .5, 1.5, 1, .5, 1, 2]);
  const after = Float32Array.from([...fixed, .5, .5, -1, .5, 1.5, 1, .5, 1, 1]);
  assert.deepEqual(newSelfIntersections(before, after, triangles, [3, 4, 5]),
    { introduced: 1, before: 0, after: 1 });
  assert.equal(introducedSelfIntersectionCount(before, after, triangles, [3, 4, 5]), 1);
  assert.deepEqual(introducedSelfIntersectionFaces(before, after, triangles, [3, 4, 5]), new Set([0, 3]));
  assert.equal(newSelfIntersections(after, after, triangles, [3, 4, 5]).introduced, 0);
  assert.equal(introducedSelfIntersectionCount(after, after, triangles, [3, 4, 5]), 0);
  assert.equal(introducedSelfIntersectionFaces(after, after, triangles, [3, 4, 5]).size, 0);
  assert.equal(introducedSelfIntersectionCount(after, before, triangles, [3, 4, 5]), 0);
});

test('같은 평면의 내부 겹침을 찾고 떨어진 삼각형은 건너뛴다', () => {
  const before = Float32Array.from([...fixed, 3, 3, 0, 4, 3, 0, 3, 4, 0]);
  const overlap = Float32Array.from([...fixed, .5, .5, 0, 1.5, .5, 0, .5, 1.5, 0]);
  const disjoint = Float32Array.from([...fixed, 1.7, 1.7, 0, 2.3, 1.7, 0, 1.7, 2.3, 0]);
  assert.equal(newSelfIntersections(before, overlap, triangles, [3, 4, 5]).introduced, 1);
  assert.equal(introducedSelfIntersectionCount(before, overlap, triangles, [3, 4, 5]), 1);
  assert.equal(newSelfIntersections(before, disjoint, triangles, [3, 4, 5]).introduced, 0);
  assert.equal(introducedSelfIntersectionCount(before, disjoint, triangles, [3, 4, 5]), 0);
});

test('공유 정점의 정상적인 이웃 면은 자기교차가 아니다', () => {
  const square = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
  assert.equal(newSelfIntersections(square, square, [0, 1, 2, 1, 3, 2], [1, 2]).introduced, 0);
  assert.equal(introducedSelfIntersectionCount(square, square, [0, 1, 2, 1, 3, 2], [1, 2]), 0);
});

test('같은 좌표의 별도 정점이 점 접촉에서 면 관통으로 바뀌면 잡는다', () => {
  const before = Float32Array.from([...fixed, 0, 0, 0, .5, .5, 1, 1, .5, 1]);
  const after = Float32Array.from([...fixed, 0, 0, 0, .5, .5, -1, 1, .5, 1]);
  assert.deepEqual(newSelfIntersections(before, after, triangles, [4]),
    { introduced: 1, before: 0, after: 1 });
  assert.equal(introducedSelfIntersectionCount(before, after, triangles, [4]), 1);
});

test('비정상 정점은 검사를 실패시킨다', () => {
  const bad = Float32Array.from([...fixed, Number.NaN, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.throws(() => newSelfIntersections(bad, bad, triangles, [3]), /non-finite/);
  assert.throws(() => introducedSelfIntersectionCount(bad, bad, triangles, [3]), /non-finite/);
});

test('다양한 합성 위치에서 최적화된 새 교차 수가 기존 판정과 같다', () => {
  const moving = (x, z) => Float32Array.from([...fixed, x, .5, z - 1, x, 1.5, z + 1, x + 1, 1, z + 1]);
  for (const start of [-1, 0, 1]) for (const x of [-1, 0, .5, 1, 2]) for (const z of [-1, 0, 1]) {
    const before = moving(.5, start), after = moving(x, z);
    assert.equal(introducedSelfIntersectionCount(before, after, triangles, [3, 4, 5]),
      newSelfIntersections(before, after, triangles, [3, 4, 5]).introduced);
  }
});

test('멀리 있는 면은 건너뛰고 편집 부위와 닿는 면의 새 교차는 찾는다', () => {
  const far = [100, 100, 0, 101, 100, 0, 100, 101, 0];
  const before = Float32Array.from([...fixed, 3, 3, 0, 4, 3, 0, 3, 4, 0, ...far]);
  const after = Float32Array.from([...fixed, .5, .5, 0, 1.5, .5, 0, .5, 1.5, 0, ...far]);
  assert.equal(introducedSelfIntersectionCount(before, after, [...triangles, 6, 7, 8], [3, 4, 5]), 1);
  assert.equal(introducedSelfIntersectionCount(before, after, [...triangles, 6, 7, 8], []), 0);
});
