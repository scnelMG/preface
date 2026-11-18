"""Low-pass the landmark RESIDUAL of the GNM candidate (2026-10-19).

The "gnm" candidate = statistical GNM fit (fit_gnm_base, smooth) + a landmark residual (template_fit --base-mesh).
On eun02 the residual brought MediaPipe landmark noise in as small creases: frown lines between the brows, a bumpy nose
bridge (gray renders: the base is clean, the residual adds them). The residual is meant to correct SHAPE (positions of
eyes / brows / nose / lips by a few mm), not to carve detail, so here its displacement field D = fit - base is diffused
over the surface: strong where creases appeared (forehead, glabella, nose bridge, cheeks), weak at the eyelids and lips
whose small corrections are real. Positions of the base are untouched; only the residual is smoothed.

usage: python residual_smooth.py <base.ply> <fit.ply> <out.ply> [--iters 40] [--pin-lids fit.json]   -> prints JSON stats

--pin-lids (G15 OPTION, 2026-10-24): the 32 eyelid landmark vertices (eyelid_offset.EYE upper / lower lid + corners, ids from
the fit JSON) keep their residual exactly. The lid edge is a sharp line; averaging it with the lid skin above moved the
fitted upper-lid points back up (zu01 one column +0.015 -> +0.033 x eye width above the photo lash edge).
"""
import argparse, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import meshio  # noqa

STRONG = ["forehead_region", "middle_brow_region", "left_brow_region", "right_brow_region", "left_temple_region",
          "right_temple_region", "nose_region", "left_infraorbital_region", "right_infraorbital_region",
          "left_zygomatic_region", "right_zygomatic_region", "left_cheek_region", "right_cheek_region", "chin_region",
          "left_parotid_region", "right_parotid_region"]
WEAK = ["upper_lip", "lower_lip", "left_orbital_region", "right_orbital_region", "eyes", "eye_sockets", "ears"]


def smooth_residual(base, fit, iters=40, strong=1.0, weak=0.15, pin=None):
    from scipy.sparse import coo_matrix, diags
    from gnm_model import GNM
    g = GNM()
    F = g.tri
    n = len(base)
    ii = np.concatenate([F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]])
    jj = np.concatenate([F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]])
    A = coo_matrix((np.ones(len(ii)), (ii, jj)), shape=(n, n)).tocsr(); A.data[:] = 1.0
    deg = np.maximum(np.asarray(A.sum(1)).ravel(), 1)
    M = diags(1.0 / deg) @ A                                   # neighbour average
    s = np.full(n, 0.5)                                        # default: medium
    for name in STRONG:
        if name in g.group_names: s[g.group(name)] = strong
    for name in WEAK:                                           # weak wins where regions overlap (eyelids, lips)
        if name in g.group_names: s[g.group(name)] = np.minimum(s[g.group(name)], weak)
    if pin is not None: s[pin] = 0.0
    D0 = fit - base; D = D0.copy()
    for _ in range(iters):
        D = D + (0.5 * s)[:, None] * (M @ D - D)
    return base + D, D0, D


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base"); ap.add_argument("fit"); ap.add_argument("out"); ap.add_argument("--iters", type=int, default=80)
    ap.add_argument("--pin-lids", help="G15 OPTION: fit JSON whose eyelid landmark vertices keep their residual (see top)")
    a = ap.parse_args()
    pin = None
    if a.pin_lids:
        from eyelid_offset import EYE
        lid = json.load(open(a.pin_lids))["landmark_vertex_ids"]
        pin = np.array(sorted({lid[k] for e in EYE.values() for k in e["up"] + e["lo"] + list(e["c"])}), np.int64)
    mb = meshio.read_any(a.base); mf = meshio.read_any(a.fit)
    Vb = np.asarray(mb["vertices"], np.float64); Vf = np.asarray(mf["vertices"], np.float64)
    if Vb.shape != Vf.shape:
        print(json.dumps({"status": "skipped", "reason": "vertex count differs"})); return
    V, D0, D = smooth_residual(Vb, Vf, a.iters, pin=pin)
    meshio.write_ply(a.out, V, np.asarray(mf["faces"]), colors=mf.get("colors"))
    print(json.dumps({"status": "ok", "iters": a.iters, "residual_mean_before": float(np.linalg.norm(D0, axis=1).mean()),
                      "residual_mean_after": float(np.linalg.norm(D, axis=1).mean()),
                      **({"pinned_lid_vertices": int(len(pin))} if pin is not None else {})}))


if __name__ == "__main__":
    main()
