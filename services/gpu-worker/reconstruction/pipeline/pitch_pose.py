"""Camera poses of chin-up / chin-down frames from FACE features (N2 of docs/nose-design.md, option --recover-pitch, off).

Origin: the team's nose work (live-mirror-poc-nose-20261023, pipeline/pitch_pose.py, 10/21-22), ported with two changes
found in our check on the six originals (DEV-LOG 10/24 "팀원 코 작업 검증"):
  1. a KEPT frame's pose is replaced only when the face-feature PnP is better on points it was NOT solved on (the correspondences
     are split in two halves: solve on one, compare stored vs new on the other, both ways). The team's rule compared both on
     the PnP's own inliers, which always favours the PnP (seo01: 25 / 45 kept frames replaced, woo03 20 with a median turn
     of 11.4 deg; their eun03 run replaced 28 and the side hold-out got worse 4.10 -> 6.32)
  2. the NOSE region is left out of the lifted points in every mode (the team did this only with --all): otherwise a recovered
     pose would be pulled onto the model's own nose, the very part the nostril fit / the nose judge look at
Problem (team, me01 = chae01 file): chin-up / chin-down frames are dropped by the pose check (MediaPipe points 9-30 px off)
although their SfM reprojection is fine: the head mask includes the wall around a tilted head, so these frames register to
the WALL. Without them the underside of the nose is only seen at grazing angles (docs/nose-design.md R1).
Method (per frame D; the model and the poses of the reference frames are trusted):
  1. face region of D = MediaPipe face oval (x 1.05; kept frames: the model's face skin projected with the stored pose)
  2. raw COLMAP matches D <-> every reference frame G; G's keypoint is lifted onto the fitted model surface by casting its ray
     into the model rendered with G's pose (front-most face-skin triangle, not scalp / eyes / mouth / nose)
  3. one 3D point per keypoint of D (median over the G frames, dropped if they disagree by > 3 % IOD) -> PnP RANSAC (4 px) + LM
  4. dropped frame accepted when >= 15 inliers (25 with --keep-nose), median reprojection <= 2.5 px on the inliers AND <= 2.5 px on the held-back
     half (pose solved on the other half), and the model's nose tip projects inside the face oval
  5. up to 3 rounds (6 with --all): frames recovered in a round are references in the next
--all: also the kept frames; references start as the near-frontal frames (|yaw| < 25, |pitch| < 8). Replaced frames get status
"face_pnp", recovered dropped frames "recovered" (every later step treats both like "ok"). The input JSON is copied once to
<poses>.pre_pitch.json before it is rewritten.
usage: python pitch_pose.py <work> <fit.ply> <fit.json> <sparse> <frame_poses.json> [--all] [--debug check.jpg]  -> JSON stats
"""
import argparse, json, os, shutil, sqlite3, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import meshio  # noqa
from frame_check import intrinsics  # noqa

OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149,
        150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
PAIR = 2147483647
NOSE_R = 0.35                       # x IOD around the nose tip: left out of the lifted points


def index_buffer(V, F, R, t, K, shape):
    """triangle id per pixel (front-most), -1 = none"""
    import cv2
    X = V @ R.T + t; z = X[:, 2]
    uv = (X[:, :2] / z[:, None]) * [K[0, 0], K[1, 1]] + [K[0, 2], K[1, 2]]
    ok = (z[F] > 0).all(1)
    e1 = uv[F[:, 1]] - uv[F[:, 0]]; e2 = uv[F[:, 2]] - uv[F[:, 0]]
    ok &= (e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]) != 0
    idx = np.full(shape, -1, np.int32); pts = np.round(uv[F] * 4).astype(np.int32)
    for k in np.where(ok)[0][np.argsort(-z[F[ok]].mean(1))]:
        cv2.fillPoly(idx, [pts[k]], int(k), shift=2)
    return idx


def ray_hit(V, F, tri, R, t, K, xy):
    """3D points where the camera rays through pixels xy meet the planes of triangles tri"""
    C = -R.T @ t
    d = (np.linalg.inv(K) @ np.c_[xy, np.ones(len(xy))].T).T @ R
    A, B, Cc = V[F[tri, 0]], V[F[tri, 1]], V[F[tri, 2]]
    n = np.cross(B - A, Cc - A)
    s = ((A - C) * n).sum(1) / np.where(np.abs((d * n).sum(1)) < 1e-12, 1e-12, (d * n).sum(1))
    return C + s[:, None] * d


def read_db(path):
    db = sqlite3.connect(path)
    names = dict(db.execute("select image_id, name from images").fetchall())
    kps = {}
    for iid, rows, cols, data in db.execute("select image_id, rows, cols, data from keypoints"):
        if rows: kps[iid] = np.frombuffer(data, np.float32).reshape(rows, cols)[:, :2]
    matches = {}
    for pid, rows, cols, data in db.execute("select pair_id, rows, cols, data from matches"):
        if not rows: continue
        i2 = pid % PAIR; i1 = (pid - i2) // PAIR
        matches[(int(i1), int(i2))] = np.frombuffer(data, np.uint32).reshape(rows, cols)
    return names, kps, matches


def face_oval(images, name, img):
    import face_lm
    L, _ = face_lm.landmarks(images, name, img)
    if L is None: return None
    H, W = img.shape[:2]
    P = np.array(L)[OVAL, :2] * [W, H]
    c = P.mean(0); return c + 1.05 * (P - c)


def solve(pts3, pts2, K, min_inl):
    """PnP RANSAC + LM -> (rvec, tvec, inlier idx) or None"""
    import cv2
    if len(pts2) < min_inl: return None
    ok, rv, tv, inl = cv2.solvePnPRansac(pts3, pts2, K, None, iterationsCount=3000, reprojectionError=4.0, confidence=0.999, flags=cv2.SOLVEPNP_EPNP)
    if not ok or inl is None or len(inl) < min_inl: return None
    inl = inl.ravel(); rv, tv = cv2.solvePnPRefineLM(pts3[inl], pts2[inl], K, None, rv, tv)
    return rv, tv, inl


def med_err(pts3, pts2, rv, tv, K):
    import cv2
    pr, _ = cv2.projectPoints(pts3, rv, tv, K, None); return float(np.median(np.linalg.norm(pr.reshape(-1, 2) - pts2, axis=1)))


def held_out(pts3, pts2, K, rv_old, tv_old, min_inl):
    """split-half check: solve on one half, score the stored and the new pose on the other half; both directions.
    -> (median px stored, median px new) on held-back points, or None"""
    n = len(pts2); idx = np.arange(n); ea, eb = [], []
    rng = np.random.default_rng(0); perm = rng.permutation(n)
    for A, B in ((perm[: n // 2], perm[n // 2:]), (perm[n // 2:], perm[: n // 2])):
        r = solve(pts3[A], pts2[A], K, max(8, min_inl // 2))
        if r is None: return None
        rv, tv, _ = r
        ea.append(med_err(pts3[B], pts2[B], rv_old, tv_old, K) if rv_old is not None else np.nan); eb.append(med_err(pts3[B], pts2[B], rv, tv, K))
    return float(np.nanmean(ea)) if rv_old is not None else None, float(np.mean(eb))


def main():
    import cv2, pycolmap
    from matplotlib.path import Path
    from template_fit import load_template
    from gnm_features import scalp_vertices
    ap = argparse.ArgumentParser()
    for k in ("work", "fit", "fit_json", "sparse", "poses"): ap.add_argument(k)
    ap.add_argument("--debug"); ap.add_argument("--rounds", type=int, default=3); ap.add_argument("--min-inliers", type=int, default=None, help="PnP inliers needed (default 15 with the nose left out, 25 with --keep-nose: "
                    "without the nose a chin-up frame keeps 25-45 face correspondences, 9 / 15 frames of chae01 / gyu01 / woo03 failed at 25; the "
                    "held-back half check below guards the smaller sets, 10/24)"); ap.add_argument("--max-px", type=float, default=2.5)
    ap.add_argument("--all", action="store_true", help="also check (and replace when clearly wrong on held-back points) the kept frames")
    ap.add_argument("--keep-nose", action="store_true", help="use the nose region too (the team's behaviour without --all)")
    a = ap.parse_args()
    if a.min_inliers is None: a.min_inliers = 25 if a.keep_nose else 15
    m = meshio.read_any(a.fit); V = np.asarray(m["vertices"], np.float64); F = np.asarray(m["faces"])
    lid = np.asarray(json.load(open(a.fit_json, encoding="utf-8"))["landmark_vertex_ids"]); iod = np.linalg.norm(V[lid[33]] - V[lid[263]])
    _, _, mat, _, _ = load_template()
    face_v = (mat == 0) & ~scalp_vertices()
    face_tri = face_v[F].all(1)
    if not a.keep_nose: face_tri &= np.linalg.norm(V[F].mean(1) - V[lid[1]], axis=1) > NOSE_R * iod
    rec = pycolmap.Reconstruction(a.sparse); f, cx, cy = intrinsics(list(rec.cameras.values())[0])
    K = np.array([[f, 0, cx], [0, f, cy], [0, 0, 1.0]])
    pre = os.path.splitext(a.poses)[0] + ".pre_pitch.json"
    if not os.path.exists(pre): shutil.copy2(a.poses, pre)
    P = json.load(open(a.poses, encoding="utf-8")); fr = P["frames"]
    names, kps, matches = read_db(os.path.join(a.work, "colmap", "database.db"))
    id_of = {n: i for i, n in names.items()}
    good_of = lambda: [n for n, p in fr.items() if p["status"] != "dropped" and n in id_of]
    todo = [n for n, p in fr.items() if p["status"] == "dropped" and n in id_of]
    rep = {"dropped": len(todo), "recovered": [], "failed": {}, "nose_excluded": not a.keep_nose}
    refs = None
    if a.all:
        pr = {x["file"]: x for x in json.load(open(os.path.join(a.work, "prep", "prepare.json"), encoding="utf-8"))["images"]}
        front = lambda n: pr.get(n, {}).get("yaw") is not None and abs(pr[n]["yaw"]) < 25 and abs(pr[n].get("pitch") or 99) < 8
        refs = {n for n in good_of() if front(n)}
        todo = todo + [n for n in good_of() if n not in refs]
        good_of = lambda: sorted(refs)
        rep.update(checked=len(todo) - rep["dropped"], references=len(refs), replaced=[], agreed=[])
        a.rounds = max(a.rounds, 6)
    if not todo:
        rep["status"] = "nothing to do"; print(json.dumps(rep)); return
    images = os.path.join(a.work, "prep", "images")
    ibuf = {}
    def buf(g):
        if g not in ibuf:
            p = fr[g]; ibuf[g] = index_buffer(V, F, np.array(p["R"]), np.array(p["t"]), K, (int(2 * cy), int(2 * cx)))
        return ibuf[g]
    vis = []; ovals = {}
    for rnd in range(a.rounds):
        new = 0
        for d in sorted(todo):
            if fr[d]["status"] in ("recovered", "face_pnp") or (refs is not None and d in refs): continue
            kept = fr[d]["status"] != "dropped"
            img = cv2.imread(os.path.join(images, d))
            if d not in ovals: ovals[d] = face_oval(images, d, img)
            oval = ovals[d]
            if kept:
                Xs = V[face_v] @ np.array(fr[d]["R"]).T + np.array(fr[d]["t"]); us = Xs[:, :2] / Xs[:, 2:] * f + [cx, cy]
                hull = cv2.convexHull(us[Xs[:, 2] > 0].astype(np.float32)).reshape(-1, 2)
                oval = (hull - hull.mean(0)) * 1.05 + hull.mean(0)
            if oval is None: rep["failed"][d] = "no face"; continue
            did = id_of[d]; kd = kps.get(did)
            if kd is None: rep["failed"][d] = "no keypoints"; continue
            inside = Path(oval).contains_points(kd)
            cand = {}
            for g in good_of():
                gid = id_of[g]; key = (min(did, gid), max(did, gid)); M = matches.get(key)
                if M is None: continue
                md, mg = (M[:, 0], M[:, 1]) if did < gid else (M[:, 1], M[:, 0])
                sel = inside[md]
                if sel.sum() < 4: continue
                md, mg = md[sel], mg[sel]; xg = kps[gid][mg]
                ib = buf(g); xi = np.clip(np.round(xg).astype(int), 0, [ib.shape[1] - 1, ib.shape[0] - 1])
                tri = ib[xi[:, 1], xi[:, 0]]
                ok = (tri >= 0) & face_tri[np.maximum(tri, 0)]
                if not ok.any(): continue
                Xw = ray_hit(V, F, tri[ok], np.array(fr[g]["R"]), np.array(fr[g]["t"]), K, xg[ok])
                for k, X in zip(md[ok], Xw): cand.setdefault(int(k), []).append(X)
            pts2, pts3 = [], []
            for k, Xs in cand.items():
                Xs = np.array(Xs); med = np.median(Xs, 0)
                if len(Xs) > 1 and np.median(np.linalg.norm(Xs - med, axis=1)) > 0.03 * iod: continue
                pts2.append(kd[k]); pts3.append(med)
            if len(pts2) < a.min_inliers:
                rep["failed"][d] = f"{len(pts2)} face correspondences"; continue
            pts2 = np.array(pts2, np.float64); pts3 = np.array(pts3, np.float64)
            r = solve(pts3, pts2, K, a.min_inliers)
            if r is None: rep["failed"][d] = f"PnP failed ({len(pts2)} correspondences)"; continue
            rv, tv, inl = r
            err = med_err(pts3[inl], pts2[inl], rv, tv, K)
            R = cv2.Rodrigues(rv)[0]; t = tv.ravel()
            tip = V[lid[1]] @ R.T + t; tip_px = tip[:2] / tip[2] * f + [cx, cy]
            # held-back halves (inliers of the full solve: gross mismatches are not evidence either way)
            rv_old = cv2.Rodrigues(np.array(fr[d]["R"]))[0] if kept else None; tv_old = np.array(fr[d]["t"]).reshape(3, 1) if kept else None
            ho = held_out(pts3[inl], pts2[inl], K, rv_old, tv_old, a.min_inliers)
            if ho is None: rep["failed"][d] = "split-half solve failed"; continue
            e_old_ho, e_new_ho = ho
            if kept:
                rot_ = np.degrees(np.arccos(np.clip((np.trace(np.array(fr[d]["R"]).T @ R) - 1) / 2, -1, 1)))
                if err > a.max_px or e_new_ho > a.max_px or tip[2] <= 0 or rot_ > 25:
                    rep["failed"][d] = f"check: median {err:.2f} px (held-back {e_new_ho:.2f}), turn vs stored {rot_:.1f} deg"; continue
                if not (e_old_ho >= 1.5 * e_new_ho and e_old_ho >= 2.5):
                    rep["agreed"].append(d); refs.add(d); rep["failed"].pop(d, None); new += 1; continue
            elif err > a.max_px or e_new_ho > a.max_px or tip[2] <= 0 or not Path(oval).contains_point(tip_px):
                rep["failed"][d] = f"check: median {err:.2f} px (held-back {e_new_ho:.2f}), nose tip inside oval {bool(Path(oval).contains_point(tip_px))}"; continue
            old = fr[d]
            fr[d] = {**old, "R": R.tolist(), "t": t.tolist(), "status": "face_pnp" if kept else "recovered",
                     "recover": {"correspondences": len(pts2), "inliers": int(len(inl)), "median_px": round(err, 2), "held_back_px": round(e_new_ho, 2),
                                 **({"stored_held_back_px": round(e_old_ho, 2), "status_before": old["status"]} if kept else {}),
                                 "pose_before": {"R": old["R"], "t": old["t"]}}}
            new += 1; rep["failed"].pop(d, None)
            if refs is not None: refs.add(d)
            if kept:
                rot = np.degrees(np.arccos(np.clip((np.trace(np.array(old["R"]).T @ R) - 1) / 2, -1, 1)))
                rep["replaced"].append({"frame": d, "stored_held_back_px": round(e_old_ho, 2), "pnp_held_back_px": round(e_new_ho, 2), "rot_deg": round(float(rot), 1)})
                continue
            rep["recovered"].append({"round": rnd + 1, "frame": d, "inliers": int(len(inl)), "of": len(pts2), "median_px": round(err, 2), "held_back_px": round(e_new_ho, 2)})
            if a.debug and len(vis) < 6:
                row = []
                for RR, tt, col in ((np.array(old["R"]), np.array(old["t"]), (0, 0, 255)), (R, t, (0, 255, 255))):
                    ib = index_buffer(V, F, RR, tt, K, img.shape[:2]); e = np.zeros(img.shape[:2], bool)
                    e[:, 1:] |= ib[:, 1:] != ib[:, :-1]; e[1:, :] |= ib[1:, :] != ib[:-1, :]
                    e &= (ib >= 0)
                    c = img.copy(); c[e] = (0.5 * c[e] + 0.5 * np.array(col)).astype(np.uint8)
                    o = oval.mean(0).astype(int); rr = int(0.75 * np.ptp(oval[:, 0]))
                    row.append(cv2.resize(c[max(0, o[1] - rr):o[1] + rr, max(0, o[0] - rr):o[0] + rr], (300, 300)))
                vis.append(np.hstack(row))
        if not new: break
    if vis: cv2.imwrite(a.debug, np.vstack(vis), [cv2.IMWRITE_JPEG_QUALITY, 85])
    S = P.setdefault("summary", {})
    S["recovered"] = [r["frame"] for r in rep["recovered"]]
    if a.all: S["face_pnp"] = [r["frame"] for r in rep["replaced"]]
    S["dropped"] = [n for n, p in fr.items() if p["status"] == "dropped"]
    json.dump(P, open(a.poses, "w", encoding="utf-8"), indent=1)
    rep["status"] = "ok"; print(json.dumps(rep, ensure_ascii=False))


if __name__ == "__main__":
    main()
