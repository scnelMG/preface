// Conservative first-use candidate. Spring still checks the same assets before opening edits.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { checkNoseEdit } from '../engine/glb-nose.mjs';
import { RELATIVE_EDIT_LEVELS, scanEditLimit } from '../engine/edit-limit.mjs';

const CODES = [
  'nose.bridge_height', 'nose.tip_projection', 'nose.tip_height',
  'nose.tip_rotation', 'nose.alar_width',
];
const BOUNDARY_CHECKS = 3;
// check result fields kept when a sample fails (S15P31B204-671, plan S6-1: failures used to say only "eligible: false")
const FLAGS = ['valid', 'canonicalValid', 'canonicalReason', 'skinValid', 'protectedRegionsPresent', 'affectedVertices',
  'protectedAffectedVertices', 'selfIntersections'];

const flags = (result) => Object.fromEntries(FLAGS.filter((k) => result?.[k] !== undefined && result?.[k] !== null).map((k) => [k, result[k]]));
function safeSample(check, code, sign, limit, tried) {
  const at = `${code}=${sign * limit}`;
  let result;
  try { result = check({ [code]: sign * limit }); }
  catch (error) {
    if (['unsupported edit weight', 'unsupported edit direction'].includes(error.message)) {
      tried.push({ limit, at, error: error.message });
      return { valid: false, reason: 'unavailable' };
    }
    throw error;
  }
  if (result.valid && result.protectedRegionsPresent && result.protectedAffectedVertices === 0 && result.affectedVertices > 0) return { valid: true };
  tried.push({ limit, at, ...flags(result) });
  return {
    valid: false,
    reason: !result.protectedRegionsPresent || result.affectedVertices === 0 ? 'unavailable' : 'geometry',
  };
}

function directionalLimit(check) {
  const coarse = scanEditLimit(RELATIVE_EDIT_LEVELS, check);
  if (coarse.failedAt === null || coarse.reason !== 'geometry') return coarse.accepted;
  // Spring rechecks the exact endpoints and the validator accepts three decimal places.
  let low = Math.round(coarse.accepted * 1000), high = Math.round(coarse.failedAt * 1000);
  for (let i = 0; i < BOUNDARY_CHECKS; i++) {
    const middle = Math.floor((low + high) / 2);
    if (middle === low) break;
    const result = check(middle / 1000);
    if (result.valid) low = middle;
    else if (result.reason === 'geometry') high = middle;
    else break;
  }
  return low / 1000;
}

export function directionalCandidate(check, tried = []) {
  const neutral = check({});
  if (!neutral.valid || !neutral.protectedRegionsPresent) {
    tried.push({ at: 'neutral', ...flags(neutral) });
    return null;
  }
  const ranges = {};
  for (const code of CODES) {
    const negative = directionalLimit((level) => safeSample(check, code, -1, level, tried));
    const positive = directionalLimit((level) => safeSample(check, code, 1, level, tried));
    if (negative || positive) ranges[code] = { min: negative ? -negative : 0, max: positive };
  }
  return Object.keys(ranges).length ? { neutral, ranges } : null;
}

const summary = (t) => `${t.at}${t.error ? ` ${t.error}` : ''} ${FLAGS.filter((k) => k in t && k !== 'valid')
  .map((k) => `${k}=${t[k]}`).join(' ')}`.trim().slice(0, 200);

export function approvalCandidate(mesh, rigBytes) {
  const rig = JSON.parse(rigBytes.toString('utf8'));
  const tried = [];
  const selected = directionalCandidate((weights) => checkNoseEdit(mesh, rig, weights), tried);
  if (!selected) {
    const last = tried.at(-1) ?? {};
    return { eligible: false, reason: summary(last), tried };
  }
  const { neutral, ranges } = selected;
  return { eligible: true,
    binding: { meshSha256: neutral.meshSha256, rigSha256: createHash('sha256').update(rigBytes).digest('hex'),
      fitSha: neutral.fitSha, engine: neutral.engine, rigVersion: neutral.rigVersion,
      topologyVersion: neutral.topologyVersion },
    ranges,
    ...(tried.length ? { narrowedBy: tried } : {}),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const dir = process.argv[2];
    if (!dir) throw Error('model directory required');
    console.log(JSON.stringify(approvalCandidate(fs.readFileSync(path.join(dir, 'head.glb')),
      fs.readFileSync(path.join(dir, 'rig.json')))));
  } catch (error) {
    // e.g. a rig/model version mismatch or a corrupt GLB: say which, not just "not eligible"
    console.log(JSON.stringify({ eligible: false, reason: `${error?.name ?? 'Error'}: ${error?.message ?? error}`.slice(0, 200) }));
  }
}
