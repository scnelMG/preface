"""EC2 프레임 추출 워커(S15P31B204-353). 계약: contracts/frame-extraction.

Spring 내부 API로 작업을 하나씩 가져가(pull) 원본 영상에서 프레임 묶음을 만들고 올린 뒤 결과를 보고한다. 동시에 한 건만 처리한다
(추출은 CPU를 많이 써서 같은 EC2의 api·web에 영향이 간다). DB·S3 자격 증명 없이 presigned URL만 쓴다.

환경 변수:
    EXTRACTOR_API_BASE   Spring api 주소(기본 http://api:8080, docker 내부망)
    INTERNAL_API_SECRET  내부 API 공유 시크릿(필수)
    EXTRACTOR_WORKER_ID  워커 ID(기본 ec2-<hostname>)
    EXTRACT_CMD          추출 명령(기본: 같은 Python으로 reconstruction/tools/frames_bundle.py, S15P31B204-355)
    EXTRACT_WORK_DIR     임시 파일 위치(기본 시스템 임시 폴더). 작업이 끝나면 지우고, 강제 종료로 남은 것은 2시간 뒤 지운다(app/leftovers.py)
    FFPROBE              영상 정보(videoMeta)를 읽는 ffprobe(기본 ffprobe). 없으면 영상 정보 없이 보고한다(app/extractor/probe.py)
    EXTRACT_IDLE_SEC     대기 작업이 없을 때 다음 claim까지 기다리는 초(기본 3, 여기에 0~2초를 더한다). 운영 EC2는 길게 둬서
                         SSAFY 추출 워커가 먼저 가져가게 한다(S15P31B204-594)
    EXTRACT_TRACE_CUT    1이면 웹 녹화 촬영 기록(capture.trace)으로 마지막 정면·최소 길이 대기 구간을 빼고 프레임을 고른다
                         (S15P31B204-667, frames_bundle.trace_cut). 기본 꺼짐: dev 웹 녹화로 확인한 뒤 켠다
    EXTRACT_POSE_SLOTS   기본 켬: 촬영 기록의 새 머리 각도에 프레임을 고르게 나눈다(frames_bundle.pose_slots, TRACE_CUT 대신).
                         0이면 영상 시간 칸

서명 URL과 시크릿은 로그에 남기지 않는다.
"""

import base64
import hashlib
import json
import logging
import os
import random
import re
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
from pathlib import Path

import httpx

from app import leftovers
from app.download import download as _download
from app.extractor import probe
from app.metrics import Meter
from app.proctree import kill_tree
from app.pushmetrics import Pusher

log = logging.getLogger("extractor")
# 워커 지표 보내기(S15P31B204-455). METRICS_PUSH_URL이 있을 때만 main이 만든다
pusher: Pusher | None = None

CLAIM = "/internal/v1/frame-extraction-jobs/claim"
FAIL_CODES = {
    "QUALITY_NO_FACE",
    "QUALITY_ANGLE",
    "QUALITY_LIGHT",
    "QUALITY_COMPRESSED",
    "FIT_FAILED",
    "TIMEOUT",
    "INTERNAL",
}
QUALITY_EXIT = 2
# AI 파트 추출 명령. 자기 위치 기준으로 파일을 찾으므로 작업 폴더와 무관하다
FRAMES_BUNDLE = Path(__file__).resolve().parents[2] / "reconstruction" / "tools" / "frames_bundle.py"
# 작업별 임시 폴더(원본 영상·묶음) 이름표. 공용 임시 폴더에서도 남은 것만 골라 지운다(S15P31B204-595)
TEMP_PREFIX = "lm-extract-"
RETRY_DELAYS = (1, 2, 4, 8, 16)
IDLE_SEC = 3.0


def idle_sec() -> float:
    """EXTRACT_IDLE_SEC(0~600초). 없거나 틀리면 기본 3초다. main이 시작할 때 한 번 읽는다."""
    raw = os.environ.get("EXTRACT_IDLE_SEC", "")
    try:
        sec = float(raw) if raw else IDLE_SEC
    except ValueError:
        sec = -1.0
    if not 0 <= sec <= 600:
        log.warning("EXTRACT_IDLE_SEC invalid, using %ss", IDLE_SEC)
        sec = IDLE_SEC
    return sec


class Fatal(Exception):
    """재시도해도 같은 오류(401 등). 루프를 멈추고 알린다."""


def sha256_b64(path: Path) -> str:
    """S3 체크섬과 같은 형식(base64)."""
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return base64.b64encode(digest.digest()).decode()


def worker_id() -> str:
    raw = os.environ.get("EXTRACTOR_WORKER_ID") or f"ec2-{socket.gethostname()}"
    return re.sub(r"[^A-Za-z0-9._-]", "-", raw)[:64]


def read_lens(bundle: Path) -> dict:
    """묶음 lens.json. 없거나 깨졌으면 렌즈 없음으로 본다(GPU가 초점값을 추정)."""
    try:
        with tarfile.open(bundle) as tar:
            member = tar.extractfile("lens.json")
            lens = json.loads(member.read()) if member else {}
    except (KeyError, tarfile.TarError, ValueError):
        lens = {}
    lens.setdefault("focalPx", None)
    lens.setdefault("focalSource", "none")
    return lens


class Api:
    def __init__(self, client: httpx.Client, secret: str, wid: str):
        self.client = client
        self.secret = secret
        self.wid = wid

    def post(self, path: str, body: dict, *, job: bool = True) -> httpx.Response:
        headers = {"X-Internal-Secret": self.secret}
        if job:
            headers["X-Worker-Id"] = self.wid
        for i, delay in enumerate((0, *RETRY_DELAYS)):
            time.sleep(delay)
            try:
                r = self.client.post(path, json=body, headers=headers)
            except httpx.TransportError as e:
                log.warning("api %s network error (%s), try %d", path, type(e).__name__, i + 1)
                continue
            if r.status_code == 401:
                raise Fatal("AUTH_001: INTERNAL_API_SECRET mismatch")
            if r.status_code < 500:
                return r
            log.warning("api %s %d, try %d", path, r.status_code, i + 1)
        raise RuntimeError(f"api {path} failed after retries")


def download(client: httpx.Client, url: str, dest: Path, sleep=time.sleep) -> None:
    """원본 영상 받기: 연결 오류는 다시 받는다(app/download.py, S15P31B204-594)"""
    _download(client, url, dest, "video", sleep)


def run_extract(
    cmd: list[str],
    video: Path,
    bundle: Path,
    job_id: str,
    timeout: int,
    device_model: str | None = None,
    capture_trace: Path | None = None,
    work_id: str | None = None,
) -> tuple[int, dict, str]:
    """exit 2(품질 실패)도 결과로 쓴다. 시간 초과면 자손까지 끝내고 TimeoutExpired를 그대로 올린다.

    추출 임시 파일(영상 하드링크 등)은 이 작업의 임시 폴더(영상 옆) 안에 만들게 해, 추출이 죽어도 process()가 폴더째 지운다.
    추출 중간 결과(work/_bundle-<jobId>, 고른 프레임)는 정상 종료면 frames_bundle이 지우고, 죽었을 때를 위해 여기서도 지운다
    (S15P31B204-448). work_id(작업 ID + 시도 번호)를 주면 그 이름으로 폴더를 만든다: lease가 넘어가 같은 작업을 두 워커가 같은 코드 폴더에서
    돌려도 서로의 폴더를 지우지 않는다(S15P31B204-594)."""
    proc = subprocess.Popen(
        [*cmd, "extract", str(video), str(bundle), "--job-id", job_id]
        + (["--device-model", device_model] if device_model else [])
        + (["--capture-trace", str(capture_trace)] if capture_trace else [])
        + (["--work-id", work_id] if work_id else []),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env={**os.environ, "TMPDIR": str(video.parent)},
    )
    try:
        stdout, stderr = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        kill_tree(proc)
        raise
    finally:
        shutil.rmtree(FRAMES_BUNDLE.parents[1] / "work" / f"_bundle-{work_id or job_id}", ignore_errors=True)
    try:
        out = json.loads(stdout.strip().splitlines()[-1]) if stdout.strip() else {}
    except ValueError:
        out = {}
    return proc.returncode, out, stderr[-500:]


def process(api: Api, files: httpx.Client, job: dict, cmd: list[str], work_dir: str | None) -> None:
    """작업 1건 처리. 끝나면 구간별 시간·CPU를 로그에 "job metrics {...}" 한 줄로 남긴다(숫자와 작업 ID만, S15P31B204-445)."""
    meter, outcome = Meter(), ["ERROR", None]
    if pusher:
        pusher.set_busy(True)
    try:
        _process(api, files, job, cmd, work_dir, meter, outcome)
    finally:
        try:
            rec = meter.finish(None, job["jobId"], api.wid, outcome[0], outcome[1], kind="extraction")
            log.info("job metrics %s", json.dumps(rec, ensure_ascii=False))
            if pusher:
                pusher.record(rec)
        except Exception as e:  # noqa: BLE001 - 기록 실패가 작업을 막지 않는다
            log.warning("metrics record failed: %s", type(e).__name__)
        if pusher:
            pusher.set_busy(False)


def _process(api, files, job, cmd, work_dir, meter: Meter, outcome: list) -> None:
    job_id, attempt = job["jobId"], job["attempt"]
    result_path = f"/internal/v1/frame-extraction-jobs/{job_id}/result"

    def report(body: dict) -> None:
        r = api.post(result_path, {"attempt": attempt, **body})
        if r.status_code == 400 and "videoMeta" in body:
            # 기록용 영상 정보 하나가 검사에 걸려 보고 전체가 거절되면 3D 생성까지 실패한다 — 영상 정보만 빼고 다시 보낸다
            log.warning(
                "result rejected with videoMeta, retrying without: jobId=%s code=%s", job_id, _code(r)
            )
            body = {k: v for k, v in body.items() if k != "videoMeta"}
            r = api.post(result_path, {"attempt": attempt, **body})
        if r.status_code != 200:
            log.error("result rejected: jobId=%s status=%d code=%s", job_id, r.status_code, _code(r))
        elif not r.json()["data"]["accepted"]:
            log.info("result not accepted (canceled or reassigned): jobId=%s", job_id)

    info = None  # 원본 영상의 ffprobe 결과(-395). 원본은 이 함수가 끝나면 지워지므로 실패 보고에도 싣는다

    def failed(codes: list[str], message: str) -> None:
        meter.lap("report")
        outcome[:] = ["FAILED", codes[0]]
        body = {"status": "FAILED", "failCodes": codes, "debugMessage": message[:1000]}
        meta = probe.video_meta(info)
        if meta:
            body["videoMeta"] = meta
        report(body)

    with tempfile.TemporaryDirectory(prefix=TEMP_PREFIX, dir=work_dir) as tmp:
        video, bundle = Path(tmp) / "input", Path(tmp) / "frames.tar"
        try:
            download(files, job["input"]["downloadUrl"], video)
        except httpx.HTTPError as e:
            return failed(["INTERNAL"], f"video download failed: {type(e).__name__}")
        if sha256_b64(video) != job["input"]["checksumSha256"]:
            return failed(["INTERNAL"], "video checksum mismatch")
        info = probe.probe(video)

        meter.lap("extract")
        timeout = max(60, int(job["leaseTimeoutSec"]) - 60)
        try:
            # 웹 녹화 영상은 렌즈 기록이 없다: FE가 보낸 기종을 렌즈 표 출발값으로(S15P31B204-618). 영상 안 기록이 이긴다
            capture = job.get("capture") or {}
            extra: dict = {"device_model": capture["deviceModel"]} if capture.get("deviceModel") else {}
            # 웹 녹화 촬영 기록(-640). 회전 부족(QUALITY_ANGLE)의 원인을 가르는 데만 쓴다(S15P31B204-662). 각도 숫자뿐이다
            if isinstance(capture.get("trace"), dict):
                extra["capture_trace"] = Path(tmp) / "capture-trace.json"
                extra["capture_trace"].write_text(json.dumps(capture["trace"]), encoding="utf-8")
            code, out, err = run_extract(
                cmd, video, bundle, job_id, timeout, work_id=f"{job_id}-a{attempt}", **extra
            )
        except subprocess.TimeoutExpired:
            return failed(["TIMEOUT"], f"extract exceeded {timeout}s")
        if code == QUALITY_EXIT:
            fail_code = out.get("failCode") if out.get("failCode") in FAIL_CODES else "QUALITY_NO_FACE"
            # 회전 부족이면 좌우 최대 각도·원인(trace)을 남긴다. 실패 분석용이고 영상이 지워져도 남는다(S1-5)
            detail = (
                out.get("angle")
                if fail_code == "QUALITY_ANGLE" and out.get("angle")
                else out.get("quality") or {}
            )
            return failed([fail_code], json.dumps(detail, ensure_ascii=False)[:1000])
        if code != 0 or not bundle.exists():
            return failed(["INTERNAL"], f"extract exit {code}: {err}")
        frames = int(out.get("frames") or 0)
        if not 1 <= frames <= int(job["maxFrames"]):
            return failed(["INTERNAL"], f"frame count {frames} out of range")

        meter.lap("upload")
        size, checksum = bundle.stat().st_size, sha256_b64(bundle)
        r = api.post(
            f"/internal/v1/frame-extraction-jobs/{job_id}/bundle-url",
            {"attempt": attempt, "sizeBytes": size, "checksumSha256": checksum},
        )
        if r.status_code != 200:
            log.info("bundle-url refused: jobId=%s status=%d code=%s", job_id, r.status_code, _code(r))
            outcome[:] = ["DROPPED", None]
            return None
        upload = r.json()["data"]
        with bundle.open("rb") as f:
            # 서명된 PUT은 chunked 전송을 받지 않는다 — 길이를 직접 붙인다
            headers = {**upload["headers"], "Content-Length": str(size)}
            put = files.put(upload["uploadUrl"], content=f, headers=headers)
        if put.status_code >= 300:
            return failed(["INTERNAL"], f"bundle upload failed: {put.status_code}")
        lens = read_lens(bundle)
        body = {
            "status": "SUCCEEDED",
            "bundle": {
                "objectKey": upload["objectKey"],
                "sizeBytes": size,
                "checksumSha256": checksum,
                "frameCount": frames,
            },
            "lens": lens,
        }
        meta = probe.video_meta(info, lens)
        if meta:
            body["videoMeta"] = meta
        meter.lap("report")
        report(body)
        outcome[:] = ["SUCCEEDED", None]
        log.info("frames bundle reported: jobId=%s frames=%d", job_id, frames)
    return None


def _code(r: httpx.Response) -> str:
    try:
        return r.json()["error"]["code"]
    except (ValueError, KeyError, TypeError):
        return "-"


def leftover_targets(work_dir: str | None) -> list[Path]:
    """강제 종료로 남았을 수 있는 추출 폴더 후보(S15P31B204-595): frames_bundle의 작업 폴더와 작업별 임시 폴더."""
    return [
        *leftovers.matching(FRAMES_BUNDLE.parents[1] / "work", "_bundle-" + leftovers.JOB_ID + r"(-a\d+)?"),
        *leftovers.matching(leftovers.temp_root(work_dir), re.escape(TEMP_PREFIX) + ".+"),
    ]


def run_once(api: Api, files: httpx.Client, cmd: list[str], work_dir: str | None) -> bool:
    """작업 하나를 처리했으면 True, 대기 작업이 없으면 False."""
    r = api.post(CLAIM, {"workerId": api.wid}, job=False)
    if r.status_code == 204:
        return False
    if r.status_code != 200:
        raise RuntimeError(f"claim {r.status_code} {_code(r)}")
    job = r.json()["data"]
    log.info("claimed: jobId=%s attempt=%s", job["jobId"], job["attempt"])
    process(api, files, job, cmd, work_dir)
    return True


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    # httpx는 요청 URL(서명 포함)을 INFO로 남긴다
    logging.getLogger("httpx").setLevel(logging.WARNING)
    secret = os.environ.get("INTERNAL_API_SECRET", "")
    if not secret:
        log.error("INTERNAL_API_SECRET is empty")
        return 1
    base = os.environ.get("EXTRACTOR_API_BASE", "http://api:8080")
    default_cmd = [sys.executable, str(FRAMES_BUNDLE)]
    cmd = shlex.split(os.environ["EXTRACT_CMD"]) if os.environ.get("EXTRACT_CMD") else default_cmd
    work_dir = os.environ.get("EXTRACT_WORK_DIR") or None
    idle = idle_sec()
    with httpx.Client(base_url=base, timeout=30) as client, httpx.Client(timeout=600) as files:
        api = Api(client, secret, worker_id())
        log.info("extractor started: workerId=%s idleSec=%s", api.wid, idle)
        global pusher
        # 추출은 GPU를 쓰지 않는다(EC2에는 GPU가 없고, SSAFY에서는 GPU 워커가 같은 GPU 값을 이미 보낸다)
        pusher = Pusher.from_env("extractor", api.wid, with_gpu=False)
        if pusher:
            pusher.start()
        sweeper = leftovers.Sweeper("extractor", lambda: leftover_targets(work_dir))
        stop = threading.Event()
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda signum, frame: stop_requested(stop, signum))
        code = serve(api, files, cmd, work_dir, idle, stop, sweeper)
        if pusher:
            pusher.close()
        return code


def stop_requested(stop: threading.Event, signum: int) -> None:
    """종료 신호(배포가 컨테이너를 다시 띄울 때 SIGTERM): 하던 추출은 마저 끝내고 새 작업은 받지 않는다(S15P31B204-531).
    추출 프로세스는 자식이라 이 신호를 받지 않는다(docker는 PID 1에만 보낸다). compose의 stop_grace_period 안에 끝나지 않으면
    SIGKILL로 끊기고, 그 작업은 전처럼 lease가 끝난 뒤 다시 처리된다."""
    if not stop.is_set():
        log.info("stop requested (signal %d): finishing the current job, no new claims", signum)
    stop.set()


def serve(api, files, cmd, work_dir, idle: float, stop: threading.Event, sweeper=None) -> int:
    """stop이 켜질 때까지 작업을 가져와 처리한다. 작업 중에 켜지면 그 작업은 끝까지 하고 돌아온다."""
    while not stop.is_set():
        if sweeper:
            sweeper.maybe()  # 시작할 때와 한 시간마다. 작업 사이에만 돈다
        try:
            if run_once(api, files, cmd, work_dir):
                continue
        except Fatal as e:
            log.error("stopping: %s", e)
            return 1
        except Exception:
            log.exception("extract loop error")
        # 워커끼리 같은 순간에 묻지 않게 0~2초를 더한다. 종료 신호가 오면 바로 깬다
        stop.wait(idle + random.random() * 2)
    log.info("stopped: no job in progress")
    return 0


if __name__ == "__main__":
    sys.exit(main())
