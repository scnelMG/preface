"""Audit weight-shape plus each available GLB morph on private or synthetic heads.

Only aggregate counts are printed. Input GLBs and geometry never leave this process except
the local Node geometry validator; no result files are written.
"""

import argparse
import json
import os
import subprocess
from collections import Counter
from itertools import combinations as pairs

import numpy as np

if __package__:
    from .contour_morphs import accessor, read_glb
else:
    from contour_morphs import accessor, read_glb

HERE = os.path.dirname(os.path.abspath(__file__))
AUDITOR = os.path.join(HERE, "audit_weight_shape.mjs")
EYE_AUDITOR = os.path.join(HERE, "audit_weight_eye.mjs")
NOSE_AUDITOR = os.path.join(HERE, "audit_weight_nose.mjs")
LEVELS = (0.25, 0.5, 0.75, 1.0)


def target_delta(glb, binary, index):
    entry = glb["accessors"][index]
    if entry["type"] != "VEC3" or entry["componentType"] != 5126:
        raise ValueError("unsupported morph accessor")
    result = np.zeros((entry["count"], 3), dtype=np.float32)
    if "bufferView" in entry:
        result[:] = accessor(glb, binary, index)
    sparse = entry.get("sparse")
    if sparse:
        ids = sparse["indices"]
        view = glb["bufferViews"][ids["bufferView"]]
        types = {5121: "B", 5123: "H", 5125: "I"}
        kind = types.get(ids["componentType"])
        if not kind:
            raise ValueError("unsupported sparse indices")
        start = view.get("byteOffset", 0) + ids.get("byteOffset", 0)
        selected = np.frombuffer(binary, dtype={"B": "u1", "H": "<u2", "I": "<u4"}[kind],
                                 count=sparse["count"], offset=start)
        values = sparse["values"]
        view = glb["bufferViews"][values["bufferView"]]
        start = view.get("byteOffset", 0) + values.get("byteOffset", 0)
        if selected.size and selected.max() >= entry["count"]:
            raise ValueError("sparse index out of range")
        result[selected] = np.frombuffer(binary, dtype="<f4", count=sparse["count"] * 3,
                                         offset=start).reshape(-1, 3)
    if not np.isfinite(result).all():
        raise ValueError("non-finite morph")
    return result.astype(np.float64)


def model_mesh(glb, binary):
    skins = [mesh for mesh in glb["meshes"] if mesh.get("name") == "skin"]
    if len(skins) != 1 or len(skins[0].get("primitives", [])) != 1:
        raise ValueError("one skin primitive required")
    mesh = skins[0]
    primitive = mesh["primitives"][0]
    base = accessor(glb, binary, primitive["attributes"]["POSITION"]).astype(np.float64)
    faces = accessor(glb, binary, primitive["indices"]).astype(np.int64).reshape(-1, 3)
    names = mesh.get("extras", {}).get("targetNames", [])
    if len(names) != len(primitive.get("targets", [])) or faces.max() >= len(base):
        raise ValueError("invalid skin morphs or faces")
    deltas = {name: target_delta(glb, binary, target["POSITION"])
              for name, target in zip(names, primitive["targets"])
              if name.startswith("contour.") or name.startswith("nose.")}
    if not all(f"contour.weight_shape_{side}" in deltas for side in ("neg", "pos")):
        raise ValueError("weight-shape target pair missing")
    return base, faces, deltas


def intersections(base, changed, faces):
    payload = {"kind": "composite", "base": base.ravel().tolist(),
               "edited": changed.ravel().tolist(), "index": faces.ravel().tolist()}
    result = subprocess.run(["node", AUDITOR], input=json.dumps(payload), text=True,
                            capture_output=True, check=True, timeout=120)
    checked = json.loads(result.stdout)
    return None if checked.get("valid") else checked.get("reason", "audit unavailable")


def combinations(deltas):
    effects = available_effects(deltas)
    for weight_side in ("neg", "pos"):
        for effect in effects:
            for side in ("neg", "pos"):
                other = effect_delta(deltas, effect, side)
                for weight_level in LEVELS:
                    for other_level in LEVELS:
                        yield (weight_side, effect, side, weight_level, other_level,
                               weight_level * deltas[f"contour.weight_shape_{weight_side}"] + other_level * other)


def available_effects(deltas):
    contour = sorted({name[:-4] for name in deltas if name.startswith("contour.")
                      and name.endswith("_neg") and name != "contour.weight_shape_neg"
                      and f"{name[:-4]}_pos" in deltas})
    return contour + sorted(name for name in deltas if name.startswith("nose."))


def effect_delta(deltas, effect, side):
    return deltas[f"{effect}_{side}"] if effect.startswith("contour.") else \
        deltas[effect] * (-1 if side == "neg" else 1)


def audit_multi(base, faces, deltas, level=1.0):
    failures = Counter()
    final_failures = Counter()
    count = 0
    failed_cases = []
    for left, right in pairs(available_effects(deltas), 2):
        for left_side in ("neg", "pos"):
            for right_side in ("neg", "pos"):
                baseline = base + level * (effect_delta(deltas, left, left_side) +
                                           effect_delta(deltas, right, right_side))
                for weight_side in ("neg", "pos"):
                    count += 1
                    edited = baseline + level * deltas[f"contour.weight_shape_{weight_side}"]
                    if intersections(baseline, edited, faces):
                        failures[(left, right)] += 1
                        failed_cases.append([left, left_side, right, right_side, weight_side])
                    if intersections(base, edited, faces):
                        final_failures[(left, right)] += 1
    return {"level": level, "samples": count, "failed": sum(failures.values()),
            "failedPairs": [[left, right, n] for (left, right), n in sorted(failures.items())],
            "failedCases": failed_cases, "finalFailed": sum(final_failures.values()),
            "finalFailedPairs": [[left, right, n] for (left, right), n in sorted(final_failures.items())]}


def eye_audit(path, glb, binary, base, faces, deltas):
    mesh = next(mesh for mesh in glb["meshes"] if mesh.get("name") == "skin")
    primitive = mesh["primitives"][0]
    normals = accessor(glb, binary, primitive["attributes"]["NORMAL"])
    metadata = glb.get("asset", {}).get("extras", {}).get("live-mirror", {})
    sample_sha = None
    if os.path.basename(path) in ("base-male.glb", "base-female.glb"):
        manifest = os.path.abspath(os.path.join(HERE, "../../../../apps/web/public/models/manifest.json"))
        with open(manifest, encoding="utf-8") as source:
            sample_sha = next((model["sha256"] for model in json.load(source)["models"]
                               if model["file"] == os.path.basename(path)), None)
    payload = {"base": base.ravel().tolist(), "normals": normals.ravel().tolist(),
               "index": faces.ravel().tolist(),
               "negative": deltas["contour.weight_shape_neg"].ravel().tolist(),
               "positive": deltas["contour.weight_shape_pos"].ravel().tolist(),
               "synthetic": metadata.get("synthetic") is True, "sampleSha": sample_sha,
               "review": {"L": "absent", "R": "absent"}}
    result = subprocess.run(["node", EYE_AUDITOR, path], input=json.dumps(payload), text=True,
                            capture_output=True, check=True, timeout=600)
    return json.loads(result.stdout)


def nose_audit(path, rig_path, deltas):
    payload = {"negative": deltas["contour.weight_shape_neg"].ravel().tolist(),
               "positive": deltas["contour.weight_shape_pos"].ravel().tolist()}
    result = subprocess.run(["node", NOSE_AUDITOR, path, rig_path], input=json.dumps(payload),
                            text=True, capture_output=True, check=True, timeout=600)
    return json.loads(result.stdout)


def audit(path, include_eyes=False, rig_path=None, include_multi=False):
    glb, binary = read_glb(path)
    base, faces, deltas = model_mesh(glb, binary)
    failures = Counter()
    counts = Counter()
    failed_cases = []
    for weight_side, effect, side, weight_level, other_level, shift in combinations(deltas):
        counts[effect] += 1
        other = effect_delta(deltas, effect, side)
        baseline = base + other_level * other
        changed = base + shift
        # Existing solo edits are already exposed; require weight to introduce no additional defect.
        failure = intersections(baseline, changed, faces)
        if failure:
            failures[(effect, failure)] += 1
            failed_cases.append([effect, weight_side, side, weight_level, other_level])
    return {"samples": sum(counts.values()), "effects": len(counts),
            "failures": [{"effect": effect, "reason": reason, "count": count}
                         for (effect, reason), count in sorted(failures.items())],
            "failedCases": failed_cases,
            **({"eyes": eye_audit(path, glb, binary, base, faces, deltas)} if include_eyes else {}),
            **({"nose": nose_audit(path, rig_path, deltas)} if rig_path else {}),
            **({"multi": audit_multi(base, faces, deltas)} if include_multi else {})}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("glb", nargs="+", help="local private or synthetic GLB; never printed")
    parser.add_argument("--eyes", action="store_true", help="audit approved eye controls on refined skin")
    parser.add_argument("--multi", action="store_true", help="audit full-strength weight with every pair of GLB effects")
    parser.add_argument("--nose-rig", nargs="*", help="matching local nose rig JSON files; never printed")
    args = parser.parse_args()
    if args.nose_rig is not None and len(args.nose_rig) != len(args.glb):
        parser.error("one nose rig is required per GLB")
    for number, path in enumerate(args.glb, 1):
        try:
            rig = args.nose_rig[number - 1] if args.nose_rig else None
            print(json.dumps({"model": number, **audit(path, args.eyes, rig, args.multi)}, ensure_ascii=False))
        except (OSError, ValueError, KeyError, IndexError, subprocess.SubprocessError) as error:
            print(json.dumps({"model": number, "error": type(error).__name__}))
