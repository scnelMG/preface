"""Per-frame tracking check: does the 3D model, seen with the SfM camera of that frame, sit on the person in that frame?

usage: python frame_check.py <model.ply> <sparse> <imagesDir> <out.json> [--fit-json model.fit.json] [--focal-from-sparse]
For each registered frame: detect the 468 MediaPipe landmarks, project the model's landmarks with the SfM pose, median
pixel error. Frames whose error is far above the others (robust: > max(8 px, median + 4 MAD)) have a wrong SfM pose
(fast head turn / motion blur): we re-solve their pose with PnP against the model (same lens). If PnP brings them back
to the normal error they are kept with the corrected pose ("repaired"), else they are dropped ("dropped").
Output JSON: {frame: {status ok|repaired|dropped, err_px, err_after_px, R (3x3 cam_from_world), t}} - used by uv_bake.py
and tools/overlay_fit.py (--poses). Personal data: stays in work/.
"""
import argparse, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import meshio  # noqa


def main():
    import cv2, pycolmap
    import face_lm
    ap = argparse.ArgumentParser()
    ap.add_argument("model"); ap.add_argument("sparse"); ap.add_argument("images"); ap.add_argument("out")
    ap.add_argument("--fit-json", help="template fit report with landmark_vertex_ids (else the first 468 vertices are the landmarks)")
    ap.add_argument("--poses-in", help="evaluate with these poses (frame_check JSON) instead of the SfM ones")
    ap.add_argument("--no-repair", action="store_true", help="only measure, never re-solve poses (evaluation)")
    ap.add_argument("--skip", help="comma list of landmark ids not scored (e.g. upper-lid points moved on purpose to the lash line)")
    a = ap.parse_args()
    pin = load_poses(a.poses_in) if a.poses_in else None
    mm = meshio.read_any(a.model)
    V = np.asarray(mm["vertices"], np.float64)
    lid = np.array(json.load(open(a.fit_json))["landmark_vertex_ids"]) if a.fit_json else np.arange(468)
    X = V[lid]
    rec = pycolmap.Reconstruction(a.sparse)
    # landmark normals from the model surface -> only landmarks facing the camera are scored (MediaPipe guesses hidden ones)
    Fm = np.asarray(mm["faces"], np.int64)
    fn = np.cross(V[Fm[:, 1]] - V[Fm[:, 0]], V[Fm[:, 2]] - V[Fm[:, 0]]); vn = np.zeros_like(V)
    for k in range(3): np.add.at(vn, Fm[:, k], fn)
    XN = vn[lid] / (np.linalg.norm(vn[lid], axis=1, keepdims=True) + 1e-12)
    cams = np.array([i.projection_center() for i in rec.images.values()])
    if ((X - X.mean(0)) * XN).sum(1).mean() < 0: XN = -XN
    rows = {}
    for im in sorted(rec.images.values(), key=lambda i: i.name):
        img = cv2.imread(os.path.join(a.images, im.name)); H, W = img.shape[:2]
        cam = rec.cameras[im.camera_id]; T = im.cam_from_world()
        R, t = T.rotation.matrix(), np.asarray(T.translation, np.float64)
        if pin is not None:
            if im.name not in pin:
                continue
            R, t = pin[im.name]
        row = {"R": R.tolist(), "t": t.tolist(), "status": "ok"}
        L, M4 = face_lm.landmarks(a.images, im.name, img)
        if L is not None:
            uv = (np.array(L)[:, :2] * [W, H])[:468]
            pr = np.array([q if (q := cam.img_from_cam(R @ x + t)) is not None else (-1e6, -1e6) for x in X])   # None behind the camera -> huge error
            cc = -R.T @ t
            vis = ((cc - X) * XN).sum(1) / (np.linalg.norm(cc - X, axis=1) + 1e-12) > 0.25
            if a.skip: vis[[int(k) for k in a.skip.split(",")]] = False
            row["visible_landmarks"] = int(vis.sum())
            row["err_px"] = float(np.median(np.linalg.norm(pr - uv, axis=1)[vis if vis.sum() > 50 else slice(None)]))
            row["iod_px"] = float(np.linalg.norm(uv[33] - uv[263]))
            M = np.array(M4)[:3, :3]
            row["yaw"] = float(np.degrees(np.arctan2(M[0, 2], M[2, 2])))
            row["_uv"] = uv
        rows[im.name] = row
    errs = np.array([r["err_px"] for r in rows.values() if "err_px" in r])
    med = np.median(errs); mad = 1.4826 * np.median(np.abs(errs - med)); thr = max(8.0, med + 4 * mad)
    for name, row in rows.items():
        uv = row.pop("_uv", None)
        if uv is None or row["err_px"] <= thr or a.no_repair:
            continue
        im = [i for i in rec.images.values() if i.name == name][0]; cam = rec.cameras[im.camera_id]
        f, cx, cy = cam.params[0], cam.params[1], cam.params[2]
        K = np.array([[f, 0, cx], [0, f, cy], [0, 0, 1.0]])
        rv, _ = cv2.Rodrigues(np.array(row["R"])); tv = np.array(row["t"]).reshape(3, 1)
        ok, rv, tv = cv2.solvePnP(X, uv, K, None, rv, tv, useExtrinsicGuess=True, flags=cv2.SOLVEPNP_ITERATIVE)
        pr, _ = cv2.projectPoints(X, rv, tv, K, None)
        e2 = float(np.median(np.linalg.norm(pr[:, 0] - uv, axis=1)))  # (all landmarks: pose fit quality)
        row["err_after_px"] = e2
        if ok and e2 <= max(med * 2, 5.0):
            row.update(status="repaired", R=cv2.Rodrigues(rv)[0].tolist(), t=tv.ravel().tolist())
        else:
            row["status"] = "dropped"
    summ = {"frames": len(rows), "median_err_px": float(med), "threshold_px": float(thr),
            "repaired": [k for k, r in rows.items() if r["status"] == "repaired"], "dropped": [k for k, r in rows.items() if r["status"] == "dropped"]}
    json.dump({"summary": summ, "frames": rows}, open(a.out, "w"), indent=1)
    print(json.dumps(summ))


def bands(path, names=None, use_after=True):
    """median error per yaw band (px and % inter-ocular) from a frame_check JSON, optionally for a subset of frames."""
    fr = json.load(open(path))["frames"]
    out = {}
    for lab, lo, hi in (("front_0_15", 0, 15), ("three_quarter_15_35", 15, 35), ("side_35_90", 35, 91)):
        rows = [r for k, r in fr.items() if "err_px" in r and (names is None or k in names) and lo <= abs(r["yaw"]) < hi
                and r["status"] != "dropped"]
        if rows:
            e = [r.get("err_after_px", r["err_px"]) if use_after else r["err_px"] for r in rows]
            pct = [ei / r["iod_px"] * 100 for ei, r in zip(e, rows)]
            out[lab] = {"frames": len(rows), "px": round(float(np.median(e)), 2), "pct_iod": round(float(np.median(pct)), 2)}
    return out


def intrinsics(cam):
    """(f, cx, cy) for SIMPLE_* / RADIAL models (params f, cx, cy, ...) and PINHOLE (fx, fy, cx, cy; fx used)."""
    p = cam.params; name = str(cam.model).split(".")[-1]
    if name in ("PINHOLE", "OPENCV", "FULL_OPENCV", "OPENCV_FISHEYE"):
        return float(p[0]), float(p[2]), float(p[3])
    return float(p[0]), float(p[1]), float(p[2])


def load_poses(path):
    """{frame: (R, t)} for frames that are usable, from a frame_check.py JSON (None -> use the SfM poses)."""
    if not path:
        return None
    d = json.load(open(path))["frames"]
    return {k: (np.array(r["R"]), np.array(r["t"])) for k, r in d.items() if r["status"] != "dropped"}


if __name__ == "__main__":
    main()
