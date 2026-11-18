import os
import time

from app import leftovers
from app.extractor import worker as extractor
from app.reconstruction import worker as recon

JOB = "7b0e4c2d-9f1a-4e3b-8c5d-2a6f1e9b3c40"
HOUR = 3600


def age(path, seconds):
    """path의 마지막 변경 시각을 seconds 전으로 돌린다."""
    t = time.time() - seconds
    os.utime(path, (t, t))
    return path


def make_dir(path, seconds):
    path.mkdir(parents=True)
    (path / "frame.jpg").write_bytes(b"synthetic")
    return age(path, seconds)


def test_2시간이_지난_것만_지우고_진행_중일_수_있는_것은_남긴다(tmp_path):
    old_dir = make_dir(tmp_path / "old", 3 * HOUR)
    old_file = tmp_path / "old.tar"
    old_file.write_bytes(b"x")
    age(old_file, 3 * HOUR)
    fresh = make_dir(tmp_path / "fresh", 10 * 60)

    assert leftovers.sweep([old_dir, old_file, fresh]) == 2

    assert not old_dir.exists() and not old_file.exists()
    assert fresh.exists()


def test_이미_사라진_후보는_건너뛴다(tmp_path):
    assert leftovers.sweep([tmp_path / "gone"]) == 0


def test_이름이_통째로_맞는_것만_후보다(tmp_path):
    (tmp_path / JOB).mkdir()
    (tmp_path / (JOB + "-model")).mkdir()
    (tmp_path / "_video_meta_cache.json").write_text("{}")
    (tmp_path / "not-a-job").mkdir()

    assert leftovers.matching(tmp_path, leftovers.JOB_ID) == [tmp_path / JOB]
    assert leftovers.matching(tmp_path / "missing", leftovers.JOB_ID) == []


def test_정리는_처음과_한_시간마다만_돈다(tmp_path):
    calls = []
    sweeper = leftovers.Sweeper("test", lambda: calls.append(1) or [])

    sweeper.maybe(now=0)
    sweeper.maybe(now=HOUR - 1)
    sweeper.maybe(now=HOUR)

    assert len(calls) == 2


def test_GPU_워커는_작업_폴더_편집_사본_이름표_붙은_임시_폴더만_후보로_본다(tmp_path, monkeypatch):
    recon_root, temp = tmp_path / "reconstruction", tmp_path / "tmp"
    for path in (
        recon_root / "work" / JOB,
        recon_root / "work" / ("_bundle-" + JOB),  # 추출 워커 몫
        recon_root / "cases" / (JOB + "-model"),
        temp / "lm-recon-abc123",
        temp / "tmpother",  # 다른 프로그램의 임시 폴더
    ):
        path.mkdir(parents=True)
    monkeypatch.setattr(recon, "RECON", recon_root)
    monkeypatch.setenv("RECON_WORK_DIR", str(temp))

    assert sorted(p.name for p in recon.leftover_targets()) == sorted(
        [JOB, JOB + "-model", "lm-recon-abc123"]
    )


def test_추출_워커는_묶음_작업_폴더와_이름표_붙은_임시_폴더만_후보로_본다(tmp_path, monkeypatch):
    recon_root, temp = tmp_path / "reconstruction", tmp_path / "tmp"
    for path in (
        recon_root / "work" / ("_bundle-" + JOB),
        recon_root / "work" / ("_bundle-" + JOB + "-a2"),  # 시도별 폴더(S15P31B204-594)
        recon_root / "work" / ("_bundle-" + JOB + "-other"),
        recon_root / "work" / JOB,  # GPU 워커 몫
        temp / "lm-extract-xyz",
        temp / "lm-recon-abc",
    ):
        path.mkdir(parents=True)
    monkeypatch.setattr(extractor, "FRAMES_BUNDLE", recon_root / "tools" / "frames_bundle.py")

    assert sorted(p.name for p in extractor.leftover_targets(str(temp))) == sorted(
        ["_bundle-" + JOB, "_bundle-" + JOB + "-a2", "lm-extract-xyz"]
    )
