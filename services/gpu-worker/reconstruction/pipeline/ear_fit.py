"""Ear placement from the side-view photos (2026-10-16, v2 with the multiclass segmentation).

Ears carry no MediaPipe landmark, so after the statistical fit an ear sits where the average head has it (woo01: too
high / too far back; the photo's ear was painted onto the cheek and neck). Each ear is moved as a whole (shift along
the head's up / forward axes + scale about its root) to where the side photos show it.

Score of a placement, per side frame in which that ear faces the camera (class map: 1 hair, 2/3 skin):
  + share of SKIN under the projected ear (an ear is skin)
  + share of NOT-SKIN (hair / background) in a ring just BEHIND / ABOVE the projected ear: an ear stands out of the
    head side, with hair or background behind it. This is what tells the ear from the cheek - v1 (colour skin share
    + edges only) slid the ear onto the cheek, where everything around is skin as well.
  - a prior keeping it near the statistical position
Grid search + refinement; the move is blended into the head skin around the ear root (no tear).

Contour fit (S15P31B204-331, default since 2026-11-09): the score above is almost flat ALONG the skin / hair border, so
the ear could sit anywhere on it (zu01 right: lobe on the cheek). Now each placement (up / forward shift, scale and
TILT about the ear root) is scored by how far the model ear's back / top / lobe rim lies from the photo's class border
(skin / hair / background, face skin / neck skin) - a line, not an area, so it pins the ear. The front rim joins the
cheek and shows no border; it is left out. Per side: when the side frames each want a different placement (hair, a
wrong border), or the best placement is on a search limit, that ear is not trusted and takes the other ear's move
(mirrored: same up / forward / scale / tilt about the head's left-right axis). Neither ear trusted -> the area score.
"""
import numpy as np


def _axes(L):
    x = L[454] - L[234]; x /= np.linalg.norm(x)
    up = L[10] - L[152]; up -= x * (up @ x); up /= np.linalg.norm(up)
    fw = np.cross(x, up)
    if (L[1] - (L[234] + L[454]) / 2) @ fw < 0: fw = -fw
    return x, up, fw


def _rot(k, deg):
    """rotation by deg about the unit axis k (Rodrigues)"""
    a = np.deg2rad(deg)
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + np.sin(a) * K + (1 - np.cos(a)) * (K @ K)


def _ear_parts(V, F, ear_w, side_mask, x):
    """{side: (sgn, ear vertex ids, ear triangles in those ids, root, blend weight per vertex)}"""
    from scipy.sparse import coo_matrix
    ii = np.concatenate([F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]])
    jj = np.concatenate([F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]])
    Adj = coo_matrix((np.ones(len(ii)), (ii, jj)), shape=(len(V), len(V))).tocsr(); deg = np.maximum(np.asarray(Adj.sum(1)).ravel(), 1)
    parts = {}
    for side, sgn in (("left", 1), ("right", -1)):
        core = (ear_w > 0.5) & (side_mask == sgn)
        if core.sum() < 50: continue
        wv = np.where(side_mask == sgn, ear_w, 0.0).astype(np.float64)
        for _ in range(8): wv = np.maximum(wv, 0.5 * wv + 0.5 * (Adj @ wv) / deg)
        E = np.where(core)[0]
        triE = np.searchsorted(E, F[np.isin(F, E).all(1)])
        lat = (V[E] - V[E].mean(0)) @ (sgn * x)
        parts[side] = (sgn, E, triE, V[E][lat < np.percentile(lat, 30)].mean(0), np.clip(wv, 0, 1))
    return parts


def adjust_ears(V, F, ear_w, side_mask, obs, L, rep, method="contour"):
    """method contour (default) or area (the 2026-10-19 score). Contour falls back to area when neither ear is trusted."""
    if method == "contour":
        out = adjust_ears_contour(V, F, ear_w, side_mask, obs, L, rep)
        if out is not None: return out
    out = adjust_ears_area(V, F, ear_w, side_mask, obs, L, rep)
    for v in rep.get("ear_fit", {}).values(): v["method"] = "area"
    return out


def adjust_ears_contour(V, F, ear_w, side_mask, obs, L, rep, search=0.15, step=0.03, scales=(0.9, 1.0, 1.1, 1.2),
                        tilts=(-15.0, -7.5, 0.0, 7.5, 15.0), prior=0.12, q=2, tau=0.04, min_gain=0.03, min_skin=0.45,
                        max_spread=0.06, max_asym=0.10, top_k=10):
    """-> moved vertices, or None (neither ear trusted: the caller uses the area score). Records rep["ear_fit"].
    cost of a placement in one frame = mean over the rim pixels of min(distance to the nearest class border, tau x IOD)
    / (tau x IOD): 0 = the rim lies on the border, 1 = nowhere near one. Stable = at most a third of the frames have
    their own best placement farther than max_spread (x IOD) from the joint one."""
    import cv2
    from parallel import fork_map
    x, up, fw = _axes(L)
    iod = np.linalg.norm(L[33] - L[263])
    parts = _ear_parts(V, F, ear_w, side_mask, x)
    info, plans = {}, {}
    for side, (sgn, E, triE, root, wv) in parts.items():
        VE = V[E]
        frames = []
        for o in obs:
            if len(o) < 12 or o[11] is None: continue
            n, R, t, f, cx, cy = o[:6]; cm = o[11]
            R = np.asarray(R); cc = -R.T @ np.asarray(t)
            vdir = cc - VE.mean(0); vdir /= np.linalg.norm(vdir)
            if vdir @ (sgn * x) < 0.45: continue                       # this ear does not face the camera
            small = cv2.resize(cm, (cm.shape[1] // q, cm.shape[0] // q), interpolation=cv2.INTER_NEAREST)
            lab = np.where(np.isin(small, [2, 3]), small, 0)           # 0 not skin, 2 body (neck) skin, 3 face skin
            edge = np.zeros(lab.shape, bool)
            edge[:, 1:] |= lab[:, 1:] != lab[:, :-1]; edge[1:, :] |= lab[1:, :] != lab[:-1, :]
            dt = cv2.distanceTransform((~edge).astype(np.uint8), cv2.DIST_L2, 3)
            fd = (R @ fw)[:2]; fd /= np.linalg.norm(fd) + 1e-9           # the face's forward direction in the image
            frames.append((R, np.asarray(t), f / q, cx / q, cy / q, dt, lab > 0, fd))
        if len(frames) < 2:
            info[side] = {"method": "contour", "applied": False, "frames": len(frames)}; continue

        def rim(P, R, t, f, cx, cy, dt, skin, fd, skin_share=None):
            """-> (back / top / lobe rim pixels of the drawn ear, median ear depth), or None (off the frame / too small)"""
            Q = P @ R.T + t; uv = np.c_[f * Q[:, 0] / Q[:, 2] + cx, f * Q[:, 1] / Q[:, 2] + cy]
            Hs, Ws = dt.shape
            pts = np.round(uv[triE]).astype(np.int32); pf = pts.reshape(-1, 2)
            x0, y0 = (int(c) for c in np.maximum(pf.min(0) - 1, 0)); x1, y1 = (int(c) for c in np.minimum(pf.max(0) + 2, (Ws, Hs)))
            if x0 >= x1 or y0 >= y1: return None
            em = np.zeros((y1 - y0, x1 - x0), np.uint8)
            cv2.fillPoly(em, list(pts - np.array([x0, y0], np.int32)), 1)
            if em.sum() < 20: return None
            if skin_share is not None: skin_share.append(skin[y0:y1, x0:x1][em > 0].mean())
            cs, _ = cv2.findContours(em, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            c = np.concatenate([k.reshape(-1, 2) for k in cs]) + np.array([x0, y0])
            dv = c - c.mean(0); dv /= np.linalg.norm(dv, axis=1, keepdims=True) + 1e-9
            return c[dv @ fd < 0.3], np.median(Q[:, 2])                  # the front rim joins the cheek: left out

        def costs(dy, dz, s, tl, skin_share=None):
            P = root + s * ((VE - root) @ _rot(x, tl).T) + dy * iod * up + dz * iod * fw
            out = []
            for fr in frames:
                r = rim(P, *fr, skin_share=skin_share)
                if r is None or not len(r[0]): out.append(1.0); continue
                c, z = r; dt = fr[5]; tp = tau * fr[2] * iod / z
                out.append(float(np.minimum(dt[c[:, 1], c[:, 0]], tp).mean() / tp))
            return np.array(out)

        D = np.array([(a_, b_) for a_ in np.arange(-search, search + 1e-9, step) for b_ in np.arange(-search, search + 1e-9, step)])
        D3 = D[:, :1] * iod * up + D[:, 1:] * iod * fw

        def grid_costs(st):
            """costs (shifts of D, frames) at one scale / tilt. S15P31B204-769: the ear is drawn ONCE per frame (no shift)
            and its rim moved by each shift's image offset of the ear centre; the depth (cost scale) is exact. Drawing
            every shift (2,420 x 5-9 frames per ear) made this the slowest step of the model stage (11/11: 35-79 s of
            100-160 s). Moved rims differ from a redraw by a pixel's rounding (mean cost |diff| p95 ~0.02), so the
            best ones are redrawn below; the refinement redraws too."""
            P = root + st[0] * ((VE - root) @ _rot(x, st[1]).T)
            out = np.ones((len(D), len(frames)))
            for j, fr in enumerate(frames):
                r = rim(P, *fr)
                if r is None or not len(r[0]): continue
                (c, z), (R, t, f), dt = r, fr[:3], fr[5]
                Hs, Ws = dt.shape
                c0 = P.mean(0) @ R.T + t; cd = c0 + D3 @ R.T
                off = f * (cd[:, :2] / cd[:, 2:] - c0[:2] / c0[2])
                tp = tau * f * iod / (z + (D3 @ R.T)[:, 2])
                px = np.rint(c[None] + off[:, None]).astype(np.int64)
                inside = (px[..., 0] >= 0) & (px[..., 0] < Ws) & (px[..., 1] >= 0) & (px[..., 1] < Hs)
                d = dt[px[..., 1].clip(0, Hs - 1), px[..., 0].clip(0, Ws - 1)]
                out[:, j] = np.where(inside, np.minimum(d, tp[:, None]), tp[:, None]).mean(1) / tp
            return out

        def pen(dy, dz, s, tl):
            return ((dy ** 2 + dz ** 2) / prior ** 2) * 0.05 + ((s - 1) / 0.15) ** 2 * 0.05 + (tl / 20) ** 2 * 0.05
        vis = []
        c0 = costs(0, 0, 1.0, 0.0, vis); base = c0.mean()
        skin_at_stat = float(np.median(vis)) if vis else 0.0
        if skin_at_stat < min_skin:
            info[side] = {"method": "contour", "applied": False, "frames": len(frames), "reason": "ear covered (hair?)",
                          "skin_share_at_statistical": round(skin_at_stat, 2)}
            continue
        combos = [(s_, tl_) for s_ in scales for tl_ in tilts]
        cand = [(dy_, dz_, s_, tl_) for s_, tl_ in combos for dy_, dz_ in D]
        C = np.concatenate(fork_map(grid_costs, combos))               # (placements, frames), offset-moved rims
        Pn = np.array([pen(*c_) for c_ in cand])
        # redraw (exact) the top_k best and every shift at the winner's scale / tilt (the frames' own best below): the
        # winner is then the exact grid winner - in 10 / 10 ears (11/11) it was 1st or 2nd of the offset-moved order
        top = [int(k) for k in np.argsort(C.mean(1) + Pn, kind="stable")[:top_k]]
        C[top] = fork_map(lambda k: costs(*cand[k]), top)
        i = min(top, key=lambda k: (C[k].mean() + Pn[k], k))
        sel = [k for k in range(len(cand)) if cand[k][2:] == cand[i][2:] and k not in top]
        if sel: C[sel] = fork_map(lambda k: costs(*cand[k]), sel)
        ex = sorted(top + sel)
        i = ex[int(np.argmin(C[ex].mean(1) + Pn[ex]))]; dy, dz, s, tl = cand[i]; sc = C[i].mean() + Pn[i]
        same = np.array([c_[2:] == (s, tl) for c_ in cand])             # each frame's own best at the joint scale / tilt
        own = np.array([cand[j][:2] for j in np.where(same)[0][np.argmin((C + Pn[:, None])[same], 0)]])
        far = np.linalg.norm(own - np.array([dy, dz]), axis=1) > max_spread
        for _ in range(2):
            for ddy in (-step / 2, 0, step / 2):
                for ddz in (-step / 2, 0, step / 2):
                    for ds in (-0.03, 0, 0.03):
                        for dtl in (-3.0, 0, 3.0):
                            v_ = costs(dy + ddy, dz + ddz, s + ds, tl + dtl).mean() + pen(dy + ddy, dz + ddz, s + ds, tl + dtl)
                            if v_ < sc: sc, dy, dz, s, tl = v_, dy + ddy, dz + ddz, s + ds, tl + dtl
        rec ={"method": "contour", "frames": len(frames), "shift_up_pct_iod": round(dy * 100, 1),
               "shift_forward_pct_iod": round(dz * 100, 1), "scale": round(s, 3), "tilt_deg": round(tl, 1),
               "cost_before": round(float(base), 3), "cost_after": round(float(sc), 3),
               "skin_share_at_statistical": round(skin_at_stat, 2), "frames_disagree": int(far.sum()),
               "frame_best_pct_iod": [[round(a * 100, 1), round(b * 100, 1)] for a, b in own]}
        why = None
        if max(abs(dy), abs(dz)) >= search - 1e-9: why = "best placement on the search limit (not trusted)"
        elif not min(scales) < s < max(scales) or abs(tl) >= max(tilts): why = "scale / tilt on the search limit (not trusted)"
        elif far.sum() * 3 > len(frames): why = "side frames disagree (not trusted)"
        elif base - sc < min_gain: why = "gain too small"
        if why:
            info[side] = {"applied": False, "reason": why, **rec}; continue
        plans[side] = (base - sc, dy, dz, s, tl)
        info[side] = {"applied": True, **rec}
    if len(plans) == 2 and np.hypot(plans["left"][1] - plans["right"][1], plans["left"][2] - plans["right"][2]) > max_asym:
        weak = "left" if plans["left"][0] < plans["right"][0] else "right"
        plans.pop(weak); info[weak]["applied"] = False; info[weak]["reason"] = "left / right moves disagree"
    if not plans:
        rep["ear_fit_contour"] = info                                   # kept for the record; the area score decides
        return None
    if len(plans) == 1:                                                 # the other ear: mirrored move of the trusted one
        src = next(iter(plans)); other = "right" if src == "left" else "left"
        if other in parts:
            plans[other] = plans[src]
            o = info.get(other, {"method": "contour"})                  # record the move applied, its own search under "own"
            mv = {k: info[src][k] for k in ("shift_up_pct_iod", "shift_forward_pct_iod", "scale", "tilt_deg")}
            info[other] = {"method": "contour", "applied": True, "reason": o.get("reason"), "copied_from": src, **mv,
                           "own": {k: v for k, v in o.items() if k not in ("method", "applied", "reason")}}
    out = V.copy()
    for side, (_, dy, dz, s, tl) in plans.items():
        _, _, _, root, wv = parts[side]
        tgt = root + s * ((V - root) @ _rot(x, tl).T) + dy * iod * up + dz * iod * fw
        out = out + wv[:, None] * (tgt - V)
    rep["ear_fit"] = info
    return out


def adjust_ears_area(V, F, ear_w, side_mask, obs, L, rep, search=0.15, step=0.03, prior=0.12, q=4, min_gain=0.04,
                     max_asym=0.10, min_skin=0.45):
    """2026-10-19 safeguards (woo01: long hair over the right ear -> the search slid that ear 24 % IOD forward and 18 %
    down onto the cheek, the blend dragged the skin into streaks):
      - search range 20 -> 15 % IOD; a best placement ON the search limit is not trusted (not applied)
      - the ear must be visible: median skin share under the statistical ear >= min_skin in its side frames, else the
        ear is covered (hair) and keeps the statistical position
      - gain >= min_gain, and left / right moves must agree within max_asym (% IOD / 100); otherwise the side with the
        smaller gain is not moved (ears sit symmetrically on a head to a few mm)"""
    import cv2
    from scipy.sparse import coo_matrix
    x, up, fw = _axes(L)
    iod = np.linalg.norm(L[33] - L[263])
    ii = np.concatenate([F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]])
    jj = np.concatenate([F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]])
    Adj = coo_matrix((np.ones(len(ii)), (ii, jj)), shape=(len(V), len(V))).tocsr(); deg = np.maximum(np.asarray(Adj.sum(1)).ravel(), 1)
    out = V.copy(); info = {}; plans = {}
    for side, sgn in (("left", 1), ("right", -1)):
        core = (ear_w > 0.5) & (side_mask == sgn)
        if core.sum() < 50: continue
        wv = np.where(side_mask == sgn, ear_w, 0.0).astype(np.float64)
        for _ in range(8): wv = np.maximum(wv, 0.5 * wv + 0.5 * (Adj @ wv) / deg)
        wv = np.clip(wv, 0, 1)
        E = np.where(core)[0]
        tri = F[np.isin(F, E).all(1)]
        VE, triE = V[E], np.searchsorted(E, tri)                        # the score only looks at the ear (S15P31B204-469)
        lat = (V[E] - V[E].mean(0)) @ (sgn * x)
        root = V[E][lat < np.percentile(lat, 30)].mean(0)
        frames = []
        for o in obs:
            if len(o) < 12 or o[11] is None: continue
            n, R, t, f, cx, cy = o[:6]; cm = o[11]
            R = np.asarray(R); cc = -R.T @ t
            vdir = cc - V[E].mean(0); vdir /= np.linalg.norm(vdir)
            if vdir @ (sgn * x) < 0.45: continue                       # this ear does not face the camera
            small = cv2.resize(cm, (cm.shape[1] // q, cm.shape[0] // q), interpolation=cv2.INTER_NEAREST)
            skin = np.isin(small, [2, 3]); nonskin = np.isin(small, [0, 1])
            frames.append((R, np.asarray(t), f / q, cx / q, cy / q, skin, nonskin))
        if len(frames) < 2:
            info[side] = {"applied": False, "frames": len(frames)}; continue
        back3 = -fw + 0.5 * up                                          # behind and above the ear: hair / background

        def score(dy, dz, s, parts=None):
            P = root + s * (VE - root) + dy * iod * up + dz * iod * fw
            tot = 0.0
            for R, t, f, cx, cy, skin, nonskin in frames:
                Q = P @ R.T + t; u = f * Q[:, 0] / Q[:, 2] + cx; v = f * Q[:, 1] / Q[:, 2] + cy
                Hs, Ws = skin.shape
                uvE = np.c_[u, v]
                # the ear's box only, not the whole frame (S15P31B204-469: 13.9 s of gnm_fit). Same pixels: the fill stays
                # inside its vertices' box, the ring inside that box + ring_px, both boxes clipped to the frame like the fill
                pts = np.round(uvE[triE]).astype(np.int32)
                pf = pts.reshape(-1, 2).astype(np.int64)
                x0, y0 = (int(c) for c in np.maximum(pf.min(0) - 1, 0)); x1, y1 = (int(c) for c in np.minimum(pf.max(0) + 2, (Ws, Hs)))
                if x0 >= x1 or y0 >= y1: return -1e9                     # the ear is off the frame (area 0)
                em = np.zeros((y1 - y0, x1 - x0), np.uint8)
                cv2.fillPoly(em, list(pts - np.array([x0, y0], np.int32)), 1)
                area = em.sum()
                if area < 20: return -1e9
                ring_px = max(2, int(0.08 * f * iod / np.median(Q[:, 2])))
                X0, Y0 = max(x0 - ring_px - 1, 0), max(y0 - ring_px - 1, 0); X1, Y1 = min(x1 + ring_px + 1, Ws), min(y1 + ring_px + 1, Hs)
                emr = np.zeros((Y1 - Y0, X1 - X0), np.uint8); emr[y0 - Y0:y1 - Y0, x0 - X0:x1 - X0] = em
                ring = cv2.dilate(emr, np.ones((2 * ring_px + 1, 2 * ring_px + 1), np.uint8)) - emr
                ys, xs = np.nonzero(ring); ys = ys + Y0; xs = xs + X0
                c0 = uvE.mean(0)
                bd = (R @ back3)[:2]; bd /= np.linalg.norm(bd) + 1e-9
                post = ((np.c_[xs, ys] - c0) @ bd) > 0
                inside = skin[y0:y1, x0:x1][em > 0].mean()
                outside = nonskin[ys[post], xs[post]].mean() if post.any() else 0.0
                tot += inside + outside
                if parts is not None: parts.append(inside)
            tot /= len(frames)
            return tot - ((dy ** 2 + dz ** 2) / prior ** 2) * 0.05 - ((s - 1) / 0.15) ** 2 * 0.05
        vis = []
        base = score(0, 0, 1.0, vis); best = (base, 0.0, 0.0, 1.0)
        skin_at_stat = float(np.median(vis)) if vis else 0.0
        if skin_at_stat < min_skin:
            info[side] = {"applied": False, "frames": len(frames), "reason": "ear covered (hair?)",
                          "skin_share_at_statistical": round(skin_at_stat, 2)}
            continue
        grid = np.arange(-search, search + 1e-9, step)
        # the 484 placements are independent: scored side by side, then read in the old loop order (S15P31B204-702) -
        # the same placement wins (the first one with the highest score). Processes: score() is a Python loop
        cand = [(dy, dz, s) for s in (0.85, 0.92, 1.0, 1.08) for dy in grid for dz in grid]
        from parallel import fork_map
        scores = fork_map(lambda c: score(*c), cand)
        for (dy, dz, s), sc in zip(cand, scores):
            if sc > best[0]: best = (sc, dy, dz, s)
        sc, dy, dz, s = best
        for _ in range(2):
            for ddy in (-step / 2, 0, step / 2):
                for ddz in (-step / 2, 0, step / 2):
                    for ds in (-0.03, 0, 0.03):
                        v_ = score(dy + ddy, dz + ddz, s + ds)
                        if v_ > sc: sc, dy, dz, s = v_, dy + ddy, dz + ddz, s + ds
        rec = {"frames": len(frames), "shift_up_pct_iod": round(dy * 100, 1), "shift_forward_pct_iod": round(dz * 100, 1),
               "scale": round(s, 3), "score_before": round(base, 3), "score_after": round(sc, 3),
               "skin_share_at_statistical": round(skin_at_stat, 2)}
        if max(abs(dy), abs(dz)) >= search - 1e-9:
            info[side] = {"applied": False, "reason": "best placement on the search limit (not trusted)", **rec}; continue
        if sc - base < min_gain:
            info[side] = {"applied": False, "reason": "gain too small", **rec}; continue
        plans[side] = (sc - base, dy, dz, s, root, wv)
        info[side] = {"applied": True, **rec}
    if len(plans) == 2:
        (gl, *pl), (gr, *pr) = plans["left"], plans["right"]
        if np.hypot(pl[0] - pr[0], pl[1] - pr[1]) > max_asym:
            weak = "left" if gl < gr else "right"
            plans.pop(weak); info[weak]["applied"] = False; info[weak]["reason"] = "left / right moves disagree"
    # a side that could not be trusted takes the move of the trusted side (ears sit symmetrically to a few mm)
    wvs, roots = {}, {}
    for side, sgn in (("left", 1), ("right", -1)):
        core = (ear_w > 0.5) & (side_mask == sgn)
        if core.sum() < 50: continue
        wv = np.where(side_mask == sgn, ear_w, 0.0).astype(np.float64)
        for _ in range(8): wv = np.maximum(wv, 0.5 * wv + 0.5 * (Adj @ wv) / deg)
        E = np.where(core)[0]; lat = (V[E] - V[E].mean(0)) @ (sgn * x)
        wvs[side] = np.clip(wv, 0, 1); roots[side] = V[E][lat < np.percentile(lat, 30)].mean(0)
    if len(plans) == 1:
        src = next(iter(plans)); other = "right" if src == "left" else "left"
        if other in wvs and other in info:
            _, dy, dz, s, _, _ = plans[src]
            plans[other] = (0.0, dy, dz, s, roots[other], wvs[other])
            info[other]["applied"] = True; info[other]["copied_from"] = src
    for side, (_, dy, dz, s, root, wv) in plans.items():
        tgt = root + s * (V - root) + dy * iod * up + dz * iod * fw
        out = out + wv[:, None] * (tgt - V)
    rep["ear_fit"] = info
    return out


def mean_ear_shape(V, F, M, ear_w, side_mask, rep, iod, root_w=10.0, rings=6):
    """S15P31B204-764: give each ear the SHAPE of the GNM mean ear M (same vertex order as V), keeping where the fit put
    it. No observation holds the ear, so the identity coefficients fitted to the face bend it as a side effect (folded
    rim, flat concha, S-curve seen from behind; dev result 2026-11-09: 5.3 mm from the mean ear vs 2.2-4.1 mm locally).
    The mean ear is laid onto the fitted one by one similarity (position, size, tilt), its ROOT (ear vertices next to
    head skin) weighted root_w so it stays seated; what the root still moves fades out over `rings` rings of head skin."""
    from scipy.sparse import coo_matrix
    from template_fit import umeyama
    ear = ear_w > 0.5
    ii = np.concatenate([F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]])
    jj = np.concatenate([F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]])
    Adj = coo_matrix((np.ones(len(ii)), (ii, jj)), shape=(len(V), len(V))).tocsr(); Adj.data[:] = 1
    deg = np.maximum(np.asarray(Adj.sum(1)).ravel(), 1)
    root = ear & ((Adj @ (~ear).astype(float)) > 0)
    out = V.copy(); info = {}; s_head = umeyama(M, V)[0]
    for side, sgn in (("left", 1), ("right", -1)):
        E = np.where(ear & (side_mask == sgn))[0]
        if len(E) < 50: continue
        s, R, t = umeyama(M[E], V[E], np.where(root[E], root_w, 1.0))
        d = np.zeros_like(V); d[E] = (s * (R @ M[E].T)).T + t - V[E]
        core = np.zeros(len(V), bool); core[E] = True
        dE = d[E].copy()
        for _ in range(rings): d[~core] = 0.5 * (Adj @ d)[~core] / deg[~core, None]
        out += d
        mv = np.linalg.norm(dE, axis=1) / iod * 100
        info[side] = {"scale_vs_head": round(float(s / s_head), 3), "root_move_pct_iod": round(float(mv[root[E]].mean()), 2),
                      "root_move_max_pct_iod": round(float(mv[root[E]].max()), 2), "ear_move_pct_iod": round(float(mv.mean()), 2)}
    rep["mean_ear"] = info
    return out
