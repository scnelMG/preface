"""Eyelid surface coordinates (2026-11-12): which skin is the eyelid's FRONT, and the directions on it.

Why: the double-eyelid code (pipeline/eye_parts.py, and the edit engine's foldDisplacement) worked in a PLANE in front of
the eye (u across, v up, push along the face's forward axis). A plane cannot tell the lid's front skin from the lining
behind it (GNM models the lid margin's underside and the eye socket as skin too, stacked 0.08-0.13 x eye width behind the
front skin), so about half of the vertices the crease moved were hidden lining (gyu01 / chae01, DEV-LOG 11/12), and
heights measured in the plane are not lengths on a lid that leans (gyu01: 1 on the surface = 0.71 in the plane).

What this gives (topology from the GNM template, no per-person number):
  rows(lid)             per eye, the ROW of every skin vertex counted outward from the lid's inner border
                        (row 0 = the loop where GNM's exterior skin meets the eye-socket lining, 40 vertices, a clean
                        quad loop). Rows 0-1 are the lid margin's underside, row MARGIN_ROW = 2 is the lid margin itself
                        (the row MediaPipe's upper-lid landmarks sit on), rows above it are the front skin. -1 = not this
                        eye's exterior skin (lining, other eye, beyond MAX_ROW).
  front(lid)            per eye, bool: the front skin (row >= MARGIN_ROW)
  columns(lid)          per eye, the neighbour one row up / down the lid of every vertex (moving along the surface)
  frame(V, F, up)       per vertex: n (surface normal), g (unit direction "up the lid" ALONG the surface = `up` projected
                        on the tangent plane), c = g . up (how much of a step along the surface shows as height in the
                        plane; a height difference dv in the plane is a surface distance dv / c)
The edit engine (engine/eye-edit.mjs) reads the same rows from engine/lid-rows.json (template vertex id -> row, per eye),
written by --write-rows from rows() below and checked against it by --selftest; the constants are in engine/lid-step.json.
usage: python pipeline/lid_coords.py --selftest [work/<id> ...]
       python pipeline/lid_coords.py --write-rows
"""
import collections, functools, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
STEP = json.load(open(os.path.join(HERE, "..", "engine", "lid-step.json"), encoding="utf-8"))
ROWS_JSON = os.path.join(HERE, "..", "engine", "lid-rows.json")

MARGIN_ROW = STEP["margin_row"]   # the lid margin (lash line) is the 3rd quad loop from the socket border (checked by --selftest)
MAX_ROW = STEP["max_row"]         # rows kept: 14 rows reach the brow (row spacing 0.03-0.04 x eye width)
C_MIN = STEP["c_min"]             # floor of g . up (the lid margin rolls forward: its surface runs almost along the view axis)
UPPER_MID = {"R": 159, "L": 386}     # MediaPipe upper-lid middle point: names which socket loop is which eye


@functools.lru_cache(maxsize=1)
def _topology():
    """(quad neighbours per vertex in OUR template index, exterior-skin mask, the socket-border loops)"""
    from gnm_model import GNM, template_map
    G = GNM(); o2g = template_map()[0]; g2o = -np.ones(G.V, np.int64); g2o[o2g] = np.arange(len(o2g))
    ext = G.group("skin_exterior")[o2g]; sock = G.group("eye_sockets")[o2g]
    Q = g2o[G.quads]; Q = Q[(Q >= 0).all(1)]
    nb = collections.defaultdict(set)
    for q in Q:
        for i in range(4):
            a, b = int(q[i]), int(q[(i + 1) % 4]); nb[a].add(b); nb[b].add(a)
    border = [v for v in np.where(ext)[0] if any(sock[w] and not ext[w] for w in nb[int(v)])]
    bs = set(int(v) for v in border); loops, seen = [], set()                                   # connected components of the border = one loop per eye
    for v in border:
        if v in seen: continue
        comp, q = [], collections.deque([int(v)]); seen.add(int(v))
        while q:
            a = q.popleft(); comp.append(a)
            for b in nb[a]:
                if b in bs and b not in seen: seen.add(b); q.append(b)
        loops.append(comp)
    return nb, ext, loops


def rows(lid):
    """{"R": row per vertex, "L": ...} for the fit's 468 landmark vertex ids `lid` (only used to name the two loops)"""
    nb, ext, loops = _topology(); cand = []
    for loop in loops:
        row = -np.ones(len(ext), np.int64); row[loop] = 0; q = collections.deque(loop)
        while q:
            a = q.popleft()
            if row[a] >= MAX_ROW: continue
            for b in nb[a]:
                if row[b] < 0 and ext[b]: row[b] = row[a] + 1; q.append(b)
        cand.append(row)
    out = {}
    for S, k in UPPER_MID.items():                             # the loop this eye's upper-lid landmark is nearest to
        near = [r for r in cand if r[int(lid[k])] >= 0]
        if near: out[S] = min(near, key=lambda r: r[int(lid[k])])
    if set(out) != {"R", "L"} or out["R"] is out["L"]: raise ValueError("lid_coords: the socket loops do not match the eyelid landmarks")
    return out


def front(lid):
    return {S: r >= MARGIN_ROW for S, r in rows(lid).items()}


def columns(lid):
    """{"R": (up, down), "L": ...}: per vertex, the quad neighbour one row further from the lid margin / one row nearer
    (-1 = none). Rows are loops around the eye, so these edges run up and down the lid: a vertex that has to sit higher
    or lower on the lid moves along them and stays on the surface. At the few irregular vertices (corners) with two such
    neighbours the lower vertex id is taken."""
    nb = _topology()[0]; out = {}
    for S, r in rows(lid).items():
        up = -np.ones(len(r), np.int64); dn = up.copy()
        for v in np.where(r >= 0)[0]:
            for w in sorted(nb[int(v)]):
                if r[w] == r[v] + 1 and up[v] < 0: up[v] = w
                if r[w] == r[v] - 1 and dn[v] < 0: dn[v] = w
        out[S] = (up, dn)
    return out


def frame(V, F, up):
    """n, g, c per vertex of the skin mesh (V, F): see the module docstring. `up` = the eye's up axis (unit)"""
    from render import vertex_normals
    n = vertex_normals(np.asarray(V, np.float64), F)
    g = up[None] - n * (n @ up)[:, None]; L = np.linalg.norm(g, axis=1)
    g = g / np.maximum(L, 1e-9)[:, None]
    return n, g, np.clip(L, C_MIN, 1.0)


def _template_lid():
    return np.array(json.load(open(os.path.join(HERE, "..", "assets", "gnm_mp468.json")))["vertex"], np.int64)


def rows_table():
    """the rows of the template as engine/lid-rows.json stores them: per eye, template vertex ids with a row and their rows"""
    r = rows(_template_lid())
    return {"_about": "generated by pipeline/lid_coords.py --write-rows (template vertex id = GLB _TEMPLATE_INDEX -> lid row; "
                      "row 0 = the eye-socket border loop, row margin_row = the lid margin; vertices not listed: not this eye's skin)",
            "vertices": int(len(r["R"])),
            **{S: {"ids": np.where(r[S] >= 0)[0].tolist(), "rows": r[S][r[S] >= 0].tolist()} for S in ("R", "L")}}


def selftest(works):
    sys.path.insert(0, os.path.join(HERE, "..", "tools"))
    import meshio
    nb, ext, loops = _topology()
    rep = {"loops": [len(l) for l in loops], "loop_is_cycle": [all(sum(w in set(l) for w in nb[v]) == 2 for v in l) for l in loops], "runs": {}}
    t = np.load(os.path.join(HERE, "..", "assets", "gnm-template-v2.npz")); skin = t["materials"] == 0; F = t["triangles"].astype(np.int64)
    lid0 = _template_lid()
    stored = json.load(open(ROWS_JSON, encoding="utf-8")) if os.path.exists(ROWS_JSON) else None
    rep["rows_json_matches"] = stored is not None and {k: v for k, v in stored.items() if k != "_about"} == {k: v for k, v in rows_table().items() if k != "_about"}
    cases = [("template", np.asarray(t["vertices"], np.float64), lid0)]
    for w in works:
        M = os.path.join(w, "model"); ch = json.load(open(os.path.join(M, "report.json"), encoding="utf-8")).get("chosen", "gnm")
        cases.append((os.path.basename(os.path.normpath(w)), np.asarray(meshio.read_any(os.path.join(M, f"fit_{ch}.ply"))["vertices"], np.float64),
                      np.array(json.load(open(os.path.join(M, f"fit_{ch}.fit.json")))["landmark_vertex_ids"], np.int64)))
    from eye_parts import EYE
    ok = len(loops) == 2 and all(rep["loop_is_cycle"]) and rep["rows_json_matches"]
    for name, V, lid in cases:
        r = rows(lid); L = V[lid]; x = L[263] - L[33]; x /= np.linalg.norm(x); up = L[10] - L[152]; up -= x * (up @ x); up /= np.linalg.norm(up)
        fw = np.cross(x, up); fw *= np.sign((L[1] - L[[33, 263]].mean(0)) @ fw)
        n, g, c = frame(V, F[skin[F].all(1)], up); out = {}
        for S in ("R", "L"):
            lm = [int(r[S][lid[k]]) for k in EYE[S]["up"]]
            mid = lambda k: np.where((r[S] == k) & (np.abs((V - L[UPPER_MID[S]]) @ x) < 0.25 * np.linalg.norm(L[EYE[S]["c"][0]] - L[EYE[S]["c"][1]])) & ((V - L[EYE[S]["c"][0]]) @ up > 0))[0]
            facing = [round(float(np.median(n[mid(k)] @ fw)), 2) if len(mid(k)) else None for k in range(0, 8)]
            out[S] = {"upper_landmark_rows": lm, "front_vertices": int((r[S] >= MARGIN_ROW).sum()), "row_facing_forward_0_to_7": facing}
            # rows under the margin face back, the rows above the margin's roll face forward; on a FIT the margin row carries
            # the upper-lid landmarks (the template's own landmark file was picked on a render and sits rows off)
            ok &= facing[0] < 0 and facing[1] < 0 and facing[4] > 0 and (name == "template" or sum(v == MARGIN_ROW for v in lm) >= 5)
        rep["runs"][name] = out
    rep["pass"] = bool(ok); print(json.dumps(rep, indent=1)); return rep


if __name__ == "__main__":
    if "--write-rows" in sys.argv:
        with open(ROWS_JSON, "w", encoding="utf-8", newline="\n") as f: json.dump(rows_table(), f, ensure_ascii=False, separators=(",", ":")); f.write("\n")
        print(ROWS_JSON)
    if "--selftest" in sys.argv:
        sys.exit(0 if selftest([a for a in sys.argv[1:] if not a.startswith("--")])["pass"] else 1)
