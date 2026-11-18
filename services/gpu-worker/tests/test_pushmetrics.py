"""워커 지표 보내기(S15P31B204-455 2단계)."""

import httpx
import pytest

from app import pushmetrics as pm

REC = {
    "status": "SUCCEEDED",
    "totalSec": 250.0,
    "segments": [
        {"name": "download", "sec": 1.5, "cpuSec": 0.4},
        {"name": "sfm", "sec": 70.0, "cpuSec": 400.0},
        {"name": "model", "sec": 95.0, "cpuSec": None},
    ],
}


@pytest.fixture(autouse=True)
def no_gpu(monkeypatch):
    monkeypatch.setattr(pm, "gpu", lambda: None)


def pusher(handler=None, worker="ssafy-jupyter10-prod-1"):
    client = httpx.Client(transport=httpx.MockTransport(handler or (lambda r: httpx.Response(200))))
    return pm.Pusher("http://127.0.0.1:19091/", "gpu", worker, client)


def samples(text: str) -> dict[str, float]:
    return {
        line.rsplit(" ", 1)[0]: float(line.rsplit(" ", 1)[1])
        for line in text.splitlines()
        if line and not line.startswith("#")
    }


def test_작업_결과와_구간_시간을_누적해_히스토그램으로_낸다():
    p = pusher()
    p.record(REC)
    p.record({**REC, "status": "FAILED", "totalSec": 700.0})
    s = samples(p.render())
    base = 'server="ssafy",host="' + p.base["host"] + '"'
    assert s[f'preface_worker_jobs_total{{{base},status="SUCCEEDED"}}'] == 1
    assert s[f'preface_worker_jobs_total{{{base},status="FAILED"}}'] == 1
    assert s[f'preface_worker_job_seconds_bucket{{{base},le="300"}}'] == 1
    assert s[f'preface_worker_job_seconds_bucket{{{base},le="+Inf"}}'] == 2
    assert s[f"preface_worker_job_seconds_count{{{base}}}"] == 2
    assert s[f'preface_worker_segment_seconds_bucket{{{base},segment="sfm",le="90"}}'] == 2
    assert s[f'preface_worker_segment_cpu_seconds_total{{{base},segment="sfm"}}'] == 800
    # CPU를 모르는 구간은 시간만 센다
    assert f'preface_worker_segment_cpu_seconds_total{{{base},segment="model"}}' not in s


def test_같은_이름의_TYPE은_한_번만_쓴다():
    p = pusher()
    p.record(REC)
    types = [line for line in p.render().splitlines() if line.startswith("# TYPE")]
    assert len(types) == len(set(types))


def test_작업_중이면_busy가_1이다():
    p = pusher()
    p.set_busy(True)
    assert any(
        line.startswith("preface_worker_busy{") and line.endswith(" 1") for line in p.render().splitlines()
    )
    p.set_busy(False)
    assert any(
        line.startswith("preface_worker_busy{") and line.endswith(" 0") for line in p.render().splitlines()
    )


def test_워커_그룹_주소로_통째로_바꿔_쓰고_끝나면_지운다():
    calls = []
    p = pusher(lambda r: calls.append((r.method, r.url.path)) or httpx.Response(200))
    assert p.push()
    p.close()
    path = "/metrics/job/preface_worker/kind/gpu/worker/ssafy-jupyter10-prod-1"
    assert calls == [("PUT", path), ("DELETE", path)]


def test_보내지_못해도_예외를_내지_않는다(caplog):
    def down(request):
        raise httpx.ConnectError("refused", request=request)

    p = pusher(down)
    assert p.push() is False
    assert p.push() is False
    # 경고는 10분에 한 번
    assert sum("metrics push failed" in r.getMessage() for r in caplog.records) == 1


def test_주소가_없으면_만들지_않는다(monkeypatch):
    monkeypatch.delenv("METRICS_PUSH_URL", raising=False)
    assert pm.Pusher.from_env("gpu", "runpod-x-prod-1") is None


@pytest.mark.parametrize(
    ("worker", "server"),
    [
        ("runpod-k73g-prod-2", "runpod"),
        ("ssafy-jupyter10-extractor-1", "ssafy"),
        ("ec2-prod-extractor", "ec2"),
        ("lab-1", "other"),
    ],
)
def test_워커_ID_앞부분으로_서버를_정한다(worker, server):
    assert pm.server_of(worker) == server


def test_cgroup_v2에서_CPU_할당과_메모리를_읽는다(tmp_path):
    d = tmp_path / "cg" / "user.slice"
    d.mkdir(parents=True)
    (d / "cpu.stat").write_text("usage_usec 2500000\nuser_usec 1\n")
    (d / "cpu.max").write_text("800000 100000\n")
    (d / "memory.current").write_text("1048576\n")
    me = tmp_path / "self"
    me.write_text("0::/user.slice\n")
    assert pm.cgroup_usage(tmp_path / "cg", me) == {
        "cpu_seconds": 2.5,
        "quota_cores": 8.0,
        "memory_bytes": 1048576,
    }


def test_cgroup_v1은_컨테이너_루트를_읽는다(tmp_path):
    (tmp_path / "cpuacct").mkdir()
    (tmp_path / "cpu").mkdir()
    (tmp_path / "memory").mkdir()
    (tmp_path / "cpuacct" / "cpuacct.usage").write_text("3000000000\n")
    (tmp_path / "cpu" / "cpu.cfs_quota_us").write_text("3100000\n")
    (tmp_path / "cpu" / "cpu.cfs_period_us").write_text("100000\n")
    (tmp_path / "memory" / "memory.usage_in_bytes").write_text("2048\n")
    me = tmp_path / "self"
    me.write_text("12:cpu,cpuacct:/\n")
    assert pm.cgroup_usage(tmp_path, me) == {"cpu_seconds": 3.0, "quota_cores": 31.0, "memory_bytes": 2048}


def test_cgroup_v2_working_set은_비울_수_있는_파일_캐시를_뺀다(tmp_path):
    # 2026-11-06 SSAFY 실측 모양: 17GiB 중 16GiB가 inactive_file(최근에 읽은 파일 캐시)
    d = tmp_path / "cg" / "system.slice" / "jupyter-k15b204.service"
    d.mkdir(parents=True)
    (d / "cpu.stat").write_text("usage_usec 1\n")
    (d / "cpu.max").write_text("max 100000\n")
    (d / "memory.current").write_text(f"{17 * 2**30}\n")
    (d / "memory.stat").write_text(
        f"anon {2**29}\nfile {16 * 2**30}\nactive_file 1\ninactive_file {16 * 2**30}\n"
    )
    me = tmp_path / "self"
    me.write_text("0::/system.slice/jupyter-k15b204.service\n")
    got = pm.cgroup_usage(tmp_path / "cg", me)
    assert got["memory_bytes"] == 17 * 2**30
    assert got["memory_working_set_bytes"] == 2**30
    assert "quota_cores" not in got


def test_cgroup_v1_working_set은_하위_합계_항목을_쓰고_음수가_되지_않는다(tmp_path):
    (tmp_path / "memory").mkdir()
    (tmp_path / "memory" / "memory.usage_in_bytes").write_text("1000\n")
    (tmp_path / "memory" / "memory.stat").write_text("inactive_file 10\ntotal_inactive_file 1500\n")
    me = tmp_path / "self"
    me.write_text("12:cpu,cpuacct:/\n")
    got = pm.cgroup_usage(tmp_path, me)
    assert got["memory_bytes"] == 1000
    assert got["memory_working_set_bytes"] == 0


def test_working_set을_보낸다(monkeypatch):
    monkeypatch.setattr(pm, "gpu", lambda: None)
    monkeypatch.setattr(pm, "cgroup_usage", lambda: {"memory_bytes": 300, "memory_working_set_bytes": 100})
    lines = pusher().render().splitlines()
    assert any(l.startswith("preface_worker_cgroup_memory_bytes{") and l.endswith(" 300") for l in lines)
    assert any(
        l.startswith("preface_worker_cgroup_memory_working_set_bytes{") and l.endswith(" 100") for l in lines
    )


def test_GPU_값은_바이트로_보낸다(monkeypatch):
    monkeypatch.setattr(pm, "gpu", lambda: (85, 4096))
    text = pusher().render()
    assert any(
        line.startswith("preface_worker_gpu_utilization_percent{") and line.endswith(" 85")
        for line in text.splitlines()
    )
    assert any(
        line.endswith(f" {4096 * 2**20}") for line in text.splitlines() if "gpu_memory_used_bytes" in line
    )
