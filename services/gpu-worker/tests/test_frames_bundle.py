"""reconstruction/tools/frames_bundle.py: parts that run without OpenCV·MediaPipe (contract details, bundle checks).

The frame selection itself (prepare_capture.py) needs real capture videos and is verified outside CI (README).
Synthetic data only: no face images.
"""

import hashlib
import importlib.util
import io
import json
import sys
import tarfile
from pathlib import Path

import pytest

RECON = Path(__file__).resolve().parents[1] / "reconstruction"
_spec = importlib.util.spec_from_file_location("frames_bundle", RECON / "tools" / "frames_bundle.py")
fb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fb)


@pytest.mark.parametrize(
    ("head", "suffix"),
    [
        (b"\x00\x00\x00\x14ftypqt  \x00\x00\x00\x00", ".mov"),
        (b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00", ".mp4"),
        (b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01\x42\xf7\x81\x01\x42\xf2\x81", ".mkv"),
    ],
)
def test_video_without_extension_gets_one_from_its_header(tmp_path, head, suffix):
    video = tmp_path / "input"  # the EC2 worker downloads the video as plain "input"
    video.write_bytes(head + b"\x00" * 32)
    assert fb.video_suffix(str(video)) == suffix


def test_known_extension_is_kept_and_unknown_content_stops(tmp_path):
    named = tmp_path / "capture.MOV"
    named.write_bytes(b"\x00" * 48)
    assert fb.video_suffix(str(named)) == ".mov"
    junk = tmp_path / "input"
    junk.write_bytes(b"not a video" * 4)
    with pytest.raises(SystemExit):
        fb.video_suffix(str(junk))


def test_lens_prefers_the_recorded_focal_length(tmp_path):
    video = tmp_path / "v.mov"
    video.write_bytes(b"\x00" * 64)
    rep = {"lens_source": {"source": "file", "focal_px": 1221.9, "focal35_mm": 24.0}}
    lens = fb.lens_record(rep, str(video), "1080x1920", None)
    assert (lens["focalPx"], lens["focalSource"], lens["focal35mm"]) == (1221.9, "file", 24.0)
    assert (lens["imageWidth"], lens["imageHeight"]) == (1080, 1920)


def test_lens_falls_back_to_the_device_profile(tmp_path):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"\x00" * 64)  # no metadata: the profile comes from --device
    lens = fb.lens_record({}, str(video), "1080x1920", "galaxy-s24-front")
    assert (lens["focalPx"], lens["focalSource"], lens["deviceProfile"]) == (
        1558.8,
        "device profile",
        "galaxy-s24-front",
    )


@pytest.mark.parametrize(
    ("model", "profile"),
    [
        ("SM-S921N", "galaxy-s24-front"),  # region letter after the 7-character code does not matter
        ("SM-S938U", "galaxy-s25ultra-front"),
        ("SM-G991B", "galaxy-s21-front"),
        ("SM-S947N", "galaxy-s26-front"),
        ("SM-G781B", None),  # S20 FE left out on purpose: no lens figure -> lens search
        # S15P31B204-468: A series (35 mm equivalent), Flip inner / Fold cover camera (spec FOV)
        ("SM-A528N", "galaxy-a-26mm-front"),  # A52s
        ("SM-A556S", "galaxy-a-26mm-front"),  # Quantum5 = A55
        ("SM-A166L", "galaxy-a-26mm-front"),  # Buddy4 = A16 5G
        ("SM-A356E", "galaxy-a-25mm-front"),
        ("SM-F721N", "galaxy-zflip4-front"),
        ("SM-F741N", "galaxy-zflip5-zflip6-front"),
        ("SM-F956N", "galaxy-zfold4-6-cover-front"),
        ("SM-F766N", None),  # Z Flip7 records the lens in the video (S15P31B204-467), no row
        ("iPhone 14 Pro Max", "iphone14pro-front"),
        # iPhone videos record the model name; a trimmed video keeps it but loses the lens record
        ("iPhone 13 mini", "iphone13-front"),
        ("iPhone 14 Plus", "iphone14-front"),
        ("iPhone 16e", "iphone16-front"),
        ("iPhone 17e", "iphone17e-front"),  # 12MP TrueDepth like the 16 generation, not the iPhone 17 row
        ("iPhone 17", "iphone17-front"),
        ("iPhone Air", "iphoneair-front"),
        ("iPhone 18 Pro Max", "iphone18pro-front"),
        ("iPhone Duo", None),  # no front lens figure -> lens search
    ],
)
def test_recorded_model_code_picks_the_device_profile(model, profile):
    assert fb.device_for_model(model) == profile


def test_every_profile_gives_a_plausible_front_camera_focal_length():
    from run_all import device_focal

    prof = json.loads((RECON / "assets" / "device_profiles.json").read_text(encoding="utf-8"))
    names = [k for k in prof if not k.startswith("_")]
    codes = [m for k in names for m in prof[k]["match"]]
    assert len(codes) == len(set(codes))  # one model code, one profile
    for name in names:
        assert 950 < device_focal(name, "1080x1920")[0] < 1700, name


def test_lens_without_any_record_is_none(tmp_path):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"\x00" * 64)
    lens = fb.lens_record({}, str(video), "1080x1920", None)
    assert (lens["focalPx"], lens["focalSource"]) == (None, "none")


def test_a_video_without_a_face_fails_even_when_prepare_kept_its_frames():
    # prepare keeps frames where no face was found (S15P31B204-374): 100 frames, 0 faces must not pass
    no_face = [{"file": f"v0_{i:05d}.jpg", "face": False} for i in range(100)]
    status, notes, n = fb.face_check("WARN", [], no_face)
    assert (status, n) == ("FAIL", 0)
    assert "0장" in notes[-1]


def test_false_faces_do_not_count_and_enough_faces_keep_the_prepare_status():
    faces = [{"face": True, "false_face": False}] * 19 + [{"face": True, "false_face": True}] * 5
    assert fb.face_check("PASS", [], faces)[0] == "FAIL"
    faces = [{"face": True, "false_face": False}] * 20
    assert fb.face_check("WARN", ["side"], faces) == ("WARN", ["side"], 20)


def _bundle(tmp_path, *, files=None, extra=None, quality="PASS", fmt=fb.FORMAT, wrong_sum=False, lens=None):
    files = files or {"prepare.json": b'{"images": []}', "images/v0_00001.jpg": b"synthetic"}
    sums = {k: hashlib.sha256(v).hexdigest() for k, v in files.items()}
    if wrong_sum:
        sums["images/v0_00001.jpg"] = "0" * 64
    manifest = {
        "format": fmt,
        "jobId": "test",
        "sourceVideo": {"file": "input"},
        "frameCount": 1,
        "frames": {"size": ["1080x1920"], "yawRange": None, "pitchRange": None, "fixedCamera": False},
        "quality": {"status": quality, "failCode": None, "proceed": quality != "FAIL", "notes": []},
        "versions": {},
        "files": sums,
    }
    lens = lens or {"focalPx": 1221.9, "focalSource": "file"}
    path = tmp_path / "frames.tar"
    with tarfile.open(path, "w") as t:
        members = {"manifest.json": json.dumps(manifest).encode(), "lens.json": json.dumps(lens).encode()}
        members.update(files)
        members.update(extra or {})
        for name, data in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            t.addfile(info, io.BytesIO(data))
    return path


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"wrong_sum": True}, "체크섬"),
        ({"extra": {"../outside.txt": b"x"}}, "목록에 없는 파일"),
        ({"quality": "FAIL"}, "품질 실패"),
        ({"fmt": "other/9"}, "형식"),
    ],
)
def test_run_refuses_a_bad_bundle_before_any_3d_work(tmp_path, monkeypatch, kwargs, message):
    monkeypatch.setattr(fb, "ROOT", str(tmp_path / "root"))
    called = []
    monkeypatch.setattr(fb.subprocess, "call", lambda *a, **k: called.append(a) or 0)
    args = type("A", (), {"bundle": str(_bundle(tmp_path, **kwargs)), "id": "t1", "force": False})()
    with pytest.raises(SystemExit) as e:
        fb.run(args, [])
    assert message in str(e.value)
    assert not called
    assert not (tmp_path / "outside.txt").exists()


def test_run_passes_the_bundle_focal_length_to_the_pipeline(tmp_path, monkeypatch):
    monkeypatch.setattr(fb, "ROOT", str(tmp_path / "root"))
    called = []
    monkeypatch.setattr(fb.subprocess, "call", lambda cmd, **k: called.append(cmd) or 0)
    args = type("A", (), {"bundle": str(_bundle(tmp_path)), "id": "t1", "force": False})()
    assert fb.run(args, ["--shape-only"]) == 0
    cmd = called[0]
    assert cmd[0] == sys.executable and "--focal" in cmd and cmd[cmd.index("--focal") + 1] == "1221.9"
    assert "--focal-estimate" not in cmd  # recorded in the video: fixed
    assert cmd[-1] == "--shape-only"
    rep = json.loads((tmp_path / "root" / "work" / "t1" / "run_all.json").read_text(encoding="utf-8"))
    assert rep["stages"]["prepare"]["status"] == "PASS"
    assert (
        tmp_path / "root" / "work" / "t1" / "prep" / "images" / "v0_00001.jpg"
    ).read_bytes() == b"synthetic"


def test_extract_removes_the_video_link_and_the_frames_when_prepare_fails(tmp_path, monkeypatch):
    """S15P31B204-448: a failed prepare left the video (hard link in /tmp/lmvid_*) and the selected frames behind"""
    root = tmp_path / "root"
    (root / "assets").mkdir(parents=True)
    (root / "assets" / "face_landmarker.task").write_bytes(b"synthetic")
    monkeypatch.setattr(fb, "ROOT", str(root))
    temp = tmp_path / "temp"
    temp.mkdir()
    monkeypatch.setattr(fb.tempfile, "tempdir", str(temp))
    work = root / "work" / "_bundle-j1"

    def prepare_dies(cmd, **kwargs):  # prepare wrote some frames, then died before run_all.json
        (work / "prep" / "images").mkdir(parents=True)
        (work / "prep" / "images" / "v0_00001.jpg").write_bytes(b"synthetic")
        return fb.subprocess.CompletedProcess(cmd, -9, "", "killed")

    monkeypatch.setattr(fb.subprocess, "run", prepare_dies)
    video = tmp_path / "capture.mp4"
    video.write_bytes(b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00synthetic")
    args = type(
        "A",
        (),
        {
            "video": str(video),
            "out": str(tmp_path / "frames.tar"),
            "job_id": "j1",
            "device": None,
            "keep": False,
        },
    )()
    with pytest.raises(SystemExit, match="prepare 실패"):
        fb.extract(args)
    assert list(temp.iterdir()) == []
    assert not work.exists()
    assert video.exists()  # the caller's video is the caller's to delete


# S15P31B204-467: a failed fixed trial retries (an estimate around itself first) instead of failing the job
def test_lens_attempts_fix_a_known_value_search_around_an_estimate_and_fall_back_to_the_full_search():
    from run_all import lens_attempts

    assert lens_attempts(None, False) == [("full", [])]
    assert lens_attempts(1221.9, False) == [
        ("fixed", ["--lo", "1221.9", "--hi", "1221.9", "--iters", "1"]),
        ("full", []),
    ]
    assert lens_attempts(1390.7, True) == [
        ("fixed", ["--lo", "1390.7", "--hi", "1390.7", "--iters", "1"]),  # unchanged when the estimate passes
        ("near", ["--lo", "1043.0", "--hi", "1877.4", "--iters", "3"]),
        ("full", []),
    ]


# S15P31B204-669 (plan S3-4 / F-6): the full search is a share of the frames' long side, not 600..3000 px
def test_full_lens_search_scales_with_the_frame_size():
    from run_all import FRAME_MAX_SIDE, frame_long_side, lens_attempts

    assert FRAME_MAX_SIDE == 1920  # prepare_capture --max-side default must match

    assert lens_attempts(None, False, 1920) == [("full", ["--lo", "864.0", "--hi", "1824.0"])]
    assert lens_attempts(814.6, True, 1280)[-1] == (
        "full",
        ["--lo", "576.0", "--hi", "1216.0"],
    )  # a web recording that came in at 1280x720
    # every focal seen so far is inside; the known wrong solution (eun02-sam 631 px at 1920) is not
    lo, hi = 0.45 * 1920, 0.95 * 1920
    assert all(lo <= f <= hi for f in (1018, 1222, 1273, 1559)) and not lo <= 631 <= hi
    assert frame_long_side("1080x1920") == 1920 and frame_long_side("1800X3200") == 3200
    assert frame_long_side(None) is None and lens_attempts(None, False, None) == [("full", [])]


@pytest.mark.parametrize(
    ("lens", "estimate"),
    [
        ({"focalPx": 1390.7, "focalSource": "device profile", "deviceProfile": "galaxy-s26-front"}, True),
        (
            {"focalPx": 1273.0, "focalSource": "device profile", "deviceProfile": "iphone12-front"},
            False,
        ),  # measured
        ({"focalPx": 1221.9, "focalSource": "file"}, False),
        ({"focalPx": 1221.9, "focalSource": "same-model file"}, False),
        ({"focalPx": None, "focalSource": "none"}, False),
    ],
)
def test_only_an_unchecked_device_profile_counts_as_an_estimate(lens, estimate):
    assert fb.focal_is_estimate(lens) is estimate


def test_run_marks_an_estimated_focal_length_for_the_pipeline(tmp_path, monkeypatch):
    monkeypatch.setattr(fb, "ROOT", str(tmp_path / "root"))
    called = []
    monkeypatch.setattr(fb.subprocess, "call", lambda cmd, **k: called.append(cmd) or 0)
    lens = {"focalPx": 1390.7, "focalSource": "device profile", "deviceProfile": "galaxy-s26-front"}
    args = type("A", (), {"bundle": str(_bundle(tmp_path, lens=lens)), "id": "t1", "force": False})()
    assert fb.run(args, []) == 0
    cmd = called[0]
    assert cmd[cmd.index("--focal") + 1] == "1390.7" and "--focal-estimate" in cmd


def _box(kind, payload):
    return len(payload + b"12345678").to_bytes(4, "big") + kind + payload


def _samsung_mp4(path, lens=None):
    """synthetic Samsung-style MP4: moov/udta with auth (3GPP full box + language), smta (full box) with mdln and lens"""
    smta = b"\0\0\0\0" + _box(b"mdln", b"SM-F766N")
    if lens is not None:
        smta += _box(b"lens", lens)
    udta = _box(b"auth", b"\0\0\0\0\x15\xc7Galaxy Z Flip7\0") + _box(b"smta", smta)
    path.write_bytes(_box(b"ftyp", b"mp42\0\0\0\0isommp42") + _box(b"moov", _box(b"udta", udta)))
    return str(path)


# S15P31B204-467: Galaxy models launched with Android 15+ record the lens in udta/smta/lens (Z Flip7: 22, 23, 23)
def test_samsung_lens_box_is_read_as_the_still_35mm_equivalent(tmp_path):
    from video_meta import focal_px_from_still_35mm, read

    meta = read(_samsung_mp4(tmp_path / "v.mp4", b"\0\0\0\0\x16\x00\x17\x00\x17"))
    assert meta["model"] == "Galaxy Z Flip7 (SM-F766N)"
    assert (meta["samsung_lens"], meta["samsung_focal35"]) == ([22, 23, 23], 23.0)
    assert "focal35" not in meta  # not the iPhone video-frame equivalent (fixed, no search)
    # same rule as the device profiles: 23 mm still equivalent -> 1390.7 px at 1080x1920 (galaxy-s26-front gives 1390.7)
    assert round(focal_px_from_still_35mm(23, 1920, 1080), 1) == 1390.7


@pytest.mark.parametrize(
    "lens",
    [
        None,  # S24+ and older: no lens box
        b"\0\0\0\0\x16\x00\x17",  # other layout: not guessed
        b"\0\0\0\0\x00\x00\x00\x00\x00",  # not a plausible focal length
    ],
)
def test_samsung_video_without_a_usable_lens_box_keeps_only_the_model(tmp_path, lens):
    from video_meta import read

    meta = read(_samsung_mp4(tmp_path / "v.mp4", lens))
    assert meta["model"] == "Galaxy Z Flip7 (SM-F766N)"
    assert "samsung_focal35" not in meta and "samsung_lens" not in meta


def test_samsung_lens_box_value_goes_to_the_gpu_as_an_estimate(tmp_path):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"\x00" * 64)
    rep = {
        "lens_source": {
            "source": "file",
            "focal_px": 1390.7,
            "focal35_mm": 23.0,
            "estimate": True,
            "samsung_lens": [22, 23, 23],
        }
    }
    lens = fb.lens_record(rep, str(video), "1080x1920", None)
    assert (lens["focalPx"], lens["focalSource"], lens["focal35mm"]) == (1390.7, "file", 23.0)
    assert (lens["focalEstimate"], lens["samsungLens"]) == (True, [22, 23, 23])
    assert fb.focal_is_estimate(lens) is True


@pytest.mark.parametrize(
    ("frame", "focal"),
    [("1080x1920", 1221.9), ("1800x3200", 2036.6), ("3200x1800", 2036.6)],
)
def test_recorded_35mm_becomes_px_on_the_prepared_frame_not_the_original_video(frame, focal):
    """S15P31B204-565: a 2160x3840 iPhone 4K video is prepared at 1800x3200. The original size would give 2443.9 px."""
    from video_meta import focal_px_on_frame

    assert focal_px_on_frame(24.0, frame) == focal
    # Samsung lens box: 35 mm equivalent of the still
    assert focal_px_on_frame(23.0, "1920x1080", still=True) == 1390.7


def test_lens_converts_the_35mm_record_on_the_4k_prepared_frames(tmp_path):
    """run_all --until prepare keeps only the 35 mm record (no px); the bundle converts it on the prepared frame size."""
    from video_meta import focal_px_from_still_35mm

    video = tmp_path / "v.mov"
    video.write_bytes(b"\x00" * 64)
    iphone = {"lens_source": {"source": "file", "focal35_mm": 24.0, "lens_model": "front camera"}}
    lens = fb.lens_record(iphone, str(video), "1800x3200", None)
    assert (lens["focalPx"], lens["focalSource"], lens["focal35mm"]) == (2036.6, "file", 24.0)
    assert fb.focal_is_estimate(lens) is False  # recorded for this video: fixed
    samsung = {
        "lens_source": {
            "source": "file",
            "focal35_mm": 23.0,
            "still": True,
            "estimate": True,
            "samsung_lens": [22, 23, 23],
        }
    }
    lens = fb.lens_record(samsung, str(video), "1800x3200", None)
    assert lens["focalPx"] == round(focal_px_from_still_35mm(23.0, 1800, 3200), 1)
    assert (lens["focalEstimate"], fb.focal_is_estimate(lens)) == (True, True)


@pytest.mark.parametrize(
    ("device", "device_model", "expected"),
    [
        (None, "SM-S921N", "galaxy-s24-front"),  # 웹 녹화: FE가 보낸 기종(S15P31B204-618)
        ("iphone15-front", "SM-S921N", "iphone15-front"),  # --device를 직접 주면 그대로
        (None, "Unknown Phone", None),  # 맞는 프로필이 없으면 지금처럼 탐색
        (None, None, None),
    ],
)
def test_device_model_option_resolves_to_a_profile(device, device_model, expected):
    assert fb.device_arg(device, device_model) == expected


# S15P31B204-675 (plan S3-1): a whole side that fails to register is caught per side, not by the overall ratio
def test_a_side_that_did_not_register_fails_before_the_model():
    from run_all import short_sides, side_registration

    images = (
        [{"file": f"l{i}.jpg", "yaw": -40.0 - i} for i in range(6)]
        + [{"file": f"r{i}.jpg", "yaw": 50.0 + i} for i in range(7)]
        + [{"file": f"f{i}.jpg", "yaw": 3.0} for i in range(40)]
        + [{"file": "ff.jpg", "yaw": -60.0, "false_face": True}, {"file": "nf.jpg", "yaw": None}]
    )
    every = {im["file"] for im in images}
    assert side_registration(every, images) == {"left": [6, 6], "right": [7, 7]}
    assert short_sides(side_registration(every, images)) == []
    # woo02 gapR (11/05): the right side lost, 75 % overall still passed the 60 % gate
    lost = every - {f"r{i}.jpg" for i in range(7)}
    assert short_sides(side_registration(lost, images)) == [("right", 0, 7)]
    # half registered is enough; two side frames are judged, one is not
    half = every - {"l0.jpg", "l1.jpg", "l2.jpg"}
    assert short_sides(side_registration(half, images)) == []
    two = [{"file": "a.jpg", "yaw": -50.0}, {"file": "b.jpg", "yaw": -55.0}]
    assert short_sides(side_registration(set(), two)) == [("left", 0, 2)]
    assert short_sides(side_registration({"a.jpg"}, two)) == []
    assert short_sides(side_registration(set(), two[:1])) == []


# --- S15P31B204-662 (plan S1-1): the GPU's 5-view angle rule runs at extraction; capture.trace only explains it ---

from app.reconstruction import worker as recon_worker


def faces(*yaws, **extra):
    """Synthetic prepare.json images: one real face frame per yaw."""
    return [
        {"file": f"v0_s_{i:05d}.jpg", "face": True, "yaw": y, "sharpness": 10.0, **extra}
        for i, y in enumerate(yaws)
    ]


def trace_file(tmp_path, yaws, **over):
    """capture.trace as the web guide writes it: [tMs, yaw, pitch, found], 50 ms apart; None = face lost."""
    pts = [[i * 50, y, None if y is None else 2.0, 0 if y is None else 1] for i, y in enumerate(yaws)]
    body = {"version": 1, "guideVersion": "live-capture-2026-11-07", "trace": pts, **over}
    path = tmp_path / "trace.json"
    path.write_text(json.dumps(body), encoding="utf-8")
    return str(path)


def test_angle_limits_are_the_gpu_pick_limits():
    assert (fb.SIDE_MIN_DEG, fb.FRONT_MAX_DEG) == (recon_worker.SIDE_MIN_DEG, recon_worker.FRONT_MAX_DEG)


@pytest.mark.parametrize(
    "images",
    [
        faces(-80, -40, 0, 40, 80),
        faces(-34.9, 0, 60),  # left short
        faces(-60, 0, 20),  # right short
        faces(-60, 16, 60),  # nothing within 15 deg of frontal
        faces(-60, 0, 60) + [{"file": "m.jpg", "face": True, "yaw": 89.0, "marker": True}],  # marker photo
        faces(-60, 0) + [{"file": "f.jpg", "face": True, "yaw": 70.0, "false_face": True}],  # false face
        faces(-60, 0, 60) + [{"file": "n.jpg", "face": False, "yaw": None}],
    ],
)
def test_angle_check_fails_exactly_where_the_gpu_pick_fails(images):
    angle = fb.angle_check(images)
    try:
        recon_worker.pick_captures(images)
        gpu_fails = False
    except recon_worker.JobFailed as e:
        assert e.code == "QUALITY_ANGLE"
        gpu_fails = True
    assert (angle["status"] == "FAIL") is gpu_fails


def test_short_side_becomes_quality_angle_with_the_measured_turn():
    angle = fb.angle_check(faces(-28.4, -3, 50))
    assert (angle["status"], angle["short"], angle["yawMin"], angle["yawMax"]) == (
        "FAIL",
        ["LEFT"],
        -28.4,
        50,
    )
    status, notes, code = fb.apply_angle("PASS", [], angle)
    assert (status, code) == ("FAIL", "QUALITY_ANGLE")
    assert "왼쪽 28°" in notes[-1] and "35°" in notes[-1]


def test_no_face_wins_over_angle_and_a_passing_angle_changes_nothing():
    short = fb.angle_check(faces(-10, 0, 10))
    assert fb.apply_angle("FAIL", ["x"], short) == ("FAIL", ["x"], "QUALITY_NO_FACE")
    assert fb.apply_angle("WARN", ["x"], fb.angle_check(faces(-60, 0, 60))) == ("WARN", ["x"], None)
    assert fb.angle_check([{"face": False, "yaw": None}]) is None  # no face at all is face_check's job
    assert fb.apply_angle("PASS", [], None) == ("PASS", [], None)


def test_trace_tells_turn_from_selection(tmp_path):
    # left: the head reached -70 but no selected frame did -> selection; right: never past 20 -> turn
    yaws, note = fb.read_trace(trace_file(tmp_path, [0] * 10 + [-70, -50, None, -30] + [5] * 10 + [20] * 3))
    assert note is None
    angle = fb.angle_check(faces(-30, 0, 18), yaws)
    assert angle["status"] == "FAIL" and angle["short"] == ["LEFT", "RIGHT"]
    assert angle["trace"] == {
        "yawMin": -70,
        "yawMax": 20,
        "used": True,
        "cause": {"LEFT": "selection", "RIGHT": "turn"},
    }


def test_trace_never_passes_a_video(tmp_path):
    yaws, _ = fb.read_trace(trace_file(tmp_path, [-80, -40, 0, 40, 80] * 5))
    angle = fb.angle_check(faces(-20, 0, 60), yaws)
    assert angle["status"] == "FAIL" and angle["trace"]["cause"] == {"LEFT": "selection"}


def test_trace_that_disagrees_with_the_frames_is_dropped(tmp_path):
    # frames turned -70 .. +40; a trace of -40 .. +70 is the mirror image (sign flipped)
    yaws, _ = fb.read_trace(trace_file(tmp_path, [-40, 0, 70] * 10))
    angle = fb.angle_check(faces(-70, 0, 40), yaws)
    assert angle["status"] == "PASS"
    assert angle["trace"]["used"] is False and "부호 반대" in angle["trace"]["note"]
    assert "cause" not in angle["trace"]


@pytest.mark.parametrize(
    ("body", "reason"),
    [
        ({"version": 2, "trace": [[0, 1, 1, 1]] * 30}, "버전"),
        ({"version": 1, "trace": [[0, 1, 1, 1]] * 2001}, "표본 수"),
        (
            {"version": 1, "trace": [[i, 1, 1, 1] for i in range(30)] + [[5, 1, 1, 1]]},
            "모양",
        ),  # time goes back
        ({"version": 1, "trace": [[i, 1, 1, 2] for i in range(30)]}, "모양"),  # found must be 0 / 1
        ({"version": 1, "trace": [[i, 1, 1, True] for i in range(30)]}, "모양"),
        ({"version": 1, "trace": [[i, "1", 1, 1] for i in range(30)]}, "각도"),
        ({"version": 1, "trace": [[i, 200, 1, 1] for i in range(30)]}, "각도"),
        ({"version": 1, "trace": [[i, 5, 1, 0] for i in range(30)]}, "얼굴 없는"),
        ({"version": 1, "trace": [[i, 5, 1, 1] for i in range(19)]}, "얼굴 표본"),
    ],
)
def test_broken_trace_is_dropped_with_a_reason(tmp_path, body, reason):
    path = tmp_path / "t.json"
    path.write_text(json.dumps(body), encoding="utf-8")
    yaws, note = fb.read_trace(str(path))
    assert yaws is None and reason in note
    angle = fb.angle_check(faces(-60, 0, 60), yaws, note)
    assert angle["status"] == "PASS" and angle["trace"] == {"used": False, "note": note}


def test_no_trace_is_the_file_upload_path(tmp_path):
    assert fb.read_trace(None) == (None, None)
    assert fb.angle_check(faces(-60, 0, 60))["trace"] is None
    yaws, note = fb.read_trace(str(tmp_path / "missing.json"))
    assert yaws is None and note


# --- S15P31B204-667 (plan S1-6): duplicate web guide segments left out of the frame choice ---


def guide_rows(end_ms=30000, misread_at=None, lose_return=False):
    """A web guide recording at 20 Hz: (yaw, pitch, found) by time. Each step's range starts with the previous step's hold."""
    rows = []
    for t in range(0, end_ms + 1, 50):
        found = 1
        if t < 12000:
            yaw, pitch = 60 - t * 0.01, 0.0  # sweep right end -> left end
        elif t < 13200:
            yaw, pitch = -65.0, 0.0  # left-end hold (in the 1st backfront range)
        elif t < 15500:
            yaw, pitch = -60 + 60 * (t - 13200) / 2300, 0.0  # way back to the front
            found = 0 if lose_return else 1
        elif t < 18000:
            yaw, pitch = 2.0, 0.0  # front confirm, then the 2 s front hold (in the headup range)
        elif t < 20500:
            yaw, pitch = 1.0, -25.0  # head up + its hold
        elif t < 23200:
            yaw, pitch = 1.0, 25.0  # head down + its hold (the hold is in the 2nd backfront range)
        elif t < 23700:
            yaw, pitch = 1.0, 25 - 50 * (t - 23200) / 500.0
        else:
            yaw, pitch = 2.0, 0.5  # closing front and the wait
        if misread_at is not None and abs(t - misread_at) < 1:
            yaw, pitch, found = -20.0, 0.0, 1  # one-frame tracker jump at the profile
        rows.append([t, round(yaw, 1) if found else None, round(pitch, 1) if found else None, found])
    return rows


def guide_trace(tmp_path, end_ms=30000, names=None, guide="live-capture-2026-11-07", **kw):
    bounds = [0, 0, 12000, 16000, 19500, 22000, end_ms]
    names = fb.GUIDE_ORDER if names is None else names
    steps = [{"name": n, "startMs": bounds[i], "endMs": bounds[i + 1]} for i, n in enumerate(names)]
    body = {
        "version": 1,
        "guideVersion": guide,
        "steps": steps,
        "trace": guide_rows(end_ms, **kw),
        "meta": {"durationMs": end_ms},
    }
    path = tmp_path / "trace.json"
    path.write_text(json.dumps(body), encoding="utf-8")
    return str(path)


def test_duplicate_segments_are_cut_only_when_switched_on(tmp_path, monkeypatch):
    path = guide_trace(tmp_path)
    monkeypatch.delenv(fb.TRACE_CUT_ENV, raising=False)
    assert fb.trace_cut(path, 30000) == {
        "applied": False,
        "reason": "off",
    }  # default: frames chosen as before
    monkeypatch.setenv(fb.TRACE_CUT_ENV, "1")
    cut = fb.trace_cut(path, 30100)
    assert cut["applied"]
    (ret_s, ret_e), (close_s, close_e) = cut["excludeMs"]
    assert 13200 < ret_s < 14200 and ret_e == 16000  # the left-end hold stays, the way back to the front goes
    assert (
        23700 <= close_s < 24200 and close_e == 31100
    )  # the chin-down hold stays, the closing front + wait go
    assert cut["frontKeptMs"] >= 2000  # the 2 s front hold stays


def test_a_one_frame_jump_at_the_profile_does_not_start_the_left_cut(tmp_path):
    cut = fb.trace_cut(guide_trace(tmp_path, misread_at=12500), 30000, enabled=True)
    assert cut["cuts"]["leftReturn"]["fromMs"] > 13200


def test_each_cut_is_dropped_alone_when_not_found_cleanly(tmp_path):
    cut = fb.trace_cut(guide_trace(tmp_path, lose_return=True), 30000, enabled=True)
    assert cut["applied"] and len(cut["excludeMs"]) == 1 and isinstance(cut["cuts"]["leftReturn"], str)


@pytest.mark.parametrize(
    ("kw", "video_ms", "reason"),
    [
        ({"guide": "live-capture-2099-01-01"}, 30000, "unknown guideVersion"),
        ({"names": ["recleft", "sweepleft", "headup", "headdown", "backfront", "backfront"]}, 30000, "steps"),
        ({"names": fb.GUIDE_ORDER[:5]}, 30000, "steps"),  # stopped before the closing front
        ({}, 32000, "vs video"),  # trace and video lengths disagree: the time mapping is in doubt
        ({}, None, "vs video"),
    ],
)
def test_any_doubt_keeps_the_frames_as_before(tmp_path, kw, video_ms, reason):
    cut = fb.trace_cut(guide_trace(tmp_path, **kw), video_ms, enabled=True)
    assert cut["applied"] is False and reason in cut["reason"]


def test_no_or_broken_trace_is_not_cut(tmp_path):
    assert fb.trace_cut(None, 30000, enabled=True)["reason"] == "no trace"
    bad = tmp_path / "bad.json"
    bad.write_text("{}", encoding="utf-8")
    assert fb.trace_cut(str(bad), 30000, enabled=True)["applied"] is False


_sspec = importlib.util.spec_from_file_location("frame_slots", RECON / "pipeline" / "frame_slots.py")
fs = importlib.util.module_from_spec(_sspec)
_sspec.loader.exec_module(fs)


def test_frame_slots_skip_the_cut_range_and_keep_the_count():
    times = [k * 1000 / 30 for k in range(900)]  # 30 s at 30 fps
    want = fs.slot_frames(fs.kept_frames(times, [(22000, 31000)]), 50)
    assert max(want) < 22000 * 30 / 1000 and len(set(want.values())) == 50
    assert fs.slot_frames(list(range(900)), 50) == fs.slot_frames(
        fs.kept_frames(times, []), 50
    )  # no cut: as before


def test_uneven_frame_times_are_cut_by_time_not_by_frame_number():
    # a browser recording with a 1 s freeze: frame numbers no longer match k / fps
    times = [k * 33.3 for k in range(300)] + [10990 + k * 33.3 for k in range(300)]
    kept = fs.kept_frames(times, [(15000, 30000)])
    assert kept and all(times[k] < 15000 for k in kept)
    assert len(kept) == sum(1 for t in times if t < 15000)


def test_linspace_matches_numpy_values_at_the_ends():
    assert fs.linspace(0, 99, 5) == [0.0, 24.75, 49.5, 74.25, 99]
    assert fs.parse_exclude("22000-31000, 5000-6000") == [(22000.0, 31000.0), (5000.0, 6000.0)]
    assert fs.parse_exclude("") == []


# --- pose slots (default on, EXTRACT_POSE_SLOTS=0 = off): frames spread over new head poses, not over time ---


def _pose_rows(pause_ms=0, closing_ms=2000):
    """20 Hz web guide trace: sweep +60 -> -60 deg (with an optional front pause), way back, up, down, closing wait."""
    rows, t = [], 0

    def add(ms, f):
        nonlocal t
        for k in range(0, ms, 50):
            y, p = f(k / ms)
            rows.append([t, round(y, 1), round(p, 1), 1])
            t += 50

    add(3000, lambda u: (60 - 60 * u, 0))
    if pause_ms:
        add(pause_ms, lambda u: (0, 0))
    add(3000, lambda u: (-60 * u, 0))
    add(2000, lambda u: (-60 + 60 * u, 0))  # way back over angles already seen
    add(1000, lambda u: (0, -25 * u))
    add(1000, lambda u: (0, -25 + 50 * u))
    add(closing_ms, lambda u: (0, 0))
    return rows


def _pose_frames(rows, n=40):
    times = [k * 1000 / 30 for k in range(int(rows[-1][0] * 30 / 1000))]
    want = fs.progress_slots(fs.progress_at(times, fs.trace_progress(rows)), n)
    first = {}
    for k, s in sorted(want.items()):
        first.setdefault(s, k)
    return times, first


def test_pose_slots_give_a_pause_or_a_long_wait_no_frames():
    counts = []
    for pause, closing in ((0, 2000), (5000, 2000), (0, 12000)):
        times, first = _pose_frames(_pose_rows(pause_ms=pause, closing_ms=closing))
        assert len(first) >= 36  # nearly every slot gets a frame
        sweep_end = 6000 + pause
        counts.append(sum(1 for k in first.values() if times[k] < sweep_end))
    assert (
        min(counts) >= 15 and max(counts) - min(counts) <= 2
    )  # the same share on the sweep, whatever the pauses


def test_pose_slots_frames_per_pose_do_not_depend_on_pauses():
    _, a = _pose_frames(_pose_rows())
    b_t, b = _pose_frames(_pose_rows(pause_ms=5000, closing_ms=12000))
    in_pause = sum(1 for k in b.values() if 3000 <= b_t[k] < 8000)
    assert in_pause <= 2  # time slots would put about 9 of 40 frames in the 5 s pause
    assert abs(len(a) - len(b)) <= 2


def _profile_recording():
    """0.5 s face at the right end, 8 s lost at the right profile, then a 6 s sweep 50 -> -60 deg (iPhone 12-like)"""
    rows = [[t, 55.0, 0.0, 1] for t in range(0, 500, 50)] + [[t, None, None, 0] for t in range(500, 8500, 50)]
    rows += [[t, 50.0 - (t - 8500) * 110 / 6000, 0.0, 1] for t in range(8500, 14500, 50)]
    return rows


def test_pose_profile_gets_the_same_share_as_time_slots():
    rows = _profile_recording()
    p = dict(fs.trace_progress(rows))
    total = p[14450]
    profile = p[8450] - p[800]  # counting starts 300 ms after the loss
    # time slots give the profile (8450 - 800) / 14450 of the frames; never fewer here
    assert profile / total == pytest.approx((8450 - 800) / 14450, rel=0.03)


def test_pose_profile_share_is_spread_over_the_whole_lost_time():
    p = dict(fs.trace_progress(_profile_recording()))
    p0, mid, p_end = p[800], p[4600], p[8450]
    assert (mid - p0) / (p_end - p0) == pytest.approx(0.5, abs=0.03)  # half the share by half the stretch


def test_pose_face_loss_near_the_front_or_short_adds_nothing():
    rows = [[t, 0.0, 0.0, 1] for t in range(0, 500, 50)] + [[t, None, None, 0] for t in range(500, 2500, 50)]
    rows += [[t, 1.0, 0.0, 1] for t in range(2500, 3000, 50)]
    p = dict(fs.trace_progress(rows))
    assert p[2450] == p[450]  # looking down / a tracker drop at the front is not a profile


def test_pose_slots_switch_and_trace_length_check(tmp_path, monkeypatch):
    path = tmp_path / "trace.json"
    path.write_text(
        json.dumps({"version": 1, "trace": _pose_rows(), "meta": {"durationMs": 12000}}), encoding="utf-8"
    )
    monkeypatch.delenv(fb.POSE_SLOTS_ENV, raising=False)
    assert fb.pose_slots(str(path), 12000)["applied"] is True  # on by default
    monkeypatch.setenv(fb.POSE_SLOTS_ENV, "0")
    assert fb.pose_slots(str(path), 12000)["reason"] == "off"
    assert fb.pose_slots(str(path), 12000, enabled=True)["applied"] is True
    assert (
        fb.pose_slots(str(path), 20000, enabled=True)["applied"] is False
    )  # trace and video lengths disagree
    assert fb.pose_slots(None, 12000, enabled=True)["reason"] == "no trace"


def test_pose_progress_ignores_head_up_down_past_the_limit_from_the_front_pose():
    # a phone held low: the front reads +10 deg up / down; the head then goes to +55 deg (past the 30 deg limit)
    rows = [[t, 0.0, 10.0, 1] for t in range(0, 1000, 50)]
    rows += [[1000 + 50 * k, 0.0, 10.0 + 2.5 * k, 1] for k in range(19)]  # 10 -> 55 deg
    prog = fs.trace_progress(rows)
    # the usual height (front +-10 deg) is one cell, then the A안 2.5 deg pitch cells up to front + 30 deg; nothing past it
    within = int((fs.PITCH_MAX_DEG - fs.LEVEL_BAND_DEG) / fs.CELL_PITCH_DEG)
    assert prog[-1][1] == pytest.approx(1 + within, abs=1)


def test_head_up_opens_the_a_plan_cells_past_the_usual_height(monkeypatch):
    # 11/10: 5 deg head up / down cells cut the registered head-up frames 10 -> 7 - those are the only views under the
    # chin. Past the usual height the level rule keeps the A안 2.5 deg cells: the same cells (+-1 at the band edge).
    # 0 .. -10 deg is the usual height on purpose (R4) and not counted here
    rows = [[50 * k, 60.0 - 1.0 * k, 0.0, 1] for k in range(121)]  # sweep 60 -> -60 at the usual height
    rows += [[6050 + 50 * k, 0.0, -1.0 * k, 1] for k in range(30)]  # head up 0 -> -29 deg at the front
    past = lambda p: p[-1][1] - dict(p)[6550.0]  # 6550 ms: -10 deg
    level = past(fs.trace_progress(rows))
    monkeypatch.setenv("EXTRACT_POSE_LEVEL", "0")
    assert level == pytest.approx(past(fs.trace_progress(rows)), abs=1)


# --- gyro left / right progress and the usual head height (S15P31B204-735, default on) ---
def _sweep(gyro_sign=-1.0, hold_ms=3000, gyro_scale=1.0):
    """right end +60 deg (face seen) -> lost past 60 for hold_ms at +80 -> back to -60 -> front; gyro = sign * yaw + 90"""
    rows, gyro, t = [], [], 0

    def add(yaw, face):
        nonlocal t
        rows.append([t, yaw if face else None, 0.0 if face else None, 1 if face else 0])
        gyro.append([t, gyro_sign * gyro_scale * yaw + 90.0])
        t += 50

    for k in range(20):
        add(60 + k, k < 5)  # 60 -> 79, the face is lost from 65
    for _ in range(hold_ms // 50):
        add(80, False)  # held at the profile
    for k in range(141):
        add(80 - k, abs(80 - k) <= 60)
    for _ in range(40):
        add(-60 + 1.5 * _, True)  # back to the front
    return rows, gyro


def test_gyro_profile_hold_adds_nothing():
    a = dict(fs.trace_progress(*_sweep(hold_ms=1000)))
    b = dict(fs.trace_progress(*_sweep(hold_ms=8000)))
    assert max(a.values()) == pytest.approx(max(b.values()), abs=1)  # 7 s more at the profile: no more cells
    _, info = fs.trace_progress_info(*_sweep())
    assert info["gyro"] == "used" and info["corr"] < -0.95


def test_gyro_works_whichever_way_the_phone_turns():
    p1, i1 = fs.trace_progress_info(*_sweep(gyro_sign=-1.0))
    p2, i2 = fs.trace_progress_info(*_sweep(gyro_sign=1.0))
    assert i1["gyro"] == i2["gyro"] == "used" and p1[-1][1] == pytest.approx(p2[-1][1], abs=1)


def test_gyro_that_does_not_follow_the_face_is_not_used():
    # the values recorded before !591 turned 13-24 deg for a whole sweep: rejected -> profile time share as before
    rows, gyro = _sweep(gyro_scale=0.1)
    _, info = fs.trace_progress_info(rows, gyro)
    assert info["gyro"] == "rejected"
    a = dict(fs.trace_progress(*_sweep(gyro_scale=0.1, hold_ms=1000)))
    b = dict(fs.trace_progress(*_sweep(gyro_scale=0.1, hold_ms=8000)))
    assert max(b.values()) > max(a.values()) + 5  # the profile time counts again
    assert fs.trace_progress_info(rows, gyro, gyro_version=1)[1]["reason"] == "gyroVersion 1"


def test_way_back_at_another_height_is_not_a_new_pose():
    out = [[50 * k, 40 - k, 0.0, 1] for k in range(80)]  # +40 -> -40 at the front height
    back = [[4000 + 50 * k, -40 + k, 3.0, 1] for k in range(80)]  # back 3 deg higher
    p = dict(fs.trace_progress(out + back))
    assert p[max(p)] == pytest.approx(p[3950], abs=1)


def test_switches_turn_the_new_rules_off(monkeypatch):
    rows, gyro = _sweep()
    monkeypatch.setenv("EXTRACT_POSE_GYRO", "0")
    assert fs.trace_progress_info(rows, gyro)[1]["gyro"] == "off"
    monkeypatch.setenv("EXTRACT_POSE_LEVEL", "0")
    assert fs.trace_progress_info(rows, gyro)[1]["level_band"] is None
