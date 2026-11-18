"""W8b S2 (2026-10-21): the chosen BASE fit of a run -> the DETAIL layer mesh  model/fit_<c>_detail.ply

  1. base         model/fit_<c>.ply (after eye_fit: eyeballs placed, lids draped). When c = gnme the base-resolution eye
                  displacement is UNDONE first (recomputed from model/eye_parts.json on fit_gnm.ply) so that the eye parts
                  are solved once, on the detail mesh, instead of being lifted from the coarse one.
  2. lift         DetailMesh.upsample (midpoints, base vertices keep their index) + Taubin smoothing of the refined skin
                  (--smooth-passes 8: the facet-scale ripple of the lifted base disappears, base vertices move ~0.07 % IOD)
  3. eye parts    EyeBasis on the detail mesh (ring_hold, hold_below_lash, targets on EVERY detail vertex: the thick roll
                  fold needs the fine rows) with the parameters of model/eye_parts.json (gnme) - nothing when the chosen
                  fit has no eye parts
  4. outputs      fit_<c>_detail.ply, detail.json (checks: flipped / inverted faces, inside eyeball, crease line vertices,
                  timing). The base fit, report.json and the qa are untouched (qa stays on the base; rule 6).
usage  python pipeline/detail_apply.py work/<id> [--fit gnme] [--eye-params model/eye_parts.json] [--no-undo]
                                       [--smooth-passes 8] [--curved] [--base-targets] [--crease fold=0.05 ...] [--out <ply>]
"""
import argparse, json, os, sys, time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE); sys.path.insert(0, HERE)
TEMPLATE = os.path.join(ROOT, "assets", "gnm-template-v2.npz")


def main():
    import meshio
    from detail_mesh import DetailMesh
    from eye_parts import EyeBasis, flipped_faces, inside_eyeball
    ap = argparse.ArgumentParser()
    ap.add_argument("work"); ap.add_argument("--fit", default="", help="fit name (default report.json chosen)")
    ap.add_argument("--eye-params", default="", help="eye_parts json (default model/eye_parts.json when the fit is gnme / --no-undo for other bases)")
    ap.add_argument("--no-undo", action="store_true", help="the base carries no eye-parts displacement (e.g. fit_gnm_<variant>_ef.ply)")
    ap.add_argument("--smooth-passes", type=int, default=8); ap.add_argument("--curved", action="store_true")
    ap.add_argument("--base-targets", action="store_true", help="eye targets on base vertices only (S1 behaviour; default: all detail vertices)")
    ap.add_argument("--ring-hold", type=float, default=0.015); ap.add_argument("--normal-smooth", type=int, default=0)
    ap.add_argument("--crease", nargs="*", default=[], help="override crease parameters of both eyes, key=value (fold=0.05 fold_width=0.15 mode=tuck)")
    ap.add_argument("--lid-profile", default="", help="S2.5: model/lid_profile.json (pipeline/lid_profile.py) - its fullness bands are applied (EyeBasis patch 1.1)")
    ap.add_argument("--asset", default=""); ap.add_argument("--out", default="", help="output ply (default model/fit_<fit>_detail.ply)")
    ap.add_argument("--json", default="", help="output json (default model/detail.json)")
    a = ap.parse_args()
    W = os.path.normpath(a.work); M = os.path.join(W, "model"); P = lambda n: os.path.join(M, n)
    name = a.fit or json.load(open(P("report.json"), encoding="utf-8")).get("chosen", "gnm")   # report.json exists only after scan_to_model
    fj = json.load(open(P(f"fit_{name}.fit.json"))); lid = np.asarray(fj["landmark_vertex_ids"], np.int64)
    V = np.asarray(meshio.read_any(P(f"fit_{name}.ply"))["vertices"], np.float64)
    D = DetailMesh(a.asset) if a.asset else DetailMesh()
    if len(V) != D.n0: raise SystemExit(f"fit has {len(V)} vertices, the detail asset expects {D.n0}")
    t = np.load(TEMPLATE); Fb = t["triangles"].astype(np.int64)
    tm = {}; info = {"work": W, "fit": name, "asset": os.path.relpath(D.path, ROOT), "smooth_passes": a.smooth_passes, "curved": a.curved}
    ep = a.eye_params or (P("eye_parts.json") if name == "gnme" and os.path.exists(P("eye_parts.json")) else "")
    params = None
    if ep:
        epj = json.load(open(ep, encoding="utf-8")); params = epj["params"]
        for kv in a.crease:
            k, v = kv.split("=", 1)
            for S in ("R", "L"): params[S]["crease"][k] = v if k in ("mode", "curve") else float(v)
        info["eye_params"] = os.path.relpath(ep, ROOT); info["crease_override"] = a.crease
        if not a.no_undo:
            # undo the base-resolution displacement: recompute it on the base it was fitted on (fit_<base>.ply of the eye fit)
            bname = epj.get("base", "gnm"); Vb = np.asarray(meshio.read_any(P(f"fit_{bname}.ply"))["vertices"], np.float64)
            t0 = time.time(); Bb = EyeBasis(Vb, Fb, t["materials"], t["components"], lid)
            Db = Bb.displace(params, smooth_iters=int((epj.get("constants") or {}).get("smooth_iters", 0) or 0))
            V = V - Db; tm["undo_sec"] = round(time.time() - t0, 2)
            info["undo"] = {"base": bname, "moved_vertices": int((np.linalg.norm(Db, axis=1) > 1e-4 * Bb.eyes["R"]["ew"]).sum())}
    patch_r = None
    if a.lid_profile:
        lp = json.load(open(a.lid_profile, encoding="utf-8")); patch_r = lp.get("patch_r", 1.1)
        if params is None: params = {S: {"crease": {"heights": [0, 0, 0], "depth": 0, "bulge": 0, "fold": 0}, "fullness": [0, 0, 0], "epicanthus": {"cover": 0, "angle_deg": 0}} for S in "RL"}
        for S in ("R", "L"): params[S]["fullness"] = lp["fullness"][S]
        info["lid_profile"] = {"file": os.path.relpath(a.lid_profile, ROOT), "fullness": lp["fullness"], "patch_r": patch_r}
    t0 = time.time(); Vd = D.upsample(V, curved=a.curved, smooth_passes=a.smooth_passes); tm["lift_sec"] = round(time.time() - t0, 2)
    iod = float(np.linalg.norm(V[lid[33]] - V[lid[263]]))
    mv = np.linalg.norm(Vd[:D.n0] - V, axis=1) / iod * 100
    info["lift"] = {"base_move_pct_iod": {"median": round(float(np.median(mv[mv > 1e-9])), 4) if (mv > 1e-9).any() else 0.0, "p95": round(float(np.percentile(mv, 95)), 4), "max": round(float(mv.max()), 4)}}
    F, mat = D.F, D.mat; skinF = F[(mat[F] == 0).all(1)]; Vd1 = Vd
    if params is not None:
        t0 = time.time()
        B = EyeBasis(Vd, F, mat, D.comp, lid, ring_hold=a.ring_hold, normal_smooth=a.normal_smooth, target_mask=(D.level == 0) if a.base_targets else None, hold_below_lash=True,
                     **({"patch": patch_r} if patch_r else {}))
        tm["eye_basis_sec"] = round(time.time() - t0, 2); t0 = time.time()
        disp = B.displace(params); Vd1 = Vd + disp; tm["eye_solve_sec"] = round(time.time() - t0, 2)
        ew = B.eyes["R"]["ew"]; fl, fld = flipped_faces(Vd, Vd1, skinF)
        n0 = np.cross(Vd[skinF[:, 1]] - Vd[skinF[:, 0]], Vd[skinF[:, 2]] - Vd[skinF[:, 0]]); n1 = np.cross(Vd1[skinF[:, 1]] - Vd1[skinF[:, 0]], Vd1[skinF[:, 2]] - Vd1[skinF[:, 0]])
        sgn = (n0 * n1).sum(1) < 0; n1u = n1 / (np.linalg.norm(n1, axis=1, keepdims=True) + 1e-18); n0u = n0 / (np.linalg.norm(n0, axis=1, keepdims=True) + 1e-18)
        outward = np.sign((n0u * B.axes["fwd"]).sum(1).mean()); back = int((sgn & ((n1u * B.axes["fwd"]).sum(1) * outward < -0.3)).sum())
        info["eye_parts"] = {"params": params, "targets": "base vertices" if a.base_targets else "all", "ring_hold": a.ring_hold, "hold_below_lash": True,
                             "moved_vertices": int((np.linalg.norm(disp, axis=1) > 1e-4 * ew).sum()), "max_disp_x_ew": round(float(np.linalg.norm(disp, axis=1).max() / ew), 4),
                             "flipped_faces": int(fl), "flipped_degenerate_faces": int(fld), "flipped_facing_back": back, "inside_eyeball": inside_eyeball(B, Vd1),
                             "crease_line_vertices": {S: (int(len(B.crease_line(S, params[S]))) if (np.array(params[S]["crease"]["heights"]) > 0).any() else 0) for S in ("R", "L")},
                             "note": "flipped = normal sign change incl. the fold roll's underside (a real overhang); facing_back = true inversions"}
    out = a.out or P(f"fit_{name}_detail.ply")
    if os.path.abspath(out) == os.path.abspath(P(f"fit_{name}.ply")): raise SystemExit("refusing to overwrite the base fit")
    meshio.write_ply(out, Vd1, F, None)
    import hashlib
    info |= {"out": out, "vertices": int(D.n), "faces": int(len(F)), "timing_sec": tm, "sha": hashlib.sha1(open(out, "rb").read()).hexdigest()[:12],
             "base_sha": hashlib.sha1(open(P(f"fit_{name}.ply"), "rb").read()).hexdigest()[:12]}
    json.dump(info, open(a.json or P("detail.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(json.dumps({k: v for k, v in info.items() if k != "eye_parts"} | ({"eye_parts": {k: v for k, v in info["eye_parts"].items() if k != "params"}} if "eye_parts" in info else {}), ensure_ascii=False))


if __name__ == "__main__":
    main()
