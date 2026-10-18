type ChamferOperation = 'cut' | 'extend';
// Admission-angle roundoff accounts for canonical coordinate rounding at the
// range endpoints. It does not change the plane/weld budgets or the cut angle.
const CHAMFER_CORNER_POLICY=Object.freeze({minimumIncludedAngleDeg:2,maximumIncludedAngleDeg:178,angleComparisonRoundoffDeg:1e-8,orthogonalRoundoff:1e-12,uniformRimCosineTolerance:1e-7,planeSolveDeterminantTolerance:1e-10,maximumRimMiterFactor:20,rimMiterSlackFactor:10,endOverrunFactor:2,endPlaneMinimumCosine:1e-10,endSnapClearanceFactor:8,endMinimumEdgeClearanceFactor:32,symmetricBiasDeg:45});
interface ChamferCornerFrame {a:Vec3;b:Vec3;t:Vec3;da:Vec3;db:Vec3;includedAngle:number;sideNormal:Vec3;}
interface ChamferRimFrame {points:Vec3[];selectedOffsets:Vec3[];sideOffsets:Vec3[];includedAngle:number;}
interface ChamferSelectedPath {edges:HalfEdge[];closed:boolean;reverseSelection?:boolean;}
const CHAMFER_CHAIN_SELECTION_POLICY=Object.freeze({maximumTurnDeg:45});

function chamferCurveChainCandidate(s:Solid,halfEdgeId:HalfEdgeId,operation:ChamferOperation='cut'):HalfEdgeId[]|null{
  const seed=s.halfEdges.get(halfEdgeId);if(!seed||!chamferCornerFrame(s,seed,operation))return null;
  const minimumDot=Math.cos(CHAMFER_CHAIN_SELECTION_POLICY.maximumTurnDeg*Math.PI/180);
  let best:HalfEdgeId[]=[];
  // Search both incident loops. A curved rim may be picked from its wall;
  // preserve that picked-side orientation when returning the common cap path.
  for(const start of [seed,s.halfEdges.get(seed.twin)!]){
    const reverse=start.id!==seed.id,frames=new Map<HalfEdgeId,ChamferCornerFrame|null>(),directions=new Map<HalfEdgeId,Vec3>();
    const frame=(e:HalfEdge)=>{if(!frames.has(e.id))frames.set(e.id,chamferCornerFrame(s,reverse?s.halfEdges.get(e.twin)!:e,operation));return frames.get(e.id)!;};
    const direction=(e:HalfEdge)=>{let value=directions.get(e.id);if(!value){value=V.unit(V.sub(s.vertices.get(s.halfEdges.get(e.next)!.origin)!.position,s.vertices.get(e.origin)!.position));directions.set(e.id,value);}return value;};
    const first=frame(start)!;if(!first)continue;const includedCosine=Math.cos(first.includedAngle),chosen=new Set<HalfEdgeId>([start.id]);
    for(const step of ['prev','next'] as const){
      let current=start;
      while(true){
        const next=s.halfEdges.get(current[step])!;if(chosen.has(next.id))break;
        if(V.dot(direction(current),direction(next))<=minimumDot)break;
        const f=frame(next);if(!f||Math.abs(Math.cos(f.includedAngle)-includedCosine)>CHAMFER_CORNER_POLICY.uniformRimCosineTolerance)break;
        chosen.add(next.id);current=next;
      }
    }
    const ids=loopHalfEdges(s,start.loop).filter(e=>chosen.has(e.id)).map(e=>reverse?e.twin:e.id);
    if(ids.length>best.length)best=ids;
  }
  return best.length?best:null;
}

function triangularPrismCsg(a:Vec3[],b:Vec3[]):CSGPolygon[]{
  const all=[...a,...b],center=V.mul(all.reduce((q,p)=>V.add(q,p),[0,0,0] as Vec3),1/all.length),out:CSGPolygon[]=[];
  out.push(orientConvexFace([a[0],a[1],a[2]],center));out.push(orientConvexFace([b[0],b[1],b[2]],center));
  for(let i=0;i<3;i++){const j=(i+1)%3;out.push(orientConvexFace([a[i],b[i],b[j],a[j]],center));}
  return out;
}
function edgeInteriorDirection(s:Solid,faceId:FaceId,a:Vec3,b:Vec3,knownEdge?:HalfEdge):Vec3|null{
  const face=s.faces.get(faceId);if(!face)return null;
  const edge=knownEdge??[face.outerLoop,...face.innerLoops].flatMap(id=>loopHalfEdges(s,id)).find(e=>{
    const p=s.vertices.get(e.origin)!.position,q=s.vertices.get(s.halfEdges.get(e.next)!.origin)!.position;
    return V.near(p,a,TOL.weld)&&V.near(q,b,TOL.weld)||V.near(p,b,TOL.weld)&&V.near(q,a,TOL.weld);
  });
  if(!edge||edge.face!==faceId)return null;
  const p=s.vertices.get(edge.origin)!.position,q=s.vertices.get(s.halfEdges.get(edge.next)!.origin)!.position,tangent=V.sub(q,p);
  if(V.len(tangent)<TOL.minimumEdge)return null;
  // Validated outer and hole loops both keep material on the left of their
  // directed half-edges. A point-in-domain probe is unnecessary: fuzzy boundary
  // acceptance can mark BOTH probe points inside near a short edge.
  return V.unit(V.cross(face.plane.normal,V.unit(tangent)));
}
function lineIntersection2(a:Vec2,da:Vec2,b:Vec2,db:Vec2):Vec2|null{
  const cross=da[0]*db[1]-da[1]*db[0];if(Math.abs(cross)<1e-10)return null;const q:[number,number]=[b[0]-a[0],b[1]-a[1]],t=(q[0]*db[1]-q[1]*db[0])/cross;return [a[0]+da[0]*t,a[1]+da[1]*t];
}
function chamferCornerFrame(s:Solid,he:HalfEdge,operation:ChamferOperation='cut'):ChamferCornerFrame|null{
  const tw=s.halfEdges.get(he.twin),next=s.halfEdges.get(he.next),fa=s.faces.get(he.face),fb=tw&&s.faces.get(tw.face),va=s.vertices.get(he.origin),vb=next&&s.vertices.get(next.origin);if(!fa||!fb||!va||!vb)return null;
  const a=[...va.position] as Vec3,b=[...vb.position] as Vec3,t=V.unit(V.sub(b,a)),interiorA=edgeInteriorDirection(s,fa.id,a,b,he),db=edgeInteriorDirection(s,fb.id,a,b,tw);if(!interiorA||!db)return null;
  const convex=V.dot(fa.plane.normal,db)<0&&V.dot(fb.plane.normal,interiorA)<0,concave=V.dot(fa.plane.normal,db)>0&&V.dot(fb.plane.normal,interiorA)>0;
  if(operation==='cut'?!convex:!convex&&!concave)return null;
  // A convex extension continues the selected face outward. A concave
  // extension fills the free wedge between both face-interior rays.
  const da=operation==='extend'&&convex?V.mul(interiorA,-1):interiorA;
  const includedAngle=Math.acos(Math.max(-1,Math.min(1,V.dot(da,db)))),degrees=includedAngle*180/Math.PI;
  // Apply the same admission-angle budget to the chosen material/free wedge.
  if(degrees+CHAMFER_CORNER_POLICY.angleComparisonRoundoffDeg<CHAMFER_CORNER_POLICY.minimumIncludedAngleDeg||degrees-CHAMFER_CORNER_POLICY.angleComparisonRoundoffDeg>CHAMFER_CORNER_POLICY.maximumIncludedAngleDeg)return null;
  return {a,b,t,da,db,includedAngle,sideNormal:fb.plane.normal};
}
function requireChamferCornerFrame(s:Solid,he:HalfEdge,operation:ChamferOperation='cut'):ChamferCornerFrame{
  const frame=chamferCornerFrame(s,he,operation);if(!frame)throw Error(`${operation==='cut'?'Chamfer requires a convex edge':'Extend requires a convex or concave edge'} with an included profile angle between ${CHAMFER_CORNER_POLICY.minimumIncludedAngleDeg}° and ${CHAMFER_CORNER_POLICY.maximumIncludedAngleDeg}°.`);return frame;
}
// A fixed distance multiple does not cover an obtuse terminal corner: the
// neighboring face can flare beyond it and leave a thin uncut lip. Bound the
// entire triangular profile against every outward-facing incident end plane.
// Linear plane intersection reaches its maximum at a profile triangle vertex,
// so the same bound covers every straight/rounded profile and setback bias.
function chamferCutEndOverrun(s:Solid,he:HalfEdge,frame:ChamferCornerFrame,distance:number,otherDistance:number,start:boolean):number{
  const clearance=Math.max(TOL.snapGeometry*CHAMFER_CORNER_POLICY.endSnapClearanceFactor,TOL.minimumEdge*CHAMFER_CORNER_POLICY.endMinimumEdgeClearanceFactor);
  let overrun=Math.max(distance,otherDistance)*CHAMFER_CORNER_POLICY.endOverrunFactor+clearance;
  const outward=V.mul(frame.t,start?-1:1),point=start?frame.a:frame.b,offsets:Vec3[]=[[0,0,0],V.mul(frame.da,distance),V.mul(frame.db,otherDistance)];
  const seed=start?he:s.halfEdges.get(he.twin)!,visited=new Set<HalfEdgeId>();let current=seed;
  // Rotate around this canonical vertex only; do not scan unrelated geometry
  // or change the zero-overrun semantics of additive Chamfer.
  while(!visited.has(current.id)){
    visited.add(current.id);
    if(current.face!==he.face&&current.face!==s.halfEdges.get(he.twin)!.face){
      const plane=s.faces.get(current.face)!.plane,axial=V.dot(plane.normal,outward);
      // Parallel planes do not bound the end of this edge. The cutoff protects
      // division from roundoff at canonical collinear subdivisions.
      if(axial>CHAMFER_CORNER_POLICY.endPlaneMinimumCosine){
        for(const delta of offsets)overrun=Math.max(overrun,(plane.offset-V.dot(plane.normal,V.add(point,delta))+clearance)/axial);
      }
    }
    current=s.halfEdges.get(s.halfEdges.get(current.prev)!.twin)!;
  }
  if(!Number.isFinite(overrun))throw Error('The Chamfer endpoint cannot be bounded by its neighboring faces.');
  return overrun;
}
function chamferClosedRimFrame(s:Solid,he:HalfEdge,distance:number,angleDeg:number,operation:ChamferOperation='cut'):ChamferRimFrame|null{
  const loop=s.loops.get(he.loop),support=s.faces.get(he.face);if(!loop||!support)return null;const rim=loopHalfEdges(s,loop.id);if(rim.length<3)return null;const points=rim.map(e=>[...s.vertices.get(e.origin)!.position] as Vec3);
  if(loop.kind==='outer'&&!approximatelyCircularPlanarLoop(points,support.plane))return null;
  return chamferPathFrame(s,rim,distance,angleDeg,operation,true);
}
function chamferPathFrame(s:Solid,edges:HalfEdge[],distance:number,angleDeg:number,operation:ChamferOperation,closed:boolean,reverseSelection=false):ChamferRimFrame{
  const support=s.faces.get(edges[0].face)!;
  const points=edges.map(e=>[...s.vertices.get(e.origin)!.position] as Vec3);
  if(!closed)points.push([...s.vertices.get(s.halfEdges.get(edges[edges.length-1].next)!.origin)!.position] as Vec3);
  const frames=edges.map(e=>{
    if(!reverseSelection)return requireChamferCornerFrame(s,e,operation);
    const twin=s.halfEdges.get(e.twin)!,f=requireChamferCornerFrame(s,twin,operation);
    // Preserve wall-picked additive rays as well as unequal setbacks. Merely
    // flipping to the cap frame would extend into a different free wedge.
    return {...f,a:f.b,b:f.a,t:V.mul(f.t,-1),da:f.db,db:f.da,sideNormal:s.faces.get(twin.face)!.plane.normal};
  }),cosine=Math.cos(frames[0].includedAngle),includedAngle=frames[0].includedAngle;
  // One support-plane depth describes a joined miter only when every incident
  // side has the same inclination. Otherwise a single setback cannot satisfy
  // both side-plane constraints at their shared vertex.
  if(frames.some(f=>Math.abs(Math.cos(f.includedAngle)-cosine)>CHAMFER_CORNER_POLICY.uniformRimCosineTolerance))throw Error('This rim has varying side inclinations. Select a rim with a consistent angle to its supporting face.');
  const basis=planeBasis(support.plane,points[0]),selectedOffsets:Vec3[]=[],sideOffsets:Vec3[]=[],otherDistance=distance*Math.tan(angleDeg*Math.PI/180),normalDepth=V.dot(support.plane.normal,frames[0].db)*otherDistance;
  for(let i=0;i<points.length;i++){
    if(!closed&&(i===0||i===points.length-1)){const f=i===0?frames[0]:frames[frames.length-1],direction=i===0?-1:1,overrun=operation==='cut'?chamferCutEndOverrun(s,i===0?edges[0]:edges[edges.length-1],f,distance,otherDistance,i===0):0;points[i]=V.add(points[i],V.mul(f.t,direction*overrun));selectedOffsets.push(V.add(points[i],V.mul(f.da,distance)));sideOffsets.push(V.add(points[i],V.mul(f.db,otherDistance)));continue;}
    const prev=(i+points.length-1)%points.length,p=toPlane2(points[i],basis),pp=toPlane2(points[prev],basis),pn=toPlane2(points[(i+1)%points.length],basis),dPrev=frames[prev].da,dCurrent=frames[i].da,dp:Vec2=[V.dot(dPrev,basis.u),V.dot(dPrev,basis.v)],dc:Vec2=[V.dot(dCurrent,basis.u),V.dot(dCurrent,basis.v)],a:Vec2=[pp[0]+dp[0]*distance,pp[1]+dp[1]*distance],b:Vec2=[p[0]+dc[0]*distance,p[1]+dc[1]*distance];let offset=lineIntersection2(a,[p[0]-pp[0],p[1]-pp[1]],b,[pn[0]-p[0],pn[1]-p[1]]);
    // A collinear subdivision shares one inset line and needs no line-line miter.
    if(!offset&&V.len(V.cross(frames[prev].t,frames[i].t))<=TOL.coplanarAngle&&V.dot(frames[prev].t,frames[i].t)>0&&V.len(V.sub(dPrev,dCurrent))<=TOL.coplanarAngle)offset=[p[0]+dc[0]*distance,p[1]+dc[1]*distance];
    if(!offset||v2.dist(offset,p)>distance*CHAMFER_CORNER_POLICY.maximumRimMiterFactor+TOL.minimumEdge*CHAMFER_CORNER_POLICY.rimMiterSlackFactor)throw Error('The rim setback has an unstable corner. Reduce the distance or choose another edge.');const selected=fromPlane2(offset,basis),deltaA=V.sub(selected,points[i]);if(Math.abs(V.dot(dPrev,deltaA)-distance)>TOL.topologyKey||Math.abs(V.dot(dCurrent,deltaA)-distance)>TOL.topologyKey)throw Error('The rim base setback cannot meet both adjacent edges.');selectedOffsets.push(selected);
    const na=frames[prev].sideNormal,nb=frames[i].sideNormal,n=support.plane.normal,cross=V.cross(na,nb),det=V.dot(n,cross);let delta:Vec3;
    if(Math.abs(V.dot(n,na))<=CHAMFER_CORNER_POLICY.orthogonalRoundoff&&Math.abs(V.dot(n,nb))<=CHAMFER_CORNER_POLICY.orthogonalRoundoff)delta=V.mul(n,normalDepth);
    else if(Math.abs(det)>CHAMFER_CORNER_POLICY.planeSolveDeterminantTolerance)delta=V.mul(cross,normalDepth/det);
    else delta=V.mul(frames[i].db,otherDistance);
    if(Math.abs(V.dot(na,delta))>TOL.plane||Math.abs(V.dot(nb,delta))>TOL.plane||Math.abs(V.dot(n,delta)-normalDepth)>TOL.plane||Math.abs(V.dot(frames[prev].db,delta)-otherDistance)>TOL.topologyKey||Math.abs(V.dot(frames[i].db,delta)-otherDistance)>TOL.topologyKey||V.len(delta)>otherDistance*CHAMFER_CORNER_POLICY.maximumRimMiterFactor+TOL.minimumEdge*CHAMFER_CORNER_POLICY.rimMiterSlackFactor)throw Error('The rim side setback cannot meet both adjacent planes. Reduce the distance or choose another rim.');sideOffsets.push(V.add(points[i],delta));
  }
  return {points,selectedOffsets,sideOffsets,includedAngle};
}
function chamferClosedRimCutter(s:Solid,he:HalfEdge,distance:number,angleDeg:number,operation:ChamferOperation='cut'):CSGPolygon[]|null{
  const frame=chamferClosedRimFrame(s,he,distance,angleDeg,operation);if(!frame)return null;const {points,selectedOffsets,sideOffsets}=frame;let tool:CSGPolygon[]=[];
  for(let i=0;i<points.length;i++){const j=(i+1)%points.length,w=triangularPrismCsg([points[i],selectedOffsets[i],sideOffsets[i]],[points[j],selectedOffsets[j],sideOffsets[j]]);tool=tool.length?csgUnionOwned(tool,w):w;}
  return tool;
}
// A setback on a faceted support must follow its actual boundary. Extrapolating
// only the first face can put the tangent point in empty space and leave a lip
// on later facets. This construction applies to a constant prismatic section;
// ordinary two-plane corners retain their exact existing cutter coordinates.
const CHAMFER_SUPPORT_TRACE_POLICY=Object.freeze({maximumTurnDeg:45});
interface ChamferSupportTrace {points:Vec3[];direction:Vec3;curved:boolean;}
function chamferPrismaticSupportCutter(s:Solid,he:HalfEdge,frame:ChamferCornerFrame,distance:number,otherDistance:number,segments:number|null):CSGPolygon[]|null{
  const {a,b,t,da,db}=frame;
  let ring:Vec3[]|null=null,index=-1;
  for(const face of s.faces.values()){
    if(Math.abs(V.dot(face.plane.normal,t))<1-TOL.coplanarAngle)continue;
    for(const loopId of [face.outerLoop,...face.innerLoops]){
      const edges=loopHalfEdges(s,loopId),at=edges.findIndex(e=>e.origin===he.origin);if(at<0)continue;
      const points=edges.map(e=>s.vertices.get(e.origin)!.position),forward=V.unit(V.sub(points[(at+1)%points.length],a)),back=V.unit(V.sub(points[(at+points.length-1)%points.length],a));
      if(Math.max(V.dot(forward,da),V.dot(back,da))<1-TOL.coplanarAngle||Math.max(V.dot(forward,db),V.dot(back,db))<1-TOL.coplanarAngle)continue;
      ring=points;index=at;break;
    }
    if(ring)break;
  }
  if(!ring)return null;
  const points=ring,count=points.length,stepFor=(ray:Vec3)=>V.dot(V.unit(V.sub(points[(index+1)%count],a)),ray)>1-TOL.coplanarAngle?1:-1;
  const stepA=stepFor(da),stepB=stepFor(db),firstLength=(step:number)=>V.len(V.sub(points[(index+step+count)%count],a));
  if(distance<=firstLength(stepA)&&otherDistance<=firstLength(stepB))return null;
  const levelA=V.dot(a,t),levelB=V.dot(b,t);
  // Both end stations and every side plane certify translation of one section.
  // A sloped end, taper, twist or other spatial junction keeps the general path.
  for(const vertex of s.vertices.values())if(Math.min(Math.abs(V.dot(vertex.position,t)-levelA),Math.abs(V.dot(vertex.position,t)-levelB))>TOL.plane)return null;
  for(const face of s.faces.values()){const cosine=Math.abs(V.dot(face.plane.normal,t));if(cosine>TOL.coplanarAngle&&cosine<1-TOL.coplanarAngle)return null;}
  const minimumDot=Math.cos(CHAMFER_SUPPORT_TRACE_POLICY.maximumTurnDeg*Math.PI/180);
  const trace=(step:number,requested:number):ChamferSupportTrace|null=>{
    const path:Vec3[]=[[0,0,0]];let remaining=requested,at=index,previous:Vec3|null=null,curved=false;
    for(let walked=0;walked<count-1;walked++){
      const next=(at+step+count)%count,delta=V.sub(points[next],points[at]),length=V.len(delta),direction=V.mul(delta,1/length);
      if(previous){const cosine=V.dot(previous,direction);if(cosine<=minimumDot){if(curved)throw Error('The Chamfer setback crosses a sharp support corner. Reduce the distance.');return null;}if(cosine<1-TOL.coplanarAngle)curved=true;}
      if(remaining<=length){path.push(V.sub(V.add(points[at],V.mul(direction,remaining)),a));return {points:path,direction,curved};}
      path.push(V.sub(points[next],a));remaining-=length;at=next;previous=direction;
    }
    throw Error('The Chamfer setback wraps around its supporting section. Reduce the distance.');
  };
  const sideA=trace(stepA,distance),sideB=trace(stepB,otherDistance);
  if(!sideA||!sideB||(!sideA.curved&&!sideB.curved))return null;
  const endA=sideA.points[sideA.points.length-1],endB=sideB.points[sideB.points.length-1],basis=planeBasis({normal:t,offset:levelA},[0,0,0]);
  let profile:Vec3[];
  if(segments===null)profile=[endA,endB];
  else{
    const to2=(p:Vec3):Vec2=>[V.dot(p,basis.u),V.dot(p,basis.v)],pa=to2(endA),pb=to2(endB),ua=to2(sideA.direction),ub=to2(sideB.direction),intersection=lineIntersection2(pa,ua,pb,ub);
    if(!intersection)throw Error('The curved Chamfer supports do not define stable tangent lines. Reduce the distance.');
    const origin=V.add(V.mul(basis.u,intersection[0]),V.mul(basis.v,intersection[1])),setbackA=V.dot(V.sub(endA,origin),sideA.direction),setbackB=V.dot(V.sub(endB,origin),sideB.direction),included=Math.acos(Math.max(-1,Math.min(1,V.dot(sideA.direction,sideB.direction))));
    if(setbackA<=TOL.minimumEdge||setbackB<=TOL.minimumEdge||included*180/Math.PI<CHAMFER_CORNER_POLICY.minimumIncludedAngleDeg||included*180/Math.PI>CHAMFER_CORNER_POLICY.maximumIncludedAngleDeg)throw Error('The curved Chamfer tangent profile folds over its supports. Reduce the distance.');
    profile=roundedChamferProfile(setbackA,Math.atan2(setbackB,setbackA)*180/Math.PI,segments,included).map(p=>V.add(origin,V.add(V.mul(sideA.direction,p[0]),V.mul(sideB.direction,p[1]))));
    profile[0]=endA;profile[profile.length-1]=endB;
  }
  let section=dedupePolygon3([...sideA.points,...profile.slice(1),...sideB.points.slice(0,-1).reverse()]),section2=section.map(p=>[V.dot(p,basis.u),V.dot(p,basis.v)] as Vec2);
  if(polygonSelfIntersects(section2))throw Error('The Chamfer profile intersects its supporting section. Reduce the distance.');
  if(v2.area(section2)<0){section=section.reverse();section2=section2.reverse();}
  const triangles=triangulateSimple2(section2),overrun=Math.max(distance,otherDistance)*CHAMFER_CORNER_POLICY.endOverrunFactor+Math.max(TOL.snapGeometry*CHAMFER_CORNER_POLICY.endSnapClearanceFactor,TOL.minimumEdge*CHAMFER_CORNER_POLICY.endMinimumEdgeClearanceFactor),lo=section.map(p=>V.add(V.add(a,p),V.mul(t,-overrun))),hi=section.map(p=>V.add(V.add(b,p),V.mul(t,overrun))),out:CSGPolygon[]=[];
  // Direct shell emission avoids Boolean seams between touching profile fans.
  for(const triangle of triangles){out.push(csgPolygon(triangle.map(i=>lo[i]).reverse()));out.push(csgPolygon(triangle.map(i=>hi[i])));}
  for(let i=0;i<section.length;i++){const j=(i+1)%section.length;out.push(csgPolygon([lo[i],lo[j],hi[j],hi[i]]));}
  return out;
}
function chamferStraightEdgeCutter(s:Solid,he:HalfEdge,distance:number,angleDeg:number,operation:ChamferOperation='cut'):CSGPolygon[]{
  const frame=requireChamferCornerFrame(s,he,operation),{a:rawA,b:rawB,t,da,db}=frame,d2=distance*Math.tan(angleDeg*Math.PI/180);
  if(operation==='cut'){const curved=chamferPrismaticSupportCutter(s,he,frame,distance,d2,null);if(curved)return curved;}
  const a=operation==='extend'?rawA:V.add(rawA,V.mul(t,-chamferCutEndOverrun(s,he,frame,distance,d2,true))),b=operation==='extend'?rawB:V.add(rawB,V.mul(t,chamferCutEndOverrun(s,he,frame,distance,d2,false))),a1=V.add(a,V.mul(da,distance)),b1=V.add(b,V.mul(da,distance)),a2=V.add(a,V.mul(db,d2)),b2=V.add(b,V.mul(db,d2));return triangularPrismCsg([a,a1,a2],[b,b1,b2]);
}
// Only an unbranched connected component with one common supporting face has
// a planar path miter. Spatial/branched selections keep their existing corner
// Boolean semantics, and disconnected components cannot affect one another.
function chamferSelectedPaths(s:Solid,ids:HalfEdgeId[],angleDeg:number,operation:ChamferOperation):ChamferSelectedPath[]{
  const key=(e:HalfEdge)=>e.id<e.twin?e.id:e.twin,selected=new Map<HalfEdgeId,HalfEdge>(),atVertex=new Map<VertexId,HalfEdge[]>();
  for(const id of ids){const e=s.halfEdges.get(id);if(!e)throw Error('A chamfer edge no longer exists.');if(!selected.has(key(e)))selected.set(key(e),e);}
  for(const e of selected.values())for(const vertex of [e.origin,s.halfEdges.get(e.next)!.origin]){const list=atVertex.get(vertex)||[];list.push(e);atVertex.set(vertex,list);}
  const seen=new Set<HalfEdgeId>(),paths:ChamferSelectedPath[]=[];
  for(const seed of selected.values()){
    if(seen.has(key(seed)))continue;const component:HalfEdge[]=[],pending=[seed];
    while(pending.length){const e=pending.pop()!,id=key(e);if(seen.has(id))continue;seen.add(id);component.push(e);for(const vertex of [e.origin,s.halfEdges.get(e.next)!.origin])for(const neighbor of atVertex.get(vertex)||[])if(!seen.has(key(neighbor)))pending.push(neighbor);}
    const separate=()=>{for(const e of component)paths.push({edges:[e],closed:false});};
    if(component.length<2||component.some(e=>[e.origin,s.halfEdges.get(e.next)!.origin].some(v=>atVertex.get(v)!.length>2))){separate();continue;}
    const faces=[seed.face,s.halfEdges.get(seed.twin)!.face].filter(face=>component.every(e=>e.face===face||s.halfEdges.get(e.twin)!.face===face));
    const direct=faces.find(face=>component.every(e=>e.face===face)),reverse=faces.find(face=>component.every(e=>e.face!==face)),equalSetbacks=angleDeg===CHAMFER_CORNER_POLICY.symmetricBiasDeg;
    const support=direct??reverse??(operation==='cut'&&equalSetbacks?faces.sort()[0]:undefined);
    // A wall-side chain can use its common cap by exchanging both rays and
    // setbacks. Mixed unequal picks retain independent orientation rather
    // than changing the requested edit.
    if(!support){separate();continue;}
    const oriented=component.map(e=>e.face===support?e:s.halfEdges.get(e.twin)!);
    if(oriented.some(e=>e.loop!==oriented[0].loop)){separate();continue;}
    const chosen=new Set(oriented.map(e=>e.id)),rim=loopHalfEdges(s,oriented[0].loop),closed=chosen.size===rim.length;
    const start=closed?rim[0]:rim.find(e=>chosen.has(e.id)&&!chosen.has(e.prev));
    if(!start){separate();continue;}
    const edges:HalfEdge[]=[];let current=start;
    do{if(!chosen.has(current.id))break;edges.push(current);current=s.halfEdges.get(current.next)!;}while(current.id!==start.id);
    if(edges.length!==component.length){separate();continue;}
    paths.push({edges,closed,reverseSelection:direct===undefined&&support===reverse});
  }
  return paths;
}
// A convex corner followed by a concave run can consume the first short inset
// segment even though both requested profiles fit the solid. Its local miter
// folds back; the correct boundary is the Boolean envelope of the two runs.
// This differs from opposing convex corners exhausting the available material,
// which must retain the overlap rejection. Collinear subdivisions have no turn.
type ChamferPathOverlap={kind:'clear'}|{kind:'exhausted'}|{kind:'mixed-turn';pieces:ChamferSelectedPath[]};
function chamferPathOverlap(s:Solid,path:ChamferSelectedPath,frame:ChamferRimFrame):ChamferPathOverlap{
  const directions=path.edges.map(e=>V.unit(V.sub(s.vertices.get(s.halfEdges.get(e.next)!.origin)!.position,s.vertices.get(e.origin)!.position))),normal=s.faces.get(path.edges[0].face)!.plane.normal,count=path.edges.length;
  const turnAt=(i:number):number=>!path.closed&&(i<=0||i>=count)?0:V.dot(V.cross(directions[(i+count-1)%count],directions[i%count]),normal);
  const nearestTurn=(from:number,step:number):{index:number;turn:number}|null=>{
    for(let walked=0;walked<count;walked++){
      const index=path.closed?(from+walked*step+count)%count:from+walked*step;
      if(!path.closed&&(index<=0||index>=count))return null;
      const turn=turnAt(index);if(Math.abs(turn)>TOL.coplanarAngle)return {index,turn};
    }
    return null;
  };
  const breaks=new Set<number>();
  for(let i=0;i<count;i++){
    const j=(i+1)%frame.points.length,t=V.unit(V.sub(frame.points[j],frame.points[i]));
    if(![frame.selectedOffsets,frame.sideOffsets].some(rail=>V.dot(V.sub(rail[j],rail[i]),t)<=TOL.minimumEdge))continue;
    const before=nearestTurn(i,-1),after=nearestTurn(i+1,1);
    if(!before||!after||before.turn*after.turn>=0)return {kind:'exhausted'};
    breaks.add(before.turn>0?before.index:after.index);
  }
  if(!breaks.size)return {kind:'clear'};
  const pieces:ChamferSelectedPath[]=[],start=path.closed?Math.min(...breaks):0;let edges:HalfEdge[]=[];
  for(let step=0;step<count;step++){
    const index=(start+step)%count;
    if(edges.length&&breaks.has(index)){pieces.push({edges,closed:false});edges=[];}
    edges.push(path.edges[index]);
  }
  if(edges.length)pieces.push({edges,closed:false});
  return pieces.length>1?{kind:'mixed-turn',pieces}:{kind:'exhausted'};
}
function chamferJoinedPathCutter(s:Solid,path:ChamferSelectedPath,distance:number,angleDeg:number,segments:number|null,operation:ChamferOperation,reportFraction?:(fraction:number)=>void,reportGeometry?:(data:Record<string,unknown>)=>void):CSGPolygon[]{
  if(path.reverseSelection&&angleDeg!==CHAMFER_CORNER_POLICY.symmetricBiasDeg){distance*=Math.tan(angleDeg*Math.PI/180);angleDeg=90-angleDeg;}
  const frame=chamferPathFrame(s,path.edges,distance,angleDeg,operation,path.closed,!!path.reverseSelection&&operation==='extend'),otherDistance=distance*Math.tan(angleDeg*Math.PI/180);
  const overlap=chamferPathOverlap(s,path,frame);
  if(overlap.kind==='exhausted'||overlap.kind==='mixed-turn'&&operation!=='cut')throw Error('The connected Chamfer distance makes neighboring profile stations overlap. Reduce the distance.');
  if(overlap.kind==='mixed-turn'){
    reportGeometry?.({kind:'mixed-turn-envelope',edges:path.edges.length,pieces:overlap.pieces.map(piece=>piece.edges.length)});
    let tool:CSGPolygon[]=[];
    for(let i=0;i<overlap.pieces.length;i++){
      const piece=overlap.pieces[i],fraction=(value:number)=>reportFraction?.((i+value)/overlap.pieces.length);
      const cutter=piece.edges.length>1?chamferJoinedPathCutter(s,piece,distance,angleDeg,segments,operation,fraction,reportGeometry):segments===null?chamferStraightEdgeCutter(s,piece.edges[0],distance,angleDeg,operation):roundedChamferStraightEdgeCutter(s,piece.edges[0],distance,angleDeg,segments,fraction,undefined,operation);
      tool=tool.length?csgUnionOwned(tool,cutter):cutter;fraction(1);
    }
    return tool;
  }
  const profile=segments===null?[[distance,0],[0,otherDistance]] as Vec2[]:roundedChamferProfile(distance,angleDeg,segments,frame.includedAngle);
  // A single shared station per vertex/profile parameter prevents independent
  // endpoint overruns from intersecting as comb-shaped patches around a bend.
  const stations=frame.points.map((point,i)=>profile.map(p=>V.add(point,V.add(V.mul(V.sub(frame.selectedOffsets[i],point),p[0]/distance),V.mul(V.sub(frame.sideOffsets[i],point),p[1]/otherDistance)))));
  const tool:CSGPolygon[]=[];let done=0;const total=path.edges.length*(profile.length-1);
  for(let i=0;i<path.edges.length;i++){const j=(i+1)%frame.points.length;for(let k=0;k+1<profile.length;k++){
    const wedge=triangularPrismCsg([frame.points[i],stations[i][k],stations[i][k+1]],[frame.points[j],stations[j][k],stations[j][k+1]]);
    // The station triangles and radial fan sides are internal interfaces,
    // not cutter boundaries. Emit the joined shell directly instead of
    // repeatedly Boolean-unioning touching wedges into numerical slivers.
    if(!path.closed&&i===0)tool.push(wedge[0]);
    if(!path.closed&&i===path.edges.length-1)tool.push(wedge[1]);
    if(k===0)tool.push(wedge[2]);
    tool.push(wedge[3]);
    if(k===profile.length-2)tool.push(wedge[4]);
    reportFraction?.(++done/total);
  }}
  return tool;
}
function chamferEdgeChainCandidate(s:Solid,halfEdgeId:HalfEdgeId,operation:ChamferOperation='cut'):HalfEdgeId[]{
  const seed=s.halfEdges.get(halfEdgeId);if(!seed)return [];const loop=s.loops.get(seed.loop);if(!loop)return [halfEdgeId];
  if(loop.kind==='hole')return loopHalfEdges(s,loop.id).map(e=>e.id);
  const support=s.faces.get(seed.face),rim=loopHalfEdges(s,loop.id);if(loop.kind==='outer'&&support&&approximatelyCircularPlanarLoop(rim.map(e=>s.vertices.get(e.origin)!.position),support.plane))return rim.map(e=>e.id);
  const twin=s.halfEdges.get(seed.twin),twinLoop=twin&&s.loops.get(twin.loop);if(twin&&twinLoop?.kind==='hole')return loopHalfEdges(s,twinLoop.id).map(e=>e.id);
  if(twin&&twinLoop?.kind==='outer'){const twinSupport=s.faces.get(twin.face),twinRim=loopHalfEdges(s,twinLoop.id);if(twinSupport&&approximatelyCircularPlanarLoop(twinRim.map(e=>s.vertices.get(e.origin)!.position),twinSupport.plane))return twinRim.map(e=>e.id);}
  if(!support)return [halfEdgeId];const idx=rim.findIndex(e=>e.id===seed.id);if(idx<0)return [halfEdgeId];
  const edgeDir=(e:HalfEdge)=>{const n=s.halfEdges.get(e.next),a=s.vertices.get(e.origin),b=n&&s.vertices.get(n.origin);return a&&b?V.unit(V.sub(b.position,a.position)):null;};
  const seedDir=edgeDir(seed);if(!seedDir)return [halfEdgeId];
  const good=(e:HalfEdge)=>{const tw=s.halfEdges.get(e.twin),side=tw&&s.faces.get(tw.face),d=edgeDir(e);return !!side&&!!d&&!!chamferCornerFrame(s,e,operation)&&Math.abs(V.dot(seedDir,d))>.999999;};
  if(!good(seed))return [halfEdgeId];
  const picked=new Set<number>([idx]);for(const step of [-1,1]){let i=idx;for(let n=1;n<rim.length;n++){i=(i+step+rim.length)%rim.length;if(picked.has(i)||!good(rim[i]))break;picked.add(i);}}
  return [...picked].sort((a,b)=>a-b).map(i=>rim[i].id);
}
function chamferEdgesSolid(s:Solid,halfEdgeIds:HalfEdgeId[],distance:number,angleDeg=45,operation:ChamferOperation='cut'):Solid{
  if(!Number.isFinite(distance)||distance<=TOL.minimumEdge)throw Error('Chamfer distance must be greater than 0.');if(!Number.isFinite(angleDeg)||angleDeg<=1||angleDeg>=89)throw Error('Chamfer angle must be between 1° and 89°.');if(!halfEdgeIds.length)throw Error('No chamfer edges were selected.');
  let tool:CSGPolygon[]=[];
  for(const path of chamferSelectedPaths(s,halfEdgeIds,angleDeg,operation)){
    // A complete selected rim retains its existing support policy. A partial
    // rim must stay partial, and no first rim may consume another component.
    const rim=path.closed?chamferClosedRimCutter(s,path.edges[0],distance,angleDeg,operation):null;
    const wedge=rim??(path.edges.length>1?chamferJoinedPathCutter(s,path,distance,angleDeg,null,operation):chamferStraightEdgeCutter(s,path.edges[0],distance,angleDeg,operation));
    tool=tool.length?csgUnionOwned(tool,wedge):wedge;
  }
  const base=solidToCsg(s,true),result=operation==='extend'?csgUnionOwned(base,tool):csgSubtractOwned(base,tool),out=csgToSolid(result,s.id,{kind:'pushpull',label:operation==='extend'?'Extended Chamfer':'Chamfer'},true);return out;
}
function chamferEdgeSolid(s:Solid,halfEdgeId:HalfEdgeId,distance:number,angleDeg=45,operation:ChamferOperation='cut'):Solid{return chamferEdgesSolid(s,chamferEdgeChainCandidate(s,halfEdgeId,operation),distance,angleDeg,operation);}

const ROUNDED_CHAMFER_POLICY=Object.freeze({minimumSegments:2,maximumSegments:32,defaultSegments:6});
function roundedChamferProfile(distance:number,angleDeg:number,segments:number,includedAngle=Math.PI/2):Vec2[]{
  const count=Math.max(ROUNDED_CHAMFER_POLICY.minimumSegments,Math.min(ROUNDED_CHAMFER_POLICY.maximumSegments,Math.round(segments))),otherDistance=distance*Math.tan(angleDeg*Math.PI/180),out:Vec2[]=[];
  // Equal setbacks define a tangent circular arc in the actual material wedge.
  // Unequal setbacks affinely scale that arc into a tangent ellipse. The 90°
  // branch retains the existing segment coordinates and tan(bias) convention.
  if(Math.abs(includedAngle-Math.PI/2)<=CHAMFER_CORNER_POLICY.orthogonalRoundoff){for(let i=0;i<=count;i++){const a=-Math.PI/2-(Math.PI/2)*(i/count);out.push([distance+Math.cos(a)*distance,otherDistance+Math.sin(a)*otherDistance]);}return out;}
  const radius=Math.tan(includedAngle/2),sine=Math.sin(includedAngle),cosine=Math.cos(includedAngle);
  for(let i=0;i<=count;i++){if(i===0){out.push([distance,0]);continue;}if(i===count){out.push([0,otherDistance]);continue;}const a=-Math.PI/2-(Math.PI-includedAngle)*(i/count),y=radius*(1+Math.sin(a))/sine,x=1+radius*Math.cos(a)-y*cosine;out.push([x*distance,y*otherDistance]);}
  return out;
}
function roundedChamferStraightEdgeCutter(s:Solid,he:HalfEdge,distance:number,angleDeg:number,segments:number,reportFraction?:(fraction:number)=>void,reportGeometry?:(data:Record<string,unknown>)=>void,operation:ChamferOperation='cut'):CSGPolygon[]{
  const frame=requireChamferCornerFrame(s,he,operation),{a:rawA,b:rawB,t,da,db,includedAngle}=frame;
  reportGeometry?.({kind:'straight',halfEdgeId:he.id,includedAngleDeg:includedAngle*180/Math.PI});
  const otherDistance=distance*Math.tan(angleDeg*Math.PI/180);
  if(operation==='cut'){const curved=chamferPrismaticSupportCutter(s,he,frame,distance,otherDistance,segments);if(curved){reportGeometry?.({kind:'curved-support',halfEdgeId:he.id});reportFraction?.(1);return curved;}}
  const a=operation==='extend'?rawA:V.add(rawA,V.mul(t,-chamferCutEndOverrun(s,he,frame,distance,otherDistance,true))),b=operation==='extend'?rawB:V.add(rawB,V.mul(t,chamferCutEndOverrun(s,he,frame,distance,otherDistance,false))),profile=roundedChamferProfile(distance,angleDeg,segments,includedAngle);let tool:CSGPolygon[]=[];
  const q=(base:Vec3,p:Vec2)=>V.add(base,V.add(V.mul(da,p[0]),V.mul(db,p[1]))),steps=Math.max(1,profile.length-1);
  for(let i=0;i+1<profile.length;i++){const wedge=triangularPrismCsg([a,q(a,profile[i]),q(a,profile[i+1])],[b,q(b,profile[i]),q(b,profile[i+1])]);tool=tool.length?csgUnionOwned(tool,wedge):wedge;reportFraction?.((i+1)/steps);}
  return tool;
}
function roundedChamferClosedRimCutter(s:Solid,he:HalfEdge,distance:number,angleDeg:number,segments:number,reportFraction?:(fraction:number)=>void,reportGeometry?:(data:Record<string,unknown>)=>void,operation:ChamferOperation='cut'):CSGPolygon[]|null{
  const frame=chamferClosedRimFrame(s,he,distance,angleDeg,operation);if(!frame)return null;const {points,selectedOffsets,sideOffsets,includedAngle}=frame,otherDistance=distance*Math.tan(angleDeg*Math.PI/180);
  reportGeometry?.({kind:'closed-rim',halfEdgeId:he.id,edges:points.length,includedAngleDeg:includedAngle*180/Math.PI});
  const profile=roundedChamferProfile(distance,angleDeg,segments,includedAngle),profilePoint=(vertex:number,p:Vec2)=>V.add(points[vertex],V.add(V.mul(V.sub(selectedOffsets[vertex],points[vertex]),p[0]/distance),V.mul(V.sub(sideOffsets[vertex],points[vertex]),p[1]/otherDistance)));let tool:CSGPolygon[]=[],done=0,total=Math.max(1,points.length*Math.max(1,profile.length-1));
  for(let i=0;i<points.length;i++){const j=(i+1)%points.length;for(let k=0;k+1<profile.length;k++){const wedge=triangularPrismCsg([points[i],profilePoint(i,profile[k]),profilePoint(i,profile[k+1])],[points[j],profilePoint(j,profile[k]),profilePoint(j,profile[k+1])]);tool=tool.length?csgUnionOwned(tool,wedge):wedge;reportFraction?.(++done/total);}}
  return tool;
}
function roundedChamferEdgesSolid(s:Solid,halfEdgeIds:HalfEdgeId[],distance:number,angleDeg:number=45,segments:number=ROUNDED_CHAMFER_POLICY.defaultSegments,report?:(update:ModelingProgressUpdate)=>void,reportDiagnostic?:(event:ModelingDiagnosticEvent)=>void,operation:ChamferOperation='cut'):Solid{
  const started=profilerClock(),progress=(value:number,message:string)=>report?.({progress:Math.max(0,Math.min(100,value)),message}),diagnostic:ModelingDiagnosticReporter=(category,event,data={})=>reportDiagnostic?.({category,event,elapsedMs:profilerClock()-started,data}),toolProgress=(fraction:number)=>progress(10+fraction*45,operation==='extend'?'Building rounded extension…':'Building rounded cutter…');
  diagnostic('rounded-chamfer','start',{halfEdgeIds:[...halfEdgeIds],distance,angleDeg,segments,operation,otherDistance:distance*Math.tan(angleDeg*Math.PI/180),source:{vertices:s.vertices.size,halfEdges:s.halfEdges.size,loops:s.loops.size,faces:s.faces.size},cornerPolicy:CHAMFER_CORNER_POLICY,tolerances:TOL,csgRepairPolicy:CSG_REPAIR_POLICY});
  progress(2,'Analyzing selected edge…');
  if(!Number.isFinite(distance)||distance<=TOL.minimumEdge)throw Error('Rounded Chamfer distance must be greater than 0.');if(!Number.isFinite(angleDeg)||angleDeg<=1||angleDeg>=89)throw Error('Rounded Chamfer angle must be between 1° and 89°.');if(!Number.isFinite(segments)||segments<ROUNDED_CHAMFER_POLICY.minimumSegments||segments>ROUNDED_CHAMFER_POLICY.maximumSegments)throw Error(`Rounded Chamfer segments must be between ${ROUNDED_CHAMFER_POLICY.minimumSegments} and ${ROUNDED_CHAMFER_POLICY.maximumSegments}.`);if(!halfEdgeIds.length)throw Error('No Rounded Chamfer edges were selected.');
  progress(8,operation==='extend'?'Preparing rounded extension…':'Preparing rounded cutter…');
  const geometryReport=(data:Record<string,unknown>)=>diagnostic('rounded-chamfer','corner-geometry',data);let tool:CSGPolygon[]=[];
  const paths=chamferSelectedPaths(s,halfEdgeIds,angleDeg,operation);
  for(let i=0;i<paths.length;i++){
    const path=paths[i],fraction=(value:number)=>toolProgress((i+value)/paths.length);
    const rim=path.closed?roundedChamferClosedRimCutter(s,path.edges[0],distance,angleDeg,segments,fraction,geometryReport,operation):null;
    if(!rim&&path.edges.length>1)geometryReport({kind:'connected-path',edges:path.edges.length,closed:path.closed});
    const wedge=rim??(path.edges.length>1?chamferJoinedPathCutter(s,path,distance,angleDeg,segments,operation,fraction,geometryReport):roundedChamferStraightEdgeCutter(s,path.edges[0],distance,angleDeg,segments,fraction,geometryReport,operation));
    tool=tool.length?csgUnionOwned(tool,wedge):wedge;toolProgress((i+1)/paths.length);
  }
  diagnostic('rounded-chamfer','cutter-complete',{polygons:tool.length});
  progress(60,'Preparing source solid…');const base=solidToCsg(s,true);diagnostic('csg','source-polygons',{count:base.length});
  progress(68,operation==='extend'?'Adding rounded extension…':'Applying rounded cut…');const booleanStarted=profilerClock(),result=operation==='extend'?csgUnionOwned(base,tool):csgSubtractOwned(base,tool);diagnostic('csg','boolean-complete',{operation:operation==='extend'?'union':'subtract',sourcePolygons:base.length,toolPolygons:tool.length,resultPolygons:result.length,durationMs:profilerClock()-booleanStarted});
  progress(88,'Rebuilding B-rep…');const out=csgToSolid(result,s.id,{kind:'pushpull',label:operation==='extend'?'Rounded Extension':'Rounded Chamfer'},true,diagnostic);
  progress(97,operation==='extend'?'Finalizing rounded extension…':'Finalizing rounded chamfer…');progress(100,operation==='extend'?'Rounded Extension complete':'Rounded Chamfer complete');diagnostic('rounded-chamfer','complete',{durationMs:profilerClock()-started,result:{vertices:out.vertices.size,halfEdges:out.halfEdges.size,loops:out.loops.size,faces:out.faces.size}});return out;
}
function roundedChamferEdgeSolid(s:Solid,halfEdgeId:HalfEdgeId,distance:number,angleDeg:number=45,segments:number=ROUNDED_CHAMFER_POLICY.defaultSegments,operation:ChamferOperation='cut'):Solid{return roundedChamferEdgesSolid(s,chamferEdgeChainCandidate(s,halfEdgeId,operation),distance,angleDeg,segments,undefined,undefined,operation);}
