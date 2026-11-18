"""Optional team nose fit after the existing eye step; base GNM topology only.

The team algorithms are kept in nostril_fit / alar_width / nose_profile. This
adapter excludes hold-out frames, protects eyes/lips, rejects topology changes
and backs off new triangle inversions. Optional harmonic protection permits a
continuous cheek transition. No camera or default changes.
joint (2026-11-11, scan_to_model --nose-fit joint): nose_fit.py alone - every
nose observation (nose_obs.py) in one smooth solve over its own region with a
fixed, zero-slope edge; it replaces the step sequence, so it is not combined
with the step options. The inversion / crease guards apply as for the steps.
"""
import hashlib
import json
import os
import shutil
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))


def sha(path):
    if not os.path.isfile(path): return None
    return hashlib.sha1(open(path, "rb").read()).hexdigest()[:12]


def nose_mask(vertices, lid, materials):
    """GNM region weights overlap: explicitly protect eyes, brows and lips."""
    from gnm_model import GNM, template_map
    g = GNM(); mapping = template_map()[0]
    group = lambda name: (g.groups[g.group_names.index(name)] > 0.3)[mapping]
    iod = np.linalg.norm(vertices[lid[33]] - vertices[lid[263]])
    allowed = group("nose_region")
    interior = group("skin") & ~group("skin_exterior") & ~group("mouth_sock") & ~group("eye_sockets")
    allowed |= interior & (np.linalg.norm(vertices - vertices[lid[1]], axis=1) < 0.3 * iod)
    for name in ("left_orbital_region", "right_orbital_region", "left_brow_region", "right_brow_region",
                 "upper_lip_region", "lower_lip_region"):
        allowed &= ~group(name)
    return allowed & (materials == 0)


def restore(work, chosen):
    """Remove our previous result before eye fitting or an options-off replay."""
    m = os.path.join(work, "model")
    stamp = os.path.join(m, "nose_finish.json")
    if not os.path.isfile(stamp): return
    d = json.load(open(stamp, encoding="utf-8"))
    dst = os.path.join(m, f"fit_{chosen}.ply")
    raw = os.path.join(m, f"fit_{chosen}.pre_nose.ply")
    if d.get("chosen") == chosen and sha(dst) == d.get("output_sha"):
        if sha(raw) != d.get("input_sha"):
            raise RuntimeError("pre-nose source is missing or changed; rerun model with a new id")
        shutil.copy2(raw, dst)


def finish(work, chosen, sparse, nostril, alar, run, log, protection="legacy", profile=False, joint=False):
    import meshio
    m = os.path.join(work, "model")
    p = lambda n: os.path.join(m, n)
    fit, fitj = p(f"fit_{chosen}.ply"), p(f"fit_{chosen}.fit.json")
    template = np.load(os.path.join(HERE, "..", "assets", "gnm-template-v2.npz"))
    source = meshio.read_any(fit)
    v0 = np.asarray(source["vertices"], np.float64)
    f = np.asarray(source["faces"], np.int64)
    if len(v0) != len(template["materials"]) or not np.array_equal(f, template["triangles"]):
        raise ValueError("nose options require base GNM topology; --detail is not supported")
    base_path = p("fit_gnmb.ply")
    if not os.path.isfile(base_path):
        raise ValueError("nose options require fit_gnmb.ply for the final inversion guard")
    if joint and (nostril or alar == "photo" or profile):
        raise ValueError("--nose-fit joint (default) replaces --nostril-fit / --alar-width photo / --nose-profile; for those use --nose-fit off")
    if joint and protection != "legacy":
        raise ValueError("--nose-fit joint (default) keeps its own region edge; --nose-protection harmonic needs --nose-fit off")
    hold = p("holdout.txt")
    if not os.path.isfile(hold): raise ValueError("nose fit requires holdout.txt")
    key = {"input": sha(fit), "base": sha(base_path), "fit_json": sha(fitj), "poses": sha(p("frame_poses.json")),
           "holdout": sha(hold), "nostril": nostril, "alar": alar, "protection": protection, "profile": profile,
           "code": [sha(__file__), sha(os.path.join(HERE, "nostril_fit.py")), sha(os.path.join(HERE, "alar_width.py")),
                    sha(os.path.join(HERE, "nose_transition.py")), sha(os.path.join(HERE, "nose_profile.py")),
                    *([sha(os.path.join(HERE, n)) for n in ("nose_fit.py", "nose_obs.py", "outline_obs.py", "sam_masks.py")] if joint else [])],
           **({"joint": True, "sam_size": os.environ.get("LM_SAM_SIZE", "")} if joint else {})}
    cached = json.load(open(p("nose_finish.json"), encoding="utf-8")) if os.path.exists(p("nose_finish.json")) else {}
    result = p(f"fit_{chosen}.nose_result.ply")
    if cached.get("key") == key and sha(result) == cached.get("output_sha"):
        shutil.copy2(result, fit)
        return {**cached, "cached": True}
    raw = p(f"fit_{chosen}.pre_nose.ply")
    shutil.copy2(fit, raw)
    candidate = p(f"fit_{chosen}.nose_candidate.ply")
    shutil.copy2(raw, candidate)
    rep = {"chosen": chosen, "key": key, "input_sha": sha(raw), "steps": {}}
    import sys
    if joint:
        args = [sys.executable, os.path.join(HERE, "nose_fit.py"), work, candidate, fitj, sparse, p("frame_poses.json"), candidate,
                "--exclude", hold]
        rep["steps"]["joint"] = json.loads(run(args, log) or "{}")
    if alar == "photo":
        args = [sys.executable, os.path.join(HERE, "alar_width.py"), candidate, fitj, sparse,
                os.path.join(work, "prep", "images"), p("frame_poses.json"), os.path.join(work, "prep", "prepare.json"), candidate,
                "--exclude", hold, "--debug", p("alar_width_check.jpg")]
        rep["steps"]["alar_before"] = json.loads(run(args, log) or "{}")
    if nostril:
        args = [sys.executable, os.path.join(HERE, "nostril_fit.py"), work, candidate, fitj, sparse,
                p("frame_poses.json"), candidate, "--exclude", hold, "--debug", p("nostril_fit_check.jpg")]
        rep["steps"]["nostril"] = json.loads(run(args, log) or "{}")
        if alar == "photo":
            args = [sys.executable, os.path.join(HERE, "alar_width.py"), candidate, fitj, sparse,
                    os.path.join(work, "prep", "images"), p("frame_poses.json"), os.path.join(work, "prep", "prepare.json"), candidate,
                    "--exclude", hold, "--max-change", "0.05", "--debug", p("alar_width_after_check.jpg")]
            rep["steps"]["alar_after"] = json.loads(run(args, log) or "{}")
    if profile:
        args = [sys.executable, os.path.join(HERE, "nose_profile.py"), candidate, fitj, sparse,
                os.path.join(work, "prep", "images"), p("frame_poses.json"), candidate,
                "--exclude", hold, "--debug", p("nose_profile_check.jpg")]
        rep["steps"]["profile"] = json.loads(run(args, log) or "{}")
    proposed = meshio.read_any(candidate)
    v = np.asarray(proposed["vertices"], np.float64)
    if v.shape != v0.shape or not np.array_equal(proposed["faces"], f) or not np.isfinite(v).all():
        raise ValueError("invalid nose output: topology changed or non-finite vertices")
    lid = np.asarray(json.load(open(fitj, encoding="utf-8"))["landmark_vertex_ids"])
    iod = np.linalg.norm(v0[lid[33]] - v0[lid[263]])
    if joint:                               # the fit's own region; its displacement is already 0 outside, smoothly
        from nose_fit import groups
        allowed = groups(v0, lid, template["materials"])["region"]; protection = "fit"
    else:
        allowed = nose_mask(v0, lid, template["materials"])
    delta = v - v0
    rep["blocked_outside_vertices"] = int((np.linalg.norm(delta, axis=1)[~allowed] > 1e-10).sum())
    if protection == "harmonic":
        from nose_transition import transition_mask, project_delta
        rep["legacy_mask_outside_candidate_vertices"] = rep["blocked_outside_vertices"]
        allowed = transition_mask(v0, lid, template["materials"])
        rep["blocked_outside_vertices"] = int((np.linalg.norm(delta, axis=1)[~allowed] > 1e-10).sum())
        delta = project_delta(v0, f, delta, allowed)
    elif protection in ("legacy", "fit"):
        delta[~allowed] = 0
    else:
        raise ValueError("unknown nose protection")
    rep["protection"] = protection
    n0 = np.cross(v0[f[:, 1]] - v0[f[:, 0]], v0[f[:, 2]] - v0[f[:, 0]])
    usable = np.linalg.norm(n0, axis=1) > 1e-15
    base = meshio.read_any(base_path)
    vb = np.asarray(base["vertices"], np.float64)
    if vb.shape != v0.shape or not np.array_equal(base["faces"], f):
        raise ValueError("statistical reference topology does not match")
    nb = np.cross(vb[f[:, 1]] - vb[f[:, 0]], vb[f[:, 2]] - vb[f[:, 0]])
    good_base = usable & (np.linalg.norm(nb, axis=1) > 1e-15) & ((n0 * nb).sum(1) > 0)
    def flips(vertices):
        normals = np.cross(vertices[f[:, 1]] - vertices[f[:, 0]], vertices[f[:, 2]] - vertices[f[:, 0]])
        return {"vs_input": int(np.sum(usable & ((n0 * normals).sum(1) <= 0))),
                "vs_gnmb": int(np.sum(good_base & ((nb * normals).sum(1) <= 0)))}
    rep["inversions_before_guard"] = {"raw_candidate": flips(v), "after_protection": flips(v0 + delta)}
    import sys
    sys.path.insert(0, os.path.join(HERE, "..", "tools"))
    from qa_check import crease, ABS
    base_lid_path = p("fit_gnmb.fit.json")
    base_lid = np.asarray(json.load(open(base_lid_path, encoding="utf-8"))["landmark_vertex_ids"]) if os.path.exists(base_lid_path) else lid
    base_iod = np.linalg.norm(vb[base_lid[33]] - vb[base_lid[263]])
    crease_before = crease(v0, vb, base_iod)["p95"]
    scale = 0.0
    for k in (1.0, 0.75, 0.5, 0.25, 0.0):
        vn = v0 + k * delta
        nn = np.cross(vn[f[:, 1]] - vn[f[:, 0]], vn[f[:, 2]] - vn[f[:, 0]])
        surface = crease(vn, vb, base_iod)["p95"]
        surface_ok = surface < ABS["crease_p95_fail"] if crease_before < ABS["crease_p95_fail"] else surface <= crease_before
        if surface_ok and not np.any(usable & ((n0 * nn).sum(1) <= 0)) and not np.any(good_base & ((nb * nn).sum(1) <= 0)):
            scale = k; break
    vn = v0 + scale * delta
    from template_fit import head_axes
    axes = head_axes(v0[lid])
    rep["landmark_motion_pct_iod"] = {
        name: np.round((vn[lid[index]] - v0[lid[index]]) @ axes.T / iod * 100, 4).tolist()
        for name, index in (("tip_mp1", 1), ("subnasale_mp2", 2), ("alar_mp64", 64), ("alar_mp294", 294))}
    rep["motion_axes"] = "head right/up/forward; displacement, not photo accuracy"
    rep["quality_approval"] = "pending user; surface safety does not validate alar height or nose-base rotation"
    if scale == 0 or np.array_equal(vn, v0):
        shutil.copy2(raw, result)  # byte-identical when skipped
    else:
        meshio.write_ply(result, vn, f, colors=source.get("colors"))
    shutil.copy2(result, fit)
    rep.update(status="applied" if scale > 0 and np.any(vn != v0) else "kept", candidate_sha=sha(candidate),
               safety_scale=scale, outside_nose_max=0.0 if protection == "legacy" else None,
               outside_transition_max=float(np.linalg.norm(vn[~allowed] - v0[~allowed], axis=1).max()) if (~allowed).any() else 0.0,
               new_inversions=0, new_inversions_vs_gnmb=0,
               crease_p95_before=crease_before, crease_p95_after=surface,
               max_move_pct_iod=float(np.linalg.norm(vn - v0, axis=1).max() / iod * 100), output_sha=sha(fit))
    json.dump(rep, open(p("nose_finish.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return rep
