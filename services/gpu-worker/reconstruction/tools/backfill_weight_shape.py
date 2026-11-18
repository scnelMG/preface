"""Prepare one private, versioned weight-shape GLB from an older generated GLB.

The caller owns S3 transfer. This tool never prints face geometry, paths, or identifiers.
"""

import argparse
import hashlib
import json
import re
from pathlib import Path

from reconstruction.tools.contour_morphs import add_contour_targets, read_glb


PAIR = ["contour.weight_shape_neg", "contour.weight_shape_pos"]
SAFE_REASONS = {
    "unsupported model binding", "weight shape audit rejected", "output already exists",
    "contour targets already present; weight shape unavailable",
    "unknown or incomplete contour targets already present", "no skin primitive with _TEMPLATE_INDEX",
    "target names do not match targets", "existing GLB content changed",
}


def prepare(source: Path, output: Path):
    if output.exists() or source.resolve() == output.resolve():
        raise ValueError("output already exists")
    before, old_binary = read_glb(str(source))
    old_model = before.get("asset", {}).get("extras", {}).get("live-mirror", {})
    if (old_model.get("name") != "live-mirror-head" or old_model.get("version") != 1 or
            not re.fullmatch(r"[a-f0-9]{12}", old_model.get("fit_sha") or "")):
        raise ValueError("unsupported model binding")
    try:
        audit = add_contour_targets(str(source), str(output), weight_only=True)
        if not audit["weight_shape"].get("eligible"):
            raise ValueError("weight shape audit rejected")
        after, new_binary = read_glb(str(output))
        old_skin = next(mesh for mesh in before["meshes"] if mesh.get("name") == "skin")
        new_skin = next(mesh for mesh in after["meshes"] if mesh.get("name") == "skin")
        old_names = old_skin.get("extras", {}).get("targetNames") or []
        new_model = after["asset"]["extras"]["live-mirror"]
        if (bytes(new_binary[:len(old_binary)]) != bytes(old_binary)
                or after["accessors"][:len(before["accessors"])] != before["accessors"]
                or after["bufferViews"][:len(before["bufferViews"])] != before["bufferViews"]
                or [m for m in after["meshes"] if m.get("name") != "skin"] !=
                   [m for m in before["meshes"] if m.get("name") != "skin"]
                or any(after.get(key) != before.get(key) for key in
                       ("materials", "textures", "images", "samplers", "nodes", "scenes"))
                or new_skin["primitives"][0]["attributes"] != old_skin["primitives"][0]["attributes"]
                or new_skin["primitives"][0]["targets"][:-2] != old_skin["primitives"][0].get("targets", [])
                or new_skin["extras"]["targetNames"] != old_names + PAIR
                or new_skin["weights"] != list(old_skin.get("weights") or [0] * len(old_names)) + [0, 0]
                or new_model["weight_shape"]["fit_sha"] != old_model["fit_sha"]
                or any(target["flips"] for target in audit["targets"].values())):
            raise ValueError("existing GLB content changed")
        original = source.read_bytes()
        candidate = output.read_bytes()
        return {
            "eligible": True,
            "oldSha256": hashlib.sha256(original).hexdigest(),
            "newSha256": hashlib.sha256(candidate).hexdigest(),
            "negativeLimit": audit["weight_shape"]["negativeLimit"],
            "positiveLimit": audit["weight_shape"]["positiveLimit"],
        }
    except Exception:
        output.unlink(missing_ok=True)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = prepare(args.source, args.output)
    except Exception as error:
        reason = str(error) if type(error) is ValueError and str(error) in SAFE_REASONS else type(error).__name__
        result = {"eligible": False, "reason": reason}
    args.report.write_text(json.dumps(result), encoding="utf-8")
    raise SystemExit(0 if result["eligible"] else 2)
