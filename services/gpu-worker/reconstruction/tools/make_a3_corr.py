"""A3 (2026-10-23): upper-lid landmark correspondence on the eyeball CONTACT line -> assets/gnm_mp468_a3.json

Why: MediaPipe's upper-lid points sit where the lid meets the eyeball (the visible edge of the eye opening): their
triangulated 3D points lie at 1.03 x the eyeball radius from the eyeball centre (R0 analysis, design doc 13/14). The GNM
template attaches the middle upper-lid landmarks to vertices of the lid FRONT (1.15-1.27 x radius). The residual fit then
pulls the lid front onto the contact line and the whole lid sinks by its thickness (P1: upper lash root +0.036 -> +0.082
x eye width from the statistical fit to the final model). The lower-lid landmarks already sit at 1.03-1.09.

Rule (template only, the same for every person): an upper-lid ring landmark (eyelid_offset.EYE "up") whose vertex lies
beyond --max-ratio x radius is re-attached to the skin vertex within --max-angle degrees of the same direction from the
eyeball centre that lies on the lid MARGIN edge (radius ratio --lo .. --hi, normal not facing the eyeball: the inner
conjunctival sheet is excluded) and is closest in direction. The A2 fixes (assets/gnm_mp468_fix.json,
3 socket-interior vertices) are kept for every landmark this rule does not move.
usage: python tools/make_a3_corr.py [--out assets/gnm_mp468_a3.json]
"""
import argparse, json, os, sys
import numpy as np
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, os.path.join(ROOT, "pipeline"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "assets", "gnm_mp468_a3.json"))
    ap.add_argument("--base-fix", default=os.path.join(ROOT, "assets", "gnm_mp468_fix.json"))
    ap.add_argument("--max-ratio", type=float, default=1.10, help="landmark vertices beyond this x radius are on the lid front")
    ap.add_argument("--target", type=float, default=1.045, help="contact-line radius ratio (MediaPipe 1.03, lower lid 1.03-1.09)")
    ap.add_argument("--lo", type=float, default=1.0); ap.add_argument("--hi", type=float, default=1.10)
    ap.add_argument("--max-angle", type=float, default=8.0, help="deg from the eyeball centre (the middle of the upper-lid margin lies 6-7 deg below its front vertex)")
    ap.add_argument("--min-facing", type=float, default=-0.3, help="vertex normal . radial direction: the lid MARGIN edge is ~0, the "
                    "inner (conjunctival) sheet faces the eyeball (< -0.5) and is not the visible contact line")
    a = ap.parse_args()
    from template_fit import load_template, correspondence
    from eyelid_offset import EYE
    V, F, mat, comp, _ = load_template()
    corr = np.array(correspondence(V, F, mat)).copy()
    base = json.load(open(a.base_fix))["vertex"]
    for k, v in base.items(): corr[int(k)] = int(v)
    skin = np.where(mat == 0)[0]; fwd = np.array([0.0, 0.0, 1.0])     # template frame: +z = face forward
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]); vn = np.zeros_like(V)
    for i in range(3): np.add.at(vn, F[:, i], fn)
    vn /= np.linalg.norm(vn, axis=1, keepdims=True) + 1e-12
    if ((V[skin] - V[skin].mean(0)) * vn[skin]).sum(1).mean() < 0: vn = -vn      # outward skin normals
    out = {k: int(v) for k, v in base.items()}; moved = []
    for cid in (1, 2):
        eb = np.where((comp == cid) & (mat == 4))[0]
        Pe = V[eb]; A_ = np.c_[2 * Pe, np.ones(len(Pe))]; sol = np.linalg.lstsq(A_, (Pe ** 2).sum(1), rcond=None)[0]
        ce = sol[:3]; r = float(np.sqrt(sol[3] + ce @ ce))
        rs = np.linalg.norm(V[skin] - ce, axis=1) / r
        front = (V[skin] - ce) @ fwd > 0.2 * r
        facing = (vn[skin] * (V[skin] - ce)).sum(1) / np.linalg.norm(V[skin] - ce, axis=1)
        for side, e in EYE.items():
            if np.linalg.norm(V[corr[e["up"][3]]] - ce) > 2.5 * r: continue
            for k in e["up"]:
                v = int(corr[k]); rv = float(np.linalg.norm(V[v] - ce) / r)
                if rv <= a.max_ratio: continue
                dv = (V[v] - ce) / np.linalg.norm(V[v] - ce)
                dc = (V[skin] - ce) / np.linalg.norm(V[skin] - ce, axis=1, keepdims=True)
                ang = np.degrees(np.arccos(np.clip(dc @ dv, -1, 1)))
                ok = np.where((ang <= a.max_angle) & (rs >= a.lo) & (rs <= a.hi) & front & (facing >= a.min_facing))[0]
                if not len(ok):
                    print(f"  {side} {k}: no contact vertex within {a.max_angle} deg - kept v{v}"); continue
                # the margin-edge vertex closest in direction (straight behind / below the front vertex); ratio only breaks ties
                j = ok[np.lexsort((np.abs(rs[ok] - a.target), np.round(ang[ok], 1)))[0]]
                out[str(k)] = int(skin[j])
                moved.append({"landmark": k, "eye": side, "from": v, "from_ratio": round(rv, 3), "to": int(skin[j]),
                              "to_ratio": round(float(rs[j]), 3), "angle_deg": round(float(ang[j]), 2), "to_facing": round(float(facing[j]), 2)})
    json.dump({"note": "A3 2026-10-23: upper-lid landmarks re-attached from the lid front to the eyeball contact line "
                       "(tools/make_a3_corr.py); includes the A2 fixes of gnm_mp468_fix.json",
               "rule": {k: getattr(a, k) for k in ("max_ratio", "target", "lo", "hi", "max_angle", "min_facing")},
               "moved": moved, "vertex": out}, open(a.out, "w"), indent=1)
    for m in moved: print(f"  {m['eye']} {m['landmark']}: v{m['from']} ({m['from_ratio']}) -> v{m['to']} ({m['to_ratio']}, {m['angle_deg']} deg, facing {m['to_facing']})")
    print(f"{len(moved)} upper-lid landmarks moved -> {a.out}")


if __name__ == "__main__":
    main()
