"""RGB mode (일반 모드): one front photo from ANY phone -> estimated face surface (no depth sensor).

photo -> MediaPipe Face Landmarker (468 face points + estimated relative depth) -> triangles from the MediaPipe
tessellation -> 2x linear subdivision -> per-vertex colour sampled from the photo -> PLY + landmark json.
The output is fed to build_case.py with --input-kind rgb_estimated_mesh --units unknown.

What this is NOT: a measured surface. Depth comes from a learned face prior; nose depth error on a public scan with
known truth was median 0.086D / p95 0.21D (evaluation/tierB_rgb_depth). Units are image pixels (no mm, ever).

usage: python rgb_to_mesh.py <photo.jpg> <out.ply> [face_landmarker.task]
writes <out.ply> and <out>.landmarks.json (pronasale/nasion/subnasale from MediaPipe indices, source coords)
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import meshio  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_TASK = os.path.join(HERE, "..", "assets", "face_landmarker.task")
# MediaPipe face-mesh indices used as nose landmarks (approximate anatomical correspondences)
MP_LANDMARKS = {"pronasale": 1, "nasion": 168, "subnasale": 2}


def tessellation_triangles():
    from mediapipe.python.solutions.face_mesh_connections import FACEMESH_TESSELATION
    adj = {}
    for a, b in FACEMESH_TESSELATION:
        adj.setdefault(a, set()).add(b); adj.setdefault(b, set()).add(a)
    tris = set()
    for a, b in FACEMESH_TESSELATION:
        for c in adj[a] & adj[b]:
            tris.add(tuple(sorted((a, b, c))))
    return np.array(sorted(tris), np.int64)


def subdivide(v, f):
    edges = np.sort(np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]]), axis=1)
    uniq, inv = np.unique(edges, axis=0, return_inverse=True)
    inv = inv.reshape(-1); n = len(v); m = len(f)
    v2 = np.concatenate([v, 0.5 * (v[uniq[:, 0]] + v[uniq[:, 1]])])
    e01, e12, e20 = inv[:m] + n, inv[m:2 * m] + n, inv[2 * m:] + n
    a, b, c = f[:, 0], f[:, 1], f[:, 2]
    f2 = np.concatenate([np.stack([a, e01, e20], 1), np.stack([e01, b, e12], 1), np.stack([e20, e12, c], 1), np.stack([e01, e12, e20], 1)])
    return v2, f2


# eye openings and the mouth seam are HOLES in the MediaPipe tessellation (the face mesh has no eyeballs). Fill them
# with caps sampled from the photo, so the eyes (iris/pupil) and lips show as in the picture. The cap is a surface for
# display only; it is not a measured eyeball (a separate eye model is planned for the eye module).
EYE_LOOPS = {
    "eye_subject_left": [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
    "eye_subject_right": [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
}
MOUTH_LOOP = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191]


def add_cap(v, f, loop, bulge=0.0, rings=3):
    """fan-with-rings cap over a closed vertex loop; returns new (v, f)"""
    L = np.array(loop)
    P = v[L]
    c = P.mean(0) + np.array([0, 0, bulge])
    n0 = len(v)
    newv, ringidx = [], [list(L)]
    for k in range(1, rings):
        t = k / rings
        ring = []
        for p in P:
            q = p * (1 - t) + c * t
            q[2] = p[2] * (1 - t) + c[2] * t + bulge * np.sin(np.pi * t) * 0.5
            ring.append(n0 + len(newv)); newv.append(q)
        ringidx.append(ring)
    ci = n0 + len(newv); newv.append(c)
    tris = []
    m = len(L)
    for r in range(len(ringidx) - 1):
        A, B = ringidx[r], ringidx[r + 1]
        for j in range(m):
            j2 = (j + 1) % m
            tris += [[A[j], A[j2], B[j2]], [A[j], B[j2], B[j]]]
    last = ringidx[-1]
    for j in range(m):
        tris.append([last[j], last[(j + 1) % m], ci])
    v2 = np.concatenate([v, np.array(newv)])
    T = np.array(tris, np.int64)
    fn = np.cross(v2[T[:, 1]] - v2[T[:, 0]], v2[T[:, 2]] - v2[T[:, 0]])
    flip = fn[:, 2] < 0
    T[flip] = T[flip][:, [0, 2, 1]]
    return v2, np.concatenate([f, T])


def main(photo, out, task=None):
    import mediapipe as mp
    from PIL import Image, ImageOps
    task = task or DEFAULT_TASK
    im = ImageOps.exif_transpose(Image.open(photo)).convert("RGB")
    rgb = np.asarray(im)
    H, W, _ = rgb.shape
    det = mp.tasks.vision.FaceLandmarker.create_from_options(mp.tasks.vision.FaceLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_buffer=open(task, "rb").read()), num_faces=1))
    res = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
    if not res.face_landmarks:
        raise SystemExit("no face detected in photo")
    lm = np.array([[p.x, p.y, p.z] for p in res.face_landmarks[0]])[:468]
    # pixel units: +X right, +Y up, +Z toward camera (MediaPipe z: smaller = closer; same scale as x)
    v = np.stack([(lm[:, 0] - 0.5) * W, -(lm[:, 1] - 0.5) * H, -lm[:, 2] * W], 1)
    f = tessellation_triangles()
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    flip = fn[:, 2] < 0
    f[flip] = f[flip][:, [0, 2, 1]]
    # eyes: slightly recessed caps (the eyeball sits behind the lid rim); mouth seam: flat cap (closed lips)
    eye_w = np.linalg.norm(v[33] - v[133])
    for loop in EYE_LOOPS.values():
        v, f = add_cap(v, f, loop, bulge=-0.08 * eye_w, rings=4)
    v, f = add_cap(v, f, MOUTH_LOOP, bulge=-0.02 * eye_w, rings=2)
    for _ in range(2):
        v, f = subdivide(v, f)
    px = np.clip((v[:, 0] / W + 0.5) * (W - 1), 0, W - 1).astype(int)
    py = np.clip((0.5 - v[:, 1] / H) * (H - 1), 0, H - 1).astype(int)
    col = rgb[py, px] / 255.0
    meshio.write_ply(out, v, f, col)
    marks = {k: v[i].tolist() for k, i in MP_LANDMARKS.items()}
    json.dump(marks, open(os.path.splitext(out)[0] + ".landmarks.json", "w"), indent=1)
    info = {"photo": os.path.basename(photo), "image_size": [W, H], "vertices": int(len(v)), "faces": int(len(f)),
            "units": "image pixels (estimated depth, not measured)", "landmark_source": "MediaPipe indices " + json.dumps(MP_LANDMARKS)}
    json.dump(info, open(os.path.splitext(out)[0] + ".rgbinfo.json", "w"), indent=1)
    print(json.dumps(info))


if __name__ == "__main__":
    main(*sys.argv[1:4])
