"""W8b (2026-10-20): the DETAIL layer of the head mesh - a fixed topology (assets/gnm-detail-v1.npz, built by
tools/make_detail_topology.py) made from the GNM-v2 template by deterministic local midpoint subdivision of the skin.

  base vertices 0..base_count-1 keep their template indices; new vertices are appended with a parent map, so any per-vertex
  quantity of a fitted base mesh is carried over by `lift` (positions by `upsample`) and nothing is stored twice.
  upsample(V_base) with no displacement is EXACTLY the base surface (midpoints only, no smoothing).

usage  D = DetailMesh()            # default asset
       Vd = D.upsample(V_base)     # (n_detail, 3)
       xd = D.lift(x_base)         # per-vertex scalars / vectors / bools (bool: all parents True)
       xb = D.restrict(xd)         # first base_count entries
       D.F, D.UV, D.UT, D.mat, D.comp, D.level, D.region, D.parent_idx, D.parent_w
"""
import json, os
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
DEFAULT = os.path.join(ROOT, "assets", "gnm-detail-v1.npz")


class DetailMesh:
    def __init__(self, path=DEFAULT):
        d = np.load(path, allow_pickle=False)
        self.path = path; self.version = str(d["version"]); self.n0 = int(d["base_count"])
        self.V_template = np.asarray(d["vertices"], np.float64); self.F = d["triangles"].astype(np.int64)
        self.UV = np.asarray(d["vertex_uvs"], np.float64); self.UT = d["uv_triangles"].astype(np.int64)
        self.mat = d["materials"]; self.comp = d["components"]; self.level = d["level"].astype(np.int64); self.region = d["region"]
        self.parent_idx = d["parent_idx"].astype(np.int64); self.parent_w = np.asarray(d["parent_w"], np.float64)
        self.face_parent = d["face_parent"].astype(np.int64) if "face_parent" in d.files else None     # base face of each detail face
        self.levels = json.loads(str(d["levels_json"])); self.n = len(self.V_template)

    # the parent map is HIERARCHICAL: a level-2 midpoint's parents are level-1 vertices (indices >= base_count), so values
    # are resolved level by level (parents always have smaller indices than their children)
    def _resolve(self, x_base, combine):
        x = np.asarray(x_base)
        if len(x) != self.n0: raise ValueError(f"expected {self.n0} base values, got {len(x)}")
        out = np.empty((self.n,) + x.shape[1:], dtype=x.dtype if x.dtype != bool else bool); out[:self.n0] = x
        for L in range(1, int(self.level.max()) + 1):
            idx = np.where(self.level == L)[0]
            if len(idx): out[idx] = combine(out, idx)
        return out

    def upsample(self, V_base, curved=False, smooth_passes=0):
        """curved=False: midpoints (exactly the base surface, flat facets stay). curved=True (2026-10-21, 만두: the lifted
        surface looked faceted / bumpy): each inserted vertex is put on the cubic PN-triangle edge curve through its two
        parents (positions + base vertex normals), level by level - the base vertices do not move, the surface between them
        is curved by the base normals, so the facets of the base resolution disappear; residual noise OF the base vertices
        stays (that is a fit property, not a resolution one)"""
        V_base = np.asarray(V_base, np.float64)
        if not curved:
            V = self._resolve(V_base, lambda out, idx: (out[self.parent_idx[idx]] * self.parent_w[idx][:, :, None]).sum(1))
            return self._taubin(V, smooth_passes) if smooth_passes > 0 else V
        from render import vertex_normals
        if not hasattr(self, "_F_base"):
            self._F_base = np.load(os.path.join(ROOT, "assets", "gnm-template-v2.npz"))["triangles"].astype(np.int64)
        N = self._resolve(vertex_normals(V_base, self._F_base), lambda out, idx: out[self.parent_idx[idx]][:, :2].sum(1))
        N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12

        def pn(out, idx):
            pi_, pj_ = self.parent_idx[idx][:, 0], self.parent_idx[idx][:, 1]
            P_i, P_j, n_i, n_j = out[pi_], out[pj_], N[pi_], N[pj_]
            b_ij = (2 * P_i + P_j - ((P_j - P_i) * n_i).sum(1)[:, None] * n_i) / 3
            b_ji = (2 * P_j + P_i - ((P_i - P_j) * n_j).sum(1)[:, None] * n_j) / 3
            return (P_i + 3 * b_ij + 3 * b_ji + P_j) / 8
        V = self._resolve(V_base, pn)
        return self._taubin(V, smooth_passes) if smooth_passes > 0 else V

    def _taubin(self, V, passes, lam=0.5, mu=-0.53):
        """smooth_passes > 0 (2026-10-21, 만두: flat midpoints show the base facets as creases, the PN curved lift a quilted
        ripple on the nose sides; a biharmonic solve streaked along the level transitions): Taubin lambda|mu smoothing of the
        refined skin region (level > 0 vertices and their neighbours; the eye-opening boundary and everything outside the
        refined regions stay exactly as lifted). Volume-preserving, removes the facet-scale ripple only - 8 passes on the
        template: base vertices move median 0.07 / p95 0.2 % IOD. The base fit itself is never changed by this."""
        from scipy.sparse import coo_matrix, diags
        if not hasattr(self, "_tb"):
            F = self.F; n = self.n
            e = np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
            A = coo_matrix((np.ones(2 * len(e)), (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(n, n)).tocsr(); A.data[:] = 1.0
            M = diags(1.0 / np.maximum(np.asarray(A.sum(1)).ravel(), 1)) @ A
            skin = self.mat == 0; near = (self.level > 0); near = near | (A @ near.astype(float) > 0)
            bnd = (A @ (~skin).astype(float) > 0)                                 # skin vertices touching the eyeballs / mouth parts
            self._tb = (M.tocsr(), skin & near & ~bnd)
        M, mask = self._tb; S = V.copy()
        for _ in range(int(passes)):
            d = M @ S - S; d[~mask] = 0; S = S + lam * d
            d = M @ S - S; d[~mask] = 0; S = S + mu * d
        return S

    def lift(self, x_base):
        x = np.asarray(x_base)
        if x.dtype == bool: return self._resolve(x, lambda out, idx: out[self.parent_idx[idx]].all(1))
        if np.issubdtype(x.dtype, np.integer):          # labels: the parent with the largest weight
            return self._resolve(x, lambda out, idx: out[self.parent_idx[idx][np.arange(len(idx)), np.argmax(self.parent_w[idx], 1)]])
        xf = x.astype(np.float64)
        return self._resolve(xf, lambda out, idx: (out[self.parent_idx[idx]] * (self.parent_w[idx] if xf.ndim == 1 else self.parent_w[idx][:, :, None])).sum(1))

    def restrict(self, x_detail):
        return np.asarray(x_detail)[:self.n0]

    def skin_faces(self):
        return self.F[(self.mat[self.F] == 0).all(1)]

    def info(self):
        return {"version": self.version, "base_count": self.n0, "vertices": self.n, "faces": int(len(self.F)), "uv_vertices": int(len(self.UV)),
                "levels": {int(k): int(v) for k, v in zip(*np.unique(self.level, return_counts=True))}, "regions": self.levels["regions"]}


if __name__ == "__main__":
    D = DetailMesh(); print(json.dumps(D.info(), ensure_ascii=False))
