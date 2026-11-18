// 눈 편집 엔진(쌍꺼풀 접힘·트임). 모든 변화는 불변 원본에서 계산하며 피부 외 메시에는 적용하지 않는다.
import { introducedSelfIntersectionFaces } from './mesh-audit.mjs';
import { scanEditLimit } from './edit-limit.mjs';
import LID_STEP from './lid-step.json' with { type: 'json' };
import LID_ROWS from './lid-rows.json' with { type: 'json' };
export { LID_STEP };

export const EYE_CONTROLS = [
  ['opening', '눈 뜨임', 0, 100, 0],
  ['inner', '앞트임', 0, 100, 0],
  ['outer', '뒤트임', 0, 100, 0],
  ['lower', '밑트임', 0, 100, 0],
  ['upper', '윗트임', 0, 100, 0],
  ['tail', '눈꼬리 높이', -100, 100, 0],
  ['crease', '쌍꺼풀 깊이', 0, 100, 0],
  ['height', '쌍꺼풀 높이', 0, 100, 20],
];
export const defaultEyeValues = () => Object.fromEntries(EYE_CONTROLS.map(([key, , , , value]) => [key, value]));
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm = (a) => Math.hypot(...a);
const unit = (a) => a.map(v => v / norm(a));
const gaussian = (x, width) => Math.exp(-0.5 * (x / width) ** 2);
const smooth = (a, b, x) => { if (b-a<1e-9) return x>=b ? 1 : 0; const t = Math.max(0, Math.min(1, (x-a)/(b-a))); return t*t*(3-2*t); };
const POINTS = {
  R: { inner: 133, outer: 33, upper: [133,173,157,158,159,160,161,246,33], lower: [133,155,154,153,145,144,163,7,33] },
  L: { inner: 362, outer: 263, upper: [362,398,384,385,386,387,388,466,263], lower: [362,382,381,380,374,373,390,249,263] },
};
// 템플릿 기준점의 고정 좌우 치우침: R 기준점 − (L 기준점을 얼굴 가운데 면으로 반전). POINTS 순서(위·아래 각 9점),
// 얼굴 축 [R 바깥쪽, 위, 앞], 평균 눈 폭 단위. 메시가 거의 대칭인 남녀 기본 모델에서 잰 값의 평균이다(두 모델 차이 0.011 이하).
// 모든 모델이 같은 템플릿 기준점 배치를 쓰므로 사람별 값이 아니다.
export const TEMPLATE_EYE_BIAS={
  upper:[[-.003,.032,.007],[-.005,-.028,.01],[-.052,-.017,.015],[.018,-.008,.017],[.019,.004,.021],[-.051,.031,.059],[.022,.029,.023],[.023,.045,.026],[.003,-.032,-.007]],
  lower:[[-.003,.032,.007],[-.011,-.006,.014],[.045,.034,-.003],[.024,.014,.018],[.021,.022,.022],[.018,.033,.025],[.022,.041,.029],[.021,.047,.031],[.003,-.032,-.007]],
};
function interpolate(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i=1; i<points.length; i++) if (x <= points[i][0]) {
    const a=points[i-1], b=points[i]; return a[1]+(b[1]-a[1])*(x-a[0])/Math.max(b[0]-a[0],1e-9);
  }
  return points.at(-1)[1];
}

export const CURVE_U = [.08,.29,.5,.71,.92];
export const DEFAULT_CURVE_ARCH=-30;
export function creaseHeights(height=20, style='inout') {
  const h=.09+.16*Math.max(0,Math.min(100,height))/100;
  const factors=style==='inline' ? [.08,.55,.95,1.1,1.2] : style==='inout' ? [.35,.82,1,1.1,1.2] : [.85,1,1.05,1.1,1.2];
  const arch=[0,.6,1,.6,0];
  return factors.map((v,i)=>Math.max(.005,Math.min(.36,h*v+DEFAULT_CURVE_ARCH*.0012*arch[i])));
}
export function creaseHeight(u, heights, style='inout') {
  return heightCurve(heights,style)(u);
}
// 5점 설계 높이 곡선을 미리 풀어 둔 평가기. 정점마다 부르는 곳(접힘 변위·영역)은 이것을 한 번 만들어 쓴다.
function heightCurve(heights,style) {
  const y=heights.map(v=>Math.max(.005,Math.min(.36,Number.isFinite(v)?v:.12)));
  const h0=CURVE_U[0],h1=CURVE_U[1]-h0,d0=y[0]/h0,d1=(y[1]-y[0])/h1;
  const joinSlope=d1>0 ? (3*(h0+h1))/((2*h1+h0)/d0+(h1+2*h0)/d1) : 0;
  // 5점을 지나는 3차 스플라인. 기울기와 휨이 모두 이어져 조절점에서 곡률이 급하게 바뀌지 않는다.
  // 이전(기울기만 잇는 곡선, 첫 점 기울기 0)은 인아웃 첫 점(u 0.08)에서 휨이 끊겨 높이를 올릴수록 앞머리가 꺾였다.
  // 인라인은 눈꺼풀 합류 기울기로 시작하고, 나머지는 첫 점 휨 0으로 시작해 그 앞은 같은 기울기로 이어진다.
  const bend=cachedBends(y,h1,style==='inline'?joinSlope:null);
  const lead=(y[1]-y[0])/h1-h1*(2*bend[0]+bend[1])/6;
  return u=>{
    if(style==='inline'&&u<h0) {
      const s=Math.max(0,u/h0);
      return Math.max(0,(3*s*s-2*s*s*s)*y[0]+(s*s*s-s*s)*h0*joinSlope);
    }
    if(u<h0)return Math.max(.005,Math.min(.36,y[0]+lead*(u-h0)));
    const x=Math.max(0,Math.min(4,(u-CURVE_U[0])/h1)),i=Math.min(3,Math.floor(x)),t=x-i;
    if(x>=4)return y[4];
    const a=1-t,value=a*y[i]+t*y[i+1]+h1*h1/6*((a**3-a)*bend[i]+(t**3-t)*bend[i+1]);
    return Math.max(.005,Math.min(.36,value));
  };
}
// 정점마다 같은 라인으로 다시 풀지 않도록 최근 결과를 둔다(정점 20만 개에서 계산 시간의 절반이 이 풀이였다).
const bendCache=new Map();
function cachedBends(y,h,start) {
  const key=`${start}|${y.join(',')}`;
  let bend=bendCache.get(key);
  if(!bend){bend=splineBends(y,h,start);if(bendCache.size>64)bendCache.delete(bendCache.keys().next().value);bendCache.set(key,bend);}
  return bend;
}
// 등간격 5점 3차 스플라인의 휨(2차 도함수). start가 있으면 첫 점 기울기 고정, 없으면 첫 점 휨 0. 끝점 휨은 0.
function splineBends(y,h,start) {
  const n=y.length,a=new Array(n).fill(0),b=new Array(n).fill(0),c=new Array(n).fill(0),d=new Array(n).fill(0);
  if(start===null){b[0]=1;}else{b[0]=2;c[0]=1;d[0]=6/h*((y[1]-y[0])/h-start);}
  for(let i=1;i<n-1;i++){a[i]=1;b[i]=4;c[i]=1;d[i]=6/(h*h)*(y[i+1]-2*y[i]+y[i-1]);}
  b[n-1]=1;
  for(let i=1;i<n;i++){const m=a[i]/b[i-1];b[i]-=m*c[i-1];d[i]-=m*d[i-1];}
  const out=new Array(n);out[n-1]=d[n-1]/b[n-1];
  for(let i=n-2;i>=0;i--)out[i]=(d[i]-c[i]*out[i+1])/b[i];
  return out;
}
// 설계선은 눈꺼풀 앞쪽(u≤0.4)까지 그 눈의 눈꺼풀 곡선 + 설계 높이를 따른다.
// 그 뒤 눈꼬리(u 1)까지는 라인-눈꺼풀 폭을 위치·기울기·휨이 이어지는 5차 곡선으로 끝 높이까지 키운다(줄지 않음).
// 끝 높이는 눈꺼풀 모양과 무관하게 설계 꼬리 높이의 CREASE_TAIL_RATIO배다. 어떤 모델이든 눈꼬리/중앙 폭이 같은 범위가 된다.
// 눈꼬리에서 폭이 커지는 속도는 라인 기울기가 얼굴 기준 내리막 CREASE_TAIL_SLOPE가 되는 값이되 CREASE_TAIL_FLARE를 넘지 않는다.
// 넘으면 중간 폭이 오목하게 줄어든다. 이전(눈꺼풀 기울기를 이어받아 펴짐)은 눈꺼풀이 꼬리에서 급하게 떨어지는 눈일수록
// 끝이 높아졌다(눈꼬리/중앙 폭 2.4~3.6배, seo01 최대). 눈꼬리 밖은 일정한 휨으로 펴져 얼굴 기준 수평에서 멈춘다.
export const CREASE_TURN=.4;
export const CREASE_TAIL_RATIO=1.25;
export const CREASE_TAIL_SLOPE=-.4;
// 눈꼬리(u 1) 위 라인 높이는 가운데(u 0.5) 라인 높이(눈꺼풀 + 설계 간격)의 CREASE_TAIL_CAP배를 넘지 않는다.
// 끝 높이를 설계 꼬리 높이 비율로만 정하면 높이를 올릴수록 꼬리가 가운데보다 빨리 커져, 높이 100에서 눈꼬리 위 라인이
// 가운데의 약 89%까지 올라가 눈 위에 수평 띠를 얹은 모양이 됐다(2026-11-01 6개 모델 측정). 기본 높이 20은 51~56%라 상한에 닿지 않는다.
export const CREASE_TAIL_CAP=.65;
function tailEnd(eye,heights,style='inout',front=heightCurve(heights,style)) {
  const y=heights.map(v=>Math.max(.005,Math.min(.36,Number.isFinite(v)?v:.12)));
  const [tilt,rise]=eye.faceTilt??[eye.t[1],eye.up[1]];
  const center=upperHeight(eye,.5)+front(.5);
  return {height:Math.min(CREASE_TAIL_RATIO*y[4],CREASE_TAIL_CAP*center),slope:(CREASE_TAIL_SLOPE-tilt)/Math.max(.5,rise)};
}
export const CREASE_TAIL_FLARE=3.5;
const lineCache=new WeakMap();
export function creaseLine(eye,u,heights,style='inout') {
  let cached=lineCache.get(eye);
  if(!cached){cached=new Map();lineCache.set(eye,cached);}
  const key=`${style}|${heights.join(',')}`;
  let line=cached.get(key);
  if(!line){line=creaseLineCurve(eye,heights,style);if(cached.size>32)cached.delete(cached.keys().next().value);cached.set(key,line);}
  return line(u);
}
// 한 눈·한 라인의 평가기(u → 눈꺼풀에서 라인까지 간격). 꼬리 계수를 한 번만 구한다.
export function creaseLineCurve(eye,heights,style='inout') {
  const a=CREASE_TURN,w=1-a,front=heightCurve(heights,style);
  const {g0,span,top,s0,q0,q1,s1,slope,outBend,reach}=tailCoefficients(eye,heights,style,front);
  const shape=t=>{const t3=t**3,t4=t**4,t5=t**5;return (t-6*t3+8*t4-3*t5)*s0+(.5*t*t-1.5*t3+1.5*t4-.5*t5)*q0+(.5*t3-t4+.5*t5)*q1+(-4*t3+7*t4-3*t5)*s1+(10*t3-15*t4+6*t5);};
  return u=>{
    if(u<=a)return front(u);
    if(u<1)return Math.max(.005,Math.min(.5,g0+span*shape((u-a)/w)));
    const d=Math.min(u-1,reach);
    return Math.max(.005,Math.min(.5,top+slope*d+.5*outBend*d*d));
  };
}
function tailCoefficients(eye,heights,style,front=heightCurve(heights,style)) {
  const a=CREASE_TURN,end=tailEnd(eye,heights,style,front),e=1e-3,w=1-a;
  const g0=front(a),gb=front(a-e),ga=front(a+e);
  const l0=upperHeight(eye,1),l1=upperHeight(eye,1-e),l2=upperHeight(eye,1-2*e),lidSlope=(l0-l1)/e,lidBend=(l0-2*l1+l2)/(e*e);
  // 끝 높이가 0.4 지점보다 0.02 이상 높지 않으면(꼬리 상한이 크게 걸린 낮은 눈꺼풀) 0.02로 두고, 눈꼬리 밖도 같은 끝 높이에서 잇는다.
  const span=Math.max(.02,end.height-g0),top=g0+span;
  // 폭은 0.4의 설계 폭에서 끝 높이까지 줄지 않고 커진다. 끝에서 커지는 속도는 라인 기울기가 end.slope가 되는 값이되 상한(CREASE_TAIL_FLARE)을 둔다.
  const s0=(ga-gb)/(2*e)*w/span,q0=(ga-2*g0+gb)/(e*e)*w*w/span;
  const s1=Math.max(0,Math.min(CREASE_TAIL_FLARE,(end.slope-lidSlope)*w/span));
  // 눈꼬리 밖은 일정한 휨으로 점점 수평이 되어 u CREASE_REACH에서 평평해진다.
  // 직선으로 계속 내려가면 낮은 높이에서 최소 높이에 닿아 꺾였다(seo01 높이 0). 눈꼬리에서 휨이 같도록 폭의 끝 휨을 맞춘다.
  // 평평해지는 기준은 얼굴 가로(눈 좌표 기울기 -tilt/rise)다. 눈 좌표 수평이면 눈꼬리가 올라간 눈에서 끝이 다시 올라간다.
  const [tilt,rise]=eye.faceTilt??[eye.t[1],eye.up[1]],level=-tilt/Math.max(.5,rise);
  const slope=lidSlope+span*s1/w,reach=CREASE_REACH-1,outBend=Math.max(0,(level-slope)/reach),q1=(outBend-lidBend)*w*w/span;
  return {g0,span,top,s0,q0,q1,s1,slope,outBend,reach};
}
export function curvePoint(eye,u,heights,style='inout') {
  const c=eye.crease??eye,v=upperHeight(c,u)+creaseLine(c,u,heights,style);
  return c.inner.map((p,k)=>p+c.width*(c.t[k]*u+c.up[k]*v));
}
// 설계선 검증 기준(새 모델에도 같은 규칙). 세부 구간 높이는 막고 전체 높이만 쓰므로 전체 높이 0~100에서 확인한다.
// shrink: 0.4~1에서 폭이 앞 구간보다 줄어든 최대량, ratio: 눈꼬리/중앙(0.5) 폭, rise: 꼭대기 뒤(0.86~1.2) 얼굴 기준으로 다시 올라간 최대량,
// bendStep: 얼굴 기준 곡률의 0.01 구간당 최대 변화.
// ratio 아래 끝은 1.05다(2026-11-01, 이전 1.5). 꼬리 상한(CREASE_TAIL_CAP)이 걸리는 높은 라인·낮은 눈꺼풀에서는
// 꼬리 폭이 가운데 폭에 가까워지는 것이 의도다. 꼬리가 가운데보다 좁아지지 않는 것은 1 이상으로 지킨다.
export const CREASE_LINE_RULE={shrink:.002,ratio:[1.05,3],rise:.002,bendStep:1.3};
export function inspectCreaseLine(eye,height,style='inout') {
  const c=eye.crease??eye,heights=creaseHeights(height,style),[tilt,rise]=c.faceTilt??[c.t[1],c.up[1]];
  const gap=u=>creaseLine(c,u,heights,style),face=u=>tilt*u+rise*(upperHeight(c,u)+gap(u));
  let shrink=0,up=0,bendStep=0,bendAt=0,prev=gap(CREASE_TURN),bend=null;
  for(let u=CREASE_TURN+.01;u<=1.0001;u+=.01){const g=gap(u);shrink=Math.max(shrink,prev-g);prev=g;}
  for(let u=.88;u<=1.2001;u+=.02)up=Math.max(up,face(u)-face(u-.02));
  for(let u=.03;u<=1.19;u+=.01) {
    const [[x0,y0],[x1,y1],[x2,y2]]=[u-.01,u,u+.01].map(x=>[x,face(x)]),cross=(x1-x0)*(y2-y0)-(y1-y0)*(x2-x0);
    const k=2*cross/(Math.hypot(x1-x0,y1-y0)*Math.hypot(x2-x1,y2-y1)*Math.hypot(x2-x0,y2-y0));
    if(bend!==null&&Math.abs(k-bend)>bendStep){bendStep=Math.abs(k-bend);bendAt=u;}
    bend=k;
  }
  const ratio=gap(1)/gap(.5),rule=CREASE_LINE_RULE;
  return {shrink,ratio,rise:up,bendStep,bendAt,ok:shrink<=rule.shrink&&ratio>=rule.ratio[0]&&ratio<=rule.ratio[1]&&up<=rule.rise&&bendStep<=rule.bendStep};
}
function upperHeight(eye,u) {
  // 눈꺼풀 기준점의 작은 흔들림이 쌍꺼풀 선의 꺾임으로 복제되지 않게 한다.
  const x=Math.max(0,Math.min(1,u)),s=x*(1-x);
  return eye.upperCurve ? s*(eye.upperCurve[0]+eye.upperCurve[1]*(2*x-1)) : interpolate(eye.upper,u);
}
function lowerHeight(eye,u) {
  const x=Math.max(0,Math.min(1,u)),s=x*(1-x);
  return eye.lowerCurve ? s*(eye.lowerCurve[0]+eye.lowerCurve[1]*(2*x-1)) : interpolate(eye.lower,u);
}
function fitUpper(points) {
  let aa=0,ab=0,bb=0,av=0,bv=0;
  for(const [u,v]of points) {const a=u*(1-u),b=a*(2*u-1);aa+=a*a;ab+=a*b;bb+=b*b;av+=a*v;bv+=b*v;}
  const determinant=aa*bb-ab*ab;
  return Math.abs(determinant)>1e-10 ? [(av*bb-bv*ab)/determinant,(bv*aa-av*ab)/determinant] : null;
}

// 쌍꺼풀 깊이 슬라이더 기본값. lidDepth가 이 값에서 lid-step.json edit.depth가 되게 옮긴다.
export const FOLD_DEFAULT=65;

export function eligibleEyes(status) {
  return {L:status?.L==='absent',R:status?.R==='absent'};
}

// 설계선이 눈꼬리 밖에서 얼굴 기준 수평으로 펴지는 끝(creaseLineCurve). 단은 그 전에 LID_TAIL에서 끝난다.
export const CREASE_REACH=1.26;
export function creaseStart(u,style='inout') {
  const start=style==='inline' ? [0,.14] : style==='outline' ? [-.045,.075] : [-.025,.12];
  return smooth(...start,u);
}
// 한 번의 변형 계산(values 객체) 동안 눈별 라인 평가기를 한 번만 만든다.
const valuesLines=new WeakMap();
function lineFor(values,eye,joinStyle,height) {
  let byEye=valuesLines.get(values);
  if(!byEye){byEye=new Map();valuesLines.set(values,byEye);}
  const key=eye.side+'|'+joinStyle;
  let line=byEye.get(key);
  if(!line){line=creaseLineCurve(eye.crease??eye,values.curves?.[eye.side]||creaseHeights(height,joinStyle),joinStyle);byEye.set(key,line);}
  return line;
}
function eyeFrame(side,points) {
  const {inner,outer}=points,width=norm(sub(outer,inner));
  if (width < 1e-8) throw Error('눈 기준점 간격이 올바르지 않다.');
  const t = unit(sub(outer, inner));
  const up = unit(sub([0,1,0], t.map(v=>v*t[1])));
  const forward = unit(cross(t, up)); if (forward[2]<0) forward.forEach((v,i)=>forward[i]=-v);
  // 정점마다 여러 번 부르므로 배열·reduce 없이 계산한다(같은 순서로 더해 값은 이전과 같다).
  const [ix,iy,iz]=inner,[tx,ty,tz]=t,[ux,uy,uz]=up,[fx,fy,fz]=forward;
  const local = p => { const dx=p[0]-ix,dy=p[1]-iy,dz=p[2]-iz; return [(dx*tx+dy*ty+dz*tz)/width,(dx*ux+dy*uy+dz*uz)/width,(dx*fx+dy*fy+dz*fz)/width]; };
  return {side,inner,width,t,up,forward,local,upperCurve:fitUpper(points.upper.map(local)),lowerCurve:fitUpper(points.lower.map(local)),
    upper: points.upper.map(local).sort((a,b)=>a[0]-b[0]),
    lower: points.lower.map(local).sort((a,b)=>a[0]-b[0])};
}
// templateBias=false는 템플릿 치우침이 없는 합성 기준점(시험용)에 쓴다.
export function buildEyeBasis(landmarks,{templateBias=true}={}) {
  if (!Array.isArray(landmarks) || landmarks.length < 468) throw Error('눈 기준점이 없는 모델이다.');
  const points = Object.entries(POINTS).map(([side, ids]) => {
    const inner = landmarks[ids.inner], outer = landmarks[ids.outer];
    if (![inner, outer, ...ids.upper.map(i=>landmarks[i]), ...ids.lower.map(i=>landmarks[i])].every(p => p?.length === 3 && p.every(Number.isFinite))) throw Error('눈 기준점이 누락된 모델이다.');
    return {side,inner,outer,upper:ids.upper.map(i=>landmarks[i]),lower:ids.lower.map(i=>landmarks[i])};
  });
  const eyes = points.map(p=>eyeFrame(p.side,p));
  // 얼굴 세로축: 두 눈 중심을 잇는 선에 수직. 머리가 조금 기울어도 두 눈을 같은 기준으로 잡는다.
  const middle=eye=>eye.inner.map((v,k)=>v+eye.width*eye.t[k]/2);
  const across=unit(sub(middle(eyes[1]),middle(eyes[0])));
  const faceUp=unit(sub([0,1,0],across.map(v=>v*across[1])));
  // 쌍꺼풀 기준(crease): 템플릿 기준점의 고정 좌우 치우침(TEMPLATE_EYE_BIAS)을 두 눈에서 절반씩 뺀 각 눈의 기준점.
  // 치우친 그대로 그리면 메시가 대칭인 기본 모델에서도 한쪽 선만 앞쪽에서 눈꺼풀에 붙거나 꼬리가 높아진다.
  // 두 눈 평균을 쓰면 실제로 좌우가 다른 얼굴(seo01 R 눈꺼풀이 눈 폭의 3~7% 높음)에서 한쪽 선이 실제 눈꺼풀보다 낮아진다.
  // 트임·뜨임은 원래 기준점을 쓴다.
  const fwd=unit(cross(across,faceUp)),width=(eyes[0].width+eyes[1].width)/2;
  const shift=([out,rise,front],sign)=>[0,1,2].map(k=>width*(sign*out*across[k]+rise*faceUp[k]+front*fwd[k])/2);
  points.forEach((own,i)=>{
    // R은 치우침(R 바깥쪽 = -across)의 절반을 빼고, L은 반전한 치우침의 절반을 더한다.
    const fix=(q,bias)=>!templateBias?q:own.side==='R'?q.map((v,k)=>v-shift(bias,-1)[k]):q.map((v,k)=>v+shift(bias,1)[k]);
    eyes[i].crease=eyeFrame(own.side,{inner:fix(own.inner,TEMPLATE_EYE_BIAS.upper[0]),outer:fix(own.outer,TEMPLATE_EYE_BIAS.upper[8]),
      upper:own.upper.map((q,k)=>fix(q,TEMPLATE_EYE_BIAS.upper[k])),lower:own.lower.map((q,k)=>fix(q,TEMPLATE_EYE_BIAS.lower[k]))});
  });
  for(const eye of eyes)for(const frame of [eye,eye.crease])frame.faceTilt=[dot(frame.t,faceUp),dot(frame.up,faceUp)];
  return eyes;
}

// 쌍꺼풀 = 모델링(pipeline/lid_fold.py)과 같은 단 하나. 실제 쌍꺼풀은 올림근 섬유가 선을 따라
// 피부에 붙어 선 아래 띠가 들어가고 선 위 피부는 그대로다. 그래서 눈꺼풀 앞면 피부(줄 margin_row+margin_roll 이상)만
// 피부 법선 반대로 가라앉고, 뒤 숨은 면과 눈꺼풀 가장자리 3줄은 움직이지 않는다. 상수는 lid-step.json(모델링과 공용),
// 줄은 lid-rows.json(pipeline/lid_coords.py가 만들고 검사). 모델링과 다른 것은 선의 자리뿐이다(사진 대신 높이·종류·곡선 조절).
// 이전(2026-11-13까지)은 눈 앞 평면에서 말려 들어가는 접힘 단면(tuck)이라 숨은 면·눈꺼풀 가장자리까지 움직였다.
// 단 모양(0~1): a = 속눈썹선 위 높이, h = 선 높이(눈 평면, 눈 너비 배수), c = 피부 기울기 인자, lip = 선 위 피부가 돌아오는
// 폭(피부 위 거리), risePow = 돌아오는 곡선(0 = S자, 모델링 / p = (1-t)^p, 선에서 가파르고 위에서 볼록). lid_fold.sink와 같은 식.
// 편집은 LID_STEP.edit 값을 쓴다(세분화 메시에서 모델링 화면처럼 턱으로 보이게, lid-step.json).
export function lidSink(a,h,c,lip=LID_STEP.lip,risePow=0) {
  if(!(h>LID_STEP.line_min)||!(a>LID_STEP.lash_hold))return 0;
  if(a<=h)return Math.min(1,a/Math.max(h,1e-6))**LID_STEP.strip_pow;
  const t=Math.min(1,Math.max(0,(a-h)/c/lip));
  return risePow>0?(1-t)**risePow:1-t*t*(3-2*t);
}
// 피부 메시 하나의 lid 입력. mesh = 세분화 전 피부(positions·indices, template = 정점별 GLB _TEMPLATE_INDEX),
// sources = refineEyeMesh의 sources(세분화하지 않았으면 생략).
// front: 눈별 앞면 피부 무게(원본 정점 0/1을 세분화 정점으로 보간), normal: 단의 방향(원본 메시의 면적 가중 정점 법선을
// 이웃 평균 frame_smooth번 = lid_fold._coords와 같은 정의, 세분화 정점으로 보간). 세분화한 메시에서 따로 평균하면 같은
// 횟수가 1/4 거리만 덮어 모델링과 다른 방향이 된다.
export function lidSkin(mesh,sources) {
  const count=mesh.positions.length/3,P=mesh.positions,I=mesh.indices,fixed=LID_STEP.margin_row+LID_STEP.margin_roll;
  if(!mesh.template||mesh.template.length!==count)throw Error('피부 정점의 템플릿 번호가 없다.');
  const front={};
  for(const side of ['L','R']) {
    const rows=new Map(LID_ROWS[side].ids.map((id,k)=>[id,LID_ROWS[side].rows[k]])),w=new Float32Array(count);
    for(let i=0;i<count;i++)w[i]=(rows.get(mesh.template[i])??-1)>=fixed?1:0;
    front[side]=w;
  }
  let normal=new Float32Array(3*count);
  for(let f=0;f<I.length;f+=3) {
    const a=3*I[f],b=3*I[f+1],c=3*I[f+2];
    const ux=P[b]-P[a],uy=P[b+1]-P[a+1],uz=P[b+2]-P[a+2],vx=P[c]-P[a],vy=P[c+1]-P[a+1],vz=P[c+2]-P[a+2];
    const n=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx];
    for(const v of [a,b,c])for(let k=0;k<3;k++)normal[v+k]+=n[k];
  }
  const normalize=N=>{for(let i=0;i<N.length;i+=3){const l=Math.hypot(N[i],N[i+1],N[i+2])+1e-12;N[i]/=l;N[i+1]/=l;N[i+2]/=l;}return N;};
  normalize(normal);
  const {offsets,list}=neighborList(I,count);
  for(let pass=0;pass<LID_STEP.frame_smooth;pass++) {
    const next=new Float32Array(3*count);
    for(let i=0;i<count;i++) {
      const n=offsets[i+1]-offsets[i];
      if(!n){for(let k=0;k<3;k++)next[3*i+k]=normal[3*i+k];continue;}
      for(let j=offsets[i];j<offsets[i+1];j++)for(let k=0;k<3;k++)next[3*i+k]+=normal[3*list[j]+k]/n;
    }
    normal=normalize(next);
  }
  if(!sources)return {front,normal};
  return {front:{L:transferRefined(sources,front.L,1),R:transferRefined(sources,front.R,1)},normal:normalize(transferRefined(sources,normal,3))};
}
// 슬라이더 깊이 → 단 깊이(눈 너비 배수). 기본 깊이(FOLD_DEFAULT)가 lid-step.json edit.depth(0.04)다. 모델링 깊이(depth 0.05,
// 사진에서 실제로 쓴 값 0.0465~0.05)보다 조금 얕게 두었다(만두 11/13). 0.0325로 낮췄을 때는 선이 선명하지 않았다.
export const lidDepth=crease=>LID_STEP.edit.depth*Math.max(0,Math.min(FOLD_DEPTH_MAX,crease))/FOLD_DEFAULT;
// 단의 선 끝: 눈꼬리 직전(LID_TAIL[0])부터 흐려져 LID_TAIL[1]에서 없어진다. 이전 tuck의 꼬리 감쇠(0.96~1.26)는 꼬리가 눈꼬리
// 밖으로 길게 뻗어 아래로 휘어 보였다. 깊이는 가운데가 가장 깊고 양끝(u 0·1)은 가운데의 LID_ENDS배다. 편집에는 사진이 없으므로
// 실제 쌍꺼풀처럼 가운데가 또렷하고 끝이 흐려지게 둔 설계값이다(만두 확인 대상).
export const LID_TAIL=[.85,1.08],LID_ENDS=.5;
function lidEnvelope(u,style) {
  const x=Math.max(0,Math.min(1,u));
  return creaseStart(u,style)*(1-smooth(LID_TAIL[0],LID_TAIL[1],u))*(1-(1-LID_ENDS)*(1-4*x*(1-x)));
}
export function lidFoldPositions(base,basis,values,selection,style,lid) {
  const out=base.slice();
  if(!(values.crease>0))return out;
  for(const eye of basis) {
    if((selection!=='both'&&eye.side!==selection)||values.eligible?.[eye.side]!==true)continue;
    const c=eye.crease??eye,joinStyle=values.joinStyles?.[eye.side]||style,line=lineFor(values,eye,joinStyle,values.height);
    const front=lid.front[eye.side],N=lid.normal,depth=lidDepth(values.crease)*c.width,[ux,uy,uz]=c.up;
    for(let i=0;i<front.length;i++) {
      const w=front[i];
      if(!w)continue;
      const k=3*i,[u,v]=c.local([base[k],base[k+1],base[k+2]]),end=lidEnvelope(u,joinStyle);
      if(!end)continue;
      const nx=N[k],ny=N[k+1],nz=N[k+2],along=nx*ux+ny*uy+nz*uz;
      // 눈 평면 높이차를 피부 위 거리로 바꾸는 인자(lid_coords.frame의 c): 위 방향을 피부 접평면에 투영한 길이
      const surface=Math.max(LID_STEP.c_min,Math.min(1,Math.hypot(ux-nx*along,uy-ny*along,uz-nz*along)));
      const s=depth*w*end*lidSink(v-upperHeight(c,u),line(u),surface,LID_STEP.edit.lip,LID_STEP.edit.rise_pow);
      if(s){out[k]-=nx*s;out[k+1]-=ny*s;out[k+2]-=nz*s;}
    }
  }
  return out;
}
const clampedValues=new WeakMap();
export function eyeDisplacement(point, basis, values, selection='both', style='inout') {
  let p=clampedValues.get(values);
  if(!p) {
    p=defaultEyeValues();
    for (const [key,,min,max] of EYE_CONTROLS) if (Number.isFinite(values[key])) p[key]=Math.max(min,Math.min(max,values[key]));
    clampedValues.set(values,p);
  }
  const out=[0,0,0];
  for (const eye of basis) {
    if (selection!=='both' && selection!==eye.side) continue;
    const [u,v,z]=eye.local(point);
    // 안와의 앞면만 사용한다. 뒷머리·안구·입·눈썹 바깥으로 영향이 번지지 않는다.
    if (u<-.45 || u>1.45 || v<-.65 || v>.85 || Math.abs(z)>.55) continue;
    const upper=upperHeight(eye,u), lower=lowerHeight(eye,u), above=v-upper;
    const edgeEnvelope=smooth(-.4,-.05,u)*(1-smooth(1.05,1.4,u));
    const front=1-smooth(.25,.55,Math.abs(z));
    // 위·아래 경계를 독립적으로 이동하고 눈 틈 중앙의 중복 영향을 줄인다.
    // 눈꼬리에서 위·아래 경계가 합쳐져도 분모가 0으로 좁아지지 않는다.
    // 옆으로 트인 피부가 이 경계를 넘을 때 뜨임의 이동장이 불연속이 되지 않게 한다.
    const middle=(upper+lower)/2,half=Math.max(.07,(upper-lower)/2);
    const upperShare=smooth(middle-half,middle+half,v);
    let dv=p.opening/100*(.075*gaussian(v-upper,.13)*upperShare-.018*gaussian(v-lower,.10)*(1-upperShare))*edgeEnvelope;
    // 앞트임 중심에서 이동량이 급히 줄면 가까운 눈꺼풀 면이 엇갈린다. 영향 범위 끝에서는 0으로 연결한다.
    const innerW=gaussian(u,.31)*gaussian(v,.32)*smooth(-.45,-.36,u)*smooth(-.65,-.53,v)*(1-smooth(.68,.85,v));
    const outerW=gaussian(u-1,.20)*gaussian(v,.18);
    const du=-.075*p.inner/100*innerW+.075*p.outer/100*outerW;
    dv+=.075*p.tail/100*outerW;
    // 윗트임은 안쪽 위 경계, 밑트임은 바깥쪽 아래 경계를 각각 연다.
    dv+=.065*p.upper/100*gaussian(u-.18,.24)*gaussian(v-upper,.11)*upperShare;
    dv-=.065*p.lower/100*gaussian(u-.76,.27)*gaussian(v-lower,.12)*(1-upperShare);
    // 눈 뜨임을 바꿀 때 접힘 선도 경계 근처 피부와 함께 이동한다.
    const dz=p.inner/100*.018*innerW;
    for(let k=0;k<3;k++) out[k]+=eye.width*front*(eye.t[k]*du+eye.up[k]*dv+eye.forward[k]*dz);
  }
  return out;
}

// 2회 국소 세분화(모서리 중점 4등분). 공유 모서리의 중점을 재사용하고 인접면도 분할해 틈을 만들지 않는다.
// 원본 삼각형 평면 위에서만 보간하므로 0값에서는 원래 표면을 그대로 유지한다.
// sources는 새 정점마다 원본 정점 번호·가중치(CSR)다. 원본 morph·코 변형을 같은 평균으로 옮긴다.
export function refineEyeMesh(input,basis,passes=2) {
  let mesh=input;
  const original=input.positions.length/3;
  let sources=Array.from({length:original},(_,i)=>new Map([[i,1]]));
  for(let pass=0;pass<passes;pass++) {
    const pos=Array.from(mesh.positions), normals=Array.from(mesh.normals), uv=Array.from(mesh.uv || []), edges=new Map(), result=[];
    const p=i=>pos.slice(3*i,3*i+3), key=(a,b)=>a<b ? `${a}:${b}` : `${b}:${a}`;
    const active=i=>basis.some(eye=>{ const [u,v,z]=eye.local(p(i)); return u>-.25&&u<1.25&&v>-.35&&v<.7&&Math.abs(z)<.5; });
    const add=(ids)=>{
      const index=pos.length/3;
      for(let k=0;k<3;k++) { pos.push(ids.reduce((s,i)=>s+pos[3*i+k],0)/ids.length); normals.push(ids.reduce((s,i)=>s+normals[3*i+k],0)/ids.length); }
      if(uv.length) for(let k=0;k<2;k++) uv.push(ids.reduce((s,i)=>s+uv[2*i+k],0)/ids.length);
      const mixed=new Map();
      for(const id of ids)for(const [source,weight] of sources[id])mixed.set(source,(mixed.get(source)??0)+weight/ids.length);
      sources.push(mixed);
      return index;
    };
    const marked=new Set();
    for(let i=0;i<mesh.indices.length;i+=3) {
      const tri=Array.from(mesh.indices.slice(i,i+3));
      if(tri.some(active)) for(let k=0;k<3;k++) marked.add(key(tri[k],tri[(k+1)%3]));
    }
    // 모서리 중점 4등분(빨강-초록 닫힘): 표시된 모서리 3개 = 4조각, 2개 = 3조각(남은 사각형은 짧은 대각선), 1개 = 2조각.
    // 이전(표시된 모서리 중점 + 삼각형 가운데 점 부채꼴)은 두 번 반복하면 연결선이 12개 몰린 별 정점이 생겨, 쌍꺼풀 선처럼
    // 날카로운 형상이 지나가면 그림자가 별 무늬·톱니로 깨졌다(2026-11-13 a7533453·706344da 회색 렌더). 가운데 점이 없어
    // 정점 연결이 고르고 만드는 정점도 적다.
    const mid=(a,b)=>{const id=key(a,b);if(!marked.has(id))return -1;if(!edges.has(id))edges.set(id,add([a,b]));return edges.get(id);};
    const len=(a,b)=>Math.hypot(pos[3*a]-pos[3*b],pos[3*a+1]-pos[3*b+1],pos[3*a+2]-pos[3*b+2]);
    for(let i=0;i<mesh.indices.length;i+=3) {
      const t=Array.from(mesh.indices.slice(i,i+3)),m=[0,1,2].map(k=>mid(t[k],t[(k+1)%3])),n=m.filter(v=>v>=0).length;
      if(n===0){result.push(...t);continue;}
      if(n===3){result.push(t[0],m[0],m[2],m[0],t[1],m[1],m[2],m[1],t[2],m[0],m[1],m[2]);continue;}
      // 표시된 모서리(둘이면 이어진 두 모서리의 앞쪽)가 t[k]→t[k+1]이 되도록 돌린다
      const k=n===1?m.findIndex(v=>v>=0):m.findIndex((v,j)=>v>=0&&m[(j+1)%3]>=0);
      const A=t[k],B=t[(k+1)%3],C=t[(k+2)%3],mAB=m[k];
      if(n===1){result.push(A,mAB,C,mAB,B,C);continue;}
      const mBC=m[(k+1)%3];
      result.push(mAB,B,mBC);
      if(len(A,mBC)<len(mAB,C))result.push(A,mAB,mBC,A,mBC,C);else result.push(A,mAB,C,mAB,mBC,C);
    }
    for(let i=0;i<normals.length;i+=3) { const n=Math.hypot(normals[i],normals[i+1],normals[i+2])||1; for(let k=0;k<3;k++) normals[i+k]/=n; }
    mesh={positions:new Float32Array(pos),normals:new Float32Array(normals),uv:new Float32Array(uv),indices:new Uint32Array(result)};
  }
  const offsets=new Uint32Array(sources.length+1);
  for(let i=0;i<sources.length;i++)offsets[i+1]=offsets[i]+sources[i].size;
  const ids=new Uint32Array(offsets.at(-1)),weights=new Float32Array(offsets.at(-1));
  sources.forEach((map,i)=>{let k=offsets[i];for(const [source,weight] of map){ids[k]=source;weights[k++]=weight;}});
  return {...mesh,sources:{original,offsets,ids,weights}};
}
// 원본 정점 기준 값(morph 변위·코 변형 차이 등)을 세분화 정점으로 옮긴다.
export function transferRefined(sources,values,itemSize=3) {
  const out=new Float32Array((sources.offsets.length-1)*itemSize);
  for(let i=0;i<sources.offsets.length-1;i++)for(let k=sources.offsets[i];k<sources.offsets[i+1];k++) {
    const id=sources.ids[k],w=sources.weights[k];
    for(let c=0;c<itemSize;c++)out[i*itemSize+c]+=w*values[id*itemSize+c];
  }
  return out;
}

export function deformPositions(base, basis, values, selection, style) {
  const out=base.slice();
  // 눈 변형이 닿는 범위(눈 좌표 u −0.45~1.45·v −0.65~0.85·|z|<0.55)는 눈 가운데에서 눈 폭의 1.4배 안이다.
  // 쌍꺼풀 기준(crease)은 원래 기준점에서 눈 폭의 0.06 안쪽으로만 옮겨 1.5배면 둘 다 덮는다.
  const reach=basis.map(eye=>({c:eye.inner.map((v,k)=>v+eye.t[k]*eye.width*.5),r2:(1.5*eye.width)**2}));
  for(let i=0;i<base.length;i+=3) {
    if(!reach.some(({c,r2})=>(base[i]-c[0])**2+(base[i+1]-c[1])**2+(base[i+2]-c[2])**2<r2))continue;
    const d=eyeDisplacement([base[i],base[i+1],base[i+2]],basis,values,selection,style);
    if(d[0]===0&&d[1]===0&&d[2]===0)continue;
    for(let k=0;k<3;k++) out[i+k]=base[i+k]+d[k];
  }
  return out;
}

// 안구 표면에 구를 맞춘다. 잔차가 큰 비구형 메시에는 이 근사를 적용하지 않는다.
export function fitEyeSpheres(points, basis) {
  return basis.flatMap(eye=>{
    const center=eye.inner.map((v,k)=>v+eye.t[k]*eye.width*.5);
    const sample=points.filter(p=>norm(sub(p,center))<eye.width*.85);
    if(sample.length<12) return [];
    const mean=[0,1,2].map(k=>sample.reduce((s,p)=>s+p[k],0)/sample.length);
    const matrix=Array.from({length:4},()=>Array(5).fill(0));
    for(const p of sample) {
      const q=sub(p,mean), row=[...q.map(v=>2*v),1], value=dot(q,q);
      for(let i=0;i<4;i++) { for(let j=0;j<4;j++) matrix[i][j]+=row[i]*row[j]; matrix[i][4]+=row[i]*value; }
    }
    for(let i=0;i<4;i++) {
      let pivot=i; for(let j=i+1;j<4;j++) if(Math.abs(matrix[j][i])>Math.abs(matrix[pivot][i])) pivot=j;
      [matrix[i],matrix[pivot]]=[matrix[pivot],matrix[i]];
      if(Math.abs(matrix[i][i])<1e-12) return [];
      const d=matrix[i][i]; for(let k=i;k<5;k++) matrix[i][k]/=d;
      for(let j=0;j<4;j++) if(j!==i) { const f=matrix[j][i]; for(let k=i;k<5;k++) matrix[j][k]-=f*matrix[i][k]; }
    }
    const offset=matrix.slice(0,3).map(r=>r[4]), radius=Math.sqrt(matrix[3][4]+dot(offset,offset));
    const c=mean.map((v,k)=>v+offset[k]);
    const error=Math.sqrt(sample.reduce((s,p)=>s+(norm(sub(p,c))-radius)**2,0)/sample.length);
    return Number.isFinite(radius) && radius>eye.width*.15 && radius<eye.width && error<radius*.08 ? [{center:c,radius}] : [];
  });
}

export function clampToEyeballs(base, positions, spheres) {
  for(let i=0;i<base.length;i+=3) for(const sphere of spheres) {
    const ox=base[i]-sphere.center[0],oy=base[i+1]-sphere.center[1],oz=base[i+2]-sphere.center[2];
    const mx=positions[i]-sphere.center[0],my=positions[i+1]-sphere.center[1],mz=positions[i+2]-sphere.center[2];
    // 내보내기 GLB의 +Z 전방 축으로 보호한다. 방사형 보정으로 눈꺼풀을 옆으로 밀지 않는다.
    const r=sphere.radius*1.005, oldR2=ox*ox+oy*oy, r2=mx*mx+my*my;
    if(oz<0 || r2>=r*r)continue;
    const oldSurface=Math.sqrt(Math.max(0,r*r-oldR2));
    const penetration=Math.min(0,oz-oldSurface);
    const minimum=Math.sqrt(Math.max(0,r*r-r2))+penetration;
    if(mz<minimum-1e-7*r)positions[i+2]=sphere.center[2]+minimum;
  }
  return positions;
}

// 기존 삼각형의 법선 방향과 면적을 검사한다. 전체 자기 교차 검사는 아니다.
// faces(면 시작 번호 목록)를 주면 그 면만 본다. 정점이 움직이지 않은 면은 base와 같아 검사할 필요가 없다.
export function unsafeFaceIndices(base, positions, indices, forward, foldMask, faces) {
  const invalid=[],count=faces?faces.length:indices.length/3;
  for(let f=0;f<count;f++) {
    const i=faces?faces[f]:3*f;
    const a=indices[i],b=indices[i+1],c=indices[i+2],ia=3*a,ib=3*b,ic=3*c;
    const ax=base[ib]-base[ia],ay=base[ib+1]-base[ia+1],az=base[ib+2]-base[ia+2];
    const bx=base[ic]-base[ia],by=base[ic+1]-base[ia+1],bz=base[ic+2]-base[ia+2];
    const cx=positions[ib]-positions[ia],cy=positions[ib+1]-positions[ia+1],cz=positions[ib+2]-positions[ia+2];
    const dx=positions[ic]-positions[ia],dy=positions[ic+1]-positions[ia+1],dz=positions[ic+2]-positions[ia+2];
    const nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx;
    const mx=cy*dz-cz*dy,my=cz*dx-cx*dz,mz=cx*dy-cy*dx;
    const area=nx*nx+ny*ny+nz*nz;
    if(area<=1e-20) continue;
    // 접힘으로 표면 법선이 회전하는 것과 정점 순서 반전을 구분한다.
    // 앞면은 눈 평면에 투영한 부호·면적을 검사하고, 옆/뒷면은 기존 검사를 쓴다.
    const projectedArea=forward ? nx*forward[0]+ny*forward[1]+nz*forward[2] : 0;
    const projected=forward&&projectedArea>.15*Math.sqrt(area);
    // 해석적으로 만든 겹침 구간은 투영 방향이 바뀌므로 3D 면적을 검사한다.
    const folded=foldMask&&foldMask[a]&&foldMask[b]&&foldMask[c];
    const inverted=folded ? false : projected ? mx*forward[0]+my*forward[1]+mz*forward[2]<.1*projectedArea : nx*mx+ny*my+nz*mz<.1*area;
    if(inverted || mx*mx+my*my+mz*mz<.01*area || !Number.isFinite(mx+my+mz)) invalid.push(i);
  }
  return invalid;
}
export const unsafeFaces=(...args)=>unsafeFaceIndices(...args).length;
// reference·target(·guard 기준)이 다른 정점을 하나라도 가진 면. 제한·축소는 이 면 밖을 바꾸지 않는다.
export function movedFaces(indices,reference,target,guardBase) {
  const moved=new Uint8Array(reference.length/3);
  for(let i=0;i<reference.length;i++)if(reference[i]!==target[i]||(guardBase&&guardBase[i]!==reference[i]))moved[(i/3)|0]=1;
  const faces=[];
  for(let f=0;f<indices.length;f+=3)if(moved[indices[f]]||moved[indices[f+1]]||moved[indices[f+2]])faces.push(f);
  return Uint32Array.from(faces);
}

const neighborCache=new WeakMap();
function neighbors(indices,count) {
  let adjacency=neighborCache.get(indices);
  if(!adjacency) {
    adjacency=Array.from({length:count},()=>new Set());
    for(let i=0;i<indices.length;i+=3)for(let k=0;k<3;k++) {adjacency[indices[i+k]].add(indices[i+(k+1)%3]);adjacency[indices[i+k]].add(indices[i+(k+2)%3]);}
    neighborCache.set(indices,adjacency);
  }
  return adjacency;
}
// 이웃 목록을 압축 배열로 둔다(Set을 정점마다 도는 비용이 세분화 뒤 계산 시간의 큰 몫이었다).
const csrCache=new WeakMap();
function neighborList(indices,count) {
  let csr=csrCache.get(indices);
  if(!csr) {
    const sets=neighbors(indices,count),offsets=new Uint32Array(count+1);
    for(let i=0;i<count;i++)offsets[i+1]=offsets[i]+sets[i].size;
    const list=new Uint32Array(offsets[count]);
    for(let i=0;i<count;i++){let k=offsets[i];for(const n of sets[i])list[k++]=n;}
    csr={offsets,list};csrCache.set(indices,csr);
  }
  return csr;
}
export function limitEyeDeformation(base,target,indices,forward,spheres=[],foldMask,maxPasses=18,guard,faces=movedFaces(indices,base,target,guard?.base),extraUnsafeFaces) {
  const positions=target.slice(), weights=new Float32Array(base.length/3).fill(1);
  const invalidFaces=changed=>{
    const invalid=unsafeFaceIndices(base,positions,indices,forward,foldMask,faces);
    if(guard)invalid.push(...unsafeFaceIndices(guard.base,positions,indices,undefined,guard.mask,faces));
    if(extraUnsafeFaces)invalid.push(...extraUnsafeFaces(positions,changed));
    return invalid;
  };
  let invalid=invalidFaces();
  if(!invalid.length)return {positions,limited:0,remaining:0};
  const adjacency=neighbors(indices,weights.length);
  for(let pass=0;pass<maxPasses&&invalid.length;pass++) {
    const affected=new Set();for(const face of invalid)for(let k=0;k<3;k++)affected.add(indices[face+k]);
    const next=weights.slice();
    for(const vertex of affected) {
      next[vertex]=pass>12 ? 0 : weights[vertex]*.5;
      for(const neighbor of adjacency[vertex])next[neighbor]=Math.min(next[neighbor],weights[neighbor]*.8);
    }
    // 정점별 제한값의 계단이 피부에 작은 능선·구멍으로 복제되지 않게 한다.
    // 제한된 정점의 강도는 되올리지 않고 이웃 쪽으로만 부드럽게 퍼뜨린다.
    let support=new Set(affected);
    for(let ring=0;ring<3;ring++) {
      const expanded=new Set(support);
      for(const vertex of support)for(const neighbor of adjacency[vertex])expanded.add(neighbor);
      support=expanded;
    }
    for(let relax=0;relax<3;relax++) {
      const softened=next.slice();
      for(const vertex of support) {
        let sum=2*next[vertex],count=2;
        for(const neighbor of adjacency[vertex]){sum+=next[neighbor];count++;}
        softened[vertex]=Math.min(next[vertex],sum/count);
      }
      next.set(softened);
    }
    weights.set(next);
    for(let i=0;i<positions.length;i++)positions[i]=base[i]+weights[Math.floor(i/3)]*(target[i]-base[i]);
    clampToEyeballs(base,positions,spheres);
    // 이 단계에서 바뀐 면과 직전 교차 면은 모두 support 안에 있다.
    invalid=invalidFaces(support);
  }
  return {positions,limited:weights.reduce((s,v)=>s+(v<.999?1:0),0),remaining:invalid.length};
}

// 접힘을 확정한 뒤 눈 테두리 변형을 운반한다. 제한 시에도 접힘 기준으로 돌아간다.
const eyeCompositionCache=new WeakMap();
// 원본에서 30° 미만이던 인접면 쌍이 결과에서 70° 이상 꺾인 수. 접힘 마스크 안쪽은 의도한 접힘이라 뺀다.
const facePairCache=new WeakMap(),baseBendCache=new WeakMap();
function facePairs(indices) {
  let pairs=facePairCache.get(indices);
  if(!pairs) {
    const open=new Map();pairs=[];
    for(let f=0;f<indices.length;f+=3)for(let k=0;k<3;k++) {
      const a=indices[f+k],b=indices[f+(k+1)%3],key=a<b?`${a}:${b}`:`${b}:${a}`,other=open.get(key);
      if(other===undefined)open.set(key,f);else{pairs.push(other,f);open.delete(key);}
    }
    pairs=Uint32Array.from(pairs);facePairCache.set(indices,pairs);
  }
  return pairs;
}
function faceNormalAt(P,I,f) {
  const a=3*I[f],b=3*I[f+1],c=3*I[f+2];
  const ux=P[b]-P[a],uy=P[b+1]-P[a+1],uz=P[b+2]-P[a+2],vx=P[c]-P[a],vy=P[c+1]-P[a+1],vz=P[c+2]-P[a+2];
  const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx,l=Math.hypot(x,y,z)||1;
  return [x/l,y/l,z/l];
}
export function newSharpEdges(base,positions,indices,mask) {
  const pairs=facePairs(indices);
  let bends=baseBendCache.get(base);
  if(!bends||bends.indices!==indices) {
    const smooth=new Uint8Array(pairs.length/2);
    for(let i=0;i<pairs.length;i+=2){const p=faceNormalAt(base,indices,pairs[i]),q=faceNormalAt(base,indices,pairs[i+1]);smooth[i/2]=p[0]*q[0]+p[1]*q[1]+p[2]*q[2]>Math.cos(Math.PI/6)?1:0;}
    bends={indices,smooth};baseBendCache.set(base,bends);
  }
  const inside=f=>mask&&mask[indices[f]]&&mask[indices[f+1]]&&mask[indices[f+2]];
  let count=0;
  for(let i=0;i<pairs.length;i+=2) {
    if(!bends.smooth[i/2]||inside(pairs[i])||inside(pairs[i+1]))continue;
    const p=faceNormalAt(positions,indices,pairs[i]),q=faceNormalAt(positions,indices,pairs[i+1]);
    if(p[0]*q[0]+p[1]*q[1]+p[2]*q[2]<Math.cos(70*Math.PI/180))count++;
  }
  return count;
}

// 회색 형상이 깨지지 않는 조절 범위의 판정 기준(2026-10-31 실측).
// 분모는 눈 변형이 닿을 수 있는 고정 영역의 정점 수다. 볼까지 아주 조금씩 움직인 정점이 비율을 묽히지 않는다.
// 전체 강도 축소(amount<1)는 항상 실패다. 접힘 밖의 새 급한 꺾임은 영역의 0.2%까지,
// 트임이 더한 국소 보호(정점 강도 감쇠)는 영역의 5%까지 허용한다. 접힘 자신의 보호는 단면을 만드는 설계라
// 세지 않는다(세면 접힘 범위가 조금만 넓어져도 4~6% 사이를 오가며 한계가 흔들린다).
// 사용자가 자연스럽다고 본 상태(새 꺾임 최대 0.16%)와 부자연스럽다고 본 조합(0.52%, 트임 보호 8.2%) 사이에서 정했다.
// 접힘 깊이 슬라이더는 0~100 전체를 쓴다.
export const EYE_SAFE_RULE={sharpPerRegion:.002,limitedPerRegion:.05,step:5};
export const FOLD_DEPTH_MAX=100;
export const FOLD_LIMIT_CONTROLS=['height','crease'],TRIM_LIMIT_CONTROLS=['inner','outer','lower','upper'];
const regionCache=new WeakMap();
// eyeDisplacement가 변위를 만들 수 있는 범위(눈별)의 정점 수.
export function eyeRegionCount(rig,selection='both') {
  let cached=regionCache.get(rig.base);
  if(!cached||cached.basis!==rig.basis) {
    cached={basis:rig.basis,L:0,R:0};
    for(let i=0;i<rig.base.length;i+=3)for(const eye of rig.basis) {
      const [u,v,z]=eye.local([rig.base[i],rig.base[i+1],rig.base[i+2]]);
      if(u>-.45&&u<1.45&&v>-.65&&v<.85&&Math.abs(z)<.55)cached[eye.side]++;
    }
    regionCache.set(rig.base,cached);
  }
  return selection==='both'?cached.L+cached.R:cached[selection];
}
export function eyeShapeHealth(rig,values,selection='both') {
  const style=values.style||'inout';
  const result=composeEyeDeformation(rig.base,rig.basis,{...values,opening:0,tail:0},selection,style,rig.normals,rig.indices,rig.spheres,rig.lid);
  return {amount:Math.min(result.foldAmount,result.rimAmount),limited:result.limited-(result.foldLimited??0),region:eyeRegionCount(rig,selection),sharp:newSharpEdges(rig.base,result.positions,rig.indices,result.foldMask)};
}
export function isEyeShapeSafe(health,rule=EYE_SAFE_RULE) {
  if(health.amount<1)return false;
  if(!health.region)return true;
  return health.sharp<=rule.sharpPerRegion*health.region&&health.limited<=rule.limitedPerRegion*health.region;
}
// 좌우가 같으면 한 번, 다르면 눈마다 따로 검사한다(applyEyeState와 같은 합성 단위).
export function isEyeStateSafe(rig,sides,rule=EYE_SAFE_RULE) {
  return sides.every(({selection,values})=>isEyeShapeSafe(eyeShapeHealth(rig,values,selection),rule));
}
// 0은 원본이므로 안전하다고 본다. 큰 값부터 확인하고, 실패하면 step 단위 이분 탐색으로 경계를 찾는다.
// 경계가 하나인 경우(조합 검사의 증가분)에 쓴다.
export function findSafeLimit(isSafe,min=0,max=100,step=EYE_SAFE_RULE.step) {
  if(isSafe(max))return max;
  let lo=min,hi=max;
  while(hi-lo>step) {
    const mid=lo+Math.max(step,Math.round((hi-lo)/2/step)*step);
    if(mid>=hi)break;
    if(isSafe(mid))lo=mid;else hi=mid;
  }
  return lo;
}
// 실패 구간이 중간에 끼는 조절(인라인 높이 50에서만 전체 축소 등)은 끝값만 보면 놓친다.
// 작은 값부터 coarse 간격으로 올라가 처음 실패한 곳에서 멈추고, 그 앞 구간만 step으로 좁힌다.
export function scanSafeLimit(isSafe,min=0,max=100,coarse=10,step=EYE_SAFE_RULE.step) {
  function* coarseLevels() {
    for(let value=min;value<max;) {
      value=Math.min(max,value+coarse);
      yield value;
    }
  }
  const check=value=>({valid:isSafe(value)});
  const {accepted,failedAt}=scanEditLimit(coarseLevels(),check,min);
  if(failedAt===null)return accepted;
  function* fineLevels() {
    for(let value=accepted+step;value<failedAt;value+=step)yield value;
  }
  return scanEditLimit(fineLevels(),check,accepted).accepted;
}
// 한 조절만 바꾸고 나머지는 기본값(높이 20·깊이 FOLD_DEFAULT·트임 0)에 둔 단독 한계다.
// 여러 조절을 함께 올린 조합은 놓을 때마다 지금 상태 전체로 다시 검사한다(FE useEyeLimits의 check).
export function measureEyeSafeLimit(rig,control,{style='inout',eligible={L:true,R:true}}={},rule=EYE_SAFE_RULE) {
  const fold=FOLD_LIMIT_CONTROLS.includes(control);
  if(fold&&!eligible.L&&!eligible.R)return 0;
  const values={height:20,crease:fold?FOLD_DEFAULT:0,inner:0,outer:0,lower:0,upper:0,style,eligible:fold?eligible:{L:false,R:false},joinStyles:{L:style,R:style}};
  const top=control==='crease'?FOLD_DEPTH_MAX:100;
  return scanSafeLimit(value=>isEyeShapeSafe(eyeShapeHealth(rig,{...values,[control]:value}),rule),0,top,10,rule.step);
}

export function combineEyeOffset(a,b) {
  if(a===0||b===0||a*b<0)return a+b;
  // 같은 피부를 같은 방향으로 여는 효과는 중복 합산하지 않는다.
  // 매끈한 최대값으로 합쳐 각 단독 이동은 유지하고 과도한 중첩을 막는다.
  const hi=Math.max(Math.abs(a),Math.abs(b)),lo=Math.min(Math.abs(a),Math.abs(b));
  return Math.sign(a)*hi*(1+(lo/hi)**8)**.125;
}
// lid: lidSkin(...)의 결과. 쌍꺼풀(crease>0)에 필요하다(없으면 오류: 앞면 피부와 숨은 면을 구분할 수 없다).
// normals는 합성 캐시 열쇠로만 쓴다(같은 원본이면 결과를 다시 쓴다).
export function composeEyeDeformation(base,basis,values,selection,style,normals,indices,spheres=[],lid) {
  const crease=values.crease>0;
  if(crease&&!lid)throw Error('쌍꺼풀에 필요한 눈꺼풀 줄 정보가 없다.');
  const foldValues={...values,style,opening:0,inner:0,outer:0,lower:0,upper:0,tail:0};
  // 면 뒤집힘 검사는 두 눈 앞 방향의 평균(얼굴 정면)으로 본다. 한쪽 눈 기준이면 좌우 꼬리 제한이 달라진다.
  const forward=unit(basis.reduce((s,eye)=>s.map((v,k)=>v+eye.forward[k]),[0,0,0]));
  function stable(reference,target,mask,guard,checkFoldIntersections=false) {
    const checkForward=mask ? forward : undefined;
    // 접힘 단계는 국소 제한을 40회까지 반복한다. 18회로는 면 1개가 남아 접힘 전체가 반씩 줄어드는 경우가 있었다(woo02 인라인 높이 50).
    const faces=movedFaces(indices,reference,target,guard?.base);
    const intersectionFaces=checkFoldIntersections&&faces.length ? (positions,affected)=>{
      if(!affected) {
        affected=new Set();
        for(let i=0;i<positions.length;i+=3) {
          if(positions[i]!==reference[i]||positions[i+1]!==reference[i+1]||positions[i+2]!==reference[i+2])affected.add(i/3);
        }
      }
      return introducedSelfIntersectionFaces(reference,positions,indices,affected);
    } : undefined;
    const limited=limitEyeDeformation(reference,target,indices,checkForward,spheres,mask,mask?40:120,guard,faces,intersectionFaces);
    const unsafe=positions=>unsafeFaces(reference,positions,indices,checkForward,mask,faces)||(guard&&unsafeFaces(guard.base,positions,indices,undefined,guard.mask,faces))||intersectionFaces?.(positions).size;
    let amount=1,positions=limited.positions.slice();
    // 제한 루프가 같은 면을 검사하고 돌려준 결과를 재사용한다.
    let invalid=limited.remaining>0||(limited.limited>0&&Boolean(intersectionFaces?.(positions).size));
    while(invalid&&amount>1/64) {
      amount/=2;
      for(let i=0;i<positions.length;i++)positions[i]=reference[i]+amount*(limited.positions[i]-reference[i]);
      clampToEyeballs(reference,positions,spheres);
      invalid=unsafe(positions);
    }
    if(invalid){positions.set(reference);amount=0;}
    return {positions,amount,limited:limited.limited,remaining:limited.remaining};
  }
  const cacheKey=JSON.stringify([selection,style,values.crease,values.height,values.curves,values.eligible,values.joinStyles]);
  let cached=eyeCompositionCache.get(base);
  if(!cached||cached.key!==cacheKey||cached.basis!==basis||cached.indices!==indices||cached.normals!==normals||cached.spheres!==spheres||cached.lid!==(crease?lid:undefined)) {
    let fold={positions:base.slice(),amount:1,limited:0,remaining:0},foldMask=new Uint8Array(base.length/3);
    if(crease) {
      // 접힘 마스크 = 단을 만든 정점(앞면 피부). 이웃 평균은 하지 않는다(고정한 가장자리·숨은 면으로 이동이 번진다).
      // 단은 계산으로 만든 매끄러운 면이라, 단 정점끼리의 면은 의도한 접힘으로 보아 뒤집힘 검사에서 빼고(붕괴·자기 교차는 검사)
      // 경계 면만 정면 투영으로 본다. 뒤집힘 검사를 걸면 선의 꺾임에 놓인 작은 세분화 면 몇 개 때문에 국소 제한이
      // 주변 정점 수백~2천 개의 깊이를 군데군데 깎아 선이 조각났다(0e91d7f1 걸린 면 194개 → 제한 정점 2,310개, 2026-11-13).
      const target=clampToEyeballs(base,lidFoldPositions(base,basis,foldValues,selection,style,lid),spheres);
      for(let i=0;i<base.length;i++)if(target[i]!==base[i])foldMask[(i/3)|0]=1;
      fold=stable(base,target,foldMask,undefined,true);
    }
    cached={key:cacheKey,basis,indices,normals,spheres,lid:crease?lid:undefined,fold,foldMask,effects:new Map()};
    eyeCompositionCache.set(base,cached);
  }
  const {fold,foldMask}=cached;
  // 기능마다 제한·평활화한 추가 이동을 순서가 고정된 단계로 합성한다.
  // 새 기능이 제한돼도 앞서 확정한 기능의 변위까지 함께 곱해 줄이지 않는다.
  let positions=fold.positions.slice(),rimAmount=1,limited=fold.limited;
  const stages=[];
  const components=[];
  for(const control of ['inner','outer','lower','upper','tail','opening']) {
    if(!Number.isFinite(values[control])||values[control]===0)continue;
    const isolated={...foldValues,crease:0,[control]:values[control]};
    const effectKey=control+':'+values[control];
    let effect=cached.effects.get(effectKey);
    if(!effect) {
      const target=clampToEyeballs(fold.positions,deformPositions(fold.positions,basis,isolated,selection,style),spheres);
      // 트임 변위를 이웃과 다시 평균 내면 가까운 눈꺼풀 표면이 서로 교차할 수 있다.
      effect=stable(fold.positions,target);
      if(cached.effects.size>=12)cached.effects.delete(cached.effects.keys().next().value);
      cached.effects.set(effectKey,effect);
    }
    components.push({control,positions:effect.positions});
    const combined=positions.slice();
    for(let i=0;i<combined.length;i++)combined[i]=fold.positions[i]+combineEyeOffset(positions[i]-fold.positions[i],effect.positions[i]-fold.positions[i]);
    clampToEyeballs(positions,combined,spheres);
    const composed=stable(positions,combined,undefined,{base:fold.positions,mask:foldMask});
    stages.push({control,reference:positions,positions:composed.positions});
    positions=composed.positions;
    rimAmount=Math.min(rimAmount,effect.amount*composed.amount);
    limited+=effect.limited+composed.limited;
  }
  const reductions=[];
  if(components.length>1)for(const component of components)for(const eye of basis) {
    if(selection!=='both'&&eye.side!==selection)continue;
    const control=component.control,u0={opening:.5,inner:.02,outer:.98,lower:.76,upper:.18,tail:.98}[control];
    const v0=['inner','outer','tail'].includes(control)?0:control==='lower'?lowerHeight(eye,u0):upperHeight(eye,u0);
    const axis=['inner','outer'].includes(control)?eye.t:eye.up,sign=['inner','lower'].includes(control)?-1:control==='tail'?Math.sign(values.tail):1;
    let solo=0,combined=0,weight=0;
    for(let i=0;i<base.length;i+=3) {
      const [u,v,z]=eye.local([base[i],base[i+1],base[i+2]]);
      if(Math.abs(u-u0)>.09||Math.abs(v-v0)>.07||Math.abs(z)>.3)continue;
      const w=Math.exp(-((u-u0)**2+(v-v0)**2)/.003);
      for(let k=0;k<3;k++) {
        solo+=w*sign*axis[k]*(component.positions[i+k]-fold.positions[i+k])/eye.width;
        combined+=w*sign*axis[k]*(positions[i+k]-fold.positions[i+k])/eye.width;
      }
      weight+=w;
    }
    if(weight&&solo/weight>1e-5&&combined<solo*.9-weight*1e-4)reductions.push({control,side:eye.side,retention:Math.max(0,combined/solo)});
  }
  return {positions,foldPositions:fold.positions.slice(),foldMask,rimAmount,stages,reductions,
    foldAmount:fold.amount,limited,foldLimited:fold.limited};
}
