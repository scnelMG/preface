"""NumPy-only mesh readers/writers: PLY (ascii / binary LE/BE), OBJ, GLB (first mesh), plus GLB writer.

Readers return dict(vertices Nx3 float64, faces Mx3 int64, colors Nx3 float 0..1 or None,
uv Nx2 or None, source_format, notes[]).
Nothing here guesses units. Units are an ingest-time declaration (see ingest.py).
"""
import json
import struct
import numpy as np

PLY_TYPES = {
    "char": "i1", "int8": "i1", "uchar": "u1", "uint8": "u1",
    "short": "i2", "int16": "i2", "ushort": "u2", "uint16": "u2",
    "int": "i4", "int32": "i4", "uint": "u4", "uint32": "u4",
    "float": "f4", "float32": "f4", "double": "f8", "float64": "f8",
}


def read_ply(path):
    with open(path, "rb") as fh:
        data = fh.read()
    end = data.find(b"end_header")
    if end < 0:
        raise ValueError("PLY header not found")
    nl = data.find(b"\n", end)
    header = data[:end].decode("ascii", "replace").splitlines()
    body = data[nl + 1:]
    fmt = None
    elements = []
    notes = []
    for line in header:
        tok = line.strip().split()
        if not tok:
            continue
        if tok[0] == "format":
            fmt = tok[1]
        elif tok[0] == "element":
            elements.append({"name": tok[1], "count": int(tok[2]), "props": []})
        elif tok[0] == "property":
            if tok[1] == "list":
                elements[-1]["props"].append(("list", tok[4], PLY_TYPES[tok[2]], PLY_TYPES[tok[3]]))
            else:
                elements[-1]["props"].append(("scalar", tok[2], PLY_TYPES[tok[1]]))
        elif tok[0] in ("comment", "obj_info"):
            notes.append(" ".join(tok[1:]))
    out = {}
    if fmt == "ascii":
        lines = body.decode("ascii", "replace").split("\n")
        li = 0
        for el in elements:
            if all(p[0] == "scalar" for p in el["props"]):
                arr = np.loadtxt(lines[li:li + el["count"]], ndmin=2) if el["count"] else np.zeros((0, len(el["props"])))
                out[el["name"]] = {p[1]: arr[:, k] for k, p in enumerate(el["props"])}
            else:
                lists = []
                for k in range(el["count"]):
                    vals = lines[li + k].split()
                    n = int(vals[0])
                    lists.append([int(x) for x in vals[1:1 + n]])
                out[el["name"]] = {"__list__": lists}
            li += el["count"]
    else:
        endian = "<" if fmt == "binary_little_endian" else ">"
        off = 0
        for el in elements:
            if all(p[0] == "scalar" for p in el["props"]):
                dt = np.dtype([(p[1], endian + p[2]) for p in el["props"]])
                arr = np.frombuffer(body, dtype=dt, count=el["count"], offset=off)
                off += dt.itemsize * el["count"]
                out[el["name"]] = {name: arr[name].astype(float) for name in dt.names}
            else:
                # common case: a single list property (faces), possibly followed by scalars
                lists = []
                for _ in range(el["count"]):
                    row = []
                    for p in el["props"]:
                        if p[0] == "list":
                            cdt = np.dtype(endian + p[2])
                            n = int(np.frombuffer(body, cdt, 1, off)[0])
                            off += cdt.itemsize
                            idt = np.dtype(endian + p[3])
                            row = np.frombuffer(body, idt, n, off).tolist()
                            off += idt.itemsize * n
                        else:
                            off += np.dtype(p[2]).itemsize
                    lists.append(row)
                out[el["name"]] = {"__list__": lists}
    vert = out["vertex"]
    v = np.stack([vert["x"], vert["y"], vert["z"]], 1).astype(np.float64)
    colors = None
    for keys in (("red", "green", "blue"), ("r", "g", "b"), ("diffuse_red", "diffuse_green", "diffuse_blue")):
        if all(k in vert for k in keys):
            c = np.stack([vert[k] for k in keys], 1).astype(float)
            colors = c / 255.0 if c.max() > 1.0 else c
            break
    faces = np.zeros((0, 3), np.int64)
    if "face" in out:
        tris = []
        for poly in out["face"]["__list__"]:
            for k in range(1, len(poly) - 1):
                tris.append((poly[0], poly[k], poly[k + 1]))
        faces = np.array(tris, np.int64).reshape(-1, 3)
    return {"vertices": v, "faces": faces, "colors": colors, "uv": None,
            "source_format": "ply_" + fmt, "notes": notes}


def read_obj(path):
    """OBJ with optional vertex colours (v x y z r g b) and MTL textures (vt + usemtl + map_Kd).
    Textures are sampled per face corner (nearest texel) and averaged per vertex -> vertex colours.
    Supports several texture pages (photogrammetry exports such as RealityScan)."""
    import os
    vs, cols, vts = [], [], []
    fv, ft, fm = [], [], []
    mtllibs, cur_mtl, mat_names = [], None, []
    with open(path, "r", errors="replace") as fh:
        for line in fh:
            if line.startswith("v "):
                p = line.split()
                vs.append((float(p[1]), float(p[2]), float(p[3])))
                if len(p) >= 7:
                    cols.append((float(p[4]), float(p[5]), float(p[6])))
            elif line.startswith("vt "):
                p = line.split()
                vts.append((float(p[1]), float(p[2])))
            elif line.startswith("f "):
                toks = line.split()[1:]
                vi, ti = [], []
                for t in toks:
                    q = t.split("/")
                    i = int(q[0]); vi.append(i - 1 if i > 0 else len(vs) + i)
                    if len(q) > 1 and q[1]:
                        j = int(q[1]); ti.append(j - 1 if j > 0 else len(vts) + j)
                for k in range(1, len(vi) - 1):
                    fv.append((vi[0], vi[k], vi[k + 1]))
                    ft.append((ti[0], ti[k], ti[k + 1]) if len(ti) == len(vi) else (-1, -1, -1))
                    fm.append(cur_mtl)
            elif line.startswith("mtllib"):
                mtllibs.append(line.split(None, 1)[1].strip())
            elif line.startswith("usemtl"):
                cur_mtl = line.split(None, 1)[1].strip()
    v = np.array(vs, float)
    f = np.array(fv, np.int64).reshape(-1, 3)
    notes = []
    c = np.array(cols, float) if len(cols) == len(vs) and cols else None
    if c is not None and c.max() > 1.0:
        c = c / 255.0
    uvc = np.array(vts, float) if vts else None
    if c is None and uvc is not None and mtllibs:
        try:
            from PIL import Image
            base = os.path.dirname(os.path.abspath(path))
            maps = {}
            for lib in mtllibs:
                cur = None
                for line in open(os.path.join(base, lib), errors="replace"):
                    t = line.strip().split(None, 1)
                    if not t:
                        continue
                    if t[0] == "newmtl":
                        cur = t[1].strip()
                    elif t[0] == "map_Kd" and cur is not None and len(t) > 1:
                        maps[cur] = os.path.join(base, t[1].strip().split()[-1])
            ftx = np.array(ft, np.int64).reshape(-1, 3)
            acc = np.zeros((len(v), 3)); cnt = np.zeros(len(v))
            fm_arr = np.array([m if m is not None else "" for m in fm])
            for name, img_path in maps.items():
                sel = (fm_arr == name) & (ftx[:, 0] >= 0)
                if len(maps) == 1:
                    sel = ftx[:, 0] >= 0
                if not sel.any():
                    continue
                im = np.asarray(Image.open(img_path).convert("RGB"), float) / 255.0
                h, w, _ = im.shape
                uvs = uvc[ftx[sel]]  # (n,3,2)
                px = np.clip((uvs[..., 0] % 1.0) * (w - 1), 0, w - 1).astype(int)
                py = np.clip((1.0 - (uvs[..., 1] % 1.0)) * (h - 1), 0, h - 1).astype(int)  # OBJ uv origin bottom-left
                cc = im[py, px]  # (n,3,3)
                for k in range(3):
                    np.add.at(acc, f[sel][:, k], cc[:, k]); np.add.at(cnt, f[sel][:, k], 1)
                notes.append(f"texture {os.path.basename(img_path)} sampled to vertex colours (per corner, averaged)")
            if cnt.any():
                c = np.where(cnt[:, None] > 0, acc / np.maximum(cnt, 1)[:, None], 0.6)
        except Exception as e:  # PIL missing / texture missing
            notes.append("OBJ texture not sampled: " + str(e))
    if c is None:
        notes.append("no vertex colours")
    return {"vertices": v, "faces": f, "colors": c, "uv": None, "source_format": "obj", "notes": notes}


GLTF_CT = {5120: "i1", 5121: "u1", 5122: "i2", 5123: "u2", 5125: "u4", 5126: "f4"}
GLTF_N = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_glb(path):
    with open(path, "rb") as fh:
        data = fh.read()
    magic, ver, total = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise ValueError("not a GLB")
    off = 12
    js, binc = None, b""
    while off < len(data):
        ln, ty = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + ln]
        if ty == 0x4E4F534A:
            js = json.loads(chunk)
        elif ty == 0x004E4942:
            binc = chunk
        off += 8 + ln

    def acc(i):
        a = js["accessors"][i]
        bv = js["bufferViews"][a["bufferView"]]
        dt = np.dtype("<" + GLTF_CT[a["componentType"]])
        n = GLTF_N[a["type"]]
        start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = bv.get("byteStride", 0)
        if stride and stride != dt.itemsize * n:
            raw = np.frombuffer(binc, np.uint8, stride * a["count"], start).reshape(a["count"], stride)
            arr = raw[:, :dt.itemsize * n].copy().view(dt).reshape(a["count"], n)
        else:
            arr = np.frombuffer(binc, dt, a["count"] * n, start).reshape(a["count"], n)
        if a.get("normalized"):
            arr = arr.astype(float) / np.iinfo(dt).max
        return arr

    prim = js["meshes"][0]["primitives"][0]
    v = acc(prim["attributes"]["POSITION"]).astype(float)
    f = acc(prim["indices"]).reshape(-1, 3).astype(np.int64) if "indices" in prim else np.arange(len(v)).reshape(-1, 3)
    uv = acc(prim["attributes"]["TEXCOORD_0"]).astype(float) if "TEXCOORD_0" in prim["attributes"] else None
    col = acc(prim["attributes"]["COLOR_0"])[:, :3].astype(float) if "COLOR_0" in prim["attributes"] else None
    # node transform of the first node referencing mesh 0 (matrix / TRS)
    M = np.eye(4)
    for node in js.get("nodes", []):
        if node.get("mesh") == 0:
            if "matrix" in node:
                M = np.array(node["matrix"], float).reshape(4, 4).T
            else:
                T = np.eye(4); T[:3, 3] = node.get("translation", [0, 0, 0])
                S = np.diag(list(node.get("scale", [1, 1, 1])) + [1])
                qx, qy, qz, qw = node.get("rotation", [0, 0, 0, 1])
                Rm = np.array([[1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
                               [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
                               [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)]])
                Rr = np.eye(4); Rr[:3, :3] = Rm
                M = T @ Rr @ S
            break
    v = v @ M[:3, :3].T + M[:3, 3]
    notes = ["GLB node transform applied"] if not np.allclose(M, np.eye(4)) else []
    if col is None and uv is not None and js.get("images"):
        try:
            import io
            from PIL import Image
            img_bv = js["bufferViews"][js["images"][0]["bufferView"]]
            st = img_bv.get("byteOffset", 0)
            im = np.asarray(Image.open(io.BytesIO(binc[st:st + img_bv["byteLength"]])).convert("RGB"), float) / 255.0
            h, w, _ = im.shape
            px = np.clip((uv[:, 0] % 1.0) * (w - 1), 0, w - 1).astype(int)
            py = np.clip((uv[:, 1] % 1.0) * (h - 1), 0, h - 1).astype(int)  # glTF UV origin = top-left
            col = im[py, px]
            notes.append("base color texture sampled to vertex colors (nearest texel)")
        except Exception as e:  # PIL missing or no embedded image
            notes.append("texture not sampled: " + str(e))
    if col is None:
        notes.append("no vertex colors")
    return {"vertices": v, "faces": f, "colors": col, "uv": uv, "source_format": "glb", "notes": notes}


def read_any(path):
    p = str(path).lower()
    if p.endswith(".ply"):
        return read_ply(path)
    if p.endswith(".obj"):
        return read_obj(path)
    if p.endswith(".glb"):
        return read_glb(path)
    raise ValueError("unsupported input format: " + str(path))


def write_ply(path, v, f, colors=None):
    v = np.asarray(v, "<f4")
    f = np.asarray(f, "<i4")
    hdr = ["ply", "format binary_little_endian 1.0", f"element vertex {len(v)}",
           "property float x", "property float y", "property float z"]
    if colors is not None:
        hdr += ["property uchar red", "property uchar green", "property uchar blue"]
    hdr += [f"element face {len(f)}", "property list uchar int vertex_indices", "end_header"]
    with open(path, "wb") as fh:
        fh.write(("\n".join(hdr) + "\n").encode())
        if colors is None:
            fh.write(v.tobytes())
        else:
            c = np.clip(np.asarray(colors) * 255 + 0.5, 0, 255).astype("u1")
            dt = np.dtype([("p", "<f4", 3), ("c", "u1", 3)])
            arr = np.empty(len(v), dt); arr["p"] = v; arr["c"] = c
            fh.write(arr.tobytes())
        dt = np.dtype([("n", "u1"), ("i", "<i4", 3)])
        arr = np.empty(len(f), dt); arr["n"] = 3; arr["i"] = f
        fh.write(arr.tobytes())


def write_glb(path, v, f, colors=None, name="face"):
    """Minimal GLB (positions, normals, optional COLOR_0, indices). Units are whatever v is in."""
    from render import vertex_normals
    v = np.asarray(v, "<f4")
    n = vertex_normals(v.astype(float), np.asarray(f)).astype("<f4")
    idx = np.asarray(f, "<u4").reshape(-1)
    blobs = [v.tobytes(), n.tobytes(), idx.tobytes()]
    if colors is not None:
        blobs.append(np.asarray(colors, "<f4").tobytes())
    views, offs, cur = [], [], 0
    for b in blobs:
        offs.append(cur)
        cur += (len(b) + 3) // 4 * 4
    binc = b"".join(b + b"\x00" * ((4 - len(b) % 4) % 4) for b in blobs)
    targets = [34962, 34962, 34963] + ([34962] if colors is not None else [])
    for k, b in enumerate(blobs):
        views.append({"buffer": 0, "byteOffset": offs[k], "byteLength": len(b), "target": targets[k]})
    accs = [
        {"bufferView": 0, "componentType": 5126, "count": len(v), "type": "VEC3",
         "min": v.min(0).tolist(), "max": v.max(0).tolist()},
        {"bufferView": 1, "componentType": 5126, "count": len(v), "type": "VEC3"},
        {"bufferView": 2, "componentType": 5125, "count": len(idx), "type": "SCALAR"},
    ]
    attrs = {"POSITION": 0, "NORMAL": 1}
    if colors is not None:
        accs.append({"bufferView": 3, "componentType": 5126, "count": len(v), "type": "VEC3"})
        attrs["COLOR_0"] = 3
    gl = {"asset": {"version": "2.0", "generator": "live-mirror-poc meshio"},
          "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": name}],
          "meshes": [{"name": name, "primitives": [{"attributes": attrs, "indices": 2, "material": 0}]}],
          "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 0.8}}],
          "buffers": [{"byteLength": len(binc)}], "bufferViews": views, "accessors": accs}
    jb = json.dumps(gl).encode()
    jb += b" " * ((4 - len(jb) % 4) % 4)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(binc)))
        fh.write(struct.pack("<II", len(jb), 0x4E4F534A) + jb)
        fh.write(struct.pack("<II", len(binc), 0x004E4942) + binc)
