"""LINE agreement between the 3D model and the photos (2026-10-15) - "does the model's outline sit on the person's
outline?", per frame and per head-turn band. Complements the hold-out LANDMARK check (scan_to_model): landmarks only
measure the 468 MediaPipe points; this measures the silhouette lines that people judge by eye (jaw, cheek, nose /
lips / chin profile), where the template shape could be wrong without any landmark error.

Per frame: the model (fitted mesh, the frame's camera) is drawn as a silhouette; its outline points are kept when they
belong to the FACE (chin .. eye level, in front of the face-contour landmarks: no hair, ears, neck or back of the head)
and are compared with the person outline of the photo (MediaPipe selfie segmentation, cached in prep/person_masks).
  distance = pixels to the nearest photo outline point / eye distance in pixels at that depth (% of IOD)
  sign     = + where the model sticks OUT of the person (too wide / too deep), - where it falls inside
  parts    = profile (|x| < 0.25 IOD from the face midline: nose, lips, chin) and outline (cheeks, jaw)
Bands: front |yaw| < 15, three-quarter 15-35, side > 35 (MediaPipe yaw of the frame).
usage: python tools/line_check.py <work> [--every 1] [--overlays 4] -> <work>/model/line_check.json (+ line_check_*.jpg)
"""
import argparse, glob, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, "..", "pipeline"))
import meshio  # noqa


def main():
    import cv2, pycolmap
    from scipy.spatial import cKDTree
    from frame_check import load_poses, intrinsics
    from cranium_fit import person_masks
    ap = argparse.ArgumentParser()
    ap.add_argument("work"); ap.add_argument("--every", type=int, default=1); ap.add_argument("--overlays", type=int, default=4)
    ap.add_argument("--mesh", help="mesh to check (default: the chosen fit)"); ap.add_argument("--tag", default=""); ap.add_argument("--sparse")
    ap.add_argument("--yaw-source", choices=["mediapipe", "sfm"], default="mediapipe", help="OPTION (2026-10-24, W14 P4 B judge): sfm = "
                    "every registered frame, banded by the SfM view yaw (model/view_coverage.json, or --view-coverage), bands 0-15 / 15-45 / "
                    "45-75 / 75-105; mediapipe (default) = frames with a MediaPipe yaw only (frames beyond ~75 deg are skipped)")
    ap.add_argument("--view-coverage", help="view_coverage.json to read the SfM yaw from (default <work>/model/view_coverage.json)")
    ap.add_argument("--out", help="write the json here instead of <work>/model/line_check<tag>.json (no overlay image)")
    a = ap.parse_args()
    W = a.work; M = os.path.join(W, "model")
    rp = os.path.join(M, "report.json"); rep = json.load(open(rp)) if os.path.exists(rp) else {}
    best = rep.get("chosen", "lm")
    sparse = a.sparse or rep.get("sparse") or os.path.join(W, "colmap", "sparse_lens_anchored")
    if not os.path.isdir(sparse): sparse = os.path.join(W, "colmap", "sparse_lens_anchored")
    t = np.load(os.path.join(HERE, "..", "assets", "gnm-template-v2.npz")); F = t["triangles"].astype(np.int64); mat = t["materials"]
    V = np.asarray(meshio.read_any(a.mesh or os.path.join(M, f"fit_{best}.ply"))["vertices"], np.float64)
    # landmark ids: the checked mesh's own fit json first. During candidate scoring report.json does not exist yet, so
    # "chosen" falls back to lm - with --no-lm there is no fit_lm.fit.json and every candidate lost its line score
    # (2026-10-24, min01-orig-nolm). The ids are the same for all candidates (one template), so old results do not change.
    fj = [p for p in ((a.mesh[:-4] + ".fit.json") if a.mesh and a.mesh.endswith(".ply") else "", os.path.join(M, f"fit_{best}.fit.json"))
          if p and os.path.exists(p)] or sorted(glob.glob(os.path.join(M, "fit_*.fit.json")))
    ids = np.array(json.load(open(fj[0]))["landmark_vertex_ids"]); L = V[ids]
    iod = float(np.linalg.norm(L[33] - L[263]))
    x = L[454] - L[234]; x /= np.linalg.norm(x); up = L[10] - L[152]; up -= x * (up @ x); up /= np.linalg.norm(up)
    fw = np.cross(x, up); fw *= np.sign((L[1] - (L[234] + L[454]) / 2) @ fw)
    chin, eye_h = L[152], ((L[33] + L[263]) / 2 - L[152]) @ up
    hr = ((V - chin) @ up) / eye_h                                      # 0 at the chin, 1 at the eye line
    mid = (L[234] + L[454]) / 2; lat = ((V - mid) @ x) / iod; dep = ((V - mid) @ fw) / iod
    face_v = (mat == 0) & (hr > -0.02) & (hr < 1.0) & (dep > -0.05)       # in front of the contour landmarks
    profile_v = face_v & (np.abs(lat) < 0.25)
    rec = pycolmap.Reconstruction(sparse); P = load_poses(os.path.join(M, "frame_poses.json"))
    prep = json.load(open(os.path.join(W, "prep", "prepare.json"))); yaw = {i["file"]: i.get("yaw") for i in prep["images"]}
    hold = set(open(os.path.join(M, "holdout.txt")).read().split()) if os.path.exists(os.path.join(M, "holdout.txt")) else set()
    if a.yaw_source == "sfm":                       # SfM view yaw for every registered frame (MediaPipe has none beyond ~75 deg)
        vcp = a.view_coverage or os.path.join(M, "view_coverage.json")
        yaw = {n: float(v[0]) for n, v in json.load(open(vcp))["per_frame"].items()}
    names = sorted(n for n in P if yaw.get(n) is not None)[::max(1, a.every)]
    images = os.path.join(W, "prep", "images")
    PMk = person_masks(images, names, os.path.join(W, "prep", "person_masks"))
    from outline_obs import class_masks, gate_skin
    CMk = class_masks(images, names, os.path.join(W, "prep", "class_masks"))
    cam = list(rec.cameras.values())[0]; f, cx, cy = intrinsics(cam)
    rows = []; ov = []
    want_ov = sorted(names, key=lambda n: abs(abs(yaw[n]) - 60))[:2] + sorted(names, key=lambda n: abs(yaw[n]))[:1] + \
              sorted(names, key=lambda n: abs(abs(yaw[n]) - 30))[:1]
    tri = F[np.isin(mat[F], [0, 4, 5, 6]).all(1)]
    from outline_obs import background_edge

    def frame(n):
        """(row, overlay image or None) for one frame, None when it is not measured"""
        pm = PMk.get(n)
        if pm is None: return None
        R, tt = P[n]; R = np.asarray(R); tt = np.asarray(tt); H, Wd = pm.shape
        Q = V @ R.T + tt
        if (Q[:, 2] <= 0).any(): return None
        uv = np.c_[f * Q[:, 0] / Q[:, 2] + cx, f * Q[:, 1] / Q[:, 2] + cy]
        mm = np.zeros((H, Wd), np.uint8)
        cv2.fillPoly(mm, list(np.round(uv[tri]).astype(np.int32)), 255)
        cm, _ = cv2.findContours(mm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        # photo outline = SKIN outline (face + neck skin, holes for eyes / brows / lips filled), not the person outline:
        # hanging hair over the cheeks (woo01) is part of the person but not of the face
        im_ = cv2.imread(os.path.join(images, n)); ycc = cv2.cvtColor(im_, cv2.COLOR_BGR2YCrCb).astype(np.float32)
        ref_uv = uv[ids[[50, 280, 205, 425, 101, 330, 151]]].astype(int)
        ref_uv = ref_uv[(ref_uv[:, 0] >= 0) & (ref_uv[:, 0] < Wd) & (ref_uv[:, 1] >= 0) & (ref_uv[:, 1] < H)]
        if len(ref_uv) < 3: return None
        smp = np.vstack([ycc[max(0, v_ - 4):v_ + 5, max(0, u_ - 4):u_ + 5].reshape(-1, 3) for u_, v_ in ref_uv])
        y0c, cr0, cb0 = np.median(smp, 0)
        skin = ((np.abs(ycc[..., 1] - cr0) < 16) & (np.abs(ycc[..., 2] - cb0) < 16) & (ycc[..., 0] > 0.4 * y0c) & (pm > 127)).astype(np.uint8)
        skin = gate_skin(skin, CMk.get(n), pm)
        skin = cv2.morphologyEx(skin, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)); skin = cv2.morphologyEx(skin, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
        cs_, _ = cv2.findContours(skin, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        if not cs_: return None
        # the skin blob(s) that overlap the model's face
        cs_ = [c for c in cs_ if cv2.contourArea(c) > 0.02 * (mm > 0).sum()]
        filled = np.zeros_like(skin); cv2.drawContours(filled, cs_, -1, 1, -1)
        pm = (filled * 255).astype(np.uint8)
        cp, _ = cv2.findContours(filled, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        if not cm or not cp: return None
        qm = np.vstack([c[:, 0, :] for c in cm]).astype(float); qp = np.vstack([c[:, 0, :] for c in cp]).astype(float)
        # which model vertex is at each outline pixel (nearest projected vertex that faces sideways / is in front)
        vis = np.where(face_v | (mat == 0))[0]
        vt = cKDTree(uv[vis]); dv, iv = vt.query(qm); vv = vis[iv]
        keep = face_v[vv] & (dv < 0.03 * f * iod / np.median(Q[ids[[33, 263]], 2]))
        if keep.sum() < 20: return None
        qk = qm[keep]; part = np.where(profile_v[vv[keep]], "profile", "outline")
        d, jn = cKDTree(qp).query(qk)
        bg = background_edge(qp, PMk[n])[jn]          # photo skin edge against the background (else hair / clothes)
        iod_px = f * iod / float(np.median(Q[ids[[33, 263, 1]], 2]))
        inside = pm[np.clip(qk[:, 1].astype(int), 0, H - 1), np.clip(qk[:, 0].astype(int), 0, Wd - 1)] > 127
        sd = np.where(inside, -d, d) / iod_px * 100
        # no photo outline near (the face edge continues into the neck, or a strand of hair covers it): not measured
        # where hair continues beyond the skin edge (hairline, hanging hair) the head goes on under the hair: only a
        # model INSIDE the visible skin is an error there (same one-sided rule as the silhouette fit, 2026-10-16)
        ref_ok = (np.abs(sd) < 15) & (bg | (sd < 0))
        cover = float(ref_ok.mean()) if len(ref_ok) else 0.0
        qk, part, sd = qk[ref_ok], part[ref_ok], sd[ref_ok]
        if len(sd) < 10: return None
        y = yaw[n]
        if a.yaw_source == "sfm":
            band = "front_0_15" if abs(y) < 15 else ("three_quarter_15_45" if abs(y) < 45 else ("side_45_75" if abs(y) < 75 else "profile_75_105"))
        else:
            band = "front_0_15" if abs(y) < 15 else ("three_quarter_15_35" if abs(y) < 35 else "side_35_90")
        rec_ = {"frame": n, "yaw": round(y, 1), "band": band, "holdout": n in hold, "measured_share": round(cover, 2)}
        for p in ("profile", "outline"):
            s = sd[part == p]
            if len(s) >= 10:
                rec_[p] = {"median_abs": round(float(np.median(np.abs(s))), 2), "p90_abs": round(float(np.percentile(np.abs(s), 90)), 2),
                           "median_signed": round(float(np.median(s)), 2), "within2": round(float((np.abs(s) < 2).mean() * 100), 1),
                           "within5": round(float((np.abs(s) < 5).mean() * 100), 1), "n": int(len(s))}
        if n not in want_ov or a.overlays <= 0:
            return rec_, None
        im = im_.copy()
        cv2.drawContours(im, cp, -1, (255, 255, 255), 2)
        for (u_, v_), s in zip(qk.astype(int), sd):
            col = (60, 200, 60) if abs(s) < 2 else ((0, 200, 255) if abs(s) < 5 else (40, 40, 230))
            cv2.circle(im, (u_, v_), 3, col, -1)
        ys_, xs_ = np.where(mm > 0); y0_, y1_ = max(0, ys_.min() - 40), min(H, ys_.max() + 40); x0_, x1_ = max(0, xs_.min() - 60), min(Wd, xs_.max() + 60)
        c = im[y0_:y1_, x0_:x1_]; c = cv2.resize(c, (int(c.shape[1] * 600 / c.shape[0]), 600))
        cv2.putText(c, f"yaw {y:.0f}", (10, 30), 0, 1, (0, 255, 255), 2)
        return rec_, c

    # frames are independent (S15P31B204-702): side by side, rows and overlays kept in frame order
    from concurrent.futures import ThreadPoolExecutor
    from parallel import workers
    with ThreadPoolExecutor(workers(len(names)) if names else 1) as pool:
        for r in pool.map(frame, names):
            if r is None: continue
            rows.append(r[0])
            if r[1] is not None and len(ov) < a.overlays: ov.append(r[1])
    summ = {}
    for b in (("front_0_15", "three_quarter_15_45", "side_45_75", "profile_75_105") if a.yaw_source == "sfm" else ("front_0_15", "three_quarter_15_35", "side_35_90")):
        for p in ("profile", "outline"):
            vals = [r[p] for r in rows if r["band"] == b and p in r]
            if not vals: continue
            summ[f"{b}/{p}"] = {"frames": len(vals),
                                "median_abs_pct_iod": round(float(np.median([v["median_abs"] for v in vals])), 2),
                                "p90_abs_pct_iod": round(float(np.median([v["p90_abs"] for v in vals])), 2),
                                "signed_pct_iod": round(float(np.median([v["median_signed"] for v in vals])), 2),
                                "within_2pct": round(float(np.median([v["within2"] for v in vals])), 1),
                                "within_5pct": round(float(np.median([v["within5"] for v in vals])), 1)}
    out = {"work": W, "mesh": a.mesh or f"fit_{best}.ply", "frames": len(rows), "summary": summ, "per_frame": rows,
           "note": "% of the eye distance (outer corners); + = model outside the person outline (too wide / deep)"}
    tag = ("_" + a.tag) if a.tag else ""
    out["yaw_source"] = a.yaw_source
    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True); json.dump(out, open(a.out, "w"), indent=1); ov = []
    else:
        json.dump(out, open(os.path.join(M, f"line_check{tag}.json"), "w"), indent=1)
    if ov:
        hh = 600; cv2.imwrite(os.path.join(M, f"line_check{tag}.jpg"), np.hstack([cv2.resize(o, (int(o.shape[1] * hh / o.shape[0]), hh)) for o in ov]),
                              [cv2.IMWRITE_JPEG_QUALITY, 88])
    print(json.dumps({"frames": len(rows), "summary": summ}, ensure_ascii=False))


if __name__ == "__main__":
    main()
