"""Add contour (광대·턱끝·볼살·사각턱) morph targets to an exported head GLB; geometry and textures stay as they are.

Usage: python tools/contour_morphs.py in.glb out.glb [--report out.json]

The GLB must keep GNM template topology (`_TEMPLATE_INDEX` on every vertex), as export_glb.py writes it. Each
effect is a smooth displacement field around template anchors (MediaPipe 468 points and a jaw border line), so
no per-person numbers are set by hand. The jaw line is re-found on THIS model (where the skin turns under the jaw)
because the real border sits up to ~1.5 cm off the template line near the angle (PoC 11/03, 6 test captures).

Targets are written as `<code>_neg` / `<code>_pos` pairs (apps/web morphTargets.ts reads the pair by sign). The end
size is a provisional demo range, not a clinical one; unsafe pairs are omitted per model. Personal output is face
geometry: keep it beside the private model, never in Git.
"""

import argparse
import json
import os
import struct
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(os.path.dirname(HERE), "assets", "gnm-template-v2.npz")

# public codes -> (field, gain) parts. Order = target order in the GLB.
CONTOUR_EFFECTS = {
    "contour.cheekbone": [("malar", 1.0), ("zygoma", 1.0)],
    "contour.chin_projection": [("chin_proj", 1.0)],
    "contour.chin_length": [("chin_len", 1.0)],
    "contour.chin_width": [("chin_width", 1.0)],
    "contour.cheek_volume": [("cheek_fat", 1.0)],
    # x0.8 so its end (~6 mm on the sample head) matches the others; jaw line : muscle stays 1 : 0.6
    "contour.jaw_angle": [("jaw_line", 0.8), ("masseter", 0.48)],
}
WEIGHT_SHAPE_CODE = "contour.weight_shape"
WEIGHT_SHAPE_PARTS = [("cheek_fat", 1.0), ("masseter", 1.0), ("neck_soft", 1.0)]
WEIGHT_PROTECTED = ("left_eye", "right_eye", "upper_lip", "lower_lip", "nose_region", "ears")
CONTOUR_PROTECTED = ("left_eye", "right_eye", "nose_region")
SPATIAL_CONTOURS = {"contour.cheekbone", "contour.jaw_angle"}
# end size of the slider. 11/04: the PoC demo used 1.8 for visibility, which left ends of 9-13 mm on the sample
# head, about twice the nose (2.6-5.8 mm, nose-engine UI caps <= 6 mm). 1.0 = the field design values: every
# contour end is now ~3-6 mm, in line with the nose. Not a measured or clinical range.
END_GAIN = 1.0


def normals(v, f):
    n = np.zeros_like(v)
    t = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    for k in range(3):
        np.add.at(n, f[:, k], t)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def gauss(p, c, sig):
    q = (p - np.asarray(c)) / np.asarray(sig)
    return np.exp(-.5 * (q ** 2).sum(1))


def seg_dist(p, pts):
    best = np.full(len(p), np.inf)
    for a, b in zip(pts[:-1], pts[1:]):
        a, b = np.asarray(a), np.asarray(b)
        u = np.clip(((p - a) @ (b - a)) / ((b - a) @ (b - a)), 0, 1)
        best = np.minimum(best, np.linalg.norm(p - (a + u[:, None] * (b - a)), axis=1))
    return best


def contour_fields(v0, f, mat, geo=None):
    """Template-space deltas {field: (neg, pos)}, each (n_template, 3). geo = the model's positions in the template
    frame (same vertex order) for the jaw line; None = the template itself."""
    skin = (mat == 0).astype(float)
    n0 = normals(v0, f)
    x, y, z = v0.T
    s = np.where(x >= 0, 1.0, -1.0)
    ax = np.abs(x)
    P = np.c_[ax, y, z]
    ear_lobe = np.array([.074, .255, .02])
    not_ear = smoothstep(.012, .03, np.linalg.norm(P - ear_lobe, axis=1)) * smoothstep(-.01, .02, z)
    facing = smoothstep(-.2, .3, n0[:, 2] + .6 * np.abs(n0[:, 0]))
    mask = skin * not_ear
    edges = np.r_[f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]]
    edges = np.r_[edges, edges[:, ::-1]]
    deg = np.maximum(np.bincount(edges[:, 0], minlength=len(v0)), 1).astype(float)

    def relax(w, iters):
        for _ in range(iters):
            acc = np.zeros_like(w)
            np.add.at(acc, edges[:, 0], w[edges[:, 1]])
            w = .5 * w + .5 * acc / deg
        return w

    def relaxed(w0, iters, keep):
        w = relax(w0, iters) * keep
        return w * (w0.max() / max(w.max(), 1e-9))

    mouth_still = smoothstep(.022, .040, np.linalg.norm((P - [0, .228, .125]) * [1, 1.4, 1], axis=1)) * \
        smoothstep(.004, .02, ax)
    zero = lambda: np.zeros_like(v0)  # noqa: E731
    F = {}

    # 앞광대: 줄이기 = 안쪽 + 위쪽 (상방이동) / 키우기 = 바깥쪽. Fades out below the lower lid.
    w = gauss(P, [.056, .268, .098], [.020, .016, .020]) * mask * facing * (1 - smoothstep(.266, .298, y))
    neg, pos = zero(), zero()
    neg[:] = -n0 * (.0030 * w)[:, None]
    neg[:, 1] += .0010 * w
    pos[:] = n0 * (.0030 * w)[:, None]
    F["malar"] = (neg, pos)

    # 옆광대: horizontal arch at cheekbone level, zero at its root by the ear, temple stays.
    arch = np.exp(-.5 * (seg_dist(P, [[.071, .281, .028], [.073, .278, .050], [.068, .274, .075],
                                      [.060, .271, .092]]) / .016) ** 2)
    w = arch * smoothstep(.024, .058, z) * smoothstep(.232, .252, y) * (1 - smoothstep(.288, .308, y)) * skin
    neg, pos = zero(), zero()
    neg[:, 0] = -s * .0035 * w
    pos[:, 0] = s * .0035 * w
    F["zygoma"] = (neg, pos)

    # 턱끝 앞뒤: chin + part of the mandible body
    border = np.array([[0, .1865, .118], [.022, .189, .112], [.040, .196, .093], [.052, .203, .065],
                       [.056, .208, .035]])
    bl = np.linalg.norm(np.diff(border, axis=0), axis=1)
    bc = np.r_[0, np.cumsum(bl)] / bl.sum()
    jd = np.full(len(P), np.inf)
    jt = np.zeros(len(P))
    for i in range(len(border) - 1):
        a, b = border[i], border[i + 1]
        u = np.clip(((P - a) @ (b - a)) / ((b - a) @ (b - a)), 0, 1)
        dd = np.linalg.norm(P - (a + u[:, None] * (b - a)), axis=1)
        m = dd < jd
        jd[m], jt[m] = dd[m], bc[i] + u[m] * (bc[i + 1] - bc[i])
    wc = gauss(np.c_[x, y, z], [0, .192, .12], [.020, .015, .03]) * mask
    wb = np.exp(-.5 * (jd / .016) ** 2) * mask * np.exp(-.5 * ((jt - .35) / .2) ** 2) * .45
    w = np.maximum(wc, wb)
    neg, pos = zero(), zero()
    neg[:, 2] = -.0035 * w
    pos[:, 2] = .0045 * w
    F["chin_proj"] = (neg, pos)

    # 턱끝 길이: 짧게 = 위로 / 길게 = 아래로(+약간 앞)
    w = gauss(np.c_[x, y, z], [0, .188, .115], [.022, .016, .035]) * mask
    neg, pos = zero(), zero()
    neg[:, 1] = .0035 * w
    pos[:, 1] = -.0045 * w
    pos[:, 2] = .0012 * w
    F["chin_len"] = (neg, pos)

    # 턱끝 폭: toward the midline
    w = gauss(np.c_[x, y, z], [0, .19, .115], [.030, .016, .04]) * mask
    neg, pos = zero(), zero()
    neg[:, 0] = -x * .28 * w
    pos[:, 0] = x * .28 * w
    F["chin_width"] = (neg, pos)

    # 사각턱: long-curve angle reduction feel. Line chin -> lower border -> angle -> up the ramus, re-found on this
    # model; the region around the angle moves in + up (+ a little forward), most at the angle, one smooth field.
    ramus = np.array([[0, .1865, .118], [.022, .189, .112], [.040, .196, .093], [.052, .203, .065],
                      [.056, .208, .035], [.059, .223, .028], [.062, .240, .024]])
    rl = np.linalg.norm(np.diff(ramus, axis=0), axis=1)
    rc = np.r_[0, np.cumsum(rl)] / rl.sum()
    K = 48
    tk = np.linspace(0, 1, K)
    k_angle = int(np.argmin(np.abs(tk - rc[4])))
    t_angle = tk[k_angle]
    shape = v0 if geo is None else geo

    def samples(side):
        pts = np.array([np.interp(tk, rc, ramus[:, j]) for j in range(3)]).T
        pts[:, 0] *= side
        return pts

    def turn(pos_, nrm, pts):
        found = np.full_like(pts, np.nan)
        for k, c in enumerate(pts):
            sel = np.where((skin > 0) & (np.abs(pos_[:, 0] - c[0]) < .006) & (np.abs(pos_[:, 2] - c[2]) < .008)
                           & (np.abs(pos_[:, 1] - c[1]) < .03))[0]
            if len(sel) > 3:
                found[k] = pos_[sel[np.argmin(np.abs(nrm[sel, 1] + .45))]]
        return found

    lines = {}
    for side in (1, -1):
        base = samples(side)
        if geo is None:
            lines[side] = base
            continue
        d = turn(geo, normals(geo, f), base) - turn(v0, n0, base)
        d[:, 0] = 0
        d[tk > t_angle] = np.nan
        for j in (1, 2):
            ok = ~np.isnan(d[:, j])
            d[:, j] = np.interp(tk, tk[ok], d[ok, j]) if ok.any() else 0
        d = np.array([np.convolve(d[:, j], np.ones(7) / 7, mode="same") for j in range(3)]).T
        d[tk > t_angle] = d[k_angle] * (1 - (tk[tk > t_angle] - t_angle) / (1 - t_angle))[:, None]
        lines[side] = base + np.clip(d, -.015, .015)
    rd = np.full(len(v0), np.inf)
    rt = np.zeros(len(v0))
    for side, pts in lines.items():
        on = np.where(s == side)[0]
        Q = shape[on]
        for i in range(K - 1):
            a, b = pts[i], pts[i + 1]
            u = np.clip(((Q - a) @ (b - a)) / ((b - a) @ (b - a)), 0, 1)
            dd = np.linalg.norm(Q - (a + u[:, None] * (b - a)), axis=1)
            m = dd < rd[on]
            rd[on[m]], rt[on[m]] = dd[m], tk[i] + u[m] * (tk[i + 1] - tk[i])
    y_angle = np.mean([lines[sd][k_angle, 1] for sd in lines])
    share = np.where(rt <= t_angle, smoothstep(.15, t_angle, rt), 1 - smoothstep(t_angle, 1, rt))
    cheek_still = 1 - smoothstep(y_angle + .034, y_angle + .064, shape[:, 1])
    w = relaxed(np.exp(-.5 * (rd / .019) ** 2) * share * mask, 80, mask * mouth_still * cheek_still)
    neg, pos = zero(), zero()
    neg[:, 0], neg[:, 1], neg[:, 2] = -s * .0048 * w, .0032 * w, .0014 * w
    pos[:, 0], pos[:, 1], pos[:, 2] = s * .0048 * w, -.0026 * w, -.0012 * w
    F["jaw_line"] = (neg, pos)

    # 턱 근육(교근): bulk above the angle, sideways only
    w = relaxed(gauss(P, [.060, .226, .048], [.016, .026, .024]) * mask, 80, mask * mouth_still)
    neg, pos = zero(), zero()
    neg[:, 0] = -s * .0034 * w
    pos[:, 0] = s * .0034 * w
    F["masseter"] = (neg, pos)

    # 볼살: soft tissue just under the cheekbone (landmarks 207/187); fades out before the cheekbone itself and the
    # nasolabial fold; the mouth lining stays (11/04: moved up from the mouth-side cheek)
    under = (1 - smoothstep(.256, .270, y)) * smoothstep(.028, .040, ax) * smoothstep(.072, .084, z)
    w = relaxed(gauss(P, [.050, .248, .104], [.014, .012, .018]) * mask * facing * under, 40,
                mask * mouth_still * under)
    neg, pos = zero(), zero()
    neg[:] = -n0 * (.0032 * w)[:, None]
    neg[:, 1] += .0008 * w
    pos[:] = n0 * (.0032 * w)[:, None]
    F["cheek_fat"] = (neg, pos)

    # 얼굴 볼륨 변화의 시각적 방향만 표현한다. 목 양 끝은 고정해 이음매를 움직이지 않는다.
    w = smoothstep(.07, .095, y) * (1 - smoothstep(.17, .205, y)) * skin
    neg, pos = zero(), zero()
    neg[:, 0] = -x * .05 * w
    neg[:, 2] = -(z - .01) * .05 * w
    pos[:, 0] = x * .05 * w
    pos[:, 2] = (z - .01) * .05 * w
    F["neck_soft"] = (neg, pos)
    return F


def umeyama(a, b):
    """b ~ s R a + t"""
    ma, mb = a.mean(0), b.mean(0)
    A, B = a - ma, b - mb
    U, S, Vt = np.linalg.svd(B.T @ A / len(a))
    D = np.eye(3)
    D[2, 2] = np.sign(np.linalg.det(U @ Vt))
    R = U @ D @ Vt
    scale = (S * np.diag(D)).sum() / (A ** 2).sum() * len(a)
    return scale, R, mb - scale * R @ ma


def read_glb(path):
    with open(path, "rb") as fh:
        data = fh.read()
    if len(data) < 28 or struct.unpack_from("<III", data) != (0x46546C67, 2, len(data)):
        raise ValueError("invalid GLB")
    json_size = struct.unpack_from("<I", data, 12)[0]
    glb = json.loads(data[20:20 + json_size])
    bin_size = struct.unpack_from("<I", data, 20 + json_size)[0]
    binary = bytearray(data[28 + json_size:28 + json_size + bin_size])
    return glb, binary


def accessor(glb, binary, index):
    a = glb["accessors"][index]
    view = glb["bufferViews"][a["bufferView"]]
    dtype = {5126: "<f4", 5125: "<u4", 5123: "<u2", 5121: "u1"}[a["componentType"]]
    width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
    off = view.get("byteOffset", 0) + a.get("byteOffset", 0)
    arr = np.frombuffer(bytes(binary[off:off + a["count"] * width * np.dtype(dtype).itemsize]), dtype)
    return arr.reshape(a["count"], width) if width > 1 else arr


def append_sparse(glb, binary, arr, floor):
    keep = np.where(np.abs(arr).max(1) > floor)[0].astype("<u4")
    acc = {"componentType": 5126, "count": int(arr.shape[0]), "type": "VEC3",
           "min": arr.min(0).tolist(), "max": arr.max(0).tolist()}
    if len(keep):
        views = []
        for chunk in (keep, arr[keep]):
            while len(binary) % 4:
                binary.append(0)
            off = len(binary)
            binary.extend(chunk.tobytes())
            glb["bufferViews"].append({"buffer": 0, "byteOffset": off, "byteLength": chunk.nbytes})
            views.append(len(glb["bufferViews"]) - 1)
        acc["sparse"] = {"count": int(len(keep)), "indices": {"bufferView": views[0], "componentType": 5125},
                         "values": {"bufferView": views[1]}}
    glb["accessors"].append(acc)
    return len(glb["accessors"]) - 1


def write_glb(glb, binary, path, *, exclusive=False):
    glb["buffers"][0]["byteLength"] = len(binary)
    js = json.dumps(glb, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    while len(binary) % 4:
        binary.append(0)
    with open(path, "xb" if exclusive else "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binary)))
        fh.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        fh.write(struct.pack("<II", len(binary), 0x004E4942) + bytes(binary))


def synthetic_protected_regions(v, mat):
    """GNM mean-head sample only: conservative template-space masks for the geometry audit."""
    skin = mat == 0
    x, y, z = v.T
    return {
        "left_eye": np.where(skin & (x > .025) & (y > .29) & (z > .07))[0].tolist(),
        "right_eye": np.where(skin & (x < -.025) & (y > .29) & (z > .07))[0].tolist(),
        "upper_lip": np.where(skin & (np.abs(x) < .02) & (y > .23) & (y < .245) & (z > .13))[0].tolist(),
        "lower_lip": np.where(skin & (np.abs(x) < .02) & (y > .215) & (y < .23) & (z > .13))[0].tolist(),
        "nose_region": np.where(skin & (np.abs(x) < .018) & (y > .255) & (y < .31) & (z > .12))[0].tolist(),
        "ears": np.where(skin & (np.abs(x) > .08) & (y > .22) & (y < .31))[0].tolist(),
    }


def protected_contour_fade(geometry, template_ids, regions):
    from scipy.spatial import cKDTree

    protected = np.unique(np.concatenate([regions[name] for name in CONTOUR_PROTECTED])).astype(int)
    if protected.min() < 0 or protected.max() >= len(geometry):
        raise ValueError("protected region outside template")
    distances = cKDTree(geometry[protected]).query(geometry[template_ids])[0]
    return smoothstep(0, .006, distances)[:, None]


def spatial_contour_weights(positions):
    from scipy.spatial import cKDTree

    # Nearby layers must share motion even when their triangles have no common edges.
    radius = .003  # metres in the fitted template frame
    tree = cKDTree(positions)
    weights = tree.sparse_distance_matrix(tree, radius, output_type="coo_matrix").tocsr()
    weights.data = (1 - (weights.data / radius) ** 2) ** 2
    return weights.multiply(1 / np.asarray(weights.sum(axis=1))).tocsr()


def add_contour_targets(in_path, out_path, *, synthetic_sample=False, weight_only=False, validate_final=True):
    tpl = np.load(TEMPLATE)
    v0, f, mat = tpl["vertices"].astype(float), tpl["triangles"].astype(int), tpl["materials"]
    glb, binary = read_glb(in_path)
    prims = {}
    for mi, mesh in enumerate(glb["meshes"]):
        p = mesh["primitives"][0]
        if "_TEMPLATE_INDEX" in p["attributes"]:
            prims[mesh["name"]] = (mi, p)
    if "skin" not in prims:
        raise ValueError("no skin primitive with _TEMPLATE_INDEX")
    skin_mesh = glb["meshes"][prims["skin"][0]]
    names = list(skin_mesh.get("extras", {}).get("targetNames") or [])
    if len(names) != len(prims["skin"][1].get("targets", [])):
        raise ValueError("target names do not match targets")
    weight_pair = {WEIGHT_SHAPE_CODE + suffix for suffix in ("_neg", "_pos")}
    existing_weight = [name for name in names if name in weight_pair]
    if existing_weight and (len(existing_weight) != 2 or set(existing_weight) != weight_pair):
        raise ValueError("incomplete or duplicate weight shape targets already present")
    existing_contour = [name for name in names if name.startswith("contour.") and name not in weight_pair]
    original_contour = {code + suffix for code in CONTOUR_EFFECTS for suffix in ("_neg", "_pos")}
    if existing_contour and (set(existing_contour) != original_contour or
                             len(existing_contour) != len(original_contour)):
        raise ValueError("unknown or incomplete contour targets already present")
    if existing_weight and (existing_contour or weight_only):
        raise ValueError("requested targets already present")
    pos_all = {k: accessor(glb, binary, p["attributes"]["POSITION"]).astype(float) for k, (_, p) in prims.items()}
    tid_all = {k: accessor(glb, binary, p["attributes"]["_TEMPLATE_INDEX"]).astype(int).ravel()
               for k, (_, p) in prims.items()}
    s, R, t = umeyama(v0[tid_all["skin"]], pos_all["skin"])
    geo = v0.copy()
    for k in prims:
        geo[tid_all[k]] = ((pos_all[k] - t) @ R) / s
    fields = contour_fields(v0, f, mat, geo)

    mi, prim = prims["skin"]
    tid = tid_all["skin"]
    pos = pos_all["skin"]
    tri = accessor(glb, binary, prim["indices"]).astype(int).reshape(-1, 3)
    base_n = normals(pos, tri)
    area0 = np.cross(pos[tri[:, 1]] - pos[tri[:, 0]], pos[tri[:, 2]] - pos[tri[:, 0]])
    weight_deltas = [s * (sum(fields[name][j] * gain for name, gain in WEIGHT_SHAPE_PARTS)[tid] @ R.T)
                     for j in (0, 1)]
    model = glb.get("asset", {}).get("extras", {}).get("live-mirror", {})
    if synthetic_sample and (model.get("synthetic") is not True or
                             model.get("name") != "bald-synthetic-editable-head" or
                             model.get("version") != 3):
        raise ValueError("not a supported synthetic sample")
    mouth_fade = contour_mouth_fade = None
    if synthetic_sample or (not existing_contour and not weight_only):
        landmarks = model.get("landmark_vertex_ids", [])
        if len(landmarks) <= 291 or any(i < 0 or i >= len(v0) for i in (landmarks[61], landmarks[291])):
            raise ValueError("mouth landmarks unavailable")
        corners = geo[[landmarks[61], landmarks[291]]]
        distance = np.linalg.norm(geo[tid, None, :] - corners[None, :, :], axis=2).min(1)
        mouth_fade = smoothstep(.002, .010, distance)[:, None]
        contour_mouth_fade = smoothstep(.010, .020, seg_dist(geo[tid], corners))[:, None]
    if synthetic_sample:
        weight_deltas = [d * mouth_fade for d in weight_deltas]
    regions = synthetic_protected_regions(v0, mat) if synthetic_sample else model.get("regions")
    contour_protected_fade = None
    if not existing_contour and not weight_only and regions and all(regions.get(k) for k in CONTOUR_PROTECTED):
        contour_protected_fade = protected_contour_fade(geo, tid, regions)
    weight_approval = {"eligible": False, "reason": "model binding or protected regions unavailable"}
    bound = synthetic_sample or (model.get("name") == "live-mirror-head" and model.get("version") == 1 and
                                 model.get("template_vertices") == len(v0) and bool(model.get("fit_sha")))
    if existing_weight:
        weight_approval = {"eligible": False, "reason": "existing weight shape preserved"}
    elif bound and regions and all(regions.get(k) for k in WEIGHT_PROTECTED):
        try:
            from scipy.spatial import cKDTree
            protected = np.unique(np.concatenate([regions[k] for k in WEIGHT_PROTECTED])).astype(int)
            if protected.min() < 0 or protected.max() >= len(v0):
                raise ValueError("protected region outside template")
            fade = smoothstep(0, .006, cKDTree(geo[protected]).query(geo[tid])[0])[:, None]
            weight_deltas = [d * fade for d in weight_deltas]
            audit = subprocess.run(["node", os.path.join(HERE, "audit_weight_shape.mjs")],
                                   input=json.dumps({"base": pos.ravel().tolist(), "negative": weight_deltas[0].ravel().tolist(),
                                                     "positive": weight_deltas[1].ravel().tolist(),
                                                     "index": tri.ravel().tolist(), "template": tid.tolist(), "regions": regions}),
                                   text=True, capture_output=True, check=True, timeout=120)
            weight_approval = json.loads(audit.stdout)
        except (ImportError, OSError, subprocess.SubprocessError, ValueError) as exc:
            weight_approval = {"eligible": False, "reason": type(exc).__name__}
    report = {"input": os.path.basename(in_path), "scale_to_template": round(1 / s, 4),
              "targets": {}, "skipped": [], "weight_shape": weight_approval}
    new_targets, new_names = [], []
    contour_limits = {}
    effects = {} if existing_contour or weight_only else {**CONTOUR_EFFECTS}
    spatial_weights = spatial_contour_weights(((pos - t) @ R) / s) if effects else None
    if weight_approval.get("eligible"):
        effects[WEIGHT_SHAPE_CODE] = WEIGHT_SHAPE_PARTS
    if not effects:
        raise ValueError("contour targets already present; weight shape unavailable")
    for code, parts in effects.items():
        baked = []
        limits = []
        unsafe = False
        for j, suffix in ((0, "_neg"), (1, "_pos")):
            d_tpl = sum(fields[name][j] * gain for name, gain in parts)[tid] * END_GAIN
            if code in SPATIAL_CONTOURS:
                d_tpl = spatial_weights @ d_tpl
            d = s * (d_tpl @ R.T)                                    # template frame -> GLB frame
            if code == WEIGHT_SHAPE_CODE:
                d = weight_deltas[j] * weight_approval["negativeLimit" if j == 0 else "positiveLimit"]
            elif contour_mouth_fade is not None:
                d *= contour_mouth_fade
            # Recovery checks every appended contour against the eye and nose masks.
            if (contour_protected_fade is not None and code != WEIGHT_SHAPE_CODE and
                    (existing_weight or code in SPATIAL_CONTOURS)):
                d *= contour_protected_fade
            if validate_final and code != WEIGHT_SHAPE_CODE:
                checked = subprocess.run(["node", os.path.join(HERE, "audit_weight_shape.mjs")],
                                         input=json.dumps({"kind": "contour", "base": pos.ravel().tolist(),
                                                           "delta": d.ravel().tolist(), "index": tri.ravel().tolist()}),
                                         text=True, capture_output=True, check=True, timeout=120)
                limit = json.loads(checked.stdout).get("limit", 0)
                if limit not in (.025, .05, .1, .25, .5, .75, 1):
                    unsafe = True
                    continue
                limits.append(limit)
                d *= limit
            q = pos + d
            area = np.cross(q[tri[:, 1]] - q[tri[:, 0]], q[tri[:, 2]] - q[tri[:, 0]])
            ratio = np.linalg.norm(area, axis=1) / np.maximum(np.linalg.norm(area0, axis=1), 1e-15)
            moved = np.abs(ratio - 1) > .01
            report["targets"][code + suffix] = {
                "flips": int(((area * area0).sum(1) <= 0).sum()),
                "area_p1_p99": [round(float(np.percentile(ratio[moved], 1)), 2) if moved.any() else 1,
                                round(float(np.percentile(ratio[moved], 99)), 2) if moved.any() else 1]}
            baked.append((d.astype("<f4"), (normals(q, tri) - base_n).astype("<f4")))
        if unsafe:
            report["targets"].pop(code + "_neg", None)
            report["targets"].pop(code + "_pos", None)
            report["skipped"].append(code)
            continue
        new_targets.extend(baked)
        new_names.extend((code + "_neg", code + "_pos"))
        if limits:
            contour_limits[code] = {"negative": limits[0], "positive": limits[1]}
    if not new_targets:
        raise ValueError("unsafe contour final mesh")

    targets = prim.setdefault("targets", [])
    for d, dn in new_targets:
        # below 0.002 mm of movement or 0.001 of normal change nothing shows; those vertices are not stored
        targets.append({"POSITION": append_sparse(glb, binary, d, 2e-6),
                        "NORMAL": append_sparse(glb, binary, dn, 1e-3)})
    mesh = glb["meshes"][mi]
    mesh["weights"] = list(mesh.get("weights") or [0] * (len(targets) - len(new_targets))) + [0] * len(new_targets)
    mesh.setdefault("extras", {})["targetNames"] = names + new_names
    extra = glb.setdefault("asset", {}).setdefault("extras", {}).setdefault("live-mirror", {})
    if "morph_targets" in extra:
        extra["morph_targets"] = list(extra["morph_targets"]) + new_names
    if "default_weights" in extra:
        extra["default_weights"] = list(extra["default_weights"]) + [0] * len(new_names)
    if not existing_contour and not weight_only:
        extra["contour_morphs"] = {"version": 1, "codes": [code for code in CONTOUR_EFFECTS
                                                        if code not in report["skipped"]], "end_gain": END_GAIN,
                                   "note": "simulation range, not clinical"}
        if validate_final:
            extra["contour_morphs"]["measured_limits"] = contour_limits
    if weight_approval.get("eligible"):
        extra["weight_shape"] = {"version": 1, "code": WEIGHT_SHAPE_CODE,
                                 "fit_sha": extra.get("fit_sha") or
                                            ("synthetic" if synthetic_sample else None),
                                 "model_version": extra.get("version"),
                                 "negative_limit": weight_approval["negativeLimit"],
                                 "positive_limit": weight_approval["positiveLimit"],
                                 "note": "relative face shape preview, not body mass or health prediction"}
    write_glb(glb, binary, out_path, exclusive=bool(existing_weight))
    return report


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("glb")
    ap.add_argument("out")
    ap.add_argument("--report")
    ap.add_argument("--synthetic-sample", action="store_true")
    a = ap.parse_args()
    rep = add_contour_targets(a.glb, a.out, synthetic_sample=a.synthetic_sample)
    text = json.dumps(rep, ensure_ascii=False, indent=1)
    if a.report:
        with open(a.report, "w", encoding="utf-8") as fh:
            fh.write(text)
    print(text if not a.report else json.dumps({k: rep[k] for k in ("input", "scale_to_template")}))
    sys.exit(1 if any(v["flips"] for v in rep["targets"].values()) else 0)
