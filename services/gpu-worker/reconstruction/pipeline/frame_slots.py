"""Even time slots over the video frames, optionally leaving time ranges out (S15P31B204-667, plan S1-6), or (option)
slots over new head poses from the web guide trace (trace_progress / progress_slots below).

prepare_capture.py chooses video frames in n even slots (2 candidates per slot, the sharper is kept). With cut ranges
(the web guide's duplicate segments, from frames_bundle.trace_cut) the slots are laid over the KEPT frames only, so
the same number of frames spreads over the rest. Pure Python (no numpy) so the CI tests run without the pipeline deps;
the slot positions are computed the way numpy.linspace does, so with nothing cut the choice is the same as before.
"""


def parse_exclude(text):
    """'start-end,start-end' (ms of the video) -> [(start, end)]; '' / None -> []"""
    out = []
    for part in (text or "").split(","):
        part = part.strip()
        if "-" in part:
            s, e = part.split("-", 1)
            out.append((float(s), float(e)))
    return out


def kept_frames(times_ms, exclude):
    """Frame numbers whose presentation time is outside every [start, end] ms range."""
    return [k for k, t in enumerate(times_ms) if not any(s <= t <= e for s, e in exclude)]


def linspace(start, stop, num):
    """numpy.linspace(start, stop, num) for num >= 2 (same float steps, last value exactly stop)."""
    step = (stop - start) / (num - 1)
    out = [start + i * step for i in range(num)]
    out[-1] = stop
    return out


def slot_frames(kept, n):
    """n even slots over the kept frame numbers, 2 candidates per slot -> {frame number: slot}. Positions are taken in
    the KEPT list, so a slot never reaches into a cut range."""
    pos = linspace(0, len(kept) - 1, n + 1)
    want = {}
    for i in range(n):
        a, b = int(pos[i]), int(pos[i + 1])
        for j in {a + (b - a) // 3, a + 2 * (b - a) // 3}:
            want[kept[j]] = i
    return want


# --- pose slots (web recordings, DEFAULT since 11/09; frames_bundle EXTRACT_POSE_SLOTS=0 = time): NEW head poses ----
# Time slots give a still head (a front pause, the voice prompt waits, the closing 24 s wait) as many frames as a turn,
# and a pose seen twice (the way back from the left end, the return to the front after up / down) twice. Which frames
# that is depends on how this person moved this time, so two recordings of the same person get different frame sets.
# Here the web guide trace (head yaw / pitch, about 20 Hz) is turned into a "progress" that grows only when the head
# reaches a pose cell not seen before; the n slots are laid evenly over that progress. A pause or a repeated pose adds
# nothing, a slow or fast turn gets the same frames per degree. Where the face is lost past a side turn (profiles beyond
# about 60 deg) the trace has no angle: that time gets the frames time slots would give it (see the profile note below).
# Short losses and losses near the front (looking down) do not count.
# Values checked on 4 dev web recordings (11/09 13:18-13:37, Galaxy S24, iPhone 12 / 14 Plus / 16 Pro): 1.5 x 5 deg
# cells gave head up / down only 10-15 % of the frames (time slots 8-18 frames), square 2.5 deg cells 15-24 % - the
# same frames per degree in every direction.
# 3D check on 9 dev web recordings (11/09, 6 phones, against time slots): registered frames 692/760 -> 775/788, side
# frames registered 125 -> 210, still / repeated-pose frames 200 / 191 -> 80 / 108, angle gaps >= 8 deg 47 -> 23,
# extraction +4 s, 3D time unchanged. Known limit: on the way back from the left end the head is 2-5 deg higher or lower
# than on the way out, so 142 of 191 cells opened there are a pose already seen at another height.
CELL_YAW_DEG = 2.5          # pose cell 2.5 x 2.5 deg: 140-175 cells per recording (n = 100 slots)
CELL_PITCH_DEG = 2.5
SMOOTH = 2                  # median over +-2 face samples (tracker jitter would open new cells during a pause)
NOFACE_SIDE_DEG = 35.0      # a face loss counts only after a turn past this (the profile, not a tracker drop at the front)
NOFACE_MIN_MS = 300.0       # ... and only from this long on
# The profile past ~60 deg has no angle in the trace. There the frames are taken exactly as time slots take them: the
# same frames per second as the whole recording (n / length), spread over the time the face was lost on a side - the
# share that registered (iPhone 12, 11/09: time slots 18 of 18 frames at 68-105 deg SfM). 3D checks (11/09) of the
# alternatives: a fixed rate up to a cap used the share in the first 0.7 s (4 frames, 0 registered, right side stopped at
# 62 deg); a fixed 16 cells per side over the whole lost time gave 11 frames, 1 registered (74 deg) - fewer frames than
# time slots there and the chain to the front broke. So: as many as time slots, never fewer.
PITCH_MAX_DEG = 30.0        # head up / down beyond this opens no cell
# 11/09 (iPhone 12): with no limit the 10 frames at -35..-52 deg head up were not registered. 11/10 (5 recordings,
# iPhone 16 / 17 / 17 Pro, Galaxy S24, limit 50): 24 of 28 frames past 30 deg registered (SfM -27..-47), head-up frames
# 41 -> 60, but the fixed slots left the other poses (registered 410 -> 397) and the same-person side difference grew
# (2.99 -> 3.36 % head width): the fit keeps head and neck as one piece, so more head-up poses disagree under the chin.
# Kept at 30 until the under-chin / neck fit uses them (jaw-obs plan, neck joint).
CANDIDATES = 4              # frames read per slot (evenly over the slot's frames); the sharpest is kept


def _profile_rows(rows, smooth):
    """rows where the face is lost on a side (after a turn past NOFACE_SIDE_DEG, from NOFACE_MIN_MS on) -> {row: side}"""
    out, last_yaw, lost_at = {}, 0.0, None
    for i, r in enumerate(rows):
        if i in smooth:
            lost_at, last_yaw = None, smooth[i][0]
            continue
        lost_at = r[0] if lost_at is None else lost_at
        if abs(last_yaw) >= NOFACE_SIDE_DEG and r[0] - lost_at >= NOFACE_MIN_MS:
            out[i] = 1 if last_yaw > 0 else -1
    return out


# 11/10 (S15P31B204-735): the left / right progress comes from the phone gyro when the recording has a usable one, and the
# usual head height counts as one row. Root causes left after the 11/09 check (9 dev web recordings, A-plan):
#  R1 profile holds: no face angle past ~60 deg, so the profile got time-slot frames -> 45 % of the frames past 55 deg
#     sat within 1 deg of another (131 of 294)
#  R2 the tracker yaw reads the + side 0.87 x (0.73-0.94) of the true (SfM) angle -> fewer cells there, 5 gaps at 15-40 deg
#  R3 60-77 deg the face is found / lost in turns: neither cells nor profile time -> 4 (+2) gaps
#  R4 on the way back from the left end the head is 2-5 deg higher or lower: 142 of 191 cells opened there were a yaw
#     already seen at another height
# The gyro (capture trace "gyro", [t_ms, deg] turned about the vertical, S15P31B204-677 / -733) measures the phone's turn
# around the face: 0.99-1.13 x the SfM angle on 11/10 iPhone 17 Pro / Galaxy S24 recordings, within about +-10 deg
# (15-23 at the profile ends), and holds show as a flat line. Only "is this a new yaw / did it stop" is used, never the
# absolute angle. It is lined up with the face yaw of the same recording (sign and offset from the frames where the face is
# seen) - no per-person value. Not usable (none, the wrong-axis values recorded before !591 that turn 13-24 deg for a
# whole sweep, or a head turned instead of the phone) -> the face-tracker rules above, unchanged.
# Within LEVEL_BAND_DEG of the front pitch only the yaw counts (R4); past it the pitch cells are the A안 2.5 deg ones,
# so head up / down keeps its A안 share of the frames - those are the only views under the chin, the least observed
# part (jaw-obs-plan-1109). (5 deg cells there cut the registered head-up frames 10 -> 7, and weighting them 2 put two
# frames in the same 0.1 s: 2 -> 11 pairs, Galaxy S24, 11/10.)
LEVEL_BAND_DEG = 10.0
GYRO_FIT_DEG = 45.0         # face rows within this yaw line the gyro up with the face yaw
GYRO_SLOPE = (0.5, 2.0)     # gyro deg per face-yaw deg allowed (11/10: 0.93-1.07 / 1.15-1.34; pre-!591 values ~0.1)
GYRO_CORR = 0.8             # and this straight a relation (a head turned instead of the phone breaks it)


def _switch(name):
    """experiment switches (frames_bundle passes the environment): EXTRACT_POSE_LEVEL / EXTRACT_POSE_GYRO = 0 turn one off"""
    import os
    return os.environ.get(name, "1") != "0"


def _interp(ts, vs, t):
    import bisect
    j = bisect.bisect_left(ts, t)
    if j <= 0: return vs[0]
    if j >= len(ts): return vs[-1]
    t0, t1 = ts[j - 1], ts[j]
    return vs[j - 1] + (vs[j] - vs[j - 1]) * (t - t0) / (t1 - t0) if t1 > t0 else vs[j]


def gyro_yaw(rows, smooth, gyro, version=None):
    """-> (t_ms -> yaw in the face-yaw sign and zero, info) or (None, info). The fit uses the face rows within
    GYRO_FIT_DEG: sign from the slope, offset = median(gyro - sign * yaw)."""
    if not gyro or len(gyro) < 20: return None, {"gyro": "missing"}
    if version is not None and version < 2: return None, {"gyro": "rejected", "reason": f"gyroVersion {version}"}
    ts = [float(g[0]) for g in gyro]; vs = [float(g[1]) for g in gyro]
    pts = [(smooth[i][0], _interp(ts, vs, rows[i][0])) for i in smooth if abs(smooth[i][0]) < GYRO_FIT_DEG]
    if len(pts) < 20: return None, {"gyro": "rejected", "reason": f"{len(pts)} face rows to line up"}
    n = len(pts); my = sum(p[0] for p in pts) / n; mg = sum(p[1] for p in pts) / n
    syy = sum((p[0] - my) ** 2 for p in pts); sgg = sum((p[1] - mg) ** 2 for p in pts); syg = sum((p[0] - my) * (p[1] - mg) for p in pts)
    slope = syg / syy if syy else 0.0; corr = syg / (syy * sgg) ** 0.5 if syy and sgg else 0.0
    info = {"slope": round(slope, 2), "corr": round(corr, 2)}
    if not (GYRO_SLOPE[0] <= abs(slope) <= GYRO_SLOPE[1] and abs(corr) >= GYRO_CORR):
        return None, {"gyro": "rejected", "reason": "does not follow the face yaw", **info}
    sign = 1.0 if slope > 0 else -1.0
    off = sorted(g - sign * y for y, g in pts)[n // 2]
    return (lambda t: sign * (_interp(ts, vs, t) - off)), {"gyro": "used", **info, **({"version": version} if version else {})}


def trace_progress(rows, gyro=None, gyro_version=None):
    """web guide trace rows [t_ms, yaw, pitch, found] (+ the gyro rows) -> [(t_ms, progress)], progress in pose cells."""
    return trace_progress_info(rows, gyro, gyro_version)[0]


def trace_progress_info(rows, gyro=None, gyro_version=None):
    """-> ([(t_ms, progress)], info). Progress grows by 1 for each pose cell reached the first time."""
    found = [i for i, r in enumerate(rows) if r[3] == 1 and r[1] is not None and r[2] is not None]
    med = lambda v: sorted(v)[len(v) // 2]
    smooth = {}
    for j, i in enumerate(found):
        win = found[max(0, j - SMOOTH): j + SMOOTH + 1]
        smooth[i] = (med([rows[k][1] for k in win]), med([rows[k][2] for k in win]))
    # head up / down is measured from this recording's front pose (phones held low or high read -7 .. +9 deg at the
    # front on the 11/09 dev recordings), so the PITCH_MAX_DEG window follows the person, not the camera height
    front = [v[1] for v in smooth.values() if abs(v[0]) < 12]
    pitch0 = med(front) if front else 0.0
    level = _switch("EXTRACT_POSE_LEVEL")
    yaw_of, info = gyro_yaw(rows, smooth, gyro, gyro_version) if _switch("EXTRACT_POSE_GYRO") else (None, {"gyro": "off"})
    info["level_band"] = LEVEL_BAND_DEG if level else None

    def cell(yaw, pitch):
        """pose cell of a row, None when the head is up / down past the limit. pitch None = face not seen (profile)"""
        if pitch is not None and abs(pitch - pitch0) > PITCH_MAX_DEG: return None
        yc = round(yaw / CELL_YAW_DEG)
        if level and (pitch is None or abs(pitch - pitch0) <= LEVEL_BAND_DEG): return (yc, "L")   # the usual height
        return (yc, "P" if pitch is None else round(pitch / CELL_PITCH_DEG))

    new_cell, seen = set(), set()
    for i, r in enumerate(rows):
        if yaw_of is None and i not in smooth: continue
        c = cell(yaw_of(r[0]) if yaw_of else smooth[i][0], smooth[i][1] if i in smooth else None)
        if c is not None and c not in seen:
            seen.add(c); new_cell.add(i)
    lost_ms, rate = {}, 0.0
    if yaw_of is None:
        # no usable gyro: the profile gets the time-slot share. With C cells, T ms recorded and B ms of profile, each
        # profile ms is worth C / (T - B) so that the profile gets B / T of the frames, as time slots give it
        lost_ms = {i: rows[i][0] - rows[i - 1][0] for i in _profile_rows(rows, smooth) if i}
        span = float(rows[-1][0] - rows[0][0]) if rows else 0.0
        rate = len(new_cell) / (span - sum(lost_ms.values())) if span > sum(lost_ms.values()) else 0.0
    p, out = 0.0, []
    for i, r in enumerate(rows):
        p += 1.0 if i in new_cell else rate * lost_ms.get(i, 0.0)
        out.append((float(r[0]), p))
    return out, info


def progress_at(times_ms, prog):
    """progress of every frame time, linear between trace samples (constant before the first / after the last)."""
    out, j = [], 0
    for t in times_ms:
        while j + 1 < len(prog) and prog[j + 1][0] <= t: j += 1
        if t <= prog[0][0] or j + 1 >= len(prog): out.append(prog[0][1] if t <= prog[0][0] else prog[-1][1]); continue
        (t0, p0), (t1, p1) = prog[j], prog[j + 1]
        out.append(p0 + (p1 - p0) * (t - t0) / (t1 - t0) if t1 > t0 else p1)
    return out


def progress_slots(progress, n):
    """n slots evenly over the frames' progress -> {frame number: slot}, up to CANDIDATES frames per slot spread over
    the frames in it (the sharpest is kept later). A slot with no frame (a jump between two frames) stays empty."""
    total = progress[-1] - progress[0] if progress else 0.0
    if total <= 0: return {}
    members = {}
    for k, p in enumerate(progress):
        members.setdefault(min(n - 1, int((p - progress[0]) / total * n)), []).append(k)
    want = {}
    for i, ks in members.items():
        m = min(CANDIDATES, len(ks))
        for c in range(m):
            want[ks[(2 * c + 1) * len(ks) // (2 * m)]] = i
    return want
