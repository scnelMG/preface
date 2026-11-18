"""Frame check from the SfM model itself (2026-10-24, 만두 proposal; OPTION scan_to_model --frame-check sfm).

frame_check.py judges every camera pose by MediaPipe landmarks re-projected from a first landmark triangulation and
re-solves or drops the frames that disagree. MediaPipe is weakest at the pose extremes, and that is exactly what it
removed: per run 3-11 frames, nearly all chin-up (-20..-43 deg) or profile (49-90 deg) frames (gyu01, seo01, chae01,
woo02, min01, 10/24) - the views that carry the under-chin, nostril and side-profile information. With the background
cut from the SfM masks (b090b14) the SfM poses are the better reference.

Here a frame is judged by its OWN SfM evidence: the head-masked feature points it observes and how well they re-project.
  dropped  when it observes few 3D points (< max(15, 0.2 x median)) or re-projects badly (median error > max(3 px,
           median + 4 MAD over the frames))
  never re-solved (no "repaired"): a pose that SfM got wrong as a whole is not something MediaPipe can fix reliably.
A self-consistent but globally FOLDED reconstruction is not caught here (its own re-projection is fine): that check stays
in the lens stage (rotation direction against MediaPipe on reliable frames).
Output: same JSON as frame_check.py ({"summary", "frames": {name: {status, err_px, n_obs, R, t}}}).
usage: python frame_check_sfm.py <sparse> <out.json>
"""
import json, sys
import numpy as np


def main():
    import pycolmap
    sparse, out = sys.argv[1], sys.argv[2]
    rec = pycolmap.Reconstruction(sparse)
    rows = {}
    for im in rec.images.values():
        cam = rec.cameras[im.camera_id]; T = im.cam_from_world(); R = T.rotation.matrix(); t = np.asarray(T.translation, float)
        errs = []
        for p2 in im.points2D:
            if not p2.has_point3D(): continue
            X = rec.points3D[p2.point3D_id].xyz
            q = cam.img_from_cam(R @ X + t)
            if q is None: continue
            errs.append(float(np.linalg.norm(np.asarray(q) - np.asarray(p2.xy))))
        rows[im.name] = {"R": R.tolist(), "t": t.tolist(), "status": "ok", "n_obs": len(errs),
                         "err_px": float(np.median(errs)) if errs else float("inf")}
    n = np.array([r["n_obs"] for r in rows.values()], float); e = np.array([r["err_px"] for r in rows.values()], float)
    fin = np.isfinite(e)
    med_n = float(np.median(n)); med_e = float(np.median(e[fin])) if fin.any() else 0.0
    mad = 1.4826 * float(np.median(np.abs(e[fin] - med_e))) if fin.any() else 0.0
    n_min = max(15.0, 0.2 * med_n); e_max = max(3.0, med_e + 4 * mad)
    for r in rows.values():
        if r["n_obs"] < n_min or not (r["err_px"] <= e_max): r["status"] = "dropped"
    summ = {"mode": "sfm", "frames": len(rows), "median_obs": med_n, "min_obs": n_min, "median_err_px": med_e, "threshold_px": e_max,
            "repaired": [], "dropped": sorted(k for k, r in rows.items() if r["status"] == "dropped")}
    json.dump({"summary": summ, "frames": rows}, open(out, "w"), indent=1)
    print(json.dumps(summ))


if __name__ == "__main__":
    main()
