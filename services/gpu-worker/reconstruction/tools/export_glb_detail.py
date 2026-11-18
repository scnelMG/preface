"""W8b viewer-first (2026-10-21, 만두 "뷰어 선행 연결"): the DETAIL layer as a head.glb for the glb viewer, WITHOUT the pipeline
connection (S2): no re-bake, no rig. It shows today's logic at the detail resolution:

  base shape   a fitted BASE mesh of the run (model/fit_<name>.ply; default = the chosen fit of report.json) lifted to the
               detail topology (assets/gnm-detail-v1.npz, DetailMesh.upsample = exactly the base surface, midpoints only)
  eyeballs     optionally taken from another fit of the same run (--eyes-from gnm: the eye_fit result, when the base variant
               was fitted without eye_fit, e.g. the template_fit option ablations fit_gnm_<variant>.ply)
  eye parts    the crease / fold displacement (EyeBasis) solved ON the detail mesh with the detail options (ring_hold,
               targets on base vertices only) from the parameters of a model/eye_parts*.json of the run (--eye-params);
               omit it for the plain lifted surface
  textures     the run's existing bakes (same UV atlas; the detail asset carries the subdivided UV triangles)
  metadata     as tools/export_glb.py (regions, landmarks, scalp = BASE vertex ids; _TEMPLATE_INDEX = the base vertex each
               detail vertex descends from (largest parent weight, resolved through the levels), so region display and
               template-indexed edits keep working at the parent's resolution) + "detail": asset, counts, options

output  work/<out-id>/model/head.glb (+ head.glb.json, fit_<name>_detail.ply, export_detail.json); default out id = <id>-detail.
        Never writes into the source run. Open: npm.cmd run glb -- <out-id>
usage   python tools/export_glb_detail.py work/<id> [--fit gnm_depthw] [--eyes-from gnm] [--eye-params model/eye_parts_depthw.json]
                                           [--out-id <id>-detail] [--ring-hold 0.015] [--normal-smooth 0] [--smooth 0] [--tex-dir ""]
"""
import argparse, hashlib, json, os, shutil, sys, time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "pipeline")); sys.path.insert(0, HERE)
from export_glb import GLB, head_frame, IOD_NORM_M, MOUTH, FORMAT, from_parts


def main():
    import meshio
    from detail_mesh import DetailMesh
    ap = argparse.ArgumentParser()
    ap.add_argument("work"); ap.add_argument("--fit", default="", help="fit name (model/fit_<name>.ply); default = report.json chosen")
    ap.add_argument("--eyes-from", default="", help="fit name whose NON-skin vertices (eyeballs, irises, mouth) replace the base's (e.g. gnm = eye_fit result)")
    ap.add_argument("--eye-params", default="", help="model/eye_parts*.json (its 'params' are applied with EyeBasis on the detail mesh); omit = no eye displacement")
    ap.add_argument("--out-id", default="", help="work/<out-id>/model/head.glb (default <id>-detail); never the source run")
    ap.add_argument("--ring-hold", type=float, default=0.015); ap.add_argument("--normal-smooth", type=int, default=0)
    ap.add_argument("--smooth", type=int, default=0, help="displacement smoothing passes (eye_parts_fit --smooth)")
    ap.add_argument("--all-targets", action="store_true", help="targets on every detail vertex (default: base vertices only, fine ones interpolated)")
    ap.add_argument("--no-hold-below-lash", action="store_true", help="do not hold the skin below the lash line (EyeBasis hold_below_lash; default held: "
                    "the eye_fit drape slivers inside the opening flip under any displacement on the fine mesh)")
    ap.add_argument("--crease", nargs="*", default=[], help="override crease parameters of BOTH eyes, key=value (e.g. fold=0 mode=groove depth=0.03)")
    ap.add_argument("--curved", action="store_true", help="curved lift (PN-triangle edge curves from the base normals) instead of flat midpoints")
    ap.add_argument("--asset", default="", help="detail asset (default assets/gnm-detail-v1.npz)")
    ap.add_argument("--tex-dir", default="", help="maps from model/<dir> of the source run")
    ap.add_argument("--lifted", default="", help="PIPELINE (S2): a detail-topology ply made by pipeline/detail_apply.py - no lift / eye parts here")
    ap.add_argument("--in-place", action="store_true", help="PIPELINE: write model/head.glb of the run itself (with --lifted)")
    a = ap.parse_args()
    W = os.path.normpath(a.work); M = os.path.join(W, "model"); sid = os.path.basename(W)
    rep = json.load(open(os.path.join(M, "report.json"), encoding="utf-8")); name = a.fit or rep.get("chosen", "gnm")
    out_id = a.out_id or f"{sid}-detail"
    if a.in_place:
        if not a.lifted: raise SystemExit("--in-place needs --lifted (the run's own detail mesh)")
        out_id = sid
    elif out_id == sid: raise SystemExit("refusing to write into the source run (--out-id must differ)")
    O = os.path.join(os.path.dirname(W), out_id, "model"); os.makedirs(O, exist_ok=True)
    fit = os.path.join(M, f"fit_{name}.ply"); fj = json.load(open(os.path.join(M, f"fit_{name}.fit.json")))
    lid = np.asarray(fj["landmark_vertex_ids"], np.int64)
    D = DetailMesh(a.asset) if a.asset else DetailMesh()
    V0 = np.asarray(meshio.read_any(fit)["vertices"], np.float64)
    if len(V0) != D.n0: raise SystemExit(f"fit has {len(V0)} vertices, the detail asset expects {D.n0} base vertices")
    t0 = time.time(); tm = {}
    eyes_src = None
    if a.eyes_from:
        Ve = np.asarray(meshio.read_any(os.path.join(M, f"fit_{a.eyes_from}.ply"))["vertices"], np.float64)
        sel = D.mat[:D.n0] != 0; eyes_src = {"fit": a.eyes_from, "vertices": int(sel.sum()),
                                              "moved_pct_iod": round(float(np.linalg.norm(Ve[sel] - V0[sel], axis=1).max() / np.linalg.norm(V0[lid[33]] - V0[lid[263]]) * 100), 3)}
        V0 = V0.copy(); V0[sel] = Ve[sel]
    Vd = D.upsample(V0, curved=a.curved); tm["upsample_sec"] = round(time.time() - t0, 2)
    lift = {"curved": a.curved}
    if a.curved:                                                        # how far the curved surface is from the flat one
        Vflat = D.upsample(V0); dd = np.linalg.norm(Vd - Vflat, axis=1)[D.n0:] / np.linalg.norm(V0[lid[33]] - V0[lid[263]]) * 100
        lift["curved_vs_flat_pct_iod"] = {"median": round(float(np.median(dd)), 3), "p95": round(float(np.percentile(dd, 95)), 3), "max": round(float(dd.max()), 3)}
    F, UV, UT, mat = D.F, D.UV, D.UT, D.mat
    skinF = F[(mat[F] == 0).all(1)]
    eye_info = None; Vd1 = Vd
    if a.lifted:
        Vd1 = np.asarray(meshio.read_any(a.lifted)["vertices"], np.float64)
        if len(Vd1) != D.n: raise SystemExit(f"--lifted has {len(Vd1)} vertices, the detail asset {D.n}")
        lift = {"lifted": os.path.relpath(a.lifted, ROOT), "detail_json": json.load(open(os.path.join(M, "detail.json"), encoding="utf-8")) if os.path.exists(os.path.join(M, "detail.json")) else None}
    if a.eye_params and not a.lifted:
        from eye_parts import EyeBasis, flipped_faces, inside_eyeball
        ep = json.load(open(a.eye_params, encoding="utf-8")); params = ep["params"]
        for kv in a.crease:
            k, v = kv.split("=", 1)
            for S in ("R", "L"): params[S]["crease"][k] = v if k in ("mode", "curve") else float(v)
        t1 = time.time()
        B = EyeBasis(Vd, F, mat, D.comp, lid, ring_hold=a.ring_hold, normal_smooth=a.normal_smooth, target_mask=None if a.all_targets else (D.level == 0),
                     hold_below_lash=not a.no_hold_below_lash)
        tm["eye_basis_sec"] = round(time.time() - t1, 2); t1 = time.time()
        disp = B.displace(params, smooth_iters=a.smooth); Vd1 = Vd + disp; tm["eye_solve_sec"] = round(time.time() - t1, 2)
        ew = B.eyes["R"]["ew"]; fl, fld = flipped_faces(Vd, Vd1, skinF)
        # a fold OVERHANG turns a face's normal by > 90 deg (down / forward: a real lip) - the sign test counts it as flipped;
        # faces whose new normal points INTO the head (backward) are the true inversions
        n0 = np.cross(Vd[skinF[:, 1]] - Vd[skinF[:, 0]], Vd[skinF[:, 2]] - Vd[skinF[:, 0]]); n1 = np.cross(Vd1[skinF[:, 1]] - Vd1[skinF[:, 0]], Vd1[skinF[:, 2]] - Vd1[skinF[:, 0]])
        sgn = (n0 * n1).sum(1) < 0; n1u = n1 / (np.linalg.norm(n1, axis=1, keepdims=True) + 1e-18); n0u = n0 / (np.linalg.norm(n0, axis=1, keepdims=True) + 1e-18)
        outward = np.sign((n0u * B.axes["fwd"]).sum(1).mean())            # face winding vs the forward axis
        back = int((sgn & ((n1u * B.axes["fwd"]).sum(1) * outward < -0.3)).sum())
        crease = {S: (int(len(B.crease_line(S, params[S]))) if (np.array(params[S]["crease"]["heights"]) > 0).any() else 0) for S in ("R", "L")}
        eye_info = {"params_file": os.path.relpath(a.eye_params, ROOT), "params": params, "ring_hold": a.ring_hold, "normal_smooth": a.normal_smooth,
                    "smooth": a.smooth, "targets": "all" if a.all_targets else "base vertices (level 0)",
                    "moved_vertices": int((np.linalg.norm(disp, axis=1) > 1e-4 * ew).sum()), "max_disp_x_ew": round(float(np.linalg.norm(disp, axis=1).max() / ew), 4),
                    "hold_below_lash": not a.no_hold_below_lash, "held_below_lash": {S: B.eyes[S].get("held_below_lash") for S in ("R", "L")}, "crease_override": a.crease,
                    "flipped_faces": int(fl), "flipped_degenerate_faces": int(fld), "flipped_facing_back": back, "inside_eyeball": inside_eyeball(B, Vd1), "crease_line_vertices": crease}
        # the same parameters on the BASE mesh, for the "how much did the resolution change" numbers
        Fb = np.load(os.path.join(ROOT, "assets", "gnm-template-v2.npz"))["triangles"].astype(np.int64)
        Bb = EyeBasis(V0, Fb, mat[:D.n0], D.comp[:D.n0], lid)
        db = Bb.displace(params, smooth_iters=a.smooth)
        eye_info["base_crease_line_vertices"] = {S: (int(len(Bb.crease_line(S, params[S]))) if (np.array(params[S]["crease"]["heights"]) > 0).any() else 0) for S in ("R", "L")}
        eye_info["base_moved_vertices"] = int((np.linalg.norm(db, axis=1) > 1e-4 * ew).sum())
    if not a.lifted: meshio.write_ply(os.path.join(O, f"fit_{name}_detail.ply"), Vd1, F, None)
    # ---- glb (as export_glb.py, with the detail arrays)
    V = Vd1; L = V[lid]; c, Rh = head_frame(L)
    iod = float(np.linalg.norm(L[33] - L[263])); s = IOD_NORM_M / iod
    Vh = ((V - c) @ Rh.T) * s
    fn = np.cross(Vh[F[:, 1]] - Vh[F[:, 0]], Vh[F[:, 2]] - Vh[F[:, 0]]); vn = np.zeros_like(Vh)
    for k in range(3): np.add.at(vn, F[:, k], fn)
    ln = np.linalg.norm(vn, axis=1); skin = mat == 0
    bad = ln < 1e-12; vn[~bad] /= ln[~bad, None]
    if ((Vh[skin & ~bad] - Vh[skin].mean(0)) * vn[skin & ~bad]).sum(1).mean() < 0: vn = -vn
    if bad.any():
        r = Vh[bad] - Vh[skin].mean(0); vn[bad] = r / (np.linalg.norm(r, axis=1, keepdims=True) + 1e-12)
    g = GLB()
    tex = lambda n: os.path.join(M, a.tex_dir, f"tex_{n}.png")
    t_alb = g.image(tex("skin_albedo")) if os.path.exists(tex("skin_albedo")) else None
    t_photo = g.image(tex("skin")); t_norm = g.image(tex("skin_normal")); t_orm = g.image(tex("skin_orm"))
    t_eye = g.image(tex("eye")); t_iris = g.image(tex("iris"))

    def material(name, tex_i, color=None, rough=0.55, normal=None, orm=None, double=True):
        m = {"name": name, "pbrMetallicRoughness": {"baseColorFactor": color or [1, 1, 1, 1], "metallicFactor": 0.0, "roughnessFactor": rough}, "doubleSided": double}
        if tex_i is not None: m["pbrMetallicRoughness"]["baseColorTexture"] = {"index": tex_i}
        if normal is not None: m["normalTexture"] = {"index": normal, "scale": 1.0}
        if orm is not None:
            m["pbrMetallicRoughness"]["metallicRoughnessTexture"] = {"index": orm}; m["pbrMetallicRoughness"]["roughnessFactor"] = 1.0
            m["occlusionTexture"] = {"index": orm, "strength": 1.0}
        g.materials.append(m); return len(g.materials) - 1
    m_skin = material("skin", t_alb if t_alb is not None else t_photo, rough=0.55, normal=t_norm, orm=t_orm)
    m_photo = material("skin_photo", t_photo, rough=0.6, normal=t_norm, orm=t_orm)
    m_eye = material("eye", t_eye, rough=0.12); m_iris = material("iris", t_iris, rough=0.2)
    eyeish = np.isin(mat[F], [4, 5, 6]).all(1)
    sets = [("iris", eyeish & np.isin(mat[F], [5, 6]).any(1), m_iris), ("eye", np.isin(mat[F], [4]).all(1), m_eye), ("skin", np.isin(mat[F], [0]).all(1), m_skin)]
    sets += [(n, np.isin(mat[F], ids).all(1), material(n, None, col, r)) for n, (ids, col, r) in MOUTH.items()]
    tpl = D.lift(np.arange(D.n0))                                   # base ancestor of every detail vertex (largest weight, level by level)
    used = np.zeros(len(F), bool); prim_info = {}
    for name_, sel, mi in sets + [("other", None, material("other", None, [0.75, 0.6, 0.6, 1], 0.6))]:
        tris = np.where(~used)[0] if sel is None else np.where(sel & ~used)[0]
        used[tris] = True
        if not len(tris): continue
        key = F[tris] * len(UV) + UT[tris]
        uniq, inv = np.unique(key.ravel(), return_inverse=True)
        pi, ui = uniq // len(UV), uniq % len(UV)
        uv = UV[ui].copy(); uv[:, 1] = 1.0 - uv[:, 1]
        attrs = {"POSITION": g.accessor(Vh[pi].astype("<f4"), 5126, "VEC3", 34962, minmax=True),
                 "NORMAL": g.accessor(vn[pi].astype("<f4"), 5126, "VEC3", 34962),
                 "TEXCOORD_0": g.accessor(uv.astype("<f4"), 5126, "VEC2", 34962),
                 "_TEMPLATE_INDEX": g.accessor(tpl[pi].astype("<u4")[:, None], 5125, "SCALAR", 34962),
                 "_DETAIL_INDEX": g.accessor(pi.astype("<u4")[:, None], 5125, "SCALAR", 34962)}
        idx = g.accessor(inv.astype("<u4"), 5125, "SCALAR", 34963)
        prim = {"attributes": attrs, "indices": idx, "material": mi, "mode": 4}
        if name_ == "skin" and t_alb is not None:
            prim["extensions"] = {"KHR_materials_variants": {"mappings": [{"material": m_skin, "variants": [0]}, {"material": m_photo, "variants": [1]}]}}
        g.meshes.append({"name": name_, "primitives": [prim]}); g.nodes.append({"name": name_, "mesh": len(g.meshes) - 1})
        prim_info[name_] = {"vertices": int(len(pi)), "triangles": int(len(tris))}
    regions = {}
    try:
        from gnm_model import GNM, template_map
        from gnm_features import scalp_vertices
        G = GNM(); o2g = template_map()[0]
        for i, n in enumerate(G.group_names):
            if n.endswith("region") or n in ("ears", "upper_lip", "lower_lip", "left_eye", "right_eye", "eye_sockets", "left", "right"):
                ids = np.where(G.groups[i][o2g] > 0.3)[0]
                if len(ids): regions[n] = ids.astype(int).tolist()
        sc = scalp_vertices(); regions["scalp"] = np.where(sc)[0].astype(int).tolist()
        scd = D.lift(sc.astype(bool)); scalp_tris = np.where(scd[F].all(1) & skin[F].all(1))[0].astype(int).tolist()
    except Exception as ex:
        scalp_tris = []; regions["_error"] = str(ex)[:200]
    T = np.eye(4); T[:3, :3] = s * Rh; T[:3, 3] = -s * (Rh @ c)
    sha = hashlib.sha1(open(fit, "rb").read()).hexdigest()[:12]
    detail = {"asset": os.path.relpath(D.path, ROOT), "version": D.version, "base_vertices": D.n0, "vertices": int(D.n), "faces": int(len(F)),
              "levels": D.info()["levels"], "regions": D.levels.get("regions"), "template_index": "base ancestor (largest parent weight)",
              "eyes_from": eyes_src, "lift": lift, "eye_parts": eye_info, "timing_sec": tm, "note": "viewer-first: textures / rig / frames are the base run's; not a pipeline result (W8b S2 pending)"}
    extras = {"live-mirror": {**FORMAT, "source": sid, "chosen_fit": name, "fit_sha": sha, "created": time.strftime("%Y-%m-%d %H:%M:%S"),
              "frame": "+X person's left, +Y up (chin -> forehead), +Z forward; origin between the ears (head_axes)",
              "scale_note": f"metres with the eye distance NORMALISED to {IOD_NORM_M * 1000:.0f} mm - not a measured size (no marker)",
              "world_to_glb": T.round(8).tolist(), "template": "assets/gnm-template-v2.npz (vertex order = _TEMPLATE_INDEX); detail layer " + detail["asset"] + " (_DETAIL_INDEX)",
              "template_vertices": int(D.n0), "landmark_vertex_ids": lid.astype(int).tolist(),
              "regions": regions, "scalp_triangles": scalp_tris, "primitives": prim_info,
              "materials_note": "skin = lighting-free albedo (variant 'albedo'), 'photo' = capture-lit bake (baked on the BASE mesh, same UV)",
              "tex_dir": a.tex_dir or ".", "bald": False, "maps": {"albedo": t_alb is not None, "photo": t_photo is not None, "normal": t_norm is not None, "orm": t_orm is not None},
              "detail": {k: v for k, v in detail.items() if k != "eye_parts"} | {"eye_parts": None if eye_info is None else {k: v for k, v in eye_info.items() if k != "params"}}}}
    eye_proof = from_parts(M)
    if eye_proof is not None:
        extras["live-mirror"]["eye_review"], extras["live-mirror"]["eye_parts_sha256"] = eye_proof
    out = os.path.join(O, "head.glb")
    n = g.write(out, extras, variants=["albedo", "photo"] if t_alb is not None else None)
    summ = {"out": os.path.relpath(out, ROOT), "bytes": n, "source": W, "fit": name, "primitives": prim_info, "detail": detail, "fit_sha": sha}
    json.dump({"out": out, "bytes": n, "primitives": prim_info, "regions": len([k for k in regions if not k.startswith("_")]), "maps": extras["live-mirror"]["maps"], "fit_sha": sha},
              open(os.path.splitext(out)[0] + ".glb.json", "w"), indent=1)
    json.dump(summ, open(os.path.join(O, "export_detail.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    for f in ("frames.json",):                                         # photo overlay cameras: same base landmarks -> same head frame
        if os.path.exists(os.path.join(M, f)) and not os.path.exists(os.path.join(O, f)): shutil.copy2(os.path.join(M, f), os.path.join(O, f))
    print(json.dumps({k: v for k, v in summ.items() if k != "detail"} | {"detail": {k: v for k, v in detail.items() if k != "eye_parts"},
                      "eye_parts": None if eye_info is None else {k: v for k, v in eye_info.items() if k != "params"}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
