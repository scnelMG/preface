/**
 * 표정 주름 음영(시험, 2026-11-14). 찡그릴 때 미간 세로 주름, 눈썹을 올릴 때 이마 가로 주름을 피부 셰이더에서 그린다.
 *
 * 왜 형상이 아니라 음영인가: 주름 골은 폭 1 mm 안팎인데 피부 메시의 모서리는 2 mm 안팎이라 정점을 움직여서는 그릴 수 없다.
 * 모션 캡처용 얼굴도 표정 값에 따라 주름 노멀맵을 섞는다. 여기서는 텍스처를 따로 만들지 않고, 정점마다 얼굴 좌표
 * (눈썹 안쪽 끝 사이를 원점으로 오른쪽·위·앞, 눈 사이 거리 단위)를 붙여 두고 픽셀마다 주름 높이와 기울기를 식으로
 * 계산한다 → 메시 해상도·UV와 무관하고, 좌표가 정점에 붙어 있어 주름이 피부와 함께 움직인다.
 * 법선은 높이의 표면 기울기(surface gradient, 화면 미분으로 접평면을 잡는다)로 기울이고, 골 안쪽은 조금 어둡게 한다.
 *
 * 주름 모양(위치·폭·깊이)은 사람별 값이 아니라 일반적인 얼굴 비율로 정한 시험값이다. 사람마다 주름 자리는 다르다.
 */
import { BufferAttribute, MeshStandardMaterial, type Mesh } from 'three'
import type { ExpressionRig } from './rig'

/** 양 눈썹 안쪽 끝(MediaPipe): 윗선(얼굴 좌표 원점)과 아랫선 */
const INNER_BROWS = [107, 336]
const INNER_BROWS_LOW = [55, 285]
/**
 * 미간 세로 주름의 윗끝: 눈썹 머리 윗선에서 눈 사이 거리의 이만큼 위(약 4 mm). 0.15(약 1 cm)는 주름이 너무 길었다
 * (만두 11/15). rig 도구의 미간 모임 형상(`tools/rig_expr_upgrade.py` KNIT_UP)도 같은 높이까지 피부를 모은다
 */
const MIDBROW_TOP = 0.06

interface Uniforms {
  uFrown: { value: number }
  uRaise: { value: number }
  uSneer: { value: number }
  uWrinkleIod: { value: number }
  /** 눈썹 머리 아랫선 높이(음수)와 그 좌우 반 너비(얼굴 좌표). 미간 주름을 그 사람 눈썹 머리 사이에 놓는다 */
  uBrowLow: { value: number }
  uBrowGap: { value: number }
}
const installed = new WeakMap<MeshStandardMaterial, Uniforms>()

const VERTEX_HEAD = `
attribute vec3 wrinkleCoord;
varying vec3 vWrinkle;
varying float vWrinkleScale;
`
const FRAGMENT_HEAD = `
#define MIDBROW_TOP ${MIDBROW_TOP.toFixed(3)}
uniform float uFrown;
uniform float uRaise;
uniform float uSneer;
uniform float uWrinkleIod;
uniform float uBrowLow;
uniform float uBrowGap;
varying vec3 vWrinkle;
varying float vWrinkleScale;

float wrinkleBell(float d, float s) { return exp(-0.5 * d * d / (s * s)); }

// 주름 높이(눈 사이 거리 단위, 골은 음수). 좌표 p = 얼굴 좌표 x(오른쪽)·y(위)
float wrinkleHeight(vec2 p) {
  float h = 0.0;
  if (uFrown > 0.001) {
    // 미간: 눈썹 머리를 모으는 근육(추미근)이 눈썹 머리 사이 피부를 모아 접는다 — 눈썹 머리 바로 안쪽의 짧은 세로 골
    // 두 줄과 그 사이로 모인 살. 골은 눈썹 머리 높이 안에서 시작해 눈썹 위로 조금만(MIDBROW_TOP) 올라간다.
    // 콧등 쪽으로 내려가면 어색했고, 눈썹 위 1 cm까지는 너무 길었다(만두 11/15)
    float low = uBrowLow + 0.02;
    float top = MIDBROW_TOP;
    float mid = 0.5 * (low + top);
    float lineHalf = 0.5 * (top - low);
    float along = smoothstep(low - 0.02, low + 0.02, p.y) * (1.0 - smoothstep(top - 0.02, top + 0.02, p.y));
    // 줄 위의 자리(-1 아래 끝, 0 가운데, 1 위 끝)
    float t = clamp((p.y - mid) / lineHalf, -1.0, 1.0);
    float bell = 1.0 - t * t;
    for (int k = 0; k < 2; k++) {
      float side = k == 0 ? -1.0 : 1.0;
      // 두 줄은 ")(" 처럼 가운데가 서로 가장 가깝다: 모인 살이 가운데로 몰리며 줄이 활처럼 휜다. 곧은 "11" 자는
      // 칼자국처럼 인위적이었고, 위로 벌어지는 V 자도 어색했다(만두 11/14, 11/15)
      float dx = side * p.x - (0.7 * uBrowGap - 0.018 * bell);
      // 가운데가 가장 깊고 넓고, 양 끝으로 가며 가늘고 얕아져 사라진다(끝이 뚝 끊기지 않게).
      // 피부가 덜 접히면 넓고 얕은 골이고, 세게 찡그릴수록 좁고 깊어진다. 골 옆에 밀려 부푼 살(밝은 가장자리)은 세게
      // 찡그릴 때만 생긴다. 세기와 상관없이 좁은 골에 가장자리까지 그리면 옅을 때도 새긴 선처럼 또렷했다(만두 11/15)
      float width = (0.007 + 0.006 * bell) * mix(1.8, 1.25, uFrown);
      float depth = along * (0.15 + 0.85 * bell);
      h += depth * (-0.006 * wrinkleBell(dx, width) + 0.0015 * uFrown * (wrinkleBell(dx - 0.026, 0.013) + wrinkleBell(dx + 0.026, 0.013)));
    }
    // 두 줄 사이로 모인 살
    h += 0.003 * wrinkleBell(p.x, 0.045) * wrinkleBell(p.y - mid, 0.05);
    h *= uFrown;
  }
  if (uRaise > 0.001) {
    // 이마: 가로 골 세 줄. 줄마다 길이·깊이가 다르고 조금씩 물결치며, 양옆으로 갈수록 올라간다
    float r = 0.0;
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float y0 = 0.22 + 0.125 * fk + 0.16 * p.x * p.x + 0.010 * sin(7.0 * p.x + 1.7 * fk);
      float reach = k == 1 ? 0.5 : (k == 0 ? 0.36 : 0.3);
      float span = 1.0 - smoothstep(reach, reach + 0.2, abs(p.x));
      float depth = 0.65 + 0.35 * sin(5.0 * p.x + 2.3 * fk);
      r -= 0.0022 * span * depth * wrinkleBell(p.y - y0, 0.02);
    }
    h += r * uRaise;
  }
  if (uSneer > 0.001) {
    // 코 찡그림: 콧등 옆면에 비스듬한 짧은 골 두세 줄(콧볼을 끌어올리는 근육이 콧등 피부를 모은다)
    float n = 0.0;
    for (int k = 0; k < 2; k++) {
      float side = k == 0 ? -1.0 : 1.0;
      vec2 q = vec2(side * p.x, p.y);
      for (int j = 0; j < 3; j++) {
        float fj = float(j);
        vec2 c = vec2(0.055 + 0.012 * fj, -0.20 - 0.035 * fj);
        vec2 dir = normalize(vec2(0.8, -0.6));
        vec2 d = q - c;
        float along = dot(d, dir);
        float across = dot(d, vec2(-dir.y, dir.x));
        n -= (j == 1 ? 0.004 : 0.003) * wrinkleBell(across, 0.008) * wrinkleBell(along, 0.022);
      }
    }
    h += n * uSneer;
  }
  return h;
}

// vec3(높이, dh/dx, dh/dy): 기울기는 얼굴 좌표에서 차분으로(모양 식을 바꿔도 따로 미분할 필요가 없다)
vec3 wrinkleField(vec3 c) {
  if (c.z < -0.35 || (uFrown <= 0.001 && uRaise <= 0.001 && uSneer <= 0.001)) return vec3(0.0);   // 얼굴 앞면만
  const float e = 0.002;
  return vec3(
    wrinkleHeight(c.xy),
    (wrinkleHeight(c.xy + vec2(e, 0.0)) - wrinkleHeight(c.xy - vec2(e, 0.0))) / (2.0 * e),
    (wrinkleHeight(c.xy + vec2(0.0, e)) - wrinkleHeight(c.xy - vec2(0.0, e))) / (2.0 * e));
}
`

function install(material: MeshStandardMaterial): Uniforms {
  const known = installed.get(material)
  if (known) return known
  const uniforms: Uniforms = {
    uFrown: { value: 0 },
    uRaise: { value: 0 },
    uSneer: { value: 0 },
    uWrinkleIod: { value: 1 },
    uBrowLow: { value: -0.08 },
    uBrowGap: { value: 0.12 },
  }
  const previous = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader =
      VERTEX_HEAD +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vWrinkle = wrinkleCoord;
         vWrinkleScale = length(modelViewMatrix[0].xyz);`,
      )
    shader.fragmentShader =
      FRAGMENT_HEAD +
      shader.fragmentShader
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
           vec3 wrinkle = wrinkleField(vWrinkle);
           // 골 안쪽 그늘: 가장 깊은 곳에서 22 %
           diffuseColor.rgb *= 1.0 - 0.22 * clamp(-wrinkle.x / 0.008, 0.0, 1.0);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
           if (wrinkle.y != 0.0 || wrinkle.z != 0.0) {
             // 높이를 화면 미분으로 옮긴다(얼굴 좌표의 화면 미분 × 해석적 기울기 → 높이 변화/픽셀, 보기 공간 길이)
             float unit = uWrinkleIod * vWrinkleScale;
             float dhx = unit * (wrinkle.y * dFdx(vWrinkle.x) + wrinkle.z * dFdx(vWrinkle.y));
             float dhy = unit * (wrinkle.y * dFdy(vWrinkle.x) + wrinkle.z * dFdy(vWrinkle.y));
             vec3 sx = dFdx(-vViewPosition);
             vec3 sy = dFdy(-vViewPosition);
             vec3 r1 = cross(sy, normal);
             vec3 r2 = cross(normal, sx);
             float det = dot(sx, r1);
             if (abs(det) > 1e-20) normal = normalize(normal - (dhx * r1 + dhy * r2) / det);
           }`,
        )
  }
  const previousKey = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = () => previousKey() + '|wrinkles'
  material.needsUpdate = true
  installed.set(material, uniforms)
  return uniforms
}

/**
 * 피부 메시에 얼굴 좌표를 붙이고 재질에 주름 음영을 넣는다. 좌표는 지금(표정을 얹기 전) 정점 위치에서 잰다.
 * 재질은 원본·비교용 모델이 함께 쓰므로 한 번만 고치고, 값은 어느 쪽이 써도 같다.
 */
export function installWrinkles(mesh: Mesh, rig: ExpressionRig) {
  const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(
    (material): material is MeshStandardMaterial => material instanceof MeshStandardMaterial,
  )
  if (!materials.length) return null
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position').array as Float32Array
  const origin = [0, 1, 2].map(
    (k) => (rig.lmk[3 * INNER_BROWS[0] + k] + rig.lmk[3 * INNER_BROWS[1] + k]) / 2,
  )
  const { right, up, fwd } = rig.axes
  /** 얼굴 점 i의 얼굴 좌표 [오른쪽, 위] */
  const face = (i: number) => {
    const d = [0, 1, 2].map((k) => rig.lmk[3 * i + k] - origin[k])
    return [
      (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / rig.iod,
      (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / rig.iod,
    ]
  }
  const [lowA, lowB] = INNER_BROWS_LOW.map(face)
  const browLow = (lowA[1] + lowB[1]) / 2
  const browGap = (Math.abs(lowA[0]) + Math.abs(lowB[0])) / 2
  const coord = new Float32Array(position.length)
  for (let i = 0; i < position.length; i += 3) {
    const d = [position[i] - origin[0], position[i + 1] - origin[1], position[i + 2] - origin[2]]
    coord[i] = (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / rig.iod
    coord[i + 1] = (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / rig.iod
    coord[i + 2] = (d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2]) / rig.iod
  }
  geometry.setAttribute('wrinkleCoord', new BufferAttribute(coord, 3))
  const all = materials.map(install)
  for (const uniforms of all) {
    uniforms.uWrinkleIod.value = rig.iod
    uniforms.uBrowLow.value = browLow
    uniforms.uBrowGap.value = browGap
  }
  return {
    /** 찡그림(미간)·눈썹 올림(이마)·코 찡그림(콧등 옆) 세기 0~1 */
    set(frown: number, raise: number, sneer: number) {
      for (const uniforms of all) {
        uniforms.uFrown.value = Math.min(1, Math.max(0, frown))
        uniforms.uRaise.value = Math.min(1, Math.max(0, raise))
        uniforms.uSneer.value = Math.min(1, Math.max(0, sneer))
      }
    },
  }
}
