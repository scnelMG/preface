// A stroke is a template vertex and a displacement relative to the skin bounding-box diagonal.
// The same code runs in the viewer and in the final-mesh validator.
export const POINT_STROKES_VERSION = 'nose-points-v1';
export const MAX_POINT_STROKES = 24;
export const MAX_POINT_STEP = 0.01;

export function applyPointStrokes(base, template, mask, strokes) {
  if (!Array.isArray(strokes) || strokes.length > MAX_POINT_STROKES ||
      base.length !== template.length * 3) {
    throw Error('invalid point strokes');
  }
  const n = base.length / 3, low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    low[k] = Math.min(low[k], base[3 * i + k]); high[k] = Math.max(high[k], base[3 * i + k]);
  }
  const D = Math.hypot(...low.map((v, k) => high[k] - v));
  if (!Number.isFinite(D) || D <= 0) throw Error('invalid skin size');
  const edited = Float32Array.from(base), first = new Map();
  for (let i = 0; i < n; i++) {
    if (!Number.isInteger(template[i]) || template[i] < 0 || template[i] >= mask.length) throw Error('invalid template');
    if (!first.has(template[i])) first.set(template[i], i);
  }
  for (const stroke of strokes) {
    if (!stroke || !Number.isInteger(stroke.vertex) || !Array.isArray(stroke.delta) ||
        stroke.delta.length !== 3 || stroke.delta.some((v) => !Number.isFinite(v) || Math.abs(v) > MAX_POINT_STEP ||
          Number(v.toFixed(4)) !== v) || Math.hypot(...stroke.delta) === 0 ||
        Math.hypot(...stroke.delta) > MAX_POINT_STEP) {
      throw Error('invalid point stroke');
    }
    const anchor = first.get(stroke.vertex);
    if (anchor === undefined || mask[stroke.vertex] < 0.2) throw Error('point outside nose');
    const center = [0, 1, 2].map((k) => base[3 * anchor + k]);
    for (let i = 0; i < n; i++) {
      const t = template[i], nose = mask[t];
      if (nose <= 0) continue;
      const distance = Math.hypot(...center.map((v, k) => base[3 * i + k] - v));
      const q = Math.max(0, 1 - (distance / (0.12 * D)) ** 2);
      for (let k = 0; k < 3; k++) edited[3 * i + k] += stroke.delta[k] * D * q * q * nose;
      if (Math.hypot(...[0, 1, 2].map((k) => edited[3 * i + k] - base[3 * i + k])) > 0.15 * D) {
        throw Error('point displacement limit');
      }
    }
  }
  return edited;
}
