"""Dense multi-view stereo points of the head (COLMAP, CUDA) -> <work>/colmap/dense/fused.ply

Why (woo01 2026-10-16): the nose wings, nostril rims and columella have only a few of the 468 landmarks, so the
template nose stays where the template has it and the photo nose is "pasted" onto it (cross-view brightness
disagreement around the nose wings 2-2.5x the cheek's, same colour = edges landing in different places per view).
Dense stereo measures that surface directly; template_fit uses it for the NOSE only (--dense-region nose), the rest of
the face keeps the smooth landmark fit (dense everywhere made the face bumpy before).

Steps: image_undistorter (max side 1200 px) -> patch_match_stereo (geometric consistency) -> stereo_fusion.
Needs the CUDA COLMAP binary (runtime.local.json "colmap" or .tools/colmap/COLMAP.bat); without it: exit 3, the
pipeline continues without dense points.
usage: python dense_mvs.py <work> <sparse> [--max-size 1200] [--every 1]
"""
import argparse, json, os, shutil, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)


def main():
    from sfm_sparse import find_colmap
    import subprocess
    ap = argparse.ArgumentParser()
    ap.add_argument("work"); ap.add_argument("sparse"); ap.add_argument("--max-size", type=int, default=1200)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    colmap = find_colmap()
    out = os.path.join(a.work, "colmap", "dense"); fused = os.path.join(out, "fused.ply")
    if os.path.exists(fused) and not a.force:
        print(json.dumps({"status": "cached", "fused": fused})); return
    if not colmap:
        print(json.dumps({"status": "no-colmap", "note": "dense stereo needs the CUDA COLMAP binary"})); sys.exit(3)
    if os.path.isdir(out): shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out, exist_ok=True)
    images = os.path.join(a.work, "prep", "images")
    T = {}
    def run(cmd, args):
        t0 = time.time()
        r = subprocess.run([colmap, cmd] + args, capture_output=True, text=True)
        T[cmd] = round(time.time() - t0, 1)
        if r.returncode != 0:
            print(r.stdout[-1500:], r.stderr[-1500:], file=sys.stderr)
            print(json.dumps({"status": "failed", "step": cmd, "sec": T})); sys.exit(2)
    run("image_undistorter", ["--image_path", images, "--input_path", a.sparse, "--output_path", out,
                              "--output_type", "COLMAP", "--max_image_size", str(a.max_size)])
    run("patch_match_stereo", ["--workspace_path", out, "--workspace_format", "COLMAP",
                               "--PatchMatchStereo.geom_consistency", "true", "--PatchMatchStereo.max_image_size", str(a.max_size)])
    run("stereo_fusion", ["--workspace_path", out, "--workspace_format", "COLMAP", "--input_type", "geometric",
                          "--output_path", fused])
    n = 0
    try:
        with open(fused, "rb") as fh:
            for line in fh:
                if line.startswith(b"element vertex"): n = int(line.split()[-1]); break
    except Exception:
        pass
    print(json.dumps({"status": "ok", "fused": fused, "points": n, "sec": T}))


if __name__ == "__main__":
    main()
