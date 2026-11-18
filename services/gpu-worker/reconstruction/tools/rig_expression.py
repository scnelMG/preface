"""표정 트래킹용 리그(expression.json)를 만든다.

이미 만든 모델의 head.glb와 rig.json만 쓴다 → 새 모델은 파이프라인 마지막에, 기존 모델은 같은 도구로 보충한다.
rig.json은 코·눈 승인이 파일 해시(rigSha256)로 묶여 있으므로 건드리지 않고, 화면(apps/web/src/features/expression/rig.ts)이
읽는 것만 따로 쓴다: options, gnmx(GNM 표정 성분·풀이 행렬), expr(얼굴 점 대응·무표정 위치·직접 정의한 표정·좌우 짝),
rig(이름 붙은 표정·눈), mouth(치아 자리·입술 접촉), head(머리 관절).

사용: python tools/rig_expression.py <head.glb> <rig.json> --out <expression.json>
마지막 줄에 측정값 JSON을 찍는다. 개인 얼굴 형상이 담기므로 모델 옆 비공개 저장소에만 둔다.

계산은 PoC tools/rig_expr_upgrade.py(--gnm-eye 40 --gnm-lower 100 --sigma 0.006 --landmark-trust 6,1 --frown-native
--nose-shapes --brow-knit)와 같다. 다른 점: GNM 의미 표정 생성기 대신 그 분류별 출력(assets/gnm_semantic_classes.json)을 읽고,
화면이 쓰지 않는 값(의미 표정 블록, 눈 감김 배율, 입 안 깊이)은 만들지 않는다.
"""
import argparse
import base64
import json
import os
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "pipeline")); sys.path.insert(0, HERE)

import rig_blocks as VD

b64 = lambda a, dt: base64.b64encode(np.ascontiguousarray(a, dtype=dt).tobytes()).decode()
unb = lambda s, dt: np.frombuffer(base64.b64decode(s), dtype=dt)

SEMANTIC = os.path.join(ROOT, "assets", "gnm_semantic_classes.json")

# 풀이 설정(만두 11/15 결정: 개발 서버 시험 모델 '미간 시험3'과 같은 조합)
N_EYE, N_LOWER = 40, 100            # 실을 GNM 표정 성분: 눈 영역마다 40개, 아래 얼굴 100개
SIGMA = 0.006                       # 풀이가 가정하는 얼굴 점 잡음(눈 사이 거리 대비). 작을수록 얼굴 점을 더 따른다
TRUST = {"brow": 6.0, "nose": 1.0}  # 눈썹·콧볼 얼굴 점을 다른 점보다 얼마나 더 믿나
DEPTH_W = 0.3                       # 카메라 쪽(깊이) 움직임은 이만큼만 믿는다

# MediaPipe 얼굴 윤곽 점은 피부가 아니라 보이는 윤곽을 따라가 고개를 돌리면 미끄러진다 → 풀이에 쓰지 않는다
OVAL = [338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234,
        127, 162, 21, 54, 103, 67, 109]
BROW_LM = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46, 336, 296, 334, 293, 300, 285, 295, 282, 283, 276]
NOSE_LM = [98, 327, 64, 294, 48, 278, 49, 279, 102, 331, 129, 358]
LID_PAIRS = {"Left": [(386, 374), (385, 380), (387, 373)], "Right": [(159, 145), (158, 153), (160, 144)]}

# 코 찡그림 형상(GNM에는 콧볼만 따로 움직이는 표정이 없다): 콧볼이 올라가고 뒤로 당겨진다(눈 사이 거리 대비, 가우스 반경)
SNEER_WINGS = {"Right": [64, 48, 98, 102, 129], "Left": [294, 278, 327, 331, 358]}
SNEER_LIFT, SNEER_BACK, SNEER_RADIUS = 0.032, 0.008, 0.07
# 미간 모임 형상(GNM 찡그림은 눈썹 머리를 가운데로 거의 모으지 않는다): 눈썹 머리가 가운데로, 그 사이 살이 앞으로
KNIT_BROWS = {"Right": (107, 55), "Left": (336, 285)}
KNIT_IN, KNIT_BULGE, KNIT_RADIUS = 0.03, 0.012, 0.12
KNIT_UP = 0.06                      # 눈썹 머리 윗선 위로 모으는 높이(화면 미간 주름 wrinkles.ts MIDBROW_TOP과 같다)


def read_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def base_positions(glb, nbase):
    """템플릿 정점 위치(glb 좌표). glb 정점마다 템플릿 번호(_TEMPLATE_INDEX)가 붙어 있다"""
    with open(glb, "rb") as fh:
        raw = fh.read()
    jl = struct.unpack("<I", raw[12:16])[0]; gl = json.loads(raw[20:20 + jl]); bin0 = 20 + jl + 8

    def acc(i, dt, ncomp):
        a = gl["accessors"][i]; v = gl["bufferViews"][a["bufferView"]]
        if v.get("byteStride"): raise SystemExit("interleaved buffer views are not supported")
        off = bin0 + v.get("byteOffset", 0) + a.get("byteOffset", 0)
        return np.frombuffer(raw, dtype=dt, count=a["count"] * ncomp, offset=off).reshape(a["count"], ncomp)
    V = np.full((nbase, 3), np.nan)
    for m in gl["meshes"]:
        for pr in m["primitives"]:
            A = pr["attributes"]
            if "_TEMPLATE_INDEX" not in A: continue
            keep = acc(A["_DETAIL_INDEX"], "<u4", 1)[:, 0] < nbase if "_DETAIL_INDEX" in A else slice(None)
            V[acc(A["_TEMPLATE_INDEX"], "<u4", 1)[:, 0][keep]] = acc(A["POSITION"], "<f4", 3)[keep]
    return V


def component_fields(R, names=None, at=None):
    """성분마다 변위(nbase 또는 at 정점, 3). names를 주면 그 성분만"""
    g = R["gnmx"]; n = R["expr"]["nbase"]; out = []
    for nm in names or g["names"]:
        sh = g["shapes"][nm]; d = np.zeros((n, 3))
        d[unb(sh["idx"], "<i4")] = unb(sh["q"], "<i2").astype(np.float64).reshape(-1, 3) * sh["sc"]
        out.append(d if at is None else d[at])
    return np.array(out)


def regen_components(R, G, n_eye, n_lower):
    """rig의 성분으로 GNM 기저 → 이 모델 좌표의 닮음 변환을 구하고, 실을 성분을 GNM 기저에서 다시 만든다(제자리)"""
    from gnm_model import template_map
    o2g = template_map()[0]; g = R["gnmx"]
    X, Y = [], []
    for nm in g["names"]:
        sh = g["shapes"][nm]; idx = unb(sh["idx"], "<i4")
        X.append(G.B_ex[G.ex_names.index(nm[3:])][o2g][idx]); Y.append(unb(sh["q"], "<i2").astype(np.float64).reshape(-1, 3) * sh["sc"])
    X, Y = np.vstack(X), np.vstack(Y); M = np.linalg.lstsq(X, Y, rcond=None)[0].T          # Y = X M^T
    fit = float(np.abs(X @ M.T - Y).max() / np.abs(Y).max())
    comps = [i for i, nm in enumerate(G.ex_names) if nm.startswith(("left_eye_region_", "right_eye_region_")) and int(nm[-3:]) < n_eye] + \
            [i for i, nm in enumerate(G.ex_names) if nm.startswith("lower_face_region_") and int(nm[-3:]) < n_lower]
    comps.sort(key=lambda i: (0 if G.ex_names[i].startswith("left_eye") else 1 if G.ex_names[i].startswith("right_eye") else 2, i))
    shapes = {}
    for i in comps:
        d = G.B_ex[i][o2g] @ M.T; m = np.linalg.norm(d, axis=1); keep = np.where(m > 0.01 * m.max())[0]; sc = float(np.abs(d[keep]).max()) / 32000 + 1e-12
        shapes[f"gx_{G.ex_names[i]}"] = {"idx": b64(keep, "<i4"), "q": b64(np.round(d[keep] / sc), "<i2"), "sc": sc}
    g["shapes"] = shapes; g["names"] = list(shapes); g["K"] = len(shapes)
    return {"components": len(shapes), "n_eye": n_eye, "n_lower": n_lower, "similarity_fit_rel": round(fit, 5),
            "scale": round(float(np.cbrt(abs(np.linalg.det(M)))), 5)}


def solve_P(R, Dn):
    """가중치 = P · 얼굴 점 움직임의 P(능형 최소제곱). Dn: 성분마다 얼굴 점 변위(K, 468, 3).
    윤곽 점은 0, 눈썹·콧볼 점은 TRUST만큼 더 믿는다. 화면이 받는 정밀도(float32)로 돌려준다"""
    weight = np.ones(Dn.shape[1]); weight[OVAL] = 0.0; weight[BROW_LM] = TRUST["brow"]; weight[NOSE_LM] = TRUST["nose"]
    A = Dn.reshape(len(Dn), -1).T
    Bm = np.array([R["axes"]["right"], R["axes"]["up"], R["axes"]["fwd"]], np.float64)
    Wb = np.kron(np.diag(weight), Bm.T @ np.diag([1.0, 1.0, DEPTH_W]) @ Bm)
    sg = SIGMA * R["iod"]; AtW = A.T @ Wb
    return np.linalg.solve(AtW @ A / sg ** 2 + np.eye(A.shape[1]), AtW / sg ** 2).astype(np.float32)


def lid_share(R, w, Dn, side):
    """가중치 w가 그 눈의 눈 틈을 닫는 비율(0~1)"""
    upv = np.array(R["axes"]["up"]); Ln = unb(R["expr"]["lmk"], "<f4").astype(np.float64).reshape(-1, 3); L = np.tensordot(w, Dn, 1)
    g0 = sum((Ln[u] - Ln[l]) @ upv for u, l in LID_PAIRS[side]); gap = sum((L[u] - L[l]) @ upv for u, l in LID_PAIRS[side])
    return round(float(np.clip(-gap / g0, 0, 1)), 3)


def learned_poses(R, Dn):
    """GNM 의미 표정 분류의 대표 표정으로 만든 직접 정의 표정(expr.native):
      browDown<쪽>  'squint'의 그 쪽 눈 영역 성분(눈썹이 내려오고 모이며 볼이 오르고 눈이 좁아진다)
      cheekPuff     'blow'의 아래 얼굴 성분(볼이 부풀고 입술이 다물린다)
    그리고 미소가 입꼬리를 올릴 때 콧볼도 그 몇 배 오르는지('happy', options.smile_wing_ratio).
    반환: ({이름: 가중치}, {이름: {쪽: 눈 틈을 닫는 비율}})"""
    C = read_json(SEMANTIC); names = R["gnmx"]["names"]
    carried = [C["expression_names"].index(nm[3:]) for nm in names]
    pose = lambda cls: np.asarray(C["classes"][cls], np.float64)[carried]
    upv = np.array(R["axes"]["up"]); lower = np.array([nm.startswith("gx_lower_face") for nm in names])
    group = {}
    for prefix in ("gx_left_eye", "gx_right_eye"):              # GNM 눈 영역이 MediaPipe 어느 쪽 눈을 움직이나
        m = np.array([nm.startswith(prefix) for nm in names]); mag = np.abs(Dn[m]).sum(0)
        group["Left" if mag[386].sum() > mag[159].sum() else "Right"] = m
    squint = pose("squint"); out = {}
    for side, m in group.items():
        out[f"browDown{side}"] = np.clip(np.where(m, squint, 0.0), -4, 4)
    out["cheekPuff"] = np.clip(np.where(lower, pose("blow"), 0.0), -4, 4)
    lids = {nm: {s: lid_share(R, w, Dn, s) for s in LID_PAIRS} for nm, w in out.items()}
    happy = np.tensordot(pose("happy"), Dn, 1)
    corner = {"Left": [291], "Right": [61]}; wing = {"Left": [294, 278], "Right": [64, 48]}
    R["options"]["smile_wing_ratio"] = {s: round(float(np.mean([happy[i] @ upv for i in wing[s]]) / np.mean([happy[i] @ upv for i in corner[s]])), 3) for s in wing}
    return out, lids


def nose_sneer_shapes(R, Vb, ok):
    """한쪽 코 찡그림 변위(nbase, 3): 콧볼과 그 둘레가 올라가며 뒤로 당겨지고, 거리와 가운데 선을 넘어가며 잦아든다.
    ok: 움직일 수 있는 피부 정점"""
    lx = np.array(R["expr"]["lid"]); iod = R["iod"]; rt, upv, fw = (np.array(R["axes"][k]) for k in ("right", "up", "fwd"))
    tip = Vb[lx[4]]; out = {}
    for side, ids in SNEER_WINGS.items():
        c = Vb[lx[ids]].mean(0); sign = np.sign((c - tip) @ rt)
        d = np.linalg.norm(Vb - c, axis=1) / iod
        lateral = ((Vb - tip) @ rt) * sign / iod
        across = np.clip((lateral + 0.02) / 0.05, 0, 1); across = across * across * (3 - 2 * across)
        w = np.where(ok, np.exp(-0.5 * (d / SNEER_RADIUS) ** 2) * across, 0.0); w[w < 0.01] = 0.0
        out[side] = w[:, None] * (SNEER_LIFT * upv - SNEER_BACK * fw)[None, :] * iod
    return out


def brow_knit_shapes(R, Vb, ok):
    """한쪽 미간 모임 변위(nbase, 3): 눈썹 머리와 둘레가 가운데로(가운데 선 자체는 그대로 → 사이 살이 모인다), 그 쪽 몫의
    모인 살이 앞으로. 눈썹 아래(윗눈꺼풀)는 움직이지 않는다"""
    lx = np.array(R["expr"]["lid"]); iod = R["iod"]; rt, upv, fw = (np.array(R["axes"][k]) for k in ("right", "up", "fwd"))
    heads = {s: Vb[lx[list(p)]].mean(0) for s, p in KNIT_BROWS.items()}; mid = (heads["Left"] + heads["Right"]) / 2
    smooth = lambda t: np.clip(t, 0, 1) ** 2 * (3 - 2 * np.clip(t, 0, 1))
    out = {}
    for side, (upper, lower) in KNIT_BROWS.items():
        head = heads[side]; sign = np.sign((head - mid) @ rt); reach = abs((head - mid) @ rt) / iod
        lateral = ((Vb - mid) @ rt) * sign / iod
        below = smooth(((Vb - Vb[lx[lower]]) @ upv / iod + 0.12) / 0.09)
        front = ((Vb - mid) @ fw) / iod > -0.3
        rel = Vb - head; side_d = (rel @ rt) / iod; depth_d = (rel @ fw) / iod
        over = ((Vb - Vb[lx[upper]]) @ upv) / iod
        rise = np.where(over > KNIT_UP, (over - KNIT_UP) / KNIT_RADIUS, 0.0)
        near = np.exp(-0.5 * ((side_d / KNIT_RADIUS) ** 2 + (depth_d / KNIT_RADIUS) ** 2 + rise ** 2))
        pull = np.where(ok & front, near * smooth(lateral / reach) * below, 0.0)
        low = ((Vb - Vb[lx[lower]]) @ upv) / iod; span = ((Vb[lx[upper]] - Vb[lx[lower]]) @ upv) / iod + KNIT_UP
        hy = low - span / 2
        bulge = np.where(ok & front & (lateral > -0.5 * reach), np.exp(-0.5 * ((lateral / 0.07) ** 2 + (hy / (0.45 * span)) ** 2)) * smooth(lateral / 0.05 + 1), 0.0)
        bulge = 0.5 * bulge * below; pull[pull < 0.01] = 0.0; bulge[bulge < 0.005] = 0.0
        out[side] = (-KNIT_IN * sign * pull[:, None] * rt[None, :] + KNIT_BULGE * bulge[:, None] * fw[None, :]) * iod
    return out


def add_extra_shapes(R, fields):
    """직접 만든 변위를 풀이에 쓰지 않는 성분으로 덧붙인다(P에는 0인 줄). 덧붙인 성분 번호를 돌려준다"""
    g = R["gnmx"]; K = g["K"]; P = unb(g["P"], "<f4").reshape(K, -1)
    for name, d in fields.items():
        m = np.linalg.norm(d, axis=1); keep = np.where(m > 0)[0]; sc = float(np.abs(d[keep]).max()) / 32000 + 1e-12
        g["shapes"][name] = {"idx": b64(keep, "<i4"), "q": b64(np.round(d[keep] / sc), "<i2"), "sc": sc}; g["names"].append(name)
    g["K"] = len(g["names"]); g["P"] = b64(np.vstack([P, np.zeros((len(fields), P.shape[1]), np.float32)]), "<f4")
    K = g["K"]
    for nm, text in R["expr"]["native"].items():               # 직접 정의한 표정 가중치도 성분 수만큼 늘린다
        w = unb(text, "<f4"); R["expr"]["native"][nm] = b64(np.concatenate([w, np.zeros(K - len(w))]), "<f4")
    return {nm: g["names"].index(nm) for nm in fields}


def mirror_map(T):
    """템플릿 정점마다 좌우 짝(GNM 평균 머리 T에서 반사한 위치에 가장 가까운 정점). 화면이 표정을 거울처럼 뒤집는 데 쓴다"""
    from scipy.spatial import cKDTree
    Q = T.copy(); Q[:, 0] = 2 * np.median(T[:, 0]) - Q[:, 0]   # GNM 좌표: x = 좌우
    dist, part = cKDTree(T).query(Q)
    return part.astype(np.int32), float(dist.max())


def build(glb, rig):
    """표정 리그(dict)와 측정값(dict)"""
    import teeth_place
    from gnm_model import GNM, template_map
    R = read_json(rig)
    if R.get("format") != "live-mirror-rig" or not R.get("gnmx") or not R.get("expr"):
        raise SystemExit("rig.json has no GNM expression block (gnmx / expr)")
    n = R["expr"]["nbase"]; iod = R["iod"]; info = {}
    G = GNM(); o2g = template_map()[0]; T = G.T[o2g]        # GNM은 한 번만 불러와 모든 단계가 함께 쓴다(한 번에 약 0.45초)
    R["options"] = {"landmark_trust": dict(TRUST), "sigma_frac": SIGMA, "solve_without_oval": True}
    info["components"] = R["options"]["components"] = regen_components(R, G, N_EYE, N_LOWER)
    # 얼굴 점 대응: 안쪽 윗입술·아랫입술 점을 각자 입술 정점으로 나눈다(같은 정점이면 입을 벌려도 상쇄된다)
    lid, li = VD.lip_split_lid(np.array(R["expr"]["lid"]), G)
    if li is None: raise SystemExit("lip split needs the GNM model (tools/fetch_models.py)")
    V = base_positions(glb, n)
    if np.isnan(V).any(): raise SystemExit("the glb does not carry every base vertex")
    R["expr"]["lid"] = [int(x) for x in lid]; R["expr"]["lmk"] = b64(V[lid], "<f4")
    Dn = component_fields(R, at=lid)                       # 성분마다 얼굴 점 변위: 풀이·찡그림·배율이 함께 쓴다
    P32 = solve_P(R, Dn); R["gnmx"]["P"] = b64(P32, "<f4"); R["options"]["lip_split"] = info["lip_split"] = li
    # 입 안: 치아·잇몸·혀를 이 입에 맞게 놓고, 입술-치아 접촉과 입 안 색을 만든다
    tpl = np.load(VD.TEMPLATE)
    lidm = np.array(read_json(os.path.join(ROOT, "assets", "gnm_mp468.json"))["vertex"])
    Vp, info["teeth_place"] = teeth_place.place(V, T, tpl["materials"], tpl["components"], float(np.linalg.norm(T[lidm[33]] - T[lidm[263]])), tpl["triangles"].astype(np.int64))
    pid = np.where(np.isin(tpl["components"], list(teeth_place.PARTS.values())))[0]
    ct = VD.lip_contact_block(Vp, iod, G=G)
    rgb = VD.mouth_colors(Vp, pid, R["axes"]["fwd"], iod)
    mouth = {"contact": {k: ct[k] for k in ("v", "cand", "c", "ncand", "reach", "hard", "normal", "nbr_ptr", "nbr")},
             "placed": {"idx": b64(pid, "<i4"), "pos": b64(Vp[pid], "<f4"), "rgb": b64(rgb, "<f4")}}
    info["lip_contact_vertices"] = ct["n"]
    # 입 벌림(이름 붙은 표정 jawOpen): 윗입술·아랫입술 가운데를 가장 많이 벌리는 아래 얼굴 성분들의 조합
    grp = lambda nm: G.group(nm)[o2g]; upv = np.array(R["axes"]["up"]); rtv = np.array(R["axes"]["right"])
    cen = np.abs((V - V[lid[168]]) @ rtv) < 0.08 * iod; ext = grp("skin_exterior")
    U = np.where(grp("upper_lip") & ext & cen)[0]; Lo = np.where(grp("lower_lip") & ext & cen)[0]
    lowers = [nm for nm in R["gnmx"]["names"] if nm.startswith("gx_lower_face")]; Dl = dict(zip(lowers, component_fields(R, lowers)))
    dg = {nm: float((d[U] @ upv).mean() - (d[Lo] @ upv).mean()) for nm, d in Dl.items()}
    top = max(abs(v) for v in dg.values()); jaw = sum(1.5 * np.sign(dg[nm]) * Dl[nm] for nm in Dl if abs(dg[nm]) > 0.2 * top)
    R["expr"]["named_extra"] = {"jawOpen": b64(jaw[lid], "<f4")}
    info["jaw_open_gap_iod"] = round(float(((jaw[U] @ upv).mean() - (jaw[Lo] @ upv).mean()) / iod), 3)
    # 머리 관절(고개를 돌릴 때 목에서 부드럽게 이어진다)
    hj = VD.head_joint_block(V, G)
    if hj is None: raise SystemExit("head joint needs the GNM model (tools/fetch_models.py)")
    head = {"w": hj["w"], "pivot": hj["pivot"]}
    # 얼굴 점이 약하게 보는 표정: 풀이가 이름 붙은 표정을 얼마나 전달하나 → 배율 = 1 / 전달률(1~2)
    Pm = P32.astype(np.float64); ng = {}
    for nm in ("mouthFunnel", "browInnerUp", "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper"):
        sh = R["rig"]["shapes"].get(nm)
        if not sh: continue
        d = np.zeros((n, 3)); d[unb(sh["idx"], "<i4")] = unb(sh["d"], "<f4").astype(np.float64).reshape(-1, 3); t = d[lid]
        sol = np.tensordot(np.clip(Pm @ t.reshape(-1), -4, 4), Dn, 1); mg = np.linalg.norm(t, axis=1); act = mg > 0.15 * mg.max()
        ng[nm] = round(float(np.clip(1.0 / max((sol[act] * t[act]).sum() / (t[act] ** 2).sum(), 1e-3), 1.0, 2.0)), 3)
    R["options"]["named_gain"] = info["named_gain"] = ng
    # 입술 내밀기: 입술 정점 전체가 눈 사이 거리의 0.10만큼 앞으로(입꼬리는 가운데로 0.35배) 나오고 나머지 아래 얼굴은
    # 그대로인 아래 얼굴 성분 가중치(능형 1)
    names = R["gnmx"]["names"]; lf = np.array([nm.startswith("gx_lower_face") for nm in names]); K = len(names)
    Dfull = np.array([Dl[nm] for nm in lowers]); fwv = np.array(R["axes"]["fwd"])
    lipm = (grp("upper_lip") | grp("lower_lip")) & ext
    face = ext & (grp("chin_region") | grp("left_cheek_region") | grp("right_cheek_region") | grp("nose_region") | grp("upper_lip_region") | grp("lower_lip_region"))
    lv = np.where(lipm & ~np.isnan(V[:, 0]))[0]; ov = np.where(face & ~lipm)[0]
    Ln = unb(R["expr"]["lmk"], "<f4").astype(np.float64).reshape(-1, 3)
    xs = (V[lv] - Ln[168]) @ rtv; mw = abs((Ln[291] - Ln[61]) @ rtv) / 2; amp = 0.10 * iod
    tgt = np.tile(fwv * amp, (len(lv), 1)) - rtv[None, :] * (np.clip(xs / mw, -1, 1) * 0.35 * amp)[:, None]
    Am = np.concatenate([Dfull[:, lv].reshape(len(Dfull), -1).T, np.sqrt(0.05) * Dfull[:, ov].reshape(len(Dfull), -1).T]); bm = np.concatenate([tgt.reshape(-1), np.zeros(len(ov) * 3)])
    sgm = 0.01 * iod; wl = np.linalg.solve(Am.T @ Am / sgm ** 2 + np.eye(Am.shape[1]), Am.T @ bm / sgm ** 2)
    wn = np.zeros(K); wn[lf] = np.clip(wl, -4, 4)
    native = {"mouthPucker": wn}
    # 찡그림·볼 부풀리기(GNM 의미 표정), 미소 콧볼 비율
    poses, native_lid = learned_poses(R, Dn); native.update(poses)
    R["expr"]["native"] = {nm: b64(w, "<f4") for nm, w in native.items()}; R["expr"]["native_lid"] = native_lid
    # 좌우 짝
    mir, mir_err = mirror_map(T); R["expr"]["mirror"] = b64(mir, "<i4"); info["mirror_max_mm"] = round(1000 * mir_err, 2)
    # 직접 만든 형상은 맨 뒤에 덧붙인다(위 계산은 GNM 성분을 이름으로 읽는다)
    ok = grp("skin") & ~np.isnan(V[:, 0])
    sneer = nose_sneer_shapes(R, V, ok); knit = brow_knit_shapes(R, V, ok)
    at = add_extra_shapes(R, {**{f"x_noseSneer{s}": f for s, f in sneer.items()}, **{f"x_browKnit{s}": f for s, f in knit.items()}})
    K = R["gnmx"]["K"]
    for side in SNEER_WINGS:
        one = np.zeros(K); one[at[f"x_noseSneer{side}"]] = 1.0; R["expr"]["native"][f"noseSneer{side}"] = b64(one, "<f4")
    for side in KNIT_BROWS:
        w = unb(R["expr"]["native"][f"browDown{side}"], "<f4").copy(); w[at[f"x_browKnit{side}"]] = 1.0
        R["expr"]["native"][f"browDown{side}"] = b64(w, "<f4")
    rtv_ = np.array(R["axes"]["right"])
    info["brow_knit_in_pct_iod"] = {s: round(100 * float(abs(np.mean([f[lid[i]] @ rtv_ for i in KNIT_BROWS[s]]))) / iod, 2) for s, f in knit.items()}
    R["options"]["built_by"] = "tools/rig_expression.py"
    E = {"format": R["format"], "version": R["version"], "id": R.get("id"), "fit_sha": R.get("fit_sha"),
         "iod": iod, "axes": R["axes"], "options": R["options"], "gnmx": R["gnmx"],
         "expr": {k: R["expr"][k] for k in ("nbase", "lid", "lmk", "named_extra", "native", "native_lid", "mirror")},
         "rig": {k: R["rig"][k] for k in ("shapes", "eyes") if k in R.get("rig", {})}, "mouth": mouth, "head": head,
         "note": "expression tracking rig (GNM Head v3 expression components, Apache-2.0). Personal face geometry: private storage only."}
    return E, info


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("glb"); ap.add_argument("rig"); ap.add_argument("--out", required=True)
    a = ap.parse_args()
    if os.path.abspath(a.out) in (os.path.abspath(a.rig), os.path.abspath(a.glb)): raise SystemExit("--out must be a new file")
    E, info = build(a.glb, a.rig)
    tmp = a.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh: json.dump(E, fh, separators=(",", ":"))
    os.replace(tmp, a.out)
    print(json.dumps({"out": a.out, "bytes": os.path.getsize(a.out), **info}, ensure_ascii=False))


if __name__ == "__main__":
    main()
