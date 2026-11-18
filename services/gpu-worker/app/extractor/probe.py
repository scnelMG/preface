"""원본 영상의 기술 정보(videoMeta, S15P31B204-395). 계약: contracts/reconstruction/schemas/result-request.schema.json `$defs.videoMeta`.

원본 영상은 추출 직후 지워지므로 추출 워커가 지우기 전에 ffprobe로 읽어 결과 보고에 함께 보낸다(FN-CAP-02 수용 9, REQ-N-20).

- 계약에 있는 키만 하나씩 골라 만든다. 위치(GPS, `com.apple.quicktime.location.*`·`location`)는 읽지 않는다.
- ffprobe가 없거나 실패하면 None — 영상 정보 없이 지금처럼 보고한다(추출 자체는 막지 않는다).
- `originalSuspect`: 원본이 아닐 가능성. 기록만 하고 거절하지 않는다. 기준(기획 FN-CAP-02는 [제안], 2026-10-28 사용자 결정):
  기기 정보 없음 · 재인코딩 도구의 encoder 태그(Lavf 등) · 짧은 변 720px 미만(아이폰 웹 촬영 360×480, S15P31B204-394).

환경 변수: FFPROBE  ffprobe 실행 파일(기본 ffprobe)
"""

import json
import logging
import os
import re
import subprocess
from datetime import UTC, datetime
from pathlib import Path

log = logging.getLogger("extractor")

MIN_SHORT_SIDE = 720
REENCODER = re.compile(r"^(lavf|lavc)|ffmpeg|handbrake", re.IGNORECASE)
HDR_TRANSFER = {"smpte2084", "arib-std-b67"}  # PQ, HLG


def probe(video: Path, timeout: int = 30) -> dict | None:
    """ffprobe JSON(format + streams). 실행할 수 없거나 실패하면 None."""
    cmd = [
        os.environ.get("FFPROBE") or "ffprobe",
        "-v", "error",
        "-print_format", "json",
        "-show_format", "-show_streams",
        str(video),
    ]  # fmt: skip
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as e:
        log.warning("ffprobe unavailable: %s", type(e).__name__)
        return None
    if proc.returncode != 0:
        log.warning("ffprobe exit %d", proc.returncode)
        return None
    try:
        return json.loads(proc.stdout)
    except ValueError:
        return None


def video_meta(info: dict | None, lens: dict | None = None) -> dict | None:
    """ffprobe 결과 → videoMeta. 기기 정보가 ffprobe 태그에 없으면(갤럭시 udta) 묶음 lens.json 값으로 채운다."""
    if not info:
        return None
    stream = next((s for s in info.get("streams") or [] if s.get("codec_type") == "video"), None)
    if stream is None:
        return None
    fmt = info.get("format") or {}
    tags = _lower_keys(fmt.get("tags"))
    stags = _lower_keys(stream.get("tags"))
    lens = lens or {}

    width, height = _int(stream.get("width")), _int(stream.get("height"))
    make = _text(tags.get("com.apple.quicktime.make") or tags.get("make") or lens.get("deviceMake"))
    model = _text(tags.get("com.apple.quicktime.model") or tags.get("model") or lens.get("deviceModel"))
    encoder = _text(tags.get("encoder") or stags.get("encoder"))
    duration = _float(fmt.get("duration")) or _float(stream.get("duration"))
    meta = {
        "width": width,
        "height": height,
        "fps": _rate(stream.get("avg_frame_rate")) or _rate(stream.get("r_frame_rate")),
        "codec": _text(stream.get("codec_name"), 50),
        "durationMs": round(duration * 1000) if duration is not None else None,
        "rotation": _rotation(stream, stags),
        "hdr": stream.get("color_transfer") in HDR_TRANSFER,
        "bitrate": _int(fmt.get("bit_rate")) or _int(stream.get("bit_rate")),
        "deviceMake": make,
        "deviceModel": model,
        "recordedAt": _instant(tags.get("com.apple.quicktime.creationdate") or tags.get("creation_time")),
        "encoder": encoder,
    }
    meta["originalSuspect"] = bool(
        (make is None and model is None)
        or (encoder is not None and REENCODER.search(encoder))
        or (width and height and min(width, height) < MIN_SHORT_SIDE)
    )
    # 값이 없는 키는 보내지 않는다(width 등 정수 키는 계약상 null 불가)
    return {k: v for k, v in meta.items() if v is not None}


def _lower_keys(tags) -> dict:
    return {str(k).lower(): v for k, v in (tags or {}).items()}


def _int(value) -> int | None:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if n >= 0 else None


def _float(value) -> float | None:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if n >= 0 else None


def _text(value, limit: int = 100) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text[:limit] or None


def _rate(value) -> float | None:
    """'30000/1001' → 29.97. 0/0은 None."""
    try:
        num, _, den = str(value).partition("/")
        rate = float(num) / float(den or 1)
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    return round(rate, 3) if rate > 0 else None


def _rotation(stream: dict, stags: dict) -> int | None:
    """Display Matrix(최근 ffprobe) 또는 rotate 태그(예전 ffprobe). 0~359로 맞춘다."""
    for side in stream.get("side_data_list") or []:
        if "rotation" in side:
            value = side["rotation"]
            break
    else:
        value = stags.get("rotate")
    try:
        return round(float(value)) % 360
    except (TypeError, ValueError):
        return None


def _instant(value) -> str | None:
    """'2026-10-27T14:38:10+0900'·'2026-10-27T05:38:10.000000Z' → UTC ISO-8601('…Z'). 시간대가 없으면 버린다."""
    if not value:
        return None
    try:
        at = datetime.fromisoformat(str(value).strip())
    except ValueError:
        return None
    if at.tzinfo is None:
        return None
    return at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
