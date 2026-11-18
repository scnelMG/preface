"""P1 (2026-10-16): the 468 MediaPipe landmarks split into SYSTEMATIC classes by the GNM Head v3 face regions.

  anchor   eyes (orbital), brows, nose, lips, infraorbital - fixed anatomical points, seen the same from every view
  surface  temple, zygomatic, parotid, cheek, chin, forehead - points on smooth skin; MediaPipe places them by the
           look of the whole face, so in turned views they slide (woo01: cheek / jaw points 15-20 % of the eye distance
           INSIDE the measured outline). With the silhouettes fitted they are only a weak hint.
  oval     MediaPipe's face-oval ring (template_fit.OVAL) - follows the visible outline of each view, not skin points

Classes are computed from the model's vertex groups (no hand lists) and cached in assets/gnm/gnm_features.json for
inspection. usage: from gnm_features import landmark_classes, landmark_weights
"""
import json, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "..", "assets", "gnm", "gnm_features.json")
ANCHOR_GROUPS = ["left_orbital_region", "right_orbital_region", "left_brow_region", "right_brow_region", "middle_brow_region",
                 "nose_region", "upper_lip_region", "lower_lip_region", "upper_lip", "lower_lip",
                 "left_infraorbital_region", "right_infraorbital_region"]
SURFACE_GROUPS = ["left_temple_region", "right_temple_region", "left_zygomatic_region", "right_zygomatic_region",
                  "left_parotid_region", "right_parotid_region", "left_cheek_region", "right_cheek_region",
                  "chin_region", "forehead_region"]


def landmark_classes():
    if os.path.exists(CACHE):
        d = json.load(open(CACHE))
        return {k: np.array(v, np.int64) for k, v in d["classes"].items()}
    from gnm_model import GNM, template_map
    from template_fit import load_template, correspondence, OVAL, EYE_LM
    G = GNM(); o2g = template_map()[0]
    V0, F, mat, comp, raw = load_template(); gk = o2g[correspondence(V0, F, mat)]
    memb = lambda names: np.any([G.groups[G.group_names.index(n)][gk] > 0.5 for n in names], axis=0)
    anchor = memb(ANCHOR_GROUPS); anchor[EYE_LM] = True
    surface = memb(SURFACE_GROUPS) & ~anchor
    oval = np.zeros(468, bool); oval[OVAL] = True
    cls = {"oval": np.where(oval)[0], "anchor": np.where(anchor & ~oval)[0], "surface": np.where(surface & ~oval)[0]}
    cls["other"] = np.setdiff1d(np.arange(468), np.concatenate(list(cls.values())))
    regions = {}
    for k in range(468):
        regions[int(k)] = [n for i, n in enumerate(G.group_names) if n.endswith("region") and G.groups[i][gk[k]] > 0.5]
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    json.dump({"note": __doc__.strip().splitlines()[0], "classes": {k: [int(x) for x in v] for k, v in cls.items()},
               "regions": regions}, open(CACHE, "w"), indent=0)
    return cls


def landmark_weights(oval=1.0, surface=1.0, other=1.0):
    """per-landmark multiplier (468,) for the classes (anchors always 1)"""
    c = landmark_classes(); w = np.ones(468)
    w[c["surface"]] = surface; w[c["other"]] = other; w[c["oval"]] = oval
    return w



def scalp_vertices(n_vertices=None):
    """(V,) True for the hair-covered head skin (crown, back, sides above the ears): skin of the template that is in none
    of the GNM face regions / ears and above the eye line. The rest of the skin (face, ears, neck) shows SKIN in the photos;
    there hair / clothes in front of it must not be painted onto it (uv_bake.py --skin-only)."""
    from gnm_model import GNM, template_map
    from template_fit import load_template
    G = GNM(); o2g = template_map()[0]
    V0, F, mat, comp, raw = load_template()
    reg = np.zeros(G.V, bool)
    for i, n in enumerate(G.group_names):
        if n.endswith("region") or n == "ears": reg |= G.groups[i] > 0.3
    reg = reg[o2g]
    from template_fit import correspondence
    corr = correspondence(V0, F, mat)
    up = V0[corr[10]] - V0[corr[152]]; up /= np.linalg.norm(up)
    # above the eye line: behind / below the ears is neck skin (hanging hair covers it, it is not hair-covered scalp)
    above = (V0 - (V0[corr[33]] + V0[corr[263]]) / 2) @ up > 0
    return (mat == 0) & ~reg & above


def skin_only_vertices():
    """(V,) True where the photos must show SKIN to colour the surface (uv_bake.py): cheeks, jaw, chin, ears, neck -
    below the brow line. Forehead / temples (hairline: hair lies ON the surface there; eun02 got bald patches when they
    were skin-only) and the scalp take the photo colour as it is."""
    from template_fit import load_template, correspondence
    V0, F, mat, comp, raw = load_template()
    corr = correspondence(V0, F, mat)
    up = V0[corr[10]] - V0[corr[152]]; up /= np.linalg.norm(up)
    brow = (V0[corr[105]] + V0[corr[334]]) / 2
    from gnm_model import GNM, template_map
    G = GNM(); o2g = template_map()[0]
    ears = (G.groups[G.group_names.index("ears")] > 0.3)[o2g]
    return (mat == 0) & ~scalp_vertices() & (((V0 - brow) @ up < 0) | ears)


if __name__ == "__main__":
    print({k: len(v) for k, v in landmark_classes().items()})
