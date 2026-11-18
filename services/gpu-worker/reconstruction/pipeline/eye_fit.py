"""Eyeballs sit INSIDE the eyelids, iris where the photos show it (2026-10-15, eun01: "the eye pokes out of the lids").

Problems measured on eun01 (fit_lm):
  - eyeball surface in front of the lid skin outside the lid opening: 30 + 9 vertices, up to 2.2 % of the eye distance
    (grey wedges at the eye corners / over the upper lid in the viewer)
  - iris too high between the lids: photo upper / lower lid at 0.83 r / 0.83 r from the iris centre, model 0.63-0.75 r /
    0.99-1.20 r (white showing under the iris = staring look)
Method (automatic, any person):
  1. gaze: near-frontal photos (MediaPipe 478 points incl. iris) -> where the iris centre sits between the lid points
     (fractions along corner->corner and upper->lower lid; distance / lens independent) -> the eyeball is ROTATED about
     its centre so the model's iris centre lands at the same fractions (max 12 deg)
  2. containment: every eyeball vertex outside the lid opening must lie behind the skin in front of it (margin 0.4 %
     of the eye distance) -> the eyeball is moved back along the face direction by the largest violation (max 5 %)
usage: python eye_fit.py <fit.ply> <fit.json> <images> <prepare.json> [--exclude holdout.txt] [--out fit.ply]
"""
import argparse, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import meshio  # noqa

# (eyeball component, corner a, corner b, upper lid, lower lid, iris centre, opening ring) -- MediaPipe indices
EYES = {2: (33, 133, 159, 145, 468, [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7]),
        1: (263, 362, 386, 374, 473, [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249])}


def photo_fractions(images, prep, exclude, max_frames=14):
    import cv2
    import face_lm
    fr = [i for i in prep["images"] if i.get("yaw") is not None and abs(i["yaw"]) < 8 and abs(i.get("pitch") or 0) < 10
          and i["file"] not in exclude and (i.get("blink") or 0) < 0.35]
    fr = sorted(fr, key=lambda i: abs(i["yaw"]))[:max_frames]
    res = {c: [] for c in EYES}
    for i in fr:
        im = cv2.imread(os.path.join(images, i["file"]))
        if im is None: continue
        H, W = im.shape[:2]
        L, _ = face_lm.landmarks(images, i["file"], im)
        if L is None or len(L) < 478: continue
        u = np.array(L)[:, :2] * [W, H]
        for cid, (ca, cb, ul, ll, ic, _) in EYES.items():
            ax = u[cb] - u[ca]; th = ((u[ic] - u[ca]) @ ax) / (ax @ ax)
            v = u[ll] - u[ul]; tv = ((u[ic] - u[ul]) @ v) / max(v @ v, 1e-9)
            res[cid].append((th, tv))
    return {c: (np.median(np.array(v), 0) if len(v) >= 3 else None) for c, v in res.items()}, len(fr)


def sphere(P):
    sol = np.linalg.lstsq(np.c_[2 * P, np.ones(len(P))], (P ** 2).sum(1), rcond=None)[0]
    c = sol[:3]; return c, float(np.sqrt(max(sol[3] + c @ c, 1e-12)))


def rot_between(a, b):
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b); v = np.cross(a, b); s = np.linalg.norm(v); c = a @ b
    if s < 1e-9: return np.eye(3)
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K * ((1 - c) / s ** 2)


def main():
    from matplotlib.path import Path
    from scipy.spatial import cKDTree
    ap = argparse.ArgumentParser()
    ap.add_argument("fit"); ap.add_argument("fit_json"); ap.add_argument("images"); ap.add_argument("prepare")
    ap.add_argument("--exclude"); ap.add_argument("--out"); ap.add_argument("--max-gaze-deg", type=float, default=12)
    ap.add_argument("--margin", type=float, default=0.004, help="eyeball behind the lid skin by this x eye distance")
    ap.add_argument("--no-gaze", action="store_true")
    ap.add_argument("--lid-clear", type=float, default=0.0, help="OPTION (2026-10-21, sunken lids): after the drape, upper-lid skin "
                    "outside the opening and within 0.25 x eye distance of it is kept at least this x eyeball radius OUTSIDE the ball "
                    "(a minimum lid thickness; 0 = off, try 0.05)")
    a = ap.parse_args()
    t = np.load(os.path.join(HERE, "..", "assets", "gnm-template-v2.npz")); mat = t["materials"]; comp = t["components"]
    fit = meshio.read_any(a.fit); V = np.asarray(fit["vertices"], np.float64).copy()
    ids = np.array(json.load(open(a.fit_json))["landmark_vertex_ids"]); L = V[ids]
    x = L[263] - L[33]; x /= np.linalg.norm(x); up = L[10] - L[152]; up -= x * (up @ x); up /= np.linalg.norm(up)
    fw = np.cross(x, up); fw *= np.sign((L[1] - L[[33, 263]].mean(0)) @ fw)
    iod = float(np.linalg.norm(L[263] - L[33])); sk = np.where(mat == 0)[0]
    excl = set(open(a.exclude).read().split()) if a.exclude else set()
    rep = {"eyes": {}}
    frac, nfr = ({c: None for c in EYES}, 0) if a.no_gaze else photo_fractions(a.images, json.load(open(a.prepare)), excl)
    rep["frontal_frames"] = nfr
    for cid, (ca, cb, ul, ll, ic, ring) in EYES.items():
        eb = np.where((comp == cid) & np.isin(mat, [4, 5, 6]))[0]
        allc = np.where(comp == cid)[0]
        if len(eb) < 20: continue
        ce, re_ = sphere(V[np.where((comp == cid) & (mat == 4))[0]])
        irc = V[np.where((comp == cid) & (mat == 5))[0]].mean(0)
        e = {"radius_pct_iod": round(100 * re_ / iod, 2)}
        # 1. gaze
        fr_ = frac.get(cid)
        if fr_ is not None:
            th, tv = fr_
            A, B, U, D = L[ca], L[cb], L[ul], L[ll]
            tgt = A + th * (B - A)                              # horizontal position along the corners
            tgt = tgt + (((U + tv * (D - U)) - tgt) @ up) * up  # vertical position between the lids
            r_ic = np.linalg.norm(irc - ce)
            cur = (irc - ce) / r_ic
            want_x = ((tgt - ce) @ x) / r_ic; want_u = ((tgt - ce) @ up) / r_ic
            if want_x ** 2 + want_u ** 2 < 0.95:
                want = want_x * x + want_u * up + np.sqrt(1 - want_x ** 2 - want_u ** 2) * fw
                ang = np.degrees(np.arccos(np.clip(cur @ want, -1, 1)))
                if ang > a.max_gaze_deg:                         # cap: slerp toward the target
                    k = a.max_gaze_deg / ang; want = cur * (1 - k) + want * k; want /= np.linalg.norm(want); ang = a.max_gaze_deg
                Rg = rot_between(cur, want)
                V[allc] = ce + (V[allc] - ce) @ Rg.T
                e.update(photo_fraction_h=round(float(th), 3), photo_fraction_v=round(float(tv), 3), gaze_rotation_deg=round(float(ang), 2))
        # 2. containment behind the lids
        poly = L[ring]; pc = poly.mean(0)
        P2 = np.c_[(poly - pc) @ x, (poly - pc) @ up]; path = Path(P2 * 0.97)
        near = sk[np.linalg.norm(V[sk] - pc, axis=1) < 0.6 * iod]
        s2 = np.c_[(V[near] - pc) @ x, (V[near] - pc) @ up]; sz = (V[near] - pc) @ fw; tree = cKDTree(s2)
        dd0, nn0 = tree.query(np.c_[(V[eb] - pc) @ x, (V[eb] - pc) @ up], k=6)
        def pokes(Vc):
            e2 = np.c_[(Vc[eb] - pc) @ x, (Vc[eb] - pc) @ up]; ez = (Vc[eb] - pc) @ fw
            dd, nn = tree.query(e2, k=6); out = ~path.contains_points(e2) & (dd[:, 0] < 0.04 * iod)
            v = (ez - sz[nn].max(1) + a.margin * iod)[out]
            return int((v > 0).sum()), (float(v.max()) if len(v) else -1.0)
        # 2a. LIDS DRAPE OVER THE EYEBALL (the template eyeball is large for a narrow / hooded opening: r = 0.56 x eye
        # width): skin vertices around the opening (outside the measured lid outline, front half of the ball) that lie
        # INSIDE the eyeball surface are moved radially onto it (+1.5 %), so the lid covers the ball like a real lid.
        # Shrinking the ball instead (tried: 0.8x) opened dark gaps at the corners.
        ce2, r2 = sphere(V[np.where((comp == cid) & (mat == 4))[0]])
        u_g = V[np.where((comp == cid) & (mat == 5))[0]].mean(0) - ce2; u_g /= np.linalg.norm(u_g)
        dense_poly = np.concatenate([P2[i] + (P2[(i + 1) % len(P2)] - P2[i]) * np.linspace(0, 1, 8, endpoint=False)[:, None] for i in range(len(P2))])
        conform = 0
        for _ in range(3):                              # a few passes: neighbours move together
            p2 = np.c_[(V[sk] - pc) @ x, (V[sk] - pc) @ up]
            edge_d = cKDTree(dense_poly).query(p2)[0]
            inside_open = Path(P2).contains_points(p2)
            rel = np.linalg.norm(V[sk] - ce2, axis=1) / r2
            front = ((V[sk] - ce2) @ u_g) > -0.1 * r2
            m = (~inside_open) & (edge_d < 0.10 * iod) & (rel < 1.015) & (rel > 0.7) & front
            if not m.any(): break
            idx = sk[m]; dv = V[idx] - ce2
            # feather: full push at the outline, less further out
            wgt = np.clip(1 - edge_d[m] / (0.10 * iod), 0.3, 1.0)[:, None]
            tgt = ce2 + dv / np.linalg.norm(dv, axis=1, keepdims=True) * r2 * 1.015
            V[idx] = V[idx] + (tgt - V[idx]) * wgt; conform += int(m.sum())
        e["lid_vertices_draped"] = conform
        if a.lid_clear > 0:
            # minimum lid thickness: skin above the opening (upper lid) that lies closer than (1 + lid_clear) x radius to the
            # ball centre is pushed radially out, feathered from the opening (full) to 0.25 x eye distance (none)
            p2 = np.c_[(V[sk] - pc) @ x, (V[sk] - pc) @ up]; edge_d = cKDTree(dense_poly).query(p2)[0]
            inside_open = Path(P2).contains_points(p2); rel = np.linalg.norm(V[sk] - ce2, axis=1) / r2
            front = ((V[sk] - ce2) @ u_g) > 0.0; above = ((V[sk] - pc) @ up) > 0
            m = (~inside_open) & above & front & (edge_d < 0.25 * iod) & (rel < 1.0 + a.lid_clear) & (rel > 0.8)
            if m.any():
                idx = sk[m]; dv = V[idx] - ce2; wgt = np.clip(1 - edge_d[m] / (0.25 * iod), 0.0, 1.0)[:, None]
                tgt = ce2 + dv / np.linalg.norm(dv, axis=1, keepdims=True) * r2 * (1.0 + a.lid_clear)
                V[idx] = V[idx] + (tgt - V[idx]) * wgt
            e["lid_clear_vertices"] = int(m.sum()); e["lid_clear"] = a.lid_clear
        s2 = np.c_[(V[near] - pc) @ x, (V[near] - pc) @ up]; sz = (V[near] - pc) @ fw; tree = cKDTree(s2)
        # 2c. last resort: whatever still pokes out is moved back (small)
        push_total = 0.0
        for _ in range(2):
            e2 = np.c_[(V[eb] - pc) @ x, (V[eb] - pc) @ up]; ez = (V[eb] - pc) @ fw
            dd, nn = tree.query(e2, k=6); skin_z = sz[nn].max(1)
            out = ~path.contains_points(e2) & (dd[:, 0] < 0.04 * iod)
            viol = (ez - skin_z + a.margin * iod)[out]
            push = float(viol.max()) if out.any() and viol.max() > 0 else 0.0
            push = min(push, 0.05 * iod - push_total)
            if push <= 1e-9: break
            V[allc] -= fw * push; push_total += push
        e2 = np.c_[(V[eb] - pc) @ x, (V[eb] - pc) @ up]; ez = (V[eb] - pc) @ fw
        dd, nn = tree.query(e2, k=6); out = ~path.contains_points(e2) & (dd[:, 0] < 0.04 * iod)
        e.update(pushed_back_pct_iod=round(100 * push_total / iod, 2),
                 remaining_poke_vertices=int((out & (ez > sz[nn].max(1))).sum()))
        # iris position check after the fix (fractions in the model, frontal projection)
        irc = V[np.where((comp == cid) & (mat == 5))[0]].mean(0)
        A, B, U, D = L[ca], L[cb], L[ul], L[ll]
        e["model_fraction_h"] = round(float(((irc - A) @ (B - A)) / ((B - A) @ (B - A))), 3)
        e["model_fraction_v"] = round(float(((irc - U) @ up) / ((D - U) @ up)), 3)
        rep["eyes"][str(cid)] = e
    out = a.out or a.fit
    meshio.write_ply(out, V, np.asarray(fit["faces"]), fit.get("colors"))
    print(json.dumps(rep))


if __name__ == "__main__":
    main()
