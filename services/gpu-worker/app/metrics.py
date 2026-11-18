"""작업 1건의 구간별 시간·CPU·메모리·GPU 기록(S15P31B204-445). 숫자와 작업 ID만 넣는다(얼굴 데이터·경로·URL 없음).

- GPU 워커: 작업마다 RECON_METRICS_FILE(run-worker.sh가 logs/<환경>/metrics-<번호>.jsonl로 준다)에 JSON 한 줄을 붙인다
- 추출 워커: 같은 형식을 로그에 "job metrics {...}" 한 줄로 남긴다(EC2 docker 로그)
모아서 보는 법: runpod/measure-report.py

3D 생성 구간: download(묶음 받기·체크섬) → build(3D 생성: run_all 단계 sfm·lens·model·viewer + build_other(묶음 풀기 등))
→ finalize(코 편집 검증) → upload(결과 올리기) → report(결과 보고)
- CPU 코어·초: 3D 단계는 run_all.json의 cpu_sec(단계 프로그램의 실제 CPU), 나머지는 워커 스레드 + 하위 프로그램의 CPU
- 최대 코어·메모리: 3D 생성 프로세스 트리를 interval초마다 잰 값(/proc, Linux만)
- GPU: nvidia-smi로 잰 GPU 전체 값이라, 같은 Pod의 다른 워커 작업이 섞일 수 있다(최대값만 남긴다)
"""

import json
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

INTERVAL = 2.0  # GPU 특징점 추출은 3~6초라 5초 간격으로는 놓친다(2026-10-29 Pod A)
STAGES = ("sfm", "lens", "model", "viewer")  # model은 dense(있으면)를 포함한다


def child_cpu() -> float:
    """끝난 하위 프로그램들의 CPU 초 누계(Windows는 0)."""
    try:
        import resource
    except ImportError:
        return 0.0
    r = resource.getrusage(resource.RUSAGE_CHILDREN)
    return r.ru_utime + r.ru_stime


def tree_usage(root: int) -> tuple[float, int] | None:
    """root 프로세스 트리의 누적 CPU 초(자신 + 거둔 자식)와 RSS 합(바이트). /proc이 없으면 None."""
    tick, page = os.sysconf("SC_CLK_TCK"), os.sysconf("SC_PAGE_SIZE")
    table = {}
    try:
        names = os.listdir("/proc")
    except OSError:
        return None
    for name in names:
        if not name.isdigit():
            continue
        try:
            with open(f"/proc/{name}/stat") as f:
                fields = f.read().rsplit(")", 1)[1].split()
        except (OSError, IndexError):
            continue
        table[int(name)] = (int(fields[1]), sum(int(x) for x in fields[11:15]) / tick, int(fields[21]) * page)
    kids: dict[int, list[int]] = {}
    for pid, (ppid, _, _) in table.items():
        kids.setdefault(ppid, []).append(pid)
    todo, cpu, rss = [root], 0.0, 0
    while todo:
        pid = todo.pop()
        if pid in table:
            cpu += table[pid][1]
            rss += table[pid][2]
            todo += kids.get(pid, [])
    return cpu, rss


def visible_gpu() -> str | None:
    """이 워커가 쓰는 GPU 번호(CUDA_VISIBLE_DEVICES의 첫 값). nvidia-smi는 이 변수를 따르지 않아 직접 넘긴다.
    SSAFY GPU 서버는 GPU 1번만 쓰고 0번은 다른 팀이 쓴다(S15P31B204-535). 없거나 숫자가 아니면 None(첫 GPU)."""
    first = os.environ.get("CUDA_VISIBLE_DEVICES", "").split(",")[0].strip()
    return first if first.isdigit() else None


def gpu() -> tuple[int, int] | None:
    """이 워커 GPU의 사용률(%)·메모리(MiB). nvidia-smi가 없으면 None."""
    if not shutil.which("nvidia-smi"):
        return None
    index = visible_gpu()
    try:
        out = subprocess.run(
            [
                "nvidia-smi",
                *(["-i", index] if index else []),
                "--query-gpu=utilization.gpu,memory.used",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        ).stdout
        util, mem = out.splitlines()[0].split(",")
        return int(util), int(mem)
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None


class Meter:
    """process()가 구간 경계에서 lap()을 부르고 끝에 finish()로 한 줄을 남긴다. 샘플은 별도 스레드가 모은다."""

    def __init__(self, proc_of=lambda: None, interval: float = INTERVAL):
        self.proc_of, self.interval = proc_of, interval
        self.laps: list[dict] = []
        self.samples: list[tuple[float, float | None, int | None, int | None, int | None]] = []
        self.done = threading.Event()
        self._open("download")
        threading.Thread(target=self._sample, daemon=True).start()

    def _open(self, name: str) -> None:
        self.cur = {"name": name, "start": time.time(), "thread": time.thread_time(), "child": child_cpu()}

    def lap(self, name: str) -> None:
        """지금 구간을 닫고 name 구간을 연다."""
        c = self.cur
        cpu = time.thread_time() - c["thread"] + child_cpu() - c["child"]
        self.laps.append({"name": c["name"], "start": c["start"], "end": time.time(), "cpu": cpu})
        self._open(name)

    def _sample(self) -> None:
        while not self.done.wait(self.interval):
            proc = self.proc_of()
            tree = tree_usage(proc.pid) if proc is not None and proc.poll() is None else None
            g = gpu()
            self.samples.append((time.time(), *(tree if tree else (None, None)), *(g if g else (None, None))))

    def _window(self, start: float, end: float) -> dict:
        """구간 안 샘플의 최대 코어·메모리·GPU."""
        rows = [s for s in self.samples if start < s[0] <= end]
        peak, prev = None, None
        for s in self.samples:
            if s[1] is not None and prev is not None and prev[1] is not None and start < s[0] <= end:
                peak = max(peak or 0.0, (s[1] - prev[1]) / (s[0] - prev[0]))
            prev = s
        pick = lambda i: max((s[i] for s in rows if s[i] is not None), default=None)
        rss = pick(2)
        return {
            "coresPeak": round(peak, 1) if peak is not None else None,
            "rssMaxGb": round(rss / 2**30, 2) if rss is not None else None,
            "gpuUtilMax": pick(3),
            "gpuMemMaxMb": pick(4),
        }

    def segments(self, stages: dict) -> list[dict]:
        out = []
        for lap in self.laps:
            sec = lap["end"] - lap["start"]
            if lap["name"] != "build":
                out.append(self._seg(lap["name"], lap["start"], sec, lap["cpu"]))
                continue
            done_sec = done_cpu = 0.0  # build은 run_all 단계로 나누고 나머지를 build_other로 둔다
            for name in STAGES:
                st = stages.get(name)
                if not isinstance(st, dict) or "sec" not in st:
                    continue
                cpu = st.get("cpu_sec")
                out.append(self._seg(name, st.get("started", lap["start"]), st["sec"], cpu))
                done_sec += st["sec"]
                done_cpu += cpu or 0.0
            out.append(
                self._seg(
                    "build_other", lap["start"], max(0.0, sec - done_sec), max(0.0, lap["cpu"] - done_cpu)
                )
            )
        return out

    def _seg(self, name: str, start: float, sec: float, cpu: float | None) -> dict:
        return {
            "name": name,
            "sec": round(sec, 1),
            "cpuSec": round(cpu, 1) if cpu is not None else None,
            "coresAvg": round(cpu / sec, 2)
            if cpu is not None and sec >= 0.5
            else None,  # 아주 짧은 구간은 평균이 튄다
            **self._window(start, start + sec),
        }

    def finish(
        self,
        path: str | None,
        job_id: str,
        worker: str,
        status: str,
        code: str | None,
        run_dir: Path | None = None,
        kind: str = "reconstruction",
    ) -> dict:
        """마지막 구간을 닫고 한 줄을 만든다. path가 있으면 붙여 쓴다. run_dir(run_all.json)는 지우기 전에 읽는다."""
        self.lap("_end")
        self.done.set()
        try:
            stages = json.loads((run_dir / "run_all.json").read_text(encoding="utf-8")).get("stages", {})
        except (OSError, ValueError, TypeError):
            stages = {}
        segs = self.segments(stages)
        total = self.laps[-1]["end"] - self.laps[0]["start"]
        rec = {
            "v": 1,
            "kind": kind,
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "jobId": job_id,
            "workerId": worker,
            "status": status,
            "failCode": code,
            "threads": int(os.environ.get("OMP_NUM_THREADS") or 0) or None,
            "totalSec": round(total, 1),
            "cpuSec": round(sum(s["cpuSec"] or 0 for s in segs), 1),
            "segments": segs,
        }
        if path:
            try:
                with open(path, "a", encoding="utf-8") as f:
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            except OSError:
                pass  # 기록 실패가 작업을 막지 않는다
        return rec
