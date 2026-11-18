// 새 모델의 눈 승인 한계 후보(S15P31B204-521). Spring은 코 승인 결속과 눈 판정 해시가 같을 때만 저장한다.
// 브라우저와 같은 엔진·입력으로 잰다: 리그 준비는 apps/web eyeRig.ts prepareEyeRig, 한계는 eyeLimits.worker.ts·useEyeLimits.ts.
// 출력(한 줄 JSON): {eligible:true, meshSha256, review, limits, timingMs} 또는 {eligible:false, reason}
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  buildEyeBasis, fitEyeSpheres, lidSkin, refineEyeMesh, measureEyeSafeLimit, TRIM_LIMIT_CONTROLS,
} from '../engine/eye-edit.mjs';

export const STYLES = ['inline', 'inout', 'outline'];
// 트임 한계는 접힘 없이(깊이 0·쌍꺼풀 미적용) 재므로 종류와 무관하다. 브라우저 기본 종류로 잰다.
const TRIM_STYLE = 'inout';
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const READ = { 5126: ['readFloatLE', 4], 5125: ['readUInt32LE', 4], 5123: ['readUInt16LE', 2], 5121: ['readUInt8', 1] };
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function chunks(bytes) {
  if (bytes.length < 28 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 ||
      bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) throw Error('invalid GLB header');
  const jsonLength = bytes.readUInt32LE(12), binHeader = 20 + jsonLength;
  if (binHeader + 8 > bytes.length || bytes.readUInt32LE(binHeader + 4) !== 0x004e4942) throw Error('invalid GLB BIN');
  const binLength = bytes.readUInt32LE(binHeader);
  if (binHeader + 8 + binLength > bytes.length) throw Error('invalid GLB BIN');
  return { json: JSON.parse(bytes.subarray(20, binHeader).toString('utf8')), bin: bytes.subarray(binHeader + 8, binHeader + 8 + binLength) };
}

function accessor(json, bin, id) {
  const a = json.accessors?.[id], view = a && json.bufferViews?.[a.bufferView], read = a && READ[a.componentType];
  const width = a && COMPONENTS[a.type];
  if (!view || !read || !width || a.sparse || view.buffer !== 0) throw Error('unsupported GLB accessor');
  if (view.byteStride && view.byteStride !== width * read[1]) throw Error('unsupported GLB stride');
  const count = a.count * width, start = (view.byteOffset || 0) + (a.byteOffset || 0);
  if (start + count * read[1] > (view.byteOffset || 0) + view.byteLength || start + count * read[1] > bin.length) {
    throw Error('GLB accessor out of range');
  }
  const out = a.componentType === 5126 ? new Float32Array(count) : new Uint32Array(count);
  for (let i = 0; i < count; i++) out[i] = bin[read[0]](start + i * read[1]);
  return out;
}

function identity(node) {
  return (!node.matrix || node.matrix.every((v, i) => v === IDENTITY[i])) &&
    (!node.translation || node.translation.every((v) => v === 0)) &&
    (!node.rotation || node.rotation.every((v, i) => v === (i === 3 ? 1 : 0))) &&
    (!node.scale || node.scale.every((v) => v === 1));
}

// 장면 순서대로 메시 노드를 모은다(three의 traverse와 같은 순서). 노드 변환이 있으면 브라우저처럼 거절한다.
function meshNodes(json) {
  const out = [], visit = (id) => {
    const node = json.nodes?.[id];
    if (!node) throw Error('invalid GLB node');
    if (node.mesh !== undefined) {
      if (!identity(node)) throw Error('node transforms are not supported');
      out.push(json.meshes[node.mesh]);
    }
    for (const child of node.children ?? []) visit(child);
  };
  for (const id of json.scenes?.[json.scene ?? 0]?.nodes ?? []) visit(id);
  return out;
}

function eyeVertices(basis, base) {
  let count = 0;
  for (let i = 0; i < base.length; i += 3) {
    if (basis.some((eye) => {
      const [u, v, z] = eye.local([base[i], base[i + 1], base[i + 2]]);
      return u > -0.45 && u < 1.45 && v > -0.65 && v < 0.85 && Math.abs(z) < 0.55;
    })) count++;
  }
  return count;
}

export function readReview(json) {
  const review = json.asset?.extras?.['live-mirror']?.eye_review;
  const side = (value) => value === 'present' || value === 'absent';
  return review && side(review.L) && side(review.R) ? { L: review.L, R: review.R } : null;
}

/** GLB 바이트 → measureEyeSafeLimit에 넣을 리그(브라우저 eyeLimits.worker.ts의 rig와 같은 모양). */
export function eyeRigFromGlb(bytes) {
  const { json, bin } = chunks(bytes);
  const ids = json.asset?.extras?.['live-mirror']?.landmark_vertex_ids;
  if (!Array.isArray(ids) || ids.length < 468) throw Error('missing landmarks');
  const points = new Map(), balls = [], skins = [];
  for (const mesh of meshNodes(json)) {
    for (const primitive of mesh.primitives ?? []) {
      if (primitive.attributes?._TEMPLATE_INDEX === undefined) continue;
      if ((primitive.mode ?? 4) !== 4) throw Error('unsupported primitive mode');
      const material = json.materials?.[primitive.material]?.name;
      const positions = accessor(json, bin, primitive.attributes.POSITION);
      const template = accessor(json, bin, primitive.attributes._TEMPLATE_INDEX);
      if (positions.length !== template.length * 3) throw Error('invalid template index');
      for (let i = 0; i < template.length; i++) {
        const point = [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
        points.set(template[i], point);
        if (material === 'eye' || material === 'sclera') balls.push(point);
      }
      if (material === 'skin' || material === 'skin_photo') {
        const normals = accessor(json, bin, primitive.attributes.NORMAL);
        const indices = primitive.indices === undefined
          ? Uint32Array.from({ length: template.length }, (_, i) => i) : accessor(json, bin, primitive.indices);
        if (normals.length !== positions.length || indices.length % 3 || indices.some((i) => i >= template.length)) {
          throw Error('invalid skin mesh');
        }
        skins.push({ positions, normals, indices, template, meshName: mesh.name });
      }
    }
  }
  const landmarks = ids.map((id) => points.get(id));
  const basis = buildEyeBasis(landmarks);
  if (!skins.length || basis.length !== 2) throw Error('missing eye skin');
  // lid: 쌍꺼풀 입력(눈꺼풀 앞면 피부·단 방향, 세분화 정점). 브라우저 eyeRig.ts prepareEyeRig와 같다.
  const refined = skins.map((skin) => {
    const data = refineEyeMesh(skin, basis, 2);
    return { ...data, meshName: skin.meshName, original: skin.positions, lid: lidSkin(skin, data.sources) };
  });
  // 피부가 여러 메시로 나뉜 모델은 눈 주변 정점이 가장 많은 피부로 잰다(useEyeLimits와 같음)
  const skin = refined.reduce((best, item) => eyeVertices(basis, item.positions) > eyeVertices(basis, best.positions) ? item : best);
  return {
    rig: { base: skin.positions, normals: skin.normals, indices: skin.indices, basis, spheres: fitEyeSpheres(balls, basis), lid: skin.lid },
    skins: refined,
    review: readReview(json),
    meshSha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/** 단독 안전 한계. 무쌍(absent) 눈이 있을 때만 종류별 쌍꺼풀 높이를 재고, 트임 4개는 항상 잰다. */
export function measureEyeLimits(rig, review) {
  const eligible = { L: review.L === 'absent', R: review.R === 'absent' }, limits = {};
  if (eligible.L || eligible.R) {
    for (const style of STYLES) limits[`${style}:height`] = measureEyeSafeLimit(rig, 'height', { style, eligible });
  }
  for (const control of TRIM_LIMIT_CONTROLS) limits[control] = measureEyeSafeLimit(rig, control, { style: TRIM_STYLE, eligible });
  return limits;
}

export function eyeApprovalCandidate(bytes) {
  const started = Date.now();
  const { rig, review, meshSha256 } = eyeRigFromGlb(bytes);
  if (!review) return { eligible: false, reason: 'eye review missing' };
  const limits = measureEyeLimits(rig, review);
  if (!Object.values(limits).every((v) => Number.isFinite(v) && v >= 0 && v <= 100)) return { eligible: false, reason: 'limit out of range' };
  return { eligible: true, meshSha256, review, limits, timingMs: Date.now() - started };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const dir = process.argv[2];
    if (!dir) throw Error('model directory required');
    console.log(JSON.stringify(eyeApprovalCandidate(fs.readFileSync(path.join(dir, 'head.glb')))));
  } catch (error) {
    console.log(JSON.stringify({ eligible: false, reason: String(error?.message ?? error).slice(0, 200) }));
  }
}
