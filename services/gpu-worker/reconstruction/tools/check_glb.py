"""Structural check of a .glb (W8): header / chunks, every accessor against its buffer view, index ranges, material ->
texture -> image references, images decodable, normals unit length, live-mirror metadata present.
usage: python tools/check_glb.py <file.glb>      -> prints a summary, exit 1 on any error
"""
import io, json, struct, sys
import numpy as np

CT = {5120: ("i1", 1), 5121: ("u1", 1), 5122: ("<i2", 2), 5123: ("<u2", 2), 5125: ("<u4", 4), 5126: ("<f4", 4)}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def check(path):
    err, info = [], {}
    b = open(path, "rb").read()
    magic, ver, total = struct.unpack_from("<III", b, 0)
    if magic != 0x46546C67 or ver != 2: err.append("not a glTF 2.0 binary")
    if total != len(b): err.append(f"length {total} != file {len(b)}")
    jl, jt = struct.unpack_from("<II", b, 12); gl = json.loads(b[20:20 + jl].decode("utf-8"))
    bl, bt = struct.unpack_from("<II", b, 20 + jl); binc = b[28 + jl:28 + jl + bl]
    if jt != 0x4E4F534A or bt != 0x004E4942: err.append("chunk types")
    if gl["buffers"][0]["byteLength"] > len(binc): err.append("BIN chunk shorter than the buffer")
    views = gl["bufferViews"]
    for v in views:
        if v["byteOffset"] + v["byteLength"] > len(binc): err.append(f"bufferView out of range {v}")

    def read(ai):
        a = gl["accessors"][ai]; v = views[a["bufferView"]]; dt, sz = CT[a["componentType"]]; n = NC[a["type"]]
        need = a["count"] * sz * n
        if need > v["byteLength"]: err.append(f"accessor {ai} needs {need} bytes, view has {v['byteLength']}")
        return np.frombuffer(binc, dt, a["count"] * n, v["byteOffset"]).reshape(a["count"], n), a
    tri = 0
    for m in gl["meshes"]:
        for p in m["primitives"]:
            P, ap = read(p["attributes"]["POSITION"]); nv = len(P)
            if "min" in ap and (np.abs(P.min(0) - ap["min"]).max() > 1e-5 or np.abs(P.max(0) - ap["max"]).max() > 1e-5): err.append(f"{m['name']}: POSITION min/max")
            for k, ai in p["attributes"].items():
                X, _ = read(ai)
                if len(X) != nv: err.append(f"{m['name']}: {k} count {len(X)} != {nv}")
                if k == "NORMAL":
                    ln = np.linalg.norm(X, axis=1)
                    if np.abs(ln - 1).max() > 1e-3: err.append(f"{m['name']}: normals not unit ({np.abs(ln - 1).max():.4f})")
                if not np.isfinite(X.astype(np.float64)).all(): err.append(f"{m['name']}: {k} not finite")
            I, _ = read(p["indices"])
            if I.max() >= nv: err.append(f"{m['name']}: index {int(I.max())} >= {nv}")
            if len(I) % 3: err.append(f"{m['name']}: index count not a multiple of 3")
            tri += len(I) // 3
            if p.get("material") is not None and p["material"] >= len(gl["materials"]): err.append(f"{m['name']}: material index")
    for mt in gl["materials"]:
        for key in ("baseColorTexture", "metallicRoughnessTexture"):
            t = mt.get("pbrMetallicRoughness", {}).get(key)
            if t and t["index"] >= len(gl["textures"]): err.append(f"{mt['name']}: {key} texture index")
        for key in ("normalTexture", "occlusionTexture"):
            if key in mt and mt[key]["index"] >= len(gl["textures"]): err.append(f"{mt['name']}: {key} texture index")
    try:
        from PIL import Image
        for im in gl.get("images", []):
            v = views[im["bufferView"]]
            Image.open(io.BytesIO(binc[v["byteOffset"]:v["byteOffset"] + v["byteLength"]])).verify()
    except Exception as ex:
        err.append(f"image decode: {ex}")
    lm = gl["asset"].get("extras", {}).get("live-mirror", {})
    if len(lm.get("landmark_vertex_ids", [])) != 468: err.append("live-mirror metadata: 468 landmark ids missing")
    info.update(meshes=[m["name"] for m in gl["meshes"]], triangles=tri, materials=len(gl["materials"]), images=len(gl.get("images", [])),
                regions=len(lm.get("regions", {})), bytes=len(b), extensions=gl.get("extensionsUsed", []))
    return err, info


if __name__ == "__main__":
    e, i = check(sys.argv[1])
    print(json.dumps({"ok": not e, "errors": e, **i}, ensure_ascii=False))
    sys.exit(1 if e else 0)
