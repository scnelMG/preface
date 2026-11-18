"""app/reconstruction/worker.py: contract flow with a fake Spring API and a fake 3D build.

The real 3D build (frames_bundle.py run → run_all.py) needs COLMAP·GPU and real capture frames, so it is verified
outside CI (reconstruction/README.md). Synthetic data only: no face images.
"""

import base64
import hashlib
import json
import subprocess
from pathlib import Path

import httpx
import pytest
from test_eye_review import glb

from app.download import RETRY_DELAYS
from app.reconstruction import worker as w

JOB = "7b0e4c2d-9f1a-4e3b-8c5d-2a6f1e9b3c40"
PREFIX = f"users/1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f/models/{JOB}/a1/"
ANGLES = ("FRONT", "LEFT", "RIGHT", "LEFT_45", "RIGHT_45")


def frame(name, yaw, **kw):
    return {
        "file": name,
        "yaw": yaw,
        "face": True,
        "false_face": False,
        "marker": False,
        "sharpness": 40.0,
        **kw,
    }


SWEEP = [frame(f"v0_{i:05d}.jpg", y) for i, y in enumerate((-68, -50, -42, -20, -3, 2, 18, 40, 47, 63))]


def test_captures_take_the_most_turned_sides_and_the_nearest_half_turns():
    got = w.pick_captures(SWEEP)
    assert got == {
        "FRONT": "v0_00005.jpg",
        "LEFT": "v0_00000.jpg",
        "RIGHT": "v0_00009.jpg",
        "LEFT_45": "v0_00002.jpg",
        "RIGHT_45": "v0_00008.jpg",
    }


def test_captures_skip_false_faces():
    images = [*SWEEP, frame("bad.jpg", -80, false_face=True), frame("noface.jpg", 85, face=False)]
    got = w.pick_captures(images)
    assert (got["LEFT"], got["RIGHT"]) == ("v0_00000.jpg", "v0_00009.jpg")


def test_captures_without_a_side_view_are_an_angle_failure():
    images = [frame(f"v0_{i:05d}.jpg", y) for i, y in enumerate((-20, -5, 0, 10, 50))]
    with pytest.raises(w.JobFailed) as e:
        w.pick_captures(images)
    assert e.value.code == "QUALITY_ANGLE"
    assert e.value.quality == {"yawMin": -20, "yawMax": 50}


def b64sha(data: bytes) -> str:
    return base64.b64encode(hashlib.sha256(data).digest()).decode()


class FakeSpring:
    """INT-REC-02~04 + presigned GET/PUT, recording what the worker sent."""

    def __init__(self, *, continue_=True, output_status=200, result_errors=(), expression=False):
        self.calls, self.puts, self.result, self.results = [], {}, None, []
        # 표정 리그 업로드 주소도 주는 백엔드인지
        self.expression = expression
        self.continue_, self.output_status = continue_, output_status
        # result 요청에 차례로 돌려줄 오류 코드. 다 쓰면 200
        self.result_errors = list(result_errors)
        self.bundle = b"synthetic bundle"

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.calls.append((request.method, path))
        if request.method == "GET":
            return httpx.Response(200, content=self.bundle)
        if request.method == "PUT":
            self.puts[path] = request.read()
            return httpx.Response(200)
        assert request.headers["X-Internal-Secret"] == "s" and request.headers["X-Worker-Id"] == "w1"
        if path.endswith("/progress"):
            return httpx.Response(
                200, json={"success": True, "data": {"continue": self.continue_}, "error": None}
            )
        if path.endswith("/output-urls"):
            if self.output_status != 200:
                err = {"code": "REC_022", "message": "reassigned"}
                return httpx.Response(self.output_status, json={"success": False, "data": None, "error": err})
            names = {
                "mesh": "head.glb",
                "rig": "rig.json",
                "texture": "texture.png",
                "thumbnail": "thumb.webp",
                **({"expression": "expression.json"} if self.expression else {}),
            }
            up = {k: self.upload(v) for k, v in names.items()}
            up["captures"] = {a: self.upload(f"captures/{a}.jpg") for a in ANGLES}
            return httpx.Response(200, json={"success": True, "data": up, "error": None})
        if path.endswith("/result"):
            self.result = json.loads(request.read())
            self.results.append(self.result)
            if self.result_errors:
                err = {"code": self.result_errors.pop(0), "message": "rejected"}
                status = 503 if err["code"] == "REC_023" else 409
                return httpx.Response(status, json={"success": False, "data": None, "error": err})
            return httpx.Response(
                200,
                json={"success": True, "data": {"accepted": True, "faceModelId": "model-1"}, "error": None},
            )
        raise AssertionError(path)

    @staticmethod
    def upload(name):
        return {
            "objectKey": PREFIX + name,
            "uploadUrl": f"https://storage.example.invalid/put/{name}",
            "method": "PUT",
            "headers": {"x-amz-checksum-sha256": "x"},
            "expiresAt": "2026-10-26T06:40:00Z",
        }


def job(spring):
    return {
        "jobId": JOB,
        "input": {
            "downloadUrl": "https://storage.example.invalid/get/frames-a1.tar",
            "checksumSha256": b64sha(spring.bundle),
            "frameCount": len(SWEEP),
            "lens": {"focalPx": 1221.9, "focalSource": "file"},
        },
        "outputPrefix": PREFIX,
        "morphSchemaVersion": "v1",
        "heartbeatIntervalSec": 120,
        "leaseTimeoutSec": 600,
    }


@pytest.fixture
def recon(tmp_path, monkeypatch):
    monkeypatch.setattr(w, "RECON", tmp_path)
    monkeypatch.setattr(w, "RETRY_DELAYS", ())
    monkeypatch.setattr(
        w.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args,
            0,
            json.dumps(
                {
                    "eligible": True,
                    "binding": {"meshSha256": "a" * 64},
                    "ranges": {"nose.bridge_height": {"min": -0.1, "max": 0.1}},
                }
            ),
        ),
    )
    return tmp_path


def fake_build(recon, *, fail=None, rig=True, eye_review=None):
    def build(hb, bundle, job_id):
        hb.set_stage("RECONSTRUCT", "COLMAP")
        run = recon / "work" / job_id
        (run / "prep" / "images").mkdir(parents=True)
        (run / "model").mkdir()
        for im in SWEEP:
            (run / "prep" / "images" / im["file"]).write_bytes(b"jpg " + im["file"].encode())
        (run / "prep" / "prepare.json").write_text(json.dumps({"images": SWEEP}), encoding="utf-8")
        (run / "model" / "head.glb").write_bytes(glb(eye_review, "a" * 64) if eye_review else b"glb")
        if rig:
            editable = b"synthetic rig data"
            (run / "model" / "rig.json").write_text(
                json.dumps(
                    {
                        "format": "live-mirror-rig",
                        "version": 1,
                        "nose": {
                            "engine": "v1",
                            "json": {
                                "editable_sha256": hashlib.sha256(editable).hexdigest(),
                                "rig_version": "v1",
                                "topology_version": "v1",
                            },
                            "bin": base64.b64encode(editable).decode(),
                        },
                    }
                ),
                encoding="utf-8",
            )
        (recon / "cases" / f"{job_id}-model").mkdir(parents=True)  # build_case's editable copy
        stages = {"model": {"chosen": "gnme", "sec": 90.0}, "lens": {"focal_px": 1222, "registered": 86}}
        (run / "run_all.json").write_text(json.dumps({"stages": stages}), encoding="utf-8")
        if fail:
            raise w.JobFailed(fail, "synthetic failure")
        return run

    return build


def run(spring, monkeypatch):
    transport = httpx.MockTransport(spring.handler)
    with (
        httpx.Client(transport=transport, base_url="http://api") as c,
        httpx.Client(transport=transport) as f,
    ):
        w.process(w.Api(c, "s", "w1"), f, job(spring))


def test_success_uploads_mesh_and_five_captures_then_reports_their_keys(recon, monkeypatch):
    spring = FakeSpring()
    monkeypatch.setattr(w, "build", fake_build(recon))
    run(spring, monkeypatch)
    assert spring.puts["/put/head.glb"] == b"glb"
    assert spring.puts["/put/captures/LEFT.jpg"] == b"jpg v0_00000.jpg"
    res = spring.result
    assert res["status"] == "SUCCEEDED" and res["meshFormat"] == "GLB" and res["morphSchemaVersion"] == "v1"
    assert res["meshObjectKey"] == PREFIX + "head.glb"
    assert res["captureImages"] == {a: PREFIX + f"captures/{a}.jpg" for a in ANGLES}
    assert res["qualityReport"]["chosen"] == "gnme"
    assert "texture.png" not in json.dumps(res)  # texture is inside the GLB
    assert res["rigObjectKey"] == PREFIX + "rig.json"
    assert res["noseApproval"]["schemaVersion"] == "v1"
    assert "eyeReview" not in res
    assert "eyePartsSha256" not in res
    stages = [p for m, p in spring.calls if p.endswith("/progress")]
    assert len(stages) >= 3  # QUALITY_CHECK, RECONSTRUCT, FINALIZE
    assert not (recon / "work" / JOB).exists()  # face data removed
    assert not (recon / "cases" / f"{JOB}-model").exists()


def test_result_reports_the_review_in_the_uploaded_glb(recon, monkeypatch):
    spring = FakeSpring()
    review = {"R": "present", "L": "absent"}
    monkeypatch.setattr(w, "build", fake_build(recon, eye_review=review))
    run(spring, monkeypatch)
    assert spring.result["eyeReview"] == review
    assert spring.result["eyePartsSha256"] == "a" * 64
    assert spring.puts["/put/head.glb"] == glb(review, spring.result["eyePartsSha256"])


def test_intact_nose_rig_is_uploaded_before_local_files_are_removed(recon, monkeypatch):
    spring = FakeSpring()
    monkeypatch.setattr(w, "build", fake_build(recon, rig=True))
    run(spring, monkeypatch)
    assert spring.result["rigObjectKey"] == PREFIX + "rig.json"
    assert "/put/rig.json" in spring.puts
    assert not (recon / "work" / JOB).exists()


def test_unsafe_new_rig_fails_generation_before_upload(recon, monkeypatch):
    spring = FakeSpring()
    monkeypatch.setattr(w, "build", fake_build(recon, rig=True))
    monkeypatch.setattr(
        w.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args, 0, '{"eligible": false}'),
    )
    run(spring, monkeypatch)
    assert spring.result["status"] == "FAILED"
    assert spring.result["failCodes"] == ["INTERNAL"]
    assert not spring.puts


def test_corrupt_rig_is_not_reported_as_an_edit_asset(recon, monkeypatch):
    spring = FakeSpring()
    original = fake_build(recon, rig=True)

    def corrupt(hb, bundle, job_id):
        run_dir = original(hb, bundle, job_id)
        path = run_dir / "model" / "rig.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        data["nose"]["bin"] = base64.b64encode(b"changed").decode()
        path.write_text(json.dumps(data), encoding="utf-8")
        return run_dir

    monkeypatch.setattr(w, "build", corrupt)
    run(spring, monkeypatch)
    assert spring.result["status"] == "FAILED"
    assert "/put/rig.json" not in spring.puts


def test_missing_rig_is_rebuilt_from_the_same_mesh_before_approval(recon, monkeypatch):
    spring = FakeSpring()
    monkeypatch.setattr(w, "build", fake_build(recon, rig=False))
    default_run = w.subprocess.run
    editable = b"recovered synthetic rig"
    repaired = json.dumps(
        {
            "format": "live-mirror-rig",
            "version": 1,
            "nose": {
                "bin": base64.b64encode(editable).decode(),
                "json": {"editable_sha256": hashlib.sha256(editable).hexdigest()},
            },
        }
    ).encode()

    def run_tool(args, **kwargs):
        if args[1].endswith("backfill_nose_rig.py"):
            assert Path(args[2]).read_bytes() == b"glb"
            Path(args[3]).write_bytes(repaired)
        return default_run(args, **kwargs)

    monkeypatch.setattr(w.subprocess, "run", run_tool)
    run(spring, monkeypatch)

    assert spring.result["status"] == "SUCCEEDED"
    assert spring.result["noseApproval"]["ranges"]
    assert spring.puts["/put/rig.json"] == repaired


def test_local_nose_tool_timeout_retries_without_rebuilding_the_model(recon, monkeypatch):
    spring = FakeSpring()
    monkeypatch.setattr(w, "build", fake_build(recon))
    default_run = w.subprocess.run
    attempts = []

    def run_tool(args, **kwargs):
        if args[1].endswith("auto_nose_candidate.mjs"):
            attempts.append(args[2])
            if len(attempts) == 1:
                raise subprocess.TimeoutExpired(args, kwargs["timeout"])
        return default_run(args, **kwargs)

    monkeypatch.setattr(w.subprocess, "run", run_tool)
    run(spring, monkeypatch)

    assert len(attempts) == 2 and attempts[0] == attempts[1]
    assert spring.result["status"] == "SUCCEEDED"
    assert spring.result["noseApproval"]["ranges"]


def test_wrong_bundle_checksum_fails_without_building(recon, monkeypatch):
    spring = FakeSpring()
    built = []
    monkeypatch.setattr(w, "build", lambda *a: built.append(a))
    spring.bundle = b"tampered"
    transport = httpx.MockTransport(spring.handler)
    j = job(FakeSpring())  # checksum of the original bytes
    with (
        httpx.Client(transport=transport, base_url="http://api") as c,
        httpx.Client(transport=transport) as f,
    ):
        w.process(w.Api(c, "s", "w1"), f, j)
    assert not built
    assert spring.result["status"] == "FAILED" and spring.result["failCodes"] == ["INTERNAL"]


def test_build_failure_is_reported_and_files_are_removed(recon, monkeypatch):
    spring = FakeSpring()
    monkeypatch.setattr(w, "build", fake_build(recon, fail="FIT_FAILED"))
    run(spring, monkeypatch)
    assert spring.result["status"] == "FAILED" and spring.result["failCodes"] == ["FIT_FAILED"]
    assert not (recon / "work" / JOB).exists()


def test_failure_log_keeps_the_reason_but_not_the_program_output(recon, monkeypatch, caplog):
    def build(hb, bundle, job_id):
        raise w.JobFailed(
            "FIT_FAILED", "lens: lens_anchor exit 2 | exit 1: /workspace/lm/work/x/prep/images/v0_00001.jpg"
        )

    monkeypatch.setattr(w, "build", build)
    with caplog.at_level("INFO", logger="reconstruction"):
        run(FakeSpring(), monkeypatch)
    line = next(r.getMessage() for r in caplog.records if "reconstruction failed" in r.getMessage())
    assert line.endswith("code=FIT_FAILED (lens: lens_anchor exit 2)")
    assert "/workspace" not in line


def test_stop_from_spring_sends_no_result(recon, monkeypatch):
    spring = FakeSpring(continue_=False)
    monkeypatch.setattr(w, "build", fake_build(recon))
    run(spring, monkeypatch)
    assert spring.result is None and not spring.puts


def test_reassigned_job_uploads_nothing(recon, monkeypatch):
    spring = FakeSpring(output_status=409)
    monkeypatch.setattr(w, "build", fake_build(recon))
    run(spring, monkeypatch)
    assert spring.result is None and not spring.puts
    assert not (recon / "work" / JOB).exists()


@pytest.mark.parametrize("errors", [("EDIT_031",), ("EDIT_032",), ("REC_023", "REC_023")])
def test_result_rejected_by_nose_check_reuses_uploaded_assets_and_only_locks_nose(
    recon, monkeypatch, clock, errors
):
    spring = FakeSpring(result_errors=errors)
    monkeypatch.setattr(w, "build", fake_build(recon))
    run(spring, monkeypatch)
    *attempts, second = spring.results
    assert len(attempts) == len(errors)
    first = attempts[0]
    assert all(attempt == first for attempt in attempts)
    assert first["status"] == second["status"] == "SUCCEEDED"
    assert "noseApproval" in first and "noseApproval" not in second
    assert second["meshObjectKey"] == first["meshObjectKey"]
    assert second["rigObjectKey"] == first["rigObjectKey"]
    assert second["captureImages"] == first["captureImages"]
    assert second["qualityReport"]["noseCheck"]["reason"] == f"result {errors[-1]}"
    assert spring.calls.count(("PUT", "/put/head.glb")) == 1
    assert not (recon / "work" / JOB).exists()


def test_temporary_nose_check_failure_retries_with_the_same_approval(recon, monkeypatch, clock):
    spring = FakeSpring(result_errors=["REC_023"])
    monkeypatch.setattr(w, "build", fake_build(recon))
    run(spring, monkeypatch)
    first, second = spring.results
    assert "noseApproval" in first
    assert second == first
    assert spring.calls.count(("PUT", "/put/head.glb")) == 1
    assert clock[0] >= w.NOSE_CHECK_RETRY_SEC


@pytest.mark.parametrize("first_error", ["EDIT_031", "REC_023"])
def test_nose_result_retry_does_not_overwrite_a_reassigned_job(recon, monkeypatch, clock, first_error):
    spring = FakeSpring(result_errors=[first_error, "REC_022"])
    monkeypatch.setattr(w, "build", fake_build(recon))
    run(spring, monkeypatch)
    assert [r["status"] for r in spring.results] == ["SUCCEEDED", "SUCCEEDED"]
    assert ("noseApproval" in spring.results[-1]) == (first_error == "REC_023")


@pytest.mark.parametrize("code", ["REC_020", "REC_021", "REC_022"])
def test_result_for_a_canceled_finished_or_reassigned_job_is_dropped(recon, monkeypatch, code):
    spring = FakeSpring(result_errors=[code])
    monkeypatch.setattr(w, "build", fake_build(recon))
    run(spring, monkeypatch)
    assert [r["status"] for r in spring.results] == ["SUCCEEDED"]
    assert not (recon / "work" / JOB).exists()


def test_failure_report_rejected_with_409_is_not_reported_again(recon, monkeypatch):
    spring = FakeSpring(result_errors=["EDIT_031"])
    monkeypatch.setattr(w, "build", fake_build(recon, fail="FIT_FAILED"))
    run(spring, monkeypatch)
    assert [r["failCodes"] for r in spring.results] == [["FIT_FAILED"]]


class Redeploy(FakeSpring):
    """api가 첫 output-urls 요청부터 down_sec 동안 응답하지 않는다(개발 배포로 재시작 중). 시간은 가짜 시계."""

    def __init__(self, clock, down_sec):
        super().__init__()
        self.clock, self.down_sec, self.down_from = clock, down_sec, None

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path.endswith("/output-urls") and self.down_from is None:
            self.down_from = self.clock[0]
        down = self.down_from is not None and self.clock[0] - self.down_from < self.down_sec
        if request.method == "POST" and down:
            raise httpx.ConnectError("connection refused", request=request)
        return super().handler(request)


@pytest.fixture
def clock(monkeypatch):
    now = [0.0]
    monkeypatch.setattr(w.time, "sleep", lambda s: now.__setitem__(0, now[0] + s))
    monkeypatch.setattr(w, "RETRY_DELAYS", (1, 2, 4, 8, 16))
    return now


def test_retry_delays_wait_longer_only_when_asked():
    assert list(w.retry_delays()) == [0, 1, 2, 4, 8, 16]  # claim·progress: 31초
    long = list(w.retry_delays(w.JOB_API_WAIT_SEC))
    assert sum(long) == w.JOB_API_WAIT_SEC and max(long) <= 16


def test_result_is_reported_after_an_api_redeploy(recon, clock, monkeypatch):
    spring = Redeploy(clock, down_sec=55)  # 2026-10-28 실측 46~54초
    monkeypatch.setattr(w, "build", fake_build(recon))
    run(spring, monkeypatch)
    assert spring.result["status"] == "SUCCEEDED"
    assert sum(1 for m, p in spring.calls if p.endswith("/result")) == 1
    assert 55 <= clock[0] - spring.down_from < 55 + w.JOB_API_RETRY_GAP
    assert not (recon / "work" / JOB).exists()


def test_result_gives_up_when_the_api_stays_down(recon, clock, monkeypatch):
    spring = Redeploy(clock, down_sec=10_000)
    monkeypatch.setattr(w, "build", fake_build(recon))
    with pytest.raises(RuntimeError):
        run(spring, monkeypatch)
    assert clock[0] - spring.down_from == w.JOB_API_WAIT_SEC
    assert spring.result is None
    assert not (recon / "work" / JOB).exists()  # face data removed even when giving up


def test_claim_still_gives_up_after_31_seconds(clock):
    def down(request):
        raise httpx.ConnectError("connection refused", request=request)

    with (
        httpx.Client(transport=httpx.MockTransport(down), base_url="http://api") as c,
        pytest.raises(RuntimeError),
    ):
        w.run_once(w.Api(c, "s", "w1"), c)
    assert clock[0] == 31


def _run_all(tmp_path, stages):
    (tmp_path / "run_all.json").write_text(json.dumps({"stages": stages}), encoding="utf-8")
    return tmp_path


@pytest.mark.parametrize(
    ("stages", "code", "expected"),
    [
        # COLMAP crashed inside the lens stage (job af8ae9ec): run_all ends with 1, the stage keeps -11
        (
            {"sfm": {"status": "PASS"}, "lens": {"status": "FAIL", "error": "lens_anchor exit -11"}},
            1,
            "INTERNAL",
        ),
        ({"sfm": {"status": "FAIL", "error": "sfm exit 1"}}, 1, "INTERNAL"),
        # lens_anchor gives up on purpose (exit 2): no focal length registers 80 % of the frames (jobs e28a5f95, 5e09758f)
        (
            {"sfm": {"status": "PASS"}, "lens": {"status": "FAIL", "error": "lens_anchor exit 2"}},
            1,
            "FIT_FAILED",
        ),
        # sfm_sparse mapping gives up on purpose: no model (2), under 60 % registered (3)
        ({"sfm": {"status": "FAIL", "error": "sfm exit 2"}}, 1, "FIT_FAILED"),
        ({"sfm": {"status": "FAIL", "error": "sfm exit 3"}}, 1, "FIT_FAILED"),
        # photo problems: the programs ran, the frames did not give a camera solution
        ({"sfm": {"status": "FAIL", "error": "sfm exit 0"}}, 1, "FIT_FAILED"),
        (
            {"lens": {"status": "FAIL", "error": "카메라 위치 복원 실패(등록 프레임 60% 미만)"}},
            1,
            "FIT_FAILED",
        ),
        # later stages failing is our bug, not the user's video
        (
            {"lens": {"status": "PASS"}, "model": {"status": "FAIL", "error": "scan_to_model exit 1"}},
            1,
            "INTERNAL",
        ),
        ({}, 1, "INTERNAL"),
    ],
)
def test_build_failure_tells_a_photo_problem_from_a_program_problem(tmp_path, stages, code, expected):
    assert w.build_failure(code, _run_all(tmp_path, stages))[0] == expected


def test_a_killed_build_and_a_missing_record_are_internal(tmp_path):
    assert w.build_failure(-11, tmp_path) == ("INTERNAL", "3d build killed by signal 11")
    assert w.build_failure(1, tmp_path)[0] == "INTERNAL"  # no run_all.json (bundle refused before any stage)


POSE_NOTE = (
    "카메라 위치 복원 실패: 고개를 돌린 쪽에서 SfM 회전이 MediaPipe보다 작음 (왼쪽 -27.4°, 기준 -15.0°)"
)


def test_pose_check_fail_returns_the_model_and_records_the_verdict(tmp_path):
    """S15P31B204-663 (계획 S5-1): 끝까지 만든 결과는 돌려주고, 카메라 위치 검사 판정만 qualityReport에 남긴다."""
    body = {
        "overall": "FAIL",
        "stages": {"model": {"status": "WARN", "pose_check": "FAIL", "notes": ["x", POSE_NOTE]}},
    }
    (tmp_path / "run_all.json").write_text(json.dumps(body), encoding="utf-8")
    q = w.quality_report(tmp_path)
    assert q["overall"] == "FAIL" and q["poseCheck"] == "FAIL" and q["poseNote"] == POSE_NOTE
    assert not hasattr(w, "overall_failure")  # no gate after a finished build
    _run_all(tmp_path, {"model": {"status": "PASS"}})
    assert "poseCheck" not in w.quality_report(tmp_path) and "poseNote" not in w.quality_report(tmp_path)


@pytest.mark.parametrize(
    ("stages", "where", "done"),
    [
        (
            {
                "prepare": {"status": "PASS", "sec": 30.2},
                "sfm": {"status": "PASS", "sec": 80},
                "lens": {"status": "WARN"},
            },
            "model",
            "prepare 30s, sfm 80s, lens 0s",
        ),
        (
            {"prepare": {"status": "PASS", "sec": 12}, "sfm": {"status": "FAIL", "sec": 5}},
            "sfm",
            "prepare 12s",
        ),
        ({}, "prepare", "none"),
    ],
)
def test_timeout_point_names_the_stage_that_was_running(tmp_path, stages, where, done):
    assert w.timeout_point(_run_all(tmp_path, stages)) == (where, done)


def test_timeout_reports_where_the_build_stopped(recon, monkeypatch):
    """S15P31B204-665: 시간 초과 2건의 초과 단계를 몰랐다. 끝난 단계와 그때 돌던 단계를 보고에 남긴다."""

    class FakePopen:
        def __init__(self, cmd, **kwargs):
            run = recon / "work" / JOB
            run.mkdir(parents=True)
            stages = {"prepare": {"status": "PASS", "sec": 31}, "sfm": {"status": "PASS", "sec": 84}}
            (run / "run_all.json").write_text(json.dumps({"stages": stages}), encoding="utf-8")

        def wait(self, timeout=None):
            raise subprocess.TimeoutExpired("run_all", timeout)

    monkeypatch.setattr(w.subprocess, "Popen", FakePopen)
    monkeypatch.setattr(w, "kill_tree", lambda proc: None)
    spring = FakeSpring()
    run(spring, monkeypatch)
    res = spring.result
    assert res["failCodes"] == ["TIMEOUT"]
    assert "during lens (done: prepare 31s, sfm 84s)" in res["debugMessage"]
    assert res["qualityReport"]["timeoutStage"] == "lens"
    assert res["qualityReport"]["stageSec"] == {"prepare": 31, "sfm": 84}


def test_success_reports_the_finalize_steps(recon, monkeypatch):
    spring = FakeSpring()
    monkeypatch.setattr(w, "build", fake_build(recon))
    run(spring, monkeypatch)
    assert set(spring.result["qualityReport"]["finalizeSec"]) == {
        "contour",
        "noseCheck",
        "eyeLimits",
        "expression",
        "upload",
    }


def _coverage(tmp_path, per_frame):
    (tmp_path / "model").mkdir(exist_ok=True)
    (tmp_path / "model" / "view_coverage.json").write_text(
        json.dumps({"per_frame": per_frame}), encoding="utf-8"
    )
    return tmp_path


def test_sfm_angles_pick_the_real_profiles(tmp_path):
    """S15P31B204-666: MediaPipe가 못 찾는 옆모습(얼굴 없음)도 SfM 각도로는 90° 근처다. 그 프레임을 측면 사진으로 고른다."""
    profiles = [
        frame("pl.jpg", None, face=False),
        frame("pr.jpg", None, face=False),
        frame("up.jpg", None, face=False),
    ]
    images = [*SWEEP, *profiles]
    per = {im["file"]: [im["yaw"] * 1.1, 0.0] for im in SWEEP}
    per.update(
        {"pl.jpg": [-88.0, 3.0], "pr.jpg": [86.0, -4.0], "up.jpg": [90.0, 35.0]}
    )  # chin-up is not a profile
    picked, views = w.sfm_captures(w.pick_captures(images), _coverage(tmp_path, per), images)
    assert picked["LEFT"] == "pl.jpg" and picked["RIGHT"] == "pr.jpg"
    assert views["LEFT"] == {"yaw": -88.0, "pitch": 3.0, "by": "sfm"}
    assert views["RIGHT"] == {"yaw": 86.0, "pitch": -4.0, "by": "sfm"}
    assert picked["LEFT_45"] == "v0_00002.jpg"  # -42 * 1.1 = -46.2 is the nearest to -45
    assert views["FRONT"]["by"] == "sfm"


def test_a_side_sfm_got_wrong_keeps_the_mediapipe_pick(tmp_path):
    # seo01 (10-21 run, old SfM masks): the right side registered at 30 deg at most while MediaPipe saw 69 -> RIGHT and RIGHT_45 stay as before
    per = {im["file"]: [min(im["yaw"], 30.0), 0.0] for im in SWEEP}
    before = w.pick_captures(SWEEP)
    picked, views = w.sfm_captures(before, _coverage(tmp_path, per), SWEEP)
    assert picked["RIGHT"] == before["RIGHT"] and views["RIGHT"]["by"] == "mediapipe"
    assert picked["RIGHT_45"] == before["RIGHT_45"] and views["RIGHT_45"]["by"] == "mediapipe"
    assert views["RIGHT"]["yaw"] == 30.0  # what SfM said about the frame MediaPipe chose


def test_front_is_level_not_just_unturned(tmp_path):
    """11/08 원본 6건: yaw만 보면 고개를 숙인·든 프레임(pitch 8~12°, MediaPipe 규칙은 40°)이 정면으로 뽑혔다."""
    per = {im["file"]: [im["yaw"], 0.0] for im in SWEEP}
    front = w.pick_captures(SWEEP)["FRONT"]
    per[front] = [0.0, 12.0]  # unturned but chin up
    per["v0_level.jpg"] = [2.5, -1.0]
    images = [*SWEEP, frame("v0_level.jpg", 2.0)]
    picked, views = w.sfm_captures(w.pick_captures(images), _coverage(tmp_path, per), images)
    assert picked["FRONT"] == "v0_level.jpg"
    assert views["FRONT"] == {"yaw": 2.5, "pitch": -1.0, "by": "sfm"}


@pytest.mark.parametrize(
    "content", [None, "not json", json.dumps({"per_frame": "x"}), json.dumps({"per_frame": {"a": 1}})]
)
def test_no_or_broken_view_coverage_changes_nothing(tmp_path, content):
    if content is not None:
        (tmp_path / "model").mkdir()
        (tmp_path / "model" / "view_coverage.json").write_text(content, encoding="utf-8")
    before = w.pick_captures(SWEEP)
    picked, views = w.sfm_captures(before, tmp_path, SWEEP)
    assert picked == before and {v["by"] for v in views.values()} == {"mediapipe"}


def test_success_reports_how_each_capture_was_chosen(recon, monkeypatch):
    spring = FakeSpring()
    monkeypatch.setattr(w, "build", fake_build(recon))
    run(spring, monkeypatch)
    assert set(spring.result["qualityReport"]["captureViews"]) == set(ANGLES)


def _frames_json(run_dir, names, **extra):
    """tools/glb_frames.py 형식의 합성 model/frames.json(카메라 숫자만, 이미지 없음)."""
    (run_dir / "model").mkdir(parents=True, exist_ok=True)
    frames = [
        {
            "name": n,
            "R": [[1.0, 0.0, 0.0], [0.0, 0.123456789, 0.0], [0.0, 0.0, 1.0]],
            "t": [0.01234567, -0.0, 0.45678912],
            "status": "ok",
            "holdout": False,
            "yaw": 0.0,
            "err_pct": None,
        }
        for n in names
    ]
    data = {
        "world_to_glb": [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
        "camera": {"w": 1080, "h": 1920, "f": 1450.123456, "cx": 540.00004, "cy": 959.99996},
        "frames": frames,
        **extra,
    }
    (run_dir / "model" / "frames.json").write_text(json.dumps(data), encoding="utf-8")


def test_capture_cameras_for_all_five_views_are_rounded(tmp_path):
    captures = w.pick_captures(SWEEP)
    _frames_json(tmp_path, [im["file"] for im in SWEEP])
    got = w.capture_cameras(tmp_path, captures)
    assert got["frame"] == "glb" and got["axes"] == "colmap"
    assert got["camera"] == {"w": 1080, "h": 1920, "f": 1450.1235, "cx": 540.0, "cy": 960.0}
    assert set(got["views"]) == set(ANGLES)
    for v in got["views"].values():
        assert v["R"][1][1] == 0.123457
        assert v["t"] == [0.0123, -0.0, 0.4568]
    assert not any(n in json.dumps(got) for n in captures.values())  # 파일 이름은 넣지 않는다


def test_capture_cameras_without_a_frame_are_null(tmp_path):
    captures = w.pick_captures(SWEEP)
    _frames_json(tmp_path, [n for a, n in captures.items() if a not in ("LEFT", "RIGHT_45")])
    views = w.capture_cameras(tmp_path, captures)["views"]
    assert views["LEFT"] is None and views["RIGHT_45"] is None
    assert all(views[a] for a in ("FRONT", "RIGHT", "LEFT_45"))


def test_capture_camera_with_a_broken_pose_is_null(tmp_path):
    captures = w.pick_captures(SWEEP)
    _frames_json(tmp_path, list(captures.values()))
    data = json.loads((tmp_path / "model" / "frames.json").read_text(encoding="utf-8"))
    data["frames"][0]["t"] = [0.0, 0.0]
    (tmp_path / "model" / "frames.json").write_text(json.dumps(data), encoding="utf-8")
    views = w.capture_cameras(tmp_path, captures)["views"]
    assert sum(v is None for v in views.values()) == 1


@pytest.mark.parametrize(
    "content",
    [None, "not json", json.dumps({"frames": []}), json.dumps({"camera": {"w": 1}, "frames": []})],
)
def test_no_or_broken_frames_json_gives_no_capture_cameras(tmp_path, content):
    if content is not None:
        (tmp_path / "model").mkdir()
        (tmp_path / "model" / "frames.json").write_text(content, encoding="utf-8")
    assert w.capture_cameras(tmp_path, w.pick_captures(SWEEP)) is None


def test_success_reports_capture_cameras_from_frames_json(recon, monkeypatch):
    build = fake_build(recon)

    def with_frames(hb, bundle, job_id):
        run_dir = build(hb, bundle, job_id)
        _frames_json(run_dir, [im["file"] for im in SWEEP])
        return run_dir

    spring = FakeSpring()
    monkeypatch.setattr(w, "build", with_frames)
    run(spring, monkeypatch)
    cams = spring.result["qualityReport"]["captureCameras"]
    assert set(cams["views"]) == set(ANGLES) and all(cams["views"].values())


def test_success_without_frames_json_leaves_capture_cameras_out(recon, monkeypatch):
    spring = FakeSpring()
    monkeypatch.setattr(w, "build", fake_build(recon))
    run(spring, monkeypatch)
    assert spring.result["status"] == "SUCCEEDED"
    assert "captureCameras" not in spring.result["qualityReport"]


def test_3d_생성은_작업_임시_폴더를_TMPDIR로_쓴다(tmp_path, monkeypatch):
    seen = {}

    class FakePopen:
        def __init__(self, cmd, **kwargs):
            seen.update(kwargs)

        def wait(self, timeout=None):
            return 1

    monkeypatch.setattr(w.subprocess, "Popen", FakePopen)
    hb = type("Hb", (), {"proc": None, "set_stage": lambda *a: None, "check": lambda self: None})()
    with pytest.raises(w.JobFailed):  # 결과 GLB가 없으므로 실패로 끝난다
        w.build(hb, tmp_path / "frames.tar", "tmpdir-test-no-such-job")
    assert seen["env"]["TMPDIR"] == str(tmp_path)


def test_작업_중에는_busy로_보내고_끝나면_결과를_지표에_더한다(recon, monkeypatch):
    # S15P31B204-455: Pushgateway로 보내는 지표. 작업 중 여부와 결과·구간 시간
    seen = []

    class FakePusher:
        def set_busy(self, busy):
            seen.append(("busy", busy))

        def record(self, rec):
            seen.append(("record", rec["status"], rec["segments"][0]["name"]))

    monkeypatch.setattr(w, "pusher", FakePusher())
    monkeypatch.setattr(w, "build", fake_build(recon))
    run(FakeSpring(), monkeypatch)
    assert seen == [("busy", True), ("record", "SUCCEEDED", "download"), ("busy", False)]


def test_작업마다_구간_기록을_한_줄_남긴다(recon, monkeypatch, tmp_path):
    spring = FakeSpring()
    monkeypatch.setattr(w, "build", fake_build(recon))
    path = tmp_path / "metrics-1.jsonl"
    monkeypatch.setenv("RECON_METRICS_FILE", str(path))
    run(spring, monkeypatch)
    rec = json.loads(path.read_text(encoding="utf-8"))
    assert rec["jobId"] == JOB and rec["status"] == "SUCCEEDED" and rec["workerId"] == "w1"
    names = [s["name"] for s in rec["segments"]]
    assert names[0] == "download" and names[-3:] == ["finalize", "upload", "report"]
    assert "model" in names  # run_all.json 단계가 작업 폴더를 지우기 전에 읽혔다
    assert not (recon / "work" / JOB).exists()


CONTRACTS = Path(__file__).resolve().parents[3] / "contracts" / "reconstruction"
NOSE_BINDING = {
    "meshSha256": "a" * 64,
    "rigSha256": "b" * 64,
    "fitSha": "synthetic-fit",
    "engine": "synthetic-engine",
    "rigVersion": "v1",
    "topologyVersion": "synthetic-topology",
}
EYE_REVIEW = {"R": "present", "L": "absent"}
EYE_LIMITS = {
    "inline:height": 60.0,
    "inout:height": 100.0,
    "outline:height": 80.0,
    "inner": 100.0,
    "outer": 70.0,
    "lower": 100.0,
    "upper": 40.0,
}


def eye_tool(**changes):
    return {"eligible": True, "meshSha256": "a" * 64, "review": EYE_REVIEW, "limits": EYE_LIMITS, **changes}


def node_tools(eye, calls=None, contour=None, seen=None, nose=None):
    """contour_morphs.py·auto_nose_candidate.mjs·auto_eye_limits.mjs 대역. eye가 예외면 눈 계산이 그 예외로 끝난다.
    contour: None이면 윤곽 도구가 결과 파일을 못 만든 것처럼, bytes면 그 뒤에 붙여 굽고, 예외면 그 예외로 끝난다.
    seen: 코 후보 도구가 읽은 head.glb 바이트를 담는다(승인이 최종 GLB로 계산되는지 확인)."""

    def fake(cmd, **kwargs):
        script = Path(cmd[1]).name
        if calls is not None:
            calls.append(script)
        if script == "contour_morphs.py":
            if isinstance(contour, Exception):
                raise contour
            if contour is not None:
                Path(cmd[3]).write_bytes(Path(cmd[2]).read_bytes() + contour)
            return subprocess.CompletedProcess(cmd, 0, "{}")
        if script == "auto_nose_candidate.mjs":
            if seen is not None:
                seen["glb"] = (Path(cmd[2]) / "head.glb").read_bytes()
            out = nose or {
                "eligible": True,
                "binding": NOSE_BINDING,
                "ranges": {"nose.bridge_height": {"min": -1, "max": 1}},
            }
        elif isinstance(eye, Exception):
            raise eye
        else:
            out = eye
        return subprocess.CompletedProcess(cmd, 0, out if isinstance(out, str) else json.dumps(out))

    return fake


def test_success_reports_eye_approval_bound_to_the_nose_binding(recon, monkeypatch):
    spring = FakeSpring()
    monkeypatch.setattr(w.subprocess, "run", node_tools(eye_tool()))
    monkeypatch.setattr(w, "build", fake_build(recon, eye_review=EYE_REVIEW))
    run(spring, monkeypatch)
    res = spring.result
    assert res["status"] == "SUCCEEDED" and res["eyeReview"] == EYE_REVIEW
    binding = {k: v for k, v in NOSE_BINDING.items() if k != "fitSha"} | {
        "eyePartsSha256": res["eyePartsSha256"]
    }
    assert res["eyeApproval"] == {"schemaVersion": "v1", "binding": binding, "limits": EYE_LIMITS}


@pytest.mark.parametrize(
    "eye",
    [
        eye_tool(eligible=False, reason="eye review missing"),
        eye_tool(meshSha256="c" * 64),  # 다른 GLB를 잼
        eye_tool(review={"R": "absent", "L": "absent"}),  # 다른 판정으로 잼
        eye_tool(limits={"inner": "wide"}),
        "not json",
        subprocess.TimeoutExpired(["node"], 300),
        subprocess.CalledProcessError(1, ["node"]),
    ],
)
def test_eye_limit_failure_keeps_the_model_and_locks_only_the_eyes(recon, monkeypatch, eye):
    spring = FakeSpring()
    monkeypatch.setattr(w.subprocess, "run", node_tools(eye))
    monkeypatch.setattr(w, "build", fake_build(recon, eye_review=EYE_REVIEW))
    run(spring, monkeypatch)
    assert spring.result["status"] == "SUCCEEDED"
    assert spring.result["eyeReview"] == EYE_REVIEW
    assert "eyeApproval" not in spring.result


def test_unsafe_nose_ranges_keep_the_model_and_report_why_the_nose_is_locked(recon, monkeypatch):
    nose = {
        "eligible": False,
        "reason": "limit 0.1: all:-+--- canonicalValid=true skinValid=false selfIntersections=12",
        "tried": [
            {"limit": lim, "at": "all:-+---", "valid": False, "skinValid": False, "selfIntersections": 12}
            for lim in (1, 0.75, 0.5, 0.25, 0.1)
        ],
    }
    spring = FakeSpring()
    mesh = glb(EYE_REVIEW, "a" * 64)
    eye = eye_tool(meshSha256=hashlib.sha256(mesh).hexdigest())
    monkeypatch.setattr(w.subprocess, "run", node_tools(eye, nose=nose))
    monkeypatch.setattr(w, "build", fake_build(recon, eye_review=EYE_REVIEW))
    run(spring, monkeypatch)
    res = spring.result
    assert res["status"] == "SUCCEEDED" and "noseApproval" not in res
    assert res["eyeApproval"]["binding"]["meshSha256"] == hashlib.sha256(mesh).hexdigest()
    assert (
        res["eyeApproval"]["binding"]["rigSha256"] == hashlib.sha256(spring.puts["/put/rig.json"]).hexdigest()
    )
    note = res["qualityReport"]["noseCheck"]
    assert note["eligible"] is False and note["reason"] == nose["reason"]
    assert [t["limit"] for t in note["tried"]] == [1, 0.75, 0.5, 0.25, 0.1]
    assert note["tried"][0] == {
        "limit": 1,
        "at": "all:-+---",
        "valid": False,
        "skinValid": False,
        "selfIntersections": 12,
    }
    assert spring.puts["/put/head.glb"] == mesh


def test_neutral_mesh_failure_still_rejects_the_model(recon, monkeypatch):
    nose = {"eligible": False, "reason": "invalid neutral", "tried": [{"limit": 1, "at": "neutral"}]}
    spring = FakeSpring()
    monkeypatch.setattr(w.subprocess, "run", node_tools(eye_tool(), nose=nose))
    monkeypatch.setattr(w, "build", fake_build(recon))
    run(spring, monkeypatch)
    assert spring.result["status"] == "FAILED"
    assert spring.result["qualityReport"]["noseCheck"]["reason"] == nose["reason"]
    assert not spring.puts


def test_neutral_check_without_nose_protection_keeps_the_unmodified_mesh(recon, monkeypatch):
    nose = {
        "eligible": False,
        "tried": [
            {
                "limit": 1,
                "at": "neutral",
                "skinValid": True,
                "affectedVertices": 0,
                "protectedRegionsPresent": False,
            }
        ],
    }
    spring = FakeSpring()
    monkeypatch.setattr(w.subprocess, "run", node_tools(eye_tool(), nose=nose))
    monkeypatch.setattr(w, "build", fake_build(recon))
    run(spring, monkeypatch)
    assert spring.result["status"] == "SUCCEEDED" and "noseApproval" not in spring.result
    assert spring.result["qualityReport"]["noseCheck"]["tried"][0]["protectedRegionsPresent"] is False


def test_model_without_eye_review_does_not_measure_eye_limits(recon, monkeypatch):
    spring, calls = FakeSpring(), []
    monkeypatch.setattr(w.subprocess, "run", node_tools(eye_tool(), calls))
    monkeypatch.setattr(w, "build", fake_build(recon))
    run(spring, monkeypatch)
    assert spring.result["status"] == "SUCCEEDED"
    assert "eyeApproval" not in spring.result and "eyeReview" not in spring.result
    assert calls == ["contour_morphs.py", "auto_nose_candidate.mjs"]


def test_contour_morphs_are_baked_before_approvals_and_uploaded(recon, monkeypatch):
    spring, calls, seen = FakeSpring(), [], {}
    monkeypatch.setattr(w.subprocess, "run", node_tools(eye_tool(), calls, contour=b"+contour", seen=seen))
    monkeypatch.setattr(w, "build", fake_build(recon, eye_review=EYE_REVIEW))
    run(spring, monkeypatch)
    baked = glb(EYE_REVIEW, "a" * 64) + b"+contour"
    assert spring.result["status"] == "SUCCEEDED"
    # 승인 후보(meshSha256)는 업로드하는 바로 그 GLB로 계산한다
    assert calls[:2] == ["contour_morphs.py", "auto_nose_candidate.mjs"]
    assert seen["glb"] == baked
    assert spring.puts["/put/head.glb"] == baked
    # 눈 판정 메타데이터는 굽기 뒤에도 그대로 읽힌다
    assert spring.result["eyeReview"] == EYE_REVIEW
    assert not (recon / "work" / JOB).exists()


@pytest.mark.parametrize("tool", ["contour_morphs.py", "auto_eye_limits.mjs"])
def test_finalizer_timeout_does_not_leave_recoverable_controls_locked(recon, monkeypatch, tool):
    spring, calls, seen = FakeSpring(), [], {}
    finish = node_tools(eye_tool(), calls, contour=b"+contour", seen=seen)
    attempts = 0

    def run_tool(args, **kwargs):
        nonlocal attempts
        if args[1].endswith(tool):
            attempts += 1
            if attempts == 1:
                if tool == "contour_morphs.py":
                    Path(args[3]).write_bytes(b"partial")
                raise subprocess.TimeoutExpired(args, kwargs["timeout"])
            if tool == "contour_morphs.py":
                assert not Path(args[3]).exists()
        return finish(args, **kwargs)

    monkeypatch.setattr(w.subprocess, "run", run_tool)
    monkeypatch.setattr(w, "build", fake_build(recon, eye_review=EYE_REVIEW))
    run(spring, monkeypatch)

    assert attempts == 2
    assert spring.result["status"] == "SUCCEEDED"
    assert spring.result["eyeApproval"]["limits"]
    assert spring.puts["/put/head.glb"] == glb(EYE_REVIEW, "a" * 64) + b"+contour"


@pytest.mark.parametrize(
    "contour",
    [
        subprocess.CalledProcessError(1, ["python"]),  # 접힌 면이 생겨 도구가 1로 끝남
        subprocess.TimeoutExpired(["python"], 300),
        None,  # 결과 파일 없음
    ],
)
def test_contour_failure_keeps_the_original_glb_and_succeeds(recon, monkeypatch, contour):
    spring = FakeSpring()
    monkeypatch.setattr(w.subprocess, "run", node_tools(eye_tool(), contour=contour))
    monkeypatch.setattr(w, "build", fake_build(recon, eye_review=EYE_REVIEW))
    run(spring, monkeypatch)
    assert spring.result["status"] == "SUCCEEDED"
    assert spring.puts["/put/head.glb"] == glb(EYE_REVIEW, "a" * 64)
    assert "eyeApproval" in spring.result


def test_success_body_uses_only_contract_fields(recon, monkeypatch):
    schema = json.loads((CONTRACTS / "schemas" / "result-request.schema.json").read_text(encoding="utf-8"))
    succeeded = schema["$defs"]["succeeded"]
    spring = FakeSpring()
    monkeypatch.setattr(w.subprocess, "run", node_tools(eye_tool()))
    monkeypatch.setattr(w, "build", fake_build(recon, eye_review=EYE_REVIEW))
    run(spring, monkeypatch)
    res = spring.result
    assert set(succeeded["required"]) <= set(res) <= set(succeeded["properties"])
    approval = succeeded["properties"]["eyeApproval"]
    assert set(approval["required"]) <= set(res["eyeApproval"]) <= set(approval["properties"])
    binding = approval["properties"]["binding"]
    assert set(res["eyeApproval"]["binding"]) == set(binding["required"]) == set(binding["properties"])
    assert set(res["eyeApproval"]["limits"]) <= set(approval["properties"]["limits"]["properties"])


def test_failure_keeps_per_frame_angles_without_images(tmp_path):
    """S15P31B204-663 (계획 S1-5): 원본이 지워져도 실패 원인을 볼 수 있게 프레임별 숫자만 남긴다."""
    assert w.failure_diag(tmp_path) == {}  # nothing written yet
    (tmp_path / "prep").mkdir()
    prep = {
        "videos_in": [{"fps": 30.0}],
        "rejected": {"blur": 4, "eyes_closed": 10},
        "no_face_kept": 2,
        "images": [
            {"file": "v0_input_00060.jpg", "yaw": -61.04, "pitch": 3.0, "face": True},
            {"file": "v0_input_00030.jpg", "yaw": 1.26, "pitch": -2.0, "face": True},
            {"file": "v0_input_00090.jpg", "yaw": None, "pitch": None, "face": False},
        ],
    }
    (tmp_path / "prep" / "prepare.json").write_text(json.dumps(prep), encoding="utf-8")
    (tmp_path / "model").mkdir()
    per = {"v0_input_00030.jpg": [2.04, -1.0], "v0_input_00060.jpg": [-70.36, 2.0]}
    (tmp_path / "model" / "view_coverage.json").write_text(json.dumps({"per_frame": per}), encoding="utf-8")
    model = {"pose_check": "FAIL", "notes": ["x" * 300], "holdout_pct_iod": {"side_35_90": 18.53}}
    _run_all(tmp_path, {"model": model, "lens": {"trials": [{"f": 1559, "slope": 0.72, "sec": 22.4}]}})
    d = w.failure_diag(tmp_path)
    assert d["cols"] == ["tMs", "mpYaw", "mpPitch", "face", "sfmYaw", "sfmPitch"]
    assert d["frames"] == [
        [1000, 1.3, -2.0, 1, 2.0, -1.0],
        [2000, -61.0, 3.0, 1, -70.4, 2.0],
        [3000, None, None, 0, None, None],  # no face, not registered
    ]
    assert d["rejected"] == {"blur": 4.0, "eyes_closed": 10.0} and d["noFaceKept"] == 2
    assert d["lensTrials"] == [{"f": 1559.0, "slope": 0.7, "sec": 22.4}]
    assert d["poseCheck"] == "FAIL" and len(d["notes"][0]) == 200
    assert "jpg" not in json.dumps(d)  # no file names / paths
    assert w.failed_quality(tmp_path, timeoutStage="model")["diag"] == d


def test_quality_report_carries_model_sub_step_seconds(tmp_path):
    _run_all(tmp_path, {"model": {"status": "PASS", "sec": 218.0}})
    # no model/report.json (failed before the model stage)
    assert "modelSec" not in w.quality_report(tmp_path)
    (tmp_path / "model").mkdir()
    (tmp_path / "model" / "report.json").write_text(
        json.dumps(
            {
                "timing_sec": {"gnm_fit": 40.12, "uv_bake": 70.3, "note": "text is dropped"},
                "bake": {"timing_sec": {"frames": 31.04, "flag": True}},
                "gnm_fit": {
                    "timing_sec": {"sil_frames": 10.99, "ears": 4.97},
                    "top_components": [["id_1", 2.1]],
                },
                "eye_parts": {"timing_sec": {"solve_sec": 3.24, "total_sec": 9.8}},
                "sparse": "/work/job/colmap/sparse",
            }
        ),
        encoding="utf-8",
    )
    q = w.quality_report(tmp_path)
    assert q["stageSec"] == {"model": 218.0}
    assert q["modelSec"] == {"gnm_fit": 40.1, "uv_bake": 70.3}
    assert q["bakeSec"] == {"frames": 31.0}
    # S15P31B204-772: gnm_fit·눈 부위 맞춤의 구간 시간만, 얼굴 모양 계수·경로는 넘기지 않는다
    assert q["gnmFitSec"] == {"sil_frames": 11.0, "ears": 5.0}
    assert q["eyePartsSec"] == {"solve_sec": 3.2, "total_sec": 9.8}
    assert "id_1" not in json.dumps(q) and "/work/" not in json.dumps(q)


def test_quality_report_splits_face_and_head(tmp_path):
    """S15P31B204-676 (계획 S4-3): 사진으로 검증되는 얼굴과, 통계 모양으로 채우는 두상을 나눠 남긴다."""
    qa = {
        "status": "FAIL",
        "current": {
            "holdout_lm": 5.627,
            "holdout_line": 1.117,
            "holdout_side": 12.8,
            "crease": {"p95": 0.035},
            "head_ratios": {"crown_h": 0.996, "temple_over_zyg": 1.066, "zyg_over_H": 1.253, "back": 1.006},
        },
    }
    (tmp_path / "run_all.json").write_text(json.dumps({"stages": {}, "qa": qa}), encoding="utf-8")
    q = w.quality_report(tmp_path)
    assert q["face"] == {"holdoutLm": 5.627, "holdoutLine": 1.117, "holdoutSide": 12.8, "creaseP95": 0.035}
    assert q["head"]["ratios"]["back"] == 1.006
    assert q["head"]["outOfRange"] == ["back"]  # min01 (11/08): back 1.006 < 1.063 (0.5 %)
    _run_all(tmp_path, {})  # no qa (failed before it)
    assert "face" not in w.quality_report(tmp_path) and "head" not in w.quality_report(tmp_path)


@pytest.mark.parametrize("recon_args", [None, "--no-lm --select-prefer gnm"])
def test_build_always_asks_for_service_outputs_only(tmp_path, monkeypatch, recon_args):
    """S15P31B204-761: the worker run skips outputs nobody reads (eye colour, gray qa picture) even when
    RECON_ARGS is overridden"""
    if recon_args is None:
        monkeypatch.delenv("RECON_ARGS", raising=False)
    else:
        monkeypatch.setenv("RECON_ARGS", recon_args)
    seen = {}

    class Stop(Exception):
        pass

    def popen(cmd, **kw):
        seen["cmd"] = cmd
        raise Stop

    class Hb:
        proc = None

        def set_stage(self, *a):
            pass

    monkeypatch.setattr(w.subprocess, "Popen", popen)
    with pytest.raises(Stop):
        w.build(Hb(), tmp_path / "frames.tar", "job")
    assert seen["cmd"][-1] == "--service"
    assert "--no-lm" in seen["cmd"]


def _flaky(fails, status=200, body=b"synthetic bundle"):
    """MockTransport that raises a connection error `fails` times, then answers"""
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if len(calls) <= fails:
            raise httpx.ConnectError("refused", request=request)
        return httpx.Response(status, content=body)

    return httpx.Client(transport=httpx.MockTransport(handler)), calls


def test_bundle_download_retries_connection_errors(tmp_path):
    # S15P31B204-766: a ConnectError right after extraction no longer sends the job back
    client, calls = _flaky(2)
    waits = []
    w.download(client, "https://s3.example/bundle.tar", tmp_path / "frames.tar", sleep=waits.append)
    assert (tmp_path / "frames.tar").read_bytes() == b"synthetic bundle"
    assert len(calls) == 3
    assert waits == list(RETRY_DELAYS)


def test_bundle_download_gives_up_after_three_connection_errors(tmp_path):
    client, calls = _flaky(5)
    with pytest.raises(httpx.ConnectError):
        w.download(client, "https://s3.example/bundle.tar", tmp_path / "frames.tar", sleep=lambda s: None)
    assert len(calls) == 3


def test_bundle_download_does_not_retry_an_http_error(tmp_path):
    client, calls = _flaky(0, status=403)
    with pytest.raises(httpx.HTTPStatusError):
        w.download(client, "https://s3.example/bundle.tar", tmp_path / "frames.tar", sleep=lambda s: None)
    assert len(calls) == 1


def expression_tool(made=True, calls=None):
    """rig_expression.py 대역(그 밖의 도구는 코 후보만 맞게 돌려준다). made: True면 표정 리그를 쓰고, False면 파일 없이 끝나고,
    예외면 그 예외로 끝난다. calls: 불린 도구 이름을 담는다"""

    def fake(cmd, **kwargs):
        script = Path(cmd[1]).name
        if calls is not None:
            calls.append(script)
        if script == "rig_expression.py":
            if isinstance(made, Exception):
                raise made
            if made:
                Path(cmd[5]).write_text(json.dumps({"format": "live-mirror-rig"}), encoding="utf-8")
            return subprocess.CompletedProcess(cmd, 0, '{"components": 180}')
        return subprocess.CompletedProcess(
            cmd, 0, json.dumps({"eligible": True, "binding": NOSE_BINDING, "ranges": {}})
        )

    return fake


def test_expression_rig_is_uploaded_beside_the_rig_and_reported(recon, monkeypatch):
    spring = FakeSpring(expression=True)
    monkeypatch.setattr(w.subprocess, "run", expression_tool())
    monkeypatch.setattr(w, "build", fake_build(recon))
    run(spring, monkeypatch)
    res = spring.result
    assert res["status"] == "SUCCEEDED"
    assert res["expressionObjectKey"] == PREFIX + "expression.json"
    assert json.loads(spring.puts["/put/expression.json"])["format"] == "live-mirror-rig"
    # rig.json은 그대로 올라간다(코·눈 승인이 그 해시로 묶여 있다)
    assert json.loads(spring.puts["/put/rig.json"])["nose"]["engine"] == "v1"


def test_old_backend_without_expression_url_does_not_build_it(recon, monkeypatch):
    spring, calls = FakeSpring(), []
    monkeypatch.setattr(w.subprocess, "run", expression_tool(calls=calls))
    monkeypatch.setattr(w, "build", fake_build(recon))
    run(spring, monkeypatch)
    assert spring.result["status"] == "SUCCEEDED"
    assert "expressionObjectKey" not in spring.result
    assert "rig_expression.py" not in calls


@pytest.mark.parametrize(
    "made",
    [
        subprocess.CalledProcessError(1, ["python"]),  # rig에 GNM 표정 성분이 없다 등
        subprocess.TimeoutExpired(["python"], 120),
        False,  # 끝났는데 파일이 없다
    ],
)
def test_expression_rig_failure_keeps_the_model_without_expression(recon, monkeypatch, made):
    spring = FakeSpring(expression=True)
    monkeypatch.setattr(w.subprocess, "run", expression_tool(made))
    monkeypatch.setattr(w, "build", fake_build(recon))
    run(spring, monkeypatch)
    assert spring.result["status"] == "SUCCEEDED"
    assert "expressionObjectKey" not in spring.result
    assert "/put/expression.json" not in spring.puts
