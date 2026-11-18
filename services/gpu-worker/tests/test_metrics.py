"""app/metrics.py: 작업 1건의 구간별 시간·CPU 기록(S15P31B204-445). 합성 값만 쓴다."""

import json
import time

from app import metrics
from app.metrics import Meter


def test_3d_생성_기록은_run_all_단계로_나누고_나머지를_build_other로_둔다(tmp_path):
    m = Meter(interval=60)
    m.lap("build")
    t0 = time.time()
    time.sleep(0.05)
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    stages = {
        "prepare": {"sec": 0.0},  # 묶음에서 온 단계: 기록하지 않는다
        "sfm": {"sec": 2.0, "cpu_sec": 10.0, "started": t0},
        "model": {"sec": 1.0, "cpu_sec": 0.8, "started": t0 + 2.0},
    }
    (run_dir / "run_all.json").write_text(json.dumps({"stages": stages}), encoding="utf-8")
    for name in ("finalize", "upload", "report"):
        m.lap(name)
    path = tmp_path / "metrics.jsonl"
    m.finish(str(path), "job-1", "w1", "SUCCEEDED", None, run_dir)
    rec = json.loads(path.read_text(encoding="utf-8"))
    names = [s["name"] for s in rec["segments"]]
    assert names == ["download", "sfm", "model", "build_other", "finalize", "upload", "report"]
    sfm = rec["segments"][1]
    assert sfm["cpuSec"] == 10.0 and sfm["coresAvg"] == 5.0
    assert rec["jobId"] == "job-1" and rec["status"] == "SUCCEEDED" and rec["kind"] == "reconstruction"
    assert rec["totalSec"] >= 0.05
    assert str(tmp_path) not in path.read_text(encoding="utf-8")  # 경로·얼굴 데이터는 남기지 않는다


def test_파일이_없으면_남기지_않고_기록만_돌려준다(tmp_path):
    m = Meter(interval=60)
    m.lap("extract")
    rec = m.finish(None, "job-2", "ec2", "FAILED", "QUALITY_NO_FACE", kind="extraction")
    assert [s["name"] for s in rec["segments"]] == ["download", "extract"]
    assert rec["failCode"] == "QUALITY_NO_FACE" and rec["kind"] == "extraction"
    assert list(tmp_path.iterdir()) == []


def test_GPU는_CUDA_VISIBLE_DEVICES의_첫_번호만_읽는다(monkeypatch):
    # SSAFY GPU 서버: 0번은 다른 팀이 쓰고 워커는 1번만 쓴다. nvidia-smi는 이 변수를 따르지 않는다(S15P31B204-455)
    calls = []
    monkeypatch.setattr(metrics.shutil, "which", lambda name: "/usr/bin/nvidia-smi")
    monkeypatch.setattr(
        metrics.subprocess,
        "run",
        lambda args, **kw: calls.append(args) or metrics.subprocess.CompletedProcess(args, 0, "37, 2048\n"),
    )
    monkeypatch.setenv("CUDA_VISIBLE_DEVICES", "1")
    assert metrics.gpu() == (37, 2048)
    assert calls[-1][1:3] == ["-i", "1"]
    monkeypatch.delenv("CUDA_VISIBLE_DEVICES")
    metrics.gpu()
    assert "-i" not in calls[-1]
