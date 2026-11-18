"""Per-frame / per-candidate work side by side, with the same results as the serial loop (S15P31B204-702).

A 3D job used ~4 of its 7-8 cores on average: many sub-steps walk the frames (or a search grid) one by one in Python.
  workers(n)          how many at once: LM_BAKE_WORKERS if set, else the job's thread budget OMP_NUM_THREADS (the GPU
                      worker sets it per job: CPU quota / workers on a pod, 8 on the shared SSAFY server), else 4
  thread_map(fn, xs)  threads - for work that spends its time in OpenCV / NumPy / MediaPipe / SciPy (they release the GIL)
  fork_map(fn, xs)    forked processes - for work that is a Python loop (the GIL keeps threads on one core). fn may be
                      a closure: the children inherit it and the inputs by fork, only the results are pickled back
Both return the results in input order; the caller combines them in that order, so sums and "first best" picks are the
same as before. Where fork is not available (Windows) fork_map runs the plain loop.
"""
import os

_JOB = None   # (fn, items) inherited by the forked children


def workers(n=None):
    w = os.environ.get("LM_BAKE_WORKERS") or os.environ.get("OMP_NUM_THREADS") or "4"
    w = max(1, int(w))
    return max(1, min(w, n)) if n else w


def thread_map(fn, items):
    items = list(items)
    if len(items) < 2 or workers(len(items)) < 2:
        return [fn(x) for x in items]
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(workers(len(items))) as pool:
        return list(pool.map(fn, items))


def _run(i):
    fn, items = _JOB
    return fn(items[i])


def fork_map(fn, items):
    global _JOB
    import multiprocessing as mp
    items = list(items)
    w = workers(len(items))
    if len(items) < 2 or w < 2 or "fork" not in mp.get_all_start_methods():
        return [fn(x) for x in items]
    _JOB = (fn, items)
    try:
        with mp.get_context("fork").Pool(w) as pool:
            return pool.map(_run, range(len(items)), chunksize=max(1, len(items) // (4 * w)))
    finally:
        _JOB = None
