"""Frame cameras in head.glb coordinates, for the photo overlay of the glb viewer (web/glb, W13, 2026-10-20).

usage: python tools/glb_frames.py work/<id> [--sparse <model>]   ->  work/<id>/model/frames.json

  camera   intrinsics of the lens-checked COLMAP model {w, h, f, cx, cy} (pixels of prep/images)
  frames   every kept frame (frame_poses.json, "dropped" left out): name, R, t (glb frame: x_cam = R X_glb + t, COLMAP
           camera axes x right / y down / z forward, t in glb metres), status, holdout, MediaPipe yaw, hold-out error %
The glb frame is the export's similarity world_to_glb (X_glb = s Rh (X - c)); since a projection does not change
when the camera frame is scaled, R' = R Rh^T and t' = s (R c + t). PERSONAL DATA: the file only holds camera numbers,
the photos stay in work/<id>/prep/images and are served by server.mjs on this PC only.
"""
import argparse, hashlib, json, os, struct, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "pipeline"))


def glb_extras(path):
    with open(path, "rb") as fh:
        head = fh.read(20)
        if struct.unpack("<I", head[:4])[0] != 0x46546C67: raise SystemExit(f"not a glb: {path}")
        jl = struct.unpack("<I", head[12:16])[0]
        return json.loads(fh.read(jl))["asset"]["extras"]["live-mirror"]


def main():
    import pycolmap
    from frame_check import intrinsics
    ap = argparse.ArgumentParser(); ap.add_argument("work"); ap.add_argument("--sparse", help="default: lens_anchor.json 'sparse'")
    ap.add_argument("--out")
    a = ap.parse_args()
    W = a.work; M = os.path.join(W, "model")
    sparse = a.sparse or json.load(open(os.path.join(W, "lens_anchor.json")))["sparse"]
    exported = glb_extras(os.path.join(M, "head.glb"))
    T = np.asarray(exported["world_to_glb"], np.float64)
    A, b = T[:3, :3], T[:3, 3]; s = float(np.linalg.norm(A[0])); Rh = A / s; c = -Rh.T @ b / s
    if abs(np.linalg.det(Rh) - 1) > 1e-4: raise SystemExit(f"world_to_glb is not a rotation + scale (det {np.linalg.det(Rh):.4f})")
    cam = list(pycolmap.Reconstruction(sparse).cameras.values())[0]
    f, cx, cy = intrinsics(cam)[:3]
    rep = json.load(open(os.path.join(M, "report.json"), encoding="utf-8")); ch = rep.get("chosen", "gnm")
    actual = hashlib.sha1(open(os.path.join(M, f"fit_{ch}.ply"), "rb").read()).hexdigest()[:12]
    if exported.get("chosen_fit") != ch or exported.get("fit_sha") != actual or (rep.get("provenance") or {}).get("fit_sha") not in (None, actual):
        raise SystemExit("head.glb / report final fit mismatch; export the final mesh before cameras")
    evp = os.path.join(M, f"eval_{ch}.json")
    final = rep.get("final_validation") or {}
    pose_sha = hashlib.sha1(open(os.path.join(M, "frame_poses.json"), "rb").read()).hexdigest()[:12]
    hold_sha = hashlib.sha1(open(os.path.join(M, "holdout.txt"), "rb").read()).hexdigest()[:12]
    if final.get("fit_sha") == actual and final.get("poses_sha") == pose_sha and final.get("holdout_sha") == hold_sha:
        candidate = os.path.join(M, os.path.basename(final.get("eval", "")))
        if os.path.isfile(candidate): evp = candidate
    ev = json.load(open(evp, encoding="utf-8"))["frames"] if os.path.exists(evp) else {}
    hp = os.path.join(M, "holdout.txt"); hold = set(open(hp).read().split()) if os.path.exists(hp) else set()
    poses = json.load(open(os.path.join(M, "frame_poses.json")))["frames"]
    frames = []
    for name in sorted(poses):
        p = poses[name]
        if p["status"] == "dropped": continue
        R = np.asarray(p["R"], np.float64); t = np.asarray(p["t"], np.float64); e = ev.get(name, {})
        frames.append({"name": name, "R": np.round(R @ Rh.T, 8).tolist(), "t": np.round(s * (R @ c + t), 8).tolist(),
                       "status": p["status"], "holdout": name in hold, "yaw": round(e.get("yaw", p.get("yaw", 0.0)), 1),
                       "err_pct": round(e["err_px"] / e["iod_px"] * 100, 2) if "err_px" in e and "iod_px" in e else None})
    out = a.out or os.path.join(M, "frames.json")
    json.dump({"id": os.path.basename(os.path.normpath(W)), "chosen_fit": ch, "fit_sha": exported["fit_sha"], "evaluation": os.path.basename(evp),
               "world_to_glb": exported["world_to_glb"], "camera": {"w": cam.width, "h": cam.height, "f": float(f), "cx": float(cx), "cy": float(cy)},
               "frames": frames}, open(out, "w"), indent=0)
    print(json.dumps({"out": out, "frames": len(frames), "camera": [cam.width, cam.height, round(float(f), 1)]}))


if __name__ == "__main__":
    main()
