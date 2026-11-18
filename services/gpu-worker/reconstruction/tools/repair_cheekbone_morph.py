"""Build a private replacement candidate for an existing GLB's two cheekbone targets."""

import argparse
import json
import os
import subprocess
from pathlib import Path

import numpy as np

from reconstruction.tools.audit_weight_combinations import target_delta
from reconstruction.tools.contour_morphs import (
    CONTOUR_PROTECTED, accessor, append_sparse, normals, protected_contour_fade, read_glb, write_glb,
)


def repair_cheekbone(source, output):
    glb, binary = read_glb(source)
    metadata = glb["asset"]["extras"]["live-mirror"]
    if metadata.get("name") != "live-mirror-head" or metadata.get("version") != 1:
        raise ValueError("unsupported model")
    skin, = [mesh for mesh in glb["meshes"] if mesh.get("name") == "skin"]
    primitive, = skin["primitives"]
    names = skin["extras"]["targetNames"]
    targets = primitive["targets"]
    if len(names) != len(targets) or any(skin.get("weights", [])):
        raise ValueError("invalid contour targets")
    pos = accessor(glb, binary, primitive["attributes"]["POSITION"]).astype(float)
    ids = accessor(glb, binary, primitive["attributes"]["_TEMPLATE_INDEX"])
    faces = accessor(glb, binary, primitive["indices"]).astype(int).reshape(-1, 3)
    regions = metadata["regions"]
    protected = np.unique(np.concatenate([regions[name] for name in CONTOUR_PROTECTED]))
    if not all(regions[name] for name in CONTOUR_PROTECTED):
        raise ValueError("protected regions unavailable")
    geometry = np.zeros((metadata["template_vertices"], 3), dtype=float)
    populated = np.zeros(len(geometry), dtype=bool)
    for mesh in glb["meshes"]:
        for part in mesh["primitives"]:
            attrs = part["attributes"]
            if "_TEMPLATE_INDEX" not in attrs:
                continue
            indices = accessor(glb, binary, attrs["_TEMPLATE_INDEX"])
            geometry[indices] = accessor(glb, binary, attrs["POSITION"])
            populated[indices] = True
    if not populated[protected].all():
        raise ValueError("protected region positions unavailable")
    geometry[ids] = pos
    fade = protected_contour_fade(geometry, ids, regions)
    base_normals = normals(pos, faces)
    auditor = Path(__file__).with_name("audit_weight_shape.mjs")
    for suffix in ("_neg", "_pos"):
        name = "contour.cheekbone" + suffix
        if names.count(name) != 1:
            raise ValueError("missing or duplicate cheekbone target")
        index = names.index(name)
        delta = (target_delta(glb, binary, targets[index]["POSITION"]) * fade).astype("<f4")
        delta[np.max(np.abs(delta), axis=1) <= 2e-6] = 0
        audit = subprocess.run(["node", os.fspath(auditor)], check=True, capture_output=True, text=True,
                               timeout=120, input=json.dumps({"kind": "contour", "finerFirstStep": True,
                               "base": pos.ravel().tolist(),
                               "delta": delta.ravel().tolist(), "index": faces.ravel().tolist()}))
        limit = json.loads(audit.stdout).get("limit", 0)
        if limit not in (.025, .05, .1, .25, .5, .75, 1):
            raise ValueError(f"cheekbone range failed the repaired geometry audit ({suffix})")
        # Keep the existing slider's normalized range while baking the verified endpoint.
        delta *= limit
        normal_delta = (normals(pos + delta, faces) - base_normals).astype("<f4")
        targets[index] = {"POSITION": append_sparse(glb, binary, delta, 2e-6),
                          "NORMAL": append_sparse(glb, binary, normal_delta, 1e-3)}
    write_glb(glb, binary, output, exclusive=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("output")
    args = parser.parse_args()
    repair_cheekbone(args.source, args.output)
