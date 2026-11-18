"""reconstruction/pipeline/parallel.py: per-frame work side by side, results in input order (S15P31B204-702)."""

import importlib.util
import os
import sys
from pathlib import Path

import pytest

_spec = importlib.util.spec_from_file_location(
    "parallel", Path(__file__).resolve().parents[1] / "reconstruction" / "pipeline" / "parallel.py"
)
parallel = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(parallel)


def test_workers_follow_the_bake_knob_then_the_job_threads(monkeypatch):
    monkeypatch.setenv("OMP_NUM_THREADS", "7")
    monkeypatch.setenv("LM_BAKE_WORKERS", "6")
    assert parallel.workers() == 6
    assert parallel.workers(3) == 3
    monkeypatch.setenv("LM_BAKE_WORKERS", "0")
    assert parallel.workers(10) == 1
    monkeypatch.delenv("LM_BAKE_WORKERS")
    assert parallel.workers() == 7  # the worker's per-job thread budget
    monkeypatch.delenv("OMP_NUM_THREADS")
    assert parallel.workers() == 4


def test_thread_map_keeps_the_input_order(monkeypatch):
    monkeypatch.setenv("LM_BAKE_WORKERS", "4")
    assert parallel.thread_map(lambda x: x * x, range(20)) == [x * x for x in range(20)]


@pytest.mark.skipif(not hasattr(os, "fork"), reason="fork only (Linux GPU servers)")
def test_fork_map_runs_a_closure_in_other_processes_and_keeps_the_order(monkeypatch):
    monkeypatch.setenv("LM_BAKE_WORKERS", "3")
    # registered as the pipeline imports it: the pool sends _run by name
    monkeypatch.setitem(sys.modules, "parallel", parallel)
    offset = 1000  # a closure: the children get it by fork, not by pickling
    out = parallel.fork_map(lambda x: (x + offset, os.getpid()), range(30))
    assert [v for v, _ in out] == [x + offset for x in range(30)]
    assert {pid for _, pid in out} - {os.getpid()}  # really ran elsewhere
    assert parallel._JOB is None


def test_one_item_or_one_worker_runs_the_plain_loop(monkeypatch):
    monkeypatch.setenv("LM_BAKE_WORKERS", "1")
    assert parallel.fork_map(lambda x: (x, os.getpid()), [1, 2]) == [(1, os.getpid()), (2, os.getpid())]
    monkeypatch.setenv("LM_BAKE_WORKERS", "4")
    assert parallel.fork_map(lambda x: os.getpid(), [5]) == [os.getpid()]
