"""Joint nose fit (2026-11-11, scan_to_model --nose-fit joint, the default since S15P31B204-773): every nose observation of
nose_obs.py in ONE smooth solve, instead of steps that each find their own evidence and move the mesh in turn.

Observations (nose_obs.py; hold-out frames never used)
  profile   side frames: the photo nose-to-lip profile; the model's silhouette point nearest to each photo point is
            pulled along the photo curve's normal (two-sided: the photo point is only kept where mask and edge agree)
  nostrils  frontal / chin-up frames: the photo nostril outline vs the outline of the model's VISIBLE nostril opening, both
            ways (model outline -> nearest photo point, photo point -> nearest model outline point), along the photo normal;
            at an occluding edge (the alar / tip skin in front of the opening) the occluding surface moves, at the rim the rim
  alar      frontal frames: the photo alar groove per row vs the model's crease of that row (horizontal), the crease vertex
            found once on the input mesh and then followed
Unknown   the displacement of the nose, the philtrum and a cheek band around them (groups); everything else stays (fixed
          boundary).
Solve     Gauss-Newton rounds: correspondences on the current mesh -> one sparse linear least-squares solve for the total
          displacement:  sum_obs w (g . d - r)^2 / SIG^2  +  STIFF x thin-plate energy of d  (+ a tiny ridge)
          The thin-plate term (squared Laplacian of the displacement, also on the first ring outside the region) keeps the
          displacement smooth and fading out with zero slope at the boundary: no creases, no steps at the region edge.
          Each frame and structure (and nostril side) weighs PTS points in total, Cauchy-robust within the group.
Accepted  when the sum of the structures' median residuals gets smaller and none grows by more than SIG / 10; nose_finish
          then applies its inversion / crease guards as for the other nose options.
usage: python nose_fit.py <work> <fit.ply> <fit.json> <sparse> <frame_poses.json> <out.ply> [--exclude holdout.txt]
       -> prints JSON stats
"""
import argparse, json, os, sys, time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE); sys.path.insert(0, HERE)
import meshio  # noqa
import nose_obs as NO  # noqa
from frame_check import intrinsics  # noqa
from template_fit import head_axes  # noqa

SIG = 0.01                 # x IOD, observation noise (Cauchy scale 2 SIG)
PTS = 20.0                 # points per frame and structure
STIFF = 5.0e3              # thin-plate weight (11/11, 4 recordings x 1e4 / 5e3 / 2.5e3): 5e3 is the stiffest applied on all 4
                           # (1e4: c7da7d66 kept, nostrils worse); 2.5e3 doubles the bent vertices for little more fit
ROUNDS = 5
NEAR = 0.02                # x IOD: alar crease pixel -> visible vertex search radius
MATCH = 0.08               # x IOD: photo point -> model outline distance beyond which the pair is not used
FRONTAL_YAW, FRONTAL_PITCH, CHIN_UP = 20.0, 5.0, -12.0   # deg (prepare.json): nostril frames; chin-up below CHIN_UP
ALAR_YAW, ALAR_PITCH = 8.0, 12.0                          # deg: alar groove frames (alar_width.py)
NOSTRIL_FRONTAL = 6        # frontal frames with agreeing nostrils (all chin-up frames are used)
BAND = 0.08                # x IOD of cheek / philtrum skin around the nose that may follow (fit region)
VERMILION = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291]   # MediaPipe upper outer lip contour (vermilion border)
OWNER = 0.12               # x IOD from the midline: nose / philtrum vertices that may own a side-view profile point
BANDS = {"dorsum": (-0.20, -0.06), "tip": (-0.05, 0.05), "infratip": (0.05, 0.13), "columella": (0.13, 0.22), "lip": (0.22, 0.36)}
                           # report only: profile height bands below the model tip, x IOD


def groups(V, lid, mat):
    """vertex masks: cav (nostril interior), region (moves), owner (may own a profile point), hinge (fixed edge whose slope
    is free: the vermilion border)"""
    from gnm_model import GNM, template_map
    from nose_finish import nose_mask
    G = GNM(); o2g = template_map()[0]; grp = lambda nm, th=0.5: (G.groups[G.group_names.index(nm)] > th)[o2g]
    iod = np.linalg.norm(V[lid[33]] - V[lid[263]])
    cav = grp("skin") & ~grp("skin_exterior") & ~grp("mouth_sock") & ~grp("eye_sockets") & (mat == 0) \
        & (np.linalg.norm(V - V[lid[1]], axis=1) < 0.3 * iod)
    # The philtrum takes part (the profile runs from the tip over the subnasale to the lip), the RED lip does not. GNM's
    # "upper_lip" group is the whole upper lip incl. the philtrum skin up to the subnasale, so the red lip is taken as the
    # part of it below the vermilion border (MediaPipe outer lip contour); excluding the whole group fixed the columella-lip
    # junction in the middle of the region (57581c57: the columella band did not move at any stiffness, 11/11)
    from scipy.spatial import cKDTree
    from template_fit import head_axes
    L = V[lid]; ax = head_axes(L); mid = L[[1, 2, 4, 5, 195, 197]].mean(0) @ ax[0]
    bx, by = (L[VERMILION] - L[1]) @ ax[0], (L[VERMILION] - L[1]) @ ax[1]; o_ = np.argsort(bx)
    x_, y_ = (V - L[1]) @ ax[0], (V - L[1]) @ ax[1]
    red = grp("upper_lip", 0.3) & (y_ < np.interp(x_, bx[o_], by[o_])) & (x_ > bx.min()) & (x_ < bx.max())
    nose = nose_mask(V, lid, mat) | (grp("skin") & (mat == 0) & grp("upper_lip_region", 0.3) & ~red)
    keep_out = red | grp("lower_lip", 0.3) | grp("eyes", 0.3) | grp("mouth_sock", 0.3) | grp("eye_sockets", 0.3)
    for nm in ("left_orbital_region", "right_orbital_region", "left_brow_region", "right_brow_region", "lower_lip_region"):
        keep_out |= grp(nm, 0.3)
    # a cheek band of BAND around the nose keeps the region edge away from the alar groove (at 1-2 rings from the fixed
    # edge the thin-plate term held the groove in place: afbf6699 alar residual 0.79 -> 0.78 % IOD with the groove alone)
    band = grp("skin") & (mat == 0) & ~keep_out & (cKDTree(V[nose]).query(V)[0] < BAND * iod)
    # the side-view profile is the face MIDLINE: only nose / philtrum vertices near it may own a profile point. Below the
    # tip of a 62-75 deg view the far cheek (or the red lip) is the outline in the photo and in the model alike; matched to
    # each other those pairs pulled the cheek band
    owner = nose & (np.abs(V @ ax[0] - mid) < OWNER * iod)
    # the vermilion border is a natural fold: the red lip stays, but the philtrum may meet it at a new angle. With a zero
    # slope there too the columella-lip junction could not follow the profile (9425cac6: 0.5 % of a 1.3 % gap, 5 rings away)
    return {"cav": cav, "region": nose | band, "owner": owner, "hinge": red}


def jac(Q, R, cam):
    """(P, 2, 3) d(pixel) / d(world position) at camera points Q"""
    f = cam[0]; x, y, z = Q.T; J = np.zeros((len(Q), 2, 3))
    J[:, 0, 0] = f / z; J[:, 0, 2] = -f * x / z ** 2; J[:, 1, 1] = f / z; J[:, 1, 2] = -f * y / z ** 2
    return J @ R


def id_buffer(V, F, tris, R, t, cam, box):
    """(triangle index image in the box (-1 = none), per-triangle depth): painter's order over `tris`"""
    import cv2
    X0, Y0, X1, Y1 = box; Q = V @ R.T + t; uv = NO.project(V, R, t, cam) - [X0, Y0]
    z = Q[F[tris], 2].mean(1); idx = np.full((Y1 - Y0, X1 - X0), -1, np.int32); pts = np.round(uv[F[tris]] * 4).astype(np.int32)
    for k in np.argsort(-z):
        cv2.fillPoly(idx, [pts[k]], int(tris[k]), shift=2)
    zt = np.full(len(F), np.inf); zt[tris] = z
    return idx, zt


# ---------------------------------------------------------------------------------------------- correspondences per frame
def outline_vertices(V, F, idx, zt, mask, box, o):
    """(vertices, their image positions) along the outline of `mask` (a region of the triangle index image idx): per outline
    pixel the vertex of the triangle just inside it nearest to the pixel, or of the triangle just outside when that one
    lies in front (skin occluding the region decides the edge there). The triangle under the pixel, not the nearest
    projected vertex (a search radius around the pixel drops pixels where the mesh is coarse). The outline of a mesh runs
    along its edges, so the vertex position is the outline point to sub-pixel accuracy; the integer outline pixel moved in
    1 px (~0.3 % IOD) steps and hid smaller moves from the residual (57581c57 columella, 11/11)"""
    ol = NO.outline(mask)
    if ol is None: return np.zeros(0, int), np.zeros((0, 2))
    c, n = ol; H, W = idx.shape
    at = lambda q: idx[np.clip(np.round(q[:, 1]).astype(int), 0, H - 1), np.clip(np.round(q[:, 0]).astype(int), 0, W - 1)]
    ii, oo = at(c - 0.7 * n), at(c + 1.5 * n); ok = ii >= 0
    c, ii, oo = c[ok] + box[:2], ii[ok], oo[ok]
    tri = np.where((oo >= 0) & (zt[np.maximum(oo, 0)] < zt[ii] - 0.01 * o["iod3"]), oo, ii)
    ids = F[tri]; uv = NO.project(V[ids.ravel()], o["R"], o["t"], o["cam"]).reshape(-1, 3, 2)
    k = np.argmin(np.linalg.norm(uv - c[:, None], axis=2), 1); r = np.arange(len(ids))
    v = ids[r, k]; _, u = np.unique(v, return_index=True)                  # one point per vertex
    return v[u], uv[r, k][u]


def profile_pairs(V, F, skin_tri, owner, o):
    """[(vertex, model pixel, photo pixel, photo normal, photo level)] of one side frame: photo point -> nearest point of
    the model's silhouette, where a midline nose / philtrum vertex owns it"""
    from scipy.spatial import cKDTree
    c = o["P"].mean(0); r = int(0.6 * o["ip"]); box = (int(c[0] - r), int(c[1] - r), int(c[0] + r), int(c[1] + r))
    Q = V @ o["R"].T + o["t"]; uv = NO.project(V, o["R"], o["t"], o["cam"])[F[skin_tri]].mean(1)
    tri = skin_tri[(Q[F[skin_tri], 2] > 0).all(1) & (np.abs(uv - c) < r + 2).all(1)]
    idx, zt = id_buffer(V, F, tri, o["R"], o["t"], o["cam"], box)
    mv, mq = outline_vertices(V, F, idx, zt, idx >= 0, box, o)
    if len(mv) < 10: return []
    d, j = cKDTree(mq).query(o["P"]); ok = d < MATCH * o["ip"]
    return [(int(mv[j[i]]), mq[j[i]], o["P"][i], o["N"][i], o["lev"][i]) for i in np.flatnonzero(ok & owner[mv[j]])]


def nostril_pairs(V, F, near_tri, cav_tri, side_of_vertex, o):
    """{head side: [(vertex, model pixel, photo pixel, photo normal)]} of one frontal / chin-up frame: the outline of the
    model's visible opening vs the photo nostril outline, both ways"""
    from scipy.spatial import cKDTree
    allp = np.vstack([p for p, _ in o["sides"].values()]); pad = int(0.12 * o["ip"])
    X0, Y0 = (allp.min(0) - pad).astype(int); X1, Y1 = (allp.max(0) + pad).astype(int); box = (X0, Y0, X1, Y1)
    idx, zt = id_buffer(V, F, near_tri, o["R"], o["t"], o["cam"], box)
    vis = (idx >= 0) & cav_tri[np.maximum(idx, 0)]
    tri_side = np.where(idx >= 0, side_of_vertex[F[np.maximum(idx, 0), 0]], 0); out = {}
    for s, (P, N) in o["sides"].items():
        mv, mq = outline_vertices(V, F, idx, zt, vis & (tri_side == s), box, o)
        if len(mv) < 8: continue
        d, j = cKDTree(P).query(mq); ok = d < MATCH * o["ip"]                  # model outline -> photo
        rows = [(int(mv[k]), mq[k], P[j[k]], N[j[k]]) for k in np.flatnonzero(ok)]
        d, j = cKDTree(mq).query(P); ok = d < MATCH * o["ip"]                  # photo -> model outline
        out[s] = rows + [(int(mv[j[i]]), mq[j[i]], P[i], N[i]) for i in np.flatnonzero(ok)]
    return out


def alar_pairs(V, F, lid, near_v, o):
    """{image side: [(vertex, its pixel offset to the crease, photo groove pixel, normal)]} of one frontal frame, found ONCE
    on the input mesh (alar_width.crease_rows) and then followed with the vertex: the crease found again on a moving mesh
    jumps by whole pixels between neighbouring concave points and did not respond to the fit (afbf6699, 11/11)"""
    import alar_width as AW
    from scipy.spatial import cKDTree
    R, t, cam = o["R"], o["t"], o["cam"]; f, cx, cy = cam
    depth, uv, _ = AW.render_depth(V, F, R, t, f, cx, cy, o["gray"].shape, near_v)
    tip, sn = uv[lid[1]], uv[lid[2]]; iodp = np.linalg.norm(uv[lid[33]] - uv[lid[263]])
    rows = AW.crease_rows(o["gray"], depth, tip, sn, iodp)
    Q = V @ R.T + t; cand = np.flatnonzero(near_v); tree = cKDTree(uv[cand]); out = {}
    for s, rr in rows.items():
        pairs = []
        for (y, xm, xv) in rr:
            q = np.array([xm, y], float); ks = tree.query_ball_point(q, NEAR * iodp)
            ks = [cand[k] for k in ks if Q[cand[k], 2] <= depth[y, xm] + 0.01 * o["iod3"]]   # visible there
            if not ks: continue
            v = ks[int(np.argmin(np.linalg.norm(uv[ks] - q, axis=1)))]
            pairs.append((int(v), q - uv[v], np.array([xv, y], float), np.array([float(s), 0.0])))
        if pairs: out[s] = pairs
    return out


# ------------------------------------------------------------------------------------------------------------- solve
def thin_plate(F, region, hinge, nV, edge):
    """sparse rows of the scaled Laplacian of the displacement on the region and its first outside ring (zero slope at the
    fixed edge) except the ring on `hinge` (zero value only), columns = region"""
    from scipy.sparse import coo_matrix, diags
    ii = np.r_[F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]]; jj = np.r_[F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]]
    A = coo_matrix((np.ones(len(ii)), (ii, jj)), shape=(nV, nV)).tocsr(); A.data[:] = 1.0
    deg = np.asarray(A.sum(1)).ravel(); Lp = (diags(np.ones(nV)) - diags(1.0 / np.maximum(deg, 1)) @ A).tocsr()
    rows = region | ((A @ region.astype(float) > 0) & ~hinge)
    return Lp[np.flatnonzero(rows)][:, np.flatnonzero(region)] / edge   # x sqrt(vertex area) / edge^2, area ~ edge^2


def residuals(o, rows):
    """x IOD along the photo normal (+ = model outside the photo outline / ahead of the photo profile)"""
    return np.array([(q - p) @ n for _, q, p, n in rows]) / o["ip"]


def solve(V0, V, region_ids, groups_, Lr, iod, stiff):
    """one linearised solve for the total displacement; groups_ = correspond() groups -> new vertices"""
    from scipy.sparse import coo_matrix, identity, kron, csr_matrix
    from scipy.sparse.linalg import spsolve
    col = {v: k for k, v in enumerate(region_ids)}; n = len(region_ids)
    D = (V - V0)[region_ids].ravel() / iod
    ri, ci, val, b, w = [], [], [], [], []
    for _, o, rows, _ in groups_:
        rows = [x for x in rows if x[0] in col]
        if len(rows) < 5: continue
        r = residuals(o, rows); wr = 1.0 / (1.0 + (r / (2 * SIG)) ** 2); wr *= PTS / wr.sum() / SIG ** 2
        vv = np.array([v for v, *_ in rows]); J = jac(V[vv] @ o["R"].T + o["t"], o["R"], o["cam"])
        for (v, _, _, nn), j_, rk, wk in zip(rows, J, r, wr):
            g = nn @ j_ * iod / o["ip"]                                                  # d r / d displacement (x IOD)
            k = len(b)
            for a in range(3): ri.append(k); ci.append(3 * col[v] + a); val.append(g[a])
            b.append(g @ D[3 * col[v]:3 * col[v] + 3] - rk); w.append(wk)
    if not b: return V
    A = csr_matrix(coo_matrix((val, (ri, ci)), shape=(len(b), 3 * n))); Wd = np.array(w)
    Lk = kron(Lr, identity(3, format="csr"), format="csr")
    M = (A.T.multiply(Wd) @ A + stiff * (Lk.T @ Lk) + 1e-6 * identity(3 * n)).tocsc()
    x = spsolve(M, A.T @ (Wd * np.array(b)))
    Vn = V0.copy(); Vn[region_ids] += x.reshape(-1, 3) * iod
    return Vn


def main():
    import cv2, pycolmap
    from outline_obs import class_masks
    from face_lm import landmarks
    ap = argparse.ArgumentParser()
    for k in ("work", "fit", "fit_json", "sparse", "poses", "out"): ap.add_argument(k)
    ap.add_argument("--exclude", help="held-out frame names: never used")
    ap.add_argument("--stiff", type=float, default=STIFF, help="thin-plate weight (see STIFF)")
    ap.add_argument("--structures", default="profile,nostril,alar", help="observations used (comparison runs)")
    a = ap.parse_args()
    m = meshio.read_any(a.fit); V0 = np.asarray(m["vertices"], np.float64); F = np.asarray(m["faces"]).astype(np.int64)
    lid = np.asarray(json.load(open(a.fit_json, encoding="utf-8"))["landmark_vertex_ids"])
    L = V0[lid]; ax = head_axes(L); iod = float(np.linalg.norm(L[33] - L[263]))
    mat = np.load(os.path.join(ROOT, "assets", "gnm-template-v2.npz"))["materials"]
    gr = groups(V0, lid, mat); cav, region, owner = gr["cav"], gr["region"], gr["owner"]
    mid = L[[1, 2, 4, 5, 195, 197]].mean(0) @ ax[0]; side_v = np.sign(V0 @ ax[0] - mid).astype(int)
    dist = np.linalg.norm(V0 - L[1], axis=1)
    skin_tri = np.flatnonzero((mat[F] == 0).all(1) & (dist[F] < 0.8 * iod).all(1))
    near_tri = np.flatnonzero((np.linalg.norm(V0[F].mean(1) - L[1], axis=1) < 0.35 * iod))
    cav_tri = cav[F].any(1)
    cam = intrinsics(list(pycolmap.Reconstruction(a.sparse).cameras.values())[0])
    poses = json.load(open(a.poses, encoding="utf-8"))["frames"]
    prep = {x["file"]: x for x in json.load(open(os.path.join(a.work, "prep", "prepare.json"), encoding="utf-8"))["images"]}
    excl = set(open(a.exclude, encoding="utf-8").read().split()) if a.exclude else set()
    images = os.path.join(a.work, "prep", "images")
    use = {n: (np.array(p["R"]), np.array(p["t"])) for n, p in sorted(poses.items()) if p["status"] != "dropped" and n not in excl}
    base = lambda n: {"R": use[n][0], "t": use[n][1], "cam": cam, "ip": NO.iod_px(L, *use[n], cam), "iod3": iod}
    rep = {"excluded_frames": len(excl)}; t0 = time.perf_counter()
    if "nostril" in a.structures.split(","):
        from sam_masks import available
        if not available()[0]:
            rep.update(status="skipped", reason="nostril observation needs SAM 2.1 (sam_masks.available)")
            meshio.write_ply(a.out, V0, F, colors=m.get("colors")); print(json.dumps(rep)); return
    # observations: photo, fixed through the rounds (the alar crease vertex too)
    want = set(a.structures.split(","))
    side = [n for n in use if NO.head_yaw(use[n][0], ax) >= NO.PROFILE_YAW] if "profile" in want else []
    cms = class_masks(images, side, os.path.join(a.work, "prep", "class_masks")) if side else {}
    prof = []
    for n in side:
        if n not in cms: continue
        pr = NO.profile_frame(cv2.imread(os.path.join(images, n)), cms[n], L, ax, *use[n], cam)
        if pr is not None: prof.append({**base(n), "name": n, "P": pr[0], "N": pr[1], "lev": pr[2]})
    front = []; info = {}
    yp = {n: (prep[n]["yaw"], prep[n]["pitch"]) for n in use if prep.get(n, {}).get("yaw") is not None and prep[n].get("pitch") is not None}
    cands = [n for n in yp if abs(yp[n][0]) <= FRONTAL_YAW and yp[n][1] <= FRONTAL_PITCH] if "nostril" in want else []
    up_ = [n for n in cands if yp[n][1] <= CHIN_UP]; fr_ = [n for n in cands if yp[n][1] > CHIN_UP]
    spread = fr_[:: max(1, len(fr_) // NOSTRIL_FRONTAL)]; fr_ = spread + [n for n in fr_ if n not in spread]   # spread ones first
    nfr = 0
    for n in up_ + fr_:
        if n in fr_ and nfr >= NOSTRIL_FRONTAL: break
        img = cv2.imread(os.path.join(images, n)); lm, _ = landmarks(images, n, img)
        if lm is None: continue
        Lm = np.asarray(lm, float)[:468, :2] * [img.shape[1], img.shape[0]]
        sides, inf = NO.nostril_frame(img, Lm, float(np.sign((ax[0] @ use[n][0].T)[0]) or 1.0))
        for v in inf.values(): info[v] = info.get(v, 0) + 1
        if sides: front.append({**base(n), "name": n, "sides": sides}); nfr += n in fr_
    alar = []
    for n in (yp if "alar" in want else []):
        if abs(yp[n][0]) > ALAR_YAW or abs(yp[n][1]) > ALAR_PITCH: continue
        o = {**base(n), "name": n, "gray": cv2.cvtColor(cv2.imread(os.path.join(images, n)), cv2.COLOR_BGR2GRAY).astype(np.float32) / 255}
        o["rows"] = alar_pairs(V0, F, lid, dist < 0.7 * iod, o); del o["gray"]
        if o["rows"]: alar.append(o)
    rep.update(profile_frames=len(prof), nostril_frames=len(front), nostril_sides=info, alar_frames=len(alar))
    if len(prof) < 3 and len(front) < 3 and len(alar) < 3:
        rep.update(status="skipped", reason="fewer than 3 frames for every structure"); meshio.write_ply(a.out, V0, F, colors=m.get("colors"))
        print(json.dumps(rep)); return
    region_ids = np.flatnonzero(region); t1 = time.perf_counter()
    edge = float(np.median(np.linalg.norm(V0[F[near_tri, 0]] - V0[F[near_tri, 1]], axis=1))) / iod
    Lr = thin_plate(F, region, gr["hinge"], len(V0), edge)

    def correspond(V):
        """[(group name, frame, rows (vertex, model px, photo px, photo normal), photo levels or None)]: one group per frame
        and structure (and nostril / alar side), each weighing PTS points"""
        out = []
        for o in prof:
            pr = profile_pairs(V, F, skin_tri, owner, o)
            out.append((f"profile:{o['name']}", o, [x[:4] for x in pr], np.array([x[4] for x in pr])))
        for o in front:
            for s, rows in nostril_pairs(V, F, near_tri, cav_tri, side_v, o).items():
                out.append((f"nostril:{o['name']}:{s}", o, rows, None))
        for o in alar:
            for s, rows in o["rows"].items():
                uv = NO.project(V[[v for v, *_ in rows]], o["R"], o["t"], cam)
                out.append((f"alar:{o['name']}:{s}", o, [(v, q + off, p, n) for (v, off, p, n), q in zip(rows, uv)], None))
        return out

    def score(g):
        """median |residual| per structure and the signed profile residual per height band (% IOD, + = model ahead), over
        the points on movable vertices"""
        ab, band, inr = {}, {k: [] for k in BANDS}, {}
        for name, o, rows, lev in g:
            if len(rows) < 5: continue
            inside = np.array([region[x[0]] for x in rows]); r = residuals(o, rows)
            ab.setdefault(name.split(":")[0], []).extend(np.abs(r[inside]).tolist())
            inr[name.split(":")[0]] = inr.get(name.split(":")[0], 0) + int(sum(region[x[0]] for x in rows))
            if lev is None: continue
            for k, (h0, h1) in BANDS.items():
                sel = (lev >= h0) & (lev < h1) & inside
                if sel.sum() >= 3: band[k].append(float(np.median(r[sel])))
        return ({k: round(float(np.median(v)) * 100, 3) for k, v in ab.items() if v},
                {k: round(float(np.median(v)) * 100, 2) for k, v in band.items() if v},
                {k: [len(v), inr[k]] for k, v in ab.items()})

    V = V0.copy(); hist, bands = [], []
    for rd in range(ROUNDS + 1):                         # correspondences once per round: scored, then solved
        g = correspond(V); st, bd, counts = score(g); hist.append(st); bands.append(bd)
        if rd < ROUNDS: V = solve(V0, V, region_ids, g, Lr, iod, a.stiff)
    before, after = hist[0], hist[-1]
    common = [k for k in before if k in after]
    # better overall, and no structure worse by more than a tenth of the observation noise (a relative 5 % rejected
    # 57581c57 for a profile 0.77 -> 0.82 % IOD while its nostrils went 1.04 -> 0.51 and its alar groove 1.35 -> 0.40)
    tol = 100 * SIG / 10                                                      # % IOD, like the scores
    ok = bool(common) and sum(after[k] for k in common) < sum(before[k] for k in common) and all(after[k] <= before[k] + tol for k in common)
    rep.update(median_abs_residual_pct_iod_per_round=hist, profile_signed_pct_iod_by_band={"before": bands[0], "after": bands[-1]},
               profile_bands_below_tip_iod=BANDS, points_all_in_region=counts, stiffness=a.stiff, region_vertices=int(region.sum()),
               max_move_pct_iod=round(float(np.linalg.norm(V - V0, axis=1).max() / iod * 100), 2),
               seconds={"observe": round(t1 - t0, 1), "fit": round(time.perf_counter() - t1, 1)},
               status="applied" if ok else "kept (no gain)")
    meshio.write_ply(a.out, V if ok else V0, F, colors=m.get("colors"))
    print(json.dumps(rep))


if __name__ == "__main__":
    main()
