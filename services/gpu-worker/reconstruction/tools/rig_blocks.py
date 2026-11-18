"""Edit / expression blocks of the adopted model, shared by tools/glb_rig.py (glb viewer) and tools/viewer_data.py
(360° viewer). Moved unchanged out of viewer_data.py (2026-10-20, W13 E4) so the glb viewer's data does not need the
360° viewer code (the team share leaves the 360° viewer out).
"""
import base64, json, os, subprocess, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
from uv_bake import TEMPLATE  # noqa


def b64(a, dt):
    return base64.b64encode(np.ascontiguousarray(a, dtype=dt).tobytes()).decode()


def gnm_expression_block(V0, lid, n_eye=16, n_lower=48, sigma_frac=0.015, axes=None, depth_w=0.3):
    """GNM Head v3 EXPRESSION basis on the adopted model (2026-10-16): the statistical model also knows how faces MOVE
    (eyes 100 + 100, lower face incl. jaw / teeth 150 components, learned from real scans). The first components are
    carried over to this person: GNM template -> fitted mesh similarity (same vertex order), displacement = s R B_k.
    The viewer solves, per tracked video frame, the component weights that best explain the landmark motion
    (ridge least squares with the model's prior b ~ N(0, I)): w = P . landmark_displacement (P precomputed here).
    Returns None when GNM is missing or the mesh is not in GNM vertex order (e.g. the experimental lip cut)."""
    try:
        sys.path.insert(0, os.path.join(HERE, "..", "pipeline"))
        from gnm_model import GNM, template_map
        G = GNM(); o2g = template_map()[0]
    except (Exception, SystemExit):
        return None
    if len(V0) != len(o2g): return None
    T = G.T[o2g]; skin = np.asarray(np.load(TEMPLATE)["materials"]) == 0
    A0, B0 = T[skin], V0[skin]; ca, cb = A0.mean(0), B0.mean(0)
    U, Sv, Vt = np.linalg.svd((B0 - cb).T @ (A0 - ca)); dd = np.sign(np.linalg.det(U @ Vt))
    R = U @ np.diag([1, 1, dd]) @ Vt; s = np.trace(np.diag(Sv) @ np.diag([1, 1, dd])) / ((A0 - ca) ** 2).sum()
    comps = [i for i, n in enumerate(G.ex_names) if n.startswith("left_eye_region_") and int(n[-3:]) < n_eye] + \
            [i for i, n in enumerate(G.ex_names) if n.startswith("right_eye_region_") and int(n[-3:]) < n_eye] + \
            [i for i, n in enumerate(G.ex_names) if n.startswith("lower_face_region_") and int(n[-3:]) < n_lower]
    shapes, cols = {}, []
    for i in comps:
        d = s * (G.B_ex[i][o2g] @ R.T)                                # (V, 3) world displacement per unit weight
        m = np.linalg.norm(d, axis=1); keep = np.where(m > 0.01 * m.max())[0]
        sc = float(np.abs(d[keep]).max()) / 32000 + 1e-12
        shapes[f"gx_{G.ex_names[i]}"] = {"idx": b64(keep, "<i4"), "q": b64(np.round(d[keep] / sc), "<i2"), "sc": sc}
        cols.append(d[lid].reshape(-1))
    A = np.stack(cols, 1)                                              # (468*3, K)
    iod = np.linalg.norm(V0[lid[33]] - V0[lid[263]]); sg = sigma_frac * iod
    # the tracker's DEPTH (MediaPipe z) is much noisier than its image position: the forward component of every landmark
    # motion counts depth_w as much (W = B^T diag(1, 1, depth_w) B per landmark, B = right / up / forward)
    Wl = np.eye(3)
    if axes is not None:
        Bm = np.stack([axes["right"], axes["up"], axes["fwd"]]); Wl = Bm.T @ np.diag([1.0, 1.0, depth_w]) @ Bm
    Wb = np.kron(np.eye(len(lid)), Wl)                                 # (1404, 1404) block diagonal
    AtW = A.T @ Wb
    P = np.linalg.solve(AtW @ A / sg ** 2 + np.eye(A.shape[1]), AtW / sg ** 2)   # (K, 1404)
    names = [f"gx_{G.ex_names[i]}" for i in comps]
    return {"shapes": shapes, "names": names, "P": b64(P, "<f4"), "K": len(names), "clip": 4.0,
            "note": "GNM Head v3 expression components (Apache-2.0)"}


INNER_UPPER = [13, 82, 81, 80, 191, 312, 311, 310, 415]      # MediaPipe inner lip contour, upper / lower (same order)
INNER_LOWER = [14, 87, 178, 88, 95, 317, 402, 318, 324]


def lip_split_lid(lid, G=None):
    """OPTION (2026-11-12, glb_rig.py --lip-split): landmark -> vertex map for the EXPRESSION solve only.
    The fitting map (assets/gnm_mp468.json) was made on the closed mouth: 6 of the 9 inner-lip pairs (13|14 ...) sit on
    ONE vertex and some upper-lip landmarks sit on lower-lip vertices, so the tracked lips moving apart cancel out in
    w = P . landmark motion. Here every inner upper-lip landmark is moved to the nearest vertex of GNM's 'upper_lip'
    group and every inner lower-lip landmark to the nearest 'lower_lip' vertex (on the GNM mean: the same vertices for
    every person). The fitting map itself is not changed. Returns (lid2, info) or (lid, None) without GNM."""
    try:
        sys.path.insert(0, os.path.join(HERE, "..", "pipeline"))
        from gnm_model import GNM, template_map
        from scipy.spatial import cKDTree
        G = G or GNM(); o2g = template_map()[0]
    except (Exception, SystemExit):
        return np.asarray(lid), None
    lid2 = np.array(lid).copy(); T = G.T[o2g]
    if len(T) <= int(lid2.max()): return lid2, None
    iod = float(np.linalg.norm(T[lid2[33]] - T[lid2[263]])); moved = []
    for name, ids in (("upper_lip", INNER_UPPER), ("lower_lip", INNER_LOWER)):
        cand = np.where(G.group(name)[o2g])[0]; tree = cKDTree(T[cand])
        for k in ids:
            d, j = tree.query(T[lid2[k]])
            if cand[j] != lid2[k]: moved.append((k, int(lid2[k]), int(cand[j]), round(float(d / iod), 4)))
            lid2[k] = cand[j]
    shared = len(set(lid2[INNER_UPPER].tolist()) & set(lid2[INNER_LOWER].tolist()))
    return lid2, {"moved": len(moved), "max_move_iod": max([m[3] for m in moved], default=0.0), "shared_after": shared,
                  "shared_before": len(set(np.asarray(lid)[INNER_UPPER].tolist()) & set(np.asarray(lid)[INNER_LOWER].tolist()))}


def head_joint_block(V, G=None):
    """OPTION (2026-11-12, 만두: the whole bust turned with the tracked head, the vertical axis tilted): GNM's own skinning
    for the HEAD joint, so the viewer can turn the head on a fixed bust. Per base vertex the weight of the head joint
    (+ the eye joints, its children) and the joint position of the GNM mean carried to this model by the similarity
    that aligns the mean's exterior skin with V (the person's own joint offset is not known from a glb: mean position)."""
    try:
        from gnm_model import GNM, template_map
        G = G or GNM(); o2g = template_map()[0]
    except (Exception, SystemExit):
        return None
    T = G.T[o2g]; sk = G.group("skin_exterior")[o2g]; ok = sk & ~np.isnan(V[:, 0]); ca, cb = T[ok].mean(0), V[ok].mean(0)
    U, Sv, Vt = np.linalg.svd((V[ok] - cb).T @ (T[ok] - ca)); dd = np.sign(np.linalg.det(U @ Vt)); Rr = U @ np.diag([1, 1, dd]) @ Vt
    s = (Sv * [1, 1, dd]).sum() / ((T[ok] - ca) ** 2).sum()
    jn = G.joint_names; w = sum(G.W[jn.index(k)] for k in ("head", "left_eye", "right_eye"))[o2g]
    pivot = s * (G.J0[jn.index("head")] - ca) @ Rr.T + cb
    return {"w": b64(w, "<f4"), "pivot": [float(x) for x in pivot], "fixed_vertices": int((w < 0.01).sum()), "full_vertices": int((w > 0.99).sum())}

MOUTH_BASE = {1: (0.80, 0.75, 0.69), 2: (0.40, 0.15, 0.16), 3: (0.42, 0.16, 0.17)}   # teeth ivory, gums, tongue (linear)


def mouth_colors(V, ids, fwd, iod):
    """Per-vertex colour of the teeth / gums / tongue (2026-11-12, 만두: the teeth read as one flat white band).
    The glb gives each part ONE plain colour and the viewers have no shadows, so nothing separates the teeth. Colour =
    base colour of the vertex's material x two shades computed on the mesh itself:
      depth    how far behind the front teeth the vertex sits (0.92 at the front -> 0.30 at 0.55 x eye distance): no
               light reaches the back of the mouth
      crevice  how concave the surface is at the vertex (Laplacian along the normal / edge length): the gaps between
               teeth and the gum line go darker (down to 0.55), the tooth faces stay
    V: positions with the mouth parts where they belong; ids: the mouth vertices. Returns (len(ids), 3) float32."""
    tpl = np.load(TEMPLATE); F = tpl["triangles"].astype(np.int64); mat = tpl["materials"]
    Fm = F[np.isin(mat[F], [1, 2, 3]).all(1)]; n = len(V)
    nrm = np.zeros((n, 3)); c = np.cross(V[Fm[:, 1]] - V[Fm[:, 0]], V[Fm[:, 2]] - V[Fm[:, 0]])
    for k in range(3): np.add.at(nrm, Fm[:, k], c)
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-18
    e = np.vstack([Fm[:, [0, 1]], Fm[:, [1, 2]], Fm[:, [2, 0]]]); e = np.vstack([e, e[:, ::-1]])
    acc = np.zeros((n, 3)); cnt = np.zeros(n); ln = np.zeros(n)
    np.add.at(acc, e[:, 0], V[e[:, 1]]); np.add.at(cnt, e[:, 0], 1); np.add.at(ln, e[:, 0], np.linalg.norm(V[e[:, 1]] - V[e[:, 0]], axis=1))
    ok = cnt > 0; lap = np.zeros((n, 3)); lap[ok] = acc[ok] / cnt[ok, None] - V[ok]
    conc = np.zeros(n); conc[ok] = (lap[ok] * nrm[ok]).sum(1) / (ln[ok] / cnt[ok] + 1e-18)
    # the part normals point outward when most vertices are convex; flip if not
    if np.median(conc[ids]) > 0: conc = -conc
    step = lambda x: np.clip(x, 0, 1) ** 2 * (3 - 2 * np.clip(x, 0, 1))
    crevice = 1 - 0.45 * step(conc[ids] / 0.35)
    fwd = np.asarray(fwd, np.float64); teeth = ids[mat[ids] == 1]; front = (V[teeth] @ fwd).max() if len(teeth) else (V[ids] @ fwd).max()
    depth = 0.92 + (0.30 - 0.92) * step((front - V[ids] @ fwd) / (0.55 * iod))
    base = np.array([MOUTH_BASE[int(m)] for m in mat[ids]])
    return (base * (depth * crevice)[:, None]).astype(np.float32)


def lip_contact_block(V, iod, ncand=16, reach=0.25, margin=0.02, G=None):
    """Contact between the lips and the teeth while the face MOVES (2026-11-12).
    pipeline/teeth_place.py puts the teeth where no lip vertex is closer to them than on the GNM mean - in the neutral
    face. An expression then adds the mean's lip displacement to this person's lips; nothing in a sum of displacements
    knows that lips are soft tissue lying ON the teeth, so a lip pulled in or back passes through them (만두 캡처 11/12,
    side view: upper teeth through the lower lip). The missing piece of the model is the contact itself, like the eyelid
    on the eyeball: a lip vertex cannot be inside a tooth.
    For every exterior skin vertex within `reach` x eye distance of the teeth / gums (V = positions with the PLACED
    teeth): its `ncand` nearest teeth / gum vertices that face it, and the clearance it keeps along the tooth normal =
    min(its neutral clearance, margin x eye distance). The viewers move a vertex that comes closer back out along
    that normal. margin 0.02 (~1.3 mm): the lip triangles between vertices must clear the tooth corners too (with
    0.006 the rule never fired while corners were already through, measured)."""
    try:
        from gnm_model import GNM, template_map
        from scipy.spatial import cKDTree
        G = G or GNM(); o2g = template_map()[0]
    except (Exception, SystemExit):
        return None
    tpl = np.load(TEMPLATE); F = tpl["triangles"].astype(np.int64); mat = tpl["materials"]
    hard = np.where(np.isin(mat, [1, 2]))[0]; Fh = F[np.isin(mat[F], [1, 2]).all(1)]
    nrm = np.zeros_like(V); c = np.cross(V[Fh[:, 1]] - V[Fh[:, 0]], V[Fh[:, 2]] - V[Fh[:, 0]])
    for k in range(3): np.add.at(nrm, Fh[:, k], c)
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-18
    ext = np.where(G.group("skin_exterior")[o2g] & ~G.group("mouth_sock")[o2g])[0]
    d, j = cKDTree(V[hard]).query(V[ext], k=ncand * 3); vs, cand, clr = [], [], []
    for a_, (dd, jj) in enumerate(zip(d, j)):
        if dd[0] > reach * iod: continue
        v = ext[a_]; q = hard[jj]; s = ((V[v] - V[q]) * nrm[q]).sum(1); face = s > 0
        if not face.any(): continue
        q = q[face][:ncand]; s = s[face][:ncand]
        vs.append(v); cand.append(np.pad(q, (0, ncand - len(q)), constant_values=q[0])); clr.append(min(float(s[0]), margin * iod))
    hn = nrm[hard].astype(np.float32)
    # skin neighbours among the contact vertices (CSR): a vertex pushed off a tooth corner takes its neighbours along,
    # otherwise the lip shows the corner as a notch (만두 캡처 11/12)
    slot = {int(v): i for i, v in enumerate(vs)}; Fs = F[(mat[F] == 0).all(1)]; nb = [set() for _ in vs]
    for a_, b_ in np.vstack([Fs[:, [0, 1]], Fs[:, [1, 2]], Fs[:, [2, 0]]]):
        i, j_ = slot.get(int(a_)), slot.get(int(b_))
        if i is not None and j_ is not None: nb[i].add(j_); nb[j_].add(i)
    ptr = np.cumsum([0] + [len(x) for x in nb]); flat = np.array([j_ for x in nb for j_ in sorted(x)], np.int32)
    return {"v": b64(np.array(vs), "<i4"), "cand": b64(np.array(cand), "<i4"), "c": b64(np.array(clr), "<f4"), "ncand": ncand, "n": len(vs),
            "reach": float(0.08 * iod), "hard": b64(hard, "<i4"), "normal": b64(hn, "<f4"), "nbr_ptr": b64(ptr, "<i4"), "nbr": b64(flat, "<i4")}


LOWER_FACE = [14, 87, 178, 88, 95, 317, 402, 318, 324, 17, 84, 181, 91, 146, 314, 405, 321, 375, 152, 148, 176, 149, 150,
              136, 172, 58, 377, 400, 378, 379, 365, 397, 288, 199, 200, 175, 18, 201, 421, 428, 208, 32, 262, 171, 396, 140,
              369, 83, 313, 106, 335, 182, 406, 194, 418, 169, 170, 211, 32, 394, 395, 430, 431, 424, 204, 202, 210]


def expression_weights(V, F, mat, comp, lid, iod, K=12):
    """landmark-driven expression deformation weights.
    controls = the distinct template vertices that carry MediaPipe landmarks. Each skin vertex gets the BIHARMONIC
    interpolation weights of the controls (smooth, exact at the landmarks, respects the opened mouth because lips are not
    connected any more), truncated to the K largest and faded out with geodesic distance (back of the head stays still).
    eyeballs and upper teeth: rigid with the head; lower teeth / tongue: follow the lower lip and chin."""
    from scipy.sparse import coo_matrix, csr_matrix
    from scipy.sparse.csgraph import dijkstra
    from scipy.sparse.linalg import splu
    skinF = F[(mat[F] == 0).all(1)]
    n = len(V)
    ctrl, inv = np.unique(lid, return_inverse=True)            # control vertices and landmark -> control
    # uniform Laplacian on the skin graph
    e = np.vstack([skinF[:, [0, 1]], skinF[:, [1, 2]], skinF[:, [2, 0]]])
    A = coo_matrix((np.ones(2 * len(e)), (np.concatenate([e[:, 0], e[:, 1]]), np.concatenate([e[:, 1], e[:, 0]]))), shape=(n, n)).tocsr()
    A.data[:] = 1.0
    deg = np.asarray(A.sum(1)).ravel()
    skinv = np.where(deg > 0)[0]
    Lp = (csr_matrix((np.ones(n), (np.arange(n), np.arange(n))), shape=(n, n)) - csr_matrix((1 / np.maximum(deg, 1), (np.arange(n), np.arange(n))), shape=(n, n)) @ A)
    Bi = (Lp.T @ Lp).tocsr()
    isc = np.zeros(n, bool); isc[ctrl] = True
    free = skinv[~isc[skinv]]
    Aff = Bi[free][:, free].tocsc(); Afc = Bi[free][:, ctrl]
    lu = splu(Aff + 1e-9 * csr_matrix((np.ones(len(free)), (np.arange(len(free)), np.arange(len(free))))).tocsc())
    W = np.zeros((n, len(ctrl)), np.float32)
    W[ctrl, np.arange(len(ctrl))] = 1
    W[free] = lu.solve(-Afc.toarray()).astype(np.float32)
    # geodesic fade towards the back of the head / neck
    w = np.linalg.norm(V[e[:, 0]] - V[e[:, 1]], axis=1)
    G = coo_matrix((np.concatenate([w, w]), (np.concatenate([e[:, 0], e[:, 1]]), np.concatenate([e[:, 1], e[:, 0]]))), shape=(n, n)).tocsr()
    dmin = dijkstra(G, indices=ctrl, min_only=True)
    limit = 0.8 * iod
    fall = np.clip(1 - dmin / limit, 0, 1) ** 0.5
    order = np.argsort(-W, 1)[:, :K]
    wk = np.take_along_axis(W, order, 1); wk = np.clip(wk, 0, None)
    wk = wk / np.maximum(wk.sum(1, keepdims=True), 1e-9) * fall[:, None]
    wk[~np.isfinite(wk)] = 0
    eye = np.isin(mat, [4, 5, 6]); wk[eye] = 0
    up_teeth = comp == 3; wk[up_teeth] = 0
    low = np.isin(comp, [4, 5])
    c14, c152 = inv[14], inv[152]
    order[low] = 0; wk[low] = 0          # lower teeth / tongue: moved by the jaw rotation only
    lm_ctrl = inv.astype(np.uint16)                                  # landmark -> control index
    # jaw weight: 1 on the lower lip / chin / jaw line landmarks, 0 on every other landmark, biharmonic in between
    JAW_LM = set(LOWER_FACE)
    cval = np.zeros(len(ctrl))
    for li, c in enumerate(inv): 
        if li in JAW_LM: cval[c] = 1.0
    jw = np.clip(W @ cval, 0, 1) * fall
    jw[eye] = 0; jw[up_teeth] = 0; jw[low] = 1.0
    return order.astype(np.uint16), wk.astype(np.float32), lm_ctrl, int(len(ctrl)), jw.astype(np.float32)


def nose_block(case_dir, groups, V0):
    """editable layer of the case (for the nose engine) + per display vertex: nearest editable vertex (canonical frame)."""
    from scipy.spatial import cKDTree
    ej = json.load(open(os.path.join(case_dir, "avatar", "editable.json")))
    raw = open(os.path.join(case_dir, "avatar", "editable.bin"), "rb").read()
    lay = ej["buffers"]["layout"]["position"]
    Pe = np.frombuffer(raw[lay["byteOffset"]:lay["byteOffset"] + lay["byteLength"]], "<f4").reshape(-1, 3).astype(np.float64)
    T = np.array(ej["frame"]["transform_source_to_canonical"])
    tree = cKDTree(Pe); D = ej["D"]
    for g in groups:
        Pc = g["_P"] @ T[:3, :3].T + T[:3, 3]
        dist, nn = tree.query(Pc)
        wt = np.clip(1 - (dist - 0.03 * D) / (0.07 * D), 0, 1)   # outside the editable crop: no nose displacement
        g["nmap"] = b64(nn.astype(np.int32), "<i4"); g["nw"] = b64(wt.astype(np.float32), "<f4")
    # the limit scan (~12 s) depends only on the editable layer and the engine code: cached next to the case under a
    # hash of exactly those inputs (2026-10-20, shared by the 360° viewer and tools/glb_rig.py; same numbers)
    import hashlib
    hsh = hashlib.sha256()
    for f_ in (os.path.join(case_dir, "avatar", "editable.json"), os.path.join(case_dir, "avatar", "editable.bin"),
               os.path.join(ROOT, "engine", "nose-engine.mjs"),
               os.path.join(ROOT, "engine", "nose-profile-limits.mjs"), os.path.join(HERE, "case_limits.mjs")):
        hsh.update(open(f_, "rb").read())
    cache = os.path.join(case_dir, "avatar", "nose_limits.cache.json")
    lim = None
    try:
        c_ = json.load(open(cache))
        if c_.get("key") == hsh.hexdigest(): lim = c_["lim"]
    except Exception:
        pass
    if lim is None:
        lim = json.loads(subprocess.check_output(["node", os.path.join(HERE, "case_limits.mjs"), case_dir]).decode().strip().splitlines()[-1])
        try: json.dump({"key": hsh.hexdigest(), "lim": lim}, open(cache, "w"))
        except Exception: pass
    return {"json": ej, "bin": base64.b64encode(raw).decode(), "T": T.tolist(), "limits": lim["limits"], "engine": lim["engine"]}
