"""Printable scale card: two ArUco markers (DICT_4X4_50, ids 0 and 1), 40 mm each, centres 80 mm apart, plus a 50 mm
check bar. Print at 100% scale, verify the bar with a ruler, tape the card flat on the subject's collar/shoulder (or a
stand next to the face) so it appears in most photos. Output: marker_card.png (300 dpi) and marker_card.pdf.
usage: python make_marker_sheet.py <outDir>
"""
import json
import os
import sys

import numpy as np

MARKER_MM, GAP_MM, DPI = 40.0, 40.0, 300


def mm2px(mm):
    return int(round(mm / 25.4 * DPI))


def main(out):
    import cv2
    from PIL import Image, ImageDraw
    os.makedirs(out, exist_ok=True)
    d = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    W, H = mm2px(140), mm2px(85)
    card = Image.new("L", (W, H), 255)
    draw = ImageDraw.Draw(card)
    s = mm2px(MARKER_MM)
    x0, y0 = mm2px(10), mm2px(10)
    for k in range(2):
        mk = cv2.aruco.generateImageMarker(d, k, s)
        card.paste(Image.fromarray(mk), (x0 + k * (s + mm2px(GAP_MM)), y0))
    # 50 mm check bar
    by = y0 + s + mm2px(12)
    draw.rectangle([x0, by, x0 + mm2px(50), by + mm2px(2)], fill=0)
    draw.text((x0, by + mm2px(4)), "50 mm check bar - print at 100%; markers 40 mm, centres 80 mm apart (ArUco 4x4 id 0,1)", fill=0)
    card.save(os.path.join(out, "marker_card.png"), dpi=(DPI, DPI))
    card.convert("RGB").save(os.path.join(out, "marker_card.pdf"), resolution=DPI)
    spec = {"dictionary": "DICT_4X4_50", "ids": [0, 1], "marker_side_mm": MARKER_MM,
            "centre_distance_mm": MARKER_MM + GAP_MM, "check_bar_mm": 50, "dpi": DPI}
    json.dump(spec, open(os.path.join(out, "marker_card.json"), "w"), indent=1)
    print(json.dumps(spec))


if __name__ == "__main__":
    main(sys.argv[1])
