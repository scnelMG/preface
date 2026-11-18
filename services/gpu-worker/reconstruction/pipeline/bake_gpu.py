"""GPU (PyTorch) versions of uv_bake.py's texel accumulation stages (S15P31B204-69).

uv_bake keeps its NumPy code as the CPU path (results unchanged). These functions do the same steps on the GPU in float32
(the CPU path accumulates in float64), so a GPU texture differs by rounding only (checked against the CPU path: PSNR >= 40 dB,
8-bit difference within +-2 for >= 99 % of the texels). A stage that fails on the GPU (out of memory, driver error) returns
None and the caller runs its CPU code; the reason is kept in the bake report ("gpu_fallback").

  LM_BAKE_DEVICE  auto (default: CUDA when torch is installed and a GPU answers) | cpu | cuda (no GPU = error)
torch is imported inside the functions: without it (CI, CPU-only Pods) this module and uv_bake still import.
"""
import os


def pick():
    """(torch device or None, label for the report)"""
    want = os.environ.get("LM_BAKE_DEVICE", "auto")
    if want not in ("auto", "cpu", "cuda"): raise SystemExit(f"LM_BAKE_DEVICE is auto, cpu or cuda, not {want!r}")
    if want == "cpu": return None, "cpu"
    try:
        import torch
        ok = torch.cuda.is_available()
    except Exception:          # not installed / broken install
        torch, ok = None, False
    if not ok:
        if want == "cuda": raise SystemExit("LM_BAKE_DEVICE=cuda but no CUDA GPU (torch missing or CUDA unavailable)")
        return None, "cpu (no torch)" if torch is None else "cpu (no CUDA)"
    return torch.device("cuda"), f"cuda ({torch.cuda.get_device_name(0)})"


def stage(rep, name, fn):
    """fn() on the GPU, or None (the caller runs its CPU code) when it fails: the reason goes to rep["gpu_fallback"].
    The GPU memory is handed back afterwards (the Pod's workers share one GPU)."""
    import torch
    try:
        return fn()
    except Exception as ex:
        rep.setdefault("gpu_fallback", {})[name] = f"{type(ex).__name__}: {str(ex)[:200]}"
        return None
    finally:
        torch.cuda.empty_cache()


def _upload(samples, dev, cdt=None):
    """(texel index int64, colour cdt (default float32), weight float32) per frame; uv_bake's colours are float64"""
    import torch
    cdt = cdt or torch.float32
    return [(torch.as_tensor(idx, dtype=torch.int64, device=dev), torch.as_tensor(c, dtype=cdt, device=dev),
             torch.as_tensor(w, dtype=torch.float32, device=dev)) for idx, c, w, cs in samples]


def _median(x):
    """np.median along axis 0 (mean of the two middle values for an even count; torch.median takes the lower one)"""
    s = x.sort(dim=0).values; n = s.shape[0]
    return (s[(n - 1) // 2] + s[n // 2]) / 2


def gains(samples, n_tex, n0, dev):
    """uv_bake "gains": per-frame exposure / white-balance gains -> (frames, 3) float32 numpy.
    In float64 like the CPU path (the gains stay float32 as there): tex_align (optical flow on the consensus texture,
    next) turned float32 gain rounding into visible texture changes (synthetic run: 96.7 % of the skin texels within +-2
    vs 99.99 % with tex_align off, S15P31B204-69)"""
    import torch
    T = _upload(samples, dev, torch.float64)
    g = torch.ones((len(T), 3), device=dev)
    for _ in range(3):
        acc = torch.zeros((n_tex, 3), dtype=torch.float64, device=dev); ws = torch.zeros(n_tex, dtype=torch.float64, device=dev)
        for k, (idx, c, w) in enumerate(T):
            acc.index_add_(0, idx, c * g[k] * w[:, None]); ws.index_add_(0, idx, w.double())
        ref = acc / ws.clamp_min(1e-9)[:, None]
        for k, (idx, c, w) in enumerate(T):
            good = (w > 0.1) & (ws[idx] > 0.3) & (idx < n0)
            if int(good.sum()) > 500:
                g[k] = torch.clamp(_median(ref[idx[good]] / c[good].clamp_min(5)), 0.6, 1.6)
        g /= _median(g)
    return g.cpu().numpy()


def blend(samples, gains_, n_tex, n0, robust, shadow, dev):
    """uv_bake "blend" (average mode): weighted texel mean, robust re-weighting -> (acc float64, ws float64, sigma)"""
    import torch
    T = _upload(samples, dev); g = torch.as_tensor(gains_, device=dev)

    def accumulate(weight):
        acc = torch.zeros((n_tex, 3), device=dev); ws = torch.zeros(n_tex, device=dev)
        for k, (idx, c, w) in enumerate(T):
            wk = weight(k, idx, c, w)
            acc.index_add_(0, idx, c * g[k] * wk[:, None]); ws.index_add_(0, idx, wk)
        return acc, ws
    acc, ws = accumulate(lambda k, idx, c, w: w)
    sig = 0.0
    if robust:
        lum = torch.tensor([0.114, 0.587, 0.299], device=dev)
        for _ in range(2):
            ref = acc / ws.clamp_min(1e-9)[:, None]
            dev_ = lambda k, idx, c: (c * g[k] - ref[idx]).abs().mean(1)
            dd = torch.cat([dev_(k, idx[idx < n0][::9], c[idx < n0][::9]) for k, (idx, c, w) in enumerate(T)])
            sig = max(4.0, 1.4826 * float(_median(dd)))

            def robust_w(k, idx, c, w):
                wr = w / (1 + (dev_(k, idx, c) / (2 * sig)) ** 2)
                if shadow:   # darker than the consensus on the skin = in a shadow in that frame
                    sd = (c * g[k] - ref[idx]) @ lum
                    wr = torch.where((idx < n0) & (sd < 0), wr / (1 + (sd / sig) ** 2), wr)
                return wr
            acc, ws = accumulate(robust_w)
    return acc.double().cpu().numpy(), ws.double().cpu().numpy(), sig


def texel_mean(samples, n_tex, dev):
    """mv_light_correct's first step in float64: per-texel sum(c w) / sum(w) -> (ref float32 numpy, ws float64 numpy)"""
    import torch
    T = _upload(samples, dev, torch.float64)
    acc = torch.zeros((n_tex, 3), dtype=torch.float64, device=dev); ws = torch.zeros(n_tex, dtype=torch.float64, device=dev)
    for idx, c, w in T:
        acc.index_add_(0, idx, c * w[:, None]); ws.index_add_(0, idx, w.double())
    return (acc / ws.clamp_min(1e-9)[:, None]).float().cpu().numpy(), ws.cpu().numpy()


def light_fit(I, Y, Wt, Fi, fs, nv, N, nF, dev):
    """mv_light_correct's fit(nv) in float64 -> (coef float64 numpy (4,), residual). The few steps that run in float32
    on the CPU path (first round: sum / sqrt of the float32 weights) are done the same way, so the coefficients, cast to
    float32 for the correction, come out as on the CPU (S15P31B204-69)"""
    import numpy as np, torch
    f64 = torch.float64
    tI = torch.as_tensor(I, dtype=torch.int64, device=dev); tF = torch.as_tensor(Fi, dtype=torch.int64, device=dev)
    tY = torch.as_tensor(Y, dtype=f64, device=dev); tW = torch.as_tensor(Wt, dtype=f64, device=dev)
    X = torch.cat([torch.ones((len(I), 1), dtype=f64, device=dev), torch.as_tensor(nv, dtype=f64, device=dev)], 1)
    bc = lambda wts: torch.bincount(tI, wts, N)
    g = torch.ones(nF, dtype=f64, device=dev)
    A = bc(tW * tY) / bc(tW).clamp_min(1e-9); coef = None
    for _ in range(8):
        y = tY / (g[tF] * A[tI].clamp_min(1e-4))
        if coef is None:
            srw = torch.as_tensor(np.sqrt(Wt), dtype=f64, device=dev); lam = 0.02 * Wt.sum()       # float32 like the CPU
        else:
            r = torch.log((X @ coef).clamp_min(1e-3)) - torch.log(y); sc = 1.4826 * float(_median(r.abs())) + 1e-6
            rw = tW / (1 + (r / (2 * sc)) ** 2); srw = rw.sqrt(); lam = 0.02 * float(rw.sum())
        Rg = torch.zeros((3, 4), dtype=f64, device=dev); Rg[:, 1:] = torch.eye(3, dtype=f64, device=dev) * float(np.sqrt(lam))
        coef = torch.linalg.lstsq(torch.cat([X * srw[:, None], Rg]), torch.cat([y * srw, torch.zeros(3, dtype=f64, device=dev)])).solution
        s_ = (X @ coef).clamp_min(0.05)
        A = bc(tW * tY / g[tF] * s_) / bc(tW * s_ * s_).clamp_min(1e-9)
        q = tY / (A[tI] * s_).clamp_min(1e-4)
        g = torch.stack([_median(q[fs[j]:fs[j + 1]]) if fs[j + 1] - fs[j] > 100 else torch.ones((), dtype=f64, device=dev) for j in range(nF)])
        g = g / _median(g)
    res = torch.log(tY) - torch.log(g[tF] * A[tI].clamp_min(1e-4) * (X @ coef).clamp_min(0.05))
    return coef.cpu().numpy(), float(torch.sqrt((res ** 2 * tW).sum() / tW.sum()))


class Frames:
    """uv_bake "frames" on the GPU (S15P31B204-69): the facing cosine of every texel per frame (+ the selection, the
    pre-pass maximum) and the colour sampling. float64 in the CPU path's operation order, each step a separate
    elementwise op (same IEEE rounding), so the result is bit-identical (LM_BAKE_CHECK=1 compares every frame).
    The projection of the selected texels, the masks, MediaPipe and the sharpness stay on the CPU."""
    def __init__(self, allP, allN, dev):
        import torch
        self.t, self.dev = torch, dev
        self.P = torch.as_tensor(allP, dtype=torch.float64, device=dev)
        self.N = torch.as_tensor(allN, dtype=torch.float64, device=dev)
        self.fb = None

    def cosv(self, cc):
        """((cc - P) * N).sum(1) / (|cc - P| + 1e-12), summed x, y, z in order like NumPy"""
        t = self.t
        d = t.as_tensor(cc, dtype=t.float64, device=self.dev) - self.P
        m = d * self.N; q = d * d
        return ((m[:, 0] + m[:, 1]) + m[:, 2]) / (t.sqrt((q[:, 0] + q[:, 1]) + q[:, 2]) + 1e-12)

    def facing_max(self, ccs):
        """pre-pass: per texel the best facing cosine over all frames, float32 numpy"""
        out = None
        for cc in ccs:
            c = self.cosv(cc).float(); out = c if out is None else self.t.maximum(out, c)
        return out.cpu().numpy()

    def select(self, cc, need_fb):
        """(sel int64, cosv[sel] float64) numpy: texels facing the camera, or grazing ones that need a fallback"""
        t = self.t
        if self.fb is None: self.fb = t.as_tensor(need_fb, dtype=t.bool, device=self.dev)
        c = self.cosv(cc)
        sel = t.nonzero((c > 0.52) | (self.fb & (c > 0.12))).squeeze(1)
        return sel.cpu().numpy(), c[sel].cpu().numpy()

    def sample(self, img, u, v):
        """bilinear colour at (u, v) like uv_bake's sample(): float32 pixels x float64 weights, same order"""
        t = self.t
        I = t.as_tensor(img, device=self.dev)
        u_ = t.as_tensor(u, dtype=t.float64, device=self.dev); v_ = t.as_tensor(v, dtype=t.float64, device=self.dev)
        x0 = t.floor(u_).long(); y0 = t.floor(v_).long(); fx = (u_ - x0)[:, None]; fy = (v_ - y0)[:, None]
        g = lambda yy, xx: I[yy, xx].float()
        out = g(y0, x0) * (1 - fx) * (1 - fy) + g(y0, x0 + 1) * fx * (1 - fy) + g(y0 + 1, x0) * (1 - fx) * fy + g(y0 + 1, x0 + 1) * fx * fy
        return out.cpu().numpy()
