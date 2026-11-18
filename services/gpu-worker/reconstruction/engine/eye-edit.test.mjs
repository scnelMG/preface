import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEyeBasis, defaultEyeValues as baseEyeValues, deformPositions, eyeDisplacement, unsafeFaces, fitEyeSpheres, clampToEyeballs, creaseHeights, creaseHeight, creaseLine, CREASE_TURN, CREASE_TAIL_CAP, inspectCreaseLine, TEMPLATE_EYE_BIAS, curvePoint, refineEyeMesh, limitEyeDeformation, eligibleEyes, composeEyeDeformation, combineEyeOffset, DEFAULT_CURVE_ARCH, lidFoldPositions, LID_TAIL} from './eye-edit.mjs';
// 엔진 upperHeight와 같은 2계수 눈꺼풀 곡선(합성 눈 시험용)
const lidAt=(eye,u)=>{const x=Math.max(0,Math.min(1,u)),s=x*(1-x);return s*(eye.upperCurve[0]+eye.upperCurve[1]*(2*x-1));};

// 이 파일의 기하 fixture는 기존 주름이 없는 합성 눈이다.
const defaultEyeValues=()=>({...baseEyeValues(),eligible:{L:true,R:true}});

function fixture() {
  const landmarks=Array.from({length:468},()=>[0,0,0]);
  for(const [side,sign,upper,lower] of [
    ['R',-1,[133,173,157,158,159,160,161,246,33],[133,155,154,153,145,144,163,7,33]],
    ['L',1,[362,398,384,385,386,387,388,466,263],[362,382,381,380,374,373,390,249,263]],
  ]) {
    for(let i=0;i<upper.length;i++) {
      const u=i/(upper.length-1), x=sign*(.6+u);
      landmarks[upper[i]]=[x,.15*Math.sin(Math.PI*u),0];
      landmarks[lower[i]]=[x,-.1*Math.sin(Math.PI*u),0];
    }
  }
  return buildEyeBasis(landmarks,{templateBias:false});
}
// 두 눈을 덮는 합성 피부 평면(z 0.04)과 lid 입력(전부 앞면 피부, 법선 +z). x0..x1 범위만 만들 수 있다.
function plane({x0=-1.85,x1=1.85,y0=-.45,y1=1.05,step=.03}={}) {
  const cols=Math.round((x1-x0)/step)+1,rows=Math.round((y1-y0)/step)+1,positions=[],indices=[];
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++)positions.push(x0+x*step,y0+y*step,.04);
  for(let y=0;y<rows-1;y++)for(let x=0;x<cols-1;x++){const a=y*cols+x;indices.push(a,a+1,a+cols,a+1,a+cols+1,a+cols);}
  const base=new Float32Array(positions),count=base.length/3,normals=new Float32Array(base.length);
  for(let i=2;i<normals.length;i+=3)normals[i]=1;
  const front=new Float32Array(count).fill(1);
  return {base,indices:new Uint32Array(indices),normals,lid:{front:{L:front,R:front},normal:normals},cols};
}
const moved=(a,b,i)=>a[3*i]!==b[3*i]||a[3*i+1]!==b[3*i+1]||a[3*i+2]!==b[3*i+2];
test('템플릿 기준점 치우침을 보정해 메시가 대칭이면 두 눈 설계선도 대칭이다',()=>{
  // 대칭 눈에 템플릿 치우침(R − 반전 L)을 R에만 더한 합성 기준점. 축: x=두 눈 방향(R 바깥쪽 −x), y=위, z=앞, 눈 폭 1.
  const landmarks=Array.from({length:468},()=>[0,0,0]);
  for(const [side,sign,upper,lower] of [
    ['R',-1,[133,173,157,158,159,160,161,246,33],[133,155,154,153,145,144,163,7,33]],
    ['L',1,[362,398,384,385,386,387,388,466,263],[362,382,381,380,374,373,390,249,263]],
  ]) for(let i=0;i<upper.length;i++) {
    const u=i/(upper.length-1),x=sign*(.6+u),add=(p,b)=>side==='R'?[p[0]-b[0],p[1]+b[1],p[2]+b[2]]:p;
    landmarks[upper[i]]=add([x,.15*Math.sin(Math.PI*u),0],TEMPLATE_EYE_BIAS.upper[i]);
    landmarks[lower[i]]=add([x,-.1*Math.sin(Math.PI*u),0],TEMPLATE_EYE_BIAS.lower[i]);
  }
  const [R,L]=buildEyeBasis(landmarks);
  for(const style of ['inline','inout','outline']) {
    const heights=creaseHeights(20,style),points=eye=>Array.from({length:110},(_,i)=>curvePoint(eye,.15+i*.01,heights,style));
    const left=points(L);
    for(const p of points(R)) {
      const mirrored=[-p[0],p[1]],near=left.reduce((a,b)=>Math.abs(b[0]-mirrored[0])<Math.abs(a[0]-mirrored[0])?b:a);
      assert.ok(Math.abs(near[1]-mirrored[1])<.008,`${style} x=${p[0].toFixed(3)} 높이 ${p[1].toFixed(4)} / ${near[1].toFixed(4)}`);
    }
  }
});
test('누락된 모델 기준점은 추측하지 않고 거절한다',()=>{
  assert.throws(()=>buildEyeBasis([]));
  assert.throws(()=>buildEyeBasis(Array(468).fill([0,0,0])));
});
test('원본·양쪽 대칭·단측 적용·영향 영역을 보존한다',()=>{
  const basis=fixture(), zero=defaultEyeValues(), p={...zero,opening:50,crease:65,inner:25};
  assert.deepEqual(eyeDisplacement([1.1,.2,0],basis,zero),[0,0,0]);
  const l=eyeDisplacement([1.1,.25,0],basis,p), r=eyeDisplacement([-1.1,.25,0],basis,p);
  assert.ok(Math.abs(l[0]+r[0])<1e-12 && Math.abs(l[1]-r[1])<1e-12 && Math.abs(l[2]-r[2])<1e-12);
  assert.deepEqual(eyeDisplacement([-1.1,.25,0],basis,p,'L'),[0,0,0]);
  assert.deepEqual(eyeDisplacement([0,-3,0],basis,p),[0,0,0]);
  assert.deepEqual(eyeDisplacement([1.1,.25,-2],basis,p),[0,0,0]);
});
test('앞·뒤 경계와 눈 뜨임·꼬리·접힘이 서로 다른 방향으로 움직인다',()=>{
  const b=fixture(), z=defaultEyeValues();
  assert.ok(eyeDisplacement([.6,0,0],b,{...z,inner:100})[0]<0);
  assert.ok(eyeDisplacement([1.6,0,0],b,{...z,outer:100})[0]>0);
  assert.ok(eyeDisplacement([1.1,.15,0],b,{...z,opening:100})[1]>0);
  assert.ok(eyeDisplacement([1.6,0,0],b,{...z,tail:100})[1]>0);
  assert.ok(eyeDisplacement([1.6,0,0],b,{...z,tail:-100})[1]<0);
  // 쌍꺼풀은 트임·뜨임 변위(eyeDisplacement)에 섞이지 않는다(lidFoldPositions)
  assert.deepEqual(eyeDisplacement([1.1,.3,0],b,{...z,crease:100}),[0,0,0]);
});
test('반복 적용이 원본을 오염시키지 않으며 잘못된 값도 유한하게 처리한다',()=>{
  const b=fixture(), base=new Float32Array([1.1,.25,0,-1.1,.25,0]), copy=base.slice();
  const p={...defaultEyeValues(),crease:100,opening:100};
  assert.deepEqual(deformPositions(base,b,p),deformPositions(base,b,p));
  assert.deepEqual(base,copy);
  assert.ok(deformPositions(base,b,{opening:Infinity,crease:NaN}).every(Number.isFinite));
});
test('삼각형 뒤집힘·붕괴를 감지한다',()=>{
  const base=new Float32Array([0,0,0,1,0,0,0,1,0]), indices=[0,1,2];
  assert.equal(unsafeFaces(base,base,indices),0);
  assert.equal(unsafeFaces(base,new Float32Array([0,0,0,0,1,0,1,0,0]),indices),1);
  assert.equal(unsafeFaces(base,new Float32Array(9),indices),1);
});
test('안구 근사를 복원하고 피부의 추가 침범을 제한하며 원본은 보존한다',()=>{
  const basis=fixture(), points=[];
  for(const sign of [-1,1]) for(let i=0;i<20;i++) for(let j=0;j<20;j++) {
    const theta=(i+.5)*Math.PI/20, phi=j*Math.PI/10;
    points.push([sign*1.1+.35*Math.sin(theta)*Math.cos(phi),.35*Math.sin(theta)*Math.sin(phi),-.2+.35*Math.cos(theta)]);
  }
  const spheres=fitEyeSpheres(points,basis);
  assert.equal(spheres.length,2);
  for(const s of spheres) assert.ok(Math.abs(s.radius-.35)<1e-8);
  const base=new Float32Array([1.1,0,.2]), target=new Float32Array([1.1,0,0]);
  clampToEyeballs(base,target,spheres);
  assert.ok(target[2]>.15);
  assert.deepEqual(clampToEyeballs(base,base.slice(),spheres),base);
  assert.deepEqual(fitEyeSpheres([],basis),[]);
});
test('5점 곡선은 제어점을 통과하고 프리셋·사용자 편집·단측 형상에 반영된다',()=>{
  const heights=creaseHeights(), basis=fixture();
  for(let i=0;i<5;i++)assert.ok(Math.abs(creaseHeight(.08+i*.21,heights)-heights[i])<1e-10);
  const custom=heights.slice();custom[2]=.28;
  assert.ok(creaseHeight(.5,custom)>creaseHeight(.5,heights));
  assert.ok(creaseHeights(45,'inline')[0]<creaseHeights(45,'outline')[0]);
  const g=plane({x0:.35}),p={...defaultEyeValues(),crease:80,curves:{L:heights,R:heights}};
  assert.notDeepEqual(lidFoldPositions(g.base,basis,p,'both','inout',g.lid),lidFoldPositions(g.base,basis,{...p,curves:{L:custom,R:heights}},'both','inout',g.lid));
  // R만 고르면 L 곡선을 바꿔도 L 눈은 그대로다
  assert.deepEqual(lidFoldPositions(g.base,basis,{...p,curves:{L:custom,R:heights}},'R','inout',g.lid),g.base);
});
test('공유 모서리를 분할해도 표면·면적·경계 연결을 보존한다',()=>{
  const positions=new Float32Array([.7,.2,0,1.5,.2,0,1.5,.5,0,.7,.5,0]);
  const normals=new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1]);
  const input={positions,normals,uv:new Float32Array([0,0,1,0,1,1,0,1]),indices:new Uint32Array([0,1,2,0,2,3])};
  const output=refineEyeMesh(input,fixture(),2),edges=new Map();let area=0;
  assert.ok(output.positions.length>input.positions.length);
  assert.deepEqual(input.positions,positions);
  for(let i=0;i<output.indices.length;i+=3) {
    const tri=Array.from(output.indices.slice(i,i+3)),p=tri.map(i=>Array.from(output.positions.slice(i*3,i*3+3)));
    area+=((p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[2][0]-p[0][0])*(p[1][1]-p[0][1]))/2;
    for(let k=0;k<3;k++){const a=tri[k],b=tri[(k+1)%3],key=[a,b].sort((a,b)=>a-b).join(':');edges.set(key,(edges.get(key)||0)+1);}
  }
  assert.ok(Math.abs(area-.24)<1e-6);
  for(const [key,count]of edges)if(count===1){const p=key.split(':').map(Number).map(i=>output.positions.slice(i*3,i*3+3));assert.ok([0,1].some(k=>Math.abs(p[0][k]-p[1][k])<1e-7&&(Math.abs(p[0][k]-positions[k])<1e-7||Math.abs(p[0][k]-positions[6+k])<1e-7)));}else assert.equal(count,2);
  assert.equal(unsafeFaces(output.positions,output.positions,output.indices,[0,0,1]),0);
});
test('접힘 법선 회전과 투영 반전을 구분하고 국소 강도 제한으로 반전을 제거한다',()=>{
  const base=new Float32Array([0,0,0,1,0,0,0,1,0]),indices=new Uint32Array([0,1,2]);
  const depth=new Float32Array([0,0,0,1,0,0,0,1,-2]);
  assert.equal(unsafeFaces(base,depth,indices,[0,0,1]),0);
  const flipped=new Float32Array([0,0,0,-1,0,0,0,1,0]);
  assert.equal(unsafeFaces(base,flipped,indices,[0,0,1]),1);
  const result=limitEyeDeformation(base,flipped,indices,[0,0,1]);
  assert.ok(result.limited>0);assert.equal(result.remaining,0);
  assert.equal(unsafeFaces(base,result.positions,indices,[0,0,1]),0);
});
test('윗트임은 안쪽 위, 밑트임은 바깥쪽 아래에 별도로 작용한다',()=>{
  const b=fixture(),z=defaultEyeValues();
  const upperPoint=[.78,.15*Math.sin(Math.PI*.18),0],lowerPoint=[1.36,-.1*Math.sin(Math.PI*.76),0];
  assert.ok(eyeDisplacement(upperPoint,b,{...z,upper:100})[1]>0);
  assert.ok(eyeDisplacement(lowerPoint,b,{...z,lower:100})[1]<0);
  assert.deepEqual(eyeDisplacement(lowerPoint,b,{...z,lower:100},'R'),[0,0,0]);
  assert.ok(eyeDisplacement(upperPoint,b,{...z,upper:100})[1]>Math.abs(eyeDisplacement(upperPoint,b,{...z,lower:100})[1]));
});
test('미확인·기존 쌍꺼풀 눈은 생성하지 않고 확인된 무쌍 눈만 허용한다',()=>{
  const b=fixture(),g=plane(),values={...baseEyeValues(),crease:100};
  for(const status of [undefined,{L:'unknown',R:'present'},{L:'present',R:'present'}])
    assert.deepEqual(lidFoldPositions(g.base,b,{...values,eligible:eligibleEyes(status)},'both','inout',g.lid),g.base);
  assert.deepEqual(lidFoldPositions(g.base,b,values,'both','inout',g.lid),g.base);
  const changed=lidFoldPositions(g.base,b,{...values,eligible:eligibleEyes({L:'absent',R:'present'})},'both','inout',g.lid);
  let left=0,right=0;
  for(let i=0;i<g.base.length/3;i++)if(moved(changed,g.base,i))g.base[3*i]>0?left++:right++;
  assert.ok(left>0);assert.equal(right,0);
  assert.deepEqual(eligibleEyes({L:'typo',R:'absent'}),{L:false,R:true});
});
test('단은 눈머리 앞·눈꼬리 밖(LID_TAIL 끝) 피부를 움직이지 않고, 끝으로 갈수록 얕아진다',()=>{
  // 왼눈(L) fixture: 눈머리 x=0.6, 눈꼬리 x=1.6, 폭 1(u = x - 0.6)
  const basis=fixture(),g=plane({x0:.35}),p={...defaultEyeValues(),crease:100};
  const out=lidFoldPositions(g.base,basis,p,'both','inout',g.lid);
  const deepest=(u0,u1)=>{let d=0;for(let i=0;i<g.base.length/3;i++){const u=g.base[3*i]-.6;if(u>=u0&&u<u1)d=Math.max(d,g.base[3*i+2]-out[3*i+2]);}return d;};
  assert.equal(deepest(-.3,-.03),0);
  assert.equal(deepest(LID_TAIL[1]+.001,1.6),0);
  const middle=deepest(.45,.55),tail=deepest(.9,1);
  assert.ok(middle>0&&tail>0&&tail<middle,`꼬리 ${tail} 가운데 ${middle}`);
});
test('설계선은 앞쪽만 눈꺼풀을 따르고 꼬리는 눈꺼풀 낙차를 따르지 않고 폭이 커지며 끝에서 펴진다',()=>{
  // 기울기가 다른 두 눈, 하나는 눈꺼풀이 꼬리 근처까지 높다가 급하게 떨어진다(기본 남성 모델의 좌우 차이와 같은 방향).
  const make=(angle,skew)=>({t:[Math.cos(angle),Math.sin(angle),0],up:[-Math.sin(angle),Math.cos(angle),0],upperCurve:[1,skew],faceTilt:[Math.sin(angle),Math.cos(angle)]});
  const lid=(eye,u)=>{const x=Math.max(0,Math.min(1,u)),s=x*(1-x);return s*(eye.upperCurve[0]+eye.upperCurve[1]*(2*x-1));};
  for(const style of ['inline','inout','outline']) {
    const heights=creaseHeights(20,style),eyes=[make(.06,.12),make(.13,-.24)];
    const face=(eye,u)=>eye.faceTilt[0]*u+eye.faceTilt[1]*(lid(eye,u)+creaseLine(eye,u,heights,style));
    for(const eye of eyes) {
      for(let u=.1;u<=CREASE_TURN;u+=.05)assert.equal(creaseLine(eye,u,heights,style),creaseHeight(u,heights,style));
      // 꼭대기(눈 기울기에 따라 u 0.6~0.8) 뒤로는 다시 올라가지 않는다.
      for(let u=.86;u<=1.26;u+=.02)assert.ok(face(eye,u)<face(eye,u-.02)+1e-9,`${style} ${u.toFixed(2)}에서 위로 꺾임`);
      // 눈꼬리 밖은 점점 펴져 접힘이 사라지는 곳에서 얼굴 기준 수평이 된다.
      const end=(face(eye,1.26)-face(eye,1.24))/.02;
      assert.ok(end<=1e-6&&end>-.05,`${style} 끝 기울기 ${end}`);
      const gap=u=>creaseLine(eye,u,heights,style);
      assert.ok(gap(1)>gap(.9)&&gap(.9)>gap(.7),`${style} 꼬리 폭 ${gap(.7)} ${gap(.9)} ${gap(1)}`);
      // 눈꺼풀 구간과 펴지는 구간 사이의 휨이 이어져 무릎처럼 꺾이지 않는다.
      const e=.004,bend=u=>(face(eye,u+e)-2*face(eye,u)+face(eye,u-e))/(e*e);
      assert.ok(Math.abs(bend(CREASE_TURN+e)-bend(CREASE_TURN-e))<.3,`${style} 휨 ${bend(CREASE_TURN-e)} → ${bend(CREASE_TURN+e)}`);
    }
    // 눈꺼풀이 꼬리에서 급하게 떨어져도 라인은 그 낙차를 따라 꺾이지 않는다(꼬리가 갑자기 좁아지지 않는다).
    for(const eye of eyes) {
      const lidFace=u=>eye.faceTilt[0]*u+eye.faceTilt[1]*lid(eye,u);
      assert.ok(face(eye,1)-face(eye,.85)>lidFace(1)-lidFace(.85),`${style} 꼬리 낙차`);
    }
  }
});

test('새 모델에도 같은 규칙으로 설계선 검증을 통과하고 눈꼬리 높이가 눈꺼풀 모양과 무관하게 같은 범위다(상한 전)',()=>{
  // 눈꺼풀 높이·치우침·눈 기울기를 실제 9개 모델(0.71~1.13, −0.20~+0.06, 0.05~0.16)보다 넓게 바꾼 합성 눈.
  // 세부 구간 높이는 막고 전체 높이(0~100)만 쓴다.
  const make=(a0,skew,angle)=>({t:[Math.cos(angle),Math.sin(angle),0],up:[-Math.sin(angle),Math.cos(angle),0],upperCurve:[a0,skew],faceTilt:[Math.sin(angle),Math.cos(angle)]});
  const eyes=[];
  for(const a0 of [.6,.75,.9,1.05,1.2])for(const skew of [-.3,-.15,0,.15])for(const angle of [0,.1,.2])eyes.push(make(a0,skew,angle));
  for(const style of ['inline','inout','outline'])for(let height=0;height<=100;height+=10) {
    const ratios=eyes.map(eye=>{const r=inspectCreaseLine(eye,height,style);assert.ok(r.ok,`${style} ${height} ${eye.upperCurve} ${JSON.stringify(r)}`);return r.ratio;});
    // 꼬리 상한은 그 눈의 가운데 라인 높이를 따르므로 상한이 걸린 눈은 모양마다 비율이 다르다. 상한 전인 눈끼리만 같은 범위를 본다.
    const free=eyes.map((eye,i)=>[eye,ratios[i]]).filter(([eye])=>creaseLine(eye,1,creaseHeights(height,style),style)<CREASE_TAIL_CAP*(lidAt(eye,.5)+creaseHeight(.5,creaseHeights(height,style),style))-1e-6).map(([,r])=>r);
    if(free.length>1)assert.ok(Math.max(...free)-Math.min(...free)<.3,`${style} ${height} 눈꼬리/중앙 ${Math.min(...free)}~${Math.max(...free)}`);
  }
});

test('높이를 올려도 눈꼬리 위 라인은 가운데 라인 높이의 상한 비율을 넘지 않고, 기본 높이는 상한에 닿지 않는다',()=>{
  const make=(a0,skew)=>({t:[1,0,0],up:[0,1,0],upperCurve:[a0,skew],faceTilt:[0,1]});
  for(const style of ['inline','inout','outline'])for(const a0 of [.9,1,1.1,1.2])for(const skew of [-.25,0,.1]) {
    const eye=make(a0,skew),center=h=>lidAt(eye,.5)+creaseHeight(.5,creaseHeights(h,style),style),tail=h=>creaseLine(eye,1,creaseHeights(h,style),style);
    for(let h=0;h<=100;h+=10)assert.ok(tail(h)<=CREASE_TAIL_CAP*center(h)+1e-9,`${style} ${a0} ${skew} ${h}`);
    assert.ok(tail(20)<CREASE_TAIL_CAP*center(20)-.005,`${style} ${a0} ${skew} 기본 높이에서 상한에 닿음`);
    for(let h=10;h<=100;h+=10)assert.ok(tail(h)>=tail(h-10)-1e-9,`${style} 높이를 올렸는데 꼬리가 내려감 ${h}`);
  }
});

test('트임·눈매를 합성해도 확정한 접힘은 유지하고 원본을 변경하지 않는다',()=>{
  const basis=fixture(), positions=[], indices=[];
  const cols=51,rows=51;
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++)positions.push(.35+x*.03,-.45+y*.03,.04);
  for(let y=0;y<rows-1;y++)for(let x=0;x<cols-1;x++) {
    const a=y*cols+x;indices.push(a,a+1,a+cols,a+1,a+cols+1,a+cols);
  }
  const base=new Float32Array(positions), original=base.slice(), normals=new Float32Array(base.length);
  for(let i=2;i<normals.length;i+=3)normals[i]=1;
  const lid={front:{L:new Float32Array(base.length/3).fill(1),R:new Float32Array(base.length/3).fill(1)},normal:normals};
  const values={...defaultEyeValues(),crease:55},fold=composeEyeDeformation(base,basis,values,'both','inout',normals,indices,[],lid);
  assert.ok(fold.positions.some((v,i)=>Math.abs(v-base[i])>1e-5));
  for(const control of ['opening','inner','outer','lower','upper','tail']) {
    const result=composeEyeDeformation(base,basis,{...values,[control]:100},'both','inout',normals,indices,[],lid);
    assert.deepEqual(result.foldPositions,fold.positions,control+' 접힘 기준 보존');
    assert.ok(result.positions.some((v,i)=>Math.abs(v-fold.positions[i])>1e-5),control+' 실제 이동');
    assert.equal(unsafeFaces(base,result.foldPositions,indices,basis[0].forward,result.foldMask),0);
    assert.equal(unsafeFaces(result.foldPositions,result.positions,indices),0);
    const reset=composeEyeDeformation(base,basis,values,'both','inout',normals,indices,[],lid);
    assert.deepEqual(reset.positions,fold.positions,control+' 해제 시 접힘 복원');
  }
  assert.deepEqual(base,original);
});


test('국소 제한 후에도 매끈한 변형장에 고주파 요철을 크게 만들지 않는다',()=>{
  const n=41,positions=[],target=[],indices=[];
  for(let y=0;y<n;y++)for(let x=0;x<n;x++) {
    const u=-1+x*.05,v=-1+y*.05;
    positions.push(u,v,0);target.push(u+.45*Math.exp(-(u*u+v*v)/.09),v,0);
  }
  for(let y=0;y<n-1;y++)for(let x=0;x<n-1;x++) {
    const a=y*n+x;indices.push(a,a+1,a+n,a+1,a+n+1,a+n);
  }
  const base=new Float32Array(positions),original=base.slice(),faces=new Uint32Array(indices);
  assert.ok(unsafeFaces(base,new Float32Array(target),faces,[0,0,1])>0);
  const result=limitEyeDeformation(base,new Float32Array(target),faces,[0,0,1],[],undefined,120);
  assert.equal(result.remaining,0);
  let energy=0;
  for(let y=1;y<n-1;y++)for(let x=1;x<n-1;x++) {
    const i=y*n+x,d=j=>result.positions[3*j]-base[3*j];
    energy+=(4*d(i)-d(i-1)-d(i+1)-d(i-n)-d(i+n))**2;
  }
  // 동일 합성장의 이전 제한 방식은 0.5702였다. 새 방식은 약 0.1453이다.
  assert.ok(energy<.2);
  assert.ok(result.positions.some((v,i)=>Math.abs(v-base[i])>.01));
  assert.deepEqual(base,original);
});


test('눈 뜨임을 추가해도 앞·뒤트임의 수평 이동을 함께 줄이지 않는다',()=>{
  const basis=fixture(),p=[],indices=[],n=31;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)p.push(.35+.05*x,-.45+.05*y,.04);
  for(let y=0;y<n-1;y++)for(let x=0;x<n-1;x++) {
    const a=y*n+x;indices.push(a,a+1,a+n,a+1,a+n+1,a+n);
  }
  const base=new Float32Array(p),normals=new Float32Array(base.length);
  for(let i=2;i<normals.length;i+=3)normals[i]=1;
  const lid={front:{L:new Float32Array(base.length/3).fill(1),R:new Float32Array(base.length/3).fill(1)},normal:normals};
  for(const control of ['inner','outer']) {
    const values={...defaultEyeValues(),crease:55,[control]:100};
    const solo=composeEyeDeformation(base,basis,values,'both','inout',normals,indices,[],lid);
    const combined=composeEyeDeformation(base,basis,{...values,opening:100},'both','inout',normals,indices,[],lid);
    let opening=0;
    for(let i=0;i<base.length;i+=3) {
      assert.equal(combined.positions[i],solo.positions[i]);
      opening=Math.max(opening,combined.positions[i+1]-solo.positions[i+1]);
    }
    assert.ok(opening>.01);
    for(const stage of combined.stages)assert.equal(unsafeFaces(stage.reference,stage.positions,indices),0);
    const reversed=composeEyeDeformation(base,basis,Object.fromEntries(Object.entries({...values,opening:100}).reverse()),'both','inout',normals,indices,[],lid);
    assert.deepEqual(reversed.positions,combined.positions);
  }
});


test('합성 단계가 각각 안전해도 누적된 바깥 피부의 반전은 제한한다',()=>{
  const base=new Float32Array([0,0,0,1,0,0,0,1,0]),indices=new Uint32Array([0,1,2]);
  const rotate=angle=>new Float32Array([0,0,0,1,0,0,0,Math.cos(angle),Math.sin(angle)]);
  const reference=rotate(Math.PI/3),target=rotate(2*Math.PI/3);
  assert.equal(unsafeFaces(reference,target,indices),0);
  assert.ok(unsafeFaces(base,target,indices)>0);
  const result=limitEyeDeformation(reference,target,indices,undefined,[],undefined,120,{base,mask:new Uint8Array(3)});
  assert.equal(unsafeFaces(base,result.positions,indices),0);
  assert.equal(unsafeFaces(reference,result.positions,indices),0);
});

test('합성 캐시는 조절·생성 허용 상태 변경을 반영하고 반환 배열로 오염되지 않는다',()=>{
  const basis=fixture(),base=new Float32Array([1.1,.3,.04,1.15,.3,.04,1.1,.35,.04]),indices=new Uint32Array([0,1,2]),spheres=[];
  const normals=new Float32Array([0,0,1,0,0,1,0,0,1]),lid={front:{L:new Float32Array([1,1,1]),R:new Float32Array([1,1,1])},normal:normals};
  const values={...defaultEyeValues(),crease:55,inner:50};
  const first=composeEyeDeformation(base,basis,values,'both','inout',normals,indices,spheres,lid);
  const expected=first.positions.slice();first.positions.fill(0);first.foldPositions.fill(0);
  const again=composeEyeDeformation(base,basis,values,'both','inout',normals,indices,spheres,lid);
  assert.deepEqual(again.positions,expected);
  values.eligible.L=false;
  const cached=composeEyeDeformation(base,basis,values,'both','inout',normals,indices,spheres,lid);
  const fresh=composeEyeDeformation(base.slice(),basis,values,'both','inout',normals,indices,spheres,lid);
  assert.deepEqual(cached.positions,fresh.positions);
});


test('같은 방향의 겹친 이동은 단독값 이상으로 유지하고 중복 합산을 완화한다',()=>{
  for(const a of [.001,.02,.075])for(const b of [.001,.02,.075])for(const sign of [-1,1]) {
    const merged=Math.abs(combineEyeOffset(sign*a,sign*b));
    assert.ok(merged>=Math.max(a,b)-1e-12&&merged<a+b);
    assert.equal(combineEyeOffset(sign*a,0),sign*a);
  }
  assert.ok(Math.abs(combineEyeOffset(.03,-.01)-.02)<1e-12);
});


test('기본 높이·곡률은 낮추고 뒤쪽·꼬리는 올리며 꼬리를 더 높게 둔다',()=>{
  assert.equal(baseEyeValues().height,20);assert.equal(DEFAULT_CURVE_ARCH,-30);
  for(const style of ['inline','inout','outline']) {
    const h=creaseHeights(undefined,style);
    assert.ok(h[2]<.162);assert.ok(h[3]>(.09+.16*.2)-.036*.6);assert.ok(h[4]>h[3]);
    assert.ok(h.every(v=>v>=.005&&v<=.36));
  }
});

test('인라인은 눈꺼풀 경계에서 0 높이·접선으로 합류하고 첫 점에서 꺾이지 않는다',()=>{
  for(const height of [0,20,100]) {
    const points=creaseHeights(height,'inline'),e=1e-6;
    assert.equal(creaseHeight(0,points,'inline'),0);
    assert.equal(creaseHeight(-.01,points,'inline'),0);
    assert.ok(creaseHeight(e,points,'inline')/e<.001);
    const f=u=>creaseHeight(u,points,'inline');
    const left=(f(.08)-f(.08-e))/e,right=(f(.08+e)-f(.08))/e;
    assert.ok(Math.abs(left-right)<.001);
    let previous=0;
    for(let u=0;u<=.29;u+=.001) {const y=f(u);assert.ok(y>=previous-1e-8);previous=y;}
    for(let i=0;i<5;i++)assert.ok(Math.abs(f(.08+.21*i)-points[i])<1e-9);
  }
});

test('인라인을 직접 편집해도 합류 방식을 유지하고 캐시가 이를 구분한다',()=>{
  const basis=fixture(),curves={L:creaseHeights(20,'inline'),R:creaseHeights(20,'inline')},g=plane({x0:.35});
  const values={...defaultEyeValues(),crease:55,curves,joinStyles:{L:'inline',R:'inline'}};
  // 종류는 joinStyles를 따른다(style 인자가 'custom'이어도 인라인 합류)
  assert.deepEqual(lidFoldPositions(g.base,basis,values,'both','inline',g.lid),lidFoldPositions(g.base,basis,values,'both','custom',g.lid));
  const base=new Float32Array([1.1,.3,.04,1.15,.3,.04,1.1,.35,.04]),indices=new Uint32Array([0,1,2]),normals=new Float32Array([0,0,1,0,0,1,0,0,1]),spheres=[];
  const lid={front:{L:new Float32Array([1,1,1]),R:new Float32Array([1,1,1])},normal:normals};
  composeEyeDeformation(base,basis,values,'both','custom',normals,indices,spheres,lid);
  values.joinStyles.L='outline';
  const reused=composeEyeDeformation(base,basis,values,'both','custom',normals,indices,spheres,lid);
  const fresh=composeEyeDeformation(base.slice(),basis,values,'both','custom',normals,indices,spheres,lid);
  assert.deepEqual(reused.positions,fresh.positions);
});
test('세분화 원본 가중치로 원본 값을 옮기면 세분화 위치·morph 변위가 그대로 재현된다',async()=>{
  const {transferRefined}=await import('./eye-edit.mjs');
  const positions=new Float32Array([.7,.2,0,1.5,.2,0,1.5,.5,0,.7,.5,0]);
  const input={positions,normals:new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1]),indices:new Uint32Array([0,1,2,0,2,3])};
  const output=refineEyeMesh(input,fixture(),2);
  assert.equal(output.sources.original,4);
  assert.equal(output.sources.offsets.length-1,output.positions.length/3);
  const moved=transferRefined(output.sources,positions,3);
  for(let i=0;i<moved.length;i++)assert.ok(Math.abs(moved[i]-output.positions[i])<1e-6);
  for(let i=0;i<output.positions.length/3;i++) {
    let sum=0;for(let k=output.sources.offsets[i];k<output.sources.offsets[i+1];k++)sum+=output.sources.weights[k];
    assert.ok(Math.abs(sum-1)<1e-6);
  }
  // 한 원본 정점만 움직이는 morph는 그 정점을 쓰는 세분화 정점에만 퍼진다.
  const delta=new Float32Array(12);delta[2*3+2]=1;
  const spread=transferRefined(output.sources,delta,3);
  assert.equal(spread[2*3+2],1);
  assert.equal(spread[0*3+2],0);
});
test('안전 한계 탐색은 처음 실패하는 값 직전의 단계값을 돌려준다',async()=>{
  const {findSafeLimit,isEyeShapeSafe,EYE_SAFE_RULE}=await import('./eye-edit.mjs');
  assert.equal(findSafeLimit(()=>true),100);
  assert.equal(findSafeLimit(v=>v<=37),35);
  assert.equal(findSafeLimit(v=>v<=0),0);
  const calls=[];findSafeLimit(v=>{calls.push(v);return v<=60;});
  assert.ok(calls.length<=6);
  assert.ok(calls.every(v=>v%EYE_SAFE_RULE.step===0));
  // 분모는 눈 주변 고정 영역이다(움직인 정점 수가 아니다).
  assert.equal(isEyeShapeSafe({amount:.5,limited:0,region:1000,sharp:0}),false);
  assert.equal(isEyeShapeSafe({amount:1,limited:0,region:0,sharp:0}),true);
  assert.equal(isEyeShapeSafe({amount:1,limited:50,region:1000,sharp:2}),true);
  assert.equal(isEyeShapeSafe({amount:1,limited:51,region:1000,sharp:0}),false);
  assert.equal(isEyeShapeSafe({amount:1,limited:0,region:1000,sharp:3}),false);
});
test('조합 검사는 좌우를 따로 보고 하나라도 실패하면 실패한다',async()=>{
  const {isEyeStateSafe,eyeRegionCount,FOLD_DEPTH_MAX}=await import('./eye-edit.mjs');
  assert.equal(FOLD_DEPTH_MAX,100);
  const basis=fixture();
  const base=new Float32Array([1.1,.2,0,-1.1,.2,0,5,5,5]),rig={base,basis,normals:new Float32Array([0,0,1,0,0,1,0,0,1]),indices:new Uint32Array([0,1,2]),spheres:[]};
  assert.equal(eyeRegionCount(rig),2);
  assert.equal(eyeRegionCount(rig,'L'),1);
  const values={height:20,crease:0,inner:0,outer:0,lower:0,upper:0,style:'inout',eligible:{L:false,R:false}};
  assert.equal(isEyeStateSafe(rig,[{selection:'both',values}]),true);
});
test('새 급한 꺾임은 원래 매끈하던 모서리에서만 세고 접힘 마스크 안쪽은 뺀다',async()=>{
  const {newSharpEdges}=await import('./eye-edit.mjs');
  const base=new Float32Array([0,0,0,1,0,0,0,1,0,1,1,0]),indices=new Uint32Array([0,1,2,1,3,2]);
  assert.equal(newSharpEdges(base,base,indices),0);
  const bent=base.slice();bent[11]=-3;
  assert.equal(newSharpEdges(base,bent,indices),1);
  assert.equal(newSharpEdges(base,bent,indices,new Uint8Array([1,1,1,1])),0);
});
test('한계 탐색은 중간에 낀 실패 구간을 놓치지 않는다',async()=>{
  const {scanSafeLimit}=await import('./eye-edit.mjs');
  // 인라인 높이처럼 50 부근에서만 실패하고 75·100은 다시 통과하는 경우
  assert.equal(scanSafeLimit(v=>v<45||v>60),40);
  assert.equal(scanSafeLimit(()=>true),100);
  assert.equal(scanSafeLimit(v=>v<=37),35);
  assert.equal(scanSafeLimit(v=>v<=65,0,65),65);
  assert.equal(scanSafeLimit(v=>v===0),0);
});

test("lid 단 모양은 모델링(pipeline/lid_fold.py sink)과 같은 값이다",async()=>{
  const {lidSink,lidDepth,LID_STEP}=await import('./eye-edit.mjs');
  // python: lid_fold.sink(a, h, c) = 모델링 값, sink(a, h, c, 0.09, 2) = 편집 메시 값(lid-step.json edit) 출력(2026-11-13)
  const points=[[.004,.12,1],[.03,.12,1],[.06,.12,.8],[.11,.12,1],[.12,.12,1],[.13,.12,.7],[.16,.12,1],[.2,.12,1],[.05,.003,1]];
  const model=[0,.125,.353553,.877642,1,.761645,.034294,0,0],edit=[0,.125,.353553,.877642,1,.707735,.308642,.012346,0];
  points.forEach(([a,h,c],i)=>{
    assert.ok(Math.abs(lidSink(a,h,c)-model[i])<1e-6,`model ${a},${h},${c}`);
    assert.ok(Math.abs(lidSink(a,h,c,LID_STEP.edit.lip,LID_STEP.edit.rise_pow)-edit[i])<1e-6,`edit ${a},${h},${c}`);
  });
  assert.equal(lidDepth(65),LID_STEP.edit.depth);
});
test("lid 쌍꺼풀은 앞면 피부 무게가 있는 정점만 피부 법선 반대로 움직이고, 줄 정보가 없으면 거절한다",async()=>{
  const basis=fixture(),positions=[],indices=[],cols=51,rows=51;
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++)positions.push(.35+x*.03,-.45+y*.03,.04);
  for(let y=0;y<rows-1;y++)for(let x=0;x<cols-1;x++){const a=y*cols+x;indices.push(a,a+1,a+cols,a+1,a+cols+1,a+cols);}
  const base=new Float32Array(positions),count=base.length/3,normals=new Float32Array(base.length);
  for(let i=2;i<normals.length;i+=3)normals[i]=1;
  // 절반(왼쪽 열)만 앞면 피부로 둔다: 나머지(숨은 면·가장자리 역할)는 움직이면 안 된다
  const front=new Float32Array(count).map((_,i)=>i%cols<cols/2?1:0),lid={front:{L:front,R:front},normal:normals};
  const values={...defaultEyeValues(),crease:65,curves:{L:creaseHeights(20),R:creaseHeights(20)},joinStyles:{L:'inout',R:'inout'}};
  const out=lidFoldPositions(base,basis,values,'both','inout',lid);
  let moved=0;
  for(let i=0;i<count;i++) {
    const d=[0,1,2].map(k=>out[3*i+k]-base[3*i+k]);
    if(!front[i])assert.deepEqual(d,[0,0,0]);
    else if(d[2]!==0){moved++;assert.ok(d[2]<0&&d[0]===0&&d[1]===0);}
  }
  assert.ok(moved>0);
  assert.throws(()=>composeEyeDeformation(base,basis,values,'both','inout',normals,indices),/줄 정보/);
  // 쌍꺼풀이 없으면(깊이 0) 줄 정보 없이도 트임만 계산한다
  assert.ok(composeEyeDeformation(base,basis,{...values,crease:0,inner:100},'both','inout',normals,indices).positions.some((v,i)=>v!==base[i]));
});
