"""Shared MediaPipe reliability flags (2026-10-24).

FALSE FACES inside a profile stretch: with the head at 85-90 deg MediaPipe sometimes "finds" a near-frontal face (gyu01
k 307 / 317 / 330 / 339: yaw -6..12, pitch -17..-50 while no face is found in the frames around them). Such a detection
broke the profile-angle estimate of the frame selection, and its yaw makes the lens-stage rotation check fail a correct
SfM (gyu01 best-cut: direction agreement -0.64 on a straight reconstruction).

Rule (any person, one value set): a detection read as near-frontal (|yaw| < 35) whose neighbours (+-8 frames in time
order) are mostly faceless (> 60 %) is a false face. Real frontal frames have faces around them.
"""
import numpy as np

FRONTAL_MAX = 35.0
NEIGHBOURS = 8
FACELESS_SHARE = 0.6


def false_faces(rows):
    """rows: list of dicts with 'k' (frame number), 'face' (bool) and 'yaw' (float or None), ONE video.
    Returns the set of k flagged as false faces."""
    sv = sorted(rows, key=lambda r: r["k"]); out = set()
    for i, f in enumerate(sv):
        if not f.get("face") or f.get("yaw") is None or abs(f["yaw"]) >= FRONTAL_MAX: continue
        nb = sv[max(0, i - NEIGHBOURS):i] + sv[i + 1:i + 1 + NEIGHBOURS]
        if nb and sum(1 for t in nb if not t.get("face")) / len(nb) > FACELESS_SHARE: out.add(f["k"])
    return out


def prepare_flags(prep):
    """{file: True} for false faces of a prepare.json dict: the stored flag when the frame selection wrote one, else the
    rule on the kept frames (per video, in frame order)."""
    import re
    ims = prep.get("images", [])
    if any("false_face" in i for i in ims):
        return {i["file"]: bool(i.get("false_face")) for i in ims}
    by_v = {}
    for i in ims:
        m = re.match(r"v(\d+)_.*_(\d{5})\.jpg$", i["file"])
        if not m: continue
        by_v.setdefault(m.group(1), []).append({"k": int(m.group(2)), "face": bool(i.get("face")), "yaw": i.get("yaw"), "file": i["file"]})
    flags = {}
    for rows in by_v.values():
        ff = false_faces(rows)
        for r in rows: flags[r["file"]] = r["k"] in ff
    return flags
