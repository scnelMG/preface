"""Edit / expression data of the adopted model in head.glb coordinates, for the glb viewer (W13 step 2-3, 2026-10-20).

usage: python tools/glb_rig.py work/<id> [--sparse <model>] [--out <file>]   ->  work/<id>/model/rig.json

The same blocks the 360° viewer gets from tools/viewer_data.py (the SAME functions, tools/rig_blocks.py), keyed by TEMPLATE vertex
index (= the glb's _TEMPLATE_INDEX attribute) and moved into the glb frame with the export's similarity world_to_glb
(X_glb = s Rh (X - c)): points with the full transform, directions with Rh, displacements and lengths with s Rh / s.
  rig    eye edit shapes + ARKit-named expression shapes (pipeline/face_rig.py), eye centres
  gnmx   GNM expression components + the landmark -> weight solve P (w = P . landmark displacement, re-expressed for
         displacements in the glb frame: P_i' = Rh P_i / s per landmark)
  expr   landmark ids, neutral landmark positions, jaw weights / hinge / axis, mouth centre / width
  nose   the case's editable layer (nose engine input, its own canonical frame) + per template vertex the nearest
         editable vertex and weight, and M = s Rh Rc^T: canonical displacement -> glb displacement
No photos, no textures. PERSONAL DATA all the same (the person's face shape): local only, like work/.
"""
import argparse, base64, json, os, subprocess, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "pipeline")); sys.path.insert(0, HERE)

FORMAT = {"format": "live-mirror-rig", "version": 1}


def b64(a, dt): return base64.b64encode(np.ascontiguousarray(a, dtype=dt).tobytes()).decode()
def unb64(s, dt): return np.frombuffer(base64.b64decode(s), dtype=dt)


def main():
    import meshio
    import rig_blocks as VD            # the blocks the 360° viewer uses too (same numbers, only the frame changes)
    import face_rig
    from glb_frames import glb_extras
    ap = argparse.ArgumentParser(); ap.add_argument("work"); ap.add_argument("--sparse", help="default: lens_anchor.json 'sparse'")
    ap.add_argument("--case", help="editable case (default: report.json 'case')"); ap.add_argument("--no-gnm-expr", action="store_true")
    ap.add_argument("--out")
    a = ap.parse_args()
    W = os.path.abspath(a.work); M = os.path.join(W, "model")
    sparse = os.path.abspath(a.sparse or json.load(open(os.path.join(W, "lens_anchor.json")))["sparse"])
    ex = glb_extras(os.path.join(M, "head.glb"))
    T = np.asarray(ex["world_to_glb"], np.float64); A_, b_ = T[:3, :3], T[:3, 3]; s = float(np.linalg.norm(A_[0])); Rh = A_ / s
    pt = lambda p: (np.asarray(p, np.float64) @ A_.T + b_)            # point  world -> glb
    dr = lambda v: np.asarray(v, np.float64) @ Rh.T                  # direction
    dp = lambda v: np.asarray(v, np.float64) @ A_.T                  # displacement (s Rh)
    rep = json.load(open(os.path.join(M, "report.json"), encoding="utf-8")); ch = rep.get("chosen", "gnm")
    if ex.get("chosen_fit") not in (None, ch): raise SystemExit(f"head.glb is fit {ex.get('chosen_fit')}, report.json chose {ch}: re-export the glb")
    V0 = np.asarray(meshio.read_any(os.path.join(M, f"fit_{ch}.ply"))["vertices"], np.float64)
    lid = np.array(json.load(open(os.path.join(M, f"fit_{ch}.fit.json")))["landmark_vertex_ids"])
    tpl = np.load(VD.TEMPLATE); F = tpl["triangles"].astype(np.int64); mat = tpl["materials"]; comp = tpl["components"]
    L = V0[lid]; iod = float(np.linalg.norm(L[33] - L[263]))
    ax = json.loads(subprocess.check_output([sys.executable, os.path.join(HERE, "colmap", "frontal_axes.py"), sparse,
                                             os.path.join(W, "prep", "prepare.json")], stderr=subprocess.DEVNULL).decode().strip().splitlines()[-1])
    up_ = np.array([float(x) for x in ax["up"].split(",")]); fw_ = np.array([float(x) for x in ax["fwd"].split(",")])
    fw_ -= up_ * (fw_ @ up_); fw_ /= np.linalg.norm(fw_); rt_ = np.cross(up_, fw_)
    axes = {"right": rt_, "up": up_, "fwd": fw_}
    target = L[1] * 0.4 + L[168] * 0.3 + L[6] * 0.3
    # ---- expression: jaw weights + hinge (viewer_data.py main), neutral landmarks
    _, _, _, _, jw = VD.expression_weights(V0, F, mat, comp, lid, iod)
    hinge = (V0[lid[234]] + V0[lid[454]]) / 2 - fw_ * 0.30 * iod - up_ * 0.05 * iod
    expr = {"lid": [int(x) for x in lid], "lmk": b64(pt(L), "<f4"), "nbase": int(len(V0)),
            "jaw": {"w": b64(jw, "<f4"), "hinge": pt(hinge).tolist(), "axis": dr(rt_).tolist(), "max_deg": 0.0},
            "mouth": {"center": pt((V0[lid[13]] + V0[lid[14]]) / 2).tolist(), "width": s * float(np.linalg.norm(V0[lid[78]] - V0[lid[308]]))}}
    # ---- own face rig (eye edits, ARKit-named expression shapes)
    rig = face_rig.build(V0, F, mat, comp, lid, axes, iod)
    rig_out = {"shapes": {k: {"idx": b64(v["idx"], "<i4"), "d": b64(dp(np.asarray(v["d"], np.float64).reshape(-1, 3)), "<f4")} for k, v in rig["shapes"].items()},
               "eyes": {k: {**e, "center": pt(e["center"]).tolist()} for k, e in rig["eyes"].items()},
               "jaw": {"w": b64(rig["jaw"]["w"], "<f4"), "hinge": pt(rig["jaw"]["hinge"]).tolist(), "axis": dr(rig["jaw"]["axis"]).tolist(), "max_deg": 0.0}}
    # ---- GNM expression components
    gnmx = None if a.no_gnm_expr else VD.gnm_expression_block(V0, lid, axes=axes)
    if gnmx:
        for k, v in gnmx["shapes"].items():
            d = dp(unb64(v["q"], "<i2").astype(np.float64).reshape(-1, 3) * v["sc"]); sc = float(np.abs(d).max()) / 32000 + 1e-12
            v["q"] = b64(np.round(d / sc), "<i2"); v["sc"] = sc
        P = unb64(gnmx["P"], "<f4").astype(np.float64).reshape(gnmx["K"], -1, 3)
        gnmx["P"] = b64((P @ Rh.T) / s, "<f4")          # w = sum_i P_i . d_world,i = sum_i (Rh P_i / s) . d_glb,i
    # ---- nose editing: editable layer of the case + nearest editable vertex per template vertex
    nose = None
    cid = a.case or rep.get("case")
    if cid and os.path.isdir(os.path.join(ROOT, "cases", cid)):
        g = {"_P": V0}
        nb = VD.nose_block(os.path.join(ROOT, "cases", cid), [g], V0)
        Rc = np.asarray(nb["T"], np.float64)[:3, :3]                  # world -> canonical rotation
        nose = {"case": cid, "json": nb["json"], "bin": nb["bin"], "limits": nb["limits"], "engine": nb["engine"],
                "nmap": g["nmap"], "nw": g["nw"], "M": (A_ @ Rc.T).tolist()}
    out = a.out or os.path.join(M, "rig.json")
    data = {**FORMAT, "id": os.path.basename(W), "chosen_fit": ch, "fit_sha": ex.get("fit_sha"), "frame": "head.glb (world_to_glb)",
            "axes": {"up": dr(up_).tolist(), "fwd": dr(fw_).tolist(), "right": dr(rt_).tolist()}, "target": pt(target).tolist(), "iod": s * iod,
            "expr": expr, "rig": rig_out, "gnmx": gnmx, "nose": nose,
            "note": "personal data (face shape) - local only; template vertex indices = glb _TEMPLATE_INDEX"}
    json.dump(data, open(out, "w"))
    print(json.dumps({"out": out, "bytes": os.path.getsize(out), "nbase": len(V0), "shapes": len(rig_out["shapes"]),
                      "gnmx": gnmx["K"] if gnmx else 0, "nose": cid if nose else None}))


if __name__ == "__main__":
    main()
