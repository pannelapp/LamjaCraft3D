// Certified face-plane offsets for nonprismatic concave shells. This path keeps
// incidence only when the requested offset still has that topology. It never
// substitutes a fitted corner, clamps a wall, or accepts an unchecked mesh.
const CARVE_SPATIAL_POLICY=Object.freeze({normalRankTolerance:1e-10,segmentPlaneDenominatorTolerance:1e-12,planeResidualTolerance:TOL.plane,contactTolerance:TOL.plane,clearanceTolerance:TOL.plane*4,maximumTriangles:8000,maximumTrianglePairs:4000000,progressInterval:32});
interface CarveSpatialTriangle {points:Vec3[];faceId:FaceId;bounds:Bounds3;}
interface CarveSpatialContacts {vertices:Vec3[];edges:[Vec3,Vec3][];}
type CarveSpatialResult={ok:true;polygons:CSGPolygon[];stats:CarveOutStats}|{ok:false;message:string};
function carveOffsetPoint3(position:Vec3,planes:Plane[]):Vec3|null{
  if(!planes.length)return null;
  const a=planes[0],b=planes.reduce((best,p)=>V.len(V.cross(a.normal,p.normal))>V.len(V.cross(a.normal,best.normal))?p:best,a),ab=V.cross(a.normal,b.normal),c=planes.reduce((best,p)=>Math.abs(V.dot(ab,p.normal))>Math.abs(V.dot(ab,best.normal))?p:best,a),det=V.dot(ab,c.normal),rhs=(p:Plane)=>p.offset-V.dot(p.normal,position);let delta:Vec3;
  if(Math.abs(det)>CARVE_SPATIAL_POLICY.normalRankTolerance)delta=V.mul(V.add(V.add(V.mul(V.cross(b.normal,c.normal),rhs(a)),V.mul(V.cross(c.normal,a.normal),rhs(b))),V.mul(ab,rhs(c))),1/det);
  else if(V.len(ab)>CARVE_SPATIAL_POLICY.normalRankTolerance){const dot=V.dot(a.normal,b.normal),den=V.dot(ab,ab);delta=V.add(V.mul(a.normal,(rhs(a)-dot*rhs(b))/den),V.mul(b.normal,(rhs(b)-dot*rhs(a))/den));}
  else delta=V.mul(a.normal,rhs(a));
  const point=V.add(position,delta);return point.every(Number.isFinite)&&planes.every(p=>Math.abs(V.dot(p.normal,point)-p.offset)<=CARVE_SPATIAL_POLICY.planeResidualTolerance)?point:null;
}
function carveSpatialMeshTriangles(mesh:Mesh):CarveSpatialTriangle[]{return mesh.triangles.map((t,i)=>{const points=t.map(v=>mesh.vertices[v]);return {points,faceId:mesh.face[i],bounds:{min:[0,1,2].map(axis=>Math.min(...points.map(p=>p[axis]))) as Vec3,max:[0,1,2].map(axis=>Math.max(...points.map(p=>p[axis]))) as Vec3}};});}
function carveSpatialBoundsOverlap(a:Bounds3,b:Bounds3,pad:number):boolean{return a.min.every((x,i)=>x<=b.max[i]+pad&&a.max[i]>=b.min[i]-pad);}
function carveSpatialPointSegmentDistance(p:Vec3,a:Vec3,b:Vec3):number{const d=V.sub(b,a),length2=V.dot(d,d),t=length2?clamp(V.dot(V.sub(p,a),d)/length2,0,1):0;return V.len(V.sub(p,V.add(a,V.mul(d,t))));}
function carveSpatialPointTriangleDistance(p:Vec3,t:Vec3[]):number{
  const [a,b,c]=t,u=V.sub(b,a),v=V.sub(c,a),n=V.cross(u,v),n2=V.dot(n,n),height=V.dot(n,V.sub(p,a)),q=V.sub(p,V.mul(n,height/n2));
  if(t.every((a,i)=>V.dot(V.cross(V.sub(t[(i+1)%3],a),V.sub(q,a)),n)>=0))return Math.abs(height)/Math.sqrt(n2);
  return Math.min(...t.map((a,i)=>carveSpatialPointSegmentDistance(p,a,t[(i+1)%3])));
}
function carveSpatialSegmentDistance(a:Vec3,b:Vec3,c:Vec3,d:Vec3):number{
  const u=V.sub(b,a),v=V.sub(d,c),w=V.sub(a,c),cross=V.cross(u,v),den=V.dot(cross,cross);
  let distance=Math.min(carveSpatialPointSegmentDistance(a,c,d),carveSpatialPointSegmentDistance(b,c,d),carveSpatialPointSegmentDistance(c,a,b),carveSpatialPointSegmentDistance(d,a,b));
  if(den>0){const s=V.dot(V.cross(v,w),cross)/den,t=V.dot(V.cross(u,w),cross)/den;if(s>=0&&s<=1&&t>=0&&t<=1)distance=Math.min(distance,V.len(V.sub(V.add(a,V.mul(u,s)),V.add(c,V.mul(v,t)))));}return distance;
}
function carveSpatialSegmentTriangleContacts(a:Vec3,b:Vec3,t:Vec3[]):Vec3[]{
  const n=V.unit(V.cross(V.sub(t[1],t[0]),V.sub(t[2],t[0]))),da=V.dot(n,V.sub(a,t[0])),db=V.dot(n,V.sub(b,t[0])),eps=CARVE_SPATIAL_POLICY.contactTolerance;
  if(Math.abs(da)<=eps&&Math.abs(db)<=eps){
    let lo=0,hi=1;
    for(let i=0;i<3;i++){const p=t[i],q=t[(i+1)%3],inward=V.unit(V.cross(n,V.sub(q,p))),x=V.dot(inward,V.sub(a,p)),y=V.dot(inward,V.sub(b,p));
      if(x< -eps&&y< -eps)return [];if(x>=0&&y>=0)continue;const delta=y-x;if(Math.abs(delta)<=CARVE_SPATIAL_POLICY.segmentPlaneDenominatorTolerance){if(x< -eps)return [];continue;}const cut=-x/delta;if(delta>0)lo=Math.max(lo,cut);else hi=Math.min(hi,cut);if(lo>hi)return [];
    }return lo<=hi?[V.lerp(a,b,clamp(lo,0,1)),V.lerp(a,b,clamp(hi,0,1))]:[];
  }
  if(da>eps&&db>eps||da< -eps&&db< -eps)return [];
  const delta=da-db;if(Math.abs(delta)<=CARVE_SPATIAL_POLICY.segmentPlaneDenominatorTolerance)return [];const fraction=da/delta;if(fraction<0||fraction>1)return [];const p=V.lerp(a,b,fraction);
  return t.every((q,i)=>V.dot(V.cross(V.sub(t[(i+1)%3],q),V.sub(p,q)),n)>=-eps*V.len(V.sub(t[(i+1)%3],q)))?[p]:[];
}
function carveSpatialTriangleContacts(a:Vec3[],b:Vec3[]):Vec3[]{const out:Vec3[]=[];for(let i=0;i<3;i++)out.push(...carveSpatialSegmentTriangleContacts(a[i],a[(i+1)%3],b),...carveSpatialSegmentTriangleContacts(b[i],b[(i+1)%3],a));return out;}
function carveSpatialTriangleDistance(a:Vec3[],b:Vec3[]):number{
  if(carveSpatialTriangleContacts(a,b).length)return 0;let distance=Infinity;
  for(let i=0;i<3;i++){distance=Math.min(distance,carveSpatialPointTriangleDistance(a[i],b),carveSpatialPointTriangleDistance(b[i],a));for(let j=0;j<3;j++)distance=Math.min(distance,carveSpatialSegmentDistance(a[i],a[(i+1)%3],b[j],b[(j+1)%3]));}return distance;
}
function carveSpatialCoplanarOverlapArea(a:Vec3[],b:Vec3[],plane:Plane):number{
  const basis=planeBasis(plane,a[0]),clip=b.map(p=>toPlane2(p,basis));if(v2.area(clip)<0)clip.reverse();let out=a.map(p=>toPlane2(p,basis));
  for(let i=0;i<3&&out.length;i++){const p=clip[i],q=clip[(i+1)%3],next:Vec2[]=[];for(let j=0;j<out.length;j++){const a=out[j],b=out[(j+1)%out.length],x=v2.cross(p,q,a),y=v2.cross(p,q,b);if(x>=0)next.push(a);if(x>=0&&y<0||x<0&&y>=0){const t=x/(x-y);next.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}}out=next;}return Math.abs(v2.area(out));
}
function carveSpatialRingsValid(s:Solid):boolean{
  const eps=CARVE_SPATIAL_POLICY.contactTolerance;
  for(const face of s.faces.values()){
    const loops=faceLoopPoints(s,face.id),basis=planeBasis(face.plane,loops.outer[0]),rings=[loops.outer,...loops.holes].map(r=>r.map(p=>toPlane2(p,basis)));
    for(let k=0;k<rings.length;k++){
      const r=rings[k];if(polygonSelfIntersects(r))return false;
      if(k&&r.some(p=>!pointInPolygon2(p,rings[0])))return false;
      for(let j=0;j<k;j++)if(j&&pointInPolygon2(r[0],rings[j])||j&&pointInPolygon2(rings[j][0],r))return false;
      for(let l=0;l<=k;l++)for(let i=0;i<r.length;i++)for(let j=0;j<rings[l].length;j++){
        if(l===k&&(j<=i||j===i+1||i===0&&j===r.length-1))continue;const a=r[i],b=r[(i+1)%r.length],c=rings[l][j],d=rings[l][(j+1)%rings[l].length];
        if(segmentIntersection2(a,b,c,d)||pointOnSegment2(a,c,d,eps)||pointOnSegment2(b,c,d,eps)||pointOnSegment2(c,a,b,eps)||pointOnSegment2(d,a,b,eps))return false;
      }
    }
  }return true;
}
function carveSpatialPairKey(a:FaceId,b:FaceId):string{return JSON.stringify(a<b?[a,b]:[b,a]);}
function carveSpatialAllowedContacts(s:Solid):Map<string,CarveSpatialContacts>{
  const incident=new Map<VertexId,Set<FaceId>>(),allowed=new Map<string,CarveSpatialContacts>(),record=(a:FaceId,b:FaceId)=>{const key=carveSpatialPairKey(a,b);let entry=allowed.get(key);if(!entry){entry={vertices:[],edges:[]};allowed.set(key,entry);}return entry;};
  for(const e of s.halfEdges.values()){const faces=incident.get(e.origin)||new Set<FaceId>();faces.add(e.face);incident.set(e.origin,faces);const twin=s.halfEdges.get(e.twin);if(twin&&e.id<twin.id)record(e.face,twin.face).edges.push([s.vertices.get(e.origin)!.position,s.vertices.get(s.halfEdges.get(e.next)!.origin)!.position]);}
  for(const [id,faces] of incident){const list=[...faces];for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++)record(list[i],list[j]).vertices.push(s.vertices.get(id)!.position);}return allowed;
}
function carveSpatialSurfaceCheck(s:Solid,triangles:CarveSpatialTriangle[],work:{pairs:number}):string|null{
  const allowed=carveSpatialAllowedContacts(s),eps=CARVE_SPATIAL_POLICY.contactTolerance;
  for(let i=0;i<triangles.length;i++)for(let j=i+1;j<triangles.length;j++){
    const a=triangles[i],b=triangles[j];if(!carveSpatialBoundsOverlap(a.bounds,b.bounds,eps))continue;
    if(++work.pairs>CARVE_SPATIAL_POLICY.maximumTrianglePairs)return 'The 3D shell exceeds the surface-check work limit. Simplify the object first.';
    if(a.faceId===b.faceId){if(carveSpatialCoplanarOverlapArea(a.points,b.points,s.faces.get(a.faceId)!.plane)>TOL.minimumFaceArea)return 'The offset would overlap triangles inside a face.';continue;}
    const contacts=carveSpatialTriangleContacts(a.points,b.points),shared=allowed.get(carveSpatialPairKey(a.faceId,b.faceId));
    for(const p of contacts)if(!shared||!shared.vertices.some(v=>V.len(V.sub(p,v))<=eps)&&!shared.edges.some(([a,b])=>carveSpatialPointSegmentDistance(p,a,b)<=eps))return 'The offset would make nonadjacent surfaces touch or cross. Reduce Wall thickness.';
  }return null;
}
function carveSpatialCavity(s:Solid,openingFaceId:FaceId,planes:CarvePlaneConstraint[],wall:number,openExtension:number,sourceMesh:Mesh,sourceVolume:number,report:(progress:number,message:string)=>void):CarveSpatialResult{
  const reject=(message:string):CarveSpatialResult=>({ok:false,message}),opening=s.faces.get(openingFaceId)!,n=V.unit(opening.plane.normal),openingOffset=opening.plane.offset/V.len(opening.plane.normal),eps=CARVE_SPATIAL_POLICY.contactTolerance;
  if(solidShellCount(s)!==1)return reject('The 3D offset requires one connected source boundary without sealed internal cavities.');
  if([...s.vertices.values()].some(v=>V.dot(n,v.position)>openingOffset+eps))return reject('Choose an outer supporting face as the opening; recessed openings are not supported by this 3D offset.');
  const offsets=new Map<FaceId,number>();for(const p of planes)for(const id of p.sourceFaceIds||[p.sourceFaceId!])offsets.set(id,p.opening?0:wall+p.extraInset);
  const inner=cloneSolid(s),incident=new Map<VertexId,Set<FaceId>>();for(const e of s.halfEdges.values()){const faces=incident.get(e.origin)||new Set<FaceId>();faces.add(e.face);incident.set(e.origin,faces);}
  for(const face of inner.faces.values()){const length=V.len(face.plane.normal),inset=offsets.get(face.id);if(inset===undefined)throw Error('Carve Out is missing an inward constraint for a source face.');face.plane={normal:V.mul(face.plane.normal,1/length),offset:face.plane.offset/length-inset};}
  report(22,'Intersecting inward face planes…');
  for(const vertex of inner.vertices.values()){
    const local=[...(incident.get(vertex.id)||[])].map(id=>inner.faces.get(id)!.plane),point=carveOffsetPoint3(vertex.position,local);if(!point)return reject('The incident inward planes cannot meet at one corner. This offset needs a topology change; reduce Wall thickness or simplify that junction.');vertex.position=point;
  }
  const vertices=[...inner.vertices.values()];for(let i=0;i<vertices.length;i++)for(let j=i+1;j<vertices.length;j++)if(V.len(V.sub(vertices[i].position,vertices[j].position))<TOL.minimumEdge)return reject('The offset would merge distinct corners. Reduce Wall thickness.');
  for(const edge of s.halfEdges.values()){const next=s.halfEdges.get(edge.next)!,before=V.sub(s.vertices.get(next.origin)!.position,s.vertices.get(edge.origin)!.position),after=V.sub(inner.vertices.get(next.origin)!.position,inner.vertices.get(edge.origin)!.position);if(V.dot(before,after)<=TOL.minimumEdge*V.len(before))return reject('A 3D offset edge collapses or reverses at this thickness. Reduce Wall thickness.');}
  if(!carveSpatialRingsValid(inner))return reject('An inward face boundary would cross or collapse. Reduce Wall thickness.');
  const captured:{mesh:Mesh|null}={mesh:null},validation=validateSolid(inner,false,mesh=>captured.mesh=mesh);if(!validation.ok||!captured.mesh)return reject(`The inward shell is invalid. ${validation.errors[0]||''}`.trim());
  if(!(validation.volume>TOL.minimumFaceArea&&validation.volume<sourceVolume))return reject('The inward shell has no valid removable volume. Reduce Wall thickness.');
  const innerTriangles=carveSpatialMeshTriangles(captured.mesh),sourceTriangles=carveSpatialMeshTriangles(sourceMesh),work={pairs:0};
  if(Math.max(innerTriangles.length,sourceTriangles.length)>CARVE_SPATIAL_POLICY.maximumTriangles)return reject('The 3D shell exceeds the triangle-check limit. Simplify the object first.');
  report(28,'Checking inward surface intersections…');const sourceProblem=carveSpatialSurfaceCheck(s,sourceTriangles,work),innerProblem=sourceProblem||carveSpatialSurfaceCheck(inner,innerTriangles,work);if(innerProblem)return reject(innerProblem);
  for(let i=0;i<innerTriangles.length;i++){
    const a=innerTriangles[i];for(const b of sourceTriangles){if(b.faceId===openingFaceId||!carveSpatialBoundsOverlap(a.bounds,b.bounds,wall))continue;if(++work.pairs>CARVE_SPATIAL_POLICY.maximumTrianglePairs)return reject('The 3D shell exceeds the wall-clearance work limit. Simplify the object first.');if(carveSpatialTriangleDistance(a.points,b.points)+CARVE_SPATIAL_POLICY.clearanceTolerance<wall)return reject('The inward shell reaches another surface before the requested wall thickness. Reduce Wall thickness.');}
    if(i%CARVE_SPATIAL_POLICY.progressInterval===0)report(32+12*i/Math.max(1,innerTriangles.length),'Checking complete wall clearance…');
  }
  // This exact Boolean containment check complements boundary separation; it
  // also excludes an inverted/enclosing cavity without relying on sampled rays.
  const closed=innerTriangles.map(t=>csgPolygon(t.points));report(46,'Checking inner volume containment…');if(csgSubtractOwned(closed.map(cloneCsgPoly),solidToCsg(s)).length)return reject('The inward shell is not completely inside the source. Reduce Wall thickness.');
  const polygons:CSGPolygon[]=[];for(const t of innerTriangles)if(t.faceId!==openingFaceId)polygons.push(csgPolygon(t.points));else polygons.push(csgPolygon(t.points.map(p=>V.add(p,V.mul(n,openExtension)))));
  const rim=loopPoints(inner,inner.faces.get(openingFaceId)!.outerLoop);for(let i=0;i<rim.length;i++){const a=rim[i],b=rim[(i+1)%rim.length];polygons.push(csgPolygon([a,b,V.add(b,V.mul(n,openExtension)),V.add(a,V.mul(n,openExtension))]));}
  const unique:Plane[]=[],keys=new Set<string>();for(const p of polygons){if(!unique.some(q=>carvePlaneSame(p.plane,q,TOL.coplanarAngle,TOL.plane)))unique.push(p.plane);for(const v of p.vs)keys.add(carvePointKey(v,TOL.topologyKey));}
  report(50,'Certified 3D inner shell ready');return {ok:true,polygons,stats:{sourcePlanes:planes.length,cavityPlanes:unique.length,cavityVertices:keys.size,cavityFaces:polygons.length,simplifiedPlanes:planes.filter(p=>!p.opening&&p.extraInset>TOL.minimumEdge).length}};
}

// An angled opening rim needs true adjacent-plane setbacks rather than a
// uniform 2D inset. Visit only the opening's corner fans, never the whole solid.
function carveSpatialOpeningGuide(s:Solid,faceId:FaceId,wall:number):{applicable:false}|{applicable:true;loop:Vec3[]|null}{
  const face=s.faces.get(faceId);if(!face)return {applicable:true,loop:null};const rim=loopHalfEdges(s,face.outerLoop),n=V.unit(face.plane.normal);
  if(rim.every(e=>{const twin=s.halfEdges.get(e.twin),other=twin&&s.faces.get(twin.face);return !!other&&Math.abs(V.dot(V.unit(other.plane.normal),n))<=TOL.coplanarAngle;}))return {applicable:false};
  const out:Vec3[]=[];
  for(const start of rim){
    const visited=new Set<HalfEdgeId>(),planes:Plane[]=[];let edge=start;
    while(!visited.has(edge.id)){
      visited.add(edge.id);const f=s.faces.get(edge.face);if(!f)return {applicable:true,loop:null};const length=V.len(f.plane.normal);planes.push({normal:V.mul(f.plane.normal,1/length),offset:f.plane.offset/length-(f.id===faceId?0:wall)});
      const prev=s.halfEdges.get(edge.prev),next=prev&&s.halfEdges.get(prev.twin);if(!next||next.origin!==start.origin)return {applicable:true,loop:null};edge=next;
    }
    if(edge.id!==start.id)return {applicable:true,loop:null};const p=carveOffsetPoint3(s.vertices.get(start.origin)!.position,planes);if(!p)return {applicable:true,loop:null};out.push(p);
  }
  const basis=planeBasis(face.plane,out[0]),flat=out.map(p=>toPlane2(p,basis)),original=loopPoints(s,face.outerLoop).map(p=>toPlane2(p,basis));
  if(v2.area(flat)<=TOL.minimumFaceArea||polygonSelfIntersects(flat)||flat.some(p=>!pointInPolygon2(p,original)))return {applicable:true,loop:null};
  return {applicable:true,loop:out};
}
