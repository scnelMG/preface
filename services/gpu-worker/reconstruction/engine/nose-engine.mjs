// Live Mirror PoC — semantic nose-tip editing engine (shared by browser UI and Node tests).
// Pure functions, no DOM / Three.js dependency.
//
// Contract (see 02-nose-editing-spec.md):
//  * The ORIGINAL positions are never modified. evaluate() always starts from the original buffers and a full
//    absolute parameter set (original-relative), so repeated evaluation cannot drift.
//  * Users never see XYZ. Parameters are semantic: tip_projection, tip_height, tip_rotation, tip_width, tip_fullness.
//  * Distance unit: "mm" ONLY if the model's metric scale was verified (units.metric_scale_known === true);
//    otherwise "pctD" = percent of D (this case's nasion–subnasale vertical distance). Never mixed.
//  * Canonical frame: +X viewer-right in front view (= subject's left), +Y up, +Z forward, origin = pronasale.

const LEGACY_ENGINE_VERSION = 'nose-engine-0.12.0';
export const ENGINE_VERSION = 'nose-engine-0.13.0';
export const supportsNoseEngine = (version) => version === ENGINE_VERSION || version === LEGACY_ENGINE_VERSION;
// 0.12.0 deformation model: STRUCTURE + SOFT-TISSUE ENVELOPE (user feedback 10/14: edits looked like stretched skin,
// not like a surgical result). Each operation moves a structural core rigidly (tip lobule, radix graft strip, dorsal
// ridge implant, alar lobule) and the surrounding skin follows with a C2 falloff over GEODESIC distance on the surface
// (it follows the skin, never jumps across a nostril or into the eye).
export const DEFORM_MODEL = 'structure+envelope (geodesic) v1';

export const TIP_PARAMS = [
  { id: 'tip_projection', region: 'tip', label: '돌출', kind: 'distance', hint: '앞으로 당기면 코끝이 더 나와요', view: 'side', handle: 'axis' },
  { id: 'tip_height', region: 'tip', label: '높이', kind: 'distance', hint: '위·아래로 움직이면 코끝 높이가 바뀌어요', view: 'side', handle: 'axis' },
  { id: 'tip_rotation', region: 'tip', label: '방향', kind: 'angle', hint: '곡선을 따라 돌리면 코끝이 들리거나 내려가요', view: 'side', handle: 'arc' },
  { id: 'tip_width', region: 'tip', label: '폭', kind: 'distance', hint: '양쪽 점을 모으면 코끝 폭이 좁아져요 (전체 폭)', view: 'front', handle: 'pair' },
  { id: 'tip_fullness', region: 'tip', label: '볼륨', kind: 'index', hint: '위로 끌면 코끝이 도톰해지고, 아래로 끌면 날렵해져요', view: 'oblique', handle: 'region' },
];
// nose expansion step 1 (0.7.0): dorsum (콧대). Same contract as the tip: absolute, original-relative, validated.
export const DORSUM_PARAMS = [
  { id: 'dorsum_height', region: 'bridge', label: '높이', kind: 'distance', hint: '앞으로 당기면 콧대가 높아져요 (코끝은 그대로)', view: 'side', handle: 'axis' },
  { id: 'dorsum_hump', region: 'bridge', label: '매부리', kind: 'distance', hint: '안쪽으로 밀면 콧대 혹(매부리)이 줄고, 바깥으로 당기면 생겨요', view: 'side', handle: 'axis' },
  { id: 'dorsum_width', region: 'bridge', label: '폭', kind: 'index', hint: '양쪽 점을 모으면 콧대가 좁아져요', view: 'front', handle: 'pair' },
  // WHERE the change is applied (user request 10/14): sub-parameters of a main feature. They change no geometry by
  // themselves; with the main value they move/resize the zone. Unit: % of this case's dorsum length (nasion -> supratip).
  { id: 'dorsum_height_pos', region: 'bridge', parent: 'dorsum_height', sub: true, label: '높이 위치', kind: 'position', hint: '◆ 점을 콧대를 따라 옮기면 높아지는 위치가 바뀌어요 (+ = 코끝 쪽)', view: 'side', handle: 'slide' },
  { id: 'dorsum_height_span', region: 'bridge', parent: 'dorsum_height', sub: true, label: '높이 범위', kind: 'index', hint: '높아지는 구간의 길이 (+ 길게 / − 짧게)', view: 'side', handle: 'none' },
  { id: 'dorsum_hump_pos', region: 'bridge', parent: 'dorsum_hump', sub: true, label: '매부리 위치', kind: 'position', hint: '◆ 점을 콧대를 따라 옮기면 매부리를 바꾸는 위치가 바뀌어요 (+ = 코끝 쪽)', view: 'side', handle: 'slide' },
];
// nose expansion step 2 (0.8.0): radix (코뿌리) = where the bridge starts between the eyes
export const RADIX_PARAMS = [
  { id: 'radix_height', region: 'radix', label: '높이', kind: 'distance', hint: '앞으로 당기면 눈 사이 콧대 시작점(코뿌리)이 높아져요', view: 'side', handle: 'axis' },
  { id: 'radix_level', region: 'radix', label: '시작 위치', kind: 'distance', hint: '위·아래로 움직이면 콧대가 시작되는 높이가 바뀌어요', view: 'side', handle: 'axis' },
];
// nose expansion step 3 (0.9.0): alar (콧볼). Left/right are SUBJECT sides (subject left = viewer right in front view).
export const ALAR_PARAMS = [
  { id: 'alar_width', region: 'alar', label: '폭', kind: 'distance', hint: '양쪽 점을 모으면 콧볼 사이 폭이 좁아져요 (전체 폭)', view: 'front', handle: 'pair' },
  { id: 'alar_flare', region: 'alar', label: '벌어짐', kind: 'index', hint: '바깥으로 끌면 콧볼이 둥글게 벌어지고, 안으로 밀면 납작해져요', view: 'bottom', handle: 'axis' },
  { id: 'alar_balance', region: 'alar', label: '좌우 균형', kind: 'distance', hint: '점을 옮기면 한쪽 콧볼은 넓어지고 반대쪽은 좁아져요 (+ = 본인 기준 왼쪽이 넓게)', view: 'front', handle: 'axis' },
];
// nose expansion step 4 (0.10.0): columella (비주) between the tip lobule and the subnasale
export const COLUMELLA_PARAMS = [
  { id: 'columella_show', region: 'columella', label: '노출', kind: 'distance', hint: '아래로 끌면 옆에서 비주가 더 보여요 (+), 위로 밀면 덜 보여요', view: 'side', handle: 'axis' },
  { id: 'nasolabial_angle', region: 'columella', label: '코-입술 각도', kind: 'angle', hint: '곡선을 따라 돌리면 비주와 윗입술 사이 각도가 커지거나 작아져요', view: 'side', handle: 'arc' },
  { id: 'columella_width', region: 'columella', label: '폭', kind: 'index', hint: '양쪽 점을 모으면 비주가 가늘어져요', view: 'bottom', handle: 'pair' },
];
// 0.11.0: smooth joins between regions (user request: edits must connect smoothly to the neighbouring parts)
export const GLOBAL_PARAMS = [
  { id: 'edge_blend', region: 'global', sub: true, label: '경계 매끄럽게', kind: 'index', hint: '부위 사이 이음새와 변형 경계를 부드럽게 이어요 (각 부위의 중심 값은 그대로)', view: 'oblique', handle: 'none' },
];
export const NOSE_PARAMS = [...TIP_PARAMS, ...DORSUM_PARAMS, ...RADIX_PARAMS, ...ALAR_PARAMS, ...COLUMELLA_PARAMS, ...GLOBAL_PARAMS];
export const REGION_LABELS = { tip: '코끝', bridge: '콧대', radix: '코뿌리', alar: '콧볼', columella: '비주', global: '전체' };

// UI CAPS (not clinical). The usable range of each case is narrower: createEditor() scans each single parameter
// on THIS mesh and keeps 85% of the last geometrically valid value (case_limits). Every evaluated state is still
// validated; invalid combinations are rejected and the last valid state is restored.
export const GEOMETRY_LIMITS = {
  tip_projection: { pctD: [-15, 15], mm: [-6, 6] },
  tip_height: { pctD: [-15, 15], mm: [-6, 6] },
  tip_rotation: { degree: [-20, 20] },
  tip_width: { pctD: [-12, 12], mm: [-5, 5] },
  tip_fullness: { percent: [-100, 100] },
  dorsum_height: { pctD: [-8, 15], mm: [-3, 6] },
  dorsum_hump: { pctD: [-10, 10], mm: [-4, 4] },
  dorsum_width: { percent: [-30, 30] },
  dorsum_height_pos: { percent: [-30, 30] },
  dorsum_height_span: { percent: [-50, 60] },
  dorsum_hump_pos: { percent: [-40, 40] },
  radix_height: { pctD: [-8, 12], mm: [-3, 5] },
  radix_level: { pctD: [-10, 10], mm: [-4, 4] },
  alar_width: { pctD: [-15, 12], mm: [-6, 5] },
  alar_flare: { percent: [-100, 100] },
  alar_balance: { pctD: [-6, 6], mm: [-3, 3] },
  columella_show: { pctD: [-6, 8], mm: [-3, 4] },
  nasolabial_angle: { degree: [-15, 15] },
  columella_width: { percent: [-35, 35] },
  edge_blend: { percent: [0, 100] },
};

export function unitsFor(model) {
  const metric = !!(model.units && model.units.metric_scale_known && model.units.mm_per_unit);
  return {
    metric,
    distance: metric ? 'mm' : 'pctD',
    angle: 'degree',
    index: 'percent',
    label(kind) {
      if (kind === 'angle') return '°';
      if (kind === 'position') return '% (콧대 길이 기준)';
      if (kind === 'index') return '%';
      return metric ? 'mm' : '% (코 높이 대비)';
    },
  };
}

export function paramUnit(model, id) {
  const u = unitsFor(model);
  const p = NOSE_PARAMS.find((q) => q.id === id);
  return p.kind === 'distance' ? u.distance : p.kind === 'angle' ? 'degree' : 'percent'; // index and position: percent
}

export function limitsFor(model, id) {
  return GEOMETRY_LIMITS[id][paramUnit(model, id)];
}

export function zeroParams() {
  const o = {};
  for (const p of NOSE_PARAMS) o[p.id] = 0;
  return o;
}

const v3 = (a, i) => [a[3 * i], a[3 * i + 1], a[3 * i + 2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
function smoother(t) { t = Math.min(1, Math.max(0, t)); return t * t * t * (t * (t * 6 - 15) + 10); }

// Build the rig: region weights are functions of ORIGINAL canonical positions and this case's landmarks
// (adapted to the individual nose size/shape, not copied vertex offsets from another face).
export function buildRig(model, positions, normals, index, engineVersion = ENGINE_VERSION) {
  if (!supportsNoseEngine(engineVersion)) throw Error('unsupported nose engine');
  const L = model.landmarks;
  const D = model.D;
  const prn = L.pronasale, sn = L.subnasale;
  const tl = L.tip_lat_subject_left, tr = L.tip_lat_subject_right;
  const al = L.alar_crease_subject_left, ar = L.alar_crease_subject_right;
  const halfTip = 0.5 * Math.abs(tl[0] - tr[0]);
  const alarZ = 0.5 * (al[2] + ar[2]);
  // individual-adaptive anisotropic support (canonical units), centred exactly on the pronasale
  const rx = Math.min(0.65 * D, Math.max(0.35 * D, 2.2 * halfTip));
  const ryUp = 0.60 * D;
  const ryDown = Math.max(0.20 * D, prn[1] - sn[1] + 0.12 * D); // ends 0.12D below subnasale (columella-lip transition); lower lip region fixed
  const rzBack = Math.max(0.50 * D, 0.95 * (prn[2] - alarZ));
  const tv = model.controls.pronasale.vertex;
  const center = [positions[3 * tv], positions[3 * tv + 1], positions[3 * tv + 2]]; // registered tip vertex => weight exactly 1
  const pivot = [prn[0], 0.5 * (al[1] + ar[1]), alarZ];
  const inner = [prn[0], prn[1] - 0.1 * D, prn[2] - 0.5 * D];
  const n = positions.length / 3;
  const idx = [], wT = [], wF = [], wW = [];
  const flatX = 1.1 * halfTip;
  // geodesic distance from the tip vertex over the welded surface graph (structure: tip lobule core)
  const Gr = index ? weldedGraph(positions, index, D) : null;
  const tipGeo = Gr ? dijkstra(Gr, [Gr.grp[tv]], 1.2 * D) : null;
  const TC = globalThis.__LM_TIP_CFG || { core: 0.08, env: 0.5, g0: 0.7 }; // tuning hook (tests only)
  const TIP_CORE = TC.core * D, TIP_ENV = TC.env * D, G0 = TC.g0;
  const wend = (r) => (r >= 1 ? 0 : Math.pow(1 - r, 4) * (4 * r + 1));
  for (let i = 0; i < n; i++) {
    const p = v3(positions, i);
    const dx = (p[0] - center[0]) / rx;
    const dy = (p[1] - center[1]) / (p[1] >= center[1] ? ryUp : ryDown);
    const dz = (p[2] - center[2]) / rzBack;
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // width weight: flat across the tip lobule in X (|x|<=1.1*half tip width), same falloff elsewhere
    const dxw = Math.max(0, Math.abs(p[0] - center[0]) - flatX) / rx;
    const rw = Math.sqrt(dxw * dxw + dy * dy + dz * dz);
    if (r >= 1 && rw >= 1) continue;
    let w = wend(r);
    if (tipGeo && r < 1) {
      // rigid lobule (core) + soft envelope; the old anisotropic support only guards the outer edge (lip/eyes fixed)
      const d = tipGeo.dist[Gr.grp[i]];
      const wGeo = d <= TIP_CORE ? 1 : 1 - smoother((d - TIP_CORE) / TIP_ENV);
      w = wGeo * (1 - smoother((r - G0) / (1 - G0)));
    }
    const ww = wend(rw);
    if (w <= 1e-6 && ww <= 1e-6) continue;
    // fullness bump: smaller support, only on outward-facing skin (excludes nostril cavity walls)
    const rf = r / 0.75;
    let f = wend(rf);
    if (f > 0 && normals) {
      const rd = sub(p, inner); const l = len(rd) || 1;
      const facing = (normals[3 * i] * rd[0] + normals[3 * i + 1] * rd[1] + normals[3 * i + 2] * rd[2]) / l;
      f *= smoother((facing - 0.1) / 0.4);
    }
    idx.push(i); wT.push(w); wF.push(r < 1 ? f : 0); wW.push(ww);
  }
  // smoothed normals for the fullness offset (Gaussian average over 0.06D) so scanner noise in per-vertex normals
  // is not amplified into folds; computed once from the ORIGINAL surface
  const sN = new Float32Array(idx.length * 3);
  if (normals) {
    const r2 = (0.06 * D) ** 2;
    for (let a = 0; a < idx.length; a++) {
      if (wF[a] <= 0) continue;
      const ia = idx[a]; let sx = 0, sy = 0, sz = 0;
      for (let b = 0; b < idx.length; b++) {
        const ib = idx[b];
        const dx = positions[3 * ia] - positions[3 * ib], dy = positions[3 * ia + 1] - positions[3 * ib + 1], dz = positions[3 * ia + 2] - positions[3 * ib + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        const g = Math.exp(-d2 / (0.5 * r2));
        sx += g * normals[3 * ib]; sy += g * normals[3 * ib + 1]; sz += g * normals[3 * ib + 2];
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      sN[3 * a] = sx / l; sN[3 * a + 1] = sy / l; sN[3 * a + 2] = sz / l;
    }
  }
  // displacement relaxation graph (welded): transition-zone vertices average their displacement with neighbours so
  // combined edits spread compression instead of folding; tip/control vertices and the plateau stay fixed (exact values)
  let relax = null;
  if (index) {
    const local = new Int32Array(n).fill(-1);
    for (let a = 0; a < idx.length; a++) local[idx[a]] = a;
    const keyOf = (i) => `${Math.round(positions[3 * i] / (1e-6 * D))},${Math.round(positions[3 * i + 1] / (1e-6 * D))},${Math.round(positions[3 * i + 2] / (1e-6 * D))}`;
    const gid = new Map(); const grp = new Int32Array(idx.length);
    for (let a = 0; a < idx.length; a++) { const kk = keyOf(idx[a]); if (!gid.has(kk)) gid.set(kk, gid.size); grp[a] = gid.get(kk); }
    const G = gid.size;
    const nb = Array.from({ length: G }, () => new Set());
    const outside = new Uint8Array(G); // touches a vertex outside the rig (displacement 0)
    for (let t = 0; t < index.length / 3; t++) {
      const tri = [index[3 * t], index[3 * t + 1], index[3 * t + 2]];
      const loc = tri.map((v) => local[v]);
      if (loc.every((l) => l < 0)) continue;
      for (let u = 0; u < 3; u++) for (let v = 0; v < 3; v++) {
        if (u === v || loc[u] < 0) continue;
        if (loc[v] < 0) outside[grp[loc[u]]] = 1; else if (grp[loc[u]] !== grp[loc[v]]) nb[grp[loc[u]]].add(grp[loc[v]]);
      }
    }
    const fixed = new Uint8Array(G);
    const ctrlSet = new Set(Object.values(model.controls).map((c) => c.vertex));
    for (let a = 0; a < idx.length; a++) if (wT[a] >= 0.95 || ctrlSet.has(idx[a])) fixed[grp[a]] = 1;
    const off = new Int32Array(G + 1); for (let g = 0; g < G; g++) off[g + 1] = off[g] + nb[g].size;
    const lst = new Int32Array(off[G]); for (let g = 0; g < G; g++) { let k2 = off[g]; for (const x of nb[g]) lst[k2++] = x; }
    relax = { grp, G, off, lst, outside, fixed, iters: 10, alpha: 0.5 };
  }
  const ctrl = (k) => model.controls[k].vertex;
  const wAt = (vi) => { const j = idx.indexOf(vi); return j >= 0 ? wW[j] : 0; };
  const dorsum = buildDorsumRig(model, positions, normals, Gr, engineVersion === ENGINE_VERSION);
  const radix = buildRadixRig(model, positions, normals, Gr);
  const alar = buildAlarRig(model, positions, normals, Gr);
  const columella = buildColumellaRig(model, positions, normals);
  const tlV = ctrl('tip_lat_subject_left'), trV = ctrl('tip_lat_subject_right');
  const blend = index ? buildBlendGraph(model, positions, index, { idx, wT, dorsum, radix, alar, columella }) : null;
  return {
    D, rx, ryUp, ryDown, rzBack, center, pivot, relax, dorsum, radix, alar, columella, blend,
    idx: Int32Array.from(idx), wT: Float32Array.from(wT), wF: Float32Array.from(wF), wW: Float32Array.from(wW), sN,
    tipV: ctrl('pronasale'), tlV, trV,
    W0: Math.abs(positions[3 * tlV] - positions[3 * trV]),
    // width solve: x_i' = cx + (x_i-cx)(1+w_i*k)  =>  ΔW = k*(w_L*(x_L-cx) - w_R*(x_R-cx))
    widthDen: wAt(tlV) * (positions[3 * tlV] - center[0]) - wAt(trV) * (positions[3 * trV] - center[0]), // same midline (cx) as evaluate()
    fullK: 0.05 * D,
    definition: {
      region: 'Wendland C2 weight centred on the pronasale; radii adapted per case: x=clamp(2.2*half tip width,0.35D,0.65D), up=0.6D, down=(pronasale-subnasale)+0.06D (upper lip fixed), back=max(0.5D,0.95*tip-to-alar-crease depth)',
      projection: 'translation along canonical +Z (face forward) × weight; pronasale weight = 1 so the tip moves exactly by the value',
      height: 'translation along canonical +Y (face up) × weight',
      rotation: 'rotation about the canonical X axis through pivot = mean alar crease point; per-vertex angle = value × weight; positive = tip turns up',
      width: 'X scaling about the midline with a width weight that is flat across the tip lobule (|x|<=1.1×half tip width) and decays like the region weight beyond; solved so the total tip_lat(L)–tip_lat(R) distance changes by exactly the value (total width, not per side)',
      fullness: 'offset along ORIGINAL normals Gaussian-smoothed over 0.06D, with a smaller bump on outward-facing skin only; 100% = 0.05D at the pronasale; relative shape index, not tissue volume',
    },
  };
}

// along-the-dorsum profile of the height zone. Default (dc=0, ext=0): rises over u=-0.15..0.2, flat to 0.8, fades by 1.25
// (identical to 0.7.0). dc shifts the zone (fraction of the dorsum length), ext widens it on both sides. A window keeps
// the zone inside the precomputed vertex range (u=-0.35..1.45) without touching the default zone.
function dorsumAlong(u, dc, ext) {
  const lo = 0.2 + dc - ext, hi = 0.8 + dc + ext;
  const a = smoother((u - lo + 0.35) / 0.35) * (u <= hi ? 1 : smoother((hi + 0.45 - u) / 0.45));
  return a * smoother((u + 0.35) / 0.2) * smoother((1.45 - u) / 0.2);
}
function bridgeHeightAlong(u, end, dc = 0, ext = 0) {
  const upper = smoother((u + 0.35 - dc + ext) / 0.53);
  const lower = smoother((end - u + dc + ext) / 0.60);
  return upper * lower * smoother((u + 0.35) / 0.15) * smoother((end - u) / 0.15);
}
export function dorsumCenters(Dr, params) {
  const dc = (params.dorsum_height_pos || 0) / 100;
  return { height: 0.5 + dc, hump: Math.min(1.0, Math.max(0.05, Dr.uh + (params.dorsum_hump_pos || 0) / 100)) };
}
// per-evaluation weights; returns the precomputed defaults when no position/span parameter is set (exactly 0.7.0)
function dorsumWeights(Dr, params) {
  const dc = (params.dorsum_height_pos || 0) / 100, ext = 0.3 * (params.dorsum_height_span || 0) / 100;
  const dp = params.dorsum_hump_pos || 0;
  const bridgeHeight = Dr.wBridge ?? Dr.wH;
  if (!dc && !ext && !dp) return { wH: bridgeHeight, wB: Dr.wB };
  const n = Dr.idx.length, wH = new Float32Array(n), wB = new Float32Array(n);
  const uh = dorsumCenters(Dr, params).hump;
  for (let j = 0; j < n; j++) {
    const u = Dr.U[j];
    wH[j] = bridgeHeight[j];
    if (dc || ext) {
      wH[j] = Dr.wBridge
        ? bridgeHeightAlong(Dr.bridgeU[j], Dr.bridgeEnd, dc, ext) * Dr.bridgeSide[j]
        : dorsumAlong(u, dc, ext) * Dr.LH[j];
    }
    wB[j] = dp ? Math.exp(-0.5 * ((u - uh) / 0.2) ** 2) * smoother((1.15 - u) / 0.3) * smoother((u + 0.1) / 0.25) * Dr.LH[j] : Dr.wB[j];
  }
  return { wH, wB };
}

// Dorsum (콧대) rig. Built from THIS case's nasion / pronasale and its own midline profile:
//   u = position along the dorsum, 0 at the nasion, 1 at the supratip (0.2D above the pronasale)
//   lateral support widens toward the base (0.20D -> 0.32D) so the inner eye corners (~0.3D at the nasion) stay fixed
//   depth support: only skin within 0.45D behind the midline profile at the same height (no cheeks / eyes)
//   hump point: largest bulge in front of the nasion->supratip chord (if none, mid-dorsum)
function buildDorsumRig(model, positions, normals, Gr, smoothBridge) {
  const L = model.landmarks, D = model.D;
  const N = L.nasion, prn = L.pronasale;
  if (!N || !(N[1] - prn[1] > 0.3 * D)) return null;
  const midX = prn[0];
  const yS = prn[1] + 0.2 * D, yN = N[1];
  const span = yN - yS;
  if (span <= 0.1 * D) return null;
  const n = positions.length / 3;
  // midline profile z(y): max z of vertices within 0.04D of the midline, binned along y
  const nb = 80, y0 = yS - 0.6 * span, y1 = yN + 0.35 * span, zb = new Float64Array(nb).fill(-Infinity);
  const bin = (y) => Math.min(nb - 1, Math.max(0, Math.floor(((y - y0) / (y1 - y0)) * nb)));
  for (let i = 0; i < n; i++) {
    const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
    if (Math.abs(x - midX) > 0.04 * D || y < y0 || y > y1) continue;
    const b = bin(y); if (z > zb[b]) zb[b] = z;
  }
  // fill empty bins by interpolation
  const good = []; for (let b = 0; b < nb; b++) if (zb[b] > -Infinity) good.push(b);
  if (good.length < 8) return null;
  for (let b = 0; b < nb; b++) if (zb[b] === -Infinity) {
    let lo = good.filter((g) => g < b).pop(), hi = good.find((g) => g > b);
    zb[b] = lo === undefined ? zb[hi] : hi === undefined ? zb[lo] : zb[lo] + (zb[hi] - zb[lo]) * (b - lo) / (hi - lo);
  }
  const zProf = (y) => zb[bin(y)];
  const uOf = (y) => (yN - y) / span;
  // hump: max distance in front of the chord N -> S along the profile
  const zN = zProf(yN), zS = zProf(yS);
  let uh = 0.5, hmax = 0;
  for (let k = 1; k < 40; k++) {
    const u = k / 40, y = yN - u * span, zc = zN + (zS - zN) * u;
    const d = zProf(y) - zc;
    if (d > hmax) { hmax = d; uh = u; }
  }
  if (hmax < 0.01 * D) uh = 0.5;
  // outward normal of the chord in the YZ plane ((y,z) components), pointing forward (+z)
  let ty = yS - yN, tz = zS - zN; const tl = Math.hypot(ty, tz) || 1; ty /= tl; tz /= tl;
  let nh = [-tz, ty]; if (nh[1] < 0) nh = [tz, -ty];
  const wend = (r) => (r >= 1 ? 0 : Math.pow(1 - r, 4) * (4 * r + 1));
  const along = (u) => dorsumAlong(u, 0, 0);
  const idx = [], wH = [], wB = [], wW = [], U = [], LH = [], LW = [];
  const wBridge = smoothBridge ? [] : null;
  const bridgeU = [], bridgeSide = [];
  // Use each vertex's own height and taper to zero by the tip.
  const bridgeEnd = Math.min(1.35, uOf(prn[1]));
  const bridgeCore = 0.055 * D;
  const addBridgeWeight = (u, side) => {
    wBridge.push(bridgeHeightAlong(u, bridgeEnd) * side);
    bridgeU.push(u);
    bridgeSide.push(side);
  };
  // structure: the dorsal ridge strip (implant/hump bed). The height/hump profile is defined ALONG this ridge and the
  // sidewalls follow by geodesic distance from it (like skin draped over a graft), instead of a separate lateral bump.
  let rg = null;
  if (Gr) {
    const core = [];
    for (let g = 0; g < Gr.G; g++) {
      const x = Gr.gp[3 * g], y = Gr.gp[3 * g + 1], z = Gr.gp[3 * g + 2], u = uOf(y);
      if (u < -0.35 || u > 1.45 || Math.abs(x - midX) > 0.035 * D || z < zProf(y) - 0.03 * D) continue;
      core.push(g);
    }
    if (core.length > 5) rg = dijkstra(Gr, core, 0.32 * D);
  }
  for (let i = 0; i < n; i++) {
    const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
    let u = uOf(y);
    if (rg) {
      const g = Gr.grp[i], d = rg.dist[g];
      if (!(d < 0.32 * D)) continue;
      u = uOf(Gr.gp[3 * rg.src[g] + 1]); // profile value of the nearest ridge point
      if (u < -0.35 || u > 1.45) continue;
      let face = 1;
      if (normals) face = smoother((normals[3 * i + 2] + 0.3) / 0.6);
      const env = envelope(d, 0.3 * D) * face;
      const ax = Math.abs(x - midX);
      const wx = (0.20 + 0.12 * Math.min(1, Math.max(0, u))) * D;
      const behind = zProf(y) - z;
      const c = wend(Math.max(0, behind) / (0.45 * D));
      const bw = ax < 0.10 * D ? 1 : wend((ax - 0.10 * D) / (wx * 1.2 - 0.10 * D || 1e-9));
      if (env <= 1e-6 && bw * c <= 1e-6) continue;
      const hb = Math.exp(-0.5 * ((u - uh) / 0.2) ** 2) * smoother((1.15 - u) / 0.3) * smoother((u + 0.1) / 0.25);
      const a = along(u);
      idx.push(i); wH.push(a * env); wB.push(hb * env); wW.push(a * bw * c);
      if (wBridge) addBridgeWeight(uOf(y), envelope(d - bridgeCore, 0.30 * D - bridgeCore) * face);
      U.push(u); LH.push(env); LW.push(bw * c);
      continue;
    }
    // wider u range than the default zone so the user can MOVE the zone (dorsum_height_pos / _span / dorsum_hump_pos)
    if (u < -0.35 || u > 1.45) continue;
    const a = along(u);
    const behind = zProf(y) - z;
    if (behind > 0.45 * D) continue;
    const c = wend(Math.max(0, behind) / (0.45 * D));
    const wx = (0.20 + 0.12 * Math.min(1, Math.max(0, u))) * D;
    const ax = Math.abs(x - midX);
    const bl = wend(ax / wx);
    if (bl * c <= 1e-6) continue;
    // forward-facing skin only for the height/hump offsets (sidewalls fade, no undersides)
    let face = 1;
    if (normals) face = smoother((normals[3 * i + 2] + 0.1) / 0.5);
    const hb = Math.exp(-0.5 * ((u - uh) / 0.2) ** 2) * smoother((1.15 - u) / 0.3) * smoother((u + 0.1) / 0.25);
    const bw = ax < 0.10 * D ? 1 : wend((ax - 0.10 * D) / (wx * 1.2 - 0.10 * D || 1e-9));
    idx.push(i); wH.push(a * bl * c * face); wB.push(hb * bl * c * face); wW.push(a * bw * c);
    if (wBridge) addBridgeWeight(u, envelope(ax - bridgeCore, wx - bridgeCore) * c * face);
    U.push(u); LH.push(bl * c * face); LW.push(bw * c);
  }
  // profile samples for position handles: u -> on-surface midline point (continuous) and nearest vertex
  // control vertices: on-surface points near the midline (max z) and the lateral width handles
  const pick = (yt, xt, tol = 0.035 * D) => {
    let best = -1, bz = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
      if (Math.abs(y - yt) > tol || Math.abs(x - xt) > tol) continue;
      if (z > bz) { bz = z; best = i; }
    }
    if (best < 0) { let bd = Infinity; for (let i = 0; i < n; i++) { const d = Math.hypot(positions[3 * i] - xt, positions[3 * i + 1] - yt); if (d < bd) { bd = d; best = i; } } }
    return best;
  };
  const yMid = yN - 0.5 * span, yH = yN - uh * span, yW = yN - 0.6 * span;
  const midV = pick(yMid, midX), humpV = pick(yH, midX);
  const dlV = pick(yW, midX + 0.13 * D), drV = pick(yW, midX - 0.13 * D);
  const profV = []; for (let k = 0; k <= 40; k++) profV.push(pick(yN - (k / 40) * span, midX));
  const profileAt = (u) => { const y = yN - u * span; return [midX, y, zProf(y)]; };
  return {
    idx: Int32Array.from(idx), wH: Float32Array.from(wH), wB: Float32Array.from(wB), wW: Float32Array.from(wW),
    wBridge: wBridge && Float32Array.from(wBridge), bridgeEnd,
    bridgeU: Float32Array.from(bridgeU), bridgeSide: Float32Array.from(bridgeSide),
    U: Float32Array.from(U), LH: Float32Array.from(LH), LW: Float32Array.from(LW), profV, profileAt, span,
    midX, nh, uh, hump_depth_D: hmax / D, yN, yS, midV, humpV, dlV, drV,
    W0: Math.abs(positions[3 * dlV] - positions[3 * drV]),
    definition: {
      region: 'nasion (u=0) to supratip (u=1, 0.2D above the pronasale) along this case\'s midline profile; lateral Wendland support 0.20D->0.32D; skin within 0.45D behind the profile; forward-facing skin for height/hump',
      height: smoothBridge
        ? 'forward translation with a wider ridge core and a gradual taper from the nasion into the supratip'
        : 'translation along canonical +Z (face forward) x weight (flat over u=0.2..0.8, fading toward the nasion and into the supratip); the tip vertex is not moved by this op',
      hump: 'offset along the outward normal of the nasion->supratip chord, Gaussian along the dorsum centred on the detected hump (sigma 0.2); negative = reduce hump',
      width: 'X scaling about the midline, flat for |x|<0.10D then fading; value = % change of the bridge width at weight 1 (relative index, the handles show the actual change)',
    },
  };
}

// Radix (코뿌리) rig: small region centred on THIS case's nasion. Lateral support 0.22D keeps the inner eye corners
// (~0.3D from the midline) fixed; vertical support 0.28D up (glabella) / 0.32D down (upper dorsum); forward-facing skin.
//   height: +Z translation (deepen/raise the start of the bridge); level: +Y translation (move the start up/down)
function buildRadixRig(model, positions, normals, Gr) {
  const L = model.landmarks, D = model.D, N = L.nasion, prn = L.pronasale;
  if (!N || !(N[1] - prn[1] > 0.3 * D)) return null;
  const n = positions.length / 3;
  // nasion control vertex: on-surface (max z) near the landmark on the midline
  let nasV = -1, bz = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
    if (Math.abs(x - N[0]) > 0.03 * D || Math.abs(y - N[1]) > 0.03 * D || Math.abs(z - N[2]) > 0.15 * D) continue;
    if (z > bz) { bz = z; nasV = i; }
  }
  if (nasV < 0) return null;
  const c = [positions[3 * nasV], positions[3 * nasV + 1], positions[3 * nasV + 2]];
  const wend = (r) => (r >= 1 ? 0 : Math.pow(1 - r, 4) * (4 * r + 1));
  const rx = 0.22 * D, ryU = 0.28 * D, ryD = 0.32 * D, rz = 0.35 * D;
  const idx = [], wH = [], wL = [];
  if (Gr) {
    // structure: a graft strip on the midline, full height at the nasion, tapering 0.4D down the dorsum and 0.1D up
    // into the glabella; the skin follows by geodesic distance (0.18D) -> smooth, elongated, no round bump
    const prof = (y) => (y >= c[1] ? 1 - smoother((y - c[1]) / (0.1 * D)) : 1 - smoother((c[1] - y) / (0.4 * D)));
    const core = [];
    for (let g = 0; g < Gr.G; g++) {
      const x = Gr.gp[3 * g], y = Gr.gp[3 * g + 1], z = Gr.gp[3 * g + 2];
      if (Math.abs(x - c[0]) > 0.045 * D || y > c[1] + 0.1 * D || y < c[1] - 0.4 * D || z < c[2] - 0.3 * D) continue;
      core.push(g);
    }
    const geo = dijkstra(Gr, core, 0.2 * D);
    for (let i = 0; i < n; i++) {
      const g = Gr.grp[i], d = geo.dist[g];
      if (!(d < 0.18 * D)) continue;
      let w = prof(Gr.gp[3 * geo.src[g] + 1]) * envelope(d, 0.18 * D);
      if (normals) w *= smoother((normals[3 * i + 2] + 0.3) / 0.6);
      if (w <= 1e-6) continue;
      idx.push(i); wH.push(w); wL.push(w);
    }
  } else for (let i = 0; i < n; i++) {
    const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
    const dx = (x - c[0]) / rx, dy = (y - c[1]) / (y >= c[1] ? ryU : ryD), dz = (z - c[2]) / rz;
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (r >= 1) continue;
    let w = wend(r);
    if (normals) w *= smoother((normals[3 * i + 2] + 0.1) / 0.5);
    if (w <= 1e-6) continue;
    idx.push(i); wH.push(w); wL.push(w);
  }
  return {
    idx: Int32Array.from(idx), wH: Float32Array.from(wH), wL: Float32Array.from(wL), nasV, center: c,
    definition: {
      region: 'Wendland ellipsoid centred on the nasion vertex: x 0.22D, up 0.28D, down 0.32D, depth 0.35D; forward-facing skin',
      height: 'translation along canonical +Z x weight; nasion vertex moves by the value x its weight (~1)',
      level: 'translation along canonical +Y x weight: moves where the bridge starts up/down',
    },
  };
}

// Alar (콧볼) rig, per subject side, centred on the alar lobule estimated from THIS case's alar crease and tip landmarks:
//   lobule centre = crease moved 15% toward the midline, 0.03D down, 0.08D forward. Support x 0.20D, y 0.20D, z 0.22D,
//   limited to its own side of the midline and to y below the tip-lateral level + 0.1D (the dorsum is not touched).
//   width: x translation (half the total change per side) · balance: both sides shift along x (one wider, one narrower
//   relative to the midline) · flare: offset along smoothed normals on the lobule (0.04D at 100%)
function buildAlarRig(model, positions, normals, Gr) {
  const L = model.landmarks, D = model.D;
  const al = L.alar_crease_subject_left, ar = L.alar_crease_subject_right, prn = L.pronasale;
  if (!al || !ar) return null;
  const midX = prn[0], n = positions.length / 3;
  const centres = [al, ar].map((c) => [c[0] + 0.15 * (midX - c[0]), c[1] - 0.03 * D, c[2] + 0.08 * D]);
  const wend = (r) => (r >= 1 ? 0 : Math.pow(1 - r, 4) * (4 * r + 1));
  const rx = 0.20 * D, ry = 0.20 * D, rz = 0.22 * D, yTop = prn[1] + 0.1 * D;
  const idx = [], side = [], w = [], wf = [];
  // structure: each alar lobule moves as ONE piece (rigid core, ellipsoid r < 0.6); cheek, nostril sill and sidewall
  // follow by geodesic distance (0.2D), so the lobule keeps its shape instead of being stretched into a point
  let geo = null;
  if (Gr) {
    const core = [];
    for (let g = 0; g < Gr.G; g++) {
      const x = Gr.gp[3 * g], y = Gr.gp[3 * g + 1], z = Gr.gp[3 * g + 2];
      if (y > yTop) continue;
      const c = centres[x >= midX ? 0 : 1];
      const r = Math.hypot((x - c[0]) / rx, (y - c[1]) / ry, (z - c[2]) / rz);
      if (r < 0.6 && Math.abs(x - midX) > 0.11 * D) core.push(g);
    }
    if (core.length > 3) geo = dijkstra(Gr, core, 0.25 * D);
  }
  for (let i = 0; i < n; i++) {
    const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
    if (geo) {
      if (y > yTop + 0.05 * D) continue;
      const g = Gr.grp[i], d = geo.dist[g];
      if (!(d < 0.22 * D)) continue;
      const sgnS = Gr.gp[3 * geo.src[g]] >= midX ? 1 : -1; // side of the lobule this skin follows
      if ((x - midX) * sgnS < -0.01 * D) continue;          // never across the midline
      const mid = smoother((Math.abs(x - midX) - 0.03 * D) / (0.08 * D));
      const ww = envelope(d, 0.22 * D) * mid;
      if (ww <= 1e-6) continue;
      const c = centres[sgnS > 0 ? 0 : 1];
      const r = Math.hypot((x - c[0]) / rx, (y - c[1]) / ry, (z - c[2]) / rz);
      idx.push(i); side.push(sgnS); w.push(ww); wf.push(wend(Math.min(1, r / 0.8)) * mid);
      continue;
    }
    if (y > yTop) continue;
    const sgn = x >= midX ? 1 : -1;
    const c = centres[sgn > 0 ? 0 : 1];
    const dx = (x - c[0]) / rx, dy = (y - c[1]) / ry, dz = (z - c[2]) / rz;
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (r >= 1) continue;
    // midline fade: nothing crosses the columella / tip centre
    const mid = smoother((Math.abs(x - midX) - 0.03 * D) / (0.08 * D));
    const ww = wend(r) * mid;
    if (ww <= 1e-6) continue;
    idx.push(i); side.push(sgn); w.push(ww); wf.push(wend(Math.min(1, r / 0.8)) * mid);
  }
  // smoothed normals for flare (0.06D Gaussian) from the ORIGINAL surface
  const sN = new Float32Array(idx.length * 3), r2 = (0.06 * D) ** 2;
  for (let a = 0; a < idx.length; a++) {
    if (!normals) { sN[3 * a] = side[a]; continue; }
    const ia = idx[a]; let sx = 0, sy = 0, sz = 0;
    for (let b = 0; b < idx.length; b++) {
      const ib = idx[b];
      const ddx = positions[3 * ia] - positions[3 * ib], ddy = positions[3 * ia + 1] - positions[3 * ib + 1], ddz = positions[3 * ia + 2] - positions[3 * ib + 2];
      const d2 = ddx * ddx + ddy * ddy + ddz * ddz; if (d2 > r2) continue;
      const g = Math.exp(-d2 / (0.5 * r2)); sx += g * normals[3 * ib]; sy += g * normals[3 * ib + 1]; sz += g * normals[3 * ib + 2];
    }
    const l = Math.hypot(sx, sy, sz) || 1; sN[3 * a] = sx / l; sN[3 * a + 1] = sy / l; sN[3 * a + 2] = sz / l;
  }
  // control vertices: crease points (width/balance handles) and lobule points (flare handle), on-surface
  const near = (p, sgn) => { let best = -1, bd = Infinity; for (let a = 0; a < idx.length; a++) { if (side[a] !== sgn) continue; const i = idx[a]; const d = Math.hypot(positions[3 * i] - p[0], positions[3 * i + 1] - p[1], positions[3 * i + 2] - p[2]); if (d < bd) { bd = d; best = a; } } return best; };
  // width handles: the lateral-most strongly weighted lobule vertex per side (alar base width), so the handle follows
  // the finger and the value is exact at the handle (translation is normalised by the handle weight)
  const lateral = (sgn) => { let best = -1, bx = -Infinity; for (let a = 0; a < idx.length; a++) { if (side[a] !== sgn || w[a] < 0.6) continue; const ax = sgn * (positions[3 * idx[a]] - midX); if (ax > bx) { bx = ax; best = a; } } return best; };
  const jl = lateral(1) >= 0 ? lateral(1) : near(al, 1), jr = lateral(-1) >= 0 ? lateral(-1) : near(ar, -1);
  const jLobL = near(centres[0], 1), jLobR = near(centres[1], -1);
  if (jl < 0 || jr < 0 || jLobL < 0) return null;
  return {
    idx: Int32Array.from(idx), side: Int8Array.from(side), w: Float32Array.from(w), wf: Float32Array.from(wf), sN,
    lV: idx[jl], rV: idx[jr], wHL: w[jl], wHR: w[jr], lobL: idx[jLobL], lobLj: jLobL, lobR: jLobR >= 0 ? idx[jLobR] : idx[jLobL], midX, flareK: 0.04 * D,
    definition: {
      region: 'per side: Wendland ellipsoid on the alar lobule (crease 15% toward the midline, 0.03D down, 0.08D forward), x/y 0.20D, z 0.22D, below tip level + 0.1D, faded at the midline',
      width: 'x translation, half of the value per side outward/inward, normalised so the lateral-most lobule handles move exactly by the value (total alar base width)',
      balance: 'both sides shift along +x (subject left) by half the value: the left lobule moves away from the midline and the right one toward it',
      flare: 'offset along Gaussian-smoothed original normals on the lobule core, 100% = 0.04D; relative shape index',
    },
  };
}

// Columella (비주) rig: midline strip between the subnasale and the tip lobule underside of THIS case.
//   centre = on-surface down-facing midline vertex nearest to sn + 0.45*(prn - sn); support x 0.12D, y 0.2D, z 0.25D
//   the pronasale stays fixed (fade within 0.18D of it) and the upper lip below the subnasale stays fixed.
//   show: -Y translation x weight · angle: rotation about X through the subnasale x weight (+ = columella swings up,
//   larger nasolabial angle) · width: X scaling about the midline
function buildColumellaRig(model, positions, normals) {
  const L = model.landmarks, D = model.D, sn = L.subnasale, prn = L.pronasale;
  if (!sn || !(prn[1] - sn[1] > 0.1 * D)) return null;
  const n = positions.length / 3, midX = prn[0];
  const t = [midX, sn[1] + 0.45 * (prn[1] - sn[1]), sn[2] + 0.55 * (prn[2] - sn[2])];
  let colV = -1, bd = Infinity;
  for (let i = 0; i < n; i++) {
    const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
    if (Math.abs(x - midX) > 0.05 * D) continue;
    if (normals && normals[3 * i + 1] > -0.15) continue; // underside (faces down)
    const d = Math.hypot(y - t[1], z - t[2]);
    if (d < bd) { bd = d; colV = i; }
  }
  if (colV < 0 || bd > 0.25 * D) return null;
  const c = [positions[3 * colV], positions[3 * colV + 1], positions[3 * colV + 2]];
  const wend = (r) => (r >= 1 ? 0 : Math.pow(1 - r, 4) * (4 * r + 1));
  const idx = [], w = [], ww = [];
  for (let i = 0; i < n; i++) {
    const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
    const dx = (x - c[0]) / (0.12 * D), dy = (y - c[1]) / (0.2 * D), dz = (z - c[2]) / (0.25 * D);
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (r >= 1) continue;
    const dt = Math.hypot(x - prn[0], y - prn[1], z - prn[2]);
    const keepTip = smoother((dt - 0.08 * D) / 0.1 / D);
    const keepLip = smoother((y - (sn[1] - 0.06 * D)) / (0.05 * D));
    const wi = wend(r) * keepTip * keepLip;
    if (wi <= 1e-6) continue;
    idx.push(i); w.push(wi); ww.push(wi);
  }
  // width handles: lateral-most columella vertices with weight > 0.5 at the centre height (+-0.05D)
  let wl = -1, wr = -1, xl = -Infinity, xr = Infinity;
  for (let a = 0; a < idx.length; a++) {
    const i = idx[a], x = positions[3 * i], y = positions[3 * i + 1];
    if (w[a] < 0.3 || Math.abs(y - c[1]) > 0.08 * D) continue;
    if (x > midX && x > xl) { xl = x; wl = i; }   // one handle on each side of the midline
    if (x < midX && x < xr) { xr = x; wr = i; }
  }
  if (wl < 0 || wr < 0) { wl = colV; wr = colV; }
  return {
    idx: Int32Array.from(idx), w: Float32Array.from(w), ww: Float32Array.from(ww), colV, wl, wr, midX,
    W0: Math.abs(positions[3 * wl] - positions[3 * wr]), pivot: [sn[1], sn[2]], center: c,
    definition: {
      region: 'Wendland ellipsoid on the columella (x 0.12D, y 0.2D, z 0.25D) around the down-facing midline vertex 45% of the way from the subnasale to the pronasale; pronasale and upper lip faded to 0',
      show: '-Y translation x weight (columella hangs lower: more columella visible from the side)',
      angle: 'rotation about the X axis through the subnasale, angle x weight; positive = the columella swings up (larger nasolabial angle)',
      width: 'X scaling about the midline (index %)',
    },
  };
}

// ---------- geodesic helpers (welded surface graph; UV-seam duplicates are one node) ----------
function weldedGraph(positions, index, D) {
  const n = positions.length / 3;
  const key = (i) => `${Math.round(positions[3 * i] / (1e-6 * D))},${Math.round(positions[3 * i + 1] / (1e-6 * D))},${Math.round(positions[3 * i + 2] / (1e-6 * D))}`;
  const gid = new Map(), grp = new Int32Array(n);
  for (let i = 0; i < n; i++) { const k = key(i); if (!gid.has(k)) gid.set(k, gid.size); grp[i] = gid.get(k); }
  const G = gid.size, gp = new Float64Array(3 * G);
  for (let i = 0; i < n; i++) { const g = grp[i]; gp[3 * g] = positions[3 * i]; gp[3 * g + 1] = positions[3 * i + 1]; gp[3 * g + 2] = positions[3 * i + 2]; }
  const nb = Array.from({ length: G }, () => new Set());
  for (let t = 0; t < index.length / 3; t++) {
    const a = grp[index[3 * t]], b = grp[index[3 * t + 1]], c = grp[index[3 * t + 2]];
    if (a !== b) { nb[a].add(b); nb[b].add(a); } if (b !== c) { nb[b].add(c); nb[c].add(b); } if (a !== c) { nb[a].add(c); nb[c].add(a); }
  }
  const off = new Int32Array(G + 1); for (let g = 0; g < G; g++) off[g + 1] = off[g] + nb[g].size;
  const lst = new Int32Array(off[G]), el = new Float64Array(off[G]);
  for (let g = 0; g < G; g++) { let k = off[g]; for (const h of nb[g]) { lst[k] = h; el[k] = Math.hypot(gp[3 * g] - gp[3 * h], gp[3 * g + 1] - gp[3 * h + 1], gp[3 * g + 2] - gp[3 * h + 2]); k++; } }
  return { n, G, grp, gp, off, lst, el };
}
// multi-source Dijkstra (binary heap) up to maxDist; returns per-group distance and nearest source group
function dijkstra(Gr, sources, maxDist) {
  const dist = new Float64Array(Gr.G).fill(Infinity), src = new Int32Array(Gr.G).fill(-1);
  const heap = []; // [d, g]
  const push = (d, g) => { heap.push([d, g]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (const g of sources) { if (dist[g] === 0) continue; dist[g] = 0; src[g] = g; push(0, g); }
  while (heap.length) {
    const [d, g] = pop();
    if (d > dist[g] || d > maxDist) continue;
    for (let k = Gr.off[g]; k < Gr.off[g + 1]; k++) {
      const h = Gr.lst[k], nd = d + Gr.el[k];
      if (nd < dist[h] && nd <= maxDist) { dist[h] = nd; src[h] = src[g]; push(nd, h); }
    }
  }
  return { dist, src };
}
const envelope = (d, R) => (d >= R ? 0 : 1 - smoother(d / R)); // C2, 1 at the core edge, 0 at R

export function toModelUnits(model, id, value) {
  const unit = paramUnit(model, id);
  if (unit === 'mm') return value / model.units.mm_per_unit;
  if (unit === 'pctD') return (value / 100) * model.D;
  return value;
}
export function fromModelUnits(model, id, x) {
  const unit = paramUnit(model, id);
  if (unit === 'mm') return x * model.units.mm_per_unit;
  if (unit === 'pctD') return (x / model.D) * 100;
  return x;
}

// Evaluate an absolute semantic state. Returns new Float32Array positions (full copy) + measurement + validity.
export function evaluate(model, rig, base, normals, params, out) {
  const P = out || new Float32Array(base.length);
  P.set(base);
  const d = toModelUnits(model, 'tip_projection', params.tip_projection || 0);
  const h = toModelUnits(model, 'tip_height', params.tip_height || 0);
  const th = -((params.tip_rotation || 0) * Math.PI) / 180; // rotation about +X by -angle => tip goes up for positive
  const dW = toModelUnits(model, 'tip_width', params.tip_width || 0);
  const kW = rig.widthDen !== 0 ? dW / rig.widthDen : 0;
  const k = ((params.tip_fullness || 0) / 100) * rig.fullK;
  const cx = rig.center[0];
  const [py, pz] = [rig.pivot[1], rig.pivot[2]];
  // 0) dorsum ops (applied first; tip ops then act on the result, so the tip stays where the tip values put it)
  const Dr = rig.dorsum, Rx = rig.radix;
  let ref = base; // relaxation acts on the TIP-op displacement only (relative to the post-radix/dorsum surface)
  // -1) radix ops (first; dorsum and tip ops act on the result)
  if (Rx) {
    const rh = toModelUnits(model, 'radix_height', params.radix_height || 0);
    const rl = toModelUnits(model, 'radix_level', params.radix_level || 0);
    if (rh !== 0 || rl !== 0) {
      for (let j = 0; j < Rx.idx.length; j++) {
        const i = Rx.idx[j];
        P[3 * i + 1] += rl * Rx.wL[j];
        P[3 * i + 2] += rh * Rx.wH[j];
      }
      ref = null;
    }
  }
  if (Dr) {
    const dh = toModelUnits(model, 'dorsum_height', params.dorsum_height || 0);
    const hb = toModelUnits(model, 'dorsum_hump', params.dorsum_hump || 0);
    const sw = (params.dorsum_width || 0) / 100;
    if (dh !== 0 || hb !== 0 || sw !== 0) {
      const W = dorsumWeights(Dr, params);
      for (let j = 0; j < Dr.idx.length; j++) {
        const i = Dr.idx[j];
        let x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
        if (sw !== 0) x = Dr.midX + (x - Dr.midX) * (1 + sw * Dr.wW[j]);
        z += dh * W.wH[j];
        y += hb * W.wB[j] * Dr.nh[0]; z += hb * W.wB[j] * Dr.nh[1];
        P[3 * i] = x; P[3 * i + 1] = y; P[3 * i + 2] = z;
      }
      ref = null;
    }
  }
  const Al = rig.alar;
  if (Al) {
    const aw = toModelUnits(model, 'alar_width', params.alar_width || 0);
    const ab = toModelUnits(model, 'alar_balance', params.alar_balance || 0);
    const af = ((params.alar_flare || 0) / 100) * Al.flareK;
    if (aw !== 0 || ab !== 0 || af !== 0) {
      for (let j = 0; j < Al.idx.length; j++) {
        const i = Al.idx[j], sgn = Al.side[j], w = Al.w[j];
        // half the total width change per side (outward = +sgn); balance: subject-left (+x) out, right in
        P[3 * i] += (w / (sgn > 0 ? Al.wHL : Al.wHR)) * (sgn * 0.5 * aw + 0.5 * ab);
        if (af !== 0) { const wf = Al.wf[j]; P[3 * i] += wf * af * Al.sN[3 * j]; P[3 * i + 1] += wf * af * Al.sN[3 * j + 1]; P[3 * i + 2] += wf * af * Al.sN[3 * j + 2]; }
      }
      ref = null;
    }
  }
  const Co = rig.columella;
  if (Co) {
    const cs = toModelUnits(model, 'columella_show', params.columella_show || 0);
    const ca = -((params.nasolabial_angle || 0) * Math.PI) / 180; // same convention as tip_rotation: + = swings up (angle opens)
    const cw = (params.columella_width || 0) / 100;
    if (cs !== 0 || ca !== 0 || cw !== 0) {
      const [py, pz] = Co.pivot;
      for (let j = 0; j < Co.idx.length; j++) {
        const i = Co.idx[j], w = Co.w[j];
        let x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
        if (cw !== 0) x = Co.midX + (x - Co.midX) * (1 + cw * Co.ww[j]);
        if (ca !== 0) { const a = ca * w, c = Math.cos(a), sn = Math.sin(a), yy = y - py, zz = z - pz; y = py + yy * c - zz * sn; z = pz + yy * sn + zz * c; }
        y -= cs * w;
        P[3 * i] = x; P[3 * i + 1] = y; P[3 * i + 2] = z;
      }
      ref = null;
    }
  }
  if (ref === null) ref = new Float32Array(P);
  for (let j = 0; j < rig.idx.length; j++) {
    const i = rig.idx[j], w = rig.wT[j], wf = rig.wF[j], ww = rig.wW[j];
    let x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
    // 1) fullness along original normal
    if (k !== 0 && wf > 0) {
      x += wf * k * rig.sN[3 * j]; y += wf * k * rig.sN[3 * j + 1]; z += wf * k * rig.sN[3 * j + 2];
    }
    // 2) width: scale about the midline
    if (kW !== 0) x = cx + (x - cx) * (1 + ww * kW);
    // 3) rotation about X through pivot
    if (th !== 0) {
      const a = th * w, c = Math.cos(a), sn = Math.sin(a);
      const yy = y - py, zz = z - pz;
      y = py + yy * c - zz * sn; z = pz + yy * sn + zz * c;
    }
    // 4) translations
    y += w * h; z += w * d;
    P[3 * i] = x; P[3 * i + 1] = y; P[3 * i + 2] = z;
  }
  const R = rig.relax;
  if (R && R.iters > 0) {
    const { grp, G, off, lst, outside, fixed } = R;
    let disp = new Float64Array(3 * G); const cnt = new Float64Array(G);
    for (let j = 0; j < rig.idx.length; j++) {
      const i = rig.idx[j], g = grp[j];
      for (let c = 0; c < 3; c++) disp[3 * g + c] += P[3 * i + c] - ref[3 * i + c];
      cnt[g]++;
    }
    for (let g = 0; g < G; g++) for (let c = 0; c < 3; c++) disp[3 * g + c] /= cnt[g];
    let nxt = new Float64Array(3 * G);
    for (let it = 0; it < R.iters; it++) {
      for (let g = 0; g < G; g++) {
        if (fixed[g]) { nxt[3 * g] = disp[3 * g]; nxt[3 * g + 1] = disp[3 * g + 1]; nxt[3 * g + 2] = disp[3 * g + 2]; continue; }
        const m = off[g + 1] - off[g] + (outside[g] ? 1 : 0);
        let sx = 0, sy = 0, sz = 0;
        for (let q = off[g]; q < off[g + 1]; q++) { const h2 = lst[q]; sx += disp[3 * h2]; sy += disp[3 * h2 + 1]; sz += disp[3 * h2 + 2]; }
        const a = m ? R.alpha : 0;
        nxt[3 * g] = (1 - a) * disp[3 * g] + (m ? a * sx / m : 0);
        nxt[3 * g + 1] = (1 - a) * disp[3 * g + 1] + (m ? a * sy / m : 0);
        nxt[3 * g + 2] = (1 - a) * disp[3 * g + 2] + (m ? a * sz / m : 0);
      }
      const tmp = disp; disp = nxt; nxt = tmp;
    }
    for (let j = 0; j < rig.idx.length; j++) {
      const i = rig.idx[j], g = grp[j];
      for (let c = 0; c < 3; c++) P[3 * i + c] = ref[3 * i + c] + disp[3 * g + c];
    }
  }
  // final: smooth joins between all regions (edge_blend %). Region cores (weight ~1) and control vertices keep their
  // exact displacement, transition zones relax toward their neighbours, the outer boundary blends toward 0.
  const Bl = rig.blend, eb = (params.edge_blend || 0) / 100;
  if (Bl && eb > 0) {
    const { verts, grp, G, off, lst, outside, free } = Bl;
    let disp = new Float64Array(3 * G); const cnt = new Float64Array(G);
    for (let a = 0; a < verts.length; a++) { const i = verts[a], g = grp[a]; for (let c = 0; c < 3; c++) disp[3 * g + c] += P[3 * i + c] - base[3 * i + c]; cnt[g]++; }
    let any = false;
    for (let g = 0; g < G; g++) for (let c = 0; c < 3; c++) { disp[3 * g + c] /= cnt[g]; if (disp[3 * g + c]) any = true; }
    if (any) {
      let nxt = new Float64Array(3 * G);
      for (let it = 0; it < Bl.iters; it++) {
        for (let g = 0; g < G; g++) {
          const a = 0.5 * eb * free[g];
          const m = off[g + 1] - off[g] + (outside[g] ? 1 : 0);
          if (!a || !m) { nxt[3 * g] = disp[3 * g]; nxt[3 * g + 1] = disp[3 * g + 1]; nxt[3 * g + 2] = disp[3 * g + 2]; continue; }
          let sx = 0, sy = 0, sz = 0;
          for (let q = off[g]; q < off[g + 1]; q++) { const h = lst[q]; sx += disp[3 * h]; sy += disp[3 * h + 1]; sz += disp[3 * h + 2]; }
          nxt[3 * g] = (1 - a) * disp[3 * g] + a * sx / m; nxt[3 * g + 1] = (1 - a) * disp[3 * g + 1] + a * sy / m; nxt[3 * g + 2] = (1 - a) * disp[3 * g + 2] + a * sz / m;
        }
        const tmp = disp; disp = nxt; nxt = tmp;
      }
      for (let a = 0; a < verts.length; a++) { const i = verts[a], g = grp[a]; for (let c = 0; c < 3; c++) P[3 * i + c] = base[3 * i + c] + disp[3 * g + c]; }
    }
  }
  return P;
}

// union of all region vertices with per-group freedom = 1 - max region weight (0 at region cores and control vertices)
function buildBlendGraph(model, positions, index, R) {
  const n = positions.length / 3, D = model.D;
  const wMax = new Float32Array(n), inU = new Uint8Array(n);
  const add = (ids, ws) => { for (let a = 0; a < ids.length; a++) { const i = ids[a]; inU[i] = 1; if (ws) wMax[i] = Math.max(wMax[i], ws[a]); } };
  add(R.idx, R.wT);
  if (R.dorsum) { add(R.dorsum.idx, R.dorsum.wH); add(R.dorsum.idx, R.dorsum.wW); }
  if (R.radix) add(R.radix.idx, R.radix.wH);
  if (R.alar) add(R.alar.idx, R.alar.w);
  if (R.columella) add(R.columella.idx, R.columella.w);
  const ctrl = new Set(Object.values(model.controls).map((c) => c.vertex));
  if (R.dorsum) for (const v of [R.dorsum.midV, R.dorsum.humpV, R.dorsum.dlV, R.dorsum.drV, ...R.dorsum.profV]) ctrl.add(v);
  if (R.radix) ctrl.add(R.radix.nasV);
  if (R.alar) for (const v of [R.alar.lV, R.alar.rV, R.alar.lobL, R.alar.lobR]) ctrl.add(v);
  if (R.columella) for (const v of [R.columella.colV, R.columella.wl, R.columella.wr]) ctrl.add(v);
  const verts = []; for (let i = 0; i < n; i++) if (inU[i]) verts.push(i);
  const key = (i) => `${Math.round(positions[3 * i] / (1e-6 * D))},${Math.round(positions[3 * i + 1] / (1e-6 * D))},${Math.round(positions[3 * i + 2] / (1e-6 * D))}`;
  const gid = new Map(), grp = new Int32Array(verts.length), local = new Int32Array(n).fill(-1);
  verts.forEach((i, a) => { local[i] = a; const k = key(i); if (!gid.has(k)) gid.set(k, gid.size); grp[a] = gid.get(k); });
  const G = gid.size, free = new Float32Array(G).fill(1), nb = Array.from({ length: G }, () => new Set()), outside = new Uint8Array(G);
  verts.forEach((i, a) => { const g = grp[a]; free[g] = Math.min(free[g], ctrl.has(i) ? 0 : Math.max(0, 1 - wMax[i])); });
  for (let t = 0; t < index.length / 3; t++) {
    const tri = [index[3 * t], index[3 * t + 1], index[3 * t + 2]], loc = tri.map((v) => local[v]);
    if (loc.every((l) => l < 0)) continue;
    for (let u = 0; u < 3; u++) for (let v = 0; v < 3; v++) {
      if (u === v || loc[u] < 0) continue;
      if (loc[v] < 0) outside[grp[loc[u]]] = 1; else if (grp[loc[u]] !== grp[loc[v]]) nb[grp[loc[u]]].add(grp[loc[v]]);
    }
  }
  const off = new Int32Array(G + 1); for (let g = 0; g < G; g++) off[g + 1] = off[g] + nb[g].size;
  const lst = new Int32Array(off[G]); for (let g = 0; g < G; g++) { let k = off[g]; for (const x of nb[g]) lst[k++] = x; }
  return { verts: Int32Array.from(verts), grp, G, off, lst, outside, free, iters: 12 };
}

export function measure(model, rig, base, P, params) {
  const t0 = v3(base, rig.tipV), t1 = v3(P, rig.tipV);
  const ang = (p) => Math.atan2(p[1] - rig.pivot[1], p[2] - rig.pivot[2]);
  const dAng = ((ang(t1) - ang(t0)) * 180) / Math.PI;
  const W1 = Math.abs(P[3 * rig.tlV] - P[3 * rig.trV]);
  // fullness index: mean normal offset over bump core (wF>0.5) relative to 0.08D
  let acc = 0, cnt = 0;
  for (let j = 0; j < rig.idx.length; j++) {
    if (rig.wF[j] <= 0.5) continue;
    const i = rig.idx[j];
    const dv = sub(v3(P, i), v3(base, i));
    // remove the parts explained by rigid-ish ops: approximate by comparing with fullness-free evaluation is done by caller if needed
    acc += dv[0] * model.__n[3 * i] + dv[1] * model.__n[3 * i + 1] + dv[2] * model.__n[3 * i + 2];
    cnt++;
  }
  const meanN = cnt ? acc / cnt : 0;
  return {
    tip_forward_model: t1[2] - t0[2],
    tip_up_model: t1[1] - t0[1],
    measured: {
      tip_projection: fromModelUnits(model, 'tip_projection', t1[2] - t0[2]),
      tip_height: fromModelUnits(model, 'tip_height', t1[1] - t0[1]),
      tip_rotation: dAng,
      tip_width: fromModelUnits(model, 'tip_width', W1 - rig.W0),
      tip_fullness_mean_normal_offset_index: (meanN / rig.fullK) * 100,
      ...(rig.dorsum ? {
        dorsum_height: fromModelUnits(model, 'dorsum_height', P[3 * rig.dorsum.midV + 2] - base[3 * rig.dorsum.midV + 2]),
        dorsum_hump: fromModelUnits(model, 'dorsum_hump', (P[3 * rig.dorsum.humpV + 1] - base[3 * rig.dorsum.humpV + 1]) * rig.dorsum.nh[0] + (P[3 * rig.dorsum.humpV + 2] - base[3 * rig.dorsum.humpV + 2]) * rig.dorsum.nh[1]),
        dorsum_width_pct: (Math.abs(P[3 * rig.dorsum.dlV] - P[3 * rig.dorsum.drV]) / (rig.dorsum.W0 || 1) - 1) * 100,
      } : {}),
      ...(rig.alar ? {
        alar_width: fromModelUnits(model, 'alar_width', Math.abs(P[3 * rig.alar.lV] - P[3 * rig.alar.rV]) - Math.abs(base[3 * rig.alar.lV] - base[3 * rig.alar.rV])),
        alar_balance: fromModelUnits(model, 'alar_balance', (P[3 * rig.alar.lV] - base[3 * rig.alar.lV]) + (P[3 * rig.alar.rV] - base[3 * rig.alar.rV])),
        alar_flare_offset_index: (() => { const i = rig.alar.lobL, j = rig.alar.lobLj; return ((P[3 * i] - base[3 * i]) * rig.alar.sN[3 * j] + (P[3 * i + 1] - base[3 * i + 1]) * rig.alar.sN[3 * j + 1] + (P[3 * i + 2] - base[3 * i + 2]) * rig.alar.sN[3 * j + 2]) / rig.alar.flareK * 100; })(),
      } : {}),
      ...(rig.columella ? (() => {
        const C = rig.columella, v = C.colV, ang = (Q) => Math.atan2(Q[3 * v + 1] - C.pivot[0], Q[3 * v + 2] - C.pivot[1]);
        return {
          columella_show: fromModelUnits(model, 'columella_show', -(P[3 * v + 1] - base[3 * v + 1])),
          nasolabial_angle_change_deg: ((ang(P) - ang(base)) * 180) / Math.PI,
          columella_width_pct: C.W0 > 0 ? (Math.abs(P[3 * C.wl] - P[3 * C.wr]) / C.W0 - 1) * 100 : null,
        };
      })() : {}),
      ...(rig.radix ? {
        radix_height: fromModelUnits(model, 'radix_height', P[3 * rig.radix.nasV + 2] - base[3 * rig.radix.nasV + 2]),
        radix_level: fromModelUnits(model, 'radix_level', P[3 * rig.radix.nasV + 1] - base[3 * rig.radix.nasV + 1]),
      } : {}),
    },
    definitions: {
      tip_projection: 'Δz of the registered pronasale vertex (includes coupling from rotation/height ops)',
      tip_height: 'Δy of the registered pronasale vertex',
      tip_rotation: 'change of the pivot→pronasale angle in the canonical YZ plane (positive = up)',
      tip_width: 'Δ|x_L − x_R| of the registered tip_lat control vertices (total width)',
      tip_fullness_mean_normal_offset_index: 'mean displacement along original normals over the bump core (wF>0.5) / 0.05D ×100 (other ops also contribute)',
      dorsum_height: 'Δz of the mid-dorsum control vertex',
      dorsum_hump: 'displacement of the hump control vertex along the chord normal',
      dorsum_width_pct: '% change of |x_L − x_R| of the bridge width handles (weight there < 1, so smaller than the value)',
      radix_height: 'Δz of the nasion control vertex',
      radix_level: 'Δy of the nasion control vertex',
    },
  };
}

// Validity: inspect every triangle touching an affected vertex.
export function validate(rig, base, P, index, triCache) {
  const tris = triCache || affectedTriangles(rig, index, base.length / 3);
  let flips = 0, degenerate = 0, maxStretch = 1, minAreaRatio = Infinity;
  if (rig._minEdge === undefined) {
    // stretch is judged only on edges >= 25% of the median edge length in the region: ratios of near-zero edges
    // (nostril rims, decimation slivers) are numerically unstable and not visible; flips/collapse stay strict
    const ls = [];
    for (let t = 0; t < tris.length; t++) { const f = tris[t]; ls.push(len(sub(v3(base, index[3 * f]), v3(base, index[3 * f + 1])))); }
    ls.sort((x, y) => x - y);
    rig._minEdge = 0.25 * (ls[ls.length >> 1] || 0);
  }
  for (let t = 0; t < tris.length; t++) {
    const f = tris[t];
    const a = index[3 * f], b = index[3 * f + 1], c = index[3 * f + 2];
    const n0 = cross(sub(v3(base, b), v3(base, a)), sub(v3(base, c), v3(base, a)));
    const n1 = cross(sub(v3(P, b), v3(P, a)), sub(v3(P, c), v3(P, a)));
    const A0 = len(n0), A1 = len(n1);
    if (A0 < 1e-18) continue;
    if (dot(n0, n1) <= 0) flips++;
    const ratio = A1 / A0;
    if (ratio < minAreaRatio) minAreaRatio = ratio;
    if (ratio < 0.05) degenerate++;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const l0 = len(sub(v3(base, u), v3(base, v))), l1 = len(sub(v3(P, u), v3(P, v)));
      if (l0 > rig._minEdge) maxStretch = Math.max(maxStretch, l1 / l0, l0 / Math.max(l1, 1e-12));
    }
  }
  const valid = flips === 0 && degenerate === 0 && maxStretch < 4;
  return { valid, flips, degenerate, maxStretch, minAreaRatio, triangles: tris.length,
    reason: valid ? null : (flips ? `면 뒤집힘 ${flips}개` : degenerate ? `면 붕괴 ${degenerate}개` : `과도한 늘어남 ×${maxStretch.toFixed(1)}`) };
}

export function affectedTriangles(rig, index, nVerts) {
  const mark = new Uint8Array(nVerts);
  for (const i of rig.idx) mark[i] = 1;
  if (rig.dorsum) for (const i of rig.dorsum.idx) mark[i] = 1;
  if (rig.radix) for (const i of rig.radix.idx) mark[i] = 1;
  if (rig.alar) for (const i of rig.alar.idx) mark[i] = 1;
  if (rig.columella) for (const i of rig.columella.idx) mark[i] = 1;
  if (rig.blend) for (const i of rig.blend.verts) mark[i] = 1;
  const out = [];
  for (let f = 0; f < index.length / 3; f++) {
    if (mark[index[3 * f]] || mark[index[3 * f + 1]] || mark[index[3 * f + 2]]) out.push(f);
  }
  return Int32Array.from(out);
}

// Clamp to experimental geometry limits. Returns {params, clamped:[{id,requested,applied,reason}]}
export function clampParams(model, params, caseLimits) {
  const outp = { ...params };
  const clamped = [];
  for (const p of NOSE_PARAMS) {
    const lim = caseLimits ? caseLimits[p.id] : limitsFor(model, p.id);
    const v = Number(params[p.id] || 0);
    const c = Math.min(lim[1], Math.max(lim[0], v));
    if (c !== v) clamped.push({ id: p.id, requested: v, applied: c, reason: '기술 검증 범위 밖 (의학적 한계 아님)' });
    outp[p.id] = c;
  }
  return { params: outp, clamped };
}

// Convenience: full pipeline used by UI and tests.
export function createEditor(model, base, normals, index, precomputedLimits = null, engineVersion = ENGINE_VERSION) {
  model.__n = normals;
  const rig = buildRig(model, base, normals, index, engineVersion);
  const tris = affectedTriangles(rig, index, base.length / 3);
  // the limit scan evaluates every parameter in 24 steps per side (~10 s on a 20k-vertex case): viewers may pass the
  // result computed once offline (tools/case_limits.mjs), the editor app keeps scanning
  const caseLimits = precomputedLimits || scanCaseLimits(model, rig, base, normals, index, tris);
  let lastValid = zeroParams();
  return {
    rig,
    caseLimits,
    apply(requested) {
      const { params, clamped } = clampParams(model, requested, caseLimits);
      const P = evaluate(model, rig, base, normals, params);
      const validity = validate(rig, base, P, index, tris);
      if (!validity.valid) {
        // move from the last valid state toward the request and stop at the furthest valid point (bisection),
        // so the user gets as much of the change as the surface allows instead of a silent no-op
        let lo = 0, hi = 1, bestP = null, bestParams = { ...lastValid };
        const mix = (t) => { const o = {}; for (const q of NOSE_PARAMS) o[q.id] = lastValid[q.id] + t * (params[q.id] - lastValid[q.id]); return o; };
        for (let it = 0; it < 10; it++) {
          const t = (lo + hi) / 2, pm = mix(t);
          const Pm = evaluate(model, rig, base, normals, pm);
          if (validate(rig, base, Pm, index, tris).valid) { lo = t; bestP = Pm; bestParams = pm; } else hi = t;
        }
        const dec = (id) => (paramUnit(model, id) === 'percent' ? 0 : 1);
        for (const q of NOSE_PARAMS) bestParams[q.id] = Math.trunc(bestParams[q.id] * 10 ** dec(q.id)) / 10 ** dec(q.id);
        const Pl = evaluate(model, rig, base, normals, bestParams);
        const vl = validate(rig, base, Pl, index, tris);
        const finalParams = vl.valid ? bestParams : { ...lastValid };
        const Pf = vl.valid ? Pl : evaluate(model, rig, base, normals, lastValid);
        if (vl.valid) lastValid = { ...finalParams };
        return { ok: false, partial: vl.valid ? +lo.toFixed(3) : 0, params: finalParams, positions: Pf, clamped, validity,
          measurement: measure(model, rig, base, Pf, finalParams) };
      }
      lastValid = { ...params };
      return { ok: true, params, positions: P, clamped, validity, measurement: measure(model, rig, base, P, params) };
    },
    reset() { lastValid = zeroParams(); },
  };
}

export function scanCaseLimits(model, rig, base, normals, index, tris) {
  const out = {};
  for (const p of NOSE_PARAMS) {
    const cap = limitsFor(model, p.id);
    const unit = paramUnit(model, p.id);
    const steps = 24;
    const lim = [0, 0];
    for (const side of [0, 1]) {
      const end = cap[side];
      let last = 0;
      for (let k = 1; k <= steps; k++) {
        const v = (end * k) / steps;
        const P = evaluate(model, rig, base, normals, { ...zeroParams(), [p.id]: v });
        if (!validate(rig, base, P, index, tris).valid) break;
        last = v;
      }
      lim[side] = last === end ? end : 0.85 * last;
    }
    const dec = unit === 'percent' ? 0 : 1;
    out[p.id] = lim.map((x) => Number(x.toFixed(dec)));
  }
  return out;
}

// Edit-state document (saved JSON). Values are original-relative absolute values in their stated units.
export function editDocument(model, params, extra = {}) {
  const units = {};
  for (const p of NOSE_PARAMS) units[p.id] = paramUnit(model, p.id);
  return {
    schema: 'live-mirror-edit-v1',
    engine_version: ENGINE_VERSION,
    original_model_id: model.case_id + '/' + model.session_id,
    original_editable_sha256: model.editable_sha256,
    raw_sha256: model.raw_sha256,
    topology_version: model.topology_version,
    rig_version: model.rig_version,
    registry_version: 'nose-p1-v1 (tip + dorsum)',
    metric_scale_known: !!(model.units && model.units.metric_scale_known),
    scale_basis: model.units && model.units.metric_scale_known ? 'verified mm_per_unit' : 'relative: percent of D (nasion–subnasale vertical distance of this case)',
    semantic_values: { ...params },
    units,
    symmetry: 'symmetric_midline_ops (tip ops act about the registered midline; asymmetry of the original is preserved, not symmetrised)',
    ...extra,
  };
}
