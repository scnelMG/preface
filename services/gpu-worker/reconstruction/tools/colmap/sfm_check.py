"""COLMAP (pycolmap) alignment check on a photo set: registered images, reprojection error, and — for synthetic sets
with truth.json — accuracy of the sparse points against the true surface after a similarity fit on camera centres.
Runs on CPU (feature extraction, matching, incremental SfM). Dense MVS/meshing needs CUDA (run on the GPU PC).
usage: python sfm_check.py <imagesDir> <workDir> [--truth truth.json --mesh src.glb]
"""
import argparse
import json
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "pipeline"))


def umeyama(A, B):
    """similarity s,R,t with s*R@A+t ~ B"""
    ca, cb = A.mean(0), B.mean(0)
    A0, B0 = A - ca, B - cb
    U, S, Vt = np.linalg.svd(A0.T @ B0 / len(A))
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    D = np.diag([1, 1, d])
    R = Vt.T @ D @ U.T
    s = np.trace(np.diag(S) @ D) / (A0 ** 2).sum(1).mean()
    return s, R, cb - s * R @ ca


def main():
    import pycolmap
    ap = argparse.ArgumentParser()
    ap.add_argument("images"); ap.add_argument("work")
    ap.add_argument("--truth"); ap.add_argument("--mesh")
    ap.add_argument("--masks", default=None, help="COLMAP mask folder (<image>.png); only white pixels are used for features")
    ap.add_argument("--stage", default="all", choices=["features", "match", "map", "all"])
    ap.add_argument("--multi-camera", action="store_true", help="images of different sizes/devices (camera per image size)")
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)
    db = os.path.join(a.work, "database.db")
    t0 = time.time(); out = {"images_dir": a.images}
    if a.stage in ("features", "all"):
        ro = pycolmap.ImageReaderOptions()
        if a.masks:
            ro.mask_path = a.masks
        pycolmap.extract_features(db, a.images, camera_mode=pycolmap.CameraMode.AUTO if a.multi_camera else pycolmap.CameraMode.SINGLE, reader_options=ro)
        out["t_features"] = time.time() - t0
    if a.stage in ("match", "all"):
        pycolmap.match_exhaustive(db)
        out["t_match"] = time.time() - t0
    if a.stage in ("map", "all"):
        recs = pycolmap.incremental_mapping(db, a.images, os.path.join(a.work, "sparse"))
        n_img = len([f for f in os.listdir(a.images) if f.lower().endswith((".jpg", ".png"))])
        if not recs:
            out.update({"status": "fail", "reason": "no reconstruction"})
        else:
            best = max(recs.values(), key=lambda r: r.num_reg_images())
            out.update({"status": "ok", "models": len(recs), "registered": best.num_reg_images(), "images": n_img,
                        "points3D": best.num_points3D(), "mean_reproj_px": best.compute_mean_reprojection_error()})
            if a.truth and a.mesh:
                import meshio, render
                from canonical import nn_query
                tr = json.load(open(a.truth))
                mm = tr["mm_per_unit"]; c = np.array([0.0, 1.2, 1.8]); dist = tr["distance_units"]
                est, gt = [], []
                for img in best.images.values():
                    meta = next(x for x in tr["images"] if x["file"] == img.name)
                    R = render.view_matrix(meta["yaw"], meta["pitch"])
                    gt.append(c + dist * R[2])
                    est.append(img.projection_center())
                s, Rr, t = umeyama(np.array(est), np.array(gt))
                P = np.array([p.xyz for p in best.points3D.values()])
                P = (s * (Rr @ P.T)).T + t
                m = meshio.read_any(a.mesh)
                # dense sampling of the true surface (vertices + face centroids + edge midpoints)
                v, f = m["vertices"], m["faces"]
                S = np.concatenate([v, v[f].mean(1), 0.5 * (v[f[:, 0]] + v[f[:, 1]])])
                d, _ = nn_query(S, P)
                d_mm = d * mm
                face = (P[:, 2] > 1.2) & (np.abs(P[:, 0]) < 2.2) & (P[:, 1] > -0.6)  # front of the head
                out["sparse_point_error_mm_all"] = {"median": float(np.median(d_mm)), "p95": float(np.quantile(d_mm, 0.95))}
                if face.any():
                    out["sparse_point_error_mm_face"] = {"median": float(np.median(d_mm[face])), "p95": float(np.quantile(d_mm[face], 0.95)), "n": int(face.sum())}
                cam_err = np.linalg.norm((s * (Rr @ np.array(est).T)).T + t - np.array(gt), axis=1) * mm
                out["camera_centre_error_mm"] = {"median": float(np.median(cam_err)), "max": float(cam_err.max())}
        out["t_total"] = time.time() - t0
    json.dump(out, open(os.path.join(a.work, f"sfm_check_{a.stage}.json"), "w"), indent=1)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
