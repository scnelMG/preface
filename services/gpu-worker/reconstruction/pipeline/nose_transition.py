"""Optional differential-coordinate nose/cheek transition, with fixed eyes/lips.

The legacy adapter clips an already smooth displacement at a region boundary.
Here the fixed boundary is part of a Dirichlet solve: preserve the proposed
displacement's mesh Laplacian instead of leaving a jump at that boundary.
No image observations or camera positions are changed by this operation.
"""
import numpy as np


def transition_mask(vertices, lid, materials):
    from nose_finish import nose_mask
    from gnm_model import GNM, template_map
    g = GNM(); mapping = template_map()[0]
    group = lambda name: (g.groups[g.group_names.index(name)] > 0.3)[mapping]
    allowed = nose_mask(vertices, lid, materials)
    allowed |= (group("left_cheek_region") | group("right_cheek_region")) & (materials == 0)
    for name in ("left_orbital_region", "right_orbital_region", "left_brow_region", "right_brow_region",
                 "upper_lip_region", "lower_lip_region"):
        allowed &= ~group(name)
    return allowed


def project_delta(vertices, faces, proposed_delta, allowed):
    from scipy.sparse import coo_matrix, diags
    from scipy.sparse.csgraph import connected_components
    from scipy.sparse.linalg import spsolve
    f = np.asarray(faces, np.int64); n = len(vertices)
    i = np.r_[f[:, 0], f[:, 1], f[:, 2], f[:, 1], f[:, 2], f[:, 0]]
    j = np.r_[f[:, 1], f[:, 2], f[:, 0], f[:, 0], f[:, 1], f[:, 2]]
    adj = coo_matrix((np.ones(len(i)), (i, j)), shape=(n, n)).tocsr()
    adj.data[:] = 1.0
    lap = diags(np.asarray(adj.sum(1)).ravel()) - adj
    free = np.flatnonzero(allowed); result = np.zeros_like(proposed_delta, dtype=np.float64)
    if not len(free): return result
    # A disconnected component with no fixed neighbour has no Dirichlet boundary;
    # retain its proposed field rather than solving a singular system.
    _, labels = connected_components(adj[free][:, free], directed=False)
    touches_fixed = np.asarray(adj[free][:, ~allowed].sum(1)).ravel() > 0
    constrained_labels = np.unique(labels[touches_fixed])
    solve = free[np.isin(labels, constrained_labels)]
    untouched = free[~np.isin(labels, constrained_labels)]
    result[untouched] = proposed_delta[untouched]
    if len(solve):
        result[solve] = spsolve(lap[solve][:, solve].tocsc(), (lap @ proposed_delta)[solve])
    if not np.isfinite(result).all(): raise ValueError("non-finite nose transition")
    return result
