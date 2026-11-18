import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { creaseHeights } from '../engine/eye-edit.mjs';
import { parseSkinGlb } from '../engine/glb-nose.mjs';
import { validateCompositeEdit } from './validate-composite.mjs';

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  '../../../../apps/web/public/models/base-female.glb');
function syntheticFixture(protectContourVertex = false, eyePartsSha256) {
  const original = fs.readFileSync(fixture), skin = parseSkinGlb(original);
  const jsonLength = original.readUInt32LE(12);
  const metadata = JSON.parse(original.subarray(20, 20 + jsonLength).toString('utf8'));
  const outside = skin.template.reduce((largest, value) => Math.max(largest, value), 0) + 1;
  metadata.asset.extras['live-mirror'] = { ...metadata.asset.extras['live-mirror'],
    fit_sha: 'a'.repeat(12), template_vertices: outside + 1,
    ...(eyePartsSha256 ? { eye_parts_sha256: eyePartsSha256, eye_review: { L: 'absent', R: 'absent' } } : {}),
    regions: Object.fromEntries(['left_eye', 'right_eye', 'upper_lip', 'lower_lip', 'nose_region', 'ears']
      .map((name) => [name, [outside]])),
  };
  if (protectContourVertex) {
    const mesh = metadata.meshes.find((entry) => entry.name === 'skin');
    const sparse = (name) => metadata.accessors[
      mesh.primitives[0].targets[mesh.extras.targetNames.indexOf(name)].POSITION].sparse;
    const bin = 28 + jsonLength;
    const start = (view) => bin + metadata.bufferViews[view.bufferView].byteOffset;
    const vertex = (entry, i) => original.readUInt32LE(start(entry.indices) + i * 4);
    const contour = sparse('contour.cheek_volume_pos');
    const moving = Array.from({ length: contour.count }, (_, i) => i)
      .find((i) => Math.abs(original.readFloatLE(start(contour.values) + i * 12)) > 4e-6);
    assert.notEqual(moving, undefined);
    const protectedId = skin.template[vertex(contour, moving)];
    metadata.asset.extras['live-mirror'].regions.left_eye = [protectedId];
    const weight = sparse('contour.weight_shape_neg');
    for (let i = 0; i < weight.count; i++) {
      if (skin.template[vertex(weight, i)] !== protectedId) continue;
      const offset = start(weight.values) + i * 12;
      original.fill(0, offset, offset + 12);
    }
  }
  const json = Buffer.from(JSON.stringify(metadata));
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const header = Buffer.from(original.subarray(0, 20));
  header.writeUInt32LE(original.length + padded.length - jsonLength, 8);
  header.writeUInt32LE(padded.length, 12);
  return Buffer.concat([header, padded, original.subarray(20 + jsonLength)]);
}

const mesh = syntheticFixture();
const approved = {
  meshUrl: 'synthetic-mesh',
  meshSha256: createHash('sha256').update(mesh).digest('hex'),
  fitSha: 'a'.repeat(12),
  weights: { 'contour.weight_shape': -0.5, 'contour.cheek_volume': 0.5 },
};
const fetchAsset = async () => mesh;

test('합성 기본 모델의 체중·윤곽 실제 최종 피부와 해시를 검사한다', async () => {
  const result = await validateCompositeEdit(approved, fetchAsset);
  assert.deepEqual(result, { valid: true, validatorVersion: 1, meshSha256: approved.meshSha256,
    fitSha: approved.fitSha, weights: approved.weights });
});

test('체중 모프가 그대로 두는 눈 정점을 윤곽이 움직여도 불합격이다', async () => {
  const bytes = syntheticFixture(true);
  const meshSha256 = createHash('sha256').update(bytes).digest('hex');
  const result = await validateCompositeEdit({ ...approved, meshSha256 }, async () => bytes);
  assert.equal(result.valid, false);
});

test('다른 자산·미지원 조합·범위 밖 수치를 검사 전에 거절한다', async () => {
  await assert.rejects(validateCompositeEdit({ ...approved, meshSha256: 'a'.repeat(64) }, fetchAsset),
    /checksum mismatch/);
  await assert.rejects(validateCompositeEdit({ ...approved, weights: {
    'contour.weight_shape': -0.5, 'nose.bridge_height': 0.2,
  } }, fetchAsset), /invalid composite request/);
  await assert.rejects(validateCompositeEdit({ ...approved, weights: {
    'contour.weight_shape': -0.5, 'contour.cheek_volume': 1.01,
  } }, fetchAsset), /invalid composite request/);
});

test('복수 윤곽은 같은 최종 피부에서 검사하고 정확한 전체 값을 돌려준다', async () => {
  const input = { ...approved, validatorVersion: 2, weights: {
    'contour.weight_shape': -0.1, 'contour.cheek_volume': 0.1, 'contour.jaw_angle': -0.1,
  } };
  const result = await validateCompositeEdit(input, fetchAsset);
  assert.equal(result.validatorVersion, 2);
  assert.deepEqual(result.weights, input.weights);
  assert.equal(result.valid, true);
  const contour = { 'contour.cheek_volume': 0.1, 'contour.jaw_angle': -0.1 };
  const contourResult = await validateCompositeEdit({ ...input, weights: contour }, fetchAsset);
  assert.equal(contourResult.valid, true);
  assert.deepEqual(contourResult.weights, contour);
  const single = { 'contour.jaw_angle': -1 };
  const singleResult = await validateCompositeEdit({ ...input, weights: single }, fetchAsset);
  assert.equal(singleResult.valid, true);
  assert.deepEqual(singleResult.weights, single);
  await assert.rejects(validateCompositeEdit({ ...input, weights: {
    ...contour, 'contour.chin_projection': 1.1,
  } }, fetchAsset), /invalid composite request/);
  await assert.rejects(validateCompositeEdit({ ...input,
    weights: { ...input.weights, 'nose.bridge_height': 0.1 },
  }, fetchAsset), /invalid composite request/);
});

test('눈과 체중을 함께 검사할 때 눈 상태와 리그 해시를 결속한다', async () => {
  const eyePartsSha256 = 'c'.repeat(64), bytes = syntheticFixture(false, eyePartsSha256);
  const rig = Buffer.from('{}');
  const settings = { enabled: false, style: 'inout',
    values: { height: 20, crease: 65, inner: 5, outer: 0, lower: 0, upper: 0 },
    curve: creaseHeights(20, 'inout') };
  const input = { ...approved, validatorVersion: 2, rigUrl: 'synthetic-rig',
    meshSha256: createHash('sha256').update(bytes).digest('hex'),
    rigSha256: createHash('sha256').update(rig).digest('hex'),
    eyePartsSha256, review: { L: 'absent', R: 'absent' }, eyeEdit: { L: settings, R: settings } };
  const fetch = async (url) => url === input.meshUrl ? bytes : rig;
  const result = await validateCompositeEdit(input, fetch);
  assert.equal(result.valid, true);
  assert.deepEqual(result.eyeEdit, input.eyeEdit);
  assert.equal(result.rigSha256, input.rigSha256);
  const faceOnly = await validateCompositeEdit({ ...input, weights: { 'contour.jaw_angle': -0.1 } }, fetch);
  assert.equal(faceOnly.valid, true);
  assert.deepEqual(faceOnly.weights, { 'contour.jaw_angle': -0.1 });
  const disabled = { ...settings, style: 'outline', curve: creaseHeights(20, 'outline'),
    values: { ...settings.values, inner: 0 } };
  const preferenceOnly = await validateCompositeEdit({ ...input,
    weights: { 'contour.weight_shape': -0.5 }, eyeEdit: { L: disabled, R: disabled },
  }, fetch);
  assert.equal(preferenceOnly.valid, true);

  await assert.rejects(validateCompositeEdit({ ...input, rigSha256: '0'.repeat(64) }, fetch),
    /asset checksum mismatch/);
});
