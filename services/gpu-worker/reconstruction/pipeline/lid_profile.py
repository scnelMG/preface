"""W8b S2.5 (2026-10-21, 만두: "눈두덩이 볼륨 - 측면·3/4 프레임의 눈꺼풀 실루엣을 재서 fullness 3띠·눈썹뼈 능선·검판 평면으로
분해해 적용"): the upper-lid VOLUME measured from the face outline of the oblique frames.

observation   In frames turned 45-75 deg the outline of the face between the eyebrow and the eye is formed by the FAR
              eye's upper lid (orbital region, 40-60 % of the rows at 50-70 deg on chae01 / gyu01 / eun02, measured on the
              model) and by the brow bone (brow region) of both sides. In a full profile (> 80 deg) the nose bridge is in
              front of the lid, so the lid is not observable there. The photo outline is the forward-most skin pixel of the
              row (multiclass skin x person mask), the model outline the forward-most projected skin vertex of the detail
              mesh; their difference along the head's forward axis, per height band between lash and brow, is the missing
              volume: band 0 (lash .. 1/3 = tarsal plate front), band 1 (1/3 .. 2/3 = orbital fat pad), band 2 (2/3 .. brow =
              brow bone ridge). Units x eye width, per eye, median over rows and frames. Rows whose model outline vertex is
              not orbital / brow (nose, hair-covered) are skipped. No per-person constants; the bands feed EyeBasis
              `fullness` (3 bands at 1/6, 1/2, 5/6 of lash -> brow), closed loop: apply, re-project, re-measure (--iters).
usage  python pipeline/lid_profile.py work/<id> [--fit gnme] [--mesh <detail ply>] [--iters 2] [--out model/lid_profile.json]
       --mesh: measure a given detail-topology mesh (evaluation of an applied result), no loop.
"""
import argparse, json, os, sys, time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE); sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(ROOT, "tools"))
YAW_MIN, YAW_MAX, PITCH_MAX = 45.0, 75.0, 20.0
BROW = {"R": 105, "L": 334}; LASH = {"R": 159, "L": 386}; CORN = {"R": (33, 133), "L": (263, 362)}
BANDS = 3; FULL_CAP = 0.10
GAIN, STEP_CAP = 0.7, 0.05                     # closed-loop gain and max change per pass (x eye width)
PATCH_R = 1.1                                  # EyeBasis active radius (x eye width) so the lateral orbital rim / brow bone is reachable                     # x eye width: the applied fullness per band is clipped to +-FULL_CAP
MIN_ROWS, MIN_FRAMES = 6, 2
OK_LABELS = ("orbital", "brow")


def region_labels(D):
    from gnm_model import GNM, template_map
    G = GNM(); o2g = template_map()[0]; lab = np.full(D.n0, "other", dtype=object)
    for nm, tag in [("nose_region", "nose"), ("forehead_region", "forehead"), ("left_brow_region", "brow"), ("right_brow_region", "brow"),
                    ("left_orbital_region", "orbital"), ("right_orbital_region", "orbital"), ("left_temple_region", "temple"), ("right_temple_region", "temple")]:
        lab[(G.groups[G.group_names.index(nm)] > 0.3)[o2g]] = tag
    return lab[D.lift(np.arange(D.n0))]


class Profiler:
    def __init__(self, W, V_base, lid, D, sparse=None):
        import pycolmap
        from frame_check import intrinsics
        from parts_measure_v1 import frame_yaws
        from view_coverage import head_axes
        M = os.path.join(W, "model"); self.W, self.D, self.lid = W, D, lid
        self.poses = {k: v for k, v in json.load(open(os.path.join(M, "frame_poses.json")))["frames"].items() if v["status"] != "dropped"}
        prep = {x["file"]: x for x in json.load(open(os.path.join(W, "prep", "prepare.json"), encoding="utf-8"))["images"]}
        rec = pycolmap.Reconstruction(sparse or os.path.join(W, "colmap", "sparse_lens_anchored")); self.f, self.cx, self.cy = intrinsics(list(rec.cameras.values())[0])
        self.yaws = frame_yaws(V_base, lid, self.poses, prep)
        self.hold = set(open(os.path.join(M, "holdout.txt")).read().split()) if os.path.exists(os.path.join(M, "holdout.txt")) else set()
        self.c, self.x, self.up, self.fw = head_axes(V_base[lid]); self.lab = region_labels(D)
        self.ew = {S: float(np.linalg.norm(V_base[lid[CORN[S][0]]] - V_base[lid[CORN[S][1]]])) for S in "RL"}
        self.frames = sorted(n for n, (y, p) in self.yaws.items() if YAW_MIN <= abs(y) <= YAW_MAX and abs(p) <= PITCH_MAX)
        self._mask = {}

    def proj(self, X, R, t):
        Q = X @ np.asarray(R).T + np.asarray(t); return np.c_[self.f * Q[:, 0] / Q[:, 2] + self.cx, self.f * Q[:, 1] / Q[:, 2] + self.cy, Q[:, 2]]

    def mask(self, n):
        import cv2
        if n not in self._mask:
            cm = cv2.imread(os.path.join(self.W, "prep", "class_masks_v3", n + ".png"), -1); pm = cv2.imread(os.path.join(self.W, "prep", "person_masks", n + ".png"), -1)
            self._mask[n] = None if cm is None or pm is None else (np.isin(cm, [2, 3]) & (pm > 127))
        return self._mask[n]

    def measure(self, Vd, use_hold=False):
        """per side, per band: forward offset photo - model (x eye width) over rows x frames; returns dict + rows list"""
        D = self.D; skin = D.mat == 0; obs = {S: {b: [] for b in range(BANDS)} for S in "RL"}; used = {S: set() for S in "RL"}; rows_out = []
        for n in self.frames:
            if (n in self.hold) != use_hold: continue
            m = self.mask(n)
            if m is None: continue
            H, Wd = m.shape; R, t = self.poses[n]["R"], self.poses[n]["t"]; P = self.proj(Vd, R, t); Pb = P[:D.n0]
            for S in "RL":
                yb, yl = Pb[self.lid[BROW[S]], 1], Pb[self.lid[LASH[S]], 1]
                if not (0 < yb < yl < H): continue
                # the outline this eye can form is on ITS lateral side (outer corner direction): the far eye's lid against the
                # background, the near eye's brow bone at the temple. Image direction of (outer - inner corner) of this eye.
                out3 = Vd[self.lid[CORN[S][0]]] - Vd[self.lid[CORN[S][1]]]; cen = (Vd[self.lid[CORN[S][0]]] + Vd[self.lid[CORN[S][1]]]) / 2
                dd = self.proj(np.array([cen, cen + out3]), R, t); sgn = np.sign(dd[1, 0] - dd[0, 0]) or 1.0
                zc = float(np.mean([Pb[self.lid[CORN[S][0]], 2], Pb[self.lid[CORN[S][1]], 2]])); px_per_ew = self.f * self.ew[S] / zc
                win = 0.6 * px_per_ew
                near_eye = skin & (np.linalg.norm(Vd - cen, axis=1) < 1.6 * self.ew[S])          # this eye's neighbourhood only
                for y in range(int(np.ceil(yb)), int(np.floor(yl)) + 1):
                    sel = near_eye & (np.abs(P[:, 1] - y) < 1.0) & (P[:, 2] > 0)
                    if not sel.any(): continue
                    idx = np.where(sel)[0]; i = idx[np.argmax(sgn * P[idx, 0])]
                    if self.lab[i] not in OK_LABELS: continue
                    xm = P[i, 0]; row = m[y]; xs = np.where(row)[0]
                    xs = xs[np.abs(xs - xm) < win]
                    if len(xs) == 0: continue
                    xp = xs.max() if sgn > 0 else xs.min()
                    if abs(xp - xm) > 0.35 * px_per_ew: continue                    # not the same outline (hair, hand)
                    if (sgn > 0 and xs.max() < xm - 2) or (sgn < 0 and xs.min() > xm + 2): pass   # photo inside the model: fine, negative offset
                    rel = (yl - y) / max(yl - yb, 1e-6); b = min(int(rel * BANDS), BANDS - 1)
                    off = sgn * (xp - xm) / px_per_ew
                    obs[S][b].append(off); used[S].add(n); rows_out.append((n, S, b, round(float(off), 4), self.lab[i], int(i)))
        summ = {}
        for S in "RL":
            summ[S] = {"frames": len(used[S]), "bands": []}
            for b in range(BANDS):
                v = np.array(obs[S][b])
                summ[S]["bands"].append({"n_rows": int(len(v)), "median": round(float(np.median(v)), 4) if len(v) else None,
                                         "iqr": round(float(np.subtract(*np.percentile(v, [75, 25]))), 4) if len(v) else None})
        return summ, rows_out


def fullness_from(summ, prev=None):
    out = {}
    for S in "RL":
        f = list(prev[S]) if prev else [0.0, 0.0, 0.0]
        if summ[S]["frames"] >= MIN_FRAMES:
            for b, d in enumerate(summ[S]["bands"]):
                if d["median"] is not None and d["n_rows"] >= MIN_ROWS:
                    step = float(np.clip(GAIN * d["median"], -STEP_CAP, STEP_CAP))      # damped: the 3 bands interact through the interpolation
                    f[b] = float(np.clip(f[b] + step, -FULL_CAP, FULL_CAP))
        out[S] = [round(x, 4) for x in f]
    return out


def main():
    import meshio
    from detail_mesh import DetailMesh
    from eye_parts import EyeBasis
    ap = argparse.ArgumentParser()
    ap.add_argument("work"); ap.add_argument("--fit", default=""); ap.add_argument("--mesh", default="", help="detail-topology mesh to evaluate (no loop)")
    ap.add_argument("--eye-params", default="", help="eye_parts json whose crease / epicanthus params are kept while fullness is solved")
    ap.add_argument("--iters", type=int, default=2); ap.add_argument("--smooth-passes", type=int, default=8)
    ap.add_argument("--sparse", default=""); ap.add_argument("--out", default="")
    a = ap.parse_args()
    W = os.path.normpath(a.work); M = os.path.join(W, "model"); P = lambda n: os.path.join(M, n)
    name = a.fit or json.load(open(P("report.json"), encoding="utf-8")).get("chosen", "gnm")
    lid = np.asarray(json.load(open(P(f"fit_{name}.fit.json")))["landmark_vertex_ids"], np.int64)
    V = np.asarray(meshio.read_any(P(f"fit_{name}.ply"))["vertices"], np.float64); D = DetailMesh()
    t0 = time.time(); pr = Profiler(W, V, lid, D, a.sparse or None); tm = {"setup_sec": round(time.time() - t0, 2)}
    out = {"work": W, "fit": name, "patch_r": PATCH_R, "full_cap": FULL_CAP, "frames_candidate": len(pr.frames), "yaw_range": [YAW_MIN, YAW_MAX], "bands": "0 tarsal (lash..1/3), 1 fat pad, 2 brow bone (..brow)", "units": "x eye width, photo - model along the head forward axis"}
    if a.mesh:
        Vd = np.asarray(meshio.read_any(a.mesh)["vertices"], np.float64)
        out["mesh"] = a.mesh; out["train"], _ = pr.measure(Vd); out["holdout"], _ = pr.measure(Vd, use_hold=True)
    else:
        Vd = D.upsample(V, smooth_passes=a.smooth_passes)
        t0 = time.time(); before, rows = pr.measure(Vd); tm["measure_sec"] = round(time.time() - t0, 2)
        out["before"] = before; out["before_holdout"], _ = pr.measure(Vd, use_hold=True)
        params = json.load(open(a.eye_params, encoding="utf-8"))["params"] if a.eye_params else {S: {"crease": {"heights": [0, 0, 0], "depth": 0, "bulge": 0, "fold": 0}, "fullness": [0, 0, 0], "epicanthus": {"cover": 0, "angle_deg": 0}} for S in "RL"}
        full = fullness_from(before); loop = [{"pass": 0, "measured": before, "fullness": full}]
        B = EyeBasis(Vd, D.F, D.mat, D.comp, lid, ring_hold=0.015, hold_below_lash=True, patch=PATCH_R); tm["eye_basis_sec"] = round(time.time() - t0, 2)
        Vcur = Vd
        for it in range(1, max(1, a.iters) + 1):
            for S in "RL": params[S]["fullness"] = full[S]
            disp = B.displace(params); Vcur = Vd + disp
            after, _ = pr.measure(Vcur)
            if it < a.iters: full = fullness_from(after, prev=full)
            loop.append({"pass": it, "measured": after, "fullness": full})
        out["fullness"] = full; out["after"] = loop[-1]["measured"]; out["after_holdout"], _ = pr.measure(Vcur, use_hold=True); out["loop"] = loop
        out["rows_sample"] = rows[:40]
    out["timing_sec"] = tm
    o = a.out or P("lid_profile.json"); json.dump(out, open(o, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    brief = {k: out.get(k) for k in ("fit", "frames_candidate", "fullness")}
    for k in ("before", "after", "train", "holdout", "before_holdout", "after_holdout"):
        if k in out: brief[k] = {S: [(d["median"], d["n_rows"]) for d in out[k][S]["bands"]] + [out[k][S]["frames"]] for S in "RL"}
    print(json.dumps(brief, ensure_ascii=False))


if __name__ == "__main__":
    main()
