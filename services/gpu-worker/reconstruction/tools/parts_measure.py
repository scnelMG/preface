"""W7 part measurements v0 (2026-10-20): how far the model's eyes / nose are from the photos, PART BY PART.
Measures only (the shape is not changed). -> work/<id>/model/parts_v0.json

  1. double eyelid (쌍꺼풀)   near-frontal frames (|yaw| <= 12, |pitch| <= 10): above each upper-lid landmark the
                             vertical gray profile is searched for the dark CREASE line 0.10-0.40 x eye width above the
                             lash line (a valley clearly darker than both sides). Per eye: detection rate over frames and
                             columns, crease height (x eye width). The current model has no crease (GNM mean lid):
                             any reliable detection = a part the model misses.
  2. upper-lid profile (눈두덩이) side frames (SfM |yaw| 55-95 deg, mostly without a face): the model's outline in the
                             brow / orbital band against the person outline of the photo. Signed distance, % of the eye
                             distance (+ = model outside = fuller than the photo, - = model inside = hollower).
  3. nostrils (콧구멍)       chin-up frames (MediaPipe pitch <= -12 deg = head tilted back, nostrils visible, |yaw| <= 30):
                             dark blobs between the nose wings vs the model's nostril openings (nose-region vertices with
                             ambient occlusion < 0.42) projected into the same frame. Intersection over union and area ratio.
usage: python tools/parts_measure.py work/<id>
"""
import argparse, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
UP = {"R": [246, 161, 160, 159, 158, 157, 173], "L": [466, 388, 387, 386, 385, 384, 398]}
CORNERS = {"R": (33, 133), "L": (263, 362)}


def detector():
    import mediapipe as mp
    from mediapipe.tasks.python import vision, BaseOptions
    return mp, vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_buffer=open(os.path.join(ROOT, "assets", "face_landmarker.task"), "rb").read()), num_faces=1))


def landmarks(mp, det, img):
    import cv2
    r = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB)))
    if not r.face_landmarks: return None
    H, W = img.shape[:2]
    return np.array([[p.x * W, p.y * H] for p in r.face_landmarks[0][:468]])


def crease(gray, L):
    """per eye: list of crease heights (x eye width) over the lid columns, None where no clear valley"""
    import cv2
    out = {}
    for side in ("R", "L"):
        a, b = L[CORNERS[side][0]], L[CORNERS[side][1]]; ew = np.linalg.norm(b - a)
        if ew < 25: out[side] = None; continue
        t = (b - a) / ew; n = np.array([t[1], -t[0]])
        if n[1] > 0: n = -n                                         # image "up"
        hs = []
        for k in UP[side][1:-1]:                                     # inner columns (corners are too steep)
            p0 = L[k]; ds = np.linspace(0.02, 0.48, 47) * ew
            pts = p0[None] + ds[:, None] * n[None]
            prof = []
            for (x, y) in pts:
                xi, yi = int(round(x)), int(round(y))
                if not (2 <= xi < gray.shape[1] - 2 and 2 <= yi < gray.shape[0] - 2): prof.append(np.nan); continue
                prof.append(float(gray[yi - 1:yi + 2, xi - 2:xi + 3].mean()))
            prof = np.array(prof)
            if np.isnan(prof).any(): continue
            prof = np.convolve(prof, np.ones(3) / 3, "same")
            fr = ds / ew; win = (fr >= 0.10) & (fr <= 0.40)
            i = np.where(win)[0][np.argmin(prof[win])]
            lo, hi = max(0, i - 5), min(len(prof) - 1, i + 5)
            depth = min(prof[lo:i].max() if i > lo else 0, prof[i + 1:hi + 1].max() if hi > i else 0) - prof[i]
            hs.append(float(fr[i]) if depth > 4.0 and i not in (np.where(win)[0][0], np.where(win)[0][-1]) else None)
        out[side] = hs
    return out


def main():
    import cv2, meshio, pycolmap
    from frame_check import intrinsics
    from gnm_model import GNM, template_map
    from mesh_ao import vertex_ao
    ap = argparse.ArgumentParser(); ap.add_argument("work"); a = ap.parse_args()
    W = a.work; M = os.path.join(W, "model")
    rep = json.load(open(os.path.join(M, "report.json"), encoding="utf-8")); ch = rep.get("chosen", "gnm")
    V = np.asarray(meshio.read_any(os.path.join(M, f"fit_{ch}.ply"))["vertices"], np.float64)
    lid = np.array(json.load(open(os.path.join(M, f"fit_{ch}.fit.json")))["landmark_vertex_ids"])
    t = np.load(os.path.join(ROOT, "assets", "gnm-template-v2.npz")); F = t["triangles"].astype(np.int64); mat = t["materials"]
    poses = {k: v for k, v in json.load(open(os.path.join(M, "frame_poses.json")))["frames"].items() if v["status"] != "dropped"}
    prep = {x["file"]: x for x in json.load(open(os.path.join(W, "prep", "prepare.json"), encoding="utf-8"))["images"]}
    vc = json.load(open(os.path.join(M, "view_coverage.json"))).get("per_frame", {})
    rec = pycolmap.Reconstruction(os.path.join(W, "colmap", "sparse_lens_anchored")); f, cx, cy = intrinsics(list(rec.cameras.values())[0])
    images = os.path.join(W, "prep", "images"); iod = float(np.linalg.norm(V[lid[33]] - V[lid[263]]))
    proj = lambda X, R, tt: (lambda Q: np.c_[f * Q[:, 0] / Q[:, 2] + cx, f * Q[:, 1] / Q[:, 2] + cy, Q[:, 2]])(X @ np.asarray(R).T + np.asarray(tt))
    G = GNM(); o2g = template_map()[0]; grp = lambda *ns: np.max([(G.groups[G.group_names.index(n)] > 0.3)[o2g] for n in ns], axis=0)
    out = {"source": os.path.basename(os.path.normpath(W)), "chosen": ch}
    mp, det = detector()
    # ---- 1. crease
    fr = [n for n, x in prep.items() if x.get("yaw") is not None and abs(x["yaw"]) <= 12 and abs(x.get("pitch") or 99) <= 10 and n in poses]
    fr = sorted(fr, key=lambda n: abs(prep[n]["yaw"]))[:14]
    res = {"R": [], "L": []}
    for n in fr:
        img = cv2.imread(os.path.join(images, n)); L = landmarks(mp, det, img)
        if L is None: continue
        c = crease(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32), L)
        for s in ("R", "L"):
            if c[s] is not None: res[s].append(c[s])
    cr = {}
    for s, rows in res.items():
        cols = [h for r in rows for h in r]; det_ = [h for h in cols if h is not None]
        cr["right" if s == "R" else "left"] = {"frames": len(rows), "columns": len(cols), "detected_pct": round(100 * len(det_) / max(len(cols), 1), 1),
                                              "crease_height_x_eye_width": round(float(np.median(det_)), 3) if det_ else None,
                                              "spread_p25_p75": [round(float(np.percentile(det_, q)), 3) for q in (25, 75)] if len(det_) >= 4 else None}
    out["double_eyelid"] = {"method": "dark valley 0.10-0.40 x eye width above the upper-lid landmarks, near-frontal frames",
                            "model": "no crease in the current model (GNM mean lid)", **cr}
    # ---- 2. upper-lid / brow profile in side frames
    band = grp("left_orbital_region", "right_orbital_region", "left_brow_region", "right_brow_region")
    skin_tri = F[(mat[F] == 0).all(1)]
    side = [n for n in poses if n in vc and 55 <= abs(vc[n][0]) <= 95]
    vals = {"left": [], "right": []}
    for n in side:
        pm = cv2.imread(os.path.join(W, "prep", "person_masks", n + ".png"), 0)
        if pm is None: continue
        R, tt = poses[n]["R"], poses[n]["t"]; P = proj(V, R, tt)
        if (P[:, 2] <= 0).any(): continue
        H, Wd = pm.shape; mm = np.zeros((H, Wd), np.uint8)
        cv2.fillPoly(mm, list(np.round(P[skin_tri][:, :, :2]).astype(np.int32)), 1)
        cs, _ = cv2.findContours(mm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        if not cs: continue
        q = np.vstack([c_[:, 0, :] for c_ in cs]).astype(np.float64)
        from scipy.spatial import cKDTree
        bandv = np.where(band)[0]; dv, jv = cKDTree(P[bandv, :2]).query(q)
        iod_px = f * iod / float(np.median(P[lid[[33, 263, 1]], 2]))
        sel = dv < 0.02 * iod_px
        if sel.sum() < 15: continue
        person = (pm > 127).astype(np.uint8)
        d_in = cv2.distanceTransform(person, cv2.DIST_L2, 3); d_out = cv2.distanceTransform(1 - person, cv2.DIST_L2, 3)
        qq = q[sel].astype(int); qq[:, 0] = np.clip(qq[:, 0], 0, Wd - 1); qq[:, 1] = np.clip(qq[:, 1], 0, H - 1)
        sd = np.where(person[qq[:, 1], qq[:, 0]] > 0, -d_in[qq[:, 1], qq[:, 0]], d_out[qq[:, 1], qq[:, 0]]) / iod_px * 100
        sd = sd[np.abs(sd) < 15]
        if len(sd) >= 10: vals["left" if vc[n][0] < 0 else "right"].append(float(np.median(sd)))
    out["upper_lid_profile"] = {"method": "model outline (brow + orbital regions) vs person outline, side frames SfM |yaw| 55-95",
                                **{k: {"frames": len(v), "signed_median_pct_iod": round(float(np.median(v)), 2) if v else None,
                                       "abs_median_pct_iod": round(float(np.median(np.abs(v))), 2) if v else None} for k, v in vals.items()},
                                "sign": "+ model outside the photo (fuller), - inside (hollower)"}
    # ---- 3. nostrils in chin-up frames
    fn_ = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]); vn = np.zeros_like(V)
    for k in range(3): np.add.at(vn, F[:, k], fn_)
    vn /= np.linalg.norm(vn, axis=1, keepdims=True) + 1e-12
    if ((V[mat == 0] - V[mat == 0].mean(0)) * vn[mat == 0]).sum(1).mean() < 0: vn = -vn
    ao = vertex_ao(V, F, vn); nost = np.where(grp("nose_region") & (ao < 0.42) & (mat == 0))[0]
    mid = V[lid[[1, 2, 4, 5, 195, 197]]].mean(0); xax = V[lid[263]] - V[lid[33]]; xax /= np.linalg.norm(xax)
    up_fr = [n for n, x in prep.items() if x.get("pitch") is not None and x["pitch"] <= -12 and abs(x.get("yaw") or 99) <= 30 and n in poses]
    rows = []
    for n in up_fr:
        img = cv2.imread(os.path.join(images, n)); Lm = landmarks(mp, det, img)
        if Lm is None or len(nost) < 6: continue
        x0, x1 = sorted([Lm[98, 0], Lm[327, 0]]); w_ = x1 - x0; y0 = Lm[1, 1]; y1 = Lm[2, 1] + 0.35 * abs(Lm[2, 1] - Lm[1, 1])
        X0, X1, Y0, Y1 = int(x0 - 0.15 * w_), int(x1 + 0.15 * w_), int(min(y0, y1) - 0.1 * w_), int(max(y0, y1) + 0.1 * w_)
        if X1 - X0 < 20 or Y1 - Y0 < 10: continue
        roi = cv2.cvtColor(img[Y0:Y1, X0:X1], cv2.COLOR_BGR2LAB)[..., 0].astype(np.float32)
        thr = min(np.percentile(roi, 18), 0.62 * np.median(roi))
        dark = (roi < thr).astype(np.uint8); dark = cv2.morphologyEx(dark, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        nb, lab_, st, _ = cv2.connectedComponentsWithStats(dark)
        keep = np.zeros_like(dark)
        for k in (1 + np.argsort(-st[1:, cv2.CC_STAT_AREA]))[:2] if nb > 1 else []:
            if st[k, cv2.CC_STAT_AREA] > 0.002 * dark.size: keep[lab_ == k] = 1
        R, tt = poses[n]["R"], poses[n]["t"]; P = proj(V, R, tt)
        mm = np.zeros_like(dark)
        for sgn in (-1, 1):
            ids = nost[((V[nost] - mid) @ xax) * sgn > 0]
            if len(ids) >= 3:
                hull = cv2.convexHull(np.round(P[ids, :2] - [X0, Y0]).astype(np.int32)); cv2.fillPoly(mm, [hull], 1)
        inter = int((keep & mm).sum()); uni = int((keep | mm).sum())
        if keep.sum() < 20: continue
        rows.append({"frame": n, "iou": inter / max(uni, 1), "area_model_over_photo": float(mm.sum()) / max(float(keep.sum()), 1)})
    out["nostrils"] = {"method": "dark blobs between the nose wings in chin-up frames vs the model's nostril openings (AO < 0.42) projected",
                       "frames": len(rows), "model_nostril_vertices": int(len(nost)),
                       "iou_median": round(float(np.median([r["iou"] for r in rows])), 3) if rows else None,
                       "area_model_over_photo_median": round(float(np.median([r["area_model_over_photo"] for r in rows])), 3) if rows else None}
    json.dump(out, open(os.path.join(M, "parts_v0.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
