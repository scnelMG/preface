"""Minimal NumPy software renderer for evidence images (gray shape / vertex color / error map).

No GPU or browser needed. Orthographic camera in the canonical face frame:
  +X = subject's left->right as seen by the viewer in front view (see canonical.py),
  +Y = up, +Z = forward (out of the face, toward the viewer in front view).
Views are named rotations of the camera around the face.
"""
import numpy as np

VIEWS = {
    # name: (yaw_deg, pitch_deg) ; yaw rotates camera around +Y, pitch tilts camera (positive = looking from below)
    "front": (0, 0),
    "oblique_l": (-35, 0),
    "oblique_r": (35, 0),
    "side_l": (-90, 0),
    "side_r": (90, 0),
    "bottom": (0, 55),
}


def view_matrix(yaw_deg, pitch_deg):
    y, p = np.radians(yaw_deg), np.radians(pitch_deg)
    ry = np.array([[np.cos(y), 0, -np.sin(y)], [0, 1, 0], [np.sin(y), 0, np.cos(y)]])
    rx = np.array([[1, 0, 0], [0, np.cos(p), np.sin(p)], [0, -np.sin(p), np.cos(p)]])
    return rx @ ry  # world -> camera (camera looks along -Z)


def vertex_normals(v, f):
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    vn = np.zeros_like(v)
    for k in range(3):
        np.add.at(vn, f[:, k], fn)
    n = np.linalg.norm(vn, axis=1, keepdims=True)
    return vn / np.maximum(n, 1e-12)


def render(v, f, view="front", size=512, colors=None, center=None, extent=None,
           light=(0.3, 0.4, 1.0), bg=(250, 250, 252), base=(200, 200, 205), uv=None, tex=None, return_depth=False, uv_flip_v=False, persp=None):
    """persp=(dist, focal_px): pinhole camera at distance dist along +camera z, focal length in pixels."""
    """Return HxWx3 uint8. colors: per-vertex Nx3 floats 0..1 (optional)."""
    if isinstance(view, np.ndarray) and view.shape == (3, 3):
        R = view  # rows: screen right, screen up, toward camera
    else:
        yaw, pitch = VIEWS[view] if isinstance(view, str) else view
        R = view_matrix(yaw, pitch)
    if center is None:
        center = (v.max(0) + v.min(0)) / 2
    pc = (v - center) @ R.T
    if extent is None:
        extent = np.abs(pc[:, :2]).max() * 1.08
    s = size / (2 * extent)
    if persp is not None:
        dist, fpx = persp
        dep = dist - pc[:, 2]
        sx = fpx * pc[:, 0] / dep + size / 2
        sy = size / 2 - fpx * pc[:, 1] / dep
        sz = -dep  # larger = closer
    else:
        sx = pc[:, 0] * s + size / 2
        sy = size / 2 - pc[:, 1] * s
        sz = pc[:, 2]
    vn = vertex_normals(v, f) @ R.T
    L = np.array(light, float)
    L /= np.linalg.norm(L)
    shade = np.clip(vn @ L, 0, 1) * 0.75 + 0.25
    if colors is None:
        col = np.tile(np.array(base, float) / 255.0, (len(v), 1))
    else:
        col = np.asarray(colors, float)
    vcol = col * shade[:, None]
    img = np.empty((size, size, 3), float)
    img[:] = np.array(bg) / 255.0
    zb = np.full((size, size), -np.inf)
    tri = f
    x0, y0 = sx[tri], sy[tri]
    # back-face culling (camera looks along -Z, facing triangles have positive signed area in screen with y down -> negative)
    area = (x0[:, 1] - x0[:, 0]) * (y0[:, 2] - y0[:, 0]) - (x0[:, 2] - x0[:, 0]) * (y0[:, 1] - y0[:, 0])
    order = np.argsort(sz[tri].mean(1))
    import os as _os
    if _os.environ.get("LM_RENDER_SLOW") == "1":
        _render_loop(order, area, x0, y0, tri, sz, size, zb, img, vcol, shade, uv, tex, uv_flip_v)
    else:
        _render_vec(order, area, x0, y0, tri, sz, size, zb, img, vcol, shade, uv, tex, uv_flip_v)
    out = (np.clip(img, 0, 1) * 255).astype(np.uint8)
    if return_depth:
        return out, zb, {"R": R, "center": center, "scale": s, "size": size}
    return out


def _render_loop(order, area, x0, y0, tri, sz, size, zb, img, vcol, shade, uv, tex, uv_flip_v):
    """reference per-triangle rasteriser (painter order far -> near, strict z test)"""
    for t in order:
        a = area[t]
        if abs(a) < 1e-9:
            continue
        xs, ys = x0[t], y0[t]
        xmin, xmax = int(max(np.floor(xs.min()), 0)), int(min(np.ceil(xs.max()), size - 1))
        ymin, ymax = int(max(np.floor(ys.min()), 0)), int(min(np.ceil(ys.max()), size - 1))
        if xmin > xmax or ymin > ymax:
            continue
        gx, gy = np.meshgrid(np.arange(xmin, xmax + 1) + 0.5, np.arange(ymin, ymax + 1) + 0.5)
        w0 = ((xs[1] - gx) * (ys[2] - gy) - (xs[2] - gx) * (ys[1] - gy)) / a
        w1 = ((xs[2] - gx) * (ys[0] - gy) - (xs[0] - gx) * (ys[2] - gy)) / a
        w2 = 1 - w0 - w1
        m = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        if not m.any():
            continue
        i = tri[t]
        z = w0 * sz[i[0]] + w1 * sz[i[1]] + w2 * sz[i[2]]
        sub = zb[ymin:ymax + 1, xmin:xmax + 1]
        upd = m & (z > sub)
        if not upd.any():
            continue
        sub[upd] = z[upd]
        c = (w0[..., None] * vcol[i[0]] + w1[..., None] * vcol[i[1]] + w2[..., None] * vcol[i[2]])
        if tex is not None and uv is not None:
            uu = w0 * uv[i[0], 0] + w1 * uv[i[1], 0] + w2 * uv[i[2], 0]
            vv = w0 * uv[i[0], 1] + w1 * uv[i[1], 1] + w2 * uv[i[2], 1]
            th, tw, _ = tex.shape
            vv = (1.0 - (vv % 1)) if uv_flip_v else (vv % 1)
            tc = tex[np.clip(vv * (th - 1), 0, th - 1).astype(int), np.clip((uu % 1) * (tw - 1), 0, tw - 1).astype(int)]
            sh = (w0 * shade[i[0]] + w1 * shade[i[1]] + w2 * shade[i[2]])[..., None]
            c = tc * sh
        img[ymin:ymax + 1, xmin:xmax + 1][upd] = c[upd]


def _render_vec(order, area, x0, y0, tri, sz, size, zb, img, vcol, shade, uv, tex, uv_flip_v, chunk=4_000_000):
    """vectorised rasteriser (2026-10-20, build_case spent ~49 s in the per-triangle loop): every (pixel, triangle)
    candidate of the bounding boxes is evaluated with the SAME expressions as _render_loop; per pixel the nearest
    triangle wins and ties go to the earlier triangle in the painter order, exactly like the strict z test there."""
    keep = np.abs(area[order]) >= 1e-9
    ts = order[keep]; rank_all = np.arange(len(order))[keep]
    xs, ys = x0[ts], y0[ts]
    xmin = np.maximum(np.floor(xs.min(1)), 0).astype(np.int64); xmax = np.minimum(np.ceil(xs.max(1)), size - 1).astype(np.int64)
    ymin = np.maximum(np.floor(ys.min(1)), 0).astype(np.int64); ymax = np.minimum(np.ceil(ys.max(1)), size - 1).astype(np.int64)
    ok = (xmin <= xmax) & (ymin <= ymax)
    ts, rank_all, xs, ys, xmin, xmax, ymin, ymax = ts[ok], rank_all[ok], xs[ok], ys[ok], xmin[ok], xmax[ok], ymin[ok], ymax[ok]
    w_ = xmax - xmin + 1; h_ = ymax - ymin + 1; cnt = w_ * h_
    # process triangles in chunks of candidate pixels
    cs = np.cumsum(cnt)
    i0 = 0
    sel_t, sel_pix, sel_z, sel_w0, sel_w1, sel_w2, sel_rank = [], [], [], [], [], [], []
    while i0 < len(ts):
        i1 = int(np.searchsorted(cs, cs[i0] - cnt[i0] + chunk, side="right")); i1 = max(i1, i0 + 1)
        k = np.arange(i0, i1); n = cnt[k]; tot = int(n.sum())
        rep_k = np.repeat(k, n); local = np.arange(tot) - np.repeat(np.r_[0, np.cumsum(n)[:-1]], n)
        gxi = xmin[rep_k] + local % w_[rep_k]; gyi = ymin[rep_k] + local // w_[rep_k]
        gx = gxi + 0.5; gy = gyi + 0.5
        X, Y = xs[rep_k], ys[rep_k]; a = area[ts[rep_k]]
        w0 = ((X[:, 1] - gx) * (Y[:, 2] - gy) - (X[:, 2] - gx) * (Y[:, 1] - gy)) / a
        w1 = ((X[:, 2] - gx) * (Y[:, 0] - gy) - (X[:, 0] - gx) * (Y[:, 2] - gy)) / a
        w2 = 1 - w0 - w1
        m = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        tt = ts[rep_k][m]; i = tri[tt]
        z = w0[m] * sz[i[:, 0]] + w1[m] * sz[i[:, 1]] + w2[m] * sz[i[:, 2]]
        sel_t.append(tt); sel_pix.append(gyi[m] * size + gxi[m]); sel_z.append(z)
        sel_w0.append(w0[m]); sel_w1.append(w1[m]); sel_w2.append(w2[m]); sel_rank.append(rank_all[rep_k][m])
        i0 = i1
    if not sel_t: return
    tt = np.concatenate(sel_t); pix = np.concatenate(sel_pix); z = np.concatenate(sel_z)
    w0 = np.concatenate(sel_w0); w1 = np.concatenate(sel_w1); w2 = np.concatenate(sel_w2); rk = np.concatenate(sel_rank)
    # winner per pixel: max z; ties -> smallest painter rank (the loop keeps the first one with a strict >)
    o = np.lexsort((rk, -z, pix)); first = np.r_[True, pix[o][1:] != pix[o][:-1]]; win = o[first]
    tt, pix, z, w0, w1, w2 = tt[win], pix[win], z[win], w0[win], w1[win], w2[win]
    i = tri[tt]; py, px = pix // size, pix % size
    zb[py, px] = z
    c = (w0[:, None] * vcol[i[:, 0]] + w1[:, None] * vcol[i[:, 1]] + w2[:, None] * vcol[i[:, 2]])
    if tex is not None and uv is not None:
        uu = w0 * uv[i[:, 0], 0] + w1 * uv[i[:, 1], 0] + w2 * uv[i[:, 2], 0]
        vv = w0 * uv[i[:, 0], 1] + w1 * uv[i[:, 1], 1] + w2 * uv[i[:, 2], 1]
        th, tw, _ = tex.shape
        vv = (1.0 - (vv % 1)) if uv_flip_v else (vv % 1)
        tc = tex[np.clip(vv * (th - 1), 0, th - 1).astype(int), np.clip((uu % 1) * (tw - 1), 0, tw - 1).astype(int)]
        sh = (w0 * shade[i[:, 0]] + w1 * shade[i[:, 1]] + w2 * shade[i[:, 2]])[:, None]
        c = tc * sh
    img[py, px] = c


def error_colors(err, vmax):
    """Map non-negative error to white->amber->red. NaN -> blue-gray (not evaluated)."""
    t = np.clip(np.nan_to_num(err, nan=0) / vmax, 0, 1)
    c = np.stack([np.ones_like(t) * 0.92, 0.92 - 0.55 * t, 0.92 - 0.8 * t], 1)
    c[t > 0.5, 0] = 0.92
    nanm = np.isnan(err)
    c[nanm] = [0.62, 0.66, 0.78]
    return c


def save_png(path, img):
    import zlib, struct
    h, w, _ = img.shape
    raw = b"".join(b"\x00" + img[y].tobytes() for y in range(h))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + \
        chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)


def contact_sheet(images, labels=None, cols=3, pad=8, bg=255):
    h, w, _ = images[0].shape
    try:
        from PIL import Image, ImageDraw
    except ImportError:  # no labels without PIL
        rows = (len(images) + cols - 1) // cols
        sheet = np.full((rows * (h + pad) + pad, cols * (w + pad) + pad, 3), bg, np.uint8)
        for k, im in enumerate(images):
            r, c = divmod(k, cols)
            sheet[pad + r * (h + pad): pad + r * (h + pad) + h, pad + c * (w + pad): pad + c * (w + pad) + w] = im
        return sheet
    rows = (len(images) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (w + pad) + pad, rows * (h + pad + 22) + pad), (bg, bg, bg))
    d = ImageDraw.Draw(sheet)
    for k, im in enumerate(images):
        r, c = divmod(k, cols)
        x, y = pad + c * (w + pad), pad + r * (h + pad + 22)
        sheet.paste(Image.fromarray(im), (x, y + 22))
        if labels:
            d.text((x + 4, y + 4), labels[k], fill=(40, 40, 60))
    return np.array(sheet)
