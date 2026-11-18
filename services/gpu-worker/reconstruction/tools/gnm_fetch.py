"""Download the GNM Head v3.0 model (Google, Apache-2.0) and link it to our template.

  python tools/gnm_fetch.py            (about 53 MB from huggingface.co/google/gnm-v3, once)

1. downloads v3_0/gnm_head.npz to assets/gnm/v3_0/ (sha256 checked; git-ignored)
2. inspects it: vertex / triangle counts, identity / expression / joint names, vertex groups (ears, eyes, ...)
3. links it to our assets/gnm-template-v2.npz (the model mean we used so far): same vertex order? (similarity fit of all
   vertices) else nearest-vertex map -> assets/gnm/template_map.npz
writes assets/gnm/gnm_inspect.json
"""
import hashlib, json, os, sys, urllib.request
import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
URL = "https://huggingface.co/google/gnm-v3/resolve/main/v3_0/gnm_head.npz"
SHA = "61d78bbfb4ad8e0b38495804a4caef3214d3df00f8c3f68761e63b41ce3747eb"
DST = os.path.join(ROOT, "assets", "gnm", "v3_0", "gnm_head.npz")


def umeyama(A, B):
    ca, cb = A.mean(0), B.mean(0); A0, B0 = A - ca, B - cb
    U, S, Vt = np.linalg.svd(B0.T @ A0); d = np.sign(np.linalg.det(U @ Vt)); D = np.diag([1, 1, d])
    R = U @ D @ Vt; s = np.trace(np.diag(S) @ D) / (A0 ** 2).sum()
    return s, R, cb - s * R @ ca


def main():
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    open(os.path.join(ROOT, "assets", "gnm", ".gitignore"), "w").write("*.npz\n")
    if not os.path.exists(DST) or hashlib.sha256(open(DST, "rb").read()).hexdigest() != SHA:
        print("downloading", URL, flush=True)
        req = urllib.request.Request(URL, headers={"User-Agent": "live-mirror-poc"})
        tmp = DST + ".part"
        with urllib.request.urlopen(req, timeout=300) as r, open(tmp, "wb") as fh:
            while True:
                b = r.read(1 << 20)
                if not b: break
                fh.write(b); print(".", end="", flush=True)
        print()
        h = hashlib.sha256(open(tmp, "rb").read()).hexdigest()
        if h != SHA: raise SystemExit(f"checksum mismatch {h}")
        os.replace(tmp, DST)
    d = np.load(DST, allow_pickle=True)
    info = {"file": DST, "fields": {k: list(d[k].shape) for k in d.files}}
    for k in ("identity_names", "expression_names", "joint_names", "vertex_group_names", "mesh_component_names"):
        names = [str(x) for x in d[k]]
        pref = {}
        for n in names:
            p = n.rsplit("_", 1)[0] if any(ch.isdigit() for ch in n[-3:]) else n
            pref[p] = pref.get(p, 0) + 1
        info[k] = pref if len(pref) < len(names) else names
    T = np.asarray(d["template_vertex_positions"], np.float64)
    t = np.load(os.path.join(ROOT, "assets", "gnm-template-v2.npz"))
    O = t["vertices"].astype(np.float64)
    info["n_vertices"] = {"gnm": len(T), "ours": len(O)}
    if len(T) == len(O):
        s, R, tr = umeyama(T, O); r = np.linalg.norm((s * (R @ T.T)).T + tr - O, axis=1)
        info["same_order"] = {"median_resid_m": float(np.median(r)), "max_resid_m": float(r.max()), "scale": s}
        same = float(np.percentile(r, 99)) < 1e-3 * np.ptp(O, 0).max()
        ours_to_gnm = np.arange(len(O))
        if not same:
            from scipy.spatial import cKDTree
            ours_to_gnm = cKDTree((s * (R @ T.T)).T + tr).query(O)[1]
    else:
        from scipy.spatial import cKDTree
        # different topology: align the bounding boxes, then nearest vertex (rough; reported)
        s = np.ptp(O, 0).max() / np.ptp(T, 0).max(); R = np.eye(3); tr = O.mean(0) - s * T.mean(0)
        ours_to_gnm = cKDTree((s * T) + tr).query(O)[1]; same = False
    info["linked"] = "same vertex order" if same else "nearest-vertex map"
    np.savez(os.path.join(ROOT, "assets", "gnm", "template_map.npz"), ours_to_gnm=ours_to_gnm, s=s, R=R, t=tr)
    json.dump(info, open(os.path.join(ROOT, "assets", "gnm", "gnm_inspect.json"), "w"), indent=1, ensure_ascii=False)
    print(json.dumps({k: info[k] for k in ("n_vertices", "linked")} | {"same_order": info.get("same_order")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
