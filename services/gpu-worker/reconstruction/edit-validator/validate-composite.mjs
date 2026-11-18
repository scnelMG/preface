import { createHash } from 'node:crypto';
import { CONTOUR_CODES } from '../engine/contour-codes.mjs';
import { POC_MORPH_KEYS } from '../engine/effect-codes.mjs';
import { clampToEyeballs, composeEyeDeformation, transferRefined } from '../engine/eye-edit.mjs';
import { eyeRigFromGlb } from '../tools/auto_eye_limits.mjs';
import { eyeEditSides, validateEyeEdit } from './validate-eye.mjs';
import { approvedNoseSkinPositions, parseSkinGlb } from '../engine/glb-nose.mjs';
import { scanComposedMesh } from '../tools/audit_weight_shape.mjs';

const PROTECTED = ['left_eye', 'right_eye', 'upper_lip', 'lower_lip', 'nose_region', 'ears'];
const PROTECTED_COMPOSITE = ['left_eye', 'right_eye', 'nose_region'];
const WEIGHT = 'contour.weight_shape';
const VALIDATOR_VERSION = 1;
// Skin coordinates are in metres. Ignore a projection difference below 5 μm for face-only edits.
const FACE_EYEBALL_TOLERANCE = 5e-6;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function view(glb, binary, id, bytesPerElement) {
  const entry = glb.bufferViews?.[id];
  if (!entry || entry.buffer !== 0 || (entry.byteStride && entry.byteStride !== bytesPerElement)) {
    throw Error('unsupported buffer view');
  }
  const start = entry.byteOffset || 0, end = start + entry.byteLength;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > binary.length) {
    throw Error('buffer view out of range');
  }
  return { start, end };
}

function accessor(glb, binary, id, count) {
  const entry = glb.accessors?.[id];
  if (!entry || entry.componentType !== 5126 || entry.type !== 'VEC3' || entry.count !== count) {
    throw Error('unsupported morph accessor');
  }
  const values = new Float32Array(count * 3);
  if (entry.bufferView !== undefined) {
    const { start, end } = view(glb, binary, entry.bufferView, 12);
    const offset = start + (entry.byteOffset || 0);
    if (offset < start || offset + values.length * 4 > end) throw Error('morph out of range');
    for (let i = 0; i < values.length; i++) values[i] = binary.readFloatLE(offset + 4 * i);
  }
  if (entry.sparse) {
    const sparse = entry.sparse, size = { 5121: 1, 5123: 2, 5125: 4 }[sparse.indices?.componentType];
    if (!size || !Number.isInteger(sparse.count) || sparse.count < 1 || sparse.count > count) {
      throw Error('invalid sparse morph');
    }
    const indices = view(glb, binary, sparse.indices.bufferView, size);
    const data = view(glb, binary, sparse.values.bufferView, 12);
    const indexStart = indices.start + (sparse.indices.byteOffset || 0);
    const valueStart = data.start + (sparse.values.byteOffset || 0);
    if (indexStart < indices.start || indexStart + sparse.count * size > indices.end ||
        valueStart < data.start || valueStart + sparse.count * 12 > data.end) throw Error('sparse morph out of range');
    let previous = -1;
    for (let i = 0; i < sparse.count; i++) {
      const position = indexStart + i * size;
      const vertex = size === 1 ? binary.readUInt8(position) : size === 2 ? binary.readUInt16LE(position) : binary.readUInt32LE(position);
      if (vertex <= previous || vertex >= count) throw Error('invalid sparse vertex');
      previous = vertex;
      for (let axis = 0; axis < 3; axis++) values[3 * vertex + axis] = binary.readFloatLE(valueStart + 12 * i + 4 * axis);
    }
  }
  if (!values.every(Number.isFinite)) throw Error('non-finite morph');
  return values;
}

function targets(bytes, skin, codes) {
  const jsonLength = bytes.readUInt32LE(12), binHeader = 20 + jsonLength;
  const glb = JSON.parse(bytes.subarray(20, binHeader).toString('utf8'));
  const binary = bytes.subarray(binHeader + 8, binHeader + 8 + bytes.readUInt32LE(binHeader));
  const mesh = glb.meshes?.filter((entry) => entry.name === 'skin');
  if (mesh?.length !== 1 || mesh[0].primitives?.length !== 1) throw Error('invalid skin mesh');
  const primitive = mesh[0].primitives[0], names = mesh[0].extras?.targetNames;
  if (!Array.isArray(names) || names.length !== primitive.targets?.length ||
      mesh[0].weights?.some((value) => value !== 0)) throw Error('invalid morph targets');
  const result = new Map();
  for (const code of codes) {
    const index = names.indexOf(code);
    if (index < 0 || names.lastIndexOf(code) !== index) throw Error('missing morph target');
    result.set(code, accessor(glb, binary, primitive.targets[index].POSITION, skin.positions.length / 3));
  }
  const regions = glb.asset?.extras?.['live-mirror']?.regions;
  if (!PROTECTED.every((name) => Array.isArray(regions?.[name]) && regions[name].length &&
      regions[name].every((id) => Number.isInteger(id) && id >= 0 && id < skin.templateVertices))) {
    throw Error('missing protected regions');
  }
  return { result, regions };
}

/** The final skin is checked at the exact pair of requested signed weights. */
export async function validateCompositeEdit(input, fetchAsset = fetch) {
  if (input?.validatorVersion === 2) return validateFullComposite(input, fetchAsset);
  const weights = input?.weights, keys = weights && typeof weights === 'object' && !Array.isArray(weights)
    ? Object.keys(weights) : [];
  const contour = keys.find((code) => code !== WEIGHT && CONTOUR_CODES.includes(code));
  if (typeof input?.meshUrl !== 'string' || !/^[a-f0-9]{64}$/.test(input?.meshSha256) ||
      !/^[a-f0-9]{12}$/.test(input?.fitSha) || keys.length !== 2 || !keys.includes(WEIGHT) || !contour ||
      !keys.every((code) => Number.isFinite(weights[code]) && weights[code] !== 0 &&
        Math.abs(weights[code]) <= 1 && Number(weights[code].toFixed(3)) === weights[code])) {
    throw Error('invalid composite request');
  }
  const bytes = await fetchAsset(input.meshUrl);
  if (sha256(bytes) !== input.meshSha256) throw Error('mesh checksum mismatch');
  const skin = parseSkinGlb(bytes);
  if (skin.fitSha !== input.fitSha) throw Error('fit mismatch');
  const side = (value) => value < 0 ? 'neg' : 'pos';
  const weightKey = `${WEIGHT}_${side(weights[WEIGHT])}`, contourKey = `${contour}_${side(weights[contour])}`;
  const { result, regions } = targets(bytes, skin, [weightKey, contourKey]);
  const weightDelta = result.get(weightKey), contourDelta = result.get(contourKey);
  if (!weightDelta.some((value) => value !== 0) || !contourDelta.some((value) => value !== 0)) {
    return { valid: false, validatorVersion: VALIDATOR_VERSION, meshSha256: skin.meshSha256, fitSha: skin.fitSha, weights };
  }
  const protectedIds = new Set(PROTECTED.flatMap((name) => regions[name]));
  const protectedCompositeIds = new Set(PROTECTED_COMPOSITE.flatMap((name) => regions[name]));
  const weightValue = Math.abs(weights[WEIGHT]), contourValue = Math.abs(weights[contour]);
  for (let vertex = 0; vertex < skin.template.length; vertex++) {
    const templateId = skin.template[vertex];
    if (!protectedIds.has(templateId)) continue;
    const offset = vertex * 3;
    if ([offset, offset + 1, offset + 2].some((i) => Math.abs(weightDelta[i]) > 2e-6 ||
        (protectedCompositeIds.has(templateId) && (Math.abs(contourValue * contourDelta[i]) > 2e-6 ||
          Math.abs(weightValue * weightDelta[i] + contourValue * contourDelta[i]) > 2e-6)))) {
      return { valid: false, validatorVersion: VALIDATOR_VERSION, meshSha256: skin.meshSha256, fitSha: skin.fitSha, weights };
    }
  }
  const base = Array.from(skin.positions), index = Array.from(skin.index);
  const contourOnly = Float32Array.from(skin.positions);
  for (let i = 0; i < contourOnly.length; i++) contourOnly[i] += contourValue * contourDelta[i];
  if (!scanComposedMesh({ base, edited: Array.from(contourOnly), index }).valid) {
    return { valid: false, validatorVersion: VALIDATOR_VERSION, meshSha256: skin.meshSha256, fitSha: skin.fitSha, weights };
  }
  const edited = Float32Array.from(contourOnly);
  for (let i = 0; i < edited.length; i++) edited[i] += weightValue * weightDelta[i];
  const checked = scanComposedMesh({ base, edited: Array.from(edited), index });
  return { valid: checked.valid, validatorVersion: VALIDATOR_VERSION, meshSha256: skin.meshSha256, fitSha: skin.fitSha, weights };
}

/** Checks the same surface as the viewer: eye positions + transferred nose and GLB offsets. */
async function validateFullComposite(input, fetchAsset) {
  const { weights, meshUrl, meshSha256, fitSha, rigUrl, rigSha256, eyeEdit = null, eyePartsSha256, review } = input;
  const sha = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const keys = weights && typeof weights === 'object' && !Array.isArray(weights) ? Object.keys(weights) : [];
  const noseCodes = keys.filter((code) => Object.hasOwn(POC_MORPH_KEYS, code));
  const glbCodes = keys.filter((code) => code === WEIGHT || CONTOUR_CODES.includes(code));
  const needsRig = noseCodes.length > 0 || eyeEdit !== null;
  const contourOnly = keys.length > 0 && !needsRig && keys.every((code) => CONTOUR_CODES.includes(code));
  const mixedFace = !keys.includes(WEIGHT) && needsRig &&
    (glbCodes.length > 0 || (noseCodes.length > 0 && eyeEdit !== null));
  if (typeof meshUrl !== 'string' || !sha(meshSha256) || !/^[a-f0-9]{12}$/.test(fitSha) ||
      (!contourOnly && !mixedFace && (!keys.includes(WEIGHT) || (keys.length < 2 && eyeEdit === null))) ||
      keys.length !== noseCodes.length + glbCodes.length ||
      !keys.every((code) => Number.isFinite(weights[code]) && weights[code] !== 0 &&
        Math.abs(weights[code]) <= 1 && Number(weights[code].toFixed(3)) === weights[code]) ||
      (needsRig && (typeof rigUrl !== 'string' || !sha(rigSha256)))) {
    throw Error('invalid composite request');
  }
  const [bytes, rigBytes] = await Promise.all([fetchAsset(meshUrl), needsRig ? fetchAsset(rigUrl) : null]);
  if (sha256(bytes) !== meshSha256 || (rigBytes && sha256(rigBytes) !== rigSha256)) {
    throw Error('asset checksum mismatch');
  }
  const skin = parseSkinGlb(bytes);
  if (skin.fitSha !== fitSha) throw Error('fit mismatch');
  const result = (valid) => ({
    valid, validatorVersion: 2, meshSha256, fitSha, weights, rigSha256: rigSha256 ?? null, eyeEdit,
  });
  const targetKeys = glbCodes.map((code) => code + (weights[code] < 0 ? '_neg' : '_pos'));
  const { result: deltas, regions } = targets(bytes, skin, targetKeys);
  const weightProtected = new Set(PROTECTED.flatMap((name) => regions[name]));
  const contourProtected = new Set(PROTECTED_COMPOSITE.flatMap((name) => regions[name]));
  const glbOffset = new Float32Array(skin.positions.length);
  let weightOffset = new Float32Array(skin.positions.length);
  for (const [i, code] of glbCodes.entries()) {
    const delta = deltas.get(targetKeys[i]);
    const protectedIds = code === WEIGHT ? weightProtected : contourProtected;
    const scale = Math.abs(weights[code]);
    if (!delta.some((value) => value !== 0)) return result(false);
    if (code === WEIGHT) weightOffset = Float32Array.from(delta, (value) => value * scale);
    for (let j = 0; j < delta.length; j++) {
      if (protectedIds.has(skin.template[Math.floor(j / 3)]) &&
          Math.abs(delta[j] * (code === WEIGHT ? 1 : scale)) > 2e-6) return result(false);
      if (code !== WEIGHT) glbOffset[j] += delta[j] * scale;
    }
  }
  if (glbOffset.some((delta, i) => Math.abs(delta + weightOffset[i]) > 2e-6 &&
      contourProtected.has(skin.template[Math.floor(i / 3)]))) return result(false);
  const scan = (base, edited, index) => scanComposedMesh({
    base: Array.from(base), edited: Array.from(edited), index: Array.from(index),
  }).valid;
  const nosePositions = noseCodes.length ? approvedNoseSkinPositions(skin, JSON.parse(rigBytes.toString('utf8')),
    Object.fromEntries(noseCodes.map((code) => [code, weights[code]]))) : skin.positions;
  const noseOffset = Float32Array.from(nosePositions, (value, i) => value - skin.positions[i]);
  if (noseOffset.some((delta, i) => Math.abs(delta) > 2e-6 && skin.protectedVertices?.has(skin.template[Math.floor(i / 3)]))) {
    return result(false);
  }
  if (eyeEdit === null) {
    const withoutWeight = Float32Array.from(nosePositions, (value, i) => value + glbOffset[i]);
    if (!keys.includes(WEIGHT)) return result(scan(skin.positions, withoutWeight, skin.index));
    const edited = Float32Array.from(withoutWeight, (value, i) => value + weightOffset[i]);
    return result(scan(skin.positions, withoutWeight, skin.index) &&
      scan(skin.positions, edited, skin.index));
  }

  const checkedEye = await validateEyeEdit({ meshUrl, meshSha256, rigUrl, rigSha256, eyeEdit, eyePartsSha256, review },
    async (url) => url === meshUrl ? bytes : rigBytes);
  if (!checkedEye.valid) return result(false);
  const { rig, skins } = eyeRigFromGlb(bytes);
  // Until cross-surface intersections are covered, only approve the bound single skin.
  const [refined] = skins;
  if (skins.length !== 1 || refined.meshName !== 'skin' ||
      refined.original.length !== skin.positions.length ||
      !refined.original.every((value, i) => value === skin.positions[i])) return result(false);
  const { positions: original, normals, indices, sources, lid } = refined;
  const edited = original.slice();
  for (const { selection, values } of eyeEditSides(eyeEdit, review)) {
    const eye = composeEyeDeformation(original.slice(), rig.basis, { ...values, opening: 0, tail: 0 },
      selection, values.style, normals, indices, rig.spheres, lid);
    for (let i = 0; i < edited.length; i++) edited[i] += eye.positions[i] - original[i];
  }
  const expectsEyeMovement = [eyeEdit.L, eyeEdit.R].some(({ enabled, values }) =>
    enabled || ['inner', 'outer', 'lower', 'upper'].some((key) => values[key] > 0));
  if (expectsEyeMovement && !edited.some((value, i) => Math.abs(value - original[i]) > 2e-6)) {
    return result(false);
  }
  const refinedNose = transferRefined(sources, noseOffset, 3);
  const refinedGlb = transferRefined(sources, glbOffset, 3);
  for (let i = 0; i < edited.length; i++) edited[i] += refinedNose[i] + refinedGlb[i];
  const safe = (positions, allowNeutral = false, eyeballTolerance = 2e-6) => {
    if (allowNeutral && positions.every((value, i) => Math.abs(value - original[i]) <= 2e-6)) return true;
    const guarded = clampToEyeballs(original, positions.slice(), rig.spheres);
    return guarded.every((value, i) => Math.abs(value - positions[i]) <= eyeballTolerance) &&
      scan(original, positions, indices);
  };
  if (!keys.includes(WEIGHT)) return result(safe(edited, false, FACE_EYEBALL_TOLERANCE));
  const refinedWeight = transferRefined(sources, weightOffset, 3);
  return result(safe(edited, true) && safe(Float32Array.from(edited, (value, i) => value + refinedWeight[i])));
}
