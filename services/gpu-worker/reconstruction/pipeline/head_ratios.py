"""Head proportions of a fitted head vs the range of real heads (W1d, 2026-10-19).

Why: zu01 (curly short hair) got a crown that bulges upward ("Megamind"), and the temples of most fits sit on the
hairline (head too narrow there). Nothing flagged either. Four ratios, all scale-free (divided by the face height
H = eye line -> chin along the head's up axis, or by another width):
  crown_h          height of the skull top above the eye line / H
  temple_over_zyg  head width at the temples (60 % of the way eye line -> landmark 151) / width at the cheekbones
                   (height of landmarks 234 / 454); ears excluded
  zyg_over_H       cheekbone width / H
  back             depth of the back of the head behind the ear centre / H
The range of real heads comes from the GNM identity model itself (Apache-2.0): identities b ~ N(0, I), the prior the
fit uses. assets/head_ratio_range.json holds its percentiles (regenerate: python pipeline/head_ratios.py).
"""
import json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
RANGE = os.path.join(HERE, "..", "assets", "head_ratio_range.json")
LABELS = {"crown_h": "정수리 높이", "temple_over_zyg": "관자놀이 폭 / 광대 폭", "zyg_over_H": "광대 폭", "back": "뒤통수 깊이"}
HINT = {("crown_h", "high"): "두상이 위로 부풀었을 수 있음 (머리카락·액세서리를 두개골로 잡음)",
        ("crown_h", "low"): "정수리가 낮게 눌렸을 수 있음",
        ("temple_over_zyg", "low"): "관자놀이가 헤어라인으로 잡혀 두상이 좁을 수 있음",
        ("temple_over_zyg", "high"): "관자놀이 쪽 두상이 옆으로 부풀었을 수 있음",
        ("zyg_over_H", "high"): "광대가 넓게 잡혔을 수 있음", ("zyg_over_H", "low"): "광대가 좁게 잡혔을 수 있음",
        ("back", "high"): "뒤통수가 뒤로 길게 잡혔을 수 있음", ("back", "low"): "뒤통수가 납작하게 잡혔을 수 있음"}
_CACHE = {}


def _masks():
    if "m" not in _CACHE:
        from gnm_model import GNM, template_map
        from gnm_features import scalp_vertices
        from template_fit import load_template
        G = GNM(); o2g = template_map()[0]
        ears = (G.groups[G.group_names.index("ears")] > 0.3)[o2g]
        mat = load_template()[2]
        _CACHE["m"] = (scalp_vertices(), (mat == 0) & ~ears)
    return _CACHE["m"]


def measures(V, lid):
    """the four ratios of a mesh in our template topology (lid: MediaPipe 468 -> vertex ids, from a fit.json)"""
    from view_coverage import head_axes
    scalp, skin = _masks()
    L = V[np.asarray(lid)]; c, x, up, fw = head_axes(L)
    eye = (L[33] + L[263]) / 2; H = (eye - L[152]) @ up
    h = (V - eye) @ up; lat = (V - c) @ x; dep = (V - c) @ fw

    def width(y0, tol=0.03):
        sel = skin & (np.abs(h - y0 * H) < tol * H)
        return float(lat[sel].max() - lat[sel].min()) if sel.sum() > 10 else float("nan")
    zyg = width(((L[234] + L[454]) / 2 - eye) @ up / H)
    tmp = width((L[151] - eye) @ up / H * 0.6)
    return {"crown_h": round(float(h[scalp].max() / H), 3), "temple_over_zyg": round(tmp / zyg, 3),
            "zyg_over_H": round(float(zyg / H), 3), "back": round(float(-dep[scalp].min() / H), 3)}


def load_range():
    return json.load(open(RANGE, encoding="utf-8")) if os.path.exists(RANGE) else None


def check(m, rng=None):
    """[(key, value, lo, hi, 'low'|'high', message)] for ratios outside the 0.5-99.5 % range of real heads"""
    rng = rng or load_range()
    out = []
    if not rng: return out
    for k, v in m.items():
        r = rng["ratios"].get(k)
        if r is None or v is None or not np.isfinite(v): continue
        lo, hi = r["p0.5"], r["p99.5"]
        if v < lo or v > hi:
            side = "low" if v < lo else "high"
            out.append((k, v, lo, hi, side, f"{LABELS[k]} 비율 {v} (사람 범위 {lo}~{hi}): {HINT[(k, side)]}"))
    return out


def build_range(n=2000, seed=0):
    """percentiles of the ratios over GNM identities b ~ N(0, I) (head components; eyes / teeth at the mean)"""
    from gnm_model import GNM, template_map
    G = GNM(); o2g, s, R, t = template_map()
    lid = None
    from template_fit import load_template, correspondence
    V0, F, mat, comp, raw = load_template(); lid = correspondence(V0, F, mat)
    hid = np.array([i for i, x in enumerate(G.id_names) if x.startswith("head")])
    rng = np.random.default_rng(seed); vals = []
    for _ in range(n):
        b = np.zeros(len(G.id_names)); b[hid] = rng.standard_normal(len(hid))
        V = (s * (R @ G.bind(b)[o2g].T)).T + t
        vals.append(measures(V, lid))
    out = {"source": "GNM Head v3 identity prior b ~ N(0, I), head components only (pipeline/head_ratios.py)",
           "samples": n, "seed": seed, "ratios": {}}
    for k in vals[0]:
        a = np.array([v[k] for v in vals])
        out["ratios"][k] = {f"p{q}": round(float(np.percentile(a, q)), 3) for q in (0.5, 5, 50, 95, 99.5)}
    return out


if __name__ == "__main__":
    r = build_range()
    json.dump(r, open(RANGE, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(json.dumps(r, ensure_ascii=False))
