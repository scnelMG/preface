"""Camera-pose check of the ~90 deg frames (10/22, 만두: "1번 진행" - asymmetry between the sides is normal, so this tool does NOT
compare left with right; it asks whether each 90 deg frame's camera pose is good enough to read the near-eye lid profile).

per frame (the frames of tools/profile90.py, work/_trace/<id>/profile90.json):
  1. SfM reprojection error of the image (COLMAP 2D-3D matches) vs the median over all registered images of the capture
  2. whole-profile outline: forehead (landmark 10) .. chin (152) rows, photo = class_masks_v3 foreground, model = full render of the
     chosen fit from the same camera; first exit walking forward from the face centre. A 2D rigid fit (rotation + shift) of the
     model outline onto the photo outline: a big rotation / shift = pose error; what remains after it = real shape difference.
     Reported at the lid heights (lash .. brow of the near eye) before / after the rigid fit.
  3. same side, two frames: difference of the lid-height outline offsets (from 2.) between the two frames of one side
units: x eye width (forward direction); angles in degrees. Information only.
usage: python tools/pose90_check.py <id> ... [--synthetic]   -> work/_trace/<id>/pose90.json
"""
import json, os, sys
import numpy as np
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, os.path.join(ROOT, "pipeline")); sys.path.insert(0, os.path.join(ROOT, "tools"))


def reproj_errors(rec):
    out = {}
    for iid, im in rec.images.items():
        cam = rec.cameras[im.camera_id]; T = im.cam_from_world(); e = []
        for p2 in im.points2D:
            if not p2.has_point3D(): continue
            X = rec.points3D[p2.point3D_id].xyz; q = cam.img_from_cam(T * X)
            if q is not None: e.append(np.linalg.norm(np.asarray(q) - np.asarray(p2.xy)))
        out[im.name] = (float(np.median(e)) if e else None, len(e))
    return out


def outline(fg, start_xy, fwd, rows, maxlen):
    """per row y: x of the first exit from fg walking along +fwd (image x direction sign) from start x"""
    xs = []
    for y in rows:
        if y < 0 or y >= fg.shape[0]: xs.append(np.nan); continue
        x = int(start_xy); step = 1 if fwd > 0 else -1; seen = False; res = np.nan
        for _ in range(int(maxlen)):
            if x < 0 or x >= fg.shape[1]: break
            if fg[y, x]: seen = True
            elif seen: res = x - step; break
            x += step
        xs.append(res)
    return np.array(xs, float)


def rigid2d(A, B):
    """rotation (deg) + translation aligning point set A onto B (corresponding rows)"""
    ca, cb = A.mean(0), B.mean(0); H = (A - ca).T @ (B - cb); U, _, Vt = np.linalg.svd(H); Rm = Vt.T @ U.T
    if np.linalg.det(Rm) < 0: Vt[1] *= -1; Rm = Vt.T @ U.T
    return Rm, cb - Rm @ ca


def main():
    import cv2, pycolmap
    import trace_sheet as TS
    from frame_check import intrinsics
    from template_fit import head_axes
    synth = "--synthetic" in sys.argv
    for w in [x for x in sys.argv[1:] if not x.startswith("--")]:
        W = os.path.join(ROOT, "work", w); D = os.path.join(ROOT, "work", "_trace", w)
        p90 = json.load(open(os.path.join(D, "profile90.json"), encoding="utf-8"))
        rec = pycolmap.Reconstruction(os.path.join(W, "colmap", "sparse_lens_anchored")); f, cx, cy = intrinsics(list(rec.cameras.values())[0])
        rep = reproj_errors(rec); med_all = float(np.median([v[0] for v in rep.values() if v[0] is not None]))
        V, F, lid, ch = TS.load_fit(w); L = V[lid]; ax = head_axes(L)
        res = {"id": w, "chosen": ch, "sfm_reproj_px_median_all": round(med_all, 3), "frames": []}
        for fr in p90["frames"]:
            n = fr["frame"]; im = [i for i in rec.images.values() if i.name == n][0]; T = im.cam_from_world(); R = T.rotation.matrix(); t = np.asarray(T.translation)
            def pj(X):
                Q = np.atleast_2d(X) @ R.T + t; return np.c_[f * Q[:, 0] / Q[:, 2] + cx, f * Q[:, 1] / Q[:, 2] + cy]
            S = fr["near_eye"]; lash, brow = (159, 105) if S == "R" else (386, 334); ew = float(np.linalg.norm(L[33] - L[133]) if S == "R" else np.linalg.norm(L[263] - L[362]))
            top, chin, nose = pj(L[10])[0], pj(L[152])[0], pj(L[1])[0]
            fwdx = np.sign((pj(L[1] + ax[2] * ew)[0] - pj(L[1])[0])[0]) or 1.0
            px_ew = float(np.linalg.norm(pj(L[lash] + ax[2] * ew)[0] - pj(L[lash])[0]))
            cm = cv2.imread(os.path.join(W, "prep", "class_masks_v3", n + ".png"), -1)
            if cm is None: continue
            fgp = cm > 0; H, Wd = fgp.shape
            # model render over the whole profile (1x)
            pts = pj(L[[10, 152, 1, 234, 454]]); m = 0.25 * np.linalg.norm(top - chin)
            x0 = int(max(0, pts[:, 0].min() - m)); x1 = int(min(Wd, pts[:, 0].max() + m)); y0 = int(max(0, pts[:, 1].min() - m)); y1 = int(min(H, pts[:, 1].max() + m))
            g = TS.cam_render(V, F, R, t, f, (x0, y0, x1 - x0, y1 - y0, cx, cy), 1.0)
            fgm = np.zeros_like(fgp); gm = np.abs(g.astype(int) - [250, 250, 252]).sum(2) >= 6
            fgm[y0:y0 + gm.shape[0], x0:x0 + gm.shape[1]] = gm[: min(gm.shape[0], H - y0), : min(gm.shape[1], Wd - x0)]
            if synth: fgp = fgm.copy()          # self-test: photo = model render -> rotation / shift / offsets ~0
            rows = np.arange(int(min(top[1], chin[1])), int(max(top[1], chin[1])))
            start = float(pj(L[[33, 263, 234, 454]]).mean(0)[0])            # inside the head at every profile row
            P = outline(fgp, start, fwdx, rows, 1.2 * np.linalg.norm(top - chin)); M = outline(fgm, start, fwdx, rows, 1.2 * np.linalg.norm(top - chin))
            ok = np.isfinite(P) & np.isfinite(M)
            if ok.sum() < 30: continue
            A = np.c_[M[ok], rows[ok]]; B = np.c_[P[ok], rows[ok]]
            # robust rigid fit: drop the worst 20 % (hair / hands / mask errors), refit
            Rm, tv = rigid2d(A, B); r = np.linalg.norm(A @ Rm.T + tv - B, axis=1); keep = r <= np.percentile(r, 80); Rm, tv = rigid2d(A[keep], B[keep])
            A2 = A @ Rm.T + tv
            ly0, ly1 = sorted([pj(L[lash])[0][1], pj(L[brow])[0][1]]); lidrow = (rows[ok] >= ly0) & (rows[ok] <= ly1)
            before = (B[:, 0] - A[:, 0]) * fwdx / px_ew; after = (B[:, 0] - A2[:, 0]) * fwdx / px_ew
            e_img = rep.get(n, (None, 0))
            res["frames"].append({"frame": n, "view_yaw": fr["view_yaw"], "near_eye": S, "sfm_reproj_px": None if e_img[0] is None else round(e_img[0], 3), "sfm_points": e_img[1],
                                  "rigid_rotation_deg": round(float(np.degrees(np.arctan2(Rm[1, 0], Rm[0, 0]))), 2),
                                  "rigid_R": [[round(float(v), 6) for v in r_] for r_ in Rm], "rigid_t_px": [round(float(v), 3) for v in tv],   # frame px: model -> photo
                                  "rigid_shift_x_ew": round(float(np.linalg.norm(A2.mean(0) - A.mean(0)) / px_ew), 3),
                                  "profile_rms_x_ew": {"before": round(float(np.sqrt(np.mean(before ** 2))), 3), "after": round(float(np.sqrt(np.mean(after ** 2))), 3)},
                                  "lid_rows_offset_x_ew": {"before": round(float(np.median(before[lidrow])), 3) if lidrow.any() else None, "after": round(float(np.median(after[lidrow])), 3) if lidrow.any() else None}})
        # same side, two frames
        for S in "RL":
            fs = [x for x in res["frames"] if x["near_eye"] == S]
            if len(fs) >= 2:
                res[f"same_side_{S}_lid_offset_diff_x_ew"] = round(abs(fs[0]["lid_rows_offset_x_ew"]["before"] - fs[1]["lid_rows_offset_x_ew"]["before"]), 3)
                res[f"same_side_{S}_rotation_diff_deg"] = round(abs(fs[0]["rigid_rotation_deg"] - fs[1]["rigid_rotation_deg"]), 2)
        json.dump(res, open(os.path.join(D, "pose90_synthetic.json" if synth else "pose90.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        print(w, "sfm med all", res["sfm_reproj_px_median_all"], {k: v for k, v in res.items() if k.startswith("same_side")})
        for x in res["frames"]:
            print("   ", x["frame"][-9:-4], x["view_yaw"], x["near_eye"], "sfm", x["sfm_reproj_px"], x["sfm_points"], "rot", x["rigid_rotation_deg"], "shift", x["rigid_shift_x_ew"],
                  "rms", x["profile_rms_x_ew"], "lid", x["lid_rows_offset_x_ew"])


if __name__ == "__main__":
    main()
