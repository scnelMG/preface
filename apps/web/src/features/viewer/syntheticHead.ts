import {
  BufferAttribute,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type BufferGeometry,
} from 'three'

/**
 * 확인용 합성 머리. **실제 얼굴 스캔이 아니다.** 타원체에 코 모양을 수식으로 얹은 메시다.
 *
 * 저장소에 라이선스가 분명한 기본 모델(GNM 등) GLB가 아직 없어서, 뷰어·morph 반영을 이 메시로 확인한다.
 * morph target 이름은 서비스 저장 코드(`nose.bridge_height` 등)를 그대로 쓴다. `/dev/viewer`는 이 메시를
 * GLTFExporter로 GLB로 바꿔 실제 GLB 로드 경로(useGLTF)로 불러온다.
 *
 * 좌표: +Y 위, 얼굴은 +Z. 머리 높이 약 2(단위 없음).
 */

export const SYNTHETIC_MORPH_CODES = [
  'nose.bridge_height',
  'nose.tip_height',
  'nose.alar_width',
] as const

type Vec3 = [number, number, number]

const gauss = (value: number, sigma: number) => Math.exp(-((value / sigma) ** 2))

/** 얼굴 앞쪽(+Z)에서만 1에 가깝다. 뒤통수가 같이 움직이지 않게 한다 */
const frontMask = (z: number) => Math.min(1, Math.max(0, (z - 0.45) / 0.25))

/** 기본 코 높이(+Z 방향 돌출). 콧대 → 코끝으로 높아지고 코끝 아래에서 급히 꺼진다 */
function baseNose(x: number, y: number): number {
  const bridge = y > -0.18 ? 0.04 + 0.2 * Math.min(1, (0.3 - y) / 0.48) : 0
  const ridge = bridge * gauss(x, 0.06 + 0.06 * Math.max(0, (0.3 - y) / 0.5)) * (y < 0.32 ? 1 : 0)
  const tip = 0.06 * gauss(x, 0.06) * gauss(y + 0.17, 0.05)
  const alar = 0.07 * (gauss(Math.abs(x) - 0.1, 0.05) * gauss(y + 0.21, 0.05))
  return ridge + tip + alar
}

/** 콧볼 좌우로 벌리는 매끈한 홀함수. |x| = 0.2/√2(≈0.14)에서 최대 1, 가운데(x=0)는 움직이지 않는다 */
const ALAR_SPREAD = 0.2
const alarSpread = (x: number) =>
  (x * Math.exp(-((x / ALAR_SPREAD) ** 2))) / (ALAR_SPREAD * Math.SQRT1_2 * Math.exp(-0.5))

/**
 * 효과별 변위(원본 대비). 계약 "+ 방향": 콧대 높아짐, 코끝 위로, 콧볼 넓어짐.
 *
 * 크기: 기본 모델 체험(BaseModelTrial)은 3D 칸이 작아(데스크톱 약 740×213px) 머리가 100px 남짓으로 보인다.
 * 슬라이더 끝값(0.5~0.8)에서 코가 눈에 띄게 바뀌도록 머리 높이(약 2)의 몇 %를 움직인다(S15P31B204-390).
 * 체험·API-EDIT-01 예시 범위(콧대 -0.5~0.8, 코끝·콧볼 ±0.5)에서는 면이 뒤집히지 않게 폭(σ)을 같이 넓혔다
 * (변위 기울기 × weight의 절댓값 < 1). 콧볼 -1(계약 한계)처럼 그 밖에서는 가운데가 접힐 수 있다.
 */
const DELTAS: Record<(typeof SYNTHETIC_MORPH_CODES)[number], (p: Vec3) => Vec3> = {
  'nose.bridge_height': ([x, y]) => [0, 0, 0.3 * gauss(x, 0.1) * gauss(y - 0.04, 0.2)],
  'nose.tip_height': ([x, y]) => [0, 0.22 * gauss(x, 0.12) * gauss(y + 0.18, 0.2), 0],
  'nose.alar_width': ([x, y]) => [0.16 * alarSpread(x) * gauss(y + 0.21, 0.1), 0, 0],
}

function headGeometry(): SphereGeometry {
  const geometry = new SphereGeometry(1, 128, 96)
  const position = geometry.getAttribute('position')
  for (let i = 0; i < position.count; i += 1) {
    const sx = position.getX(i)
    const sy = position.getY(i)
    const sz = position.getZ(i)
    // 타원체: 폭 0.78, 깊이 0.9
    const x = sx * 0.78
    const y = sy
    let z = sz * 0.9
    const mask = frontMask(z)
    // 눈두덩 아래 오목, 코
    z += mask * (baseNose(x, y) - 0.05 * gauss(Math.abs(x) - 0.3, 0.12) * gauss(y - 0.12, 0.08))
    position.setXYZ(i, x, y, z)
  }
  geometry.computeVertexNormals()
  return geometry
}

/** 기본 메시에 효과별 morph target(위치·법선, 상대값)을 붙인다 */
function addMorphTargets(geometry: BufferGeometry): void {
  const base = geometry.getAttribute('position')
  const baseNormal = geometry.getAttribute('normal')
  const positions: BufferAttribute[] = []
  const normals: BufferAttribute[] = []

  for (const code of SYNTHETIC_MORPH_CODES) {
    const delta = new Float32Array(base.count * 3)
    const moved = geometry.clone()
    const movedPosition = moved.getAttribute('position')
    for (let i = 0; i < base.count; i += 1) {
      const p: Vec3 = [base.getX(i), base.getY(i), base.getZ(i)]
      const mask = frontMask(p[2])
      const [dx, dy, dz] = DELTAS[code](p).map((v) => v * mask) as Vec3
      delta.set([dx, dy, dz], i * 3)
      movedPosition.setXYZ(i, p[0] + dx, p[1] + dy, p[2] + dz)
    }
    moved.computeVertexNormals()
    const movedNormal = moved.getAttribute('normal')
    const normalDelta = new Float32Array(base.count * 3)
    for (let i = 0; i < base.count; i += 1) {
      normalDelta.set(
        [
          movedNormal.getX(i) - baseNormal.getX(i),
          movedNormal.getY(i) - baseNormal.getY(i),
          movedNormal.getZ(i) - baseNormal.getZ(i),
        ],
        i * 3,
      )
    }
    moved.dispose()
    positions.push(new BufferAttribute(delta, 3))
    normals.push(new BufferAttribute(normalDelta, 3))
  }

  geometry.morphAttributes.position = positions
  geometry.morphAttributes.normal = normals
  geometry.morphTargetsRelative = true
}

/** 합성 머리(머리 + 목). 머리 메시에만 morph target이 있다 */
export function createSyntheticHead(): Group {
  const material = new MeshStandardMaterial({ color: 0xeeebe5, roughness: 0.82, metalness: 0 })

  const headGeo = headGeometry()
  addMorphTargets(headGeo)
  const head = new Mesh(headGeo, material)
  head.name = 'synthetic_head'
  head.updateMorphTargets()
  // updateMorphTargets는 이름 없이 0,1,2로 사전을 만든다. GLB의 target 이름처럼 저장 코드로 바꾼다
  head.morphTargetDictionary = Object.fromEntries(
    SYNTHETIC_MORPH_CODES.map((code, index) => [code, index]),
  )
  head.morphTargetInfluences = SYNTHETIC_MORPH_CODES.map(() => 0)

  const neck = new Mesh(new CylinderGeometry(0.42, 0.5, 1.1, 64, 1, true), material)
  neck.name = 'synthetic_neck'
  neck.position.set(0, -1.15, -0.08)

  const group = new Group()
  group.name = 'synthetic_head_root'
  group.add(head, neck)
  return group
}
