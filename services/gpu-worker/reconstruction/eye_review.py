"""Read the source eye-fold judgement and its copy in the exported GLB."""

import hashlib
import json
import math
import re
import struct
from pathlib import Path


def from_parts(model_dir: str | Path) -> tuple[dict[str, str], str] | None:
    path = Path(model_dir) / "eye_parts.json"
    try:
        data = path.read_bytes()
        params = json.loads(data)["params"]
        review = {}
        for side in ("R", "L"):
            heights = params[side]["crease"]["heights"]
            if (
                not isinstance(heights, list)
                or not heights
                or any(
                    isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
                    for value in heights
                )
            ):
                return None
            review[side] = "present" if any(value > 0 for value in heights) else "absent"
        return review, hashlib.sha256(data).hexdigest()
    except (OSError, KeyError, TypeError, ValueError):
        return None


def from_glb(path: Path) -> tuple[dict[str, str], str] | None:
    try:
        with path.open("rb") as file:
            header = file.read(20)
            if len(header) != 20:
                return None
            magic, version, _, json_length, chunk_type = struct.unpack("<5I", header)
            if magic != 0x46546C67 or version != 2 or chunk_type != 0x4E4F534A:
                return None
            metadata = json.loads(file.read(json_length))["asset"]["extras"]["live-mirror"]
            review = metadata["eye_review"]
            sha = metadata["eye_parts_sha256"]
            if (
                isinstance(review, dict)
                and set(review) == {"R", "L"}
                and all(review[side] in ("present", "absent") for side in ("R", "L"))
                and isinstance(sha, str)
                and re.fullmatch(r"[0-9a-f]{64}", sha)
            ):
                return review, sha
    except (OSError, KeyError, TypeError, ValueError, struct.error):
        pass
    return None
