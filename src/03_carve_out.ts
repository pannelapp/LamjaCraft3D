// Carve Out / Hollow: convex shelling, concave-prism erosion and certified
// incidence-preserving concave 3D face offsets. The selected planar face is the opening.
// The outer B-rep is left untouched; only the subtractive cavity is generated.
// Unsupported topology changes remain explicit instead of producing ambiguous
// or non-manifold geometry.

interface CarvePlaneConstraint { normal:Vec3; offset:number; sourceFaceId?:FaceId; sourceFaceIds?:FaceId[]; opening:boolean; detailSize:number; extraInset:number; }

const CARVE_OUT_POLICY=Object.freeze({
  maxUniquePlanes:1000,
  complexityWarningPlanes:500,
  maxClipPolygons:1200,
  convexToleranceScale:2e-7,
  minimumWall:0.05,
  maximumWall:10000,
  minimumDetailFloor:0.01,
  maximumDetail:100,
});

function carveOutUnsupported(message:string):never{
  throw Error(`Carve Out requires one simple planar opening and a valid inward shell. Convex solids, straight-extruded concave prisms and certified concave 3D face offsets are supported. ${message}`);
}
function carveBounds(s:Solid):Bounds3{
  const pts=[...s.vertices.values()].map(v=>v.position),min:Vec3=[Infinity,Infinity,Infinity],max:Vec3=[-Infinity,-Infinity,-Infinity];
  for(const p of pts)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}
  return {min,max};
}
function carveSpan(s:Solid):number{const b=carveBounds(s);return Math.max(...V.sub(b.max,b.min),TOL.minimumEdge);}
function carvePlaneSame(a:Plane,b:Plane,normalTol:number,offsetTol:number):boolean{return V.dot(a.normal,b.normal)>=1-normalTol&&Math.abs(a.offset-b.offset)<=offsetTol;}
function carveFaceMinimumEdge(s:Solid,faceId:FaceId):number{
  const face=s.faces.get(faceId);if(!face)return Infinity;
  const loops=[face.outerLoop,...face.innerLoops];let minimum=Infinity;
  for(const loopId of loops){const points=loopPoints(s,loopId);for(let i=0;i<points.length;i++)minimum=Math.min(minimum,V.len(V.sub(points[(i+1)%points.length],points[i])));}
  return minimum;
}
function carveUniqueFacePlanes(s:Solid,openingFaceId:FaceId,minimumInnerDetail:number):CarvePlaneConstraint[]{
  const span=carveSpan(s),normalTol=Math.max(TOL.coplanarAngle*16,Math.pow(Math.min(.002,minimumInnerDetail/Math.max(span,1)*.02),2)/2),offsetTol=Math.max(TOL.coplanarDistance*8,Math.min(minimumInnerDetail*.002,TOL.snapGeometry));
  const opening=s.faces.get(openingFaceId);if(!opening)throw Error('The selected opening face no longer exists.');
  const sameOpening=[...s.faces.values()].filter(f=>carvePlaneSame(f.plane,opening.plane,normalTol,offsetTol));
  if(sameOpening.length!==1)carveOutUnsupported('The opening face is split into coplanar regions. Dissolve sketch boundaries first, then select the whole opening face.');
  const out:CarvePlaneConstraint[]=[];
  for(const f of s.faces.values()){
    const detailSize=carveFaceMinimumEdge(s,f.id),extraInset=Math.max(0,minimumInnerDetail-detailSize);
    let existing=out.find(p=>V.dot(p.normal,f.plane.normal)>=1-normalTol&&Math.abs(p.offset-f.plane.offset)<=offsetTol);
    if(existing){existing.sourceFaceIds!.push(f.id);existing.opening ||= f.id===openingFaceId;existing.detailSize=Math.min(existing.detailSize,detailSize);existing.extraInset=Math.max(existing.extraInset,extraInset);continue;}
    out.push({normal:[...f.plane.normal] as Vec3,offset:f.plane.offset,sourceFaceId:f.id,sourceFaceIds:[f.id],opening:f.id===openingFaceId,detailSize,extraInset});
  }
  return out;
}
function carveCheckConvex(s:Solid,planes:CarvePlaneConstraint[],span:number):boolean{
  const tolerance=Math.max(TOL.csg*64,TOL.plane*8,span*CARVE_OUT_POLICY.convexToleranceScale);
  for(const p of planes)for(const v of s.vertices.values())if(V.dot(p.normal,v.position)-p.offset>tolerance)return false;return true;
}
function carveProtectRepeatedFacetChains(planes:CarvePlaneConstraint[]){
  // A small chord repeated many times usually represents a deliberately faceted curved macro-surface
  // (for example a high-segment cylinder), not a tiny isolated detail. Preserve those constraints so
  // Minimum inner detail never changes the requested wall thickness around a smooth facet chain.
  const candidates=planes.filter(p=>!p.opening&&p.extraInset>TOL.minimumEdge&&Number.isFinite(p.detailSize)&&p.detailSize>TOL.minimumEdge);
  for(const p of candidates){const repeated=candidates.filter(q=>Math.abs(q.detailSize-p.detailSize)<=Math.max(TOL.minimumEdge,p.detailSize*.08)).length;if(repeated>=12)p.extraInset=0;}
}

interface CarveConcavePrismInfo { basis:PlaneBasis; profile:Vec2[]; depth:number; bottomOffset:number; }
function carveConcavePrismInfo(s:Solid,openingFaceId:FaceId,span:number):CarveConcavePrismInfo|null{
  const opening=s.faces.get(openingFaceId);if(!opening||opening.innerLoops.length)return null;
  const outer=loopPoints(s,opening.outerLoop);if(outer.length<4)return null;const basis=planeBasis(opening.plane,outer[0]);let profile=normalizeLoop2(outer.map(p=>toPlane2(p,basis)));if(v2.area(profile)<0)profile.reverse();
  // Convex profiles stay on the existing half-space path; this fallback is only for
  // a genuinely concave straight extrusion.
  if(polygonIsConvex2(profile)||polygonSelfIntersects(profile))return null;
  const n=V.unit(opening.plane.normal),levelTol=Math.max(TOL.plane*32,TOL.csg*64,span*2e-7),normalTol=Math.max(TOL.coplanarAngle*32,2e-8),projections=[...s.vertices.values()].map(v=>V.dot(n,v.position)),top=opening.plane.offset,bottom=Math.min(...projections),depth=top-bottom;
  if(!(depth>TOL.minimumEdge*8))return null;
  for(const q of projections)if(Math.abs(q-top)>levelTol&&Math.abs(q-bottom)>levelTol)return null;
  let bottomFaces=0;
  for(const f of s.faces.values()){
    if(f.id===openingFaceId)continue;const pts=loopPoints(s,f.outerLoop),dot=V.dot(V.unit(f.plane.normal),n),allTop=pts.every(p=>Math.abs(V.dot(n,p)-top)<=levelTol),allBottom=pts.every(p=>Math.abs(V.dot(n,p)-bottom)<=levelTol);
    if(Math.abs(dot)>=1-normalTol){if(allTop)return null;if(!allBottom)return null;bottomFaces++;continue;}
    if(Math.abs(dot)>normalTol)return null;
    if(!pts.every(p=>Math.abs(V.dot(n,p)-top)<=levelTol||Math.abs(V.dot(n,p)-bottom)<=levelTol))return null;
  }
  if(!bottomFaces)return null;
  return {basis,profile,depth,bottomOffset:bottom};
}
// A wall is the union of finite inward edge strips and reflex miter joins.
// Trace its complement inside the opening. Clipping boundary segments against
// that union handles consumed edges and nonlocal contacts with the same rule;
// it also preserves every remaining pocket instead of selecting the largest.
const CARVE_INSET_POLICY=Object.freeze({parallelDeterminant:1e-12,boundaryTolerance:TOL.plane,clearanceTolerance:TOL.topologyKey,endpointTolerance:TOL.topologyKey});
interface CarveInsetBand2 {planes:{nx:number;ny:number;c:number}[];min:Vec2;max:Vec2;}
interface CarveInsetSegment2 {a:Vec2;b:Vec2;}
function carveInsetPointSegmentDistance2(p:Vec2,a:Vec2,b:Vec2):number{
  const dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy,t=length2?clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length2,0,1):0;
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
}
function carveInsetBand2(points:Vec2[]):CarveInsetBand2{
  if(v2.area(points)<0)points.reverse();
  const planes=points.map((a,i)=>{const b=points[(i+1)%points.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]),nx=(a[1]-b[1])/length,ny=(b[0]-a[0])/length;return {nx,ny,c:nx*a[0]+ny*a[1]};});
  return {planes,min:[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))],max:[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]};
}
function carveInsetBandInterval2(a:Vec2,b:Vec2,band:CarveInsetBand2):[number,number]|null{
  // Classify coincident boundaries by their cavity-side orientation. Keep
  // exact intersections; tolerances classify coincidence, never shift a wall.
  const eps=CARVE_INSET_POLICY.boundaryTolerance;
  if(Math.max(a[0],b[0])<band.min[0]-eps||Math.min(a[0],b[0])>band.max[0]+eps||Math.max(a[1],b[1])<band.min[1]-eps||Math.min(a[1],b[1])>band.max[1]+eps)return null;
  let lo=0,hi=1;
  for(const p of band.planes){
    const da=p.nx*a[0]+p.ny*a[1]-p.c,db=p.nx*b[0]+p.ny*b[1]-p.c,delta=db-da;
    if(Math.abs(da)<=eps&&Math.abs(db)<=eps){
      // Keep a coincident boundary only when the band lies on its right.
      // A band on the cavity's left consumes this interval even when another
      // strip happens to meet it along a shared, non-interior seam.
      if(-p.nx*(b[1]-a[1])+p.ny*(b[0]-a[0])<=0)return null;continue;
    }
    if(da<=0&&db<=0)return null;
    if(da>=0&&db>=0)continue;
    const t=-da/delta;if(delta>0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(hi<=lo)return null;
  }
  return hi>lo?[lo,hi]:null;
}
function carveInsetSourceSegments2(a:Vec2,b:Vec2,poly:Vec2[]):CarveInsetSegment2[]{
  const dx=b[0]-a[0],dy=b[1]-a[1],cuts=[0,1];
  for(let i=0;i<poly.length;i++){
    const c=poly[i],d=poly[(i+1)%poly.length],ex=d[0]-c[0],ey=d[1]-c[1],det=dx*ey-dy*ex;
    if(Math.abs(det)<=CARVE_INSET_POLICY.parallelDeterminant)continue;
    const qx=c[0]-a[0],qy=c[1]-a[1],t=(qx*ey-qy*ex)/det,u=(qx*dy-qy*dx)/det;if(t>0&&t<1&&u>=0&&u<=1)cuts.push(t);
  }
  cuts.sort((x,y)=>x-y);const at=(t:number):Vec2=>[a[0]+dx*t,a[1]+dy*t],segments:CarveInsetSegment2[]=[];
  for(let i=1;i<cuts.length;i++){const lo=cuts[i-1],hi=cuts[i];if((hi-lo)*Math.hypot(dx,dy)<=TOL.minimumEdge)continue;const mid=at((lo+hi)/2);if(pointInPolygon2(mid,poly)&&!poly.some((p,j)=>pointOnSegment2(mid,p,poly[(j+1)%poly.length],CARVE_INSET_POLICY.boundaryTolerance)))segments.push({a:at(lo),b:at(hi)});}
  return segments;
}
function carveInsetTrace2(segments:CarveInsetSegment2[]):Vec2[][]|null{
  const eps=CARVE_INSET_POLICY.endpointTolerance,points:Vec2[]=[],buckets=new Map<string,number[]>(),edges=new Map<string,{a:number;b:number}>();
  const vertex=(p:Vec2):number=>{
    const x=Math.floor(p[0]/eps),y=Math.floor(p[1]/eps);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const i of buckets.get(`${x+dx},${y+dy}`)||[])if(Math.hypot(points[i][0]-p[0],points[i][1]-p[1])<=eps)return i;
    const i=points.length,key=`${x},${y}`;points.push(p);const bucket=buckets.get(key)||[];bucket.push(i);buckets.set(key,bucket);return i;
  };
  const indexed=segments.map(segment=>({a:vertex(segment.a),b:vertex(segment.b)}));
  // Coincident band boundaries may overlap only partially. Split at all real
  // endpoint incidences before deduplication; opposite segments cancel where
  // no cavity width survives. Never manufacture a closing edge at a T-junction.
  for(const segment of indexed){
    const a=points[segment.a],b=points[segment.b],dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy;if(length2<=eps*eps)continue;
    const cuts=[{t:0,i:segment.a},{t:1,i:segment.b}];
    for(let i=0;i<points.length;i++){
      const p=points[i];if(p[0]<Math.min(a[0],b[0])-eps||p[0]>Math.max(a[0],b[0])+eps||p[1]<Math.min(a[1],b[1])-eps||p[1]>Math.max(a[1],b[1])+eps)continue;
      const t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length2;if(t>0&&t<1&&Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dy*t)<=eps)cuts.push({t,i});
    }
    cuts.sort((a,b)=>a.t-b.t);for(let i=1;i<cuts.length;i++){const a=cuts[i-1].i,b=cuts[i].i;if(a!==b)edges.set(`${a},${b}`,{a,b});}
  }
  for(const [key,e] of edges)if(edges.has(`${e.b},${e.a}`)){edges.delete(key);edges.delete(`${e.b},${e.a}`);}
  const next=new Map<number,number>(),incoming=new Set<number>();
  for(const e of edges.values()){
    // A touching/branched boundary is a degenerate candidate, not permission
    // to invent a closing edge or silently discard one of its components.
    if(next.has(e.a)||incoming.has(e.b))return null;next.set(e.a,e.b);incoming.add(e.b);
  }
  if([...next.keys()].some(i=>!incoming.has(i)))return null;
  const used=new Set<number>(),loops:Vec2[][]=[];
  for(const start of next.keys()){
    if(used.has(start))continue;const loop:Vec2[]=[];let i=start;
    while(!used.has(i)){used.add(i);loop.push(points[i]);const j=next.get(i);if(j===undefined)return null;i=j;}
    if(i!==start||loop.length<3)return null;
    // Adjacent strip/join candidates often share one supporting line. Remove
    // only roundoff-collinear points before coordinate normalization so their
    // incidental subdivisions cannot become tiny cavity faces.
    let simplified=true;while(simplified&&loop.length>3){simplified=false;for(let k=0;k<loop.length;k++){
      const a=loop[(k+loop.length-1)%loop.length],b=loop[k],c=loop[(k+1)%loop.length],ux=b[0]-a[0],uy=b[1]-a[1],vx=c[0]-b[0],vy=c[1]-b[1];
      if(ux*vx+uy*vy>0&&Math.abs(ux*vy-uy*vx)<=CARVE_INSET_POLICY.parallelDeterminant*Math.hypot(ux,uy)*Math.hypot(vx,vy)){loop.splice(k,1);simplified=true;break;}
    }}
    let clean:Vec2[];try{clean=normalizeLoop2(loop);}catch{return null;}
    if(v2.area(clean)<=TOL.minimumFaceArea||polygonSelfIntersects(clean))return null;loops.push(clean);
  }
  return loops;
}
function carveInsetConcaveProfiles2(input:Vec2[],distance:number):Vec2[][]|null{
  if(!Number.isFinite(distance)||distance<=0||input.some(p=>!p.every(Number.isFinite)))return null;
  let poly:Vec2[];try{poly=normalizeLoop2(input);}catch{return null;}if(v2.area(poly)<0)poly.reverse();if(poly.length<3||polygonSelfIntersects(poly))return null;
  const bands:CarveInsetBand2[]=[],candidates:CarveInsetSegment2[]=[],normals:Vec2[]=[],offset=(p:Vec2,n:Vec2):Vec2=>[p[0]+distance*n[0],p[1]+distance*n[1]];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<=TOL.minimumEdge)return null;
    const n:Vec2=[-dy/length,dx/length],aa=offset(a,n),bb=offset(b,n);normals.push(n);bands.push(carveInsetBand2([a,b,bb,aa]));candidates.push({a:aa,b:bb});
  }
  for(let i=0;i<poly.length;i++){
    const prev=(i+poly.length-1)%poly.length,a=normals[prev],b=normals[i];if(a[0]*b[1]-a[1]*b[0]>=0)continue;
    const denominator=1+a[0]*b[0]+a[1]*b[1];if(denominator<=CARVE_INSET_POLICY.parallelDeterminant)return null;
    const p=poly[i],aa=offset(p,a),bb=offset(p,b),m:Vec2=[p[0]+distance*(a[0]+b[0])/denominator,p[1]+distance*(a[1]+b[1])/denominator];
    if(!m.every(Number.isFinite))return null;bands.push(carveInsetBand2([p,aa,m,bb]));candidates.push({a:aa,b:m},{a:m,b:bb});
  }
  const segments:CarveInsetSegment2[]=[];
  for(const {a,b} of candidates){
    const intervals:[number,number][]=[];for(const band of bands){const interval=carveInsetBandInterval2(a,b,band);if(interval)intervals.push(interval);}intervals.sort((x,y)=>x[0]-y[0]||x[1]-y[1]);
    const at=(t:number):Vec2=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];let t=0;
    for(const [lo,hi] of intervals){if(lo>t)segments.push(...carveInsetSourceSegments2(at(t),at(lo),poly));t=Math.max(t,hi);if(t>=1)break;}
    if(t<1)segments.push(...carveInsetSourceSegments2(at(t),b,poly));
  }
  const insets=carveInsetTrace2(segments);if(!insets?.length)return null;
  // Whole-segment clearance prevents a collapsed boundary from reappearing
  // across a thin feature. Keep complete validation on the eventual 3D solid.
  for(const inset of insets){
    for(let i=0;i<inset.length;i++)for(let j=0;j<poly.length;j++){
      const a=inset[i],b=inset[(i+1)%inset.length],c=poly[j],d=poly[(j+1)%poly.length];if(segmentIntersection2(a,b,c,d))return null;
      const clearance=Math.min(carveInsetPointSegmentDistance2(a,c,d),carveInsetPointSegmentDistance2(b,c,d),carveInsetPointSegmentDistance2(c,a,b),carveInsetPointSegmentDistance2(d,a,b));if(clearance+CARVE_INSET_POLICY.clearanceTolerance<distance)return null;
    }
    try{triangulateSimple2(inset);}catch{return null;}
  }
  return insets;
}
function carveConcavePrismCavity(info:CarveConcavePrismInfo,opening:Face,wall:number,detail:number,openExtension:number):CSGPolygon[]|null{
  const insets=carveInsetConcaveProfiles2(info.profile,wall);if(!insets)return null;const remainingDepth=info.depth-wall;if(remainingDepth<=Math.max(TOL.minimumEdge*4,detail*.01))return null;
  const n=V.unit(opening.plane.normal),polygons:CSGPolygon[]=[];
  for(const inset of insets){
    const top=inset.map(p=>V.add(fromPlane2(p,info.basis),V.mul(n,openExtension))),bottom=inset.map(p=>V.add(fromPlane2(p,info.basis),V.mul(n,-remainingDepth))),tris=triangulateSimple2(inset);
    for(const tri of tris){polygons.push(csgPolygon(tri.map(i=>top[i])));polygons.push(csgPolygon([...tri].reverse().map(i=>bottom[i])));}
    for(let i=0;i<inset.length;i++){const j=(i+1)%inset.length;polygons.push(csgPolygon([bottom[i],bottom[j],top[j],top[i]]));}
  }
  return polygons;
}
function carvePointKey(p:Vec3,eps:number):string{return p.map(x=>Math.round(x/eps)).join(',');}
function carveInsideAll(p:Vec3,planes:CarvePlaneConstraint[],eps:number):boolean{for(const pl of planes)if(V.dot(pl.normal,p)-pl.offset>eps)return false;return true;}
function carveOrderedFacePoints(points:Vec3[],plane:CarvePlaneConstraint,eps:number):Vec3[]{
  const unique=new Map<string,Vec3>();for(const p of points)unique.set(carvePointKey(p,eps),p);const pts=[...unique.values()];if(pts.length<3)return [];
  const center=V.mul(pts.reduce((a,p)=>V.add(a,p),[0,0,0] as Vec3),1/pts.length),basis=planeBasis({normal:plane.normal,offset:plane.offset},center);
  pts.sort((a,b)=>Math.atan2(V.dot(V.sub(a,center),basis.v),V.dot(V.sub(a,center),basis.u))-Math.atan2(V.dot(V.sub(b,center),basis.v),V.dot(V.sub(b,center),basis.u)));
  const cleanPts:Vec3[]=[];for(const p of pts)if(!cleanPts.length||V.len(V.sub(p,cleanPts[cleanPts.length-1]))>eps)cleanPts.push(p);if(cleanPts.length>2&&V.len(V.sub(cleanPts[0],cleanPts[cleanPts.length-1]))<=eps)cleanPts.pop();
  if(cleanPts.length<3)return [];
  const pl=planeFromPoints(cleanPts);if(V.dot(pl.normal,plane.normal)<0)cleanPts.reverse();return cleanPts;
}
function carveInitialClipBox(s:Solid,margin:number):CSGPolygon[]{
  const b=carveBounds(s),mn:Vec3=[b.min[0]-margin,b.min[1]-margin,b.min[2]-margin],mx:Vec3=[b.max[0]+margin,b.max[1]+margin,b.max[2]+margin];
  const p=(x:0|1,y:0|1,z:0|1):Vec3=>[x?mx[0]:mn[0],y?mx[1]:mn[1],z?mx[2]:mn[2]],c000=p(0,0,0),c001=p(0,0,1),c010=p(0,1,0),c011=p(0,1,1),c100=p(1,0,0),c101=p(1,0,1),c110=p(1,1,0),c111=p(1,1,1);
  return [
    csgPolygon([c000,c001,c011,c010]),csgPolygon([c100,c110,c111,c101]),
    csgPolygon([c000,c100,c101,c001]),csgPolygon([c010,c011,c111,c110]),
    csgPolygon([c000,c010,c110,c100]),csgPolygon([c001,c101,c111,c011]),
  ];
}
function carveClipConvexPolyhedron(polygons:CSGPolygon[],plane:CarvePlaneConstraint,eps:number,mergeEps:number):CSGPolygon[]{
  const clipped:CSGPolygon[]=[];let cut=false;
  for(const poly of polygons){
    const out:Vec3[]=[];for(let i=0;i<poly.vs.length;i++){
      const a=poly.vs[i],b=poly.vs[(i+1)%poly.vs.length],da=V.dot(plane.normal,a)-plane.offset,db=V.dot(plane.normal,b)-plane.offset,ain=da<=eps,bin=db<=eps;
      if(ain)out.push(a);
      if(ain!==bin){const den=V.dot(plane.normal,V.sub(b,a));if(Math.abs(den)>1e-14){const t=(plane.offset-V.dot(plane.normal,a))/den;out.push(V.lerp(a,b,clamp(t,0,1)));cut=true;}}
    }
    const clean=dedupePolygon3(out);if(clean.length>=3){try{const cp=csgPolygon(clean,poly);if(cp.vs.length>=3)clipped.push(cp);}catch{/* A plane can shave a polygon down below usable area. */}}
  }
  if(!clipped.length)return [];
  if(cut){
    const capPoints:Vec3[]=[];for(const poly of clipped)for(const v of poly.vs)if(Math.abs(V.dot(plane.normal,v)-plane.offset)<=eps*4)capPoints.push(v);
    const cap=carveOrderedFacePoints(capPoints,plane,mergeEps);if(cap.length>=3){const cp=csgPolygon(cap);if(V.dot(cp.plane.normal,plane.normal)<0)flipCsgPoly(cp);clipped.push(cp);}
  }
  return clipped;
}
function carveClipCavity(s:Solid,constraints:CarvePlaneConstraint[],span:number,wall:number,detail:number,openExtension:number,report:(progress:number,message:string)=>void):CSGPolygon[]{
  const insideEps=Math.max(TOL.csg*100,TOL.plane*16,span*1e-8),mergeEps=Math.max(TOL.topologyKey*4,Math.min(detail*.002,wall*.002,.001)),margin=Math.max(span*.25,openExtension+wall+detail,1);
  let polygons=carveInitialClipBox(s,margin),reportEvery=Math.max(1,Math.floor(constraints.length/64));
  for(let i=0;i<constraints.length;i++){
    polygons=carveClipConvexPolyhedron(polygons,constraints[i],insideEps,mergeEps);if(!polygons.length)throw Error('Wall thickness is too large for this geometry. Try a smaller Wall thickness.');
    if(polygons.length>CARVE_OUT_POLICY.maxClipPolygons)carveOutUnsupported(`The inner shell became too complex (${polygons.length} faces). Increase Minimum inner detail or simplify the model first.`);
    if(i%reportEvery===0||i===constraints.length-1)report(24+Math.min(26,(i+1)/Math.max(1,constraints.length)*26),constraints.length>=CARVE_OUT_POLICY.complexityWarningPlanes?`Building high-detail inner shell… ${i+1}/${constraints.length} planes`:'Building inner shell…');
  }
  return polygons;
}
function carveCavityPolygons(s:Solid,openingFaceId:FaceId,parameters:CarveOutParameters,report:(progress:number,message:string)=>void):{polygons:CSGPolygon[];stats:CarveOutStats}{
  const wall=parameters.wallThickness,detail=parameters.minimumInnerDetail;
  if(!Number.isFinite(wall)||wall<CARVE_OUT_POLICY.minimumWall||wall>CARVE_OUT_POLICY.maximumWall)throw Error(`Wall thickness must be between ${CARVE_OUT_POLICY.minimumWall} and ${CARVE_OUT_POLICY.maximumWall} mm.`);
  if(!Number.isFinite(detail)||detail<CARVE_OUT_POLICY.minimumDetailFloor||detail>CARVE_OUT_POLICY.maximumDetail)throw Error(`Minimum inner detail must be between ${CARVE_OUT_POLICY.minimumDetailFloor} and ${CARVE_OUT_POLICY.maximumDetail} mm.`);
  const opening=s.faces.get(openingFaceId);if(!opening)throw Error('The selected opening face no longer exists.');if(opening.innerLoops.length)carveOutUnsupported('The selected opening face contains holes; choose a simple face without holes.');
  const captured:{mesh:Mesh|null}={mesh:null},validity=validateSolid(s,false,mesh=>captured.mesh=mesh);if(!validity.ok)throw Error(`Carve Out requires a valid closed solid. ${validity.errors[0]||''}`.trim());
  report(8,'Analyzing solid…');const span=carveSpan(s),sourcePlanes=carveUniqueFacePlanes(s,openingFaceId,detail);
  if(sourcePlanes.length>CARVE_OUT_POLICY.maxUniquePlanes)carveOutUnsupported(`This object has ${sourcePlanes.length} unique surface planes; the current limit is ${CARVE_OUT_POLICY.maxUniquePlanes}. Increase Minimum inner detail or simplify the model first.`);
  const openExtension=Math.max(wall*2,detail,span*.02,.2),concavePrism=carveConcavePrismInfo(s,openingFaceId,span);
  if(concavePrism){
    report(20,'Offsetting concave prism profile…');const polygons=carveConcavePrismCavity(concavePrism,opening,wall,detail,openExtension);if(!polygons)throw Error('Wall thickness is too large for this concave prismatic shape. Try a smaller Wall thickness.');
    report(48,'Building concave prismatic inner shell…');const vertexKeys=new Set<string>();for(const poly of polygons)for(const v of poly.vs)vertexKeys.add(carvePointKey(v,Math.max(TOL.topologyKey*4,.00001)));
    return {polygons,stats:{sourcePlanes:sourcePlanes.length,cavityPlanes:polygons.filter(poly=>Math.abs(V.dot(poly.plane.normal,opening.plane.normal))<TOL.coplanarAngle).length+2,cavityVertices:vertexKeys.size,cavityFaces:polygons.length,simplifiedPlanes:0}};
  }
  carveProtectRepeatedFacetChains(sourcePlanes);
  if(!carveCheckConvex(s,sourcePlanes,span)){
    if(!captured.mesh)throw Error('The source mesh is unavailable after validation.');
    const candidate=carveSpatialCavity(s,openingFaceId,sourcePlanes,wall,openExtension,captured.mesh,validity.volume,report);
    if(!candidate.ok)carveOutUnsupported(candidate.message);return {polygons:candidate.polygons,stats:candidate.stats};
  }
  const constraints=sourcePlanes.map(p=>({...p,offset:p.opening?p.offset+openExtension:p.offset-wall-p.extraInset})),simplifiedPlanes=sourcePlanes.filter(p=>!p.opening&&p.extraInset>TOL.minimumEdge).length;
  report(20,'Offsetting inner wall planes…');const polygons=carveClipCavity(s,constraints,span,wall,detail,openExtension,report);
  const openingPolygon=polygons.some(poly=>V.dot(poly.plane.normal,opening.plane.normal)>1-TOL.coplanarAngle*16&&Math.abs(poly.plane.offset-(opening.plane.offset+openExtension))<=Math.max(TOL.plane*32,span*1e-7));
  if(polygons.length<4||!openingPolygon)throw Error('The requested wall thickness collapses the inner opening. Try a smaller Wall thickness.');
  const vertexKeys=new Set<string>();for(const poly of polygons)for(const v of poly.vs)vertexKeys.add(carvePointKey(v,Math.max(TOL.topologyKey*4,.00001)));
  return {polygons,stats:{sourcePlanes:sourcePlanes.length,cavityPlanes:constraints.length,cavityVertices:vertexKeys.size,cavityFaces:polygons.length,simplifiedPlanes}};
}
function carveOutSolid(s:Solid,openingFaceId:FaceId,parameters:CarveOutParameters,onProgress?:(update:ModelingProgressUpdate)=>void,onDiagnostic?:(event:ModelingDiagnosticEvent)=>void):CarveOutResult{
  const started=profilerClock(),report=(progress:number,message:string)=>onProgress?.({progress:Math.max(0,Math.min(100,progress)),message}),diagnostic:ModelingDiagnosticReporter=(category,event,data={})=>onDiagnostic?.({category,event,elapsedMs:profilerClock()-started,data});
  report(2,'Preparing Carve Out…');const cavity=carveCavityPolygons(s,openingFaceId,parameters,report);diagnostic('carve-out','cavity-built',{...cavity.stats,wallThickness:parameters.wallThickness,minimumInnerDetail:parameters.minimumInnerDetail});
  report(62,'Subtracting inner shell…');const source=solidToCsg(s),result=csgSubtractOwned(source,cavity.polygons);if(!result.length)throw Error('Carve Out removed the entire object. Try a smaller Wall thickness.');
  report(82,'Rebuilding hollow solid…');let out:Solid;try{out=csgToSolid(result,s.id,{kind:'boolean',label:'Carve Out'},false,diagnostic);}catch(error){carveOutUnsupported(`The hollow result could not be rebuilt safely. ${errorMessage(error)} Try a smaller Wall thickness or a simpler object.`);}
  report(94,'Validating hollow solid…');const validation=validateSolid(out!,false);if(!validation.ok)carveOutUnsupported(`The hollow result is not a valid closed solid. ${validation.errors[0]||''}`.trim());if(solidShellCount(out!)!==1)carveOutUnsupported('The hollow operation produced multiple disconnected shells. Try a smaller Wall thickness.');
  const original=validateSolid(s,false).volume;if(!(validation.volume>0&&validation.volume<original-TOL.minimumFaceArea))throw Error('Carve Out did not remove a valid internal volume. Try a smaller Wall thickness.');
  report(100,'Carve Out complete');diagnostic('carve-out','complete',{durationMs:profilerClock()-started,sourceVolume:original,resultVolume:validation.volume,...cavity.stats});return {solid:out!,stats:cavity.stats};
}
