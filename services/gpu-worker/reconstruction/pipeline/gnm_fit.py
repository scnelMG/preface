"""P0: fit the GNM Head v3 STATISTICAL model (identity space, 170 head components + eyeballs) to the multi-view
3D landmarks - the whole head (ears, jaw, cheeks, skull, neck) moves the way real heads vary, instead of the mean
template staying where no landmark is (2026-10-16).

  minimise   sum_k w_k |S Rw (T_k + B_k b) + tw - L_k|^2 / sigma^2  +  |b|^2      (b ~ N(0, I) prior of the model)
  sigma = 2 % of the eye distance (MediaPipe landmark noise); robust (Cauchy) landmark weights; eyelid points x6
  alternating: similarity (Umeyama)  <->  identity b (ridge least squares, linear)
Output: the neutral fitted head in OUR template topology / COLMAP frame (<out>.ply + .fit.json with the same landmark
ids as template_fit), used as the BASE shape of template_fit (--base-mesh) for the remaining small residuals.
usage: python gnm_fit.py --landmarks mv.ply --out fit_gnm_base.ply [--eyelid-offset eyelid_offset.json] [--sigma 0.02]
"""
import argparse, json, os, sys, time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import meshio  # noqa
from gnm_model import GNM, template_map, rodrigues
from template_fit import load_template, correspondence, umeyama, head_axes, EYE_LM, OVAL


class Laps:
    """seconds per named section (S15P31B204-465, which part to move to the GPU): lap(name) closes the running section
    and starts `name`, so a `continue` inside a section still counts toward it"""
    def __init__(self):
        self.sec, self.cur, self.t = {}, None, time.perf_counter()

    def lap(self, name=None):
        now = time.perf_counter()
        if self.cur: self.sec[self.cur] = self.sec.get(self.cur, 0.0) + now - self.t
        self.cur, self.t = name, now


LAPS = Laps()


SIL_GROUPS = ["hockey_mask", "ears", "left_parotid_region", "right_parotid_region", "left_cheek_region", "right_cheek_region",
              "left_zygomatic_region", "right_zygomatic_region", "chin_region", "nose_region", "upper_lip_region",
              "lower_lip_region", "left_temple_region", "right_temple_region", "left_infraorbital_region", "right_infraorbital_region"]
# forehead / brows: excluded while every skin edge was matched two-sided (the hairline pulled the head in); with the
# background / hair edge split (one-sided at hair) the visible forehead must simply lie inside the model (eun02: the
# crown term alone put the skull below the visible forehead skin, 2026-10-16)
NO_SIL = []
NECK_MATCH = 0.4        # --neck-pitch: photo outline search for the neck skin's outline points, x eye distance
SIL_MATCH = 0.15        # photo outline / face-neck border searched this far from a model outline point, x eye distance


def depth_landmarks(a):
    """landmarks whose head-forward (depth) component gets --lm-depth-w"""
    import json as _j
    reg_ = _j.load(open(os.path.join(HERE, "..", "assets", "gnm", "gnm_features.json")))["regions"]
    rg = tuple(r_.strip() for r_ in a.lm_depth_regions.split(",") if r_.strip())
    return np.array([k for k in range(468) if any(r_ in rg for r_ in reg_[str(k)])], int)


def to_world(Y, S, Rw, tw, neck=None):
    """GNM space -> world (COLMAP frame) with the head pose S, Rw, tw. neck = (weights, Rn, tn) (--neck-pitch): the skin
    the GNM skins to its NECK joint takes the pose Rn, tn instead, blended by that weight like the model's own skinning"""
    V = (S * (Rw @ Y.T)).T + tw
    if neck is not None:
        wn, Rn, tn = neck
        V = V + wn[:, None] * ((S * (Rn @ Y.T)).T + tn - V)
    return V


def silhouette_stage(a, G, use, b, S, Rw, tw, L, Tk, B, w, iod, rep):
    """P1 (2026-10-16): Gauss-Newton on the identity b with the landmark term + the SILHOUETTE term of every frame:
    model outline points (exterior skin of the face, jaw, cheeks, nose, lips, ears - not the hairline / scalp / neck)
    are pulled along their image normal onto the photo SKIN outline (outline_obs.py). In the statistical space a
    silhouette moves the whole region smoothly (no creases like the earlier per-vertex profile fit)."""
    import cv2
    from scipy.spatial import cKDTree
    from outline_obs import frame_observations
    excl = set(open(a.exclude).read().split()) if a.exclude else set()
    LAPS.lap("sil_obs")
    obs = frame_observations(a.work, a.sparse, a.poses, L, every=a.sil_every, exclude=excl)
    LAPS.lap("sil_setup")
    grp = lambda names: np.any([G.group(n) for n in names], axis=0)
    ext = G.group("skin_exterior")
    # two-sided at BACKGROUND edges: every exterior skin vertex except the hair-covered scalp (the crown term handles it).
    # The neck and the under-jaw were one-sided before -> a too full jaw-neck line was never pulled in ("blunt" jaw
    # line on every model, 2026-10-16)
    from gnm_features import scalp_vertices
    o2g0, _, _, _ = template_map(); scalp_g = np.zeros(G.V, bool); scalp_g[o2g0] = scalp_vertices()
    # OPTION (S15P31B204-554, --hairline-json, off by default): this person's hairline (pipeline/hairline.py of a first fit)
    # instead of the fixed template scalp, which starts mid-forehead (84-206 of its 1877 vertices are forehead skin on the
    # check set chae02 / by01 / chae01 / woo02): those vertices are SKIN - two-sided outline like the face, out of the crown
    # term. Measured 11/4 (forehead-top band vs the side photos, median % IOD, + = model outside; now -> this option):
    # chae02 -0.2 -> +0.7, by01 -4.2 -> -3.2, chae01 -4.7 -> -2.8, woo02 -2.9 -> -2.8; face SAME, crown height +-0.005.
    # A layer THINNING toward the hairline (--hair-ramp > 0) looked better for three (-0.7 .. -0.9) but only because the
    # thin layer pulls the forehead top up to the hair silhouette further back (front / chin-up views): chae02 +4.3 %.
    # Not switched on (safe, small gain); the remaining ~3 % inside is still open
    hl_hair = hl_line = hair_v = None
    if a.hairline_json:
        hj_ = json.load(open(a.hairline_json)); hl_hair = np.zeros(G.V, bool); hl_line = np.zeros(G.V, bool)
        t_ = np.zeros(len(o2g0), bool); t_[hj_["hair"]] = True; hl_hair[o2g0] = t_
        t_ = np.zeros(len(o2g0), bool); t_[hj_["hairline"]] = True; hl_line[o2g0] = t_
    elig = ext & ~(scalp_g & hl_hair if hl_hair is not None else scalp_g)
    if NO_SIL: elig &= ~grp(NO_SIL)
    # INNER occluding contours (jaw line over the neck, ear rim in front of the head side): no skin / background edge
    # there, so they are matched to the photo's own intensity edges (2026-10-16: ears and jaw lines did not follow)
    edge_v = ext & grp(["ears", "chin_region", "left_parotid_region", "right_parotid_region", "left_cheek_region",
                        "right_cheek_region"]) & ~scalp_g
    neck_g = ext & ~scalp_g & ~grp(SIL_GROUPS + ["forehead_region", "left_brow_region", "right_brow_region", "middle_brow_region"])
    edge_v |= neck_g
    # the nose bridge / philtrum seen from the side: the photo OUTLINE there is often the far brow / far cheek, and the
    # midline itself shows only as an inner edge (nose in front of the far cheek) -> midline zones join the edge term
    edge_v |= ext & grp(["nose_region", "upper_lip_region", "middle_brow_region"])
    mid_x = np.abs(G.T[:, 0] - G.T[G.group("skin")][:, 0].mean()) < 0.012       # GNM template: x = left-right (m)
    midline = ext & mid_x & grp(["nose_region", "upper_lip_region", "middle_brow_region", "forehead_region"])
    ext_tri = G.tri[ext[G.tri].all(1)]
    # OPTION (S15P31B204-778, --face-region): the multiclass segmentation splits the skin into FACE (3) and NECK (2); their
    # border is the jaw line seen from that view. The outline term merges both into one region, so this border was never
    # observed and the surface between it and the outline kept the statistical mean: in side views the model's face
    # regions (GNM's own *_region / hockey_mask groups, which end at the template's jaw ridge) reached 1.4-4.8 % IOD^2
    # below the photo jaw line, onto neck skin (iPhone 16 Pro web recordings, 11/11; the jaw came out blunt). Here the
    # VISIBLE edge of the model's face region inside its outline - the jaw ridge, or where the face occludes the
    # under-jaw - is matched to that border in every frame, both ways. A fixed ridge curve could not do this: the visible
    # edge moves with the view (tried 11/11, the overlap grew)
    face_border = {}                                                     # frame -> (border pixels, KD-tree)
    if a.face_region:
        face_g = ext & grp([n_ for n_ in G.group_names if n_.endswith("_region")] + ["hockey_mask"])
        face_tri = G.tri[face_g[G.tri].all(1)]
        face_edge = np.zeros(G.V, bool)                                  # face vertices next to non-face skin
        face_edge[G.tri[face_g[G.tri].any(1) & ~face_g[G.tri].all(1)].ravel()] = True; face_edge &= face_g
        for o_ in obs:
            if o_[11] is None: continue
            by_, bx_ = np.nonzero((o_[11] == 3) & (cv2.dilate((o_[11] == 2).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0))
            if len(bx_) >= 20: bq_ = np.c_[bx_, by_].astype(np.float64); face_border[o_[0]] = (bq_, cKDTree(bq_))
    # CROWN (P1 2026-10-16): long hanging hair hides the skull at the sides, but on TOP of the head the hair is a thin
    # layer - the person outline there is the skull + ~hair thickness (woo01: the head was fitted to the hairline)
    crown = np.zeros(G.V, bool)
    if a.crown_frame_pts > 0:
        from gnm_features import scalp_vertices
        o2g_, _, _, _ = template_map(); crown[o2g_] = scalp_vertices()
        crown &= ext
        # --hairline-json: the forehead skin above the template line is NOT in the crown term. Seen from the front / chin up,
        # the person outline above it is the hair further back (7-16 % IOD higher, hair pixels between): a thin / zero layer
        # there pulled the forehead top up to it (chae02 4-5 % outside the side photos, 11/4). Its skin outline (elig) holds it
        if hl_hair is not None: crown &= hl_hair
    Ball = G.B_id[use]                                                   # (K, V, 3)
    K = len(use); stats = []
    A = B.reshape(K, -1).T                                               # landmark design (468*3, K)
    # MediaPipe's face-oval points slide along the visible outline with the view (not fixed skin points): with the real
    # outline measured here they are only a weak hint, otherwise they pull the jaw / cheeks back inside
    from gnm_features import landmark_weights
    w = w * landmark_weights(oval=a.sil_oval_w, surface=a.sil_surface_w)
    import json as _j
    reg_ = _j.load(open(os.path.join(HERE, "..", "assets", "gnm", "gnm_features.json")))["regions"]
    if a.temple_lm_w != 1.0:
        # W7a option: MediaPipe's temple / upper-oval points sit on the visible skin edge = the HAIRLINE at the temples
        # (not on the skull), so even weak weights pull the head in there (10/19: temple / cheekbone width of all six
        # fits 0.936-0.999, real heads median 1.025)
        tl = np.array([k for k in range(468) if any(r_ in ("left_temple_region", "right_temple_region") for r_ in reg_[str(k)])], int)
        w = w.copy(); w[tl] *= a.temple_lm_w
    depth_lm = depth_landmarks(a)
    # OPTION (2026-10-24, --hair-shell): the hair layer is ONE unknown per person and region (top / back / sides), solved
    # with b. The fixed --hair (0.12 x eye distance) was too thin for men's hair (0.20-0.24 estimated, by01 headband 0.13)
    # and, weighted like independent points in every frame, it pulled the crown up round after round (zu01 1.04 -> 1.17)
    # front (forehead hair down to the hairline): the layer thins to 0 at the visible hairline, so one value per region
    # pulled the top of the forehead 3-5 % behind the photo skin there (zu01-hs, side views, 10/24) -> unlisted regions
    # keep only the upper bound
    REG = ("top", "back", "side", "front")
    shell = [REG.index(r_.strip()) for r_ in a.hair_shell.split(",") if r_.strip()] if a.hair_shell else []
    hs = np.full(len(REG), a.hair); Kx = K + len(REG)
    if shell:
        AX = head_axes(L)                                                # rows: right, up, forward
    # OPTION (--sparse-depth-pts): SfM sparse points as the face DEPTH observation (MediaPipe = image position only)
    spP = None; nsp = 0; spabs = []
    if a.sparse_depth_pts > 0:
        import pycolmap
        spP = np.array([p_.xyz for p_ in pycolmap.Reconstruction(a.sparse).points3D.values() if p_.track.length() >= 3])
        face_v = ext & grp(["nose_region", "upper_lip_region", "lower_lip_region", "left_orbital_region", "right_orbital_region",
                            "left_infraorbital_region", "right_infraorbital_region", "left_zygomatic_region", "right_zygomatic_region",
                            "left_cheek_region", "right_cheek_region", "middle_brow_region", "forehead_region", "chin_region"])             & ~grp(["left_brow_region", "right_brow_region"]) & ~scalp_g
        any_v = np.where(ext | G.group("eyes"))[0]                       # brow hair / eyeball points attach to these -> dropped
        fwd_ = head_axes(L)[2]; dshift = 0.0                             # --sparse-depth-shift: accumulated pose correction
        Racc = np.eye(3); tacc = np.zeros(3); c0 = L[[33, 263, 1, 152, 10]].mean(0)
    # --neck-pitch (S15P31B204-775): the head-neck angle was never fitted - the neck kept the template's angle to the head,
    # yet in the web recordings the angle that puts the model's throat on the photo throat ranged -8 .. +16 deg (12 recordings,
    # side views, 11/11): the throat sat up to 15 % IOD behind the photo, beyond the outline match range, and the photo neck
    # pulled the jaw out instead (blunt jaw, long under-chin). One unknown per person: the neck skin takes the head pose
    # turned by `pitch` about the head joint on the head's left-right axis, solved with b from the outline rows. It replaces
    # S15P31B204-768's --sparse-depth-head-only (the neck kept the landmark pose while the SfM depth correction turned the
    # head): that correction turned the neck 1.9-3.8 deg about this same axis (the other two mostly < 1 deg; 6 recordings,
    # 11/11), and the fitted angle takes it back
    neck_keep = G.W[G.joint_names.index("neck")] if a.neck_pitch else None
    pitch, pitch_ax = 0.0, head_axes(L)[0]
    head_j = G.joint_names.index("head")

    def neck_pivot():
        """the head joint in the world"""
        full_ = np.zeros(G.B_id.shape[0]); full_[use] = b
        return S * Rw @ G.joints(full_)[head_j] + tw

    def neck_pose():
        """(Rn, tn) of the neck skin: the head pose turned by `pitch` about the head joint"""
        jh = neck_pivot(); Rt = rodrigues(pitch_ax * pitch)
        return Rt @ Rw, Rt @ (tw - jh) + jh

    place = lambda Y_: to_world(Y_, S, Rw, tw, None if neck_keep is None else (neck_keep, *neck_pose()))
    for rd in range(a.sil_rounds):
        LAPS.lap("sil_round_setup")
        Y = G.T + np.tensordot(b, Ball, 1)
        Vw = place(Y)
        fn = np.cross(Vw[G.tri[:, 1]] - Vw[G.tri[:, 0]], Vw[G.tri[:, 2]] - Vw[G.tri[:, 0]]); vn = np.zeros_like(Vw)
        for k in range(3): np.add.at(vn, G.tri[:, k], fn)
        vn /= np.linalg.norm(vn, axis=1, keepdims=True) + 1e-12
        if ((Vw[ext] - Vw[ext].mean(0)) * vn[ext]).sum(1).mean() < 0: vn = -vn
        if hl_hair is not None:   # --hairline-json: hair layer per vertex, x eye distance
            dl = cKDTree(Vw[hl_line]).query(Vw)[0] / iod
            ramp_ = np.clip(dl / a.hair_ramp, 0.0, 1.0) if a.hair_ramp > 0 else 1.0     # --hair-ramp 0: full layer on all hair
            hair_v = np.where(hl_hair, a.hair * ramp_, 0.0)
        if shell:
            hd = vn @ AX.T                                               # vertex normal in head axes
            sreg = np.argmax(np.c_[hd[:, 1], -hd[:, 2], np.abs(hd[:, 0]), hd[:, 2]], 1)   # 0 top, 1 back, 2 side, 3 front
            Hs = np.zeros((Kx, Kx)); gs = np.zeros(Kx); nsh = [0] * len(REG)
        nprof = nprof_f = 0; pabs = []; JtWJ = np.zeros((K, K)); JtWr = np.zeros(K); npts = 0; rabs = []; nbg = nocc = 0; ncrown = 0; crabs = []; nedge = 0; eabs = []; nmid = 0
        nfs = 0; fsabs = []; nfp = 0; fpabs = []; nface = 0; fabs = []
        Pk = np.zeros(K + 1); Pg = 0.0                                   # --neck-pitch rows: [b-coupling, self], rhs
        if a.neck_pitch: jh_, Rt_ = neck_pivot(), rodrigues(pitch_ax * pitch)
        fcap = 1.0
        if a.crown_cap:
            # OPTION (2026-10-24, --crown-cap): the crown term pulls the skull up toward "person outline - fixed hair layer";
            # under voluminous hair that overshoots (zu01 / gyu01 1.13, above 99.5 % of real heads). From the lower to the
            # upper percentile of the real-head range (GNM prior, assets/head_ratio_range.json) its pull fades to 0;
            # the person outline stays an upper bound
            from head_ratios import measures, load_range
            full_ = np.zeros(G.B_id.shape[0]); full_[use] = b
            Vc_ = to_world(G.bind(full_)[o2g0], S, Rw, tw, None if neck_keep is None else (neck_keep[o2g0], *neck_pose()))
            crown_now = measures(Vc_, a._corr)["crown_h"]
            rr_ = load_range()["ratios"]["crown_h"]; lo_, hi_ = (rr_[k_.strip()] for k_ in a.crown_cap.split(","))
            fcap = float(np.clip((hi_ - crown_now) / max(hi_ - lo_, 1e-6), 0.0, 1.0))
        M3 = S * Rw                                                      # GNM space -> world
        def sil_frame(o):
            """one frame of the silhouette term (S15P31B204-702: frames side by side). Returns its rows in the old order
            ([("J" | "H", matrix, vector)]), counters and value lists; the caller adds them up frame by frame as before"""
            n, R, t, f, cx, cy, m, qp, bgq, pp, gray, _cm = o
            J_, c_, l_ = [], {}, {}

            def cnt(k, v): c_[k] = c_.get(k, 0) + v

            def lst(k, v): l_.setdefault(k, []).append(v)

            def add_rows(vids_, n2_, r_, w_):
                """Gauss-Newton rows of image residuals r_ (px along the image directions n2_) at the vertices vids_"""
                x, y, zz = Q[vids_].T
                Jp = np.zeros((len(vids_), 2, 3))
                Jp[:, 0, 0] = f / zz; Jp[:, 0, 2] = -f * x / zz ** 2; Jp[:, 1, 1] = f / zz; Jp[:, 1, 2] = -f * y / zz ** 2
                gw = np.einsum("pi,pij->pj", n2_, Jp) @ R                    # (P, 3) in the world
                # --neck-pitch: the neck skin's b-Jacobian turns with it
                g = (gw + neck_keep[vids_, None] * (gw @ Rt_ - gw) if a.neck_pitch else gw) @ M3   # (P, 3) in GNM space
                Jrow = np.einsum("pj,kpj->pk", g, Ball[:, G_index(vids_), :])  # (P, K)
                J_.append(("J", (Jrow * w_[:, None]).T @ Jrow, (Jrow * w_[:, None]).T @ (Jrow @ b - r_)))
                if a.neck_pitch:
                    # d r / d pitch: the neck skin turns about the head joint by its neck weight
                    jt = (gw * neck_keep[vids_, None] * np.cross(pitch_ax, Vw[vids_] - jh_)).sum(1)
                    J_.append(("P", np.r_[(Jrow * w_[:, None]).T @ jt, jt @ (w_ * jt)], jt @ (w_ * (Jrow @ b - r_))))

            def face_region_rows():
                """--face-region: the visible edge of the model's face region inside its outline onto the photo's face |
                neck skin border, along the edge's image normal (the smoothed face mask's gradient), both ways. The image
                work is done in the face region's box only"""
                bq, btree = face_border[n]
                facing = (nc * view).sum(1)
                ft = uv[face_tri[(facing[face_tri] > 0).all(1)]]
                if len(ft) == 0: return
                sgm = max(1.0, 0.01 * iod_px); mg = int(4 * sgm) + 4               # box margin: blur reach + erode
                x0, y0 = np.maximum(np.floor(ft.reshape(-1, 2).min(0)).astype(int) - mg, 0)
                x1, y1 = np.minimum(np.ceil(ft.reshape(-1, 2).max(0)).astype(int) + mg + 1, [W_, H])
                mf = np.zeros((y1 - y0, x1 - x0), np.uint8); cv2.fillPoly(mf, list(np.round(ft - [x0, y0]).astype(np.int32)), 1)
                cs_, _ = cv2.findContours(mf, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
                if not cs_: return
                ep = np.vstack([c_[:, 0, :] for c_ in cs_])
                ep = ep[cv2.erode(mm[y0:y1, x0:x1], np.ones((5, 5), np.uint8))[ep[:, 1], ep[:, 0]] > 0] + [x0, y0]   # inside the model outline
                cand = np.where(face_g & (face_edge | (np.abs(facing) < 0.35)) & (facing > -0.35))[0]
                if len(ep) < 10 or len(cand) < 10: return
                d_, j_ = cKDTree(uv[cand]).query(ep.astype(np.float64))
                vids = np.unique(cand[j_[d_ < 0.02 * iod_px]])                  # each edge pixel's face vertex, one row per vertex
                if len(vids) < 5: return
                p = uv[vids]; dq, jq = btree.query(p); ok = dq < SIL_MATCH * iod_px
                if ok.sum() < 5: return
                vids, p, q = vids[ok], p[ok], bq[jq[ok]]
                sm = cv2.GaussianBlur(mf.astype(np.float32), (0, 0), sgm)
                xi = np.clip(p[:, 0].astype(int) - x0, 0, x1 - x0 - 1); yi = np.clip(p[:, 1].astype(int) - y0, 0, y1 - y0 - 1)
                n2 = -np.c_[cv2.Sobel(sm, cv2.CV_32F, 1, 0)[yi, xi], cv2.Sobel(sm, cv2.CV_32F, 0, 1)[yi, xi]].astype(np.float64)
                nn = np.linalg.norm(n2, axis=1); okn = nn > 1e-6
                if okn.sum() < 5: return
                vids, p, q, n2 = vids[okn], p[okn], q[okn], n2[okn] / nn[okn, None]
                r = ((p - q) * n2).sum(1)                                    # px, + = model face reaches beyond the photo face skin
                sg = a.sil_sigma * iod_px; wf = 1.0 / (1.0 + (r / (2 * sg)) ** 2)
                add_rows(vids, n2, r, wf * (a.sil_frame_pts / max(wf.sum(), 1e-9)) / sg ** 2)   # same weight as the frame's outline
                cnt("nface", len(vids)); lst("fabs", r / iod_px * 100)
            if len(qp) < 50: return J_, c_, l_
            Q = Vw @ R.T + t; z = Q[:, 2]
            if (z <= 0).any(): return J_, c_, l_
            uv = np.c_[f * Q[:, 0] / z + cx, f * Q[:, 1] / z + cy]
            H, W_ = m.shape
            mm = np.zeros((H, W_), np.uint8); cv2.fillPoly(mm, list(np.round(uv[ext_tri]).astype(np.int32)), 1)
            cm, _ = cv2.findContours(mm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            if not cm: return J_, c_, l_
            qm = np.vstack([c[:, 0, :] for c in cm]).astype(np.float64)
            nc = vn @ R.T                                                # normals in the camera frame
            view = -Q / np.linalg.norm(Q, axis=1, keepdims=True)
            # every exterior vertex may be on the outline: face regions two-sided at background edges, the rest (scalp /
            # neck) only one-sided - VISIBLE skin must lie inside the model anywhere (eun02 forehead, 2026-10-16)
            cand = np.where(ext & (np.abs((nc * view).sum(1)) < 0.35))[0]
            if len(cand) < 20: return J_, c_, l_
            iod_px = f * iod / float(np.median((L[[33, 263, 1]] @ R.T + t)[:, 2]))
            if a.hair_edge_class and _cm is not None:
                # W7a option: a skin edge with HAIR right beyond it is the hairline, not the head's silhouette, however
                # thin the hair layer is (short hair at the temples: the person mask ends within ~15 px of the skin edge,
                # so background_edge() called it a silhouette and the head was pulled in to the hairline)
                kh = max(3, int(a.hair_edge_r * iod_px)) | 1
                hn = cv2.dilate((_cm == 1).astype(np.uint8), np.ones((kh, kh), np.uint8))
                qx = np.clip(qp[:, 0].astype(int), 0, hn.shape[1] - 1); qy = np.clip(qp[:, 1].astype(int), 0, hn.shape[0] - 1)
                bgq = bgq & (hn[qy, qx] == 0)
            if a.accessory_class and _cm is not None and len(pp):
                # W7a option: glasses / hats on the head (class 5 "other") are not hair or skull (min01: glasses pushed
                # up on the head bent the crown)
                ka = max(3, int(0.05 * iod_px)) | 1
                ac = cv2.dilate((_cm == 5).astype(np.uint8), np.ones((ka, ka), np.uint8))
                px_ = np.clip(pp[:, 0].astype(int), 0, ac.shape[1] - 1); py_ = np.clip(pp[:, 1].astype(int), 0, ac.shape[0] - 1)
                pp = pp[ac[py_, px_] == 0]
            d_c, j_c = cKDTree(uv[cand]).query(qm)
            near = d_c < 0.02 * iod_px
            if near.sum() < 10: return J_, c_, l_
            vids, first = np.unique(cand[j_c[near]], return_index=True)   # one outline point per vertex
            p = uv[vids]
            if a.forehead_skin_pts > 0:
                # OPTION (2026-10-24, --forehead-skin-pts): photo SKIN above the brows is evidence - it must lie inside the
                # model. The outline term only sees skin edges matched to a model outline vertex and weighs them with the
                # whole outline, so 6/8 default fits left the upper forehead 2-4 % IOD outside (side views, under a fringe)
                upi_ = ((L[10] - L[152]) @ R.T)[:2]; upi_ /= np.linalg.norm(upi_) + 1e-12
                g9 = (L[9] @ R.T + t); g9 = np.array([f * g9[0] / g9[2] + cx, f * g9[1] / g9[2] + cy])
                fz = ((qp - g9) @ upi_ > a.forehead_skin_above * iod_px) & (np.linalg.norm(qp - g9, axis=1) < 1.6 * iod_px)
                if fz.sum() >= 20:
                    qx_ = np.clip(qp[fz, 0].astype(int), 0, W_ - 1); qy_ = np.clip(qp[fz, 1].astype(int), 0, H - 1)
                    # outside by more than --forehead-skin-tol: where the skin edge IS the model silhouette, half of its
                    # pixels fall 1-2 px outside the rendered mask
                    dto = cv2.distanceTransform((1 - mm).astype(np.uint8), cv2.DIST_L2, 3)
                    outq = qp[fz][dto[qy_, qx_] > a.forehead_skin_tol * iod_px]
                    # a frame where much of the "forehead skin" is outside = segmentation error (hand, background)
                    if len(outq) and len(outq) <= a.forehead_skin_share * fz.sum():
                        dv, jv = cKDTree(p).query(outq)
                        okv = dv < a.forehead_skin_max * iod_px
                        if okv.sum() >= 3:
                            fv = vids[jv[okv]]; fq = outq[okv]
                            fn2 = nc[fv][:, :2]; fn2 /= np.linalg.norm(fn2, axis=1, keepdims=True) + 1e-12
                            fr = ((uv[fv] - fq) * fn2).sum(1)                  # px, < 0 = model inside the skin
                            ins = fr < 0
                            if ins.sum() >= 3:
                                fv, fr, fn2 = fv[ins], fr[ins], fn2[ins]
                                # one row per vertex: its worst violation
                                o_ = np.lexsort((fr, fv)); fv, fr, fn2 = fv[o_], fr[o_], fn2[o_]
                                u_, i_ = np.unique(fv, return_index=True); fv, fr, fn2 = fv[i_], fr[i_], fn2[i_]
                                sgf = a.sil_sigma * iod_px
                                wf = 1.0 / (1.0 + (fr / (2 * sgf)) ** 2)
                                wf = wf * (a.forehead_skin_pts / max(wf.sum(), 20.0)) / sgf ** 2
                                xf, yf, zf = Q[fv].T
                                Jf = np.zeros((len(fv), 2, 3))
                                Jf[:, 0, 0] = f / zf; Jf[:, 0, 2] = -f * xf / zf ** 2; Jf[:, 1, 1] = f / zf; Jf[:, 1, 2] = -f * yf / zf ** 2
                                gf_ = np.einsum("pi,pij->pj", fn2, Jf) @ (R @ M3)
                                Jfr = np.einsum("pj,kpj->pk", gf_, Ball[:, fv, :])
                                J_.append(("J", (Jfr * wf[:, None]).T @ Jfr, (Jfr * wf[:, None]).T @ (Jfr @ b - fr)))
                                cnt("nfs", len(fv)); lst("fsabs", -fr / iod_px * 100)
            if n in face_border: face_region_rows()
            dq, jq = cKDTree(qp).query(p)
            ok = dq < SIL_MATCH * iod_px                                     # photo outline nearby (not hair / neck)
            # --neck-pitch: the neck's own outline is matched farther - a wrong neck angle put the lower throat up to
            # 0.2 x eye distance behind the photo, out of reach, so only the upper neck told the angle
            if a.neck_pitch: ok |= (neck_keep[vids] >= 0.5) & (dq < NECK_MATCH * iod_px)
            if ok.sum() < 10: return J_, c_, l_
            vids, p, q, bg = vids[ok], p[ok], qp[jq[ok]], bgq[jq[ok]]
            n2 = nc[vids][:, :2]; n2 /= np.linalg.norm(n2, axis=1, keepdims=True) + 1e-12
            r0 = ((p - q) * n2).sum(1)                                       # px along the outline normal (+ = model outside)
            # skin edge against HAIR (hairline, hanging hair): the head continues under the hair, so only a model
            # outline INSIDE the visible skin is wrong there (one-sided); against the background: two-sided
            # CONCAVE parts of the model outline (nasion, under the nose, lip folds in a side view): a silhouette never shows
            # a concavity - there the photo outline is the FAR side of the face (far brow / far cheek), not the midline
            # (user-marked woo01 profile, 2026-10-16). Only "model outside the photo outline" is an error there.
            if a.concave_r > 0:
                rr = max(3, int(a.concave_r * iod_px)) | 1
                frac = cv2.blur(mm.astype(np.float32), (rr, rr))
                conc = frac[np.clip(p[:, 1].astype(int), 0, H - 1), np.clip(p[:, 0].astype(int), 0, W_ - 1)] > 0.58
            else:
                conc = np.zeros(len(vids), bool)
            # --neck-pitch: nothing hides the jaw-neck concavity in a side view - it IS the silhouette, so the neck's outline
            # counts both ways there (the dropped "model inside" rows were the evidence for the neck angle)
            if a.neck_pitch: conc &= neck_keep[vids] < 0.5
            keep = np.where(conc, r0 > 0, (bg & elig[vids]) | (r0 < 0))
            # ... and on the MIDLINE there (nose bridge, under the nose) the true profile is the strongest intensity edge
            # just INSIDE the outline (nose in front of the far cheek): pulled onto it
            mid_c = conc & midline[vids]
            prof = profile_rows(a, L, R, t, f, cx, cy, Q, uv, cand, m, mm, iod_px, M3, Ball) if a.profile_fit else None
            if prof is not None:
                Jp_, ep_, wp_ = prof
                J_.append(("J", (Jp_ * wp_[:, None]).T @ Jp_, (Jp_ * wp_[:, None]).T @ (Jp_ @ b - ep_)))
                cnt("nprof", len(ep_)); cnt("nprof_f", 1); lst("pabs", np.abs(ep_) / iod_px * 100)
                mid_c = mid_c & False        # the photo profile itself decides the midline in this frame (no inner-edge guess)
            if a.forehead_profile_pts > 0:
                fpr = profile_rows(a, L, R, t, f, cx, cy, Q, uv, cand, m, mm, iod_px, M3, Ball, forehead=True)
                if fpr is not None:
                    Jq_, eq_, wq_ = fpr
                    J_.append(("J", (Jq_ * wq_[:, None]).T @ Jq_, (Jq_ * wq_[:, None]).T @ (Jq_ @ b - eq_)))
                    cnt("nfp", len(eq_)); lst("fpabs", eq_ / iod_px * 100)
            if a.edge_frame_pts > 0 and mid_c.sum() >= 5:
                jr = midline_edge_rows(a, Q, vids[mid_c], p[mid_c], nc, gray, f, iod_px, R, M3, Ball)
                if jr is not None:
                    Je, ee, we = jr
                    J_.append(("J", (Je * we[:, None]).T @ Je, (Je * we[:, None]).T @ (Je @ b - ee)))
                    cnt("nmid", len(ee))
            if keep.sum() < 10: return J_, c_, l_
            vids, p, q, r0, n2 = vids[keep], p[keep], q[keep], r0[keep], n2[keep]
            cnt("nbg", int(bg.sum())); cnt("nocc", int((~bg).sum()))
            sig = a.sil_sigma * iod_px
            wr = 1.0 / (1.0 + (r0 / (2 * sig)) ** 2)                        # Cauchy-robust weights
            # neighbouring outline pixels are not independent measurements: each frame counts as --sil-frame-pts
            # points in total (otherwise ~200 px per frame x 35 frames outweigh the 468 landmarks and bend the face)
            wr = wr * (a.sil_frame_pts / max(wr.sum(), 1e-9)) / sig ** 2
            add_rows(vids, n2, r0, wr)
            cnt("npts", len(vids)); lst("rabs", np.abs(r0) / iod_px * 100)
            if a.edge_frame_pts > 0:
                jr = inner_edge_rows(a, Q, uv, vn, nc, view, edge_v, qm, gray, f, iod_px, R, M3, Ball, b)
                if jr is not None:
                    Je, ee, we = jr
                    J_.append(("J", (Je * we[:, None]).T @ Je, (Je * we[:, None]).T @ (Je @ b - ee)))
                    cnt("nedge", len(ee)); lst("eabs", np.abs(ee) / iod_px * 100)
            if shell and a.crown_frame_pts > 0 and len(pp) > 50:
                # --hair-shell: the hair-covered skull seen through the hair in the chosen regions: person outline = skull +
                # hs[region]. The person outline is always an upper bound; far beyond skull + layer (hanging / voluminous
                # hair) only that bound counts
                cc = np.where(crown & (np.abs((nc * view).sum(1)) < 0.35))[0]
                if len(cc) >= 20:
                    d2, j2 = cKDTree(uv[cc]).query(qm); nr = d2 < 0.02 * iod_px
                    cv_ = np.unique(cc[j2[nr]])
                    if len(cv_) >= 10:
                        m2 = nc[cv_][:, :2]; m2 /= np.linalg.norm(m2, axis=1, keepdims=True) + 1e-12
                        dq2, jq2 = cKDTree(pp).query(uv[cv_])
                        r_ = ((uv[cv_] - pp[jq2]) * m2).sum(1)                   # px, + = model outside the person outline
                        rg = sreg[cv_]
                        over = r_ + a.hair_min * iod_px > 0
                        lay = np.isin(rg, shell)
                        if a.hair_shell_taper > 0 and len(qp):
                            # the layer thins to 0 toward the visible hairline: person outline near the skin outline
                            # -> upper bound only (zu01-hs2 / gyu01-hs2: forehead top still 3.5 % behind the photo skin)
                            lay &= cKDTree(qp).query(pp[jq2])[0] > a.hair_shell_taper * iod_px
                        okc = (dq2 < a.hair_shell_search * iod_px) & (over | (lay & (-r_ <= (hs[rg] + a.hair_shell_gate) * iod_px)))
                        if okc.sum() >= 10:
                            cv_, m2, r_, rg, over = cv_[okc], m2[okc], r_[okc], rg[okc], over[okc]
                            e = np.where(over, r_ + a.hair_min * iod_px, r_ + hs[rg] * iod_px)
                            sg = a.sil_sigma * iod_px
                            wc = 1.0 / (1.0 + (e / (2 * sg)) ** 2) * np.where(over, 2.0, 1.0)
                            wc = wc * (a.crown_frame_pts / max(wc.sum(), 1e-9)) / sg ** 2
                            xx, yy, zc = Q[cv_].T
                            Jc = np.zeros((len(cv_), 2, 3))
                            Jc[:, 0, 0] = f / zc; Jc[:, 0, 2] = -f * xx / zc ** 2; Jc[:, 1, 1] = f / zc; Jc[:, 1, 2] = -f * yy / zc ** 2
                            gc = np.einsum("pi,pij->pj", m2, Jc) @ (R @ M3)
                            Jh = np.zeros((len(cv_), len(REG))); Jh[np.arange(len(cv_)), rg] = iod_px * (~over)   # d e / d hs
                            Ja = np.c_[np.einsum("pj,kpj->pk", gc, Ball[:, cv_, :]), Jh]
                            J_.append(("H", (Ja * wc[:, None]).T @ Ja, (Ja * wc[:, None]).T @ (Ja @ np.r_[b, hs] - e)))
                            cnt("ncrown", len(cv_)); lst("crabs", e / iod_px * 100)
                            lst("nsh", [int((rg == k_).sum()) for k_ in range(len(REG))])
            elif a.crown_frame_pts > 0 and len(pp) > 50:
                # model crown outline vs person outline, only where the outline faces UP (top arc: hair lies flat there;
                # at the sides long hair hangs away from the head and says nothing about the skull)
                upi = (L[10] - L[152]) @ R.T; upi = np.array([upi[0], upi[1]]); upi /= np.linalg.norm(upi) + 1e-12
                cc = np.where(crown & (np.abs((nc * view).sum(1)) < 0.35))[0]
                if len(cc) >= 20:
                    d2, j2 = cKDTree(uv[cc]).query(qm); nr = d2 < 0.02 * iod_px
                    cv_ = np.unique(cc[j2[nr]])
                    if len(cv_) >= 10:
                        pc_ = uv[cv_]; m2 = nc[cv_][:, :2]; m2 /= np.linalg.norm(m2, axis=1, keepdims=True) + 1e-12
                        # image y grows downward: "up" in the image is -y of the projected head axis
                        topf = (m2 @ (upi * np.array([1, 1]))) > 0.5
                        if a.side_hair:
                            # W7a option: the SIDES of the head too (temples, above the ears), where the outline faces
                            # sideways - only where the hair layer there is thin (short hair); long / hanging hair is
                            # skipped below by --hair-max
                            hgt = ((Vw[cv_] - (L[33] + L[263]) / 2) @ (L[10] - L[152])) > 0     # above the eye line
                            topf = topf | ((np.abs(m2 @ upi) < 0.5) & hgt)
                        if len(pp) == 0: topf[:] = False
                        dq2, jq2 = cKDTree(pp if len(pp) else np.zeros((1, 2))).query(pc_); okc = topf & (dq2 < 0.3 * iod_px)
                        if okc.sum() >= 10:
                            cv_, pc_, q2, m2 = cv_[okc], pc_[okc], pp[jq2[okc]], m2[okc]
                            # hair thickness differs per person: an upper bound (skull at least --hair-min inside the
                            # person outline, firm) + a weak pull toward the typical --hair layer; the visible forehead
                            # skin (one-sided) is the lower bound
                            r_ = ((pc_ - q2) * m2).sum(1)
                            side_pt = (np.abs(m2 @ upi) < 0.5)
                            hair_t = np.where(side_pt, a.hair_side, a.hair) if a.side_hair else np.full(len(r_), a.hair)
                            hmin = a.hair_min
                            if hair_v is not None: hair_t = hair_v[cv_]; hmin = np.minimum(a.hair_min, hair_t)   # skin: 0
                            e_ub = r_ + hmin * iod_px; e_t = r_ + hair_t * iod_px
                            over = e_ub > 0
                            e = np.where(over, e_ub, e_t)
                            if a.hair_max > 0:
                                # W7a option: the person outline far outside the model = voluminous / curly / hanging
                                # hair (zu01 "Megamind" crown). Its thickness is unknown: only the upper bound stays,
                                # the statistical model decides the skull there
                                vol = (~over) & (-r_ > a.hair_max * iod_px)
                                keep_c = ~vol
                                cv_, pc_, q2, m2, e, over = cv_[keep_c], pc_[keep_c], q2[keep_c], m2[keep_c], e[keep_c], over[keep_c]
                                if len(cv_) < 10: return J_, c_, l_
                            sideq = np.abs(m2 @ upi) < 0.5
                            if a.side_hair:
                                # sides: only where the hair layer is THIN (person outline within --side-max of the
                                # model): long / hanging / voluminous hair at the sides says nothing about the skull
                                # (10/19 first try without it widened woo01's cheekbones 1.40 -> 1.47)
                                rr_ = ((pc_ - q2) * m2).sum(1)
                                drop = sideq & ~over & (-rr_ > a.side_max * iod_px)
                                cv_, pc_, q2, m2, e, over, sideq = cv_[~drop], pc_[~drop], q2[~drop], m2[~drop], e[~drop], over[~drop], sideq[~drop]
                                if len(cv_) < 10: return J_, c_, l_
                            sg = a.sil_sigma * iod_px
                            wc = 1.0 / (1.0 + (e / (2 * sg)) ** 2) * np.where(over, 2.0, 1.0)
                            if a.side_hair: wc = wc * np.where(sideq, a.side_w, 1.0)
                            wc = wc * (a.crown_frame_pts / max(wc.sum(), 1e-9)) / sg ** 2
                            if fcap < 1.0: wc = wc * np.where(over, 1.0, fcap)   # --crown-cap: fade the pull, keep the bound
                            xx, yy, zc = Q[cv_].T
                            Jc = np.zeros((len(cv_), 2, 3))
                            Jc[:, 0, 0] = f / zc; Jc[:, 0, 2] = -f * xx / zc ** 2; Jc[:, 1, 1] = f / zc; Jc[:, 1, 2] = -f * yy / zc ** 2
                            gc = np.einsum("pi,pij->pj", m2, Jc) @ (R @ M3)
                            Jr = np.einsum("pj,kpj->pk", gc, Ball[:, cv_, :])
                            J_.append(("J", (Jr * wc[:, None]).T @ Jr, (Jr * wc[:, None]).T @ (Jr @ b - e)))
                            cnt("ncrown", len(cv_)); lst("crabs", e / iod_px * 100)
            return J_, c_, l_

        LAPS.lap("sil_frames")                                           # render, match and rows of every frame
        from concurrent.futures import ThreadPoolExecutor
        from parallel import workers
        with ThreadPoolExecutor(workers(len(obs)) if obs else 1) as pool:
            per_frame = list(pool.map(sil_frame, obs))
        LAPS.lap("sil_add")
        for J_, c_, l_ in per_frame:                                      # same order of additions as the serial loop
            for kind, A_, g_ in J_:
                if kind == "J": JtWJ += A_; JtWr += g_
                elif kind == "P": Pk += A_; Pg += g_
                else: Hs += A_; gs += g_
            nface += c_.get("nface", 0); fabs += l_.get("fabs", [])
            nfs += c_.get("nfs", 0); nprof += c_.get("nprof", 0); nprof_f += c_.get("nprof_f", 0); nfp += c_.get("nfp", 0)
            nmid += c_.get("nmid", 0); nbg += c_.get("nbg", 0); nocc += c_.get("nocc", 0); npts += c_.get("npts", 0)
            nedge += c_.get("nedge", 0); ncrown += c_.get("ncrown", 0)
            fsabs += l_.get("fsabs", []); pabs += l_.get("pabs", []); fpabs += l_.get("fpabs", []); rabs += l_.get("rabs", [])
            eabs += l_.get("eabs", []); crabs += l_.get("crabs", [])
            for row_ in l_.get("nsh", []):
                for k_ in range(len(REG)): nsh[k_] += row_[k_]
        LAPS.lap("sil_sparse_depth")
        if spP is not None:
            from scipy.spatial import cKDTree as _KD
            dd_, jj_ = _KD(Vw[any_v]).query(spP); vv_ = any_v[jj_]
            ok_ = face_v[vv_] & (dd_ < a.sparse_depth_band * iod)
            if a.sparse_depth_brow_gap > 0:
                bv_ = np.where(ext & grp(["left_brow_region", "right_brow_region"]))[0]
                ok_ &= _KD(Vw[bv_]).query(spP)[0] > a.sparse_depth_brow_gap * iod
            vv_ = vv_[ok_]; P_ = spP[ok_]; n_ = vn[vv_]
            h_ = np.einsum("ij,ij->i", P_ - Vw[vv_], n_)                 # + = the point is in FRONT of the model
            if len(vv_) >= 20 and a.sparse_depth_shift:
                for _it in range(3):                                     # point-to-plane rigid step (robust), applied to the head pose
                    sgp = a.sparse_depth_sigma * iod; wr = 1.0 / (1.0 + (h_ / (2 * sgp)) ** 2)
                    Ar = np.c_[np.cross(Vw[vv_] - c0, n_), n_]           # h' = h - a.omega - n.tau
                    xr = np.linalg.solve((Ar * wr[:, None]).T @ Ar + 1e-9 * np.eye(6), (Ar * wr[:, None]).T @ h_)
                    om, ta = xr[:3], xr[3:]; th = np.linalg.norm(om)
                    Kx_ = np.array([[0, -om[2], om[1]], [om[2], 0, -om[0]], [-om[1], om[0], 0]])
                    Rc = np.eye(3) + (np.sin(th) / th if th > 1e-12 else 1.0) * Kx_ + ((1 - np.cos(th)) / th ** 2 if th > 1e-12 else 0.5) * Kx_ @ Kx_
                    Racc = Rc @ Racc; tacc = Rc @ tacc + ta
                    Rw = Rc @ Rw; tw = Rc @ (tw - c0) + c0 + ta; M3 = S * Rw
                    Vw = (Rc @ (Vw - c0).T).T + c0 + ta; vn = vn @ Rc.T; n_ = vn[vv_]
                    h_ = np.einsum("ij,ij->i", P_ - Vw[vv_], n_)
                dshift = float(tacc @ fwd_)
            if len(vv_) >= 20:
                sg_ = a.sparse_depth_sigma * iod
                wp_ = 1.0 / (1.0 + (h_ / (2 * sg_)) ** 2)
                wp_ = wp_ * (a.sparse_depth_pts / max(wp_.sum(), 1e-9)) / sg_ ** 2
                gp_ = n_ @ M3                                            # d(n . V)/d(Y) per point (world <- GNM space)
                Jp_ = np.einsum("pj,kpj->pk", gp_, Ball[:, vv_, :])
                e_ = -h_                                                 # model - observation along the normal
                JtWJ += (Jp_ * wp_[:, None]).T @ Jp_; JtWr += (Jp_ * wp_[:, None]).T @ (Jp_ @ b - e_)
                nsp = len(vv_); spabs = h_ / iod * 100
        LAPS.lap("sil_solve")
        # landmark term (exact, linear) with the current similarity; nose / lip landmarks: their DEPTH (head forward axis)
        # only counts --lm-depth-w (MediaPipe's depth of the nasion / philtrum follows its face prior; woo01's profile
        # protruded there, user-marked 2026-10-16) - the side-view inner edges / outlines decide it
        tgt = ((L - tw) @ Rw) / S - Tk
        sigL = a.sigma * iod / S
        Bm = head_axes(L) @ Rw                                          # head axes in model space (rows)
        Wf = np.ones((468, 3)); Wf[depth_lm, 2] = a.lm_depth_w
        Wi = np.einsum("ka,ik,kb->iab", Bm, Wf, Bm) * w[:, None, None]  # B^T diag(Wf_i) B per landmark
        A3 = A.reshape(468, 3, K); t3 = tgt.reshape(468, 3)
        WA = np.einsum("iab,ibk->iak", Wi, A3)
        Hl = np.einsum("iak,ial->kl", A3, WA) / sigL ** 2; gl = np.einsum("iak,ia->k", WA, t3) / sigL ** 2
        mu = 1.0                                                         # damping toward the current b
        if shell:
            # [b, hs] together; hs prior N(--hair, --hair-sd^2) per region, same damping
            Hf = Hs.copy(); Hf[:K, :K] += Hl + JtWJ + np.eye(K) * (1 + mu)
            gf = gs.copy(); gf[:K] += gl + JtWr + mu * b
            for k_ in range(len(REG)):
                Hf[K + k_, K + k_] += 1.0 / a.hair_sd ** 2 + mu; gf[K + k_] += a.hair / a.hair_sd ** 2 + mu * hs[k_]
            x = np.linalg.solve(Hf, gf); b = x[:K]; hs = np.clip(x[K:], a.hair_min, 1.0)
        elif a.neck_pitch:
            # [b, pitch step] together; pitch prior N(0, --neck-pitch-sd^2), same damping
            sd = np.radians(a.neck_pitch_sd); Hp = np.zeros((K + 1, K + 1))
            Hp[:K, :K] = Hl + JtWJ + np.eye(K) * (1 + mu); Hp[:K, K] = Hp[K, :K] = Pk[:K]; Hp[K, K] = Pk[K] + 1 / sd ** 2 + mu
            x = np.linalg.solve(Hp, np.r_[gl + JtWr + mu * b, Pg - pitch / sd ** 2]); b = x[:K]; pitch += float(x[K])
        else:
            b = np.linalg.solve(Hl + JtWJ + np.eye(K) * (1 + mu), gl + JtWr + mu * b)
        Yk = Tk + np.tensordot(b, B, 1); S, Rw, tw = umeyama(Yk, L, w)
        if spP is not None and a.sparse_depth_shift: Rw = Racc @ Rw; tw = Racc @ (tw - c0) + c0 + tacc
        ra = np.concatenate(rabs) if rabs else np.zeros(1)
        cr = np.concatenate(crabs) if crabs else np.zeros(1)
        stats.append({"round": rd, "outline_points": int(npts), "background_edge": nbg, "hair_edge": nocc,
                      "inner_edge_points": nedge, "midline_edge_points": nmid, "inner_edge_median_pct_iod": round(float(np.median(np.concatenate(eabs))), 2) if eabs else None,
                      "crown_points": ncrown, "crown_median_pct_iod": round(float(np.median(cr)), 2), "median_abs_pct_iod": round(float(np.median(ra)), 3),
                      "b_norm": round(float(np.linalg.norm(b)), 2)})
        if face_border:
            stats[-1].update({"face_region_points": nface, "face_region_median_signed_pct_iod": round(float(np.median(np.concatenate(fabs))), 2) if fabs else None})
        if a.forehead_skin_pts > 0:
            stats[-1].update({"forehead_skin_points": nfs, "forehead_skin_median_pct_iod": round(float(np.median(np.concatenate(fsabs))), 2) if fsabs else None})
        if a.forehead_profile_pts > 0:
            stats[-1].update({"forehead_profile_points": nfp, "forehead_profile_median_signed_pct_iod": round(float(np.median(np.concatenate(fpabs))), 2) if fpabs else None})
        if a.crown_cap:
            stats[-1].update({"crown_h_at_start": round(float(crown_now), 3), "crown_pull": round(fcap, 3)})
        if shell:
            stats[-1].update({"hair_layer": {REG[k_]: round(float(hs[k_]), 3) for k_ in shell}, "hair_shell_points": {REG[k_]: nsh[k_] for k_ in shell}})
        if spP is not None:
            stats[-1].update({"sparse_depth_points": int(nsp), "sparse_depth_median_pct_iod": round(float(np.median(spabs)), 2) if len(spabs) else None,
                              "sparse_depth_shift_pct_iod": round(float(dshift / iod * 100), 2),
                              "sparse_depth_rot_deg": round(float(np.degrees(np.arccos(np.clip((np.trace(Racc) - 1) / 2, -1, 1)))), 2) if spP is not None else None})
        if a.profile_fit:
            stats[-1].update({"profile_frames": nprof_f, "profile_points": nprof,
                              "profile_median_pct_iod": round(float(np.median(np.concatenate(pabs))), 2) if pabs else None})
        if a.neck_pitch: stats[-1]["neck_pitch_deg"] = round(float(np.degrees(pitch)), 2)
    rep["silhouette"] = {"frames": len(obs), "rounds": stats}
    if shell: rep["hair_shell"] = {"regions": [REG[k_] for k_ in shell], "layer_x_iod": stats[-1]["hair_layer"] if stats else None}
    rep["_obs"] = obs
    return b, S, Rw, tw, None if neck_keep is None else neck_pose()


def _read_pts(img, x, y):
    import cv2
    n = len(x); W = 4096; rows = max(1, (n + W - 1) // W); pad = rows * W - n
    X = np.r_[x, np.zeros(pad)].astype(np.float32).reshape(rows, W); Y = np.r_[y, np.zeros(pad)].astype(np.float32).reshape(rows, W)
    return cv2.remap(img, X, Y, cv2.INTER_LINEAR).reshape(-1)[:n]


def inner_edge_rows(a, Q, uv, vn, nc, view, edge_v, qm, gray, f, iod_px, R, M3, Ball, b):
    """Rows of the INNER-contour term for one frame: model vertices that are grazing (on an occluding contour), visible
    and NOT on the outer outline (jaw line over the neck, ear rim) -> the strongest photo intensity edge along their image
    normal within --edge-search x eye distance; residual = how far the model contour must move to sit on it. Weak or no
    edge (a jaw line hidden by soft tissue) -> no row: the term never invents a jaw line."""
    import cv2
    from scipy.spatial import cKDTree
    H, W_ = gray.shape
    gz = (np.abs((nc * view).sum(1)) < 0.25) & edge_v & (Q[:, 2] > 0)
    # visibility: coarse z-buffer of all vertices (1/4 resolution), like uv_bake
    um, vm = uv[:, 0] / 4, uv[:, 1] / 4
    okm = (um >= 0) & (um < W_ // 4) & (vm >= 0) & (vm < H // 4)
    zb = np.full((H // 4 + 1, W_ // 4 + 1), np.inf)
    np.minimum.at(zb, (vm[okm].astype(int), um[okm].astype(int)), Q[okm, 2])
    zb = cv2.erode(np.where(np.isinf(zb), 1e9, zb).astype(np.float32), np.ones((3, 3), np.uint8))
    zmed = float(np.median(Q[okm, 2])) if okm.any() else 1.0
    cand = np.where(gz & okm)[0]
    if len(cand) < 15: return None
    vis = Q[cand, 2] <= zb[vm[cand].astype(int), um[cand].astype(int)] + 0.01 * zmed
    cand = cand[vis]
    if len(cand) < 15: return None
    d_out, _ = cKDTree(qm).query(uv[cand])
    cand = cand[d_out > 0.03 * iod_px]                         # outer outline points are handled by the silhouette term
    if len(cand) < 15: return None
    n2 = nc[cand][:, :2]; n2 /= np.linalg.norm(n2, axis=1, keepdims=True) + 1e-12
    g = cv2.GaussianBlur(gray, (0, 0), max(1.0, 0.004 * iod_px)).astype(np.float32)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3); gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    r = max(4, int(a.edge_search * iod_px)); ks = np.arange(-r, r + 1, dtype=np.float32)
    p = uv[cand]
    X = p[:, 0][:, None] + ks[None] * n2[:, 0][:, None]; Y = p[:, 1][:, None] + ks[None] * n2[:, 1][:, None]
    sx = _read_pts(gx, X.ravel(), Y.ravel()).reshape(X.shape); sy = _read_pts(gy, X.ravel(), Y.ravel()).reshape(X.shape)
    s = np.abs(sx * n2[:, 0][:, None] + sy * n2[:, 1][:, None])
    s = s * (1 - 0.3 * np.abs(ks)[None] / r)                    # mild preference for the nearest edge
    kbest = s.argmax(1); smax = s.max(1)
    ref = np.median(np.hypot(gx, gy)[::4, ::4][g[::4, ::4] > 20]) + 1e-3
    strong = smax > a.edge_min * ref
    if strong.sum() < 10: return None
    cand, n2, kbest, smax = cand[strong], n2[strong], kbest[strong], smax[strong]
    e = -ks[kbest]                                              # (p - q) . n2 : model must move by +k along n2
    sig = a.sil_sigma * iod_px
    we = np.clip(smax / (a.edge_min * ref * 3), 0.3, 1.0) / (1.0 + (e / (2 * sig)) ** 2)
    we = we * (a.edge_frame_pts / max(we.sum(), 1e-9)) / sig ** 2
    x, y, zz = Q[cand].T
    Jp = np.zeros((len(cand), 2, 3))
    Jp[:, 0, 0] = f / zz; Jp[:, 0, 2] = -f * x / zz ** 2; Jp[:, 1, 1] = f / zz; Jp[:, 1, 2] = -f * y / zz ** 2
    gg = np.einsum("pi,pij->pj", n2, Jp) @ (R @ M3)
    Je = np.einsum("pj,kpj->pk", gg, Ball[:, cand, :])
    return Je, e, we


def midline_edge_rows(a, Q, vids, p, nc, gray, f, iod_px, R, M3, Ball):
    """strongest intensity edge INSIDE the outline (search toward the face only) for midline outline points in concave
    profile parts; rows like the silhouette term (residual = how far the model point must move inward)"""
    import cv2
    n2 = nc[vids][:, :2]; n2 /= np.linalg.norm(n2, axis=1, keepdims=True) + 1e-12
    g = cv2.GaussianBlur(gray, (0, 0), max(1.0, 0.004 * iod_px)).astype(np.float32)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3); gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    r = max(4, int(a.mid_search * iod_px)); ks = -np.arange(2, r + 1, dtype=np.float32)          # inward only
    X = p[:, 0][:, None] + ks[None] * n2[:, 0][:, None]; Y = p[:, 1][:, None] + ks[None] * n2[:, 1][:, None]
    sx = _read_pts(gx, X.ravel(), Y.ravel()).reshape(X.shape); sy = _read_pts(gy, X.ravel(), Y.ravel()).reshape(X.shape)
    sv = np.abs(sx * n2[:, 0][:, None] + sy * n2[:, 1][:, None])
    kb = sv.argmax(1); sm = sv.max(1)
    ref = np.median(np.hypot(gx, gy)[::4, ::4][g[::4, ::4] > 20]) + 1e-3
    ok = sm > a.edge_min * ref
    if ok.sum() < 5: return None
    vids, n2, kb, sm = vids[ok], n2[ok], kb[ok], sm[ok]
    e = -ks[kb]                                                  # > 0: model point is outside the edge, move inward
    sig = a.sil_sigma * iod_px
    we = np.clip(sm / (a.edge_min * ref * 3), 0.3, 1.0) / (1.0 + (e / (2 * sig)) ** 2)
    we = we * (a.edge_frame_pts / max(we.sum(), 1e-9)) / sig ** 2
    x, y, zz = Q[vids].T
    Jp = np.zeros((len(vids), 2, 3))
    Jp[:, 0, 0] = f / zz; Jp[:, 0, 2] = -f * x / zz ** 2; Jp[:, 1, 1] = f / zz; Jp[:, 1, 2] = -f * y / zz ** 2
    gg = np.einsum("pi,pij->pj", n2, Jp) @ (R @ M3)
    return np.einsum("pj,kpj->pk", gg, Ball[:, vids, :]), e, we


def profile_rows(a, L, R, t, f, cx, cy, Q, uv, cand, m, mm, iod_px, M3, Ball, forehead=False):
    """OPTION (2026-10-23, --profile-fit): near-90-degree frames only. Per image row from the glabella (landmark 9) to the
    upper lip (landmark 0): the photo SKIN outline (first exit of the skin mask walking face-forward) vs the model's
    own outline in the same camera, TWO-sided. Both are silhouettes of the same view, so a concave part (nasion, under
    the nose) is compared like any other (the general silhouette term is one-sided there because at 20-75 degrees the
    outline is the far brow / cheek; at ~90 degrees the near profile and the outline coincide; gyu01 hand-traced profile,
    10/23). The model row point = the grazing model vertex nearest to the model outline at that row; residual =
    face-forward image distance model - photo (px, + = model in front). Rows where photo and model differ by more than
    --profile-gap x eye distance (hand / other person / hair in the mask) are skipped.
    forehead=True (OPTION 2026-10-24, --forehead-profile-pts): rows from the glabella UP to the last row with photo skin
    (behind a fringe the skin edge against the hair is the forehead profile: min01 user-marked side photo, the model
    stood 3.8 % IOD in front of it because a skin edge against hair is otherwise one-sided)."""
    from scipy.spatial import cKDTree
    sys.path.insert(0, os.path.join(HERE, "..", "tools"))
    from pose90_check import outline
    ax = head_axes(L)
    yaw = float(np.degrees(np.arccos(np.clip(-ax[2] @ R[2], -1, 1))))  # 0 = frontal, 90 = profile
    if yaw < (a.forehead_profile_yaw_min if forehead else a.profile_yaw_min): return None
    def pj(X):
        q = np.atleast_2d(X) @ R.T + t; return np.c_[f * q[:, 0] / q[:, 2] + cx, f * q[:, 1] / q[:, 2] + cy]
    fd = pj(L[1] + ax[2] * 0.3 * np.linalg.norm(L[33] - L[263]))[0] - pj(L[1])[0]
    if abs(fd[1]) > 0.5 * np.linalg.norm(fd): return None              # face-forward not along the image rows (rolled)
    fwdx = 1.0 if fd[0] > 0 else -1.0
    if forehead:
        y1 = pj(L[9])[0][1]; y0 = y1 - 1.2 * iod_px                     # image y grows downward
    else:
        y0, y1 = sorted([pj(L[9])[0][1], pj(L[0])[0][1]])
    rows = np.arange(int(np.floor(y0)), int(np.ceil(y1)) + 1)
    start = float(pj(L[[33, 263, 234, 454]]).mean(0)[0]); span = 1.5 * abs(y1 - y0) + 0.5 * iod_px
    import cv2
    cs, _ = cv2.findContours(mm.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    mf = np.zeros_like(mm, np.uint8); cv2.drawContours(mf, cs, -1, 1, -1)    # exterior-skin render has holes (eyes, mouth)
    P = outline(m > 0, start, fwdx, rows, span); Mo = outline(mf > 0, start, fwdx, rows, span)
    if forehead:
        # only the skin seen continuously from the glabella upward (stop at the first row without skin)
        gap_ = np.where(~np.isfinite(P[::-1]))[0]
        if len(gap_): P[:len(P) - gap_[0]] = np.nan
    ok = np.isfinite(P) & np.isfinite(Mo) & (np.abs(P - Mo) < a.profile_gap * iod_px)
    if ok.sum() < 8: return None
    rows, P, Mo = rows[ok], P[ok], Mo[ok]
    d, j = cKDTree(uv[cand]).query(np.c_[Mo, rows])
    near = d < 0.02 * iod_px
    if near.sum() < 8: return None
    vids = cand[j[near]]; P = P[near]
    e = fwdx * (uv[vids, 0] - P)                                       # + = model in front of the photo profile
    sig = a.sil_sigma * iod_px
    w = 1.0 / (1.0 + (e / (2 * sig)) ** 2)
    w = w * ((a.forehead_profile_pts if forehead else a.profile_frame_pts) / max(w.sum(), 1e-9)) / sig ** 2
    x, _, zz = Q[vids].T
    gx = np.zeros((len(vids), 3)); gx[:, 0] = fwdx * f / zz; gx[:, 2] = -fwdx * f * x / zz ** 2
    gg = gx @ (R @ M3)
    return np.einsum("pj,kpj->pk", gg, Ball[:, vids, :]), e, w


def G_index(v):
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--landmarks", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--eyelid-offset"); ap.add_argument("--sigma", type=float, default=0.02, help="landmark noise, x eye distance")
    ap.add_argument("--eyelid-cols", action="store_true", help="G15 OPTION (2026-10-24): per-column upper-lid offsets (offset_cols of the "
                    "eyelid_offset JSON) instead of one offset x taper per eye, like template_fit --eyelid-cols. The scalar lifted the "
                    "middle of monolid eyes 0.02-0.05 x eye width above the photo lash edge (woo02 R / seo01 R / zu01)")
    ap.add_argument("--w-eye", type=float, default=6.0); ap.add_argument("--iters", type=int, default=8)
    ap.add_argument("--corr-fix", default="", help="OPTION (2026-10-22, A2): same JSON as template_fit --corr-fix (assets/gnm_mp468_fix.json) "
                    "-> the statistical fit no longer pulls 3 socket-interior vertices onto the photo lid line")
    ap.add_argument("--max-comp", type=int, default=0, help="use only the first N head identity components (0 = all)")
    ap.add_argument("--sil", action="store_true", help="P1: also fit the face / jaw / cheek / ear SILHOUETTES of the frames")
    ap.add_argument("--work"); ap.add_argument("--sparse"); ap.add_argument("--poses"); ap.add_argument("--exclude")
    ap.add_argument("--sil-every", type=int, default=2); ap.add_argument("--sil-rounds", type=int, default=5)
    ap.add_argument("--sil-sigma", type=float, default=0.03, help="silhouette noise, x eye distance")
    ap.add_argument("--sil-frame-pts", type=float, default=40.0, help="weight of one frame's outline, in landmark-point units")
    ap.add_argument("--sil-oval-w", type=float, default=0.1, help="face-oval landmark weight during the silhouette fit")
    ap.add_argument("--crown-frame-pts", type=float, default=15.0, help="weight of one frame's CROWN outline (top of the "
                    "head vs the person outline minus --hair); 0 = off")
    ap.add_argument("--no-mean-ear", dest="mean_ear", action="store_false", help="keep the fitted ear SHAPE "
                    "(default: the GNM mean ear laid onto it, pipeline/ear_fit.py mean_ear_shape; S15P31B204-764)")
    ap.add_argument("--no-ears", dest="ears", action="store_false", help="keep the statistical ear position (default: placed from the side photos, pipeline/ear_fit.py; needs the multiclass segmentation, else skipped)")
    ap.add_argument("--ear-method", default="contour", choices=["contour", "area"], help="ear placement score (S15P31B204-331): "
                    "contour = the ear rim on the photo's class border (default), area = the 2026-10-19 skin / ring score")
    ap.add_argument("--lm-depth-w", type=float, default=0.2, help="depth weight of the nose / upper-lip landmarks in the "
                    "silhouette stage (1 = like the other directions)")
    ap.add_argument("--lm-depth-regions", default="nose_region,upper_lip_region", help="OPTION (2026-10-23): landmark regions whose DEPTH gets --lm-depth-w (default = unchanged). MediaPipe midline points lie in FRONT of the photo profile (glabella / nasion / nose 0.05-0.20 x eye width, 5/6 originals): e.g. nose_region,upper_lip_region,lower_lip_region,middle_brow_region")
    ap.add_argument("--lm-depth-init", action="store_true", help="OPTION (2026-10-23): apply --lm-depth-w / --lm-depth-regions also in the first landmark-only iterations (before: full MediaPipe depth there, the silhouette stage then starts from it)")
    ap.add_argument("--concave-r", type=float, default=0.06, help="window (x eye distance) for the concave-outline test: "
                    "concave parts of the model outline only get the one-sided (not outside) silhouette term; 0 = off")
    ap.add_argument("--edge-frame-pts", type=float, default=15.0, help="weight of one frame's INNER contours (jaw line over "
                    "the neck, ear rim) matched to photo intensity edges; 0 = off")
    ap.add_argument("--mid-search", type=float, default=0.07, help="inward search range for the midline profile edge")
    ap.add_argument("--edge-search", type=float, default=0.04, help="search range for the inner-contour edge, x eye distance")
    ap.add_argument("--edge-min", type=float, default=3.0, help="edge must be this many times the median image gradient")
    ap.add_argument("--hair-min", type=float, default=0.03, help="thinnest hair layer on top (upper bound of the skull)")
    ap.add_argument("--face-region", action="store_true", help="OPTION (off by default, S15P31B204-778): the visible edge of "
                    "the model's face regions matched to the segmentation's face | neck skin border (the jaw line of that view), "
                    "both ways, weighted per frame like the outline (--sil-frame-pts)")
    ap.add_argument("--forehead-skin-pts", type=float, default=0.0, help="OPTION (2026-10-24) (10/24 기본값이었다가 같은 날 되돌림, 만두 확인: 정수리가 너무 낮아져 두상 전체 비율이 망가짐): weight per frame (landmark-point "
                    "units) of photo SKIN above the brows that lies OUTSIDE the model (pushed out to it, one-sided). 0 = off")
    ap.add_argument("--forehead-skin-above", type=float, default=0.1, help="--forehead-skin-pts: skin this far above the glabella "
                    "(landmark 9, x eye distance, along the head's up axis)")
    ap.add_argument("--forehead-skin-tol", type=float, default=0.01, help="--forehead-skin-pts: skin counts as outside only beyond this (x eye distance)")
    ap.add_argument("--forehead-skin-max", type=float, default=0.12, help="--forehead-skin-pts: farther outside than this (x eye "
                    "distance) = not used (segmentation error)")
    ap.add_argument("--forehead-skin-share", type=float, default=0.25, help="--forehead-skin-pts: frames where more than this share "
                    "of the forehead skin outline is outside the model are skipped (segmentation error)")
    ap.add_argument("--forehead-profile-pts", type=float, default=0.0, help="OPTION (2026-10-24) (10/24 기본값이었다가 같은 날 되돌림, 만두 확인: 정수리가 너무 낮아져 두상 전체 비율이 망가짐): in side frames fit the model's "
                    "front outline to the photo skin from the glabella up to the last skin row (behind a fringe too), TWO-sided, "
                    "weight per frame in landmark-point units; 0 = off")
    ap.add_argument("--forehead-profile-yaw-min", type=float, default=65.0, help="--forehead-profile-pts: frames with the face at "
                    "least this far from frontal (deg)")
    ap.add_argument("--crown-cap", default="", help="OPTION (2026-10-24): e.g. p95,p99.5 - the crown term's upward pull fades from "
                    "the lower to the upper percentile of the real-head crown height range (head_ratio_range.json); '' = off")
    ap.add_argument("--hair-shell", default="", help="OPTION (2026-10-24, hs3 = top,back with --hair-shell-taper 0.3) (10/24 기본값이었다가 같은 날 되돌림, 만두 확인: 정수리가 너무 낮아져 두상 전체 비율이 망가짐): replace the crown term by the hair-covered skull "
                    "seen through the hair in these regions (top,back[,side]); the hair layer of each region is solved per person "
                    "(prior --hair, sd --hair-sd) instead of the fixed --hair. Off by default")
    ap.add_argument("--hair-sd", type=float, default=0.15, help="--hair-shell: prior sd of the hair layer, x eye distance")
    ap.add_argument("--hair-shell-search", type=float, default=0.6, help="--hair-shell: person outline search radius, x eye distance")
    ap.add_argument("--hair-shell-taper", type=float, default=0.0, help="--hair-shell: person outline within this (x eye "
                    "distance) of the photo skin outline (near the hairline, where the layer thins to 0) = upper bound only; 0 = off")
    ap.add_argument("--hair-shell-gate", type=float, default=0.15, help="--hair-shell: person outline more than layer + this "
                    "outside the model = hanging / voluminous hair: upper bound only")
    ap.add_argument("--hair", type=float, default=0.12, help="hair layer on top of the head, x eye distance (0.12: woo01 skull line drawn by the user, 2026-10-16; 0.06 made a too big \"Megamind\" crown)")
    ap.add_argument("--hairline-json", default="", help="OPTION (S15P31B204-554, off = empty): hairline.py output of a first fit "
                    "of this capture - template-scalp vertices that are photo skin are fitted as skin (outline, no crown term)")
    ap.add_argument("--hair-ramp", type=float, default=0.0, help="--hairline-json: hair layer thinning to 0 toward the hairline "
                    "over this distance (x eye distance); 0 = the full --hair layer on all hair (default). > 0 pulls the "
                    "forehead top up to the hair silhouette (chae02 +4.3 %% with 0.4, 11/4)")
    ap.add_argument("--sil-surface-w", type=float, default=0.3, help="surface (cheek / jaw / temple) landmark weight during it")
    # W7a options (2026-10-19, head shape / temples / hair / accessories). Off by default until the baseline qa.
    ap.add_argument("--hair-edge-class", action="store_true", help="W7a: a skin edge with hair (multiclass segmentation) "
                    "right beyond it is one-sided (hairline), even when the hair layer is thin")
    ap.add_argument("--hair-edge-r", type=float, default=0.03, help="W7a: hair search radius beyond the skin edge, x eye distance")
    ap.add_argument("--side-hair", action="store_true", help="W7a: crown term also on the sides of the head (temples) "
                    "with a thinner hair layer --hair-side")
    ap.add_argument("--hair-side", type=float, default=0.05, help="W7a: hair layer at the temples / sides, x eye distance")
    ap.add_argument("--side-max", type=float, default=0.10, help="W7a: side points only where the person outline is "
                    "within this (x eye distance) of the model = thin hair")
    ap.add_argument("--side-w", type=float, default=0.5, help="W7a: weight of a side point relative to a top point")
    ap.add_argument("--hair-max", type=float, default=0.0, help="W7a: person outline more than this outside the model "
                    "(x eye distance) = voluminous hair: only the upper bound there (0 = off; try 0.25)")
    ap.add_argument("--accessory-class", action="store_true", help="W7a: person-outline points on glasses / hats "
                    "(segmentation class 5) are not used for the crown")
    ap.add_argument("--temple-lm-w", type=float, default=1.0, help="W7a: extra factor on the temple landmarks in the "
                    "silhouette stage (they sit on the hairline); try 0")
    ap.add_argument("--profile-fit", action="store_true", help="OPTION (2026-10-23): in near-90-degree frames fit the model's "
                    "profile (glabella .. upper lip) to the photo skin profile, two-sided per image row (the general silhouette "
                    "term is one-sided at the nasion / under the nose). gyu01: the statistical fit's nasion was 0.16 x eye width "
                    "too deep and the under-tip 0.12 short against the hand-traced profile")
    ap.add_argument("--profile-yaw-min", type=float, default=70.0, help="--profile-fit: frames with the face at least this far "
                    "from frontal (deg)")
    ap.add_argument("--profile-frame-pts", type=float, default=40.0, help="--profile-fit: weight of one frame's profile, in "
                    "landmark-point units (like --sil-frame-pts)")
    ap.add_argument("--profile-gap", type=float, default=0.25, help="--profile-fit: skip rows where photo and model profile "
                    "differ by more than this x eye distance (hand / other person / hair in the mask)")
    ap.add_argument("--sparse-depth-pts", type=float, default=0.0, help="OPTION (2026-10-24, B1 S2 root cause): weight (landmark-point "
                    "units, like --sil-frame-pts) of a DEPTH term from the SfM sparse points (COLMAP, track >= 3) on the face skin: "
                    "each point pulls its nearest face-skin vertex along the normal. MediaPipe's triangulated depth is 3-7 %% IOD off "
                    "(brow mound / under-eye / cheekbone behind, glabella / nose tip in front) while the SfM points agree with a dense "
                    "multi-view surface within +-1.5 (chae01 / gyu01). Use with --lm-depth-w 0 --lm-depth-regions <all> --lm-depth-init. 0 = off")
    ap.add_argument("--sparse-depth-shift", action="store_true", help="--sparse-depth-pts: also correct the head POSE (rotation + "
                    "translation, point-to-plane on the face points, robust). The similarity is re-fitted to MediaPipe's 3D points, depth "
                    "included, every round, which keeps the head at MediaPipe's mean depth and tilt (chae01 / gyu01: top behind, chin in "
                    "front after a translation-only correction)")
    ap.add_argument("--neck-pitch", action="store_true", help="OPTION (off by default): --sil also solves the head-neck angle - "
                    "the neck skin turns about the head joint (head's left-right axis), one unknown per person fitted with the "
                    "identity from the outlines (S15P31B204-775)")
    ap.add_argument("--neck-pitch-sd", type=float, default=15.0, help="--neck-pitch: prior sd of the angle, degrees")
    ap.add_argument("--sparse-depth-brow-gap", type=float, default=0.0, help="--sparse-depth-pts: drop points closer than this (x eye "
                    "distance) to the brow regions - brow HAIR stands in front of the skin and pulled the brow mound forward (Mandu 10/24)")
    ap.add_argument("--sparse-depth-sigma", type=float, default=0.03, help="--sparse-depth-pts: point noise, x eye distance (Cauchy)")
    ap.add_argument("--sparse-depth-band", type=float, default=0.08, help="--sparse-depth-pts: points farther than this from the "
                    "model (x eye distance) are not used")
    a = ap.parse_args()
    if a.neck_pitch and a.hair_shell: ap.error("--neck-pitch does not combine with --hair-shell")
    LAPS.lap("load")
    V0, F, mat, comp, raw = load_template()
    corr = correspondence(V0, F, mat)
    if a.corr_fix:
        cf = json.load(open(a.corr_fix))["vertex"]; corr = np.array(corr).copy()
        for k_, v_ in cf.items(): corr[int(k_)] = int(v_)
    L = np.asarray(meshio.read_any(a.landmarks)["vertices"][:468], np.float64)
    if a.eyelid_offset:
        from eyelid_offset import EYE as _EYE
        eo = json.load(open(a.eyelid_offset)); L = L.copy()
        for Sd, e in _EYE.items():
            ew = np.linalg.norm(L[e["c"][0]] - L[e["c"][1]]); off = eo["offset"].get(Sd, 0.0)
            oc = (eo.get("offset_cols") or {}).get(Sd) if a.eyelid_cols else None
            for j, (u, l) in enumerate(zip(e["up"], e["lo"])):
                oj = off * eo["taper"][j]
                if oc is not None and j < len(oc) and oc[j] is not None: oj = float(oc[j])
                dd = L[u] - L[l]; dd /= np.linalg.norm(dd) + 1e-12; L[u] = L[u] + dd * oj * ew
    G = GNM(); o2g, _, _, _ = template_map()
    gk = o2g[corr]                                                   # GNM vertex of each MediaPipe landmark
    idx = np.array([i for i, n in enumerate(G.id_names) if "teeth" not in n.lower()], np.int64)
    head = np.array([i for i in idx if not G.id_names[i].lower().startswith(("eye", "eyeball"))], np.int64)
    if a.max_comp: head = head[:a.max_comp]
    use = head                                                        # head components only (eyes / teeth follow the skin)
    B = G.B_id[use][:, gk, :]                                        # (K, 468, 3)
    Tk = G.T[gk]
    rel = np.ones(468)
    mvinfo = os.path.splitext(a.landmarks)[0] + ".mvinfo.json"
    if os.path.exists(mvinfo):
        e = np.array([x.get("reproj_px_median", 20.0) for x in json.load(open(mvinfo))["landmarks"]])
        rel = 1.0 / (1.0 + (e / 3.0) ** 2)
    wbase = rel.copy(); wbase[EYE_LM] *= a.w_eye
    iod = np.linalg.norm(L[33] - L[263])
    b = np.zeros(len(use)); w = wbase.copy(); rep = {"components": int(len(use)), "head_components": int(len(head))}
    LAPS.lap("landmark_fit")
    for it in range(a.iters):
        Y = Tk + np.tensordot(b, B, 1)
        S, Rw, tw = umeyama(Y, L, w)
        # identity step in model space
        tgt = ((L - tw) @ Rw) / S - Tk                                # (468, 3)
        sig = a.sigma * iod / S
        A = B.reshape(len(use), -1).T                                 # (468*3, K)
        if a.lm_depth_init:
            # 2026-10-23 option: the depth of the chosen midline landmarks is weak already here (head axes, model space)
            Bm = head_axes(L) @ Rw; Wf = np.ones((468, 3)); Wf[depth_landmarks(a), 2] = a.lm_depth_w
            Wi = np.einsum("ka,ik,kb->iab", Bm, Wf, Bm) * w[:, None, None]
            A3 = A.reshape(468, 3, -1); WA = np.einsum("iab,ibk->iak", Wi, A3)
            H = np.einsum("iak,ial->kl", A3, WA) / sig ** 2 + np.eye(len(use))
            b = np.linalg.solve(H, np.einsum("iak,ia->k", WA, tgt) / sig ** 2)
        else:
            ww = np.repeat(w, 3)
            H = (A * ww[:, None]).T @ A / sig ** 2 + np.eye(len(use))
            b = np.linalg.solve(H, (A * ww[:, None]).T @ tgt.reshape(-1) / sig ** 2)
        Y = Tk + np.tensordot(b, B, 1)
        S, Rw, tw = umeyama(Y, L, w)
        r = np.linalg.norm((S * (Rw @ Y.T)).T + tw - L, axis=1)
        w = wbase / (1 + (r / (2 * np.median(r) + 1e-12)) ** 2)
        rep[f"iter{it}"] = {"median_resid_pct_iod": round(float(np.median(r) / iod * 100), 3), "b_norm": round(float(np.linalg.norm(b)), 2)}
    neck_rt = None
    if a.sil:
        a._corr = [int(x) for x in corr]                              # --crown-cap measures the current crown
        b, S, Rw, tw, neck_rt = silhouette_stage(a, G, use, b, S, Rw, tw, L, Tk, B, w, iod, rep)
    LAPS.lap("finish")                                               # eyes / teeth follow the skin
    full = np.zeros(G.B_id.shape[0]); full[use] = b
    Vg = G.bind(full)
    # eyeballs, teeth, tongue: the head identity components move the skin but not these parts (they have their own
    # components, not observable from landmarks) -> each part follows the mean displacement of the skin around it
    # (without this the template teeth / eyeballs poked out of a narrower or shorter fitted face)
    from scipy.spatial import cKDTree
    sk = np.where(comp == 0)[0]; tree = cKDTree(G.T[sk])
    for cid in np.unique(comp):
        if cid == 0: continue
        ids = np.where(comp == cid)[0]
        ball = ids[mat[ids] == 4]
        if len(ball) > 20:
            # eyeball: the similarity that carries its eyelid / socket RING (skin on the template eyeball surface) from
            # the template to the fitted head (a mean displacement put it in front of the lids -> bulging closed eyes)
            P = G.T[ball]; so = np.linalg.lstsq(np.c_[2 * P, np.ones(len(P))], (P ** 2).sum(1), rcond=None)[0]
            ce = so[:3]; re_ = np.sqrt(max(so[3] + ce @ ce, 1e-12))
            dd = np.linalg.norm(G.T[sk] - ce, axis=1)
            ring = sk[(dd > 0.85 * re_) & (dd < 1.35 * re_)]
            if len(ring) >= 20:
                s_, R_, t_ = umeyama(G.T[ring], Vg[ring])
                Vg[ids] = (s_ * (R_ @ G.T[ids].T)).T + t_
                continue
        _, nn = tree.query(G.T[ids].mean(0), k=60)
        Vg[ids] = G.T[ids] + (Vg[sk[nn]] - G.T[sk[nn]]).mean(0)
    neck = None if neck_rt is None else (G.W[G.joint_names.index("neck")][o2g], *neck_rt)
    Vw = to_world(Vg[o2g], S, Rw, tw, neck)                          # our topology, COLMAP frame
    obs_ = rep.pop("_obs", None)
    LAPS.lap("ears")
    if a.mean_ear:
        from ear_fit import mean_ear_shape
        Vw = mean_ear_shape(Vw, F, G.T[o2g].astype(np.float64), G.groups[G.group_names.index("ears")][o2g],
                            np.where(G.group("left")[o2g], 1, np.where(G.group("right")[o2g], -1, 0)), rep, iod)
    if a.ears and obs_:
        # ears placed from the side photos (pipeline/ear_fit.py): no landmark carries them
        from ear_fit import adjust_ears
        ear_w = G.groups[G.group_names.index("ears")][o2g]
        side = np.where(G.group("left")[o2g], 1, np.where(G.group("right")[o2g], -1, 0))
        Vw = adjust_ears(Vw, F, ear_w, side, obs_, L, rep, method=a.ear_method)
    LAPS.lap("write")
    meshio.write_ply(a.out, Vw, F)
    r = np.linalg.norm(Vw[corr] - L, axis=1) / iod * 100
    rep.update({"landmark_vertex_ids": [int(x) for x in corr], "similarity_scale": float(S), "eyelid_cols": bool(a.eyelid_cols and a.eyelid_offset),
                "landmark_residual_median_pct_iod": round(float(np.median(r)), 3), "landmark_residual_p95_pct_iod": round(float(np.percentile(r, 95)), 3),
                "identity": [round(float(x), 4) for x in full], "top_components": sorted(
                    [(G.id_names[i], round(float(full[i]), 2)) for i in use], key=lambda x: -abs(x[1]))[:12]})
    LAPS.lap()
    rep["timing_sec"] = {k: round(v, 2) for k, v in LAPS.sec.items()}
    json.dump(rep, open(os.path.splitext(a.out)[0] + ".fit.json", "w"), indent=1)
    print(json.dumps({k: rep[k] for k in ("components", "landmark_residual_median_pct_iod", "landmark_residual_p95_pct_iod", "top_components", "timing_sec")}))


if __name__ == "__main__":
    main()
