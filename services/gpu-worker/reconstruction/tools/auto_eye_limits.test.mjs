import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { test } from 'node:test';
import { eyeApprovalCandidate, eyeRigFromGlb, readReview } from './auto_eye_limits.mjs';

// 저장소의 공개 합성 기본 모델(실제 인물 아님). 서비스 GLB와 같이 468 기준점·피부·공막·_TEMPLATE_INDEX를 담는다.
const BASE = new URL('../../../../apps/web/public/models/base-male.glb', import.meta.url);

function withReview(bytes, review) {
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  json.asset.extras['live-mirror'].eye_review = review;
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)]);
  const rest = bytes.subarray(20 + jsonLength), head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + text.length + rest.length, 8);
  head.writeUInt32LE(text.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([head, text, rest]);
}

test('GLB에서 브라우저와 같은 눈 리그를 만든다', () => {
  const { rig, review, meshSha256 } = eyeRigFromGlb(fs.readFileSync(BASE));
  assert.equal(review, null);
  assert.match(meshSha256, /^[a-f0-9]{64}$/);
  assert.equal(rig.basis.length, 2);
  assert.equal(rig.spheres.length, 2);
  assert.ok(rig.base.length > 0 && rig.base.length === rig.normals.length && rig.indices.length % 3 === 0);
});

test('쌍꺼풀이 있는 눈만 있으면 높이 한계 없이 트임 4개만 담은 후보를 만든다', () => {
  const bytes = withReview(fs.readFileSync(BASE), { L: 'present', R: 'present' });
  const got = eyeApprovalCandidate(bytes);
  assert.equal(got.eligible, true);
  assert.deepEqual(got.review, { L: 'present', R: 'present' });
  assert.equal(got.meshSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(Object.keys(got.limits).sort(), ['inner', 'lower', 'outer', 'upper']);
  assert.ok(Object.values(got.limits).every((v) => Number.isFinite(v) && v >= 0 && v <= 100));
});

test('판정이 없거나 형식이 틀린 GLB는 후보를 만들지 않는다', () => {
  assert.deepEqual(eyeApprovalCandidate(fs.readFileSync(BASE)), { eligible: false, reason: 'eye review missing' });
  assert.equal(readReview({ asset: { extras: { 'live-mirror': { eye_review: { L: 'absent', R: 'maybe' } } } } }), null);
  assert.throws(() => eyeRigFromGlb(Buffer.from('not a glb at all, just text bytes')), /invalid GLB/);
});
