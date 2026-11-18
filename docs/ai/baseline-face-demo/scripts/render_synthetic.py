"""표준 라이브러리만으로 합성 얼굴 높이장의 정면·측면 PNG를 만든다."""

import math
import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SIZE = 512
WIDTHS = [(-1.0, 0.03), (-0.72, 0.26), (-0.55, 0.45), (-0.06, 0.58),
          (0.45, 0.50), (0.85, 0.31), (1.0, 0.03)]
BG = (248, 246, 244)


def half_width(y):
    for (y0, w0), (y1, w1) in zip(WIDTHS, WIDTHS[1:]):
        if y0 <= y <= y1:
            t = (y - y0) / (y1 - y0)
            t = t * t * (3 - 2 * t)
            return w0 + (w1 - w0) * t
    return 0.0


def surface(x, y):
    width = half_width(y)
    if width <= 0 or abs(x) >= width:
        return None
    roundness = math.sqrt(max(0.0, 1 - (x / width) ** 2))
    tip = 0.27 * math.exp(-((x / 0.12) ** 2 + ((y + 0.12) / 0.22) ** 2))
    bridge = 0.06 * math.exp(-((x / 0.16) ** 2 + ((y - 0.19) / 0.32) ** 2))
    sockets = sum(
        0.05 * math.exp(-(((x - side * 0.25) / 0.09) ** 2 + ((y - 0.23) / 0.09) ** 2))
        for side in (-1, 1)
    )
    return 0.50 + 0.18 * roundness + tip + bridge - sockets


def shade(x, y):
    z = surface(x, y)
    if z is None:
        return BG
    step = 0.002
    left = surface(x - step, y)
    right = surface(x + step, y)
    up = surface(x, y + step)
    down = surface(x, y - step)
    dx = ((right if right is not None else z) - (left if left is not None else z)) / (2 * step)
    dy = ((up if up is not None else z) - (down if down is not None else z)) / (2 * step)
    normal = (-dx, -dy, 1.0)
    length = math.sqrt(sum(value * value for value in normal))
    light = (-0.30, 0.45, 0.84)
    brightness = 0.60 + 0.40 * max(0.0, sum(a * b for a, b in zip(normal, light)) / length)
    return tuple(round(base * brightness) for base in (235, 211, 197))


def front_pixel(px, py):
    x = (px - 256) / 360
    y = (255 - py) / 210
    color = shade(x, y)
    if color == BG:
        return color
    if any(((x - side * 0.25) / 0.055) ** 2 + ((y - 0.23) / 0.019) ** 2 < 1 for side in (-1, 1)):
        return (77, 62, 61)
    if abs(y + 0.55) < 0.009 and abs(x) < 0.16 * (1 - abs(y + 0.55) * 8):
        return (131, 94, 91)
    return color


def profile_pixel(px, py):
    y = (255 - py) / 210
    if not -1 < y < 1:
        return BG
    front = surface(0, y)
    if front is None:
        return BG
    z = (px - 145) / 235 - 0.30
    back = -0.30 * math.sqrt(max(0, 1 - y * y))
    if not back <= z <= front:
        return BG
    brightness = 0.68 + 0.23 * (z - back) / max(0.01, front - back) + 0.09 * (y + 1) / 2
    color = tuple(round(base * brightness) for base in (235, 211, 197))
    if ((z - (front - 0.10)) / 0.025) ** 2 + ((y - 0.23) / 0.028) ** 2 < 1:
        return (77, 62, 61)
    if abs(y + 0.55) < 0.012 and front - 0.12 < z < front - 0.02:
        return (131, 94, 91)
    return color


def png_bytes(pixel):
    rows = []
    for y in range(SIZE):
        rows.append(b"\0" + bytes(channel for x in range(SIZE) for channel in pixel(x, y)))
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
        + chunk(b"IEND", b"")
    )


def png(path, pixel):
    path.write_bytes(png_bytes(pixel))


if __name__ == "__main__":
    fixtures = ROOT / "fixtures"
    fixtures.mkdir(exist_ok=True)
    png(fixtures / "front.png", front_pixel)
    png(fixtures / "profile.png", profile_pixel)
