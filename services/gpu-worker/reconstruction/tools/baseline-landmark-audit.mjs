import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseSkinGlb } from '../engine/glb-nose.mjs';

// 템플릿 대응 후보이며 해부학적 위치 확인에는 별도 검수가 필요하다.
const pairs = {
  innerEye: [133, 362, 0],
  alar: [49, 279, 0],
  cheek: [234, 454, 0],
  jaw: [172, 397, 0],
  upperFaceToChin: [152, 10, 1],
};
const tolerance = 1e-5;

function collectPoints({ positions, template }, ids) {
  const points = new Map();
  for (let index = 0; index < template.length; index++) {
    const id = template[index];
    if (!ids.has(id)) continue;
    const point = positions.subarray(index * 3, index * 3 + 3);
    const previous = points.get(id);
    if (point.length !== 3 || !point.every(Number.isFinite) || previous === null ||
        (previous && point.some((value, axis) => Math.abs(value - previous[axis]) > tolerance))) {
      points.set(id, null);
    } else if (!previous) {
      points.set(id, point);
    }
  }
  return points;
}

export function auditCandidatePairs(skin) {
  const { landmarkVertexIds } = skin;
  const ids = new Set(Object.values(pairs).flatMap(([a, b]) => [landmarkVertexIds?.[a], landmarkVertexIds?.[b]]));
  const points = collectPoints(skin, ids);
  const pointAt = (index) => {
    const id = landmarkVertexIds?.[index];
    if (!Number.isInteger(id) || id < 0) return undefined;
    return points.get(id);
  };
  return Object.fromEntries(Object.entries(pairs).map(([name, [a, b, axis]]) => {
    const start = pointAt(a), end = pointAt(b);
    let status = 'candidate';
    if (start === null || end === null) status = 'invalidVertex';
    else if (!start || !end) status = 'missing';
    else if (end[axis] - start[axis] <= tolerance) status = 'invalidAxis';
    return [name, status];
  }));
}

function boundSkin(bytes, expectedMeshSha256) {
  if (!/^[a-f0-9]{64}$/.test(expectedMeshSha256 ?? '') ||
      createHash('sha256').update(bytes).digest('hex') !== expectedMeshSha256) {
    throw new Error('원본 GLB 해시 불일치');
  }
  const skin = parseSkinGlb(bytes);
  if (!Array.isArray(skin.landmarkVertexIds) || skin.landmarkVertexIds.length < 468) {
    throw new Error('원본 GLB 특징점 메타데이터 누락');
  }
  return skin;
}

export function auditBaselineLandmarks(bytes, expectedMeshSha256) {
  return { anatomicalQuality: 'unverified', pairs: auditCandidatePairs(boundSkin(bytes, expectedMeshSha256)) };
}

// 검수자는 같은 원본의 정면과 비저면을 확인한 뒤 피부 정점 번호를 기록한다.
export function auditAlarReference(bytes, expectedMeshSha256, references) {
  const skin = boundSkin(bytes, expectedMeshSha256);
  if (!Array.isArray(references) || references.length !== 2 ||
      references.some((reference) => reference?.meshSha256 !== expectedMeshSha256 ||
        typeof reference.reviewer !== 'string' || !reference.reviewer.trim() ||
        reference.frontal !== true || reference.basal !== true ||
        (reference.vertexSpace !== undefined && reference.vertexSpace !== 'skin-primitive-index') ||
        !Array.isArray(reference.alar) || reference.alar.length !== 2 ||
        !Array.isArray(reference.innerEye) || reference.innerEye.length !== 2 ||
        [...reference.alar, ...reference.innerEye].some((id) => !Number.isInteger(id) || id < 0)) ||
      references[0].reviewer.trim() === references[1].reviewer.trim()) {
    throw new Error('같은 원본에서 독립 검수자 두 명의 정면·비저면 표시가 필요하다');
  }
  const candidateIds = Object.fromEntries(['alar', 'innerEye'].map((part) =>
    [part, pairs[part].slice(0, 2).map((id) => skin.landmarkVertexIds[id])]));
  const points = collectPoints(skin, new Set([...Object.values(candidateIds).flat(),
    ...references.filter((reference) => !reference.vertexSpace)
      .flatMap((reference) => [...reference.alar, ...reference.innerEye])]));
  const candidates = Object.fromEntries(Object.entries(candidateIds).map(([part, ids]) =>
    [part, ids.map((id) => points.get(id))]));
  const widths = { alarWidth: [], intercanthalDistance: [] };
  const alarErrors = [], innerEyeErrors = [];
  for (const reference of references) {
    const [right, left, eyeRight, eyeLeft] =
      [...reference.alar, ...reference.innerEye].map((id) => reference.vertexSpace
        ? skin.positions.subarray(3 * id, 3 * id + 3) : points.get(id));
    if (![right, left, eyeRight, eyeLeft].every((point) =>
      point?.length === 3 && point.every(Number.isFinite))) {
      throw new Error('검수점의 피부 정점이 유효하지 않다');
    }
    const eyeSpan = eyeLeft[0] - eyeRight[0];
    const midline = (eyeRight[0] + eyeLeft[0]) / 2;
    if (eyeSpan <= tolerance || right[0] >= midline || left[0] <= midline ||
        right[1] >= eyeRight[1] || left[1] >= eyeLeft[1]) {
      throw new Error('검수점 좌우 또는 세로 배치가 유효하지 않다');
    }
    widths.alarWidth.push(left[0] - right[0]);
    widths.intercanthalDistance.push(eyeSpan);
    const error = ([candidateRight, candidateLeft], [referenceRight, referenceLeft]) =>
      candidateRight && candidateLeft && candidateLeft[0] - candidateRight[0] > tolerance
        ? [(candidateRight[0] - referenceRight[0]) / eyeSpan, (referenceLeft[0] - candidateLeft[0]) / eyeSpan]
        : null;
    alarErrors.push(error(candidates.alar, [right, left]));
    innerEyeErrors.push(error(candidates.innerEye, [eyeRight, eyeLeft]));
  }
  return {
    meshSha256: expectedMeshSha256,
    definition: 'alar-lateral-frontal-basal-v1',
    unit: 'model-space',
    anatomicalQuality: 'reviewed-pair',
    observedBounds: Object.fromEntries(Object.entries(widths).map(([key, samples]) =>
      [key, [Math.min(...samples), Math.max(...samples)]])),
    candidateInwardErrorsPerEyeSpan: alarErrors,
    innerEyeInwardErrorsPerEyeSpan: innerEyeErrors,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [file, expectedMeshSha256, action, referencesFile, reportFile, ...extra] = process.argv.slice(2);
    if (!file || !expectedMeshSha256) throw new Error('원본 GLB와 승인 해시 필요');
    const bytes = readFileSync(file);
    if (!action) {
      console.log(JSON.stringify(auditBaselineLandmarks(bytes, expectedMeshSha256)));
    } else {
      if (!['save-review', 'verify-review'].includes(action) || !referencesFile || !reportFile || extra.length) {
        throw new Error('검수 기록과 비공개 보고서 경로 필요');
      }
      const report = JSON.stringify(auditAlarReference(
        bytes, expectedMeshSha256, JSON.parse(readFileSync(referencesFile, 'utf8')),
      )) + '\n';
      if (action === 'save-review') {
        writeFileSync(reportFile, report, { flag: 'wx', mode: 0o600 });
      } else if (readFileSync(reportFile, 'utf8') !== report) {
        throw new Error('저장 보고서가 원본 검수와 불일치');
      }
      console.log(JSON.stringify({ status: action === 'save-review' ? 'saved' : 'verified' }));
    }
  } catch {
    console.error('원본 GLB 또는 특징점 결속 검사 실패');
    process.exitCode = 1;
  }
}
