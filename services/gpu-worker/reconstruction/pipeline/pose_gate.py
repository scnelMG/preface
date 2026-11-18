"""Lens-stage FOLD check that does not trust MediaPipe where it is weak (2026-10-24, OPTION run_all --lens-gate-reliable).

The rotation check compares SfM with MediaPipe yaw. Beyond ~60 deg MediaPipe reads the turn too small or finds no face,
so on those frames the comparison judged straight reconstructions as bad, and restricting it to |yaw| <= 45 made it blind
to folds that happen in the profiles (eun03 / seo01 with the old masks folded beyond 45 deg and then passed).

Here every frame gets an EXPECTED angle: MediaPipe yaw where a (non-false) face is found, else the time interpolation
used by the frame selection (the head rises to 90 deg in the middle of a no-face stretch between two frames turned
>= 35 deg to one side; one-sided at the start / end of the video). The SfM angle of each frame = its camera position on the
orbit around the head (zero / sign aligned to MediaPipe on faced frames). A fold = side frames (|expected| > 45 deg)
registered more than 30 deg away from their expected angle.
Measured 10/24: folded runs (old masks) woo03-ang 58 %, eun03 95 %, seo01 100 % of the side frames; 15 straight runs 0-5 %.
"""
import json, re
import numpy as np


def expected_angles(prep):
    """{file: expected yaw (deg)} from a prepare.json dict (angle selection: its own estimate)."""
    import face_flags
    ims = prep.get("images", []); ff = face_flags.prepare_flags(prep)
    out, by_v = {}, {}
    for i in ims:
        e = i.get("extra") or ""
        if e.startswith("angle:"): out[i["file"]] = float(e[6:].split(",")[0]); continue
        m = re.match(r"v(\d+)_.*_(\d{5})\.jpg$", i["file"])
        if m: by_v.setdefault(m.group(1), []).append((int(m.group(2)), i))
    for rows in by_v.values():
        rows.sort(key=lambda r: r[0])
        faced = [(k, i["yaw"]) for k, i in rows if i.get("yaw") is not None and not ff.get(i["file"])]
        for k, i in rows:
            if i.get("yaw") is not None and not ff.get(i["file"]): out[i["file"]] = float(i["yaw"]); continue
            prev = [f for f in faced if f[0] < k][-1:]; nxt = [f for f in faced if f[0] > k][:1]
            if prev and nxt and np.sign(prev[0][1]) == np.sign(nxt[0][1]) and min(abs(prev[0][1]), abs(nxt[0][1])) >= 35:
                tau = (k - prev[0][0]) / max(1, nxt[0][0] - prev[0][0]); m0 = abs(prev[0][1]) if tau <= 0.5 else abs(nxt[0][1])
                out[i["file"]] = float(np.sign(prev[0][1]) * (m0 + (90 - min(m0, 90)) * np.sin(np.pi * tau)))
            elif bool(prev) != bool(nxt) and abs((prev or nxt)[0][1]) >= 35:
                f0 = (prev or nxt)[0]; ends = [kk for kk, ii in rows if (ii.get("yaw") is None or ff.get(ii["file"])) and (kk > f0[0] if prev else kk < f0[0])]
                D = max(1, (max(ends) - f0[0]) if prev else (f0[0] - min(ends))) if ends else 1; m0 = abs(f0[1])
                out[i["file"]] = float(np.sign(f0[1]) * (m0 + (90 - m0) * np.sin(0.5 * np.pi * min(1.0, abs(k - f0[0]) / D))))
    return out


def fold_check(sparse, prep, side=45.0, off=30.0):
    """-> {side_frames, side_off_share, all_off_share} for the reconstruction in `sparse`"""
    import pycolmap
    exp = expected_angles(prep); mp = {i["file"]: i.get("yaw") for i in prep.get("images", [])}
    rec = pycolmap.Reconstruction(sparse)
    names = [im.name for im in rec.images.values()]
    X = np.array([np.asarray(im.projection_center()) for im in rec.images.values()])
    ctr = np.median(np.array([p.xyz for p in rec.points3D.values()]), 0); X = X - ctr
    _, _, Vt = np.linalg.svd(X - X.mean(0)); th = np.degrees(np.arctan2(X @ Vt[1], X @ Vt[0]))
    front = [j for j, n in enumerate(names) if mp.get(n) is not None and abs(mp[n]) < 5]
    th0 = np.degrees(np.angle(np.mean(np.exp(1j * np.radians(th[front]))))) if front else 0.0
    th = (th - th0 + 180) % 360 - 180
    faced = [j for j, n in enumerate(names) if mp.get(n) is not None]
    if len(faced) > 3 and np.corrcoef(th[faced], [mp[names[j]] for j in faced])[0, 1] < 0: th = -th
    d = np.array([abs(th[j] - exp[n]) for j, n in enumerate(names) if n in exp])
    s = np.array([abs(exp[n]) > side for n in names if n in exp])
    return {"frames": int(len(d)), "side_frames": int(s.sum()), "side_off_share": round(float((d[s] > off).mean()), 3) if s.any() else None,
            "all_off_share": round(float((d > off).mean()), 3) if len(d) else None}
