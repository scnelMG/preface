"""Lens anchoring for head-turn captures (fixed camera, the person turns the head).

Problem (seen on p01-s1, 10/14): with a fixed camera and a mostly one-axis head turn, structure-from-motion cannot tell
"wide lens + small head rotation + flat face" from "normal lens + true rotation + true depth" - all fit the images
equally well (reprojection ~1.3-1.4 px for f = 713 ... 1800 px). A wrong lens flattens or inflates the face.

Fix: MediaPipe measures the head yaw in every frame independently (fitting its metric canonical face). For each candidate
focal length we re-run the mapper on the existing feature matches with the lens FIXED and compare the SfM head rotation
(relative to the most frontal frame) with the MediaPipe yaw difference. The focal length where the slope is 1 is taken.
p01-s1: slope 0.34 @713, 0.50 @1200, 1.04 @1700, 1.14 @1800 -> 1700 px; landmarks then triangulate at 2.2 px median.

usage: python lens_anchor.py <workDir>  [--lo 600 --hi 3000 --iters 5]
  reads <workDir>/colmap/database.db (features/matches from any earlier COLMAP run) and <workDir>/prep/prepare.json
  writes <workDir>/colmap/sparse_lens_anchored/ (best model) and <workDir>/lens_anchor.json (all trials)
CPU only (pycolmap); each trial is one mapper run on the existing matches (about 1-2 min for ~80 frames).
"""
import argparse
import time
import json
import os
import shutil
import sqlite3
import sys

import numpy as np


CFG_V = 3   # mapper settings version: cached trials of older settings are recomputed


def slope_for(work, f, cx, cy, images, yaw, keep_dir, threads=-1, n_ref=None):
    import pycolmap
    out = os.path.join(work, "colmap", f"_lens_f{int(f)}")
    # resumable: a finished trial (result.json + best/) is reused when the run is restarted
    prev = json.load(open(os.path.join(out, "result.json"))) if os.path.exists(os.path.join(out, "result.json")) else {}
    if prev.get("v") == CFG_V and prev.get("threads", -1) == threads:
        res = json.load(open(os.path.join(out, "result.json")))
        return res, ((pycolmap.Reconstruction(os.path.join(out, "best")), out) if res.get("registered") else None)
    shutil.rmtree(out, ignore_errors=True); os.makedirs(out, exist_ok=True)
    # SQLite on a local temp disk (synced / mounted work folders can fail with "disk I/O error"). The copy is removed after
    # the trial (S15P31B204-448: one lm_lens_* per trial was left in /tmp)
    import tempfile
    tmp = tempfile.mkdtemp(prefix="lm_lens_")
    try:
        db = os.path.join(tmp, "db.db"); shutil.copy(os.path.join(work, "colmap", "database.db"), db)
        return map_trial(db, out, f, cx, cy, images, yaw, threads, n_ref)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def map_trial(db, out, f, cx, cy, images, yaw, threads, n_ref):
    """one focal-length trial on a private copy of the database: fix f, map with up to 5 seeds, keep the best model"""
    import pycolmap
    con = sqlite3.connect(db)
    model = con.execute("select model from cameras limit 1").fetchone()[0]
    # SIMPLE_RADIAL (2): f, cx, cy, k ; SIMPLE_PINHOLE (0): f, cx, cy ; others: keep model, set fx=fy=f
    params = {0: [f, cx, cy], 2: [f, cx, cy, 0.0]}.get(model, None)
    if params is None:
        con.execute("update cameras set model=2"); params = [f, cx, cy, 0.0]
    con.execute("update cameras set params=?, prior_focal_length=1", (np.array(params, np.float64).tobytes(),))
    con.commit(); con.close()
    def signed_slope(rec):
        """head-turn direction check. Face-only (nearly affine) views have a DEPTH-REVERSAL ambiguity: a hollow,
        inside-out face explains the images equally well (seen on the PC, 2026-10-15: concave face, holdout side 8 %).
        In the reversed solution the cameras turn the other way, so the signed SfM yaw runs against MediaPipe's yaw.
        Correct reconstructions of p01-s1: -0.98 (reference) / -1.16; reversed: +1.28."""
        ims = {i.name: i for i in rec.images.values() if i.name in yaw}
        if len(ims) < 5: return 0.0, 0.0, 0.0, 0.0
        front = min(ims, key=lambda n: abs(yaw[n])); R0 = ims[front].cam_from_world().rotation.matrix()
        sa, ab = [], []
        for n, im in ims.items():
            Rr = im.cam_from_world().rotation.matrix() @ R0.T
            sa.append((yaw[n] - yaw[front], np.degrees(np.arctan2(Rr[0, 2], Rr[2, 2]))))
            ab.append((abs(yaw[n] - yaw[front]), np.degrees(np.arccos(np.clip((np.trace(Rr) - 1) / 2, -1, 1)))))
        sa, ab = np.array(sa), np.array(ab)
        ks = float(np.sum(sa[:, 0] * sa[:, 1]) / max(np.sum(sa[:, 0] ** 2), 1e-9))
        k = float(np.sum(ab[:, 0] * ab[:, 1]) / max(np.sum(ab[:, 0] ** 2), 1e-9))
        return ks, k, float(ab[:, 1].max()), float(ab[:, 0].max())
    best, tried, flipped, seed_reg = None, 0, 0, []
    for seed in range(5):   # retry with another seed if the only full solution is the depth-reversed one
        po = pycolmap.IncrementalPipelineOptions()
        po.ba_refine_focal_length = False; po.ba_refine_extra_params = False; po.ba_refine_principal_point = False
        # face-only (masked) webcam frames: ~150-200 features per frame, pairs with ~40-60 inliers. With the default
        # thresholds the reconstruction split into several models (54/76 registered); relaxed + fixed seed = one model
        po.min_num_matches = 10; po.random_seed = seed
        # --map-threads 1 (W-det option, 2026-10-20): the seed alone does not make the mapper repeatable - with all
        # cores the same database gave slope 1.273 / 1.266 (eun02-r2, rotations up to 0.76 deg apart)
        po.num_threads = threads
        po.mapper.init_min_num_inliers = 30; po.mapper.abs_pose_min_num_inliers = 15; po.mapper.abs_pose_min_inlier_ratio = 0.15
        sub = os.path.join(out, f"sparse_s{seed}"); os.makedirs(sub, exist_ok=True)
        recs = pycolmap.incremental_mapping(db, images, sub, options=po); tried += 1
        good = []
        seed_reg.append(max([r.num_reg_images() for r in (recs or {}).values()] or [0]))
        for r in (recs or {}).values():
            ss = signed_slope(r)
            if ss[0] < 0: good.append((r, ss))
            else: flipped += 1
        if good:
            cand = max(good, key=lambda t: t[0].num_reg_images())
            if best is None or cand[0].num_reg_images() > best[0].num_reg_images(): best = cand
            if best[0].num_reg_images() >= 0.8 * (n_ref or len(yaw)): break
    if best is None:
        json.dump({"f": f, "registered": 0, "v": CFG_V, "threads": threads, "depth_reversed_rejected": flipped}, open(os.path.join(out, "result.json"), "w"))
        return {"f": f, "registered": 0, "depth_reversed_rejected": flipped}, None
    best, (ks, k, mx_s, mx_m) = best
    res = {"f": f, "registered": best.num_reg_images(), "reproj_px": round(best.compute_mean_reprojection_error(), 3),
           "slope_sfm_vs_mediapipe": round(k, 3), "signed_slope": round(ks, 3), "max_sfm_deg": round(mx_s, 1),
           "max_mediapipe_deg": round(mx_m, 1), "mapping_runs": tried, "depth_reversed_rejected": flipped, "seed_registered": seed_reg}
    os.makedirs(os.path.join(out, "best"), exist_ok=True); best.write(os.path.join(out, "best"))
    json.dump({**res, "v": CFG_V, "threads": threads}, open(os.path.join(out, "result.json"), "w"))
    return res, (best, out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("work"); ap.add_argument("--lo", type=float, default=600); ap.add_argument("--hi", type=float, default=3000)
    ap.add_argument("--iters", type=int, default=5)
    ap.add_argument("--map-threads", type=int, default=-1, help="mapper threads (-1 = all cores, default). 1 = repeatable "
                    "result for the same database (the multi-threaded mapper differs run to run even with a fixed seed)")
    ap.add_argument("--yaw-max", type=float, default=0, help="OPTION: rotation check only on frames with |MediaPipe yaw| <= this (0 = all)")
    ap.add_argument("--pitch-max", type=float, default=0, help="OPTION: rotation check only on frames with |MediaPipe pitch| <= this (0 = all)")
    ap.add_argument("--skip-false-faces", action="store_true", help="OPTION: leave MediaPipe false faces (pipeline/face_flags.py) out of the rotation check")
    a = ap.parse_args()
    prep = json.load(open(os.path.join(a.work, "prep", "prepare.json")))
    yaw = {i["file"]: i["yaw"] for i in prep["images"] if i.get("yaw") is not None}
    n_ref = len(yaw)                          # registration thresholds always count every frame with a face
    gate = {}
    if a.yaw_max > 0 or a.pitch_max > 0 or a.skip_false_faces:
        # OPTION (2026-10-24, run_all --lens-gate-reliable): the rotation / direction check compares SfM with MediaPipe
        # only where MediaPipe is reliable: |yaw| <= --yaw-max and no false face. Beyond ~60 deg MediaPipe reads the turn
        # too small or finds a false frontal face, so a correct, straight SfM looked "folded" (gyu01 best-cut -0.64)
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "pipeline"))
        from face_flags import prepare_flags
        ff = prepare_flags(prep) if a.skip_false_faces else {}
        pit = {i["file"]: i.get("pitch") for i in prep["images"]}
        # large up / down turns distort the yaw read from the camera rotation (best-cut sets with chin-up frames) -> --pitch-max
        keep_ = {n: y for n, y in yaw.items() if not ff.get(n) and (a.yaw_max <= 0 or abs(y) <= a.yaw_max)
                 and (a.pitch_max <= 0 or abs(pit.get(n) or 0) <= a.pitch_max)}
        gate = {"yaw_max": a.yaw_max, "pitch_max": a.pitch_max, "false_faces": int(sum(bool(v) for v in ff.values())), "frames_all": n_ref, "frames_used": len(keep_)}
        if len(keep_) >= 10: yaw = keep_
        else: gate["fallback"] = "too few reliable frames, all used"
    images = os.path.join(a.work, "prep", "images")
    w, h = [int(x) for x in list(prep["image_sizes"].keys())[0].split("x")]
    trials, keep = [], {}
    lo, hi = a.lo, a.hi
    # bisection on slope = 1 (slope grows with f)
    for it in range(a.iters):
        f = round(np.sqrt(lo * hi))  # geometric midpoint
        t0 = time.time(); res, mk = slope_for(a.work, f, w / 2, h / 2, images, yaw, keep, a.map_threads, n_ref)
        res.setdefault("sec", round(time.time() - t0, 1))
        trials.append(res); print(json.dumps(res), flush=True)
        if mk: keep[f] = mk
        s = res.get("slope_sfm_vs_mediapipe")
        if s is None or res["registered"] < 0.6 * n_ref:
            lo = f; continue  # unstable: move up
        if s < 1: lo = f
        else: hi = f
    ok = [t for t in trials if t.get("slope_sfm_vs_mediapipe") and t["registered"] >= 0.8 * n_ref]
    if not ok:
        print(json.dumps({"status": "failed", "trials": trials})); sys.exit(2)
    best = min(ok, key=lambda t: abs(t["slope_sfm_vs_mediapipe"] - 1))
    rec, out = keep[best["f"]]
    dst = os.path.join(a.work, "colmap", "sparse_lens_anchored"); shutil.rmtree(dst, ignore_errors=True); os.makedirs(dst, exist_ok=True)
    rec.write(dst)
    for f in keep:
        shutil.rmtree(os.path.join(a.work, "colmap", f"_lens_f{int(f)}"), ignore_errors=True)
    rep = {"status": "ok" if abs(best["slope_sfm_vs_mediapipe"] - 1) < 0.15 else "uncertain", "chosen": best, "trials": trials,
           "sparse": dst, "map_threads": a.map_threads, **({"gate_frames": gate} if gate else {}), "fov_h_deg": round(float(2 * np.degrees(np.arctan(w / 2 / best["f"]))), 1)}
    json.dump(rep, open(os.path.join(a.work, "lens_anchor.json"), "w"), indent=1)
    print(json.dumps({k: rep[k] for k in ("status", "chosen", "fov_h_deg", "sparse")}))


if __name__ == "__main__":
    # S15P31B204-403: pycolmap / COLMAP libraries now and then crash while Python tears them down (exit -11 AFTER the
    # results are written: "features ok" / "matches ok" printed, then a segfault), and run_all then drops the finished
    # stage. Every result file is written and closed by now, so leave with the script's own exit code, skipping the teardown.
    try:
        main(); code = 0
    except SystemExit as e:
        if isinstance(e.code, str): print(e.code, file=sys.stderr)
        code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    sys.stdout.flush(); sys.stderr.flush()
    os._exit(code)
