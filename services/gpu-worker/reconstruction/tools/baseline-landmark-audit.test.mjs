import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseSkinGlb } from '../engine/glb-nose.mjs';
import { auditAlarReference, auditBaselineLandmarks, auditCandidatePairs } from './baseline-landmark-audit.mjs';

const samples = new URL('../../../../apps/web/public/models/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', samples), 'utf8'));

for (const sample of manifest.models) {
  test(`공개 합성 모델 ${sample.key}의 특징점 후보가 원본 메시와 결속된다`, () => {
    assert.equal(manifest.synthetic, true);
    const bytes = readFileSync(new URL(sample.file, samples));
    const audit = auditBaselineLandmarks(bytes, sample.sha256);
    assert.equal(audit.anatomicalQuality, 'unverified');
    assert.deepEqual(Object.values(audit.pairs), Array(5).fill('candidate'));
    assert.deepEqual(auditBaselineLandmarks(bytes, sample.sha256), audit);
    assert.throws(() => auditBaselineLandmarks(bytes, '0'.repeat(64)), /해시 불일치/);
  });
}

test('누락·갈라진 중복·비유한 좌표·반전된 가로축을 제외한다', () => {
  const landmarkVertexIds = [];
  landmarkVertexIds[133] = 0;
  landmarkVertexIds[362] = 1;
  landmarkVertexIds[49] = 2;
  landmarkVertexIds[279] = 3;
  landmarkVertexIds[234] = 4;
  landmarkVertexIds[454] = 5;
  landmarkVertexIds[172] = 6;
  landmarkVertexIds[397] = 7;
  const result = auditCandidatePairs({
    landmarkVertexIds,
    template: [0, 1, 2, 2, 3, 4, 5, 6, 7],
    positions: new Float32Array([
      -1, 0, 0, 1, 0, 0, -1, 0, 0, -2, 0, 0, 1, 0, 0,
      NaN, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0,
    ]),
  });
  assert.deepEqual(result, {
    innerEye: 'candidate', alar: 'invalidVertex', cheek: 'invalidVertex',
    jaw: 'invalidAxis', upperFaceToChin: 'missing',
  });
});

test('합성 검수 기록을 원본에 결속해 저장하고 재조회한다', () => {
  const sample = manifest.models[0];
  const file = new URL(sample.file, samples);
  const bytes = readFileSync(file);
  const { landmarkVertexIds: ids, positions, template } = parseSkinGlb(bytes);
  // 합성 테스트에서는 IO 결속만 확인하기 위해 기존 후보 정점을 검수점으로 사용한다.
  const reference = {
    meshSha256: sample.sha256, reviewer: 'first', frontal: true, basal: true,
    alar: [ids[49], ids[279]], innerEye: [ids[133], ids[362]],
  };
  const references = [reference, { ...reference, reviewer: 'second' }];
  const report = auditAlarReference(bytes, sample.sha256, references);
  assert.deepEqual(report.candidateInwardErrorsPerEyeSpan, [[0, 0], [0, 0]]);
  assert.deepEqual(report.innerEyeInwardErrorsPerEyeSpan, [[0, 0], [0, 0]]);
  const toIndices = (entry) => ({
    ...entry, vertexSpace: 'skin-primitive-index',
    alar: entry.alar.map((id) => template.indexOf(id)),
    innerEye: entry.innerEye.map((id) => template.indexOf(id)),
  });
  const selected = references.map(toIndices);
  assert.deepEqual(auditAlarReference(bytes, sample.sha256, selected), report);
  assert.throws(() => auditAlarReference(bytes, sample.sha256,
    [selected[0], { ...selected[1], innerEye: [template.length, selected[1].innerEye[1]] }]), /피부 정점/);
  const x = (id) => positions[3 * template.indexOf(id)];
  const rightIndex = template.indexOf(ids[49]) * 3;
  const eyeSpan = x(ids[362]) - x(ids[133]);
  const secondRight = template.find((_, index) => {
    const dx = positions[3 * index] - positions[rightIndex];
    return dx < -1e-5 && Math.hypot(dx,
      positions[3 * index + 1] - positions[rightIndex + 1],
      positions[3 * index + 2] - positions[rightIndex + 2]) < eyeSpan / 5;
  });
  assert.ok(secondRight !== undefined);
  const secondWidth = x(ids[279]) - x(secondRight);
  const shifted = auditAlarReference(bytes, sample.sha256, [
    reference, { ...references[1], alar: [secondRight, ids[279]] },
  ]);
  assert.ok(secondWidth > report.observedBounds.alarWidth[0]);
  assert.equal(shifted.observedBounds.alarWidth[1], secondWidth);
  assert.equal(shifted.candidateInwardErrorsPerEyeSpan[1][0],
    (x(ids[49]) - x(secondRight)) / eyeSpan);
  assert.throws(() => auditAlarReference(bytes, sample.sha256, [reference, reference]), /독립 검수자/);
  assert.throws(() => auditAlarReference(bytes, sample.sha256,
    [reference, { ...references[1], basal: false }]), /정면·비저면/);
  assert.throws(() => auditAlarReference(bytes, sample.sha256,
    [reference, { ...references[1], alar: [...reference.alar].reverse() }]), /좌우/);

  const dir = mkdtempSync(join(tmpdir(), 'baseline-landmark-test-'));
  try {
    const input = join(dir, 'reference.json');
    const output = join(dir, 'report.json');
    writeFileSync(input, JSON.stringify(selected));
    const run = (action) => JSON.parse(execFileSync(process.execPath, [
      fileURLToPath(new URL('./baseline-landmark-audit.mjs', import.meta.url)),
      fileURLToPath(file), sample.sha256, action, input, output,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    assert.deepEqual(run('save-review'), { status: 'saved' });
    assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), report);
    assert.deepEqual(run('verify-review'), { status: 'verified' });
    writeFileSync(output, JSON.stringify({ ...report, meshSha256: '0'.repeat(64) }));
    assert.throws(() => run('verify-review'));
  } finally {
    rmSync(dir, { recursive: true });
  }
});
