import base64
import hashlib
import io
import json
import subprocess
import sys
import tarfile

import httpx
import pytest

from app.extractor import probe, worker

SECRET = "integration-test-only-internal-secret-0123456789"
JOB = "7b0e4c2d-9f1a-4e3b-8c5d-2a6f1e9b3c40"
KEY = "users/1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f/uploads/3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f/frames-a1.tar"
VIDEO = b"synthetic-video-bytes"


def b64sha(data: bytes) -> str:
    return base64.b64encode(hashlib.sha256(data).digest()).decode()


def claim_body(**input_overrides):
    return {
        "success": True,
        "data": {
            "jobId": JOB,
            "attempt": 1,
            "input": {
                "downloadUrl": "https://storage.example.invalid/synthetic/input.mov",
                "expiresAt": "2026-10-26T06:40:00Z",
                "contentType": "video/quicktime",
                "sizeBytes": len(VIDEO),
                "checksumSha256": b64sha(VIDEO),
                **input_overrides,
            },
            "maxFrames": 100,
            "claimedAt": "2026-10-26T06:30:05Z",
            "leaseTimeoutSec": 600,
        },
        "error": None,
    }


class FakeSpring:
    """claim → bundle-url → result 를 흉내 내고 받은 요청을 남긴다. S3 GET·PUT도 같은 transport로 받는다."""

    def __init__(self, claim=None, result_statuses=None):
        self.claim = claim or claim_body()
        self.requests = []
        self.uploaded = None
        self.result_statuses = list(result_statuses or [])  # /result 응답 상태를 차례로(비면 200)

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.method == "GET":
            return httpx.Response(200, content=VIDEO)
        if request.method == "PUT":
            self.uploaded = request.read()
            return httpx.Response(200)
        body = json.loads(request.content)
        self.requests.append((path, dict(request.headers), body))
        if path.endswith("/claim"):
            return httpx.Response(200, json=self.claim)
        if path.endswith("/bundle-url"):
            data = {
                "objectKey": KEY,
                "uploadUrl": "https://storage.example.invalid/synthetic/frames-a1.tar",
                "method": "PUT",
                "headers": {"Content-Type": "application/x-tar"},
                "expiresAt": "2026-10-26T06:41:00Z",
            }
            return httpx.Response(200, json={"success": True, "data": data, "error": None})
        if self.result_statuses and (status := self.result_statuses.pop(0)) != 200:
            error = {"code": "COMMON_400", "message": "invalid"}
            return httpx.Response(status, json={"success": False, "data": None, "error": error})
        return httpx.Response(200, json={"success": True, "data": {"accepted": True}, "error": None})

    def result(self):
        return next(b for p, _, b in self.requests if p.endswith("/result"))


def run(fake: FakeSpring, monkeypatch, extract):
    monkeypatch.setattr(worker, "run_extract", extract)
    transport = httpx.MockTransport(fake.handler)
    with (
        httpx.Client(base_url="http://api:8080", transport=transport) as c,
        httpx.Client(transport=transport) as f,
    ):
        return worker.run_once(worker.Api(c, SECRET, "ec2-test"), f, ["unused"], None)


def make_bundle(path, lens):
    with tarfile.open(path, "w") as tar:
        data = json.dumps(lens).encode()
        info = tarfile.TarInfo("lens.json")
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))


def test_성공하면_묶음을_올리고_크기_체크섬_장수_렌즈를_보고한다(monkeypatch):
    fake = FakeSpring()

    def extract(cmd, video, bundle, job_id, timeout, work_id=None):
        assert video.read_bytes() == VIDEO and job_id == JOB
        make_bundle(bundle, {"focalPx": 1412.5, "focalSource": "file", "deviceModel": "Synthetic-1"})
        return 0, {"frames": 91, "failCode": None}, ""

    assert run(fake, monkeypatch, extract) is True
    url_req = next(b for p, _, b in fake.requests if p.endswith("/bundle-url"))
    assert url_req["attempt"] == 1
    assert url_req["checksumSha256"] == b64sha(fake.uploaded)
    result = fake.result()
    assert result["status"] == "SUCCEEDED"
    assert result["bundle"] == {
        "objectKey": KEY,
        "sizeBytes": len(fake.uploaded),
        "checksumSha256": b64sha(fake.uploaded),
        "frameCount": 91,
    }
    assert result["lens"]["focalPx"] == 1412.5 and result["lens"]["focalSource"] == "file"
    headers = [h for p, h, _ in fake.requests if not p.endswith("/claim")]
    assert all(h["x-worker-id"] == "ec2-test" and h["x-internal-secret"] == SECRET for h in headers)


def test_작업이_끝나면_구간_기록을_로그에_한_줄_남긴다(monkeypatch, caplog):
    fake = FakeSpring()

    def extract(cmd, video, bundle, job_id, timeout, work_id=None):
        make_bundle(bundle, {"focalPx": None, "focalSource": "none"})
        return 0, {"frames": 91, "failCode": None}, ""

    with caplog.at_level("INFO", logger="extractor"):
        assert run(fake, monkeypatch, extract) is True
    line = next(r.getMessage() for r in caplog.records if r.getMessage().startswith("job metrics "))
    rec = json.loads(line[len("job metrics ") :])
    assert rec["kind"] == "extraction" and rec["jobId"] == JOB and rec["status"] == "SUCCEEDED"
    assert [s["name"] for s in rec["segments"]] == ["download", "extract", "upload", "report"]


def test_품질_실패_exit_2면_묶음을_올리지_않고_FAILED로_보고한다(monkeypatch):
    fake = FakeSpring()

    def extract(cmd, video, bundle, job_id, timeout, work_id=None):
        return 2, {"failCode": "QUALITY_NO_FACE", "quality": {"usable": 12}}, ""

    run(fake, monkeypatch, extract)
    assert fake.uploaded is None
    assert not any(p.endswith("/bundle-url") for p, _, _ in fake.requests)
    assert fake.result()["status"] == "FAILED"
    assert fake.result()["failCodes"] == ["QUALITY_NO_FACE"]


def test_영상_체크섬이_다르면_추출하지_않고_INTERNAL로_보고한다(monkeypatch):
    fake = FakeSpring(claim_body(checksumSha256=b64sha(b"other")))

    def extract(*args):
        pytest.fail("체크섬이 다르면 추출하지 않는다")

    run(fake, monkeypatch, extract)
    assert fake.result()["failCodes"] == ["INTERNAL"]


def test_추출_명령이_실패하면_INTERNAL로_보고한다(monkeypatch):
    fake = FakeSpring()
    run(fake, monkeypatch, lambda *a, **k: (1, {}, "Traceback ..."))
    assert fake.result()["failCodes"] == ["INTERNAL"]


def test_작업이_없으면_204를_받고_False다(monkeypatch):
    transport = httpx.MockTransport(lambda r: httpx.Response(204))
    with httpx.Client(base_url="http://api:8080", transport=transport) as c:
        assert worker.run_once(worker.Api(c, SECRET, "ec2-test"), c, ["unused"], None) is False


@pytest.mark.parametrize(
    ("raw", "expected"),
    [(None, 3.0), ("", 3.0), ("15", 15.0), ("0", 0.0), ("2.5", 2.5), ("abc", 3.0), ("-1", 3.0), ("601", 3.0)],
)
def test_빈_시간_claim_간격은_환경_변수로_정하고_틀리면_기본_3초다(monkeypatch, raw, expected):
    if raw is None:
        monkeypatch.delenv("EXTRACT_IDLE_SEC", raising=False)
    else:
        monkeypatch.setenv("EXTRACT_IDLE_SEC", raw)
    assert worker.idle_sec() == expected


def test_시크릿이_틀리면_재시도하지_않고_멈춘다():
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(401, json={"success": False, "data": None, "error": {"code": "AUTH_001"}})

    transport = httpx.MockTransport(handler)
    with httpx.Client(base_url="http://api:8080", transport=transport) as c, pytest.raises(worker.Fatal):
        worker.run_once(worker.Api(c, "wrong", "ec2-test"), c, ["unused"], None)
    assert len(calls) == 1


def test_렌즈_파일이_없으면_렌즈_없음으로_본다(tmp_path):
    bundle = tmp_path / "frames.tar"
    with tarfile.open(bundle, "w"):
        pass
    assert worker.read_lens(bundle) == {"focalPx": None, "focalSource": "none"}


# ffprobe -print_format json -show_format -show_streams 출력 모양(합성 값)
IPHONE = {
    "streams": [
        {"codec_type": "audio", "codec_name": "aac"},
        {
            "codec_type": "video",
            "codec_name": "hevc",
            "width": 1920,
            "height": 1080,
            "avg_frame_rate": "30000/1001",
            "color_transfer": "arib-std-b67",
            "side_data_list": [{"side_data_type": "Display Matrix", "rotation": -90}],
        },
    ],
    "format": {
        "duration": "20.512000",
        "bit_rate": "9876543",
        "tags": {
            "com.apple.quicktime.make": "Apple",
            "com.apple.quicktime.model": "iPhone Synthetic",
            "com.apple.quicktime.creationdate": "2026-10-27T14:38:10+0900",
            "com.apple.quicktime.location.ISO6709": "+37.0000+127.0000+050.000/",
            "creation_time": "2026-10-27T05:38:12.000000Z",
        },
    },
}


def test_아이폰_원본은_계약_키만_담고_위치는_빼고_의심하지_않는다():
    meta = probe.video_meta(IPHONE)
    assert meta == {
        "width": 1920,
        "height": 1080,
        "fps": 29.97,
        "codec": "hevc",
        "durationMs": 20512,
        "rotation": 270,
        "hdr": True,
        "bitrate": 9876543,
        "deviceMake": "Apple",
        "deviceModel": "iPhone Synthetic",
        "recordedAt": "2026-10-27T05:38:10Z",
        "originalSuspect": False,
    }
    assert "location" not in json.dumps(meta).lower() and "+37.0000" not in json.dumps(meta)


def test_갤럭시처럼_태그에_기기가_없으면_묶음_렌즈의_기기를_쓴다():
    info = {
        "streams": [
            {
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1080,
                "height": 1920,
                "avg_frame_rate": "30/1",
            }
        ],
        "format": {
            "duration": "18.0",
            "bit_rate": "17000000",
            "tags": {"creation_time": "2026-10-27T05:00:00.000000Z"},
        },
    }
    meta = probe.video_meta(info, {"deviceMake": "samsung", "deviceModel": "Galaxy Synthetic (SM-X000N)"})
    assert meta["deviceMake"] == "samsung" and meta["deviceModel"] == "Galaxy Synthetic (SM-X000N)"
    assert meta["recordedAt"] == "2026-10-27T05:00:00Z" and meta["hdr"] is False
    assert meta["originalSuspect"] is False


def test_기기_없음_재인코딩_저해상도면_원본_의심이다():
    base = {"codec_type": "video", "codec_name": "h264", "width": 1080, "height": 1920}
    no_device = {"streams": [base], "format": {"tags": {}}}
    reencoded = {"streams": [base], "format": {"tags": {"make": "Apple", "encoder": "Lavf60.16.100"}}}
    low_res = {"streams": [{**base, "width": 360, "height": 480}], "format": {"tags": {"make": "Apple"}}}
    assert probe.video_meta(no_device)["originalSuspect"] is True
    assert probe.video_meta(reencoded)["originalSuspect"] is True
    assert probe.video_meta(reencoded)["encoder"] == "Lavf60.16.100"
    assert probe.video_meta(low_res)["originalSuspect"] is True


def test_ffprobe가_없거나_영상_스트림이_없으면_영상_정보를_보내지_않는다(monkeypatch, tmp_path):
    monkeypatch.setenv("FFPROBE", str(tmp_path / "no-such-ffprobe"))
    assert probe.probe(tmp_path / "input") is None
    assert probe.video_meta(None) is None
    assert probe.video_meta({"streams": [{"codec_type": "audio"}], "format": {}}) is None


def test_성공_보고에_영상_정보를_싣는다(monkeypatch):
    fake = FakeSpring()
    monkeypatch.setattr(probe, "probe", lambda video: IPHONE)

    def extract(cmd, video, bundle, job_id, timeout, work_id=None):
        make_bundle(bundle, {"focalPx": 1412.5, "focalSource": "file"})
        return 0, {"frames": 91}, ""

    run(fake, monkeypatch, extract)
    result = fake.result()
    assert result["status"] == "SUCCEEDED"
    assert result["videoMeta"]["width"] == 1920 and result["videoMeta"]["originalSuspect"] is False


def test_품질_실패_보고에도_영상_정보를_싣는다(monkeypatch):
    fake = FakeSpring()
    low_res = {"streams": [{"codec_type": "video", "width": 360, "height": 480}], "format": {"tags": {}}}
    monkeypatch.setattr(probe, "probe", lambda video: low_res)
    run(fake, monkeypatch, lambda *a, **k: (2, {"failCode": "QUALITY_NO_FACE"}, ""))
    result = fake.result()
    assert result["status"] == "FAILED" and result["videoMeta"]["originalSuspect"] is True


def test_영상_정보를_못_읽으면_videoMeta_없이_보고한다(monkeypatch):
    fake = FakeSpring()
    monkeypatch.setattr(probe, "probe", lambda video: None)

    def extract(cmd, video, bundle, job_id, timeout, work_id=None):
        make_bundle(bundle, {"focalPx": None, "focalSource": "none"})
        return 0, {"frames": 50}, ""

    run(fake, monkeypatch, extract)
    assert "videoMeta" not in fake.result()


def test_영상_정보_때문에_보고가_400이면_영상_정보만_빼고_다시_보고한다(monkeypatch):
    fake = FakeSpring(result_statuses=[400])
    monkeypatch.setattr(probe, "probe", lambda video: IPHONE)

    def extract(cmd, video, bundle, job_id, timeout, work_id=None):
        make_bundle(bundle, {"focalPx": 1412.5, "focalSource": "file"})
        return 0, {"frames": 91}, ""

    run(fake, monkeypatch, extract)
    results = [b for p, _, b in fake.requests if p.endswith("/result")]
    assert len(results) == 2
    assert "videoMeta" in results[0] and "videoMeta" not in results[1]
    assert results[1]["status"] == "SUCCEEDED" and results[1]["bundle"] == results[0]["bundle"]


def test_영상_정보_없는_보고가_400이면_다시_보내지_않는다(monkeypatch):
    fake = FakeSpring(result_statuses=[400])
    monkeypatch.setattr(probe, "probe", lambda video: None)
    run(fake, monkeypatch, lambda *a, **k: (2, {"failCode": "QUALITY_NO_FACE"}, ""))
    assert len([p for p, _, _ in fake.requests if p.endswith("/result")]) == 1


# 추출 명령 대신 쓰는 합성 스크립트: 받은 TMPDIR을 출력하고, 추출 중간 결과 폴더(work/_bundle-<jobId>)를 만든다
FAKE_EXTRACT = (
    "import json, os, sys, time; root, job = sys.argv[1], sys.argv[-1]; "
    "os.makedirs(os.path.join(root, 'work', '_bundle-' + job, 'prep')); "
    "time.sleep(float(os.environ.get('FAKE_SLEEP', '0'))); "
    "print(json.dumps({'tmpdir': os.environ.get('TMPDIR')}))"
)


def fake_extract_cmd(tmp_path, monkeypatch):
    root = tmp_path / "reconstruction"
    monkeypatch.setattr(worker, "FRAMES_BUNDLE", root / "tools" / "frames_bundle.py")
    return [sys.executable, "-c", FAKE_EXTRACT, str(root)], root / "work" / f"_bundle-{JOB}"


def test_추출은_작업_임시_폴더를_TMPDIR로_쓰고_끝나면_중간_결과를_지운다(tmp_path, monkeypatch):
    cmd, work = fake_extract_cmd(tmp_path, monkeypatch)
    job_tmp = tmp_path / "job"
    job_tmp.mkdir()
    code, out, _ = worker.run_extract(cmd, job_tmp / "input", job_tmp / "frames.tar", JOB, 30)
    assert code == 0
    assert out["tmpdir"] == str(job_tmp)
    assert not work.exists()


def test_추출_시간_초과면_멈추고_중간_결과를_지운다(tmp_path, monkeypatch):
    cmd, work = fake_extract_cmd(tmp_path, monkeypatch)
    monkeypatch.setenv("FAKE_SLEEP", "30")
    with pytest.raises(subprocess.TimeoutExpired):
        worker.run_extract(cmd, tmp_path / "input", tmp_path / "frames.tar", JOB, 2)
    assert not work.exists()


def test_claim의_capture_기종을_추출에_넘기고_없으면_넘기지_않는다(monkeypatch):
    """S15P31B204-618: 웹 녹화 영상은 렌즈 기록이 없어 FE가 보낸 기종을 렌즈 표 출발값으로 쓴다."""
    body = claim_body()
    body["data"]["capture"] = {"method": "WEB_RECORDER", "deviceModel": "SM-S921N"}
    seen = []

    def extract(cmd, video, bundle, job_id, timeout, device_model=None, work_id=None):
        seen.append(device_model)
        make_bundle(bundle, {"focalPx": None, "focalSource": "device profile"})
        return 0, {"frames": 50, "failCode": None}, ""

    assert run(FakeSpring(body), monkeypatch, extract) is True
    assert run(FakeSpring(), monkeypatch, extract) is True
    assert seen == ["SM-S921N", None]


def test_run_extract는_기종이_있을_때만_device_model_인자를_붙인다(monkeypatch, tmp_path):
    calls = []

    class P:
        returncode = 0

        def __init__(self, args, **kw):
            calls.append(args)

        def communicate(self, timeout=None):
            return "{}", ""

    monkeypatch.setattr(worker.subprocess, "Popen", P)
    worker.run_extract(["x"], tmp_path / "v", tmp_path / "b.tar", JOB, 30, device_model="SM-S921N")
    worker.run_extract(["x"], tmp_path / "v", tmp_path / "b.tar", JOB, 30)
    assert calls[0][-2:] == ["--device-model", "SM-S921N"]
    assert "--device-model" not in calls[1]


def test_claim의_capture_trace를_파일로_넘기고_없으면_넘기지_않는다(monkeypatch):
    """S15P31B204-662: 웹 녹화 촬영 기록은 회전 부족 원인을 가르는 데 쓴다. 파일은 작업 임시 폴더 안이라 함께 지워진다."""
    trace = {"version": 1, "trace": [[0, -40.5, 1.0, 1]]}
    body = claim_body()
    body["data"]["capture"] = {"method": "WEB_RECORDER", "deviceModel": "SM-S921N", "trace": trace}
    seen = []

    def extract(cmd, video, bundle, job_id, timeout, device_model=None, capture_trace=None, work_id=None):
        seen.append(None if capture_trace is None else json.loads(capture_trace.read_text(encoding="utf-8")))
        assert capture_trace is None or capture_trace.parent == video.parent
        make_bundle(bundle, {"focalPx": None, "focalSource": "device profile"})
        return 0, {"frames": 50, "failCode": None}, ""

    assert run(FakeSpring(body), monkeypatch, extract) is True
    assert run(FakeSpring(), monkeypatch, extract) is True
    assert seen == [trace, None]


def test_회전_부족이면_좌우_각도와_원인을_실패_보고에_남긴다(monkeypatch):
    angle = {
        "status": "FAIL",
        "short": ["LEFT"],
        "yawMin": -28.4,
        "yawMax": 61.0,
        "trace": {"cause": {"LEFT": "turn"}},
    }

    def extract(cmd, video, bundle, job_id, timeout, work_id=None):
        return 2, {"failCode": "QUALITY_ANGLE", "quality": "FAIL", "angle": angle}, ""

    fake = FakeSpring()
    run(fake, monkeypatch, extract)
    assert fake.uploaded is None and fake.result()["failCodes"] == ["QUALITY_ANGLE"]
    assert json.loads(fake.result()["debugMessage"]) == angle


def test_run_extract는_trace가_있을_때만_capture_trace_인자를_붙인다(monkeypatch, tmp_path):
    calls = []

    class P:
        returncode = 0

        def __init__(self, args, **kw):
            calls.append(args)

        def communicate(self, timeout=None):
            return "{}", ""

    monkeypatch.setattr(worker.subprocess, "Popen", P)
    worker.run_extract(["x"], tmp_path / "v", tmp_path / "b.tar", JOB, 30, capture_trace=tmp_path / "t.json")
    worker.run_extract(["x"], tmp_path / "v", tmp_path / "b.tar", JOB, 30)
    assert calls[0][-2:] == ["--capture-trace", str(tmp_path / "t.json")]
    assert "--capture-trace" not in calls[1]


def test_작업_폴더는_작업_ID와_시도_번호로_나눈다(monkeypatch):
    """S15P31B204-594: lease가 넘어가 같은 작업을 두 워커가 같은 코드 폴더에서 돌려도 서로의 폴더를 지우지 않는다"""
    body = claim_body()
    body["data"]["attempt"] = 2
    seen = []

    def extract(cmd, video, bundle, job_id, timeout, work_id=None, **kw):
        seen.append(work_id)
        make_bundle(bundle, {"focalPx": None, "focalSource": "none"})
        return 0, {"frames": 50, "failCode": None}, ""

    assert run(FakeSpring(body), monkeypatch, extract) is True
    assert seen == [f"{JOB}-a2"]


def test_run_extract는_work_id로_폴더를_만들고_끝나면_그_폴더를_지운다(tmp_path, monkeypatch):
    cmd, shared = fake_extract_cmd(tmp_path, monkeypatch)
    shared.mkdir(parents=True)  # 다른 시도가 쓰는 폴더(예전 이름): 건드리지 않는다
    job_tmp = tmp_path / "job"
    job_tmp.mkdir()
    code, _, _ = worker.run_extract(
        cmd, job_tmp / "input", job_tmp / "frames.tar", JOB, 30, work_id=f"{JOB}-a2"
    )
    assert code == 0
    assert not (shared.parent / f"_bundle-{JOB}-a2").exists()
    assert shared.exists()


def test_종료_신호가_오면_하던_작업은_끝내고_새_작업은_받지_않는다(monkeypatch):
    """S15P31B204-531: 배포가 컨테이너를 다시 띄울 때 진행 중인 추출을 끊지 않는다"""
    import threading

    stop, calls = threading.Event(), []

    def run_once(*a):
        calls.append(1)
        worker.stop_requested(stop, 15)  # 작업 중에 SIGTERM
        return True

    monkeypatch.setattr(worker, "run_once", run_once)
    assert worker.serve(None, None, ["x"], None, 30, stop) == 0
    assert calls == [1]


def test_쉬는_중에_종료_신호가_오면_대기를_끊고_바로_끝낸다(monkeypatch):
    import threading
    import time

    stop = threading.Event()
    monkeypatch.setattr(worker, "run_once", lambda *a: False)
    threading.Timer(0.2, stop.set).start()
    t0 = time.monotonic()
    assert worker.serve(None, None, ["x"], None, 30, stop) == 0
    assert time.monotonic() - t0 < 5  # idle 30초를 다 기다리지 않는다
