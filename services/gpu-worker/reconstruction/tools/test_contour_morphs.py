"""Contour morph baking on a GLB made from the GNM mean head (synthetic): no real person's geometry here."""

import json
import struct
import subprocess
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from reconstruction.tools.audit_weight_combinations import audit_multi, intersections, model_mesh, target_delta
from reconstruction.tools.contour_morphs import (
    CONTOUR_EFFECTS, TEMPLATE, accessor, add_contour_targets, read_glb, spatial_contour_weights,
)
from reconstruction.tools.repair_cheekbone_morph import repair_cheekbone


def test_spatial_contours_do_not_move_protected_regions(tmp_path):
    src, out = tmp_path / "head.glb", tmp_path / "out.glb"
    mean_head_glb(src, protected=True)
    add_contour_targets(str(src), str(out))
    glb, binary = read_glb(out)
    mesh = glb["meshes"][0]
    primitive = mesh["primitives"][0]
    ids = accessor(glb, binary, primitive["attributes"]["_TEMPLATE_INDEX"])
    metadata = glb["asset"]["extras"]["live-mirror"]
    regions = metadata["regions"]
    protected = np.isin(ids, regions["left_eye"] + regions["right_eye"] + regions["nose_region"])
    assert protected.any()
    lips = np.isin(ids, [metadata["landmark_vertex_ids"][i] for i in (61, 291)])
    assert lips.sum() == 2
    for code in ("contour.cheekbone", "contour.jaw_angle"):
        assert metadata["contour_morphs"]["measured_limits"][code] == {"negative": 1, "positive": 1}
        for suffix in ("_neg", "_pos"):
            target = primitive["targets"][mesh["extras"]["targetNames"].index(code + suffix)]
            delta = target_delta(glb, binary, target["POSITION"])
            assert not np.any(delta[protected | lips])
            assert np.max(np.linalg.norm(delta[~protected], axis=1)) > .001


def test_nearby_disconnected_surfaces_keep_both_full_contour_ends():
    surface = np.array([[0, 0, 0], [.008, 0, 0], [0, .008, 0]])
    base = np.concatenate((surface, surface + [0, 0, .00018]))
    delta = np.zeros_like(base)
    delta[:2, 2] = [.0012, -.0012]
    weights = spatial_contour_weights(base)
    audit = Path(__file__).with_name("audit_weight_shape.mjs")

    def checked_limit(displacement):
        payload = {"kind": "contour", "base": base.ravel().tolist(), "index": list(range(6)),
                   "delta": displacement.ravel().tolist()}
        result = subprocess.run(["node", str(audit)], input=json.dumps(payload), text=True,
                                capture_output=True, check=True, timeout=10)
        return json.loads(result.stdout)["limit"]

    for direction in (-delta, delta):
        assert checked_limit(direction) == .1
        assert checked_limit(weights @ direction) == 1


def test_existing_cheekbone_repair_preserves_other_targets_and_original_bytes(tmp_path, monkeypatch):
    src, old, new = (tmp_path / filename for filename in ("head.glb", "old.glb", "new.glb"))
    mean_head_glb(src, protected=True)
    monkeypatch.setattr("reconstruction.tools.contour_morphs.protected_contour_fade",
                        lambda geo, ids, regions: np.ones((len(ids), 1)))
    add_contour_targets(str(src), str(old))
    repair_cheekbone(old, new)
    before, original = read_glb(old)
    after, repaired = read_glb(new)
    old_skin, new_skin = before["meshes"][0], after["meshes"][0]
    old_primitive, new_primitive = old_skin["primitives"][0], new_skin["primitives"][0]
    assert repaired.startswith(original)
    assert old_skin["extras"] == new_skin["extras"]
    assert old_primitive["attributes"] == new_primitive["attributes"]
    assert old_primitive["indices"] == new_primitive["indices"]
    ids = accessor(after, repaired, new_primitive["attributes"]["_TEMPLATE_INDEX"])
    regions = after["asset"]["extras"]["live-mirror"]["regions"]
    protected = np.isin(ids, regions["left_eye"] + regions["right_eye"] + regions["nose_region"])
    for i, name in enumerate(old_skin["extras"]["targetNames"]):
        previous, current = old_primitive["targets"][i], new_primitive["targets"][i]
        if name.startswith("contour.cheekbone_"):
            assert np.any(target_delta(before, original, previous["POSITION"])[protected])
            assert not np.any(target_delta(after, repaired, current["POSITION"])[protected])
        else:
            assert previous == current


def mean_head_glb(path, *, scale=1.0, shift=(0.0, 0.0, 0.0), protected=False, model_version=1,
                  sample=False, fit_sha="synthetic"):
    tpl = np.load(TEMPLATE)
    v = tpl["vertices"]
    mat = tpl["materials"]
    faces = tpl["triangles"][(mat[tpl["triangles"]] == 0).all(1)]
    ids, inv = np.unique(faces, return_inverse=True)
    positions = (tpl["vertices"][ids] * scale + np.asarray(shift)).astype("<f4")
    pieces = [positions.tobytes(), ids.astype("<u4").tobytes(), inv.ravel().astype("<u4").tobytes()]
    offsets = np.cumsum([0] + [len(p) for p in pieces[:-1]]).tolist()
    regions = {}
    if protected:
        skin = mat == 0
        regions = {
            "left_eye": np.where(skin & (v[:, 0] > .025) & (v[:, 1] > .29) & (v[:, 2] > .07))[0].tolist(),
            "right_eye": np.where(skin & (v[:, 0] < -.025) & (v[:, 1] > .29) & (v[:, 2] > .07))[0].tolist(),
            "upper_lip": np.where(skin & (np.abs(v[:, 0]) < .02) & (v[:, 1] > .23) &
                                   (v[:, 1] < .245) & (v[:, 2] > .13))[0].tolist(),
            "lower_lip": np.where(skin & (np.abs(v[:, 0]) < .02) & (v[:, 1] > .215) &
                                   (v[:, 1] < .23) & (v[:, 2] > .13))[0].tolist(),
            "nose_region": np.where(skin & (np.abs(v[:, 0]) < .018) & (v[:, 1] > .255) &
                                    (v[:, 1] < .31) & (v[:, 2] > .12))[0].tolist(),
            "ears": np.where(skin & (np.abs(v[:, 0]) > .08) & (v[:, 1] > .22) &
                             (v[:, 1] < .31))[0].tolist(),
        }
    sample_landmarks = [0] * 468
    skin_ids = np.flatnonzero(mat == 0)
    sample_landmarks[61] = int(skin_ids[np.linalg.norm(v[skin_ids] - [-.024, .23, .10], axis=1).argmin()])
    sample_landmarks[291] = int(skin_ids[np.linalg.norm(v[skin_ids] - [.024, .23, .10], axis=1).argmin()])
    document = {
        "asset": {"version": "2.0", "extras": {"live-mirror": {"synthetic": True, "regions": regions,
                                                            "name": "bald-synthetic-editable-head" if sample else "live-mirror-head",
                                                            "version": 3 if sample else model_version,
                                                            "template_vertices": len(v),
                                                            "fit_sha": fit_sha,
                                                            "landmark_vertex_ids": sample_landmarks}}},
        "buffers": [{"byteLength": sum(map(len, pieces))}],
        "bufferViews": [{"buffer": 0, "byteOffset": o, "byteLength": len(p)} for o, p in zip(offsets, pieces)],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(ids), "type": "VEC3"},
            {"bufferView": 1, "componentType": 5125, "count": len(ids), "type": "SCALAR"},
            {"bufferView": 2, "componentType": 5125, "count": int(inv.size), "type": "SCALAR"},
        ],
        "meshes": [{"name": "skin", "primitives": [
            {"attributes": {"POSITION": 0, "_TEMPLATE_INDEX": 1}, "indices": 2, "mode": 4}]}],
        "nodes": [{"name": "skin", "mesh": 0}], "scenes": [{"nodes": [0]}], "scene": 0,
    }
    js = json.dumps(document).encode()
    js += b" " * (-len(js) % 4)
    binary = b"".join(pieces)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, 28 + len(js) + len(binary)))
        fh.write(struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(binary), 0x004E4942) + binary)
    return positions


@pytest.mark.parametrize("scale,shift", [(1.0, (0, 0, 0)), (0.74, (0.01, -0.2, 0.03))])
def test_adds_sparse_neg_pos_pairs_without_folds(tmp_path, scale, shift):
    src, out = tmp_path / "head.glb", tmp_path / "out.glb"
    base = mean_head_glb(src, scale=scale, shift=shift)
    report = add_contour_targets(str(src), str(out), validate_final=False)

    glb, _ = read_glb(str(out))
    mesh = glb["meshes"][0]
    names = mesh["extras"]["targetNames"]
    assert names == [code + suffix for code in CONTOUR_EFFECTS for suffix in ("_neg", "_pos")]
    assert mesh["weights"] == [0] * len(names)
    for target in mesh["primitives"][0]["targets"]:
        acc = glb["accessors"][target["POSITION"]]
        assert "bufferView" not in acc and 0 < acc["sparse"]["count"] < acc["count"] // 2
    assert all(v["flips"] == 0 for v in report["targets"].values())
    # neutral geometry is untouched; only targets were added
    pos = np.frombuffer(open(out, "rb").read()[28 + struct.unpack_from("<I", open(out, "rb").read(), 12)[0]:][:base.nbytes], "<f4")
    assert np.array_equal(pos.reshape(-1, 3), base)


def test_refuses_a_glb_that_already_has_contour_targets(tmp_path):
    src, out = tmp_path / "head.glb", tmp_path / "out.glb"
    mean_head_glb(src)
    add_contour_targets(str(src), str(out), validate_final=False)
    with pytest.raises(ValueError, match="already present"):
        add_contour_targets(str(out), str(tmp_path / "again.glb"))


def test_refuses_contour_target_when_final_skin_is_unsafe(tmp_path, monkeypatch):
    src = tmp_path / "head.glb"
    mean_head_glb(src)
    monkeypatch.setattr("reconstruction.tools.contour_morphs.subprocess.run",
                        lambda *args, **kwargs: SimpleNamespace(stdout='{"valid":false}'))
    with pytest.raises(ValueError, match="unsafe contour final mesh"):
        add_contour_targets(str(src), str(tmp_path / "out.glb"))


def test_refuses_new_contour_without_mouth_landmarks(tmp_path, monkeypatch):
    src = tmp_path / "head.glb"
    mean_head_glb(src)
    glb, binary = read_glb(str(src))
    del glb["asset"]["extras"]["live-mirror"]["landmark_vertex_ids"]
    monkeypatch.setattr("reconstruction.tools.contour_morphs.read_glb", lambda _: (glb, binary))
    with pytest.raises(ValueError, match="mouth landmarks unavailable"):
        add_contour_targets(str(src), str(tmp_path / "out.glb"))


def test_skips_both_directions_when_one_contour_end_is_unsafe(tmp_path, monkeypatch):
    src, out = tmp_path / "head.glb", tmp_path / "out.glb"
    mean_head_glb(src)
    calls = iter([0, 1, .025, .05] + [1] * 8)
    monkeypatch.setattr("reconstruction.tools.contour_morphs.subprocess.run",
                        lambda *args, **kwargs: SimpleNamespace(stdout=json.dumps({"limit": next(calls)})))
    report = add_contour_targets(str(src), str(out))
    glb, _ = read_glb(str(out))
    names = glb["meshes"][0]["extras"]["targetNames"]
    assert report["skipped"] == ["contour.cheekbone"]
    assert len(names) == 10 and all("cheekbone" not in name for name in names)
    assert "contour.cheekbone" not in glb["asset"]["extras"]["live-mirror"]["contour_morphs"]["codes"]
    assert {"negative": .025, "positive": .05} in glb["asset"]["extras"]["live-mirror"]["contour_morphs"]["measured_limits"].values()


def test_refuses_duplicate_existing_contour_target_names(tmp_path, monkeypatch):
    src, out = tmp_path / "head.glb", tmp_path / "contour.glb"
    mean_head_glb(src)
    add_contour_targets(str(src), str(out), validate_final=False)
    glb, binary = read_glb(str(out))
    mesh = glb["meshes"][0]
    mesh["extras"]["targetNames"].append(mesh["extras"]["targetNames"][-1])
    mesh["primitives"][0]["targets"].append(mesh["primitives"][0]["targets"][-1])
    monkeypatch.setattr("reconstruction.tools.contour_morphs.read_glb", lambda _: (glb, binary))
    with pytest.raises(ValueError, match="incomplete"):
        add_contour_targets(str(out), str(tmp_path / "invalid.glb"))


def test_adds_weight_shape_to_existing_synthetic_contour_without_changing_old_targets(tmp_path):
    src, contour, out = (tmp_path / name for name in ("head.glb", "contour.glb", "weight.glb"))
    mean_head_glb(src, sample=True)
    add_contour_targets(str(src), str(contour), validate_final=False)
    before, binary = read_glb(str(contour))

    report = add_contour_targets(str(contour), str(out), synthetic_sample=True)
    after, updated_binary = read_glb(str(out))
    old_mesh, new_mesh = before["meshes"][0], after["meshes"][0]
    assert report["weight_shape"]["eligible"]
    assert new_mesh["extras"]["targetNames"] == old_mesh["extras"]["targetNames"] + [
        "contour.weight_shape_neg", "contour.weight_shape_pos"]
    assert new_mesh["primitives"][0]["targets"][:-2] == old_mesh["primitives"][0]["targets"]
    assert updated_binary[:len(binary)] == binary
    assert after["asset"]["extras"]["live-mirror"]["weight_shape"]["fit_sha"] == "synthetic"
    assert all(target["flips"] == 0 for target in report["targets"].values())
    prim = new_mesh["primitives"][0]
    template = accessor(after, updated_binary, prim["attributes"]["_TEMPLATE_INDEX"])
    corners = after["asset"]["extras"]["live-mirror"]["landmark_vertex_ids"]
    mouth_rows = np.where(np.isin(template, [corners[61], corners[291]]))[0]
    assert len(mouth_rows) == 2
    for target in prim["targets"][-2:]:
        sparse = after["accessors"][target["POSITION"]]["sparse"]
        view = after["bufferViews"][sparse["indices"]["bufferView"]]
        stored = np.frombuffer(updated_binary, dtype="<u4", count=sparse["count"], offset=view["byteOffset"])
        assert not np.isin(mouth_rows, stored).any()


@pytest.mark.parametrize("scale,shift", [(1.0, (0, 0, 0)), (0.74, (0.01, -0.2, 0.03))])
def test_weight_shape_is_baked_only_with_protected_regions_and_safe_limits(tmp_path, scale, shift):
    src, out = tmp_path / "head.glb", tmp_path / "out.glb"
    mean_head_glb(src, scale=scale, shift=shift, protected=True)
    report = add_contour_targets(str(src), str(out), validate_final=False)
    glb, _ = read_glb(str(out))
    names = glb["meshes"][0]["extras"]["targetNames"]
    assert report["weight_shape"]["eligible"], report["weight_shape"]
    assert names[-2:] == ["contour.weight_shape_neg", "contour.weight_shape_pos"]
    assert glb["asset"]["extras"]["live-mirror"]["weight_shape"]["fit_sha"] == "synthetic"
    assert all(report["targets"][name]["flips"] == 0 for name in names[-2:])


def test_weight_shape_stays_locked_for_unknown_model_version(tmp_path):
    src, out = tmp_path / "head.glb", tmp_path / "out.glb"
    mean_head_glb(src, protected=True, model_version=2)
    report = add_contour_targets(str(src), str(out), validate_final=False)
    glb, _ = read_glb(str(out))
    assert report["weight_shape"]["eligible"] is False
    assert "contour.weight_shape_pos" not in glb["meshes"][0]["extras"]["targetNames"]


def test_weight_only_backfill_does_not_add_other_contour_targets(tmp_path):
    src, out = tmp_path / "old.glb", tmp_path / "new.glb"
    base = mean_head_glb(src, protected=True)
    report = add_contour_targets(str(src), str(out), weight_only=True)
    glb, binary = read_glb(str(out))
    assert report["weight_shape"]["eligible"]
    assert glb["meshes"][0]["extras"]["targetNames"] == [
        "contour.weight_shape_neg", "contour.weight_shape_pos"]
    assert "contour_morphs" not in glb["asset"]["extras"]["live-mirror"]
    assert np.array_equal(np.frombuffer(binary[:base.nbytes], "<f4").reshape(-1, 3), base)


def test_adds_checked_contour_to_weight_only_backfill_without_changing_existing_assets(tmp_path):
    source, weight, output = (tmp_path / name for name in ("source.glb", "weight.glb", "combined.glb"))
    mean_head_glb(source, protected=True)
    add_contour_targets(str(source), str(weight), weight_only=True)
    original = weight.read_bytes()
    before, binary = read_glb(str(weight))

    report = add_contour_targets(str(weight), str(output))

    after, new_binary = read_glb(str(output))
    before_skin, after_skin = before["meshes"][0], after["meshes"][0]
    before_metadata = before["asset"]["extras"]["live-mirror"]
    after_metadata = after["asset"]["extras"]["live-mirror"]
    limits = after_metadata["contour_morphs"]["measured_limits"]
    assert limits and all(code in CONTOUR_EFFECTS for code in limits)
    assert after_skin["extras"]["targetNames"] == before_skin["extras"]["targetNames"] + [
        code + suffix for code in limits for suffix in ("_neg", "_pos")
    ]
    assert all(target["flips"] == 0 for target in report["targets"].values())
    assert after_skin["primitives"][0]["targets"][:2] == before_skin["primitives"][0]["targets"]
    assert after_skin["weights"][:2] == before_skin["weights"]
    assert after_metadata["weight_shape"] == before_metadata["weight_shape"]
    assert new_binary[:len(binary)] == binary
    assert weight.read_bytes() == original
    prim = after_skin["primitives"][0]
    ids = accessor(after, new_binary, prim["attributes"]["_TEMPLATE_INDEX"])
    regions = after_metadata["regions"]
    protected = np.isin(ids, regions["left_eye"] + regions["right_eye"] + regions["nose_region"])
    assert protected.any() and "contour.jaw_angle" in limits
    for target in prim["targets"][2:]:
        delta = target_delta(after, new_binary, target["POSITION"])
        assert not np.any(delta[protected])
        assert np.any(delta[~protected])


def test_refuses_incomplete_weight_pair_before_baking_contour(tmp_path, monkeypatch):
    source = tmp_path / "source.glb"
    mean_head_glb(source)
    glb, binary = read_glb(str(source))
    skin = glb["meshes"][0]
    skin["extras"] = {"targetNames": ["contour.weight_shape_neg"]}
    skin["primitives"][0]["targets"] = [{"POSITION": 0}]
    monkeypatch.setattr("reconstruction.tools.contour_morphs.read_glb", lambda _: (glb, binary))

    output = tmp_path / "combined.glb"
    with pytest.raises(ValueError, match="incomplete or duplicate weight shape"):
        add_contour_targets(str(source), str(output))
    assert not output.exists()


@pytest.mark.parametrize("sample", ["base-male", "base-female"])
def test_public_weight_targets_do_not_create_combined_cheek_or_jaw_intersections(sample):
    path = Path(__file__).resolve().parents[4] / "apps/web/public/models" / f"{sample}.glb"
    glb, binary = read_glb(str(path))
    base, faces, deltas = model_mesh(glb, binary)
    for effect in ("contour.cheekbone", "contour.chin_length", "contour.chin_width", "nose.alar_width"):
        for side in ("neg", "pos"):
            other = (deltas[f"{effect}_{side}"] if effect.startswith("contour.")
                     else deltas[effect] * (1 if side == "pos" else -1))
            for weight_side in ("neg", "pos"):
                baseline = base + other
                assert intersections(baseline, baseline + deltas[f"contour.weight_shape_{weight_side}"], faces) is None, \
                    (sample, effect, side, weight_side)


@pytest.mark.parametrize("sample", ["base-male", "base-female"])
def test_public_contour_targets_have_safe_final_skin(sample):
    path = Path(__file__).resolve().parents[4] / "apps/web/public/models" / f"{sample}.glb"
    glb, binary = read_glb(str(path))
    base, faces, deltas = model_mesh(glb, binary)
    for name, delta in deltas.items():
        if name.startswith("contour.") and not name.startswith("contour.weight_shape"):
            assert intersections(base, base + delta, faces) is None, (sample, name)


def test_multi_audit_checks_final_mesh_against_neutral(monkeypatch):
    base = np.zeros((3, 3))
    delta = np.ones_like(base)
    deltas = {f"{code}_{side}": delta for code in ("contour.a", "contour.b", "contour.weight_shape")
              for side in ("neg", "pos")}
    monkeypatch.setattr("reconstruction.tools.audit_weight_combinations.intersections",
                        lambda original, edited, faces: "unsafe" if np.array_equal(original, base) else None)
    result = audit_multi(base, np.array([[0, 1, 2]]), deltas)
    assert result["samples"] == 8
    assert result["failed"] == 0
    assert result["finalFailed"] == 8
