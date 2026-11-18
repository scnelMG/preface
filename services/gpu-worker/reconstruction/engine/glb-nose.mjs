import { createHash } from 'node:crypto';
import * as E from './nose-engine.mjs';
import { POC_MORPH_KEYS } from './effect-codes.mjs';
import { parseEditable } from './model-loader.mjs';
import { auditNoseSkinGeometry, protectedNoseSkinVertices } from './nose-skin-audit.mjs';
import { applyPointStrokes } from './point-strokes.mjs';

function accessor(glb, bytes, id, component, type) {
  const a = glb.accessors[id], view = glb.bufferViews[a.bufferView];
  if (a.componentType !== component || a.type !== type || a.sparse) throw Error('unsupported GLB accessor');
  const size = component === 5126 || component === 5125 ? 4 : component === 5123 ? 2 : 0;
  if (!size || view.buffer !== 0 || (view.byteStride && view.byteStride !== size * (type === 'VEC3' ? 3 : 1))) {
    throw Error('unsupported GLB buffer');
  }
  const count = a.count * (type === 'VEC3' ? 3 : 1);
  const offset = (view.byteOffset || 0) + (a.byteOffset || 0);
  if (offset + count * size > (view.byteOffset || 0) + view.byteLength || offset + count * size > bytes.length) {
    throw Error('GLB accessor out of range');
  }
  const out = component === 5126 ? new Float32Array(count) : new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const pos = offset + i * size;
    out[i] = component === 5126 ? bytes.readFloatLE(pos) : component === 5125 ? bytes.readUInt32LE(pos) : bytes.readUInt16LE(pos);
  }
  return out;
}

export function parseSkinGlb(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
    throw Error('invalid GLB header');
  }
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLength + 8 > bytes.length) throw Error('invalid GLB JSON');
  const glb = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const binHeader = 20 + jsonLength, binLength = bytes.readUInt32LE(binHeader);
  if (bytes.readUInt32LE(binHeader + 4) !== 0x004e4942 || binHeader + 8 + binLength > bytes.length) throw Error('invalid GLB BIN');
  const bin = bytes.subarray(binHeader + 8, binHeader + 8 + binLength);
  const skin = glb.meshes?.find((mesh) => mesh.name === 'skin');
  if (!skin || skin.primitives.length !== 1) throw Error('missing skin primitive');
  const primitive = skin.primitives[0];
  const positions = accessor(glb, bin, primitive.attributes.POSITION, 5126, 'VEC3');
  const template = accessor(glb, bin, primitive.attributes._TEMPLATE_INDEX, 5125, 'SCALAR');
  const indexType = glb.accessors[primitive.indices].componentType;
  const index = accessor(glb, bin, primitive.indices, indexType, 'SCALAR');
  if (![5123, 5125].includes(indexType) || positions.length / 3 !== template.length || index.length % 3 ||
      [...index].some((i) => i >= template.length)) throw Error('invalid skin mesh');
  const metadata = glb.asset?.extras?.['live-mirror'];
  const protectedVertices = protectedNoseSkinVertices(metadata);
  return { positions, template, index, protectedVertices, fitSha: metadata?.fit_sha,
    templateVertices: metadata?.template_vertices, landmarkVertexIds: metadata?.landmark_vertex_ids,
    meshSha256: createHash('sha256').update(bytes).digest('hex') };
}

function decoded(value, type) {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length % 4) throw Error('invalid rig map');
  const array = type === 'index' ? new Int32Array(bytes.length / 4) : new Float32Array(bytes.length / 4);
  for (let i = 0; i < array.length; i++) array[i] = type === 'index' ? bytes.readInt32LE(i * 4) : bytes.readFloatLE(i * 4);
  return array;
}

function noseSkinPositions(skin, rig, canonicalBase, canonicalEdited, pointStrokes) {
  if (!rig || rig.fit_sha !== skin.fitSha || !rig.nose || skin.templateVertices < 1) throw Error('GLB/rig mismatch');
  const map = decoded(rig.nose.nmap, 'index'), weights = decoded(rig.nose.nw, 'weight'), matrix = rig.nose.M;
  if (map.length !== weights.length || map.length !== skin.templateVertices ||
      !Array.isArray(matrix) || matrix.length !== 3 || matrix.some((r) => !Array.isArray(r) || r.length !== 3 || r.some((v) => !Number.isFinite(v)))) {
    throw Error('invalid rig mapping');
  }
  if (canonicalBase.length !== canonicalEdited.length || canonicalBase.length % 3) throw Error('invalid canonical mesh');
  let edited = skin.positions.slice();
  for (let i = 0; i < skin.template.length; i++) {
    const template = skin.template[i], mapped = map[template], weight = weights[template];
    if (template >= map.length || mapped < 0 || mapped >= canonicalBase.length / 3 ||
        !Number.isFinite(weight) || weight < 0 || weight > 1) throw Error('invalid rig vertex');
    const delta = [0, 1, 2].map((k) => canonicalEdited[3 * mapped + k] - canonicalBase[3 * mapped + k]);
    const displacement = matrix.map((row) => weight * row.reduce((sum, x, k) => sum + x * delta[k], 0));
    for (let k = 0; k < 3; k++) edited[3 * i + k] += displacement[k];
  }
  return applyPointStrokes(edited, skin.template, weights, pointStrokes);
}

export function auditNoseOnSkin(skin, rig, canonicalBase, canonicalEdited, pointStrokes = [], morphOffset = null) {
  const edited = noseSkinPositions(skin, rig, canonicalBase, canonicalEdited, pointStrokes);
  if (morphOffset) {
    if (morphOffset.length !== edited.length || !Array.from(morphOffset).every(Number.isFinite)) {
      throw Error('invalid morph offset');
    }
    for (let i = 0; i < edited.length; i++) edited[i] += morphOffset[i];
  }
  return auditNoseSkinGeometry({ base: skin.positions, edited, template: skin.template,
    index: skin.index, protectedVertices: skin.protectedVertices });
}

// The same GLB and rig are checked many times in a row (auto_nose_candidate: 43-215 states per model, S15P31B204-679):
// the skin is parsed and the editor built ONCE per caller object instead of per state. Keyed by the objects themselves
// (WeakMap), so another buffer / rig is parsed again and nothing outlives its caller. Results are unchanged: parsing and
// createEditor are pure, and evaluate / validate / the skin audit only read them.
const skinCache = new WeakMap();
const editorCache = new WeakMap();

function cachedSkin(bytes) {
  let skin = skinCache.get(bytes);
  if (!skin) { skin = parseSkinGlb(bytes); skinCache.set(bytes, skin); }
  return skin;
}

function noseEditor(rig) {
  let built = editorCache.get(rig);
  if (built) return built;
  const binary = Buffer.from(rig.nose.bin, 'base64');
  if (createHash('sha256').update(binary).digest('hex') !== rig.nose.json.editable_sha256) {
    throw Error('rig checksum mismatch');
  }
  const data = parseEditable(rig.nose.json,
    binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength));
  built = { data, editor: E.createEditor(data.model, data.positions, data.normals, data.index, rig.nose.limits, rig.nose.engine) };
  editorCache.set(rig, built);
  return built;
}

/** One absolute nose-only state, checked on the emitted GLB surface rather than only the canonical mesh. */
function evaluateNose(skin, rig, weights) {
  if (!skin.fitSha || rig?.format !== 'live-mirror-rig' || rig.version !== 1 || rig.fit_sha !== skin.fitSha ||
      !E.supportsNoseEngine(rig.nose?.engine) || !rig.nose.json?.editable_sha256 ||
      !rig.nose.json?.rig_version || !rig.nose.json?.topology_version) throw Error('model/rig version mismatch');
  const { data, editor } = noseEditor(rig);
  const params = noseParamsForWeights(weights, rig.nose.limits);
  const applied = E.evaluate(data.model, editor.rig, data.positions, data.normals, params);
  return { base: data.positions, applied, canonical: E.validate(editor.rig, data.positions, applied, data.index) };
}

export function approvedNoseSkinPositions(skin, rig, weights) {
  const { base, applied, canonical } = evaluateNose(skin, rig, weights);
  const edited = noseSkinPositions(skin, rig, base, applied, []);
  if (!canonical.valid || !edited.some((value, i) => Math.abs(value - skin.positions[i]) > 1e-10)) {
    throw Error('unsafe or empty nose deformation');
  }
  return edited;
}

export function checkNoseEdit(glbBytes, rig, weights, pointStrokes = []) {
  const skin = cachedSkin(glbBytes);
  const { base, applied, canonical } = evaluateNose(skin, rig, weights);
  const finalMesh = auditNoseOnSkin(skin, rig, base, applied, pointStrokes);
  return { valid: canonical.valid && finalMesh.valid && finalMesh.protectedRegionsPresent &&
      (Object.values(weights).every((weight) => weight === 0) && !pointStrokes.length || finalMesh.affectedVertices > 0),
    meshSha256: skin.meshSha256, fitSha: skin.fitSha, engine: rig.nose.engine,
    rigVersion: rig.nose.json.rig_version, topologyVersion: rig.nose.json.topology_version,
    canonicalValid: canonical.valid, canonicalReason: canonical.reason ?? null, skinValid: finalMesh.valid,
    affectedVertices: finalMesh.affectedVertices, selfIntersections: finalMesh.selfIntersections,
    protectedAffectedVertices: finalMesh.protectedAffectedVertices,
    protectedRegionsPresent: finalMesh.protectedRegionsPresent };
}

export function validNoseResult(weights, canonical, finalMesh) {
  return canonical.valid && finalMesh.valid &&
    (Object.values(weights).every((weight) => weight === 0) || finalMesh.affectedVertices > 0);
}

export function noseParamsForWeights(weights, limits) {
  const params = { ...E.zeroParams(), edge_blend: 50 };
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) throw Error('invalid weights');
  for (const [code, weight] of Object.entries(weights)) {
    const key = POC_MORPH_KEYS[code];
    const bounds = limits?.[key];
    if (!key || key === 'edge_blend' || !Array.isArray(bounds) || bounds.length !== 2 ||
        bounds.some((v) => !Number.isFinite(v)) || bounds[0] > 0 || bounds[1] < 0 ||
        !Number.isFinite(weight) || Math.abs(weight) > 1) throw Error('unsupported edit weight');
    if (weight === 0) continue;
    if ((weight < 0 && bounds[0] === 0) || (weight > 0 && bounds[1] === 0)) {
      throw Error('unsupported edit direction');
    }
    params[key] = weight < 0 ? -weight * bounds[0] : weight * bounds[1];
  }
  return params;
}
