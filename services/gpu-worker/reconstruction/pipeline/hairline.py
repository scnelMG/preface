"""Per-person HAIRLINE on the fitted head (S15P31B204-328, 2026-11-03, 만두: "이마와 머리카락 딱 그 경계").

The template's scalp (gnm_features.scalp_vertices) is a FIXED vertex set: its front edge sits at mid-forehead for every
person (chae02 / by01 / chae01 / woo02: well below the real hairline, no curve down to the temples). Hair assets, the bald
texture (S15P31B204-68) and the hair layer of the crown fit need the real skin / hair boundary as a place ON THE MESH.

  python pipeline/hairline.py work/<id>        -> work/<id>/model/hairline.json (the fit is not changed)

method (observed, no shape change):
  band     template skin above the eye line (h > 0.1 x eye..chin) and in front of the ear line: where the hairline can be.
           Outside the band the template labels stay (scalp = hair, face = skin)
  votes    every registered frame (corrected poses of frame_check when present): band vertices that are visible (z-buffer of
           the whole mesh) and face the camera (cos > 0.35, grazing views mix the classes) read the multiclass segmentation
           at their pixel (prep/class_masks_v3: 1 hair, 2 body skin, 3 face skin; the rest does not vote), weight = cos
  cover    a headband / hat / hood over the forehead (class 4 clothes or 5 others, 11-09: a black headband pushed the hair
           back and its lower half came out as forehead, its black spread over the bald texture) votes HAIR, so the line
           sits on its lower edge: only band vertices above COVER_H (glasses stay below it), and only a cover blob that
           touches the face skin in that frame (on the forehead, not a collar or something behind the head). The hairline
           under it cannot be seen, so the line is the lower edge of the cover
  label    p(hair) = hair / (hair + skin); band vertices with < 1.5 weight of votes are filled from observed neighbours
           (FILL; the template label "scalp = hair" pulled the line down where the upper forehead is seen obliquely: by01
           +3.9 -> +0.2 % IOD below the front-photo boundary); averaged over the 1-ring 3 times; hair where p > 0.5. Islands
           are removed: hair parts not connected to the scalp (a strand on the forehead) become skin, skin parts not
           connected to the face (a parting) become hair
  hairline one robust curve through all hair / skin crossings (smooth_line, robust_arch): an outline that ignores points
           far off it
hairline.json: hair (all hair vertex ids), hairline (ids), curve (3D points), fit settings, frames, stats.

Tried on 11/3 and NOT kept:
  - per-section heights (2 deg polar bins, median / mean, Gaussians, wide median, opening / closing against partings and
    baby hairs): each fix moved the problem - a domed top, chae01's notch, or by01's receding corner lost. Replaced by the
    one robust curve (11/4)
  - weighting the votes by how frontally / how level a frame sees the vertex: the line moved further from the boundary"""
import argparse, json, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
HAIR, SKIN = (1,), (2, 3)
COVER, COVER_H = (4, 5), 0.3    # clothes / others over the forehead vote hair above this height (x eye..chin; brows ~0.2)
COS_MIN, W_MIN, P_HAIR, SMOOTH = 0.35, 1.5, 0.5, 3
FIT_DETAIL, FIT_BAND = 5, 6.0   # robust arch: cosine terms 0..5, points beyond 6 x the spread dropped. 만두 11/4 chose 5 of
                                # 5 / 7 / 9 on the photos + hair-cap previews: the outline (flat top, straight temple sides)
FILL = True                     # fill weakly seen band vertices from observed neighbours (off: template label, 11/3 version)


def neighbours(F, n):
    import scipy.sparse as sp
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    A = sp.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n)).tocsr()
    return ((A + A.T) > 0).astype(np.float64)


def vertex_normals(V, F, skin):
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    vn = np.zeros_like(V)
    for k in range(3): np.add.at(vn, F[:, k], n)
    vn /= np.linalg.norm(vn, axis=1, keepdims=True) + 1e-12
    if ((V[skin] - V[skin].mean(0)) * vn[skin]).sum(1).mean() < 0: vn = -vn   # outward
    return vn


def zbuffer(uv, z, F, shape):
    """nearest face depth per pixel (painter's algorithm, far first)"""
    import cv2
    zb = np.full(shape, np.inf, np.float32); zf = z[F].mean(1)
    P = np.round(uv[F]).astype(np.int32); h, w = shape
    ok = (zf > 0) & (P[:, :, 0].max(1) >= 0) & (P[:, :, 0].min(1) < w) & (P[:, :, 1].max(1) >= 0) & (P[:, :, 1].min(1) < h)
    for t in np.where(ok)[0][np.argsort(-zf[ok])]: cv2.fillConvexPoly(zb, P[t], float(zf[t]))
    return zb


def keep_connected(lab, seed, A, region):
    """lab (bool) inside region: parts of lab not connected (through lab vertices) to a seed vertex are dropped"""
    from scipy.sparse.csgraph import connected_components
    idx = np.where(lab)[0]
    if not len(idx): return lab
    _, comp = connected_components(A[idx][:, idx], directed=False)
    good = np.unique(comp[seed[idx]]); out = lab.copy()
    out[idx[~np.isin(comp, good)] ] = False
    return out | (lab & ~region)


def forehead_cover(cm):
    """pixels of a class map that are a cover (COVER classes) blob touching the face skin (class 3): a headband / hat
    on the forehead. A collar touches the neck (body skin), not the face"""
    import cv2
    cover = np.isin(cm, COVER).astype(np.uint8)
    if not cover.any(): return cover.astype(bool)
    _, lab = cv2.connectedComponents(cover)
    face = cv2.dilate((cm == 3).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    touch = np.unique(lab[face & (cover > 0)])
    return np.isin(lab, touch[touch > 0])


def robust_arch(phi, rad, detail=FIT_DETAIL, band=FIT_BAND, iters=12, tmap=None):
    """ONE curve r(phi) = sum_k c_k cos(k pi t) (k = 0..detail) through all crossing points at once, refitted with Tukey
    weights: points farther than band x the spread (1.4826 x median |residual|) from the curve get weight 0, nearer ones
    less the farther they are. t = tmap(phi) in 0..1 (default: phi scaled linearly). Returns r(phi) and the final weights"""
    t0, t1 = phi.min(), phi.max(); T = tmap or (lambda q: (q - t0) / max(t1 - t0, 1e-9))
    basis = lambda q: np.cos(np.outer(T(q), np.arange(detail + 1)) * np.pi)
    Bm = basis(phi); w = np.ones(len(rad))
    for _ in range(iters):
        sw = np.sqrt(w); c = np.linalg.lstsq(Bm * sw[:, None], rad * sw, rcond=None)[0]
        res = rad - Bm @ c; s = 1.4826 * np.median(np.abs(res)) + 1e-9
        u = res / (band * s); w = np.where(np.abs(u) < 1, (1 - u * u) ** 2, 0.0)
    return (lambda q: basis(np.asarray(q, np.float64)) @ c), w


def smooth_line(V, hair, p, band, h, lat, dep, F, step=1.0, detail=FIT_DETAIL, fit_band=FIT_BAND):
    """ONE smooth hairline: the hair / skin crossings of the mesh edges in the band (p = 0.5 on the edge where p straddles
    it, else the midpoint) in a flat map of the front of the head: s = distance around the head (horizontal radius x
    angle from the front), h = height above the eyes, both / eye..chin. The hairline is an arch over the eyes there (top of
    the forehead, down the temples), so it is a radius over the POLAR angle around the eye-line centre, fitted as one
    robust curve (robust_arch) - an outline: points off it (baby-hair clusters, a parting, stray votes) lose their weight
    instead of bending it, and band keeps moderate bumps (만두 11/4: "어느 정도의 굴곡은 반영"). Band vertices outside the
    arch are hair, inside skin.
    -> curve points (every step deg along the arch, on the mesh surface), hairline vertex ids (nearest vertex per point,
    ordered, unique), hair mask"""
    from scipy.interpolate import LinearNDInterpolator
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]); e = e[hair[e[:, 0]] != hair[e[:, 1]]]
    e = e[band[e[:, 0]] & band[e[:, 1]]]
    if len(e) < 10: return np.zeros((0, 3)), [], hair
    pa, pb = p[e[:, 0]], p[e[:, 1]]; s = (pa - 0.5) * (pb - 0.5) < 0
    t = np.where(s, (0.5 - pa) / np.where(s, pb - pa, 1), 0.5)
    mix = lambda a: a[e[:, 0]] * (1 - t) + a[e[:, 1]] * t
    # (s, h). s is a DISTANCE (radius x angle), not the bare angle: the top of the forehead is near the vertical axis, so there
    # a small sideways step was a large angle - a wide gentle dip on the map came back as a narrow U on the forehead (by01 /
    # chae01 mid-forehead notches 11/3-11/4, at any smoothing)
    flat = lambda la, de, hh: (np.hypot(la, de) * np.arctan2(la, de), hh)
    sx, hx = flat(mix(lat), mix(dep), mix(h))
    phi = np.degrees(np.arctan2(hx, sx)); rad = np.hypot(sx, hx)       # 0 / 180 = the temple sides, 90 = top
    # the curve parameter is the LENGTH along the line (of a rough 3-term fit), not the polar angle: the top of the arch is
    # nearest to the centre, so 1 deg there is a shorter piece of the line and the same detail would allow tighter bends
    # there. Along the length, detail means the same bend size everywhere
    r0, _ = robust_arch(phi, rad, 3, fit_band)
    g = np.linspace(phi.min(), phi.max(), 400); gr = r0(g)
    gl = np.concatenate([[0], np.cumsum(np.hypot(np.diff(gr * np.cos(np.radians(g))), np.diff(gr * np.sin(np.radians(g)))))])
    rf, _ = robust_arch(phi, rad, detail, fit_band, tmap=lambda q: np.interp(q, g, gl / gl[-1]))
    # the curve point = the mesh surface AT the fitted arch (linear interpolation of the band vertices over the flat map;
    # snapping to the nearest real edge crossing brought the wiggles back, 11/3)
    sv, hv = flat(lat, dep, h); pv = np.degrees(np.arctan2(hv, sv))
    qa = np.arange(phi.min(), phi.max() + 1e-9, step); qr = rf(qa); ph = np.radians(qa)
    curve = LinearNDInterpolator(np.stack([sv[band], hv[band]], 1), V[band])(np.stack([qr * np.cos(ph), qr * np.sin(ph)], 1))
    curve = curve[~np.isnan(curve).any(1)]
    inside = band & (pv >= phi.min()) & (pv <= phi.max())
    hair = np.where(inside, np.hypot(sv, hv) > np.interp(pv, qa, qr), hair)
    ids = []
    for q in curve:
        j = int(np.argmin(np.linalg.norm(V - q, axis=1)))
        if j not in ids: ids.append(j)
    return curve, ids, hair


def detect(W, detail=FIT_DETAIL, fit_band=FIT_BAND, fill=FILL, views=None):
    """views: [(frame name, R, t, (f, cx, cy))] to vote with instead of the SfM poses (a check from saved photos)"""
    import cv2, pycolmap, meshio
    from frame_check import intrinsics, load_poses
    from gnm_features import scalp_vertices
    from head_ratios import _masks
    from view_coverage import head_axes
    M = os.path.join(W, "model")
    ch = json.load(open(os.path.join(M, "report.json"))).get("chosen", "lm")
    m = meshio.read_any(os.path.join(M, f"fit_{ch}.ply"))
    V = np.asarray(m["vertices"], np.float64); F = np.asarray(m["faces"], np.int64); n = len(V)
    L = V[np.array(json.load(open(os.path.join(M, f"fit_{ch}.fit.json")))["landmark_vertex_ids"])]
    scalp = scalp_vertices(); skin = _masks()[1]   # skin = template skin without the ears
    c, x, up, fw = head_axes(L); eye = (L[33] + L[263]) / 2; H = (eye - L[152]) @ up; iod = np.linalg.norm(L[33] - L[263])
    h = (V - eye) @ up / H; dep = (V - c) @ fw / H
    band = (skin | scalp) & (h > 0.1) & (dep > -0.15)
    vn = vertex_normals(V, F, skin)
    if views is None:
        ra = os.path.join(W, "run_all.json"); sp = None
        if os.path.exists(ra): sp = (json.load(open(ra, encoding="utf-8")).get("stages", {}).get("lens") or {}).get("sparse")
        if not sp or not os.path.isdir(sp): sp = os.path.join(W, "colmap", "sparse_lens_anchored")
        rec = pycolmap.Reconstruction(sp)
        fp = os.path.join(M, "frame_poses.json"); poses = load_poses(fp) if os.path.exists(fp) else None
    cmd = os.path.join(W, "prep", "class_masks_v3")
    wh, ws = np.zeros(n), np.zeros(n); covered = np.zeros(n, bool); used = []; bi = np.where(band)[0]
    if views is None:
        views = []
        for im in rec.images.values():
            if poses is not None and im.name not in poses: continue
            if poses is not None: R, t = poses[im.name]
            else: T = im.cam_from_world(); R, t = T.rotation.matrix(), np.asarray(T.translation)
            views.append((im.name, np.asarray(R), np.asarray(t), intrinsics(rec.cameras[im.camera_id])))

    def votes(view):
        """(hair votes, skin votes) of the band vertices in one frame, None when the frame is not used"""
        name, R, t, (f, cx, cy) = view
        cm = cv2.imread(os.path.join(cmd, name + ".png"), cv2.IMREAD_UNCHANGED)
        if cm is None or cm.ndim != 2: return None
        Q = V @ R.T + t
        if (Q[:, 2] <= 0).any(): return None
        uv = np.stack([f * Q[:, 0] / Q[:, 2] + cx, f * Q[:, 1] / Q[:, 2] + cy], 1)
        cos = (vn[bi] @ R.T * -Q[bi] / np.linalg.norm(Q[bi], axis=1, keepdims=True)).sum(1)
        zb = zbuffer(uv, Q[:, 2], F, cm.shape)
        u = np.round(uv[bi]).astype(int); hh, ww = cm.shape
        ok = (cos > COS_MIN) & (u[:, 0] >= 0) & (u[:, 0] < ww) & (u[:, 1] >= 0) & (u[:, 1] < hh)
        ok[ok] &= Q[bi[ok], 2] <= zb[u[ok, 1], u[ok, 0]] + 0.03 * iod
        cls = np.full(len(bi), 255, np.uint8); cls[ok] = cm[u[ok, 1], u[ok, 0]]
        on_cover = np.zeros(len(bi), bool); on_cover[ok] = forehead_cover(cm)[u[ok, 1], u[ok, 0]]
        hair_vote = ok & (np.isin(cls, HAIR) | (on_cover & (h[bi] > COVER_H)))
        # (11/3 tried: cos^3-4 or "level view" weights moved the line further from the front-photo boundary, not closer)
        return (np.where(hair_vote, cos, 0), np.where(ok & np.isin(cls, SKIN), cos, 0),
                hair_vote & ~np.isin(cls, HAIR))

    # frames are independent (S15P31B204-702): the z-buffer is a Python loop over the faces -> processes; the votes are
    # added up in the old frame order, so the sums are the same
    from parallel import fork_map
    for view, r in zip(views, fork_map(votes, views)):
        if r is None: continue
        wh[bi] += r[0]; ws[bi] += r[1]; covered[bi] |= r[2]
        used.append(view[0])
    A = neighbours(F, n)
    obs = band & (wh + ws >= W_MIN); n_obs = int(obs.sum())   # before the fill
    p = np.where(scalp, 1.0, 0.0); p[obs] = wh[obs] / (wh[obs] + ws[obs])
    if fill:   # band vertices with too few votes from observed neighbours instead of the template "scalp = hair"
        known = ~band | obs; Ab = A.multiply(band[None, :]).tocsr()
        for _ in range(200):
            kn = known.astype(np.float64); cnt = Ab @ kn; sm = Ab @ (p * kn)
            new = band & ~known & (cnt > 0)
            if not new.any(): break
            p[new] = sm[new] / cnt[new]; known |= new
        obs = band & known
    deg = np.asarray(A.sum(1)).ravel() + 1
    for _ in range(SMOOTH):
        q = (A @ p + p) / deg; p = np.where(obs, q, p)
    hair = np.where(obs, p > P_HAIR, scalp)
    face_seed = skin & ~scalp & (h < 0.1)          # eyes .. chin: always skin
    crown_seed = scalp & (h > 0.6) & (dep < 0)     # top / back of the head: always hair
    hair = keep_connected(hair, crown_seed, A, band)
    head = skin | scalp
    hair = head & ~keep_connected(head & ~hair, face_seed, A, band)
    curve, line, hair = smooth_line(V, hair, p, band, h, (V - c) @ x / H, dep, F, detail=detail, fit_band=fit_band)
    out = {"version": 3, "chosen": ch, "method": "class_masks_v3 votes on the fitted mesh, robust arch (pipeline/hairline.py)",
           "fit": {"detail": detail, "band": fit_band, "fill": fill},
           "frames": len(used), "hair": np.where(hair)[0].tolist(), "hairline": line, "curve": np.round(curve, 6).tolist(),
           "stats": {"band": int(band.sum()), "observed": n_obs, "cover": int(covered.sum()),
                     "to_hair": int((hair & ~scalp).sum()), "to_skin": int((~hair & scalp).sum()),
                     "hairline_h_median": round(float(np.median(h[line])), 3) if line else None,
                     "template_hairline_h_median": None}}
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    t_edge = np.zeros(n, bool); tc = scalp[e[:, 0]] != scalp[e[:, 1]]; t_edge[e[tc].ravel()] = True
    tl = scalp & t_edge & band
    if tl.any(): out["stats"]["template_hairline_h_median"] = round(float(np.median(h[tl])), 3)
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("work")
    ap.add_argument("--detail", type=int, default=FIT_DETAIL, help="cosine terms of the arch (more = follows more bumps)")
    ap.add_argument("--band", type=float, default=FIT_BAND, help="points beyond this x the spread are dropped (more = keeps more)")
    ap.add_argument("--no-fill", dest="fill", action="store_false", help="weakly seen band vertices keep the template label")
    a = ap.parse_args()
    out = detect(a.work, a.detail, a.band, a.fill)
    json.dump(out, open(os.path.join(a.work, "model", "hairline.json"), "w"))
    print(f"hairline: frames {out['frames']}, " + ", ".join(f"{k} {v}" for k, v in out["stats"].items()))


if __name__ == "__main__":
    main()
