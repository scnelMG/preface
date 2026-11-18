"""하위 프로세스 트리 끝내기(S15P31B204-448).

워커는 3D 생성·프레임 추출을 하위 프로세스로 돌리고, 그 프로세스가 다시 run_all.py·COLMAP을 띄운다.
시간 초과 때 바로 아래 프로세스만 죽이면 자손이 계속 돌면서 워커가 지운 작업 폴더·임시 폴더에 다시 파일(얼굴 데이터)을 쓴다.
프로세스 그룹을 따로 만들지 않는 이유: run-worker.sh stop이 워커 그룹을 통째로 끄는데, 그룹을 나누면 3D 생성이 남는다.
"""

import os
import signal
import subprocess


def descendants(pid: int) -> list[int]:
    """pid의 자손 프로세스(Linux /proc 기준, 없으면 빈 목록). 부모가 먼저 나온다."""
    kids: dict[int, list[int]] = {}
    try:
        names = os.listdir("/proc")
    except OSError:
        return []
    for name in names:
        if not name.isdigit():
            continue
        try:
            with open(f"/proc/{name}/stat") as f:
                ppid = int(f.read().rsplit(")", 1)[1].split()[1])
        except (OSError, ValueError, IndexError):
            continue
        kids.setdefault(ppid, []).append(int(name))
    out, i = list(kids.get(pid, [])), 0
    while i < len(out):
        out += kids.get(out[i], [])
        i += 1
    return out


def kill_tree(proc: subprocess.Popen) -> None:
    """proc과 자손을 모두 SIGKILL로 끝내고 proc을 거둔다. 자손 목록을 먼저 모아, 부모가 죽어 고아가 된 자손도 놓치지 않는다."""
    if proc.poll() is None:
        sig = getattr(signal, "SIGKILL", None)
        for pid in descendants(proc.pid) if sig else []:
            try:
                os.kill(pid, sig)
            except (ProcessLookupError, PermissionError):
                pass
        proc.kill()
    proc.wait()
