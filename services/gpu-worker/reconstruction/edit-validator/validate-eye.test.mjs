import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { composeEyeDeformation, creaseHeights } from '../engine/eye-edit.mjs';
import { eyeRigFromGlb } from '../tools/auto_eye_limits.mjs';
import { eyeEditSides, validateEyeEdit } from './validate-eye.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const parts = 'c'.repeat(64);
const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  '../../../../apps/web/public/models/base-male.glb');

function approvedFixture() {
  const original = fs.readFileSync(fixture);
  const oldLength = original.readUInt32LE(12);
  const json = JSON.parse(original.subarray(20, 20 + oldLength).toString('utf8'));
  json.asset.extras = { ...json.asset.extras, 'live-mirror': {
    ...json.asset.extras?.['live-mirror'], eye_review: { L: 'absent', R: 'absent' },
    eye_parts_sha256: parts,
  } };
  const bytes = Buffer.from(JSON.stringify(json));
  const padded = Buffer.concat([bytes, Buffer.alloc((4 - bytes.length % 4) % 4, 0x20)]);
  const header = Buffer.from(original.subarray(0, 20));
  header.writeUInt32LE(20 + padded.length + original.length - 20 - oldLength, 8);
  header.writeUInt32LE(padded.length, 12);
  return Buffer.concat([header, padded, original.subarray(20 + oldLength)]);
}

const eye = (inner = 0, upper = 0) => ({ enabled: false, style: 'inout',
  values: { height: 20, crease: 65, inner, outer: 0, lower: 0, upper },
  curve: creaseHeights(20, 'inout') });

// 2026-11-13: 눈 주변 세분화를 모서리 중점 4등분으로 바꾼 뒤 이 합성 모델은 트임 최대 조합(앞트임 100 + 윗트임 50 포함)도
// 뒤집힘·교차가 없다(이전 "불안전"은 부채꼴 세분화의 별 정점 삼각형에서 나왔다). 불안전 판정 자체는 eye-edit.test.mjs가 본다.
test('합성 모델에서 트임 조합을 검사하고 자산·승인 불일치는 거절한다', async () => {
  const mesh = approvedFixture(), rig = Buffer.from('{}');
  const input = { meshUrl: 'synthetic-mesh', rigUrl: 'synthetic-rig',
    meshSha256: hash(mesh), rigSha256: hash(rig), eyePartsSha256: parts,
    review: { L: 'absent', R: 'absent' }, eyeEdit: { L: eye(100, 50), R: eye(100, 50) } };
  const fetchAsset = async (url) => url === input.meshUrl ? mesh : rig;
  assert.equal((await validateEyeEdit(input, fetchAsset)).valid, true);
  assert.equal((await validateEyeEdit({ ...input, eyeEdit: { L: eye(), R: eye() } }, fetchAsset)).valid, true);
  await assert.rejects(validateEyeEdit({ ...input, meshSha256: 'a'.repeat(64) }, fetchAsset),
    /checksum mismatch/);
  await assert.rejects(validateEyeEdit({ ...input, eyePartsSha256: 'a'.repeat(64) }, fetchAsset),
    /approval mismatch/);
});

test('세 쌍꺼풀 모양과 안전한 앞트임을 피부 교차 검사에서 허용한다', async () => {
  const mesh = approvedFixture(), rig = Buffer.from('{}');
  const input = { meshUrl: 'synthetic-mesh', rigUrl: 'synthetic-rig',
    meshSha256: hash(mesh), rigSha256: hash(rig), eyePartsSha256: parts,
    review: { L: 'absent', R: 'absent' } };
  const fetchAsset = async (url) => url === input.meshUrl ? mesh : rig;
  for (const style of ['inline', 'inout', 'outline']) {
    const fold = { ...eye(), enabled: true, style, curve: creaseHeights(20, style) };
    assert.equal((await validateEyeEdit({ ...input, eyeEdit: { L: fold, R: fold } }, fetchAsset)).valid, true, style);
  }
  const fold = { ...eye(25), enabled: true };
  assert.equal((await validateEyeEdit({ ...input, eyeEdit: { L: fold, R: fold } }, fetchAsset)).valid, true);
  assert.equal((await validateEyeEdit({ ...input, eyeEdit: { L: eye(25), R: eye(25) } }, fetchAsset)).valid, true);
});

test('합성 무쌍 눈의 인아웃은 교차를 제한해도 덮이는 피부 변위를 유지한다', () => {
  const { rig, review } = eyeRigFromGlb(approvedFixture());
  const fold = { ...eye(), enabled: true };
  const [{ selection, values }] = eyeEditSides({ L: fold, R: fold }, review);
  const result = composeEyeDeformation(rig.base, rig.basis, values, selection, values.style,
    rig.normals, rig.indices, rig.spheres, rig.lid);
  let maxShift = 0;
  for (let i = 0; i < rig.base.length; i += 3) {
    maxShift = Math.max(maxShift, Math.hypot(result.positions[i] - rig.base[i],
      result.positions[i + 1] - rig.base[i + 1], result.positions[i + 2] - rig.base[i + 2]));
  }
  // 기본 깊이의 단(눈 너비의 0.04)이 전체 감쇠 없이 들어간다.
  assert.ok(maxShift > rig.basis[0].width * 0.03);
  assert.equal(result.foldAmount, 1);
});
