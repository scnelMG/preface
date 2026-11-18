"""MediaPipe-seeded nose landmarks (pitch robustness).

The profile-based landmark search in canonical.py finds nasion/subnasale as extrema of the midline profile. Those
extrema move when the head pitch is off by ~10 deg (tested: D jumped 1.00 -> 1.41 at -10 deg, 0.80 at +15 deg).
Real scans get their pitch from MediaPipe head pose (auto_orient) or from a phone, which can differ from anatomy by
that much. Here we render the current canonical FRONT view, run Face Landmarker, and back-project a few landmarks
through the depth buffer. Only their HEIGHTS (y) are used, as search windows for the geometric profile search, so
the final points still lie on the mesh profile and keep their geometric definitions.

MediaPipe face-mesh indices used: 1 nose tip, 2 subnasale (columella base), 168 nasion region, 6 upper dorsum,
9 glabella (upper bound of the nasion search).
"""
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
TASK = os.path.join(HERE, "..", "assets", "face_landmarker.task")
_DET = None


def detector():
    global _DET
    if _DET is None:
        import auto_orient
        _DET = auto_orient.Detector(TASK)
    return _DET


def seeds(p, f, col, tip, D, size=640):
    """p: vertices in the current canonical frame (+x right, +y up, +z toward viewer). Returns dict of absolute
    y values {'prn','sn','n'} or None when no face is detected."""
    import render
    try:
        det = detector()
    except Exception:
        return None
    center = np.array([tip[0], tip[1] - 0.3 * D, tip[2]])
    extent = 2.4 * D
    near = np.linalg.norm(p - center, axis=1) < 4.0 * D  # skip far geometry (room, shoulders)
    keep = near[f].all(1)
    if keep.sum() < 100:
        return None
    img, zb, _ = render.render(p, f[keep], np.eye(3), size, colors=col, center=center, extent=extent,
                               light=(0.2, 0.3, 1.0), return_depth=True)
    lm, _ = det(img)
    if lm is None:
        return None
    s = size / (2 * extent)
    out = {}
    for name, i in (("prn", 1), ("sn", 2), ("n", 168), ("dorsum", 6), ("g", 9)):
        px, py = lm[i] * size
        out[name] = center[1] + (size / 2 - py) / s
        out[name + "_x"] = center[0] + (px - size / 2) / s
    # sanity: order along y must be nasion > dorsum > tip > subnasale
    if not (out["g"] > out["n"] > out["dorsum"] > out["prn"] > out["sn"]):
        return None
    return out
