"""GPU 서버 성능 측정. 공용 서버에서 우리 GPU가 제 성능을 내는지 본다.

터미널에서 실행한다 (JupyterHub > New > Terminal, conda 환경 활성화 후):
    python bench.py                 # 배정 GPU 1번, 3회 반복 측정 (약 1분)
    python bench.py --check-only    # GPU 번호 지정이 맞는지만 확인
    python bench.py --json ~/bench/$(date +%m%d-%H%M).json   # 결과 저장 (시간대별 비교용)

측정 항목
    - 행렬곱 속도(TFLOPS): FP32, TF32, BF16, FP16 → GPU 연산 성능
    - GPU 메모리 복사 속도(GB/s) → 메모리 대역폭
    - CPU↔GPU 전송 속도(GB/s) → PCIe 대역폭
    - 같은 GPU를 쓰는 다른 프로세스, 측정 중 사용률·전력·클럭, 서버 CPU 부하

자세한 사용법: docs/guides/gpu-server.md
"""
import argparse
import json
import os
import statistics
import subprocess
import sys
import threading
import time
import unicodedata

ASSIGNED_GPU = 1  # SSAFY가 배정한 우리 팀 GPU 번호 (nvidia-smi 번호)

# H200 NVL 공식 사양 (희소성 제외 값). 실측은 보통 이보다 낮다.
H200_NVL_SPEC = {
    "matmul_fp32_tflops": 60,
    "matmul_tf32_tflops": 417,
    "matmul_bf16_tflops": 835,
    "matmul_fp16_tflops": 835,
    "device_copy_gbps": 4800,
}


def pad(text, width, right=False):
    """한글은 두 칸을 차지하므로 화면 폭 기준으로 맞춘다."""
    gap = width - sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in text)
    return (" " * gap + text) if right else (text + " " * gap)


def parse_args():
    p = argparse.ArgumentParser(description="공용 GPU 서버 성능 측정")
    p.add_argument("--gpu", type=int, default=ASSIGNED_GPU, help=f"측정할 nvidia-smi GPU 번호 (기본 {ASSIGNED_GPU})")
    p.add_argument("--rounds", type=int, default=3, help="전체 측정 반복 횟수 (기본 3)")
    p.add_argument("--quick", action="store_true", help="작은 크기로 빠르게 측정 (작은 GPU 시험용)")
    p.add_argument("--check-only", action="store_true", help="GPU 번호 지정만 확인하고 끝낸다")
    p.add_argument("--json", help="결과를 JSON 파일로 저장할 경로")
    return p.parse_args()


def select_gpu(gpu):
    """torch를 import하기 전에 GPU 번호를 고정한다. 이미 다른 번호로 지정돼 있으면 멈춘다."""
    current = os.environ.get("CUDA_VISIBLE_DEVICES")
    if current is not None and current != str(gpu):
        sys.exit(f"CUDA_VISIBLE_DEVICES가 이미 '{current}'로 지정돼 있다. --gpu {gpu}와 다르다. 확인 후 다시 실행한다.")
    if "torch" in sys.modules and sys.modules["torch"].cuda.is_initialized():
        sys.exit("이 프로세스에서 이미 CUDA를 쓰고 있어 GPU 번호 지정이 적용되지 않는다. 터미널에서 새로 실행한다.")
    os.environ["CUDA_DEVICE_ORDER"] = "PCI_BUS_ID"
    os.environ["CUDA_VISIBLE_DEVICES"] = str(gpu)


def smi(*args):
    try:
        out = subprocess.run(["nvidia-smi", *args], capture_output=True, text=True, timeout=10)
        return out.stdout.strip() if out.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""


def smi_rows(query, kind="gpu"):
    fields = query.split(",")
    text = smi(f"--query-{kind}={query}", "--format=csv,noheader,nounits")
    return [dict(zip(fields, (v.strip() for v in line.split(",")))) for line in text.splitlines() if line.strip()]


def norm_uuid(u):
    return str(u).lower().removeprefix("gpu-")


GPU_STATE = "index,uuid,name,utilization.gpu,memory.used,memory.total,power.draw,power.limit,clocks.sm,clocks.max.sm,temperature.gpu"


def gpu_state(uuid):
    return next((r for r in smi_rows(GPU_STATE) if norm_uuid(r["uuid"]) == uuid), None)


def owner_of(pid):
    try:
        out = subprocess.run(["ps", "-o", "user=", "-p", str(pid)], capture_output=True, text=True, timeout=5)
        return out.stdout.strip() or "?"
    except (OSError, subprocess.TimeoutExpired):
        return "?"


def other_processes(uuid):
    rows = smi_rows("gpu_uuid,pid,used_memory", kind="compute-apps")
    return [
        {"pid": int(r["pid"]), "user": owner_of(r["pid"]), "memory_mib": r["used_memory"]}
        for r in rows
        if norm_uuid(r["gpu_uuid"]) == uuid and r["pid"].isdigit() and int(r["pid"]) != os.getpid()
    ]


class Sampler(threading.Thread):
    """측정하는 동안 0.5초마다 사용률·전력·클럭을 기록한다. 전력 제한에 걸려 클럭이 떨어지는지 본다."""

    def __init__(self, uuid):
        super().__init__(daemon=True)
        self.uuid, self.samples, self.stop = uuid, [], threading.Event()

    def run(self):
        while not self.stop.is_set():
            s = gpu_state(self.uuid)
            if s:
                self.samples.append(s)
            self.stop.wait(0.5)

    def summary(self):
        def nums(key):
            return [float(s[key]) for s in self.samples if s.get(key, "").replace(".", "", 1).isdigit()]

        power, clock, util = nums("power.draw"), nums("clocks.sm"), nums("utilization.gpu")
        return {
            "samples": len(self.samples),
            "power_max_w": max(power, default=None),
            "sm_clock_median_mhz": statistics.median(clock) if clock else None,
            "util_median_pct": statistics.median(util) if util else None,
        }


def timed(torch, fn, min_seconds, warmup=3):
    """fn 1회 평균 시간(초). 빠른 GPU에서 측정이 너무 짧아 흔들리지 않도록 min_seconds 이상 돌 때까지 반복 횟수를 늘린다."""
    for _ in range(warmup):
        fn()
    torch.cuda.synchronize()
    start, end = torch.cuda.Event(enable_timing=True), torch.cuda.Event(enable_timing=True)
    iters = 1
    while True:
        start.record()
        for _ in range(iters):
            fn()
        end.record()
        end.synchronize()
        sec = start.elapsed_time(end) / 1000
        if sec >= min_seconds:
            return sec / iters
        iters = max(iters * 2, int(iters * min_seconds / max(sec, 1e-6) * 1.2))


def set_tf32(torch, enabled):
    matmul = torch.backends.cuda.matmul
    if hasattr(matmul, "fp32_precision"):
        matmul.fp32_precision = "tf32" if enabled else "ieee"
    else:
        matmul.allow_tf32 = enabled


def bench_matmul(torch, dtype, n, min_seconds, tf32=False):
    set_tf32(torch, tf32)
    a = torch.randn(n, n, device="cuda", dtype=dtype)
    b = torch.randn(n, n, device="cuda", dtype=dtype)
    c = torch.empty(n, n, device="cuda", dtype=dtype)
    per = timed(torch, lambda: torch.mm(a, b, out=c), min_seconds)
    del a, b, c
    return 2 * n**3 / per / 1e12


def bench_device_copy(torch, nbytes, min_seconds):
    x = torch.empty(nbytes, dtype=torch.uint8, device="cuda")
    y = torch.empty_like(x)
    per = timed(torch, lambda: y.copy_(x), min_seconds)
    del x, y
    return 2 * nbytes / per / 1e9  # 읽기 + 쓰기


def bench_transfer(torch, nbytes, min_seconds, to_device):
    host = torch.empty(nbytes, dtype=torch.uint8, pin_memory=True)
    dev = torch.empty(nbytes, dtype=torch.uint8, device="cuda")
    fn = (lambda: dev.copy_(host, non_blocking=True)) if to_device else (lambda: host.copy_(dev, non_blocking=True))
    per = timed(torch, fn, min_seconds)
    del host, dev
    return nbytes / per / 1e9


def run_round(torch, quick):
    n = 4096 if quick else 8192
    big = (256 if quick else 2048) * 2**20
    xfer = (128 if quick else 1024) * 2**20
    t = 0.2 if quick else 1.0  # 항목마다 최소 측정 시간(초)
    return {
        "matmul_fp32_tflops": bench_matmul(torch, torch.float32, n, t),
        "matmul_tf32_tflops": bench_matmul(torch, torch.float32, n, t, tf32=True),
        "matmul_bf16_tflops": bench_matmul(torch, torch.bfloat16, n, t),
        "matmul_fp16_tflops": bench_matmul(torch, torch.float16, n, t),
        "device_copy_gbps": bench_device_copy(torch, big, t),
        "host_to_device_gbps": bench_transfer(torch, xfer, t, to_device=True),
        "device_to_host_gbps": bench_transfer(torch, xfer, t, to_device=False),
    }


LABELS = {
    "matmul_fp32_tflops": ("행렬곱 FP32", "TFLOPS"),
    "matmul_tf32_tflops": ("행렬곱 TF32", "TFLOPS"),
    "matmul_bf16_tflops": ("행렬곱 BF16", "TFLOPS"),
    "matmul_fp16_tflops": ("행렬곱 FP16", "TFLOPS"),
    "device_copy_gbps": ("GPU 메모리 복사", "GB/s"),
    "host_to_device_gbps": ("CPU→GPU 전송", "GB/s"),
    "device_to_host_gbps": ("GPU→CPU 전송", "GB/s"),
}


def main():
    args = parse_args()
    select_gpu(args.gpu)
    import torch  # GPU 번호를 고정한 뒤에 import한다

    if not torch.cuda.is_available():
        indexes = [r["index"] for r in smi_rows("index")]
        if indexes and str(args.gpu) not in indexes:
            sys.exit(f"{args.gpu}번 GPU가 없다. 이 서버의 GPU 번호: {', '.join(indexes)} (nvidia-smi -L로 확인)")
        sys.exit("CUDA를 쓸 수 없다. conda 환경과 PyTorch CUDA 빌드(cu126)를 확인한다.")

    props = torch.cuda.get_device_properties(0)
    uuid = norm_uuid(props.uuid)
    state = gpu_state(uuid)
    smi_index = state["index"] if state else "?"

    print("== GPU 지정 확인")
    print(f"PyTorch {torch.__version__} (CUDA {torch.version.cuda}), 보이는 GPU {torch.cuda.device_count()}개")
    print(f"프로그램 안의 cuda:0 = nvidia-smi {smi_index}번 GPU ({props.name}, {props.total_memory / 2**30:.0f}GiB)")
    if str(smi_index) != str(args.gpu):
        sys.exit(f"지정한 {args.gpu}번이 아니라 {smi_index}번 GPU가 잡혔다. 측정을 멈춘다.")
    print(f"→ 정상: {args.gpu}번 GPU만 보인다")

    others = other_processes(uuid)
    load = os.getloadavg()[0] if hasattr(os, "getloadavg") else None
    print("\n== 측정 전 상태")
    if state:
        print(f"사용률 {state['utilization.gpu']}%, 메모리 {state['memory.used']}/{state['memory.total']} MiB, "
              f"전력 {state['power.draw']}/{state['power.limit']} W, SM 클럭 {state['clocks.sm']}/{state['clocks.max.sm']} MHz, "
              f"온도 {state['temperature.gpu']}°C")
    print(f"같은 GPU의 다른 프로세스: {len(others)}개" + "".join(
        f"\n  - PID {o['pid']} ({o['user']}) {o['memory_mib']} MiB" for o in others))
    if load is not None:
        print(f"서버 CPU 부하(1분 평균): {load:.1f} / 코어 {os.cpu_count()}개")

    if args.check_only:
        return

    print(f"\n== 측정 ({args.rounds}회 반복{', 빠른 모드' if args.quick else ''})")
    sampler = Sampler(uuid)
    sampler.start()
    rounds = []
    for i in range(args.rounds):
        t = time.time()
        rounds.append(run_round(torch, args.quick))
        print(f"{i + 1}회차 완료 ({time.time() - t:.0f}초)")
    sampler.stop.set()
    sampler.join()
    during = sampler.summary()

    is_h200 = "H200" in props.name
    print("\n" + pad("항목", 16) + pad("중앙값", 10, True) + pad("최소~최대", 18, True) + pad("편차", 7, True)
          + "  단위" + ("     사양 대비" if is_h200 else ""))
    summary = {}
    for key, (label, unit) in LABELS.items():
        vals = [r[key] for r in rounds]
        med = statistics.median(vals)
        spread = (max(vals) - min(vals)) / med * 100 if med else 0
        summary[key] = {"median": med, "min": min(vals), "max": max(vals), "spread_pct": spread}
        line = (pad(label, 16) + f"{med:>10.1f}" + f"{f'{min(vals):.1f}~{max(vals):.1f}':>18}"
                + f"{spread:>6.0f}%" + f"  {unit:<7}")
        if is_h200 and key in H200_NVL_SPEC:
            ratio = med / H200_NVL_SPEC[key] * 100
            summary[key]["spec_pct"] = ratio
            line += f"  {ratio:>5.0f}%"
        print(line)
    print(f"\n측정 중: 최대 전력 {during['power_max_w']} W, SM 클럭 중앙값 {during['sm_clock_median_mhz']} MHz, "
          f"사용률 중앙값 {during['util_median_pct']}%")

    print("\n== 해석")
    hints = []
    if others:
        hints.append(f"다른 프로세스 {len(others)}개가 같은 GPU를 쓰고 있다 → GPU를 나눠 쓰는 중이다")
    if any(v["spread_pct"] > 10 for v in summary.values()):
        hints.append("회차 간 차이가 10%를 넘는 항목이 있다 → 측정 중 다른 작업과 경쟁했을 수 있다")
    if is_h200 and summary["matmul_bf16_tflops"].get("spec_pct", 100) < 50:
        hints.append("BF16 행렬곱이 사양의 50% 미만이다 → 다른 팀 작업이나 전력 제한으로 느려졌을 수 있다")
    if load is not None and load > os.cpu_count() * 0.7:
        hints.append("서버 CPU 부하가 높다 → 데이터 읽기·전처리가 느릴 수 있다")
    print("\n".join(f"- {h}" for h in hints) or "- 경쟁 징후 없음. 시간을 바꿔 몇 번 더 재서 비교한다")

    if args.json:
        path = os.path.expanduser(args.json)
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        result = {
            "time": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "gpu": {"index": smi_index, "name": props.name, "torch": torch.__version__, "cuda": torch.version.cuda},
            "before": state, "other_processes": others, "cpu_load_1m": load,
            "during": during, "summary": summary, "rounds": rounds,
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"\n결과 저장: {path}")


if __name__ == "__main__":
    main()
