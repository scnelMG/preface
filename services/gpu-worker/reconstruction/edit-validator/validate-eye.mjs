import { createHash } from 'node:crypto';
import { eyeRigFromGlb } from '../tools/auto_eye_limits.mjs';
import { composeEyeDeformation, isEyeStateSafe, TRIM_LIMIT_CONTROLS } from '../engine/eye-edit.mjs';
import { introducedSelfIntersectionCount } from '../engine/mesh-audit.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const reviews = new Set(['present', 'absent']);

export function eyeEditSides(state, review) {
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

/** The Spring service checks per-control limits. This check verifies the complete saved eye state on the approved mesh. */
export async function validateEyeEdit(input, fetchAsset) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.meshUrl !== 'string' || typeof input.rigUrl !== 'string' ||
      !sha(input.meshSha256) || !sha(input.rigSha256) || !sha(input.eyePartsSha256) ||
      !reviews.has(input.review?.L) || !reviews.has(input.review?.R) ||
      !input.eyeEdit || typeof input.eyeEdit !== 'object' ||
      ['L', 'R'].some((side) => {
        const eye = input.eyeEdit[side];
        return !eye || typeof eye.enabled !== 'boolean' ||
          !['inline', 'inout', 'outline'].includes(eye.style) ||
          !eye.values || !Array.isArray(eye.curve) || eye.curve.length !== 5 ||
          ['height', 'crease', 'inner', 'outer', 'lower', 'upper'].some((key) =>
            !Number.isFinite(eye.values[key]) || eye.values[key] < 0 || eye.values[key] > 100) ||
          eye.curve.some((v) => !Number.isFinite(v));
      })) throw Error('invalid eye request');
  const [mesh, rigBytes] = await Promise.all([fetchAsset(input.meshUrl), fetchAsset(input.rigUrl)]);
  if (sha256(mesh) !== input.meshSha256 || sha256(rigBytes) !== input.rigSha256) {
    throw Error('asset checksum mismatch');
  }
  const { rig, review, skins } = eyeRigFromGlb(mesh);
  const jsonLength = mesh.readUInt32LE(12);
  const glb = JSON.parse(mesh.subarray(20, 20 + jsonLength).toString('utf8'));
  if (glb.asset?.extras?.['live-mirror']?.eye_parts_sha256 !== input.eyePartsSha256 ||
      review?.L !== input.review.L || review?.R !== input.review.R ||
      rig.spheres.length !== 2) throw Error('eye approval mismatch');
  const sides = eyeEditSides(input.eyeEdit, review);
  const activeSides = sides.filter(({ values }) => values.crease > 0 ||
    TRIM_LIMIT_CONTROLS.some((control) => values[control] > 0));
  const valid = isEyeStateSafe(rig, sides) && (!activeSides.length || skins.every(({ positions, normals, indices, lid }) => {
    const edited = positions.slice();
    for (const { selection, values } of activeSides) {
      const { positions: after } = composeEyeDeformation(
        selection === 'both' ? positions : positions.slice(), rig.basis,
        { ...values, opening: 0, tail: 0 }, selection, values.style, normals, indices, rig.spheres, lid,
      );
      for (let i = 0; i < edited.length; i++) edited[i] += after[i] - positions[i];
    }
    const moved = new Set();
    for (let i = 0; i < edited.length; i++) {
      if (Math.abs(edited[i] - positions[i]) > 2e-6) moved.add(Math.floor(i / 3));
    }
    return introducedSelfIntersectionCount(positions, edited, indices, moved) === 0;
  }));
  return { valid,
    meshSha256: input.meshSha256, rigSha256: input.rigSha256,
    eyePartsSha256: input.eyePartsSha256 };
}
