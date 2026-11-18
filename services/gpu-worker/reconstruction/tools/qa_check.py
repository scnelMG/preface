"""Quality check of a model result (2026-10-19). Every run ends with it:
  1. numbers   hold-out landmark error, hold-out outline error, surface CREASE score (extra curvature of the chosen
               fit vs the smooth statistical fit gnmb, face regions, p99 in % IOD), view coverage, chosen candidate
  2. picture   gray renders (front / 35 / 80 deg) of the chosen fit -> work/<id>/model/qa_gray.png
  3. absolute  (W1d 2026-10-19): surface creases, side hold-out error, ear shift, head proportions against the range
               of the GNM head model (pipeline/head_ratios.py) -> FAIL or warnings
The comparison with an accepted earlier result (qa_baseline.json, --accept) was removed on 2026-10-24 (만두): the two
baselines (woo01-r2, eun02-r2) were inaccurate models, lost their role on 10/21, and only their own captures had one.
Compare two runs with npm.cmd run scan:compare -- work/<a> work/<b>; old qa_baseline.json files are left in work/.
usage: python tools/qa_check.py work/<id> [--no-render]      exit 1 on FAIL
"""
import argparse, json, os, subprocess, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

FACE = ["forehead_region", "middle_brow_region", "nose_region", "left_cheek_region", "right_cheek_region",
        "left_infraorbital_region", "right_infraorbital_region", "chin_region"]
# W1d absolute limits. Measured 10/19: woo01-r2 / eun02-r2 crease p95 0.067, chae01 0.089, min01
# (lm chosen, creased) 0.30; side hold-out woo01-r2 / eun02-r2 3.1-4.9 %, zu01 9.9 %, eun03 (failed camera poses) 17.8-19.6 %
ABS = {"crease_p95_warn": 0.15, "crease_p95_fail": 0.25, "side_warn": 8.0, "side_fail": 12.0}


def crease(V, Vref, iod):
    """extra curvature of V over the smooth reference (umbrella Laplacian along the normal), face regions, % IOD"""
    from scipy.sparse import coo_matrix, diags
    from gnm_model import GNM
    g = GNM(); F = g.tri; n = g.V
    ii = np.concatenate([F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]])
    jj = np.concatenate([F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]])
    A = coo_matrix((np.ones(len(ii)), (ii, jj)), shape=(n, n)).tocsr(); A.data[:] = 1.0
    M = diags(1.0 / np.maximum(np.asarray(A.sum(1)).ravel(), 1)) @ A
    face = np.zeros(n, bool)
    for r in FACE: face |= g.group(r)

    def lapn(X):
        fn = np.cross(X[F[:, 1]] - X[F[:, 0]], X[F[:, 2]] - X[F[:, 0]]); vn = np.zeros_like(X)
        for k in range(3): np.add.at(vn, F[:, k], fn)
        vn /= np.linalg.norm(vn, axis=1, keepdims=True) + 1e-12
        return ((M @ X - X) * vn).sum(1)
    d = np.abs(lapn(V) - lapn(Vref))[face] / iod * 100
    return {"p95": round(float(np.percentile(d, 95)), 3), "p99": round(float(np.percentile(d, 99)), 3)}


def measure(W):
    import meshio
    M = os.path.join(W, "model")
    rep = json.load(open(os.path.join(M, "report.json")))
    ch = rep.get("chosen", "lm"); E = rep.get("eval", {}).get(ch, {})
    h = E.get("holdout", {})
    out = {"chosen": ch,
           "holdout_lm": round(float(np.mean([b["pct_iod"] for b in h.values()])), 3) if h else None,
           "holdout_line": E.get("line_holdout_abs"),
           "fit_sha": (rep.get("provenance") or {}).get("fit_sha")}
    if os.path.exists(os.path.join(M, "fit_gnmb.ply")) and os.path.exists(os.path.join(M, f"fit_{ch}.ply")):
        V = np.asarray(meshio.read_any(os.path.join(M, f"fit_{ch}.ply"))["vertices"], np.float64)
        Vb = np.asarray(meshio.read_any(os.path.join(M, "fit_gnmb.ply"))["vertices"], np.float64)
        lid = np.array(json.load(open(os.path.join(M, "fit_gnmb.fit.json")))["landmark_vertex_ids"])
        if V.shape == Vb.shape:
            out["crease"] = crease(V, Vb, np.linalg.norm(Vb[lid][33] - Vb[lid][263]))
    fb = os.path.join(M, "fit_gnm_base.fit.json")
    if ch.startswith("gnm") and os.path.exists(fb):
        ef = json.load(open(fb)).get("ear_fit") or {}
        out["ears"] = {k: {kk: v.get(kk) for kk in ("applied", "shift_up_pct_iod", "shift_forward_pct_iod", "scale", "reason", "copied_from")}
                       for k, v in ef.items()}
    vc = os.path.join(M, "view_coverage.json")
    if os.path.exists(vc):
        v = json.load(open(vc)); out["view"] = [v.get("yaw_min_deg"), v.get("yaw_max_deg")]
    out["holdout_side"] = h.get("side_35_90", {}).get("pct_iod") if h else None
    try:   # head proportions of the chosen fit (W1d)
        from head_ratios import measures as head_measures
        V = np.asarray(meshio.read_any(os.path.join(M, f"fit_{ch}.ply"))["vertices"], np.float64)
        out["head_ratios"] = head_measures(V, json.load(open(os.path.join(M, f"fit_{ch}.fit.json")))["landmark_vertex_ids"])
    except Exception as ex:
        out["head_ratios_error"] = str(ex)[:200]
    return out


def render(W, out_png):
    M = os.path.join(W, "model")
    rep = json.load(open(os.path.join(M, "report.json"))); ch = rep.get("chosen", "lm")
    sp = json.load(open(os.path.join(W, "run_all.json")))["stages"]["lens"]["sparse"]
    if not os.path.isdir(sp): sp = os.path.join(W, "colmap", "sparse_lens_anchored")
    r = subprocess.run([sys.executable, os.path.join(HERE, "render_textured.py"), os.path.join(M, "tex"), os.path.join(M, f"fit_{ch}.ply"),
                        sp, os.path.join(W, "prep", "prepare.json"), out_png, "--gray", "--size", "420", "--angles", "0,35,80"],
                       capture_output=True, text=True)
    return r.returncode == 0 and os.path.exists(out_png)


def absolute(cur):
    """W1d: limits that hold for every capture, with or without a baseline -> (problems, warnings)"""
    problems, warnings = [], []
    c95 = (cur.get("crease") or {}).get("p95")
    if c95 is not None:
        if c95 >= ABS["crease_p95_fail"]:
            problems.append(f"표면 주름 지수 p95 {c95} (기준 {ABS['crease_p95_fail']} 미만): 이마·볼·눈 주변이 울퉁불퉁 (채택 {cur.get('chosen')})")
        elif c95 >= ABS["crease_p95_warn"]:
            warnings.append(f"표면 주름 지수 p95 {c95} (주의 {ABS['crease_p95_warn']} 이상)")
    sd = cur.get("holdout_side")
    if sd is not None:
        if sd >= ABS["side_fail"]:
            problems.append(f"측면 홀드아웃 오차 {sd}% (기준 {ABS['side_fail']}% 미만): 측면 형상이 사진과 크게 다름")
        elif sd >= ABS["side_warn"]:
            warnings.append(f"측면 홀드아웃 오차 {sd}% (주의 {ABS['side_warn']}% 이상)")
    try:
        from head_ratios import check as head_check
        warnings += [m for *_, m in head_check(cur.get("head_ratios") or {})]
    except Exception as ex:
        warnings.append(f"두상 비율 검사 생략: {str(ex)[:120]}")
    return problems, warnings


def judge(cur):
    """limits that hold for every capture -> (status, problems, notes)"""
    problems, notes = [], []
    for side, e in (cur.get("ears") or {}).items():
        if e.get("applied") and max(abs(e.get("shift_up_pct_iod") or 0), abs(e.get("shift_forward_pct_iod") or 0)) > 15:
            problems.append(f"{side} 귀 이동 과다 (위 {e.get('shift_up_pct_iod')}, 앞 {e.get('shift_forward_pct_iod')} % IOD)")
        if e.get("reason"): notes.append(f"{side} 귀: {e.get('reason')}" + (f" -> {e['copied_from']} 귀 이동 복사" if e.get("copied_from") else ""))
    p_abs, _ = absolute(cur); problems += p_abs
    return ("FAIL" if problems else "PASS"), problems, notes


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("work")
    ap.add_argument("--no-render", action="store_true")
    a = ap.parse_args()
    W = a.work; M = os.path.join(W, "model")
    cur = measure(W)
    png = os.path.join(M, "qa_gray.png")
    if not a.no_render: cur["render"] = render(W, png)
    status, problems, notes = judge(cur)
    res = {"status": status, "problems": problems, "warnings": absolute(cur)[1], "notes": notes, "current": cur}
    json.dump(res, open(os.path.join(M, "qa_check.json"), "w"), indent=1, ensure_ascii=False)
    print(json.dumps(res, ensure_ascii=False))
    sys.exit(1 if status == "FAIL" else 0)


if __name__ == "__main__":
    main()
