"""Head-shape before/after sheets for the fixed check set (S15P31B204-328, 2026-11-03, 만두: "눈으로 확인").

  python tools/head_compare.py --out work/_compare/head --pair work/hc-chae02 work/hc-chae02-h1 [--pair A B ...] [work/<id> ...]
  python tools/head_compare.py --out work/_compare/head --ids chae02,by01 --before "work/hc-{id}" --after "work/hc-{id}-h1"
  (a run given alone, or --ids without --after, gets a before-only sheet)

per run pair, one JPEG (<out>/<after id>.jpg) + one local index.html with the numbers:
  gray     front / right 90 deg / top, before | after; on the after tile the before outline and hairline (red) and the
           after ones (green); dots = the hairline (front edge of the template scalp: scalp_vertices, above the brows)
  photo    capture frames closest to front, right 90, left 90 and the highest camera (crown): before (red) and after
           (green) outlines and hairlines drawn on the photo with the BEFORE run's camera
  numbers  head ratios (pipeline/head_ratios.py, GNM range p5..p95), face-region change and scalp change in % IOD
The after mesh is aligned to the before mesh (similarity, face skin near the 468 landmarks - the compare_runs.py region), so
two runs with their own SfM are compared in one frame. Face SAME = median < 0.5 % and p95 < 1.5 % (compare_runs.py).
PERSONAL DATA: the sheets hold capture photos - they stay under work/ (git-ignored)."""
import argparse, html, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, "..", "pipeline"))
import meshio  # noqa

RED, GREEN, YELLOW = (40, 40, 230), (40, 200, 40), (0, 220, 255)
FACE_SAME = (0.5, 1.5)   # median, p95 % IOD (compare_runs.py SAME)


def umeyama(A, B):
    """similarity s, R, t with s R A + t ~ B"""
    ca, cb = A.mean(0), B.mean(0); A0, B0 = A - ca, B - cb
    U, S, Vt = np.linalg.svd(A0.T @ B0 / len(A)); d = np.sign(np.linalg.det(Vt.T @ U.T))
    D = np.diag([1, 1, d]); R = Vt.T @ D @ U.T; s = np.trace(np.diag(S) @ D) / (A0 ** 2).sum(1).mean()
    return s, R, cb - s * R @ ca


def load_run(W):
    M = os.path.join(W, "model")
    ch = json.load(open(os.path.join(M, "report.json"))).get("chosen", "lm")
    m = meshio.read_any(os.path.join(M, f"fit_{ch}.ply"))
    sp = None
    ra = os.path.join(W, "run_all.json")
    if os.path.exists(ra): sp = (json.load(open(ra, encoding="utf-8")).get("stages", {}).get("lens") or {}).get("sparse")
    if not sp or not os.path.isdir(sp): sp = os.path.join(W, "colmap", "sparse_lens_anchored")
    fp = os.path.join(M, "frame_poses.json"); hl = os.path.join(M, "hairline.json")
    hj = json.load(open(hl)) if os.path.exists(hl) else {}
    return {"W": W, "id": os.path.basename(os.path.normpath(W)), "chosen": ch,
            "hairline": hj.get("hairline"), "curve": np.array(hj["curve"], np.float64) if hj.get("curve") else None,
            "hair_ids": hj.get("hair"), "tex": os.path.join(M, "tex"),
            "V": np.asarray(m["vertices"], np.float64), "F": np.asarray(m["faces"], np.int64),
            "lid": np.array(json.load(open(os.path.join(M, f"fit_{ch}.fit.json")))["landmark_vertex_ids"]),
            "sparse": sp, "poses": fp if os.path.exists(fp) else None, "images": os.path.join(W, "prep", "images")}


def regions(r, template=False):
    """face (skin near the landmarks), scalp, hairline: the run's model/hairline.json (pipeline/hairline.py) when present
    and not template, else the template's (scalp vertices next to non-scalp, above the brows, in front)"""
    from head_ratios import _masks
    from view_coverage import head_axes
    scalp, skin = _masks(); V, L = r["V"], r["V"][r["lid"]]
    iod = np.linalg.norm(L[33] - L[263])
    d = np.min(np.linalg.norm(V[:, None] - L[None, ::4], axis=2), 1)   # every 4th landmark is dense enough for 0.25 IOD
    face = skin & ~scalp & (d < 0.25 * iod)
    c, x, up, fw = head_axes(L); eye = (L[33] + L[263]) / 2
    nb = np.zeros(len(V), bool)
    for a, b in ((0, 1), (1, 2), (2, 0)):
        e = r["F"][:, [a, b]]; cut = scalp[e[:, 0]] != scalp[e[:, 1]]
        nb[e[cut].ravel()] = True
    H = (eye - L[152]) @ up   # eye line .. chin; above 0.4 H drops the eye sockets / brows (scalp_vertices also borders the eyes)
    hair = scalp & nb & ((V - eye) @ up > 0.4 * H) & ((V - c) @ fw > 0)
    if r.get("hairline") is not None and not template:
        hair = np.zeros(len(V), bool); hair[r["hairline"]] = True
    if template: r["curve"] = None
    r["hairmask"] = scalp.copy()   # --cap: the area painted as hair
    if r.get("hair_ids") is not None and not template: r["hairmask"] = np.zeros(len(V), bool); r["hairmask"][r["hair_ids"]] = True
    return {"face": face, "scalp": scalp, "hair": hair, "iod": iod, "axes": (c, x, up, fw)}


def outward_normals(V, F, skin):
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]); n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    sk = skin[F].all(1); cen = V[F].mean(1)
    if ((cen[sk] - V[skin].mean(0)) * n[sk]).sum(1).mean() < 0: n = -n
    return n


def raster(uv, depth, F, facing, shade, shape, colors=None):
    """painter's algorithm (far first): gray (or per-face BGR colors x shading) image, silhouette mask, nearest depth"""
    import cv2
    img = np.full(shape + (3,), 40, np.uint8); mask = np.zeros(shape, np.uint8); zb = np.full(shape, np.inf, np.float32)
    k = np.where(facing)[0]; k = k[np.argsort(-depth[F[k]].mean(1))]
    P = np.round(uv[F]).astype(np.int32); zf = depth[F].mean(1).astype(np.float32)
    for t in k:
        s = max(0.0, float(shade[t]))
        col = (int(55 + 190 * s ** 0.8),) * 3 if colors is None else tuple(int(c) for c in colors[t] * (0.35 + 0.65 * s))
        cv2.fillConvexPoly(img, P[t], col); cv2.fillConvexPoly(mask, P[t], 255); cv2.fillConvexPoly(zb, P[t], float(zf[t]))
    return img, mask, zb


HAIR_BGR = np.array([34, 36, 42.0])
_TPL = {}


def cap_colors(r):
    """--cap: per-face BGR - the run's baked texture (model/tex_*.png at the face's UV centre; light gray without one) and
    the hair area (hairmask: hairline.json "hair", or the template scalp) in a dark hair colour: a hair cap that follows
    the hairline, to judge the line on a face"""
    import cv2
    from uv_bake import GROUPS, TEMPLATE
    if "d" not in _TPL: _TPL["d"] = np.load(TEMPLATE)
    d = _TPL["d"]; F = r["F"]; UV = d["vertex_uvs"]; UT = d["uv_triangles"]; mat = d["materials"]
    col = np.full((len(F), 3), 200.0)
    for name, mats, _ in GROUPS:
        tx = cv2.imread(f"{r['tex']}_{name}.png")
        if tx is None: continue
        sel = np.isin(mat[F], mats).all(1); uv = UV[UT[sel]].mean(1); ts = tx.shape[0]
        col[sel] = tx[np.clip(((1 - uv[:, 1]) * (ts - 1)).astype(int), 0, ts - 1), np.clip((uv[:, 0] * (ts - 1)).astype(int), 0, tx.shape[1] - 1)]
    col[r["hairmask"][F].sum(1) >= 2] = HAIR_BGR
    return col


def visible(uv, depth, zb, tol):
    h, w = zb.shape; u = np.round(uv).astype(int)
    ok = (u[:, 0] >= 0) & (u[:, 0] < w) & (u[:, 1] >= 0) & (u[:, 1] < h)
    v = np.zeros(len(uv), bool); v[ok] = depth[ok] <= zb[u[ok, 1], u[ok, 0]] + tol
    return v


def contour(img, mask, col, th=2):
    import cv2
    cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE); cv2.drawContours(img, cs, -1, col, th)


def dots(img, uv, sel, col, r=2):
    import cv2
    for p in np.round(uv[sel]).astype(int): cv2.circle(img, (int(p[0]), int(p[1])), r, col, -1)


def hairline_mark(img, r, uv, depth, zb, proj, tol, col, th=2):
    """the run's smoothed hairline curve (hairline.json) as a line through its visible points, else dots on the hairline
    vertices; proj(X) -> (uv, depth) of 3D points"""
    import cv2
    if r.get("curve") is None or not len(r["curve"]):
        dots(img, uv, r["hair"] & visible(uv, depth, zb, tol), col); return
    # the curve points are interpolated between vertices (slightly under the surface): seen almost edge-on at the top of
    # the head they failed the 1x tolerance and the line had gaps (by01, 11/3)
    cu, cd = proj(r["curve"]); vis = visible(cu, cd, zb, 2 * tol); P = np.round(cu).astype(int)
    for i in range(len(P) - 1):
        if vis[i] and vis[i + 1]: cv2.line(img, tuple(map(int, P[i])), tuple(map(int, P[i + 1])), col, th, cv2.LINE_AA)


def label(img, text):
    import cv2
    (w, h), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
    cv2.rectangle(img, (0, 0), (w + 12, h + 12), (0, 0, 0), -1)
    cv2.putText(img, text, (6, h + 6), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)


VIEWS = {"front": lambda x, up, fw: (x, up, fw), "right 90": lambda x, up, fw: (fw, up, -x), "top": lambda x, up, fw: (-x, fw, up)}
R45 = np.sqrt(0.5)
CAP_VIEWS = {"front": VIEWS["front"], "right 45": lambda x, up, fw: (R45 * (x + fw), up, R45 * (fw - x)),
             "right 90": VIEWS["right 90"], "left 45": lambda x, up, fw: (R45 * (x - fw), up, R45 * (fw + x))}


def gray_views(A, B, regA, S=360, cap=False):
    """rows of [before | after] per view, in the before mesh's head axes (rows of R: image right, image up, toward camera);
    cap: textured with the hair area painted (cap_colors), front / 45 / 90 / other 45"""
    c, x, up, fw = regA["axes"]; skin = regA["face"] | regA["scalp"]
    span = np.ptp((A["V"][skin] - c) @ np.stack([x, up, fw]).T, 0).max(); ext = 0.62 * span
    cen = A["V"][skin].mean(0); rows = []
    cols = [cap_colors(r) for r in [A] + ([B] if B else [])] if cap else [None, None]
    for name, f in (CAP_VIEWS if cap else VIEWS).items():
        R = np.stack(f(x, up, fw)); tiles, masks, hl = [], [], []
        def proj(X, R=R):
            P = (X - cen) @ R.T
            return np.stack([(P[:, 0] / ext * 0.5 + 0.5) * S, (0.5 - P[:, 1] / ext * 0.5) * S], 1), -P[:, 2]
        for i, r in enumerate([A] + ([B] if B else [])):
            uv, depth = proj(r["V"])
            n = outward_normals(r["V"], r["F"], skin) @ R.T
            img, mask, zb = raster(uv, depth, r["F"], n[:, 2] > 0, n @ (np.array([0.3, 0.4, 1.0]) / 1.17), (S, S), cols[i])
            tiles.append(img); masks.append(mask); hl.append((r, uv, depth, zb))
        if cap:   # the painted hair edge is the hairline: no lines on top
            label(tiles[0], f"{name}  before");
            if B: label(tiles[1], f"{name}  after")
            rows.append(np.concatenate(tiles, 1)); continue
        tol = 0.05 * regA["iod"]
        hairline_mark(tiles[0], *hl[0], proj, tol, YELLOW)
        if B:   # after tile: both outlines and both hairlines
            contour(tiles[1], masks[0], RED); contour(tiles[1], masks[1], GREEN)
            hairline_mark(tiles[1], *hl[0], proj, tol, RED); hairline_mark(tiles[1], *hl[1], proj, tol, GREEN)
        label(tiles[0], f"{name}  before")
        if B: label(tiles[1], f"{name}  after  red=before green=after")
        rows.append(np.concatenate(tiles, 1))
    return rows


def photo_views(A, B, regA, W=360, H=440):
    """capture frames closest to front / right 90 / left 90 / highest camera, outlines with the before run's cameras;
    two rows of two tiles"""
    import cv2, pycolmap
    from frame_check import intrinsics, load_poses
    rec = pycolmap.Reconstruction(A["sparse"]); poses = load_poses(A["poses"]) or {}
    c, x, up, fw = regA["axes"]; cam_pose = {}
    for im in rec.images.values():
        if A["poses"] and im.name not in poses: continue
        if not os.path.exists(os.path.join(A["images"], im.name)): continue
        if im.name in poses: Rm, t = poses[im.name]
        else: T = im.cam_from_world(); Rm, t = T.rotation.matrix(), T.translation
        d = -Rm.T @ t - c; d /= np.linalg.norm(d)
        cam_pose[im.name] = (Rm, t, im.camera_id, np.degrees(np.arctan2(d @ x, d @ fw)), np.degrees(np.arcsin(np.clip(d @ up, -1, 1))))
    if not cam_pose: return [], []
    picks, picked = [], []
    for name, (yw, el) in (("front", (0, 0)), ("right 90", (-90, 0)), ("left 90", (90, 0))):
        picks.append((name, min(cam_pose, key=lambda k: abs(cam_pose[k][3] - yw) + abs(cam_pose[k][4] - el))))
    picks.append(("highest", max(cam_pose, key=lambda k: cam_pose[k][4])))   # crown; registered head-down frames only
    skin = regA["face"] | regA["scalp"]; tiles = []
    for name, fr in picks:
        Rm, t, cid, yw, el = cam_pose[fr]; f, cx, cy = intrinsics(rec.cameras[cid])
        img = cv2.imread(os.path.join(A["images"], fr)); out = img.copy(); box = []
        def proj(X, Rm=Rm, t=t, f=f, cx=cx, cy=cy):
            Q = X @ Rm.T + t
            return np.stack([f * Q[:, 0] / Q[:, 2] + cx, f * Q[:, 1] / Q[:, 2] + cy], 1), Q[:, 2]
        for r, col in [(A, RED)] + ([(B, GREEN)] if B else []):
            uv, depth = proj(r["V"]); Q = r["V"] @ Rm.T + t
            n = outward_normals(r["V"], r["F"], skin) @ Rm.T; cen = Q[r["F"]].mean(1)
            facing = (n * -cen).sum(1) > 0
            _, mask, zb = raster(uv, depth, r["F"], facing, np.ones(len(r["F"])), img.shape[:2])
            contour(out, mask, col); hairline_mark(out, r, uv, depth, zb, proj, 0.05 * regA["iod"], col, 3)
            box.append(uv[skin])
        b = np.concatenate(box); (x0, y0), (x1, y1) = b.min(0), b.max(0); w, h = x1 - x0, y1 - y0
        x0, x1 = int(max(x0 - 0.2 * w, 0)), int(min(x1 + 0.2 * w, img.shape[1])); y0, y1 = int(max(y0 - 0.3 * h, 0)), int(min(y1 + 0.15 * h, img.shape[0]))
        tile = out[y0:y1, x0:x1]; s = min(W / tile.shape[1], H / tile.shape[0])
        tile = cv2.resize(tile, (int(tile.shape[1] * s), int(tile.shape[0] * s)))
        tile = cv2.copyMakeBorder(tile, 0, H - tile.shape[0], 0, W - tile.shape[1], cv2.BORDER_CONSTANT, value=(40, 40, 40))
        label(tile, f"photo {name}  yaw {yw:.0f}  elev {el:.0f}"); tiles.append(tile); picked.append([name, fr, round(yw), round(el)])
    return [np.concatenate(tiles[:2], 1), np.concatenate(tiles[2:], 1)], picked


def numbers(A, B, regA, regB):
    from head_ratios import measures, load_range
    rng = load_range()["ratios"]; out = {"ratios": {}, "range": {k: (v["p5"], v["p95"], v["p0.5"], v["p99.5"]) for k, v in rng.items()}}
    for tag, r in (("before", A), ("after", B)):
        if r: out["ratios"][tag] = measures(r["V"], r["lid"])
    if B:
        fa = regA["face"] & regB["face"]
        s, R, t = umeyama(B["V"][fa], A["V"][fa]); Vb = s * B["V"] @ R.T + t
        e = np.linalg.norm(Vb - A["V"], axis=1) / regA["iod"] * 100
        out["face"] = [round(float(np.median(e[fa])), 2), round(float(np.percentile(e[fa], 95)), 2), round(float(e[fa].max()), 2)]
        out["face_same"] = out["face"][0] < FACE_SAME[0] and out["face"][1] < FACE_SAME[1]
        sc = regA["scalp"]; out["scalp"] = [round(float(np.median(e[sc])), 2), round(float(np.percentile(e[sc], 95)), 2), round(float(e[sc].max()), 2)]
        B["V"] = Vb   # drawn in the before run's frame
        if B.get("curve") is not None: B["curve"] = s * B["curve"] @ R.T + t
    return out


def sheet(Wa, Wb, out_dir, template_before=False, cap=False):
    import cv2
    A = load_run(Wa); B = load_run(Wb) if Wb else None
    if B and len(B["V"]) != len(A["V"]): raise SystemExit(f"{Wa} / {Wb}: different topology")
    regA = regions(A, template_before); A.update(hair=regA["hair"])
    regB = regions(B) if B else None
    if B: B.update(hair=regB["hair"])
    num = numbers(A, B, regA, regB)
    rows = gray_views(A, B, regA, cap=cap)
    ph, picked = photo_views(A, B, regA)
    rows += ph
    W = max(r.shape[1] for r in rows)
    img = np.concatenate([cv2.copyMakeBorder(r, 0, 4, 0, W - r.shape[1], cv2.BORDER_CONSTANT) for r in rows], 0)
    name = (B or A)["id"]; os.makedirs(out_dir, exist_ok=True)
    cv2.imwrite(os.path.join(out_dir, name + ".jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return {"name": name, "before": Wa, "after": Wb, "chosen": [A["chosen"], B["chosen"] if B else None], "frames": picked, **num}


LABELS = {"crown_h": "정수리 높이", "temple_over_zyg": "관자놀이 폭 / 광대 폭", "zyg_over_H": "광대 폭", "back": "뒤통수 깊이"}


def index(rows, out_dir):
    def cell(k, v, rg):
        p5, p95, lo, hi = rg; flag = "out" if not lo <= v <= hi else ("edge" if not p5 <= v <= p95 else "")
        return f'<td class="{flag}">{v:.3f}</td>'
    h = ['<!doctype html><meta charset="utf-8"><title>두상 전후 비교</title><style>body{font:14px sans-serif;margin:16px;max-width:1500px}'
         'table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #ccc;padding:3px 8px;text-align:right}'
         '.edge{background:#fff3c4}.out{background:#f8c4c4}img{max-width:100%;border:1px solid #ccc}h2{margin-top:32px}</style>',
         '<h1>두상 전후 비교</h1><p>빨강 = 고치기 전, 초록 = 고친 후, 점 = 헤어라인. 노란 칸 = 사람 머리 범위(GNM) 5~95 % 밖, '
         '빨간 칸 = 0.5~99.5 % 밖. 얼굴 변화가 "같음"이면 눈·코·입은 그대로(중앙값 0.5 %, p95 1.5 % IOD 미만).</p>']
    for r in rows:
        h.append(f'<h2>{html.escape(r["name"])}</h2><p>before {html.escape(r["before"])} ({r["chosen"][0]})'
                 + (f' / after {html.escape(r["after"])} ({r["chosen"][1]})' if r["after"] else "") + "</p>")
        h.append("<table><tr><th></th>" + "".join(f"<th>{t}</th>" for t in r["ratios"]) + "<th>범위 p5~p95</th></tr>")
        for k, lab in LABELS.items():
            h.append(f"<tr><th>{lab}</th>" + "".join(cell(k, r["ratios"][t][k], r["range"][k]) for t in r["ratios"])
                     + f"<td>{r['range'][k][0]:.3f} ~ {r['range'][k][1]:.3f}</td></tr>")
        h.append("</table>")
        if r.get("face"):
            h.append(f'<p>얼굴 변화 (중앙값 / p95 / 최대, % IOD): {r["face"][0]} / {r["face"][1]} / {r["face"][2]} → '
                     f'<b>{"같음" if r["face_same"] else "달라짐"}</b>. 두피 변화: {r["scalp"][0]} / {r["scalp"][1]} / {r["scalp"][2]}</p>')
        if r["frames"]:
            h.append("<p>사진 프레임: " + ", ".join(f"{n} {html.escape(f)} (yaw {y}°, 높이 {e}°)" for n, f, y, e in r["frames"]) + "</p>")
        h.append(f'<img src="{html.escape(r["name"])}.jpg">')
    open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8").write("\n".join(h))
    json.dump(rows, open(os.path.join(out_dir, "head_compare.json"), "w"), indent=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="*", help="runs shown alone (before only)")
    ap.add_argument("--pair", nargs=2, action="append", default=[], metavar=("BEFORE", "AFTER"))
    ap.add_argument("--ids", help="comma list, with --before / --after patterns containing {id}")
    ap.add_argument("--before", default="work/hc-{id}"); ap.add_argument("--after")
    ap.add_argument("--out", default="work/_compare/head")
    ap.add_argument("--cap", action="store_true", help="hair-cap preview: the model's texture with the hair area painted "
                    "dark (hairline.json, template scalp on the before side with --template-before), front / 45 / 90 / 45")
    ap.add_argument("--template-before", action="store_true", help="before side draws the template hairline even when the "
                    "run has model/hairline.json (hairline step: --pair work/<id> work/<id>, same model, template vs detected)")
    a = ap.parse_args()
    pairs = [(p[0], p[1]) for p in a.pair] + [(w, None) for w in a.runs]
    if a.ids: pairs += [(a.before.format(id=i), a.after.format(id=i) if a.after else None) for i in a.ids.split(",") if i]
    if not pairs: ap.error("nothing to compare")
    rows = []
    for Wa, Wb in pairs:
        rows.append(sheet(Wa, Wb, a.out, a.template_before, a.cap)); r = rows[-1]
        print(f"{r['name']}: " + (f"face {r['face']} {'SAME' if r['face_same'] else 'CHANGED'}, scalp {r['scalp']}, " if r.get("face") else "")
              + ", ".join(f"{t} crown {v['crown_h']} temple {v['temple_over_zyg']}" for t, v in r["ratios"].items()), flush=True)
    index(rows, a.out)
    print("->", os.path.join(a.out, "index.html"))


if __name__ == "__main__":
    main()
