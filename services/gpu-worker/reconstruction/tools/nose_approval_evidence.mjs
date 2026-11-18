// Read-only 3D-308 handoff: numeric samples are evidence, never service approval.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { checkNoseEdit } from '../engine/glb-nose.mjs';
import { sampledNoseRanges } from '../engine/sampled-nose-range.mjs';

const CODES = [
  'nose.bridge_height', 'nose.tip_projection', 'nose.tip_height',
  'nose.tip_rotation', 'nose.alar_width',
];

export function assessNoseApproval(check) {
  const { ranges, firstFailures } = sampledNoseRanges(check, 10, CODES);
  const pairwiseFailures = [];
  const entries = Object.entries(ranges);
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [left, a] = entries[i], [right, b] = entries[j];
      for (const x of a) for (const y of b) {
        if (x === 0 || y === 0) continue;
        const weights = { [left]: x, [right]: y };
        let result;
        try {
          result = check(weights);
        } catch (error) {
          if (!['unsupported edit weight', 'unsupported edit direction'].includes(error.message)) throw error;
          result = { valid: false, reason: error.message };
        }
        if (result.valid !== true) pairwiseFailures.push({ weights, reason: result.reason ?? 'unsafe final mesh' });
      }
    }
  }
  const combinedFailures = [];
  if (entries.length >= 3) {
    for (let bits = 0; bits < 2 ** entries.length; bits++) {
      const weights = Object.fromEntries(entries.map(([code, bounds], i) => [code, bounds[(bits >> i) & 1]]));
      const result = check(weights);
      if (result.valid !== true) combinedFailures.push({ weights, reason: result.reason ?? 'unsafe final mesh' });
    }
  }
  return { candidateRanges: ranges, firstFailures, pairwiseFailures, combinedFailures,
    approvedForService: false, visualAndNonTargetReviewRequired: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const modelDir = process.argv[2];
  if (!modelDir) throw Error('model directory required');
  const mesh = fs.readFileSync(path.join(modelDir, 'head.glb'));
  const rigBytes = fs.readFileSync(path.join(modelDir, 'rig.json'));
  const rig = JSON.parse(rigBytes.toString('utf8'));
  const check = (weights) => checkNoseEdit(mesh, rig, weights);
  const neutral = check({});
  if (!neutral.valid) throw Error('invalid neutral model');
  const evidence = assessNoseApproval(check);
  console.log(JSON.stringify({
    meshSha256: neutral.meshSha256,
    rigSha256: createHash('sha256').update(rigBytes).digest('hex'),
    fitSha: neutral.fitSha, engine: neutral.engine,
    rigVersion: neutral.rigVersion, topologyVersion: neutral.topologyVersion,
    ...evidence,
  }, null, 2));
}
