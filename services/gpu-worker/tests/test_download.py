"""app/download.py: 서명 URL 받기의 연결 오류 재시도(S15P31B204-766, -594). 합성 데이터만 쓴다."""

import httpx
import pytest

from app import download as d


def flaky(fails, status=200, body=b"synthetic"):
    """MockTransport: 연결 오류를 fails번 낸 뒤 답한다"""
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if len(calls) <= fails:
            raise httpx.ConnectError("refused", request=request)
        return httpx.Response(status, content=body)

    return httpx.Client(transport=httpx.MockTransport(handler)), calls


def test_연결_오류는_2초_5초_뒤_다시_받는다(tmp_path, caplog):
    client, calls = flaky(2)
    waits = []
    d.download(client, "https://storage.example.invalid/x?sig=secret", tmp_path / "f", "video", waits.append)
    assert (tmp_path / "f").read_bytes() == b"synthetic"
    assert len(calls) == 3
    assert waits == list(d.RETRY_DELAYS)
    assert "sig=secret" not in caplog.text  # 서명 URL은 로그에 남기지 않는다


def test_세_번_모두_연결_오류면_그대로_올린다(tmp_path):
    client, calls = flaky(5)
    with pytest.raises(httpx.ConnectError):
        d.download(client, "https://storage.example.invalid/x", tmp_path / "f", sleep=lambda s: None)
    assert len(calls) == 3


def test_HTTP_오류는_다시_받지_않는다(tmp_path):
    client, calls = flaky(0, status=403)
    with pytest.raises(httpx.HTTPStatusError):
        d.download(client, "https://storage.example.invalid/x", tmp_path / "f", sleep=lambda s: None)
    assert len(calls) == 1
