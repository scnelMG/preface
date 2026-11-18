"""Evidence renders for engine sample states: same camera/light/material for Before and After (gray shape).
usage: python render_edits.py <caseDir>"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render  # noqa: E402


def load_case(case):
    js = json.load(open(os.path.join(case, "avatar", "editable.json")))
    raw = open(os.path.join(case, "avatar", "editable.bin"), "rb").read()
    lay = js["buffers"]["layout"]

    def arr(name, dt, cols):
        l = lay[name]
        return np.frombuffer(raw, dt, l["byteLength"] // np.dtype(dt).itemsize, l["byteOffset"]).reshape(-1, cols)
    return js, arr("position", "<f4", 3).astype(float), arr("index", "<u4", 3).astype(np.int64), arr("color", "<f4", 3).astype(float)


def main(case):
    js, v0, f, col = load_case(case)
    D = js["D"]
    sd = os.path.join(case, "evaluation", "samples")
    meta = json.load(open(os.path.join(sd, "samples.json")))
    ctr = np.array([0, -0.15 * D, -0.45 * D])
    ext = 0.95 * D
    views = [("front", "정면"), ("oblique_r", "사선"), ("side_r", "측면"), ("bottom", "밑면")]
    names = [k for k in meta["samples"] if k != "original"]
    rows = []
    labels = []
    base_imgs = [render.render(v0, f, vw, 300, center=ctr, extent=ext) for vw, _ in views]
    for k in names:
        v1 = np.fromfile(os.path.join(sd, k + ".f32"), "<f4").reshape(-1, 3).astype(float)
        disp = np.linalg.norm(v1 - v0, axis=1) / D
        heat = render.error_colors(disp, max(disp.max(), 1e-9))
        rows.append(base_imgs[2]); labels.append("before side")
        rows.append(render.render(v1, f, "side_r", 300, center=ctr, extent=ext)); labels.append(f"{k} side")
        rows.append(render.render(v1, f, "front", 300, center=ctr, extent=ext)); labels.append(f"{k} front")
        rows.append(render.render(v1, f, "bottom", 300, center=ctr, extent=ext)); labels.append(f"{k} bottom")
        rows.append(render.render(v1, f, "oblique_r", 300, colors=heat, center=ctr, extent=ext)); labels.append(f"|disp| max {disp.max():.3f}D")
    sheet = render.contact_sheet(rows, labels, 5)
    render.save_png(os.path.join(case, "evaluation", "edit_samples_gray.png"), sheet)
    # combo before/after in 4 views, gray + colour
    v1 = np.fromfile(os.path.join(sd, "combo.f32"), "<f4").reshape(-1, 3).astype(float)
    ims, lab = [], []
    for vw, name in views:
        ims.append(render.render(v0, f, vw, 300, center=ctr, extent=ext)); lab.append("Before " + vw)
        ims.append(render.render(v1, f, vw, 300, center=ctr, extent=ext)); lab.append("After " + vw)
    if js.get("has_colors"):
        for vw in ("oblique_r", "side_r"):
            ims.append(render.render(v0, f, vw, 300, colors=col, center=ctr, extent=ext)); lab.append("Before colour " + vw)
            ims.append(render.render(v1, f, vw, 300, colors=col, center=ctr, extent=ext)); lab.append("After colour " + vw)
    render.save_png(os.path.join(case, "evaluation", "combo_before_after.png"), render.contact_sheet(ims, lab, 4))
    print("ok", names)


if __name__ == "__main__":
    main(sys.argv[1])
