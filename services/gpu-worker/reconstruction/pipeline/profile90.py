"""OPTION (2026-10-24, B1 S2 root cause, Mandu: "glabella / nasal bridge low"): the 90-degree PROFILE as a two-sided
observation of the face MIDLINE depth in the residual (per-vertex) stage, only where the profile is CONVEX.

Why: the midline depth (forehead .. chin) has no photo measurement in the default path - MediaPipe's 3D midline points sit
3-7 % IOD in front, the statistical shape keeps an average nose (glabella / subnasale low, mid-bridge high: chae01 / gyu01 vs
the dense multi-view surface), the SfM points are sparse there (chae01 glabella: 5) and the residual stage uses no depth (d3).
In a near-90-degree photo the face profile IS the midline. The person mask is reliable on CONVEX profile parts (forehead,
nasal bridge, nose tip, lips, chin) but fills CONCAVE ones (nasion, under the nose, philtrum, mentolabial fold: gyu01 hand
dots, 10/24) - so only convex segments get the term; the concave ones follow through the smoothness.
Earlier attempts and why this differs: --profile-sil (20-75 deg, whole face profile: far brow / cheek outlines, wrinkles),
gnm_fit --profile-fit (statistical stage: cannot express the person's nose; rows over the concave nasion / philtrum).

frames   registered, not hold-out, head yaw in [--yaw-lo, --yaw-hi] deg (from the camera pose and the landmarks' head axes)
owner    a constraint is made only where the model's most-forward vertex in that image row is a midline vertex of a convex
         segment (rows where the cheek / brow / lips of the far side form the profile are skipped)
target   photo profile = most forward person-mask pixel in the row along the face-forward image direction; the vertex moves
         along that direction by the signed gap (both ways), back-projected at its depth; gaps > --gap x eye distance skipped
"""
import json, os
import numpy as np

SEG = [("forehead", 10, 9), ("glabella", 9, 168), ("nasion", 168, 6), ("bridge", 6, 4), ("tip", 4, 1), ("columella", 1, 2),
       ("philtrum", 2, 0), ("lips", 0, 17), ("chin", 17, 152)]
MID_LM = [10, 151, 9, 8, 168, 6, 197, 195, 5, 4, 1, 19, 94, 2, 164, 0, 11, 12, 13, 14, 15, 16, 17, 18, 200, 199, 175, 152]
CONVEX = ("forehead", "bridge", "tip", "lips", "chin")


def midline_segments(X, lm_local, L468, band=0.025, segs=CONVEX):
    """local vertex ids on the midline band, in the chosen segments (nearest midline landmark)"""
    from scipy.spatial import cKDTree
    from template_fit import head_axes
    ax = head_axes(L468); iod = float(np.linalg.norm(L468[33] - L468[263]))
    Hc = (X - L468[1]) @ ax.T
    top, bot = Hc[lm_local[10], 1] + 0.05 * iod, Hc[lm_local[152], 1] - 0.05 * iod
    mid = np.where((np.abs(Hc[:, 0]) < band * iod) & (Hc[:, 1] < top) & (Hc[:, 1] > bot) & (Hc[:, 2] > -0.3 * iod))[0]
    order = {k: i for i, k in enumerate(MID_LM)}; lmk = np.array(MID_LM)
    _, jn = cKDTree(X[lm_local[lmk]]).query(X[mid]); rank = np.array([order[lmk[j]] for j in jn])
    lab = np.full(len(mid), "", object)
    for nm, s0, s1 in SEG:
        lab[(rank >= order[s0]) & (rank <= order[s1]) & (lab == "")] = nm
    keep = np.isin(lab, list(segs))
    return mid[keep], lab[keep]


def frames90(sparse, poses_json, images, L468, exclude=(), yaw_lo=80.0, yaw_hi=100.0):
    """[(name, R, t, f, cx, cy, person mask bool)] of near-profile registered frames"""
    import cv2, pycolmap
    from template_fit import head_axes
    from frame_check import load_poses
    rec = pycolmap.Reconstruction(sparse); poses = load_poses(poses_json) if poses_json else None
    ax = head_axes(L468); c = L468[[33, 263, 1]].mean(0)
    mdir = os.path.join(os.path.dirname(os.path.normpath(images)), "person_masks")
    out = []
    for im in rec.images.values():
        if im.name in exclude or (poses is not None and im.name not in poses): continue
        if poses is not None: R, t = poses[im.name]; R = np.asarray(R); t = np.asarray(t)
        else: T = im.cam_from_world(); R = T.rotation.matrix(); t = np.asarray(T.translation)
        C = -R.T @ t; d = C - c; yaw = float(np.degrees(np.arctan2(d @ ax[0], d @ ax[2])))
        if not (yaw_lo <= abs(yaw) <= yaw_hi): continue
        # SKIN classes of the multiclass segmentation (2 body skin, 3 face skin) when cached: hair (fringe) and hands are not
        # skin; else the person mask
        cm = cv2.imread(os.path.join(os.path.dirname(mdir), "class_masks_v3", im.name + ".png"), cv2.IMREAD_UNCHANGED)
        if cm is not None and cm.ndim == 2: m = np.isin(cm, (2, 3)).astype(np.uint8) * 255
        else: m = cv2.imread(os.path.join(mdir, im.name + ".png"), cv2.IMREAD_GRAYSCALE)
        if m is None: continue
        from frame_check import intrinsics
        f, cx, cy = intrinsics(rec.cameras[im.camera_id])
        out.append((im.name, R, t, f, cx, cy, m > 127, yaw))
    return out


def targets90(X, ob, mid_ids, L468, gap=0.12):
    """(local vertex ids, 3D targets, signed gaps x eye distance) for one near-profile frame"""
    name, R, t, f, cx, cy, mask, yaw = ob
    Q = X @ R.T + t; z = Q[:, 2]
    if (z[mid_ids] <= 0).any(): return np.zeros(0, int), np.zeros((0, 3)), np.zeros(0)
    uv = np.c_[f * Q[:, 0] / z + cx, f * Q[:, 1] / z + cy]
    from template_fit import head_axes
    ax = head_axes(L468); iod = float(np.linalg.norm(L468[33] - L468[263]))
    p0 = L468[1] @ R.T + t; p1 = (L468[1] + ax[2] * 0.3 * iod) @ R.T + t
    fd = np.array([f * p1[0] / p1[2] - f * p0[0] / p0[2], f * p1[1] / p1[2] - f * p0[1] / p0[2]])
    iod_px = np.linalg.norm(fd) / 0.3; fd /= np.linalg.norm(fd) + 1e-12
    if abs(fd[1]) > 0.5: return np.zeros(0, int), np.zeros((0, 3)), np.zeros(0)      # forward not along image rows (rolled)
    s_all = uv @ fd
    rows = np.round(uv[:, 1]).astype(int)
    H, W = mask.shape
    ids, T, gaps = [], [], []
    front = z < np.median(z[mid_ids]) + 0.6 * iod                       # ignore the back of the head
    for v in mid_ids:
        r = rows[v]
        if r < 0 or r >= H: continue
        same = front & (np.abs(uv[:, 1] - uv[v, 1]) < 1.0)
        if s_all[v] < s_all[same].max() - 1.0: continue                   # not the profile owner in this row
        # walk FORWARD along the row from just behind the model point: the first place the mask ends is the photo profile
        # (not the most forward mask pixel of the whole row: hands / other objects / hair in the same row)
        sx = 1.0 if fd[0] > 0 else -1.0
        x0 = int(round(uv[v, 0] - sx * 0.10 * iod_px)); xs = x0 + sx * np.arange(0, int((0.10 + gap) * iod_px) + 2)
        xs = xs[(xs >= 0) & (xs < W)].astype(int)
        if len(xs) < 3 or not mask[r, xs[0]]: continue                  # must start inside the face
        out_ = np.where(~mask[r, xs])[0]
        if not len(out_): continue
        xe = xs[out_[0]] - sx * 0.5                                      # last inside pixel edge
        g = float((xe - uv[v, 0]) * sx * abs(fd[0]))                     # + = photo profile in front of the model
        if abs(g) > gap * iod_px: continue
        tgt_uv = uv[v] + g * fd
        ray = np.array([(tgt_uv[0] - cx) / f, (tgt_uv[1] - cy) / f, 1.0]) * z[v]
        ids.append(v); T.append((ray - t) @ R); gaps.append(g / iod_px)
    return np.array(ids, int), np.array(T).reshape(-1, 3), np.array(gaps)
