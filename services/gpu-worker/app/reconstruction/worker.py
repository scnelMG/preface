"""GPU 3D 복원 워커(S15P31B204-357). 계약: contracts/reconstruction (INT-REC-01~04).

Spring 내부 API로 작업을 하나씩 가져가(pull) 프레임 묶음(tar)에서 3D 머리(텍스처 포함 GLB)와 5방향 얼굴 사진을 만들어 올린 뒤
결과를 보고한다. 동시에 한 건만 처리한다(GPU 1장). DB·S3 자격 증명 없이 presigned URL만 쓴다.
3D 생성은 reconstruction/tools/frames_bundle.py run(= run_all.py sfm → lens → model → viewer)을 그대로 부른다.

환경 변수:
    RECON_API_BASE       Spring api 주소(기본 http://127.0.0.1:28080, EC2로 연 SSH 터널의 개발 api)
    INTERNAL_API_SECRET  내부 API 공유 시크릿(필수)
    RECON_WORKER_ID      워커 ID(기본 runpod-<hostname>)
    RECON_PYTHON         3D 파이프라인을 돌릴 Python(기본 이 프로세스의 Python). COLMAP 위치는 LM_COLMAP
    RECON_ARGS           run_all.py에 더 넘길 옵션(기본 "--no-lm", 인계 기준 설정)
    RECON_TIMEOUT_SEC    작업 하나의 3D 생성 상한(기본 1800초)
    RECON_WORK_DIR       묶음 임시 위치(기본 시스템 임시 폴더). 작업이 끝나면 지우고, 강제 종료로 남은 것은 2시간 뒤 지운다(app/leftovers.py)
    RECON_METRICS_FILE   작업마다 구간별 시간·CPU·GPU를 JSON 한 줄로 붙일 파일(없으면 남기지 않음, app/metrics.py)

얼굴 데이터(묶음·프레임·결과)는 작업이 끝나면 성공·실패와 상관없이 지운다(reconstruction/work/<jobId> 포함).
서명 URL과 시크릿은 로그에 남기지 않는다.
"""

import base64
import hashlib
import json
import logging
import math
import os
import random
import re
import shlex
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import httpx

from app import leftovers
from app.download import download as _download
from app.metrics import Meter
from app.proctree import kill_tree
from app.pushmetrics import Pusher
from reconstruction.eye_review import from_glb

log = logging.getLogger("reconstruction")

RECON = Path(__file__).resolve().parents[2] / "reconstruction"
CLAIM = "/internal/v1/reconstruction-jobs/claim"
RETRY_DELAYS = (1, 2, 4, 8, 16)
# 3D를 다 만든 뒤의 호출(결과 업로드 URL·결과 보고)은 api가 다시 뜰 때까지 더 기다린다. 개발 배포 때 api가
# 46~54초 멈춰(2026-10-28 실측) 31초 재시도로는 만든 3D를 버리고 lease 뒤 처음부터 다시 만들었다(S15P31B204-421).
# 마지막 진행 보고(최대 heartbeatIntervalSec 120초 전) 뒤 lease 600초 안에 끝나도록 300초로 둔다.
JOB_API_WAIT_SEC = 300
JOB_API_RETRY_GAP = 15
# 작업을 버리라는 409: 취소·이미 결과 있음·다른 워커에 재배정(contracts/reconstruction "워커가 할 일")
DROP_CODES = {"REC_020", "REC_021", "REC_022"}
NOSE_CHECK_UNAVAILABLE = (503, "REC_023")
NOSE_REPORT_REJECTIONS = {(409, "EDIT_031"), (409, "EDIT_032"), NOSE_CHECK_UNAVAILABLE}
NOSE_CHECK_RETRY_SEC = 5
# 워커 지표 보내기(S15P31B204-455). METRICS_PUSH_URL이 있을 때만 main이 만든다
pusher: Pusher | None = None
JOB_ID = re.compile(r"^[0-9a-f-]{36}$")
# 작업별 임시 폴더(묶음·파이프라인 TMPDIR) 이름표. 공용 임시 폴더에서도 남은 것만 골라 지운다(S15P31B204-595)
TEMP_PREFIX = "lm-recon-"
# 눈 승인 한계 계산(tools/auto_eye_limits.mjs) 상한. 로컬 CPU에서 기본 모델 하나에 9~15초(2026-11-02 실측)
EYE_LIMIT_TIMEOUT_SEC = 300
# 윤곽 morph target 굽기(tools/contour_morphs.py) 상한. 실측은 RUNTIME 기록 전(합성 평균 머리에서 수 초)
CONTOUR_TIMEOUT_SEC = 300
# 표정 리그 만들기(tools/rig_expression.py): 모델 하나에 약 2초(이 PC 실측), 넉넉히 둔다
EXPRESSION_TIMEOUT_SEC = 120

# 5방향 사진(contracts/reconstruction "5방향 얼굴 사진"). yaw는 prepare.json의 MediaPipe 값(도)이고, PoC와 같이
# 음수 = 왼쪽(prepare_capture.py profile_left, run_all.py "왼쪽 회전 범위")으로 본다.
# 옆모습(LEFT·RIGHT)은 가장 많이 돌린 프레임이고 SIDE_MIN_DEG 미만이면 각도 부족(QUALITY_ANGLE)이다.
# 추출 단계(reconstruction/tools/frames_bundle.py angle_check)가 같은 묶음에 같은 규칙·값으로 먼저 실패시키므로
# (S15P31B204-662) 여기서 걸리는 일은 없어야 한다. 값을 바꿀 때는 둘을 함께 바꾼다(tests/test_frames_bundle.py가 확인).
SIDE_MIN_DEG = 35.0
HALF_TURN_DEG = 45.0
FRONT_MAX_DEG = 15.0
# 5방향 사진을 SfM 시점 각도로 다시 고른다(S15P31B204-666, 계획 S6-2). MediaPipe는 75°를 넘으면 얼굴을 못 찾아
# 측면 사진이 실제 51~78°였다(원본 7건, 11/08). 목표 각도(도)와, 고른 프레임이 목표에서 이만큼 넘게 멀면 그 방향은
# SfM이 그쪽을 잘못 복원한 것으로 보고 MediaPipe 선택을 그대로 쓴다(10/21 seo01 실행: 예전 SfM 마스크로 오른쪽이 최대 30°로 복원, MediaPipe 69°. 10/24 마스크 변경 뒤에는 정상).
# 거리는 yaw와 pitch(고개 상하)를 함께 본 각도 거리다. yaw만 보면 고개를 든·숙인 프레임이 정면으로 뽑혔다(원본 6건: pitch 최대
# 12°, MediaPipe 규칙은 40°. 함께 보면 6건 모두 yaw 3°·pitch 2.5° 이내, 11/08)
VIEW_TARGET_DEG = {"FRONT": 0.0, "LEFT": -90.0, "RIGHT": 90.0, "LEFT_45": -45.0, "RIGHT_45": 45.0}
VIEW_TOL_DEG = {"FRONT": 10.0, "LEFT": 20.0, "RIGHT": 20.0, "LEFT_45": 10.0, "RIGHT_45": 10.0}


class Fatal(Exception):
    """재시도해도 같은 오류(401 등). 루프를 멈추고 알린다."""


class Stop(Exception):
    """Spring이 작업을 더 하지 말라고 했다(취소·회수·이미 끝남). 결과를 보내지 않고 버린다."""


class JobFailed(Exception):
    def __init__(self, code: str, message: str, quality: dict | None = None):
        super().__init__(message)
        self.code, self.quality = code, quality


def sha256_b64(path: Path) -> str:
    """S3 체크섬과 같은 형식(base64)."""
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return base64.b64encode(digest.digest()).decode()


def worker_id() -> str:
    raw = os.environ.get("RECON_WORKER_ID") or f"runpod-{socket.gethostname()}"
    return re.sub(r"[^A-Za-z0-9._-]", "-", raw)[:64]


def pick_captures(images: list[dict]) -> dict[str, str]:
    """prepare.json images에서 5방향 사진 파일 이름을 고른다. 못 고르면 JobFailed(QUALITY_ANGLE)."""
    ok = [
        im
        for im in images
        if im.get("face") and not im.get("false_face") and not im.get("marker") and im.get("yaw") is not None
    ]
    if not ok:
        raise JobFailed("QUALITY_NO_FACE", "no usable face frame in bundle")

    def sharp(im: dict) -> float:
        return -(im.get("sharpness") or 0.0)

    def nearest(target: float, pool: list[dict]) -> dict:
        return min(pool, key=lambda im: (abs(im["yaw"] - target), sharp(im)))

    left = min(ok, key=lambda im: (im["yaw"], sharp(im)))
    right = max(ok, key=lambda im: (im["yaw"], -sharp(im)))
    front = nearest(0.0, ok)
    short = [
        name
        for name, im, sign in (("LEFT", left, -1), ("RIGHT", right, 1))
        if sign * im["yaw"] < SIDE_MIN_DEG
    ]
    if short or abs(front["yaw"]) > FRONT_MAX_DEG:
        raise JobFailed(
            "QUALITY_ANGLE",
            f"angle not covered: {short or ['FRONT']}",
            {"yawMin": round(left["yaw"], 1), "yawMax": round(right["yaw"], 1)},
        )
    return {
        "FRONT": front["file"],
        "LEFT": left["file"],
        "RIGHT": right["file"],
        "LEFT_45": nearest(-HALF_TURN_DEG, [im for im in ok if im["yaw"] < 0])["file"],
        "RIGHT_45": nearest(HALF_TURN_DEG, [im for im in ok if im["yaw"] > 0])["file"],
    }


def sfm_captures(captures: dict[str, str], run_dir: Path, images: list[dict]) -> tuple[dict[str, str], dict]:
    """MediaPipe로 고른 5방향 사진(pick_captures, 회전 부족 판정은 그대로)을 SfM 시점 각도로 다시 고른다.
    model/view_coverage.json per_frame {파일: [yaw, pitch]}(얼굴 없는 옆모습 포함, 부호는 MediaPipe와 같음)에서 방향마다
    (목표 yaw, pitch 0)에 각도 거리가 가장 가까운 등록 프레임(같으면 선명한 것). 그 거리가 VIEW_TOL_DEG를 넘거나 기록이
    없으면 그 방향은 MediaPipe 선택을 둔다.
    → (사진, qualityReport용 {방향: {"yaw", "pitch": SfM 각도|None, "by": "sfm"|"mediapipe"}})"""
    try:
        per = json.loads((run_dir / "model" / "view_coverage.json").read_text(encoding="utf-8"))["per_frame"]
    except (OSError, ValueError, KeyError, TypeError):
        per = {}
    if not isinstance(per, dict):
        per = {}
    sharp = {im.get("file"): im.get("sharpness") or 0.0 for im in images}
    angles = {}
    for name, v in per.items():
        try:
            if name in sharp:
                angles[name] = (float(v[0]), float(v[1]))
        except (TypeError, ValueError, IndexError):
            continue

    def angle(name: str | None) -> dict:
        yaw, pitch = angles.get(name, (None, None))
        return {
            "yaw": None if yaw is None else round(yaw, 1),
            "pitch": None if pitch is None else round(pitch, 1),
        }

    out, note = dict(captures), {}
    for view, target in VIEW_TARGET_DEG.items():
        dist = {n: math.hypot(yaw - target, pitch) for n, (yaw, pitch) in angles.items()}
        best = min(dist, key=lambda n: (dist[n], -sharp[n]), default=None)
        if best and dist[best] <= VIEW_TOL_DEG[view]:
            out[view] = best
            note[view] = {**angle(best), "by": "sfm"}
        else:
            note[view] = {**angle(captures[view]), "by": "mediapipe"}
    return out, note


def _finite(v) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise ValueError("not a finite number")
    return float(v)


def capture_cameras(run_dir: Path, captures: dict[str, str]) -> dict | None:
    """5방향 사진을 찍은 카메라(포즈·렌즈)를 업로드한 mesh.glb 좌표로 보낸다(S15P31B204-705, 관리자 모델 비교).
    model/frames.json(tools/glb_frames.py, run_all viewer 단계): head.glb 좌표(world_to_glb 적용 뒤), x_cam = R·X_glb + t,
    COLMAP 카메라 축. 윤곽 굽기(bake_contour)는 morph target만 더해 기본 형상·좌표가 그대로다.
    방향마다 그 사진이 frames.json에 없으면(미등록·dropped) None. 파일 이름·경로는 넣지 않는다.
    frames.json이 없거나 읽을 수 없으면 None(키를 빼고 작업은 성공)."""
    try:
        data = json.loads((run_dir / "model" / "frames.json").read_text(encoding="utf-8"))
        cam = data["camera"]
        camera = {"w": int(_finite(cam["w"])), "h": int(_finite(cam["h"]))}
        camera.update({k: round(_finite(cam[k]), 4) for k in ("f", "cx", "cy")})
        frames = {fr["name"]: fr for fr in data["frames"] if isinstance(fr, dict) and "name" in fr}
    except (OSError, ValueError, KeyError, TypeError) as e:
        log.warning("capture cameras unavailable: jobId=%s (%s)", run_dir.name, type(e).__name__)
        return None

    def view(name: str) -> dict | None:
        try:
            fr = frames[name]
            rot = [[round(_finite(x), 6) for x in row] for row in fr["R"]]
            t = [round(_finite(x), 4) for x in fr["t"]]
        except (KeyError, ValueError, TypeError):
            return None
        if len(rot) != 3 or any(len(row) != 3 for row in rot) or len(t) != 3:
            return None
        return {"R": rot, "t": t}

    views = {angle: view(captures.get(angle)) for angle in VIEW_TARGET_DEG}
    return {"frame": "glb", "axes": "colmap", "camera": camera, "views": views}


HEAD_RATIO_RANGE = RECON / "assets" / "head_ratio_range.json"


def face_head_quality(rep: dict) -> dict:
    """품질을 얼굴과 두상으로 나눠 남긴다(S15P31B204-676, 계획 S4-3). run_all.json의 qa(tools/qa_check.py) 값.
    face: 사진으로 검증되는 부위. 홀드아웃(맞춤에 안 쓴 사진) 점 오차·얼굴 윤곽 오차·측면 점 오차(눈꼬리 거리 %), 주름 p95.
    head: 뒤통수·정수리는 사진에 거의 안 보여 통계 모양으로 채워진다. 두상 비율 4개와, GNM 사전분포 0.5~99.5% 밖인 항목
    (qa_check의 두상 비율 경고와 같은 범위). → {"face": {...}, "head": {...}} (값이 없으면 빈 dict)"""
    cur = (rep.get("qa") or {}).get("current") or {}
    face = {
        "holdoutLm": cur.get("holdout_lm"),
        "holdoutLine": cur.get("holdout_line"),
        "holdoutSide": cur.get("holdout_side"),
        "creaseP95": (cur.get("crease") or {}).get("p95"),
    }
    # 소수 셋째 자리까지(주름 p95는 0.03 안팎이라 _numbers의 한 자리 반올림이면 0이 된다)
    face = {
        k: round(float(v), 3)
        for k, v in face.items()
        if isinstance(v, (int, float)) and not isinstance(v, bool)
    }
    ratios = {
        k: round(float(v), 3)
        for k, v in (cur.get("head_ratios") or {}).items()
        if isinstance(v, (int, float))
    }
    out = {"face": face} if face else {}
    if ratios:
        try:
            ref = json.loads(HEAD_RATIO_RANGE.read_text(encoding="utf-8"))["ratios"]
        except (OSError, ValueError, KeyError):
            ref = {}
        outside = [k for k, v in ratios.items() if k in ref and not ref[k]["p0.5"] <= v <= ref[k]["p99.5"]]
        out["head"] = {"ratios": ratios, "outOfRange": outside}
    return out


def quality_report(run_dir: Path) -> dict:
    """run_all.json에서 숫자만 뽑는다(contracts: 숫자·짧은 문자열, 이미지·경로 금지)."""
    try:
        rep = json.loads((run_dir / "run_all.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    stages = rep.get("stages", {})
    model = stages.get("model", {})
    # 렌즈 출처는 묶음 값을 쓴다. run_all의 lens_source는 "--focal"로 덮인다
    lens = (rep.get("bundle") or {}).get("lens", {})
    out = {
        "frames": stages.get("prepare", {}).get("frames"),
        "registered": stages.get("lens", {}).get("registered"),
        "focalPx": stages.get("lens", {}).get("focal_px"),
        "focalSource": lens.get("focalSource"),
        "chosen": model.get("chosen"),
        "holdoutPctIod": model.get("holdout_pct_iod"),
        "stageSec": {k: v.get("sec") for k, v in stages.items() if isinstance(v, dict) and "sec" in v},
        "overall": rep.get("overall"),
        # 카메라 위치 검사(고개를 돌린 쪽에서 SfM 회전이 MediaPipe보다 작음, 그쪽 측면이 틀렸을 수 있음). 끝까지 만든 결과는
        # 사용자에게 돌려주고 판정만 남긴다(S15P31B204-663, 계획 S5-1. 실패 처리안은 11/08 만두 판단으로 뺐다: 회전 부족은
        # 촬영 중(S0-2)·업로드 직후(QUALITY_ANGLE)에 미리 알린다). run_all이 0으로 끝나고 overall이 FAIL이면 이 경우뿐이다
        "poseCheck": model.get("pose_check"),
        "poseNote": next((str(n)[:200] for n in model.get("notes") or [] if "카메라 위치" in str(n)), None),
        **face_head_quality(rep),
    }
    # model 단계 안의 하위 단계 시간(S15P31B204-431, GPU 전환 대상 고르기). 후보를 스레드로 같이 돌려 합이 단계 시간보다 클 수 있다
    try:
        mrep = json.loads((run_dir / "model" / "report.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        mrep = {}
    out["modelSec"] = _numbers(mrep.get("timing_sec")) or None
    out["bakeSec"] = _numbers((mrep.get("bake") or {}).get("timing_sec")) or None
    # gnm_fit·눈 부위 맞춤 안의 구간 시간(S15P31B204-772). 작업 폴더가 지워지면 report.json과 함께 사라져서 여기 남긴다
    out["gnmFitSec"] = _numbers((mrep.get("gnm_fit") or {}).get("timing_sec")) or None
    out["eyePartsSec"] = _numbers((mrep.get("eye_parts") or {}).get("timing_sec")) or None
    return {k: v for k, v in out.items() if v is not None}


FRAME_NO = re.compile(r"_(\d+)\.jpe?g$", re.IGNORECASE)
DIAG_COLS = ["tMs", "mpYaw", "mpPitch", "face", "sfmYaw", "sfmPitch"]


def _r1(v):
    return round(float(v), 1) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def failure_diag(run_dir: Path) -> dict:
    """실패한 3D 생성의 진단 수치(S15P31B204-663, 계획 S1-5). 원본과 work 폴더는 작업이 끝나면 지워지므로 실패 원인
    (각도 부족·SfM 회전 부족·등록 실패)을 나중에 볼 수 있게 숫자만 남긴다. 얼굴 이미지·경로는 넣지 않는다.
    frames: 고른 프레임마다 [영상 시각 ms, MediaPipe yaw, pitch, 얼굴 1/0, SfM yaw, pitch] (SfM 미등록·모델 전 실패면 None).
    녹화 전체의 각도 곡선은 captureTrace로 따로 저장된다(!493). 100장 기준 약 4KB(계약 한도 64KB)."""
    try:
        prep = json.loads((run_dir / "prep" / "prepare.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        prep = {}
    try:
        per = json.loads((run_dir / "model" / "view_coverage.json").read_text(encoding="utf-8")).get(
            "per_frame"
        )
    except (OSError, ValueError, AttributeError):
        per = None
    per = per if isinstance(per, dict) else {}
    videos = prep.get("videos_in") or [{}]
    fps = videos[0].get("fps") if isinstance(videos[0], dict) else None
    rows = []
    for im in prep.get("images") or []:
        if not isinstance(im, dict):
            continue
        name = str(im.get("file", ""))
        m = FRAME_NO.search(name)
        t = round(int(m.group(1)) / fps * 1000) if m and isinstance(fps, (int, float)) and fps > 0 else None
        sfm = per.get(name) if isinstance(per.get(name), list) else [None, None]
        rows.append(
            [
                t,
                _r1(im.get("yaw")),
                _r1(im.get("pitch")),
                1 if im.get("face") else 0,
                *(_r1(v) for v in sfm[:2]),
            ]
        )
    rows.sort(key=lambda r: (r[0] is None, r[0] or 0))
    try:
        stages = json.loads((run_dir / "run_all.json").read_text(encoding="utf-8")).get("stages", {})
    except (OSError, ValueError):
        stages = {}
    model, lens = stages.get("model") or {}, stages.get("lens") or {}
    out = {
        "cols": DIAG_COLS if rows else None,
        "frames": rows or None,
        "rejected": _numbers(prep.get("rejected")) or None,
        "noFaceKept": prep.get("no_face_kept"),
        "lensTrials": [_numbers(t) for t in lens.get("trials") or [] if isinstance(t, dict)] or None,
        "viewCoverage": model.get("view_coverage") if isinstance(model.get("view_coverage"), dict) else None,
        "holdoutPctIod": _numbers(model.get("holdout_pct_iod")) or None,
        "poseCheck": model.get("pose_check"),
        "notes": [str(n)[:200] for n in (model.get("notes") or [])[:5]] or None,
    }
    return {k: v for k, v in out.items() if v is not None}


def failed_quality(run_dir: Path, **extra) -> dict:
    """실패 보고용 qualityReport: 성공과 같은 숫자 + 진단 수치(diag)."""
    diag = failure_diag(run_dir)
    return {**quality_report(run_dir), **extra, **({"diag": diag} if diag else {})}


def nose_check_note(candidate: dict) -> dict:
    """코 편집 검사 결과(auto_nose_candidate.mjs)에서 qualityReport에 남길 숫자·짧은 문자열(S15P31B204-671)."""
    tried = candidate.get("tried") or candidate.get("narrowedBy") or []
    keep = (
        "limit",
        "at",
        "error",
        "valid",
        "canonicalValid",
        "canonicalReason",
        "skinValid",
        "protectedRegionsPresent",
        "affectedVertices",
        "protectedAffectedVertices",
        "selfIntersections",
    )
    rows = [
        {k: (str(t[k])[:80] if isinstance(t[k], str) else t[k]) for k in keep if k in t}
        for t in tried[:5]
        if isinstance(t, dict)
    ]
    out = {"eligible": bool(candidate.get("eligible")), "tried": rows}
    if candidate.get("reason"):
        out["reason"] = str(candidate["reason"])[:200]
    return out


def _numbers(d) -> dict:
    """{이름: 초}에서 숫자만 남긴다(계약: 숫자·짧은 문자열)."""
    if not isinstance(d, dict):
        return {}
    return {
        str(k)[:40]: round(float(v), 1)
        for k, v in d.items()
        if isinstance(v, (int, float)) and not isinstance(v, bool)
    }


# 사진 때문에 실패할 수 있는 단계. 여기서 하위 프로그램이 정상 종료했는데 실패면(매칭 부족·카메라 복원 실패·방향 반대) 사진 문제다
PHOTO_STAGES = ("sfm", "lens")
# 사진 단계 프로그램이 "사진으로는 카메라를 못 풀었다"고 일부러 끝내는 종료 코드(S15P31B204-466).
# lens_anchor.py: 어떤 초점거리로도 프레임 80% 이상을 못 맞추면 2. sfm_sparse.py: 모델 없음 2, 등록 60% 미만 3
PHOTO_EXITS = (2, 3)
STAGE_ORDER = ("prepare", "sfm", "lens", "model", "viewer")
CHILD_EXIT = re.compile(r"exit (-?\d+)")


def build_failure(code: int, run_dir: Path) -> tuple[str, str]:
    """3D 생성 실패의 failCode와 이유. run_all.py는 하위 프로그램(COLMAP 등)의 종료 코드를 단계 error에 남기고 자신은 1로 끝나서,
    종료 코드만으로는 사진 문제와 프로그램 문제를 가를 수 없다(S15P31B204-381). 사진 문제만 FIT_FAILED(다시 찍기 안내),
    나머지는 INTERNAL(서버 문제, BE가 다시 대기열에 넣는다). 사진 단계의 하위 프로그램이 0이나 PHOTO_EXITS로 끝났으면
    사진 문제, 신호(음수)·1(예외)·4 등은 프로그램 문제다."""
    if code < 0:
        return "INTERNAL", f"3d build killed by signal {-code}"
    try:
        stages = json.loads((run_dir / "run_all.json").read_text(encoding="utf-8")).get("stages", {})
    except (OSError, ValueError):
        return "INTERNAL", f"3d build exit {code}, no run_all.json"
    for name in STAGE_ORDER:
        stage = stages.get(name) or {}
        if stage.get("status") != "FAIL":
            continue
        error = str(stage.get("error", ""))
        child = CHILD_EXIT.search(error)
        if name in PHOTO_STAGES and (not child or int(child.group(1)) in (0, *PHOTO_EXITS)):
            return "FIT_FAILED", f"{name}: {error}"
        return "INTERNAL", f"{name}: {error}"
    return "INTERNAL", f"3d build exit {code}, no failed stage"


def timeout_point(run_dir: Path) -> tuple[str, str]:
    """시간 초과로 끊긴 3D 생성이 어디까지 갔는지(S15P31B204-665, 계획 S6-3). run_all.py는 단계가 끝날 때마다 run_all.json을
    저장하므로, 끝난 단계 다음 단계가 초과 당시 돌던 단계다. → ("model", "prepare 30s, sfm 80s, lens 12s")"""
    try:
        stages = json.loads((run_dir / "run_all.json").read_text(encoding="utf-8")).get("stages", {})
    except (OSError, ValueError):
        stages = {}
    done = [n for n in STAGE_ORDER if (stages.get(n) or {}).get("status") in ("PASS", "WARN")]
    where = next((n for n in STAGE_ORDER if n not in done), "after viewer")
    return where, ", ".join(f"{n} {round(stages[n].get('sec') or 0)}s" for n in done) or "none"


def retry_delays(wait_sec: float = 0):
    """시도 전 쉬는 초. 첫 시도 뒤 RETRY_DELAYS로 재시도하고,
    wait_sec가 남으면 JOB_API_RETRY_GAP 간격으로 그때까지 더 시도한다."""
    yield 0
    yield from RETRY_DELAYS
    waited = sum(RETRY_DELAYS)
    while waited < wait_sec:
        gap = min(JOB_API_RETRY_GAP, wait_sec - waited)
        waited += gap
        yield gap


class Api:
    def __init__(self, client: httpx.Client, secret: str, wid: str):
        self.client = client
        self.secret = secret
        self.wid = wid

    def post(
        self,
        path: str,
        body: dict | None = None,
        *,
        job: bool = True,
        wait_sec: float = 0,
        timeout_sec: float = 30,
    ) -> httpx.Response:
        headers = {"X-Internal-Secret": self.secret}
        if job:
            headers["X-Worker-Id"] = self.wid
        for i, delay in enumerate(retry_delays(wait_sec)):
            time.sleep(delay)
            try:
                r = self.client.post(path, json=body, headers=headers, timeout=timeout_sec)
            except httpx.TransportError as e:
                log.warning("api %s network error (%s), try %d", path, type(e).__name__, i + 1)
                continue
            if r.status_code == 401:
                raise Fatal("AUTH_001: INTERNAL_API_SECRET mismatch")
            if r.status_code < 500 or (
                body and body.get("noseApproval") and (r.status_code, _code(r)) in NOSE_REPORT_REJECTIONS
            ):
                return r
            log.warning("api %s %d, try %d", path, r.status_code, i + 1)
        raise RuntimeError(f"api {path} failed after retries")


def _code(r: httpx.Response) -> str:
    try:
        return r.json()["error"]["code"]
    except (ValueError, KeyError, TypeError):
        return "-"


class Heartbeat(threading.Thread):
    """단계 시작마다, 그리고 heartbeatIntervalSec마다 progress를 보낸다. continue=false면 3D 생성을 멈춘다."""

    def __init__(self, api: Api, job_id: str, interval: int):
        super().__init__(daemon=True)
        self.api, self.path, self.interval = api, f"/internal/v1/reconstructions/{job_id}/progress", interval
        self.stage, self.engine = "QUALITY_CHECK", None
        self.stopped = threading.Event()  # Spring이 멈추라고 했다
        self.done = threading.Event()
        self.proc: subprocess.Popen | None = None

    def set_stage(self, stage: str, engine: str | None = None) -> None:
        self.stage, self.engine = stage, engine
        self.beat()

    def beat(self) -> None:
        body = {"status": "RUNNING", "stage": self.stage, **({"engine": self.engine} if self.engine else {})}
        try:
            r = self.api.post(self.path, body)
        except (RuntimeError, Fatal) as e:
            log.warning("progress failed: %s", e)
            return
        if r.status_code == 200 and not r.json()["data"]["continue"]:
            self.stopped.set()
            if self.proc and self.proc.poll() is None:
                kill_tree(self.proc)
        elif r.status_code != 200:
            log.warning("progress %d %s", r.status_code, _code(r))

    def run(self) -> None:
        while not self.done.wait(self.interval):
            self.beat()

    def check(self) -> None:
        if self.stopped.is_set():
            raise Stop("progress continue=false")


def download(client: httpx.Client, url: str, dest: Path, sleep=time.sleep) -> None:
    """프레임 묶음 받기: 연결 오류는 다시 받는다(app/download.py, S15P31B204-766)"""
    _download(client, url, dest, "bundle", sleep)


def put_file(files: httpx.Client, upload: dict, path: Path) -> None:
    size = path.stat().st_size
    with path.open("rb") as f:
        # 서명된 PUT은 chunked 전송을 받지 않는다 — 길이를 직접 붙인다
        r = files.put(
            upload["uploadUrl"], content=f, headers={**upload["headers"], "Content-Length": str(size)}
        )
    if r.status_code >= 300:
        raise JobFailed("INTERNAL", f"upload failed: {r.status_code}")


def validated_rig(run_dir: Path, path: Path | None = None) -> Path | None:
    """Check the embedded nose binary checksum; this does not approve edit capability."""
    path = path or run_dir / "model" / "rig.json"
    if not path.is_file():
        return None
    try:
        rig = json.loads(path.read_text(encoding="utf-8"))
        nose = rig["nose"]
        expected = nose["json"]["editable_sha256"]
        actual = hashlib.sha256(base64.b64decode(nose["bin"], validate=True)).hexdigest()
        if rig["format"] == "live-mirror-rig" and rig["version"] == 1 and actual == expected:
            return path
    except (KeyError, TypeError, ValueError, OSError):
        pass
    log.warning("3d rig artifact invalid: jobId=%s", run_dir.name)
    return None


def recover_nose_rig(run_dir: Path) -> Path | None:
    """최종 GLB에서 누락되거나 손상된 리그를 다시 만들고 결속 검사는 그대로 수행한다."""
    if rig := validated_rig(run_dir):
        return rig
    model = run_dir / "model"
    candidate = model / "rig.recovered.json"
    try:
        subprocess.run(
            [
                os.environ.get("RECON_PYTHON") or sys.executable,
                str(RECON / "tools" / "backfill_nose_rig.py"),
                str(model / "head.glb"),
                str(candidate),
            ],
            cwd=RECON,
            capture_output=True,
            check=True,
            timeout=120,
        )
        if validated_rig(run_dir, candidate) is None:
            return None
        rig = model / "rig.json"
        candidate.replace(rig)
        return rig
    except (OSError, subprocess.SubprocessError) as e:
        log.warning("nose rig recovery unavailable: jobId=%s (%s)", run_dir.name, type(e).__name__)
        return None
    finally:
        candidate.unlink(missing_ok=True)


def run_edit_finalizer(
    args: list[str], *, output: Path | None = None, **options
) -> subprocess.CompletedProcess:
    """시간 초과 때만 같은 자산으로 한 번 더 시도한다. 형상 불합격은 그대로 처리한다."""
    try:
        return subprocess.run(args, check=True, **options)
    except subprocess.TimeoutExpired:
        if output is not None:
            output.unlink(missing_ok=True)
        log.warning("edit finalizer timed out; retrying %s", Path(args[1]).name)
        return subprocess.run(args, check=True, **options)


def eye_limits(
    run_dir: Path, schema_version: str, binding: dict | None, eye_proof: tuple | None
) -> dict | None:
    """최종 메시·리그와 눈 판정 해시에 눈 안전 한계를 결속한다.

    한계는 브라우저와 같은 엔진으로 잰다(reconstruction/tools/auto_eye_limits.mjs). 판정이 없거나 계산이 실패하면 보내지
    않는다. 그때도 생성은 성공이며 눈 편집만 잠긴다(contracts/edit/eye-state-v1).
    """
    if not eye_proof:
        return None
    try:
        if binding is None:
            model = run_dir / "model"
            rig_bytes = (model / "rig.json").read_bytes()
            rig = json.loads(rig_bytes)["nose"]
            binding = {
                "meshSha256": hashlib.sha256((model / "head.glb").read_bytes()).hexdigest(),
                "rigSha256": hashlib.sha256(rig_bytes).hexdigest(),
                "engine": rig["engine"],
                "rigVersion": rig["json"]["rig_version"],
                "topologyVersion": rig["json"]["topology_version"],
            }
        out = run_edit_finalizer(
            ["node", str(RECON / "tools" / "auto_eye_limits.mjs"), str(run_dir / "model")],
            capture_output=True,
            text=True,
            timeout=EYE_LIMIT_TIMEOUT_SEC,
        )
        found = json.loads(out.stdout)
        if not found.get("eligible"):
            raise ValueError(str(found.get("reason", "not eligible"))[:200])
        if found["meshSha256"] != binding["meshSha256"] or found["review"] != eye_proof[0]:
            raise ValueError("measured another mesh or review")
        approval = {
            "schemaVersion": schema_version,
            "binding": {
                "meshSha256": binding["meshSha256"],
                "rigSha256": binding["rigSha256"],
                "eyePartsSha256": eye_proof[1],
                "engine": binding["engine"],
                "rigVersion": binding["rigVersion"],
                "topologyVersion": binding["topologyVersion"],
            },
            "limits": {k: float(v) for k, v in found["limits"].items()},
        }
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError, AttributeError) as e:
        log.warning("eye limits unavailable, eye edit stays locked: jobId=%s (%s)", run_dir.name, e)
        return None
    log.info("eye limits measured: jobId=%s ms=%s", run_dir.name, found.get("timingMs"))
    return approval


def bake_contour(run_dir: Path) -> bool:
    """head.glb에 윤곽 morph target(contour.*_neg/_pos)을 굽는다(S15P31B204-564 후속).

    기본 형상·텍스처·메타데이터(눈 판정 포함)는 그대로 두고 타깃만 덧붙인다. 코·눈 승인 결속(meshSha256)은 GLB 전체 바이트의
    해시라서, 반드시 승인 후보 계산(auto_nose_candidate·auto_eye_limits) 전에 부른다. 실패하거나 접힌 면이 생기면(도구 종료 코드 1)
    윤곽 없이 원래 GLB로 계속한다: 생성은 성공이고 웹은 타깃이 없는 윤곽 줄만 잠근다.
    """
    model = run_dir / "model"
    glb = model / "head.glb"
    baked = model / "head.contour.glb"
    py = os.environ.get("RECON_PYTHON") or sys.executable
    try:
        run_edit_finalizer(
            [
                py,
                str(RECON / "tools" / "contour_morphs.py"),
                str(glb),
                str(baked),
                "--report",
                str(model / "contour_report.json"),
            ],
            cwd=RECON,
            output=baked,
            capture_output=True,
            text=True,
            timeout=CONTOUR_TIMEOUT_SEC,
        )
        os.replace(baked, glb)
    except (OSError, subprocess.SubprocessError) as e:
        baked.unlink(missing_ok=True)
        log.warning("contour morphs skipped: jobId=%s (%s)", run_dir.name, type(e).__name__)
        return False
    return True


def build_expression(run_dir: Path, rig: Path) -> Path | None:
    """표정 트래킹용 리그(model/expression.json)를 업로드할 최종 head.glb·rig.json으로 만든다.

    rig.json은 코·눈 승인이 파일 해시로 묶여 있어 건드리지 않고 따로 쓴다. 도구는 다 쓴 파일만 제자리에 놓으므로(임시 파일을 바꿔
    넣는다) 종료 코드가 0이고 파일이 있으면 성공이다. 실패하면(rig에 GNM 표정 성분이 없는 코만 다시 만든 rig 등) 표정 없이
    계속한다: 생성은 성공이고 편집실의 표정 트래킹 버튼만 보이지 않는다.
    """
    model = run_dir / "model"
    out = model / "expression.json"
    py = os.environ.get("RECON_PYTHON") or sys.executable
    try:
        done = run_edit_finalizer(
            [
                py,
                str(RECON / "tools" / "rig_expression.py"),
                str(model / "head.glb"),
                str(rig),
                "--out",
                str(out),
            ],
            cwd=RECON,
            output=out,
            capture_output=True,
            text=True,
            timeout=EXPRESSION_TIMEOUT_SEC,
        )
        if not out.is_file():
            raise FileNotFoundError(out.name)
    except (OSError, subprocess.SubprocessError) as e:
        out.unlink(missing_ok=True)
        log.warning("expression rig skipped: jobId=%s (%s)", run_dir.name, type(e).__name__)
        return None
    # 도구가 마지막 줄에 찍는 측정값(성분 수·입술 접촉 정점 수 등): 나중에 원인을 볼 때 쓴다
    log.info("expression rig built: jobId=%s %s", run_dir.name, (done.stdout or "").strip().splitlines()[-1:])
    return out


def build(hb: Heartbeat, bundle: Path, job_id: str) -> Path:
    """frames_bundle.py run으로 3D를 만든다. 결과 폴더(reconstruction/work/<jobId>)를 돌려준다."""
    py = os.environ.get("RECON_PYTHON") or sys.executable
    extra = shlex.split(os.environ.get("RECON_ARGS", "--no-lm"))
    cmd = [
        py,
        str(RECON / "tools" / "frames_bundle.py"),
        "run",
        str(bundle),
        "--id",
        job_id,
        "--force",
        *extra,
        # outputs nobody reads in the service (eye colour, gray qa picture) are not made (S15P31B204-761).
        # Passed here, not through RECON_ARGS, so an environment override cannot bring them back
        "--service",
    ]
    timeout = int(os.environ.get("RECON_TIMEOUT_SEC", "1800"))
    hb.set_stage("RECONSTRUCT", "COLMAP")
    with tempfile.TemporaryFile("w+", encoding="utf-8", errors="replace") as out:
        # 파이프라인 임시 파일(COLMAP DB 사본 등)은 이 작업의 임시 폴더(묶음 옆) 안에 만든다. 작업이 어떻게 끝나도
        # process()가 폴더째 지운다(S15P31B204-448)
        env = {**os.environ, "TMPDIR": str(bundle.parent)}
        hb.proc = subprocess.Popen(cmd, cwd=RECON, stdout=out, stderr=subprocess.STDOUT, text=True, env=env)
        try:
            code = hb.proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            kill_tree(hb.proc)
            run_dir = RECON / "work" / job_id
            where, done = timeout_point(run_dir)
            log.warning("3d build timeout: jobId=%s during=%s done=%s", job_id, where, done)
            quality = failed_quality(run_dir, timeoutStage=where)
            raise JobFailed(
                "TIMEOUT", f"3d build exceeded {timeout}s during {where} (done: {done})", quality
            ) from None
        hb.check()
        out.seek(0)
        tail = out.read()[-800:]
    run_dir = RECON / "work" / job_id
    if code != 0 or not (run_dir / "model" / "head.glb").exists():
        fail_code, reason = build_failure(code, run_dir)
        log.warning("3d build failed: jobId=%s exit=%s code=%s (%s)", job_id, code, fail_code, reason[:200])
        raise JobFailed(fail_code, f"{reason} | exit {code}: {tail}", failed_quality(run_dir))
    return run_dir


def process(api: Api, files: httpx.Client, job: dict) -> None:
    job_id = job["jobId"]
    if not JOB_ID.match(job_id):  # work/<jobId> 폴더 이름으로 쓴다
        raise RuntimeError("unexpected jobId format")
    base = f"/internal/v1/reconstructions/{job_id}"
    started = time.monotonic()
    hb = Heartbeat(api, job_id, int(job["heartbeatIntervalSec"]))
    hb.set_stage("QUALITY_CHECK")
    hb.start()
    meter = Meter(lambda: hb.proc)
    outcome: tuple[str, str | None] = ("ERROR", None)
    run_dir = RECON / "work" / job_id
    if pusher:
        pusher.set_busy(True)
    try:
        with tempfile.TemporaryDirectory(
            prefix=TEMP_PREFIX, dir=os.environ.get("RECON_WORK_DIR") or None
        ) as tmp:
            bundle = Path(tmp) / "frames.tar"
            try:
                download(files, job["input"]["downloadUrl"], bundle)
            except httpx.HTTPError as e:
                raise JobFailed("INTERNAL", f"bundle download failed: {type(e).__name__}") from None
            if sha256_b64(bundle) != job["input"]["checksumSha256"]:
                raise JobFailed("INTERNAL", "bundle checksum mismatch")
            hb.check()
            meter.lap("build")
            run_dir = build(hb, bundle, job_id)

        meter.lap("finalize")
        hb.set_stage("FINALIZE")
        # 마무리 하위 단계 시간(S15P31B204-665). 성공 결과 qualityReport.finalizeSec로 보낸다
        finalize: dict[str, float] = {}
        mark = [time.monotonic()]

        def took(name: str) -> None:
            now = time.monotonic()
            finalize[name] = round(now - mark[0], 1)
            mark[0] = now

        prep = json.loads((run_dir / "prep" / "prepare.json").read_text(encoding="utf-8"))
        captures, capture_views = sfm_captures(pick_captures(prep["images"]), run_dir, prep["images"])
        # 승인값(코·눈)은 업로드할 최종 GLB로 계산해야 하므로 윤곽 굽기가 먼저다
        contour = bake_contour(run_dir)
        took("contour")
        rig = recover_nose_rig(run_dir)
        if rig is None:
            raise JobFailed("INTERNAL", "editable nose rig missing or invalid")
        try:
            proof = run_edit_finalizer(
                ["node", str(RECON / "tools" / "auto_nose_candidate.mjs"), str(run_dir / "model")],
                capture_output=True,
                text=True,
                timeout=180,
            )
            candidate = json.loads(proof.stdout)
            if not isinstance(candidate, dict):
                raise TypeError("invalid nose candidate")
        except (OSError, subprocess.SubprocessError, TypeError, ValueError) as e:
            raise JobFailed("INTERNAL", f"nose validation unavailable: {type(e).__name__}") from None
        approval = None
        if not candidate.get("eligible"):
            # 어느 범위·조합에서 어떤 검사가 막았는지(S15P31B204-671, 계획 S6-1). 예전에는 이유 없이 실패만 남았다
            reason = str(candidate.get("reason") or "no reason")[:200]
            log.warning("nose check failed: jobId=%s (%s)", job_id, reason)
            tried = candidate.get("tried")
            if not tried or any(
                sample.get("at") == "neutral"
                and (sample.get("skinValid") is not True or sample.get("affectedVertices") != 0)
                for sample in tried
            ):
                raise JobFailed(
                    "INTERNAL",
                    f"nose edit mesh validation failed: {reason}",
                    {**quality_report(run_dir), "noseCheck": nose_check_note(candidate)},
                )
        else:
            approval = {
                "schemaVersion": job["morphSchemaVersion"],
                "binding": candidate["binding"],
                "ranges": candidate["ranges"],
            }
        if candidate.get("narrowedBy"):
            log.info("nose range narrowed: jobId=%s %s", job_id, nose_check_note(candidate)["tried"])
        took("noseCheck")
        eye_proof = from_glb(run_dir / "model" / "head.glb")
        eye_approval = eye_limits(run_dir, job["morphSchemaVersion"], candidate.get("binding"), eye_proof)
        took("eyeLimits")
        meter.lap("upload")
        r = api.post(f"{base}/output-urls", wait_sec=JOB_API_WAIT_SEC)
        if r.status_code != 200:
            raise Stop(f"output-urls {r.status_code} {_code(r)}")
        urls = r.json()["data"]
        # 표정 리그는 그 업로드 주소를 주는 백엔드일 때만 만든다(이전 백엔드면 만들어도 올릴 곳이 없다)
        expression_upload = urls.get("expression")
        expression = build_expression(run_dir, rig) if expression_upload else None
        took("expression")
        put_file(files, urls["mesh"], run_dir / "model" / "head.glb")
        rig_upload = urls["rig"]
        put_file(files, rig_upload, rig)
        if expression:
            put_file(files, expression_upload, expression)
        for angle, name in captures.items():
            put_file(files, urls["captures"][angle], run_dir / "prep" / "images" / name)
        took("upload")
        cameras = capture_cameras(run_dir, captures)
        hb.check()
        meter.lap("report")
        model_id = report(
            api,
            base,
            {
                "status": "SUCCEEDED",
                "meshObjectKey": urls["mesh"]["objectKey"],
                "rigObjectKey": rig_upload["objectKey"],
                **({"expressionObjectKey": expression_upload["objectKey"]} if expression else {}),
                **({"noseApproval": approval} if approval else {}),
                **({"eyeReview": eye_proof[0], "eyePartsSha256": eye_proof[1]} if eye_proof else {}),
                **({"eyeApproval": eye_approval} if eye_approval else {}),
                "meshFormat": "GLB",
                "morphSchemaVersion": job["morphSchemaVersion"],
                "captureImages": {a: urls["captures"][a]["objectKey"] for a in captures},
                "qualityReport": {
                    **quality_report(run_dir),
                    "finalizeSec": finalize,
                    "captureViews": capture_views,
                    **({"captureCameras": cameras} if cameras else {}),
                    **({"noseCheck": nose_check_note(candidate)} if approval is None else {}),
                },
                "durationMs": int((time.monotonic() - started) * 1000),
            },
        )
        if not model_id:
            raise RuntimeError("successful result did not return a model id")
        log.info("reconstruction reported: jobId=%s contour=%s", job_id, contour)
        outcome = ("SUCCEEDED", None)
        hb.done.set()
    except JobFailed as e:
        outcome = ("FAILED", e.code)
        if not hb.stopped.is_set():
            meter.lap("report")
            body = {"status": "FAILED", "failCodes": [e.code], "debugMessage": str(e)[:1000]}
            if e.quality:
                body["qualityReport"] = e.quality
            body["durationMs"] = int((time.monotonic() - started) * 1000)
            report(api, base, body)
        # 이유는 앞부분만 남긴다("이유 | exit N: 출력 끝" 중 이유). 출력 끝에는 경로가 섞일 수 있다(S15P31B204-466)
        log.info("reconstruction failed: jobId=%s code=%s (%s)", job_id, e.code, str(e).split(" | ")[0][:200])
    except Stop as e:
        outcome = ("DROPPED", None)
        log.info("job dropped: jobId=%s (%s)", job_id, e)
    finally:
        hb.done.set()
        # 구간별 시간·CPU·GPU 한 줄(숫자와 작업 ID만). run_all.json을 읽으므로 작업 폴더를 지우기 전에 남긴다
        try:
            rec = meter.finish(os.environ.get("RECON_METRICS_FILE"), job_id, api.wid, *outcome, run_dir)
            if pusher:
                pusher.record(rec)
        except Exception as e:  # noqa: BLE001 - 기록 실패가 얼굴 데이터 삭제를 막지 않는다
            log.warning("metrics record failed: %s", type(e).__name__)
        if pusher:
            pusher.set_busy(False)
        # 얼굴 데이터: 성공·실패와 상관없이 지운다. 편집용 사본(build_case)은 cases/<jobId>-model에 따로 생긴다
        shutil.rmtree(RECON / "work" / job_id, ignore_errors=True)
        shutil.rmtree(RECON / "cases" / f"{job_id}-model", ignore_errors=True)


def report(api: Api, base: str, body: dict) -> str | None:
    path = f"{base}/result"
    r = api.post(path, body, wait_sec=JOB_API_WAIT_SEC, timeout_sec=180)
    rejection = (r.status_code, _code(r))
    if body.get("noseApproval") and rejection == NOSE_CHECK_UNAVAILABLE:
        log.warning("nose check temporarily unavailable; retrying the same result")
        time.sleep(NOSE_CHECK_RETRY_SEC)
        r = api.post(path, body, wait_sec=JOB_API_WAIT_SEC, timeout_sec=180)
        rejection = (r.status_code, _code(r))
    if body.get("noseApproval") and rejection in NOSE_REPORT_REJECTIONS:
        # 같은 시도의 업로드를 재사용하고, 코 승인 증거만 빼고 한 번 다시 보고한다.
        code = rejection[1]
        log.warning("nose approval rejected in result: %s", code)
        body = {
            **{key: value for key, value in body.items() if key != "noseApproval"},
            "qualityReport": {
                **body.get("qualityReport", {}),
                "noseCheck": nose_check_note({"eligible": False, "reason": f"result {code}"}),
            },
        }
        r = api.post(path, body, wait_sec=JOB_API_WAIT_SEC, timeout_sec=180)
    if r.status_code == 400:
        # 본문 버그. 재시도해도 같으므로 INTERNAL로 다시 보고한다(contracts "워커가 할 일")
        log.error("result rejected 400: %s", _code(r))
        if body["status"] != "FAILED" or body["failCodes"] != ["INTERNAL"]:
            api.post(
                f"{base}/result",
                {"status": "FAILED", "failCodes": ["INTERNAL"], "debugMessage": "result 400"},
                wait_sec=JOB_API_WAIT_SEC,
            )
    elif r.status_code == 409 and _code(r) in DROP_CODES:
        raise Stop(f"result {r.status_code} {_code(r)}")
    elif r.status_code == 409:
        # 작업은 아직 이 워커 것인데 결과를 받지 못한다. 버리면 lease 만료 두 번(약 30분) 뒤
        # TIMEOUT이 되므로 INTERNAL로 바로 보고한다. INTERNAL은 한 번 재시도된다(S15P31B204-582, contracts "워커가 할 일")
        log.error("result rejected 409: %s", _code(r))
        if body["status"] == "SUCCEEDED":
            raise JobFailed("INTERNAL", f"result 409 {_code(r)}")
    elif r.status_code != 200:
        raise RuntimeError(f"result not accepted: status={r.status_code} code={_code(r)}")
    return (r.json().get("data") or {}).get("faceModelId") if r.status_code == 200 else None


def leftover_targets() -> list[Path]:
    """강제 종료로 남았을 수 있는 작업 폴더 후보(S15P31B204-595). 나이는 leftovers.sweep이 거른다."""
    return [
        *leftovers.matching(RECON / "work", leftovers.JOB_ID),
        *leftovers.matching(RECON / "cases", leftovers.JOB_ID + "-model"),
        *leftovers.matching(
            leftovers.temp_root(os.environ.get("RECON_WORK_DIR")), re.escape(TEMP_PREFIX) + ".+"
        ),
    ]


def run_once(api: Api, files: httpx.Client) -> bool:
    """작업 하나를 처리했으면 True, 대기 작업이 없으면 False."""
    r = api.post(CLAIM, {"workerId": api.wid}, job=False)
    if r.status_code == 204:
        return False
    if r.status_code != 200:
        raise RuntimeError(f"claim {r.status_code} {_code(r)}")
    job = r.json()["data"]
    log.info("claimed: jobId=%s frames=%s", job["jobId"], job["input"].get("frameCount"))
    process(api, files, job)
    return True


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    # httpx는 요청 URL(서명 포함)을 INFO로 남긴다
    logging.getLogger("httpx").setLevel(logging.WARNING)
    secret = os.environ.get("INTERNAL_API_SECRET", "")
    if not secret:
        log.error("INTERNAL_API_SECRET is empty")
        return 1
    base = os.environ.get("RECON_API_BASE", "http://127.0.0.1:28080")
    with httpx.Client(base_url=base, timeout=30) as client, httpx.Client(timeout=600) as files:
        api = Api(client, secret, worker_id())
        log.info("reconstruction worker started: workerId=%s", api.wid)
        global pusher
        pusher = Pusher.from_env("gpu", api.wid)
        if pusher:
            pusher.start()
        sweeper = leftovers.Sweeper("reconstruction", leftover_targets)
        while True:
            sweeper.maybe()  # 시작할 때와 한 시간마다. 작업 사이에만 돈다
            try:
                if run_once(api, files):
                    continue
            except Fatal as e:
                log.error("stopping: %s", e)
                if pusher:
                    pusher.close()
                return 1
            except Exception:
                log.exception("reconstruction loop error")
            time.sleep(3 + random.random() * 2)


if __name__ == "__main__":
    sys.exit(main())
