interface FaceBoundaryLocation2 { loopIndex:number; kind:'outer'|'hole'; edgeIndex:number; t:number; point:Vec2; }
function boundaryLocationOnLoop2(loop:Vec2[],p:Vec2,loopIndex:number,kind:'outer'|'hole',eps=TOL.snapGeometry*2):FaceBoundaryLocation2|null {
  let best:FaceBoundaryLocation2|null=null,bestDist=Infinity;
  for(let i=0;i<loop.length;i++){
    const a=loop[i],b=loop[(i+1)%loop.length],dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;if(l2<TOL.minimumEdge*TOL.minimumEdge)continue;
    const t=clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2,0,1),q:[number,number]=[a[0]+dx*t,a[1]+dy*t],d=v2.dist(p,q);
    if(d<=eps&&d<bestDist){bestDist=d;best={loopIndex,kind,edgeIndex:i,t,point:q};}
  }
  return best;
}
function faceBoundaryLocation(s:Solid,faceId:FaceId,p:Vec3,eps=TOL.snapGeometry*2):FaceBoundaryLocation2|null {
  const face=s.faces.get(faceId);if(!face)return null;const loops=faceLoopPoints(s,faceId),basis=planeBasis(face.plane,loops.outer[0]),q=toPlane2(p,basis),all=[loops.outer,...loops.holes];let best:FaceBoundaryLocation2|null=null,bestDist=Infinity;
  for(let i=0;i<all.length;i++){const loop2=all[i].map(x=>toPlane2(x,basis)),loc=boundaryLocationOnLoop2(loop2,q,i,i===0?'outer':'hole',eps);if(loc){const d=v2.dist(q,loc.point);if(d<bestDist){bestDist=d;best=loc;}}}
  return best;
}
function boundaryPathForward2(loop:Vec2[],a:FaceBoundaryLocation2,b:FaceBoundaryLocation2):Vec2[]{
  const out:Vec2[]=[[...a.point] as Vec2],push=(p:Vec2)=>{if(!out.length||v2.dist(out[out.length-1],p)>TOL.minimumEdge*.25)out.push([...p] as Vec2);};
  if(a.edgeIndex===b.edgeIndex&&a.t<=b.t+1e-12){push(b.point);return out;}
  let edge=a.edgeIndex,guard=0;push(loop[(edge+1)%loop.length]);edge=(edge+1)%loop.length;
  while(edge!==b.edgeIndex&&guard++<=loop.length+1){push(loop[(edge+1)%loop.length]);edge=(edge+1)%loop.length;}
  push(b.point);return out;
}
function openPolylineSelfIntersects2(line:Vec2[]):boolean {
  for(let i=0;i<line.length-1;i++)for(let j=i+2;j<line.length-1;j++)if(segmentIntersection2(line[i],line[i+1],line[j],line[j+1]))return true;
  for(let i=0;i<line.length;i++)for(let j=i+2;j<line.length;j++)if(v2.dist(line[i],line[j])<TOL.minimumEdge)return true;
  return false;
}
function convexIntersection2(subjectInput:Vec2[],clipInput:Vec2[]):Vec2[]{
  let out=[...subjectInput],clip=[...clipInput];if(v2.area(clip)<0)clip.reverse();
  for(let i=0;i<clip.length&&out.length;i++)out=splitPolygonLine2(out,clip[i],clip[(i+1)%clip.length]).inside;
  if(out.length<3||Math.abs(v2.area(out))<=TOL.minimumFaceArea)return [];
  if(v2.area(out)<0)out.reverse();return out;
}
interface FaceRegionClip2 { region:Vec2[]; fragments:Vec2[][]; components:{outer:Vec2[];holes:Vec2[][]}[]; area:number; }
function clipRegion2ToFace(s:Solid,faceId:FaceId,basis:PlaneBasis,regionInput:Vec2[]):FaceRegionClip2 {
  let region=normalizeLoop2(regionInput);if(polygonSelfIntersects(region))throw Error('The outline self-intersects.');if(v2.area(region)<0)region.reverse();
  const rTris=triangulateSimple2(region).map(t=>{const q=[region[t[0]],region[t[1]],region[t[2]]] as Vec2[];if(v2.area(q)<0)q.reverse();return q;});
  const faceTris=triangulateFaceLocal(s,faceId).map(t=>{const q=t.map(p=>toPlane2(p,basis));if(v2.area(q)<0)q.reverse();return q;});
  const bounds=(p:Vec2[])=>{const xs=p.map(q=>q[0]),ys=p.map(q=>q[1]);return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)] as [number,number,number,number];};
  const rb=rTris.map(bounds),fb=faceTris.map(bounds),over=(a:[number,number,number,number],b:[number,number,number,number])=>a[0]<=b[2]+TOL.topologyKey&&a[2]>=b[0]-TOL.topologyKey&&a[1]<=b[3]+TOL.topologyKey&&a[3]>=b[1]-TOL.topologyKey;
  const fragments:Vec2[][]=[];
  for(let i=0;i<rTris.length;i++)for(let j=0;j<faceTris.length;j++){if(!over(rb[i],fb[j]))continue;const x=convexIntersection2(rTris[i],faceTris[j]);if(x.length>=3&&Math.abs(v2.area(x))>TOL.minimumFaceArea)fragments.push(x);}
  if(!fragments.length)return {region,fragments:[],components:[],area:0};
  const face=s.faces.get(faceId)!;const loops3=boundaryLoopsFromPolygons(fragments.map(p=>p.map(q=>fromPlane2(q,basis))),face.plane),classified=classifyPlaneLoops(loops3,face.plane);
  const components=classified.map(c=>({outer:c.outer.map(p=>toPlane2(p,basis)),holes:c.holes.map(h=>h.map(p=>toPlane2(p,basis)))}));
  const area=components.reduce((sum,c)=>sum+Math.abs(v2.area(c.outer))-c.holes.reduce((a,h)=>a+Math.abs(v2.area(h)),0),0);
  return {region,fragments,components,area};
}
function contourCandidateOnFace(s:Solid,faceId:FaceId,basis:PlaneBasis,candidate:Vec2[]):{region:Vec2[];components:{outer:Vec2[];holes:Vec2[][]}[];area:number}|null {
  try{const clipped=clipRegion2ToFace(s,faceId,basis,candidate);if(clipped.area<=TOL.minimumFaceArea)return null;return {region:clipped.region,components:clipped.components,area:clipped.area};}catch{return null;}
}
function resolveOpenFaceContour(s:Solid,faceId:FaceId,chain3Input:Vec3[]):{region:Vec3[];boundaryPath:Vec3[];loopKind:'outer'|'hole';clippedRegions:Vec3[][]} {
  const face=s.faces.get(faceId);if(!face)throw Error('Select a valid planar face.');const loops=faceLoopPoints(s,faceId),basis=planeBasis(face.plane,loops.outer[0]);
  const chain3:Vec3[]=[];for(const p of chain3Input){if(!chain3.length||V.len(V.sub(chain3[chain3.length-1],p))>=TOL.minimumEdge)chain3.push([...p] as Vec3);}if(chain3.length<2)throw Error('The edge-to-edge contour requires at least one segment.');
  for(const p of chain3)if(Math.abs(V.dot(face.plane.normal,p)-face.plane.offset)>TOL.plane)throw Error('The contour must lie in the plane of the selected face.');
  const chain2=chain3.map(p=>toPlane2(p,basis));if(openPolylineSelfIntersects2(chain2))throw Error('The contour self-intersects.');
  const start=faceBoundaryLocation(s,faceId,chain3[0]),end=faceBoundaryLocation(s,faceId,chain3[chain3.length-1]);if(!start||!end)throw Error('An open contour must start and end on an edge of the face.');if(start.loopIndex!==end.loopIndex)throw Error('Start and end must lie on the same connected face boundary.');if(v2.dist(chain2[0],chain2[chain2.length-1])<TOL.minimumEdge)throw Error('Start and end must be different points.');
  const loop3=[loops.outer,...loops.holes][start.loopIndex],loop2=loop3.map(p=>toPlane2(p,basis));const endToStartA=boundaryPathForward2(loop2,end,start),endToStartB=boundaryPathForward2(loop2,start,end).reverse();
  const options:{region:Vec2[];path:Vec2[];area:number;components:{outer:Vec2[];holes:Vec2[][]}[]}[]=[];for(const path of [endToStartA,endToStartB]){const candidate=[...chain2,...path.slice(1,-1)],clipped=contourCandidateOnFace(s,faceId,basis,candidate);if(clipped)options.push({region:clipped.region,path,area:clipped.area,components:clipped.components});}
  if(!options.length)throw Error('The polyline does not bound a valid region on the face.');options.sort((a,b)=>a.area-b.area);const chosen=options[0];return {region:chosen.region.map(p=>fromPlane2(p,basis)),boundaryPath:chosen.path.map(p=>fromPlane2(p,basis)),loopKind:start.kind,clippedRegions:chosen.components.map(c=>c.outer.map(p=>fromPlane2(p,basis)))};
}
function segmentsTouchOrCross2(a:Vec2,b:Vec2,c:Vec2,d:Vec2,eps:number):boolean {
  const ab=v2.dist(a,b),cd=v2.dist(c,d),tol=eps*Math.max(1,ab,cd),o1=v2.cross(a,b,c),o2=v2.cross(a,b,d),o3=v2.cross(c,d,a),o4=v2.cross(c,d,b);
  if(((o1>tol&&o2<-tol)||(o1<-tol&&o2>tol))&&((o3>tol&&o4<-tol)||(o3<-tol&&o4>tol)))return true;
  return (Math.abs(o1)<=tol&&pointOnSegment2(c,a,b,eps))||(Math.abs(o2)<=tol&&pointOnSegment2(d,a,b,eps))||(Math.abs(o3)<=tol&&pointOnSegment2(a,c,d,eps))||(Math.abs(o4)<=tol&&pointOnSegment2(b,c,d,eps));
}
function regionStrictlyEmbeddedInFace(s:Solid,faceId:FaceId,region2:Vec2[],basis:PlaneBasis):boolean {
  const loops=faceLoopPoints(s,faceId),all=[loops.outer,...loops.holes].map(loop=>loop.map(p=>toPlane2(p,basis))),outer=all[0],holes=all.slice(1),eps=Math.max(TOL.topologyKey*8,TOL.weld*32);
  const onLoop=(p:Vec2,loop:Vec2[])=>loop.some((a,i)=>pointOnSegment2(p,a,loop[(i+1)%loop.length],eps));
  for(const p of region2){if(!pointInPolygon2(p,outer)||onLoop(p,outer))return false;for(const h of holes)if(pointInPolygon2(p,h)||onLoop(p,h))return false;}
  for(let i=0;i<region2.length;i++){const a=region2[i],b=region2[(i+1)%region2.length];for(const loop of all)for(let j=0;j<loop.length;j++)if(segmentsTouchOrCross2(a,b,loop[j],loop[(j+1)%loop.length],eps))return false;}
  // A region surrounding an existing hole is not a simple embedded split; the
  // general subdivision path must own that topology change.
  for(const h of holes)if(h.length&&(pointInPolygon2(h[0],region2)||onLoop(h[0],region2)))return false;
  let tris:[number,number,number][];try{tris=triangulateSimple2(region2);}catch{return false;}
  for(const t of tris){const c:Vec2=[(region2[t[0]][0]+region2[t[1]][0]+region2[t[2]][0])/3,(region2[t[0]][1]+region2[t[1]][1]+region2[t[2]][1])/3];if(!pointInsideFaceDomain(s,faceId,fromPlane2(c,basis)))return false;}
  return true;
}
function splitEmbeddedFaceRegionDirect(s:Solid,faceId:FaceId,region3:Vec3[],kindLabel:string):{solid:Solid;regionFaceId:FaceId} {
  const support=s.faces.get(faceId);if(!support)throw Error('Select a valid planar face.');const out=cloneSolidFast(s),serial=`split${topologySerial++}`,regionId=`f_region_${serial}`,outerLoopId=`l_region_${serial}`,holeLoopId=`l_hole_${serial}`,n=region3.length;
  if(n<3)throw Error('The outline has too few points.');const vids=region3.map((p,i)=>{const id=`v_${serial}_${i+1}`;out.vertices.set(id,{id,position:[...p] as Vec3});return id;}),regionHE=region3.map((_,i)=>`he_region_${serial}_${i+1}`),holeHE=region3.map((_,i)=>`he_hole_${serial}_${i+1}`);
  out.loops.set(outerLoopId,{id:outerLoopId,kind:'outer',firstHalfEdge:regionHE[0]});out.loops.set(holeLoopId,{id:holeLoopId,kind:'hole',firstHalfEdge:holeHE[0]});
  out.faces.set(regionId,{id:regionId,plane:{normal:[...support.plane.normal] as Vec3,offset:support.plane.offset},outerLoop:outerLoopId,innerLoops:[],provenance:{kind:'split',label:kindLabel},boundaryGroup:`region:${serial}`});out.faces.get(faceId)!.innerLoops=[...out.faces.get(faceId)!.innerLoops,holeLoopId];
  for(let i=0;i<n;i++){
    out.halfEdges.set(regionHE[i],{id:regionHE[i],origin:vids[i],twin:holeHE[i],next:regionHE[(i+1)%n],prev:regionHE[(i+n-1)%n],loop:outerLoopId,face:regionId});
    // holeHE[i] is the exact reverse of regionHE[i]. The hole loop therefore
    // advances through decreasing edge indices.
    out.halfEdges.set(holeHE[i],{id:holeHE[i],origin:vids[(i+1)%n],twin:regionHE[i],next:holeHE[(i+n-1)%n],prev:holeHE[(i+1)%n],loop:holeLoopId,face:faceId});
  }
  validateSolid(out);return {solid:out,regionFaceId:regionId};
}
function splitFaceWithRegion(s:Solid,faceId:FaceId,region3Input:Vec3[],kindLabel='Sketch'): {solid:Solid; regionFaceId:FaceId; regionFaceIds?:FaceId[]} {
  const face=s.faces.get(faceId);if(!face)throw Error('Select a valid planar face.');if(region3Input.length<3)throw Error('The outline has too few points.');
  // Sketches live in the infinite support plane while they are being drawn.
  // The authoritative region is the 2D intersection with the actual face
  // domain. This makes rectangle/circle/contour tools obey one clipping rule.
  for(const p of region3Input)if(Math.abs(V.dot(face.plane.normal,p)-face.plane.offset)>TOL.plane)throw Error('The outline must lie in the plane of the selected face.');
  const oldLoops=faceLoopPoints(s,faceId),basis=planeBasis(face.plane,oldLoops.outer[0]),clipped=clipRegion2ToFace(s,faceId,basis,region3Input.map(p=>toPlane2(p,basis))),region2=clipped.region,region3=region2.map(p=>fromPlane2(p,basis));
  if(clipped.area<=TOL.minimumFaceArea||!clipped.fragments.length)throw Error('The outline does not intersect the selected face with a valid area.');
  // Fully embedded contours use the exact Euler split. Once a sketch touches or
  // crosses a face boundary, both retained region and remainder are rebuilt from
  // the same clipped planar partition so there are no special shape cases.
  if(regionStrictlyEmbeddedInFace(s,faceId,region2,basis))return splitEmbeddedFaceRegionDirect(s,faceId,region3,kindLabel);
  let remainder:Vec2[][]=triangulateFaceLocal(s,faceId).map(t=>{const q=t.map(p=>toPlane2(p,basis));if(v2.area(q)<0)q.reverse();return q;});
  const regionTris=triangulateSimple2(region2).map(t=>{const q=t.map(i=>region2[i]);if(v2.area(q)<0)q.reverse();return q;});
  const bounds=(p:Vec2[])=>{const xs=p.map(q=>q[0]),ys=p.map(q=>q[1]);return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)] as [number,number,number,number];},over=(a:[number,number,number,number],b:[number,number,number,number])=>a[0]<=b[2]+TOL.topologyKey&&a[2]>=b[0]-TOL.topologyKey&&a[1]<=b[3]+TOL.topologyKey&&a[3]>=b[1]-TOL.topologyKey;
  for(const rt of regionTris){const rtb=bounds(rt),next:Vec2[][]=[];for(const frag of remainder){if(!over(rtb,bounds(frag))){next.push(frag);continue;}next.push(...subtractConvex2(frag,rt));}remainder=next;}
  const serial='split'+topologySerial++,regionGroup='region:'+serial,regionId='f_region_'+serial,inputs:PolyFaceInput[]=[];
  for(const f of s.faces.values()){if(f.id===faceId)continue;for(const tri of triangulateFaceLocal(s,f.id))inputs.push({points:tri,group:f.boundaryGroup,provenance:f.provenance,faceIdHint:f.id});}
  for(const frag of remainder)inputs.push({points:frag.map(p=>fromPlane2(p,basis)),group:'remainder:'+serial,provenance:{kind:'split',label:'Support face'}});
  for(let i=0;i<clipped.fragments.length;i++)inputs.push({points:clipped.fragments[i].map(p=>fromPlane2(p,basis)),group:regionGroup,provenance:{kind:'split',label:kindLabel},faceIdHint:i===0?regionId:undefined});
  const out=buildSolidFromPolygons(inputs,s.id);validateSolid(out);const regionFaceIds=[...out.faces.values()].filter(f=>f.boundaryGroup===regionGroup).map(f=>f.id);if(!regionFaceIds.length)throw Error('Could not create the sketch region.');
  regionFaceIds.sort((a,b)=>faceAreaLocal(out,b)-faceAreaLocal(out,a));return {solid:out,regionFaceId:regionFaceIds[0],regionFaceIds};
}
function faceAreaLocal(s:Solid,faceId:FaceId):number {let a=0;for(const t of triangulateFaceLocal(s,faceId))a+=V.len(V.cross(V.sub(t[1],t[0]),V.sub(t[2],t[0])))/2;return a;}
function normalizeSolid(s:Solid):Solid {const out=buildSolidFromPolygons(solidToPolyInputs(s),s.id);validateSolid(out);return out;}
function findCoplanarFaceContaining(s:Solid,plane:Plane,p:Vec3):FaceId|null {let best:FaceId|null=null,bestArea=Infinity;for(const f of s.faces.values()){if(V.dot(f.plane.normal,plane.normal)<1-TOL.coplanarAngle)continue;if(Math.abs(f.plane.offset-plane.offset)>TOL.coplanarDistance*4)continue;if(pointInsideFaceDomain(s,f.id,p)){const a=faceAreaLocal(s,f.id);if(a<bestArea){best=f.id;bestArea=a;}}}return best;}
function faceContainsClosedOutlineBoundary(s:Solid,faceId:FaceId,region3:Vec3[]):boolean {
  const face=s.faces.get(faceId);if(!face||region3.length<3)return false;const loops=faceLoopPoints(s,faceId),basis=planeBasis(face.plane,loops.outer[0]),region2=region3.map(p=>toPlane2(p,basis)),boundary=[loops.outer,...loops.holes].map(loop=>loop.map(p=>toPlane2(p,basis)));
  const onDomain=(p:Vec3)=>pointInsideFaceDomain(s,faceId,p)||!!faceBoundaryLocation(s,faceId,p,Math.max(TOL.topologyKey*8,TOL.weld*32));
  for(let i=0;i<region3.length;i++){
    const a3=region3[i],b3=region3[(i+1)%region3.length],mid=V.mul(V.add(a3,b3),.5);if(!onDomain(a3)||!onDomain(mid))return false;
    const a=region2[i],b=region2[(i+1)%region2.length];for(const loop of boundary)for(let j=0;j<loop.length;j++)if(segmentIntersection2(a,b,loop[j],loop[(j+1)%loop.length]))return false;
  }
  return true;
}
function coplanarFaceComponent(s:Solid,seedFaceId:FaceId):FaceId[]{
  const seed=s.faces.get(seedFaceId);if(!seed)return [];const out:FaceId[]=[],seen=new Set<FaceId>([seedFaceId]),queue:FaceId[]=[seedFaceId];
  while(queue.length){const id=queue.shift()!,face=s.faces.get(id);if(!face)continue;out.push(id);for(const lid of [face.outerLoop,...face.innerLoops])for(const he of loopHalfEdges(s,lid)){const twin=he.twin?s.halfEdges.get(he.twin):null,other=twin?s.faces.get(twin.face):null;if(!other||seen.has(other.id))continue;if(V.dot(other.plane.normal,seed.plane.normal)<1-TOL.coplanarAngle||Math.abs(other.plane.offset-seed.plane.offset)>TOL.coplanarDistance*4)continue;seen.add(other.id);queue.push(other.id);}}
  return out;
}
function resolveClosedSketchSupportFace(s:Solid,seedFaceId:FaceId,region3:Vec3[]):FaceId {
  const seed=s.faces.get(seedFaceId);if(!seed)throw Error('Select a valid planar face.');if(region3.length<3)return seedFaceId;
  if(faceContainsClosedOutlineBoundary(s,seedFaceId,region3))return seedFaceId;
  const candidates=coplanarFaceComponent(s,seedFaceId).filter(id=>id!==seedFaceId&&faceContainsClosedOutlineBoundary(s,id,region3));if(!candidates.length)return seedFaceId;
  candidates.sort((a,b)=>faceAreaLocal(s,a)-faceAreaLocal(s,b)||a.localeCompare(b));return candidates[0];
}
function triangleCentroid(t:Vec3[]):Vec3{return V.mul(V.add(V.add(t[0],t[1]),t[2]),1/3);}
