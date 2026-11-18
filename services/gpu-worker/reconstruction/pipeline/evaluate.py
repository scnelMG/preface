"""H1 geometry evaluation.

  python evaluate.py loss <caseDir>                     raw->clean and clean->editable surface loss (GEO-02)
  python evaluate.py template <scanCase> <templateCase> how far a base template nose is from the scanned nose
  python evaluate.py repeat <caseA> <caseB> [<caseC>..] session repeatability on the nose (GEO-01, GEO-04)

Distances are point-to-surface (closest point on triangles) when trimesh is available, else point-to-vertex
(upper bound, stated in the output). Reported in mm only if every case has metric_scale_known, else in D units.
Registration for repeatability uses STABLE face regions only (nose excluded) to avoid fitting away nose error.
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import canonical  # noqa: E402
import meshio  # noqa: E402
import render  # noqa: E402
from render_edits import load_case  # noqa: E402

def _closest_on_tris(p, a, b, c):
    """vectorised closest point on triangles (Ericson). p,a,b,c: (N,3). returns distances."""
    ab, ac, ap = b - a, c - a, p - a
    d1, d2 = (ab * ap).sum(1), (ac * ap).sum(1)
    bp = p - b; d3, d4 = (ab * bp).sum(1), (ac * bp).sum(1)
    cp = p - c; d5, d6 = (ab * cp).sum(1), (ac * cp).sum(1)
    va = d3 * d6 - d5 * d4; vb = d5 * d2 - d1 * d6; vc = d1 * d4 - d3 * d2
    res = np.empty_like(p)
    den = va + vb + vc
    den = np.where(np.abs(den) < 1e-30, 1e-30, den)
    v = vb / den; w = vc / den
    res[:] = a + ab * v[:, None] + ac * w[:, None]
    m = (va <= 0) & (d4 - d3 >= 0) & (d5 - d6 >= 0)
    t = (d4 - d3) / np.maximum((d4 - d3) + (d5 - d6), 1e-30); res[m] = (b + (c - b) * t[:, None])[m]
    m = (vb <= 0) & (d2 >= 0) & (d6 <= 0)
    t = d2 / np.maximum(d2 - d6, 1e-30); res[m] = (a + ac * t[:, None])[m]
    m = (vc <= 0) & (d1 >= 0) & (d3 <= 0)
    t = d1 / np.maximum(d1 - d3, 1e-30); res[m] = (a + ab * t[:, None])[m]
    res[(d6 >= 0) & (d5 <= d6)] = c[(d6 >= 0) & (d5 <= d6)]
    res[(d3 >= 0) & (d4 <= d3)] = b[(d3 >= 0) & (d4 <= d3)]
    res[(d1 <= 0) & (d2 <= 0)] = a[(d1 <= 0) & (d2 <= 0)]
    return np.linalg.norm(p - res, axis=1)


def p2s(points, v, f, k=10):
    """exact point-to-surface distance restricted to triangles incident to the k nearest vertices."""
    from collections import defaultdict
    inc = defaultdict(list)
    for t, tri in enumerate(f):
        for x in tri:
            inc[x].append(t)
    if canonical.cKDTree is not None:
        _, nn = canonical.cKDTree(v).query(points, k=k)
    else:
        nn = np.stack([canonical.nn_query(v, points)[1]], 1)
    best = np.full(len(points), np.inf)
    for col in range(nn.shape[1]):
        cand = [inc[i] for i in nn[:, col]]
        maxc = max(len(c) for c in cand)
        for j in range(maxc):
            sel = np.array([len(c) > j for c in cand])
            if not sel.any():
                continue
            tris = f[np.array([c[j] for c, s_ in zip(cand, sel) if s_])]
            d = _closest_on_tris(points[sel], v[tris[:, 0]], v[tris[:, 1]], v[tris[:, 2]])
            best[sel] = np.minimum(best[sel], d)
    return best, "point_to_surface (k-nearest-vertex candidate triangles)"


def stats(d):
    d = np.asarray(d)
    return {"median": float(np.median(d)), "p95": float(np.quantile(d, 0.95)), "max": float(d.max()), "n": int(len(d))}


def nose_mask(v, js, margin=0.0):
    L, D = js["landmarks"], js["D"]
    return (np.abs(v[:, 0]) < (0.6 + margin) * D) & (v[:, 1] > L["subnasale"][1] - 0.1 * D) & (v[:, 1] < L["nasion"][1]) & (v[:, 2] > -0.9 * D)


def stable_mask(v, js):
    L, D = js["landmarks"], js["D"]
    r = np.linalg.norm(v - np.array(L["pronasale"]), axis=1)
    return (r > 1.0 * D) & (r < 2.2 * D) & ~nose_mask(v, js, 0.3)


def unit_info(*jss):
    if all(j["units"]["metric_scale_known"] for j in jss):
        return "mm", [j["units"]["mm_per_unit"] for j in jss]
    return "D", [1.0 / j["D"] for j in jss]


def cmd_loss(case):
    js, ve, fe, _ = load_case(case)
    cap = json.load(open(os.path.join(case, "capture.json")))
    raw = meshio.read_any(os.path.join(case, cap.get("mesh_file") or cap["raw_file"]))
    T = np.array(js["frame"]["transform_source_to_canonical"])
    rawc = raw["vertices"] @ T[:3, :3].T + T[:3, 3]
    clean = meshio.read_ply(os.path.join(case, "processed", "face_clean.ply"))
    unit, scale = unit_info(js)
    # raw -> clean: every clean vertex must coincide with a raw vertex (crop only, no smoothing)
    d_rc, _ = canonical.nn_query(rawc, clean["vertices"])
    # clean -> editable: editable vertices onto the clean surface
    d_ce, how = p2s(ve, clean["vertices"], clean["faces"])
    nm = nose_mask(ve, js)
    out = {
        "test": "GEO-02 (and raw->clean)", "unit": unit,
        "raw_to_clean_vertex_offset": stats(d_rc * scale[0]),
        "clean_to_editable_all": stats(d_ce * scale[0]),
        "clean_to_editable_nose": stats(d_ce[nm] * scale[0]),
        "distance_kind": how,
        "note": "crop+linear subdivision cannot change the surface; non-zero values = float32 storage only. This does NOT measure scanner accuracy.",
    }
    json.dump(out, open(os.path.join(case, "evaluation", "geo02_loss.json"), "w"), indent=1)
    print(json.dumps(out, indent=1))


def nose_dims(v, js):
    L, D = js["landmarks"], js["D"]
    prn, sn, n = map(np.array, (L["pronasale"], L["subnasale"], L["nasion"]))
    al, ar = np.array(L["alar_crease_subject_left"]), np.array(L["alar_crease_subject_right"])
    tl, tr = np.array(L["tip_lat_subject_left"]), np.array(L["tip_lat_subject_right"])
    return {
        "nose_height_D": float(n[1] - sn[1]),
        "tip_projection_from_alar_crease": float(prn[2] - 0.5 * (al[2] + ar[2])),
        "alar_crease_width": float(abs(al[0] - ar[0])),
        "tip_width": float(abs(tl[0] - tr[0])),
        "nasion_to_tip_length": float(np.linalg.norm(prn - n)),
        "tip_to_subnasale_length": float(np.linalg.norm(prn - sn)),
        "nasolabial_proxy_angle_deg": float(np.degrees(np.arctan2(prn[1] - sn[1], prn[2] - sn[2]))),
    }


def align_by_landmarks(js_src, js_dst, names):
    A = np.array([js_src["landmarks"][k] for k in names]) / js_src["D"]
    B = np.array([js_dst["landmarks"][k] for k in names]) / js_dst["D"]
    R, t = canonical.rigid_fit(A, B)
    return R, t


def cmd_template(scan_case, tmpl_case):
    js_s, vs, fs, _ = load_case(scan_case)
    js_t, vt, ft, _ = load_case(tmpl_case)
    # normalise each by its own D (template is scale-free relative to a person), align with nose-BASE landmarks
    names = ["nasion", "subnasale", "alar_crease_subject_left", "alar_crease_subject_right"]
    R, t = align_by_landmarks(js_t, js_s, names)
    vt_n = (vt / js_t["D"]) @ R.T + t
    vs_n = vs / js_s["D"]
    nm = nose_mask(vt, js_t)
    d, how = p2s(vt_n[nm], vs_n, fs)
    ds = nose_dims(vs, js_s); dt = nose_dims(vt, js_t)
    rel = {k: {"scan": ds[k] / (js_s["D"] if k != "nasolabial_proxy_angle_deg" else 1),
               "template": dt[k] / (js_t["D"] if k != "nasolabial_proxy_angle_deg" else 1)} for k in ds}
    out = {
        "test": "H1 base-shape check: template nose vs scanned nose (both normalised by their own D)",
        "alignment": "rigid fit on nasion, subnasale, alar creases after D-normalisation (tip NOT used)",
        "template_nose_to_scan_surface_D": stats(d), "distance_kind": how,
        "relative_dimensions": rel,
        "interpretation": "A crop of the base template keeps the template's nose: differences here are what a crop-only approach would lose for this person. Not an accuracy measurement of any scanner.",
    }
    json.dump(out, open(os.path.join(scan_case, "evaluation", "template_vs_scan.json"), "w"), indent=1)
    # visual: side profiles overlay + error map on the template nose
    col = np.tile([0.8, 0.8, 0.82], (len(vt_n), 1))
    full_d, _ = p2s(vt_n, vs_n, fs)
    col = render.error_colors(np.where(nm, full_d, np.nan), 0.15)
    ctr = np.array([0, -0.15, -0.4])
    ims = [render.render(vs_n, fs, "side_r", 340, center=ctr, extent=1.0), render.render(vt_n, ft, "side_r", 340, center=ctr, extent=1.0),
           render.render(vs_n, fs, "front", 340, center=ctr, extent=1.0), render.render(vt_n, ft, "front", 340, center=ctr, extent=1.0),
           render.render(vt_n, ft, "oblique_r", 340, colors=col, center=ctr, extent=1.0)]
    render.save_png(os.path.join(scan_case, "evaluation", "template_vs_scan.png"),
                    render.contact_sheet(ims, ["scan side", "template side (aligned)", "scan front", "template front", "template nose dist to scan (white 0 -> red >=0.15D)"], 5))
    print(json.dumps(out, indent=1))


def cmd_repeat(cases, out_path):
    loaded = [(c,) + load_case(c) for c in cases]
    unit, scales = unit_info(*[l[1] for l in loaded])
    ref_case, js0, v0, f0, _ = loaded[0]
    rows, dims = [], []
    for c, js, v, f, _ in loaded:
        conv = js["units"]["mm_per_unit"] if unit == "mm" else 1 / js["D"]
        dd = {k: (x if k == "nasolabial_proxy_angle_deg" else x * conv) for k, x in nose_dims(v, js).items()}
        dims.append({"case": os.path.basename(c), **dd})
    for i in range(len(loaded)):
        for j in range(i + 1, len(loaded)):
            ca, ja, va, fa, _ = loaded[i]
            cb, jb, vb, fb, _ = loaded[j]
            sa = va * (ja["units"]["mm_per_unit"] if unit == "mm" else 1 / ja["D"])
            sb = vb * (jb["units"]["mm_per_unit"] if unit == "mm" else 1 / jb["D"])
            st = stable_mask(va, ja)
            R, t, _ = canonical.icp(sa[st], sb, iters=40, trim=0.9)
            sa2 = sa @ R.T + t
            nm = nose_mask(va, ja)
            d, how = p2s(sa2[nm], sb, fb)
            rows.append({"a": os.path.basename(ca), "b": os.path.basename(cb), "nose": stats(d), "distance_kind": how,
                         "registration": "ICP on stable face ring 1.0D-2.2D from tip, nose excluded"})
    keys = [k for k in dims[0] if k != "case"]
    variation = {k: float(max(d[k] for d in dims) - min(d[k] for d in dims)) for k in keys}
    # GEO-04 with landmark TRANSFER: reference-session landmarks are mapped into each session by stable-region ICP
    # and snapped to that session's surface; dimensions are then measured in the reference frame.
    conv0 = js0["units"]["mm_per_unit"] if unit == "mm" else 1 / js0["D"]
    dims_t = []
    for c, js, v, f, _ in loaded:
        conv = js["units"]["mm_per_unit"] if unit == "mm" else 1 / js["D"]
        sv, s0 = v * conv, v0 * conv0
        st = stable_mask(v, js)
        R, t, _ = canonical.icp(sv[st], s0, iters=40, trim=0.9)
        svr = sv @ R.T + t  # session in reference frame (scaled units)
        lm = {}
        for k2, p in js0["landmarks"].items():
            p = np.asarray(p) * conv0
            _, i = canonical.nn_query(svr, p[None])
            lm[k2] = svr[i[0]]
        fake = {"landmarks": {k2: (val / conv0).tolist() for k2, val in lm.items()}, "D": js0["D"]}
        dd = {k2: (x if k2 == "nasolabial_proxy_angle_deg" else x * conv0) for k2, x in nose_dims(None, fake).items()}
        dims_t.append({"case": os.path.basename(c), **dd})
    variation_t = {k: float(max(d[k] for d in dims_t) - min(d[k] for d in dims_t)) for k in keys}
    out = {"test": "GEO-01 / GEO-04 repeatability", "unit": unit, "pairs": rows,
           "dimensions_auto_landmarks_per_session": dims, "range_auto_landmarks": variation,
           "dimensions_transferred_landmarks": dims_t, "range_transferred_landmarks": variation_t,
           "landmark_transfer": "reference = first case; ICP on stable ring; snap to nearest vertex of each session"}
    json.dump(out, open(out_path, "w"), indent=1)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "loss":
        cmd_loss(sys.argv[2])
    elif cmd == "template":
        cmd_template(sys.argv[2], sys.argv[3])
    elif cmd == "repeat":
        cmd_repeat(sys.argv[2:-1], sys.argv[-1])
