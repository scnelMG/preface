"""Bald skin maps (S15P31B204-68, 2026-11-05): the head is shown bald and hair assets are put on top, so the painted hair
of the photo must leave the skin maps.

  face     the photo map inside the face: the MediaPipe face oval (temple -> in front of the ear -> jaw angle -> chin), its
           top opened upward, so above the temples only the per-person hairline (pipeline/hairline.py) decides
  behind   ears, sideburns, scalp, back of the head and neck: filled from the colours AT the face line (v8, 11/6). Each face-
           side vertex touching the painted side keeps its own clean map colour (smoothed along the line), and every painted
           vertex is the harmonic (membrane) interpolation of those colours over the skin surface: near the forehead it is the
           forehead's colour, near the neck the neck's, in between a smooth blend. v7 faded the line colour into ONE tone (the
           median of the whole line, jaw and sideburns included) within ~0.25 eye distances: the colour broke off right
           behind the line (6091 forehead top L* 62 -> 42 in one step; 5 check people: largest step along the midline
           5-15 -> 2-4 L*). The ears now sit 2-4 L* above the cheeks (v7: ~8 below)
  clean    hair-like texels (darker and greyer than the local skin) on the face side near the line -> local clean skin
           colour; eyebrows are protected (a first try erased the upper brow fringe: 5-13 % of the brow texels)
  hairline (v9, S15P31B204-750) the photo stops PHOTO_IN before the scalp hair and fades into the fill over PHOTO_FADE; no
           texel of the hair side is kept. v8 kept the photo up to the line and HAIR_RAMP into the hair: a hard step from
           skin grain to the smooth fill all along the line, and cap / headband edges (a cap buckle, baby hairs) left on the
           bald head. The fill colour at the hairline is the clean face side RING_IN..RING_OUT further inside (the skin
           right at the line is darkened by baby hairs and the shade of the hair), and the top of the head is fixed to that
           forehead colour too: v8 took the line colour (chae01 L* 128) and the top of the head came from the shaded
           temples / ears, so the lit photo forehead (L* 173) stood out as a light patch with hard edges. Gone with it: the
           v8 forehead-top step (texels darker than 0.82 x the forehead reference over-painted with that one colour), which
           made blocky light patches of its own. "Scalp hair" = hairline.json hair above the brows or out at the temples:
           the file also lists template scalp vertices around the eyes / lashes (a first try faded the photo there)

Earlier tries (local, 4 check people): v5 photo map + inpainting looked blotchy; v6 one tone + the photo's fine pattern
everywhere looked too white with the lighting-free map; the template scalp reached 0.25-0.43 eye distances below the real
hairline, so only hairline.json marks the hair here.

Both skin maps are made: tex_skin_bald.png (photo) and tex_skin_albedo_bald.png (lighting-free, the head.glb default
skin), each from its own colours with the same face / behind split. tools/export_glb.py --bald puts them into head.glb.
writes model/tex_skin_bald.png, model/tex_skin_albedo_bald.png, model/bald_skin.json
usage: python pipeline/bald_skin.py work/<id>"""
import argparse, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)

# MediaPipe face oval, clockwise from the forehead centre
FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
             172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
RAMP = 0.08          # face -> behind blend across the face line, x eye distance
HAIR_RAMP = 0.06     # v8 blend into the hair: still the hair-spot search area and the non-scalp "hair" vertices
SIGMA_LINE = 0.12    # broad colour along the line (Gaussian over the line vertices)
GUTTER_PX = 16       # texels outside the UV islands repainted with the bald colours (filtering / mip levels read them)
FREF = 0.25          # forehead reference = clean forehead at least this far inside the face
SPOT_REF = 0.82      # darker than this x the forehead reference L* -> hair-dark: left out of the hairline fill colour
PHOTO_IN, PHOTO_FADE = 0.03, 0.12   # v9: the photo ends this far before the scalp hair, then fades over this (x eye distance)
RING_IN, RING_OUT = 0.03, 0.20      # v9: hairline fill colour = clean face side this far inside the line vertex
RING_NEAR = 0.20                    # v9: line vertices within PHOTO_IN + PHOTO_FADE + this of the scalp hair take it
CROWN_H = 0.6                       # v9: skin this far below the highest skin point is fixed to the forehead colour
SCALP_Y, SCALP_X = 0.45, 0.75       # v9: scalp hair = hair this far above the eyes, or this far out (temples, sideburns)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("work")
    ap.add_argument("--margin", type=float, default=0.0, help="moves the face line forward (+, more skin colour), x eye distance")
    a = ap.parse_args()
    import cv2, meshio
    from uv_bake import raster_layout, TEMPLATE
    from gnm_model import GNM, template_map
    from view_coverage import head_axes
    from matplotlib.path import Path
    from scipy.sparse import coo_matrix, diags, identity
    from scipy.sparse.linalg import factorized
    from scipy.spatial import cKDTree

    M = os.path.join(a.work, "model")
    hj_path = os.path.join(M, "hairline.json")
    if not os.path.exists(hj_path): sys.exit("bald_skin: no model/hairline.json (pipeline/hairline.py)")
    ch = json.load(open(os.path.join(M, "report.json"), encoding="utf-8")).get("chosen", "gnm")
    D = np.load(TEMPLATE); UV = D["vertex_uvs"].astype(np.float64); UT = D["uv_triangles"].astype(np.int64)
    F = D["triangles"].astype(np.int64); mat = D["materials"]
    V = np.asarray(meshio.read_any(os.path.join(M, f"fit_{ch}.ply"))["vertices"], np.float64)
    lid = np.array(json.load(open(os.path.join(M, f"fit_{ch}.fit.json")))["landmark_vertex_ids"])
    iod = np.linalg.norm(V[lid[33]] - V[lid[263]])
    maps = {n: os.path.join(M, f"tex_{n}.png") for n in ("skin", "skin_albedo")}
    maps = {n: p for n, p in maps.items() if os.path.exists(p)}
    if "skin" not in maps: sys.exit("bald_skin: no model/tex_skin.png")
    S = cv2.imread(maps["skin"]).shape[0]
    tris = np.where((mat[F] == 0).all(1))[0]; py, px, tt, w = raster_layout(S, tris, UV, UT)
    vtx = lambda f: (w * f[F[tt]]).sum(1)
    valid = np.zeros((S, S), np.float32); valid[py, px] = 1
    n = len(mat)
    ii = np.concatenate([F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]]); jj = np.concatenate([F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]])
    Adj = coo_matrix((np.ones(len(ii)), (ii, jj)), shape=(n, n)).tocsr(); deg = np.maximum(np.asarray(Adj.sum(1)).ravel(), 1)

    def msmooth(f, k):
        for _ in range(k): f = 0.5 * f + 0.5 * (Adj @ f) / deg
        return f

    def nblur(x, sg, m=None):
        m = valid if m is None else m * valid
        den = np.maximum(cv2.GaussianBlur(m, (0, 0), sg), 1e-4)
        return (cv2.GaussianBlur(x * m, (0, 0), sg) / den) if x.ndim == 2 else cv2.GaussianBlur(x * m[..., None], (0, 0), sg) / den[..., None]

    G = GNM(); o2g = template_map()[0]; grp = lambda nm: (G.groups[G.group_names.index(nm)] > 0.3)[o2g]
    skin = mat == 0; ears = grp("ears")
    hj = json.load(open(hj_path)); hair = np.zeros(n, bool); hair[hj["hair"]] = True; hair &= skin & ~ears
    c, x, up, fw = head_axes(V[lid]); X, Y, Z = (V - c) @ x / iod, (V - c) @ up / iod, (V - c) @ fw / iod

    # ---- face / behind split (geometry only, the same for both maps)
    P_ = V[lid[FACE_OVAL]]; th_r = np.arctan2((P_ - c) @ x, (P_ - c) @ fw); y_r = (P_ - c) @ up / iod
    ytop = min(y_r[FACE_OVAL.index(21)], y_r[FACE_OVAL.index(251)]); y_open = np.where(y_r > ytop, 50.0, y_r)
    inside = Path(np.stack([th_r, y_open], 1)).contains_points(np.stack([np.arctan2(X, Z), Y], 1)) & (Z > 0)
    seg = np.concatenate([np.linspace(P_[i], P_[(i + 1) % len(P_)], 12, endpoint=False) for i in range(len(P_))])
    keep = ((seg - c) @ up / iod) <= ytop + 0.05; dl = cKDTree(seg[keep]).query(V)[0] / iod
    sd = np.where(inside, dl, -dl) - a.margin                              # + inside the face
    ds = cKDTree(V[skin & ~hair]).query(V)[0] / iod
    wt = np.clip((sd + RAMP / 2) / RAMP, 0, 1)                              # 1 photo .. 0 skin colour
    # the v8 weight (photo up to the hairline) still places the hair-spot search: around the hairline, not around the
    # moved photo edge (v9 reaches lower and the search there took the lashes for hair)
    wt_line = np.where(hair, np.minimum(wt, 1 - np.clip(ds / HAIR_RAMP, 0, 1)), wt); wt_line[ears] = 0; wt_line[~skin] = 0
    wt_line = np.clip(msmooth(wt_line, 2), 0, 1)
    # v9: no photo on the scalp hair, and it fades in from PHOTO_IN before it over PHOTO_FADE
    ye = float(np.mean(Y[lid[[33, 133, 263, 362]]]))
    scalp_hair = hair & ((Y > ye + SCALP_Y) | (np.abs(X) > SCALP_X))
    dh = cKDTree(V[scalp_hair]).query(V)[0] / iod if scalp_hair.any() else np.full(n, 9.0)
    wt = np.where(scalp_hair, 0.0, np.minimum(wt, np.clip((dh - PHOTO_IN) / PHOTO_FADE, 0, 1)))
    wt = np.where(hair & ~scalp_hair, np.minimum(wt, 1 - np.clip(ds / HAIR_RAMP, 0, 1)), wt); wt[ears] = 0; wt[~skin] = 0
    wt = np.clip(msmooth(wt, 2), 0, 1)
    tex_v = skin & (wt > 0.95); tone_v = skin & (wt < 0.05)
    dT = cKDTree(V[tone_v]).query(V)[0] / iod
    t_wt = vtx(wt)
    texm = np.zeros((S, S), np.float32); texm[py, px] = (t_wt > 0.5).astype(np.float32)
    d_line = cKDTree(V[skin & (wt_line < 0.05)]).query(V)[0] / iod
    t_near = vtx(((d_line < 0.4) & skin).astype(float)) > 0.5
    prot = msmooth((grp("left_brow_region") | grp("right_brow_region") | grp("middle_brow_region")).astype(float), 3) > 0.05
    t_prot = vtx(prot.astype(float)) > 0.01
    wtx = (t_wt > 0.95).astype(float)
    a_ = np.zeros((S, S), np.float32); a_[py, px] = t_wt; alpha = np.clip(nblur(a_, 0.002 * S), 0, 1)[..., None]
    # forehead by position (the GNM "forehead_region" group stops below the top of the forehead on the midline): above the
    # brows, in front, between the temples
    fore = skin & ~ears & ~prot & (Y > ye + 0.30) & (Z > 0.15) & (np.abs(X) < 0.55)
    t_fref = vtx((fore & tex_v & (dT > FREF)).astype(float)) > 0.5
    # fill system (geometry only, the same for both maps): uniform graph Laplacian of the skin surface; the face side
    # (tex_v) and the top of the head (crown, v9) are fixed, the painted side solved. A tiny pull to the line median keeps a
    # skin island with no face side (none on the check set) solvable
    crown = skin & ~tex_v & ~ears & (Y > Y[skin].max() - CROWN_H)
    sk_idx = np.where(skin)[0]; As = Adj[sk_idx][:, sk_idx].tocsr(); As.data[:] = 1.0
    Ls = (diags(np.asarray(As.sum(1)).ravel()) - As).tocsr()
    unk = ~(tex_v | crown)[sk_idx]; fixd = ~unk
    EPS = 1e-4
    solve_u = factorized((Ls[unk][:, unk] + EPS * identity(int(unk.sum()))).tocsc()); Luf = Ls[unk][:, fixd]
    import threading
    solve_lock = threading.Lock()   # the two maps run side by side; one factor object, solved one at a time
    is_crown_f = crown[sk_idx[fixd]]
    border = (np.asarray(abs(Luf).sum(0)).ravel() > 0) & ~is_crown_f; bv = sk_idx[fixd][border]   # face side touching the painted side
    hl_line = dh[bv] < PHOTO_IN + PHOTO_FADE + RING_NEAR                                    # ... along the hairline
    Kb = cKDTree(V[bv]).sparse_distance_matrix(cKDTree(V[bv]), 3 * SIGMA_LINE * iod, output_type="coo_matrix")
    Kb.data = np.exp(-0.5 * (Kb.data / (SIGMA_LINE * iod)) ** 2); Kb = (Kb.tocsr() + identity(len(bv), format="csr")).tocsr()

    def bald(img):
        """one skin map -> its bald version + numbers"""
        Lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32); Lt = Lab[..., 0][py, px]
        chroma = np.hypot(Lab[..., 1] - 128, Lab[..., 2] - 128)
        locL = nblur(Lab[..., 0], 0.012 * S, texm); locC = nblur(chroma, 0.012 * S, texm)
        spot = t_near & ~t_prot & (t_wt > 0.05) & (Lt < 0.82 * locL[py, px]) & (chroma[py, px] < 0.75 * locC[py, px])
        ref = np.median(Lab[py[t_fref], px[t_fref]], 0) if t_fref.sum() >= 500 else None
        dm = np.zeros((S, S), np.float32); dm[py[spot], px[spot]] = 1; dm = cv2.dilate(dm, np.ones((5, 5), np.uint8)) * valid
        local = nblur(img.astype(np.float32), 0.01 * S, (1 - dm) * texm)
        dmb = np.clip(nblur(dm, 0.0015 * S), 0, 1)[..., None]
        clean = img.astype(np.float32) * (1 - dmb) + local * dmb
        # colour at the line: vertex means of the clean face-side texels, then a Gaussian along the line vertices
        lab_c = cv2.cvtColor(np.clip(clean, 0, 255).astype(np.uint8), cv2.COLOR_BGR2LAB).astype(np.float64)[py, px]
        acc = np.zeros((n, 3)); wa = np.zeros(n)
        for k in range(3): np.add.at(acc, F[tt, k], (w[:, k] * wtx)[:, None] * lab_c); np.add.at(wa, F[tt, k], w[:, k] * wtx)
        okb = wa[bv] > 1e-3
        if okb.sum() < 20: raise RuntimeError(f"face line too short ({int(okb.sum())} vertices)")
        own = acc[bv] / np.maximum(wa[bv], 1e-9)[:, None]
        # v9: along the hairline, the clean face side RING_IN..RING_OUT inside (brows and hair-dark vertices left out)
        lab_all = acc / np.maximum(wa, 1e-9)[:, None]
        ok_all = tex_v & ~prot & (wa > 1e-3)
        if ref is not None: ok_all &= lab_all[:, 0] >= SPOT_REF * ref[0]
        cand = np.where(ok_all)[0]; ringed = 0
        if len(cand) >= 20:
            near = np.where(okb & hl_line)[0]
            for j, nb in zip(near, cKDTree(V[cand]).query_ball_point(V[bv[near]], RING_OUT * iod)):
                nb = np.asarray(nb, int)
                if not len(nb): continue
                nb = nb[np.linalg.norm(V[cand[nb]] - V[bv[j]], axis=1) / iod >= RING_IN]
                if len(nb) >= 5: own[j] = lab_all[cand[nb]].mean(0); ringed += 1
        tone = np.median(own[okb], 0)
        # border colours smoothed along the line (one hair texel must not paint a stripe over the scalp)
        colb = (Kb @ (own * okb[:, None])) / np.maximum(Kb @ okb.astype(float), 1e-9)[:, None]
        xf = np.tile(tone, (int(fixd.sum()), 1)); xf[border] = colb
        fl = okb & hl_line                                     # v9: the top of the head = the forehead's hairline colour
        if is_crown_f.any(): xf[is_crown_f] = np.median(colb[fl], 0) if fl.sum() >= 5 else tone
        with solve_lock:
            xu = np.stack([solve_u(-(Luf @ xf[:, k]) + EPS * tone[k]) for k in range(3)], 1)
        tfield = np.tile(tone, (n, 1)); tfield[sk_idx[fixd]] = xf; tfield[sk_idx[unk]] = xu
        lt_ = Lab.copy(); lt_[py, px] = np.clip(np.stack([vtx(tfield[:, k]) for k in range(3)], 1), 0, 255)
        tone_img = np.zeros((S, S, 3), np.float32)
        tone_img[py, px] = cv2.cvtColor(lt_.astype(np.uint8), cv2.COLOR_LAB2BGR)[py, px].astype(np.float32)
        out = clean * alpha + tone_img * (1 - alpha)
        res = img.copy(); res[py, px] = np.clip(out[py, px], 0, 255).astype(np.uint8)
        # gutter: texels just outside the UV islands still held the baked hair colour; texture filtering / mip levels
        # read them at the island borders -> a dark dashed seam down the back of the bald head (11/5). Grow the new
        # colours outward over the gutter (average of the already filled neighbours, ring by ring)
        acc_ = res.astype(np.float32) * valid[..., None]; m_ = valid.copy(); k3 = np.ones((3, 3), np.float32)
        for _ in range(GUTTER_PX):
            num_ = cv2.filter2D(acc_, -1, k3, borderType=cv2.BORDER_CONSTANT); den_ = cv2.filter2D(m_, -1, k3, borderType=cv2.BORDER_CONSTANT)
            new_ = (den_ > 0) & (m_ == 0)
            if not new_.any(): break
            acc_[new_] = num_[new_] / den_[new_, None]; m_[new_] = 1
        grown = (m_ > 0) & (valid == 0); res[grown] = np.clip(acc_[grown], 0, 255).astype(np.uint8)
        return res, {"line_median_lab": [round(float(v), 1) for v in tone], "spots_cleaned": int(spot.sum()), "line_vertices": int(okb.sum()),
                     "forehead_ref_lab": [round(float(v), 1) for v in ref] if ref is not None else None,
                     "hairline_vertices_recoloured": ringed}

    rep = {"version": 9, "margin_iod": a.margin, "chosen": ch, "face_texels": int((t_wt > 0.5).sum()), "skin_colour_texels": int((t_wt <= 0.5).sum()),
           "settings": {"photo_in": PHOTO_IN, "photo_fade": PHOTO_FADE, "ring": [RING_IN, RING_OUT], "ring_near": RING_NEAR,
                        "crown_h": CROWN_H, "scalp_y": SCALP_Y, "scalp_x": SCALP_X},
           "scalp_hair_vertices": int(scalp_hair.sum()), "crown_vertices": int(crown.sum()), "maps": {}}
    imgs = {name: cv2.imread(p) for name, p in maps.items()}
    todo = [name for name, img in imgs.items() if img is not None and img.shape[0] == S]
    # the two maps (photo colour, albedo) are independent: side by side (S15P31B204-702), written in the old order
    from parallel import thread_map
    done = dict(zip(todo, thread_map(lambda name: bald(imgs[name]), todo)))
    for name in maps:
        if name not in done: rep["maps"][name] = {"skipped": "unreadable or other size"}; continue
        out, info = done[name]
        cv2.imwrite(os.path.join(M, f"tex_{name}_bald.png"), out); rep["maps"][name] = info
    json.dump(rep, open(os.path.join(M, "bald_skin.json"), "w"), indent=1)
    print(json.dumps(rep))


if __name__ == "__main__":
    main()
