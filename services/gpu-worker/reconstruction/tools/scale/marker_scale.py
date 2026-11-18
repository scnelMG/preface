"""Metric scale for a COLMAP reconstruction from the printed ArUco card (tools/scale/make_marker_sheet.py).

photos -> detect marker corners (OpenCV ArUco) -> rays through the COLMAP cameras (pycolmap, distortion aware)
-> least-squares triangulation of each corner over all views -> marker side lengths and centre distance in model
units -> mm_per_unit = known_mm / model_length. Consistency (side vs centre distance, per-marker spread) is reported;
the scale is accepted only if the estimates agree within 1%.
usage: python marker_scale.py <imagesDir> <colmapSparseModelDir> <out.json> [--card marker_card.json]
"""
import argparse
import json
import os

import numpy as np


def triangulate(origins, dirs):
    """least-squares point closest to all rays"""
    A = np.zeros((3, 3)); b = np.zeros(3)
    for o, d in zip(origins, dirs):
        d = d / np.linalg.norm(d)
        P = np.eye(3) - np.outer(d, d)
        A += P; b += P @ o
    return np.linalg.solve(A, b)


def main():
    import cv2
    import pycolmap
    ap = argparse.ArgumentParser()
    ap.add_argument("images"); ap.add_argument("model"); ap.add_argument("out")
    ap.add_argument("--card", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "marker_card.json"))
    a = ap.parse_args()
    card = json.load(open(a.card)) if os.path.exists(a.card) else {"ids": [0, 1], "marker_side_mm": 40.0, "centre_distance_mm": 80.0}
    rec = pycolmap.Reconstruction(a.model)
    prm = cv2.aruco.DetectorParameters()
    prm.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX  # sub-pixel corners
    det = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50), prm)
    obs = {}  # (id, corner) -> list of (origin, dir)
    n_img_det = 0
    for img in rec.images.values():
        path = os.path.join(a.images, img.name)
        im = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        if im is None:
            continue
        corners, ids, _ = det.detectMarkers(im)
        if ids is None:
            continue
        cam = rec.cameras[img.camera_id]
        T = img.cam_from_world() if callable(getattr(img, "cam_from_world", None)) else img.cam_from_world
        R = np.array(T.rotation.matrix()); t = np.array(T.translation)
        centre = -R.T @ t
        found = False
        for c4, mid in zip(corners, ids.reshape(-1)):
            if int(mid) not in card["ids"]:
                continue
            found = True
            pts = c4.reshape(4, 2).astype(np.float64)
            rays = np.array(cam.cam_from_img(pts))  # normalized image plane (x, y), distortion removed
            for k in range(4):
                dcam = np.array([rays[k][0], rays[k][1], 1.0])
                obs.setdefault((int(mid), k), []).append((centre, R.T @ dcam))
        n_img_det += found
    X = {}
    resid = []
    for key, lst in obs.items():
        if len(lst) < 3:
            continue
        O = [o for o, _ in lst]; Dd = [d for _, d in lst]
        x = triangulate(O, Dd)
        for _ in range(2):  # drop rays far from the consensus point (mis-detections), re-solve
            r = np.array([np.linalg.norm(np.cross(x - o, d / np.linalg.norm(d))) for o, d in zip(O, Dd)])
            keep = r <= max(3 * np.median(r), 1e-12)
            if keep.sum() >= 3 and keep.sum() < len(O):
                O = [o for o, k in zip(O, keep) if k]; Dd = [d for d, k in zip(Dd, keep) if k]
                x = triangulate(O, Dd)
        X[key] = x
        resid.append(float(np.median([np.linalg.norm(np.cross(x - o, d / np.linalg.norm(d))) for o, d in zip(O, Dd)])))
    out = {"images_in_model": rec.num_reg_images(), "images_with_markers": n_img_det,
           "corners_triangulated": len(X), "card": card, "median_ray_residual_model_units": float(np.median(resid)) if resid else None}
    est = []
    sides = {}
    for mid in card["ids"]:
        cs = [X.get((mid, k)) for k in range(4)]
        if all(c is not None for c in cs):
            s_ = [np.linalg.norm(cs[k] - cs[(k + 1) % 4]) for k in range(4)]
            sides[mid] = s_
            est += [card["marker_side_mm"] / x for x in s_]
    if len(sides) == 2:
        c0 = np.mean([X[(card["ids"][0], k)] for k in range(4)], 0)
        c1 = np.mean([X[(card["ids"][1], k)] for k in range(4)], 0)
        est.append(card["centre_distance_mm"] / np.linalg.norm(c1 - c0))
    if not est:
        out.update({"status": "fail", "reason": "markers not found in >=3 registered photos"})
    else:
        est = np.array(est)
        mpu = float(np.median(est))
        spread = float((est.max() - est.min()) / mpu)
        mad = float(np.median(np.abs(est / mpu - 1)))
        within = float(np.mean(np.abs(est / mpu - 1) <= 0.01))
        out.update({"mm_per_unit": mpu, "estimates": est.tolist(), "relative_spread": spread,
                    "median_abs_rel_dev": mad, "fraction_within_1pct": within,
                    "status": "ok" if len(est) >= 6 and mad <= 0.005 and within >= 0.75 else "uncertain",
                    "rule": ">=6 estimates (8 sides + centre distance), median abs deviation <=0.5% and >=75% within 1% of the median"})
    json.dump(out, open(a.out, "w"), indent=1)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
