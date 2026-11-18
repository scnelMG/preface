// Audit the actual refined-eye rendering path with a simultaneous weight morph.
// Called with one local GLB path and JSON skin arrays on stdin; output contains counts only.
import fs from 'node:fs';
import { eyeRigFromGlb, measureEyeLimits } from './auto_eye_limits.mjs';
import { composeEyeDeformation, FOLD_DEFAULT, refineEyeMesh, transferRefined } from '../engine/eye-edit.mjs';
import { scanComposedMesh } from './audit_weight_shape.mjs';

export function auditWeightEye(bytes, input) {
  const { rig, review: assetReview, meshSha256 } = eyeRigFromGlb(bytes);
  const review = assetReview ?? (input.synthetic && input.sampleSha === meshSha256 &&
    input.review?.L === 'absent' && input.review?.R === 'absent'
    ? input.review : null);
  if (!review) return { eligible: false, reason: 'eye review missing' };
  const refined = refineEyeMesh({
    positions: Float32Array.from(input.base), normals: Float32Array.from(input.normals),
    indices: Uint32Array.from(input.index),
  }, rig.basis, 2);
  if (refined.positions.length !== rig.base.length ||
      refined.positions.some((value, i) => Math.abs(value - rig.base[i]) > 1e-7)) {
    return { eligible: false, reason: 'refined skin mismatch' };
  }
  const weight = {
    neg: transferRefined(refined.sources, Float32Array.from(input.negative), 3),
    pos: transferRefined(refined.sources, Float32Array.from(input.positive), 3),
  };
  const limits = measureEyeLimits(rig, review);
  const failures = {};
  let samples = 0, overlapSamples = 0, maxOverlapRatio = 0;
  for (const control of ['inner', 'outer', 'lower', 'upper', 'height']) {
    const maximum = limits[control === 'height' ? 'inout:height' : control] ?? 0;
    if (!maximum) continue;
    for (const side of ['neg', 'pos']) for (const eyeLevel of [0.25, 0.5, 0.75, 1]) for (const weightLevel of [0.25, 0.5, 0.75, 1]) {
      const fold = control === 'height';
      const values = { height: 20, crease: fold ? FOLD_DEFAULT : 0,
        inner: 0, outer: 0, lower: 0, upper: 0, [control]: maximum * eyeLevel,
        eligible: fold ? { L: review.L === 'absent', R: review.R === 'absent' } : { L: false, R: false },
        joinStyles: { L: 'inout', R: 'inout' } };
      const eye = composeEyeDeformation(rig.base, rig.basis, values, 'both', 'inout',
        rig.normals, rig.indices, rig.spheres, rig.lid).positions;
      let overlap = false;
      for (let i = 0; i < eye.length; i += 3) {
        if (Math.hypot(...[0, 1, 2].map((k) => eye[i + k] - rig.base[i + k])) <= rig.basis[0].width * 1e-7) continue;
        const shift = weightLevel * Math.hypot(weight[side][i], weight[side][i + 1], weight[side][i + 2]);
        overlap ||= shift > 2e-6;
        maxOverlapRatio = Math.max(maxOverlapRatio, shift / rig.basis[0].width);
      }
      if (overlap) overlapSamples++;
      const edited = Float32Array.from(eye, (value, i) => value + weight[side][i] * weightLevel);
      // Eye-only folds are already governed by the eye engine. Test defects introduced by weight on that approved state.
      const checked = scanComposedMesh({ base: Array.from(eye), edited: Array.from(edited),
        index: Array.from(rig.indices) });
      samples++;
      if (!checked.valid) failures[control] = (failures[control] ?? 0) + 1;
    }
  }
  return { eligible: true, samples, overlapSamples, maxOverlapRatio: +maxOverlapRatio.toFixed(4), failures };
}

if (process.argv[1] && process.argv[2]) {
  try {
    console.log(JSON.stringify(auditWeightEye(fs.readFileSync(process.argv[2]),
      JSON.parse(fs.readFileSync(0, 'utf8')))));
  } catch {
    console.log(JSON.stringify({ eligible: false, reason: 'eye composite audit unavailable' }));
  }
}
