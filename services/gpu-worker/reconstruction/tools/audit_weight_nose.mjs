// Audit the generated-model semantic nose rig with a simultaneous weight morph.
// One private GLB and its matching rig are read locally; stdout contains counts only.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as E from '../engine/nose-engine.mjs';
import { POC_MORPH_KEYS } from '../engine/effect-codes.mjs';
import { parseEditable } from '../engine/model-loader.mjs';
import { auditNoseOnSkin, checkNoseEdit, noseParamsForWeights, parseSkinGlb } from '../engine/glb-nose.mjs';

const CODES = ['nose.bridge_height', 'nose.tip_projection', 'nose.tip_height',
  'nose.tip_rotation', 'nose.alar_width'];

export function auditWeightNose(glbBytes, source, input) {
  const neutral = checkNoseEdit(glbBytes, source, {});
  if (!neutral.valid) return { eligible: false, reason: 'nose approval binding failed' };
  const skin = parseSkinGlb(glbBytes);
  const binary = Buffer.from(source.nose.bin, 'base64');
  if (createHash('sha256').update(binary).digest('hex') !== source.nose.json.editable_sha256) {
    return { eligible: false, reason: 'nose rig checksum mismatch' };
  }
  const data = parseEditable(source.nose.json,
    binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength));
  const noseRig = E.buildRig(data.model, data.positions, data.normals, data.index, source.nose.engine);
  if (skin.positions.length !== input.negative.length || skin.positions.length !== input.positive.length) {
    return { eligible: false, reason: 'weight morph length mismatch' };
  }
  const failures = {};
  let samples = 0;
  for (const code of CODES) for (const sign of [-1, 1]) {
    const bounds = source.nose.limits?.[POC_MORPH_KEYS[code]];
    if (!Array.isArray(bounds) || bounds[sign < 0 ? 0 : 1] === 0) continue;
    for (const weightSide of ['negative', 'positive']) for (const noseLevel of [0.25, 0.5, 0.75, 1]) for (const weightLevel of [0.25, 0.5, 0.75, 1]) {
      const params = noseParamsForWeights({ [code]: sign * noseLevel }, source.nose.limits);
      const changed = E.evaluate(data.model, noseRig, data.positions, data.normals, params);
      const canonical = E.validate(noseRig, data.positions, changed, data.index);
      const offset = Float32Array.from(input[weightSide], (value) => value * weightLevel);
      const skinResult = auditNoseOnSkin(skin, source, data.positions, changed, [], offset);
      samples++;
      if (!canonical.valid || !skinResult.valid) {
        const reason = !canonical.valid ? 'canonical geometry' : skinResult.protectedAffectedVertices
          ? 'protected region' : skinResult.selfIntersections ? 'new self-intersection' : 'skin geometry';
        const key = `${code}:${reason}`;
        failures[key] = (failures[key] ?? 0) + 1;
      }
    }
  }
  return { eligible: true, samples, failures };
}

if (process.argv[1] && process.argv[2] && process.argv[3]) {
  try {
    console.log(JSON.stringify(auditWeightNose(fs.readFileSync(process.argv[2]),
      JSON.parse(fs.readFileSync(process.argv[3], 'utf8')),
      JSON.parse(fs.readFileSync(0, 'utf8')))));
  } catch {
    console.log(JSON.stringify({ eligible: false, reason: 'nose composite audit unavailable' }));
  }
}
