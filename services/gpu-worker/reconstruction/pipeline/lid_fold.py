"""Double eyelid as a step in the eyelid's own skin (2026-11-12/13, crease mode "lid" of pipeline/eye_parts.py).

How a real double eyelid works: fibres of the lid-lifting muscle attach to the skin along one line, the crease. When
the eye opens, the stiff plate inside the lid and the skin stuck to it below the crease (the pretarsal strip) go up and
back as one piece, the crease skin is drawn in with them, and the loose skin above does not follow - it stays where it
is and ends at the crease. What one sees is ONE step: the strip set back, the lid above it untouched. There is no extra
roll above the line (the roll of the tuck mode added three more bends over 0.15 x eye width where the mesh has about
two rows - the lip came out uneven; 만두 11/12-13: the step looks more natural). When the eye closes the strip comes
back down and the step flattens; on a closed eye the crease is only a line on the skin.

So the step here is
  attached   a line ON the lid's front skin (pipeline/lid_coords.py: front skin only, never the lining behind the lid),
             placed where the photos show it (eye_parts_fit: the line's vertices are projected into the frontal frames
             and the heights corrected by their distance to the photo line - no renders)
  shaped     along the skin's own normal n, lengths ALONG the skin (a height difference in the photo plane / c):
               strip (lash line .. crease)   sinks from 0 at the lash line to `depth` at the crease
               above the crease (.. LIP)     comes back to the untouched lid over LIP
  open-driven weight(opening): the step's strength for an eye opening, 1 on the neutral open eye, 0 on the closed eye
             (for the expression layer; targets() with crease["part"] == "layout" gives the part that does not scale)
  laid out   layout(): the vertices near the line gather on it (`slide`), fading out toward the line's ends like the
             step. A vertex moves toward its neighbour one row up or down the lid, so it stays on the surface. This is mesh layout, not part of the step: it
             does not change with the opening, and it is stored as "between which two vertices, how far" so that it
             stays on the surface under an expression.
depth (0.05 x eye width, scaled by the photo line's darkness) and the gather amount `slide` (0.85) are the values 만두
confirmed for the tuck mode on 10/24 (depth = lid-step.json "depth", run_all passes it as --depth); fold / fold_width /
fold_sag of that mode are not used here.
The step's constants are in engine/lid-step.json, shared with the edit engine's "add a double eyelid" (engine/eye-edit.mjs,
fold "lid"): both make the same step from the same numbers; only where the line is differs (photos here, sliders there).
"""
import numpy as np
import lid_coords

_S = lid_coords.STEP
STRIP_POW = _S["strip_pow"]       # strip profile (height / crease height)^p: stays on the lid, dives just below the crease
LASH_HOLD = _S["lash_hold"]       # skin this close above the lash line stays (x eye width, in the photo plane)
LINE_MIN = _S["line_min"]         # a crease lower than this is no crease
MARGIN_ROLL = _S["margin_roll"]   # rows of the lid margin and its rounded edge (rows 2-4 of lid_coords): not skin of the fold - they stay,
                                  # like the lining behind the lid (the crease moved the lid's own edge by up to 0.05 x eye width, 11/13)
LIP = _S["lip"]                   # x eye width along the skin: the step's upper edge above the line (the tuck mode's ROLL_RISE x fold_width)
FRAME_SMOOTH = _S["frame_smooth"] # neighbour-averaging passes of the normals: the step's frame is the lid around it, not each vertex's
                                  # normal - raw normals differ by tens of degrees between gathered rows and turned small faces over


def weight(opening):
    """fold strength for an eye opening (lid gap / neutral lid gap): the fold forms as the lid goes up, 0 when closed"""
    o = np.clip(opening, 0.0, 1.0); return o * o * (3 - 2 * o)


def _coords(B, S):
    """front-skin vertex ids of eye S inside the patch, and the surface frame there (cached on the basis)"""
    if not hasattr(B, "_lid"):
        from scipy.sparse import coo_matrix, diags
        fr = {s_: r >= lid_coords.MARGIN_ROW + MARGIN_ROLL for s_, r in lid_coords.rows(B.lid).items()}; col = lid_coords.columns(B.lid); F = B.F[B.skin[B.F].all(1)]
        ii = np.r_[F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]]; jj = np.r_[F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]]
        A = coo_matrix((np.ones(len(ii)), (ii, jj)), shape=(B.n, B.n)).tocsr(); A.data[:] = 1.0
        M = diags(1.0 / np.maximum(np.asarray(A.sum(1)).ravel(), 1)) @ A; n = B.N.copy()
        for _ in range(FRAME_SMOOTH): n = M @ n; n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
        B._lid = {}
        for s, e in B.eyes.items():
            g = e["u"][None] - n * (n @ e["u"])[:, None]; L = np.linalg.norm(g, axis=1)
            B._lid[s] = {"front": fr[s] & B.skin, "n": n, "c": np.clip(L, lid_coords.C_MIN, 1.0), "up": col[s][0], "down": col[s][1]}
    return B._lid[S]


def hidden(B, eyes=("L", "R")):
    """patch vertices of these eyes that are not front skin: the lining behind the lid never takes part in a fold"""
    out = np.zeros(B.n, bool)
    for S in eyes: out |= B.eyes[S]["patch"] & ~_coords(B, S)["front"]
    return np.where(out)[0]


def _line(e, c, idx):
    """photo-plane coordinates of the vertices idx and the crease there: u, height above the lash line, crease height h
    (0 = no crease in this column), end weight (1 inside the line, easing to 0 over end_taper at both of its ends)"""
    from eye_parts import nodes_of
    hs = np.asarray(c.get("heights") or [0, 0, 0], float); nd = nodes_of(c)
    u, v = e["uv"][idx, 0], e["uv"][idx, 1]; a = v - e["lash_v"][idx]
    lo, hi = (0.03, 0.97) if len(hs) > 7 else (0.05, 0.95)
    if len(nd) and nd[0] < 0 and (hs[nd < 0] > 0).any():     # the line runs on past the outer corner: lash reference there =
        lo = float(nd[0]) - 1e-6                              # the face-horizontal line through the corner
        a = np.where(u < 0, v - (float(np.polyval(e["lash_pc"], 0.0)) + e["x_slope"] * u), a)
    def h_of(uq):
        if (c.get("curve") or "linear") == "smooth":
            k = np.clip(np.searchsorted(nd, uq) - 1, 0, len(nd) - 2); t = np.clip((uq - nd[k]) / np.maximum(nd[k + 1] - nd[k], 1e-9), 0, 1)
            w = 0.5 - 0.5 * np.cos(np.pi * t); hk = hs[k] * (1 - w) + hs[k + 1] * w
            hk = np.where(uq < nd[0], hs[0], np.where(uq > nd[-1], hs[-1], hk))
        else: hk = np.interp(uq, nd, hs, left=hs[0], right=hs[-1])
        return hk * (uq > lo) * (uq < hi)
    h = h_of(u); w = np.ones(len(u)); rng = float(c.get("end_taper") or 0.0)
    if rng > 0:
        ug = np.linspace(min(lo, 0.0), 1.0, 501); on = h_of(ug) > LINE_MIN
        if on.any():
            w = np.clip((u - ug[on].min()) / rng, 0, 1) * np.clip((ug[on].max() - u) / rng, 0, 1); w = w * w * (3 - 2 * w)
    return u, a, h, w


def layout(B, S, c):
    """Mesh layout for the step of eye S: the front-skin vertices near the crease line gather on it (eye_parts.slide_above,
    amount crease["slide"]), less and less toward the line's ends (wend: where the step fades out the layout fades with
    it - gathered vertices with no step left ended the line in a notch, 만두 11/13). A vertex goes part of the way to its
    neighbour one row up (or down) the lid, i.e. along the mesh surface, until its height in the photo plane is that one.
    -> dict: idx (front vertices of the patch), u, a (height in the photo plane after the layout), h, wend, n, c (the
    frame where each vertex landed), lo / hi / f (each vertex sits at V[lo] (1 - f) + V[hi] f; lo == hi where it stays)
    KNOWN LIMIT: the line runs slantwise across the quad grid, so the step follows the grid's edges like stairs - a few
    triangles end up half in the step, bent across the line (2-11 per eye; latest main 3-13), and the gathered vertices
    squeeze the triangles between them. Layouts tried and dropped 11/12-13 (all looked worse in the gray render than this
    one): one mesh row on the line; two rows along the line (foot and upper edge of the step); only the nearest vertex
    of each column on the line; the vertices above the line on the step's upper edge; the skin above the line untouched."""
    from eye_parts import slide_above
    e = B.eyes[S]; L = _coords(B, S)
    sel = e["patch"] & L["front"]
    if B.target_mask is not None: sel &= B.target_mask
    idx = np.where(sel)[0]; u, a, h, wend = _line(e, c, idx)
    out = {"idx": idx, "u": u, "a": a, "h": h, "wend": wend, "n": L["n"][idx], "c": L["c"][idx], "lo": idx.copy(), "hi": idx.copy(), "f": np.zeros(len(idx))}
    amt = float(c.get("slide") or 0.0)
    if amt > 0:
        a2 = a + wend * (slide_above(a, h, amt) - a); to = np.where(a2 > a, L["up"][idx], L["down"][idx]); ok = to >= 0
        to = np.where(ok, to, idx); an = _line(e, c, to)[1]
        f = np.where(ok & ((an - a) * (a2 - a) > 1e-12), np.clip((a2 - a) / np.where(an == a, 1.0, an - a), 0, 1), 0.0)
        n = L["n"][idx] * (1 - f[:, None]) + L["n"][to] * f[:, None]
        out.update(hi=np.where(f > 0, to, idx), f=f, a=a + f * (an - a), n=n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12),
                   c=L["c"][idx] * (1 - f) + L["c"][to] * f)
    return out


def sink(a, h, c, lip=LIP, rise_pow=0):
    """the step's profile (0..1, times depth along -n): a = height above the lash line and h = crease height (photo plane,
    x eye width), c = the surface factor there, lip = how far above the line the skin comes back (along the skin), rise_pow =
    the shape of that return (0 = smoothstep, as modelling uses it; p = (1 - t)^p, steep at the line and rounding onto the
    lid above). The edit engine's lidSink (engine/eye-edit.mjs) is this same function; on its finer mesh it uses
    lid-step.json "edit"."""
    a, h, c = np.asarray(a, float), np.asarray(h, float), np.asarray(c, float)
    t = np.clip((a - h) / c / lip, 0, 1)                                       # (a - h) / c = distance above the crease along the skin
    back = (1 - t) ** rise_pow if rise_pow > 0 else 1 - t * t * (3 - 2 * t)
    return np.where(a <= h, np.clip(a / np.maximum(h, 1e-6), 0, 1) ** STRIP_POW, back) * (h > LINE_MIN) * (a > LASH_HOLD)


def targets(B, S, p):
    """(vertex ids, displacement) of the step of eye S for the parameters p (eye_parts crease dict, mode "lid").
    crease["part"] == "layout" gives the mesh layout alone (no step)."""
    c = p.get("crease") or {}; Y = layout(B, S, c); ew = B.eyes[S]["ew"]
    idx, a, h, wend, n = Y["idx"], Y["a"], Y["h"], Y["wend"], Y["n"]
    D = (B.V[Y["hi"]] - B.V[idx]) * Y["f"][:, None]
    if c.get("part") != "layout":
        D -= n * (float(c.get("depth") or 0.0) * ew * sink(a, h, Y["c"]) * wend)[:, None]
    moved = np.linalg.norm(D, axis=1) > 0
    return idx[moved], D[moved]


def line_vertices(B, S, p, tol=0.012):
    """front-skin vertices on the crease line of eye S (within tol x eye width of it in the photo plane after the
    layout, where the crease is higher than 0.02), outer -> inner: what eye_parts_fit projects into the photos"""
    c = p.get("crease") or {}
    if not (np.asarray(c.get("heights") or [0], float) > 0).any(): return np.zeros(0, np.int64)
    Y = layout(B, S, c); on = (Y["h"] > 0.02) & (np.abs(Y["a"] - Y["h"]) <= tol)
    return Y["idx"][on][np.argsort(Y["u"][on])]
