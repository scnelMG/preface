"""Build a Live Mirror PoC case from a real scan mesh (TrueDepth app export, public scan, or template for comparison).

  python build_case.py --input scan.ply --case-id h1-s1 --input-kind truedepth_app_mesh --units m \
      --device "iPhone 17 Pro" --app "Heges x.y" --sensor truedepth [--unit-evidence card_check.json]

Stages: received -> input_validated -> cropped -> editable_ready -> texture_ready -> editing_ready
(failed_at_<stage> on error). Existing case folders are never overwritten.

Outputs (cases/<case_id>/):
  raw/<original file>                 byte copy + sha256 (immutable)
  processed/face_clean.ply            canonical-frame face crop (source units, no smoothing)
  avatar/editable.json + editable.bin web/engine model (positions/normals/colors/indices, landmarks, rig)
  avatar/editable.glb                 gray/vertex-color GLB of the editable model
  capture.json, avatar.json, status.json, evaluation/*.png
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
import time
import traceback

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import canonical  # noqa: E402
import meshio  # noqa: E402
import render  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TOPOLOGY_VERSION = "crop-v1+midsub-v1"
RIG_VERSION = "nose-tip-rig-v1"
UNIT_TO_MM = {"m": 1000.0, "cm": 10.0, "mm": 1.0}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def weld_groups(v, tol):
    key = np.round(v / tol).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    return inv.reshape(-1)


def welded_normals(v, f, groups):
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    acc = np.zeros((groups.max() + 1, 3))
    for k in range(3):
        np.add.at(acc, groups[f[:, k]], fn)
    n = acc[groups]
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-15)


def largest_component(f, nv):
    parent = np.arange(nv)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for a, b, c in f:
        ra, rb, rc = find(a), find(b), find(c)
        parent[rb] = ra
        parent[find(rc)] = ra
    roots = np.array([find(i) for i in range(nv)])
    used = np.unique(f)
    vals, counts = np.unique(roots[used], return_counts=True)
    keep_root = vals[np.argmax(counts)]
    return roots == keep_root


def submesh(v, f, keep_v, extra=None):
    keep_f = keep_v[f].all(1)
    f2 = f[keep_f]
    used = np.zeros(len(v), bool); used[f2.reshape(-1)] = True
    remap = -np.ones(len(v), np.int64); remap[used] = np.arange(used.sum())
    out = [v[used], remap[f2]]
    if extra is not None:
        out += [None if e is None else e[used] for e in extra]
    return out, used


def midpoint_subdivide(v, f, colors):
    """Linear 1->4 subdivision: new vertices lie exactly on the original triangles (zero surface change)."""
    edges = np.sort(np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]]), axis=1)
    uniq, inv = np.unique(edges, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    nv = len(v)
    v2 = np.concatenate([v, 0.5 * (v[uniq[:, 0]] + v[uniq[:, 1]])])
    c2 = None if colors is None else np.concatenate([colors, 0.5 * (colors[uniq[:, 0]] + colors[uniq[:, 1]])])
    m = len(f)
    e01, e12, e20 = inv[:m] + nv, inv[m:2 * m] + nv, inv[2 * m:] + nv
    a, b, c = f[:, 0], f[:, 1], f[:, 2]
    f2 = np.concatenate([np.stack([a, e01, e20], 1), np.stack([e01, b, e12], 1),
                         np.stack([e20, e12, c], 1), np.stack([e01, e12, e20], 1)])
    return v2, f2, c2


def taubin_smooth(v, f, iters, lam=0.5, mu=-0.53, groups=None):
    """Volume-preserving Taubin smoothing (uniform Laplacian) on the welded mesh; open-boundary vertices fixed.
    Removes scanner/estimation noise and facets without the shrinkage of plain Laplacian smoothing."""
    if iters <= 0:
        return v.copy()
    g = groups if groups is not None else np.arange(len(v))
    ng = g.max() + 1
    cnt = np.bincount(g, minlength=ng)[:, None]
    P = np.zeros((ng, 3)); np.add.at(P, g, v); P /= np.maximum(cnt, 1)
    fg = g[f]
    E = np.sort(np.concatenate([fg[:, [0, 1]], fg[:, [1, 2]], fg[:, [2, 0]]]), axis=1)
    E = E[E[:, 0] != E[:, 1]]
    uE, ec = np.unique(E, axis=0, return_counts=True)
    fixed = np.zeros(ng, bool); fixed[uE[ec == 1].reshape(-1)] = True
    deg = np.bincount(uE.reshape(-1), minlength=ng).astype(float)[:, None]
    for _ in range(iters):
        for w in (lam, mu):
            acc = np.zeros_like(P)
            np.add.at(acc, uE[:, 0], P[uE[:, 1]]); np.add.at(acc, uE[:, 1], P[uE[:, 0]])
            L = acc / np.maximum(deg, 1) - P
            L[fixed] = 0
            P = P + w * L
    return P[g]


def fill_small_holes(v, f, max_edges=24):
    """Close small boundary loops (holes) with a centroid fan. The largest loop (outer crop boundary) and loops longer
    than max_edges are left open (intentional crop edge / real openings). Returns v, f, n_filled, n_new_faces."""
    e = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    key = np.sort(e, axis=1)
    _, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    bnd = e[cnt[inv.reshape(-1)] == 1]  # directed boundary edges (face orientation kept)
    nxt = {}
    for a_, b_ in bnd:
        nxt.setdefault(int(a_), []).append(int(b_))
    seen, loops = set(), []
    for a_, b_ in bnd:
        if (int(a_), int(b_)) in seen:
            continue
        loop, cur, start, ok = [int(a_)], int(b_), int(a_), True
        seen.add((int(a_), int(b_)))
        while cur != start and len(loop) < 5000:
            loop.append(cur)
            cands = [x for x in nxt.get(cur, []) if (cur, x) not in seen]
            if not cands:
                ok = False
                break
            seen.add((cur, cands[0])); cur = cands[0]
        if ok and cur == start:
            loops.append(loop)
    if not loops:
        return v, f, 0, 0
    loops.sort(key=len)
    outer = loops[-1]
    newv, newf, nfill = [v], [f], 0
    nv = len(v)
    for lp in loops[:-1]:
        if len(lp) > max_edges or lp is outer:
            continue
        c = v[lp].mean(0)
        ci = nv; nv += 1
        newv.append(c[None])
        # boundary edges run opposite to the hole's fan orientation -> reverse to keep normals consistent
        newf.append(np.array([[lp[(k + 1) % len(lp)], lp[k], ci] for k in range(len(lp))], np.int64))
        nfill += 1
    v2 = np.concatenate(newv); f2 = np.concatenate(newf)
    return v2, f2, nfill, len(f2) - len(f)


def boundary_edges(f):
    e = np.sort(np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]]), axis=1)
    u, cnt = np.unique(e, axis=0, return_counts=True)
    return u[cnt == 1]


def coverage(v, f, center, half, axis_drop, res=64):
    """fraction of a square window (projected along axis_drop) covered by surface (rasterised triangle centroids+verts)."""
    ax = [a for a in range(3) if a != axis_drop]
    pts = np.concatenate([v, v[f].mean(1)])
    rel = pts[:, ax] - np.asarray(center)[ax]
    m = (np.abs(rel) < half).all(1)
    ij = np.clip(((rel[m] + half) / (2 * half) * res).astype(int), 0, res - 1)
    grid = np.zeros((res, res), bool); grid[ij[:, 0], ij[:, 1]] = True
    return float(grid.mean())


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--case-id", required=True)
    ap.add_argument("--session-id", default="s1")
    ap.add_argument("--input-kind", required=True,
                    choices=["truedepth_app_mesh", "truedepth_raw_frames", "public_scan_mesh",
                             "parametric_template_not_scan", "synthetic_depth_simulation",
                             "rgb_estimated_mesh", "livelinkface_metahuman_mesh", "photogrammetry_mesh"])
    ap.add_argument("--units", default="unknown", choices=["m", "cm", "mm", "unknown"])
    ap.add_argument("--unit-evidence", default=None, help="path/description of a reference-object unit check")
    ap.add_argument("--up", default="+Y"); ap.add_argument("--fwd", default="+Z")
    ap.add_argument("--device", default=None); ap.add_argument("--app", default=None)
    ap.add_argument("--sensor", default=None)
    ap.add_argument("--manual-landmarks", default=None, help="json {name:[x,y,z]} in SOURCE coordinates")
    ap.add_argument("--subdivide", type=int, default=-1, help="-1 auto (if nose has <600 vertices), 0/1")
    ap.add_argument("--crop", default="1.30,1.40,1.45", help="top,bottom,half-width in D units")
    ap.add_argument("--notes", default="")
    ap.add_argument("--scale-json", default=None, help="marker_scale.py result: if status ok, mesh is scaled to mm and units become verified")
    ap.add_argument("--auto-orient", action="store_true", help="estimate up/forward with multi-view MediaPipe (scans with arbitrary axes)")
    ap.add_argument("--smooth-iters", type=int, default=0, help="Taubin smoothing iterations on the EDITABLE layer only (raw/clean untouched; loss measured)")
    ap.add_argument("--editable-max-verts", type=int, default=25000, help="decimate the editable layer above this size (loss measured)")
    ap.add_argument("--source-take", default=None, help="Live Link Face take manifest (pipeline/llf_take.py) this mesh was derived from")
    ap.add_argument("--voxel-mm", type=float, default=0.0, help="point-cloud inputs only: voxel-average points before triangulation (needs declared units)")
    ap.add_argument("--license", default=None)
    ap.add_argument("--personal", action="store_true", help="real person's face: never embedded in demo builds or published")
    ap.add_argument("--texture", default=None, help="external base-colour image sampled via the mesh UVs (GLB/OBJ)")
    ap.add_argument("--texture-v-origin", default="top", choices=["top", "bottom"],
                    help="UV v origin of the external texture: top (glTF spec) or bottom (OBJ / flipY-authored maps)")
    ap.add_argument("--cases-dir", default=os.path.join(ROOT, "cases"))
    ap.add_argument("--replace", action="store_true", help="rebuild an existing case of the same id in place "
                    "(scan_to_model: its own derived case, e.g. after an interrupted run)")
    a = ap.parse_args(argv)

    case = os.path.join(a.cases_dir, a.case_id)
    if os.path.exists(case) and not a.replace:
        print(f"refusing to overwrite existing case {case}", file=sys.stderr)
        return 2
    for sub in ("raw", "processed", "avatar", "edits", "evaluation"):
        os.makedirs(os.path.join(case, sub), exist_ok=a.replace)
    status = {"case_id": a.case_id, "stage": "received", "history": [], "started": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    t0 = time.time()

    def stage(name, **kw):
        status["stage"] = name
        status["history"].append({"stage": name, "t_sec": round(time.time() - t0, 3), **kw})
        json.dump(status, open(os.path.join(case, "status.json"), "w"), indent=2, ensure_ascii=False)

    cur = "received"
    try:
        raw_name = os.path.basename(a.input)
        raw_path = os.path.join(case, "raw", raw_name)
        if a.replace and os.path.exists(raw_path):
            os.chmod(raw_path, 0o644); os.remove(raw_path)   # the raw copy is made read-only below; --replace rebuilds it
        shutil.copy2(a.input, raw_path)
        raw_hash = sha256(raw_path)
        os.chmod(raw_path, 0o444)
        stage("received", raw_sha256=raw_hash)

        cur = "input_validated"
        mesh_path = raw_path
        if raw_name.lower().endswith(".zip"):
            # photogrammetry export bundle (OBJ + MTL + texture pages): extract to processed/extracted, keep zip as raw
            import zipfile
            ex = os.path.join(case, "processed", "extracted")
            os.makedirs(ex)
            with zipfile.ZipFile(raw_path) as z:
                for n in z.namelist():
                    dest = os.path.abspath(os.path.join(ex, n))
                    if not dest.startswith(os.path.abspath(ex) + os.sep):
                        raise ValueError("unsafe path in zip: " + n)
                z.extractall(ex)
            cands = [os.path.join(r, n) for r, _, ns in os.walk(ex) for n in ns if n.lower().endswith((".obj", ".ply", ".glb"))]
            if not cands:
                raise ValueError("zip has no OBJ/PLY/GLB")
            mesh_path = max(cands, key=os.path.getsize)
        m = meshio.read_any(mesh_path)
        v, f, col = m["vertices"], m["faces"], m["colors"]
        if a.scale_json:
            sj = json.load(open(a.scale_json))
            if sj.get("status") == "ok":
                v = v * float(sj["mm_per_unit"])
                a.units = "mm"
                a.unit_evidence = (f"printed ArUco card: {sj['card'].get('marker_side_mm')} mm markers, {len(sj['estimates'])} estimates, "
                                   f"median abs dev {sj['median_abs_rel_dev']:.4f}, file {os.path.basename(a.scale_json)}")
                shutil.copy2(a.scale_json, os.path.join(case, "raw", "scale_evidence.json"))
                m["notes"].append(f"scaled by {sj['mm_per_unit']:.6g} mm/unit from printed markers")
            else:
                m["notes"].append("marker scale rejected (status " + str(sj.get("status")) + "): units left unknown")
        if col is None and a.texture and m.get("uv") is not None:
            from PIL import Image
            tex_copy = os.path.join(case, "raw", os.path.basename(a.texture))
            shutil.copy2(a.texture, tex_copy)
            im = np.asarray(Image.open(tex_copy).convert("RGB"), float) / 255.0
            h_, w_, _ = im.shape
            uv = m["uv"]
            vv_ = (1.0 - (uv[:, 1] % 1.0)) if a.texture_v_origin == "bottom" else (uv[:, 1] % 1.0)
            col = im[np.clip(vv_ * (h_ - 1), 0, h_ - 1).astype(int),
                     np.clip((uv[:, 0] % 1.0) * (w_ - 1), 0, w_ - 1).astype(int)]
            m["notes"].append(f"external texture sampled to vertex colours: {os.path.basename(a.texture)} (v origin {a.texture_v_origin})")
        surface_note = "input mesh faces used as-is"
        if len(f) == 0:
            # single-view depth frame exported as a point cloud (e.g. one TrueDepth frame): 2.5D triangulation in the
            # plane of the two major axes, long-edge triangles removed. Only valid for ONE viewpoint (no fusion).
            from scipy.spatial import Delaunay
            if a.voxel_mm > 0 and UNIT_TO_MM.get(a.units):
                vs = a.voxel_mm / UNIT_TO_MM[a.units]
                key = np.floor(v / vs).astype(np.int64)
                _, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
                inv = inv.reshape(-1)
                acc = np.zeros((len(cnt), 3)); np.add.at(acc, inv, v)
                if col is not None:
                    cacc = np.zeros((len(cnt), 3)); np.add.at(cacc, inv, col); col = cacc / cnt[:, None]
                v = acc / cnt[:, None]
                surface_voxel = f"voxel average {a.voxel_mm} mm ({len(v)} points)"
            else:
                surface_voxel = "no voxel averaging"
            c0 = v - v.mean(0)
            _, _, Vt = np.linalg.svd(c0[np.random.default_rng(0).choice(len(c0), min(len(c0), 20000), replace=False)], full_matrices=False)
            uv2 = c0 @ Vt[:2].T
            tri = Delaunay(uv2).simplices
            el = np.max(np.stack([np.linalg.norm(v[tri[:, a]] - v[tri[:, b]], axis=1) for a, b in ((0, 1), (1, 2), (2, 0))], 1), 1)
            f = tri[el < 3.0 * np.median(el)].astype(np.int64)
            fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
            if (fn @ canonical.axis_vec(a.fwd)).mean() < 0:  # orient toward the declared forward (camera) axis
                f = f[:, [0, 2, 1]]
            surface_note = surface_voxel + "; single-view point cloud -> 2.5D Delaunay (major-axis plane), long edges (>3x median) removed; no multi-frame fusion"
        bbox = (v.max(0) - v.min(0)).tolist()
        metric_scale_known = a.units != "unknown" and bool(a.unit_evidence)
        mm_per_unit = UNIT_TO_MM.get(a.units)
        plaus = None
        if mm_per_unit:
            ext_mm = max(bbox) * mm_per_unit
            plaus = {"max_extent_mm": ext_mm, "plausible_face_or_head": 80 <= ext_mm <= 450}
            if not plaus["plausible_face_or_head"]:
                raise ValueError(f"declared unit '{a.units}' gives extent {ext_mm:.1f} mm: implausible for a face scan")
        capture = {
            "case_id": a.case_id, "session_id": a.session_id, "device": a.device, "app_version": a.app,
            "sensor_source": a.sensor, "input_kind": a.input_kind, "raw_file": "raw/" + raw_name, "mesh_file": os.path.relpath(mesh_path, case),
            "raw_sha256": raw_hash, "source_format": m["source_format"], "reader_notes": m["notes"],
            "declared_units": a.units, "unit_evidence": a.unit_evidence, "metric_scale_known": metric_scale_known,
            "unit_plausibility": plaus, "orientation_hint": {"up": a.up, "forward": a.fwd},
            "vertex_count": int(len(v)), "face_count": int(len(f)), "bbox_source_units": bbox,
            "source_take_manifest": a.source_take, "color_presence": col is not None, "license": a.license, "notes": a.notes, "surface_source": surface_note,
            "consent_retention_note": "local files only; no external upload by this pipeline",
            # personal: explicit flag, TrueDepth captures, or anything produced from the scan work area (tools/scan.mjs)
            "personal_data": bool(a.personal or a.input_kind.startswith("truedepth")
                                  or os.sep + "work" + os.sep in os.path.abspath(a.input) or "/work/" in a.input.replace("\\", "/")),
            "is_depth_backed": a.input_kind in ("truedepth_app_mesh", "truedepth_raw_frames", "livelinkface_metahuman_mesh", "photogrammetry_mesh"),
            "template_fitted": a.input_kind in ("livelinkface_metahuman_mesh", "parametric_template_not_scan"),
            "capture_mode": {"truedepth_app_mesh": "precise", "truedepth_raw_frames": "precise", "livelinkface_metahuman_mesh": "precise_metahuman",
                             "rgb_estimated_mesh": "general_rgb", "photogrammetry_mesh": "precise_photogrammetry"}.get(a.input_kind, "test_data"),
        }
        json.dump(capture, open(os.path.join(case, "capture.json"), "w"), indent=2, ensure_ascii=False)
        if capture["personal_data"]:
            # keep a real person's scan out of git (the whole case folder is ignored from inside)
            open(os.path.join(case, ".gitignore"), "w").write("# personal data - never commit\n*\n")
        stage("input_validated")

        cur = "cropped"
        manual = json.load(open(a.manual_landmarks)) if a.manual_landmarks else None
        up_hint, fwd_hint, orient_src = a.up, a.fwd, f"declared hint up={a.up} fwd={a.fwd}"
        if a.auto_orient or a.input_kind == "photogrammetry_mesh":
            # photogrammetry Poisson meshes carry far blobs (background, extrapolated surface) that shrink the face in
            # the orientation renders and can become the 'most anterior point': keep the dense core (within 2x the
            # 90th-percentile distance from the median)
            med = np.median(v, 0); dd = np.linalg.norm(v - med, axis=1); r90 = float(np.quantile(dd, 0.9))
            keepv = dd < 2.0 * r90
            if keepv.sum() < len(v):
                fk = f[keepv[f].all(1)]
                used = np.unique(fk); remap = -np.ones(len(v), int); remap[used] = np.arange(len(used))
                v, f = v[used], remap[fk]
                col = col[used] if col is not None else None
                status.setdefault("notes", []).append(f"trimmed {int((~keepv).sum())} far vertices (r90={r90:.4g})")
        if a.auto_orient:
            import auto_orient
            up_hint, fwd_hint, _, alog = auto_orient.auto_orient(v, f, col)
            orient_src = alog[-2] + " | " + alog[-1] if len(alog) > 1 else alog[-1]
        pc, T, lm, D, log, manual_keys = canonical.canonicalize(v, f, up_hint, fwd_hint, manual=manual, col=col)
        log.insert(0, "orientation: " + orient_src)
        top, bot, hw = [float(x) for x in a.crop.split(",")]
        y_top = lm["nasion"][1] + top * D
        y_bot = lm["subnasale"][1] - bot * D
        yc, by = 0.5 * (y_top + y_bot), 0.5 * (y_top - y_bot)
        ell = (pc[:, 0] / (hw * D)) ** 2 + ((pc[:, 1] - yc) / by) ** 2 <= 1.0
        # remove back-facing / far-behind parts (ears, sides, interior of mouth far behind the face)
        nrm = welded_normals(pc, f, weld_groups(pc, 1e-6 * max(bbox)))
        depth_ok = pc[:, 2] > -1.6 * D
        keep = ell & depth_ok
        hair_removed = 0
        if col is not None:
            hsv_v = col.max(1); sat = (col.max(1) - col.min(1)) / np.maximum(col.max(1), 1e-6)
            hairish = (pc[:, 1] > lm["nasion"][1] + 0.35 * D) & (hsv_v < 0.22)
            hair_removed = int((keep & hairish).sum())
            keep &= ~hairish
        (vc, fc, cc), used = submesh(pc, f, keep, [col])
        comp = largest_component(fc, len(vc))
        (vc, fc, cc), _ = submesh(vc, fc, comp, [cc])
        clean_path = os.path.join(case, "processed", "face_clean.ply")
        meshio.write_ply(clean_path, vc, fc, cc)
        crop_meta = {"definition": "ellipse in canonical XY: top=nasion+%.2fD, bottom=subnasale-%.2fD, half-width=%.2fD; z>-1.6D; largest component" % (top, bot, hw),
                     "hair_rule": "vertex colour value<0.22 above nasion+0.35D (only if colours exist)",
                     "hair_vertices_removed": hair_removed, "vertices": int(len(vc)), "faces": int(len(fc)),
                     "smoothing_applied": False}
        stage("cropped", **{k: crop_meta[k] for k in ("vertices", "faces")})

        cur = "editable_ready"
        nose_box = (np.abs(vc[:, 0]) < 0.6 * D) & (vc[:, 1] > lm["subnasale"][1] - 0.15 * D) & (vc[:, 1] < lm["nasion"][1])
        n_nose = int(nose_box.sum())
        sub = a.subdivide if a.subdivide >= 0 else int(n_nose < 600)
        decimated = False
        if len(vc) > a.editable_max_verts:
            # large photogrammetry meshes: uniform vertex clustering for the editable layer (loss reported by evaluate.py)
            import auto_orient
            if a.smooth_iters > 0:  # denoise the dense surface BEFORE clustering -> far fewer folded clusters
                vc = taubin_smooth(vc, fc, a.smooth_iters, groups=weld_groups(vc, 1e-7 * max(bbox)))
            vc, fc, cc = auto_orient.cluster_decimate(vc, fc, cc, target_faces=2 * a.editable_max_verts)
            # clean clustering artefacts: duplicate faces, slivers (<1% median area), faces whose normal opposes
            # the local average (folded flaps) -> these showed as dark specks and caused false validity failures
            fc = fc[np.sort(np.unique(np.sort(fc, axis=1), axis=0, return_index=True)[1])]
            fn_ = np.cross(vc[fc[:, 1]] - vc[fc[:, 0]], vc[fc[:, 2]] - vc[fc[:, 0]])
            ar_ = np.linalg.norm(fn_, axis=1)
            ok_ = ar_ > 0.01 * np.median(ar_)
            vn_ = np.zeros_like(vc)
            for k_ in range(3):
                np.add.at(vn_, fc[:, k_], fn_)
            avg_ = vn_[fc].sum(1)
            ok_ &= (np.einsum("ij,ij->i", fn_, avg_) > -0.5 * ar_ * np.linalg.norm(avg_, axis=1))  # only clearly folded flaps
            removed_faces = int((~ok_).sum())
            fc = fc[ok_]
            comp_ = largest_component(fc, len(vc))
            fc = fc[comp_[fc].all(1)]
            keepv = np.zeros(len(vc), bool); keepv[fc.reshape(-1)] = True
            (vc, fc, cc), _ = submesh(vc, fc, keepv, [cc])
            decimated, sub = True, 0
            log.append(f"decimation cleanup removed {removed_faces} sliver/folded faces")
            nv0 = len(vc)
            vc, fc, nfill, nnew = fill_small_holes(vc, fc)
            if cc is not None and len(vc) > nv0:  # fan-centre colour = mean of its ring
                cc = np.concatenate([cc, np.zeros((len(vc) - nv0, cc.shape[1]))])
                ff = fc[len(fc) - nnew:]
                acc_ = np.zeros_like(cc); cnt_ = np.zeros(len(vc))
                np.add.at(acc_, ff[:, 2], cc[ff[:, 0]]); np.add.at(cnt_, ff[:, 2], 1)
                ci_ = np.arange(nv0, len(vc))
                cc[ci_] = acc_[ci_] / np.maximum(cnt_[ci_], 1)[:, None]
            log.append(f"hole filling closed {nfill} small loops ({nnew} faces)")
        ve, fe, ce = (midpoint_subdivide(vc, fc, cc) if sub else (vc, fc, cc))
        groups = weld_groups(ve, 1e-7 * max(bbox))
        if a.smooth_iters > 0:
            ve = taubin_smooth(ve, fe, 5 if decimated else a.smooth_iters, groups=groups)
        ne = welded_normals(ve, fe, groups)
        # control points: nearest editable vertex to each landmark (vertex ids are topology-version bound)
        from canonical import nn_query
        names = list(lm.keys())
        dists, ids = nn_query(ve, np.array([lm[k] for k in names]))
        controls = {k: {"vertex": int(i), "landmark_canonical": np.round(lm[k], 9).tolist(), "snap_distance_D": float(d / D)}
                    for k, i, d in zip(names, ids, dists)}
        # observation checks around the nose (CAP-03)
        be = boundary_edges(fe)
        bpts = ve[be].mean(1)
        crop_edge = ((bpts[:, 0] / (hw * D)) ** 2 + ((bpts[:, 1] - yc) / by) ** 2) > 0.85
        near_nose = (np.abs(bpts[:, 0]) < 0.8 * D) & (bpts[:, 1] > lm["subnasale"][1] - 0.3 * D) & (bpts[:, 1] < lm["nasion"][1] + 0.1 * D)
        obs = {
            "nose_vertices_before_subdivision": n_nose,
            "open_boundary_edges_near_nose_not_crop": int((near_nose & ~crop_edge).sum()),
            "front_coverage_nose_window": coverage(ve, fe, [0, -0.25 * D, 0], 0.55 * D, 2),
            "bottom_coverage_nose_window": coverage(ve, fe, [0, lm["subnasale"][1], -0.3 * D], 0.45 * D, 1),
            "note": "coverage = fraction of a window with any surface sample; holes/cavities in nostrils are not distinguished from observed concavities automatically",
        }
        units_block = {
            "source_units": a.units, "metric_scale_known": metric_scale_known,
            "scale_is_synthetic": bool(a.unit_evidence and a.unit_evidence.upper().startswith("SYNTHETIC")),
            "mm_per_unit": mm_per_unit if metric_scale_known else None,
            "relative_unit": "D = nasion-subnasale vertical distance of THIS case (geometric definition, canonical.py)",
            "D_source_units": D,
            "D_mm_if_declared_units": (D * mm_per_unit) if mm_per_unit else None,
        }
        model = {
            "schema": "live-mirror-editable-v1", "case_id": a.case_id, "session_id": a.session_id,
            "input_kind": a.input_kind, "is_depth_backed": capture["is_depth_backed"],
            "raw_sha256": raw_hash, "topology_version": TOPOLOGY_VERSION + (":sub1" if sub else ":sub0"),
            "rig_version": RIG_VERSION, "units": units_block,
            "frame": {"transform_source_to_canonical": T.tolist(),
                      "axes": "+X viewer-right in front view (= subject LEFT), +Y up (scan up hint), +Z forward; origin = pronasale",
                      "mirroring": "none (det=+1)", "pitch_source": "scan up hint (" + a.up + ")"},
            "landmarks": {k: np.round(val, 9).tolist() for k, val in lm.items()},
            "landmark_source": {k: ("manual" if k in manual_keys else "auto") for k in lm},
            "controls": controls, "D": D,
            "counts": {"vertices": int(len(ve)), "faces": int(len(fe))},
            "has_colors": ce is not None, "observation": obs, "crop": crop_meta,
            "canonicalize_log": log,
        }
        pos = ve.astype("<f4"); nor = ne.astype("<f4"); idx = fe.astype("<u4")
        colb = (ce if ce is not None else np.tile([0.78, 0.78, 0.8], (len(ve), 1))).astype("<f4")
        grp = groups.astype("<u4")
        blobs = [("position", pos), ("normal", nor), ("color", colb), ("index", idx), ("weld_group", grp)]
        off, layout, chunks = 0, {}, []
        for name, arr in blobs:
            b = arr.tobytes()
            layout[name] = {"byteOffset": off, "byteLength": len(b), "dtype": str(arr.dtype), "shape": list(arr.shape)}
            chunks.append(b); off += len(b)
        model["buffers"] = {"uri": "editable.bin", "layout": layout}
        with open(os.path.join(case, "avatar", "editable.bin"), "wb") as fh:
            fh.write(b"".join(chunks))
        model_hash = hashlib.sha256(b"".join(chunks)).hexdigest()
        model["editable_sha256"] = model_hash
        json.dump(model, open(os.path.join(case, "avatar", "editable.json"), "w"), indent=1, ensure_ascii=False)
        meshio.write_glb(os.path.join(case, "avatar", "editable.glb"), ve, fe, ce)
        stage("editable_ready", editable_sha256=model_hash, subdivided=bool(sub), decimated=decimated, taubin_iters=a.smooth_iters)

        cur = "texture_ready"
        stage("texture_ready", color_source=("vertex colours from input" if ce is not None else "none (gray only)"))

        # evidence renders (gray + colour + landmarks)
        cur = "editing_ready"
        ctr = np.array([0, -0.2 * D, -0.6 * D])
        ims, labels = [], []
        lmcol = np.tile([0.80, 0.80, 0.82], (len(ve), 1))
        for k, c in controls.items():
            lmcol[np.linalg.norm(ve - ve[c["vertex"]], axis=1) < 0.035 * D] = [0.85, 0.15, 0.25]
        ve_r, fe_r, ce_r, lm_r = ve, fe, ce, lmcol
        if len(fe) > 40000:  # evidence images only: render a decimated copy for speed
            import auto_orient
            both = np.concatenate([ce if ce is not None else np.zeros((len(ve), 3)), lmcol], 1)
            ve_r, fe_r, both_r = auto_orient.cluster_decimate(ve, fe, both, target_faces=40000)
            ce_r = both_r[:, :3] if ce is not None else None
            lm_r = both_r[:, 3:]
        for vw in ("front", "oblique_r", "side_r", "bottom"):
            ims.append(render.render(ve_r, fe_r, vw, 360, center=ctr, extent=1.25 * D)); labels.append("gray " + vw)
        for vw in ("front", "side_l"):
            ims.append(render.render(ve_r, fe_r, vw, 360, colors=lm_r, center=ctr, extent=1.25 * D)); labels.append("controls " + vw)
        if ce is not None:
            for vw in ("front", "oblique_l"):
                ims.append(render.render(ve_r, fe_r, vw, 360, colors=ce_r, center=ctr, extent=1.25 * D)); labels.append("colour " + vw)
        render.save_png(os.path.join(case, "evaluation", "face_views.png"), render.contact_sheet(ims, labels, 4))
        avatar = {
            "raw_file_reference": capture["raw_file"], "raw_sha256": raw_hash,
            "transform_to_canonical": T.tolist(), "source_units": a.units,
            "unit_verification_evidence": a.unit_evidence, "metric_scale_known": metric_scale_known,
            "observed_vs_supplemented": "all editable vertices come from the input surface (crop + linear subdivision); nothing supplemented",
            "geometry_versions": {"original": "raw/" + raw_name, "clean": "processed/face_clean.ply", "editable": "avatar/editable.json"},
            "mesh_error_metrics": {"clean_vs_raw": "crop only (no smoothing): retained vertices identical up to rigid canonical transform",
                                    "editable_vs_clean": ("uniform vertex-clustering decimation" if decimated else "linear midpoint subdivision" if sub else "identical to clean") + (f" + Taubin smoothing x{a.smooth_iters} (boundary fixed)" if a.smooth_iters else "") + " — loss measured by evaluate.py loss"},
            "color_source": "input vertex colours" if ce is not None else None,
            "accuracy_status": "not_validated", "identity_verified": False,
            "processing_time_sec": round(time.time() - t0, 3),
            "manual_intervention": {"manual_landmarks": manual_keys, "seconds": None},
        }
        json.dump(avatar, open(os.path.join(case, "avatar.json"), "w"), indent=2, ensure_ascii=False)
        stage("editing_ready", processing_time_sec=avatar["processing_time_sec"])
        print(json.dumps({"case": case, "D": D, "vertices": len(ve), "observation": obs}, indent=1))
        return 0
    except Exception as e:
        status["error"] = repr(e)
        status["traceback"] = traceback.format_exc()
        stage("failed_at_" + cur)
        print(traceback.format_exc(), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
