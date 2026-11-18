"""Texture-space registration of the per-frame colour samples (2026-10-16).

Problem: a texel takes its colour from every frame that sees it. Where the 3D shape is a little off in a frame (side views,
ears, jaw line - the side landmark error is ~3x the frontal one), that frame paints the feature a few millimetres away
from where the other frames paint it: ghost ears / jaw lines on the neck, doubled brows, a blurred average.

Method (texture-space optical flow, in the spirit of Zhou & Koltun 2014 "Color map optimization" and Bi et al. 2017):
  1. consensus texture = weighted mean of all frames (frontal frames dominate through cos^p)
  2. per frame: its own texture image (its samples; elsewhere the consensus, so the flow sees no artificial edges)
  3. dense optical flow (OpenCV DIS) consensus -> frame image: where does this frame show the feature the consensus has
  4. the frame's colour for each texel is re-read at the flowed position (only where the frame really has samples there)
  5. repeat with the sharper consensus
The flow is limited (default 2.5 % of the map) and smoothed, so it fixes misregistration but cannot invent features.
"""
import numpy as np


def _gray(img):
    return (img @ np.array([0.114, 0.587, 0.299], np.float32)).astype(np.float32)


def _remap_pts(img, mx, my):
    """bilinear read of img at many points (cv2.remap maps must stay below 32767 columns: reshaped into rows)"""
    import cv2
    n = len(mx); W = 4096; rows = (n + W - 1) // W; pad = rows * W - n
    X = np.r_[mx, np.zeros(pad, np.float32)].reshape(rows, W); Y = np.r_[my, np.zeros(pad, np.float32)].reshape(rows, W)
    out = cv2.remap(img, X, Y, cv2.INTER_LINEAR)
    return out.reshape((rows * W,) + img.shape[2:])[:n]


def align(samples, gains, valid, n0, S, iters=2, max_frac=0.025, rep=None):
    """samples: [idx, colours, weights, cos] per frame (modified in place: colours re-read, weights of samples whose
    flowed position the frame never saw set to 0). Only skin-group texels (idx < n0) are aligned."""
    import cv2
    ys, xs = np.nonzero(valid)
    assert len(ys) == n0, "texel order must be the valid mask order"
    d = 2 if S >= 1536 else 1                                   # flow on a half-size grid for 2048 maps
    sz = (S // d, S // d)
    import os, threading
    from concurrent.futures import ThreadPoolExecutor
    tl = threading.local()                                      # one DIS flow object per thread
    from parallel import workers           # LM_BAKE_WORKERS, else the job's thread budget (S15P31B204-702)
    pool = ThreadPoolExecutor(workers())
    lim = max_frac * S
    stats = []
    for it in range(iters):
        acc = np.zeros((n0, 3), np.float64); ws = np.zeros(n0)
        for k, (idx, c, w, cs) in enumerate(samples):
            m = idx < n0
            acc[idx[m]] += c[m] * gains[k] * w[m, None]; ws[idx[m]] += w[m]        # idx unique per frame
        seen = ws > 1e-4
        ref = np.zeros((n0, 3), np.float32); ref[seen] = (acc[seen] / ws[seen, None]).astype(np.float32)
        R = np.zeros((S, S, 3), np.float32); M = np.zeros((S, S), np.float32)
        R[ys[seen], xs[seen]] = ref[seen]; M[ys[seen], xs[seen]] = 1
        # fill the empty space (outside the UV islands, unseen texels) by normalized blur: no hard edges for the flow
        num = cv2.GaussianBlur(R, (0, 0), 0.01 * S); den = cv2.GaussianBlur(M, (0, 0), 0.01 * S)
        Rf = np.where(M[..., None] > 0, R, num / np.maximum(den, 1e-4)[..., None])
        g0 = cv2.resize(np.clip(_gray(Rf), 0, 255).astype(np.uint8), sz, interpolation=cv2.INTER_AREA)
        def one(k):
            idx, c, w, cs = samples[k]
            m = np.where(idx < n0)[0]
            if len(m) < 2000: return None
            t = idx[m]
            Fk = Rf.copy(); Mk = np.zeros((S, S), np.float32)
            Fk[ys[t], xs[t]] = c[m] * gains[k]; Mk[ys[t], xs[t]] = 1
            Fraw = np.zeros((S, S, 3), np.float32); Fraw[ys[t], xs[t]] = c[m]
            g1 = cv2.resize(np.clip(_gray(Fk), 0, 255).astype(np.uint8), sz, interpolation=cv2.INTER_AREA)
            dis = getattr(tl, "dis", None)
            if dis is None: dis = tl.dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
            fl = dis.calc(g0, g1, None)                          # g0(x) ~ g1(x + fl(x))
            if d > 1: fl = cv2.resize(fl, (S, S), interpolation=cv2.INTER_LINEAR) * d
            # only inside this frame's coverage (eroded: the flow at the coverage border is unreliable), smooth, limited
            cov = cv2.erode(Mk, np.ones((5, 5), np.uint8))
            fl = fl * cov[..., None]
            num = cv2.GaussianBlur(fl, (0, 0), 0.006 * S); den = cv2.GaussianBlur(cov, (0, 0), 0.006 * S)
            fl = num / np.maximum(den, 1e-3)[..., None] * (den > 0.2)[..., None]
            mag = np.linalg.norm(fl, axis=2); sc = np.minimum(1.0, lim / np.maximum(mag, 1e-6))
            fl = fl * sc[..., None]
            # re-read the frame's colour at the flowed position (bilinear on its sample image) where it has samples
            mx = (xs[t] + fl[ys[t], xs[t], 0]).astype(np.float32); my = (ys[t] + fl[ys[t], xs[t], 1]).astype(np.float32)
            col = _remap_pts(Fraw, mx, my)
            okw = _remap_pts(Mk, mx, my)
            ok = okw > 0.999
            c[m[ok]] = col[ok]
            w[m[~ok]] = 0.0
            return float(np.median(mag[ys[t], xs[t]])) / S * 100
        # frames are independent within a round (each changes only its own samples): thread pool, results in order
        mags = [x for x in pool.map(one, range(len(samples))) if x is not None]
        stats.append({"iter": it, "frames": len(mags), "median_shift_pct_map": round(float(np.median(mags)), 3) if mags else None,
                      "p90_shift_pct_map": round(float(np.percentile(mags, 90)), 3) if mags else None})
    pool.shutdown()
    if rep is not None:
        rep["texture_align"] = {"iters": iters, "max_shift_pct_map": max_frac * 100, "rounds": stats}
    return samples


class LandmarkWarp:
    """Feature-guided sampling (2026-10-16: nostrils / eye corners / lip edges painted beside the model's own features
    - dark nostril colour on the skin of the nose wing).
    Per frame: MediaPipe finds the 468 points in the PHOTO; the fitted model's same points are projected into that
    photo. The difference (where the photo shows the feature vs where the model is) is a smooth 2D displacement field,
    built only from the ANCHOR points (eyes, brows, nose incl. nostrils, lips: gnm_features) that face the camera, and
    fading to zero away from them. The photo colour of a texel is then read at  projection + displacement , so a photo
    feature lands on the model's feature. Limited to --max-frac of the eye distance."""

    def __init__(self, model_path, ids, max_frac=0.06):
        import mediapipe as mp, threading
        self.mp = mp; self.model = open(model_path, "rb").read(); self.local = threading.local()
        self.det = self._detector()      # fails here (not per frame) when the model cannot be loaded
        from gnm_features import landmark_classes
        self.anchor = landmark_classes()["anchor"]
        self.ids = np.asarray(ids); self.max_frac = max_frac; self.stats = []

    def _detector(self):
        """one FaceLandmarker per thread (uv_bake runs the frames in a thread pool; a detector is not thread safe)"""
        d = getattr(self.local, "det", None)
        if d is None:
            from mediapipe.tasks.python import vision, BaseOptions
            d = self.local.det = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
                base_options=BaseOptions(model_asset_buffer=self.model), num_faces=1))
        return d

    def field(self, img, V, vn, R, t, f, cx, cy):
        """(H, W, 2) displacement in pixels (photo - model) or None"""
        import cv2
        H, W = img.shape[:2]
        r = self._detector().detect(self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB)))
        if not r.face_landmarks: return None
        det = np.array([[p.x * W, p.y * H] for p in r.face_landmarks[0][:468]])
        P = V[self.ids] @ np.asarray(R).T + t
        proj = np.c_[f * P[:, 0] / P[:, 2] + cx, f * P[:, 1] / P[:, 2] + cy]
        cc = -np.asarray(R).T @ t; nrm = vn[self.ids]
        facing = ((cc - V[self.ids]) * nrm).sum(1) / (np.linalg.norm(cc - V[self.ids], axis=1) + 1e-12) > 0.35
        iod_px = np.linalg.norm(proj[33] - proj[263])
        a = self.anchor[facing[self.anchor]]
        if len(a) < 30 or iod_px < 20: return None
        d = det[a] - proj[a]
        mag = np.linalg.norm(d, axis=1); keep = mag < self.max_frac * iod_px
        if keep.sum() < 30: return None
        a, d = a[keep], d[keep]
        # coarse grid (1/8): Gaussian-weighted average of the anchor displacements, faded out where no anchor is near
        q = 8; gh, gw = H // q + 1, W // q + 1
        gy, gx = np.mgrid[0:gh, 0:gw]; G = np.c_[gx.ravel() * q, gy.ravel() * q].astype(np.float64)
        sg = 0.10 * iod_px
        out = np.zeros((len(G), 2)); wsum = np.zeros(len(G))
        for k in range(0, len(a), 64):
            dd = ((G[:, None, :] - proj[a[k:k + 64]][None]) ** 2).sum(2)
            wk = np.exp(-dd / (2 * sg * sg))
            out += wk @ d[k:k + 64]; wsum += wk.sum(1)
        fld = out / (wsum + 0.3)[:, None]                      # + 0.3: fades to 0 away from the anchors
        fld = fld.reshape(gh, gw, 2).astype(np.float32)
        self.stats.append(float(np.median(np.linalg.norm(d, axis=1)) / iod_px * 100))
        return cv2.resize(fld, (gw * q, gh * q), interpolation=cv2.INTER_LINEAR)[:H, :W]

    def report(self):
        s = self.stats
        return {"frames": len(s), "median_feature_offset_pct_iod": round(float(np.median(s)), 2) if s else None,
                "p90_feature_offset_pct_iod": round(float(np.percentile(s, 90)), 2) if s else None}
