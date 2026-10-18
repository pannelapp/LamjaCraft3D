// Explicit local shape editing. Keep every surrounding supporting plane and
// solve common boundary points against the chosen plane, rather than moving
// independent copies of vertices or allowing changes to propagate indefinitely.
const MERGE_FACES_POLICY = Object.freeze({
  maximumSelectedFaces:512,
  maximumSolidFaces:10000,
  maximumHalfEdges:100000,
  maximumIntersectionPairs:1000000,
  constraintRankTolerance:1e-8,
  minimumMovedDistance:1e-9,
  unchangedVolumeAbsoluteTolerance:1e-8,
  unchangedVolumeRelativeTolerance:1e-8,
  constraintOrthogonalizationPasses:2,
  minimumReferenceAlignment:0.5,
  defaultMaximumAdjustment:0.1,
});
interface MergeFacesParameters {
  referenceFaceId?:FaceId;
  adjustNeighbors:boolean;
  maximumAdjustment:number;
}
interface MergeFacesEdit {
  solid:Solid;faceId:FaceId;referenceFaceId:FaceId;selectedFaceIds:FaceId[];
  movedVertices:{id:VertexId;from:Vec3;to:Vec3}[];
  affectedFaceIds:FaceId[];maximumMovement:number;volumeBefore:number;volumeAfter:number;
}
type MergeFacesResult =
  | {ok:true;result:MergeFacesEdit}
  | {ok:false;reason:'selection'|'limit'|'plane'|'boundary'|'invalid';message:string};

function mergeFacesConstrainedPoint(point:Vec3,planes:readonly Plane[]):Vec3|null {
  if(planes.every(p=>Math.abs(V.dot(p.normal,point)-p.offset)<=MERGE_FACES_POLICY.minimumMovedDistance))return [...point];
  const rows:{normal:Vec3;offset:number}[]=[];
  for(const plane of planes){
    let normal:[number,number,number]=[...plane.normal],offset=plane.offset;
    for(let pass=0;pass<MERGE_FACES_POLICY.constraintOrthogonalizationPasses;pass++)for(const row of rows){
      const coefficient=V.dot(normal,row.normal);
      normal=V.sub(normal,V.mul(row.normal,coefficient));offset-=coefficient*row.offset;
    }
    const length=V.len(normal);
    if(length<=MERGE_FACES_POLICY.constraintRankTolerance)continue;
    if(rows.length===3)return null;
    rows.push({normal:V.mul(normal,1/length),offset:offset/length});
  }
  let result:Vec3=[...point];
  for(const row of rows)result=V.add(result,V.mul(row.normal,row.offset-V.dot(row.normal,point)));
  if(result.some(x=>!Number.isFinite(x))||planes.some(p=>Math.abs(V.dot(p.normal,result)-p.offset)>TOL.plane))return null;
  return result;
}

function mergeFacesSolid(s:Solid,faceIds:readonly FaceId[],parameters:MergeFacesParameters):MergeFacesResult {
  const reject=(reason:Extract<MergeFacesResult,{ok:false}>['reason'],message:string):MergeFacesResult=>({ok:false,reason,message});
  const ids=[...new Set(faceIds)].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),selected=new Set(ids);
  if(ids.length<2||ids.some(id=>!s.faces.has(id)))return reject('selection','Select at least two existing faces on one object.');
  if(ids.length>MERGE_FACES_POLICY.maximumSelectedFaces||s.faces.size>MERGE_FACES_POLICY.maximumSolidFaces||s.halfEdges.size>MERGE_FACES_POLICY.maximumHalfEdges)return reject('limit','This face merge exceeds the bounded local-edit size. Use a smaller object or face selection.');
  if(typeof parameters.adjustNeighbors!=='boolean'||!Number.isFinite(parameters.maximumAdjustment)||parameters.maximumAdjustment<0)return reject('limit','Maximum adjustment must be a finite, non-negative distance in mm.');
  if(parameters.referenceFaceId&&!selected.has(parameters.referenceFaceId))return reject('selection','The reference plane must belong to a selected face.');
  const referenceFaceId=parameters.referenceFaceId||ids.slice().sort((a,b)=>faceAreaLocal(s,b)-faceAreaLocal(s,a)||a.localeCompare(b,undefined,{numeric:true}))[0];
  const reference=s.faces.get(referenceFaceId)!,plane=reference.plane;
  if(ids.some(id=>V.dot(s.faces.get(id)!.plane.normal,plane.normal)<MERGE_FACES_POLICY.minimumReferenceAlignment))return reject('plane','Select faces facing the same side; this selection bends too far around the object.');
  const faceEdges=new Map<FaceId,HalfEdge[]>();
  for(const id of ids){const f=s.faces.get(id)!;faceEdges.set(id,[f.outerLoop,...f.innerLoops].flatMap(lid=>loopHalfEdges(s,lid)));}
  const reached=new Set<FaceId>([ids[0]]),queue=[ids[0]];
  for(let q=0;q<queue.length;q++)for(const he of faceEdges.get(queue[q])!){const neighbor=s.halfEdges.get(he.twin)?.face;if(neighbor&&selected.has(neighbor)&&!reached.has(neighbor)){reached.add(neighbor);queue.push(neighbor);}}
  if(reached.size!==selected.size)return reject('selection','Selected faces must form one connected area through shared edges.');
  const outgoing=new Map<VertexId,VertexId>(),incoming=new Set<VertexId>();
  for(const edges of faceEdges.values())for(const he of edges){
    const twin=s.halfEdges.get(he.twin);if(!twin)return reject('invalid','The source solid contains an open edge.');
    if(selected.has(twin.face))continue;
    const dest=s.halfEdges.get(he.next)!.origin;
    if(outgoing.has(he.origin)||incoming.has(dest))return reject('boundary','The selected area has a branching boundary. Select a simpler connected area.');
    outgoing.set(he.origin,dest);incoming.add(dest);
  }
  const loops:VertexId[][]=[];
  while(outgoing.size){
    const start=outgoing.keys().next().value!,loop:VertexId[]=[];let current=start;
    do {const next=outgoing.get(current);if(next===undefined)return reject('boundary','The selected boundary does not close.');loop.push(current);outgoing.delete(current);current=next;}while(current!==start);
    if(loop.length<3)return reject('boundary','The selected area has a degenerate boundary.');loops.push(loop);
  }
  if(!loops.length)return reject('boundary','The selection has no outer boundary.');
  const boundary=new Set(loops.flat()),support=new Map<VertexId,Plane[]>(),affected=new Set<FaceId>();
  for(const f of s.faces.values())if(!selected.has(f.id))for(const lid of [f.outerLoop,...f.innerLoops])for(const he of loopHalfEdges(s,lid))if(boundary.has(he.origin)){
    const list=support.get(he.origin)||[];if(!list.includes(f.plane))list.push(f.plane);support.set(he.origin,list);
  }
  const positions=new Map<VertexId,Vec3>([...s.vertices].map(([id,v])=>[id,[...v.position] as Vec3]));
  const movedVertices:MergeFacesEdit['movedVertices']=[];let maximumMovement=0;
  if(!parameters.adjustNeighbors){
    if(ids.some(id=>faceEdges.get(id)!.some(he=>Math.abs(V.dot(plane.normal,s.vertices.get(he.origin)!.position)-plane.offset)>TOL.plane)))return reject('plane','The faces do not share one plane. Enable Adjust neighboring faces and preview the shape change.');
  }else for(const id of boundary){
    const from=s.vertices.get(id)!.position,to=mergeFacesConstrainedPoint(from,[plane,...support.get(id)||[]]);
    if(!to)return reject('plane','The reference plane cannot meet every surrounding face. Choose another reference plane or include more faces.');
    const distance=V.len(V.sub(to,from));
    if(distance<=MERGE_FACES_POLICY.minimumMovedDistance)continue;
    maximumMovement=Math.max(maximumMovement,distance);
    // Avoid numerical changes to a point that already satisfies the equations.
    if(distance>MERGE_FACES_POLICY.minimumMovedDistance){positions.set(id,to);movedVertices.push({id,from:[...from],to:[...to]});}
  }
  if(maximumMovement>parameters.maximumAdjustment)return reject('limit',`This merge needs ${maximumMovement.toPrecision(6)} mm of adjustment. Increase Maximum adjustment or choose another reference plane.`);
  const basis=planeBasis(plane,positions.get(loops[0][0])!),projectLoop=(loop:VertexId[])=>loop.map(id=>toPlane2(positions.get(id)!,basis));
  const outer=loops.filter(loop=>v2.area(projectLoop(loop))>TOL.minimumFaceArea),holes=loops.filter(loop=>v2.area(projectLoop(loop))<-TOL.minimumFaceArea);
  if(outer.length!==1||outer.length+holes.length!==loops.length)return reject('boundary','The selected area cannot form one consistently oriented planar face.');
  const outer2=projectLoop(outer[0]);
  if(holes.some(loop=>loop.some(id=>!pointInPolygon2(toPlane2(positions.get(id)!,basis),outer2))))return reject('boundary','A selected hole lies outside the new face.');
  const movedIds=new Set(movedVertices.map(v=>v.id));
  const faces:ProjectSolid['faces']=[];
  for(const f of s.faces.values())if(!selected.has(f.id)){
    const face={id:f.id,outer:loopVertexIds(s,f.outerLoop),holes:f.innerLoops.map(lid=>loopVertexIds(s,lid)),material:f.material,provenance:f.provenance,boundaryGroup:f.boundaryGroup};
    if([face.outer,...face.holes].some(loop=>loop.some(id=>movedIds.has(id))))affected.add(f.id);
    faces.push(face);
  }
  faces.push({id:referenceFaceId,outer:outer[0],holes,material:reference.material,provenance:{kind:'boolean',label:'Merge Faces'},boundaryGroup:`merge:${referenceFaceId}`});
  // Reject crossings and boundary touches locally before asking the canonical
  // constructor to validate orientation, planarity, incidence and volume.
  let comparisons=0;
  for(const f of faces)if(f.id===referenceFaceId||affected.has(f.id)){
    const oldPlane=f.id===referenceFaceId?plane:s.faces.get(f.id)!.plane,b=planeBasis(oldPlane,positions.get(f.outer[0])!);
    const polygons=[f.outer,...f.holes].map(loop=>loop.map(id=>toPlane2(positions.get(id)!,b)));
    for(let l=0;l<polygons.length;l++)for(let m=l;m<polygons.length;m++){
      const a=polygons[l],c=polygons[m];
      for(let i=0;i<a.length;i++)for(let j=l===m?i+1:0;j<c.length;j++){
        if(l===m&&(j===i+1||i===0&&j===a.length-1))continue;
        if(++comparisons>MERGE_FACES_POLICY.maximumIntersectionPairs)return reject('limit','The affected boundaries exceed the local intersection-check budget.');
        const p=a[i],q=a[(i+1)%a.length],r=c[j],t=c[(j+1)%c.length];
        if(segmentIntersection2(p,q,r,t)||pointOnSegment2(p,r,t,TOL.topologyKey)||pointOnSegment2(q,r,t,TOL.topologyKey)||pointOnSegment2(r,p,q,TOL.topologyKey)||pointOnSegment2(t,p,q,TOL.topologyKey))return reject('boundary','Adjusting this area would make a face boundary cross or touch itself.');
      }
      if(l!==m&&l>0&&(pointInPolygon2(a[0],c)||pointInPolygon2(c[0],a)))return reject('boundary','The adjusted hole boundaries overlap.');
    }
    if(f.holes.some(loop=>loop.some(id=>!pointInPolygon2(toPlane2(positions.get(id)!,b),polygons[0]))))return reject('boundary','Adjusting this area would cross a neighboring hole.');
    if([f.outer,...f.holes].some(loop=>loop.some(id=>Math.abs(V.dot(oldPlane.normal,positions.get(id)!)-oldPlane.offset)>TOL.plane)))return reject('plane','Adjusting this boundary would bend a surrounding face.');
  }
  const used=new Set(faces.flatMap(f=>[...f.outer,...f.holes.flat()]));
  // One adapter for the canonical constructor/exporter's throwing contract.
  try {
    const before=validateSolid(s),solid=deserializeProjectSolid({schema:'poly-brep-1',id:s.id,metadata:structuredClone(s.metadata),vertices:[...used].map(id=>({id,position:positions.get(id)!})),faces});
    for(const id of affected)if(V.dot(solid.faces.get(id)!.plane.normal,s.faces.get(id)!.plane.normal)<=0)return reject('invalid','The adjustment would reverse a surrounding face.');
    solidMeshExportLocal(solid);
    const after=validateSolid(solid);
    if(!parameters.adjustNeighbors&&Math.abs(after.volume-before.volume)>Math.max(MERGE_FACES_POLICY.unchangedVolumeAbsoluteTolerance,before.volume*MERGE_FACES_POLICY.unchangedVolumeRelativeTolerance))return reject('invalid','Keeping the shape would change material volume. Enable Adjust neighboring faces to preview an explicit shape edit.');
    return {ok:true,result:{solid,faceId:referenceFaceId,referenceFaceId,selectedFaceIds:ids,movedVertices,affectedFaceIds:[...affected],maximumMovement,volumeBefore:before.volume,volumeAfter:after.volume}};
  }catch(error){return reject('invalid',`The merged solid could not pass geometry/export checks: ${errorMessage(error)}`);}
}
