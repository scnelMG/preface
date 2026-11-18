"""app/proctree.py: 시간 초과 때 하위 프로세스의 자손까지 끝내는지(S15P31B204-448). 합성 프로세스만 쓴다."""

import os
import subprocess
import sys
import time

import pytest

from app.proctree import descendants, kill_tree

CHILD = (
    "import subprocess, sys, time; p = subprocess.Popen(['sleep', '60']); "
    "print(p.pid, flush=True); time.sleep(60)"
)


def gone(pid):
    """끝났으면 True. 거둘 부모가 없어 좀비(Z)로 남은 것도 끝난 것이다"""
    try:
        with open(f"/proc/{pid}/stat") as f:
            return f.read().rsplit(")", 1)[1].split()[0] == "Z"
    except OSError:
        return True


@pytest.mark.skipif(not os.path.isdir("/proc"), reason="자손 찾기는 Linux /proc 기준")
def test_자손_프로세스까지_끝낸다():
    # 자식 Python이 손자(sleep)를 띄우고 그 pid를 알린다
    child = subprocess.Popen(
        [sys.executable, "-c", CHILD],
        stdout=subprocess.PIPE,
        text=True,
    )
    grandchild = int(child.stdout.readline())
    assert grandchild in descendants(child.pid)
    kill_tree(child)
    assert child.returncode is not None
    for _ in range(50):
        if gone(grandchild):
            break
        time.sleep(0.1)
    else:
        pytest.fail("손자 프로세스가 남았다")


def test_이미_끝난_프로세스도_오류_없이_거둔다():
    p = subprocess.Popen([sys.executable, "-c", "pass"])
    p.wait()
    kill_tree(p)
    assert p.returncode == 0
