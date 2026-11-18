"""HEAD masks for structure-from-motion: face + hair + ears, nothing below the chin.

Why (2026-10-15):
  - face-only masks (prepare_capture) leave ~150-300 SIFT points per webcam frame -> unstable camera poses
  - full frames include things that do NOT move with the head: a still background (fixed camera, head turning) or the
    shoulders / clothes / hands (they turn differently from the head; eun01 turns the whole body and gestures)
  - hair and ears move rigidly with the head and are well textured: p01 frame pairs 61 -> 165 consistent matches
    (14 -> 34 at 50 deg), eun01 87 -> 232
The head region is valid whether the camera is fixed (person turns) or moving (person still), so it is the default.
Frames where MediaPipe finds no face (near 90 deg profiles) get the union of the nearest found masks, enlarged.
usage: python head_masks.py <prep dir>   -> <prep>/head_masks/<image>.png (COLMAP convention: <name>.png, 255 = use)
"""
import json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150,
        136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]


def build(prep, scale=1.55, up=0.12, seg=True, person_cut=False):
    import cv2, mediapipe as mp
    images = os.path.join(prep, "images"); out = os.path.join(prep, "head_masks_pc" if person_cut else "head_masks"); os.makedirs(out, exist_ok=True)
    det = mp.tasks.vision.FaceLandmarker.create_from_options(mp.tasks.vision.FaceLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_buffer=open(os.path.join(HERE, "..", "assets", "face_landmarker.task"), "rb").read()), num_faces=1))
    names = sorted(n for n in os.listdir(images) if n.lower().endswith((".jpg", ".jpeg", ".png")))
    masks, shape = {}, None
    for n in names:
        im = cv2.imread(os.path.join(images, n)); H, W = im.shape[:2]; shape = (H, W)
        r = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(cv2.cvtColor(im, cv2.COLOR_BGR2RGB))))
        if not r.face_landmarks: masks[n] = None; continue
        uv = np.array([[p.x * W, p.y * H] for p in r.face_landmarks[0]])
        hull = uv[OVAL]; c = hull.mean(0); big = c + (hull - c) * scale
        big[:, 1] -= up * (uv[152, 1] - uv[10, 1])                      # more room above the forehead (hair)
        m = np.zeros((H, W), np.uint8); cv2.fillPoly(m, [cv2.convexHull(big.astype(np.int32))], 255)
        m[int(min(H, uv[152, 1] + 0.03 * H)):] = 0                       # nothing below the chin: neck, shoulders, hands
        masks[n] = m
    found = [i for i, n in enumerate(names) if masks[n] is not None]
    filled, seg_refined = 0, 0
    noface = [n for n in names if masks[n] is None]
    # 2026-10-19 (90 deg capture): a profile hold of ~3 s has no face for many frames in a row, so the neighbour masks
    # can be far from where the head is. With the multiclass segmentation the mask is the head itself (hair + face
    # skin blob near the neighbour masks), slightly enlarged; the neighbour union stays the fallback.
    CM = {}
    if noface and seg:
        try:
            from outline_obs import class_masks
            CM = class_masks(images, noface, os.path.join(prep, "class_masks"))
        except Exception as ex:
            print("head_masks: segmentation unavailable:", ex, flush=True)
    for i, n in enumerate(names):
        if masks[n] is None and found:
            near = sorted(found, key=lambda j: abs(j - i))[:2]           # neighbours in time (frames are in video order)
            m = np.maximum.reduce([masks[names[j]] for j in near])
            k = max(3, int(0.08 * max(shape)))
            masks[n] = cv2.dilate(m, np.ones((k, k), np.uint8)); filled += 1
            cm = CM.get(n)
            if cm is not None and cm.shape == shape:
                head = np.isin(cm, (1, 3)).astype(np.uint8)
                near_zone = cv2.dilate(m, np.ones((2 * k + 1, 2 * k + 1), np.uint8)) > 0
                nb, lab, st, _ = cv2.connectedComponentsWithStats(head)
                best, best_a = 0, 0
                for c in range(1, nb):
                    a_in = int((near_zone & (lab == c)).sum())
                    if a_in > best_a: best, best_a = c, a_in
                if best and best_a > 0.25 * (m > 0).sum():
                    kk = max(3, int(0.02 * max(shape)))
                    masks[n] = cv2.dilate((lab == best).astype(np.uint8) * 255, np.ones((kk, kk), np.uint8)); seg_refined += 1
    # 2026-10-24 (default, 만두 decision): BACKGROUND removed from the head mask with the multiclass person segmentation
    # (any person class: face / body skin, hair, clothes, accessories). A selfie has the room and the head moving
    # differently; background points inside the enlarged head mask pulled the camera-to-room motion into SfM and folded a
    # whole side onto the frontal pose (woo03 left, eun03 left, seo01 right: rotation agreement -0.25 / -0.62 / -0.74 ->
    # -1.12 / -1.02 / -1.10; healthy gyu01 / woo02 / chae01 / min01 unchanged). Hair is kept (removing it gave nothing and
    # lost 6 woo03 frames). The head mask still bounds the region: body / arms / hands below or beside it stay out.
    n_cut, kept = 0, []
    if person_cut:
        try:
            from outline_obs import class_masks
            CMa = class_masks(images, names, os.path.join(prep, "class_masks"))
        except Exception as ex:
            print("head_masks: segmentation unavailable, background kept:", ex, flush=True); CMa = {}
        for n in names:
            cm = CMa.get(n)
            if masks[n] is None or cm is None or cm.shape != masks[n].shape: continue
            before = int((masks[n] > 0).sum())
            masks[n] = np.where(cm > 0, masks[n], 0).astype(np.uint8); n_cut += 1
            kept.append((masks[n] > 0).sum() / max(before, 1))
    for n in names:
        if masks[n] is not None: cv2.imwrite(os.path.join(out, n + ".png"), masks[n])
    info = {"frames": len(names), "face_found": len(found), "filled_from_neighbours": filled, "profile_seg_refined": seg_refined,
            "person_cut": bool(person_cut), "person_cut_frames": n_cut, "person_cut_kept_median": round(float(np.median(kept)), 3) if kept else None,
            "mean_area_pct": round(float(np.mean([(masks[n] > 0).mean() for n in names if masks[n] is not None])) * 100, 2)}
    json.dump(info, open(os.path.join(out, "head_masks.json"), "w"))
    return out, info


if __name__ == "__main__":
    print(json.dumps(build(sys.argv[1])[1]))
