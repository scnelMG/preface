"""Near-eye lid PROFILE in ~90 deg frames (10/22, 만두: "각 측면 눈꺼풀 볼륨은 90도 방면이 가장 정확하지 않아"; test worth doing).

In a true profile the NEAR eye shows its own vertical section: brow ridge -> lid mound -> crease -> lashes, as a shading edge
INSIDE the face (lid skin in front of the darker eye / nose side), not against the background - so lid_profile.py (background
outline of the FAR eye, 45-75 deg) cannot see it. This tool tests whether that profile is measurable in the current videos.

frames  per side, the registered frames (COLMAP pose) closest to 90 deg view yaw (75-105), |pitch| < 15; yaw from the camera
        centre and the model's head axes (MediaPipe does not detect faces there)
lines   N scan lines between the near eye's lash point (159 / 386) and brow (105 / 334), each along the image direction of the
        head-forward axis. Model profile = the most forward projected skin vertex of the near eye patch (EyeBasis patch 1.1) within
        1.5 px of the line. Photo profile = strongest luminance edge on the line within +-0.3 x projected eye height of the model
        point (Gaussian-smoothed derivative; lashes / iris edges can win near the lash line -> band 0 least reliable)
out     work/_trace/<id>/p90_<side>_<frame>_{photo,now,A,overlay}.png (3x crop; overlay: red = model now, orange = A; the automatic photo edge failed the
        synthetic self-test and is not drawn), profile90.json: per band (0 lash .. 2 brow) median photo - model offset along head-forward, x eye width (+ = photo in
        front = model too flat / sunken). Information only, personal data stays local.
usage   python tools/profile90.py <id> [--a <id>-lidp] [--frames 2] [--lines 24]
"""
import argparse, json, os, sys
import numpy as np
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, os.path.join(ROOT, "pipeline")); sys.path.insert(0, os.path.join(ROOT, "tools"))
EYE = {"R": {"lash": 159, "brow": 105, "corners": (33, 133)}, "L": {"lash": 386, "brow": 334, "corners": (263, 362)}}


def contour_profile(V, F, B, E, S, R, t, f, cx, cy, box, k, lash3, brow3, fwd2, nlines, pj):
    """[(line index, origin px, forward offset px)]: how far forward the LID MOUND reaches on each scan line (10/22, third version).
    Each scan line back-projects to a plane through the camera; the lid proper (skin, u 0.15..0.85, lash .. brow) is cut by that
    plane triangle by triangle (smooth, interpolated) and the most forward cut point is the model profile on that line.
    History (만두 10/22 "지진파처럼 진동"): most forward VERTEX per line hopped between base vertices; the outline of the cut-out lid
    region traced its staircase edge near the nose. An occluding contour of the lid does not exist on the current models at 90 deg:
    the lid surface runs smoothly into the nose side (still facing the camera) - the photo's lid profile comes from a mound that
    folds in front of the nose side, which the models lack."""
    uv = E["uv"]; lid = B.skin & (uv[:, 0] > 0.15) & (uv[:, 0] < 0.85) & (uv[:, 1] > E["lash_v"] - 0.01) & (uv[:, 1] < E["brow_v"] + 0.05)
    skinF = F[B.skin[F].all(1)]; Fl = skinF[lid[skinF].any(1)]
    Xc = V @ R.T + t; perp = np.array([-fwd2[1], fwd2[0]]); out = []
    for i in range(nlines):
        r = (i + 0.5) / nlines; o = pj(lash3 + r * (brow3 - lash3))[0][0]
        nc = np.array([f * perp[0], f * perp[1], (cx - o[0]) * perp[0] + (cy - o[1]) * perp[1]])   # plane of the scan line (camera frame)
        d = Xc @ nc; dt = d[Fl]; cross = (dt.min(1) < 0) & (dt.max(1) > 0)
        pts = []
        for tri, dv in zip(Fl[cross], dt[cross]):
            for a_, b_ in ((0, 1), (1, 2), (2, 0)):
                if (dv[a_] > 0) != (dv[b_] > 0):
                    u_ = dv[a_] / (dv[a_] - dv[b_]); pts.append(V[tri[a_]] + u_ * (V[tri[b_]] - V[tri[a_]]))
        if not pts: continue
        q = pj(np.array(pts))[0]; out.append((i, o, float(((q - o) @ fwd2).max())))
    return out

def main():
    import cv2, pycolmap
    import trace_sheet as TS
    from frame_check import intrinsics
    from template_fit import head_axes
    from eye_parts import EyeBasis
    ap = argparse.ArgumentParser(); ap.add_argument("id"); ap.add_argument("--a", default=""); ap.add_argument("--frames", type=int, default=2); ap.add_argument("--lines", type=int, default=60)
    ap.add_argument("--synthetic", action="store_true", help="self-test: the photo is replaced by the grey render of the 'now' model (offsets must be ~0)")
    a = ap.parse_args()
    W = os.path.join(ROOT, "work", a.id); OUT = os.path.join(ROOT, "work", "_trace", a.id); os.makedirs(OUT, exist_ok=True)
    rec = pycolmap.Reconstruction(os.path.join(W, "colmap", "sparse_lens_anchored")); f, cx, cy = intrinsics(list(rec.cameras.values())[0])
    meshes = {"now": TS.load_fit(a.id)}
    if a.a and os.path.exists(os.path.join(ROOT, "work", a.a, "model", "report.json")): meshes["A"] = TS.load_fit(a.a)
    V0, F0, lid0, _ = meshes["now"]; L0 = V0[lid0]; ax = head_axes(L0); hc = L0[[33, 263, 1]].mean(0)
    cand = []
    for im in rec.images.values():
        T = im.cam_from_world(); R = T.rotation.matrix(); t = np.asarray(T.translation); C = -R.T @ t; d = (C - hc) / np.linalg.norm(C - hc)
        yaw = float(np.degrees(np.arctan2(d @ ax[0], d @ ax[2]))); pitch = float(np.degrees(np.arcsin(np.clip(d @ ax[1], -1, 1))))
        if 75 <= abs(yaw) <= 105 and abs(pitch) < 15: cand.append((abs(abs(yaw) - 90) + 0.5 * abs(pitch), yaw, pitch, im.name, R, t))
    out = {"id": a.id, "method": "drawn: model lid-mound front (red now / orange A) = model surface of the lid proper cut by each scan-line plane; compare with a traced lid profile (tools/profile90 + trace). outline_* = face outline vs background (information only: at lid heights the outline is the far brow / nose bridge)", "units": "photo - model along head-forward, x eye width (+ = photo in front: model too flat / sunken)", "frames": []}
    T0 = np.load(os.path.join(ROOT, "assets", "gnm-template-v2.npz")); MAT, COMP, FT = T0["materials"], T0["components"], T0["triangles"].astype(np.int64)
    bases = {name: EyeBasis(V, FT, MAT, COMP, lid, patch=1.1) for name, (V, F, lid, ch) in meshes.items()}
    for sgn in (1, -1):
        cs = sorted([c for c in cand if np.sign(c[1]) == sgn])[:a.frames]
        for _, yaw, pitch, n, R, t in cs:
            def pj(X):
                Q = np.atleast_2d(X) @ R.T + t; return np.c_[f * Q[:, 0] / Q[:, 2] + cx, f * Q[:, 1] / Q[:, 2] + cy], Q[:, 2]
            # near eye: the eye whose corners are closer to the camera
            S = min("RL", key=lambda s: pj(L0[list(EYE[s]["corners"])])[1].mean())
            e = EYE[S]; ew = float(np.linalg.norm(L0[e["corners"][0]] - L0[e["corners"][1]]))
            pts, _ = pj(L0[[e["lash"], e["brow"], *e["corners"], 6, 168]])
            img = cv2.imread(os.path.join(W, "prep", "images", n)); H, Wd = img.shape[:2]
            span = max(np.ptp(pts[:, 0]), np.ptp(pts[:, 1]), 30.0); m = 0.6 * span
            x0 = int(max(0, pts[:, 0].min() - m)); x1 = int(min(Wd, pts[:, 0].max() + m)); y0 = int(max(0, pts[:, 1].min() - m)); y1 = int(min(H, pts[:, 1].max() + m))
            k = 3.0
            if a.synthetic:
                gsyn = TS.cam_render(V0, F0, R, t, f, (x0, y0, x1 - x0, y1 - y0, cx, cy), k)[:, :, ::-1]
                img = img.copy(); img[y0:y1, x0:x1] = cv2.resize(gsyn, (x1 - x0, y1 - y0), interpolation=cv2.INTER_AREA)[: y1 - y0, : x1 - x0]
            gray = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32), (0, 0), 1.2)
            fr = {"frame": n, "view_yaw": round(yaw, 1), "view_pitch": round(pitch, 1), "near_eye": S, "crop_px": [x0, y0, x1 - x0, y1 - y0], "models": {}}
            cmp_ = cv2.imread(os.path.join(W, "prep", "class_masks_v3", n + ".png"), -1)
            fgp = None if cmp_ is None else (cmp_ > 0)
            fr["photo_mask"] = "class_masks_v3 > 0" if fgp is not None else "missing"
            if a.synthetic:      # self-test: the photo foreground = the 'now' model render (offsets must be ~0)
                gs_ = TS.cam_render(V0, F0, R, t, f, (x0, y0, x1 - x0, y1 - y0, cx, cy), 3.0)
                fs_ = (np.abs(gs_.astype(int) - [250, 250, 252]).sum(2) >= 6).astype(np.uint8)
                fgp = np.zeros(img.shape[:2], bool); fgp[y0:y1, x0:x1] = cv2.resize(fs_, (x1 - x0, y1 - y0), interpolation=cv2.INTER_NEAREST)[: y1 - y0, : x1 - x0] > 0
            photo_crop = cv2.resize(img[y0:y1, x0:x1], ((x1 - x0) * 3, (y1 - y0) * 3), interpolation=cv2.INTER_CUBIC); overlay = photo_crop.copy()
            for name, (V, F, lid, ch) in meshes.items():
                B = bases[name]; E = B.eyes[S]; L = V[lid]
                pv, z = pj(V); uvE = E["uv"]
                # the lid / brow of THIS eye only (u 0 outer .. 1 inner corner, lash .. brow + 0.1): the patch also holds the nose side,
                # which projects in front of the lid at 90 deg (synthetic self-test: +0.05..0.10 bias before this restriction)
                skin = B.skin & E["patch"] & (uvE[:, 0] > -0.05) & (uvE[:, 0] < 1.0) & (uvE[:, 1] > E["lash_v"] - 0.02) & (uvE[:, 1] < E["brow_v"] + 0.1)
                # visibility: model vertices not hidden (render depth test)
                g = TS.cam_render(V, F, R, t, f, (x0, y0, x1 - x0, y1 - y0, cx, cy), k)
                cv2.imwrite(os.path.join(OUT, f"p90_{'p' if sgn > 0 else 'm'}{abs(round(yaw))}_{os.path.splitext(n)[0][-5:]}_{name}.png"), g[:, :, ::-1])
                fwd2 = pj(L[e["lash"]] + ax[2] * 0.05 * ew)[0][0] - pj(L[e["lash"]])[0][0]; fwd2 /= np.linalg.norm(fwd2) + 1e-12
                lash3, brow3 = L[e["lash"]], L[e["brow"]]; px_ew = float(np.linalg.norm(pj(lash3 + ax[2] * ew)[0][0] - pj(lash3)[0][0]))
                ew_img = float(np.linalg.norm(pj(lash3)[0][0] - pj(brow3)[0][0]))
                # model profile = the lid's OCCLUDING CONTOUR (10/22): zero level of g = n . (C - x) on the skin around this eye, linearly
                # interpolated inside the triangles (smooth, not vertex-hopping), kept where the full render's depth buffer shows it.
                # (1st try: most forward vertex per line -> jagged; 2nd: outline of the cut-out lid region -> its staircase boundary near
                # the nose was the most forward edge. 만두 10/22 "지진파처럼 진동")
                # 4th version (10/22, 만두 woo02: "하늘색 선이 맞아, overlay는 틀렸어"): at ~90 deg the traced lid profile IS the face
                # outline against the background at those heights. Compare outline with outline: model = first exit from the full
                # render (skin + eyes) walking forward along each scan line from inside the face; photo = first exit from the
                # multiclass foreground mask (class_masks_v3 > 0). Both are background boundaries -> no weak inner edge involved.
                gfg = np.abs(g.astype(int) - [250, 250, 252]).sum(2) >= 6
                def first_exit(o, fg_fn):
                    ss = np.arange(-0.4 * ew_img, 1.5 * ew_img, 0.25); q = o[None] + ss[:, None] * fwd2[None]; m = fg_fn(q)
                    inside = np.where(m)[0]
                    if not len(inside): return None
                    j = inside[0]
                    while j + 1 < len(m) and m[j + 1]: j += 1
                    return float(ss[j]) if j + 1 < len(m) else None
                def model_fg(q):
                    c = ((q - [x0, y0]) * k).astype(int); ok = (c[:, 0] >= 0) & (c[:, 0] < gfg.shape[1]) & (c[:, 1] >= 0) & (c[:, 1] < gfg.shape[0])
                    out = np.zeros(len(q), bool); out[ok] = gfg[c[ok, 1], c[ok, 0]]; return out
                def photo_fg(q):
                    c = q.astype(int); ok = (c[:, 0] >= 0) & (c[:, 0] < fgp.shape[1]) & (c[:, 1] >= 0) & (c[:, 1] < fgp.shape[0])
                    out = np.zeros(len(q), bool); out[ok] = fgp[c[ok, 1], c[ok, 0]]; return out
                rows = []; prof = []; profp = []
                for i in range(a.lines):
                    r = (i + 0.5) / a.lines; o = pj(lash3 + r * (brow3 - lash3))[0][0]
                    sm = first_exit(o, model_fg); sp = first_exit(o, photo_fg) if fgp is not None else None
                    if sm is not None: prof.append(o + sm * fwd2)
                    if sp is not None and name == "now": profp.append(o + sp * fwd2)
                    if sm is not None and sp is not None:
                        rows.append({"rel": round(r, 3), "band": min(int(r * 3), 2), "offset_x_ew": round(float((sp - sm) / px_ew), 4)})
                bands = []
                for b in range(3):
                    v = [x["offset_x_ew"] for x in rows if x["band"] == b]
                    bands.append({"median": round(float(np.median(v)), 4) if v else None, "n": len(v)})
                fr["models"][name] = {"chosen": ch, "bands": bands, "px_per_eye_width_forward": round(px_ew, 1),
                                      "rows": [[x["rel"], x["offset_x_ew"]] for x in rows]}
                # outline numbers are kept for information only (10/22 woo02 check: at lid heights the face outline is the far brow /
                # nose bridge, 0.1-0.2 x eye width in front of the traced lid profile -> it does not stand in for the lid)
                fr["models"][name]["outline_bands"] = fr["models"][name].pop("bands"); fr["models"][name]["outline_rows"] = fr["models"][name].pop("rows")
                fr["models"][name]["outline_px"] = [[round(float(c_), 2) for c_ in q_] for q_ in prof]
                if name == "now" and len(profp) > 1: fr["photo_outline_px"] = [[round(float(c_), 2) for c_ in q_] for q_ in profp]
                # DRAWN: the model lid-mound front (v3) - the model surface cut by each scan-line plane; compare with the traced lid profile
                lf = contour_profile(V, F, B, E, S, R, t, f, cx, cy, (x0, y0, x1 - x0, y1 - y0), k, lash3, brow3, fwd2, a.lines, pj)
                fr["models"][name]["lid_front_px"] = [[round(float(c_), 2) for c_ in (o_ + s_ * fwd2)] for (_, o_, s_) in lf]
                col = (0, 0, 255) if name == "now" else (0, 140, 255)
                pm = np.array([(o_ + s_ * fwd2 - [x0, y0]) * 3 for (_, o_, s_) in lf])
                if len(pm) > 1: cv2.polylines(overlay, [pm.astype(np.int32)], False, col, 2)
                fr["models"][name]["lash_brow_px"] = round(ew_img, 1)
            tag = f"p90_{'p' if sgn > 0 else 'm'}{abs(round(yaw))}_{os.path.splitext(n)[0][-5:]}"
            if not a.synthetic: cv2.imwrite(os.path.join(OUT, f"{tag}_photo.png"), photo_crop); cv2.imwrite(os.path.join(OUT, f"{tag}_overlay.png"), overlay)
            out["frames"].append(fr)
    json.dump(out, open(os.path.join(OUT, "profile90_synthetic.json" if a.synthetic else "profile90.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    for fr in out["frames"]:
        print(a.id, fr["frame"][-9:], fr["view_yaw"], fr["near_eye"], {k: len(v.get('lid_front_px', [])) for k, v in fr["models"].items()})


if __name__ == "__main__":
    main()
