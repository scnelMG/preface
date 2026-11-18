import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { validateEdit, fetchSignedAsset } from './validate.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('같은 GLB와 리그의 전체 상태 검사만 반환하고 서명 URL은 노출하지 않는다', async () => {
  const mesh = Buffer.from('synthetic mesh'), rig = Buffer.from('{}');
  const input = { meshUrl: 'mesh-url', rigUrl: 'rig-url', meshSha256: hash(mesh),
    rigSha256: hash(rig), currentWeights: {}, candidateWeights: { 'nose.bridge_height': 0.2 } };
  const result = await validateEdit(input, async (url) => url === 'mesh-url' ? mesh : rig,
    (bytes, parsed, weights) => {
      assert.equal(bytes, mesh);
      assert.deepEqual(parsed, {});
      assert.ok([{}, input.candidateWeights].some((value) => JSON.stringify(value) === JSON.stringify(weights)));
      return { valid: true, meshSha256: hash(mesh), engine: 'synthetic' };
    });
  assert.equal(result.valid, true);
  assert.deepEqual(result.actualWeights, input.candidateWeights);
  assert.equal(result.limited, false);
  assert.equal(result.rigSha256, hash(rig));
  assert.equal(JSON.stringify(result).includes('mesh-url'), false);
});

test('모델 또는 리그 해시가 바뀌면 형상 검사 전 거절한다', async () => {
  const mesh = Buffer.from('synthetic mesh'), rig = Buffer.from('{}');
  const input = { meshUrl: 'mesh-url', rigUrl: 'rig-url', meshSha256: hash(mesh),
    rigSha256: hash(Buffer.from('other')), currentWeights: {}, candidateWeights: {} };
  await assert.rejects(validateEdit(input, async (url) => url === 'mesh-url' ? mesh : rig,
    () => { throw Error('checker must not run'); }), /checksum mismatch/);
});

test('검사 결과의 모델 식별 정보도 다시 확인한다', async () => {
  const mesh = Buffer.from('synthetic mesh'), rig = Buffer.from('{}');
  const input = { meshUrl: 'mesh-url', rigUrl: 'rig-url', meshSha256: hash(mesh),
    rigSha256: hash(rig), currentWeights: {}, candidateWeights: {} };
  await assert.rejects(validateEdit(input, async (url) => url === 'mesh-url' ? mesh : rig,
    () => ({ valid: true, meshSha256: hash(Buffer.from('wrong')) })), /checked model mismatch/);
});

test('안전하지 않은 후보는 현재 상태와 후보 사이의 검사된 실제값으로 축소한다', async () => {
  const mesh = Buffer.from('synthetic mesh'), rig = Buffer.from('{}');
  const input = { meshUrl: 'mesh-url', rigUrl: 'rig-url', meshSha256: hash(mesh),
    rigSha256: hash(rig), currentWeights: { 'nose.bridge_height': 0.2 },
    candidateWeights: { 'nose.bridge_height': 0.8 } };
  const result = await validateEdit(input, async (url) => url === 'mesh-url' ? mesh : rig,
    (_, __, weights) => ({ valid: (weights['nose.bridge_height'] ?? 0) <= 0.5,
      meshSha256: hash(mesh), engine: 'synthetic' }));
  assert.equal(result.valid, true);
  assert.equal(result.limited, true);
  assert.ok(result.actualWeights['nose.bridge_height'] > 0.2);
  assert.ok(result.actualWeights['nose.bridge_height'] < 0.5);
});

test('복합 요청의 축소 결과는 두 항목 모두 검사된 실제값을 반환한다', async () => {
  const mesh = Buffer.from('synthetic mesh'), rig = Buffer.from('{}');
  const currentWeights = { 'nose.bridge_height': 0.2, 'nose.alar_width': -0.1 };
  const candidateWeights = { 'nose.bridge_height': 0.8, 'nose.alar_width': -0.8 };
  const input = { meshUrl: 'mesh', rigUrl: 'rig', meshSha256: hash(mesh), rigSha256: hash(rig),
    currentWeights, candidateWeights };
  const checked = [];
  const result = await validateEdit(input, async (url) => url === 'mesh' ? mesh : rig,
    (_, __, weights) => {
      checked.push(weights);
      return { valid: (weights['nose.bridge_height'] ?? 0) <= 0.5 &&
        (weights['nose.alar_width'] ?? 0) >= -0.5, meshSha256: hash(mesh) };
    });
  assert.equal(result.valid, true);
  assert.equal(result.limited, true);
  assert.deepEqual(checked.at(-1), result.actualWeights);
  assert.ok(result.actualWeights['nose.bridge_height'] > currentWeights['nose.bridge_height']);
  assert.ok(result.actualWeights['nose.bridge_height'] < candidateWeights['nose.bridge_height']);
  assert.ok(result.actualWeights['nose.alar_width'] < currentWeights['nose.alar_width']);
  assert.ok(result.actualWeights['nose.alar_width'] > candidateWeights['nose.alar_width']);
  assert.ok(Math.abs(
    (result.actualWeights['nose.bridge_height'] - currentWeights['nose.bridge_height']) /
    (candidateWeights['nose.bridge_height'] - currentWeights['nose.bridge_height']) -
    (result.actualWeights['nose.alar_width'] - currentWeights['nose.alar_width']) /
    (candidateWeights['nose.alar_width'] - currentWeights['nose.alar_width'])
  ) < 0.003);
});

test('현재 상태가 잘못되면 축소 계산도 시작하지 않는다', async () => {
  const mesh = Buffer.from('synthetic mesh'), rig = Buffer.from('{}');
  const input = { meshUrl: 'mesh-url', rigUrl: 'rig-url', meshSha256: hash(mesh),
    rigSha256: hash(rig), currentWeights: { 'nose.bridge_height': 0.7 },
    candidateWeights: { 'nose.bridge_height': 0.8 } };
  await assert.rejects(validateEdit(input, async (url) => url === 'mesh-url' ? mesh : rig,
    (_, __, weights) => ({ valid: (weights['nose.bridge_height'] ?? 0) <= 0.5,
      meshSha256: hash(mesh) })), /invalid current mesh/);
});

test('서명 자산 URL은 허용한 HTTPS 호스트에서만 읽는다', async () => {
  await assert.rejects(fetchSignedAsset('http://example.invalid/model.glb', 'example.invalid', 100), /untrusted/);
  await assert.rejects(fetchSignedAsset('https://other.invalid/model.glb', 'example.invalid', 100), /untrusted/);
  await assert.rejects(fetchSignedAsset('https://user:pass@example.invalid/model.glb', 'example.invalid', 100), /untrusted/);
});

test('저장 정밀도를 넘는 코 가중치는 자산을 읽기 전에 거절한다', async () => {
  const bytes = Buffer.from('{}');
  const input = { meshUrl: 'mesh', rigUrl: 'rig', meshSha256: hash(bytes),
    rigSha256: hash(bytes), currentWeights: {}, candidateWeights: { 'nose.bridge_height': 0.1234 } };
  await assert.rejects(validateEdit(input, () => { throw Error('must not fetch'); }), /invalid edit request/);
});

test('코 제어점 후보도 같은 최종 상태로 검사하고 안전하지 않으면 저장값을 내지 않는다', async () => {
  const mesh = Buffer.from('synthetic mesh'), rig = Buffer.from('{}');
  const stroke = { vertex: 3, delta: [0, 0.01, 0] };
  const input = { meshUrl: 'mesh', rigUrl: 'rig', meshSha256: hash(mesh), rigSha256: hash(rig),
    currentWeights: {}, candidateWeights: {}, currentPointStrokes: [], candidatePointStrokes: [stroke] };
  const fetchAsset = async (url) => url === 'mesh' ? mesh : rig;
  const accepted = await validateEdit(input, fetchAsset, (_, __, ___, points) =>
    ({ valid: true, meshSha256: hash(mesh), checkedPoints: points.length }));
  assert.deepEqual(accepted.actualPointStrokes, [stroke]);
  const rejected = await validateEdit(input, fetchAsset, (_, __, ___, points) =>
    ({ valid: points.length === 0, meshSha256: hash(mesh) }));
  assert.equal(rejected.valid, false);
  assert.equal(rejected.actualPointStrokes, undefined);
});
