"""GNM Head v3 statistical model (Google, Apache-2.0) - minimal NumPy evaluator, no extra packages.

Same maths as google/GNM gnm/shape (gnm_common.py): bind pose = template + identity basis + expression basis,
joints = template joints + joint identity basis, pose correctives, linear blend skinning (axis-angle, parent chain).
Model file: assets/gnm/v3_0/gnm_head.npz (tools/gnm_fetch.py downloads it from Hugging Face google/gnm-v3, 53 MB,
sha256 61d78bbf...). Our older assets/gnm-template-v2.npz is only the MEAN of this model (no shape space).

Parameters (v3.0): identity 253 = head 170 + eyeballs 3 + teeth 80; expression 383 = left eye 100 + right eye 100 +
lower face 150 + tongue 32 + iris 1; joints: neck + eyeballs (axis-angle).
"""
import os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get("LM_GNM_MODEL") or os.path.join(HERE, "..", "assets", "gnm", "v3_0", "gnm_head.npz")
MAP = os.environ.get("LM_GNM_MAP") or os.path.join(HERE, "..", "assets", "gnm", "template_map.npz")


def rodrigues(aa):
    aa = np.asarray(aa, np.float64); th = np.sqrt(np.maximum((aa ** 2).sum(-1, keepdims=True), 1e-16))
    k = aa / th; s, c = np.sin(th)[..., None], np.cos(th)[..., None]
    K = np.zeros(aa.shape[:-1] + (3, 3))
    K[..., 0, 1], K[..., 0, 2] = -k[..., 2], k[..., 1]
    K[..., 1, 0], K[..., 1, 2] = k[..., 2], -k[..., 0]
    K[..., 2, 0], K[..., 2, 1] = -k[..., 1], k[..., 0]
    return np.eye(3) + s * K + (1 - c) * (K @ K)


class GNM:
    def __init__(self, path=MODEL):
        if not os.path.exists(path):
            raise SystemExit(f"GNM model not found: {path}\n  run: python tools/gnm_fetch.py")
        d = np.load(path, allow_pickle=True)
        f = lambda k: np.asarray(d[k], np.float64)
        self.T = f("template_vertex_positions"); self.J0 = f("template_joint_positions")
        self.B_id = f("vertex_identity_basis"); self.B_jid = f("joint_identity_basis")
        self.B_ex = f("expression_basis")
        self.W = f("skinning_weights"); self.parents = [int(p) for p in d["joint_parent_indices"]]
        self.P = f("pose_correctives_regressor") if "pose_correctives_regressor" in d.files else None
        self.tri = np.asarray(d["triangles"], np.int64); self.quads = np.asarray(d["quads"], np.int64)
        self.tri_uvs = f("triangle_uvs")
        self.id_names = [str(x) for x in d["identity_names"]]; self.ex_names = [str(x) for x in d["expression_names"]]
        self.joint_names = [str(x) for x in d["joint_names"]]
        self.group_names = [str(x) for x in d["vertex_group_names"]]; self.groups = f("vertex_groups")
        self.mirror = np.asarray(d["mirror_indices"], np.int64)
        self.V = len(self.T)

    # name groups -------------------------------------------------------------------------------------------------
    def id_index(self, prefix):
        return np.array([i for i, n in enumerate(self.id_names) if n.startswith(prefix)], np.int64)

    def ex_index(self, prefix):
        return np.array([i for i, n in enumerate(self.ex_names) if n.startswith(prefix)], np.int64)

    def group(self, name, thr=1e-4):
        return self.groups[self.group_names.index(name)] > thr

    # forward -----------------------------------------------------------------------------------------------------
    def bind(self, identity=None, expression=None):
        v = self.T.copy()
        if identity is not None: v = v + np.tensordot(identity, self.B_id, 1)
        if expression is not None: v = v + np.tensordot(expression, self.B_ex, 1)
        return v

    def joints(self, identity=None):
        return self.J0 + (np.tensordot(identity, self.B_jid, 1) if identity is not None else 0)

    def __call__(self, identity=None, expression=None, rotations=None, translation=None):
        v = self.bind(identity, expression); j = self.joints(identity)
        nJ = len(self.parents)
        rot = np.zeros((nJ, 3)) if rotations is None else np.asarray(rotations, np.float64)
        tr = np.zeros(3) if translation is None else np.asarray(translation, np.float64)
        Rl = rodrigues(rot)
        if self.P is not None and np.any(rot):
            v = v + ((Rl - np.eye(3)).reshape(-1) @ self.P).reshape(-1, 3)
        G = []
        for k in range(nJ):
            M = np.eye(4); M[:3, :3] = Rl[k]
            M[:3, 3] = (j[0] + tr) if k == 0 else (j[k] - j[self.parents[k]])
            G.append(M if k == 0 else G[self.parents[k]] @ M)
        G = np.stack(G); Rw = G[:, :3, :3]; tw = G[:, :3, 3] - (Rw @ j[:, :, None])[..., 0]
        Rv = np.einsum("jv,jmn->vmn", self.W, Rw); tv = np.einsum("jv,jm->vm", self.W, tw)
        return (Rv @ v[:, :, None])[..., 0] + tv


def template_map():
    """(our template index -> GNM index, similarity s, R, t mapping GNM template -> our template frame)"""
    if not os.path.exists(MAP):
        raise SystemExit(f"{MAP} missing - run tools/gnm_fetch.py (it compares the GNM mesh with our template)")
    m = np.load(MAP)
    return m["ours_to_gnm"], float(m["s"]), m["R"], m["t"]
