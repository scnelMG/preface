"""W8b S1 (2026-10-20): build the DETAIL layer topology `assets/gnm-detail-v1.npz` from the GNM-v2 template by deterministic
local MIDPOINT subdivision of the skin, per region level (assets/detail_levels.json), and check it.

Design (WORKPLAN W8b):
  - base vertices 0..N-1 keep their indices (landmark map, vertex groups, edit shapes, rig blocks, _TEMPLATE_INDEX stay valid)
  - new vertices are appended, ordered by (level, parent edge (min, max)) -> deterministic; each has a PARENT MAP
    (parent_idx (3,), parent_w (3,)): edge midpoints (i, j, -) with (0.5, 0.5, 0); every per-vertex quantity of the detail
    layer (positions, UV, materials, groups, taper weights ...) is interpolated through it, nothing is stored twice
  - midpoint split only, no smoothing: upsample(V_base) puts every new vertex ON the base surface, so a detail mesh with zero
    displacement IS the base surface (baseline comparisons hold); the rule "face split 1->4 when all 3 vertices have level >= L,
    1->2 / 1->3 transitions for the neighbours" is applied level by level
  - UV: the template has 614 seam vertices (18,437 UV vertices for 17,821 positions), so UV is tracked per face corner:
    a split edge creates one position midpoint (keyed by the position pair) and one UV midpoint PER UV PAIR, which keeps seams
  - only skin faces (material 0) are split; eyes / mouth interior keep their faces and indices
checks (--check, run after building): manifold (edge used by <= 2 faces, skin boundary edge count unchanged), no T-junction
  (no split edge survives as a face edge), no flipped face vs its parent face, no UV flips, base indices preserved, new
  vertices on their parent segment (distance 0), per-region median edge length before / after, counts.
usage: python tools/make_detail_topology.py [--levels assets/detail_levels.json] [--out assets/gnm-detail-v1.npz] [--check]
       [--wire work/<id>/model/fit_gnm.ply --wire-out work/<id>/model/detail_wire_gray.png]   (eye / nose wireframe for 만두)
"""
import argparse, json, os, sys, time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "pipeline"))


def vertex_levels(levels_json, n, o2g, G):
    """per base vertex: subdivision level (max over its regions) and region name (highest priority)"""
    lv = np.zeros(n, np.int64); reg = np.full(n, "", dtype=object); thr = levels_json.get("group_weight_threshold", 0.3)
    for name in reversed(levels_json["priority"]):                # lower priority first, higher priority overwrites the label
        r = levels_json["regions"][name]
        m = np.zeros(n, bool)
        for gname in r["groups"]: m |= (G.groups[G.group_names.index(gname)] > thr)[o2g]
        lv[m] = np.maximum(lv[m], r["level"]); reg[m] = name
    return lv, reg


def subdivide(V, F, UT, UV, mat, comp, lv, reg, max_level):
    """adaptive midpoint subdivision of the skin faces. Returns new V, F, UT, UV, mat, comp, parent_idx, parent_w, level, region"""
    V = V.copy(); UV = UV.copy(); F = F.copy(); UT = UT.copy()
    n0 = len(V)
    parent_idx = np.c_[np.arange(n0), np.arange(n0), np.arange(n0)]; parent_w = np.tile([1.0, 0.0, 0.0], (n0, 1))
    level = np.zeros(n0, np.int64); region = np.array(list(reg), dtype=object); vlev = lv.copy()
    mat = list(mat); comp = list(comp); face_parent = np.arange(len(F))          # base face each detail face lies in
    for L in range(1, max_level + 1):
        skin = np.array([all(mat[v] == 0 for v in f) for f in F])
        full = skin & (vlev[F] >= L).all(1)
        # edges to split = edges of fully split faces (position pairs), deterministic order
        ekeys = set()
        for f in F[full]:
            for a, b in ((f[0], f[1]), (f[1], f[2]), (f[2], f[0])): ekeys.add((min(a, b), max(a, b)))
        ekeys = sorted(ekeys)
        mid = {}; newV = []; newP = []; newW = []; newL = []; newR = []
        for (a, b) in ekeys:
            mid[(a, b)] = len(V) + len(newV); newV.append(0.5 * (V[a] + V[b])); newP.append([a, b, a]); newW.append([0.5, 0.5, 0.0])
            newL.append(L); newR.append(region[a] if region[a] == region[b] else (region[a] or region[b]))
            mat.append(0); comp.append(comp[a])
        vlev = np.r_[vlev, [min(vlev[a], vlev[b]) for (a, b) in ekeys]]
        V = np.vstack([V, np.array(newV)]) if newV else V
        parent_idx = np.vstack([parent_idx, np.array(newP, np.int64)]) if newP else parent_idx
        parent_w = np.vstack([parent_w, np.array(newW)]) if newW else parent_w
        level = np.r_[level, newL]; region = np.r_[region, np.array(newR, dtype=object)]
        # UV midpoints per UV pair (seams keep separate UV vertices)
        umid = {}
        def uvmid(ua, ub):
            k = (min(ua, ub), max(ua, ub))
            if k not in umid:
                umid[k] = len(UV) + len(umid)
            return umid[k]
        newF = []; newUT = []; parent_face = []
        for fi, (f, u) in enumerate(zip(F, UT)):
            a, b, c = f; ua, ub, uc = u
            e = [(min(a, b), max(a, b)), (min(b, c), max(b, c)), (min(c, a), max(c, a))]
            s = [k in mid for k in e]
            if not any(s):
                newF.append([a, b, c]); newUT.append([ua, ub, uc]); parent_face.append(fi); continue
            if all(s):   # 1 -> 4
                mab, mbc, mca = mid[e[0]], mid[e[1]], mid[e[2]]; uab, ubc, uca = uvmid(ua, ub), uvmid(ub, uc), uvmid(uc, ua)
                for tri, tuv in (([a, mab, mca], [ua, uab, uca]), ([mab, b, mbc], [uab, ub, ubc]), ([mca, mbc, c], [uca, ubc, uc]), ([mab, mbc, mca], [uab, ubc, uca])):
                    newF.append(tri); newUT.append(tuv); parent_face.append(fi)
                continue
            # rotate so that the configuration is canonical: vertices (p, q, r) with uv (up, uq, ur)
            verts = [a, b, c]; uvs = [ua, ub, uc]
            if sum(s) == 1:   # split edge = (p, q): 1 -> 2
                k = s.index(True); p, q, r = verts[k], verts[(k + 1) % 3], verts[(k + 2) % 3]; up_, uq, ur = uvs[k], uvs[(k + 1) % 3], uvs[(k + 2) % 3]
                m = mid[e[k]]; um = uvmid(up_, uq)
                newF += [[p, m, r], [m, q, r]]; newUT += [[up_, um, ur], [um, uq, ur]]; parent_face += [fi, fi]
            else:             # two split edges: unsplit edge index k -> (p, q) unsplit, r opposite: 1 -> 3
                k = s.index(False); p, q, r = verts[k], verts[(k + 1) % 3], verts[(k + 2) % 3]; up_, uq, ur = uvs[k], uvs[(k + 1) % 3], uvs[(k + 2) % 3]
                mqr, mrp = mid[e[(k + 1) % 3]], mid[e[(k + 2) % 3]]; uqr, urp = uvmid(uq, ur), uvmid(ur, up_)
                # the diagonal goes from the midpoint of (q, r) to p (deterministic: p = the first vertex of the unsplit edge)
                newF += [[p, q, mqr], [p, mqr, mrp], [mrp, mqr, r]]; newUT += [[up_, uq, uqr], [up_, uqr, urp], [urp, uqr, ur]]; parent_face += [fi, fi, fi]
        if umid:
            UVn = np.zeros((len(umid), 2))
            for (ua, ub), idx in umid.items(): UVn[idx - len(UV)] = 0.5 * (UV[ua] + UV[ub])
            UV = np.vstack([UV, UVn])
        F = np.array(newF, np.int64); UT = np.array(newUT, np.int64); face_parent = face_parent[np.array(parent_face)]
    return V, F, UT, UV, np.array(mat, np.uint8), np.array(comp), parent_idx, parent_w, level, region, face_parent


def region_edge_stats(V, F, mask):
    E = np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]); sel = mask[E[:, 0]] & mask[E[:, 1]]
    return float(np.median(np.linalg.norm(V[E[sel, 0]] - V[E[sel, 1]], axis=1))) if sel.any() else float("nan")


def check(base, det, ew):
    """self checks -> dict (all numbers), 'pass' at the end"""
    V0, F0, mat0 = base[:3]; V, F, UT, UV, mat, comp, pidx, pw, level, region, face_parent = det
    rep = {"base_vertices": int(len(V0)), "detail_vertices": int(len(V)), "base_faces": int(len(F0)), "detail_faces": int(len(F)),
           "new_vertices": int(len(V) - len(V0)), "uv_vertices": int(len(UV))}
    n0 = len(V0)
    # base indices preserved (positions identical, first n0)
    rep["base_positions_identical"] = bool(np.allclose(V[:n0], V0))
    # manifold: every edge in <= 2 faces; skin boundary edges unchanged
    def edges(Fx, m):
        sf = Fx[(m[Fx] == 0).all(1)]; E = np.sort(np.vstack([sf[:, [0, 1]], sf[:, [1, 2]], sf[:, [2, 0]]]), 1)
        u, c = np.unique(E, axis=0, return_counts=True); return u, c
    u0, c0 = edges(F0, mat0); u1, c1 = edges(F, mat)
    rep["non_manifold_edges"] = int((c1 > 2).sum()); rep["skin_boundary_edges_base"] = int((c0 == 1).sum()); rep["skin_boundary_edges_detail"] = int((c1 == 1).sum())
    # T-junctions: a split edge (parent pair of a midpoint vertex) must not survive as an edge
    split_pairs = {(int(min(a, b)), int(max(a, b))) for (a, b, _), w in zip(pidx[n0:], pw[n0:]) if w[1] > 0}
    surviving = set(map(tuple, u1.tolist())) & split_pairs; rep["t_junctions"] = int(len(surviving))
    # every new vertex exactly on its parent segment
    P = (V[pidx] * pw[:, :, None]).sum(1); rep["max_parent_interp_error"] = float(np.abs(P - V).max())
    # flipped faces vs base: each detail face vs the normal of the base face it lies in (face_parent, exact)
    from scipy.spatial import cKDTree
    n_0 = np.cross(V0[F0[:, 1]] - V0[F0[:, 0]], V0[F0[:, 2]] - V0[F0[:, 0]])
    n_1 = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    rep["flipped_faces_vs_base"] = int(((n_0[face_parent] * n_1).sum(1) < 0).sum())
    # every detail face lies in its parent base face plane (midpoints only): max distance of face centroids to the parent plane
    nn = n_0 / (np.linalg.norm(n_0, axis=1, keepdims=True) + 1e-18); rep["max_centroid_offplane"] = float(np.abs(((V[F].mean(1) - V0[F0[face_parent, 0]]) * nn[face_parent]).sum(1)).max())
    # UV flips: orientation of the uv triangle preserved vs base uv triangles (same nearest-centroid pairing in uv space)
    uv0 = base[3]; UT0 = base[4]
    def uvarea(UVx, UTx): a = UVx[UTx[:, 0]]; b = UVx[UTx[:, 1]]; c = UVx[UTx[:, 2]]; return (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])
    s0 = np.sign(uvarea(uv0, UT0)); s1 = uvarea(UV, UT); cu0 = uv0[UT0].mean(1); cu1 = UV[UT].mean(1)
    ju = cKDTree(cu0).query(cu1)[1]; rep["uv_flipped_faces"] = int(((s0[ju] * np.sign(s1)) < 0).sum()); rep["uv_degenerate_faces"] = int((np.abs(s1) < 1e-12).sum())
    # degenerate faces (zero area) in position space
    rep["degenerate_faces"] = int((np.linalg.norm(n_1, axis=1) < 1e-12).sum())
    # per-region edge length before / after (x eye width)
    rep["edge_x_eye_width"] = {}
    for name in sorted(set(r for r in region if r)):
        m0 = np.array([r == name for r in region[:n0]]); m1 = np.array([r == name for r in region])
        rep["edge_x_eye_width"][name] = {"base": round(region_edge_stats(V0, F0, m0) / ew, 4), "detail": round(region_edge_stats(V, F, m1) / ew, 4),
                                        "base_vertices": int(m0.sum()), "detail_vertices": int(m1.sum())}
    rep["level_counts"] = {int(k): int(v) for k, v in zip(*np.unique(level, return_counts=True))}
    rep["pass"] = bool(rep["base_positions_identical"] and rep["non_manifold_edges"] == 0 and rep["skin_boundary_edges_detail"] == rep["skin_boundary_edges_base"]
                       and rep["t_junctions"] == 0 and rep["max_parent_interp_error"] < 1e-9 and rep["flipped_faces_vs_base"] == 0
                       and rep["uv_flipped_faces"] == 0 and rep["degenerate_faces"] == 0 and rep["uv_degenerate_faces"] == 0)
    return rep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--levels", default=os.path.join(ROOT, "assets", "detail_levels.json")); ap.add_argument("--out", default=os.path.join(ROOT, "assets", "gnm-detail-v1.npz"))
    ap.add_argument("--check", action="store_true"); ap.add_argument("--wire", help="fitted base ply to render eye / nose wireframes from (for 만두)")
    ap.add_argument("--wire-out")
    a = ap.parse_args(); t0 = time.time()
    from gnm_model import GNM, template_map
    t = np.load(os.path.join(ROOT, "assets", "gnm-template-v2.npz"))
    V0 = np.asarray(t["vertices"], np.float64); F0 = t["triangles"].astype(np.int64); UV0 = np.asarray(t["vertex_uvs"], np.float64); UT0 = t["uv_triangles"].astype(np.int64)
    mat0 = t["materials"]; comp0 = t["components"]
    lj = json.load(open(a.levels, encoding="utf-8")); G = GNM(); o2g = template_map()[0]
    lv, reg = vertex_levels(lj, len(V0), o2g, G)
    det = subdivide(V0, F0, UT0, UV0, mat0, comp0, lv, reg, int(max(r["level"] for r in lj["regions"].values())))
    V, F, UT, UV, mat, comp, pidx, pw, level, region, face_parent = det
    lid = np.array(json.load(open(os.path.join(ROOT, "assets", "gnm_mp468.json")))["vertex"], np.int64)
    ew = float(np.linalg.norm(V0[lid[33]] - V0[lid[133]]))
    np.savez_compressed(a.out, vertices=V.astype(np.float32), triangles=F.astype(np.int32), vertex_uvs=UV.astype(np.float32), uv_triangles=UT.astype(np.int32),
                        materials=mat.astype(np.uint8), components=np.asarray(comp), parent_idx=pidx.astype(np.int32), parent_w=pw.astype(np.float32),
                        level=level.astype(np.int8), region=np.array([r or "" for r in region]), base_count=np.int64(len(V0)), face_parent=face_parent.astype(np.int32),
                        levels_json=json.dumps(lj), version="gnm-detail-v1")
    rep = {"out": a.out, "build_sec": round(time.time() - t0, 2), "vertices": int(len(V)), "faces": int(len(F)), "uv_vertices": int(len(UV))}
    if a.check:
        t1 = time.time(); rep["check"] = check((V0, F0, mat0, UV0, UT0), det, ew); rep["check_sec"] = round(time.time() - t1, 2)
    if a.wire and a.wire_out:
        import meshio
        from render import render, save_png, contact_sheet
        from eye_parts import EyeBasis, eye_view
        from detail_mesh import DetailMesh
        fit = meshio.read_any(a.wire); Vb = np.asarray(fit["vertices"], np.float64)
        lidf = np.array(json.load(open(a.wire.replace(".ply", ".fit.json")))["landmark_vertex_ids"])
        D = DetailMesh(a.out); Vd = D.upsample(Vb)
        B = EyeBasis(Vb, F0, mat0, comp0, lidf); ewf = B.eyes["R"]["ew"]
        imgs = []; labels = []
        for name, Vx, Fx, matx in (("base", Vb, F0, mat0), ("detail", Vd, F, mat)):
            skinF = Fx[(matx[Fx] == 0).all(1)]
            for cen, ext, lab in ((B.eyes["R"]["a"] * 0.5 + B.eyes["L"]["a"] * 0.5, 2.2 * ewf, "eyes"), (Vb[lidf[1]], 1.6 * ewf, "nose")):
                for yaw in (0, 35):
                    R = eye_view(B, yaw, 0); img = render(Vx, skinF, view=R, size=480, center=cen, extent=ext)
                    imgs.append(wire_overlay(img, Vx, skinF, R, cen, ext, 480)); labels.append(f"{name} {lab} yaw {yaw}")
        save_png(a.wire_out, contact_sheet(imgs, labels, cols=4)); rep["wire"] = a.wire_out
    print(json.dumps(rep, ensure_ascii=False))


def wire_overlay(img, V, F, R, center, extent, size):
    """draw front-facing edges of F on the gray render (same orthographic mapping as render.render)"""
    import cv2
    pc = (V - center) @ R.T; s = size / (2 * extent); sx = pc[:, 0] * s + size / 2; sy = size / 2 - pc[:, 1] * s
    fn = np.cross(pc[F[:, 1]] - pc[F[:, 0]], pc[F[:, 2]] - pc[F[:, 0]]); front = fn[:, 2] > 0
    Ff = F[front]; E = np.unique(np.sort(np.vstack([Ff[:, [0, 1]], Ff[:, [1, 2]], Ff[:, [2, 0]]]), 1), axis=0)
    out = np.ascontiguousarray(img.copy())
    inside = (sx > -size) & (sx < 2 * size) & (sy > -size) & (sy < 2 * size)
    for a_, b_ in E:
        if inside[a_] and inside[b_]:
            cv2.line(out, (int(round(sx[a_])), int(round(sy[a_]))), (int(round(sx[b_])), int(round(sy[b_]))), (60, 60, 200), 1, cv2.LINE_AA)
    return out


if __name__ == "__main__":
    main()
