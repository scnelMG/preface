"""Sparse structure-from-motion on the prepared frames (CPU, pycolmap): features -> matching -> incremental mapping.
Enough for the scan_to_model pipeline (it needs camera poses only; no dense MVS / GPU).

Writes <work>/colmap/database.db and <work>/colmap/sparse/0. Resumable: finished stages are skipped.
Face masks are used when prepare_capture.py found a FIXED camera (person turning the head: the static background would
otherwise pull the poses); with a moving camera (recommended capture) the background helps and is kept.
usage: python sfm_sparse.py <work> [--matcher exhaustive|sequential] [--force]
"""
import argparse, json, os, shutil, sys, time

TMP = None   # local temp folder of the SQLite database (main), removed when the script ends


def main():
    import pycolmap
    ap = argparse.ArgumentParser()
    ap.add_argument("work"); ap.add_argument("--matcher", default="auto"); ap.add_argument("--force", action="store_true")
    ap.add_argument("--full-frame", action="store_true", help="old behaviour: prepare_capture's face masks or none")
    ap.add_argument("--keep-mask-background", action="store_true", help="old behaviour (before 2026-10-24): head masks "
                    "without the person-segmentation cut (background inside the enlarged head outline stays)")
    ap.add_argument("--threads", type=int, default=min(8, os.cpu_count() or 4),
                    help="feature extraction and matching threads (20 CPU-SIFT threads on 1080x1920 frames crashed on the PC: "
                    "0xC0000005). Matching used to take COLMAP's default -1 = one thread per visible CPU: a RunPod container with "
                    "a 35-core quota sees 128, and OpenBLAS then aborts ('BLAS : Bad memory unallocation!') -> exit -11")
    ap.add_argument("--cpu", action="store_true", help="never use the COLMAP binary (CUDA): pycolmap CPU only")
    ap.add_argument("--no-map", action="store_true", help="features + matching only (run_all: the lens step maps with the "
                    "focal length FIXED, which registers all frames where a free-focal start fails on face-only features)")
    ap.add_argument("--repeatable", action="store_true", help="same input -> same database (W-det option, 2026-10-20): "
                    "fixed RANSAC seed in the two-view verification (unseeded: most verified pairs changed their inliers run to "
                    "run). Mapping: lens_anchor --map-threads 1. GPU SIFT is kept (identical in 8 of 10 runs, 2-4 frames differed "
                    "in 2); CPU SIFT was repeatable but its single-thread map lost one side on eun02 (67/87 frames)")
    a = ap.parse_args()
    prep = json.load(open(os.path.join(a.work, "prep", "prepare.json")))
    images = os.path.join(a.work, "prep", "images")
    ws = os.path.join(a.work, "colmap"); os.makedirs(ws, exist_ok=True)
    db_out = os.path.join(ws, "database.db"); sp = os.path.join(ws, "sparse")
    # SQLite needs a local disk with file locking: synced / network / mounted folders (OneDrive, shares) fail with
    # "disk I/O error". The database is built in a local temp folder and copied to work/<id>/colmap after each stage.
    import hashlib, tempfile
    global TMP
    tmp = TMP = os.path.join(tempfile.gettempdir(), "livemirror_sfm_" + hashlib.md5(os.path.abspath(a.work).encode()).hexdigest()[:10])
    os.makedirs(tmp, exist_ok=True); db = os.path.join(tmp, "database.db")
    if not os.path.exists(db) and os.path.exists(db_out) and not a.force: shutil.copy2(db_out, db)
    sync = lambda: shutil.copy2(db, db_out)
    done = os.path.join(ws, "sfm_sparse.json")
    if a.force:
        for p in (db, db_out, sp, done): shutil.rmtree(p, ignore_errors=True) if os.path.isdir(p) else (os.path.exists(p) and os.remove(p))
    st = json.load(open(done)) if os.path.exists(done) else {}
    masks = os.path.join(a.work, "prep", "masks")
    # follow prepare_capture's decision (it also chooses masks when the camera motion is UNCERTAIN, e.g. a webcam video:
    # p01-s1 has fixed_camera=False but use_masks=True). Without masks the still background of a head-turn video gives
    # pairs with no baseline and the mapper finds "no good initial image pair" (seen on the PC, 2026-10-15)
    # HEAD masks (face + hair + ears, nothing below the chin) by default: valid for a fixed camera (person turns) and a
    # moving camera (person still); excludes the still background AND the body / hands, which turn differently.
    # (eun01, 2026-10-15: plain white wall fooled the fixed-camera test -> "moving", no masks -> body + hands in SfM)
    if not a.full_frame:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        # default (2026-10-24): head masks with the background cut by the person segmentation (head_masks_pc);
        # --keep-mask-background = the earlier head masks (head_masks)
        hm = os.path.join(a.work, "prep", "head_masks" if a.keep_mask_background else "head_masks_pc")
        if not os.path.exists(os.path.join(hm, "head_masks.json")):
            import head_masks
            print("head masks:", json.dumps(head_masks.build(os.path.join(a.work, "prep"), person_cut=not a.keep_mask_background)[1]), flush=True)
        masks, use_masks = hm, True
    else:
        use_masks = bool(prep.get("use_masks", prep.get("fixed_camera"))) and os.path.isdir(masks)
    # masked frames have fewer features: more SIFT features + a relaxed mapper initialisation
    PEAK = 0.004 if use_masks else 0.0067
    # --cpu: pycolmap on the CPU. SIFT only: the ALIKED + LightGlue option was removed on 11/08 (S15P31B204-687; worse
    # shapes on woo02 / eun02 than SIFT and 4-12x the GPU time, 10/19-11/08 comparisons)
    colmap = None if a.cpu else find_colmap()
    GPU = "0" if a.cpu else "1"
    cfg = {"masks": use_masks, "peak": PEAK, "mask_kind": ("head" if a.keep_mask_background else "head-person") if not a.full_frame else "prepare", "engine": "gpu" if (colmap and not a.cpu) else "cpu"}
    if a.repeatable: cfg["repeatable"] = True
    if st.get("features") and st.get("cfg") != cfg:
        print("feature settings changed -> features, matches and mapping are redone", flush=True)
        st = {"sec": {}}
        if os.path.exists(db): os.remove(db)
    T = st.setdefault("sec", {})
    if not st.get("features"):
        t0 = time.time()
        eo = pycolmap.FeatureExtractionOptions() if hasattr(pycolmap, "FeatureExtractionOptions") else None
        ro = pycolmap.ImageReaderOptions(); ro.camera_model = "SIMPLE_RADIAL"
        if use_masks: ro.mask_path = masks
        kw = dict(camera_mode=pycolmap.CameraMode.SINGLE, reader_options=ro)
        if eo is not None:
            eo.sift.peak_threshold = PEAK; eo.num_threads = a.threads; kw["extraction_options"] = eo
        # in batches of 20 frames, resumable: frames already in the database are skipped after an interruption
        import sqlite3
        allnames = sorted(n for n in os.listdir(images) if n.lower().endswith((".jpg", ".jpeg", ".png")))
        def done_names():
            if not os.path.exists(db): return set()
            con = sqlite3.connect(db)
            try: return {r[0] for r in con.execute("select i.name from images i join keypoints k on k.image_id = i.image_id")}
            except sqlite3.Error: return set()
            finally: con.close()
        if st.get("cfg_started") != cfg:          # a partial database from other settings is not reused
            if os.path.exists(db): os.remove(db)
            st["cfg_started"] = cfg; json.dump(st, open(done, "w"))
        todo = [n for n in allnames if n not in done_names()]
        if colmap and todo:
            # GPU SIFT through the COLMAP binary (CUDA build, RTX 4050 on the team laptop): ~5-10x faster than CPU SIFT
            if os.path.exists(db): os.remove(db)
            extract = lambda dbp, extra=(): colmap_run(colmap, "feature_extractor", ["--database_path", dbp, "--image_path", images,
                            "--ImageReader.camera_model", "SIMPLE_RADIAL", "--ImageReader.single_camera", "1"]
                            + (["--ImageReader.mask_path", masks] if use_masks else [])
                            + list(extra),
                            {("--FeatureExtraction.use_gpu", "--SiftExtraction.use_gpu"): GPU,
                             ("--SiftExtraction.peak_threshold",): str(PEAK)})
            ok = extract(db)
            if ok and a.repeatable and GPU == "1":
                st["sift_vote"] = sift_vote(db, extract, tmp)
                print("GPU SIFT vote:", json.dumps(st["sift_vote"]), flush=True)
            if ok:
                todo = []; st["engine_features"] = "binary-gpu" if GPU == "1" else "binary-cpu"; st["features_type"] = "sift"
                print(f"features ({st['engine_features']}, {st['features_type']}) ok", flush=True)
            else:
                print("GPU feature extraction failed -> CPU", flush=True); colmap = None
                cfg["engine"] = "cpu"; st["cfg_started"] = cfg
                if os.path.exists(db): os.remove(db)
        for b in range(0, len(todo), 20):
            batch = todo[b:b + 20]
            try:
                pycolmap.extract_features(db, images, image_names=batch, **kw)
            except TypeError:   # older pycolmap: camera_model as its own argument
                pycolmap.extract_features(db, images, image_names=batch, camera_mode=pycolmap.CameraMode.SINGLE, camera_model="SIMPLE_RADIAL")
            print(f"features {min(b + 20, len(todo))}/{len(todo)}", flush=True)
        T["features"] = round(T.get("features", 0) + time.time() - t0, 1)
        sync(); st["features"] = True; st["masks"] = use_masks; st["cfg"] = cfg; json.dump(st, open(done, "w"))
        print("features ok", flush=True)
    if not st.get("matches"):
        t0 = time.time()
        n = len(os.listdir(images))
        m = a.matcher if a.matcher != "auto" else ("exhaustive" if n <= 150 else "sequential")
        ok = False
        if colmap:
            mcmd = "exhaustive_matcher" if m == "exhaustive" else "sequential_matcher"
            if a.repeatable:
                # COLMAP 4.x: --TwoViewGeometry.random_seed (default -1 = unseeded). Older builds lack it -> recorded
                st["verify_seeded"] = colmap_has(colmap, mcmd, "--TwoViewGeometry.random_seed")
                if not st["verify_seeded"]: print("note: this COLMAP has no --TwoViewGeometry.random_seed -> verification not repeatable", flush=True)
            ok = colmap_run(colmap, mcmd,
                            ["--database_path", db],
                            {("--FeatureMatching.use_gpu", "--SiftMatching.use_gpu"): GPU,
                             ("--FeatureMatching.num_threads", "--SiftMatching.num_threads"): str(a.threads),
                             **({("--TwoViewGeometry.random_seed",): "0"} if a.repeatable else {})})
            st["engine_matching"] = ("binary-gpu" if GPU == "1" else "binary-cpu") if ok else "cpu"
        if not ok:
            vo = {}
            if hasattr(pycolmap, "FeatureMatchingOptions"):
                mo = pycolmap.FeatureMatchingOptions(); mo.num_threads = a.threads; vo["matching_options"] = mo
            if a.repeatable and hasattr(pycolmap, "TwoViewGeometryOptions"):
                v = pycolmap.TwoViewGeometryOptions(); v.ransac.random_seed = 0; vo["verification_options"] = v
                st["verify_seeded"] = True
            (pycolmap.match_exhaustive if m == "exhaustive" else pycolmap.match_sequential)(db, **vo)
        T["matching"] = round(time.time() - t0, 1)
        sync(); st["matches"] = m; json.dump(st, open(done, "w"))
        print("matches ok", m, flush=True)
    if a.no_map:
        st["images"] = n_imgs(images); json.dump(st, open(done, "w")); print(json.dumps(st)); return
    if not st.get("mapped"):
        t0 = time.time()
        os.makedirs(sp, exist_ok=True)
        po = pycolmap.IncrementalPipelineOptions()
        po.multiple_models = False; po.extract_colors = False          # one face model; colours not needed
        po.ba_global_frames_ratio = 1.3; po.ba_global_points_ratio = 1.3  # fewer global BAs (video frames are dense)
        if use_masks:
            po.min_num_matches = 10
            po.mapper.init_min_num_inliers = 30; po.mapper.init_min_tri_angle = 6.0
            po.mapper.abs_pose_min_num_inliers = 15; po.mapper.abs_pose_min_inlier_ratio = 0.15
        recs = pycolmap.incremental_mapping(db, images, sp, options=po)
        if not recs:
            print(json.dumps({"status": "failed", "reason": "no model"})); sys.exit(2)
        best_k = max(recs, key=lambda k: recs[k].num_reg_images())
        r = recs[best_k]
        T["mapping"] = round(time.time() - t0, 1)
        st.update(mapped=True, model=os.path.join(sp, str(best_k)), registered=r.num_reg_images(), images=n_imgs(images),
                  reproj_px=round(r.compute_mean_reprojection_error(), 3))
        json.dump(st, open(done, "w"))
    print(json.dumps(st))
    if st["registered"] < 0.6 * st["images"]:
        print("registered < 60 % of the frames: capture or matching problem"); sys.exit(3)



def sift_vote(db, extract, tmp):
    """--repeatable: GPU SIFT (SiftGPU) is not always repeatable - now and then single frames come out different (eun02
    2 and 4 of 87 frames in 2 of 10 runs, woo01 12 of 89 in 1 of 3, e.g. 1186 -> 688 keypoints), while most runs give the
    same features. A second extraction is compared frame by frame; frames that differ are extracted a third time and
    the version two runs agree on is kept (the first run's when all three differ)."""
    import sqlite3
    def feats(p):
        con = sqlite3.connect(p)
        try:
            nm = dict(con.execute("select image_id, name from images"))
            k = {nm[i]: (r, c, d) for i, r, c, d in con.execute("select image_id, rows, cols, data from keypoints")}
            de = {nm[i]: (t, r, c, d) for i, t, r, c, d in con.execute("select image_id, type, rows, cols, data from descriptors")}
            return {n: (k.get(n), de.get(n)) for n in nm.values()}
        finally:
            con.close()
    db2, db3, lst = (os.path.join(tmp, f) for f in ("vote2.db", "vote3.db", "vote3.txt"))
    for f in (db2, db3):
        if os.path.exists(f): os.remove(f)
    if not extract(db2): return {"status": "second extraction failed"}
    A, B = feats(db), feats(db2)
    diff = sorted(n for n in A if A[n] != B.get(n))
    res = {"frames": len(A), "differed": len(diff), "replaced": 0, "unresolved": 0}
    if diff:
        open(lst, "w").write("\n".join(diff) + "\n")
        C = feats(db3) if extract(db3, ["--image_list_path", lst]) else {}
        con = sqlite3.connect(db)
        ids = dict((n, i) for i, n in con.execute("select image_id, name from images"))
        for n in diff:
            if C.get(n) is not None and C[n] == B.get(n):
                (r, c, d), (t, r2, c2, d2) = B[n]
                con.execute("update keypoints set rows=?, cols=?, data=? where image_id=?", (r, c, d, ids[n]))
                con.execute("update descriptors set type=?, rows=?, cols=?, data=? where image_id=?", (t, r2, c2, d2, ids[n]))
                res["replaced"] += 1
            elif not (C.get(n) is not None and C[n] == A[n]):
                res["unresolved"] += 1
        con.commit(); con.close()
    for f in (db2, db3, lst):
        if os.path.exists(f): os.remove(f)
    return res


def find_colmap():
    """COLMAP binary from LM_COLMAP / runtime.local.json / runtime.json (same lookup as tools/runtime.mjs)."""
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
    cands = [os.environ.get("LM_COLMAP")]
    for f in ("runtime.local.json", "runtime.json"):
        try: cands.append(json.load(open(os.path.join(root, f))).get("colmap"))
        except Exception: pass
    cands += [os.path.join(root, ".tools", "colmap", "COLMAP.bat"), r"C:\tools\colmap\COLMAP.bat"]
    for c in cands:
        if c and os.path.isfile(c): return c
    return None


# `colmap <cmd> -h` (option names) waits this long. The first COLMAP start on a fresh RunPod Pod reads the binary and its
# CUDA libraries from the network volume and took over 60 s: the help call timed out and the job silently fell back to CPU
# SIFT - other features, so another 3D model from the same input (S15P31B204-514, 11/9 Pod C). run-worker.sh also starts
# COLMAP once before the workers (warm-up)
HELP_TIMEOUT = 600


def colmap_has(colmap, cmd, option):
    """True when `colmap <cmd> -h` lists this option (COLMAP 3.x / 4.x builds differ)"""
    import subprocess
    try:
        r = subprocess.run([colmap, cmd, "-h"], capture_output=True, text=True, timeout=HELP_TIMEOUT)
        return option in (r.stdout or "") + (r.stderr or "")      # COLMAP 4.x prints its help on stderr
    except Exception as ex:
        print(f"colmap {cmd} -h failed: {type(ex).__name__}: {str(ex)[:200]}", flush=True)
        return False


def colmap_run(colmap, cmd, args, opts):
    """run a COLMAP command; option names differ between COLMAP 3.x and 4.x, so the first name the help lists is used."""
    import subprocess
    try:
        r0 = subprocess.run([colmap, cmd, "-h"], capture_output=True, text=True, timeout=HELP_TIMEOUT)
        tx = (r0.stdout or "") + (r0.stderr or "")
    except Exception as ex:   # said out loud: a silent timeout here sent the first job of a fresh Pod to CPU SIFT (11/9)
        print(f"colmap {cmd} -h failed: {type(ex).__name__}: {str(ex)[:200]}", flush=True)
        return False
    for names, val in opts.items():
        for n in names:
            if n in tx: args += [n, val]; break
    try:
        r = subprocess.run([colmap, cmd] + args, capture_output=True, text=True)
        if r.returncode != 0: print(r.stdout[-800:], r.stderr[-800:], flush=True)
        return r.returncode == 0
    except Exception as ex:
        print("colmap failed:", ex, flush=True); return False

def n_imgs(d):
    return len([f for f in os.listdir(d) if f.lower().endswith((".jpg", ".jpeg", ".png"))])


if __name__ == "__main__":
    # S15P31B204-403: pycolmap / COLMAP libraries now and then crash while Python tears them down (exit -11 AFTER the
    # results are written: "features ok" / "matches ok" printed, then a segfault), and run_all then drops the finished
    # stage. Every result file is written and closed by now, so leave with the script's own exit code, skipping the teardown.
    try:
        main(); code = 0
    except SystemExit as e:
        if isinstance(e.code, str): print(e.code, file=sys.stderr)
        code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    # the temp database is a working copy: every finished stage is already in work/<id>/colmap (S15P31B204-448: it was
    # left in /tmp after every run). An interrupted run (Ctrl+C, crash) keeps it, so the feature batches can resume
    if TMP: shutil.rmtree(TMP, ignore_errors=True)
    sys.stdout.flush(); sys.stderr.flush()
    os._exit(code)
