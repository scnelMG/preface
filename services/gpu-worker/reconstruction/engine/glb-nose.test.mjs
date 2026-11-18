import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRig, ENGINE_VERSION, evaluate, validate, zeroParams } from './nose-engine.mjs';
import { auditNoseOnSkin, noseParamsForWeights, parseSkinGlb, validNoseResult } from './glb-nose.mjs';
import { auditNoseSkinGeometry } from './nose-skin-audit.mjs';
import { calibratedBridgeLimits } from './nose-profile-limits.mjs';

test('미리보기와 저장이 공유하는 피부 검사에서 떨어진 면의 새 관통을 잡는다', () => {
  const base = Float32Array.of(0, 0, 0, 2, 0, 0, 0, 2, 0, .5, .5, 1, .5, 1.5, 1, .5, 1, 2);
  const edited = base.slice();
  edited[11] = -1;
  edited[17] = 1;
  const topology = { template: [0, 1, 2, 3, 4, 5], index: [0, 1, 2, 3, 4, 5], protectedVertices: new Set([0]) };
  assert.equal(auditNoseSkinGeometry({ ...topology, base, edited: base }).valid, true);
  const crossing = auditNoseSkinGeometry({ ...topology, base, edited });
  assert.equal(crossing.valid, false);
  assert.equal(crossing.selfIntersections, 1);
});

function glb(regions) {
  const positions = Buffer.alloc(36), template = Buffer.alloc(12), index = Buffer.alloc(6);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => positions.writeFloatLE(v, i * 4));
  [0, 1, 2].forEach((v, i) => { template.writeUInt32LE(v, i * 4); index.writeUInt16LE(v, i * 2); });
  const bin = Buffer.concat([positions, template, index, Buffer.alloc(2)]);
  const json = { asset: { version: '2.0', extras: { 'live-mirror': { fit_sha: 'synthetic', template_vertices: 3,
    ...(regions ? { regions } : {}) } } },
    meshes: [{ name: 'skin', primitives: [{ attributes: { POSITION: 0, _TEMPLATE_INDEX: 1 }, indices: 2 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5125, count: 3, type: 'SCALAR' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
    ], bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 12 },
      { buffer: 0, byteOffset: 48, byteLength: 6 },
    ] };
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const padded = Buffer.concat([jsonBytes, Buffer.alloc((4 - jsonBytes.length % 4) % 4, 32)]);
  const head = Buffer.alloc(20), chunk = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + padded.length + 8 + bin.length, 8);
  head.writeUInt32LE(padded.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  chunk.writeUInt32LE(bin.length, 0); chunk.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, padded, chunk, bin]);
}

test('합성 GLB와 리그 매핑의 최종 메시 변형을 검사한다', () => {
  const skin = parseSkinGlb(glb());
  const base = Float32Array.from(skin.positions), edited = base.slice();
  edited[8] = .1;
  const indices = Buffer.alloc(12), weights = Buffer.alloc(12);
  [0, 1, 2].forEach((v, i) => { indices.writeInt32LE(v, i * 4); weights.writeFloatLE(1, i * 4); });
  const rig = { fit_sha: 'synthetic', nose: { nmap: indices.toString('base64'), nw: weights.toString('base64'),
    M: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] } };
  const result = auditNoseOnSkin(skin, rig, base, edited);
  assert.equal(result.valid, true);
  assert.equal(result.affectedVertices, 1);
  assert.equal(result.selfIntersections, 0);
  const neutral = auditNoseOnSkin(skin, rig, base, base);
  assert.equal(neutral.valid, true);
  assert.equal(neutral.affectedVertices, 0);
  const point = auditNoseOnSkin(skin, rig, base, base, [{ vertex: 0, delta: [0, 0, 0.01] }]);
  assert.equal(point.valid, true);
  assert.ok(point.affectedVertices > 0);
  const foldedOffset = new Float32Array(base.length);
  foldedOffset[7] = -1.2;
  assert.equal(auditNoseOnSkin(skin, rig, base, edited, [], foldedOffset).valid, false);
  assert.throws(() => auditNoseOnSkin(skin, rig, base, edited, [], [NaN]), /invalid morph offset/);
  assert.throws(() => auditNoseOnSkin(skin, { ...rig, fit_sha: 'different' }, base, edited), /mismatch/);
});

test('눈·입술 보호 영역을 움직이는 코 리그는 최종 메시에서 거절한다', () => {
  const skin = parseSkinGlb(glb({ left_eye: [2], right_eye: [0], upper_lip: [0], lower_lip: [1] }));
  const base = Float32Array.from(skin.positions), edited = base.slice();
  edited[8] = .1;
  const indices = Buffer.alloc(12), weights = Buffer.alloc(12);
  [0, 1, 2].forEach((v, i) => { indices.writeInt32LE(v, i * 4); weights.writeFloatLE(1, i * 4); });
  const rig = { fit_sha: 'synthetic', nose: { nmap: indices.toString('base64'), nw: weights.toString('base64'),
    M: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] } };
  const result = auditNoseOnSkin(skin, rig, base, edited);
  assert.equal(result.valid, false);
  assert.equal(result.protectedAffectedVertices, 1);
});

test('공개 코 가중치를 모델별 부호 한계로 변환하고 미지원·비유한값을 거절한다', () => {
  const limits = { dorsum_height: [-8, 15] };
  assert.equal(noseParamsForWeights({ 'nose.bridge_height': .4 }, limits).dorsum_height, 6);
  assert.equal(noseParamsForWeights({ 'nose.bridge_height': -.5 }, limits).dorsum_height, -4);
  assert.equal(noseParamsForWeights({ 'nose.bridge_height': 0 }, limits).edge_blend, 50);
  assert.throws(() => noseParamsForWeights({ 'nose.tip_projection': .2 }, limits), /unsupported/);
  assert.throws(() => noseParamsForWeights({ 'eye.open.left': .2 }, limits), /unsupported/);
  assert.throws(() => noseParamsForWeights({ 'eye.open.left': 0 }, limits), /unsupported/);
  assert.throws(() => noseParamsForWeights({ 'nose.bridge_height': 1.1 }, limits), /unsupported/);
  assert.throws(() => noseParamsForWeights({ 'nose.bridge_height': NaN }, limits), /unsupported/);
  assert.throws(() => noseParamsForWeights({ 'nose.bridge_height': .2 }, { dorsum_height: [-8, 0] }), /direction/);
  assert.throws(() => noseParamsForWeights({ 'nose.bridge_height': -.2 }, { dorsum_height: [0, 15] }), /direction/);
});

test('원본 상태는 통과하지만 변형 없는 비영 코 요청은 성공으로 보지 않는다', () => {
  const geometry = { valid: true }, unchanged = { valid: true, affectedVertices: 0 };
  assert.equal(validNoseResult({}, geometry, unchanged), true);
  assert.equal(validNoseResult({ 'nose.bridge_height': 0 }, geometry, unchanged), true);
  assert.equal(validNoseResult({ 'nose.bridge_height': .2 }, geometry, unchanged), false);
  assert.equal(validNoseResult({ 'nose.bridge_height': .2 }, geometry, { valid: true, affectedVertices: 1 }), true);
  assert.equal(validNoseResult({}, { valid: false }, unchanged), false);
});

function syntheticNose(width) {
  const cols = 61, rows = 74, step = 0.02;
  const vertexAt = (x, y) => Math.round((y + 0.5) / step) * cols + Math.round((x + 0.6) / step);
  const base = [], normals = [], index = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const x = col * step - 0.6, y = row * step - 0.5;
    const z = (0.24 - 0.22 * y + 0.1 * Math.exp(-((y / 0.16) ** 2))) * Math.exp(-((x / width) ** 2));
    base.push(x, y, z);
    normals.push(0, 0, 1);
    const vertex = row * cols + col;
    if (row + 1 < rows && col + 1 < cols) {
      index.push(vertex, vertex + 1, vertex + cols, vertex + 1, vertex + cols + 1, vertex + cols);
    }
  }
  const landmarks = {}, controls = {};
  const landmarksXY = {
    nasion: [0, 0.66], pronasale: [0, 0], subnasale: [0, -0.34],
    tip_lat_subject_left: [0.12, 0], tip_lat_subject_right: [-0.12, 0],
    alar_crease_subject_left: [0.18, -0.10], alar_crease_subject_right: [-0.18, -0.10],
  };
  for (const [key, [x, y]] of Object.entries(landmarksXY)) {
    const vertex = vertexAt(x, y);
    controls[key] = { vertex };
    landmarks[key] = base.slice(3 * vertex, 3 * vertex + 3);
  }
  const model = { D: 1, landmarks, controls, units: { metric_scale_known: false } };
  return { model, base: Float32Array.from(base), normals: Float32Array.from(normals), index, vertexAt };
}

test('자동 콧대 보정은 양쪽을 좁히고 이미 좁은 리그를 재보정하지 않는다', () => {
  const { model, base, normals, index } = syntheticNose(0.22);
  const rig = buildRig(model, base, normals, index, ENGINE_VERSION);
  const data = { model, positions: base, normals, index };
  const limits = calibratedBridgeLimits(data, rig, [-8, 15]);
  assert.ok(limits[1] > 0 && limits[1] < 8);
  assert.equal(limits[0], -limits[1]);
  assert.deepEqual(calibratedBridgeLimits(data, rig, limits), limits);
  const oneDirection = calibratedBridgeLimits(data, rig, [0, 15]);
  assert.equal(oneDirection[0], 0);
  assert.ok(oneDirection[1] > 0 && oneDirection[1] < 15);
});

test('콧대 변위가 코뿌리와 양쪽 옆면으로 분산되고 코끝과 보호 부위는 움직이지 않는다', () => {
  for (const width of [0.18, 0.22, 0.30]) {
    const { model, base, normals, index, vertexAt } = syntheticNose(width);
    const oldRig = buildRig(model, base, normals, index, 'nose-engine-0.12.0');
    const newRig = buildRig(model, base, normals, index, ENGINE_VERSION);
    const settings = { ...zeroParams(), edge_blend: 50 };
    const legacy = evaluate(model, oldRig, base, normals, { ...settings, dorsum_height: 10 });
    const movedZ = (edited, x, y) => {
      const z = 3 * vertexAt(x, y) + 2;
      return edited[z] - base[z];
    };
    const positive = evaluate(model, newRig, base, normals, { ...settings, dorsum_height: 10 });
    const maxProfileStep = (edited) => Math.max(...Array.from({ length: 45 }, (_, i) =>
      Math.abs(movedZ(edited, 0, 0.02 * (i + 1)) - movedZ(edited, 0, 0.02 * i))));
    assert.ok(movedZ(positive, 0, 0.66) > movedZ(legacy, 0, 0.66) + 0.02);
    assert.ok(movedZ(positive, 0.16, 0.42) > movedZ(legacy, 0.16, 0.42));
    assert.ok(maxProfileStep(positive) < maxProfileStep(legacy));
    assert.ok(movedZ(positive, 0, 0.42) > 0.09);
    assert.equal(movedZ(positive, 0, 0), 0);
    for (const setting of ['dorsum_height_pos', 'dorsum_height_span']) {
      const adjusted = evaluate(model, newRig, base, normals, { ...settings, dorsum_height: 10, [setting]: 0.1 });
      assert.ok(adjusted.every((value, i) => Math.abs(value - positive[i]) < 0.001));
      assert.equal(movedZ(adjusted, 0, 0), 0);
    }
    const protectedVertices = new Set([vertexAt(-0.36, 0.60), vertexAt(0.36, 0.60), vertexAt(0, -0.40)]);
    const template = Uint32Array.from({ length: base.length / 3 }, (_, i) => i);
    for (const height of [-15, -5, 0, 5, 15]) {
      const edited = evaluate(model, newRig, base, normals, { ...settings, dorsum_height: height });
      assert.ok(validate(newRig, base, edited, index).valid);
      assert.ok(auditNoseSkinGeometry({ base, edited, index, protectedVertices, template }).valid);
    }
    for (const alar_width of [-12, 12]) {
      const alar = { ...settings, alar_width };
      assert.deepEqual(evaluate(model, newRig, base, normals, alar), evaluate(model, oldRig, base, normals, alar));
    }
  }
});
