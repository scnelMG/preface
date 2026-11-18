"""강제 종료로 남은 작업 폴더 정리(S15P31B204-595).

워커는 작업이 끝나면 얼굴 데이터(프레임·마스크·GLB·사진·원본 영상)를 지운다. 하지만 SIGKILL·Jupyter 세션 종료·OOM·Pod 재시작으로
꺼지면 그 정리가 돌지 않아 폴더가 남는다. 그래서 워커가 시작할 때와 일이 없을 때 한 시간마다, 오래된 남은 폴더를 지운다.

한 호스트의 워커 여러 개가 같은 폴더를 쓰므로 "지금 하는 작업"을 지우면 안 된다. 그래서 나이로 거른다. 작업 하나는 3D 생성 상한
(RECON_TIMEOUT_SEC 1800초)과 결과 보고 재시도(약 5분) 안에 끝나므로, 마지막으로 바뀐 지 MAX_AGE_SEC가 지난 폴더는 남은 것이다.
로그에는 지운 개수만 남긴다.
"""

import logging
import re
import shutil
import tempfile
import time
from collections.abc import Callable, Iterable
from pathlib import Path

log = logging.getLogger(__name__)

MAX_AGE_SEC = 2 * 3600
SWEEP_EVERY_SEC = 3600
JOB_ID = r"[0-9a-f-]{36}"


def temp_root(env_dir: str | None) -> Path:
    """작업별 임시 폴더를 만드는 곳(환경 변수가 없으면 시스템 임시 폴더)."""
    return Path(env_dir) if env_dir else Path(tempfile.gettempdir())


def matching(folder: Path, pattern: str) -> list[Path]:
    """folder 바로 아래에서 이름이 pattern에 통째로 맞는 것. 폴더가 없으면 빈 목록."""
    try:
        return [p for p in folder.iterdir() if re.fullmatch(pattern, p.name)]
    except OSError:
        return []


def sweep(paths: Iterable[Path], max_age_sec: float = MAX_AGE_SEC, now: float | None = None) -> int:
    """마지막으로 바뀐 지 max_age_sec가 지난 것만 지운다. 지운 개수."""
    now = time.time() if now is None else now
    removed = 0
    for path in paths:
        try:
            if now - path.lstat().st_mtime < max_age_sec:
                continue
            if path.is_dir() and not path.is_symlink():
                shutil.rmtree(path)
            else:
                path.unlink()
            removed += 1
        except OSError as e:  # 다른 워커가 먼저 지웠거나 권한 문제. 다음 정리에서 다시 본다
            log.warning("leftover cleanup skipped one: %s", type(e).__name__)
    return removed


class Sweeper:
    """targets()가 돌려준 후보를 처음 부를 때와 그 뒤 SWEEP_EVERY_SEC마다 정리한다."""

    def __init__(self, name: str, targets: Callable[[], Iterable[Path]]):
        self.name, self.targets, self.last = name, targets, float("-inf")

    def maybe(self, now: float | None = None) -> int:
        now = time.monotonic() if now is None else now
        if now - self.last < SWEEP_EVERY_SEC:
            return 0
        self.last = now
        removed = sweep(self.targets())
        if removed:
            log.info("%s leftovers removed: %d", self.name, removed)
        return removed
