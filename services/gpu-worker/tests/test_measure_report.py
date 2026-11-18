"""runpod/measure-report.py: 워커 기록·DB 시각을 작업 ID로 합쳐 HTML 한 장을 만드는지(S15P31B204-445). 합성 값만 쓴다."""

import importlib.util
import json
import sys
from pathlib import Path

RUNPOD = Path(__file__).resolve().parents[1] / "runpod"
_spec = importlib.util.spec_from_file_location("measure_report", RUNPOD / "measure-report.py")
mr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mr)

JOB = "7b0e4c2d-9f1a-4e3b-8c5d-2a6f1e9b3c40"


def seg(name, sec, cpu=None, **kw):
    return {"name": name, "sec": sec, "cpuSec": cpu, "coresAvg": cpu / sec if cpu else None, **kw}


def test_보고서는_DB_구간과_추출_3D_세부_구간을_한_장에_합친다(tmp_path, monkeypatch):
    gpu = {
        "jobId": JOB,
        "status": "SUCCEEDED",
        "segments": [
            seg("download", 1.0, 0.2),
            seg("sfm", 34.0, 197.5, coresPeak=26.0, gpuUtilMax=84, gpuMemMaxMb=1870),
            seg("model", 166.0, 767.0),
            seg("build_other", 2.0, 1.0),
            seg("finalize", 3.0, 2.0),
            seg("upload", 4.0, 0.5),
            seg("report", 0.5, 0.1),
        ],
    }
    (tmp_path / "metrics-1.jsonl").write_text(json.dumps(gpu) + "\n{broken\n", encoding="utf-8")
    ext = {
        "jobId": JOB,
        "status": "SUCCEEDED",
        "kind": "extraction",
        "segments": [seg("download", 2.0), seg("extract", 38.0, 70.0)],
    }
    (tmp_path / "extractor.log").write_text(
        "2026-10-29 INFO extractor started\n2026-10-29 INFO extractor job metrics " + json.dumps(ext) + "\n",
        encoding="utf-8",
    )
    (tmp_path / "jobs.tsv").write_text(
        "jobId\tstatus\turl_issued_at\tuploaded_at\tcreated_at\textract_claimed_at\tframes_ready_at\tstarted_at\tfinished_at\tduration_ms\n"
        f"{JOB}\tSUCCEEDED\t2026-10-29 10:00:00\t2026-10-29 10:01:12\t2026-10-29 10:01:13\t2026-10-29 10:01:15\t"
        "2026-10-29 10:01:55\t2026-10-29 10:01:57\t2026-10-29 10:05:51\t234000\n",
        encoding="utf-8",
    )
    out = tmp_path / "report.html"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "measure-report.py",
            "--gpu",
            str(tmp_path / "metrics-1.jsonl"),
            "--extract",
            str(tmp_path / "extractor.log"),
            "--db",
            str(tmp_path / "jobs.tsv"),
            "-o",
            str(out),
        ],
    )
    mr.main()
    page = out.read_text(encoding="utf-8")
    assert "프레임 추출 (EC2)" in page and "3D 생성 (RunPod)" in page and "미측정" in page
    assert "<td>SfM</td><td>1</td><td>34.0</td>" in page  # 단계 이름·건수·초
    assert "<td>전체(URL 발급 → 결과 보고)</td><td>1</td><td>351.0</td>" in page
    assert "3D SfM 34.0초" in page and "추출 프레임 고르기 38.0초" in page  # 막대가 세부 구간으로 나뉜다
    assert str(tmp_path) not in page


def test_백분위수는_nearest_rank다():
    assert mr.pct([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5) == 5
    assert mr.pct([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9) == 9
    assert mr.pct([None], 0.5) is None
