"""How far did the head really turn? Per-frame view angle relative to the FITTED head (2026-10-19).

MediaPipe yaw (prepare.json) exists only where a face was found, i.e. up to ~60-70 deg; the profile frames that carry
the side outline have none. Here every registered frame gets an angle from its camera pose and the fitted head:
  yaw   = angle between the head's forward axis and the direction to the camera, in the head's horizontal plane
  pitch = elevation of the camera above / below the head's horizontal plane
The sign follows MediaPipe's yaw where both exist (checked by correlation), so the numbers read like prepare.json.

usage: python view_coverage.py <model dir>  [--fit fit_gnm]    -> <model dir>/view_coverage.json
"""
import argparse, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)


def head_axes(L):
    x = L[454] - L[234]; x /= np.linalg.norm(x)
    up = L[10] - L[152]; up -= x * (up @ x); up /= np.linalg.norm(up)
    fw = np.cross(x, up)
    c = (L[234] + L[454]) / 2
    if (L[1] - c) @ fw < 0: fw = -fw
    return c, x, up, fw


def coverage(model_dir, fit=None):
    import meshio
    rep = json.load(open(os.path.join(model_dir, "report.json")))
    fit = fit or f"fit_{rep.get('chosen', 'lm')}"
    V = np.asarray(meshio.read_any(os.path.join(model_dir, fit + ".ply"))["vertices"], np.float64)
    lid = np.array(json.load(open(os.path.join(model_dir, fit + ".fit.json")))["landmark_vertex_ids"])
    c, x, up, fw = head_axes(V[lid])
    fp = json.load(open(os.path.join(model_dir, "frame_poses.json")))["frames"]
    prep = os.path.join(os.path.dirname(os.path.normpath(model_dir)), "prep", "prepare.json")
    mp_yaw = {}
    if os.path.exists(prep):
        mp_yaw = {i["file"]: i["yaw"] for i in json.load(open(prep)).get("images", []) if i.get("yaw") is not None}
    rows = {}
    for n, r in fp.items():
        if r.get("status") == "dropped": continue
        R = np.asarray(r["R"]); t = np.asarray(r["t"]); cc = -R.T @ t
        d = cc - c; d /= np.linalg.norm(d)
        yaw = float(np.degrees(np.arctan2(d @ x, d @ fw)))
        pitch = float(np.degrees(np.arcsin(np.clip(d @ up, -1, 1))))
        rows[n] = [yaw, pitch]
    both = [(rows[n][0], mp_yaw[n]) for n in rows if n in mp_yaw]
    sign = 1.0
    if len(both) >= 5:
        a = np.array(both)
        if np.corrcoef(a[:, 0], a[:, 1])[0, 1] < 0: sign = -1.0
    for n in rows: rows[n][0] *= sign
    y = np.array([v[0] for v in rows.values()]) if rows else np.zeros(0)
    agree = None
    if len(both) >= 5:
        a = np.array([(rows[n][0], mp_yaw[n]) for n in rows if n in mp_yaw])
        agree = round(float(np.median(np.abs(a[:, 0] - a[:, 1]))), 1)
    # per side (2026-10-19, eun03): SfM turned much LESS than MediaPipe on one side = the camera poses of that side are
    # wrong (the solver stopped the left turn at about -20 deg while MediaPipe saw -37 .. -75). Median of
    # |SfM yaw| - |MediaPipe yaw| over the frames turned at least 35 deg to that side (MediaPipe sign)
    side = {}
    for nm, sg in (("neg", -1), ("pos", 1)):
        d = [abs(rows[n][0]) - abs(mp_yaw[n]) for n in rows if n in mp_yaw and sg * mp_yaw[n] >= 35]
        side[nm] = {"frames": len(d), "median_deg": round(float(np.median(d)), 1) if d else None}
    out = {
        "fit": fit, "frames": len(rows), "side_turn_vs_mediapipe": side,
        "yaw_min_deg": round(float(y.min()), 1) if len(y) else None,
        "yaw_max_deg": round(float(y.max()), 1) if len(y) else None,
        "frames_beyond_60": {"neg": int((y <= -60).sum()), "pos": int((y >= 60).sum())},
        "frames_beyond_75": {"neg": int((y <= -75).sum()), "pos": int((y >= 75).sum())},
        "frames_without_face": int(sum(1 for n in rows if n not in mp_yaw)),
        "median_diff_vs_mediapipe_deg": agree,
        "profile_ok": bool(len(y) and (y <= -75).sum() >= 3 and (y >= 75).sum() >= 3),
        "per_frame": {n: [round(v[0], 1), round(v[1], 1)] for n, v in sorted(rows.items())},
    }
    json.dump(out, open(os.path.join(model_dir, "view_coverage.json"), "w"), indent=1)
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("model_dir"); ap.add_argument("--fit")
    a = ap.parse_args()
    r = coverage(a.model_dir, a.fit)
    print(json.dumps({k: v for k, v in r.items() if k != "per_frame"}, ensure_ascii=False))
