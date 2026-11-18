// Inspect a saved simulation against its original GLB and rig without printing face data.
// Usage: node tools/check_saved_edit_parts.mjs <model-dir> <simulation-json>
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { checkNoseEdit } from '../engine/glb-nose.mjs';
import { POC_MORPH_KEYS } from '../engine/effect-codes.mjs';
import {
  composeEyeDeformation, creaseHeights, eyeRegionCount, isEyeStateSafe,
} from '../engine/eye-edit.mjs';
import { eyeRigFromGlb } from './auto_eye_limits.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const controls = ['height', 'crease', 'inner', 'outer', 'lower', 'upper'];
const trims = ['inner', 'outer', 'lower', 'upper'];

function eyeSides(state, review) {
  const eligible = { L: review.L === 'absent', R: review.R === 'absent' };
  const values = (side) => ({ ...state[side].values,
    crease: state[side].enabled ? state[side].values.crease : 0,
    style: state[side].style,
    curves: { L: state.L.curve, R: state.R.curve },
    joinStyles: { L: state.L.style, R: state.R.style }, eligible });
  return JSON.stringify(state.L) === JSON.stringify(state.R)
    ? [{ selection: 'both', values: values('L') }]
    : ['L', 'R'].map((side) => ({ selection: side, values: values(side) }));
}

function checkEyeState(state, review, limits) {
  if (!state || !limits || typeof limits !== 'object') throw Error('missing eye state or approval');
  if (trims.some((key) => limits[key] === undefined) ||
      Object.values(limits).some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
    throw Error('invalid eye approval');
  }
  for (const side of ['L', 'R']) {
    const eye = state[side];
    if (typeof eye?.enabled !== 'boolean' || !['inline', 'inout', 'outline'].includes(eye.style) ||
        !eye.values || !Array.isArray(eye.curve) || eye.curve.length !== 5 ||
        eye.curve.some((v) => !Number.isFinite(v) || v < 0.005 || v > 0.36) ||
        controls.some((key) => !Number.isFinite(eye.values[key]) || eye.values[key] < 0 || eye.values[key] > 100) ||
        eye.values.crease !== 65) throw Error('invalid saved eye state');
    const designed = creaseHeights(eye.values.height, eye.style);
    if (eye.curve.some((v, i) => Math.abs(v - designed[i]) > 1e-6) ||
        trims.some((key) => eye.values[key] > (limits[key] ?? 0)) ||
        (eye.enabled && (review[side] !== 'absent' ||
          !Number.isFinite(limits[`${eye.style}:height`]) ||
          limits[`${eye.style}:height`] <= 0 ||
          eye.values.height > limits[`${eye.style}:height`]))) {
      throw Error('eye state outside approved range');
    }
  }
}

/** Component checks only: the final mesh with eye and nose added together needs separate review. */
export function checkSavedEditParts(glbBytes, rigBytes, simulation, noseCheck = checkNoseEdit) {
  const state = simulation?.morphState;
  const weights = state?.weights;
  if (!state || !weights || typeof weights !== 'object' || Array.isArray(weights) ||
      Object.entries(weights).some(([code, value]) => !POC_MORPH_KEYS[code] ||
        !Number.isFinite(value) || Math.abs(value) > 1)) {
    throw Error('invalid saved morph state');
  }
  const pointStrokes = state.pointStrokes ?? [];
  if (!Array.isArray(pointStrokes)) throw Error('invalid point strokes');
  const noseChecked = Object.values(weights).some((v) => v !== 0) || pointStrokes.length > 0;
  const eyeChecked = state.eyeEdit !== null && state.eyeEdit !== undefined;
  if (!noseChecked && !eyeChecked) throw Error('no saved edit to inspect');

  const modelRig = JSON.parse(rigBytes.toString('utf8'));
  let noseValid = null, eyeSafe = null, eyeBindingVerified = false;
  if (eyeChecked) {
    const approved = simulation.eyeCapabilities;
    const versions = [
      [approved?.schemaVersion, state.schemaVersion],
      [approved?.engine, modelRig.nose?.engine],
      [approved?.rigVersion, modelRig.nose?.json?.rig_version],
      [approved?.topologyVersion, modelRig.nose?.json?.topology_version],
    ];
    const { rig, review, meshSha256 } = eyeRigFromGlb(glbBytes);
    const jsonLength = glbBytes.readUInt32LE(12);
    const glb = JSON.parse(glbBytes.subarray(20, 20 + jsonLength).toString('utf8'));
    const partsSha = glb.asset?.extras?.['live-mirror']?.eye_parts_sha256;
    if (!review || !approved || versions.some(([expected, actual]) =>
      typeof expected !== 'string' || !expected || expected !== actual) ||
        meshSha256 !== approved.meshSha256 ||
        sha256(rigBytes) !== approved.rigSha256 ||
        !/^[a-f0-9]{64}$/.test(partsSha) ||
        partsSha !== simulation.eyePartsSha256 || partsSha !== approved.eyePartsSha256 ||
        review.L !== simulation.eyeReview?.L || review.R !== simulation.eyeReview?.R ||
        rig.spheres.length !== 2 || eyeRegionCount(rig, 'L') === 0 || eyeRegionCount(rig, 'R') === 0) {
      throw Error('eye model and approval mismatch');
    }
    eyeBindingVerified = true;
    checkEyeState(state.eyeEdit, review, approved.limits);
    const sides = eyeSides(state.eyeEdit, review);
    eyeSafe = isEyeStateSafe(rig, sides);
    const requested = ['L', 'R'].some((side) => state.eyeEdit[side].enabled ||
      trims.some((key) => state.eyeEdit[side].values[key] > 0));
    if (eyeSafe && requested) {
      const moved = sides.some(({ selection, values }) => {
        const result = composeEyeDeformation(rig.base, rig.basis,
          { ...values, opening: 0, tail: 0 }, selection, values.style,
          rig.normals, rig.indices, rig.spheres, rig.lid);
        return result.positions.some((v, i) => Math.abs(v - rig.base[i]) > 1e-8);
      });
      eyeSafe = moved;
    }
  }
  if (noseChecked) {
    const checked = noseCheck(glbBytes, modelRig, weights, pointStrokes);
    noseValid = checked.valid === true;
    if (eyeChecked && checked.meshSha256 !== simulation.eyeCapabilities.meshSha256) {
      throw Error('nose and eye checked different models');
    }
  }
  return { componentChecksPass: noseValid !== false && eyeSafe !== false,
    eyeBindingVerified, noseChecked, noseValid, eyeChecked, eyeSafe,
    eyeSkinScope: eyeChecked ? 'largest-eye-region-skin' : null,
    jointMeshChecked: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const dir = process.argv[2], source = process.argv[3];
    if (!dir || !source) throw Error('model directory and simulation JSON required');
    const simulation = JSON.parse(fs.readFileSync(source, 'utf8'));
    const result = checkSavedEditParts(
      fs.readFileSync(path.join(dir, 'head.glb')),
      fs.readFileSync(path.join(dir, 'rig.json')),
      simulation.data ?? simulation,
    );
    console.log(JSON.stringify(result));
    if (!result.componentChecksPass) process.exitCode = 1;
  } catch {
    // A path, URL, simulation title or other private input must not appear in output.
    console.error('Saved edit geometry check failed; inspect inputs in the secure environment.');
    process.exitCode = 1;
  }
}
