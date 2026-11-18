"""Rebuild a nose-only rig from an older exported head.glb; never approves a model.

Usage: python tools/backfill_nose_rig.py head.glb rig.json
The output is personal face geometry. Keep it beside the private model, never in Git.
"""

import argparse
import json
import os
import struct
import subprocess
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
sys.path.insert(0, HERE)

import meshio
import rig_blocks


def exported_skin(path):
    with open(path, "rb") as fh:
        data = fh.read()
    if len(data) < 28 or struct.unpack_from("<III", data) != (0x46546C67, 2, len(data)):
        raise ValueError("invalid GLB")
    json_size, json_type = struct.unpack_from("<II", data, 12)
    bin_start = 20 + json_size
    if json_type != 0x4E4F534A or bin_start + 8 > len(data):
        raise ValueError("invalid GLB JSON")
    glb = json.loads(data[20:bin_start])
    bin_size, bin_type = struct.unpack_from("<II", data, bin_start)
    if bin_type != 0x004E4942 or bin_start + 8 + bin_size > len(data):
        raise ValueError("invalid GLB BIN")
    binary = data[bin_start + 8 : bin_start + 8 + bin_size]
    extra = glb.get("asset", {}).get("extras", {}).get("live-mirror", {})
    skin = next((m for m in glb.get("meshes", []) if m.get("name") == "skin"), None)
    if (
        not skin
        or len(skin.get("primitives", [])) != 1
        or not isinstance(extra.get("fit_sha"), str)
        or len(extra["fit_sha"]) != 12
    ):
        raise ValueError("missing exported skin or fit binding")
    primitive = skin["primitives"][0]

    def accessor(index, component, kind):
        a = glb["accessors"][index]
        view = glb["bufferViews"][a["bufferView"]]
        if a["componentType"] != component or a["type"] != kind or a.get("sparse") or view.get("byteStride"):
            raise ValueError("unsupported skin accessor")
        dt = {5126: "<f4", 5125: "<u4", 5123: "<u2"}[component]
        width = 3 if kind == "VEC3" else 1
        start = view.get("byteOffset", 0) + a.get("byteOffset", 0)
        size = a["count"] * width * np.dtype(dt).itemsize
        if (
            view.get("buffer", 0) != 0
            or start + size > view.get("byteOffset", 0) + view["byteLength"]
            or start + size > len(binary)
        ):
            raise ValueError("skin accessor out of bounds")
        return np.frombuffer(binary, dt, a["count"] * width, start).copy()

    positions = accessor(primitive["attributes"]["POSITION"], 5126, "VEC3").reshape(-1, 3)
    template = accessor(primitive["attributes"]["_TEMPLATE_INDEX"], 5125, "SCALAR")
    index_id = primitive["indices"]
    component = glb["accessors"][index_id]["componentType"]
    if component not in (5123, 5125):
        raise ValueError("unsupported skin index")
    triangles = accessor(index_id, component, "SCALAR").reshape(-1, 3)
    count = extra.get("template_vertices")
    if (
        not isinstance(count, int)
        or count <= 0
        or len(positions) != len(template)
        or np.any(template >= count)
        or np.any(triangles >= len(positions))
        or not np.isfinite(positions).all()
    ):
        raise ValueError("invalid skin topology")
    full = np.full((count, 3), np.nan, np.float64)
    seen = np.zeros(count, bool)
    for mesh in glb["meshes"]:
        for part in mesh["primitives"]:
            attrs = part["attributes"]
            vertex = accessor(attrs["POSITION"], 5126, "VEC3").reshape(-1, 3)
            ids = accessor(attrs["_TEMPLATE_INDEX"], 5125, "SCALAR")
            if len(vertex) != len(ids) or np.any(ids >= count) or not np.isfinite(vertex).all():
                raise ValueError("invalid template vertex")
            unique, inverse = np.unique(ids, return_inverse=True)
            first = np.unique(ids, return_index=True)[1]
            if not np.allclose(vertex, vertex[first[inverse]], atol=1e-6):
                raise ValueError("inconsistent template vertices")
            if not np.allclose(full[unique[seen[unique]]], vertex[first[seen[unique]]], atol=1e-6):
                raise ValueError("inconsistent template vertices")
            full[ids] = vertex
            seen[ids] = True
    if not seen.all():
        raise ValueError("incomplete exported template")
    return extra, full, template, triangles


def backfill(glb_path, out_path):
    if os.path.exists(out_path):
        raise FileExistsError("refusing to replace an existing rig")
    extra, template_positions, _, _ = exported_skin(glb_path)
    topology = np.load(os.path.join(ROOT, "assets", "gnm-template-v2.npz"))
    if len(template_positions) != len(topology["vertices"]):
        raise ValueError("GLB/template topology mismatch")
    triangles = topology["triangles"]
    with tempfile.TemporaryDirectory(
        prefix="nose-rig-backfill-", dir=os.path.dirname(os.path.abspath(out_path))
    ) as tmp:
        skin_path = os.path.join(tmp, "template.ply")
        meshio.write_ply(skin_path, template_positions, triangles)
        subprocess.run(
            [
                sys.executable,
                os.path.join(ROOT, "pipeline", "build_case.py"),
                "--input",
                skin_path,
                "--case-id",
                "legacy",
                "--cases-dir",
                tmp,
                "--input-kind",
                "parametric_template_not_scan",
                "--units",
                "m",
                "--personal",
                "--subdivide",
                "0",
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            env={**os.environ, "PYTHONUTF8": "1"},
        )
        case = os.path.join(tmp, "legacy")
        group = {"_P": template_positions}
        nose = rig_blocks.nose_block(case, [group], template_positions)
        transform = np.asarray(nose["T"], np.float64)[:3, :3]
        rig = {
            "format": "live-mirror-rig",
            "version": 1,
            "fit_sha": extra["fit_sha"],
            "frame": "head.glb",
            "nose": {
                "case": "legacy",
                "json": nose["json"],
                "bin": nose["bin"],
                "limits": nose["limits"],
                "engine": nose["engine"],
                "nmap": group["nmap"],
                "nw": group["nw"],
                "M": np.linalg.inv(transform).tolist(),
            },
        }
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(rig, fh)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("glb")
    parser.add_argument("out")
    args = parser.parse_args()
    backfill(args.glb, args.out)
    print("nose rig written; approval and final mesh validation still required")
