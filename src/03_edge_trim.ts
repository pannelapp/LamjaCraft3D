// Explicit ridge removal: join the retained boundary across a convex ridge,
// removing its two endpoints from their supporting cap loops. No points move.
const EDGE_TRIM_POLICY=Object.freeze({maximumSolidFaces:2000,maximumHalfEdges:20000,maximumIntersectionPairs:100000,volumeAbsoluteTolerance:1e-8,volumeRelativeTolerance:1e-8});
interface EdgeTrimEdit {mode:'dissolve'|'trim';solid:Solid;faceId:FaceId;selectedFaceIds:FaceId[];affectedFaceIds:FaceId[];removedVertexIds:VertexId[];volumeBefore:number;volumeAfter:number;}
type EdgeTrimResult={ok:true;result:EdgeTrimEdit}|{ok:false;reason:'selection'|'limit'|'plane'|'boundary'|'invalid';message:string};
function trimRidgeEdgeSolid(s:Solid,halfEdgeId:HalfEdgeId):EdgeTrimResult {
  const reject=(reason:Extract<EdgeTrimResult,{ok:false}>['reason'],message:string):EdgeTrimResult=>({ok:false,reason,message});
  if(s.faces.size>EDGE_TRIM_POLICY.maximumSolidFaces||s.halfEdges.size>EDGE_TRIM_POLICY.maximumHalfEdges)return reject('limit','This object exceeds the bounded edge-trim size.');
  const he=s.halfEdges.get(halfEdgeId),twin=he&&s.halfEdges.get(he.twin),next=he&&s.halfEdges.get(he.next);
  if(!he||!twin||!next||he.face===twin.face)return reject('selection','Choose an existing edge between two different faces.');
  const ids=[he.face,twin.face].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),selected=new Set(ids),ends=new Set([he.origin,next.origin]);
  if(planesCoplanarSame(s.faces.get(ids[0])!.plane,s.faces.get(ids[1])!.plane)){
    const merged=mergeFacesSolid(s,ids,{adjustNeighbors:false,maximumAdjustment:0});
    if(!merged.ok)return merged;
    const r=merged.result;return {ok:true,result:{mode:'dissolve',solid:r.solid,faceId:r.faceId,selectedFaceIds:ids,affectedFaceIds:[],removedVertexIds:[...s.vertices.keys()].filter(id=>!r.solid.vertices.has(id)),volumeBefore:r.volumeBefore,volumeAfter:r.volumeAfter}};
  }
  if(ids.some(id=>s.faces.get(id)!.innerLoops.length))return reject('boundary','A ridge trim requires two faces without holes.');
  for(const id of ends){const neighbors=new Set([...s.halfEdges.values()].filter(e=>e.origin===id&&!selected.has(e.face)).map(e=>e.face));if(neighbors.size!==1)return reject('boundary','Each ridge endpoint must meet one surrounding face. Merge coplanar subdivisions first.');}
  const outgoing=new Map<VertexId,VertexId>(),incoming=new Set<VertexId>();let shared=0;
  for(const id of ids)for(const e of loopHalfEdges(s,s.faces.get(id)!.outerLoop)){
    if(selected.has(s.halfEdges.get(e.twin)!.face)){shared++;continue;}
    const dest=s.halfEdges.get(e.next)!.origin;
    if(outgoing.has(e.origin)||incoming.has(dest))return reject('boundary','These faces do not form one simple boundary.');
    outgoing.set(e.origin,dest);incoming.add(dest);
  }
  if(shared!==2)return reject('boundary','Choose a single shared ridge; subdivided ridges must be merged first.');
  const boundary:VertexId[]=[],start=outgoing.keys().next().value;let at=start;
  if(!at)return reject('boundary','The retained boundary is empty.');
  do{const dest=outgoing.get(at);if(!dest)return reject('boundary','The retained boundary does not close.');boundary.push(at);outgoing.delete(at);at=dest;}while(at!==start);
  if(outgoing.size)return reject('boundary','These faces have more than one boundary.');
  const outer=boundary.filter(id=>!ends.has(id));
  if(outer.length<3)return reject('boundary','Removing this ridge would collapse the replacement face.');
  const points=outer.map(id=>s.vertices.get(id)!.position);
  // planeFromPoints is the canonical constructor's throwing numerical adapter.
  let plane:Plane;try{plane=planeFromPoints(points);}catch(error){return reject('plane',errorMessage(error));}
  if(points.some(p=>Math.abs(V.dot(plane.normal,p)-plane.offset)>TOL.plane))return reject('plane','The remaining boundary cannot form one flat face. Choose a longitudinal facet edge, or use Merge Faces.');
  if(ids.some(id=>V.dot(plane.normal,s.faces.get(id)!.plane.normal)<=0))return reject('plane','The replacement face would turn away from the original surface.');
  const distances=[...ends].map(id=>V.dot(plane.normal,s.vertices.get(id)!.position)-plane.offset);
  if(distances.some(d=>d < -TOL.plane)||distances.every(d=>d<=TOL.plane))return reject('plane','This is not a convex ridge cut. Removing it would add material or leave the same shape.');
  const survivor=ids.slice().sort((a,b)=>faceAreaLocal(s,b)-faceAreaLocal(s,a)||a.localeCompare(b,undefined,{numeric:true}))[0],reference=s.faces.get(survivor)!;
  const faces:ProjectSolid['faces']=[],affected:FaceId[]=[];
  for(const f of s.faces.values())if(!selected.has(f.id)){
    const oldLoops=[loopVertexIds(s,f.outerLoop),...f.innerLoops.map(l=>loopVertexIds(s,l))],loops=oldLoops.map(loop=>loop.filter(id=>!ends.has(id)));
    if(loops.some(loop=>loop.length<3))return reject('boundary','Removing this edge would collapse a surrounding face or hole.');
    if(oldLoops.some(loop=>loop.some(id=>ends.has(id))))affected.push(f.id);
    faces.push({id:f.id,outer:loops[0],holes:loops.slice(1),material:f.material,provenance:f.provenance,boundaryGroup:f.boundaryGroup});
  }
  faces.push({id:survivor,outer,holes:[],material:reference.material,provenance:{kind:'boolean',label:'Trim edge'},boundaryGroup:`trim:${survivor}`});
  let comparisons=0;
  for(const f of faces)if(f.id===survivor||affected.includes(f.id)){
    const support=f.id===survivor?plane:s.faces.get(f.id)!.plane,b=planeBasis(support,s.vertices.get(f.outer[0])!.position),polygons=[f.outer,...f.holes].map(loop=>loop.map(id=>toPlane2(s.vertices.get(id)!.position,b)));
    for(let l=0;l<polygons.length;l++)for(let m=l;m<polygons.length;m++){
      const a=polygons[l],c=polygons[m];
      for(let i=0;i<a.length;i++)for(let j=l===m?i+1:0;j<c.length;j++){
        if(l===m&&(j===i+1||i===0&&j===a.length-1))continue;
        if(++comparisons>EDGE_TRIM_POLICY.maximumIntersectionPairs)return reject('limit','The changed boundaries exceed the local checking budget.');
        const p=a[i],q=a[(i+1)%a.length],r=c[j],t=c[(j+1)%c.length];
        if(segmentIntersection2(p,q,r,t)||pointOnSegment2(p,r,t,TOL.topologyKey)||pointOnSegment2(q,r,t,TOL.topologyKey)||pointOnSegment2(r,p,q,TOL.topologyKey)||pointOnSegment2(t,p,q,TOL.topologyKey))return reject('boundary','The cut would cross or touch a surrounding boundary or hole.');
      }
      if(l!==m&&l>0&&(pointInPolygon2(a[0],c)||pointInPolygon2(c[0],a)))return reject('boundary','The cut would overlap hole boundaries.');
    }
    if(polygons.slice(1).some(hole=>hole.some(p=>!pointInPolygon2(p,polygons[0]))))return reject('boundary','The cut would reach a surrounding hole.');
  }
  const used=new Set(faces.flatMap(f=>[...f.outer,...f.holes.flat()]));
  try{
    const before=validateSolid(s),solid=deserializeProjectSolid({schema:'poly-brep-1',id:s.id,metadata:structuredClone(s.metadata),vertices:[...used].map(id=>({id,position:s.vertices.get(id)!.position})),faces});
    for(const id of affected)if(V.dot(solid.faces.get(id)!.plane.normal,s.faces.get(id)!.plane.normal)<=0)return reject('invalid','The cut would reverse a surrounding face.');
    solidMeshExportLocal(solid);const after=validateSolid(solid),budget=Math.max(EDGE_TRIM_POLICY.volumeAbsoluteTolerance,before.volume*EDGE_TRIM_POLICY.volumeRelativeTolerance);
    if(before.volume-after.volume<=budget)return reject('invalid','The candidate does not remove a measurable amount of material.');
    return {ok:true,result:{mode:'trim',solid,faceId:survivor,selectedFaceIds:ids,affectedFaceIds:affected,removedVertexIds:[...ends],volumeBefore:before.volume,volumeAfter:after.volume}};
  }catch(error){return reject('invalid',`The edge cut failed geometry/export checks: ${errorMessage(error)}`);}
}
