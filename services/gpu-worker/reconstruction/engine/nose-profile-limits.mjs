import { evaluate } from './nose-engine.mjs';

// Pilot tolerance relative to nasion–subnasale height, for simulated shape continuity.
const PROFILE_DEVIATION = 0.04;
const SAMPLES = Array.from({ length: 21 }, (_, i) => i / 20);

function profile(positions, index, x, bottom, top) {
  const front = SAMPLES.map(() => -Infinity);
  for (let i = 0; i < index.length; i += 3) {
    const section = [];
    for (let j = 0; j < 3; j++) {
      const a = 3 * index[i + j], b = 3 * index[i + (j + 1) % 3];
      const left = positions[a], right = positions[b];
      if ((left <= x) === (right <= x)) continue;
      const t = (x - left) / (right - left);
      section.push([
        positions[a + 1] + t * (positions[b + 1] - positions[a + 1]),
        positions[a + 2] + t * (positions[b + 2] - positions[a + 2]),
      ]);
    }
    if (section.length !== 2) continue;
    const [[y1, z1], [y2, z2]] = section;
    for (let j = 0; j < SAMPLES.length; j++) {
      const y = bottom + (top - bottom) * SAMPLES[j];
      if ((y1 <= y) === (y2 <= y)) continue;
      front[j] = Math.max(front[j], z1 + (y - y1) / (y2 - y1) * (z2 - z1));
    }
  }
  if (front.some(value => !Number.isFinite(value))) return null;
  return front.map((z, i) => z - front[0] - (front.at(-1) - front[0]) * SAMPLES[i]);
}

export function calibratedBridgeLimits(data, rig, limits) {
  const { model, positions, normals, index } = data;
  const root = rig.radix?.nasV;
  const tip = model.landmarks?.pronasale;
  if (root == null || !tip || !index || !(model.D > 0) ||
      !Array.isArray(limits) || limits.length !== 2 || !limits.every(Number.isFinite) ||
      limits[0] > 0 || limits[1] < 0) return limits;
  const top = positions[3 * root + 1];
  if (!(top > tip[1])) return limits;
  const section = vertices => profile(vertices, index, tip[0], tip[1], top);
  const original = section(positions);
  if (!original) return limits;
  const tolerance = PROFILE_DEVIATION * model.D;
  const deviationAt = height => {
    const edited = section(evaluate(model, rig, positions, normals, { dorsum_height: height, edge_blend: 50 }));
    // Exclude the tip and radix transition zones.
    return edited && Math.max(...edited.slice(4, 17).map((value, i) => Math.abs(value - original[i + 4])));
  };
  const safeMagnitudes = [];
  for (const limit of limits) {
    if (limit === 0) continue;
    const deviation = deviationAt(limit);
    if (deviation === null) return limits;
    safeMagnitudes.push(Math.abs(limit) * Math.min(1, tolerance / deviation));
  }
  if (!safeMagnitudes.length) return limits;
  let magnitude = Math.min(...safeMagnitudes);
  // A different triangle can define the outline after editing. Recheck the actual candidate.
  const activeDirections = limits.filter(limit => limit !== 0).map(Math.sign);
  for (let i = 0; i < 8; i++) {
    if (activeDirections.every(direction => {
      const deviation = deviationAt(direction * magnitude);
      return deviation !== null && deviation <= tolerance;
    })) return limits.map(limit => Math.sign(limit) * magnitude);
    magnitude *= 0.8;
  }
  return limits;
}
