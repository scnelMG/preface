// Run next to private development assets. Candidate and approval files stay private.
import fs from 'node:fs';
import { createEditor, ENGINE_VERSION } from '../engine/nose-engine.mjs';
import { calibratedBridgeLimits } from '../engine/nose-profile-limits.mjs';
import { parseEditable } from '../engine/model-loader.mjs';
import { approvalCandidate } from './auto_nose_candidate.mjs';

const [meshPath, originalPath, candidatePath, approvalPath, schemaVersion, bridgeCap] = process.argv.slice(2);
try {
  const original = fs.readFileSync(originalPath, 'utf8');
  const legacyField = /("engine"\s*:\s*")nose-engine-0\.12\.0(")/g;
  const rig = JSON.parse(original);
  const engine = rig.nose?.engine;
  let candidate = original;
  if (engine !== ENGINE_VERSION) {
    if (engine !== 'nose-engine-0.12.0' ||
        (bridgeCap !== undefined && bridgeCap !== 'profile') ||
        [...original.matchAll(legacyField)].length !== 1) throw Error('unsupported original rig');
    candidate = original.replace(legacyField, (_, start, end) => start + ENGINE_VERSION + end);
  }
  if (bridgeCap !== undefined) {
    const limit = rig.nose?.limits?.dorsum_height;
    if (!Array.isArray(limit) || limit.length !== 2 || !limit.every(Number.isFinite)) {
      throw Error('invalid bridge limit');
    }
    let calibrated;
    if (bridgeCap === 'profile') {
      const binary = Buffer.from(rig.nose.bin, 'base64');
      const data = parseEditable(rig.nose.json,
        binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength));
      const editor = createEditor(data.model, data.positions, data.normals, data.index, rig.nose.limits);
      calibrated = calibratedBridgeLimits(data, editor.rig, limit);
    } else {
      const cap = Number(bridgeCap);
      const bound = cap < 0 ? 0 : 1;
      const previous = limit[bound];
      if (!Number.isFinite(cap) || cap === 0 || Math.sign(cap) !== Math.sign(previous) ||
          Math.abs(cap) > Math.abs(previous)) throw Error('invalid bridge limit');
      calibrated = limit.slice();
      calibrated[bound] = cap;
    }
    if (calibrated.some((value, i) => value !== limit[i])) {
      const number = '-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';
      const field = new RegExp(`("dorsum_height"\\s*:\\s*\\[\\s*)(${number})(\\s*,\\s*)(${number})(\\s*\\])`, 'g');
      const matches = [...candidate.matchAll(field)];
      if (matches.length !== 1 || Number(matches[0][2]) !== limit[0] || Number(matches[0][4]) !== limit[1]) {
        throw Error('ambiguous bridge limit');
      }
      candidate = candidate.replace(field, (_, start, lower, comma, upper, end) => {
        const nextLower = calibrated[0] === limit[0] ? lower : calibrated[0];
        const nextUpper = calibrated[1] === limit[1] ? upper : calibrated[1];
        return `${start}${nextLower}${comma}${nextUpper}${end}`;
      });
    }
  }
  const approval = approvalCandidate(fs.readFileSync(meshPath), Buffer.from(candidate));
  if (!approval.eligible) throw Error('no safe adjustment range');
  fs.writeFileSync(candidatePath, candidate, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(approvalPath, JSON.stringify({ schemaVersion, binding: approval.binding, ranges: approval.ranges }),
    { flag: 'wx', mode: 0o600 });
} catch {
  console.error('Could not prepare a validated nose rig.');
  process.exitCode = 1;
}
