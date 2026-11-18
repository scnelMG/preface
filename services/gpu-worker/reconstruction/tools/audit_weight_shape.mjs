import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { validate } from '../engine/nose-engine.mjs';
import { introducedSelfIntersectionCount } from '../engine/mesh-audit.mjs';
import { RELATIVE_EDIT_LEVELS as LEVELS, scanEditLimit } from '../engine/edit-limit.mjs';
const PROTECTED = ['left_eye', 'right_eye', 'upper_lip', 'lower_lip', 'nose_region', 'ears'];

function scanWithNarrowFallback(check) {
  const result = scanEditLimit(LEVELS, check);
  if (result.accepted || result.failedAt !== LEVELS[0] ||
      ['no visible movement', 'invalid composed mesh', 'protected region moves'].includes(result.reason)) return result;
  // Keep the existing range when it passes. On a first-sample failure, verify smaller visible steps.
  return { ...result, accepted: scanEditLimit([0.025, 0.05], check).accepted };
}

export function scanWeightShape({ base, negative, positive, index, template, regions }) {
  if (!Array.isArray(base) || !Array.isArray(negative) || !Array.isArray(positive) ||
      !Array.isArray(index) || !Array.isArray(template) || base.length % 3 ||
      negative.length !== base.length || positive.length !== base.length ||
      template.length * 3 !== base.length || index.length % 3 ||
      ![base, negative, positive].every((values) => values.every(Number.isFinite)) ||
      !index.every((i) => Number.isInteger(i) && i >= 0 && i < template.length) ||
      !template.every((i) => Number.isInteger(i) && i >= 0) ||
      !PROTECTED.every((name) => Array.isArray(regions?.[name]) && regions[name].length)) {
    return { eligible: false, reason: 'missing geometry or protected regions' };
  }
  if (!PROTECTED.every((name) => regions[name].every((i) => Number.isInteger(i) && i >= 0))) {
    return { eligible: false, reason: 'invalid protected regions' };
  }
  const protectedIds = new Set(PROTECTED.flatMap((name) => regions[name]));
  const original = Float32Array.from(base);
  const triangles = Uint32Array.from(index);
  const evaluate = (delta, level) => {
    const edited = Float32Array.from(original);
    const affected = [];
    for (let i = 0; i < template.length; i++) {
      const j = 3 * i;
      const shift = Math.max(Math.abs(delta[j]), Math.abs(delta[j + 1]), Math.abs(delta[j + 2])) * level;
      if (shift <= 2e-6) continue;
      if (protectedIds.has(template[i])) return { valid: false, reason: 'protected region moves' };
      for (let k = 0; k < 3; k++) edited[j + k] += level * delta[j + k];
      affected.push(i);
    }
    if (!affected.length) return { valid: false, reason: 'no visible movement' };
    const shape = validate({ idx: Int32Array.from(affected) }, original, edited, triangles);
    if (!shape.valid) return { valid: false, reason: shape.reason };
    if (introducedSelfIntersectionCount(original, edited, triangles, affected)) {
      return { valid: false, reason: 'new self-intersection' };
    }
    return { valid: true };
  };
  const limit = (delta) => scanWithNarrowFallback((level) => evaluate(delta, level));
  const negScan = limit(negative), posScan = limit(positive);
  const negativeLimit = negScan.accepted, positiveLimit = posScan.accepted;
  return { eligible: negativeLimit > 0 && positiveLimit > 0,
    negativeLimit, positiveLimit, negativeReason: negScan.reason,
    positiveReason: posScan.reason, auditLevels: LEVELS };
}

export function scanComposedMesh({ base, edited, index }) {
  if (!Array.isArray(base) || !Array.isArray(edited) || !Array.isArray(index) ||
      !base.length || !index.length || base.length % 3 || base.length !== edited.length || index.length % 3 ||
      ![base, edited].every((values) => values.every(Number.isFinite)) ||
      !index.every((i) => Number.isInteger(i) && i >= 0 && i < base.length / 3)) {
    return { valid: false, reason: 'invalid composed mesh' };
  }
  const original = Float32Array.from(base), result = Float32Array.from(edited);
  const affected = [];
  for (let i = 0; i < original.length; i += 3) {
    if (Math.max(...[0, 1, 2].map((k) => Math.abs(result[i + k] - original[i + k]))) > 2e-6) affected.push(i / 3);
  }
  if (!affected.length) return { valid: false, reason: 'no visible movement' };
  const triangles = Uint32Array.from(index);
  const shape = validate({ idx: Int32Array.from(affected) }, original, result, triangles);
  const introduced = shape.valid ? introducedSelfIntersectionCount(original, result, triangles, affected) : null;
  return { ...shape, introducedSelfIntersections: introduced,
    valid: shape.valid && introduced === 0,
    reason: shape.reason ?? (introduced ? 'new self-intersection' : null) };
}

export function scanContourDirection({ base, delta, index, finerFirstStep = false }) {
  if (!Array.isArray(base) || !Array.isArray(delta) || delta.length !== base.length ||
      !delta.every(Number.isFinite)) {
    return { limit: 0 };
  }
  const check = (level) => {
    const edited = base.slice();
    for (let i = 0; i < delta.length; i += 3) {
      const shift = [0, 1, 2].map((k) => Math.fround(delta[i + k] * level));
      // The GLB omits the whole vertex when every axis is below the sparse target threshold.
      if (shift.every((value) => Math.abs(value) <= Math.fround(2e-6))) continue;
      for (let k = 0; k < 3; k++) edited[i + k] = Math.fround(base[i + k] + shift[k]);
    }
    return scanComposedMesh({ base, edited, index });
  };
  const { accepted: limit } = finerFirstStep
    ? scanEditLimit([0.025, 0.05, ...LEVELS], check)
    : scanWithNarrowFallback(check);
  return { limit };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (input.kind === 'contour') {
      console.log(JSON.stringify(scanContourDirection(input)));
    } else {
      console.log(JSON.stringify(input.kind === 'composite' ? scanComposedMesh(input) : scanWeightShape(input)));
    }
  } catch {
    console.log(JSON.stringify({ eligible: false, reason: 'geometry audit unavailable' }));
  }
}
