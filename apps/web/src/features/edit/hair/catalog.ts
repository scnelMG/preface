import { ASSET_BASE_URL } from '@/shared/config/env'

/**
 * 실험실에서 고를 수 있는 헤어(S15P31B204-699, FN-HAIR-01).
 *
 * 성별로 나누지 않고 목록 하나로 둔다. 서버 헤어 템플릿(API-HAIR-01)에는 성별이 없고
 * 바인딩(사용자 머리에 맞추기)도 아직이라, 우선 정적 GLB를 GNM 평균 머리 기준으로 얹는다(hairFit.ts).
 * 파일이 준비된 헤어만 목록에 둔다(S15P31B204-712). 카드 방식 단발(bob-curtain)은 2026-11-09 사용자 결정으로 뺐다(S15P31B204-703).
 *
 * 블렌더 가닥 헤어(S15P31B204-703): 서비스 기본 머리(base-male·base-female) 위에서 만든 가닥을 평균 머리 좌표로 옮기고,
 * 가닥마다 얇은 띠(텍스처 있는 카드)로 바꿔 meshopt로 압축했다. 텍스처가 있어야 HairLayer가 두피 캡이 아닌 머리카락
 * 재질로 그린다. 리프컷은 팀 그룸(male_leaf_groom_1105, base-male)이다.
 * 2026-11-13 사용자 결정으로 레이어드컷·댄디컷·리프컷 세 가지만 둔다(턱선 단발·긴 웨이브·긴 생머리·내린 숏컷·앞머리 숏컷 1·2 뺌).
 * 2026-11-17 울프컷을 더했다(S15P31B204-919).
 * 카드 썸네일은 모두 같은 각도로 얼굴 없는 회색 마네킹 머리 위에 찍고, 마네킹과 헤어를 합친 덩어리를 카드 가운데에 맞춘다
 * (live-mirror-poc tools/hair_mh/bl_app_thumb.py THUMB_MANNEQUIN=1 THUMB_FACELESS=1 THUMB_FIT=0.12: 마네킹+헤어를 카드 가운데에 꽉 차게).
 *
 * `hairline`(S15P31B204-723): 헤어 자신의 앞쪽 경계(평균 머리 좌표, m). 사람 헤어라인에 맞출 때 이 점들을 옮긴다.
 * 가닥 헤어는 뿌리에서 잰다(이마 펼친 지도의 각도 10~170°, 10° 간격, 3% 분위, live-mirror-poc
 * tools/hair_mh/hair_edge.py). 없으면 사람 헤어라인 맞춤을 하지 않는다.
 *
 * `scalpPaint`(S15P31B204-703): 헤어를 쓴 동안 피부 위에 겹치는 두피 칠(RGBA, 템플릿 피부 UV). 얇은 띠 사이로 민머리가
 * 비치지 않게 한다. 뿌리가 촘촘한 곳만 칠하고 가르마·가마는 옅게 두며, 헤어 앞쪽 경계 2~9mm 안쪽에서 사라진다
 * (live-mirror-poc tools/hair_mh/scalp_paint.py). 덮개 메시는 헤어라인 밖으로 튀어나오고 정수리를 다 덮어 뺐다.
 */
export interface HairAsset {
  id: string
  label: string
  /** 정적 GLB. meshopt로 압축돼 있다(drei useGLTF가 바로 푼다) */
  url: string
  /** 카드 썸네일(평균 머리에 씌운 3/4 앞모습, 합성 모델) */
  thumbnail: string
  /** 헤어의 앞쪽 경계 점(평균 머리 좌표, 사람의 왼쪽 → 오른쪽) */
  hairline?: readonly (readonly [number, number, number])[]
  /** 두피 칠 텍스처(RGBA webp, 템플릿 피부 UV) */
  scalpPaint?: string
  /**
   * 그 사람 두상을 따라가는 방식(hairFit.ts). `surface`(기본)는 점마다 가까운 두피를 따라가 볼륨 전체가 두상에 붙는다
   * (댄디처럼 짧고 두상에 붙는 머리). `root`는 가닥마다 뿌리만 두피에 맞추고 가닥 전체를 그대로 옮겨 볼륨·컬을
   * 보존한다(굴곡 있는 긴 머리). 뿌리 방식은 가닥이 삼각형으로 이어진 튜브여야 한다.
   */
  skinFollow?: 'surface' | 'root'
  /**
   * 그 사람 귀에 맞추기(S15P31B204-919, `root` 방식에서만, earFit.ts). 사람 귀 면을 지나는 가닥은 얼굴 쪽으로 옮기고,
   * 못 비키는 가닥과 옆에서 볼 때 귀 윤곽 안에 드는 머리는 `keep` 비율만 귀 위에 남기고 나머지는 귀에 닿는 곳부터 자른다.
   * 없으면 귀를 따로 맞추지 않는다(평균 머리 귀 둘레를 넓게 비운 헤어)
   */
  earFit?: { keep: number }
}

export const HAIR_NONE = 'none'

/**
 * 편집 화면에 들어갈 때 이 모델에 헤어를 씌울 수 있는지 미리 확인하는 헤어(SimulationLab). 목록 첫 헤어(레이어드컷 22MB)는
 * 들어갈 때마다 받기에 무거워 가벼운 댄디컷(15MB)으로 한다
 */
export const HAIR_PROBE_ID = 'dandy'

/**
 * 편집·체험 화면에 들어온 뒤 한가할 때 미리 받아 맞춰 둘 순서(가벼운 것부터, S15P31B204-861). 리프컷 3MB → 댄디컷 15MB →
 * 레이어드컷 22MB → 울프컷 29MB(S15P31B204-919: 고를 때 받으면 오래 걸렸다). `HAIR_PREFETCH_HEAVY`는 데이터 절약·느린 회선·모바일에서는
 * 미리 받지 않고 헤어 탭에서 고를 때 받는다
 */
export const HAIR_PREFETCH_ORDER = ['male-leaf', 'dandy', 'layered', 'wolf'] as const
export const HAIR_PREFETCH_HEAVY: ReadonlySet<string> = new Set(['layered', 'wolf'])

export const HAIR_ASSETS: readonly HairAsset[] = [
  {
    // 평균 머리(GNM) 위에서 만든 가운데 가르마 레이어드 긴 머리 가닥 튜브(가닥 3.3만, S15P31B204-703). 색·굵기를 댄디에
    // 맞추고, 어깨를 파고들던 아래쪽을 목에서 어깨로 서서히 넓히고, 가닥을 펴고 꺾인 곳을 둥글게 하고 잔머리 층을 뺐다
    // (live-mirror-poc tools/hair_mh hair_match_look·hair_shoulder_skirt·hair_strand_smooth·hair_strand_refine·
    // hair_flyaway_tuck). 2026-11-14 수정본(v11): 얼굴에 붙던 앞머리 층을 뿌리에서 위로 솟게 하고(12mm), 뿌리 기준으로 8°
    // 안쪽으로 돌려 눈꼬리 쪽으로 오게 하고, 얼굴에서 18mm 띄웠다. 얼굴 옆 층은 관자놀이를 지날 때까지(뿌리에서 13cm) 두피에
    // 붙여 두고 그 아래도 앞으로만 띄워, 관자놀이 너머 배경이 비치거나 귀 옆이 옆으로 튀어나오지 않게 했다. 띄운 앞머리
    // 뿌리 쪽 8cm는 두피에 붙은 밑층을 한 벌 더 깔아 가르마 옆 이마 위가 비어 보이지 않게 했다(hair_fringe_lift). 가닥이
    // 거의 곧은 구간의 마디를 1mm 안에서 줄여(hair_ring_decimate, 마디 33%만 남김) 파일을 55MB에서 22MB로 줄였다. 볼륨이
    // 크고 굴곡 있는 긴 머리라 가닥마다 뿌리만 두피를 따라간다(`skinFollow: 'root'`, S15P31B204-795). 목록 맨 앞에 두지만
    // 파일이 댄디보다 커서(22MB) 편집 화면의 헤어 맞춤 확인은 댄디컷으로 한다(`HAIR_PROBE_ID`).
    // hairline은 가닥 뿌리를 foreheadMap과 같은 지도로 잰 17점 중 이마 모서리 4점(앞쪽 뿌리가 없어 정수리 뿌리가 잡힘)을 뺐다
    id: 'layered',
    label: '레이어드컷',
    url: `${ASSET_BASE_URL}/hair/layered.glb`,
    thumbnail: `${ASSET_BASE_URL}/hair/layered.webp`,
    scalpPaint: `${ASSET_BASE_URL}/hair/layered.scalp.webp`,
    skinFollow: 'root',
    hairline: [
      [0.0726, 0.3096, 0.0581],
      [0.0707, 0.3268, 0.065],
      [0.0699, 0.3469, 0.0586],
      [0.0597, 0.3598, 0.0724],
      [0.0278, 0.3827, 0.0862],
      [0.0123, 0.3862, 0.0893],
      [-0.0073, 0.387, 0.0894],
      [-0.016, 0.3855, 0.089],
      [-0.0229, 0.385, 0.0862],
      [-0.062, 0.3586, 0.0687],
      [-0.0675, 0.3497, 0.0644],
      [-0.0706, 0.3376, 0.0628],
      [-0.0725, 0.3089, 0.059],
    ],
  },
  {
    // 블렌더에서 평균 머리(GNM) 위에 만든 댄디컷 가닥 튜브(가닥 2.7만, S15P31B204-703). 2026-11-12 수정본: 이마로 내려오던 앞쪽
    // 가닥과 잔머리를 빼고, 귀 뒤 끝선을 일직선으로 자르고, 오른쪽 옆 앞머리 컬을 뒤로 돌렸다. 두피 따라 옮기기(S15P31B204-792)로
    // 목 쪽 뒷머리가 붙자 뒤통수 위가 떠 보여서, 귀 뒤부터 뒤통수까지 두피에서의 높이를 2/3로 줄였다(앞·옆은 그대로,
    // live-mirror-poc tools/hair_mh/hair_volume_scale.py --back-only). 다른 헤어와 달리 얇은 띠로 바꾸지 않고
    // 튜브 그대로 meshopt로 압축했다(띠로 바꾸면 앞머리 층과 볼륨이 무너졌다). 텍스처가 없어 hairMaterial의 무광 경로로 그려지고,
    // 색은 정점 색이다. 두피 칠은 뿌리에서 머릿결을 따라 그은 결 선이고 머리 끝(경계) 쪽으로 옅어진다.
    // hairline은 가닥 뿌리를 hairFit.ts foreheadMap과 같은 지도로 잰 것이다(live-mirror-poc tools/hair_mh/hair_edge.py)
    id: 'dandy',
    label: '댄디컷',
    url: `${ASSET_BASE_URL}/hair/dandy.glb`,
    thumbnail: `${ASSET_BASE_URL}/hair/dandy.webp`,
    scalpPaint: `${ASSET_BASE_URL}/hair/dandy.scalp.webp`,
    hairline: [
      [0.0724, 0.3176, 0.0579],
      [0.0689, 0.337, 0.0682],
      [0.0684, 0.3408, 0.0678],
      [0.0643, 0.3575, 0.0644],
      [0.0502, 0.3758, 0.0695],
      [0.0368, 0.3777, 0.0854],
      [0.0303, 0.381, 0.0867],
      [0.0208, 0.3892, 0.0808],
      [-0.0047, 0.395, 0.0764],
      [-0.0221, 0.3866, 0.0843],
      [-0.0256, 0.3826, 0.088],
      [-0.0421, 0.3751, 0.083],
      [-0.0559, 0.3693, 0.0686],
      [-0.0653, 0.3533, 0.0666],
      [-0.0671, 0.3468, 0.0678],
      [-0.0702, 0.3298, 0.0661],
      [-0.0723, 0.3105, 0.0596],
    ],
  },
  {
    id: 'male-leaf',
    label: '리프컷',
    url: `${ASSET_BASE_URL}/hair/male-leaf.glb`,
    thumbnail: `${ASSET_BASE_URL}/hair/male-leaf.webp`,
    scalpPaint: `${ASSET_BASE_URL}/hair/male-leaf.scalp.webp`,
    hairline: [
      [0.0717, 0.3191, 0.0558],
      [0.0695, 0.3334, 0.0638],
      [0.0656, 0.3452, 0.0704],
      [0.0611, 0.3538, 0.0747],
      [0.0547, 0.3637, 0.0774],
      [0.0414, 0.3739, 0.0847],
      [0.0254, 0.379, 0.0916],
      [0.0171, 0.3797, 0.0945],
      [-0.0033, 0.382, 0.0947],
      [-0.0193, 0.3792, 0.0939],
      [-0.0222, 0.3799, 0.0918],
      [-0.0413, 0.3739, 0.0838],
      [-0.0521, 0.3662, 0.0782],
      [-0.0608, 0.3536, 0.0746],
      [-0.0679, 0.3368, 0.068],
      [-0.071, 0.3247, 0.0595],
      [-0.0719, 0.3205, 0.056],
    ],
  },
  {
    // 평균 머리(GNM) 위에서 만든 울프컷 가닥 튜브(S15P31B204-919). 이마로 내려오던 잔머리 두 층을 빼고, 목에서 뜨던 뒷머리를
    // 구역마다 가장 안쪽 층이 목에 닿을 만큼 옮기되 바깥 층은 안쪽 층과의 간격을 20% 줄여 붙였다(hair_nape_settle
    // --compress 0.8). 거의 곧은 구간의 마디를 1mm 안에서 줄이고(hair_ring_decimate), 평균 머리 귀 둘레를 앞 2·뒤 1.5·위 3mm만
    // 비웠다(hair_ear_clear). 사람마다 귀가 평균 머리와 어긋나 귀를 지나는 가닥은 앱이 그 사람 귀에 맞춘다(`earFit`, 15%만 남김).
    // 두피 칠은 뒤통수를 꽉 칠하고 목덜미·앞 경계는 결 선으로 남겼다(scalp_paint --solid-behind 0.03 0.02 --solid-above 0.235
    // 0.03). hairline은 가닥 뿌리 경계(hair_edge.py)에서 정수리 뿌리가 잡히는 이마 모서리 4점을 빼고 두피를 따라 5mm 올렸다:
    // 앞머리가 사람 헤어라인보다 5mm 앞(아래)에 놓인다
    id: 'wolf',
    label: '울프컷',
    url: `${ASSET_BASE_URL}/hair/wolf.glb`,
    thumbnail: `${ASSET_BASE_URL}/hair/wolf.webp`,
    scalpPaint: `${ASSET_BASE_URL}/hair/wolf.scalp.webp`,
    skinFollow: 'root',
    earFit: { keep: 0.15 },
    hairline: [
      [0.077, 0.3206, 0.0278],
      [0.0684, 0.3344, 0.0674],
      [0.0668, 0.3567, 0.0561],
      [0.0552, 0.3681, 0.0696],
      [0.05, 0.3682, 0.0793],
      [0.0164, 0.3883, 0.0849],
      [0.0002, 0.3945, 0.0784],
      [-0.0154, 0.3899, 0.0826],
      [-0.0463, 0.374, 0.0777],
      [-0.0608, 0.3651, 0.0621],
      [-0.0703, 0.3519, 0.0494],
      [-0.0679, 0.3359, 0.0688],
      [-0.0761, 0.3268, 0.0333],
    ],
  },
]

/** 고른 헤어의 GLB 주소. 없음·모르는 값이면 null */
export function hairUrlOf(id: string): string | null {
  return HAIR_ASSETS.find((asset) => asset.id === id)?.url ?? null
}

/** GLB 주소로 헤어를 찾는다. 모르는 주소면 null */
export function hairAssetOfUrl(url: string): HairAsset | null {
  return HAIR_ASSETS.find((asset) => asset.url === url) ?? null
}
