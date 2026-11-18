"""Private backfill contract on synthetic template geometry only."""

import hashlib
import json
import struct
import subprocess
import sys

import pytest

from reconstruction.tools.backfill_weight_shape import prepare
from reconstruction.tools.contour_morphs import add_contour_targets, read_glb
from reconstruction.tools.test_contour_morphs import mean_head_glb


def test_backfill_preserves_source_and_only_adds_weight_pair(tmp_path):
    source, output = tmp_path / "old.glb", tmp_path / "new.glb"
    mean_head_glb(source, protected=True, fit_sha="abcdef012345")
    original = source.read_bytes()
    _, old_binary = read_glb(str(source))
    result = prepare(source, output)
    glb, binary = read_glb(str(output))
    assert result["eligible"]
    assert result["oldSha256"] == hashlib.sha256(original).hexdigest()
    assert result["newSha256"] == hashlib.sha256(output.read_bytes()).hexdigest()
    assert source.read_bytes() == original
    assert glb["meshes"][0]["extras"]["targetNames"] == [
        "contour.weight_shape_neg", "contour.weight_shape_pos"]
    assert binary[:len(old_binary)] == old_binary


def test_backfill_rejects_unapproved_or_existing_output_without_overwrite(tmp_path):
    source, output = tmp_path / "old.glb", tmp_path / "new.glb"
    mean_head_glb(source, protected=True, model_version=2, fit_sha="abcdef012345")
    with pytest.raises(ValueError, match="unsupported model binding"):
        prepare(source, output)
    assert not output.exists()
    output.write_bytes(b"keep")
    with pytest.raises(ValueError, match="already exists"):
        prepare(source, output)
    assert output.read_bytes() == b"keep"


def test_backfill_rejects_missing_protected_regions(tmp_path):
    source, output = tmp_path / "old.glb", tmp_path / "new.glb"
    mean_head_glb(source, fit_sha="abcdef012345")
    with pytest.raises(ValueError, match="weight shape unavailable"):
        prepare(source, output)
    assert not output.exists()


def test_backfill_keeps_existing_contour_pair_order(tmp_path):
    source, contour, output = (tmp_path / name for name in ("old.glb", "contour.glb", "new.glb"))
    mean_head_glb(source, protected=True, model_version=2, fit_sha="abcdef012345")
    add_contour_targets(str(source), str(contour), validate_final=False)
    glb, binary = read_glb(str(contour))
    glb["asset"]["extras"]["live-mirror"]["version"] = 1
    payload = json.dumps(glb).encode()
    payload += b" " * (-len(payload) % 4)
    contour.write_bytes(struct.pack("<III", 0x46546C67, 2, 28 + len(payload) + len(binary)) +
                        struct.pack("<II", len(payload), 0x4E4F534A) + payload +
                        struct.pack("<II", len(binary), 0x004E4942) + binary)
    original_names = glb["meshes"][0]["extras"]["targetNames"]

    assert prepare(contour, output)["eligible"]
    updated, _ = read_glb(str(output))
    assert updated["meshes"][0]["extras"]["targetNames"] == original_names + [
        "contour.weight_shape_neg", "contour.weight_shape_pos"]


def test_cli_rejection_does_not_print_input_path(tmp_path):
    source, output, report = (tmp_path / name for name in
                              ("private-sample.glb", "output.glb", "report.json"))
    mean_head_glb(source, model_version=2, fit_sha="abcdef012345")
    result = subprocess.run([sys.executable, "-m", "reconstruction.tools.backfill_weight_shape",
                             str(source), str(output), "--report", str(report)],
                            text=True, capture_output=True, check=False)
    assert result.returncode == 2
    assert result.stdout == result.stderr == ""
    assert json.loads(report.read_text(encoding="utf-8")) == {
        "eligible": False, "reason": "unsupported model binding"}
    assert not output.exists()
