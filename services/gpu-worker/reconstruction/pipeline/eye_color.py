"""Real eye colours measured in the photos (so the eyes match the photo-textured skin instead of looking painted).

In near-frontal frames MediaPipe gives the eye opening (16 points per eye) and the iris (468-472 / 473-477: centre + 4
points on the iris edge). Per eye and frame:
  - sclera: pixels inside the opening (shrunk a little, no lashes) and outside the iris disc (x1.12); split into the
    nasal and temporal side, plus a brightness profile from the iris edge to the eye corner (shadowed corners)
  - iris: colour profile over the radius r/R in 12 rings (visible pixels only, specular highlights removed)
Medians over frames and both eyes -> eye_color.json. PERSONAL DATA (stays in work/).
usage: python eye_color.py <images> <out.json> [--exclude holdout.txt] [--max-frames 20]
"""
import argparse, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))

EYES = {  # (opening ring, iris centre, iris edge points, inner corner, outer corner)
    "R": ([33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7], 468, [469, 470, 471, 472], 133, 33),
    "L": ([263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249], 473, [474, 475, 476, 477], 362, 263),
}
NB = 12


def main():
    import cv2
    from matplotlib.path import Path
    import face_lm
    ap = argparse.ArgumentParser()
    ap.add_argument("images"); ap.add_argument("out"); ap.add_argument("--exclude"); ap.add_argument("--max-frames", type=int, default=20)
    a = ap.parse_args()
    ex = set(open(a.exclude).read().split()) if a.exclude else set()
    cands = []
    for nm in sorted(os.listdir(a.images)):
        if nm in ex or not nm.lower().endswith((".jpg", ".png")): continue
        img = cv2.imread(os.path.join(a.images, nm))
        L, M4 = face_lm.landmarks(a.images, nm, img)
        if L is None or len(L) < 478: continue
        M = np.array(M4)[:3, :3]
        yaw = abs(np.degrees(np.arctan2(M[0, 2], M[2, 2]))); pitch = abs(np.degrees(np.arcsin(-M[1, 2])))
        if yaw > 12 or pitch > 15: continue
        H, W = img.shape[:2]; uv = np.array(L)[:, :2] * [W, H]
        # gaze roughly at the camera: iris centre near the middle of its eye
        ok = True
        for ring, c, e, ci, co in EYES.values():
            u = (uv[c] - uv[ci]) @ (uv[co] - uv[ci]) / (np.linalg.norm(uv[co] - uv[ci]) ** 2)
            ok &= 0.3 < u < 0.7
        if not ok: continue
        sharp = cv2.Laplacian(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)[int(uv[159, 1]) - 40:int(uv[145, 1]) + 40,
                                                                    int(uv[33, 0]) - 20:int(uv[263, 0]) + 20], cv2.CV_64F).var()
        cands.append((sharp, nm, uv))
    cands.sort(key=lambda c: -c[0]); cands = cands[:a.max_frames]
    scl_n, scl_t, scl_prof, iris, skin, iris_w = [], [], [], [], [], []
    CHEEKS = ([50, 101, 118, 117, 123, 187, 205, 36], [280, 330, 347, 346, 352, 411, 425, 266])
    for _, nm, uv in cands:
        img = cv2.imread(os.path.join(a.images, nm))[:, :, ::-1].astype(float)
        for ch in CHEEKS:   # cheek skin in the same frames: exposure reference for the white of the eye
            cp = uv[ch]; x0, y0 = np.floor(cp.min(0)).astype(int); x1, y1 = np.ceil(cp.max(0)).astype(int)
            ys, xs = np.mgrid[y0:y1, x0:x1]; Q = np.c_[xs.ravel(), ys.ravel()].astype(float) + 0.5
            q = img[Q[Path(cp).contains_points(Q)][:, 1].astype(int), Q[Path(cp).contains_points(Q)][:, 0].astype(int)]
            if len(q) > 20: skin.append(np.median(q, 0))
        for ring, c, e, ci, co in EYES.values():
            poly = uv[ring]; pc = poly.mean(0); poly_s = pc + (poly - pc) * 0.88
            R = np.mean(np.linalg.norm(uv[e] - uv[c], axis=1))
            iris_w.append(2 * R / np.linalg.norm(uv[co] - uv[ci]))   # iris diameter / eye width (corner to corner)
            x0, y0 = np.floor(poly.min(0)).astype(int) - 2; x1, y1 = np.ceil(poly.max(0)).astype(int) + 2
            ys, xs = np.mgrid[y0:y1, x0:x1]; P = np.c_[xs.ravel(), ys.ravel()].astype(float) + 0.5
            ins = Path(poly_s).contains_points(P)
            d = np.linalg.norm(P - uv[c], axis=1)
            px = img[P[:, 1].astype(int), P[:, 0].astype(int)]
            lum = px.mean(1)
            # sclera
            s = ins & (d > 1.12 * R)
            if s.sum() > 15:
                q = px[s]; ls = lum[s]; keep = ls > np.percentile(ls, 25)   # drop lash shadows
                ax = (uv[co] - uv[ci]); ax /= np.linalg.norm(ax)
                side = (P[s] - uv[c]) @ ax
                # colour of the LIT white (60-97th brightness percentile); the darker corners come from the profile below
                lit = (ls > np.percentile(ls, 60)) & (ls < np.percentile(ls, 97))
                nas = lit & (side < 0); tmp = lit & (side > 0)
                if nas.sum() > 2: scl_n.append(np.median(q[nas], 0))
                if tmp.sum() > 2: scl_t.append(np.median(q[tmp], 0))
                # brightness vs. distance from the iris edge (0) to the corner (1)
                half = np.linalg.norm(uv[co] - uv[ci]) / 2
                rr = np.clip((d[s] - 1.12 * R) / max(half - 1.12 * R, 1e-6), 0, 1)
                prof = [np.median(ls[keep & (rr >= b / 4) & (rr < (b + 1) / 4 + (b == 3))]) if (keep & (rr >= b / 4) & (rr < (b + 1) / 4 + (b == 3))).sum() > 3 else np.nan for b in range(4)]
                scl_prof.append(prof)
            # iris rings
            # only the left/right sectors of the iris (+-35 deg from horizontal): above and below, the lids and lash
            # shadow cover the iris edge and would tint the outer rings with skin colour
            ang = np.degrees(np.arctan2(np.abs(P[:, 1] - uv[c][1]), np.abs(P[:, 0] - uv[c][0])))
            ii = ins & (d < R) & ((ang < 35) | (d < 0.45 * R))
            if ii.sum() > 30:
                q = px[ii]; rr = d[ii] / R; li = lum[ii]
                hi = li < np.percentile(li, 92)       # specular highlight off
                iris.append([np.median(q[hi & (rr >= b / NB) & (rr < (b + 1) / NB)], 0) if (hi & (rr >= b / NB) & (rr < (b + 1) / NB)).sum() > 2
                             else [np.nan] * 3 for b in range(NB)])
    if not iris or not scl_n:
        print("eye colour: not enough frontal frames"); sys.exit(1)
    iris = np.nanmedian(np.array(iris, float), 0)
    for b in range(NB):                             # fill missing rings from neighbours
        if np.isnan(iris[b]).any(): iris[b] = iris[b - 1] if b else np.nanmedian(iris, 0)
    sp = np.nanmedian(np.array(scl_prof, float), 0); sp = sp / np.nanmax(sp)
    out = {"frames": [c[1] for c in cands], "skin_rgb": (np.median(skin, 0) / 255).tolist() if skin else None,
           "iris_to_eye_width": float(np.median(iris_w)) if iris_w else None, "sclera_nasal": (np.median(scl_n, 0) / 255).tolist(),
           "sclera_temporal": (np.median(scl_t, 0) / 255).tolist(),
           "sclera_rgb": (np.median(np.vstack([scl_n, scl_t]), 0) / 255).tolist(),
           "sclera_profile": np.nan_to_num(sp, nan=1.0).tolist(),
           "iris_profile": (iris / 255).tolist()}
    json.dump(out, open(a.out, "w"), indent=1)
    print(json.dumps({k: (np.round(v, 3).tolist() if k != "frames" else len(v)) for k, v in out.items()}))


if __name__ == "__main__":
    main()
