import { validate } from './nose-engine.mjs';
import { introducedSelfIntersectionCount } from './mesh-audit.mjs';

export function protectedNoseSkinVertices(metadata) {
  const names = ['left_eye', 'right_eye', 'upper_lip', 'lower_lip'];
  const regions = metadata?.regions;
  return names.every((name) => Array.isArray(regions?.[name]) && regions[name].length > 0 &&
    regions[name].every((id) => Number.isInteger(id) && id >= 0 && id < metadata.template_vertices))
    ? new Set(names.flatMap((name) => regions[name])) : null;
}

export function auditNoseSkinGeometry({ base, edited, template, index, protectedVertices }) {
  const affected = [];
  for (let i = 0; i < template.length; i++) {
    const j = 3 * i;
    if (Math.hypot(edited[j] - base[j], edited[j + 1] - base[j + 1], edited[j + 2] - base[j + 2]) > 1e-10) {
      affected.push(i);
    }
  }
  if (!affected.length) return { valid: true, affectedVertices: 0, protectedAffectedVertices: 0,
    protectedRegionsPresent: protectedVertices !== null, geometry: null, selfIntersections: 0 };
  const geometry = validate({ idx: Int32Array.from(affected) }, base, edited, index);
  const selfIntersections = introducedSelfIntersectionCount(base, edited, index, affected);
  const protectedAffectedVertices = affected.filter((i) => protectedVertices?.has(template[i])).length;
  return { valid: geometry.valid && selfIntersections === 0 && protectedAffectedVertices === 0,
    affectedVertices: affected.length, protectedAffectedVertices,
    protectedRegionsPresent: protectedVertices !== null, geometry, selfIntersections };
}
