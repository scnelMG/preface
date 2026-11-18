"""W8 (2026-10-20): the result as ONE glTF 2.0 binary file  work/<id>/model/head.glb

contents
  meshes      skin (template topology, split only at UV seams), eyeballs, irises, mouth interior (teeth / gums / tongue)
  materials   skin = lighting-free albedo (tex_skin_albedo.png; the photo-lit bake tex_skin.png is the material variant
              "photo", KHR_materials_variants, optional extension), eyes / irises = their bakes, mouth = plain colours.
              W9 maps (normal, occlusion-roughness-metallic) are added when tex_skin_normal.png / tex_skin_orm.png exist.
  attributes  POSITION, NORMAL, TEXCOORD_0 and _TEMPLATE_INDEX (uint32: the vertex of our GNM-v2 template topology each
              glTF vertex came from - the editing engine / recipes work on template indices)
  metadata    asset.extras["live-mirror"]: source run, chosen fit + sha, frame (head axes), scale note, the 468 landmark
              vertex ids, region vertex lists (GNM v3 vertex groups: eyes / nose / lips / cheeks / jaw / ears ...), the
              scalp (hair attachment) vertices and triangles, edit-recipe format version, and the person's hairline as
              points on skin triangles when model/hairline.json exists (tools/glb_hairline.py, S15P31B204-722)
frame      head-centred, right-handed, +X = the person's left, +Y = up (chin -> forehead), +Z = forward (out of the face),
            metres with the eye distance NORMALISED to 63 mm. The size is NOT measured (no marker): relative units only.
usage: python tools/export_glb.py work/<id> [--out head.glb]
"""
import argparse, hashlib, json, os, struct, sys, time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
sys.path.insert(0, ROOT)
from eye_review import from_parts
TEMPLATE = os.path.join(ROOT, "assets", "gnm-template-v2.npz")
IOD_NORM_M = 0.063
MOUTH = {"teeth": ([1], [0.93, 0.91, 0.86, 1.0], 0.35), "gums": ([2], [0.78, 0.42, 0.45, 1.0], 0.45),
         "tongue": ([3], [0.80, 0.45, 0.47, 1.0], 0.5)}
FORMAT = {"name": "live-mirror-head", "version": 1, "edit_recipe": {"format": "live-mirror-edit-recipe", "version": 1}}


class GLB:
    def __init__(self):
        self.bin = bytearray(); self.views = []; self.acc = []; self.images = []; self.textures = []
        self.materials = []; self.meshes = []; self.nodes = []; self.samplers = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}]

    def view(self, data, target=None):
        while len(self.bin) % 4: self.bin.append(0)
        off = len(self.bin); self.bin += data
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target: v["target"] = target
        self.views.append(v); return len(self.views) - 1

    def accessor(self, arr, ctype, typ, target, minmax=False, normalized=False):
        arr = np.ascontiguousarray(arr)
        a = {"bufferView": self.view(arr.tobytes(), target), "componentType": ctype, "count": int(arr.shape[0]), "type": typ}
        if minmax:
            a["min"] = [float(x) for x in arr.min(0)]; a["max"] = [float(x) for x in arr.max(0)]
        if normalized: a["normalized"] = True
        self.acc.append(a); return len(self.acc) - 1

    def image(self, path):
        if not path or not os.path.exists(path): return None
        self.images.append({"bufferView": self.view(open(path, "rb").read()), "mimeType": "image/png", "name": os.path.basename(path)})
        self.textures.append({"source": len(self.images) - 1, "sampler": 0})
        return len(self.textures) - 1

    def write(self, out, extras, variants=None):
        gl = {"asset": {"version": "2.0", "generator": "live-mirror-poc tools/export_glb.py", "extras": extras},
              "scene": 0, "scenes": [{"nodes": list(range(len(self.nodes)))}], "nodes": self.nodes, "meshes": self.meshes,
              "materials": self.materials, "textures": self.textures, "images": self.images, "samplers": self.samplers,
              "accessors": self.acc, "bufferViews": self.views, "buffers": [{"byteLength": len(self.bin)}]}
        if variants:
            gl["extensionsUsed"] = ["KHR_materials_variants"]
            gl["extensions"] = {"KHR_materials_variants": {"variants": [{"name": v} for v in variants]}}
        js = json.dumps(gl, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        js += b" " * ((4 - len(js) % 4) % 4)
        while len(self.bin) % 4: self.bin.append(0)
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(out, "wb") as fh:
            fh.write(struct.pack("<III", 0x46546C67, 2, total))
            fh.write(struct.pack("<II", len(js), 0x4E4F534A)); fh.write(js)
            fh.write(struct.pack("<II", len(self.bin), 0x004E4942)); fh.write(self.bin)
        return total


def head_frame(L):
    """head-centred right-handed frame (rows: +X person's left, +Y up, +Z forward), centre between the ears' front"""
    from view_coverage import head_axes
    c, x, up, fw = head_axes(L)
    x = np.cross(up, fw); x /= np.linalg.norm(x)          # right-handed by construction
    return c, np.stack([x, up, fw])


def main():
    import meshio
    ap = argparse.ArgumentParser(); ap.add_argument("work"); ap.add_argument("--out")
    ap.add_argument("--tex-dir", default="", help="maps from model/<dir> instead of model/ (e.g. w6 = tools/tex_w6.py variants)")
    ap.add_argument("--bald", action="store_true", help="skin maps with the bald scalp (tex_skin_bald / tex_skin_albedo_bald)")
    ap.add_argument("--gray", action="store_true", help="uniform gray materials; do not read or embed any texture maps")
    a = ap.parse_args()
    W = a.work; M = os.path.join(W, "model")
    rep = json.load(open(os.path.join(M, "report.json"), encoding="utf-8")); ch = rep.get("chosen", "gnm")
    fit = os.path.join(M, f"fit_{ch}.ply"); fj = json.load(open(os.path.join(M, f"fit_{ch}.fit.json")))
    lid = np.asarray(fj["landmark_vertex_ids"], np.int64)
    d = np.load(TEMPLATE); UV = d["vertex_uvs"].astype(np.float64); UT = d["uv_triangles"].astype(np.int64)
    F = d["triangles"].astype(np.int64); mat = d["materials"]
    V = np.asarray(meshio.read_any(fit)["vertices"], np.float64)
    # frame + normalised scale
    L = V[lid]; c, Rh = head_frame(L)
    iod = float(np.linalg.norm(L[33] - L[263])); s = IOD_NORM_M / iod
    Vh = ((V - c) @ Rh.T) * s
    fn = np.cross(Vh[F[:, 1]] - Vh[F[:, 0]], Vh[F[:, 2]] - Vh[F[:, 0]]); vn = np.zeros_like(Vh)
    for k in range(3): np.add.at(vn, F[:, k], fn)
    ln = np.linalg.norm(vn, axis=1)
    skin = mat == 0
    # a vertex whose triangles all collapsed (zero area, seen on an lm fit 10/20) has no normal -> the outward direction
    # from the head centre, so the file stays valid glTF (unit normals); the shape itself is unchanged
    bad = ln < 1e-12; vn[~bad] /= ln[~bad, None]
    if ((Vh[skin & ~bad] - Vh[skin].mean(0)) * vn[skin & ~bad]).sum(1).mean() < 0: vn = -vn
    if bad.any():
        r = Vh[bad] - Vh[skin].mean(0); vn[bad] = r / (np.linalg.norm(r, axis=1, keepdims=True) + 1e-12)
        print(json.dumps({"note": f"{int(bad.sum())} vertices without a normal (collapsed triangles) -> radial normal"}))
    g = GLB()
    tex = lambda n: os.path.join(M, a.tex_dir, f"tex_{n}{'_bald' if a.bald and n in ('skin', 'skin_albedo', 'skin_normal') and os.path.exists(os.path.join(M, a.tex_dir, f"tex_{n}_bald.png")) else ''}.png")
    t_alb = g.image(tex("skin_albedo")) if not a.gray and os.path.exists(tex("skin_albedo")) else None
    t_photo = None if a.gray else g.image(tex("skin"))
    t_norm = None if a.gray else g.image(tex("skin_normal")); t_orm = None if a.gray else g.image(tex("skin_orm"))
    t_eye = None if a.gray else g.image(tex("eye")); t_iris = None if a.gray else g.image(tex("iris"))

    def material(name, tex_i, color=None, rough=0.55, normal=None, orm=None, double=True):
        if a.gray: color, rough = [0.65, 0.65, 0.65, 1.0], 0.65
        m = {"name": name, "pbrMetallicRoughness": {"baseColorFactor": color or [1, 1, 1, 1], "metallicFactor": 0.0, "roughnessFactor": rough},
             "doubleSided": double}
        if tex_i is not None: m["pbrMetallicRoughness"]["baseColorTexture"] = {"index": tex_i}
        if normal is not None: m["normalTexture"] = {"index": normal, "scale": 1.0}
        if orm is not None:
            m["pbrMetallicRoughness"]["metallicRoughnessTexture"] = {"index": orm}; m["pbrMetallicRoughness"]["roughnessFactor"] = 1.0
            m["occlusionTexture"] = {"index": orm, "strength": 1.0}
        g.materials.append(m); return len(g.materials) - 1
    m_skin = material("skin", t_alb if t_alb is not None else t_photo, rough=0.55, normal=t_norm, orm=t_orm)
    m_photo = material("skin_photo", t_photo, rough=0.6, normal=t_norm, orm=t_orm)
    m_eye = material("eye", t_eye, rough=0.12); m_iris = material("iris", t_iris, rough=0.2)
    eyeish = np.isin(mat[F], [4, 5, 6]).all(1)
    sets = [("iris", eyeish & np.isin(mat[F], [5, 6]).any(1), m_iris), ("eye", np.isin(mat[F], [4]).all(1), m_eye),
            ("skin", np.isin(mat[F], [0]).all(1), m_skin)]
    sets += [(n, np.isin(mat[F], ids).all(1), material(n, None, col, r)) for n, (ids, col, r) in MOUTH.items()]
    used = np.zeros(len(F), bool); prim_info = {}
    for name, sel, mi in sets + [("other", None, material("other", None, [0.75, 0.6, 0.6, 1], 0.6))]:
        tris = np.where(~used)[0] if sel is None else np.where(sel & ~used)[0]
        used[tris] = True
        if not len(tris): continue
        key = F[tris] * len(UV) + UT[tris]
        uniq, inv = np.unique(key.ravel(), return_inverse=True)
        pi, ui = uniq // len(UV), uniq % len(UV)
        uv = UV[ui].copy(); uv[:, 1] = 1.0 - uv[:, 1]                    # glTF: v from the top
        attrs = {"POSITION": g.accessor(Vh[pi].astype("<f4"), 5126, "VEC3", 34962, minmax=True),
                 "NORMAL": g.accessor(vn[pi].astype("<f4"), 5126, "VEC3", 34962),
                 "TEXCOORD_0": g.accessor(uv.astype("<f4"), 5126, "VEC2", 34962),
                 "_TEMPLATE_INDEX": g.accessor(pi.astype("<u4")[:, None], 5125, "SCALAR", 34962)}
        idx = g.accessor(inv.astype("<u4"), 5125, "SCALAR", 34963)
        prim = {"attributes": attrs, "indices": idx, "material": mi, "mode": 4}
        if name == "skin" and t_alb is not None:
            prim["extensions"] = {"KHR_materials_variants": {"mappings": [{"material": m_skin, "variants": [0]}, {"material": m_photo, "variants": [1]}]}}
        g.meshes.append({"name": name, "primitives": [prim]}); g.nodes.append({"name": name, "mesh": len(g.meshes) - 1})
        prim_info[name] = {"vertices": int(len(pi)), "triangles": int(len(tris))}
    # metadata: regions (GNM v3 vertex groups on our topology), scalp, landmarks
    regions = {}
    try:
        from gnm_model import GNM, template_map
        from gnm_features import scalp_vertices
        G = GNM(); o2g = template_map()[0]
        for i, n in enumerate(G.group_names):
            if n.endswith("region") or n in ("ears", "upper_lip", "lower_lip", "left_eye", "right_eye", "eye_sockets", "left", "right"):
                ids = np.where(G.groups[i][o2g] > 0.3)[0]
                if len(ids): regions[n] = ids.astype(int).tolist()
        sc = scalp_vertices(); regions["scalp"] = np.where(sc)[0].astype(int).tolist()
        scalp_tris = np.where(sc[F].all(1) & skin[F].all(1))[0].astype(int).tolist()
    except Exception as ex:
        scalp_tris = []; regions["_error"] = str(ex)[:200]
    T = np.eye(4); T[:3, :3] = s * Rh; T[:3, 3] = -s * (Rh @ c)
    sha = hashlib.sha1(open(fit, "rb").read()).hexdigest()[:12]
    extras = {"live-mirror": {**FORMAT, "source": os.path.basename(os.path.normpath(W)), "chosen_fit": ch, "fit_sha": sha,
              "created": time.strftime("%Y-%m-%d %H:%M:%S"),
              "frame": "+X person's left, +Y up (chin -> forehead), +Z forward; origin between the ears (head_axes)",
              "scale_note": f"metres with the eye distance NORMALISED to {IOD_NORM_M * 1000:.0f} mm - not a measured size (no marker)",
              "world_to_glb": T.round(8).tolist(), "template": "assets/gnm-template-v2.npz (vertex order = _TEMPLATE_INDEX)",
              "template_vertices": int(len(V)), "landmark_vertex_ids": lid.astype(int).tolist(),
              "regions": regions, "scalp_triangles": scalp_tris, "primitives": prim_info,
              "shape_only": bool(a.gray),
              "materials_note": "uniform gray, no texture maps" if a.gray else "skin = lighting-free albedo (variant 'albedo'), 'photo' = capture-lit bake",
              "tex_dir": a.tex_dir or ".", "bald": a.bald, "maps": {"albedo": t_alb is not None, "photo": t_photo is not None, "normal": t_norm is not None, "orm": t_orm is not None}}}
    # the person's hairline (S15P31B204-722) on the skin triangles, for fitting hair assets in the app; none without it
    hj = os.path.join(M, "hairline.json")
    if os.path.exists(hj):
        try:
            from glb_hairline import extras_for
            hl = extras_for(json.load(open(hj, encoding="utf-8")), ch, V, F[skin[F].all(1)], s)
            if hl is not None:
                extras["live-mirror"]["hairline"] = hl
        except Exception as ex:   # never stops the export: the app falls back to the template hairline
            print(json.dumps({"note": f"hairline not stored: {str(ex)[:200]}"}))
    eye_proof = from_parts(M)
    if eye_proof is not None:
        extras["live-mirror"]["eye_review"], extras["live-mirror"]["eye_parts_sha256"] = eye_proof
    out = a.out or os.path.join(M, "head.glb")
    n = g.write(out, extras, variants=["albedo", "photo"] if t_alb is not None else None)
    summ = {"out": out, "bytes": n, "primitives": prim_info, "regions": len([k for k in regions if not k.startswith("_")]),
            "maps": extras["live-mirror"]["maps"], "fit_sha": sha,
            "hairline_points": len(extras["live-mirror"].get("hairline", {}).get("points", []))}
    json.dump(summ, open(os.path.splitext(out)[0] + ".glb.json", "w"), indent=1)
    print(json.dumps(summ, ensure_ascii=False))


if __name__ == "__main__":
    main()
