"""Upper-eyelid correction: MediaPipe puts the upper-lid points on the inner edge of the eye opening (under the lashes);
the line people see is the lash line, a little higher. In near-frontal frames we look upward from each upper-lid point
for the darkest row (lash line). Over the iris the lash line and the dark iris cannot be told apart, so only the
columns over the white of the eye (both ends of the lid) are measured; the median becomes one offset per eye
(fraction of the eye width), applied to all upper-lid points with a taper towards the corners.

usage: python eyelid_offset.py <imagesDir> <prepare.json> <out.json> [--exclude holdout.txt]
       [--clean --mv mv.ply --poses frame_poses.json --sparse <colmap sparse>]   (G15 option, 2026-10-24)

--clean (G15, 2026-10-24): "offset_cols" from CLEAN frames only and aimed at the photo lash edge AFTER projection; the
previous per-column values stay as "offset_cols_all". The scalar "offset" is unchanged. A frame / eye is clean when
  - the projected triangulated eye corners (mv.ply, frame pose) lie within CLEAN_CORNER x eye width of MediaPipe's corners
    (by01 00602: 0.15 = wrong pose, lines off the eye; usual 0.01-0.03; woo03 32 / 39 frames above 0.035),
  - |pitch| <= CLEAN_PITCH (head nod changes how high the lid projects),
  - the eye is open: middle opening >= the eye's median - CLEAN_OPEN (the model has one lid; blinks / half-closed frames
    made the static lid look 0.1-0.2 too high).
Per column: median lash edge minus the median offset of the projected mv.ply point from this frame's MediaPipe point
(the target starts from mv.ply; woo03 R column 2 sat +0.135 above, seo01 L inner +0.01-0.02). Columns with fewer than
CLEAN_MIN frames are interpolated from their neighbours (before: fell back to the scalar x taper, seo01 R inner +0.034).
"""
import argparse, json, os
import numpy as np

EYE = {"R": {"up": [246, 161, 160, 159, 158, 157, 173], "lo": [7, 163, 144, 145, 153, 154, 155], "c": (33, 133)},
       "L": {"up": [466, 388, 387, 386, 385, 384, 398], "lo": [249, 390, 373, 374, 380, 381, 382], "c": (263, 362)}}
SCLERA_COLS = [0, 1, 5, 6]                      # upper-lid points away from the iris
TAPER = [0.6, 0.9, 1.0, 1.0, 1.0, 0.9, 0.6]
CLEAN_CORNER, CLEAN_PITCH, CLEAN_OPEN, CLEAN_MIN = 0.035, 10.0, 0.04, 3   # --clean frame rules (see above)


def clean_cols(rec):
    """rec: per eye list of (snap[7], bias[7], corner, pitch, open) -> (offset per column, frames used, report)"""
    out, used = {}, {}
    for S, rows in rec.items():
        if not rows: out[S] = [None] * 7; used[S] = 0; continue
        om = float(np.median([r[4] for r in rows]))
        ok = [r for r in rows if r[2] < CLEAN_CORNER and abs(r[3]) <= CLEAN_PITCH and r[4] >= om - CLEAN_OPEN]
        used[S] = len(ok); v = []
        for j in range(7):
            sn = [r[0][j] for r in ok if r[0][j] is not None]; bi = [r[1][j] for r in ok]
            v.append(float(np.clip(np.median(sn) - np.median(bi), -0.2, 0.2)) if len(sn) >= CLEAN_MIN else None)
        have = [j for j in range(7) if v[j] is not None]
        if have:                                  # empty columns: linear between neighbours, nearest at the ends
            v = [float(np.interp(j, have, [v[k] for k in have])) for j in range(7)]
        out[S] = [None if x is None else round(x, 4) for x in v]
    return out, used


def main():
    import cv2
    import face_lm
    ap = argparse.ArgumentParser()
    ap.add_argument("images"); ap.add_argument("prepare"); ap.add_argument("out"); ap.add_argument("--exclude")
    ap.add_argument("--max-yaw", type=float, default=8.0)
    ap.add_argument("--clean", action="store_true", help="G15 OPTION (2026-10-24): offset_cols from clean frames, aimed after projection (see top)")
    ap.add_argument("--mv"); ap.add_argument("--poses"); ap.add_argument("--sparse")
    a = ap.parse_args()
    pp = json.load(open(a.prepare)); yaw = {i["file"]: i["yaw"] for i in pp["images"] if i.get("yaw") is not None}
    pitch = {i["file"]: i.get("pitch") or 0.0 for i in pp["images"]}
    if a.clean:
        import meshio, pycolmap
        from frame_check import intrinsics
        mv = np.asarray(meshio.read_any(a.mv)["vertices"][:468], np.float64)
        poses = json.load(open(a.poses))["frames"]
        fc, cxc, cyc = intrinsics(list(pycolmap.Reconstruction(a.sparse).cameras.values())[0])
    rec = {S: [] for S in EYE}
    excl = set(open(a.exclude).read().split()) if a.exclude else set()
    frames = [k for k in sorted(yaw) if abs(yaw[k]) < a.max_yaw and k not in excl]
    meas = {S: [] for S in EYE}; cols = {S: [[] for _ in range(7)] for S in EYE}   # per-column lash-band edge (2026-10-21)
    for nm in frames:
        img = cv2.imread(os.path.join(a.images, nm)); H, W = img.shape[:2]
        g = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32), (3, 3), 0)
        L, _ = face_lm.landmarks(a.images, nm, img)
        if L is None: continue
        uv = np.array(L)[:, :2] * [W, H]
        if a.clean and nm in poses and poses[nm].get("status") != "dropped":
            Q = mv @ np.asarray(poses[nm]["R"]).T + np.asarray(poses[nm]["t"]); Pm = np.c_[fc * Q[:, 0] / Q[:, 2] + cxc, fc * Q[:, 1] / Q[:, 2] + cyc]
        else:
            Pm = None
        for S, e in EYE.items():
            ew = np.linalg.norm(uv[e["c"][0]] - uv[e["c"][1]]); snap7 = [None] * 7
            for j in SCLERA_COLS:
                p, q = uv[e["up"][j]], uv[e["lo"][j]]
                d = (p - q) / (np.linalg.norm(p - q) + 1e-9)
                ts = np.arange(-0.05 * ew, 0.20 * ew, 0.5)
                prof = np.array([cv2.getRectSubPix(g, (1, 1), (float(x), float(y)))[0, 0] for x, y in p + np.outer(ts, d)])
                meas[S].append(ts[int(np.argmin(prof))] / ew)
            # per upper-lid point: lash-band half-rise (darkest sample in [-0.01, 0.10] x eye width above the point, skin level
            # = median 0.03-0.08 above it, edge = first half-rise), the same detector as tools/parts_measure_v1.lid_edge_snap
            # (MediaPipe's upper-lid points sit 0.03-0.12 under the lash edge and the gap differs per column, 10/21)
            for j, u_ in enumerate(e["up"]):
                p, q = uv[u_], uv[e["lo"][j]]; d = (p - q) / (np.linalg.norm(p - q) + 1e-9)
                ds = np.linspace(-0.06, 0.16, 56); prof = np.array([cv2.getRectSubPix(g, (1, 1), (float(x), float(y)))[0, 0] for x, y in p + np.outer(ds * ew, d)])
                sm = np.convolve(prof, np.ones(3) / 3, "same"); m_ = (ds >= -0.01) & (ds <= 0.10); i0 = int(np.argmax(np.where(m_, -sm, -1e9))); dark = sm[i0]
                upm = (ds > ds[i0] + 0.03) & (ds <= ds[i0] + 0.08)
                if upm.sum() < 2: continue
                skin = float(np.median(sm[upm]))
                if skin - dark < 6: continue
                half = (dark + skin) / 2; k_ = i0
                while k_ < len(sm) - 1 and sm[k_] < half: k_ += 1
                x_ = ds[k_ - 1] + (half - sm[k_ - 1]) / (sm[k_] - sm[k_ - 1]) * (ds[k_] - ds[k_ - 1]) if (k_ > 0 and sm[k_] != sm[k_ - 1]) else ds[k_]
                if 0 <= x_ <= 0.15: cols[S][j].append(float(x_)); snap7[j] = float(x_)
            if Pm is not None:                    # --clean: frame checks + where the projected mv.ply point sits (same direction)
                bias = []
                for j, u_ in enumerate(e["up"]):
                    p, q = uv[u_], uv[e["lo"][j]]; d = (p - q) / (np.linalg.norm(p - q) + 1e-9); bias.append(float((Pm[u_] - p) @ d / ew))
                corner = float(np.linalg.norm(Pm[list(e["c"])] - uv[list(e["c"])], axis=1).mean() / ew)
                rec[S].append((snap7, bias, corner, float(pitch.get(nm, 0.0)), float(np.linalg.norm(uv[e["up"][3]] - uv[e["lo"][3]]) / ew)))
    out = {"method": "darkest lash line above MediaPipe upper-lid points, sclera columns, near-frontal frames",
           "frames": len(frames), "taper": TAPER, "offset": {}}
    for S, v in meas.items():
        v = np.array(v); v = v[v > 0]
        out["offset"][S] = round(float(np.clip(np.median(v) if len(v) else 0.0, 0, 0.10)), 4)
    out["offset_cols"] = {S: [round(float(np.median(c)), 4) if len(c) >= 3 else None for c in cols[S]] for S in EYE}
    out["offset_cols_method"] = "per upper-lid point lash-band edge (half-rise), median over frames, None when < 3 frames; used by template_fit --eyelid-cols"
    if a.clean:
        out["offset_cols_all"] = out["offset_cols"]
        out["offset_cols"], used = clean_cols(rec)
        out["clean"] = {"frames_used": used, "frames_seen": {S: len(v) for S, v in rec.items()},
                        "rules": {"corner": CLEAN_CORNER, "pitch": CLEAN_PITCH, "open_below_median": CLEAN_OPEN, "min_frames": CLEAN_MIN},
                        "bias_cols_all_frames": {S: [round(float(np.median([r[1][j] for r in v])), 4) if v else None for j in range(7)] for S, v in rec.items()}}
        out["offset_cols_method"] = ("--clean (G15 10/24): clean frames only, lash edge minus the projected mv.ply offset, empty columns "
                                     "interpolated; the unfiltered values are offset_cols_all")
    json.dump(out, open(a.out, "w"), indent=1)
    print(json.dumps(out["offset"]))


if __name__ == "__main__":
    main()
