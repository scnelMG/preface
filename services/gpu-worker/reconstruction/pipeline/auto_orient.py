"""Automatic face orientation for scans with arbitrary axes (photogrammetry exports).

Render the (decimated, coloured) mesh from ~30 directions, rotate each image by 0/90/180/270 deg, run MediaPipe
Face Landmarker, pick the most frontal upright detection, refine around it, and return world 'up' (chin->forehead)
and 'forward' (toward the viewer of the most frontal view) vectors in SOURCE coordinates.
These are hints only: canonical.py then refines yaw/roll by the symmetry plane.
usage (test): python auto_orient.py <mesh> [face_landmarker.task]
"""
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_TASK = os.path.join(HERE, "..", "assets", "face_landmarker.task")


def cluster_decimate(v, f, col, target_faces=12000):
    if len(f) <= target_faces:
        return v, f, col
    diag = np.linalg.norm(v.max(0) - v.min(0))
    cell = diag / 200.0
    for _ in range(8):
        key = np.floor((v - v.min(0)) / cell).astype(np.int64)
        _, inv = np.unique(key, axis=0, return_inverse=True)
        inv = inv.reshape(-1)
        f2 = inv[f]
        f2 = f2[(f2[:, 0] != f2[:, 1]) & (f2[:, 1] != f2[:, 2]) & (f2[:, 0] != f2[:, 2])]
        if len(f2) <= target_faces * 1.3:
            break
        cell *= 1.4
    n = inv.max() + 1
    cnt = np.bincount(inv, minlength=n)[:, None]
    v2 = np.zeros((n, 3)); np.add.at(v2, inv, v); v2 /= np.maximum(cnt, 1)
    c2 = None
    if col is not None:
        c2 = np.zeros((n, col.shape[1])); np.add.at(c2, inv, col); c2 /= np.maximum(cnt, 1)
    return v2, f2, c2


def fib_dirs(n):
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * i / n); th = np.pi * (1 + 5 ** 0.5) * i
    return np.stack([np.cos(th) * np.sin(phi), np.sin(th) * np.sin(phi), np.cos(phi)], 1)


def basis(d):
    ref = np.array([0, 1.0, 0]) if abs(d[1]) < 0.9 else np.array([1.0, 0, 0])
    right = np.cross(ref, d); right /= np.linalg.norm(right)
    up = np.cross(d, right)
    return np.stack([right, up, d])


class Detector:
    def __init__(self, task):
        import mediapipe as mp
        self.mp = mp
        self.det = mp.tasks.vision.FaceLandmarker.create_from_options(mp.tasks.vision.FaceLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_buffer=open(task, "rb").read()), num_faces=1, min_face_detection_confidence=0.3,
            output_facial_transformation_matrixes=True))

    def __call__(self, img):
        r = self.det.detect(self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=np.ascontiguousarray(img)))
        if not r.face_landmarks:
            return None, None
        M = np.array(r.facial_transformation_matrixes[0]) if r.facial_transformation_matrixes else None
        return np.array([[p.x, p.y] for p in r.face_landmarks[0]]), M


def evaluate_view(det, v, f, col, d, size):
    R = basis(d)
    img = render.render(v, f, R, size, colors=col, light=(0.2, 0.3, 1.0))
    dets = []
    for k in range(4):
        rot = np.rot90(img, k)  # counter-clockwise k*90
        lm, M = det(rot)
        if lm is None:
            continue
        p = lm * size
        # map landmarks back to the unrotated image (rot90 CCW by k)
        for _ in range(k):
            p = np.stack([size - 1 - p[:, 1], p[:, 0]], 1)
        eye_r, eye_l, nose, chin, fore = p[33], p[263], p[1], p[152], p[10]
        ew = np.linalg.norm(eye_l - eye_r)
        if ew < 5:
            continue
        frontal = 1 - abs(np.linalg.norm(nose - eye_r) - np.linalg.norm(nose - eye_l)) / ew
        upv = fore - chin
        up_img = np.array([upv[0], -upv[1]]); up_img /= np.linalg.norm(up_img)
        # uprightness inside the rotated image MediaPipe actually saw (true faces are found mostly near upright)
        q = lm * size
        upr = q[10] - q[152]; upr = np.array([upr[0], -upr[1]]) / max(np.linalg.norm(upr), 1e-9)
        rec = {"score": float(frontal), "upright": float(upr[1]), "rot": k,
               "up_world": up_img[0] * R[0] + up_img[1] * R[1], "dir": d}
        if M is not None:
            # head pose from MediaPipe (face model -> camera of the ROTATED image; +x right, +y up, +z toward viewer)
            c, s_ = np.cos(np.pi / 2 * k), np.sin(np.pi / 2 * k)
            Rk = np.array([[c, -s_, 0], [s_, c, 0], [0, 0, 1]])  # unrotated cam -> rotated cam (CCW k*90)
            to_world = R.T @ Rk.T                                 # rotated cam -> world
            rec["pose_up"] = to_world @ M[:3, 1] / np.linalg.norm(M[:3, 1])
            rec["pose_fwd"] = to_world @ M[:3, 2] / np.linalg.norm(M[:3, 2])
        dets.append(rec)
    return dets


def auto_orient(v, f, col=None, task=None, size=224, log=None):
    t0 = time.time()
    log = log if log is not None else []
    det = Detector(task or DEFAULT_TASK)
    vd, fd, cd = cluster_decimate(v, f, col)
    c = (vd.max(0) + vd.min(0)) / 2
    vd = vd - c
    cands = []
    for d in fib_dirs(26):
        cands += evaluate_view(det, vd, fd, cd, d, size)
    cands = [c_ for c_ in cands if c_["upright"] > 0.5 and c_["score"] > 0.6]
    if not cands:
        raise ValueError("auto-orient: no face found from 26 directions (check texture/colour or provide --up/--fwd)")
    # vote on the WORLD head pose: a real face seen from several directions yields the same world up/forward,
    # spurious fits (back of head, shoulders, rotated images) do not. Also require the view to face the head.
    P = [c_ for c_ in cands if "pose_up" in c_ and c_["dir"] @ c_["pose_fwd"] > np.cos(np.radians(55))]
    if not P:
        P = cands
        key_up = np.array([c_["up_world"] for c_ in P]); key_fw = np.array([c_["dir"] for c_ in P])
    else:
        key_up = np.array([c_["pose_up"] for c_ in P]); key_fw = np.array([c_["pose_fwd"] for c_ in P])
    W = np.array([c_["score"] for c_ in P])
    cosT = np.cos(np.radians(25))
    agree_m = ((key_up @ key_up.T) > cosT) & ((key_fw @ key_fw.T) > cosT)
    support = agree_m @ W
    i0 = int(np.argmax(support))
    cl = [P[j] for j in np.nonzero(agree_m[i0])[0]]
    ref_up = key_up[i0]
    best = max(cl, key=lambda r: r["score"])
    # local refinement around the most frontal consistent view
    for d in fib_dirs(24):
        dd = best["dir"] + 0.35 * d
        dd /= np.linalg.norm(dd)
        if dd @ best["dir"] < 0.9:
            continue
        for r in evaluate_view(det, vd, fd, cd, dd, size):
            if r["upright"] > 0.5 and "pose_up" in r and r["pose_up"] @ ref_up > cosT and r["score"] > best["score"]:
                best = r; cl.append(r)
    agree = [c_ for c_ in cl if "pose_up" in c_]
    if agree:
        # score-weighted mean head pose over all consistent detections
        w = np.array([c_["score"] for c_ in agree])
        up = (np.array([c_["pose_up"] for c_ in agree]) * w[:, None]).sum(0); up /= np.linalg.norm(up)
        fwd = (np.array([c_["pose_fwd"] for c_ in agree]) * w[:, None]).sum(0)
        method = "mediapipe head pose (weighted mean)"
    else:
        up = best["up_world"]; fwd = best["dir"]; method = "frontal view + chin-forehead line"
    fwd = fwd - up * (fwd @ up); fwd /= np.linalg.norm(fwd)
    log.append("auto_orient method: " + method)
    log.append(f"auto_orient: {len(cands)} upright detections, {len(cl)} agree on up, frontal score {best['score']:.3f}, {time.time() - t0:.1f}s, "
               f"decimated {len(fd)} faces")
    return up, fwd, best, log


if __name__ == "__main__":
    import meshio
    m = meshio.read_any(sys.argv[1])
    up, fwd, best, log = auto_orient(m["vertices"], m["faces"], m["colors"], sys.argv[2] if len(sys.argv) > 2 else None)
    print("up", np.round(up, 3), "fwd", np.round(fwd, 3)); print(log)
