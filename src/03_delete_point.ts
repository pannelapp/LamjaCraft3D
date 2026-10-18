// Explicit one-corner removal. Retained points never move; a planar cap closes
// the new boundary. Unsupported/nonconvex neighborhoods reject without fallback.
const POINT_DELETE_POLICY=Object.freeze({maximumFaces:2000,maximumVertices:1000,maximumHalfEdges:20000,maximumTriangles:2000,maximumComparisons:100000,volumeAbsoluteTolerance:1e-8,volumeRelativeTolerance:1e-8});
interface PointDeleteEdit {mode:'dissolve'|'flatten'|'trim';solid:Solid;vertexId:VertexId;faceId:FaceId|null;affectedFaceIds:FaceId[];removedFaceIds:FaceId[];volumeBefore:number;volumeAfter:number;}
type PointDeleteFailure={ok:false;reason:'selection'|'limit'|'plane'|'boundary'|'invalid';message:string};
type PointDeleteResult={ok:true;result:PointDeleteEdit}|PointDeleteFailure;
function deletePointSolid(s:Solid,vertexId:VertexId):PointDeleteResult {
  const reject=(reason:PointDeleteFailure['reason'],message:string):PointDeleteFailure=>({ok:false,reason,message}),vertex=s.vertices.get(vertexId);
  if(!vertex)return reject('selection','Choose an existing model point.');
  if(s.faces.size>POINT_DELETE_POLICY.maximumFaces||s.vertices.size>POINT_DELETE_POLICY.maximumVertices||s.halfEdges.size>POINT_DELETE_POLICY.maximumHalfEdges)return reject('limit','This object exceeds the bounded point-deletion size.');
  if(connectedSolidFaceComponents(s).length!==1)return reject('boundary','Point deletion currently requires one connected surface. Enclosed cavity shells and disconnected components are not supported.');
  const faces:ProjectSolid['faces']=[],affected:FaceId[]=[],removed:FaceId[]=[];let comparisons=0;
  for(const f of s.faces.values()){
    const loops=[loopVertexIds(s,f.outerLoop),...f.innerLoops.map(l=>loopVertexIds(s,l))];
    if(!loops.some(loop=>loop.includes(vertexId))){faces.push({id:f.id,outer:loops[0],holes:loops.slice(1),material:f.material,provenance:f.provenance,boundaryGroup:f.boundaryGroup});continue;}
    affected.push(f.id);
    for(let l=0;l<loops.length;l++){
      const loop=loops[l],i=loop.indexOf(vertexId);if(i<0)continue;
      const a=s.vertices.get(loop[(i+loop.length-1)%loop.length])!.position,b=vertex.position,c=s.vertices.get(loop[(i+1)%loop.length])!.position;
      const area=V.dot(V.cross(V.sub(b,a),V.sub(c,b)),f.plane.normal)/2;
      if(l>0&&Math.abs(area)>TOL.minimumFaceArea)return reject('boundary','A real hole-rim corner cannot be removed without filling material. Redundant rim points are supported.');
      if(l===0&&area < -TOL.minimumFaceArea)return reject('boundary','Deleting this concave corner would add material. Choose a convex or redundant point.');
    }
    const updated=loops.map(loop=>loop.filter(id=>id!==vertexId));
    if(updated.slice(1).some(loop=>loop.length<3))return reject('boundary','Deleting this point would collapse a hole.');
    if(updated[0].length<3){if(f.innerLoops.length)return reject('boundary','Deleting this point would collapse a perforated face.');removed.push(f.id);continue;}
    // Changed polygons must remain simple, retain their winding and contain all
    // source holes. Check touch as well as proper crossing at the existing budget.
    const basis=planeBasis(f.plane,s.vertices.get(updated[0][0])!.position),polys=updated.map(loop=>loop.map(id=>toPlane2(s.vertices.get(id)!.position,basis)));
    if(v2.area(polys[0])<=TOL.minimumFaceArea)return reject('boundary','Deleting this point would collapse or reverse a face.');
    for(let l=0;l<polys.length;l++)for(let m=l;m<polys.length;m++){
      const a=polys[l],b=polys[m];
      for(let i=0;i<a.length;i++)for(let j=l===m?i+1:0;j<b.length;j++){
        if(l===m&&(j===i+1||i===0&&j===a.length-1))continue;
        if(++comparisons>POINT_DELETE_POLICY.maximumComparisons)return reject('limit','The changed point boundaries exceed the checking budget.');
        const p=a[i],q=a[(i+1)%a.length],r=b[j],t=b[(j+1)%b.length];
        if(segmentIntersection2(p,q,r,t)||pointOnSegment2(p,r,t,TOL.topologyKey)||pointOnSegment2(q,r,t,TOL.topologyKey)||pointOnSegment2(r,p,q,TOL.topologyKey)||pointOnSegment2(t,p,q,TOL.topologyKey))return reject('boundary','Deleting this point would cross or touch a surrounding boundary or hole.');
      }
      if(l!==m&&l>0&&(pointInPolygon2(a[0],b)||pointInPolygon2(b[0],a)))return reject('boundary','Deleting this point would overlap hole boundaries.');
    }
    if(polys.slice(1).some(hole=>hole.some(p=>!pointInPolygon2(p,polys[0]))))return reject('boundary','Deleting this point would reach a surrounding hole.');
    faces.push({id:f.id,outer:updated[0],holes:updated.slice(1),material:f.material,provenance:f.provenance,boundaryGroup:f.boundaryGroup});
  }
  if(!affected.length)return reject('selection','The point is not used by a model face.');
  const used=new Set(faces.flatMap(f=>[...f.outer,...f.holes.flat()]));
  if([...s.vertices.keys()].some(id=>id!==vertexId&&!used.has(id)))return reject('boundary','Deleting this point would also remove another corner.');
  const incidence=new Map<string,[VertexId,VertexId][]>();
  for(const f of faces)for(const loop of [f.outer,...f.holes])for(let i=0;i<loop.length;i++){
    const a=loop[i],b=loop[(i+1)%loop.length],key=canonicalEdgeKey(a,b),list=incidence.get(key)||[];list.push([a,b]);incidence.set(key,list);
  }
  const outgoing=new Map<VertexId,VertexId>(),incoming=new Set<VertexId>();
  for(const list of incidence.values()){
    if(list.length===2){if(list[0][0]!==list[1][1]||list[0][1]!==list[1][0])return reject('boundary','The new boundaries have incompatible winding.');continue;}
    if(list.length!==1)return reject('boundary','The new boundaries would be non-manifold.');
    const [b,a]=list[0];if(outgoing.has(a)||incoming.has(b))return reject('boundary','This point does not leave one simple boundary.');outgoing.set(a,b);incoming.add(b);
  }
  let faceId:FaceId|null=null,mode:PointDeleteEdit['mode']='dissolve';
  if(outgoing.size){
    const boundary:VertexId[]=[],start=outgoing.keys().next().value!;let at=start;
    do{const dest=outgoing.get(at);if(!dest)return reject('boundary','The new boundary does not close.');boundary.push(at);outgoing.delete(at);at=dest;}while(at!==start);
    if(outgoing.size||boundary.length<3)return reject('boundary','This point leaves multiple or collapsed boundaries.');
    const points=boundary.map(id=>s.vertices.get(id)!.position),plane=planeFromPoints(points),distance=V.dot(plane.normal,vertex.position)-plane.offset;
    if(V.len(plane.normal)===0||points.some(p=>Math.abs(V.dot(plane.normal,p)-plane.offset)>TOL.plane))return reject('plane','The neighboring points cannot form one flat closing face. Merge suitable coplanar subdivisions first.');
    if(distance < -TOL.plane)return reject('plane','Deleting this point would add material at a concave corner.');
    const basis=planeBasis(plane,points[0]),polygon=points.map(p=>toPlane2(p,basis));
    for(let i=0;i<polygon.length;i++)for(let j=i+1;j<polygon.length;j++){
      if(j===i+1||i===0&&j===polygon.length-1)continue;
      if(++comparisons>POINT_DELETE_POLICY.maximumComparisons)return reject('limit','The closing boundary exceeds the checking budget.');
      const a=polygon[i],b=polygon[(i+1)%polygon.length],c=polygon[j],d=polygon[(j+1)%polygon.length];
      if(segmentIntersection2(a,b,c,d)||pointOnSegment2(a,c,d,TOL.topologyKey)||pointOnSegment2(b,c,d,TOL.topologyKey)||pointOnSegment2(c,a,b,TOL.topologyKey)||pointOnSegment2(d,a,b,TOL.topologyKey))return reject('boundary','The closing boundary would cross or touch itself.');
    }
    mode=distance>TOL.plane?'trim':'flatten';
    const ids=[...affected].sort((a,b)=>faceAreaLocal(s,b)-faceAreaLocal(s,a)||a.localeCompare(b,undefined,{numeric:true})),reference=s.faces.get(ids[0])!;
    if(removed.length)faceId=[...removed].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))[0];
    else{let index=Math.max(0,...[...s.faces.keys()].map(id=>Number(/^f(\d+)$/.exec(id)?.[1]||0)))+1;while(s.faces.has(`f${index}`))index++;faceId=`f${index}`;}
    faces.push({id:faceId,outer:boundary,holes:[],material:reference.material,provenance:{kind:'boolean',label:'Delete point'},boundaryGroup:`point-delete:${faceId}`});
  }
  try{
    const before=validateSolid(s),solid=deserializeProjectSolid({schema:'poly-brep-1',id:s.id,metadata:structuredClone(s.metadata),vertices:[...used].map(id=>({id,position:[...s.vertices.get(id)!.position] as Vec3})),faces});
    if(faceId){
      const face=solid.faces.get(faceId)!,boundary=loopVertexIds(solid,face.outerLoop),ids=new Set(boundary),basis=planeBasis(face.plane),polygon=boundary.map(id=>toPlane2(solid.vertices.get(id)!.position,basis));
      // A closing face must not touch an unrelated retained vertex in its
      // interior/on its edges. Proper segment crossings alone miss tangency.
      for(const v of solid.vertices.values())if(!ids.has(v.id)&&Math.abs(V.dot(face.plane.normal,v.position)-face.plane.offset)<=TOL.plane){
        const point=toPlane2(v.position,basis);let touch=pointInPolygon2(point,polygon);
        for(let i=0;!touch&&i<polygon.length;i++){if(++comparisons>POINT_DELETE_POLICY.maximumComparisons)return reject('limit','The closing face exceeds the contact-check budget.');touch=pointOnSegment2(point,polygon[i],polygon[(i+1)%polygon.length],TOL.topologyKey);}
        if(touch)return reject('boundary','The closing face would touch another model point.');
      }
      const triangles:Vec3[][]=[],cap:Vec3[][]=[];
      for(const f of solid.faces.values()){const ts=triangulateFaceLocal(solid,f.id,undefined,'canonical');triangles.push(...ts);if(f.id===faceId)cap.push(...ts);if(triangles.length>POINT_DELETE_POLICY.maximumTriangles)return reject('limit','The closing face exceeds the surface-check triangle budget.');}
      for(const tri of cap){const bounds=textureBandBounds3(tri);for(const other of triangles){if(tri===other)continue;if(++comparisons>POINT_DELETE_POLICY.maximumComparisons)return reject('limit','The closing face exceeds the surface-check comparison budget.');const ob=textureBandBounds3(other);if(bounds.min.some((v,i)=>v>ob.max[i]+TOL.plane||bounds.max[i]<ob.min[i]-TOL.plane))continue;if(pointMoveTrianglesCross(tri,other))return reject('boundary','The closing face would cross another model surface.');}}
    }
    solidMeshExportLocal(solid);const after=validateSolid(solid),budget=Math.max(POINT_DELETE_POLICY.volumeAbsoluteTolerance,before.volume*POINT_DELETE_POLICY.volumeRelativeTolerance),difference=before.volume-after.volume;
    if(mode==='trim'?difference<=budget:Math.abs(difference)>budget)return reject('invalid',mode==='trim'?'This cut does not remove a measurable amount of material.':'This point cannot be removed without changing the shape unexpectedly.');
    return {ok:true,result:{mode,solid,vertexId,faceId,affectedFaceIds:affected,removedFaceIds:removed,volumeBefore:before.volume,volumeAfter:after.volume}};
  }catch(error){return reject('invalid',`The point deletion failed geometry/export checks: ${errorMessage(error)}`);}
}
