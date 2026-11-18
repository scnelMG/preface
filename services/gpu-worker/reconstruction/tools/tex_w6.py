"""W6 texture post-processing (2026-10-20) - writes VARIANT maps into work/<id>/model/w6/, the bake itself is untouched.

  1. exposure   the lighting-free skin map (tex_skin_albedo.png) is as dark as the capture: face-skin median L* 41-57
                on six runs while the frontal lit cheek sample of the same capture (eye_color.json skin_rgb) is L* 57-73
                (side views, under-chin and neck are averaged in). The albedo is scaled (linear light, luminance only) so
                its face-skin median reaches the cheek sample minus a margin -> natural-light viewer mode not too dark.
  2. nostrils   dark photo colour painted OUTSIDE the model's nostrils (10/19 만두: "콧구멍 색이 모델 밖에"): in the nose
                region, texels much darker than the local skin tone whose model surface is NOT a cavity (ambient
                occlusion of the fitted mesh above --ao-open 0.45) are replaced by the local skin tone (soft mask). The modelled
                nostril openings (AO below 0.45) keep their colour.
  3. bald scalp the MVP head is bald + hair presets (W10): scalp texels get the forehead / temple skin tone instead of
                the photo's hair, blended over the hairline by a mesh-smoothed weight (no seam at UV island borders).
                Written as extra maps tex_skin_bald.png / tex_skin_albedo_bald.png.
                v2 (10/20, 만두 확인 "민머리가 머리카락 색을 다 못 지움"): (a) the scalp vertex set is a fixed template region,
                hair painted OUTSIDE it (temples, sideburns, above / around the ears, nape, fringe on the forehead) stayed ->
                in the hair zone (everything except the eyes / brows / nose / lips / cheeks / chin) texels clearly darker
                than the local skin tone (--hair-dark x) on a non-cavity surface (AO above --hair-ao) are replaced by the
                local tone. Dark-hair assumption: light hair close to the skin tone is not found (limitation, logged).
                (b) the scalp weight was blurred with zeros outside the UV islands -> the island border (crown seam) kept
                the hair colour = dark line; now a normalised blur (no fall-off at the border, gutter filled).
usage: python tools/tex_w6.py work/<id> [--expose-margin 4] [--no-render]
then:  python tools/export_glb.py work/<id> --tex-dir w6 --out work/<id>/model/w6/head_w6.glb
"""
import argparse, json, os, shutil, subprocess, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "pipeline"))


def srgb2lin(x): return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
def lin2srgb(x): return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(np.clip(x, 0, None), 1 / 2.4) - 0.055)


def main():
    import cv2, meshio
    from uv_bake import raster_layout, TEMPLATE
    from gnm_features import skin_only_vertices, scalp_vertices
    from gnm_model import GNM, template_map
    from mesh_ao import vertex_ao
    from scipy.sparse import coo_matrix
    ap = argparse.ArgumentParser(); ap.add_argument("work")
    ap.add_argument("--expose-margin", type=float, default=4.0, help="target = cheek sample L* minus this")
    # 10/20 measured on eun02-r2 / woo01-r2: the dark photo nostril colour sits mostly at ambient occlusion 0.35-0.55
    # (nostril rim, under the wings); the modelled opening (< 0.35) is only ~450-510 texels: the photo nostril is bigger
    # than the model's -> the real fix is the nostril SHAPE (W7-nose). Here only clearly dark texels outside the core.
    ap.add_argument("--ao-open", type=float, default=0.45, help="nostril guard acts where the fitted surface's AO is above this")
    ap.add_argument("--dark-ratio", type=float, default=0.68, help="texels darker than this x local skin tone are replaced")
    ap.add_argument("--max-gain", type=float, default=1.8); ap.add_argument("--no-render", action="store_true")
    ap.add_argument("--out", default="w6", help="folder under model/ (10/20 bald v2 written to w6b, v1 in w6 kept)")
    ap.add_argument("--hair-dark", type=float, default=0.72, help="bald v2: hair zone texels darker than this x local skin tone -> skin")
    ap.add_argument("--hair-ao", type=float, default=0.55, help="bald v2: only where the fitted surface is open (AO above), not ear / jaw cavities")
    a = ap.parse_args()
    W = a.work; M = os.path.join(W, "model"); O = os.path.join(M, a.out); os.makedirs(O, exist_ok=True)
    rep = json.load(open(os.path.join(M, "report.json"), encoding="utf-8")); ch = rep.get("chosen", "gnm")
    d = np.load(TEMPLATE); UV = d["vertex_uvs"].astype(np.float64); UT = d["uv_triangles"].astype(np.int64)
    F = d["triangles"].astype(np.int64); mat = d["materials"]
    V = np.asarray(meshio.read_any(os.path.join(M, f"fit_{ch}.ply"))["vertices"], np.float64)
    photo = cv2.imread(os.path.join(M, "tex_skin.png")); alb = cv2.imread(os.path.join(M, "tex_skin_albedo.png"))
    S = photo.shape[0]
    tris = np.where((mat[F] == 0).all(1))[0]
    py, px, tt, w = raster_layout(S, tris, UV, UT)
    vtx = lambda f: (w * f[F[tt]]).sum(1)                       # vertex field -> texel values (layout order)
    # vertex fields
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]); vn = np.zeros_like(V)
    for k in range(3): np.add.at(vn, F[:, k], fn)
    vn /= np.linalg.norm(vn, axis=1, keepdims=True) + 1e-12
    if ((V[mat == 0] - V[mat == 0].mean(0)) * vn[mat == 0]).sum(1).mean() < 0: vn = -vn
    ao = vertex_ao(V, F, vn)
    G = GNM(); o2g = template_map()[0]
    grp = lambda n: (G.groups[G.group_names.index(n)] > 0.3)[o2g].astype(np.float64)
    face_v = skin_only_vertices().astype(np.float64); scalp = scalp_vertices()
    nose_v = grp("nose_region"); fore_v = np.maximum(grp("forehead_region"), np.maximum(grp("left_temple_region"), grp("right_temple_region")))
    ii = np.concatenate([F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]]); jj = np.concatenate([F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]])
    Adj = coo_matrix((np.ones(len(ii)), (ii, jj)), shape=(len(V), len(V))).tocsr(); deg = np.maximum(np.asarray(Adj.sum(1)).ravel(), 1)
    nonscalp = (~scalp).astype(np.float64)
    for _ in range(25): nonscalp = 0.5 * nonscalp + 0.5 * (Adj @ nonscalp) / deg
    t_face, t_nose, t_ao, t_fore, t_ns = vtx(face_v) > 0.99, vtx(nose_v) > 0.5, vtx(ao), vtx(fore_v) > 0.5, vtx(nonscalp)
    # bald v2 hair zone: skin that can carry painted hair = not the facial features (soft, mesh-smoothed)
    feat = np.max([grp(n) for n in ("left_brow_region", "right_brow_region", "middle_brow_region", "left_orbital_region", "right_orbital_region",
                                    "nose_region", "upper_lip_region", "lower_lip_region", "upper_lip", "lower_lip", "left_infraorbital_region",
                                    "right_infraorbital_region", "left_cheek_region", "right_cheek_region", "left_zygomatic_region",
                                    "right_zygomatic_region", "chin_region")], axis=0)
    for _ in range(4): feat = 0.5 * feat + 0.5 * (Adj @ feat) / deg
    t_zone = vtx(1 - np.clip(feat * 2, 0, 1))
    valid = np.zeros((S, S), np.float32); valid[py, px] = 1
    report = {"source": os.path.basename(os.path.normpath(W)), "chosen": ch}

    def lab(img): return cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    # ---- 2. nostril guard (both maps)
    def nostril_guard(img):
        Lb = lab(img); L = Lb[..., 0] / 2.55
        img_n = img.copy()
        nose_img = np.zeros((S, S), np.float32); nose_img[py[t_nose], px[t_nose]] = 1
        Lt = L[py, px]
        ok = t_nose & (t_ao > a.ao_open)
        tone_src = np.zeros((S, S), np.float32); tone_w = np.zeros((S, S), np.float32)
        sel = ok & (Lt > np.percentile(Lt[t_nose], 40))
        tone_src[py[sel], px[sel]] = 1
        sg = 0.01 * S
        cimg = img.astype(np.float32)
        num = cv2.GaussianBlur(cimg * tone_src[..., None], (0, 0), sg); den = cv2.GaussianBlur(tone_src, (0, 0), sg)
        tone = num / np.maximum(den, 1e-4)[..., None]
        Ltone = cv2.cvtColor(np.clip(tone, 0, 255).astype(np.uint8), cv2.COLOR_BGR2LAB)[..., 0].astype(np.float32) / 2.55
        dark = ok & (Lt < a.dark_ratio * Ltone[py, px]) & (den[py, px] > 0.05)
        m = np.zeros((S, S), np.float32); m[py[dark], px[dark]] = 1
        m = cv2.GaussianBlur(cv2.dilate(m, np.ones((3, 3), np.uint8)), (0, 0), 0.0015 * S) * nose_img
        out = (cimg * (1 - m[..., None]) + tone * m[..., None]).astype(np.uint8)
        return out, int(dark.sum()), int(t_nose.sum())
    photo_n, nd, nt = nostril_guard(photo); alb_n, _, _ = nostril_guard(alb)
    report["nostril_guard"] = {"replaced_texels": nd, "nose_texels": nt, "share_pct": round(100 * nd / max(nt, 1), 2)}
    # ---- 1. exposure (albedo only)
    e = json.load(open(os.path.join(M, "eye_color.json"))) if os.path.exists(os.path.join(M, "eye_color.json")) else None
    gain = 1.0
    if e and e.get("skin_rgb"):
        s = np.array(e["skin_rgb"])[None, None, ::-1] * 255
        L_cheek = cv2.cvtColor(s.astype(np.uint8), cv2.COLOR_BGR2LAB)[0, 0, 0] / 2.55
        Lf = np.median(lab(alb_n)[..., 0][py[t_face], px[t_face]]) / 2.55
        target = L_cheek - a.expose_margin
        # L* -> relative luminance: Y = ((L* + 16) / 116)^3
        Y = lambda Ls: ((Ls + 16) / 116) ** 3
        gain = float(np.clip(Y(target) / Y(Lf), 1.0, a.max_gain))
        report["exposure"] = {"face_L_before": round(float(Lf), 1), "cheek_sample_L": round(float(L_cheek), 1), "target_L": round(float(target), 1), "gain_linear": round(gain, 3)}
    x = srgb2lin(alb_n.astype(np.float32) / 255) * gain
    alb_e = (np.clip(lin2srgb(np.clip(x, 0, 1)), 0, 1) * 255).astype(np.uint8)
    report.setdefault("exposure", {})["face_L_after"] = round(float(np.median(lab(alb_e)[..., 0][py[t_face], px[t_face]]) / 2.55), 1)
    # ---- 3. bald scalp (extra maps)
    def nblur(x, sg):
        """blur of a texel field over the UV islands only (normalised: no fall-off at island borders, gutter filled)"""
        den = np.maximum(cv2.GaussianBlur(valid, (0, 0), sg), 1e-4)
        if x.ndim == 2: return cv2.GaussianBlur(x * valid, (0, 0), sg) / den
        return cv2.GaussianBlur(x * valid[..., None], (0, 0), sg) / den[..., None]
    def bald(img):
        Lb = lab(img); Lt = Lb[..., 0][py, px]
        fs = t_fore & (t_ns > 0.95) & (Lt > np.percentile(Lt[t_fore], 30))
        tone = np.median(img[py[fs], px[fs]].astype(np.float32), 0) if fs.sum() > 100 else np.median(img[py[t_face], px[t_face]].astype(np.float32), 0)
        al = np.zeros((S, S), np.float32); al[py, px] = np.clip((0.85 - t_ns) / 0.55, 0, 1)
        al = np.clip(nblur(al, 0.003 * S), 0, 1)
        out = img.astype(np.float32) * (1 - al[..., None]) + tone[None, None] * al[..., None]
        # (a) painted hair outside the scalp set: dark texels vs the LOCAL skin tone (bright half of the zone, wide blur)
        Lo = cv2.cvtColor(np.clip(out, 0, 255).astype(np.uint8), cv2.COLOR_BGR2LAB)[..., 0].astype(np.float32)
        Lz = Lo[py, px]; zone = t_zone > 0.5
        src = np.zeros((S, S), np.float32); bright = zone & (Lz >= np.percentile(Lz[zone], 50))
        src[py[bright], px[bright]] = 1
        sg = 0.02 * S
        ltone = cv2.GaussianBlur(out * src[..., None], (0, 0), sg) / np.maximum(cv2.GaussianBlur(src, (0, 0), sg), 1e-4)[..., None]
        Llt = cv2.cvtColor(np.clip(ltone, 0, 255).astype(np.uint8), cv2.COLOR_BGR2LAB)[..., 0].astype(np.float32)[py, px]
        hair = zone & (t_ao > a.hair_ao) & (Lz < a.hair_dark * Llt)
        m = np.zeros((S, S), np.float32); m[py[hair], px[hair]] = 1
        m = np.clip(nblur(cv2.dilate(m, np.ones((5, 5), np.uint8)), 0.002 * S), 0, 1)
        zw = np.zeros((S, S), np.float32); zw[py, px] = np.clip(t_zone, 0, 1); m = m * np.clip(nblur(zw, 0.002 * S), 0, 1)
        out = out * (1 - m[..., None]) + ltone * m[..., None]
        return np.clip(out, 0, 255).astype(np.uint8), tone, int(hair.sum())
    photo_b, tone_p, hp_ = bald(photo_n); alb_b, tone_a, ha_ = bald(alb_e)
    report["bald_scalp"] = {"version": 2, "scalp_texels": int((t_ns < 0.85).sum()), "hair_zone_texels": int((t_zone > 0.5).sum()),
                            "hair_outside_scalp_replaced": {"photo": hp_, "albedo": ha_},
                            "tone_bgr_photo": [round(float(v)) for v in tone_p], "tone_bgr_albedo": [round(float(v)) for v in tone_a]}
    # write
    cv2.imwrite(os.path.join(O, "tex_skin.png"), photo_n); cv2.imwrite(os.path.join(O, "tex_skin_albedo.png"), alb_e)
    cv2.imwrite(os.path.join(O, "tex_skin_bald.png"), photo_b); cv2.imwrite(os.path.join(O, "tex_skin_albedo_bald.png"), alb_b)
    for n in ("eye", "iris", "skin_normal", "skin_orm"):
        if os.path.exists(os.path.join(M, f"tex_{n}.png")): shutil.copy2(os.path.join(M, f"tex_{n}.png"), os.path.join(O, f"tex_{n}.png"))
    if not a.no_render:
        # before / after renders for checking (gray-free, lit by the bake): albedo maps rendered as the skin texture
        sp = os.path.join(W, "colmap", "sparse_lens_anchored"); pj = os.path.join(W, "prep", "prepare.json")
        for tag, pre in (("before", os.path.join(M, "tex")), ("after", os.path.join(O, "tex"))):
            tmp = os.path.join(O, f"_r_{tag}"); os.makedirs(tmp, exist_ok=True)
            for n in ("eye", "iris"): shutil.copy2(f"{os.path.join(M, 'tex')}_{n}.png", os.path.join(tmp, f"tex_{n}.png"))
            shutil.copy2(f"{pre}_skin_albedo.png", os.path.join(tmp, "tex_skin.png"))
            subprocess.run([sys.executable, os.path.join(HERE, "render_textured.py"), os.path.join(tmp, "tex"), os.path.join(M, f"fit_{ch}.ply"), sp, pj,
                            os.path.join(O, f"render_albedo_{tag}.png"), "--size", "420", "--angles", "0,35,80"], capture_output=True)
            shutil.rmtree(tmp, ignore_errors=True)
        tmp = os.path.join(O, "_r_bald"); os.makedirs(tmp, exist_ok=True)
        for n in ("eye", "iris"): shutil.copy2(os.path.join(M, f"tex_{n}.png"), os.path.join(tmp, f"tex_{n}.png"))
        shutil.copy2(os.path.join(O, "tex_skin_bald.png"), os.path.join(tmp, "tex_skin.png"))
        subprocess.run([sys.executable, os.path.join(HERE, "render_textured.py"), os.path.join(tmp, "tex"), os.path.join(M, f"fit_{ch}.ply"), sp, pj,
                        os.path.join(O, "render_bald.png"), "--size", "420", "--angles", "0,80,180"], capture_output=True)
        shutil.rmtree(tmp, ignore_errors=True)
        report["renders"] = sorted(f for f in os.listdir(O) if f.startswith("render_"))
    json.dump(report, open(os.path.join(O, "w6.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
