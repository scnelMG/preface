"""Nostril (콧구멍) position and size from the photos (2026-10-21, option --nostril-fit, off by default).

Problem (me01, user check): with the chin-up frames back (pipeline/pitch_pose.py), the model's nostril openings sit
HIGHER than the photo's nostrils in the same view and are larger (tools/parts_measure.py: IoU 0.51, model / photo area
1.74). The nostrils carry no direct observation in the fit: they are the GNM mean shape.
Observation (frames whose pose is ok or recovered, |yaw| <= 20, pitch <= +5 = frontal and chin-up, nostrils visible):
  photo  the two darkest blobs between the nose wings (MediaPipe 98 / 327 / 1 / 2 box; Lab L below min(18th percentile,
         0.45 x median), opened 3x3, largest two above 0.2 % of the box) - parts_measure v0's 0.62 took the shadow
         under the nose for nostril in frontal views
  model  pixels where the VISIBLE surface is the nostril interior (GNM skin that is not exterior skin, within 0.3 IOD
         of the tip; a triangle touching it counts), rendered with the frame's pose, split left / right at the columella
  frames v3: chin-up frames (pitch <= -12, the whole rim visible) compare the filled outline of the projected RIM loop
         (interior vertices touching exterior skin); up to 6 near-frontal / mildly tilted frames compare the VISIBLE
         opening (v1 mask). v2 (rim / chin-up only) left the opening facing too far forward (wide open at 0 / -18 deg)
Fit per side: translation (head right / up / forward) + scale (right and forward axes) + turn about the up axis (the
oval's direction) + tilt about the right axis (which way the opening faces), about the nostril centre, of the nostril interior, carried to its rim (weight 1 within 0.02 IOD of the cavity, fading over 0.08 IOD; nose region only),
maximising the mean IoU over the frames (Nelder-Mead, translation within +-0.08 IOD, scale 0.6 .. 1.5).
Accepted when >= 3 frames see both sides and the mean IoU improves by >= 0.03, else the side stays.
usage: python nostril_fit.py <work> <fit.ply> <fit.json> <sparse> <frame_poses.json> <out.ply> [--debug check.jpg]
"""
import argparse, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE); sys.path.insert(0, HERE)
import meshio  # noqa
from frame_check import intrinsics  # noqa
from template_fit import head_axes  # noqa

CORE, FADE = 0.02, 0.12           # v3: 0.08 -> 0.12, a 24 deg turn bent the alar lobule into a flat facet (me01)
LIM_T, LIM_S, LIM_R = 0.08, (0.6, 1.5), 0.35  # x IOD, scale, radians (20 deg)
LOW_LIM = 0.06                    # v7 stage 0: lower-nose move down / forward, x IOD
RIM_DROP_MAX = 0.05               # v8 stage 1b: lowering of the LATERAL nostril rim (alar rim), x IOD
LOW_POSE_ERR = 0.015              # v7 stage 0 uses only frames whose camera pose agrees with the face landmarks this well (x IOD)
LOW_TOP, LOW_BELOW, LOW_SIDE, LOW_BACK = 0.10, 0.10, 0.10, 0.15   # fades below the subnasale / beyond the alar wings / behind it, x IOD


# photo detector: pipeline/nose_obs.py (shared with the joint nose fit, nose_fit.py)
from nose_obs import photo_blobs  # noqa


def cavity_mask(V, F, near_tri, cav_tri, R, t, K, box):
    """pixels of the box where the front-most surface is a nostril-cavity triangle"""
    import cv2
    X0, Y0, X1, Y1 = box
    T = F[near_tri]; X = V @ R.T + t; z = X[:, 2]
    uv = (X[:, :2] / z[:, None]) * [K[0, 0], K[1, 1]] + [K[0, 2], K[1, 2]] - [X0, Y0]
    idx = np.full((Y1 - Y0, X1 - X0), -1, np.int32); pts = np.round(uv[T] * 4).astype(np.int32)
    for k in np.argsort(-z[T].mean(1)):
        cv2.fillPoly(idx, [pts[k]], int(k), shift=2)
    cav = cav_tri[near_tri]
    return (idx >= 0) & cav[np.maximum(idx, 0)]


def rim_mask(V, ids, R, t, K, box):
    """filled outline (convex hull) of the projected rim loop of one nostril, in the box"""
    import cv2
    X0, Y0, X1, Y1 = box
    X = V[ids] @ R.T + t; uv = X[:, :2] / X[:, 2:] * [K[0, 0], K[1, 1]] + [K[0, 2], K[1, 2]] - [X0, Y0]
    m = np.zeros((Y1 - Y0, X1 - X0), np.uint8)
    if len(ids) >= 3: cv2.fillPoly(m, [cv2.convexHull(np.round(uv * 4).astype(np.int32))], 1, shift=2)
    return m.astype(bool)


def main():
    import cv2, pycolmap
    from scipy.optimize import minimize
    from gnm_model import GNM, template_map
    sys.path.insert(0, os.path.join(ROOT, "tools")); from parts_measure import detector, landmarks
    ap = argparse.ArgumentParser()
    for k in ("work", "fit", "fit_json", "sparse", "poses", "out"): ap.add_argument(k)
    ap.add_argument("--debug"); ap.add_argument("--no-rim-detail", dest="rim_detail", action="store_false")
    ap.add_argument("--exclude", help="held-out frame names: never used for fitting")
    # off by default (10/22): on IMG_6006 it pulled the wings too far down / out (user); the frontal-vs-chin-up conflict
    # it worked around came from chin-up / chin-down camera poses ~15 deg off (pitch_pose.py --all, option --face-poses)
    # off (10/22): tried on IMG_6006, lowering the wing side of the rim LOWERED the frontal overlap (0.29 -> 0.26 at 1 %
    # IOD) and the chin-up one; the "large hooked opening / gull-wing bottom" the user saw was the gray view lighting the
    # nostril walls (fixed in the viewer: ambient occlusion in gray mode)
    ap.add_argument("--rim-drop", action="store_true", help="stage 1b (v8, experimental, not adopted)")
    ap.add_argument("--lower-nose", action="store_true", help="stage 0 (v7, experimental): move the lower nose down / forward")
    ap.add_argument("--max-yaw", type=float, default=20.0); ap.add_argument("--max-pitch", type=float, default=5.0)
    a = ap.parse_args()
    m = meshio.read_any(a.fit); V0 = np.asarray(m["vertices"], np.float64); F = np.asarray(m["faces"]).astype(np.int64)
    lid = np.asarray(json.load(open(a.fit_json, encoding="utf-8"))["landmark_vertex_ids"])
    L = V0[lid]; ax = head_axes(L); iod = np.linalg.norm(L[33] - L[263])
    t_ = np.load(os.path.join(ROOT, "assets", "gnm-template-v2.npz")); mat = t_["materials"]
    G = GNM(); o2g = template_map()[0]; nose = (G.groups[G.group_names.index("nose_region")] > 0.3)[o2g]
    # nostril interior = GNM skin that is not exterior skin, near the nose tip (not the mouth / eye sockets)
    grp = lambda nm: (G.groups[G.group_names.index(nm)] > 0.5)[o2g]
    cav_v = grp("skin") & ~grp("skin_exterior") & ~grp("mouth_sock") & ~grp("eye_sockets") & (mat == 0)         & (np.linalg.norm(V0 - L[1], axis=1) < 0.3 * iod)
    mid = L[[1, 2, 4, 5, 195, 197]].mean(0) @ ax[0]
    side_v = {s: cav_v & (np.sign(V0 @ ax[0] - mid) == s) for s in (-1, 1)}
    # v2 (10/22): the nostril EDGE = interior vertices that touch exterior skin (the rim loop); its filled outline is
    # compared with the photo's dark opening (user: model nostril bigger toward the tip; the "visible interior" mask of v1
    # could not see that, the upper inner wall is hidden in chin-up views)
    ext_v = grp("skin_exterior") & (mat == 0)
    ee = np.r_[F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]
    rim_all = np.zeros(len(V0), bool)
    rim_all[np.r_[ee[cav_v[ee[:, 0]] & ext_v[ee[:, 1]], 0], ee[cav_v[ee[:, 1]] & ext_v[ee[:, 0]], 1]]] = True
    rim_ids = {s: np.where(rim_all & side_v[s])[0] for s in (-1, 1)}
    cav_tri = cav_v[F].any(1)                       # what one sees INTO the nostril (wall or its rim edge)
    near_tri = (np.linalg.norm(V0[F].mean(1) - L[1], axis=1) < 0.35 * iod)
    rec = pycolmap.Reconstruction(a.sparse); f, cx, cy = intrinsics(list(rec.cameras.values())[0])
    K = np.array([[f, 0, cx], [0, f, cy], [0, 0, 1.0]])
    poses = json.load(open(a.poses, encoding="utf-8"))["frames"]
    prep = {x["file"]: x for x in json.load(open(os.path.join(a.work, "prep", "prepare.json"), encoding="utf-8"))["images"]}
    mp, det = detector(); images = os.path.join(a.work, "prep", "images")
    obs = []
    excluded = set(open(a.exclude, encoding="utf-8").read().split()) if a.exclude else set()
    for n, p in sorted(poses.items()):
        x = prep.get(n, {})
        if n in excluded or p["status"] == "dropped" or x.get("yaw") is None or abs(x["yaw"]) > a.max_yaw or x.get("pitch") is None or x["pitch"] > a.max_pitch: continue
        img = cv2.imread(os.path.join(images, n)); Lm = landmarks(mp, det, img)
        if Lm is None: continue
        pb = photo_blobs(img, Lm)
        if pb is None: continue
        keep, box = pb; R, t = np.array(p["R"]), np.array(p["t"])
        # image column of the columella (midline) from the model: split photo / model masks per side
        tipc = (L[2] @ R.T + t); colx = f * tipc[0] / tipc[2] + cx - box[0]
        img_side = np.sign((ax[0] @ R.T)[0])          # +1: head right axis points to image right
        obs.append({"name": n, "img": img, "R": R, "t": t, "box": box, "photo": keep, "colx": colx, "img_side": img_side,
                    "pitch": x.get("pitch"), "pose_err": p.get("err_after_px", p.get("err_px", 99)) / max(p.get("iod_px", 1), 1)})
    # v3 (10/22): chin-up frames judge the RIM outline (whole rim visible); near-frontal / mildly tilted frames judge the
    # VISIBLE opening (v2 matched at -40 deg but the model showed a wide open nostril where the photo shows a slit at
    # 0 / -18 deg: the opening faced too far forward -> tilt parameter + these frames)
    up_ = [o for o in obs if (o["pitch"] or 0) <= -12]; fr_ = [o for o in obs if (o["pitch"] or 0) > -12]
    for o in up_: o["kind"] = "rim"
    for o in fr_: o["kind"] = "visible"
    obs = up_ + fr_[:: max(1, len(fr_) // 6)][:6]
    rep = {"frames": len(obs), "chin_up_frames": len(up_), "fit_frames": [o["name"] for o in obs], "excluded_frames": len(excluded)}
    if len(obs) < 3:
        rep.update(status="skipped", reason="chin-up frames with visible nostrils < 3"); print(json.dumps(rep)); return
    def split(mask, o, s):
        xs = np.arange(mask.shape[1])[None, :]
        return mask & ((np.sign(xs - o["colx"]) * o["img_side"]) == s)
    # deformation weights per side (distance to that side's cavity vertices)
    from scipy.spatial import cKDTree
    W = {}
    from scipy.sparse import coo_matrix
    ii = np.r_[F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]]; jj = np.r_[F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]]
    Adj = coo_matrix((np.ones(len(ii)), (ii, jj)), shape=(len(V0), len(V0))).tocsr(); Adj.data[:] = 1.0
    deg = np.maximum(np.asarray(Adj.sum(1)).ravel(), 1)
    # v3: the hard nose_region cut (the interior is not in that group: v2 fix) made the displacement drop to 0 within
    # one edge -> a thin crease line under the nose (me01 gray render). The region edge is diffused into a soft 0..1 band.
    soft_region = ((nose | cav_v) & (mat == 0)).astype(np.float64)
    for _ in range(15):
        soft_region = np.where(cav_v, 1.0, 0.5 * soft_region + 0.5 * (Adj @ soft_region) / deg)
    soft_region = np.clip(soft_region, 0, 1)
    for s in (-1, 1):
        d, _ = cKDTree(V0[side_v[s]]).query(V0)
        tt = np.clip((d - CORE * iod) / (FADE * iod), 0, 1)
        W[s] = (1 - tt * tt * (3 - 2 * tt)) * soft_region * (mat == 0)   # distance falloff x SOFT region edge
    cen = {s: V0[side_v[s]].mean(0) for s in (-1, 1)}
    def deform(V, s, q):
        dx, dy, dz, sx, sz, th, tl = q
        rel = V - cen[s]; a_, u_, b_ = rel @ ax[0], rel @ ax[1], rel @ ax[2]
        c, sn = np.cos(th), np.sin(th)                # rotation about the head up axis (orientation of the oval)
        a2, b2 = sx * (c * a_ - sn * b_), sz * (sn * a_ + c * b_)
        ct, st = np.cos(tl), np.sin(tl)               # tilt about the head right axis (+ = opening faces more downward)
        u3, b3 = ct * u_ - st * b2, st * u_ + ct * b2
        disp = (dx * ax[0] + dy * ax[1] + dz * ax[2]) * iod + (a2 - a_)[:, None] * ax[0] + (u3 - u_)[:, None] * ax[1] + (b3 - b_)[:, None] * ax[2]
        return V + W[s][:, None] * disp
    def ious(V, s):
        out = []
        for o in obs:
            mm = (rim_mask(V, rim_ids[s], o["R"], o["t"], K, o["box"]) if o["kind"] == "rim"
                  else split(cavity_mask(V, F, near_tri, cav_tri, o["R"], o["t"], K, o["box"]), o, s))
            ph = split(o["photo"].astype(bool), o, s)
            if ph.sum() < 10: continue
            out.append((mm & ph).sum() / max((mm | ph).sum(), 1))
        return np.array(out)
    # ---- stage 0 (v7, 10/22): the whole LOWER NOSE down / forward ---------------------------------------------------
    # Second video (IMG_6006, user: nostrils higher than the photo and the wings end too high): from the front the photo
    # nostrils sit ~3-5 % IOD LOWER than the model's, from below (chin up) they sit closer to the TIP. Moving only the
    # nostril (stage 1) cannot do both - the opening seen from the front is bounded by the wing rim, which stays. Here the
    # region from the tip down to the subnasale (tip, wings, nostril sills, columella and the nostrils inside) moves
    # down / forward, ramping in over the dorsum just above the tip (the lower dorsum gets longer), fading out
    # below the subnasale (upper lip), beyond the wings (cheeks) and behind. Both nostrils judged together; kept unless
    # the mean overlap gains >= 0.03 (me01, whose nostril heights already matched, should stay put).
    # Judged ONLY on frames whose camera pose agrees with the face landmarks (<= 1.5 % IOD): on IMG_6006 the chin-up
    # frames disagreed by ~3 % IOD (mouth and eyes visibly off), as much as the nostril offset itself, and asked for the
    # opposite move (grid: frontal overlap 0.13 -> 0.23 going down 6 %, chin-up 0.53 -> 0.36). Those were the near-
    # frontal frames; the chin-up ones still shape the nostrils in stages 1-2. Grid search (the overlap is flat in steps).
    def both_iou(V, use=None):
        out = []
        for o in (obs if use is None else use):
            mm = ((rim_mask(V, rim_ids[-1], o["R"], o["t"], K, o["box"]) | rim_mask(V, rim_ids[1], o["R"], o["t"], K, o["box"]))
                  if o["kind"] == "rim" else cavity_mask(V, F, near_tri, cav_tri, o["R"], o["t"], K, o["box"]))
            ph = o["photo"].astype(bool)
            if ph.sum() < 20: continue
            out.append((mm & ph).sum() / max((mm | ph).sum(), 1))
        return np.array(out)
    sm = lambda u: (lambda c: c * c * (3 - 2 * c))(np.clip(u, 0, 1))
    rel = V0 - L[1]; hh, xx, ff = rel @ ax[1], np.abs(rel @ ax[0] - (mid - L[1] @ ax[0])), rel @ ax[2]
    hs, fs = (L[2] - L[1]) @ ax[1], (L[2] - L[1]) @ ax[2]
    aw = 0.5 * np.linalg.norm(L[64] - L[294])
    # ramp 0 -> 1 from LOW_TOP above the tip down to the tip height (a first try ramped tip -> subnasale: the nostril
    # bottoms matched but their tops stayed, the frontal openings got 40 % too tall; the photo tip is also lower)
    w_low = (sm((LOW_TOP * iod - hh) / (LOW_TOP * iod)) * (1 - sm((hs - hh) / (LOW_BELOW * iod))) * (1 - sm((xx - aw) / (LOW_SIDE * iod)))
             * (1 - sm((fs - LOW_BACK * iod - ff) / (0.08 * iod))) * (mat == 0))
    def lower(V, q):
        return V + w_low[:, None] * ((-q[0]) * ax[1] + q[1] * ax[2])[None, :] * iod
    low = {"status": "off"}
    V = V0.copy()
    if a.lower_nose:
        good = [o for o in obs if o["pose_err"] <= LOW_POSE_ERR]
        b0 = both_iou(V0, good)
        if len(b0) >= 3:
            grid = [(dn, fw_) for dn in np.arange(-0.02, LOW_LIM + 1e-9, 0.005) for fw_ in (-0.02, 0.0, 0.02)]
            costs = [-both_iou(lower(V0, q), good).mean() + 0.05 * np.abs(q).sum() / LOW_LIM for q in grid]
            q0_ = np.array(grid[int(np.argmin(costs))]); Vl = lower(V0, q0_)
            # fold guard as in stage 2
            n0_ = np.cross(V0[F[:, 1]] - V0[F[:, 0]], V0[F[:, 2]] - V0[F[:, 0]])
            n1_ = np.cross(Vl[F[:, 1]] - Vl[F[:, 0]], Vl[F[:, 2]] - Vl[F[:, 0]]); flips = int(((n0_ * n1_).sum(1) <= 0).sum())
            a0 = both_iou(Vl, good); ok0 = a0.mean() >= b0.mean() + 0.03 and flips == 0
            others = [o for o in obs if o["pose_err"] > LOW_POSE_ERR]
            low = {"status": "applied" if ok0 else ("kept (folds)" if flips else "kept (gain < 0.03)"), "frames": int(len(b0)),
                   "iou_before": round(float(b0.mean()), 3), "iou_after": round(float(a0.mean()), 3),
                   "down_forward_pct_iod": [round(float(v) * 100, 2) for v in q0_],
                   "frames_used": [o["name"] for o in good],
                   "other_frames_iou_before_after": ([round(float(both_iou(V0, others).mean()), 3), round(float(both_iou(Vl, others).mean()), 3)]
                                                     if others else None)}
            if ok0: V = Vl
        else:
            low = {"status": "too few frames with a reliable pose", "frames": int(len(b0))}
    rep["lower_nose"] = low
    V0s = V0; V0 = V.copy()            # stage 1 starts from the stage-0 shape (its weights stay those of the input)
    # when stage 0 set the height from the reliable frames, stage 1 may not move the nostrils up / down again (the
    # chin-up frames, ~3 % IOD off on IMG_6006, pulled them straight back up) and stage 2 keeps to the base plane
    lock_up = low.get("status") == "applied"
    res = {}
    for s in (-1, 1):
        base = ious(V0, s)
        if len(base) < 3: res[s] = {"status": "too few frames", "frames": len(base)}; continue
        def cost(q):
            q = np.asarray(q, float).copy()
            if lock_up: q[1] = 0.0
            pen = 10 * (np.maximum(np.abs(q[:3]) - LIM_T, 0).sum() + np.maximum(LIM_S[0] - q[3:5], 0).sum()
                        + np.maximum(q[3:5] - LIM_S[1], 0).sum() + max(abs(q[5]) - LIM_R, 0) + max(abs(q[6]) - LIM_R, 0))
            # shape changes cost a little: turn / tilt / scale are used only where the photos clearly ask for them
            reg = 0.05 * np.abs(q[:3]).sum() / LIM_T + 0.05 * np.abs(q[3:5] - 1).sum() + 0.03 * np.abs(q[5:7]).sum() / LIM_R
            return -ious(deform(V0, s, q), s).mean() + pen + reg
        q0 = np.array([0, 0, 0, 1.0, 1.0, 0.0, 0.0])
        simplex = np.array([q0] + [q0 + d for d in np.diag([0.02, 0.02, 0.02, 0.15, 0.15, 0.15, 0.2])])
        r = minimize(cost, q0, method="Nelder-Mead", options={"initial_simplex": simplex, "maxiter": 320, "xatol": 1e-3, "fatol": 1e-4})
        q = np.clip(r.x, [-LIM_T] * 3 + [LIM_S[0]] * 2 + [-LIM_R] * 2, [LIM_T] * 3 + [LIM_S[1]] * 2 + [LIM_R] * 2)
        if lock_up: q[1] = 0.0
        after = ious(deform(V0, s, q), s)
        ok = after.mean() >= base.mean() + 0.03
        res[s] = {"status": "applied" if ok else "kept (gain < 0.03)", "frames": int(len(base)), "iou_before": round(float(base.mean()), 3),
                  "iou_after": round(float(after.mean()), 3), "shift_right_up_forward_pct_iod": [round(float(v) * 100, 2) for v in q[:3]],
                  "scale_right_forward": [round(float(v), 3) for v in q[3:5]], "turn_deg": round(float(np.degrees(q[5])), 1), "tilt_down_deg": round(float(np.degrees(q[6])), 1), "evals": int(r.nfev)}
        if ok: V = deform(V, s, q)
    # ---- stage 1b (v8, 10/22): lower the LATERAL nostril rim (alar rim) ---------------------------------------------
    # User on IMG_6006 (front view, after the camera poses were fixed): the real nostrils show from the front only as a
    # thin dark slit under a wing rim that hangs over them and the nose's bottom line is flat; the model shows a large
    # opening with its inner walls and a "gull wing" bottom line (columella lower than the wings). Both = the lateral
    # part of the nostril rim sits too high relative to the columella. Per side the rim vertices are lowered (head down
    # axis) with a weight 0 on the columella side -> 1 on the wing side, the region follows harmonically (rim fixed, the
    # stage-1 region border at 0), fold guard. The amount is chosen on the near-frontal frames with a reliable camera
    # pose (overlap of the visible opening with the photo's dark nostril); kept unless that overlap gains >= 0.02 and
    # the chin-up rim overlap does not lose more than 0.03.
    from scipy.sparse import diags as sdiags
    from scipy.sparse.linalg import spsolve
    rim_drop = {}
    def harmonic(VV, s_, ids, Dfix_ids):
        Rg = (W[s_] > 1e-4) | side_v[s_]; Rg[ids] = True
        free = Rg.copy(); free[ids] = False; fi = np.where(free)[0]
        Dfix = np.zeros((len(VV), 3)); Dfix[ids] = Dfix_ids
        Dh = np.zeros((len(VV), 3)); Dh[ids] = Dfix_ids
        if len(fi):
            Lf = sdiags(deg[fi]) - Adj[fi][:, fi]; rhs_ = Adj[fi] @ Dfix
            Dh[fi] = np.column_stack([spsolve(Lf.tocsc(), rhs_[:, c]) for c in range(3)])
        return Dh, Rg
    if a.rim_drop:
        fr_good = [o for o in obs if o["kind"] == "visible" and o["pose_err"] <= LOW_POSE_ERR]
        rim_fr = [o for o in obs if o["kind"] == "rim"]
        def side_iou(VV, s_, use):
            out = []
            for o in use:
                mm = (rim_mask(VV, rim_ids[s_], o["R"], o["t"], K, o["box"]) if o["kind"] == "rim"
                      else split(cavity_mask(VV, F, near_tri, cav_tri, o["R"], o["t"], K, o["box"]), o, s_))
                ph = split(o["photo"].astype(bool), o, s_)
                if ph.sum() < 10: continue
                out.append((mm & ph).sum() / max((mm | ph).sum(), 1))
            return float(np.mean(out)) if out else None
        for s_ in (-1, 1):
            nm_ = "head_left_of_midline" if s_ < 0 else "head_right_of_midline"
            ids = rim_ids[s_]
            if len(fr_good) < 3 or len(ids) < 6:
                rim_drop[nm_] = {"status": "too few frames", "frontal_frames": len(fr_good)}; continue
            lat = np.abs(V[ids] @ ax[0] - mid); tl = (lat - lat.min()) / max(np.ptp(lat), 1e-9)
            wr = sm((tl - 0.2) / 0.6)
            Dunit, Rg = harmonic(V, s_, ids, -(wr[:, None] * ax[1][None, :]) * iod)     # per 1.0 x IOD of drop
            tri_r = Rg[F].any(1); n0_ = np.cross(V[F[tri_r, 1]] - V[F[tri_r, 0]], V[F[tri_r, 2]] - V[F[tri_r, 0]])
            def flips(VV):
                n1_ = np.cross(VV[F[tri_r, 1]] - VV[F[tri_r, 0]], VV[F[tri_r, 2]] - VV[F[tri_r, 0]]); return int(((n0_ * n1_).sum(1) <= 0).sum())
            f0, c0 = side_iou(V, s_, fr_good), side_iou(V, s_, rim_fr)
            best = (0.0, f0, c0)
            for d_ in np.arange(0.005, RIM_DROP_MAX + 1e-9, 0.005):
                Vt = V + Dunit * d_
                nf_ = flips(Vt)
                f1, c1 = side_iou(Vt, s_, fr_good), side_iou(Vt, s_, rim_fr)
                if os.environ.get("NF_DEBUG"): print("rim_drop", s_, round(d_, 3), nf_, f1, c1, file=sys.stderr)
                if nf_: break
                if f1 is None: continue
                if c0 is not None and c1 is not None and c1 < c0 - 0.03: break
                if f1 - 0.2 * d_ / RIM_DROP_MAX * 0.05 > best[1]: best = (float(d_), f1, c1)
            ok_ = f0 is not None and best[0] > 0 and best[1] >= f0 + 0.02
            rim_drop[nm_] = {"status": "applied" if ok_ else "kept", "drop_pct_iod": round(best[0] * 100, 2),
                             "frontal_iou": [None if f0 is None else round(f0, 3), None if best[1] is None else round(best[1], 3)],
                             "chinup_rim_iou": [None if c0 is None else round(c0, 3), None if best[2] is None else round(best[2], 3)],
                             "frontal_frames": len(fr_good)}
            if ok_: V = V + Dunit * best[0]
    rep["rim_drop"] = rim_drop
    # ---- stage 2 (v4, 10/22): each RIM vertex to the photo outline -------------------------------------------------
    # The whole-nostril move / scale / turn cannot make the photo's pointed oval (user: model nostril still rounder and
    # bigger from below). The 23 rim vertices per side are ~3 px apart in the chin-up photos (nostril ~24 px across), so
    # the mesh resolution is not the limit; their positions are. Per chin-up frame each projected rim vertex is pulled to
    # the nearest point of that side's photo outline (pulls > 8 px ignored, capped at 5 px); the 2D pulls of all frames
    # are solved for a displacement of each rim vertex in the nostril base plane (head right / forward axes), smooth
    # along the rim (neighbour difference term) and small (ridge); 3 rounds. The interior and the surrounding skin follow
    # with a Gaussian of the rim displacements (sigma 1.5 x rim edge length) x the stage-1 weight.
    from scipy.spatial import cKDTree
    detail = {}
    # v5 (10/22, user: one nostril still too TALL from below and from the front): stage 2 v4 used only chin-up frames and
    # moved the rim only in the base plane (right / forward), so the height seen from the front was never corrected.
    # Now every frame takes part (chin-up: all rim vertices; frontal / mildly tilted: only rim vertices that are VISIBLE
    # and lie on the outline of the model's visible opening) and the rim may also move along the up axis.
    def visible_rim(VV, o, ids):
        """rim vertices of `ids` that the frame sees and that lie on the outline of the visible opening"""
        X0, Y0, X1, Y1 = o["box"]
        T = F[near_tri]; X = VV @ o["R"].T + o["t"]; z = X[:, 2]
        uv = (X[:, :2] / z[:, None]) * f + [cx, cy] - [X0, Y0]
        idx = np.full((Y1 - Y0, X1 - X0), -1, np.int32); pts = np.round(uv[T] * 4).astype(np.int32)
        for k in np.argsort(-z[T].mean(1)): cv2.fillPoly(idx, [pts[k]], int(k), shift=2)
        zt = z[T].mean(1); open_ = ((idx >= 0) & cav_tri[near_tri][np.maximum(idx, 0)]).astype(np.uint8)
        ker = np.ones((5, 5), np.uint8); edge = cv2.dilate(open_, ker) != cv2.erode(open_, ker)
        q = np.round(uv[ids]).astype(int); inb = (q[:, 0] >= 0) & (q[:, 1] >= 0) & (q[:, 0] < idx.shape[1]) & (q[:, 1] < idx.shape[0])
        out = np.zeros(len(ids), bool)
        for k in np.where(inb)[0]:
            tri = idx[q[k, 1], q[k, 0]]
            if tri < 0 or not edge[q[k, 1], q[k, 0]]: continue
            out[k] = z[ids[k]] <= zt[tri] + 0.01 * iod                    # not hidden behind another surface
        return out
    detail = {}
    if a.rim_detail and sum(o["kind"] == "rim" for o in obs) >= 3:
        rim_e = ee[rim_all[ee[:, 0]] & rim_all[ee[:, 1]]]
        for s_ in (-1, 1):
            ids = rim_ids[s_]
            if len(ids) < 6: continue
            loc = {v: k for k, v in enumerate(ids)}
            pairs = np.array([(loc[i], loc[j]) for i, j in rim_e if i in loc and j in loc and i < j] or np.zeros((0, 2), int))
            elen = np.median(np.linalg.norm(V[ids[pairs[:, 0]]] - V[ids[pairs[:, 1]]], axis=1)) if len(pairs) else 0.01 * iod
            conts = []
            for o in obs:
                ph = split(o["photo"].astype(bool), o, s_).astype(np.uint8)
                cs, _ = cv2.findContours(ph, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
                pts = np.concatenate([c.reshape(-1, 2) for c in cs]) if cs else np.zeros((0, 2))
                conts.append(cKDTree(pts + [o["box"][0], o["box"][1]]) if len(pts) >= 8 else None)
            def pulls(VV, D):
                """per frame: (frame, contour tree, rim-vertex mask, projected uv, camera coords)"""
                out = []
                for o, kd in zip(obs, conts):
                    if kd is None: continue
                    use = np.ones(len(ids), bool) if o["kind"] == "rim" else visible_rim(VV, o, ids)
                    X = (VV[ids] + D) @ o["R"].T + o["t"]; uv = X[:, :2] / X[:, 2:] * f + [cx, cy]
                    out.append((o, kd, use, uv, X))
                return out
            def mean_dist(VV):
                dd = {"rim": [], "visible": []}
                for o, kd, use, uv, X in pulls(VV, 0):
                    if use.any(): dd[o["kind"]].append(kd.query(uv[use])[0])
                r_ = {}
                for k_, v_ in dd.items():
                    if v_:
                        v_ = np.concatenate(v_); r_[k_] = (float(np.mean(v_)), float(np.median(v_)), float(np.percentile(v_, 90)))
                return r_
            before = mean_dist(V)
            def solve(mode):
              Bp = np.stack([ax[0], ax[1], ax[2]], 1) if mode == "all-3d" else np.stack([ax[0], ax[2]], 1)
              nb = Bp.shape[1]; Dtot = np.zeros((len(ids), 3))
              for _ in range(3):
                n = len(ids); A_rows, b_rows = [], []
                for o, kd, use, uv, X in pulls(V + 0, Dtot):
                    if mode != "all-3d" and o["kind"] != "rim": continue
                    z = X[:, 2]; dist, jn = kd.query(uv); tgt = kd.data[jn]
                    r = tgt - uv; r *= (np.minimum(dist, 5.0) / np.maximum(dist, 1e-9))[:, None]
                    for k in np.where(use & (dist <= 8.0))[0]:
                        Jc = (f / z[k]) * np.array([[1, 0, -X[k, 0] / z[k]], [0, 1, -X[k, 1] / z[k]]]) @ o["R"] @ Bp   # 2 x nb
                        row = np.zeros((2, nb * n)); row[:, nb * k:nb * k + nb] = Jc; A_rows.append(row); b_rows.append(r[k])
                if not A_rows: break
                A = np.vstack(A_rows); b = np.concatenate(b_rows)
                sc = np.median(np.abs(A[A != 0]))                               # px per model unit, for the weights
                Sm = np.zeros((nb * len(pairs), nb * n))
                for q_, (i, j) in enumerate(pairs):
                    for c in range(nb):
                        Sm[nb * q_ + c, nb * i + c] = 1; Sm[nb * q_ + c, nb * j + c] = -1
                lam, mu = 1.5 * sc, 0.2 * sc
                M = np.vstack([A, lam * Sm, mu * np.eye(nb * n)]); rhs = np.concatenate([b, np.zeros(nb * len(pairs)), np.zeros(nb * n)])
                da = np.linalg.lstsq(M, rhs, rcond=None)[0].reshape(n, nb)
                Dtot = Dtot + da @ Bp.T
                nrm = np.linalg.norm(Dtot, axis=1, keepdims=True); Dtot *= np.minimum(1, 0.05 * iod / np.maximum(nrm, 1e-12))
              # carry the rim displacements to the interior / nearby skin by a HARMONIC field (v5d): rim vertices fixed at
              # their move, the region's outer border (stage-1 weight ~0) fixed at 0, every other vertex = mean of its
              # neighbours. The v4 Gaussian average left thin nostril walls behind when the rim moved up / down (folds).
              from scipy.sparse import csr_matrix, diags as sdiags
              from scipy.sparse.linalg import spsolve
              Rg = (W[s_] > 1e-4) | side_v[s_]; Rg[ids] = True
              free = Rg.copy(); free[ids] = False
              fi = np.where(free)[0]; pos = -np.ones(len(V), int); pos[fi] = np.arange(len(fi))
              Dfix = np.zeros((len(V), 3)); Dfix[ids] = Dtot                  # outside the region: 0
              A_ = Adj[fi][:, fi]; Lf = sdiags(deg[fi]) - A_
              rhs_ = Adj[fi] @ Dfix                                         # known neighbours (rim moves; outside 0)
              Dh = np.zeros((len(V), 3)); Dh[ids] = Dtot
              if len(fi): Dh[fi] = np.column_stack([spsolve(Lf.tocsc(), rhs_[:, c]) for c in range(3)])
              # fold guard: shrink the move until no triangle of the region turns over
              tri_r = Rg[F].any(1); n0_ = np.cross(V[F[tri_r, 1]] - V[F[tri_r, 0]], V[F[tri_r, 2]] - V[F[tri_r, 0]])
              for g in (1.0, 0.8, 0.6, 0.45, 0.3, 0.0):
                  Vn = V + Dh * g
                  n1_ = np.cross(Vn[F[tri_r, 1]] - Vn[F[tri_r, 0]], Vn[F[tri_r, 2]] - Vn[F[tri_r, 0]])
                  if ((n0_ * n1_).sum(1) <= 0).sum() == 0: break
              return Vn, Dtot * g
            # both modes; accepted when the outlines get clearly closer overall and neither frame kind gets worse; the
            # better accepted one wins (v5b: all-3d made one side's frontal outline worse, the chin-up / plane one did not)
            tot = lambda r_: np.mean([v[0] for v in r_.values()])
            cands = {}
            for mode in (("chinup-plane",) if lock_up else ("all-3d", "chinup-plane")):
                Vn, Dtot = solve(mode); after = mean_dist(Vn)
                ok2 = bool(before) and bool(after) and tot(after) <= 0.92 * tot(before) and all(after[k][0] <= before[k][0] * 1.10 for k in before if k in after)
                cands[mode] = (ok2, tot(after) if after else 1e9, Vn, Dtot, after)
            good = [m_ for m_ in cands if cands[m_][0]]
            pick = min(good, key=lambda m_: cands[m_][1]) if good else None
            detail[("head_left_of_midline" if s_ < 0 else "head_right_of_midline")] = {
                "status": f"applied ({pick})" if pick else "kept",
                "outline_px_mean_median_p90": {k: {"before": [round(x, 2) for x in before[k]], **{m_: [round(x, 2) for x in cands[m_][4].get(k, (0, 0, 0))] for m_ in cands}} for k in before},
                "max_rim_move_pct_iod": round(float(np.linalg.norm(cands[pick][3], axis=1).max() / iod * 100), 2) if pick else 0.0}
            if pick: V = cands[pick][2]
    name = {-1: "head_left_of_midline", 1: "head_right_of_midline"}
    V0 = V0s
    rep.update(status="ok", sides={name[s]: res[s] for s in res}, rim_detail=detail, max_move_pct_iod=round(float(np.linalg.norm(V - V0, axis=1).max() / iod * 100), 2))
    meshio.write_ply(a.out, V, F, colors=m.get("colors"))
    if a.debug:
        tiles = []
        for o in sorted(obs, key=lambda o: o["pitch"] or 0)[:: max(1, len(obs) // 5)][:5]:
            X0, Y0, X1, Y1 = o["box"]; rows = []
            for VV in (V0, V):
                c = o["img"][Y0:Y1, X0:X1].copy()
                mm = ((rim_mask(VV, rim_ids[-1], o["R"], o["t"], K, o["box"]) | rim_mask(VV, rim_ids[1], o["R"], o["t"], K, o["box"]))
                      if o["kind"] == "rim" else cavity_mask(VV, F, near_tri, cav_tri, o["R"], o["t"], K, o["box"])).astype(np.uint8)
                for msk, col in ((o["photo"], (0, 0, 255)), (mm, (255, 160, 0))):
                    cs, _ = cv2.findContours(msk.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE); cv2.drawContours(c, cs, -1, col, 1)
                rows.append(cv2.resize(c, (300, 160)))      # top: before, bottom: after
            tiles.append(np.vstack(rows))
        cv2.imwrite(a.debug, np.hstack(tiles), [cv2.IMWRITE_JPEG_QUALITY, 90])
    print(json.dumps(rep, ensure_ascii=False))


if __name__ == "__main__":
    main()
