// Compare the final edited surface with its original: existing seams are not new edit defects.
const point = (p, i) => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function box(p, index, f) {
  const ids = [index[3 * f], index[3 * f + 1], index[3 * f + 2]];
  const [a, b, c] = ids.map((i) => point(p, i));
  return { min: [Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.min(a[2], b[2], c[2])],
    max: [Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1]), Math.max(a[2], b[2], c[2])], ids, v: [a, b, c], plane: null };
}

function overlaps(a, b, eps) {
  return a.min[0] <= b.max[0] + eps && b.min[0] <= a.max[0] + eps &&
    a.min[1] <= b.max[1] + eps && b.min[1] <= a.max[1] + eps &&
    a.min[2] <= b.max[2] + eps && b.min[2] <= a.max[2] + eps;
}

function tree(ids, boxes) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const id of ids) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], boxes[id].min[k]);
    max[k] = Math.max(max[k], boxes[id].max[k]);
  }
  if (ids.length <= 16) return { min, max, ids };
  const axis = [0, 1, 2].sort((a, b) => (max[b] - min[b]) - (max[a] - min[a]))[0];
  ids.sort((a, b) => (boxes[a].min[axis] + boxes[a].max[axis]) - (boxes[b].min[axis] + boxes[b].max[axis]));
  const half = ids.length >> 1;
  return { min, max, left: tree(ids.slice(0, half), boxes), right: tree(ids.slice(half), boxes) };
}

function query(node, target, eps, visit) {
  if (!overlaps(node, target, eps)) return;
  if (node.ids) for (const id of node.ids) visit(id);
  else { query(node.left, target, eps, visit); query(node.right, target, eps, visit); }
}

function barycentric(p, t, eps) {
  const [a, b, c] = t;
  const v0 = sub(c, a), v1 = sub(b, a), v2 = sub(p, a);
  const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1);
  const d20 = dot(v2, v0), d21 = dot(v2, v1), den = d00 * d11 - d01 * d01;
  if (den <= eps ** 4) return false;
  const u = (d11 * d20 - d01 * d21) / den, v = (d00 * d21 - d01 * d20) / den;
  return u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7;
}

function edgeHitsTriangle(p, q, t, normal, eps) {
  const d0 = dot(normal, sub(p, t[0])), d1 = dot(normal, sub(q, t[0]));
  const bound = eps * Math.hypot(...normal);
  if ((d0 > bound && d1 > bound) || (d0 < -bound && d1 < -bound)) return null;
  if (Math.abs(d0) <= bound && barycentric(p, t, eps)) return p;
  if (Math.abs(d1) <= bound && barycentric(q, t, eps)) return q;
  if (Math.abs(d0 - d1) <= bound) return null;
  const step = d0 / (d0 - d1);
  if (step < -1e-7 || step > 1 + 1e-7) return null;
  const hit = p.map((v, i) => v + step * (q[i] - v));
  return barycentric(hit, t, eps) ? hit : null;
}

function coplanarOverlap(a, b, normal, eps) {
  const axis = [0, 1, 2].sort((i, j) => Math.abs(normal[j]) - Math.abs(normal[i]))[0];
  const keep = [0, 1, 2].filter((i) => i !== axis);
  const project = (p) => keep.map((i) => p[i]);
  const aa = a.map(project), bb = b.map(project);
  const orient = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const sign = orient(bb[0], bb[1], bb[2]) >= 0 ? 1 : -1;
  let polygon = aa;
  for (let i = 0; i < 3; i++) {
    const p = bb[i], q = bb[(i + 1) % 3], input = polygon;
    polygon = [];
    for (let j = 0; j < input.length; j++) {
      const u = input[j], v = input[(j + 1) % input.length];
      const du = sign * orient(p, q, u), dv = sign * orient(p, q, v);
      if ((du >= 0) !== (dv >= 0)) {
        const t = du / (du - dv);
        polygon.push(u.map((x, k) => x + t * (v[k] - x)));
      }
      if (dv >= 0) polygon.push(v);
    }
    if (!polygon.length) return false;
  }
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(area) > eps * eps;
}

function plane(face) {
  if (!face.plane) {
    const [a, b, c] = face.v;
    const normal = cross(sub(b, a), sub(c, a));
    face.plane = { normal, length: Math.hypot(...normal) };
  }
  return face.plane;
}

function straddles([a, b, c], normal, origin, bound) {
  const d0 = dot(normal, sub(a, origin)), d1 = dot(normal, sub(b, origin)), d2 = dot(normal, sub(c, origin));
  return (d0 > bound || d1 > bound || d2 > bound) && (d0 < -bound || d1 < -bound || d2 < -bound);
}

function intersects(a, b, eps) {
  const { normal: n1, length: l1 } = plane(a);
  const { normal: n2, length: l2 } = plane(b);
  if (l1 <= eps * eps || l2 <= eps * eps) return false;
  if (b.v.every((p) => Math.abs(dot(n1, sub(p, a.v[0]))) <= eps * l1) &&
      Math.hypot(...cross(n1, n2)) <= 1e-8 * l1 * l2) {
    return coplanarOverlap(a.v, b.v, n1, eps);
  }
  if (!straddles(a.v, n2, b.v[0], eps * l2) && !straddles(b.v, n1, a.v[0], eps * l1)) return false;
  const hits = [];
  for (let i = 0; i < 3; i++) {
    const ab = edgeHitsTriangle(a.v[i], a.v[(i + 1) % 3], b.v, n2, eps);
    const ba = edgeHitsTriangle(b.v[i], b.v[(i + 1) % 3], a.v, n1, eps);
    if (ab) hits.push(ab);
    if (ba) hits.push(ba);
  }
  return hits.some((p) => hits.some((q) => Math.hypot(...sub(p, q)) > eps));
}

function intersections(p, index, affected, eps) {
  const boxes = new Array(index.length / 3);
  const active = [], region = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < boxes.length; i++) {
    const f = 3 * i;
    if (!affected.has(index[f]) && !affected.has(index[f + 1]) && !affected.has(index[f + 2])) continue;
    const current = boxes[i] = box(p, index, i);
    active.push(i);
    for (let k = 0; k < 3; k++) {
      region.min[k] = Math.min(region.min[k], current.min[k]);
      region.max[k] = Math.max(region.max[k], current.max[k]);
    }
  }
  const pairs = new Set();
  if (!active.length) return pairs;
  // A face outside every edited face's bounding region cannot intersect one of them.
  const nearby = [];
  for (let i = 0; i < boxes.length; i++) {
    if (!boxes[i]) {
      const a = 3 * index[3 * i], b = 3 * index[3 * i + 1], c = 3 * index[3 * i + 2];
      let inRegion = true;
      for (let k = 0; k < 3 && inRegion; k++) {
        inRegion = Math.min(p[a + k], p[b + k], p[c + k]) <= region.max[k] + eps &&
          Math.max(p[a + k], p[b + k], p[c + k]) >= region.min[k] - eps;
      }
      if (!inRegion) continue;
      boxes[i] = box(p, index, i);
    }
    nearby.push(i);
  }
  const root = tree(nearby, boxes);
  const activeFaces = new Set(active);
  for (const i of active) {
    query(root, boxes[i], eps, (j) => {
      if (i === j || (j < i && activeFaces.has(j)) || !overlaps(boxes[i], boxes[j], eps)) return;
      if (boxes[i].ids.some((id) => boxes[j].ids.includes(id))) return;
      if (intersects(boxes[i], boxes[j], eps)) pairs.add(`${Math.min(i, j)}:${Math.max(i, j)}`);
    });
  }
  return pairs;
}

function intersectionInputs(base, edited, index, affectedVertices) {
  if (base.length !== edited.length || base.length % 3 || index.length % 3) throw Error('invalid mesh sizes');
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < base.length; i++) {
    if (!Number.isFinite(base[i]) || !Number.isFinite(edited[i])) throw Error('non-finite mesh coordinate');
    const k = i % 3;
    min[k] = Math.min(min[k], base[i]);
    max[k] = Math.max(max[k], base[i]);
  }
  const scale = Math.max(...min.map((v, k) => max[k] - v));
  const eps = Math.max(scale * 1e-8, 1e-10);
  return { eps, affected: new Set(affectedVertices) };
}

export function newSelfIntersections(base, edited, index, affectedVertices) {
  const { eps, affected } = intersectionInputs(base, edited, index, affectedVertices);
  const before = intersections(base, index, affected, eps), after = intersections(edited, index, affected, eps);
  const introduced = [...after].filter((pair) => !before.has(pair));
  return { introduced: introduced.length, before: before.size, after: after.size };
}

function* introducedPairs(base, edited, index, affectedVertices) {
  const { eps, affected } = intersectionInputs(base, edited, index, affectedVertices);
  // Only pairs intersecting after the edit can be new defects; avoid a full baseline tree.
  const after = intersections(edited, index, affected, eps);
  for (const pair of after) {
    const [i, j] = pair.split(':').map(Number);
    const a = box(base, index, i), b = box(base, index, j);
    if (!overlaps(a, b, eps) || !intersects(a, b, eps)) yield [i, j];
  }
}

export function introducedSelfIntersectionCount(base, edited, index, affectedVertices) {
  let introduced = 0;
  for (const pair of introducedPairs(base, edited, index, affectedVertices)) introduced++;
  return introduced;
}

export function introducedSelfIntersectionFaces(base, edited, index, affectedVertices) {
  const faces = new Set();
  for (const [i, j] of introducedPairs(base, edited, index, affectedVertices)) {
    faces.add(3 * i);
    faces.add(3 * j);
  }
  return faces;
}
