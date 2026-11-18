"""Face orientation from the most frontal camera of a COLMAP model (head-turn capture: head-relative cameras).
up  = image up (-y) of the frontal camera in world coordinates, corrected by the MediaPipe head pitch of that frame
fwd = from the face toward that camera (-z)
usage: python frontal_axes.py <sparseModel> <prepare.json>   -> prints {"up": "x,y,z", "fwd": "x,y,z", "frame": ...}
Used instead of render-based auto-orientation when the dense mesh is too fragmented to show a face.
"""
import json, sys
import numpy as np


def main():
    import pycolmap
    rec = pycolmap.Reconstruction(sys.argv[1])
    prep = json.load(open(sys.argv[2], encoding="utf-8"))
    info = {i["file"]: i for i in prep["images"] if i.get("yaw") is not None}
    ims = [i for i in rec.images.values() if i.name in info]
    im = min(ims, key=lambda i: abs(info[i.name]["yaw"]) + abs(info[i.name]["pitch"] or 0))
    R = im.cam_from_world().rotation.matrix()  # rows = camera axes in world
    up, fwd = -R[1], -R[2]
    # undo the head pitch of that frame (rotate about the camera x axis)
    p = np.radians(info[im.name]["pitch"] or 0.0); x = R[0]
    rot = lambda v: v * np.cos(p) + np.cross(x, v) * np.sin(p) + x * np.dot(x, v) * (1 - np.cos(p))
    up, fwd = rot(up), rot(fwd)
    print(json.dumps({"up": ",".join(f"{t:.6f}" for t in up), "fwd": ",".join(f"{t:.6f}" for t in fwd), "frame": im.name,
                      "yaw": info[im.name]["yaw"], "pitch": info[im.name]["pitch"]}))


if __name__ == "__main__":
    main()
