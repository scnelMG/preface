"""공개 합성 GLB의 점·morph를 읽어 3D 분석 가능성을 확인한다. 실제 얼굴 입력은 받지 않는다."""

import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[4]
MODELS = ROOT / "apps/web/public/models"
sys.path.insert(0, str(ROOT / "services/gpu-worker/reconstruction/pipeline"))
from render import render, save_png, view_matrix  # noqa: E402


DTYPES = {5123: "<u2", 5125: "<u4", 5126: "<f4"}
COMPONENTS = {"SCALAR": 1, "VEC3": 3}
PAIRS = {
    "inner_eye_candidate": (133, 362),
    "alar_candidate": (49, 279),
    "cheek_candidate": (234, 454),
    "jaw_candidate": (172, 397),
}
COLORS = {
    "inner_eye_candidate": (15, 100, 220),
    "alar_candidate": (225, 75, 40),
    "cheek_candidate": (20, 145, 80),
    "jaw_candidate": (135, 75, 180),
}


def load_sample(key):
    manifest = json.loads((MODELS / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("synthetic") is not True:
        raise ValueError("합성 모델만 허용한다")
    sample = next((item for item in manifest["models"] if item["key"] == key), None)
    if sample is None:
        raise ValueError("등록된 합성 모델이 아니다")
    raw = (MODELS / sample["file"]).read_bytes()
    if hashlib.sha256(raw).hexdigest() != sample["sha256"]:
        raise ValueError("모델 해시 불일치")
    magic, version, length = struct.unpack_from("<III", raw)
    if (magic, version, length) != (0x46546C67, 2, len(raw)):
        raise ValueError("GLB 헤더 불일치")
    json_len, json_type = struct.unpack_from("<II", raw, 12)
    if json_type != 0x4E4F534A:
        raise ValueError("GLB JSON 청크 불일치")
    gltf = json.loads(raw[20:20 + json_len])
    binary_len, binary_type = struct.unpack_from("<II", raw, 20 + json_len)
    if binary_type != 0x004E4942:
        raise ValueError("GLB BIN 청크 불일치")
    binary_start = 28 + json_len

    def read(index):
        accessor = gltf["accessors"][index]
        view = gltf["bufferViews"][accessor["bufferView"]]
        dtype = np.dtype(DTYPES[accessor["componentType"]])
        components = COMPONENTS[accessor["type"]]
        if view.get("byteStride", components * dtype.itemsize) != components * dtype.itemsize or "sparse" in accessor:
            raise ValueError("이 PoC에서 지원하지 않는 접근자")
        offset = binary_start + view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        size = accessor["count"] * components * dtype.itemsize
        if offset + size > binary_start + binary_len:
            raise ValueError("GLB 접근자 범위 초과")
        return np.frombuffer(raw, dtype=dtype, count=accessor["count"] * components, offset=offset).reshape(-1, components)

    mesh = next(item for item in gltf["meshes"] if item["name"] == "skin")
    primitive = mesh["primitives"][0]
    vertices = read(primitive["attributes"]["POSITION"]).astype(np.float64)
    template_ids = read(primitive["attributes"]["_TEMPLATE_INDEX"]).ravel().astype(np.int64)
    triangles = read(primitive["indices"]).ravel().astype(np.int64).reshape(-1, 3)
    target_names = mesh["extras"]["targetNames"]
    target = read(primitive["targets"][target_names.index("nose.alar_width")]["POSITION"]).astype(np.float64)
    landmark_ids = gltf["asset"]["extras"]["live-mirror"]["landmark_vertex_ids"]
    if len(landmark_ids) != 468 or not np.isfinite(vertices).all() or not np.isfinite(target).all():
        raise ValueError("점 또는 형상 정보 불일치")
    mapped = {}
    for landmark in {index for pair in PAIRS.values() for index in pair}:
        hits = np.flatnonzero(template_ids == landmark_ids[landmark])
        if not len(hits) or np.ptp(vertices[hits], axis=0).max() > 1e-5:
            raise ValueError("템플릿 점이 없거나 중복 위치가 다르다")
        mapped[landmark] = int(hits[0])
    return vertices, triangles, target, mapped, sample["sha256"]


def widths(vertices, mapped):
    return {name: float(np.linalg.norm(vertices[mapped[left]] - vertices[mapped[right]]))
            for name, (left, right) in PAIRS.items()}


def marked_view(vertices, triangles, mapped, view="front"):
    center = (vertices.max(0) + vertices.min(0)) / 2
    extent = np.abs((vertices - center)[:, :2]).max() * 1.08
    image = render(vertices, triangles, view, size=512, center=center, extent=extent)
    rotation = view_matrix(*(0, 0) if view == "front" else (35, 0))
    for name, pair in PAIRS.items():
        for landmark in pair:
            point = (vertices[mapped[landmark]] - center) @ rotation.T
            px = int(round(point[0] * 512 / (2 * extent) + 256))
            py = int(round(256 - point[1] * 512 / (2 * extent)))
            yy, xx = np.ogrid[:512, :512]
            image[(xx - px) ** 2 + (yy - py) ** 2 <= 36] = COLORS[name]
    return image


def run(key, output):
    vertices, triangles, target, mapped, digest = load_sample(key)
    after = vertices - 0.5 * target  # 합성 모델의 비교 그림일 뿐, 실제 모델 안전 범위가 아니다.
    before_widths, after_widths = widths(vertices, mapped), widths(after, mapped)
    result = {
        "model": key, "modelSha256": digest, "synthetic": True,
        "vertices": len(vertices), "triangles": len(triangles),
        "pointPairs": {name: {"before": round(before_widths[name], 5), "after": round(after_widths[name], 5),
                              "anatomicalMapping": "unverified"} for name in PAIRS},
        "alarToInnerEyeCandidateRatio": round(before_widths["alar_candidate"] / before_widths["inner_eye_candidate"], 3),
        "maxSyntheticMorphShiftOverEyeGap": round(
            float(np.linalg.norm(0.5 * target, axis=1).max()) / before_widths["inner_eye_candidate"], 3),
        "recommendation": "deferred",
        "reason": "콧볼 후보 점의 해부학적 대응·모델별 안전 범위·실제 생성 모델 외관이 검증되지 않았다",
    }
    output.mkdir(parents=True, exist_ok=True)
    save_png(output / "landmarks-front.png", marked_view(vertices, triangles, mapped))
    save_png(output / "landmarks-oblique_r.png", marked_view(vertices, triangles, mapped, "oblique_r"))
    front_views = []
    for label, geometry in (("before", vertices), ("after", after)):
        for view in ("front", "oblique_r"):
            image = render(geometry, triangles, view, size=512)
            save_png(output / f"{label}-{view}.png", image)
            if view == "front":
                front_views.append(image)
    save_png(output / "before-after-front.png", np.concatenate(front_views, axis=1))
    result["auditImagesSha256"] = {
        name: hashlib.sha256((output / name).read_bytes()).hexdigest()
        for name in ("landmarks-front.png", "landmarks-oblique_r.png")
    }
    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=("base-female", "base-male"), default="base-female")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(run(args.model, args.output), ensure_ascii=False))
