"""서명 URL에서 파일 받기. 추출 워커(원본 영상)와 GPU 워커(프레임 묶음)가 같이 쓴다.

연결 수준의 실패(연결 거부·끊김·시간 초과)는 2초·5초 뒤 다시 받는다. HTTP 오류 상태(만료된 서명 URL 403, 404)는 다시 해도 같으므로 바로
올린다. 2026-11-10 부스에서 RunPod 워커가 묶음을 받다 ConnectError 2건으로 작업 재시도 기회를 썼다(S15P31B204-766, -594).
서명 URL은 로그에 남기지 않는다(예외 종류만).
"""

import logging
import time
from pathlib import Path

import httpx

log = logging.getLogger("download")

RETRY_DELAYS = (2.0, 5.0)


def download(client: httpx.Client, url: str, dest: Path, what: str = "file", sleep=time.sleep) -> None:
    for i, delay in enumerate((0.0, *RETRY_DELAYS)):
        if delay:
            sleep(delay)
        try:
            with client.stream("GET", url) as r:
                r.raise_for_status()
                with dest.open("wb") as f:
                    for chunk in r.iter_bytes(1 << 20):
                        f.write(chunk)
            return
        except httpx.TransportError as e:
            if i == len(RETRY_DELAYS):
                raise
            log.warning("%s download %s, try %d", what, type(e).__name__, i + 1)
