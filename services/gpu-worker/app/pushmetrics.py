"""워커 지표를 EC2 Pushgateway로 보낸다(S15P31B204-455 2단계). 숫자와 워커·서버 이름만 넣는다(작업 ID·얼굴 데이터·경로 없음).

- 보낼 곳: METRICS_PUSH_URL(run-worker.sh·ssafy-gpu.sh가 GPU 터널의 지표 포트로, EC2 추출 워커는 compose가 http://pushgateway:9091로 준다).
  없으면 보내지 않는다. 보내지 못해도 작업은 계속한다(경고는 10분에 한 번).
- PUSH_INTERVAL초마다 이 워커의 그룹(job=preface_worker, kind, worker)을 통째로 바꿔 쓴다(PUT). 끝날 때 그룹을 지운다.
  Pushgateway는 마지막 값을 들고 있으므로 화면·알림은 push_time_seconds로 오래된 그룹을 거른다(docs/guides/ec2-server.md 모니터링).
- 주기 값: 작업 중 여부, 이 워커 GPU의 사용률·메모리, 이 워커가 속한 cgroup(Pod 컨테이너 또는 SSAFY 사용자 세션)의 CPU·메모리
  (메모리는 파일 캐시를 포함한 값과 캐시를 뺀 working set 둘 다).
  cgroup·GPU 값은 같은 서버의 워커가 모두 같은 값을 보낸다(화면은 서버별 최댓값을 쓴다).
- 작업마다: 결과별 건수, 1건 시간 분포, 구간별 시간 분포·CPU 초(metrics.Meter.finish의 한 줄에서 만든다).
"""

import logging
import os
import socket
import threading
import time
from pathlib import Path

import httpx

from app.metrics import gpu

log = logging.getLogger("pushmetrics")

PUSH_INTERVAL = 60.0
WARN_EVERY = 600.0
JOB_BUCKETS = (60, 120, 180, 240, 300, 360, 450, 600, 900, 1800)
SEGMENT_BUCKETS = (1, 2, 5, 10, 20, 30, 60, 90, 120, 180, 240, 300, 450, 600)
SERVERS = ("runpod", "ssafy", "ec2")
CGROUP_ROOT = Path("/sys/fs/cgroup")


def server_of(worker: str) -> str:
    """워커 ID 앞부분(runpod-…, ssafy-…, ec2-…). api의 WorkerPresence와 같은 규칙이다."""
    prefix = worker.split("-", 1)[0]
    return prefix if prefix in SERVERS else "other"


class Histogram:
    def __init__(self, buckets: tuple[float, ...]):
        self.buckets, self.counts, self.sum, self.count = buckets, [0] * len(buckets), 0.0, 0

    def observe(self, value: float) -> None:
        for i, le in enumerate(self.buckets):
            if value <= le:
                self.counts[i] += 1
        self.sum += value
        self.count += 1


def _cgroup_dir(root: Path = CGROUP_ROOT, self_cgroup: Path = Path("/proc/self/cgroup")) -> Path | None:
    """이 프로세스의 cgroup 폴더. v2는 "0::<경로>" 한 줄, v1은 cpuacct·memory가 따로라 None(v1은 _cgroup_v1이 본다)."""
    try:
        lines = self_cgroup.read_text().splitlines()
    except OSError:
        return None
    for line in lines:
        if line.startswith("0::"):
            d = root / line[3:].lstrip("/")
            return d if (d / "cpu.stat").exists() else None
    return None


def _memory_stat(path: Path, key: str) -> int | None:
    """memory.stat의 한 항목(바이트). 없거나 읽지 못하면 None."""
    try:
        for line in path.read_text().splitlines():
            k, _, value = line.partition(" ")
            if k == key:
                return int(value)
    except (OSError, ValueError):
        pass
    return None


def _working_set(out: dict, inactive_file: int | None) -> None:
    """메모리에서 커널이 바로 비울 수 있는 파일 캐시(inactive_file)를 뺀 값. Kubernetes·cAdvisor의 working set과 같다.
    memory.current에는 최근에 읽은 파일 캐시가 들어가 실제 부담보다 크게 보인다(2026-11-06 SSAFY 17GiB 중 16GiB가 캐시)."""
    if "memory_bytes" in out and inactive_file is not None:
        out["memory_working_set_bytes"] = max(0, out["memory_bytes"] - inactive_file)


def cgroup_usage(root: Path = CGROUP_ROOT, self_cgroup: Path = Path("/proc/self/cgroup")) -> dict:
    """cgroup의 CPU 누적 초·할당 코어·메모리(캐시 포함, 캐시 뺀 working set, 바이트). 읽지 못한 값은 빠진다."""
    out: dict = {}
    d = _cgroup_dir(root, self_cgroup)
    if d is not None:
        try:
            for line in (d / "cpu.stat").read_text().splitlines():
                key, _, value = line.partition(" ")
                if key == "usage_usec":
                    out["cpu_seconds"] = int(value) / 1e6
        except (OSError, ValueError):
            pass
        try:
            quota, period = (d / "cpu.max").read_text().split()
            if quota != "max":
                out["quota_cores"] = int(quota) / int(period)
        except (OSError, ValueError):
            pass
        try:
            out["memory_bytes"] = int((d / "memory.current").read_text())
        except (OSError, ValueError):
            pass
        _working_set(out, _memory_stat(d / "memory.stat", "inactive_file"))
        return out
    # cgroup v1(일부 RunPod Secure Pod). 컨테이너 안이라 루트가 곧 Pod다
    try:
        out["cpu_seconds"] = int((root / "cpuacct" / "cpuacct.usage").read_text()) / 1e9
    except (OSError, ValueError):
        pass
    try:
        quota = int((root / "cpu" / "cpu.cfs_quota_us").read_text())
        period = int((root / "cpu" / "cpu.cfs_period_us").read_text())
        if quota > 0:
            out["quota_cores"] = quota / period
    except (OSError, ValueError):
        pass
    try:
        out["memory_bytes"] = int((root / "memory" / "memory.usage_in_bytes").read_text())
    except (OSError, ValueError):
        pass
    # v1은 하위 cgroup까지 합친 total_ 항목을 쓴다(usage_in_bytes도 하위를 포함한다)
    _working_set(out, _memory_stat(root / "memory" / "memory.stat", "total_inactive_file"))
    return out


def _labels(**kv: str) -> str:
    return "{" + ",".join(f'{k}="{v}"' for k, v in kv.items()) + "}"


class Pusher:
    """워커 하나의 지표. set_busy·record는 작업 스레드가, push는 보내기 스레드가 부른다."""

    def __init__(
        self, url: str, kind: str, worker: str, client: httpx.Client | None = None, *, with_gpu: bool = True
    ):
        self.group = f"{url.rstrip('/')}/metrics/job/preface_worker/kind/{kind}/worker/{worker}"
        self.kind, self.worker, self.with_gpu = kind, worker, with_gpu
        self.base = {"server": server_of(worker), "host": socket.gethostname()}
        self.client = client or httpx.Client(timeout=10)
        self.lock = threading.Lock()
        self.busy = False
        self.jobs: dict[str, int] = {}
        self.job_seconds = Histogram(JOB_BUCKETS)
        self.segment_seconds: dict[str, Histogram] = {}
        self.segment_cpu: dict[str, float] = {}
        self.hourly_cost = os.environ.get("WORKER_HOURLY_COST_USD")
        self.stop = threading.Event()
        self._last_warn = 0.0

    @classmethod
    def from_env(cls, kind: str, worker: str, *, with_gpu: bool = True) -> "Pusher | None":
        url = os.environ.get("METRICS_PUSH_URL", "").strip()
        return cls(url, kind, worker, with_gpu=with_gpu) if url else None

    def set_busy(self, busy: bool) -> None:
        with self.lock:
            self.busy = busy

    def record(self, rec: dict) -> None:
        """metrics.Meter.finish가 만든 한 줄(status·totalSec·segments)을 더한다."""
        with self.lock:
            status = str(rec.get("status") or "ERROR")
            self.jobs[status] = self.jobs.get(status, 0) + 1
            if isinstance(rec.get("totalSec"), (int, float)):
                self.job_seconds.observe(float(rec["totalSec"]))
            for seg in rec.get("segments") or []:
                name, sec = seg.get("name"), seg.get("sec")
                if not isinstance(name, str) or not isinstance(sec, (int, float)):
                    continue
                self.segment_seconds.setdefault(name, Histogram(SEGMENT_BUCKETS)).observe(float(sec))
                if isinstance(seg.get("cpuSec"), (int, float)):
                    self.segment_cpu[name] = self.segment_cpu.get(name, 0.0) + float(seg["cpuSec"])

    def render(self) -> str:
        """Prometheus 텍스트 형식."""
        b = self.base
        lines = [
            "# TYPE preface_worker_busy gauge",
            f"preface_worker_busy{_labels(**b)} {1 if self.busy else 0}",
        ]
        if self.hourly_cost:
            try:
                lines.append(f"preface_worker_hourly_cost_usd{_labels(**b)} {float(self.hourly_cost)}")
            except ValueError:
                pass
        g = gpu() if self.with_gpu else None
        if g is not None:
            lines.append(f"preface_worker_gpu_utilization_percent{_labels(**b)} {g[0]}")
            lines.append(f"preface_worker_gpu_memory_used_bytes{_labels(**b)} {g[1] * 2**20}")
        cg = cgroup_usage()
        if "cpu_seconds" in cg:
            lines.append(f"preface_worker_cgroup_cpu_seconds_total{_labels(**b)} {cg['cpu_seconds']:.3f}")
        if "quota_cores" in cg:
            lines.append(f"preface_worker_cgroup_cpu_quota_cores{_labels(**b)} {cg['quota_cores']:.2f}")
        if "memory_bytes" in cg:
            lines.append(f"preface_worker_cgroup_memory_bytes{_labels(**b)} {cg['memory_bytes']}")
        if "memory_working_set_bytes" in cg:
            lines.append(
                f"preface_worker_cgroup_memory_working_set_bytes{_labels(**b)} {cg['memory_working_set_bytes']}"
            )
        with self.lock:
            lines.append("# TYPE preface_worker_jobs_total counter")
            for status, n in sorted(self.jobs.items()):
                lines.append(f"preface_worker_jobs_total{_labels(**b, status=status)} {n}")
            # 같은 이름(TYPE)은 한 번만, 그 줄들은 한데 모아 쓴다(텍스트 형식 규칙. 어기면 Pushgateway가 거절한다)
            if self.job_seconds.count:
                lines.append("# TYPE preface_worker_job_seconds histogram")
                lines += self._histogram("preface_worker_job_seconds", self.job_seconds, b)
            if self.segment_seconds:
                lines.append("# TYPE preface_worker_segment_seconds histogram")
            for name, h in sorted(self.segment_seconds.items()):
                lines += self._histogram("preface_worker_segment_seconds", h, {**b, "segment": name})
            if self.segment_cpu:
                lines.append("# TYPE preface_worker_segment_cpu_seconds_total counter")
            for name, cpu in sorted(self.segment_cpu.items()):
                lines.append(
                    f"preface_worker_segment_cpu_seconds_total{_labels(**b, segment=name)} {cpu:.1f}"
                )
        return "\n".join(lines) + "\n"

    @staticmethod
    def _histogram(name: str, h: Histogram, labels: dict) -> list[str]:
        out = []
        for le, n in zip(h.buckets, h.counts):
            out.append(f"{name}_bucket{_labels(**labels, le=str(le))} {n}")
        out.append(f"{name}_bucket{_labels(**labels, le='+Inf')} {h.count}")
        out.append(f"{name}_sum{_labels(**labels)} {h.sum:.1f}")
        out.append(f"{name}_count{_labels(**labels)} {h.count}")
        return out

    def push(self) -> bool:
        try:
            r = self.client.put(self.group, content=self.render().encode())
            r.raise_for_status()
            return True
        except Exception as e:  # noqa: BLE001 - 지표 실패가 작업을 막지 않는다
            now = time.monotonic()
            if not self._last_warn or now - self._last_warn >= WARN_EVERY:
                self._last_warn = now
                log.warning("metrics push failed (%s); jobs keep running", type(e).__name__)
            return False

    def start(self, interval: float = PUSH_INTERVAL) -> "Pusher":
        def loop() -> None:
            while True:
                self.push()
                if self.stop.wait(interval):
                    return

        threading.Thread(target=loop, name="metrics-push", daemon=True).start()
        return self

    def close(self) -> None:
        """보내기를 멈추고 이 워커의 그룹을 지운다(꺼진 워커가 화면에 남지 않게)."""
        self.stop.set()
        try:
            self.client.delete(self.group)
        except Exception as e:  # noqa: BLE001 - 지우지 못하면 push_time_seconds로 걸러진다
            log.info("metrics group not deleted (%s)", type(e).__name__)
