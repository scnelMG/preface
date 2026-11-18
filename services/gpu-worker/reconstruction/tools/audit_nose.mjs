// Check each model's emitted GLB surface against its own rig limits before exposing edit support.
// Usage: node tools/audit_nose.mjs work/<id>  (writes model/nose_audit.json)
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as E from '../engine/nose-engine.mjs';
import { parseEditable } from '../engine/model-loader.mjs';
import { parseSkinGlb, auditNoseOnSkin, checkNoseEdit, noseParamsForWeights } from '../engine/glb-nose.mjs';
import { sampledNoseRanges } from '../engine/sampled-nose-range.mjs';

const modelDir = path.join(process.argv[2] || '', 'model');
if (!process.argv[2] || !fs.existsSync(modelDir)) throw Error('model directory required');
const glbBytes = fs.readFileSync(path.join(modelDir, 'head.glb'));
const skin = parseSkinGlb(glbBytes);
const rigBytes = fs.readFileSync(path.join(modelDir, 'rig.json'));
const rig = JSON.parse(rigBytes.toString('utf8'));
const neutral = checkNoseEdit(glbBytes, rig, {});
if (!neutral.valid) throw Error('invalid neutral model');
const binary = Buffer.from(rig.nose.bin, 'base64');
const data = parseEditable(rig.nose.json, binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength));
const editor = E.createEditor(data.model, data.positions, data.normals, data.index, rig.nose.limits, rig.nose.engine);
const checks = {};
const evaluate = (params) => {
  const applied = E.evaluate(data.model, editor.rig, data.positions, data.normals,
    { ...E.zeroParams(), edge_blend: 50, ...params });
  const canonical = E.validate(editor.rig, data.positions, applied, data.index);
  const skinResult = auditNoseOnSkin(skin, rig, data.positions, applied);
  return { valid: canonical.valid && skinResult.valid && skinResult.affectedVertices > 0,
    canonicalValid: canonical.valid, skinValid: skinResult.valid,
    affectedVertices: skinResult.affectedVertices, selfIntersections: skinResult.selfIntersections };
};
const checkFailures = {};
for (const effect of E.NOSE_PARAMS.filter((p) => p.id !== 'edge_blend')) {
  const limits = rig.nose.limits[effect.id];
  if (!Array.isArray(limits) || limits.length !== 2 || limits.some((v) => !Number.isFinite(v))) {
    throw Error(`invalid limit: ${effect.id}`);
  }
  checks[effect.id] = limits.map((limit, side) => {
    const result = limit !== 0 ? evaluate({ [effect.id]: limit }) : { valid: false, reason: 'zero limit' };
    if (!result.valid) (checkFailures[effect.id] ??= [null, null])[side] = result;
    return result.valid;
  });
}
// Independent limits do not promise that their combination is safe.
const combos = [
  { tip_projection: rig.nose.limits.tip_projection[1], tip_height: rig.nose.limits.tip_height[0] },
  { tip_projection: rig.nose.limits.tip_projection[0], alar_width: rig.nose.limits.alar_width[1] },
  { tip_height: rig.nose.limits.tip_height[1], alar_flare: rig.nose.limits.alar_flare[1] },
];
const combinedResults = combos.map(evaluate);
const combined = combinedResults.map((result) => result.valid);
const { ranges: sampledRanges, firstFailures: sampledFailures } = sampledNoseRanges((weights) =>
  Object.keys(weights).length === 0 ? neutral : evaluate(noseParamsForWeights(weights, rig.nose.limits)));
const report = { version: 2, fitSha: skin.fitSha, meshSha256: skin.meshSha256,
  rigSha256: createHash('sha256').update(rigBytes).digest('hex'), engine: rig.nose.engine,
  rigVersion: rig.nose.json.rig_version, topologyVersion: rig.nose.json.topology_version,
  checkedAt: new Date().toISOString(), checks, checkFailures, combined, combinedResults,
  sampledStep: 0.1, sampledRanges, sampledFailures,
  approvedForService: false,
  sampleChecksPassed: Object.values(checks).every((sides) => sides.every(Boolean)) && combined.every(Boolean) };
if (!process.argv.includes('--evaluate-only')) fs.writeFileSync(path.join(modelDir, 'nose_audit.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ sampleChecksPassed: report.sampleChecksPassed,
  failedEffects: Object.entries(checks).filter(([, sides]) => sides.includes(false)).map(([id]) => id),
  failedCombinations: combined.filter((ok) => !ok).length }));
