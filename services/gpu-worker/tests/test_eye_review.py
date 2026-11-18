"""Synthetic review metadata only; no captured face data."""

import hashlib
import json
import struct

from reconstruction.eye_review import from_glb, from_parts


def glb(review, sha):
    document = {
        "asset": {
            "version": "2.0",
            "extras": {
                "live-mirror": {
                    "eye_review": review,
                    "eye_parts_sha256": sha,
                }
            },
        }
    }
    chunk = json.dumps(document).encode()
    chunk += b" " * (-len(chunk) % 4)
    return struct.pack("<5I", 0x46546C67, 2, 20 + len(chunk), len(chunk), 0x4E4F534A) + chunk


def test_parts_judges_both_eyes_independently(tmp_path):
    path = tmp_path / "eye_parts.json"
    path.write_text(
        json.dumps(
            {"params": {"R": {"crease": {"heights": [0, 0.1, 0]}}, "L": {"crease": {"heights": [0, 0, 0]}}}}
        ),
        encoding="utf-8",
    )
    proof = from_parts(tmp_path)
    assert proof == ({"R": "present", "L": "absent"}, hashlib.sha256(path.read_bytes()).hexdigest())
    (tmp_path / "head.glb").write_bytes(glb(*proof))
    assert from_glb(tmp_path / "head.glb") == proof


def test_missing_or_invalid_parts_never_unlocks_an_eye(tmp_path):
    assert from_parts(tmp_path) is None
    (tmp_path / "eye_parts.json").write_text(
        json.dumps(
            {"params": {"R": {"crease": {"heights": [float("nan")]}}, "L": {"crease": {"heights": [0]}}}}
        ),
        encoding="utf-8",
    )
    assert from_parts(tmp_path) is None


def test_glb_reads_only_complete_review(tmp_path):
    path = tmp_path / "head.glb"
    sha = "a" * 64
    path.write_bytes(glb({"R": "present", "L": "absent"}, sha))
    assert from_glb(path) == ({"R": "present", "L": "absent"}, sha)
    path.write_bytes(glb({"R": "present"}, sha))
    assert from_glb(path) is None
    path.write_bytes(glb({"R": "present", "L": "absent"}, "A" * 64))
    assert from_glb(path) is None
