"""Tracing images (10/22, 만두: "이미지 제공하면 내가 눈 구조를 선으로 따서 반환"): for a few camera angles, the PHOTO eye-region crop
and the grey model rendered from THE SAME CAMERA (same pixels), so lines drawn on the photo can be compared with the model 1:1.
Lines traced by 만두 are a reference for understanding / evaluation only, never per-person values in the pipeline (rule 2).

views   front (|yaw| smallest, |pitch| < 10), 35 deg each side, 65 deg each side, chin down (pitch most positive = camera
        above) - picked from the frames with a checked camera pose (frame_poses.json), blink < 0.35
crop    both eyes + brows from the model landmarks projected into that frame (+ margin), upscaled x3 (nearest, no smoothing)
model   chosen fit of work/<id> ("now") and optionally work/<id>-lidp ("A"); skin + eyeballs, no lashes, grey
out     work/_trace/<id>/<view>_photo.png, <view>_now.png, <view>_A.png, <view>_sheet.png (photo | now | A) + views.json
        personal data: stays on this PC (work/ is git-ignored)
usage   python tools/trace_sheet.py <id> [--no-a] [--scale 3]
"""
import argparse, json, os, sys
import numpy as np
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, os.path.join(ROOT, "pipeline"))
import meshio  # noqa: E402
from render import render  # noqa: E402

T = np.load(os.path.join(ROOT, "assets", "gnm-template-v2.npz")); MAT = T["materials"]
EYE_LM = [33, 133, 263, 362, 159, 145, 386, 374, 70, 63, 105, 66, 107, 300, 293, 334, 296, 336, 46, 276]


def load_fit(w):
    M = os.path.join(ROOT, "work", w, "model"); ch = json.load(open(os.path.join(M, "report.json"), encoding="utf-8")).get("chosen", "gnm")
    fit = meshio.read_any(os.path.join(M, f"fit_{ch}.ply")); V = np.asarray(fit["vertices"], np.float64)[:len(MAT)]
    F = np.asarray(T["triangles"], np.int64); lid = np.array(json.load(open(os.path.join(M, f"fit_{ch}.fit.json")))["landmark_vertex_ids"])
    return V, F[np.isin(MAT, [0, 4, 5, 6])[F].all(1)], lid, ch


def pick_views(W):
    poses = {k: v for k, v in json.load(open(os.path.join(W, "model", "frame_poses.json")))["frames"].items() if v.get("status") != "dropped"}
    prep = {i["file"]: i for i in json.load(open(os.path.join(W, "prep", "prepare.json"), encoding="utf-8"))["images"]}
    c = [(n, float(prep[n]["yaw"]), float(prep[n].get("pitch") or 0)) for n in poses if n in prep and prep[n].get("yaw") is not None and float(prep[n].get("blink") or 0) < 0.35]
    out = {}
    def best(key, cond):
        cc = [x for x in c if cond(x)]
        if cc: out[key] = min(cc, key=key_fn[key])
    key_fn = {"front": lambda x: abs(x[1]) + 0.5 * abs(x[2]), "yaw+35": lambda x: abs(x[1] - 35) + 0.5 * abs(x[2]), "yaw-35": lambda x: abs(x[1] + 35) + 0.5 * abs(x[2]),
              "yaw+65": lambda x: abs(x[1] - 65) + 0.5 * abs(x[2]), "yaw-65": lambda x: abs(x[1] + 65) + 0.5 * abs(x[2]), "chin_down": lambda x: -x[2] + 0.3 * abs(x[1])}
    best("front", lambda x: abs(x[2]) < 10); best("yaw+35", lambda x: 25 < x[1] < 45); best("yaw-35", lambda x: -45 < x[1] < -25)
    best("yaw+65", lambda x: 55 < x[1] < 78); best("yaw-65", lambda x: -78 < x[1] < -55); best("chin_down", lambda x: x[2] > 8 and abs(x[1]) < 20)
    return out, poses


def cam_render(V, F, R, t, f, box, k):
    """grey render of V from camera (R, t, f, principal point) covering the photo pixel box (x0, y0, w, h, cx, cy), upscaled k"""
    x0, y0, w, h, cx, cy = box; S = int(k * max(w, h))
    Xc = V @ R.T + t; z = Xc[:, 2:3]
    ax = (k * (cx - x0) - S / 2) / (k * f); ay = (k * (cy - y0) - S / 2) / (k * f)
    Xs = Xc.copy(); Xs[:, 0] += ax * z[:, 0]; Xs[:, 1] += ay * z[:, 0]           # shift the principal point to the crop origin (exact projection)
    Rv = np.diag([1.0, -1.0, -1.0])                                                  # screen right = cam x, up = -cam y, toward camera = -cam z
    img = render(Xs, F, view=Rv, size=S, center=np.zeros(3), persp=(0.0, k * f), light=(0.2, 0.35, 1.0))
    return img[: int(k * h), : int(k * w)]


def main():
    import cv2, pycolmap
    sys.path.insert(0, os.path.join(ROOT, "pipeline"))
    from frame_check import intrinsics
    ap = argparse.ArgumentParser(); ap.add_argument("id"); ap.add_argument("--no-a", action="store_true"); ap.add_argument("--scale", type=int, default=3)
    a = ap.parse_args()
    W = os.path.join(ROOT, "work", a.id); out = os.path.join(ROOT, "work", "_trace", a.id); os.makedirs(out, exist_ok=True)
    rec = pycolmap.Reconstruction(os.path.join(W, "colmap", "sparse_lens_anchored")); f, cx, cy = intrinsics(list(rec.cameras.values())[0])
    meshes = {"now": load_fit(a.id)}
    if not a.no_a and os.path.exists(os.path.join(ROOT, "work", a.id + "-lidp", "model", "report.json")): meshes["A"] = load_fit(a.id + "-lidp")
    views, poses = pick_views(W); info = {"id": a.id, "focal_px": f, "scale": a.scale, "models": {k: v[3] for k, v in meshes.items()}, "views": {}}
    V0, _, lid0, _ = meshes["now"]
    for key, (n, yaw, pitch) in views.items():
        R = np.asarray(poses[n]["R"], np.float64); t = np.asarray(poses[n]["t"], np.float64)
        P = (V0[lid0[EYE_LM]] @ R.T + t); uv = np.c_[f * P[:, 0] / P[:, 2] + cx, f * P[:, 1] / P[:, 2] + cy]
        iod = np.linalg.norm(uv[0] - uv[2]) if abs(yaw) < 50 else 0.5 * (uv[:, 0].max() - uv[:, 0].min()) + 1
        im = cv2.imread(os.path.join(W, "prep", "images", n)); H, Wd = im.shape[:2]
        m = 0.22 * max(iod, 40)
        x0 = int(max(0, uv[:, 0].min() - m)); x1 = int(min(Wd, uv[:, 0].max() + m)); y0 = int(max(0, uv[:, 1].min() - m)); y1 = int(min(H, uv[:, 1].max() + m))
        crop = cv2.resize(im[y0:y1, x0:x1], ((x1 - x0) * a.scale, (y1 - y0) * a.scale), interpolation=cv2.INTER_NEAREST)
        cv2.imwrite(os.path.join(out, f"{key}_photo.png"), crop); tiles = [crop]
        for name, (V, F, lid, ch) in meshes.items():
            g = cam_render(V, F, R, t, f, (x0, y0, x1 - x0, y1 - y0, cx, cy), a.scale)[:, :, ::-1]
            cv2.imwrite(os.path.join(out, f"{key}_{name}.png"), g); tiles.append(g)
        hh = min(x.shape[0] for x in tiles); sheet = np.hstack([x[:hh] for x in tiles])
        for i, lab in enumerate(["photo"] + [f"{k} ({v[3]})" for k, v in meshes.items()]):
            cv2.putText(sheet, lab, (10 + i * tiles[0].shape[1], 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 255), 3)
        cv2.imwrite(os.path.join(out, f"{key}_sheet.png"), sheet)
        info["views"][key] = {"frame": n, "yaw": round(yaw, 1), "pitch": round(pitch, 1), "crop_px": [x0, y0, x1 - x0, y1 - y0]}
    json.dump(info, open(os.path.join(out, "views.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(json.dumps(info, ensure_ascii=False))


if __name__ == "__main__":
    main()
