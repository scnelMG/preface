"""Synthetic GLB checks: no real person's geometry enters the repository."""

import json
import struct

import numpy as np
import pytest

from reconstruction.tools.backfill_nose_rig import backfill, exported_skin


def synthetic_glb(path, *, duplicate_mismatch=False):
    positions = np.array(
        [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0 if not duplicate_mismatch else 0.1, 0, 0]], "<f4"
    )
    template = np.array([0, 1, 2, 0], "<u4")
    triangles = np.array([0, 1, 2, 3, 1, 2], "<u4")
    pieces = [positions.tobytes(), template.tobytes(), triangles.tobytes()]
    offsets = [0, len(pieces[0]), len(pieces[0]) + len(pieces[1])]
    document = {
        "asset": {
            "version": "2.0",
            "extras": {"live-mirror": {"fit_sha": "123456789abc", "template_vertices": 3}},
        },
        "buffers": [{"byteLength": sum(map(len, pieces))}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": offsets[i], "byteLength": len(piece)}
            for i, piece in enumerate(pieces)
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 4, "type": "VEC3"},
            {"bufferView": 1, "componentType": 5125, "count": 4, "type": "SCALAR"},
            {"bufferView": 2, "componentType": 5125, "count": 6, "type": "SCALAR"},
        ],
        "meshes": [
            {
                "name": "skin",
                "primitives": [{"attributes": {"POSITION": 0, "_TEMPLATE_INDEX": 1}, "indices": 2}],
            }
        ],
    }
    encoded = json.dumps(document).encode()
    encoded += b" " * (-len(encoded) % 4)
    binary = b"".join(pieces)
    path.write_bytes(
        struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(encoded) + 8 + len(binary))
        + struct.pack("<II", len(encoded), 0x4E4F534A)
        + encoded
        + struct.pack("<II", len(binary), 0x004E4942)
        + binary
    )


def test_exported_skin_reconstructs_template_indices(tmp_path):
    path = tmp_path / "synthetic.glb"
    synthetic_glb(path)
    extra, positions, template, triangles = exported_skin(path)
    assert extra["fit_sha"] == "123456789abc"
    assert len(positions) == 3
    assert template.tolist() == [0, 1, 2, 0]
    assert triangles.tolist() == [[0, 1, 2], [3, 1, 2]]


def test_exported_skin_rejects_inconsistent_duplicate(tmp_path):
    path = tmp_path / "synthetic.glb"
    synthetic_glb(path, duplicate_mismatch=True)
    with pytest.raises(ValueError, match="inconsistent template"):
        exported_skin(path)


def test_backfill_never_overwrites_existing_rig(tmp_path):
    output = tmp_path / "rig.json"
    output.write_text("existing")
    with pytest.raises(FileExistsError):
        backfill(tmp_path / "absent.glb", output)
    assert output.read_text() == "existing"
