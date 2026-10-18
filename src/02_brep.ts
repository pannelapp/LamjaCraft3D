let topologySerial = 1;
const pointKey3 = (p:Vec3, eps:number=TOL.topologyKey) => p.map(v=>Math.round(v/eps)).join(',');
// Polygon-to-B-rep reconstruction policy. The grouping tolerances decide which polygons form one
// logical face. Boundary resolution is explicit; bucket/index values only size conservative
// acceleration prefilters and never change a geometric decision.
const BREP_REBUILD_POLICY=Object.freeze({
  canonicalVertexWeldRadius:TOL.topologyKey*2,
  // A removed corner retained by another incident face must be eligible for
  // reinsertion by splitEdgePoints; use its existing point-to-segment budget.
  splitBoundaryCollinearDistance:TOL.weld*4,
  coplanarGroupMinimumNormalDot:1-TOL.coplanarAngle*8,
  coplanarGroupOffset:TOL.coplanarDistance*4,
  // Wider than coplanarGroupOffset, so every plane within tolerance lies in the same or an
  // adjacent offset bucket even after floating-point division.
  coplanarOffsetBucket:TOL.coplanarDistance*10,
  // Below this many distinct points a direct scan is cheaper than building an axis index.
  indexedSplitCandidateMinimum:64,
  // Twice the splitEdgePoints tolerance, so interpolation rounding can never exclude a candidate
  // that the exact point-to-segment test would accept.
  splitCandidatePrefilterPad:TOL.weld*8,
});
// Read-only migration map for project files written before the English-language cleanup.
const LEGACY_PROVENANCE_LABELS:Record<string,string>=Object.freeze({
  Skisse:'Sketch', Kontur:'Contour', Sirkel:'Circle', Sirkelbue:'Arc', Rektangel:'Rectangle', Bue:'Arc',
  Støtteflate:'Support face', Bunn:'Bottom', Topp:'Top', Side:'Side',
});
function normalizeFaceProvenance(p?:FaceProvenance):FaceProvenance|undefined {
  if(!p)return undefined;
  const label=p.label?(LEGACY_PROVENANCE_LABELS[p.label]||p.label):undefined;
  return {...p,label};
}

function loopHalfEdges(s:Solid, loopId:LoopId):HalfEdge[] {
  const loop=s.loops.get(loopId); if(!loop)return [];
  const out:HalfEdge[]=[]; let id=loop.firstHalfEdge,guard=0;
  while(id&&guard++<=s.halfEdges.size+1){const he=s.halfEdges.get(id);if(!he)break;out.push(he);id=he.next;if(id===loop.firstHalfEdge)break;}
  return out;
}
function loopPoints(s:Solid,loopId:LoopId):Vec3[]{return loopHalfEdges(s,loopId).map(he=>s.vertices.get(he.origin)!.position);}
function faceLoopPoints(s:Solid,faceId:FaceId):{outer:Vec3[];holes:Vec3[][]}{const f=s.faces.get(faceId);if(!f)throw Error('Unknown face.');return {outer:loopPoints(s,f.outerLoop),holes:f.innerLoops.map(id=>loopPoints(s,id))};}
function faceCentroid(s:Solid,faceId:FaceId):Vec3{const p=faceLoopPoints(s,faceId).outer;return p.reduce((a,b)=>V.add(a,b),[0,0,0] as Vec3).map(v=>v/p.length) as Vec3;}
function cloneSolid(s:Solid):Solid { return deserializeSolid(serializeSolid(s)); }
function connectedSolidFaceComponents(s:Solid):FaceId[][] {
  const pending=new Set<FaceId>(s.faces.keys()),components:FaceId[][]=[];
  while(pending.size){
    const seed=pending.values().next().value as FaceId;pending.delete(seed);const faces:FaceId[]=[seed];
    for(let i=0;i<faces.length;i++){
      const face=s.faces.get(faces[i]);if(!face)continue;
      for(const lid of [face.outerLoop,...face.innerLoops])for(const he of loopHalfEdges(s,lid)){
        const twin=s.halfEdges.get(he.twin);if(twin&&pending.delete(twin.face))faces.push(twin.face);
      }
    }
    components.push(faces);
  }
  return components;
}
const SOLID_SHELL_POLICY=Object.freeze({minimumVolume:TOL.minimumFaceArea,insideWindingThreshold:.5});
function solidFromFaceSubset(s:Solid,faceIds:readonly FaceId[],id:string):Solid {
    const faceSet=new Set(faceIds),loopSet=new Set<LoopId>(),halfEdgeSet=new Set<HalfEdgeId>(),vertexSet=new Set<VertexId>();
    for(const fid of faceIds){const f=s.faces.get(fid);if(!f)continue;for(const lid of [f.outerLoop,...f.innerLoops]){loopSet.add(lid);for(const he of loopHalfEdges(s,lid)){halfEdgeSet.add(he.id);vertexSet.add(he.origin);}}}
    const vertices=new Map<VertexId,Vertex>();for(const id of vertexSet){const v=s.vertices.get(id);if(v)vertices.set(id,{id:v.id,position:[...v.position] as Vec3});}
    const halfEdges=new Map<HalfEdgeId,HalfEdge>();for(const id of halfEdgeSet){const he=s.halfEdges.get(id);if(he)halfEdges.set(id,{...he});}
    const loops=new Map<LoopId,Loop>();for(const id of loopSet){const l=s.loops.get(id);if(l)loops.set(id,{...l});}
    const faces=new Map<FaceId,Face>();for(const id of faceSet){const f=s.faces.get(id);if(f)faces.set(id,{...f,plane:{normal:[...f.plane.normal] as Vec3,offset:f.plane.offset},innerLoops:[...f.innerLoops],provenance:f.provenance?{...f.provenance}:undefined});}
    const out:Solid={id,vertices,halfEdges,loops,faces,metadata:structuredClone(s.metadata||{})};
    return out;
}
function meshShellContainsPoint(vertices:Vec3[],triangles:[number,number,number][],component:readonly number[],point:Vec3):boolean {
  // Generalized winding number of a consistently oriented closed triangle shell.
  let angle=0;for(const index of component){const [a,b,c]=triangles[index].map(id=>V.sub(vertices[id],point)),la=V.len(a),lb=V.len(b),lc=V.len(c);angle+=2*Math.atan2(V.dot(a,V.cross(b,c)),la*lb*lc+V.dot(a,b)*lc+V.dot(b,c)*la+V.dot(c,a)*lb);}
  return Math.abs(angle)/(4*Math.PI)>SOLID_SHELL_POLICY.insideWindingThreshold;
}
function splitConnectedSolidShells(s:Solid,reuseConnected=false):Solid[] {
  const components=connectedSolidFaceComponents(s);
  if(components.length<=1)return [reuseConnected&&components.length===1?s:cloneSolid(s)];
  // A cavity is a disconnected *surface* with negative orientation, not a
  // separate material object. Keep it with the smallest enclosing outer shell.
  const shells=components.map(faceIds=>{
    const shell=solidFromFaceSubset(s,faceIds,s.id),mesh=solidMeshLocal(shell),reference=mesh.vertices[0],volume=signedVolumeTriangles(mesh.vertices.map(p=>V.sub(p,reference)),mesh.triangles);
    if(!Number.isFinite(volume)||Math.abs(volume)<=SOLID_SHELL_POLICY.minimumVolume)throw Error('Cannot split a zero-volume or invalid solid shell.');
    const min:Vec3=[Infinity,Infinity,Infinity],max:Vec3=[-Infinity,-Infinity,-Infinity];for(const p of mesh.vertices)for(let axis=0;axis<3;axis++){min[axis]=Math.min(min[axis],p[axis]);max[axis]=Math.max(max[axis],p[axis]);}
    return {faceIds,mesh,volume,min,max};
  });
  const material=shells.filter(shell=>shell.volume>0),groups=material.map(shell=>[...shell.faceIds]);
  if(!material.length)throw Error('Cannot split a solid without an outer material shell.');
  for(const cavity of shells.filter(shell=>shell.volume<0)){
    const candidates=material.map((shell,index)=>({shell,index})).filter(({shell})=>cavity.min.every((value,axis)=>value>=shell.min[axis])&&cavity.max.every((value,axis)=>value<=shell.max[axis])&&meshShellContainsPoint(shell.mesh.vertices,shell.mesh.triangles,shell.mesh.triangles.map((_,i)=>i),cavity.mesh.vertices[0])).sort((a,b)=>a.shell.volume-b.shell.volume);
    if(!candidates.length)throw Error('A cavity shell has no enclosing material component.');
    groups[candidates[0].index].push(...cavity.faceIds);
  }
  return groups.map((faceIds,index)=>{const out=solidFromFaceSubset(s,faceIds,index===0?s.id:`${s.id}_shell${index+1}`);validateSolid(out);return out;});
}
// Reuse an Intl.Collator for high-detail imported geometry. Rebuilding it for
// every comparison makes the sorting in project/undo snapshots very expensive.
const SKP_BREP_ID_COLLATOR=new Intl.Collator(undefined,{numeric:true});
function serializeSolid(s:Solid):SerializedSolid {
  const byId=<T extends {id:string}>(a:T[])=>a.sort((x,y)=>SKP_BREP_ID_COLLATOR.compare(x.id,y.id));
  return {
    schema:'brep-1',id:s.id,metadata:structuredClone(s.metadata||{}),
    vertices:byId([...s.vertices.values()]).map(v=>({id:v.id,position:[...v.position] as Vec3})),
    halfEdges:byId([...s.halfEdges.values()]).map(h=>({id:h.id,origin:h.origin,twin:h.twin,next:h.next,prev:h.prev,loop:h.loop,face:h.face})),
    loops:byId([...s.loops.values()]).map(l=>({id:l.id,firstHalfEdge:l.firstHalfEdge,kind:l.kind})),
    faces:byId([...s.faces.values()]).map(f=>({id:f.id,plane:{normal:[...f.plane.normal] as Vec3,offset:f.plane.offset},outerLoop:f.outerLoop,innerLoops:[...f.innerLoops],material:f.material,provenance:normalizeFaceProvenance(f.provenance),boundaryGroup:f.boundaryGroup}))
  };
}
function deserializeSolid(data:SerializedSolid):Solid {
  if(!data||data.schema!=='brep-1'||!Array.isArray(data.vertices)||!Array.isArray(data.halfEdges)||!Array.isArray(data.loops)||!Array.isArray(data.faces))throw Error('Invalid B-rep format.');
  const unique=<T extends {id:string}>(items:T[],label:string)=>{const m=new Map<string,T>();for(const item of items){if(!item?.id||m.has(item.id))throw Error(`Invalid or duplicate ${label} ID.`);m.set(item.id,item);}return m;};
  const rawV=unique(data.vertices,'vertex'),rawH=unique(data.halfEdges,'half-edge'),rawL=unique(data.loops,'loop'),rawF=unique(data.faces,'face');
  const vertices=new Map<VertexId,Vertex>();for(const v of rawV.values()){if(!Array.isArray(v.position)||v.position.length!==3||v.position.some(n=>!Number.isFinite(n)))throw Error(`Invalid vertex ${v.id}.`);vertices.set(v.id,{id:v.id,position:[...v.position] as Vec3});}
  const halfEdges=new Map<HalfEdgeId,HalfEdge>();for(const h of rawH.values())halfEdges.set(h.id,{id:h.id,origin:h.origin,twin:h.twin,next:h.next,prev:h.prev,loop:h.loop,face:h.face});
  const loops=new Map<LoopId,Loop>();for(const l of rawL.values())loops.set(l.id,{id:l.id,firstHalfEdge:l.firstHalfEdge,kind:l.kind});
  const faces=new Map<FaceId,Face>();for(const f of rawF.values()){if(!f.plane||!Array.isArray(f.plane.normal)||f.plane.normal.length!==3||f.plane.normal.some(n=>!Number.isFinite(n))||!Number.isFinite(f.plane.offset))throw Error(`Invalid plane for ${f.id}.`);faces.set(f.id,{id:f.id,plane:{normal:[...f.plane.normal] as Vec3,offset:f.plane.offset},outerLoop:f.outerLoop,innerLoops:[...f.innerLoops],material:f.material,provenance:normalizeFaceProvenance(f.provenance),boundaryGroup:f.boundaryGroup});}
  for(const h of halfEdges.values()){if(!vertices.has(h.origin)||!halfEdges.has(h.twin)||!halfEdges.has(h.next)||!halfEdges.has(h.prev)||!loops.has(h.loop)||!faces.has(h.face))throw Error(`Broken half-edge reference ${h.id}.`);}
  for(const l of loops.values())if(!halfEdges.has(l.firstHalfEdge))throw Error(`Broken loop reference ${l.id}.`);
  for(const f of faces.values())if(!loops.has(f.outerLoop)||f.innerLoops.some(id=>!loops.has(id)))throw Error(`Broken face reference ${f.id}.`);
  const s:Solid={id:String(data.id||'solid'),vertices,halfEdges,loops,faces,metadata:structuredClone(data.metadata||{})};validateSolid(s);return s;
}

function canonicalEdgeKey(a:VertexId,b:VertexId):EdgeKey { return JSON.stringify(a.localeCompare(b)<=0?[a,b]:[b,a]); }
function loopVertexIds(s:Solid,loopId:LoopId):VertexId[]{return loopHalfEdges(s,loopId).map(he=>he.origin);}
function serializeProjectSolid(s:Solid):ProjectSolid {
  validateSolid(s);
  const byId=<T extends {id:string}>(a:T[])=>a.sort((x,y)=>SKP_BREP_ID_COLLATOR.compare(x.id,y.id));
  const faces=byId([...s.faces.values()]).map(f=>({
    id:f.id,
    outer:loopVertexIds(s,f.outerLoop),
    holes:f.innerLoops.map(id=>loopVertexIds(s,id)),
    material:f.material,
    provenance:normalizeFaceProvenance(f.provenance),
    boundaryGroup:f.boundaryGroup,
  }));
  const used=new Set<VertexId>();for(const f of faces){for(const id of f.outer)used.add(id);for(const h of f.holes)for(const id of h)used.add(id);}
  if(used.size!==s.vertices.size)throw Error('The solid contains vertices that do not belong to any face loop.');
  return {
    schema:'poly-brep-1',id:s.id,metadata:structuredClone(s.metadata||{}),
    vertices:byId([...s.vertices.values()]).map(v=>({id:v.id,position:[...v.position] as Vec3})),
    faces,
  };
}
function deserializeProjectSolid(data:ProjectSolid):Solid {
  if(!data||data.schema!=='poly-brep-1'||!Array.isArray(data.vertices)||!Array.isArray(data.faces))throw Error('Invalid canonical solid format.');
  const vertices=new Map<VertexId,Vertex>();
  for(const raw of data.vertices){
    if(!raw?.id||vertices.has(raw.id))throw Error('Invalid or duplicate vertex ID.');
    if(!Array.isArray(raw.position)||raw.position.length!==3||raw.position.some(n=>!Number.isFinite(n)))throw Error(`Invalid vertex ${raw.id}.`);
    vertices.set(raw.id,{id:raw.id,position:[...raw.position] as Vec3});
  }
  const loops=new Map<LoopId,Loop>(),halfEdges=new Map<HalfEdgeId,HalfEdge>(),faces=new Map<FaceId,Face>();
  const edgeRefs=new Map<EdgeKey,{id:HalfEdgeId,a:VertexId,b:VertexId}[]>();let ln=1,hn=1;
  const addLoop=(faceId:FaceId,rawIds:any,kind:'outer'|'hole'):LoopId=>{
    if(!Array.isArray(rawIds)||rawIds.length<3)throw Error(`Face ${faceId} has an invalid ${kind} loop.`);
    const ids=rawIds.map((x:any)=>String(x));
    if(new Set(ids).size<3)throw Error(`Face ${faceId} has too few unique vertices in its ${kind} loop.`);
    for(let i=0;i<ids.length;i++){
      if(!vertices.has(ids[i]))throw Error(`Face ${faceId} references unknown vertex ${ids[i]}.`);
      if(ids[i]===ids[(i+1)%ids.length])throw Error(`Face ${faceId} has duplicate adjacent vertex ${ids[i]}.`);
    }
    const lid='l'+ln++,heIds=ids.map(()=>('he'+hn++) as HalfEdgeId);
    loops.set(lid,{id:lid,firstHalfEdge:heIds[0],kind});
    for(let i=0;i<ids.length;i++){
      const a=ids[i],b=ids[(i+1)%ids.length],id=heIds[i];
      halfEdges.set(id,{id,origin:a,twin:'' as HalfEdgeId,next:heIds[(i+1)%ids.length],prev:heIds[(i+ids.length-1)%ids.length],loop:lid,face:faceId});
      const key=canonicalEdgeKey(a,b),list=edgeRefs.get(key)||[];list.push({id,a,b});edgeRefs.set(key,list);
    }
    return lid;
  };
  const rawFaces=[...data.faces].sort((a,b)=>SKP_BREP_ID_COLLATOR.compare(String(a?.id||''),String(b?.id||'')));
  for(const raw of rawFaces){
    const id=String(raw?.id||'');if(!id||faces.has(id))throw Error('Invalid or duplicate face ID.');
    const outer=addLoop(id,raw.outer,'outer'),innerLoops=(Array.isArray(raw.holes)?raw.holes:[]).map((h:any)=>addLoop(id,h,'hole'));
    const outerPoints=loopHalfEdges({id:String(data.id||'solid'),vertices,halfEdges,loops,faces:new Map(),metadata:{}},outer).map(he=>vertices.get(he.origin)!.position);
    const plane=planeFromPoints(outerPoints);
    faces.set(id,{id,plane,outerLoop:outer,innerLoops,material:raw.material,provenance:normalizeFaceProvenance(raw.provenance),boundaryGroup:raw.boundaryGroup});
  }
  for(const [key,refs] of edgeRefs){
    if(refs.length!==2)throw Error(`Open or non-manifold edge ${key}.`);
    const [a,b]=refs;if(a.a!==b.b||a.b!==b.a)throw Error(`Edge ${key} has invalid orientation.`);
    halfEdges.get(a.id)!.twin=b.id;halfEdges.get(b.id)!.twin=a.id;
  }
  const used=new Set<VertexId>();for(const he of halfEdges.values())used.add(he.origin);if(used.size!==vertices.size)throw Error('The project contains vertices that are not used by any face loop.');
  const solid:Solid={id:String(data.id||'solid'),vertices,halfEdges,loops,faces,metadata:structuredClone(data.metadata||{})};
  validateSolid(solid);return solid;
}


// Non-solid reference surfaces use the same polygon B-rep as solids, but may
// have boundary edges. Boundary twins point to themselves: no solid operation
// may access this representation. Only surface-aware readers and renderers may.
function deserializeProjectSurface(data:ProjectSolid):Solid {
  if(!data||data.schema!=='poly-brep-1'||!Array.isArray(data.vertices)||!Array.isArray(data.faces)||!data.faces.length)throw Error('Invalid open-surface polygon format.');
  const vertices=new Map<VertexId,Vertex>();
  for(const vertex of data.vertices){
    if(typeof vertex?.id!=='string'||!vertex.id||vertices.has(vertex.id)||!Array.isArray(vertex.position)||vertex.position.length!==3||vertex.position.some(n=>!Number.isFinite(n)))throw Error('Invalid surface vertex.');
    vertices.set(vertex.id,{id:vertex.id,position:[...vertex.position] as Vec3});
  }
  const halfEdges=new Map<HalfEdgeId,HalfEdge>(),loops=new Map<LoopId,Loop>(),faces=new Map<FaceId,Face>();
  const edgeRefs=new Map<EdgeKey,{id:string;a:string;b:string}[]>();let li=0,hi=0;
  const addRing=(faceId:string,ids:VertexId[],kind:'outer'|'hole'):LoopId=>{
    if(!Array.isArray(ids)||ids.length<3||new Set(ids).size!==ids.length||ids.some(id=>!vertices.has(id)))throw Error('Invalid surface polygon boundary.');
    const loopId='l'+(++li),heIds=ids.map(()=>('he'+(++hi)));
    loops.set(loopId,{id:loopId,firstHalfEdge:heIds[0],kind});
    for(let i=0;i<ids.length;i++){
      const a=ids[i],b=ids[(i+1)%ids.length],id=heIds[i];
      if(a===b||V.len(V.sub(vertices.get(a)!.position,vertices.get(b)!.position))<TOL.minimumEdge)throw Error('Degenerate surface boundary edge.');
      halfEdges.set(id,{id,origin:a,twin:id,next:heIds[(i+1)%ids.length],prev:heIds[(i+ids.length-1)%ids.length],loop:loopId,face:faceId});
      const key=canonicalEdgeKey(a,b),uses=edgeRefs.get(key)||[];uses.push({id,a,b});edgeRefs.set(key,uses);
    }
    return loopId;
  };
  for(const raw of data.faces){
    if(typeof raw?.id!=='string'||!raw.id||faces.has(raw.id))throw Error('Invalid or duplicate surface face.');
    const outer=addRing(raw.id,raw.outer,'outer'),holes=(raw.holes||[]).map(ring=>addRing(raw.id,ring,'hole'));
    const polygon=raw.outer.map(id=>vertices.get(id)!.position),plane=planeFromPoints(polygon);
    if(polygon.some(p=>Math.abs(V.dot(plane.normal,p)-plane.offset)>TOL.plane))throw Error('Non-planar surface face.');
    faces.set(raw.id,{id:raw.id,outerLoop:outer,innerLoops:holes,plane,material:raw.material,provenance:normalizeFaceProvenance(raw.provenance),boundaryGroup:raw.boundaryGroup});
  }
  for(const uses of edgeRefs.values())if(uses.length===2&&uses[0].a===uses[1].b&&uses[0].b===uses[1].a){
    halfEdges.get(uses[0].id)!.twin=uses[1].id;halfEdges.get(uses[1].id)!.twin=uses[0].id;
  }
  const used=new Set([...halfEdges.values()].map(edge=>edge.origin));
  if(used.size!==vertices.size)throw Error('Surface has unused vertices.');
  const surface:Solid={id:String(data.id||'surface'),metadata:structuredClone(data.metadata||{}),vertices,halfEdges,loops,faces};
  // Triangulation validation prevents malformed SketchUp boundaries entering
  // scene picking, rendering, native persistence, or undo/redo.
  const mesh=solidMeshLocalImpl(surface);
  if(!mesh.triangles.length)throw Error('Surface contains no drawable polygon.');
  return surface;
}
function serializeProjectSurface(s:Solid):ProjectSolid {
  return {schema:'poly-brep-1',id:s.id,metadata:structuredClone(s.metadata),
    vertices:[...s.vertices.values()].map(v=>({id:v.id,position:[...v.position] as Vec3})),
    faces:[...s.faces.values()].map(f=>({id:f.id,outer:loopVertexIds(s,f.outerLoop),holes:f.innerLoops.map(id=>loopVertexIds(s,id)),material:f.material,provenance:f.provenance,boundaryGroup:f.boundaryGroup}))};
}
function deserializeSnapshotSurface(data:SerializedSolid):Solid {
  if(!data||data.schema!=='brep-1')throw Error('Invalid surface snapshot.');
  const vertices=data.vertices.map(v=>({id:v.id,position:v.position}));
  const edges=new Map(data.halfEdges.map(h=>[h.id,h]));
  const loops=new Map(data.loops.map(l=>[l.id,l]));
  const ring=(loopId:string):string[]=>{
    const loop=loops.get(loopId);if(!loop)throw Error('Invalid surface loop.');
    const ids:string[]=[],visited=new Set<string>();let edgeId=loop.firstHalfEdge;
    while(!visited.has(edgeId)){
      const edge=edges.get(edgeId);if(!edge)throw Error('Broken surface edge.');
      visited.add(edgeId);ids.push(edge.origin);edgeId=edge.next;
      if(ids.length>data.halfEdges.length)throw Error('Broken surface loop.');
    }
    if(edgeId!==loop.firstHalfEdge)throw Error('Surface loop does not close.');
    return ids;
  };
  return deserializeProjectSurface({schema:'poly-brep-1',id:data.id,metadata:data.metadata,vertices,faces:data.faces.map(f=>({id:f.id,outer:ring(f.outerLoop),holes:f.innerLoops.map(ring),material:f.material,provenance:f.provenance,boundaryGroup:f.boundaryGroup}))});
}

function splitEdgePoints(a:Vec3,b:Vec3,candidates:Vec3[]):Vec3[]{const d=V.sub(b,a),l2=V.dot(d,d);const cuts:{t:number,p:Vec3}[]=[{t:0,p:a},{t:1,p:b}];if(l2<TOL.minimumEdge*TOL.minimumEdge)return [a,b];
  // Exact prefilter: a point outside the padded segment box cannot pass the distance test below.
  const pad=BREP_REBUILD_POLICY.splitCandidatePrefilterPad,x0=Math.min(a[0],b[0])-pad,x1=Math.max(a[0],b[0])+pad,y0=Math.min(a[1],b[1])-pad,y1=Math.max(a[1],b[1])+pad,z0=Math.min(a[2],b[2])-pad,z1=Math.max(a[2],b[2])+pad;
  for(const q of candidates){if(q[0]<x0||q[0]>x1||q[1]<y0||q[1]>y1||q[2]<z0||q[2]>z1)continue;const t=V.dot(V.sub(q,a),d)/l2;if(t<=1e-8||t>=1-1e-8)continue;const on=V.lerp(a,b,t);if(V.len(V.sub(q,on))<=TOL.weld*4)cuts.push({t,p:q});}cuts.sort((x,y)=>x.t-y.t);const out:Vec3[]=[];for(const c of cuts)if(!out.length||!V.near(out[out.length-1],c.p))out.push(c.p);out[out.length-1]=b;return out;}
function boundaryLoopsFromPolygons(polys:Vec3[][],plane:Plane):Vec3[][] {
  const pointMap=new Map<string,Vec3>();for(const p of polys)for(const q of p)pointMap.set(pointKey3(q),q);const candidates=[...pointMap.values()];
  const candidateIndex=candidates.length>=BREP_REBUILD_POLICY.indexedSplitCandidateMinimum?orderedEdgeSplitIndex(candidates):null;
  // The boundary of a coplanar polygon union is the oriented sum of the polygons' split edge
  // segments: a segment cancels only against its reverse. Track a signed multiplicity per
  // undirected segment instead of toggling its presence. A near-degenerate sliver whose apex lies
  // within the split tolerance of its base folds onto that base; it must cancel itself, never a
  // same-direction segment of its neighbour, or the traced loop breaks and invents a closing edge.
  // A segment whose endpoints share one topology key has no boundary extent and is skipped.
  type BoundaryEdge={a:Vec3,b:Vec3,ka:string,kb:string};
  const segments=new Map<string,BoundaryEdge&{count:number}>();
  const add=(a:Vec3,b:Vec3)=>{const ka=pointKey3(a),kb=pointKey3(b);if(ka===kb)return;const uk=ka<kb?`${ka}|${kb}`:`${kb}|${ka}`,seg=segments.get(uk);if(!seg){segments.set(uk,{a,b,ka,kb,count:1});return;}seg.count+=seg.ka===ka?1:-1;if(!seg.count)segments.delete(uk);};
  for(const poly of polys)for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],cuts=splitEdgePoints(a,b,candidateIndex?orderedEdgeSplitCandidates(candidateIndex,a,b):candidates);for(let j=0;j<cuts.length-1;j++)add(cuts[j],cuts[j+1]);}
  const edges:BoundaryEdge[]=[];for(const seg of segments.values())for(let n=0;n<Math.abs(seg.count);n++)edges.push(seg.count>0?{a:seg.a,b:seg.b,ka:seg.ka,kb:seg.kb}:{a:seg.b,b:seg.a,ka:seg.kb,kb:seg.ka});
  const outgoing=new Map<string,number[]>();edges.forEach((e,i)=>{if(!outgoing.has(e.ka))outgoing.set(e.ka,[]);outgoing.get(e.ka)!.push(i);});const used=new Uint8Array(edges.length);const loops:Vec3[][]=[];
  for(let si=0;si<edges.length;si++){if(used[si])continue;const seed=edges[si],loop:Vec3[]=[seed.a];let ei=si,e=seed,guard=0;while(guard++<edges.length+4){used[ei]=1;loop.push(e.b);if(e.kb===seed.ka)break;const list=(outgoing.get(e.kb)||[]).filter(i=>!used[i]);if(!list.length)break;if(list.length===1)ei=list[0];else{const prev=V.unit(V.sub(e.b,e.a));ei=list.sort((x,y)=>{const dx=V.unit(V.sub(edges[x].b,edges[x].a)),dy=V.unit(V.sub(edges[y].b,edges[y].a));const ax=Math.atan2(V.dot(plane.normal,V.cross(prev,dx)),V.dot(prev,dx));const ay=Math.atan2(V.dot(plane.normal,V.cross(prev,dy)),V.dot(prev,dy));return ay-ax;})[0];}e=edges[ei];}
    if(loop.length>3&&V.near(loop[0],loop[loop.length-1]))loop.pop();if(loop.length>=3)loops.push(loop);
  }
  return loops;
}
function classifyPlaneLoops(loops:Vec3[][],plane:Plane):{outer:Vec3[];holes:Vec3[][]}[]{const b=planeBasis(plane,loops[0]?.[0]);const info=loops.map(p=>({p,p2:p.map(q=>toPlane2(q,b)),a:v2.area(p.map(q=>toPlane2(q,b)))}));let outers=info.filter(x=>x.a>0),holes=info.filter(x=>x.a<0);if(!outers.length){info.forEach(x=>{x.p.reverse();x.p2.reverse();x.a=-x.a;});outers=info.filter(x=>x.a>0);holes=info.filter(x=>x.a<0);}const out=outers.map(o=>({outer:o.p,holes:[] as Vec3[][]}));for(const h of holes){const sample=h.p2[0];let best=-1,bestArea=Infinity;for(let i=0;i<outers.length;i++){if(pointInPolygon2(sample,outers[i].p2)&&Math.abs(outers[i].a)<bestArea){best=i;bestArea=Math.abs(outers[i].a);}}if(best>=0)out[best].holes.push(h.p);}
return out;}
interface BrepRebuildOptions { resolveShortBoundaryEdges?:boolean; preserveBoundaryCorners?:boolean; }
interface RebuildVertexRegion { outer:VertexId[]; holes:VertexId[][]; plane:Plane; }
function rebuildInputPlane(f:PolyFaceInput):Plane {
  // Construction planes avoid amplifying rounding in nearly collinear BSP fragments.
  const hint=f.planeHint,usable=hint&&hint.normal.every(Number.isFinite)&&Number.isFinite(hint.offset)&&Math.abs(V.len(hint.normal)-1)<=TOL.coplanarAngle&&f.points.every(p=>Math.abs(V.dot(hint.normal,p)-hint.offset)<=TOL.plane);
  return usable?{normal:[...hint.normal] as Vec3,offset:hint.offset}:planeFromPoints(f.points);
}
function resolveShortRebuildBoundaryEdges(regions:RebuildVertexRegion[],vertices:Map<VertexId,Vertex>):Map<VertexId,VertexId> {
  // Only original boundary neighbours can collapse. Keep every incident plane and
  // each original cluster member inside the canonical resolution budget.
  const parent=new Map<VertexId,VertexId>(),members=new Map<VertexId,VertexId[]>(),planes=new Map<VertexId,Set<Plane>>(),incident=new Map<VertexId,Set<number>>();
  for(const id of vertices.keys()){parent.set(id,id);members.set(id,[id]);planes.set(id,new Set());incident.set(id,new Set());}
  const root=(id:VertexId):VertexId=>{let r=id;while(parent.get(r)!==r)r=parent.get(r)!;while(id!==r){const next=parent.get(id)!;parent.set(id,r);id=next;}return r;};
  const edges:[VertexId,VertexId][]=[];
  for(const r of regions)for(const loop of [r.outer,...r.holes])for(let i=0;i<loop.length;i++){
    const a=loop[i],b=loop[(i+1)%loop.length];planes.get(a)!.add(r.plane);
    if(a!==b&&V.len(V.sub(vertices.get(a)!.position,vertices.get(b)!.position))<TOL.minimumEdge){const n=edges.length;edges.push([a,b]);incident.get(a)!.add(n);incident.get(b)!.add(n);}
  }
  const queue=edges.map((_e,i)=>i),pending=new Set(queue);
  for(let head=0;head<queue.length;head++){
    const n=queue[head];pending.delete(n);const [aa,bb]=edges[n],a=root(aa),b=root(bb);if(a===b)continue;
    const joinedMembers=[...members.get(a)!,...members.get(b)!],joinedPlanes=new Set([...planes.get(a)!,...planes.get(b)!]);
    const feasible=(id:VertexId)=>{const p=vertices.get(id)!.position;return joinedMembers.every(v=>V.len(V.sub(p,vertices.get(v)!.position))<TOL.minimumEdge)&&[...joinedPlanes].every(pl=>Math.abs(V.dot(pl.normal,p)-pl.offset)<=TOL.plane);};
    const keep=feasible(a)?a:feasible(b)?b:null;if(keep===null)continue;const drop=keep===a?b:a;
    parent.set(drop,keep);members.set(keep,joinedMembers);planes.set(keep,joinedPlanes);
    const joinedEdges=new Set([...incident.get(a)!,...incident.get(b)!]);incident.set(keep,joinedEdges);
    for(const e of joinedEdges)if(!pending.has(e)){pending.add(e);queue.push(e);}
  }
  for(const id of parent.keys())parent.set(id,root(id));return parent;
}
function mergeCoplanarInputs(inputs:PolyFaceInput[]):{outer:Vec3[];holes:Vec3[][];plane:Plane;group?:string;provenance?:FaceProvenance;hint?:string}[]{
  // Do not make logical-face merging depend on which side of a rounded hash
  // bucket a numerically noisy CSG polygon happens to land on. The key is only
  // an acceleration hint; actual grouping uses the semantic coplanar
  // tolerances. This is important for long circular walls where adjacent CSG
  // fragments can differ by ~1e-10 yet must remain one logical face.
  // Offset buckets only narrow the search: a polygon still joins the first group, in creation
  // order, that passes the coplanar test, exactly as a scan over every group would choose.
  type G={plane:Plane,group?:string,polys:Vec3[][],prov?:FaceProvenance,hint?:string,order:number};const byGroup=new Map<string,G[]>(),byOffset=new Map<string,Map<number,G[]>>();
  const coplanar=(x:G,pl:Plane)=>V.dot(x.plane.normal,pl.normal)>BREP_REBUILD_POLICY.coplanarGroupMinimumNormalDot&&Math.abs(x.plane.offset-pl.offset)<=BREP_REBUILD_POLICY.coplanarGroupOffset;
  for(const f of inputs){if(f.points.length<3)continue;
    const pl=rebuildInputPlane(f),gk=f.group||'',list=byGroup.get(gk)||[],buckets=byOffset.get(gk)||new Map<number,G[]>(),home=Math.floor(pl.offset/BREP_REBUILD_POLICY.coplanarOffsetBucket);let g:G|undefined;
    // Similar normals/offsets are only a candidate test. A small angular
    // difference can exceed the planarity budget away from the plane origin;
    // parallel planes can also differ by more than that budget. Every incoming
    // vertex must fit the fixed group plane that the rebuilt faces will use.
    for(let k=home-1;k<=home+1;k++)for(const x of buckets.get(k)||[]){if(g&&x.order>g.order)break;if(coplanar(x,pl)&&f.points.every(p=>Math.abs(V.dot(x.plane.normal,p)-x.plane.offset)<=TOL.plane)){g=x;break;}}
    if(!g){g={plane:pl,group:f.group,polys:[],prov:f.provenance,hint:f.faceIdHint,order:list.length};list.push(g);byGroup.set(gk,list);const bucket=buckets.get(home);if(bucket)bucket.push(g);else buckets.set(home,[g]);byOffset.set(gk,buckets);}g.polys.push(f.points);}
  const result:any[]=[];for(const list of byGroup.values())for(const g of list){const loops=boundaryLoopsFromPolygons(g.polys,g.plane);for(const c of classifyPlaneLoops(loops,g.plane))result.push({...c,plane:g.plane,group:g.group,provenance:g.prov,hint:g.hint});}return result;
}
function simplifyCollinearLoop3(input:Vec3[]):Vec3[]{return simplifyCollinearLoop3WithinDistance(input,TOL.weld*8);}
function simplifyCollinearLoop3WithinDistance(input:Vec3[],maximumDistance:number):Vec3[]{
  // Recompute neighbours after each removal. Simultaneously dropping a corner
  // and a nearby subdivision can replace both incident edges with a diagonal.
  // Only the two affected neighbours need rechecking. Queue work is bounded
  // by the initial vertices plus two entries per monotonic removal.
  const n=input.length;if(n<=3)return [...input];const previous=Int32Array.from(input,(_p,i)=>(i+n-1)%n),next=Int32Array.from(input,(_p,i)=>(i+1)%n),alive=new Uint8Array(n).fill(1),queue=Array.from(input,(_p,i)=>i);let count=n;
  for(let head=0;head<queue.length&&count>3;head++){const i=queue[head];if(!alive[i])continue;const ai=previous[i],ci=next[i],a=input[ai],b=input[i],c=input[ci],ac=V.sub(c,a),l2=V.dot(ac,ac);if(l2<=TOL.minimumEdge*TOL.minimumEdge)continue;const t=V.dot(V.sub(b,a),ac)/l2;if(t<=1e-8||t>=1-1e-8||V.len(V.sub(b,V.lerp(a,c,t)))>maximumDistance)continue;alive[i]=0;count--;next[ai]=ci;previous[ci]=ai;queue.push(ai,ci);}
  return input.filter((_p,i)=>!!alive[i]);
}
function collapseConsecutiveWeldedVertexIds(ids:VertexId[]):VertexId[]{
  const out:VertexId[]=[];for(const id of ids)if(!out.length||out[out.length-1]!==id)out.push(id);if(out.length>1&&out[0]===out[out.length-1])out.pop();return out;
}
interface EdgeSplitPointIndex { axes:[Vec3[],Vec3[],Vec3[]]; }
function edgeSplitPointIndex(points:Vec3[]):EdgeSplitPointIndex{return {axes:[0,1,2].map(axis=>[...points].sort((a,b)=>a[axis]-b[axis])) as [Vec3[],Vec3[],Vec3[]]};}
function lowerBoundPointAxis(points:Vec3[],axis:number,value:number):number{let lo=0,hi=points.length;while(lo<hi){const mid=(lo+hi)>>>1;if(points[mid][axis]<value)lo=mid+1;else hi=mid;}return lo;}
function upperBoundPointAxis(points:Vec3[],axis:number,value:number):number{let lo=0,hi=points.length;while(lo<hi){const mid=(lo+hi)>>>1;if(points[mid][axis]<=value)lo=mid+1;else hi=mid;}return lo;}
function edgeSplitCandidates(index:EdgeSplitPointIndex,a:Vec3,b:Vec3):Vec3[]{
  // A point can split an edge only when it lies within the existing weld tolerance of the segment.
  // Use an axis-range index as an exact prefilter; splitEdgePoints still owns the geometric decision.
  const pad=TOL.weld*4;let bestAxis=0,bestLo=0,bestHi=index.axes[0].length,bestCount=bestHi;
  for(let axis=0;axis<3;axis++){const points=index.axes[axis],min=Math.min(a[axis],b[axis])-pad,max=Math.max(a[axis],b[axis])+pad,lo=lowerBoundPointAxis(points,axis,min),hi=upperBoundPointAxis(points,axis,max),count=hi-lo;if(count<bestCount){bestAxis=axis;bestLo=lo;bestHi=hi;bestCount=count;}}
  return index.axes[bestAxis].slice(bestLo,bestHi);
}
// splitEdgePoints breaks exact parameter ties by candidate order, so boundary tracing prefilters
// with an index that hands back the surviving candidates in their original order. Like
// edgeSplitCandidates, it only discards points that cannot pass the point-to-segment test.
interface OrderedEdgeSplitIndex { points:Vec3[]; axes:[Int32Array,Int32Array,Int32Array]; }
function orderedEdgeSplitIndex(points:Vec3[]):OrderedEdgeSplitIndex{const byAxis=(axis:number)=>Int32Array.from(points.keys()).sort((i,j)=>points[i][axis]-points[j][axis]);return {points,axes:[byAxis(0),byAxis(1),byAxis(2)]};}
function orderedAxisBound(index:OrderedEdgeSplitIndex,axis:number,value:number,inclusive:boolean):number{const ids=index.axes[axis];let lo=0,hi=ids.length;while(lo<hi){const mid=(lo+hi)>>>1,v=index.points[ids[mid]][axis];if(v<value||(inclusive&&v===value))lo=mid+1;else hi=mid;}return lo;}
function orderedEdgeSplitCandidates(index:OrderedEdgeSplitIndex,a:Vec3,b:Vec3):Vec3[]{
  const pad=BREP_REBUILD_POLICY.splitCandidatePrefilterPad,min:Vec3=[Math.min(a[0],b[0])-pad,Math.min(a[1],b[1])-pad,Math.min(a[2],b[2])-pad],max:Vec3=[Math.max(a[0],b[0])+pad,Math.max(a[1],b[1])+pad,Math.max(a[2],b[2])+pad];let bestAxis=0,bestLo=0,bestHi=index.points.length;
  for(let axis=0;axis<3;axis++){const lo=orderedAxisBound(index,axis,min[axis],false),hi=orderedAxisBound(index,axis,max[axis],true);if(hi-lo<bestHi-bestLo){bestAxis=axis;bestLo=lo;bestHi=hi;}}
  // Keep only points inside the full padded box (the same box splitEdgePoints tests), then restore original order.
  const ids=index.axes[bestAxis],keep:number[]=[];for(let n=bestLo;n<bestHi;n++){const i=ids[n],q=index.points[i];if(q[0]>=min[0]&&q[0]<=max[0]&&q[1]>=min[1]&&q[1]<=max[1]&&q[2]>=min[2]&&q[2]<=max[2])keep.push(i);}
  return keep.sort((i,j)=>i-j).map(i=>index.points[i]);
}
function splitAllFaceEdges(regions:{outer:Vec3[];holes:Vec3[][];plane:Plane;group?:string;provenance?:FaceProvenance;hint?:string}[],preserveBoundaryCorners=false){const distance=preserveBoundaryCorners?BREP_REBUILD_POLICY.splitBoundaryCollinearDistance:TOL.weld*8,simplified=regions.map(r=>({...r,outer:simplifyCollinearLoop3WithinDistance(r.outer,distance),holes:r.holes.map(h=>simplifyCollinearLoop3WithinDistance(h,distance))}));const all:Vec3[]=[];for(const r of simplified){all.push(...r.outer);for(const h of r.holes)all.push(...h);}const index=edgeSplitPointIndex(all),split=(loop:Vec3[])=>{const out:Vec3[]=[];for(let i=0;i<loop.length;i++){const a=loop[i],b=loop[(i+1)%loop.length],cuts=splitEdgePoints(a,b,edgeSplitCandidates(index,a,b));out.push(...cuts.slice(0,-1));}return out;};return simplified.map(r=>({...r,outer:split(r.outer),holes:r.holes.map(split)}));}
// Distance-decided welding looks at the 3x3x3 neighbour cells of a point. Nested numeric maps
// replace one string key per neighbour lookup; cells are still visited in dx, dy, dz order and
// items in insertion order, so equal distances resolve to the same vertex as a string-keyed grid.
interface WeldGrid<T> { cell(p:Vec3):[number,number,number]; add(c:[number,number,number],item:T):void; near(c:[number,number,number],out:T[]):T[]; }
function weldGrid<T>(cellSize:number):WeldGrid<T>{
  const cells=new Map<number,Map<number,Map<number,T[]>>>();
  return {
    cell:p=>[Math.floor(p[0]/cellSize),Math.floor(p[1]/cellSize),Math.floor(p[2]/cellSize)],
    add(c,item){let ys=cells.get(c[0]);if(!ys){ys=new Map();cells.set(c[0],ys);}let zs=ys.get(c[1]);if(!zs){zs=new Map();ys.set(c[1],zs);}const list=zs.get(c[2]);if(list)list.push(item);else zs.set(c[2],[item]);},
    near(c,out){out.length=0;for(let dx=-1;dx<=1;dx++){const ys=cells.get(c[0]+dx);if(!ys)continue;for(let dy=-1;dy<=1;dy++){const zs=ys.get(c[1]+dy);if(!zs)continue;for(let dz=-1;dz<=1;dz++){const list=zs.get(c[2]+dz);if(list)for(const item of list)out.push(item);}}}return out;},
  };
}
function buildSolidFromPolygonsImpl(inputs:PolyFaceInput[], id='s'+topologySerial++,options:BrepRebuildOptions={}):Solid {
  const regions=splitAllFaceEdges(mergeCoplanarInputs(inputs),options.preserveBoundaryCorners);const vertices=new Map<VertexId,Vertex>();let vn=1,ln=1,fn=1,hn=1;const loops=new Map<LoopId,Loop>(),faces=new Map<FaceId,Face>(),halfEdges=new Map<HalfEdgeId,HalfEdge>();const edgeRefs:{id:HalfEdgeId,a:VertexId,b:VertexId}[]=[];
  // CSG intersections often produce the same conceptual point with a few
  // nanometres of floating-point drift. A single rounded hash key has a hard
  // bucket boundary, so two points 3e-9 apart can still receive different
  // VertexIds when they straddle that boundary. Use a spatial bucket only as
  // an acceleration structure and decide welding by real distance. The weld
  // radius stays well below minimumEdge, so this cannot erase valid topology.
  const weldRadius=BREP_REBUILD_POLICY.canonicalVertexWeldRadius,grid=weldGrid<VertexId>(TOL.topologyKey),nearby:VertexId[]=[];
  const vid=(p:Vec3)=>{
    const c=grid.cell(p);let best:VertexId|undefined,bestD=Infinity;
    for(const id of grid.near(c,nearby)){const q=vertices.get(id)!.position,d=V.len(V.sub(p,q));if(d<=weldRadius&&d<bestD){best=id;bestD=d;}}
    if(best)return best;
    const id='v'+vn++;vertices.set(id,{id,position:[...p] as Vec3});grid.add(c,id);return id;
  };
  const vertexRegions=regions.map(r=>({...r,outer:r.outer.map(vid),holes:r.holes.map(h=>h.map(vid))}));
  const resolved=options.resolveShortBoundaryEdges?resolveShortRebuildBoundaryEdges(vertexRegions,vertices):null;
  for(const r of vertexRegions){let faceId:string;if(r.hint&&!faces.has(r.hint)){faceId=r.hint;}else{do{faceId='f'+fn++;}while(faces.has(faceId));}const face:Face={id:faceId,plane:r.plane,outerLoop:'',innerLoops:[],provenance:r.provenance,boundaryGroup:r.group};const makeLoop=(points:VertexId[],kind:'outer'|'hole'):LoopId|null=>{const ids=collapseConsecutiveWeldedVertexIds(points.map(id=>resolved?.get(id)||id));if(ids.length<3)return null;if(resolved){const basis=planeBasis(r.plane,vertices.get(ids[0])!.position),area=v2.area(ids.map(id=>toPlane2(vertices.get(id)!.position,basis)));if(Math.abs(area)<=TOL.minimumFaceArea)return null;}const lid='l'+ln++,hes=ids.map(()=>`he${hn++}`);loops.set(lid,{id:lid,kind,firstHalfEdge:hes[0]});for(let i=0;i<ids.length;i++){const he:HalfEdge={id:hes[i],origin:ids[i],twin:'',next:hes[(i+1)%ids.length],prev:hes[(i+ids.length-1)%ids.length],loop:lid,face:faceId};halfEdges.set(he.id,he);edgeRefs.push({id:he.id,a:ids[i],b:ids[(i+1)%ids.length]});}return lid;};const outer=makeLoop(r.outer,'outer');if(!outer)continue;face.outerLoop=outer;face.innerLoops=r.holes.map(h=>makeLoop(h,'hole')).filter((lid):lid is LoopId=>lid!==null);faces.set(faceId,face);}
  // Spatial welding can map two adjacent input points to the same canonical vertex.
  // Never materialize that as a zero-length half-edge; if an entire loop becomes
  // degenerate, drop it before topology is created and prune vertices used nowhere else.
  const usedVertices=new Set<VertexId>();for(const e of edgeRefs){usedVertices.add(e.a);usedVertices.add(e.b);}for(const id of vertices.keys())if(!usedVertices.has(id))vertices.delete(id);
  const paired=new Map<string,{id:HalfEdgeId,a:VertexId,b:VertexId}[]>();for(const e of edgeRefs){const k=e.a<e.b?`${e.a}|${e.b}`:`${e.b}|${e.a}`;if(!paired.has(k))paired.set(k,[]);paired.get(k)!.push(e);}for(const [k,list] of paired){if(list.length===2){const a=halfEdges.get(list[0].id)!,b=halfEdges.get(list[1].id)!;a.twin=b.id;b.twin=a.id;}else if(list.length>2)throw Error('Non-manifold edge while building B-rep: '+k);}
  return {id,vertices,halfEdges,loops,faces,metadata:{}};
}
function buildSolidFromPolygons(inputs:PolyFaceInput[],id='s'+topologySerial++,options:BrepRebuildOptions={}):Solid{return profiler.measure('geometry','B-rep rebuild',()=>buildSolidFromPolygonsImpl(inputs,id,options),{polygons:inputs.length});}
// A conforming indexed surface already owns its edge subdivisions. Preserve
// those identities instead of treating nearby points as new polygon cuts.
// Reuse the canonical loop constructor and its complete validation; no second
// persistent mesh representation or relaxed acceptance is introduced.
function buildSolidFromIndexedTriangles(vertices:Vec3[],triangles:[number,number,number][],component:readonly number[],id:string,provenance:FaceProvenance):Solid {
  const used=new Set<number>();
  const faces=component.map(ti=>{
    const triangle=triangles[ti];if(!triangle||new Set(triangle).size!==3||triangle.some(index=>!Number.isInteger(index)||index<0||index>=vertices.length))throw Error('Indexed solid has an invalid triangle.');
    for(const index of triangle)used.add(index);
    return {id:`f${ti+1}`,outer:triangle.map(index=>`v${index+1}`),holes:[],provenance,boundaryGroup:`triangle:${ti}`};
  });
  return deserializeProjectSolid({schema:'poly-brep-1',id,metadata:{},vertices:[...used].map(index=>({id:`v${index+1}`,position:vertices[index]})),faces});
}
function splitPolygonLine2(poly:Vec2[],a:Vec2,b:Vec2):{inside:Vec2[];outside:Vec2[]}{const inside:Vec2[]=[],outside:Vec2[]=[];const side=(p:Vec2)=>v2.cross(a,b,p);for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],sp=side(p),sq=side(q),pin=sp>=-1e-10,qin=sq>=-1e-10;(pin?inside:outside).push(p);if(pin!==qin){const t=sp/(sp-sq);const x:[number,number]=[p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t];inside.push(x);outside.push(x);}}const safe=(p:Vec2[])=>{if(p.length<3||Math.abs(v2.area(p))<TOL.minimumFaceArea)return [] as Vec2[];try{return normalizeLoop2(p);}catch{return [] as Vec2[];}};return {inside:safe(inside),outside:safe(outside)};}
function subtractConvex2(subject:Vec2[],clipInput:Vec2[]):Vec2[][]{let clip=[...clipInput];if(v2.area(clip)<0)clip.reverse();let insideParts=[subject],outsideParts:Vec2[][]=[];for(let i=0;i<clip.length;i++){const a=clip[i],b=clip[(i+1)%clip.length],next:Vec2[][]=[];for(const p of insideParts){const s=splitPolygonLine2(p,a,b);if(s.outside.length)outsideParts.push(s.outside);if(s.inside.length)next.push(s.inside);}insideParts=next;if(!insideParts.length)break;}return outsideParts;}
const FACE_TESSELLATION_POLICY=Object.freeze({boundaryCoordinateRoundoff:1e-8});
function triangulateFaceLocal(s:Solid,faceId:FaceId,minimumEarCross?:number,boundary:'plane'|'canonical'='plane'):Vec3[][]{
  const loops=faceLoopPoints(s,faceId),face=s.faces.get(faceId)!,b=planeBasis(face.plane,loops.outer[0]),rings=[loops.outer,...loops.holes],flat=rings.map(r=>r.map(p=>toPlane2(p,b))),result=triangulatePolygonWithHoles2(flat[0],flat.slice(1),minimumEarCross);
  if(boundary==='plane')return result.triangles.map(t=>t.map(i=>fromPlane2(result.points[i],b)));
  // Planarity has a finite budget. Lifting a boundary onto the representative
  // plane can move a shared canonical vertex differently on each incident face.
  // Preserve source vertices and interpolate source edges for boundary slabs.
  const uvPoints=result.points.map(q=>[q[0],q[1],0] as Vec3),index=edgeSplitPointIndex(uvPoints),pointIndices=new Map(uvPoints.map((q,i)=>[q,i])),mapped:(Vec3|undefined)[]=new Array(uvPoints.length),epsilon=FACE_TESSELLATION_POLICY.boundaryCoordinateRoundoff;
  // Reuse the exact candidate-range index. Its broader weld padding is only
  // a prefilter; every boundary match still passes the smaller UV budget.
  for(let r=0;r<flat.length;r++)for(let i=0;i<flat[r].length;i++){
    const a:Vec3=[flat[r][i][0],flat[r][i][1],0];for(const q of edgeSplitCandidates(index,a,a)){const qi=pointIndices.get(q)!;if(!mapped[qi]&&Math.hypot(q[0]-a[0],q[1]-a[1])<=epsilon)mapped[qi]=rings[r][i];}
  }
  for(let r=0;r<flat.length;r++)for(let i=0;i<flat[r].length;i++){
    const j=(i+1)%flat[r].length,a:Vec3=[flat[r][i][0],flat[r][i][1],0],c:Vec3=[flat[r][j][0],flat[r][j][1],0],dx=c[0]-a[0],dy=c[1]-a[1],lengthSquared=dx*dx+dy*dy;if(!lengthSquared)continue;
    for(const q of edgeSplitCandidates(index,a,c)){const qi=pointIndices.get(q)!;if(mapped[qi])continue;const t=clamp(((q[0]-a[0])*dx+(q[1]-a[1])*dy)/lengthSquared,0,1);if(Math.hypot(q[0]-a[0]-t*dx,q[1]-a[1]-t*dy)<=epsilon)mapped[qi]=V.lerp(rings[r][i],rings[r][j],t);}
  }
  const points=result.points.map((q,i)=>mapped[i]||fromPlane2(q,b));return result.triangles.map(t=>t.map(i=>points[i]));
}
function solidMeshLocalImpl(s:Solid,minimumEarCross?:number):Mesh {const vertices:Vec3[]=[],triangles:[number,number,number][]=[],faceIds:FaceId[]=[];
  // Face triangulation projects points to/from local planes, so two copies of the
  // same B-rep vertex can differ by a few floating-point ulps. A rounded hash
  // alone has bucket-boundary failures; use neighbouring spatial buckets and a
  // real distance test, as the B-rep builder does. Keep the radius far below the
  // minimum valid edge length so legitimate topology cannot be collapsed.
  const weldRadius=TOL.weld*8,grid=weldGrid<number>(TOL.topologyKey),nearby:number[]=[];
  const idx=(p:Vec3)=>{const c=grid.cell(p);let best=-1,bestD=Infinity;for(const i of grid.near(c,nearby)){const d=V.len(V.sub(p,vertices[i]));if(d<=weldRadius&&d<bestD){best=i;bestD=d;}}if(best>=0)return best;const i=vertices.length;vertices.push([...p] as Vec3);grid.add(c,i);return i;};
  for(const f of s.faces.values())for(const tri of triangulateFaceLocal(s,f.id,minimumEarCross,'canonical')){const a=idx(tri[0]),b=idx(tri[1]),c=idx(tri[2]);if(a===b||b===c||c===a)continue;triangles.push([a,b,c]);faceIds.push(f.id);}const edgeSet=new Set<string>(),edges:[number,number][]=[];for(const he of s.halfEdges.values()){const a=idx(s.vertices.get(he.origin)!.position),b=idx(s.vertices.get(s.halfEdges.get(he.next)!.origin)!.position);if(a===b)continue;const k=a<b?`${a}|${b}`:`${b}|${a}`;if(!edgeSet.has(k)){edgeSet.add(k);edges.push([a,b]);}}return {vertices,triangles,edges,face:faceIds};}
function solidMeshLocal(s:Solid):Mesh{return profiler.measure('scene','Triangulation / mesh',()=>{
  const standard=solidMeshLocalImpl(s);
  // Nearly collinear ears can overlap a neighbouring face after the existing
  // derived-vertex weld. Retry only this topology failure, not ordinary small
  // features or open T-junctions. Canonical positions/loops remain untouched.
  if(!triangleMeshHasMicroscopicEars(standard)||!triangleMeshEdgeStats(standard).nonManifold)return standard;
  const candidate=solidMeshRetessellation(s,standard,false);
  return candidate.ok?candidate.mesh:standard;
},{faces:s.faces.size,vertices:s.vertices.size});}
// Binary STL stores coordinates as Float32. Avoid microscopic ear triangles whose tiny
// perpendicular offset can disappear when written. The same threshold can repair
// non-manifold microscopic ears in derived render meshes, with topology/volume guards.
// Ordinary triangulation remains the first choice. Units are face-local double area, mm².
const STL_EXPORT_MIN_EAR_CROSS=1e-5;
const MESH_RETESSELLATION_POLICY=Object.freeze({
  // A material comparison budget in mm³; it never authorizes a B-rep edit.
  volumeAbsoluteTolerance:1e-8,
  volumeRelativeTolerance:1e-8,
});
type MeshRetessellationResult={ok:true;mesh:Mesh}|{ok:false;reason:string};
function triangleMeshHasMicroscopicEars(m:Mesh):boolean{return m.triangles.some(t=>V.len(V.cross(V.sub(m.vertices[t[1]],m.vertices[t[0]]),V.sub(m.vertices[t[2]],m.vertices[t[0]])))<=STL_EXPORT_MIN_EAR_CROSS);}
function solidMeshExportBaseLocal(s:Solid):Mesh{return profiler.measure('scene','STL base tessellation',()=>solidMeshLocalImpl(s,STL_EXPORT_MIN_EAR_CROSS),{faces:s.faces.size,vertices:s.vertices.size});}
function triangleMeshEdgeStats(m:Mesh):{boundary:number;nonManifold:number}{const counts=new Map<string,number>();for(const t of m.triangles)for(let i=0;i<3;i++){const a=t[i],b=t[(i+1)%3],k=a<b?`${a}|${b}`:`${b}|${a}`;counts.set(k,(counts.get(k)||0)+1);}let boundary=0,nonManifold=0;for(const n of counts.values()){if(n===1)boundary++;else if(n!==2)nonManifold++;}return {boundary,nonManifold};}
function triangleMeshEdgeCounts(m:Mesh):Map<string,number>{const counts=new Map<string,number>();for(const t of m.triangles)for(let i=0;i<3;i++){const a=t[i],b=t[(i+1)%3],k=a<b?`${a}|${b}`:`${b}|${a}`;counts.set(k,(counts.get(k)||0)+1);}return counts;}
const TRIANGLE_SEAM_POLICY=Object.freeze({maxPasses:8,endpointFraction:1e-9,distance:TOL.weld*8});
function conformTriangleMeshBoundaries(m:Mesh,requireClosed=true,maximumTriangles=Infinity):Mesh {
  // Face triangulation may deliberately remove collinear boundary vertices or insert a bridge
  // point while connecting a hole. That leaves T-junctions between otherwise valid adjacent
  // faces. Repair only the triangle edges that are actually open in the current mesh. The former
  // all-vertices/all-edges pass could also split internal diagonals at unrelated coplanar points;
  // on dense perforated faces that turned harmless geometric coincidences into 4+ triangles sharing
  // one explicit edge and made a valid solid look non-manifold at STL export.
  let current=m;
  const onEdge=(q:Vec3,a:Vec3,b:Vec3):number|null=>{const d=V.sub(b,a),l2=V.dot(d,d);if(l2<=TOL.minimumEdge*TOL.minimumEdge)return null;const t=V.dot(V.sub(q,a),d)/l2;if(t<=TRIANGLE_SEAM_POLICY.endpointFraction||t>=1-TRIANGLE_SEAM_POLICY.endpointFraction)return null;return V.len(V.sub(q,V.lerp(a,b,t)))<=TRIANGLE_SEAM_POLICY.distance?t:null;};
  for(let pass=0;pass<TRIANGLE_SEAM_POLICY.maxPasses;pass++){
    const counts=triangleMeshEdgeCounts(current),boundaryKeys=[...counts.entries()].filter(([,n])=>n===1).map(([k])=>k),nonManifold=[...counts.values()].filter(n=>n!==1&&n!==2).length;
    if(!boundaryKeys.length&&!nonManifold)return current;
    if(nonManifold)throw Error(`Triangle mesh is non-manifold (open edges: ${boundaryKeys.length}, non-manifold edges: ${nonManifold}).`);
    const boundarySet=new Set(boundaryKeys),candidateSet=new Set<number>();for(const key of boundaryKeys){const [a,b]=key.split('|').map(Number);candidateSet.add(a);candidateSet.add(b);}const candidates=[...candidateSet];
    const vertices=current.vertices.map(p=>[...p] as Vec3),triangles:[number,number,number][]=[],face:FaceId[]=[];let changed=false;
    for(let ti=0;ti<current.triangles.length;ti++){
      const src=current.triangles[ti],ring:number[]=[];let split=false;
      for(let e=0;e<3;e++){
        const ia=src[e],ib=src[(e+1)%3],key=ia<ib?`${ia}|${ib}`:`${ib}|${ia}`,cuts:{t:number;i:number}[]=[{t:0,i:ia},{t:1,i:ib}];
        if(boundarySet.has(key))for(const qi of candidates){if(qi===ia||qi===ib)continue;const t=onEdge(current.vertices[qi],current.vertices[ia],current.vertices[ib]);if(t!==null)cuts.push({t,i:qi});}
        cuts.sort((x,y)=>x.t-y.t);if(cuts.length>2)split=true;let last=-1;for(let i=0;i<cuts.length-1;i++){const id=cuts[i].i;if(id!==last){ring.push(id);last=id;}}
      }
      if(!split){triangles.push([src[0],src[1],src[2]]);face.push(current.face[ti]);if(triangles.length>maximumTriangles)throw Error('Triangle seam reconstruction exceeds the triangle budget.');continue;}
      changed=true;const a=current.vertices[src[0]],b=current.vertices[src[1]],c=current.vertices[src[2]],center:Vec3=[(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3,(a[2]+b[2]+c[2])/3],ci=vertices.length;vertices.push(center);
      for(let i=0;i<ring.length;i++){const ia=ring[i],ib=ring[(i+1)%ring.length];if(ia===ib||V.len(V.sub(vertices[ia],vertices[ib]))<=TOL.minimumEdge)continue;triangles.push([ci,ia,ib]);face.push(current.face[ti]);if(triangles.length>maximumTriangles)throw Error('Triangle seam reconstruction exceeds the triangle budget.');}
    }
    if(!changed)break;
    current={vertices,triangles,edges:current.edges.map(e=>[e[0],e[1]] as [number,number]),face};
  }
  const stats=triangleMeshEdgeStats(current);if(stats.nonManifold||requireClosed&&stats.boundary)throw Error(`Could not create a closed STL mesh (open edges: ${stats.boundary}, non-manifold edges: ${stats.nonManifold}).`);return current;
}
function conformTriangleMeshForExport(m:Mesh):Mesh{return conformTriangleMeshBoundaries(m);}
function triangleMeshNeedsFloat32Retessellation(m:Mesh):boolean{for(const t of m.triangles){const p=t.map(i=>m.vertices[i].map(Math.fround) as Vec3) as [Vec3,Vec3,Vec3],area2=V.len(V.cross(V.sub(p[1],p[0]),V.sub(p[2],p[0])));if(area2<=TOL.minimumFaceArea*2)return true;}return false;}
function solidMeshRetessellation(s:Solid,standard:Mesh,requireFloat32Safe:boolean):MeshRetessellationResult{
  // One adapter owns the throwing tessellator/conformance contract. A candidate
  // is derived state, accepted only with closed topology and conserved material.
  try{
    const mesh=conformTriangleMeshForExport(solidMeshExportBaseLocal(s));
    if(requireFloat32Safe&&triangleMeshNeedsFloat32Retessellation(mesh))return {ok:false,reason:'Retessellation still degenerates in Float32.'};
    const originalVolume=signedVolumeTriangles(standard.vertices,standard.triangles),volume=signedVolumeTriangles(mesh.vertices,mesh.triangles);
    const budget=Math.max(MESH_RETESSELLATION_POLICY.volumeAbsoluteTolerance,Math.abs(originalVolume)*MESH_RETESSELLATION_POLICY.volumeRelativeTolerance);
    if(!Number.isFinite(originalVolume)||originalVolume<=0||!Number.isFinite(volume)||volume<=0||Math.abs(volume-originalVolume)>budget)return {ok:false,reason:'Retessellation exceeds its material volume budget.'};
    return {ok:true,mesh};
  }catch(error){return {ok:false,reason:errorMessage(error)};}
}
function solidMeshExportLocal(s:Solid):Mesh{return profiler.measure('scene','STL closed tessellation',()=>{
  const standard=conformTriangleMeshForExport(solidMeshLocal(s));
  if(!triangleMeshNeedsFloat32Retessellation(standard))return standard;
  // Only complex near-collinear faces need the stronger export-only ear filter. Some legitimate
  // high-detail solids (notably helical thread faces) rely on the ordinary triangulation, so this
  // is an opportunistic second tessellation rather than a global simplification policy.
  const candidate=solidMeshRetessellation(s,standard,true);
  return candidate.ok?candidate.mesh:standard;
},{faces:s.faces.size,vertices:s.vertices.size});}
function solidMeshWorld(o:ModelObject):Mesh {const m=solidMeshLocal(o.solid);return {...m,vertices:m.vertices.map(p=>transformPoint(p,o.transform))};}
function solidMeshExportWorld(o:Pick<ModelObject,'solid'|'transform'>):Mesh {const m=solidMeshExportLocal(o.solid);return {...m,vertices:m.vertices.map(p=>transformPoint(p,o.transform))};}
function validateSolidImpl(s:Solid,throwOnError=true,onMesh?:(mesh:Mesh)=>void):{ok:boolean;errors:string[];volume:number}{
  const errors:string[]=[];const visited=new Set<HalfEdgeId>();
  for(const l of s.loops.values()){
    if(!s.halfEdges.has(l.firstHalfEdge)){errors.push(`Loop ${l.id} is missing firstHalfEdge`);continue;}
    const hes=loopHalfEdges(s,l.id);if(hes.length<3)errors.push(`Loop ${l.id} has fewer than three edges`);
    if(hes.length&&hes[hes.length-1].next!==l.firstHalfEdge)errors.push(`Loop ${l.id} is not closed`);
    for(const he of hes){visited.add(he.id);if(he.loop!==l.id)errors.push(`Half-edge ${he.id} points to the wrong loop`);const next=s.halfEdges.get(he.next),prev=s.halfEdges.get(he.prev);if(!next||!prev){errors.push(`Broken next/prev on ${he.id}`);continue;}if(next.prev!==he.id||prev.next!==he.id)errors.push(`Inconsistent next/prev on ${he.id}`);if(next.loop!==l.id||prev.loop!==l.id)errors.push(`Loop chain crosses into another loop at ${he.id}`);}
  }
  if(visited.size!==s.halfEdges.size)errors.push('One or more half-edges do not belong to a closed loop');
  for(const he of s.halfEdges.values()){
    const next=s.halfEdges.get(he.next),twin=s.halfEdges.get(he.twin),origin=s.vertices.get(he.origin);if(!origin||!next){errors.push(`Broken vertex/next on ${he.id}`);continue;}
    if(!twin)errors.push(`Open edge ${he.id}`);else{if(twin.twin!==he.id)errors.push(`Invalid twin ${he.id}`);const twinNext=s.halfEdges.get(twin.next);if(!twinNext||twin.origin!==next.origin||twinNext.origin!==he.origin)errors.push(`Twin orientation is not opposite on ${he.id}`);}
    if(!s.faces.has(he.face))errors.push(`Half-edge ${he.id} points to an unknown face`);
    const a=origin.position,b=s.vertices.get(next.origin)?.position;if(!b)errors.push(`Half-edge ${he.id} points to an unknown destination`);else if(V.len(V.sub(a,b))<TOL.minimumEdge)errors.push(`Short edge ${he.id}`);
  }
  for(const f of s.faces.values()){
    const outer=s.loops.get(f.outerLoop);if(!outer||outer.kind!=='outer')errors.push(`Face ${f.id} is missing an outer loop`);for(const lid of f.innerLoops){const h=s.loops.get(lid);if(!h||h.kind!=='hole')errors.push(`Face ${f.id} has invalid hole loop ${lid}`);}
    const lids=[f.outerLoop,...f.innerLoops];for(const lid of lids)for(const he of loopHalfEdges(s,lid))if(he.face!==f.id)errors.push(`Loop ${lid} points to the wrong face`);
    let lp:{outer:Vec3[];holes:Vec3[][]};try{lp=faceLoopPoints(s,f.id);}catch{errors.push(`Unreadable face ${f.id}`);continue;}if(lp.outer.length<3)errors.push(`Empty face ${f.id}`);
    for(const p of [...lp.outer,...lp.holes.flat()])if(Math.abs(V.dot(f.plane.normal,p)-f.plane.offset)>TOL.plane)errors.push(`Non-planar face ${f.id}`);
    if(lp.outer.length>=3){const b=planeBasis(f.plane,lp.outer[0]),oa=v2.area(lp.outer.map(p=>toPlane2(p,b)));if(oa<=TOL.minimumFaceArea)errors.push(`Misoriented/degenerate outer loop ${f.id}`);for(const h of lp.holes){const ha=v2.area(h.map(p=>toPlane2(p,b)));if(ha>=-TOL.minimumFaceArea)errors.push(`Misoriented/degenerate hole loop ${f.id}`);}}
  }
  let volume=0;try{const m=solidMeshLocal(s);volume=signedVolumeTriangles(m.vertices,m.triangles);if(volume<=TOL.minimumFaceArea)errors.push('Non-positive volume');onMesh?.(m);}catch(e){errors.push('Triangulation failed: '+errorMessage(e));}
  if(errors.length&&throwOnError)throw Error(errors[0]);return {ok:!errors.length,errors,volume};
}
function validateSolid(s:Solid,throwOnError=true,onMesh?:(mesh:Mesh)=>void):{ok:boolean;errors:string[];volume:number}{return profiler.measure('geometry','Validate solid',()=>validateSolidImpl(s,throwOnError,onMesh),{faces:s.faces.size,halfEdges:s.halfEdges.size});}
function solidToPolyInputs(s:Solid):PolyFaceInput[]{const out:PolyFaceInput[]=[];for(const f of s.faces.values())for(const tri of triangulateFaceLocal(s,f.id))out.push({points:tri,provenance:f.provenance});return out;}
function primitivePrism(profileInput:Vec2[],height:number,id='s'+topologySerial++):Solid {
  if(!Number.isFinite(height)||height<=TOL.minimumEdge)throw Error('Prism height must be greater than 0.');
  let profile=normalizeLoop2(profileInput);if(v2.area(profile)<0)profile.reverse();
  const vertices=new Map<VertexId,Vertex>(),halfEdges=new Map<HalfEdgeId,HalfEdge>(),loops=new Map<LoopId,Loop>(),faces=new Map<FaceId,Face>();
  const bottom:VertexId[]=[],top:VertexId[]=[];for(let i=0;i<profile.length;i++){const b='v'+(i*2+1),t='v'+(i*2+2),p=profile[i];vertices.set(b,{id:b,position:[p[0],p[1],0]});vertices.set(t,{id:t,position:[p[0],p[1],height]});bottom.push(b);top.push(t);}
  let faceSerial=1,loopSerial=1,edgeSerial=1;const edgeRefs:{id:HalfEdgeId;a:VertexId;b:VertexId}[]=[];
  const addFace=(vertexIds:VertexId[],label:string,knownPlane?:Plane)=>{const faceId='f'+faceSerial++,loopId='l'+loopSerial++,heIds=vertexIds.map(()=>`he${edgeSerial++}`),points=vertexIds.map(v=>vertices.get(v)!.position),plane=knownPlane||planeFromPoints(points);loops.set(loopId,{id:loopId,kind:'outer',firstHalfEdge:heIds[0]});faces.set(faceId,{id:faceId,plane,outerLoop:loopId,innerLoops:[],provenance:{kind:'primitive',label}});for(let i=0;i<vertexIds.length;i++){const a=vertexIds[i],b=vertexIds[(i+1)%vertexIds.length],he:HalfEdge={id:heIds[i],origin:a,twin:'',next:heIds[(i+1)%heIds.length],prev:heIds[(i+heIds.length-1)%heIds.length],loop:loopId,face:faceId};halfEdges.set(he.id,he);edgeRefs.push({id:he.id,a,b});}};
  addFace([...bottom].reverse(),'Bottom',{normal:[0,0,-1],offset:0});addFace(top,'Top',{normal:[0,0,1],offset:height});for(let i=0;i<profile.length;i++){const j=(i+1)%profile.length;addFace([bottom[i],bottom[j],top[j],top[i]],'Side');}
  const pairs=new Map<string,{id:HalfEdgeId;a:VertexId;b:VertexId}[]>();for(const e of edgeRefs){const k=e.a<e.b?`${e.a}|${e.b}`:`${e.b}|${e.a}`;if(!pairs.has(k))pairs.set(k,[]);pairs.get(k)!.push(e);}for(const [key,list] of pairs){if(list.length!==2)throw Error('Non-manifold prism edge: '+key);const a=halfEdges.get(list[0].id)!,b=halfEdges.get(list[1].id)!;if(list[0].a!==list[1].b||list[0].b!==list[1].a)throw Error('Prism edge orientation is inconsistent.');a.twin=b.id;b.twin=a.id;}
  const solid:Solid={id,vertices,halfEdges,loops,faces,metadata:{}};validateSolid(solid);return solid;
}
function cylinderProfile(w=30,d=30,n=48):Vec2[]{return Array.from({length:n},(_,i)=>[w/2*Math.cos(i*2*Math.PI/n),d/2*Math.sin(i*2*Math.PI/n)] as Vec2);}

// Private, detached canonical copies for Undo. Every capture checks contents,
// including accidental in-place edits; live maps/arrays never enter a version.
function createSolidHistoryStore():SolidHistoryStore {
  const versions=new WeakMap<HistorySolidVersion,Solid>(),sources=new WeakMap<Solid,HistorySolidVersion>();
  const equalVector=(a:Vec3,b:Vec3)=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const equalData=(a:unknown,b:unknown)=>a===b||JSON.stringify(a)===JSON.stringify(b);
  const matches=(s:Solid,version:HistorySolidVersion):boolean=>{
    const p=versions.get(version);if(!p)throw Error('Unknown history geometry version.');
    if(s.id!==p.id||s.vertices.size!==p.vertices.size||s.halfEdges.size!==p.halfEdges.size||s.loops.size!==p.loops.size||s.faces.size!==p.faces.size||!equalData(s.metadata,p.metadata))return false;
    // Map order is observable to derived geometry; preserve it as well as IDs.
    const sameMap=<T>(a:Map<string,T>,b:Map<string,T>,equal:(a:T,b:T)=>boolean)=>{
      const iterator=b.entries();for(const [id,item] of a){const next=iterator.next();if(next.done||id!==next.value[0]||!equal(item,next.value[1]))return false;}return true;
    };
    return sameMap(s.vertices,p.vertices,(a,b)=>a.id===b.id&&equalVector(a.position,b.position))
      &&sameMap(s.halfEdges,p.halfEdges,(a,b)=>a.id===b.id&&a.origin===b.origin&&a.twin===b.twin&&a.next===b.next&&a.prev===b.prev&&a.loop===b.loop&&a.face===b.face)
      &&sameMap(s.loops,p.loops,(a,b)=>a.id===b.id&&a.firstHalfEdge===b.firstHalfEdge&&a.kind===b.kind)
      &&sameMap(s.faces,p.faces,(a,b)=>a.id===b.id&&equalVector(a.plane.normal,b.plane.normal)&&Object.is(a.plane.offset,b.plane.offset)&&a.outerLoop===b.outerLoop&&a.innerLoops.length===b.innerLoops.length&&a.innerLoops.every((id,i)=>id===b.innerLoops[i])&&a.material===b.material&&a.boundaryGroup===b.boundaryGroup&&equalData(a.provenance,b.provenance));
  };
  return {
    capture(s){const previous=sources.get(s);if(previous&&matches(s,previous))return previous;const version:HistorySolidVersion=Object.freeze({kind:'history-solid-version'});versions.set(version,structuredClone(s));sources.set(s,version);return version;},
    matches,
    restore(version){const stored=versions.get(version);if(!stored)throw Error('Unknown history geometry version.');const solid:Solid=structuredClone(stored);sources.set(solid,version);return solid;},
  };
}
