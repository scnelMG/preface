import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { creaseHeights } from '../engine/eye-edit.mjs';
import { checkSavedEditParts } from './check_saved_edit_parts.mjs';

const original = fs.readFileSync(new URL('../../../../apps/web/public/models/base-male.glb', import.meta.url));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const partsSha = 'a'.repeat(64);
const rigBytes = Buffer.from(JSON.stringify({ nose: { engine: 'nose-v1',
  json: { rig_version: 'rig-v1', topology_version: 'topology-v1' } } }));

function withEyeReview() {
  const length = original.readUInt32LE(12);
  const json = JSON.parse(original.subarray(20, 20 + length).toString('utf8'));
  json.asset.extras['live-mirror'].eye_review = { L: 'absent', R: 'absent' };
  json.asset.extras['live-mirror'].eye_parts_sha256 = partsSha;
  let data = Buffer.from(JSON.stringify(json));
  data = Buffer.concat([data, Buffer.alloc((4 - data.length % 4) % 4, 32)]);
  const rest = original.subarray(20 + length), head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + data.length + rest.length, 8);
  head.writeUInt32LE(data.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([head, data, rest]);
}

const mesh = withEyeReview();
const eye = () => ({ enabled: false, style: 'inout',
  values: { height: 20, crease: 65, inner: 0, outer: 0, lower: 0, upper: 0 },
  curve: creaseHeights(20, 'inout') });
const simulation = () => ({
  morphState: { schemaVersion: 'v1', weights: {}, eyeEdit: { L: eye(), R: eye() } },
  eyeReview: { L: 'absent', R: 'absent' }, eyePartsSha256: partsSha,
  eyeCapabilities: { schemaVersion: 'v1', engine: 'nose-v1', rigVersion: 'rig-v1',
    topologyVersion: 'topology-v1', meshSha256: hash(mesh), rigSha256: hash(rigBytes), eyePartsSha256: partsSha,
    limits: { inner: 20, outer: 20, lower: 20, upper: 20, 'inout:height': 20 } },
});

test('합성 모델의 저장 눈 상태를 자산 해시·판정·안전 함수에 결속한다', () => {
  const result = checkSavedEditParts(mesh, rigBytes, simulation());
  assert.deepEqual(result, { componentChecksPass: true, eyeBindingVerified: true,
    noseChecked: false, noseValid: null, eyeChecked: true, eyeSafe: true,
    eyeSkinScope: 'largest-eye-region-skin', jointMeshChecked: false });
});

test('저장된 눈 요청은 실제 비영 변위도 있어야 통과한다', () => {
  const saved = simulation();
  saved.morphState.eyeEdit.L.enabled = true;
  saved.morphState.eyeEdit.R.enabled = true;
  const result = checkSavedEditParts(mesh, rigBytes, saved);
  assert.equal(result.eyeChecked, true);
  assert.equal(result.eyeSafe, true);
});

test('다른 모델 해시·기존 주름의 새 라인·한계 밖 트임을 거절한다', () => {
  const wrongHash = simulation(); wrongHash.eyeCapabilities.meshSha256 = 'b'.repeat(64);
  assert.throws(() => checkSavedEditParts(mesh, rigBytes, wrongHash), /mismatch/);
  const wrongReview = simulation(); wrongReview.eyeReview.L = 'present';
  assert.throws(() => checkSavedEditParts(mesh, rigBytes, wrongReview), /mismatch/);
  const overLimit = simulation(); overLimit.morphState.eyeEdit.L.values.inner = 25;
  assert.throws(() => checkSavedEditParts(mesh, rigBytes, overLimit), /approved range/);
  const invalidApproval = simulation(); invalidApproval.eyeCapabilities.limits.inner = Infinity;
  assert.throws(() => checkSavedEditParts(mesh, rigBytes, invalidApproval), /invalid eye approval/);
});

test('승인 schema·engine·rig·topology 버전의 누락과 불일치를 거절한다', () => {
  for (const field of ['schemaVersion', 'engine', 'rigVersion', 'topologyVersion']) {
    const missing = simulation(); delete missing.eyeCapabilities[field];
    assert.throws(() => checkSavedEditParts(mesh, rigBytes, missing), /mismatch/, `${field} missing`);
    const wrong = simulation(); wrong.eyeCapabilities[field] = 'other';
    assert.throws(() => checkSavedEditParts(mesh, rigBytes, wrong), /mismatch/, `${field} mismatch`);
  }
  const wrongState = simulation(); wrongState.morphState.schemaVersion = 'v2';
  assert.throws(() => checkSavedEditParts(mesh, rigBytes, wrongState), /mismatch/);
  for (const field of ['engine', 'rig_version', 'topology_version']) {
    const rig = JSON.parse(rigBytes.toString('utf8'));
    if (field === 'engine') rig.nose.engine = 'other';
    else rig.nose.json[field] = 'other';
    const bytes = Buffer.from(JSON.stringify(rig)), saved = simulation();
    saved.eyeCapabilities.rigSha256 = hash(bytes);
    assert.throws(() => checkSavedEditParts(mesh, bytes, saved), /mismatch/, `rig ${field} mismatch`);
  }
});

test('코 성분도 같은 모델의 기존 검사기를 거치고 최종 합성 메시 검증과 구별한다', () => {
  const saved = simulation(); saved.morphState.weights['nose.bridge_height'] = 0.2;
  const valid = checkSavedEditParts(mesh, rigBytes, saved, () => ({ valid: true, meshSha256: hash(mesh) }));
  assert.equal(valid.noseChecked, true);
  assert.equal(valid.componentChecksPass, true);
  assert.equal(valid.jointMeshChecked, false);
  const invalid = checkSavedEditParts(mesh, rigBytes, saved, () => ({ valid: false, meshSha256: hash(mesh) }));
  assert.equal(invalid.componentChecksPass, false);
  assert.equal(checkSavedEditParts(mesh, rigBytes, saved,
    () => ({ meshSha256: hash(mesh) })).componentChecksPass, false);
  assert.throws(() => checkSavedEditParts(mesh, rigBytes, saved,
    () => ({ valid: true, meshSha256: 'c'.repeat(64) })), /different models/);
});

test('코만 있는 상태에서는 눈 승인 결속을 확인했다고 표시하지 않는다', () => {
  const saved = simulation();
  saved.morphState.eyeEdit = null;
  saved.morphState.weights['nose.bridge_height'] = 0.2;
  const result = checkSavedEditParts(mesh, rigBytes, saved,
    () => ({ valid: true, meshSha256: hash(mesh) }));
  assert.equal(result.componentChecksPass, true);
  assert.equal(result.eyeBindingVerified, false);
  assert.equal(result.eyeChecked, false);
  assert.equal(result.eyeSkinScope, null);
});

test('CLI 실패 출력에 입력 경로나 시안 식별자를 노출하지 않는다', () => {
  const marker = 'synthetic-private-id';
  const run = spawnSync(process.execPath,
    [fileURLToPath(new URL('./check_saved_edit_parts.mjs', import.meta.url)), marker, `${marker}.json`],
    { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.ok((run.stderr + run.stdout).includes('Saved edit geometry check failed'));
  assert.ok(!(run.stderr + run.stdout).includes(marker));
});
