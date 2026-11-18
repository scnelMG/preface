"""Camera information stored in ORIGINAL phone videos (2026-10-19, lens policy step 2: file information).

iPhone .mov files carry QuickTime metadata (keys + ilst): com.apple.quicktime.model ("iPhone 17 Pro"),
camera.lens_model ("iPhone 17 Pro front camera 2.715mm f/1.9"), camera.focal_length.35mm_equivalent ("20").
Samsung .mp4 originals (2026-10-22, gyu01 S24+) carry only the model (udta/auth, udta/smta/mdln). Models launched with
Android 15+ also get udta/smta/lens (2026-10-30, Z Flip7): 35 mm equivalents of the 4:3 still -> samsung_focal35.
Videos re-sent through messengers (KakaoTalk: re-encoded by Lavf) lose all of it -> nothing is returned.
usage: python video_meta.py <video>   -> JSON {model, lens_model, focal35, make, software}
"""
import json, os, struct, sys

CONTAINERS = {"moov", "trak", "udta", "mdia", "minf"}


def _atoms(d, off, end):
    while off + 8 <= end:
        sz, typ = struct.unpack(">I4s", d[off:off + 8]); hdr = 8
        if sz == 1: sz = struct.unpack(">Q", d[off + 8:off + 16])[0]; hdr = 16
        elif sz == 0: sz = end - off
        if sz < 8 or off + sz > end: return
        yield typ.decode("latin1"), off, off + hdr, off + sz
        off += sz


def _meta_items(d, b, e):
    """keys + ilst inside one 'meta' atom -> {key: value}"""
    # QuickTime 'meta' (no version field) vs ISO full box (4-byte version/flags): try both
    for start in (b, b + 4):
        keys, vals = None, {}
        try:
            kids = list(_atoms(d, start, e))
        except Exception:
            continue
        if not any(t == "hdlr" for t, *_ in kids): continue
        for t, o, bb, ee in kids:
            if t == "keys":
                n = struct.unpack(">I", d[bb + 4:bb + 8])[0]; p = bb + 8; keys = []
                for _ in range(n):
                    ks = struct.unpack(">I", d[p:p + 4])[0]
                    keys.append(d[p + 8:p + ks].decode("utf8", "replace")); p += ks
            elif t == "ilst":
                for t2, o2, b2, e2 in _atoms(d, bb, ee):
                    idx = struct.unpack(">I", d[o2 + 4:o2 + 8])[0]
                    for t3, o3, b3, e3 in _atoms(d, b2, e2):
                        if t3 != "data": continue
                        tp = struct.unpack(">I", d[b3:b3 + 4])[0]; pay = d[b3 + 8:e3]
                        if tp == 1: vals[idx] = pay.decode("utf8", "replace")
                        elif tp == 23 and len(pay) == 4: vals[idx] = struct.unpack(">f", pay)[0]
                        elif tp == 24 and len(pay) == 8: vals[idx] = struct.unpack(">d", pay)[0]
                        elif tp in (21, 22) and 0 < len(pay) <= 8: vals[idx] = int.from_bytes(pay, "big", signed=tp == 21)
        if keys:
            return {k: vals.get(i) for i, k in enumerate(keys, 1) if vals.get(i) is not None}
    return {}


def _samsung_lens(pay):
    """udta/smta/lens payload -> [mm, mm, mm] or None. Z Flip7 (SM-F766N) original, 2026-10-30:
    00 00 00 00 | 16 | 00 17 | 00 17 = 22, 23, 23. The Samsung camera app writes it only on models launched with Android 15+
    (S24+ originals have no lens box). Read as 35 mm equivalents of the 4:3 still: the Flip5 / Flip6 spec 85 deg is 23.6 mm.
    Which of the values belongs to the video is not confirmed (S15P31B204-467)"""
    if len(pay) != 9: return None
    vals = [pay[4], int.from_bytes(pay[5:7], "big"), int.from_bytes(pay[7:9], "big")]
    return vals if all(10 <= v <= 60 for v in vals) else None


def read(path):
    out = {}
    try:
        with open(path, "rb") as fh: d = fh.read()
    except Exception:
        return out
    sam = {}
    def walk(b, e, depth=0):
        for t, o, bb, ee in _atoms(d, b, e):
            if t == "meta": out.update(_meta_items(d, bb, ee))
            # Samsung camera (2026-10-22, gyu01 S24+ original): udta/auth = "Galaxy S24+" (3GPP full box + language),
            # udta/smta/mdln = "SM-S926N". No lens / focal length is stored. udta/©xyz (GPS) is deliberately not read.
            elif t == "auth" and ee - bb > 6:
                sam["name"] = d[bb + 6:ee].split(b"\0")[0].decode("utf8", "replace").strip()
            elif t == "smta":
                for t2, o2, b2, e2 in _atoms(d, bb + 4, ee):
                    if t2 == "mdln": sam["code"] = d[b2:e2].split(b"\0")[0].decode("latin1").strip()
                    elif t2 == "lens": sam["lens"] = _samsung_lens(d[b2:e2])
            elif t in CONTAINERS and depth < 6: walk(bb, ee, depth + 1)
    top = [(t, bb, ee) for t, o, bb, ee in _atoms(d, 0, len(d)) if t == "moov"]
    for _, bb, ee in top: walk(bb, ee)
    res = {}
    if sam.get("code") or sam.get("name"):
        # model code first: device_profiles.json matches "SM-S926" etc.
        res["model"] = " ".join(x for x in (sam.get("name"), f"({sam['code']})" if sam.get("code") else None) if x)
        res["make"] = "samsung"
        if out.get("com.android.version") is not None: res["software"] = f"Android {out['com.android.version']}"
        if sam.get("lens"):
            res["samsung_lens"] = sam["lens"]
            res["samsung_focal35"] = float(max(sam["lens"], key=sam["lens"].count))   # 22, 23, 23 -> 23
    for k, v in out.items():
        short = k.split("com.apple.quicktime.")[-1]
        if short in ("model", "make", "software", "camera.lens_model", "camera.focal_length.35mm_equivalent"):
            res[short.replace("camera.", "").replace("focal_length.35mm_equivalent", "focal35")] = v
    if "focal35" in res:
        try: res["focal35"] = float(res["focal35"])
        except (TypeError, ValueError): res.pop("focal35")
    return res


def same_model_focal35(model, root, exclude=(), cache=None):
    """2026-10-23 (만두: "영상 안의 렌즈값 우선, 없으면 같은 정보가 있는 파일의 값"): a video that lost its lens record
    (trimmed / edited in the Photos app, woo03) takes the 35 mm equivalent RECORDED in another original video of the SAME
    model under `root` (exact model string, e.g. "iPhone 12"). Returns (focal35, [files]) for the most common value, or
    (None, []). Results per file are cached by size + mtime (`cache` json path) because read() loads the whole file."""
    import collections
    vids = []
    for d, _, fs in os.walk(root):
        vids += [os.path.join(d, f) for f in fs if f.lower().endswith((".mov", ".mp4", ".m4v"))]
    ex = {os.path.normcase(os.path.abspath(p)) for p in exclude}
    store = {}
    if cache and os.path.exists(cache):
        try: store = json.load(open(cache, encoding="utf-8"))
        except Exception: store = {}
    hits = collections.defaultdict(list)
    for v in sorted(vids):
        if os.path.normcase(os.path.abspath(v)) in ex: continue
        st = os.stat(v); key = os.path.abspath(v)
        if store.get(key, {}).get("stamp") != [st.st_size, int(st.st_mtime)]:
            store[key] = {"stamp": [st.st_size, int(st.st_mtime)], "meta": read(v)}
        m = store[key]["meta"]
        if m.get("model") == model and m.get("focal35"): hits[float(m["focal35"])].append(os.path.relpath(v, root))
    if cache:
        try: json.dump(store, open(cache, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        except Exception: pass
    if not hits: return None, []
    f35 = max(hits, key=lambda k: len(hits[k]))
    return f35, hits[f35]


# narrower video field than the 4:3 still: measured on the S24 (eun01, assets/device_profiles.json galaxy-s24-front)
SAMSUNG_VIDEO_CROP = 1.09


def focal_px_from_still_35mm(f35, width, height, video_crop=SAMSUNG_VIDEO_CROP):
    """35 mm equivalent of the 4:3 STILL (Samsung lens box) -> focal length in px of the video frame. Same rule as the
    device profiles (run_all.device_focal): the long side carries the long side of the 4:3 sensor, times the video crop"""
    t_long = 21.633 / f35 * 4 / 5                       # half diagonal 21.63 mm, long side = 4/5 of the 4:3 diagonal
    return max(width, height) / 2 / t_long * video_crop


def focal_px_from_35mm(f35, width, height):
    """35 mm equivalent focal length of the recorded frame -> focal length in pixels (diagonal convention)"""
    import math
    diag_px = math.hypot(width, height)
    return f35 / 43.267 * diag_px                      # 43.27 mm = 35 mm film diagonal


def focal_px_on_frame(f35, frame_size, still=False):
    """35 mm equivalent recorded in the video file -> px focal on the PREPARED frame "WxH" (run_all lens stage).
    S15P31B204-565: never the original video size - prepare shrinks 4K to 1920 px and the camera model is built on
    those frames. still=True: the Samsung lens box (35 mm equivalent of the 4:3 still)"""
    w, h = (int(v) for v in frame_size.split("x"))
    return round((focal_px_from_still_35mm if still else focal_px_from_35mm)(f35, w, h), 1)


if __name__ == "__main__":
    print(json.dumps(read(sys.argv[1]), ensure_ascii=False))
