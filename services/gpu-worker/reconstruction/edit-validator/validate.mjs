import { createHash } from 'node:crypto';
import { checkNoseEdit } from '../engine/glb-nose.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const validWeights = (weights) => weights && typeof weights === 'object' && !Array.isArray(weights) &&
  Object.entries(weights).every(([code, value]) => code.startsWith('nose.') &&
    typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1 &&
    Number(value.toFixed(3)) === value);

function actualEdit(mesh, rig, current, candidate, currentPoints, candidatePoints, checker) {
  const before = checker(mesh, rig, current, currentPoints);
  if (!before.valid) throw Error('invalid current mesh');
  const requested = checker(mesh, rig, candidate, candidatePoints);
  if (requested.meshSha256 !== before.meshSha256) throw Error('checked model mismatch');
  if (requested.valid) return { ...requested, actualWeights: candidate, actualPointStrokes: candidatePoints, limited: false };
  if (JSON.stringify(currentPoints) !== JSON.stringify(candidatePoints)) return { ...requested, valid: false };

  const codes = new Set([...Object.keys(current), ...Object.keys(candidate)]);
  const between = (factor, digits = 6) => Object.fromEntries([...codes].map((code) =>
    [code, Number(((current[code] ?? 0) + ((candidate[code] ?? 0) - (current[code] ?? 0)) * factor).toFixed(digits))]));
  let low = 0, high = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (low + high) / 2;
    if (checker(mesh, rig, between(mid), currentPoints).valid) low = mid;
    else high = mid;
  }
  const actualWeights = between(low * 0.95, 3); // Spring stores relative weights to three decimals.
  if ([...codes].every((code) => (actualWeights[code] ?? 0) === (current[code] ?? 0))) {
    return { ...requested, valid: false };
  }
  const checked = checker(mesh, rig, actualWeights, currentPoints);
  return checked.valid ? { ...checked, actualWeights, actualPointStrokes: currentPoints, limited: true } : { ...checked, valid: false };
}

/** Inspect one complete state; URLs are transport only and never appear in the result. */
export async function validateEdit(input, fetchAsset = fetch, checker = checkNoseEdit) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.meshUrl !== 'string' || typeof input.rigUrl !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.meshSha256) || !/^[a-f0-9]{64}$/.test(input.rigSha256) ||
      !validWeights(input.currentWeights) || !validWeights(input.candidateWeights)) {
    throw Error('invalid edit request');
  }
  const [mesh, rigBytes] = await Promise.all([fetchAsset(input.meshUrl), fetchAsset(input.rigUrl)]);
  if (sha256(mesh) !== input.meshSha256 || sha256(rigBytes) !== input.rigSha256) {
    throw Error('asset checksum mismatch');
  }
  const currentPoints = input.currentPointStrokes ?? [], candidatePoints = input.candidatePointStrokes ?? [];
  if (!Array.isArray(currentPoints) || !Array.isArray(candidatePoints)) throw Error('invalid point strokes');
  const result = actualEdit(mesh, JSON.parse(rigBytes.toString('utf8')),
    input.currentWeights, input.candidateWeights, currentPoints, candidatePoints, checker);
  if (result.meshSha256 !== input.meshSha256) throw Error('checked model mismatch');
  const { protectedAffectedVertices, protectedRegionsPresent, ...response } = result;
  return { ...response, rigSha256: input.rigSha256 };
}

export async function fetchSignedAsset(url, allowedHost, maxBytes) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.host !== allowedHost || target.username || target.password) {
    throw Error('untrusted asset URL');
  }
  const response = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok || !response.body) throw Error('asset fetch failed');
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > maxBytes) {
      await response.body.cancel().catch(() => {});
      throw Error('asset too large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}
