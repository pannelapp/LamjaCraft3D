'use strict';
const $ = (id: string): any => document.getElementById(id);
const qsa = (selector: string): any[] => Array.from(document.querySelectorAll(selector)) as any[];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const fmt = (n: number) => Number(n.toFixed(2)).toLocaleString('en-US', { maximumFractionDigits: 2 });
const clean = (n: number, scale = 1e9) => Math.round(n * scale) / scale;
const V = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0]+b[0], a[1]+b[1], a[2]+b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0]-b[0], a[1]-b[1], a[2]-b[2]],
  mul: (a: Vec3, s: number): Vec3 => [a[0]*s, a[1]*s, a[2]*s],
  dot: (a: Vec3, b: Vec3) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]],
  len: (a: Vec3) => Math.hypot(a[0],a[1],a[2]),
  unit: (a: Vec3): Vec3 => { const n=Math.hypot(a[0],a[1],a[2])||1; return [a[0]/n,a[1]/n,a[2]/n]; },
  lerp: (a: Vec3,b:Vec3,t:number):Vec3 => [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t],
  near: (a:Vec3,b:Vec3,eps=TOL.weld) => Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]) <= eps,
};
const v2 = {
  cross: (a:Vec2,b:Vec2,c:Vec2) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),
  area: (p:Vec2[]) => p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2,
  dist: (a:Vec2,b:Vec2) => Math.hypot(a[0]-b[0],a[1]-b[1]),
};
function circularArcThrough3(a:Vec2,m:Vec2,b:Vec2,segmentsFull=48):Vec2[]{
  const ax=a[0],ay=a[1],mx=m[0],my=m[1],bx=b[0],by=b[1];
  const d=2*(ax*(my-by)+mx*(by-ay)+bx*(ay-my));
  if(Math.abs(d)<1e-10)throw Error('The arc points are collinear.');
  const a2=ax*ax+ay*ay,m2=mx*mx+my*my,b2=bx*bx+by*by;
  const cx=(a2*(my-by)+m2*(by-ay)+b2*(ay-my))/d,cy=(a2*(bx-mx)+m2*(ax-bx)+b2*(mx-ax))/d;
  const r=Math.hypot(ax-cx,ay-cy);if(r<TOL.minimumEdge)throw Error('The arc is too small.');
  const tau=Math.PI*2,mod=(x:number)=>((x%tau)+tau)%tau,aa=Math.atan2(ay-cy,ax-cx),am=Math.atan2(my-cy,mx-cx),ab=Math.atan2(by-cy,bx-cx);
  const endCCW=mod(ab-aa),midCCW=mod(am-aa);let span=midCCW<=endCCW+1e-10?endCCW:endCCW-tau;
  if(Math.abs(span)<1e-8)throw Error('The arc angle is too small.');
  const count=Math.max(2,Math.ceil(Math.abs(span)/tau*Math.max(12,segmentsFull)));
  const out=Array.from({length:count+1},(_,i)=>{const t=i/count,ang=aa+span*t;return [cx+r*Math.cos(ang),cy+r*Math.sin(ang)] as Vec2;});
  out[0]=[...a] as Vec2;out[out.length-1]=[...b] as Vec2;return out;
}

interface InvoluteGearSpec { teeth:number; module:number; pressureAngleDeg:number; flankSegments?:number; }
function involuteGearProfile2(spec:InvoluteGearSpec,center:Vec2=[0,0],rotation=0):Vec2[]{
  const z=Math.round(spec.teeth),m=Number(spec.module),alpha=Number(spec.pressureAngleDeg)*Math.PI/180,flankSegments=Math.max(2,Math.min(16,Math.round(spec.flankSegments??5)));
  if(!Number.isFinite(z)||z<6||z>240)throw Error('Gear tooth count must be between 6 and 240.');
  if(!Number.isFinite(m)||m<=TOL.minimumEdge)throw Error('Gear module must be greater than 0.');
  if(!Number.isFinite(alpha)||alpha<10*Math.PI/180||alpha>35*Math.PI/180)throw Error('Gear pressure angle must be between 10° and 35°.');
  const rp=m*z/2,ra=rp+m,rf=Math.max(m*.2,rp-1.25*m),rb=rp*Math.cos(alpha);
  if(rf>=ra-TOL.minimumEdge)throw Error('The gear parameters produce an invalid root radius.');
  const inv=(a:number)=>Math.tan(a)-a,invA=inv(alpha),halfPitch=Math.PI/z,halfTooth=Math.PI/(2*z),startR=Math.max(rf,rb);
  const phiForRadius=(r:number)=>r<=rb?0:Math.acos(clamp(rb/r,-1,1));
  const deltaAt=(r:number)=>halfTooth+invA-inv(phiForRadius(r));
  const deltaStart=deltaAt(startR),deltaTip=deltaAt(ra);
  if(deltaTip<=0)throw Error('The gear parameters make the tooth tip too thin.');
  const out:Vec2[]=[],polar=(r:number,a:number):Vec2=>[center[0]+r*Math.cos(a+rotation),center[1]+r*Math.sin(a+rotation)];
  for(let tooth=0;tooth<z;tooth++){
    const c=tooth*2*Math.PI/z;
    const valleyA=c-halfPitch;
    out.push(polar(rf,valleyA));
    out.push(polar(rf,c-deltaStart));
    if(startR>rf+TOL.minimumEdge)out.push(polar(startR,c-deltaStart));
    for(let i=1;i<=flankSegments;i++){
      const t=i/flankSegments,r=startR+(ra-startR)*t;
      out.push(polar(r,c-deltaAt(r)));
    }
    const tipArcSteps=Math.max(2,Math.ceil((2*deltaTip)/(Math.PI/36)));
    for(let i=1;i<=tipArcSteps;i++)out.push(polar(ra,c-deltaTip+(2*deltaTip)*i/tipArcSteps));
    for(let i=flankSegments-1;i>=0;i--){
      const t=i/flankSegments,r=startR+(ra-startR)*t;
      out.push(polar(r,c+deltaAt(r)));
    }
    if(startR>rf+TOL.minimumEdge)out.push(polar(rf,c+deltaStart));
    out.push(polar(rf,c+halfPitch));
  }
  const cleaned:Vec2[]=[];for(const q of out)if(!cleaned.length||v2.dist(cleaned[cleaned.length-1],q)>TOL.minimumEdge*.2)cleaned.push(q);
  if(cleaned.length>2&&v2.dist(cleaned[0],cleaned[cleaned.length-1])<TOL.minimumEdge*.2)cleaned.pop();
  if(polygonSelfIntersects(cleaned))throw Error('The gear outline self-intersects with these parameters.');
  if(v2.area(cleaned)<0)cleaned.reverse();
  return cleaned;
}


interface InvoluteRackSpec { teeth:number; module:number; pressureAngleDeg:number; baseThickness:number; }
function involuteRackProfile2(spec:InvoluteRackSpec,origin:Vec2=[0,0],rotation=0):Vec2[]{
  const teeth=Math.round(spec.teeth),m=Number(spec.module),alpha=Number(spec.pressureAngleDeg)*Math.PI/180,baseThickness=Number(spec.baseThickness);
  if(!Number.isFinite(teeth)||teeth<1||teeth>240)throw Error('Rack tooth count must be between 1 and 240.');
  if(!Number.isFinite(m)||m<=TOL.minimumEdge)throw Error('Rack module must be greater than 0.');
  if(!Number.isFinite(alpha)||alpha<10*Math.PI/180||alpha>35*Math.PI/180)throw Error('Rack pressure angle must be between 10° and 35°.');
  if(!Number.isFinite(baseThickness)||baseThickness<TOL.minimumEdge)throw Error('Rack base thickness must be greater than 0.');
  const pitch=Math.PI*m,addendum=m,dedendum=1.25*m,flankShift=Math.tan(alpha),length=teeth*pitch,bottom=-(dedendum+baseThickness);
  const local:Vec2[]=[[0,-dedendum]];
  for(let i=0;i<teeth;i++){
    const c=(i+.5)*pitch,leftPitch=c-pitch/4,rightPitch=c+pitch/4;
    local.push([leftPitch-dedendum*flankShift,-dedendum]);
    local.push([leftPitch+addendum*flankShift,addendum]);
    local.push([rightPitch-addendum*flankShift,addendum]);
    local.push([rightPitch+dedendum*flankShift,-dedendum]);
  }
  local.push([length,-dedendum],[length,bottom],[0,bottom]);
  const ca=Math.cos(rotation),sa=Math.sin(rotation);
  return local.map(([x,y])=>[origin[0]+x*ca-y*sa,origin[1]+x*sa+y*ca] as Vec2);
}


const PROFILE_PRIMITIVE_POLICY=Object.freeze({curveSegments:24,minCurveSegments:6,maxCurveSegments:64});
function rotateTranslate2(points:Vec2[],origin:Vec2,rotation:number):Vec2[]{const ca=Math.cos(rotation),sa=Math.sin(rotation);return points.map(([x,y])=>[origin[0]+x*ca-y*sa,origin[1]+x*sa+y*ca] as Vec2);}
function slotProfile2(length:number,width:number,center:Vec2=[0,0],rotation=0,curveSegments:number=PROFILE_PRIMITIVE_POLICY.curveSegments):Vec2[]{
  if(!Number.isFinite(length)||!Number.isFinite(width)||length<=TOL.minimumEdge||width<=TOL.minimumEdge)throw Error('Slot length and width must be greater than 0.');
  if(length<width-TOL.minimumEdge)throw Error('Slot length must be at least its width.');
  const r=width/2,straight=Math.max(0,length-width),half=straight/2,n=Math.max(PROFILE_PRIMITIVE_POLICY.minCurveSegments,Math.min(PROFILE_PRIMITIVE_POLICY.maxCurveSegments,Math.round(curveSegments))),local:Vec2[]=[];
  for(let i=0;i<=n;i++){const a=-Math.PI/2+i*Math.PI/n;local.push([half+r*Math.cos(a),r*Math.sin(a)]);}
  for(let i=0;i<=n;i++){const a=Math.PI/2+i*Math.PI/n;local.push([-half+r*Math.cos(a),r*Math.sin(a)]);}
  const out=normalizeLoop2(rotateTranslate2(local,center,rotation));if(v2.area(out)<0)out.reverse();return out;
}
function arcSlotProfile2(radius:number,sweepDeg:number,width:number,center:Vec2=[0,0],rotation=0,curveSegments:number=PROFILE_PRIMITIVE_POLICY.curveSegments):Vec2[]{
  if(!Number.isFinite(radius)||!Number.isFinite(width)||radius<=TOL.minimumEdge||width<=TOL.minimumEdge)throw Error('Arc slot radius and width must be greater than 0.');
  if(width>=radius*2-TOL.minimumEdge)throw Error('Arc slot width must be smaller than twice the centerline radius.');
  if(!Number.isFinite(sweepDeg)||sweepDeg<1||sweepDeg>359)throw Error('Arc slot sweep must be between 1° and 359°.');
  const halfW=width/2,outer=radius+halfW,inner=radius-halfW,sweep=sweepDeg*Math.PI/180,a0=-sweep/2,a1=sweep/2,nArc=Math.max(2,Math.ceil(Math.abs(sweep)/(Math.PI*2)*Math.max(24,curveSegments*4))),nCap=Math.max(PROFILE_PRIMITIVE_POLICY.minCurveSegments,Math.min(PROFILE_PRIMITIVE_POLICY.maxCurveSegments,Math.round(curveSegments))),local:Vec2[]=[];
  for(let i=0;i<=nArc;i++){const a=a0+(a1-a0)*i/nArc;local.push([outer*Math.cos(a),outer*Math.sin(a)]);}
  const e1:Vec2=[radius*Math.cos(a1),radius*Math.sin(a1)];for(let i=1;i<=nCap;i++){const a=a1+Math.PI*i/nCap;local.push([e1[0]+halfW*Math.cos(a),e1[1]+halfW*Math.sin(a)]);}
  for(let i=1;i<=nArc;i++){const a=a1+(a0-a1)*i/nArc;local.push([inner*Math.cos(a),inner*Math.sin(a)]);}
  const e0:Vec2=[radius*Math.cos(a0),radius*Math.sin(a0)];for(let i=1;i<=nCap;i++){const a=a0+Math.PI+Math.PI*i/nCap;local.push([e0[0]+halfW*Math.cos(a),e0[1]+halfW*Math.sin(a)]);}
  const out=normalizeLoop2(rotateTranslate2(local,center,rotation));if(v2.area(out)<0)out.reverse();if(polygonSelfIntersects(out))throw Error('The arc slot outline self-intersects with these parameters.');return out;
}
function boltCircleProfiles2(count:number,pitchDiameter:number,holeDiameter:number,center:Vec2=[0,0],rotation=0,segments=48):Vec2[][]{
  const n=Math.round(count),pitchRadius=pitchDiameter/2,holeRadius=holeDiameter/2,seg=Math.max(8,Math.min(128,Math.round(segments)));
  if(!Number.isFinite(n)||n<2||n>96)throw Error('Bolt circle count must be between 2 and 96.');
  if(!Number.isFinite(pitchDiameter)||pitchDiameter<=TOL.minimumEdge||!Number.isFinite(holeDiameter)||holeDiameter<=TOL.minimumEdge)throw Error('Bolt circle diameters must be greater than 0.');
  const neighborDistance=2*pitchRadius*Math.sin(Math.PI/n);if(holeDiameter>=neighborDistance-TOL.minimumEdge)throw Error('Bolt circle holes overlap at this pitch diameter.');
  return Array.from({length:n},(_,i)=>{const a=rotation+i*Math.PI*2/n,c:[number,number]=[center[0]+pitchRadius*Math.cos(a),center[1]+pitchRadius*Math.sin(a)];return Array.from({length:seg},(_,j)=>{const q=j*Math.PI*2/seg;return [c[0]+holeRadius*Math.cos(q),c[1]+holeRadius*Math.sin(q)] as Vec2;});});
}

function rotate(p: Vec3, angles: Vec3): Vec3 {
  let [x,y,z]=p; const [a,b,c]=angles.map(v=>v*Math.PI/180);
  [y,z]=[y*Math.cos(a)-z*Math.sin(a),y*Math.sin(a)+z*Math.cos(a)];
  [x,z]=[x*Math.cos(b)+z*Math.sin(b),-x*Math.sin(b)+z*Math.cos(b)];
  return [x*Math.cos(c)-y*Math.sin(c),x*Math.sin(c)+y*Math.cos(c),z];
}
const ROTATION_MATH_POLICY=Object.freeze({axisAlignmentTolerance:1e-12,gimbalCosineTolerance:1e-10});
function rotateVectorAroundAxis(v:Vec3,axis0:Vec3,angleDeg:number):Vec3{const axis=V.unit(axis0),a=angleDeg*Math.PI/180,c=Math.cos(a),si=Math.sin(a);return V.add(V.add(V.mul(v,c),V.mul(V.cross(axis,v),si)),V.mul(axis,V.dot(axis,v)*(1-c)));}
function signedAxisAngleDeg(from0:Vec3,to0:Vec3,axis0:Vec3):number{const from=V.unit(from0),to=V.unit(to0),axis=V.unit(axis0);return Math.atan2(V.dot(axis,V.cross(from,to)),clamp(V.dot(from,to),-1,1))*180/Math.PI;}
// Left-compose a world-space rigid rotation with the stored Rz * Ry * Rx
// orientation. Extract an equivalent Euler frame, including both gimbal poles.
function rotateTransformAroundAxis(t:Transform,pivot:Vec3,axis0:Vec3,angleDeg:number):Transform {
  const axis=V.unit(axis0),position=V.add(pivot,rotateVectorAroundAxis(V.sub(t.position,pivot),axis,angleDeg));
  if(angleDeg===0)return {position:[...t.position],rotation:[...t.rotation]};
  if(Math.abs(axis[0])<ROTATION_MATH_POLICY.axisAlignmentTolerance&&Math.abs(axis[1])<ROTATION_MATH_POLICY.axisAlignmentTolerance)return {position,rotation:[t.rotation[0],t.rotation[1],t.rotation[2]+angleDeg*axis[2]]};
  const ex=rotateVectorAroundAxis(rotate([1,0,0],t.rotation),axis,angleDeg),ey=rotateVectorAroundAxis(rotate([0,1,0],t.rotation),axis,angleDeg),ez=rotateVectorAroundAxis(rotate([0,0,1],t.rotation),axis,angleDeg),cb=Math.hypot(ex[0],ex[1]);
  const b=Math.atan2(-ex[2],cb),a=cb>ROTATION_MATH_POLICY.gimbalCosineTolerance?Math.atan2(ey[2],ez[2]):0,c=cb>ROTATION_MATH_POLICY.gimbalCosineTolerance?Math.atan2(ex[1],ex[0]):Math.atan2(-ey[0],ey[1]),degrees=180/Math.PI;
  return {position,rotation:[a*degrees,b*degrees,c*degrees]};
}
function inverseRotate(p:Vec3, angles:Vec3):Vec3 { const ex=rotate([1,0,0],angles),ey=rotate([0,1,0],angles),ez=rotate([0,0,1],angles); return [V.dot(p,ex),V.dot(p,ey),V.dot(p,ez)]; }
function transformPoint(p:Vec3,t:Transform):Vec3 { return V.add(rotate(p,t.rotation),t.position); }
function inverseTransformPoint(p:Vec3,t:Transform):Vec3 { return inverseRotate(V.sub(p,t.position),t.rotation); }
function transformDir(p:Vec3,t:Transform):Vec3 { return rotate(p,t.rotation); }
function planeFromPoints(points:Vec3[]):Plane {
  if(points.length<3)throw Error('A face requires at least three points.');
  // The signed area vector owns polygon orientation. A concave first corner
  // can point the first non-collinear triple backwards; a tiny triple can also
  // amplify roundoff. Sum the complete boundary around a translated origin so
  // cyclic starting position and large world coordinates do not change it.
  const origin=points[0];let areaVector:Vec3=[0,0,0];
  for(let i=0;i<points.length;i++)areaVector=V.add(areaVector,V.cross(V.sub(points[i],origin),V.sub(points[(i+1)%points.length],origin)));
  const normal=V.unit(areaVector);return {normal,offset:V.dot(normal,origin)};
}
function planeBasis(plane:Plane, origin?:Vec3):PlaneBasis { const n=V.unit(plane.normal); const ref:Vec3=Math.abs(n[2])<.9?[0,0,1]:[1,0,0]; const u=V.unit(V.cross(ref,n)); const v=V.cross(n,u); return {origin:origin||V.mul(n,plane.offset),u,v,normal:n}; }
function toPlane2(p:Vec3,b:PlaneBasis):Vec2 { const d=V.sub(p,b.origin);return [V.dot(d,b.u),V.dot(d,b.v)]; }
function fromPlane2(p:Vec2,b:PlaneBasis):Vec3 { return V.add(b.origin,V.add(V.mul(b.u,p[0]),V.mul(b.v,p[1]))); }
function solve3Rows(a:Vec3,b:Vec3,c:Vec3,d:Vec3):Vec3|null { const det=V.dot(a,V.cross(b,c)); if(Math.abs(det)<1e-12)return null; const x=V.add(V.add(V.mul(V.cross(b,c),d[0]),V.mul(V.cross(c,a),d[1])),V.mul(V.cross(a,b),d[2])); return V.mul(x,1/det); }
function pointInPolygon2(p:Vec2, poly:Vec2[]):boolean { let inside=false; for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j]; const hit=((a[1]>p[1])!==(b[1]>p[1])) && p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1]+1e-30)+a[0]; if(hit)inside=!inside;} return inside; }
function pointOnSegment2(p:Vec2,a:Vec2,b:Vec2,eps:number=TOL.snapGeometry):boolean { const ab:[number,number]=[b[0]-a[0],b[1]-a[1]], ap:[number,number]=[p[0]-a[0],p[1]-a[1]]; const cross=Math.abs(ab[0]*ap[1]-ab[1]*ap[0]); const len=Math.hypot(ab[0],ab[1]); if(cross>eps*Math.max(1,len))return false; const dot=ap[0]*ab[0]+ap[1]*ab[1]; return dot>=-eps && dot<=ab[0]*ab[0]+ab[1]*ab[1]+eps; }
function normalizeLoop2(input:Vec2[]):Vec2[]{ let p=input.map(q=>[clean(q[0]),clean(q[1])] as Vec2); if(p.length>2&&v2.dist(p[0],p[p.length-1])<TOL.minimumEdge)p.pop(); for(let i=p.length-1;i>=0;i--){if(v2.dist(p[i],p[(i+1)%p.length])<TOL.minimumEdge)p.splice(i,1);} let again=true;while(again&&p.length>3){again=false;for(let i=0;i<p.length;i++){if(Math.abs(v2.cross(p[(i+p.length-1)%p.length],p[i],p[(i+1)%p.length]))<1e-10){p.splice(i,1);again=true;break;}}} if(p.length<3||Math.abs(v2.area(p))<TOL.minimumFaceArea)throw Error('The outline area is too small.'); return p; }
function triangulateSimple2(input:Vec2[],minimumEarCross=1e-10):[number,number,number][]{
  const p=input.map(q=>[q[0],q[1]] as Vec2);
  if(p.length>2&&v2.dist(p[0],p[p.length-1])<TOL.minimumEdge)p.pop();
  if(p.length<3||Math.abs(v2.area(p))<TOL.minimumFaceArea)throw Error('Could not triangulate the face.');
  const ccw=v2.area(p)>0; const idx=p.map((_,i)=>i); if(!ccw)idx.reverse(); const out:[number,number,number][]=[];
  const inside=(q:Vec2,a:Vec2,b:Vec2,c:Vec2)=>v2.cross(a,b,q)>=-1e-10&&v2.cross(b,c,q)>=-1e-10&&v2.cross(c,a,q)>=-1e-10;
  let guard=0; while(idx.length>3&&guard++<10000){let found=false;for(let j=0;j<idx.length;j++){const ia=idx[(j+idx.length-1)%idx.length],ib=idx[j],ic=idx[(j+1)%idx.length];if(v2.cross(p[ia],p[ib],p[ic])<=minimumEarCross)continue;if(idx.some(i=>i!==ia&&i!==ib&&i!==ic&&inside(p[i],p[ia],p[ib],p[ic])))continue;out.push([ia,ib,ic]);idx.splice(j,1);found=true;break;}if(!found){
      // Remove a collinear vertex without changing the surviving input indices.
      let removed=false;for(let j=0;j<idx.length;j++){const ia=idx[(j+idx.length-1)%idx.length],ib=idx[j],ic=idx[(j+1)%idx.length];if(Math.abs(v2.cross(p[ia],p[ib],p[ic]))<=minimumEarCross){idx.splice(j,1);removed=true;break;}}if(!removed)throw Error('Could not triangulate the face.');
    }}
  if(idx.length===3&&Math.abs(v2.cross(p[idx[0]],p[idx[1]],p[idx[2]]))>minimumEarCross)out.push([idx[0],idx[1],idx[2]]); return out;
}

interface TriangulationNode2 { index:number; point:Vec2; prev:TriangulationNode2; next:TriangulationNode2; active?:boolean; }
// This is only a conservative search accelerator. Exact ear predicates and
// clipping order remain authoritative; uncertain arithmetic stays linear.
const TRIANGULATION_QUERY_POLICY=Object.freeze({minimumIndexedNodes:128,leafNodes:16,minimumCoordinateMagnitude:1,barycentricBoundsFactor:3,triangleTolerance:1e-12,orientationRoundoffFactor:64,coordinateRoundoffFactor:64,maximumCoordinateMagnitude:Math.sqrt(Number.MAX_VALUE)/4});
interface TriangulationPointTree {minX:number;minY:number;maxX:number;maxY:number;nodes?:TriangulationNode2[];left?:TriangulationPointTree;right?:TriangulationPointTree;}
function createTriangulationPointQuery(nodes:TriangulationNode2[]):((a:Vec2,b:Vec2,c:Vec2)=>TriangulationNode2[]|null)|null {
  if(nodes.length<TRIANGULATION_QUERY_POLICY.minimumIndexedNodes)return null;
  let magnitude:number=TRIANGULATION_QUERY_POLICY.minimumCoordinateMagnitude;for(const node of nodes){if(!node.point.every(Number.isFinite))return null;magnitude=Math.max(magnitude,Math.abs(node.point[0]),Math.abs(node.point[1]));}
  if(magnitude>TRIANGULATION_QUERY_POLICY.maximumCoordinateMagnitude)return null;
  const orientationError=TRIANGULATION_QUERY_POLICY.orientationRoundoffFactor*Number.EPSILON*magnitude*magnitude,coordinateError=TRIANGULATION_QUERY_POLICY.coordinateRoundoffFactor*Number.EPSILON*magnitude;
  if(!Number.isFinite(orientationError))return null;
  const build=(items:TriangulationNode2[]):TriangulationPointTree=>{
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const n of items){minX=Math.min(minX,n.point[0]);minY=Math.min(minY,n.point[1]);maxX=Math.max(maxX,n.point[0]);maxY=Math.max(maxY,n.point[1]);}
    if(items.length<=TRIANGULATION_QUERY_POLICY.leafNodes)return {minX,minY,maxX,maxY,nodes:items};
    const axis=maxX-minX>=maxY-minY?0:1;items.sort((a,b)=>a.point[axis]-b.point[axis]);const mid=Math.floor(items.length/2);
    return {minX,minY,maxX,maxY,left:build(items.slice(0,mid)),right:build(items.slice(mid))};
  };
  const root=build([...nodes]);
  return (a,b,c)=>{
    const area=v2.cross(a,b,c);if(!Number.isFinite(area)||area<=orientationError)return null;
    // Accepted fuzzy half-plane tests imply barycentric weights >= -delta.
    // Their rectangle is inside the vertex bounds expanded by 2*delta*span.
    // Use a larger search margin, including a global orientation-error bound.
    const delta=(TRIANGULATION_QUERY_POLICY.triangleTolerance+orientationError)/(area-orientationError),loX=Math.min(a[0],b[0],c[0]),loY=Math.min(a[1],b[1],c[1]),hiX=Math.max(a[0],b[0],c[0]),hiY=Math.max(a[1],b[1],c[1]),padX=TRIANGULATION_QUERY_POLICY.barycentricBoundsFactor*delta*(hiX-loX)+coordinateError,padY=TRIANGULATION_QUERY_POLICY.barycentricBoundsFactor*delta*(hiY-loY)+coordinateError;
    const minX=loX-padX,minY=loY-padY,maxX=hiX+padX,maxY=hiY+padY;if(![minX,minY,maxX,maxY].every(Number.isFinite))return null;
    const out:TriangulationNode2[]=[],stack=[root];while(stack.length){const node=stack.pop()!;if(node.maxX<minX||node.minX>maxX||node.maxY<minY||node.minY>maxY)continue;if(node.nodes){for(const n of node.nodes)if(n.active&&n.point[0]>=minX&&n.point[0]<=maxX&&n.point[1]>=minY&&n.point[1]<=maxY)out.push(n);}else{if(node.left)stack.push(node.left);if(node.right)stack.push(node.right);}}
    return out;
  };
}
function triangulatePlanarMaterial2(outerInput:Vec2[],holeInputs:Vec2[][],minimumEarCross:number):{points:Vec2[];triangles:[number,number,number][]}{
  // Between consecutive vertex X coordinates, boundary segments cannot cross
  // or change order. Sweep those slabs into exact material trapezoids instead
  // of joining multiple holes with interacting, weakly-simple bridges.
  // This preserves the face domain; render/export may split shared slab edges
  // at derived T-junctions through the existing mesh conformance boundary.
  const rings=[normalizeLoop2(outerInput),...holeInputs.map(normalizeLoop2)],xs=[...new Set(rings.flat().map(p=>p[0]))].sort((a,b)=>a-b);
  const edges:{a:Vec2;b:Vec2;minimumX:number;maximumX:number;ring:number}[]=[];
  for(const [ringIndex,ring] of rings.entries())for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length];if(a[0]===b[0])continue;
    edges.push({a,b,minimumX:Math.min(a[0],b[0]),maximumX:Math.max(a[0],b[0]),ring:ringIndex});
  }
  const at=(edge:typeof edges[number],x:number):number=>x===edge.a[0]?edge.a[1]:x===edge.b[0]?edge.b[1]:edge.a[1]+(x-edge.a[0])*(edge.b[1]-edge.a[1])/(edge.b[0]-edge.a[0]);
  const points:Vec2[]=[],triangles:[number,number,number][]=[];
  const triangle=(a:Vec2,b:Vec2,c:Vec2):void=>{if(v2.cross(a,b,c)<=minimumEarCross)return;const offset=points.length;points.push(a,b,c);triangles.push([offset,offset+1,offset+2]);};
  for(let i=0;i<xs.length-1;i++){
    const left=xs[i],right=xs[i+1],middle=left+(right-left)*.5;
    if(middle<=left||middle>=right)throw Error('Face boundary exceeds planar triangulation precision.');
    const crossings=edges.filter(edge=>edge.minimumX<middle&&edge.maximumX>middle).sort((a,b)=>at(a,middle)-at(b,middle));
    let insideOuter=false;const insideHoles=new Set<number>();
    for(let j=0;j<crossings.length;j++){
      const lower=crossings[j];if(lower.ring===0)insideOuter=!insideOuter;else if(insideHoles.has(lower.ring))insideHoles.delete(lower.ring);else insideHoles.add(lower.ring);
      if(!insideOuter||insideHoles.size||j+1===crossings.length)continue;
      const upper=crossings[j+1],a:Vec2=[left,at(lower,left)],b:Vec2=[right,at(lower,right)],c:Vec2=[right,at(upper,right)],d:Vec2=[left,at(upper,left)];
      triangle(a,b,c);triangle(a,c,d);
    }
    if(insideOuter||insideHoles.size)throw Error('Face boundary is not closed during planar triangulation.');
  }
  return {points,triangles};
}
function triangulateBridgedPolygonWithHoles2(outerInput:Vec2[],holeInputs:Vec2[][],minimumEarCross:number):{points:Vec2[];triangles:[number,number,number][]}{
  const points:Vec2[]=[],makeRing=(input:Vec2[],ccw:boolean):TriangulationNode2|null=>{
    let loop=normalizeLoop2(input);const isCcw=v2.area(loop)>0;if(isCcw!==ccw)loop=[...loop].reverse();
    let last:TriangulationNode2|null=null;
    for(const q of loop){const node={} as TriangulationNode2;node.index=points.length;node.point=[q[0],q[1]];points.push(node.point);if(!last){node.prev=node;node.next=node;last=node;}else{node.prev=last;node.next=last.next;last.next.prev=node;last.next=node;last=node;}}
    return last?.next||null;
  };
  const outer=makeRing(outerInput,true);if(!outer)return {points,triangles:[]};
  const holes:TriangulationNode2[]=[];for(const h of holeInputs){const ring=makeRing(h,false);if(ring)holes.push(ring);}
  const insertAfter=(at:TriangulationNode2,node:TriangulationNode2)=>{node.prev=at;node.next=at.next;at.next.prev=node;at.next=node;};
  const duplicate=(src:TriangulationNode2)=>{const n={} as TriangulationNode2;n.index=src.index;n.point=src.point;n.prev=n;n.next=n;return n;};
  const rightmost=(start:TriangulationNode2)=>{let r=start,p=start.next;while(p!==start){if(p.point[0]>r.point[0]+1e-12||(Math.abs(p.point[0]-r.point[0])<=1e-12&&p.point[1]<r.point[1]))r=p;p=p.next;}return r;};
  const bridgeHole=(holeStart:TriangulationNode2)=>{
    const h=rightmost(holeStart),hy=h.point[1],hx=h.point[0];let bestX=Infinity,bestEdge:TriangulationNode2|null=null,p=outer;
    do{const a=p.point,b=p.next.point;if((a[1]>hy)!==(b[1]>hy)){const x=a[0]+(hy-a[1])*(b[0]-a[0])/(b[1]-a[1]);if(x>=hx-1e-12&&x<bestX){bestX=x;bestEdge=p;}}p=p.next;}while(p!==outer);
    if(!bestEdge)throw Error('Could not connect a face hole to its outer boundary.');
    const a=bestEdge.point,b=bestEdge.next.point;let bridge:TriangulationNode2;
    if(v2.dist([bestX,hy],a)<=TOL.minimumEdge)bridge=bestEdge;
    else if(v2.dist([bestX,hy],b)<=TOL.minimumEdge)bridge=bestEdge.next;
    else{bridge={} as TriangulationNode2;bridge.index=points.length;bridge.point=[bestX,hy];points.push(bridge.point);insertAfter(bestEdge,bridge);}
    const bridgeCopy=duplicate(bridge),holeCopy=duplicate(h),afterBridge=bridge.next,holePrev=h.prev;
    bridge.next=h;h.prev=bridge;holePrev.next=holeCopy;holeCopy.prev=holePrev;holeCopy.next=bridgeCopy;bridgeCopy.prev=holeCopy;bridgeCopy.next=afterBridge;afterBridge.prev=bridgeCopy;
  };
  holes.sort((a,b)=>rightmost(b).point[0]-rightmost(a).point[0]);for(const h of holes)bridgeHole(h);
  const same=(a:Vec2,b:Vec2)=>v2.dist(a,b)<=TOL.minimumEdge;
  const remove=(n:TriangulationNode2)=>{n.active=false;n.next.prev=n.prev;n.prev.next=n.next;};
  const filter=(start:TriangulationNode2):TriangulationNode2=>{let p=start,again=true;while(again){again=false;p=start;do{if(p.next!==p&&same(p.point,p.next.point)){if(p===start)start=p.next;remove(p);again=true;break;}p=p.next;}while(p!==start);}return start;};
  let start=filter(outer),count=0,p=start;const activeNodes:TriangulationNode2[]=[];do{p.active=true;activeNodes.push(p);count++;p=p.next;}while(p!==start);
  const pointQuery=createTriangulationPointQuery(activeNodes);
  const triangles:[number,number,number][]=[];
  const pointInTriangle=(q:Vec2,a:Vec2,b:Vec2,c:Vec2)=>{const ab=v2.cross(a,b,q),bc=v2.cross(b,c,q),ca=v2.cross(c,a,q);return ab>=-TRIANGULATION_QUERY_POLICY.triangleTolerance&&bc>=-TRIANGULATION_QUERY_POLICY.triangleTolerance&&ca>=-TRIANGULATION_QUERY_POLICY.triangleTolerance;};
  const isEar=(n:TriangulationNode2)=>{
    const a=n.prev.point,b=n.point,c=n.next.point;if(v2.cross(a,b,c)<=minimumEarCross)return false;
    const rejects=(q:TriangulationNode2)=>q!==n&&q!==n.prev&&q!==n.next&&!same(q.point,a)&&!same(q.point,b)&&!same(q.point,c)&&pointInTriangle(q.point,a,b,c)&&v2.cross(q.prev.point,q.point,q.next.point)<=1e-12;
    const candidates=pointQuery?.(a,b,c);if(candidates){for(const q of candidates)if(rejects(q))return false;return true;}
    let q=n.next.next;while(q!==n.prev){if(rejects(q))return false;q=q.next;}return true;
  };
  let ear=start,guard=0,stalls=0;
  while(count>3&&guard++<count*count*8+10000){if(isEar(ear)){triangles.push([ear.prev.index,ear.index,ear.next.index]);const next=ear.next;remove(ear);ear=next;count--;stalls=0;continue;}ear=ear.next;stalls++;if(stalls>count){
      // Weakly-simple hole bridges duplicate their endpoints. If clipping stalls,
      // remove only a geometrically redundant collinear node; never alter the face boundary.
      let removed=false,q=ear;do{if(Math.abs(v2.cross(q.prev.point,q.point,q.next.point))<=minimumEarCross&&pointOnSegment2(q.point,q.prev.point,q.next.point,TOL.minimumEdge)){const next=q.next;remove(q);ear=next;count--;removed=true;break;}q=q.next;}while(q!==ear);if(!removed)throw Error('Could not triangulate the face with holes.');stalls=0;
    }}
  if(count!==3)throw Error('Could not triangulate the face with holes.');if(Math.abs(v2.cross(ear.point,ear.next.point,ear.next.next.point))>minimumEarCross)triangles.push([ear.index,ear.next.index,ear.next.next.index]);
  return {points,triangles};
}
function triangulatePolygonWithHoles2(outerInput:Vec2[],holeInputs:Vec2[][],minimumEarCross=1e-12):{points:Vec2[];triangles:[number,number,number][]}{
  try{return triangulateBridgedPolygonWithHoles2(outerInput,holeInputs,minimumEarCross);}
  catch(error){
    if(!holeInputs.length||!errorMessage(error).startsWith('Could not triangulate the face'))throw error;
    // One adapter owns the existing weak-boundary rejection. Use an exact
    // domain sweep instead of the former independently simplified subtraction
    // fragments, while retaining compact constrained triangulation when valid.
    return triangulatePlanarMaterial2(outerInput,holeInputs,minimumEarCross);
  }
}
function segmentIntersection2(a:Vec2,b:Vec2,c:Vec2,d:Vec2):boolean { const c1=v2.cross(a,b,c),c2=v2.cross(a,b,d),c3=v2.cross(c,d,a),c4=v2.cross(c,d,b);return c1*c2<-1e-12&&c3*c4<-1e-12; }
function polygonSelfIntersects(poly:Vec2[]):boolean { for(let i=0;i<poly.length;i++)for(let j=i+1;j<poly.length;j++){if(j===i+1||(i===0&&j===poly.length-1))continue;if(segmentIntersection2(poly[i],poly[(i+1)%poly.length],poly[j],poly[(j+1)%poly.length]))return true;}return false; }
function polygonIsConvex2(poly:Vec2[]):boolean { if(poly.length<4)return true;let sign=0;for(let i=0;i<poly.length;i++){const c=v2.cross(poly[i],poly[(i+1)%poly.length],poly[(i+2)%poly.length]);if(Math.abs(c)<=1e-10)continue;const s=Math.sign(c);if(!sign)sign=s;else if(s!==sign)return false;}return true; }
function signedVolumeTriangles(vertices:Vec3[],triangles:[number,number,number][]):number { let v=0;for(const [i,j,k] of triangles)v+=V.dot(vertices[i],V.cross(vertices[j],vertices[k]))/6;return v; }
