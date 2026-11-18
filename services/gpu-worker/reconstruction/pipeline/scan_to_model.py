"""Scan -> 3D face model, the final PoC method (10/14). One command, resumable step by step.

input : work/<id>/prep/images (+ prepare.json from prepare_capture.py) and a COLMAP sparse model with a CORRECT lens
        (moving phone: self-calibration; fixed camera + head turn: lens anchored, tools/colmap/lens_anchor.py)
output: work/<id>/model/   (personal data, never leaves this PC)
  mv0.ply            468 face points triangulated with the SfM poses (training frames)
  frame_poses.json   per-frame check: SfM pose puts the face points on the person? bad poses re-solved (PnP) or dropped
  mv.ply             468 face points re-triangulated with the checked poses
  fit_lm.ply         GNM head template fitted to the face points (bi-Laplacian, w_smooth 40)
  fit_dense.ply      same + dense COLMAP points (only if --dense; kept only if it does not make hold-out frames worse)
  tex_*.png/.obj     UV textures baked from all frames (exposure-matched, occlusion-tested, neck below the chin filled)
  eval_*.json        hold-out frames (never used for the model): median error per head-turn band, px and % eye distance
  report.json        decision + numbers;  case: cases/<case-id> (editable, vertex colours from the texture)
usage: python pipeline/scan_to_model.py --work work/p01-s1 --sparse <model> [--dense fused.ply] [--holdout 5]
       [--case-id p01-s1-model] [--steps mv0,poses,mv,fit,select,bake,case] [--force]
"""
import argparse, time, json, os, shutil, subprocess, sys
import numpy as np
# MediaPipe face-oval ring (same as template_fit.OVAL)
OVAL_LM = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,         172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
# upper-lid points: moved on purpose from MediaPipe's position to the lash line -> never scored as landmark error
LID_LM = [246, 161, 160, 159, 158, 157, 173, 466, 388, 387, 386, 385, 384, 398]
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)


# --depth-source sfm (2026-10-24): every landmark region of assets/gnm/gnm_features.json gets no MediaPipe depth in gnm_fit
SFM_DEPTH_REGIONS = ["nose_region", "lower_lip_region", "upper_lip_region", "right_orbital_region", "left_orbital_region", "forehead_region",
                     "right_cheek_region", "left_cheek_region", "chin_region", "left_infraorbital_region", "right_infraorbital_region",
                     "right_brow_region", "left_brow_region", "right_parotid_region", "right_zygomatic_region", "right_temple_region",
                     "left_temple_region", "left_zygomatic_region", "left_parotid_region", "middle_brow_region"]

def file_sha(path):
    """short content hash: which exact fit a texture / case / viewer was made from (stale-output guard)"""
    import hashlib
    if not os.path.exists(path): return None
    h = hashlib.sha1()
    with open(path, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 20), b""): h.update(b)
    return h.hexdigest()[:12]


def bake_stale_detail(P, best):
    """detail.json missing or made from another base fit -> detail_apply must run again"""
    try: d = json.load(open(P("detail.json"), encoding="utf-8"))
    except Exception: return True
    return d.get("fit") != best or d.get("base_sha") != file_sha(P(f"fit_{best}.ply")) or not os.path.exists(P(f"fit_{best}_detail.ply"))


def stamp_ok(stamp, **want):
    """True when the stamp file exists and records exactly these source values"""
    try: d = json.load(open(stamp))
    except Exception: return False
    return all(d.get(k) == v for k, v in want.items())
sys.path.insert(0, HERE)
STEPS = ["mv0", "poses", "mv", "ba", "fit", "refine", "select", "eye", "nose", "bake", "line", "case"]
# acceptance (hold-out frames, % of the outer eye-corner distance): see handoff doc 16
ACCEPT = {"front_0_15": 2.0, "three_quarter_15_35": 3.0, "side_35_90": 5.0}
LINE_BANDS = ("front_0_15", "three_quarter_15_35", "side_35_90")


def accept_of(bands):
    """hold-out landmark bands (frame_check.bands) -> the acceptance record of report.json"""
    return {k: {"limit_pct_iod": lim, "value": bands.get(k, {}).get("pct_iod"),
                "pass": bands[k]["pct_iod"] <= lim if k in bands else None} for k, lim in ACCEPT.items()}


def line_holdout_abs(per_frame):
    """line_check per-frame rows -> mean over the yaw bands of the median |outline / profile distance| on the HOLD-OUT
    frames (% IOD); None when no band has a hold-out row"""
    import numpy as np
    vals = [np.median(rows) for b in LINE_BANDS
            for rows in [[r[p]["median_abs"] for r in per_frame if r.get("holdout") and r["band"] == b for p in ("profile", "outline") if p in r]]
            if rows]
    return round(float(np.mean(vals)), 3) if vals else None


def fixed_choice(cands, eye_parts, select_prefer="", select_max_crease=0.0, eval_gnmb=False):
    """The default model step has nothing to choose (S15P31B204-758): with --no-lm and the eye step the pool is gnm + gnme,
    and the eye rule turns a gnm choice into gnme (service 62/62 and every local run with that pool ended on gnme).
    Returns that fixed candidate - gnme when the eye step made it, else gnm - or None when a real alternative is in the
    pool (lm / dense / *_pr / --eval-gnmb) or a selection option is set; then the candidates are evaluated as before."""
    pool = [c for c in cands if not (c == "gnmb" and "gnm" in cands and not eval_gnmb)]
    if not pool or set(pool) - {"gnm", "gnme"} or select_prefer or select_max_crease > 0:
        return None
    return "gnme" if eye_parts and "gnme" in pool else ("gnm" if "gnm" in pool else None)


import threading
_TLOCK = threading.Lock()
TIMES = {}   # seconds per sub-step (script name), written to report.json "timing_sec"


def run(args, log):
    print("  $", " ".join(os.path.basename(x) if i < 2 else x for i, x in enumerate(args)), flush=True)
    t0 = time.time()
    with open(log, "a") as fh:
        r = subprocess.run(args, stdout=subprocess.PIPE, stderr=fh, text=True)
    k = os.path.splitext(os.path.basename(args[1]))[0]
    with _TLOCK:   # candidates are evaluated in threads: per-script times are summed (can exceed the wall time)
        TIMES[k] = round(TIMES.get(k, 0) + time.time() - t0, 1)
    out = r.stdout.strip().splitlines()
    if r.returncode:
        raise SystemExit(f"step failed ({r.returncode}): {' '.join(args[:3])} - see {log}")
    return out[-1] if out else ""


def case_mesh(fit_ply, tex_prefix, out_ply):
    """fitted template -> skin+eyes mesh, subdivided once, vertex colours sampled from the baked UV textures."""
    import cv2, meshio
    from uv_bake import GROUPS, TEMPLATE
    d = np.load(TEMPLATE); UV = d["vertex_uvs"].astype(np.float64); UT = d["uv_triangles"].astype(np.int64)
    F = d["triangles"].astype(np.int64); mat = d["materials"]
    V = np.asarray(meshio.read_any(fit_ply)["vertices"], np.float64)
    keep, gid = [], []
    for gi, (name, mats, _) in enumerate(GROUPS):
        t = np.where(np.isin(mat[F], mats).all(1))[0]; keep.append(t); gid.append(np.full(len(t), gi))
    T = np.concatenate(keep); G = np.concatenate(gid)
    texs = [cv2.imread(f"{tex_prefix}_{n}.png")[:, :, ::-1].astype(np.float64) / 255 for n, _, _ in GROUPS]

    def samp(g, uv):
        tx = texs[g]; s = tx.shape[0]
        return tx[np.clip(((1 - uv[1]) * (s - 1)).astype(int), 0, s - 1), np.clip((uv[0] * (s - 1)).astype(int), 0, s - 1)]
    # midpoint subdivision on the position topology (welded), colours from the triangle's own UV chart
    verts = list(V); cols = [None] * len(V); emap = {}; Fo = []
    for t, g in zip(T, G):
        a, b, c = F[t]; ua, ub, uc = UV[UT[t]]
        for vi, uv in ((a, ua), (b, ub), (c, uc)):
            if cols[vi] is None: cols[vi] = samp(g, uv)
        mids = []
        for (i, j, ui, uj) in ((a, b, ua, ub), (b, c, ub, uc), (c, a, uc, ua)):
            key = (min(i, j), max(i, j))
            if key not in emap:
                emap[key] = len(verts); verts.append(0.5 * (V[i] + V[j])); cols.append(samp(g, 0.5 * (ui + uj)))
            mids.append(emap[key])
        ab, bc, ca = mids
        Fo += [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]
    Fo = np.array(Fo); used = np.unique(Fo); rm = -np.ones(len(verts), int); rm[used] = np.arange(len(used))
    Vo = np.array(verts)[used]; Co = np.array([cols[i] if cols[i] is not None else np.full(3, .7) for i in used])
    meshio.write_ply(out_ply, Vo, rm[Fo], Co)
    return len(Vo)


def main():
    import frame_check
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True); ap.add_argument("--sparse", required=True)
    ap.add_argument("--no-gnm", action="store_true", help="do not try the GNM statistical-model candidate")
    ap.add_argument("--nostril-fit", action="store_true", help="OPTION: team nostril fit after eyes, training frames only, base topology")
    ap.add_argument("--alar-width", choices=["model", "photo"], default="model", help="OPTION: photo alar width; default model unchanged")
    ap.add_argument("--nose-protection", choices=["legacy", "harmonic"], default="legacy", help="OPTION: continuous nose/cheek transition, fixed eyes/lips; legacy unchanged")
    ap.add_argument("--nose-profile", action="store_true", help="OPTION: team true-profile tip/infratip fit, held-out frames excluded")
    ap.add_argument("--nose-fit", default="joint", choices=["off", "joint"], help="DEFAULT joint (2026-11-11, S15P31B204-773; off = the earlier shape): joint = every nose "
                    "observation (side-view profile, nostril outlines, alar groove: pipeline/nose_obs.py) in one smooth solve "
                    "(pipeline/nose_fit.py); replaces --nostril-fit / --alar-width photo / --nose-profile")
    ap.add_argument("--dense"); ap.add_argument("--dense-region", default="nose", choices=["all", "nose"])
    ap.add_argument("--holdout", type=int, default=5, help="every k-th frame kept out for validation (0 = none)")
    ap.add_argument("--no-residual-smooth", action="store_true", help="keep the raw landmark residual of the gnm candidate")
    ap.add_argument("--select-lm-tol", type=float, default=0.5, help="a candidate with clearly better outlines (-0.3 %% IOD) "
                    "wins if its hold-out landmark error is at most this much worse (%% IOD; was 0.2 before 2026-10-19)")
    ap.add_argument("--select-prefer", default="", help="W-det OPTION (off = ''), e.g. gnm: this candidate is chosen "
                    "whenever its hold-out landmark error is at most --select-lm-tol worse, without the outline margin (0.3). "
                    "eun02 2026-10-20: the outline margin gnm vs lm moved 0.25-0.68 between SfM runs and flipped the choice")
    ap.add_argument("--select-photo", action="store_true", default=True, help="DEFAULT since 2026-10-24 (만두 결정, sp6; was E1-b OPTION 2026-10-23): choose the candidate by PHOTO evidence instead of MediaPipe hold-out landmarks: (1) candidates failing the qa crease limit (p95 >= 0.25 vs gnmb) are out when another passes, (2) a MediaPipe catastrophe guard (hold-out > best + 1.5 %% IOD) is out, (3) best photo-outline hold-out, within 0.1 the better hold-out photo agreement. Replay of 21 finished runs: 8 changed, all lm -> gnm (lm crease 0.27-0.38, the qa FAIL cases)")
    ap.add_argument("--no-select-photo", dest="select_photo", action="store_false", help="previous behaviour (before 2026-10-24): choose by MediaPipe hold-out landmarks")
    ap.add_argument("--select-max-crease", type=float, default=0.0, help="W1d OPTION (off = 0): candidates whose surface "
                    "crease score p95 (vs the smooth gnmb fit, %% IOD, tools/qa_check.py) is above this are not chosen "
                    "(min01 2026-10-19: lm chosen with 0.30, baselines 0.07). Try 0.15; default stays off until the baseline qa")
    ap.add_argument("--eval-gnmb", action="store_true", help="also evaluate / allow choosing the gnmb base fit as a "
                    "candidate (before 10/19 default)")
    ap.add_argument("--no-lm", action="store_true", help="W5b OPTION (2026-10-21, off by default): drop the landmark-only candidate lm "
                    "(template_fit) - gnm is the only scored candidate (gnmb stays as its base / the qa crease reference, not scored). "
                    "Saves one template_fit and one candidate evaluation (about 30-40 s). Default unchanged until the baseline qa")
    ap.add_argument("--eye-parts", action="store_true", help="W7-eye E2~E4 OPTION (2026-10-20, off by default): add the candidate "
                    "gnme = gnm + restoration eye displacement fitted to the parts_v1 measurements (pipeline/eye_parts_fit.py: "
                    "crease curve, side lid profile, caruncle fold; uncertain -> 0). Evaluated like every candidate; when the "
                    "default rules choose gnm, gnme is taken instead (it is gnm with the eye detail). Default selection unchanged")
    ap.add_argument("--depth-source", default="sfm", choices=["sfm", "mediapipe"], help="DEFAULT sfm since 2026-10-24 (만두 결정, sp6, "
                    "B1 S2 root cause): the statistical stage (gnm_fit) takes the face DEPTH and the head pose from the SfM sparse points "
                    "(--lm-depth-w 0 on every region --lm-depth-init --sparse-depth-pts 600 --sparse-depth-shift, the neck's angle to the head "
                    "fitted from the outlines since S15P31B204-775: --neck-pitch; the face regions held to the photo jaw line since S15P31B204-778: --face-region); MediaPipe only as image "
                    "positions. chae01 / gyu01 vs the dense multi-view surface: all-face error 2.94 / 2.32 -> 1.74 / 1.59 %% IOD, lower lid "
                    "(TAPIR) +2.22 / +3.95 -> +0.04 / +0.56. Known limit: glabella / nasal bridge and nose tip sit inside the outline "
                    "(no observation there). mediapipe = previous behaviour (gnm_fit defaults)")
    ap.add_argument("--gnm-extra", default="", help="extra gnm_fit.py options for comparison runs, e.g. "
                    "\"--hair-edge-class --side-hair\" (W7a); empty = defaults")
    ap.add_argument("--eye-depth-w", type=float, default=0.0, help="template_fit --eye-depth-w (eyelid landmark depth weight). DEFAULT 0 since 2026-10-24 "
                    "(만두 결정, sp6: MediaPipe depth is not used; before: unset = template_fit's own default)")
    ap.add_argument("--eyelid-cols", action="store_true", help="OPTION: template_fit --eyelid-cols (per-column lash-edge offsets)")
    ap.add_argument("--eyelid-ref", default="scalar", choices=["scalar", "cols", "clean"], help="G15 OPTION (2026-10-24, default scalar = "
                    "unchanged): upper-lid target of BOTH the statistical fit and the residual. scalar = one offset x taper per eye; cols = "
                    "per-column lash edges (offset_cols); clean = per-column from clean frames, aimed after projection, empty columns "
                    "interpolated (eyelid_offset.py --clean). The scalar lifted the middle of monolid eyes 0.02-0.05 x eye width above "
                    "the photo lash edge (DEV-LOG 'G15')")
    ap.add_argument("--depth-axis", default="head", choices=["head", "view"], help="G15 OPTION (2026-10-24, default head = unchanged): "
                    "template_fit --depth-axis. view = the weak 'depth' of the landmarks (sp6: all regions, eyelids) is the mean viewing "
                    "direction of the near-frontal cameras instead of head-forward, so landmarks keep their photo position. chae01: "
                    "upper-lid vertices +0.013-0.034 above the target -> -0.006-+0.009 x eye width (camera 12.5 deg below the eyes)")
    ap.add_argument("--smooth-pin-lids", action="store_true", help="G15 OPTION (2026-10-24, off = unchanged): residual_smooth keeps the 32 "
                    "eyelid landmark vertices (residual_smooth.py --pin-lids). zu01: smoothing moved one upper-lid column +0.015 -> "
                    "+0.033 x eye width above the photo lash edge")
    ap.add_argument("--detail", action="store_true", help="W8b S2 OPTION (2026-10-21, off by default): after the eye fit, lift the chosen fit to the "
                    "detail layer (pipeline/detail_apply.py: subdivided eye / nose / lip / chin, eye parts solved on it) and bake the textures on that "
                    "mesh; head.glb is then exported from the detail mesh (run_all viewer stage). qa / 360 viewer stay on the base")
    ap.add_argument("--detail-extra", default="", help="extra detail_apply.py options, e.g. \"--crease fold=0.05 --smooth-passes 8\"")
    ap.add_argument("--lid-clear", type=float, default=0.0, help="OPTION: eye_fit --lid-clear (minimum lid thickness over the eyeball)")
    ap.add_argument("--lid-prior", type=float, default=None, help="OPTION (2026-10-21, option A): template_fit --lid-prior W (eyelid + orbital "
                    "landmark depth = the GNM base shape's depth; try 1)")
    ap.add_argument("--corr-fix", action="store_true", help="OPTION (2026-10-22): template_fit --corr-fix assets/gnm_mp468_fix.json "
                    "(3 lid-ring landmarks re-attached from socket-interior vertices to the lid margin)")
    ap.add_argument("--a3", action="store_true", default=True, help="DEFAULT since 2026-10-23 (만두 확인; was an option the same day): upper-lid landmarks on the eyeball CONTACT line instead of the lid front (assets/gnm_mp468_a3.json, tools/make_a3_corr.py; includes the A2 fixes) for BOTH the statistical fit and the residual - MediaPipe's upper-lid points are the visible edge of the eye opening (1.03 x eyeball radius), the template had them on the lid front (1.15-1.27 x), so the residual sank the lid by its thickness. Originals: R0 upper lash root chae01 +0.061 -> +0.015, gyu01 +0.137 -> +0.088 x eye width, folded faces around the eyes -45..-70 %%, photo scores unchanged")
    ap.add_argument("--no-a3", dest="a3", action="store_false", help="previous behaviour (before 2026-10-23): upper-lid landmarks on the lid front vertices")
    ap.add_argument("--corr-fix-gnm", action="store_true", help="OPTION (2026-10-22, A2): also pass the corr fix to gnm_fit (statistical stage)")
    ap.add_argument("--eye-parts-post", action="store_true", help="10/23 option (with --eye-parts): when gnme is chosen, the eye step "
                    "[5b] runs on gnm FIRST and the eye parts are fitted on that result (fit_gnmef -> fit_gnme, same measurement and "
                    "--eye-parts-extra). Default order drapes the lids AFTER the crease was placed and lifted the crease line by up to "
                    "0.05 x eye width (gyu01-gnme5c)")
    ap.add_argument("--eye-parts-extra", default="", help="extra eye_parts_fit.py options for comparison runs, e.g. \"--depth 0.03 --bulge 0.01\"")
    ap.add_argument("--no-eye-color", dest="eye_color", action="store_false", help="no eye colour measurement after the bake (eye_color.json is read by no service step; run_all --service, S15P31B204-761)")
    ap.add_argument("--case-id"); ap.add_argument("--steps", default=",".join(STEPS)); ap.add_argument("--force", action="store_true")
    ap.add_argument("--shape-only", action="store_true", help="shape review: run geometry/eyes/nose, skip texture bake, eye colour and coloured case")
    ap.add_argument("--photo-refine", action="store_true", help="EXPERIMENTAL photo-consistency surface refinement candidate "
                    "(helps on sharp, textured captures; on the p01-s1 webcam the plain fit looked better)")
    ap.add_argument("--images"); ap.add_argument("--tex-size", type=int, default=2048)
    ap.add_argument("--skip-false-faces", action="store_true", help="OPTION (2026-10-24): leave MediaPipe false faces (frontal faces found inside a profile stretch, pipeline/face_flags.py) out of the landmark triangulation")
    ap.add_argument("--frame-check", default="mediapipe", choices=["mediapipe", "sfm"], help="OPTION (2026-10-24, default mediapipe = unchanged): sfm = judge the camera frames by the SfM model's own re-projection (pipeline/frame_check_sfm.py) instead of MediaPipe landmarks; skips the first landmark triangulation (mv0)")
    ap.add_argument("--pose-ba", action="store_true", help="OPTIONAL camera pose + landmark bundle refinement (3 rounds). "
                    "p01-s1: hold-out side 5.0 -> 2.8 %%, shape stays smooth; off by default (user kept the previous shape)")
    ap.add_argument("--cranium", action="store_true", help="EXPERIMENTAL: fit the top / back of the head to the person "
                    "silhouettes (hair volume). Off by default: the template head is kept (user decision 2026-10-15)")
    ap.add_argument("--sil-upper", default="", choices=["", "max", "q75", "median"], help="OPTION (2026-10-24, W16 step 2): after the gnm residual (+ smoothing), push face parts that project OUTSIDE the person silhouette of any posed frame back inside (pipeline/sil_upper.py; value = how the per-frame violations of a vertex are combined). Off by default. gyu01 hand-traced profile: d2 upper nose +0.11 -> max 0.00 (00004) but -0.08 on the other side (00340, left / right camera disagreement), median +0.07 / -0.03")
    ap.add_argument("--residual-depth-w", type=float, default=0.0, help="DEFAULT 0 since 2026-10-24 (만두 결정, sp6; before 0.2 on nose / lips only): weight of the nose / lip landmark DEPTH (head-forward) in the gnm residual. MediaPipe's triangulated nose points sit 0.06-0.27 x eye width IN FRONT of the statistical fit and the residual pulled the nose bridge / tip forward by 0.06-0.19 (mid-face too high, 5/6 originals, work/_trace/midface). 0 = the front 2D positions stay, the depth comes from the silhouette-fitted base")
    ap.add_argument("--profile90", type=float, default=0.0, help="OPTION (2026-10-24, pipeline/profile90.py): gnm residual - the 80-100 deg "
                    "profile as a two-sided depth observation of the face midline, convex segments only (forehead, nasal bridge, tip, lips, "
                    "chin). Value = weight (try 0.5). 0 = off")
    ap.add_argument("--profile90-segs", default="", help="--profile90: midline segments (template_fit default forehead,bridge,tip,lips,chin); "
                    "10/24 chae01 / gyu01: bridge,tip at 0.25 kept the nose gain without pushing the lips forward")
    ap.add_argument("--residual-depth-regions", default="all", help="DEFAULT all since 2026-10-24 (만두 결정, sp6: the residual moves landmarks only in the image plane; before: empty = template_fit's nose + lips). template_fit --anchor-depth-regions for the gnm residual, e.g. nose_region,upper_lip_region,lower_lip_region,middle_brow_region")
    ap.add_argument("--recover-pitch", default="off", choices=["off", "dropped", "all"], help="N2 OPTION (2026-10-24, off = unchanged, docs/nose-design.md): "
                    "after the candidate choice, re-solve camera poses from COLMAP face features lifted onto the chosen fit (pipeline/pitch_pose.py, "
                    "nose region left out). dropped = only frames the pose check dropped (chin-up / chin-down frames registered to the wall); all = "
                    "also kept frames, replaced only when better on held-back points. The shape is NOT refitted; the eye step, texture and the "
                    "nose judge use the recovered frames. Original file kept as frame_poses.pre_pitch.json")
    ap.add_argument("--profile-sil", action="store_true", help="EXPERIMENTAL side-view silhouette constraint. p01-s1 webcam: "
                    "+side profile closer but creases on forehead/cheeks (per-frame pose noise) -> off by default")
    ap.add_argument("--even-light", type=float, default=0.0, help="texture: soften broad skin shadows (0..1, e.g. 0.5 for a hard "
                    "top light). Off by default")
    a = ap.parse_args()
    if a.shape_only and a.detail:
        ap.error("--shape-only currently supports base topology only; omit --detail")
    py = sys.executable
    W = a.work; out = os.path.join(W, "model"); os.makedirs(out, exist_ok=True)
    open(os.path.join(out, ".gitignore"), "w").write("*\n")
    images = a.images or os.path.join(W, "prep", "images")
    log = os.path.join(out, "model.log"); P = lambda n: os.path.join(out, n)
    rp = P("report.json"); rep = json.load(open(rp, encoding="utf-8")) if os.path.exists(rp) else {}
    rep.update(sparse=a.sparse, dense=a.dense, holdout_every=a.holdout)
    import pycolmap
    names = sorted(i.name for i in pycolmap.Reconstruction(a.sparse).images.values())
    hold = names[a.holdout // 2::a.holdout] if a.holdout else []
    open(P("holdout.txt"), "w").write("\n".join(hold) + "\n")
    # landmark triangulation leaves out the hold-out AND (option --skip-false-faces) MediaPipe false faces: a frontal face
    # "found" inside a profile stretch gives 468 wrong 2D points to every landmark (pipeline/face_flags.py)
    mv_excl = P("holdout.txt")
    if a.skip_false_faces:
        sys.path.insert(0, HERE); from face_flags import prepare_flags
        pj_ = os.path.join(W, "prep", "prepare.json")
        ff = [n for n, v in prepare_flags(json.load(open(pj_, encoding="utf-8"))).items() if v] if os.path.exists(pj_) else []
        open(P("mv_exclude.txt"), "w").write("\n".join(hold + ff) + "\n"); mv_excl = P("mv_exclude.txt"); rep["false_faces_excluded"] = len(ff)
    rep["frames"] = len(names); rep["holdout_frames"] = len(hold)
    steps = a.steps.split(",")
    rep["shape_only"] = bool(a.shape_only)
    if a.shape_only:
        steps = [s for s in steps if s not in ("bake", "case", "line")]  # final_shape_check owns the final outline once
        if "nose" not in steps: steps.append("nose")
        rep["skipped_steps"] = ["uv_bake", "eye_color", "case"]
        for key in ("bake", "case", "case_error", "eye_color"):
            rep.pop(key, None)
    else:
        rep.pop("skipped_steps", None)
    need = lambda st, f: st in steps and (a.force or not os.path.exists(P(f)))
    if a.frame_check == "sfm":
        # OPTION (2026-10-24, 만두 proposal): judge the frames by the SfM model's own re-projection; no first landmark
        # triangulation, no MediaPipe pose check (it dropped the chin-up / profile frames, 3-11 per run)
        if need("poses", "frame_poses.json"):
            print("[2/7] 프레임별 점검 (SfM 재투영)")
            rep["poses"] = json.loads(run([py, f"{HERE}/frame_check_sfm.py", a.sparse, P("frame_poses.json")], log))
        rep["frame_check"] = "sfm"
    else:
        if need("mv0", "mv0.ply"):
            print("[1/7] 기준점 삼각측량 (SfM 포즈)"); run([py, f"{HERE}/mv_landmarks.py", images, a.sparse, P("mv0.ply"), "--exclude", P("holdout.txt")], log)
        if need("poses", "frame_poses.json"):
            print("[2/7] 프레임별 추적 점검 · 잘못된 카메라 포즈 보정")
            rep["poses"] = json.loads(run([py, f"{HERE}/frame_check.py", P("mv0.ply"), a.sparse, images, P("frame_poses.json")], log))
    if need("mv", "mv.ply"):
        print("[3/7] 보정된 포즈로 재삼각측량")
        run([py, f"{HERE}/mv_landmarks.py", images, a.sparse, P("mv.ply"), "--exclude", mv_excl, "--poses", P("frame_poses.json")], log)
    if a.pose_ba and need("ba", "poses_ba_done.json"):
        # landmark bundle refinement: alternate pose PnP (facing, non-outline points) and re-triangulation, 3 rounds.
        # Fixes a few-degree SfM pose bias (p01-s1: profile off in one turning direction)
        print("[3b] 카메라 포즈·기준점 번갈아 정밀화 (3회)")
        pass  # shutil imported at the top
        if not os.path.exists(P("frame_poses_sfm.json")): shutil.copy2(P("frame_poses.json"), P("frame_poses_sfm.json"))
        for k in range(3):
            run([py, f"{HERE}/pose_refine.py", P("mv.ply"), a.sparse, images, P("frame_poses.json"), P("frame_poses.json")], log)
            run([py, f"{HERE}/mv_landmarks.py", images, a.sparse, P("mv.ply"), "--exclude", P("holdout.txt"), "--poses", P("frame_poses.json")], log)
        json.dump({"rounds": 3}, open(P("poses_ba_done.json"), "w"))
    gnm_ok = (not a.no_gnm) and os.path.exists(os.environ.get("LM_GNM_MODEL") or os.path.join(ROOT, "assets", "gnm", "v3_0", "gnm_head.npz")) \
        and os.path.exists(os.environ.get("LM_GNM_MAP") or os.path.join(ROOT, "assets", "gnm", "template_map.npz"))
    # "gnm": GNM Head statistical identity fit (whole head incl. ears / jaw moves like real heads) as the base shape,
    # then the same landmark / outline / eyelid deformation as "lm" for the small residuals (P0, 2026-10-16)
    cands = ([] if (a.no_lm and gnm_ok) else ["lm"]) + (["gnmb", "gnm"] if gnm_ok else []) + (["dense"] if a.dense else [])   # gnmb: statistical fit only
    if a.no_lm and gnm_ok: rep["no_lm"] = True
    if "fit" in steps:
        for c in cands:
            if a.force or not os.path.exists(P(f"fit_{c}.ply")):
                print(f"[4/7] 머리 템플릿 맞춤 ({c})")
                args = [py, f"{HERE}/template_fit.py", "--landmarks", P("mv.ply"), "--out", P(f"fit_{c}.ply"), "--w-smooth", "40",
                        # face outline from the near-frontal frames' 2D outline (not its 3D triangulation): fixes the
                        # one-sided widening seen on p01-s1 (left/right width ratio 1.2-1.5 -> 1.04, person 1.05)
                        "--sparse", a.sparse, "--poses", P("frame_poses.json"), "--contour-images", images, "--exclude", P("holdout.txt")]
                prep_json = os.path.join(W, "prep", "prepare.json")
                if os.path.exists(prep_json):
                    eo_need = a.force or not os.path.exists(P("eyelid_offset.json"))
                    if not eo_need and a.eyelid_ref == "clean": eo_need = "clean" not in json.load(open(P("eyelid_offset.json")))
                    if eo_need:
                        run([py, f"{HERE}/eyelid_offset.py", images, prep_json, P("eyelid_offset.json"), "--exclude", P("holdout.txt")]
                            + (["--clean", "--mv", P("mv.ply"), "--poses", P("frame_poses.json"), "--sparse", a.sparse] if a.eyelid_ref == "clean" else []), log)
                    args += ["--eyelid-offset", P("eyelid_offset.json")]
                    if a.eyelid_cols or a.eyelid_ref != "scalar": args += ["--eyelid-cols"]; rep["eyelid_cols"] = True
                    if a.eyelid_ref != "scalar": rep["eyelid_ref"] = a.eyelid_ref
                if a.depth_axis != "head": args += ["--depth-axis", a.depth_axis]; rep["depth_axis"] = a.depth_axis
                if a.eye_depth_w is not None: args += ["--eye-depth-w", str(a.eye_depth_w)]; rep["eye_depth_w"] = a.eye_depth_w
                if a.lid_prior is not None: args += ["--lid-prior", str(a.lid_prior)]; rep["lid_prior"] = a.lid_prior
                rep["a3"] = bool(a.a3)
                if a.a3: args += ["--corr-fix", os.path.join(ROOT, "assets", "gnm_mp468_a3.json")]
                elif a.corr_fix: args += ["--corr-fix", os.path.join(ROOT, "assets", "gnm_mp468_fix.json")]; rep["corr_fix"] = True
                if c == "dense": args += ["--dense", a.dense, "--dense-region", a.dense_region]
                if c == "gnmb":
                    continue   # written together with "gnm" (its base shape)
                if c == "gnm":
                    gargs = [py, f"{HERE}/gnm_fit.py", "--landmarks", P("mv.ply"), "--out", P("fit_gnm_base.ply"),
                             "--sil", "--work", W, "--sparse", a.sparse, "--poses", P("frame_poses.json"), "--exclude", P("holdout.txt")]
                    if os.path.exists(P("eyelid_offset.json")): gargs += ["--eyelid-offset", P("eyelid_offset.json")]
                    if a.eyelid_ref != "scalar": gargs += ["--eyelid-cols"]
                    if a.a3: gargs += ["--corr-fix", os.path.join(ROOT, "assets", "gnm_mp468_a3.json")]
                    elif a.corr_fix_gnm: gargs += ["--corr-fix", os.path.join(ROOT, "assets", "gnm_mp468_fix.json")]; rep["corr_fix_gnm"] = True
                    if a.depth_source == "sfm":
                        gargs += ["--lm-depth-w", "0", "--lm-depth-regions", ",".join(SFM_DEPTH_REGIONS), "--lm-depth-init",
                                  "--sparse-depth-pts", "600", "--sparse-depth-shift", "--neck-pitch", "--face-region"]
                    rep["depth_source"] = a.depth_source
                    if a.gnm_extra: import shlex; gargs += shlex.split(a.gnm_extra); rep["gnm_extra"] = a.gnm_extra
                    rep["gnm_fit"] = json.loads(run(gargs, log) or "{}")
                    # residual on the silhouette-fitted base: only the ANCHOR landmarks (eyes / brows / nose / lips) refine
                    # it; the oval / cheek / jaw landmarks slide with the view and are dropped / weak, and the base shape is
                    # held away from the anchors (P1: otherwise the residual pulled the fitted jaw / cheeks 3-4 % back in)
                    ci = args.index("--contour-images"); del args[ci:ci + 2]
                    args += ["--base-mesh", P("fit_gnm_base.ply"), "--w-oval", "0", "--w-surface", "0.05", "--keep-base", "1",
                             # nose / lip landmark DEPTH weak: the side-view profile of the base decides it (2026-10-16)
                             "--anchor-depth-w", str(a.residual_depth_w)]
                    if a.residual_depth_w != 0.2: rep["residual_depth_w"] = a.residual_depth_w
                    if a.residual_depth_regions: args += ["--anchor-depth-regions", a.residual_depth_regions]; rep["residual_depth_regions"] = a.residual_depth_regions
                    if a.profile90 > 0:
                        args += ["--profile90", str(a.profile90), "--profile90-images", images]; rep["profile90"] = a.profile90
                        if a.profile90_segs: args += ["--profile90-segs", a.profile90_segs]; rep["profile90_segs"] = a.profile90_segs
                    shutil.copy2(P("fit_gnm_base.ply"), P("fit_gnmb.ply")); shutil.copy2(P("fit_gnm_base.fit.json"), P("fit_gnmb.fit.json"))
                if a.profile_sil:
                    # pass 1 (base fit) -> side-view profile silhouettes segmented around it -> pass 2 with the profile edge
                    if a.force or not os.path.exists(P(f"fit_{c}_base.ply")):
                        run([x if x != P(f"fit_{c}.ply") else P(f"fit_{c}_base.ply") for x in args], log)
                    if a.force or not os.path.exists(P("profile_obs.pkl")):
                        run([py, f"{HERE}/profile_sil.py", P(f"fit_{c}_base.ply"), P(f"fit_{c}_base.fit.json"), a.sparse, images,
                             P("frame_poses.json"), "--exclude", P("holdout.txt"), "--save", P("profile_obs.pkl"),
                             "--debug", P("profile_sil_check.jpg")], log)
                    args += ["--profile-obs", P("profile_obs.pkl")]
                run(args, log)
                if c == "gnm" and not a.no_residual_smooth:
                    # 2026-10-19: the landmark residual carried MediaPipe noise in as creases (eun02: frown lines, bumpy
                    # nose bridge). Diffuse it (strong on forehead / glabella / nose / cheeks, weak at eyelids / lips).
                    # eun02: creases gone, landmark median 1.72 -> 1.89 % IOD, p90 9.48 -> 9.25
                    rep["residual_smooth"] = json.loads(run([py, f"{HERE}/residual_smooth.py", P("fit_gnm_base.ply"), P("fit_gnm.ply"),
                                                             P("fit_gnm.ply"), "--iters", "80"]
                                                            + (["--pin-lids", P("fit_gnm.fit.json")] if a.smooth_pin_lids else []), log) or "{}")
                if c == "gnm" and a.sil_upper:
                    rep["sil_upper"] = {"agg": a.sil_upper, **json.loads(run([py, f"{HERE}/sil_upper.py", P("fit_gnm.ply"), P("fit_gnm.fit.json"),
                                        P("fit_gnm.ply"), "--work", W, "--sparse", a.sparse, "--poses", P("frame_poses.json"),
                                        "--exclude", P("holdout.txt"), "--agg", a.sil_upper], log) or "{}")}
                if a.cranium:
                    # head top / back + hair volume from the person silhouettes (the face fit is held fixed)
                    print("[4c] 두상(정수리·뒤통수) 실루엣 맞춤")
                    cran_out = run([py, f"{HERE}/cranium_fit.py", P(f"fit_{c}.ply"), P(f"fit_{c}.fit.json"), a.sparse, images,
                                    P("frame_poses.json"), P(f"fit_{c}.ply")], log)
                    try: rep.setdefault("cranium", {})[c] = json.loads(cran_out)
                    except Exception: pass
    # W7-eye E2~E4 option: gnme = gnm + eye detail (crease / lid fullness / epicanthal cover) fitted to the E0 measurements
    if a.eye_parts and "gnm" in cands and os.path.exists(P("fit_gnm.ply")):
        if "fit" in steps and (a.force or not os.path.exists(P("fit_gnme.ply"))):
            print("[4d] 눈 부위 변형 맞춤 (gnme = gnm + 쌍꺼풀·눈두덩이·몽고주름)")
            try:
                eargs = [py, f"{HERE}/eye_parts_fit.py", "--work", W, "--base", "gnm", "--out", "gnme", "--sparse", a.sparse]
                if a.eye_parts_extra: import shlex; eargs += shlex.split(a.eye_parts_extra); rep["eye_parts_extra"] = a.eye_parts_extra
                rep["eye_parts"] = json.loads(run(eargs, log) or "{}")
            except SystemExit as ex:
                print("   눈 부위 맞춤 실패 (gnme 후보 없음):", ex); rep["eye_parts_error"] = str(ex)
        if os.path.exists(P("fit_gnme.ply")) and os.path.exists(P("fit_gnme.fit.json")): cands = cands + ["gnme"]
    # photo-consistency refinement of each fit -> extra candidates "<c>_pr" (surface between landmarks follows the photos)
    pr_cands = [f"{c}_pr" for c in cands]
    if "refine" in steps and a.photo_refine:
        for c in cands:
            if a.force or not os.path.exists(P(f"fit_{c}_pr.ply")):
                print(f"[4b] 사진 일치 표면 보정 ({c})")
                run([py, f"{HERE}/photo_refine.py", P(f"fit_{c}.ply"), P(f"fit_{c}.fit.json"), a.sparse, images, P(f"fit_{c}_pr.ply"),
                     "--poses", P("frame_poses.json"), "--exclude", P("holdout.txt")], log)
    cands = cands + ([c for c in pr_cands if os.path.exists(P(f"fit_{c}.ply"))] if a.photo_refine else [])
    fixed = fixed_choice(cands, a.eye_parts, a.select_prefer, a.select_max_crease, a.eval_gnmb) if a.select_photo else None
    if "select" in steps and fixed:
        # nothing to choose: no candidate evaluation (it took ~19 s and its numbers were overwritten by the final check or
        # described the surface before the eye step). The quality values come from ONE evaluation of the final surface
        # ("line" step, or tools/final_shape_check.py for shape reviews). The crease guard of the photo selection stays:
        # a creased gnme (eye parts gone wrong) falls back to gnm
        for k in ("select_photo", "select_prefer", "eye_parts_select", "select_crease_p95", "accept"): rep.pop(k, None)
        rep["eval"] = {}; best = fixed; sel = {"pool": [c for c in ("gnm", "gnme") if c in cands], "rule": "fixed"}
        if best == "gnme" and "gnm" in cands and os.path.exists(P("fit_gnmb.ply")):
            try:
                import meshio
                sys.path.insert(0, os.path.join(ROOT, "tools")); from qa_check import crease, ABS
                Vb = np.asarray(meshio.read_any(P("fit_gnmb.ply"))["vertices"], np.float64)
                lidb = np.array(json.load(open(P("fit_gnmb.fit.json")))["landmark_vertex_ids"])
                Ve = np.asarray(meshio.read_any(P("fit_gnme.ply"))["vertices"], np.float64)
                if Ve.shape == Vb.shape:
                    sel["crease_p95"] = round(float(crease(Ve, Vb, np.linalg.norm(Vb[lidb][33] - Vb[lidb][263]))["p95"]), 3)
                    if sel["crease_p95"] >= ABS["crease_p95_fail"]: best = "gnm"
            except Exception as ex:
                sel["crease_error"] = str(ex)[:120]
        sel["chosen"] = best; rep["select_fixed"] = sel; rep["chosen"] = best
        print(f"[5/7] 후보 고정: {best} (후보 평가 생략, 주름 {sel.get('crease_p95')}) - 품질 값은 최종 표면 평가에서")
    elif "select" in steps:
        rep.pop("select_fixed", None)
        print("[5/7] 홀드아웃 프레임으로 평가 · 후보 선택")
        rep["eval"] = {}
        # the photo-segmentation caches are filled once BEFORE the candidates run side by side (line_check reads them;
        # two processes must not write the same cache file)
        try:
            from frame_check import load_poses
            from cranium_fit import person_masks
            from outline_obs import class_masks
            yaw = {i["file"]: i.get("yaw") for i in json.load(open(os.path.join(W, "prep", "prepare.json")))["images"]}
            lc_names = sorted(n for n in load_poses(P("frame_poses.json")) if yaw.get(n) is not None)
            person_masks(images, lc_names, os.path.join(W, "prep", "person_masks"))
            class_masks(images, lc_names, os.path.join(W, "prep", "class_masks"))
        except Exception as ex:
            print("   분할 캐시 미리 만들기 생략:", ex)

        def eval_cand(c):
            # independent geometry check: photo agreement of the surface on hold-out frames (never used for the model)
            j = json.loads(run([py, f"{HERE}/photo_refine.py", P(f"fit_{c}.ply"), P(f"fit_{c}.fit.json"), a.sparse, images,
                                P(f"judge_{c}.ply"), "--poses", P("frame_poses.json"), "--judge", P("holdout.txt")], log) or "{}")
            run([py, f"{HERE}/frame_check.py", P(f"fit_{c}.ply"), a.sparse, images, P(f"eval_{c}.json"), "--fit-json", P(f"fit_{c}.fit.json"),
                 "--poses-in", P("frame_poses.json"), "--no-repair",
                 # upper-lid points are moved on purpose from MediaPipe's position to the lash line -> not scored
                 # face-oval points (MediaPipe's view-dependent outline, not skin points) neither: the outline is judged
                 # by the line check against the photo skin outline (P1 2026-10-16)
                 "--skip", ",".join(map(str, LID_LM + OVAL_LM))], log)
            try:   # line agreement (outline / profile vs the photos' skin outline), all frames
                lc = json.loads(run([py, os.path.join(ROOT, "tools", "line_check.py"), W, "--mesh", P(f"fit_{c}.ply"), "--tag", c,
                                     "--overlays", "0", "--sparse", a.sparse], log) or "{}").get("summary", {})
            except (Exception, SystemExit) as ex:   # said out loud: a silent failure hid the --no-lm bug (2026-10-24)
                print(f"   윤곽 검사 실패 ({c}): {str(ex)[:160]}", flush=True)
                lc = {}
            lh = None
            try:   # line agreement on the HOLD-OUT frames only (the silhouette fit used the training frames)
                lh = line_holdout_abs(json.load(open(P(f"line_check_{c}.json")))["per_frame"])
            except Exception:
                pass
            return c, {"line": lc, "line_holdout_abs": lh,
                           "line_abs_signed_mean": round(float(np.mean([abs(v["signed_pct_iod"]) for v in lc.values()])), 3) if lc else None,
                              "holdout": frame_check.bands(P(f"eval_{c}.json"), set(hold), use_after=False),
                              "training": frame_check.bands(P(f"eval_{c}.json"), set(names) - set(hold), use_after=False),
                              "holdout_photo_agreement": j.get("ncc_at_surface_mean")}

        # candidates are independent (separate processes, separate output files): evaluated side by side (2026-10-19)
        # gnmb (statistical fit only) is the BASE of gnm and the crease reference of qa_check, not a real alternative:
        # not evaluated / not chosen since 10/19 (accepted baselines all chose gnm; it only won on eun03, a failed
        # capture). --eval-gnmb restores the old behaviour.
        ev_cands = [c for c in cands if not (c == "gnmb" and "gnm" in cands and not a.eval_gnmb)]
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(len(ev_cands)) as pool:
            for c, ev in pool.map(eval_cand, ev_cands):
                rep["eval"][c] = ev
        score = lambda c: np.mean([b["pct_iod"] for b in rep["eval"][c]["holdout"].values()]) if hold else 0
        pool_c = [c for c in ev_cands if not c.endswith("_pr")]
        if a.select_max_crease > 0 and os.path.exists(P("fit_gnmb.ply")):
            # W1d option: a creased candidate (MediaPipe landmark noise carried into the surface) is not chosen
            try:
                import meshio
                sys.path.insert(0, os.path.join(ROOT, "tools")); from qa_check import crease
                Vb = np.asarray(meshio.read_any(P("fit_gnmb.ply"))["vertices"], np.float64)
                lid = np.array(json.load(open(P("fit_gnmb.fit.json")))["landmark_vertex_ids"]); iod = np.linalg.norm(Vb[lid][33] - Vb[lid][263])
                cr = {}
                for c in pool_c:
                    Vc = np.asarray(meshio.read_any(P(f"fit_{c}.ply"))["vertices"], np.float64)
                    if Vc.shape == Vb.shape: cr[c] = crease(Vc, Vb, iod)["p95"]
                rep["select_crease_p95"] = cr
                ok_c = [c for c in pool_c if cr.get(c, 0) <= a.select_max_crease]
                if ok_c and len(ok_c) < len(pool_c):
                    print(f"   주름 지수 기준({a.select_max_crease}) 초과 후보 제외: {[c for c in pool_c if c not in ok_c]}")
                    pool_c = ok_c
            except Exception as ex:
                print("   주름 기준 후보 제외 생략:", ex)
        best = min(pool_c, key=score)
        rep.pop("select_photo", None)
        if a.select_photo:
            # E1-b (2026-10-23): the MediaPipe hold-out score agrees with MediaPipe by construction (P4: lm won it while its
            # photo outline / agreement were worse and its surface creased) -> photo evidence decides, MediaPipe only guards
            sel = {"pool": list(pool_c)}
            try:
                import meshio
                sys.path.insert(0, os.path.join(ROOT, "tools")); from qa_check import crease, ABS
                if os.path.exists(P("fit_gnmb.ply")):
                    Vb = np.asarray(meshio.read_any(P("fit_gnmb.ply"))["vertices"], np.float64)
                    lidb = np.array(json.load(open(P("fit_gnmb.fit.json")))["landmark_vertex_ids"]); iodb = np.linalg.norm(Vb[lidb][33] - Vb[lidb][263])
                    crs = {}
                    for c in pool_c:
                        Vc = np.asarray(meshio.read_any(P(f"fit_{c}.ply"))["vertices"], np.float64)
                        if Vc.shape == Vb.shape: crs[c] = round(float(crease(Vc, Vb, iodb)["p95"]), 3)
                    sel["crease_p95"] = crs
                    okc = [c for c in pool_c if crs.get(c, 0) < ABS["crease_p95_fail"]]
                    if okc: pool_c = okc
            except Exception as ex:
                sel["crease_error"] = str(ex)[:120]
            pool_c = [c for c in pool_c if score(c) <= min(score(x) for x in pool_c) + 1.5]
            lh_ = lambda c: rep["eval"][c].get("line_holdout_abs") if rep["eval"][c].get("line_holdout_abs") is not None else 9e9
            pa_ = lambda c: rep["eval"][c].get("holdout_photo_agreement") or 0
            best = min(pool_c, key=lh_)
            for c in pool_c:
                if c != best and lh_(c) - lh_(best) <= 0.1 and pa_(c) > pa_(best): best = c
            sel.update({"chosen": best, "kept": list(pool_c), "mediapipe_first": min(sel["pool"], key=score)})
            rep["select_photo"] = sel
            print(f"   사진 기준 선택(E1-b): {best} (MediaPipe 기준이면 {sel['mediapipe_first']}, 주름 {sel.get('crease_p95')})")
        # landmarks barely see the jaw / cheek / ear shape: a candidate whose outlines sit clearly closer to the photos
        # wins when its hold-out landmark score is not more than 0.2 % worse
        lab = lambda c: rep["eval"][c].get("line_holdout_abs") if rep["eval"][c].get("line_holdout_abs") is not None else rep["eval"][c].get("line_abs_signed_mean")
        # 2026-10-19: tolerance 0.2 -> 0.5 (--select-lm-tol). The hold-out LANDMARK score measures agreement with
        # MediaPipe's own points, whose depth leans to its mean face in oblique views; the landmark-driven fit (lm) wins
        # that score by construction and carried a mid-face 3-8 % IOD more forward than the GNM fit (woo01/eun01/eun02),
        # while the GNM fit sat 1.7-4x closer to the photo outlines. Outlines are direct image evidence -> they decide
        # unless the landmarks get clearly worse.
        for c in [c for c in pool_c if c != best and not a.select_photo]:
            if lab(c) is not None and lab(best) is not None and lab(c) < lab(best) - 0.3 and score(c) <= score(best) + a.select_lm_tol:
                best = c
        rep.pop("select_prefer", None)
        if a.select_prefer and a.select_prefer in pool_c and best != a.select_prefer and score(a.select_prefer) <= score(best) + a.select_lm_tol:
            print(f"   우선 후보 {a.select_prefer}: 홀드아웃 점 오차 {score(a.select_prefer):.2f} ≤ {best} {score(best):.2f} + {a.select_lm_tol} → {a.select_prefer}")
            rep["select_prefer"] = {"cand": a.select_prefer, "instead_of": best}; best = a.select_prefer
        # W7-eye option: gnme IS gnm plus the eye detail (landmarks / outlines identical by construction, the hold-out
        # landmark score ties and min() keeps gnm) -> when gnm is the choice, the eye-detailed version is used
        rep.pop("eye_parts_select", None)
        if a.eye_parts and best == "gnm" and "gnme" in pool_c:
            rep["eye_parts_select"] = {"cand": "gnme", "instead_of": "gnm", "holdout_lm": [round(float(score("gnm")), 3), round(float(score("gnme")), 3)]}
            print(f"   눈 부위 후보 gnme 채택 (gnm 대신, 홀드아웃 점 오차 {score('gnm'):.3f} → {score('gnme'):.3f})"); best = "gnme"
        # refined surface wins if the hold-out photos agree better (>= +0.01) and landmarks do not get worse (<= +0.15 %)
        pa = lambda c: rep["eval"][c].get("holdout_photo_agreement") or 0
        if f"{best}_pr" in rep["eval"] and pa(f"{best}_pr") >= pa(best) + 0.01 and score(f"{best}_pr") <= score(best) + 0.15:
            best = f"{best}_pr"
        rep["chosen"] = best
        rep["accept"] = accept_of(rep["eval"][best]["holdout"])
        print("   선택:", best, json.dumps(rep["accept"], ensure_ascii=False))
    best = rep.get("chosen", "lm")
    from nose_finish import restore as restore_nose
    restore_nose(W, best)
    if (a.nostril_fit or a.alar_width == "photo" or a.nose_profile or a.nose_fit != "off") and a.detail:
        raise SystemExit("코 옵션과 --detail은 함께 쓸 수 없습니다 (base GNM 정점 전용). --detail에는 --nose-fit off")
    if a.recover_pitch != "off" and ("bake" in steps or "nose" in steps):
        # N2 (2026-10-24): chin-up / chin-down poses from face features. Stamp = the pose file it wrote: when frame_poses.json is
        # that output already, nothing to do; when the pose check rewrote it since, the old backup is stale and is replaced
        pp, pre = P("pitch_pose.json"), P("frame_poses.pre_pitch.json")
        if not stamp_ok(pp, of=best, mode=a.recover_pitch, out=file_sha(P("frame_poses.json"))):
            if os.path.exists(pre): os.remove(pre)
            print(f"[5a] 위·아래 프레임 카메라 위치 다시 계산 (얼굴 특징점, 코 제외, {a.recover_pitch})", flush=True)
            try:
                out_ = json.loads(run([py, f"{HERE}/pitch_pose.py", W, P(f"fit_{best}.ply"), P(f"fit_{best}.fit.json"), a.sparse, P("frame_poses.json"),
                                       "--debug", P("pitch_pose_check.jpg")] + (["--all"] if a.recover_pitch == "all" else []), log) or "{}")
                json.dump({"of": best, "mode": a.recover_pitch, "out": file_sha(P("frame_poses.json")), **out_}, open(pp, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
            except SystemExit as ex:              # an optional step: the run goes on with the checked poses
                print("   위·아래 프레임 복구 생략:", ex); rep["recover_pitch_error"] = str(ex)[:200]
        d_ = json.load(open(pp, encoding="utf-8")) if os.path.exists(pp) else {}
        rep["recover_pitch"] = {"mode": a.recover_pitch, "dropped_before": d_.get("dropped"), "recovered": len(d_.get("recovered") or []),
                                "replaced": len(d_.get("replaced") or [])}
    # every step after "select" works on fit_<chosen>: each output carries a stamp of WHICH fit it was made from and is
    # redone when that differs (2026-10-16: the chosen model changed lm -> gnm and old outputs were silently reused)
    eye_stale = "eye" in steps and not stamp_ok(P("eye_fit.source.json"), of=best, raw=file_sha(P(f"fit_{best}.raw.ply")),
                                                 out=file_sha(P(f"fit_{best}.ply")))
    if need("eye", "eye_fit.json") or eye_stale:
        # eyeballs inside the lids + iris where the photos show it (eun01 2026-10-15: eyeball poked out at the corners)
        print("[5b] 눈 위치·눈꺼풀 맞춤")
        raw = P(f"fit_{best}.raw.ply")
        # the fit before the eye step (kept for re-runs): refreshed unless fit_<best>.ply is the eye output of that raw
        if os.path.exists(P("eye_fit.source.json")):
            refresh = not stamp_ok(P("eye_fit.source.json"), of=best, out=file_sha(P(f"fit_{best}.ply")))
        else:   # outputs from before the stamps: the older time rule
            refresh = not os.path.exists(P("eye_fit.json")) or os.path.getmtime(P(f"fit_{best}.ply")) > os.path.getmtime(P("eye_fit.json")) + 1
        if not os.path.exists(raw) or refresh:
            shutil.copy2(P(f"fit_{best}.ply"), raw)
        if a.eye_parts_post and best == "gnme" and os.path.exists(P("fit_gnm.ply")) and os.path.exists(P("eye_parts_measure_gnm.json")):
            # 10/23: eye step on the base, then the eye parts (crease + closed loop) on the eye-fitted base
            try:
                rep["eye_fit"] = json.loads(run([py, f"{HERE}/eye_fit.py", P("fit_gnm.ply"), P("fit_gnm.fit.json"), images,
                                                 os.path.join(W, "prep", "prepare.json"), "--exclude", P("holdout.txt"),
                                                 "--out", P("fit_gnmef.ply")] + (["--lid-clear", str(a.lid_clear)] if a.lid_clear > 0 else []), log))
                shutil.copy2(P("fit_gnm.fit.json"), P("fit_gnmef.fit.json"))
                eargs = [py, f"{HERE}/eye_parts_fit.py", "--work", W, "--base", "gnmef", "--out", "gnme", "--sparse", a.sparse,
                         "--measure", P("eye_parts_measure_gnm.json")]
                if a.eye_parts_extra: import shlex; eargs += shlex.split(a.eye_parts_extra)
                rep["eye_parts"] = json.loads(run(eargs, log) or "{}"); rep["eye_parts_post"] = True
                json.dump(rep["eye_fit"], open(P("eye_fit.json"), "w"), indent=1)
                json.dump({"of": best, "raw": file_sha(raw), "out": file_sha(P(f"fit_{best}.ply")), "post": "gnmef"}, open(P("eye_fit.source.json"), "w"))
            except SystemExit as ex:
                print("   눈 맞춤 뒤 눈 부위 맞춤 실패:", ex); rep["eye_parts_post_error"] = str(ex)
        else:
          try:
            rep["eye_fit"] = json.loads(run([py, f"{HERE}/eye_fit.py", raw, P(f"fit_{best}.fit.json"), images,
                                             os.path.join(W, "prep", "prepare.json"), "--exclude", P("holdout.txt"),
                                             "--out", P(f"fit_{best}.ply")] + (["--lid-clear", str(a.lid_clear)] if a.lid_clear > 0 else []), log))
            json.dump(rep["eye_fit"], open(P("eye_fit.json"), "w"), indent=1)
            json.dump({"of": best, "raw": file_sha(raw), "out": file_sha(P(f"fit_{best}.ply"))}, open(P("eye_fit.source.json"), "w"))
          except SystemExit as ex:
            print("   눈 맞춤 생략:", ex); rep["eye_fit_error"] = str(ex)
    rep.pop("nose_finish", None)
    if ("nose" in steps or "bake" in steps) and (a.nostril_fit or a.alar_width == "photo" or a.nose_profile or a.nose_fit != "off"):
        from nose_finish import finish as finish_nose
        print("[5c] 코 국소 맞춤 (눈 이후, 홀드아웃 제외, 코 밖 고정)", flush=True)
        rep["nose_finish"] = finish_nose(W, best, a.sparse, a.nostril_fit, a.alar_width, run, log,
                                         protection=a.nose_protection, profile=a.nose_profile, joint=a.nose_fit == "joint")
        # The team fit changes the chosen surface AFTER candidate selection: re-score
        # the final surface, including nose landmarks; never reuse the earlier accept.
        if not a.shape_only:  # shape reviews evaluate once after all final geometry below
            final_eval = P(f"eval_{best}_post_nose.json")
            run([py, f"{HERE}/frame_check.py", P(f"fit_{best}.ply"), a.sparse, images, final_eval,
                 "--fit-json", P(f"fit_{best}.fit.json"), "--poses-in", P("frame_poses.json"), "--no-repair",
                 "--skip", ",".join(map(str, LID_LM + OVAL_LM))], log)
            final_bands = frame_check.bands(final_eval, set(hold), use_after=False)
            rep["nose_finish"]["holdout_after"] = final_bands
            rep["eval_before_nose"] = rep.get("eval", {}).get(best, {})
            rep.setdefault("eval", {})[best] = {**rep["eval_before_nose"], "holdout": final_bands,
                                                "evaluation_stage": "post_nose", "evaluated_fit_sha": file_sha(P(f"fit_{best}.ply"))}
            rep["accept_before_nose"] = rep.get("accept", {})
            rep["accept"] = accept_of(final_bands)
    bake_mesh, bake_topo, detail_sha = P(f"fit_{best}.ply"), [], None
    if a.detail:
        # W8b S2: the detail layer of the chosen fit (lift + smoothing + eye parts on the fine mesh); textures are baked on it
        if "bake" in steps and (a.force or bake_stale_detail(P, best)):
            print("[5d] detail 층 (국소 세분 + 눈 부위 변형)")
            dargs = [py, f"{HERE}/detail_apply.py", W, "--fit", best]
            if rep.get("eye_parts_post") and best == "gnme" and os.path.exists(P("fit_gnmef.ply")):
                # 10/23: with --eye-parts-post fit_gnme = fit_gnmef (eye-fitted gnm) + eye parts, so the detail layer starts
                # from fit_gnmef (nothing to undo) and solves the eye parts once on the fine mesh
                dargs = [py, f"{HERE}/detail_apply.py", W, "--fit", "gnmef", "--no-undo", "--eye-params", P("eye_parts.json"),
                         "--out", P("fit_gnme_detail.ply")]
            if a.detail_extra: import shlex; dargs += shlex.split(a.detail_extra); rep["detail_extra"] = a.detail_extra
            rep["detail"] = json.loads(run(dargs, log) or "{}")
        elif os.path.exists(P("detail.json")): rep["detail"] = json.load(open(P("detail.json"), encoding="utf-8"))
        if os.path.exists(P(f"fit_{best}_detail.ply")):
            bake_mesh = P(f"fit_{best}_detail.ply"); bake_topo = ["--topology", os.path.join(HERE, "..", "assets", "gnm-detail-v1.npz")]
            detail_sha = file_sha(bake_mesh)
    # N2: with --recover-pitch the recovered frames change the texture too (poses key only then: other runs keep their stamps)
    poses_sha = file_sha(P("frame_poses.json")) if a.recover_pitch != "off" else None
    bake_stale = "bake" in steps and not stamp_ok(P("tex.source.json"), of=best, fit=file_sha(P(f"fit_{best}.ply")), detail=detail_sha, poses=poses_sha, nose_tex=True if a.nostril_fit else None)
    if need("bake", "tex_skin.png") or bake_stale:
        print("[6/7] 텍스처 베이크" + (" (detail 메쉬)" if detail_sha else ""))
        rep["bake"] = json.loads(run([py, f"{HERE}/uv_bake.py", bake_mesh, a.sparse, images, P("tex"), "--size", str(a.tex_size),
                                      "--poses", P("frame_poses.json"), "--fit-json", P(f"fit_{best}.fit.json"),
                                      "--even-light", str(a.even_light)] + bake_topo + (["--nostril-dark", "1", "--nostril-ring", "0.35", "--keep-nose-creases", "1"] if a.nostril_fit else []), log))
        json.dump({"of": best, "fit": file_sha(P(f"fit_{best}.ply")), "detail": detail_sha, **({"poses": poses_sha} if poses_sha else {}), **({"nose_tex": True} if a.nostril_fit else {})}, open(P("tex.source.json"), "w"))
        # real eye colours from the frontal photos (white of the eye per side, iris rings) for the local viewers
        if a.eye_color:
            try:
                run([py, f"{HERE}/eye_color.py", images, P("eye_color.json"), "--exclude", P("holdout.txt")], log)
            except SystemExit as ex:
                print("   눈 색 측정 생략:", ex)
    if "line" in steps:
        # line agreement: model outline vs the skin outline of every frame (jaw / cheek / profile), % of the eye distance.
        # The mesh is named: line_check alone reads "chosen" from report.json, which is only written at the end of this
        # run - a fresh --no-lm run looked for fit_lm.ply and the final line check failed (65 local service runs)
        rep.pop("line_check_error", None)
        try:
            # (not "out": that is the model folder used by P(); overwriting it broke every later path)
            lc_out = run([py, os.path.join(ROOT, "tools", "line_check.py"), W, "--mesh", P(f"fit_{best}.ply"), "--tag", "final",
                          "--sparse", a.sparse], log)
            rep["line_check"] = json.loads(lc_out)["summary"]
        except (Exception, SystemExit) as ex:
            rep["line_check_error"] = str(ex)
        if fixed and "holdout" not in rep.get("eval", {}).get(best, {}):
            # the candidate evaluation was skipped: the quality values (accept, hold-out landmark / line error) are measured
            # ONCE, on the final surface (after the eye / nose steps)
            ev_ = P(f"eval_{best}_final.json")
            run([py, f"{HERE}/frame_check.py", P(f"fit_{best}.ply"), a.sparse, images, ev_, "--fit-json", P(f"fit_{best}.fit.json"),
                 "--poses-in", P("frame_poses.json"), "--no-repair", "--skip", ",".join(map(str, LID_LM + OVAL_LM))], log)
            bands_ = frame_check.bands(ev_, set(hold), use_after=False)
            rep.setdefault("eval", {})[best] = {"holdout": bands_, "training": frame_check.bands(ev_, set(names) - set(hold), use_after=False),
                                                "evaluation_stage": "final surface", "evaluated_fit_sha": file_sha(P(f"fit_{best}.ply"))}
            rep["accept"] = accept_of(bands_)
        if best in rep.get("eval", {}) and "line_check" in rep:
            try:
                rep["eval"][best].update(line=rep["line_check"], line_holdout_abs=line_holdout_abs(json.load(open(P("line_check_final.json")))["per_frame"]))
            except Exception as ex:
                rep["line_check_error"] = str(ex)
    if "case" in steps and a.case_id:
        print("[7/7] 편집 케이스 생성")
        n = case_mesh(P(f"fit_{best}.ply"), P("tex"), P("case_mesh.ply")); rep["case_mesh_vertices"] = n
        ax = json.loads(run([py, os.path.join(ROOT, "tools", "colmap", "frontal_axes.py"), a.sparse, os.path.join(W, "prep", "prepare.json")], log)) \
            if os.path.exists(os.path.join(W, "prep", "prepare.json")) else None
        args = [py, f"{HERE}/build_case.py", "--input", P("case_mesh.ply"), "--case-id", a.case_id, "--input-kind", "photogrammetry_mesh",
                "--units", "unknown", "--personal", "--editable-max-verts", "60000", "--replace",
                "--app", "scan_to_model.py (multi-view landmarks + GNM template fit + UV bake)", "--sensor", f"frames {len(names)}"]
        args += [f"--up={ax['up']}", f"--fwd={ax['fwd']}"] if ax else ["--auto-orient"]
        # the editable case (nose editor) is optional for the 3D model / viewer: a failure here is reported, not fatal
        try:
            run(args, log); rep["case"] = a.case_id; rep.pop("case_error", None)
        except SystemExit as ex:
            rep["case_error"] = str(ex); print("   편집 케이스 생성 실패(뷰어는 계속 만듦):", ex)
    # provenance: the viewer / run_all check that everything shown comes from this one fit
    rep["provenance"] = {"chosen": best, "fit_sha": file_sha(P(f"fit_{best}.ply")),
                         "tex": (json.load(open(P("tex.source.json"))) if not a.shape_only and os.path.exists(P("tex.source.json")) else None),
                         "case_mesh_sha": None if a.shape_only else (file_sha(P("case_mesh.ply")) if "case" in steps else rep.get("provenance", {}).get("case_mesh_sha")),
                         "time": time.strftime("%Y-%m-%d %H:%M:%S")}
    rep["timing_sec"] = {**rep.get("timing_sec", {}), **TIMES}
    rep["timing_this_run_sec"] = dict(TIMES)
    if a.shape_only:
        for key in ("uv_bake", "eye_color", "build_case"):
            rep["timing_sec"].pop(key, None)
    json.dump(rep, open(rp, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    if a.shape_only:
        run([py, os.path.join(ROOT, "tools", "final_shape_check.py"), W, "--evaluate-only", "--sparse", a.sparse], log)
        rep = json.load(open(rp, encoding="utf-8"))
        rep["timing_this_run_sec"] = dict(TIMES)
        rep["timing_sec"].update(TIMES)
        json.dump(rep, open(rp, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print("report:", rp)


if __name__ == "__main__":
    main()
