/**
 * Stable application-facing boundary around the B-rep kernel.
 *
 * The files below this one (02_brep and the 03_* geometry kernel files) are implementation detail.
 * Model commands and tools should ask this API for geometry queries/edits instead
 * of reconstructing topology rules themselves.  Debug rendering may still inspect
 * the raw graph deliberately.
 */
interface GeometryFaceView {
  id: FaceId;
  plane: Plane;
  outer: Vec3[];
  holes: Vec3[][];
  centroid: Vec3;
  basis: PlaneBasis;
  area: number;
  provenance?: FaceProvenance;
  boundaryGroup?: string;
}
interface GeometryBoundaryDissolveResult { solid: Solid; faceId: FaceId | null; topology?: TopologyMap; }
interface GeometryRegionResizeResult { solid: Solid; regionFaceId: FaceId; regionFaceIds?: FaceId[]; }
const CHAMFER_STRAIGHT_SELECTION_POLICY=Object.freeze({minimumParallelDot:.999999});
interface GeometryEdgeView { id: HalfEdgeId; twinId: HalfEdgeId; originVertexId: VertexId; destVertexId: VertexId; a: Vec3; b: Vec3; faceA: FaceId; faceB: FaceId; coplanar: boolean; }
interface GeometryDissolveResult { solid: Solid; faceId: FaceId | null; topology: TopologyMap; }

function topologyMapByGeometry(before:Solid,after:Solid,faceOverrides:Map<FaceId,FaceId|null>=new Map()):TopologyMap{
  const afterVertices=new Map<string,VertexId>();for(const v of after.vertices.values())afterVertices.set(pointKey3(v.position),v.id);
  const vertices=new Map<VertexId,VertexId|null>();for(const v of before.vertices.values())vertices.set(v.id,afterVertices.get(pointKey3(v.position))||null);
  const afterEdges=new Map<string,HalfEdgeId>();for(const he of after.halfEdges.values()){const next=after.halfEdges.get(he.next);if(!next)continue;const a=pointKey3(after.vertices.get(he.origin)!.position),b=pointKey3(after.vertices.get(next.origin)!.position),k=a<b?`${a}|${b}`:`${b}|${a}`;if(!afterEdges.has(k))afterEdges.set(k,he.id);}
  const edges=new Map<string,string|null>();for(const he of before.halfEdges.values()){const next=before.halfEdges.get(he.next);if(!next){edges.set(he.id,null);continue;}const a=pointKey3(before.vertices.get(he.origin)!.position),b=pointKey3(before.vertices.get(next.origin)!.position),k=a<b?`${a}|${b}`:`${b}|${a}`;edges.set(he.id,afterEdges.get(k)||null);}
  const faces=new Map<FaceId,FaceId|null>();for(const f of before.faces.values())faces.set(f.id,faceOverrides.has(f.id)?faceOverrides.get(f.id)!:(after.faces.has(f.id)?f.id:null));
  const createdFaces=[...after.faces.keys()].filter(id=>!before.faces.has(id));return {vertices,edges,faces,createdFaces};
}
function rebuildForDissolve(s:Solid,mergeFaces:Set<FaceId>,survivor:FaceId|null):Solid{
  const list=[...s.faces.values()].sort((a,b)=>a.id===survivor?-1:b.id===survivor?1:0),inputs:PolyFaceInput[]=[];
  for(const f of list){const tris=triangulateFaceLocal(s,f.id),group=mergeFaces.has(f.id)?'__dissolve__':`__keep__:${f.id}`;for(let i=0;i<tris.length;i++)inputs.push({points:tris[i],group,provenance:f.provenance,faceIdHint:i===0&&(!mergeFaces.has(f.id)||f.id===survivor)?f.id:undefined});}
  const out=buildSolidFromPolygons(inputs,s.id);
  for(const f of list){const nf=out.faces.get(f.id);if(!nf)continue;nf.material=f.material;nf.provenance=f.provenance?{...f.provenance}:undefined;nf.boundaryGroup=f.boundaryGroup;}
  if(survivor&&out.faces.has(survivor)){const originals=[...mergeFaces].map(id=>s.faces.get(id)).filter(Boolean) as Face[];const sf=s.faces.get(survivor)!;const merged=out.faces.get(survivor)!;merged.material=sf.material;merged.provenance=sf.provenance?{...sf.provenance}:undefined;merged.boundaryGroup=originals.every(f=>f.boundaryGroup===sf.boundaryGroup)?sf.boundaryGroup:undefined;}
  validateSolid(out);return out;
}
function edgeView(s:Solid,halfEdgeId:HalfEdgeId):GeometryEdgeView{const he=s.halfEdges.get(halfEdgeId);if(!he)throw Error('The edge does not exist.');const next=s.halfEdges.get(he.next),twin=s.halfEdges.get(he.twin);if(!next||!twin)throw Error('The edge has invalid topology.');const fa=s.faces.get(he.face),fb=s.faces.get(twin.face);if(!fa||!fb)throw Error('The edge points to an unknown face.');return {id:he.id,twinId:twin.id,originVertexId:he.origin,destVertexId:next.origin,a:[...s.vertices.get(he.origin)!.position] as Vec3,b:[...s.vertices.get(next.origin)!.position] as Vec3,faceA:fa.id,faceB:fb.id,coplanar:planesCoplanarSame(fa.plane,fb.plane)};}
function dissolveEdgeGeometry(s:Solid,halfEdgeId:HalfEdgeId):GeometryDissolveResult{
  const e=edgeView(s,halfEdgeId);if(!e.coplanar)throw Error('This edge separates two non-coplanar faces and cannot be dissolved without changing the shape.');
  const a=s.faces.get(e.faceA)!,b=s.faces.get(e.faceB)!,survivor=faceAreaLocal(s,a.id)>=faceAreaLocal(s,b.id)?a.id:b.id,removed=survivor===a.id?b.id:a.id,merge=new Set<FaceId>([a.id,b.id]),out=rebuildForDissolve(s,merge,survivor),overrides=new Map<FaceId,FaceId|null>([[survivor,survivor],[removed,survivor]]);
  return {solid:out,faceId:out.faces.has(survivor)?survivor:null,topology:topologyMapByGeometry(s,out,overrides)};
}
function dissolveFaceGeometry(s:Solid,faceId:FaceId):GeometryDissolveResult{
  const f=s.faces.get(faceId);if(!f)throw Error('The face does not exist.');if(f.provenance?.kind!=='split')throw Error('Only a coplanar sketch/contour face can be dissolved. A shell face cannot be deleted because that would open the solid.');
  const neighbours=new Set<FaceId>();for(const lid of [f.outerLoop,...f.innerLoops])for(const he of loopHalfEdges(s,lid)){const twin=s.halfEdges.get(he.twin),nf=twin&&s.faces.get(twin.face);if(nf&&nf.id!==f.id&&planesCoplanarSame(f.plane,nf.plane))neighbours.add(nf.id);}
  if(!neighbours.size)throw Error('The face has no coplanar neighbouring face to dissolve into.');let survivor=[...neighbours][0];for(const id of neighbours)if(faceAreaLocal(s,id)>faceAreaLocal(s,survivor))survivor=id;const merge=new Set<FaceId>([faceId,...neighbours]),out=rebuildForDissolve(s,merge,survivor),overrides=new Map<FaceId,FaceId|null>();for(const id of merge)overrides.set(id,survivor);
  return {solid:out,faceId:out.faces.has(survivor)?survivor:null,topology:topologyMapByGeometry(s,out,overrides)};
}
function vertexIsDissolvable(s:Solid,vertexId:VertexId):boolean{
  const v=s.vertices.get(vertexId);if(!v)return false;let count=0;for(const he of s.halfEdges.values())if(he.origin===vertexId){const prev=s.halfEdges.get(he.prev),next=s.halfEdges.get(he.next);if(!prev||!next)return false;const a=s.vertices.get(prev.origin)?.position,b=v.position,c=s.vertices.get(next.origin)?.position;if(!a||!c)return false;const ac=V.sub(c,a),l2=V.dot(ac,ac);if(l2<TOL.minimumEdge*TOL.minimumEdge)return false;const t=V.dot(V.sub(b,a),ac)/l2;if(t<=1e-7||t>=1-1e-7||V.len(V.sub(b,V.lerp(a,c,t)))>TOL.topologyKey*8)return false;count++;}return count>=2;
}
function dissolveVertexGeometry(s:Solid,vertexId:VertexId):GeometryDissolveResult{
  if(!s.vertices.has(vertexId))throw Error('The point does not exist.');if(!vertexIsDissolvable(s,vertexId))throw Error('This point is a real geometric corner and cannot be deleted without changing the shape.');const out=rebuildForDissolve(s,new Set(),null);if([...out.vertices.values()].some(v=>pointKey3(v.position)===pointKey3(s.vertices.get(vertexId)!.position)))throw Error('The point could not be dissolved safely.');return {solid:out,faceId:null,topology:topologyMapByGeometry(s,out)};
}

function clonePlaneValue(p:Plane):Plane{return {normal:[...p.normal] as Vec3,offset:p.offset};}

interface GeometryDeleteFeatureCandidate {
  kind:'hole'|'pocket'|'boss';
  supportFaceId:FaceId;
  supportLoopId:LoopId;
  rimHalfEdgeIds:HalfEdgeId[];
  sideFaceIds:FaceId[];
  terminalFaceId:FaceId;
  terminalLoopId:LoopId;
  terminalIsHole:boolean;
}
interface GeometryDeleteFeatureResult { solid:Solid; topology:TopologyMap; candidate:GeometryDeleteFeatureCandidate; }

function prismaticDeleteCandidateFromSupportHalfEdge(s:Solid,supportHe:HalfEdge):GeometryDeleteFeatureCandidate|null{
  const supportLoop=s.loops.get(supportHe.loop),supportFace=s.faces.get(supportHe.face);
  if(!supportLoop||supportLoop.kind!=='hole'||!supportFace)return null;
  const rim=loopHalfEdges(s,supportLoop.id);if(rim.length<3)return null;
  const sideSet=new Set<FaceId>();
  for(const he of rim){const twin=s.halfEdges.get(he.twin),side=twin&&s.faces.get(twin.face);if(!twin||!side||side.id===supportFace.id)return null;if(Math.abs(V.dot(side.plane.normal,supportFace.plane.normal))>1e-5)return null;sideSet.add(side.id);}
  const terminalEdges:HalfEdge[]=[];
  for(const sideId of sideSet){const side=s.faces.get(sideId)!;for(const lid of [side.outerLoop,...side.innerLoops])for(const he of loopHalfEdges(s,lid)){const twin=s.halfEdges.get(he.twin);if(!twin)return null;if(twin.face===supportFace.id||sideSet.has(twin.face))continue;terminalEdges.push(twin);}}
  if(terminalEdges.length<3)return null;
  const terminalFaceId=terminalEdges[0].face;if(terminalEdges.some(he=>he.face!==terminalFaceId))return null;
  const terminalFace=s.faces.get(terminalFaceId);if(!terminalFace||Math.abs(Math.abs(V.dot(terminalFace.plane.normal,supportFace.plane.normal))-1)>1e-5)return null;
  const terminalLoopId=terminalEdges[0].loop;if(terminalEdges.some(he=>he.loop!==terminalLoopId))return null;
  const terminalLoop=s.loops.get(terminalLoopId);if(!terminalLoop)return null;
  const loopHes=loopHalfEdges(s,terminalLoopId),terminalIds=new Set(terminalEdges.map(e=>e.id));
  if(loopHes.length!==terminalIds.size||loopHes.some(he=>!terminalIds.has(he.id)))return null;
  if(terminalLoop.kind==='outer'){
    if(terminalFace.outerLoop!==terminalLoopId||terminalFace.innerLoops.length)return null;
    for(const he of loopHes){const twin=s.halfEdges.get(he.twin);if(!twin||!sideSet.has(twin.face))return null;}
  }
  const supportCenter=faceCentroid(s,supportFace.id),terminalCenter=faceCentroid(s,terminalFace.id),along=V.dot(V.sub(terminalCenter,supportCenter),supportFace.plane.normal);
  const kind:GeometryDeleteFeatureCandidate['kind']=terminalLoop.kind==='hole'?'hole':along>0?'boss':'pocket';
  return {kind,supportFaceId:supportFace.id,supportLoopId:supportLoop.id,rimHalfEdgeIds:rim.map(he=>he.id),sideFaceIds:[...sideSet],terminalFaceId,terminalLoopId,terminalIsHole:terminalLoop.kind==='hole'};
}
function prismaticDeleteCandidate(s:Solid,halfEdgeId:HalfEdgeId):GeometryDeleteFeatureCandidate|null{
  const he=s.halfEdges.get(halfEdgeId);if(!he)return null;
  const direct=prismaticDeleteCandidateFromSupportHalfEdge(s,he);if(direct)return direct;
  const twin=s.halfEdges.get(he.twin);return twin?prismaticDeleteCandidateFromSupportHalfEdge(s,twin):null;
}
function healPrismaticDeleteFeature(s:Solid,halfEdgeId:HalfEdgeId):GeometryDeleteFeatureResult{
  const candidate=prismaticDeleteCandidate(s,halfEdgeId);if(!candidate)throw Error('This edge is not part of a simple removable hole, pocket, or protrusion.');
  const removed=new Set<FaceId>(candidate.sideFaceIds);if(!candidate.terminalIsHole)removed.add(candidate.terminalFaceId);
  const modifiedLoops=new Map<FaceId,LoopId>([[candidate.supportFaceId,candidate.supportLoopId]]);if(candidate.terminalIsHole)modifiedLoops.set(candidate.terminalFaceId,candidate.terminalLoopId);
  const inputs:PolyFaceInput[]=[];
  for(const f of s.faces.values()){
    if(removed.has(f.id))continue;
    let source=s;
    if(modifiedLoops.has(f.id)){source=cloneSolid(s);const mf=source.faces.get(f.id)!;mf.innerLoops=mf.innerLoops.filter(id=>id!==modifiedLoops.get(f.id));}
    const tris=triangulateFaceLocal(source,f.id);for(let i=0;i<tris.length;i++)inputs.push({points:tris[i],group:`__feature_delete__:${f.id}`,provenance:f.provenance,faceIdHint:i===0?f.id:undefined});
  }
  const out=buildSolidFromPolygons(inputs,s.id);
  for(const f of s.faces.values()){const nf=out.faces.get(f.id);if(!nf)continue;nf.material=f.material;nf.provenance=f.provenance?{...f.provenance}:undefined;nf.boundaryGroup=f.boundaryGroup;}
  validateSolid(out);return {solid:out,topology:topologyMapByGeometry(s,out),candidate};
}

function cloneLoop3(loop:Vec3[]):Vec3[]{return loop.map(p=>[...p] as Vec3);}


type EdgeFeatureWorkerRequest=
  | {type:'thread';solid:Solid;halfEdgeId:HalfEdgeId;pitch:number;depth:number;length:number;profileAngleDeg:number;direction:ThreadDirection;operation:ThreadOperation}
  | {type:'rounded-chamfer';solid:Solid;halfEdgeId:HalfEdgeId;halfEdgeIds?:HalfEdgeId[];distance:number;angleDeg:number;segments:number;operation?:ChamferOperation}
  | {type:'carve-out';solid:Solid;faceId:FaceId;wallThickness:number;minimumInnerDetail:number}
  | {type:'surface-texture';solid:Solid;faceIds:FaceId[];parameters:SurfaceTextureParameters}
  | {type:'face-text';solid:Solid;faceId:FaceId;parameters:FaceTextParameters}
  | {type:'face-twist';solid:Solid;faceId:FaceId;distance:number;angleDeg:number}
  | {type:'ground-twist';solid:Solid;faceId:FaceId;distance:number;angleDeg:number}
  | {type:'face-taper';solid:Solid;faceId:FaceId;distance:number;angleDeg:number;twistAngleDeg?:number;taperMode?:TaperMode}
  | {type:'ground-taper';solid:Solid;faceId:FaceId;distance:number;angleDeg:number;twistAngleDeg?:number;taperMode?:TaperMode};
type EdgeFeatureWorkerMessage=
  | {type:'split-surface-result';result:SplitSurfaceResult}
  | {type:'stl-export-result';bytes:ArrayBuffer}
  | {type:'object-subtract-result';result:BooleanSubtractResult}
  | {type:'object-union-result';result:BooleanUnionResult}
  | {type:'progress';update:ModelingProgressUpdate}
  | {type:'diagnostic';event:ModelingDiagnosticEvent}
  | {type:'result';solid:Solid}
  | {type:'object-check-result';report:ObjectCheckResult}
  | {type:'error';message:string};
interface GeometrySplitSurfaceJob {promise:Promise<SplitSurfaceResult>;cancel():void;}
interface GeometryPreparedJob { promise:Promise<GeometryDissolveResult>; cancel():void; }
interface GeometryUnionJob {promise:Promise<BooleanUnionResult>;cancel():void;}
interface GeometrySubtractJob { promise:Promise<BooleanSubtractResult>; cancel():void; }
interface GeometryObjectCheckJob { promise:Promise<ObjectCheckResult>; cancel():void; }
interface GeometryStlExportJob {promise:Promise<ArrayBuffer>;cancel():void;}
type ObjectCheckWorkerRequest={type:'object-check';solid:Solid};
function edgeFeatureWorkerJob(s:Solid,request:SplitSurfaceRequest,cancelMessage:string,onProgress?:(update:ModelingProgressUpdate)=>void):GeometrySplitSurfaceJob;
function edgeFeatureWorkerJob(s:null,request:StlExportRequest,cancelMessage:string,onProgress?:(update:ModelingProgressUpdate)=>void):GeometryStlExportJob;
function edgeFeatureWorkerJob(s:null,request:UnionManyRequest,cancelMessage:string,onProgress?:(update:ModelingProgressUpdate)=>void):GeometryUnionJob;
function edgeFeatureWorkerJob(s:Solid,request:ObjectSubtractRequest|GroupSubtractRequest,cancelMessage:string,onProgress?:(update:ModelingProgressUpdate)=>void):GeometrySubtractJob;
function edgeFeatureWorkerJob(s:Solid,request:ObjectCheckWorkerRequest,cancelMessage:string,onProgress?:(update:ModelingProgressUpdate)=>void,onDiagnostic?:(event:ModelingDiagnosticEvent)=>void):GeometryObjectCheckJob;
function edgeFeatureWorkerJob(s:Solid,request:EdgeFeatureWorkerRequest,cancelMessage:string,onProgress?:(update:ModelingProgressUpdate)=>void,onDiagnostic?:(event:ModelingDiagnosticEvent)=>void):GeometryPreparedJob;
function edgeFeatureWorkerJob(s:Solid|null,request:EdgeFeatureWorkerRequest|ObjectCheckWorkerRequest|ObjectSubtractRequest|GroupSubtractRequest|UnionManyRequest|StlExportRequest|SplitSurfaceRequest,cancelMessage:string,onProgress?:(update:ModelingProgressUpdate)=>void,onDiagnostic?:(event:ModelingDiagnosticEvent)=>void):{promise:Promise<GeometryDissolveResult|ObjectCheckResult|BooleanSubtractResult|BooleanUnionResult|ArrayBuffer|SplitSurfaceResult>;cancel():void}{
  let worker:Worker|null=null,rejectPromise:((reason?:unknown)=>void)|null=null,settled=false,url='';
  const cleanup=()=>{if(worker){worker.onmessage=null;worker.onerror=null;worker.terminate();worker=null;}if(url){URL.revokeObjectURL(url);url='';}};
  const promise=new Promise<GeometryDissolveResult|ObjectCheckResult|BooleanSubtractResult|BooleanUnionResult|ArrayBuffer|SplitSurfaceResult>((resolve,reject)=>{
    rejectPromise=reject;
    try{
      const blob=new Blob([EDGE_FEATURE_WORKER_SOURCE],{type:'text/javascript'});url=URL.createObjectURL(blob);worker=new Worker(url);
      worker.onmessage=(event:MessageEvent<EdgeFeatureWorkerMessage>)=>{
        if(settled)return;const message=event.data;
        if(message.type==='progress'){onProgress?.(message.update);return;}
        if(message.type==='diagnostic'){onDiagnostic?.(message.event);return;}
        settled=true;cleanup();
        if(message.type==='error'){reject(Error(message.message));return;}
        if(message.type==='split-surface-result'){if(request.type==='split-surface')resolve(message.result);else reject(Error('Unexpected split surface worker response.'));return;}
        if(message.type==='stl-export-result'){if(request.type==='stl-export')resolve(message.bytes);else reject(Error('Unexpected STL worker response.'));return;}
        if(message.type==='object-subtract-result'){if(request.type==='object-subtract'||request.type==='group-subtract')resolve(message.result);else reject(Error('Unexpected subtraction worker response.'));return;}
        if(message.type==='object-union-result'){if(request.type==='object-union')resolve(message.result);else reject(Error('Unexpected union worker response.'));return;}
        if(message.type==='object-check-result'){
          if(request.type==='object-check')resolve(message.report);else reject(Error('Unexpected object-check worker response.'));
          return;
        }
        if(!s||request.type==='split-surface'||request.type==='stl-export'||request.type==='object-check'||request.type==='object-subtract'||request.type==='group-subtract'||request.type==='object-union'){reject(Error('Unexpected geometry worker response.'));return;}
        try{resolve({solid:message.solid,faceId:null,topology:topologyMapByGeometry(s,message.solid)});}catch(error){reject(error);}
      };
      worker.onerror=(event:ErrorEvent)=>{if(settled)return;settled=true;cleanup();reject(Error(event.message||'Edge-feature worker failed.'));};
      worker.postMessage(request);
    }catch(error){settled=true;cleanup();reject(error);}
  });
  return {promise,cancel(){if(settled)return;settled=true;cleanup();rejectPromise?.(Error(cancelMessage));}};
}
function threadEdgeWorkerJob(s:Solid,halfEdgeId:HalfEdgeId,pitch:number,depth:number,length:number,profileAngleDeg:number=60,direction:ThreadDirection='right',operation:ThreadOperation='add',onProgress?:(update:ModelingProgressUpdate)=>void,onDiagnostic?:(event:ModelingDiagnosticEvent)=>void):GeometryPreparedJob{return edgeFeatureWorkerJob(s,{type:'thread',solid:s,halfEdgeId,pitch,depth,length,profileAngleDeg,direction,operation},'Thread generation cancelled.',onProgress,onDiagnostic);}
function roundedChamferEdgeWorkerJob(s:Solid,halfEdgeId:HalfEdgeId,distance:number,angleDeg:number,segments:number,onProgress?:(update:ModelingProgressUpdate)=>void,onDiagnostic?:(event:ModelingDiagnosticEvent)=>void,operation:ChamferOperation='cut'):GeometryPreparedJob{return edgeFeatureWorkerJob(s,{type:'rounded-chamfer',solid:s,halfEdgeId,distance,angleDeg,segments,operation},'Rounded Chamfer generation cancelled.',onProgress,onDiagnostic);}
function carveOutWorkerJob(s:Solid,faceId:FaceId,parameters:CarveOutParameters,onProgress?:(update:ModelingProgressUpdate)=>void,onDiagnostic?:(event:ModelingDiagnosticEvent)=>void):GeometryPreparedJob{return edgeFeatureWorkerJob(s,{type:'carve-out',solid:s,faceId,wallThickness:parameters.wallThickness,minimumInnerDetail:parameters.minimumInnerDetail},'Carve Out cancelled.',onProgress,onDiagnostic);}

interface GeometryImportJob {promise:Promise<MeshImportResult>;cancel():void;}
function geometryImportWorkerJob(request:MeshImportRequest,onProgress?:(update:ModelingProgressUpdate)=>void,onDiagnostic?:(event:ModelingDiagnosticEvent)=>void):GeometryImportJob {
  let worker:Worker|null=null,url='',settled=false,rejectPromise:((error:Error)=>void)|null=null;
  const cleanup=()=>{if(worker){worker.onmessage=null;worker.onerror=null;worker.terminate();worker=null;}if(url){URL.revokeObjectURL(url);url='';}};
  const promise=new Promise<MeshImportResult>((resolve,reject)=>{
    rejectPromise=reject;
    try{url=URL.createObjectURL(new Blob([EDGE_FEATURE_WORKER_SOURCE],{type:'text/javascript'}));worker=new Worker(url);
      worker.onmessage=(event:MessageEvent<{type:'progress';update:ModelingProgressUpdate}|{type:'diagnostic';event:ModelingDiagnosticEvent}|{type:'mesh-import-result';result:MeshImportResult}|{type:'error';message:string}>)=>{
        if(settled)return;const message=event.data;if(message.type==='progress'){onProgress?.(message.update);return;}if(message.type==='diagnostic'){onDiagnostic?.(message.event);return;}
        settled=true;cleanup();if(message.type==='error')reject(Error(message.message));else if(message.type==='mesh-import-result')resolve(message.result);else reject(Error('Unexpected import worker response.'));
      };
      worker.onerror=event=>{if(settled)return;settled=true;cleanup();reject(Error(event.message||'Import worker failed.'));};worker.postMessage(request);
    }catch(error){settled=true;cleanup();reject(error);}
  });
  return {promise,cancel(){if(settled)return;settled=true;cleanup();rejectPromise?.(Error('Import check cancelled.'));}};
}

type GeometryMergeFacesResult = {ok:true;result:MergeFacesEdit & {topology:TopologyMap}} | Extract<MergeFacesResult,{ok:false}>;
function mergeFacesGeometry(s:Solid,faceIds:readonly FaceId[],parameters:MergeFacesParameters):GeometryMergeFacesResult {
  const candidate=mergeFacesSolid(s,faceIds,parameters);if(!candidate.ok)return candidate;
  const result=candidate.result,overrides=new Map<FaceId,FaceId|null>(faceIds.map(id=>[id,result.faceId]));
  const topology=topologyMapByGeometry(s,result.solid,overrides);
  for(const id of s.vertices.keys())topology.vertices.set(id,result.solid.vertices.has(id)?id:null);
  const edges=new Map<string,HalfEdgeId>();for(const he of result.solid.halfEdges.values())edges.set(`${he.origin}|${result.solid.halfEdges.get(he.next)!.origin}`,he.id);
  for(const he of s.halfEdges.values())topology.edges.set(he.id,edges.get(`${he.origin}|${s.halfEdges.get(he.next)!.origin}`)||null);
  return {ok:true,result:{...result,topology}};
}
type GeometryEdgeTrimResult={ok:true;result:EdgeTrimEdit & {topology:TopologyMap}}|Extract<EdgeTrimResult,{ok:false}>;
function trimEdgeGeometry(s:Solid,halfEdgeId:HalfEdgeId):GeometryEdgeTrimResult {
  const candidate=trimRidgeEdgeSolid(s,halfEdgeId);if(!candidate.ok)return candidate;
  const result=candidate.result,topology=topologyMapByGeometry(s,result.solid,new Map(result.selectedFaceIds.map(id=>[id,result.faceId])));
  for(const id of s.vertices.keys())topology.vertices.set(id,result.solid.vertices.has(id)?id:null);
  const edges=new Map<string,HalfEdgeId>();for(const he of result.solid.halfEdges.values())edges.set(`${he.origin}|${result.solid.halfEdges.get(he.next)!.origin}`,he.id);
  for(const he of s.halfEdges.values())topology.edges.set(he.id,edges.get(`${he.origin}|${s.halfEdges.get(he.next)!.origin}`)||null);
  return {ok:true,result:{...result,topology}};
}
type GeometryPointDeleteResult={ok:true;result:PointDeleteEdit & {topology:TopologyMap}}|PointDeleteFailure;
function deletePointGeometry(s:Solid,vertexId:VertexId):GeometryPointDeleteResult {
  const candidate=deletePointSolid(s,vertexId);if(!candidate.ok)return candidate;
  const result=candidate.result,topology=topologyMapByGeometry(s,result.solid,new Map(result.removedFaceIds.map(id=>[id,result.faceId])));
  for(const id of s.vertices.keys())topology.vertices.set(id,result.solid.vertices.has(id)?id:null);
  const edges=new Map<string,HalfEdgeId>();for(const he of result.solid.halfEdges.values())edges.set(`${he.origin}|${result.solid.halfEdges.get(he.next)!.origin}`,he.id);
  for(const he of s.halfEdges.values())topology.edges.set(he.id,edges.get(`${he.origin}|${s.halfEdges.get(he.next)!.origin}`)||null);
  return {ok:true,result:{...result,topology}};
}
type GeometryPointMoveResult={ok:true;result:PointMoveEdit & {topology:TopologyMap}}|PointMoveFailure;
function movePointGeometry(prepared:PreparedPointMove,position:Vec3):GeometryPointMoveResult {
  const candidate=movePointSolid(prepared,position);if(!candidate.ok)return candidate;
  const result=candidate.result,s=prepared.source,topology=topologyMapByGeometry(s,result.solid);
  for(const id of s.vertices.keys())topology.vertices.set(id,id);
  const edges=new Map<string,HalfEdgeId>();for(const he of result.solid.halfEdges.values())edges.set(`${he.origin}|${result.solid.halfEdges.get(he.next)!.origin}`,he.id);
  for(const he of s.halfEdges.values())topology.edges.set(he.id,edges.get(`${he.origin}|${s.halfEdges.get(he.next)!.origin}`)||null);
  return {ok:true,result:{...result,topology}};
}
const geometryApi=Object.freeze({
  validateSketchDraft,
  sketchEditorArc:circularArcThrough3,
  createHistoryStore:createSolidHistoryStore,
  preparePointMove:preparePointMoveSolid,
  movePoint:movePointGeometry,
  pointMovePolicy:POINT_MOVE_POLICY,
  trimEdge:trimEdgeGeometry,
  deletePoint:deletePointGeometry,
  pointDeletePolicy:POINT_DELETE_POLICY,
  edgeTrimPolicy:EDGE_TRIM_POLICY,
  mergeFaces:mergeFacesGeometry,
  mergeFacesPolicy:MERGE_FACES_POLICY,
  exportSTL(list:readonly ModelObject[]):ArrayBuffer{return prepareBinarySTL(list);},
  exportPreview(object:StlExportObject){return solidExportPreview(object);},
  exportSTLAsync(list:readonly ModelObject[],onProgress?:(update:ModelingProgressUpdate)=>void):GeometryStlExportJob{return edgeFeatureWorkerJob(null,{type:'stl-export',objects:list.map(({id,name,solid,transform})=>({id,name,solid,transform:structuredClone(transform)}))},'STL export cancelled.',onProgress);},
  primitiveDefinitions:PRIMITIVE_DEFINITIONS,
  primitiveFields:PRIMITIVE_FIELD_INFO,
  primitivePolicy:PRIMITIVE_POLICY,
  primitiveDefaults(kind:PrimitiveKind):PrimitiveParameters{return defaultPrimitiveParameters(kind);},
  createPrimitive(parameters:PrimitiveParameters,id?:string):Solid{return createParametricPrimitive(parameters,id);},
  subtractGroupAsync(request:GroupSubtractRequest,onProgress?:(update:ModelingProgressUpdate)=>void):GeometrySubtractJob{return edgeFeatureWorkerJob(request.target,request,'Group subtraction cancelled.',onProgress);},
  subtractAsync(request:ObjectSubtractRequest,onProgress?:(update:ModelingProgressUpdate)=>void):GeometrySubtractJob{return edgeFeatureWorkerJob(request.target,request,'Object subtraction cancelled.',onProgress);},
  prepareImportAsync(request:MeshImportRequest,onProgress?:(update:ModelingProgressUpdate)=>void,onDiagnostic?:(event:ModelingDiagnosticEvent)=>void):GeometryImportJob{return geometryImportWorkerJob(request,onProgress,onDiagnostic);},
  maximumTwistAngleDeg:TWIST_SWEEP_POLICY.maximumAngleDeg,
  maximumTaperAngleDeg:TAPER_SWEEP_POLICY.maximumAngleDeg,
  checkObject(s:Solid):ObjectCheckResult{return checkObjectSolid(s);},
  checkObjectAsync(s:Solid):GeometryObjectCheckJob{return edgeFeatureWorkerJob(s,{type:'object-check',solid:s},'Object check cancelled.');},
  createPrism(profile:Vec2[],height:number,id?:string):Solid{return primitivePrism(profile,height,id);},
  createPrismRegion(outer:Vec2[],holes:Vec2[][],height:number,id?:string):Solid{return prismRegion(outer,holes,height,id);},
  previewGroundTwist(outer:Vec2[],holes:Vec2[][],height:number,angleDeg:number):TwistSweepPreview {const source=groundTwistSource(outer,holes,height);return previewGroundTwist(source.solid,source.faceId,height,angleDeg);},
  twistGroundPrismAsync(outer:Vec2[],holes:Vec2[][],height:number,angleDeg:number,onProgress?:(update:ModelingProgressUpdate)=>void):GeometryPreparedJob {const source=groundTwistSource(outer,holes,height);return edgeFeatureWorkerJob(source.solid,{type:'ground-twist',solid:source.solid,faceId:source.faceId,distance:height,angleDeg},'Ground twist cancelled.',onProgress);},
  clone(s:Solid):Solid{return cloneSolid(s);},
  splitConnectedShells(s:Solid,options:{reuseConnected?:boolean}={}):Solid[]{return splitConnectedSolidShells(s,options.reuseConnected===true);},
  validate(s:Solid,throwOnError=true){return validateSolid(s,throwOnError);},
  validateWithMesh(s:Solid):{validation:ReturnType<typeof validateSolid>;mesh:Mesh|null}{let mesh:Mesh|null=null;const validation=validateSolid(s,false,value=>{mesh=value;});return {validation,mesh};},
  exportPolyhedron(s:Solid):PolyhedralExportView{return polyhedralExportView(s);},
  serialize(s:Solid):SerializedSolid{return serializeSolid(s);},
  deserialize(data:SerializedSolid):Solid{return deserializeSolid(data);},
  hasFace(s:Solid,faceId:FaceId):boolean{return s.faces.has(faceId);},
  hasVertex(s:Solid,vertexId:VertexId):boolean{return s.vertices.has(vertexId);},
  hasHalfEdge(s:Solid,halfEdgeId:HalfEdgeId):boolean{return s.halfEdges.has(halfEdgeId);},
  vertex(s:Solid,vertexId:VertexId):Vec3{const v=s.vertices.get(vertexId);if(!v)throw Error('The point does not exist.');return [...v.position] as Vec3;},
  edge(s:Solid,halfEdgeId:HalfEdgeId):GeometryEdgeView{return edgeView(s,halfEdgeId);},
  faceVertexIds(s:Solid,faceId:FaceId):VertexId[]{const f=s.faces.get(faceId);if(!f)return [];const out:VertexId[]=[];for(const lid of [f.outerLoop,...f.innerLoops])for(const he of loopHalfEdges(s,lid))if(!out.includes(he.origin))out.push(he.origin);return out;},
  faceTopologyEdges(s:Solid,faceId:FaceId):GeometryEdgeView[]{const f=s.faces.get(faceId);if(!f)return [];const out:GeometryEdgeView[]=[];for(const lid of [f.outerLoop,...f.innerLoops])for(const he of loopHalfEdges(s,lid))out.push(edgeView(s,he.id));return out;},
  faceIds(s:Solid):FaceId[]{return [...s.faces.keys()];},
  faceMetadata(s:Solid,faceId:FaceId):Pick<GeometryFaceView,'id'|'plane'|'provenance'|'boundaryGroup'>{
    const f=s.faces.get(faceId);if(!f)throw Error('The face does not exist.');
    return {id:f.id,plane:clonePlaneValue(f.plane),provenance:f.provenance?{...f.provenance}:undefined,boundaryGroup:f.boundaryGroup};
  },
  face(s:Solid,faceId:FaceId):GeometryFaceView{
    const f=s.faces.get(faceId);if(!f)throw Error('The face does not exist.');
    const loops=faceLoopPoints(s,faceId),outer=cloneLoop3(loops.outer),holes=loops.holes.map(cloneLoop3),basis=planeBasis(f.plane,loops.outer[0]);
    return {id:f.id,plane:clonePlaneValue(f.plane),outer,holes,centroid:[...faceCentroid(s,faceId)] as Vec3,basis:{origin:[...basis.origin] as Vec3,u:[...basis.u] as Vec3,v:[...basis.v] as Vec3,normal:[...basis.normal] as Vec3},area:faceAreaLocal(s,faceId),provenance:f.provenance?{...f.provenance}:undefined,boundaryGroup:f.boundaryGroup};
  },
  faceBasis(s:Solid,faceId:FaceId):PlaneBasis{const f=s.faces.get(faceId);if(!f)throw Error('The face does not exist.');const pts=faceLoopPoints(s,faceId).outer;return planeBasis(f.plane,pts[0]);},
  faceLoops(s:Solid,faceId:FaceId){const l=faceLoopPoints(s,faceId);return {outer:cloneLoop3(l.outer),holes:l.holes.map(cloneLoop3)};},
  faceCentroid(s:Solid,faceId:FaceId):Vec3{return [...faceCentroid(s,faceId)] as Vec3;},
  faceArea(s:Solid,faceId:FaceId):number{return faceAreaLocal(s,faceId);},
  boundaryLocation(s:Solid,faceId:FaceId,p:Vec3,eps?:number){return faceBoundaryLocation(s,faceId,p,eps);},
  resolveOpenContour(s:Solid,faceId:FaceId,chain:Vec3[]){return profiler.measure('geometry','Resolve open contour',()=>resolveOpenFaceContour(s,faceId,chain),{faceId,points:chain.length});},
  splitFaceRegion(s:Solid,faceId:FaceId,region:Vec3[],label='Sketch'){return profiler.measure('geometry','Split face-region',()=>{const supportFaceId=resolveClosedSketchSupportFace(s,faceId,region);return splitFaceWithRegion(s,supportFaceId,region,label);},{faceId,points:region.length,label});},
  previewFaceRegion(s:Solid,faceId:FaceId,region:Vec3[]){const supportFaceId=resolveClosedSketchSupportFace(s,faceId,region),face=s.faces.get(supportFaceId);if(!face)throw Error('Select a valid planar face.');const loops=faceLoopPoints(s,supportFaceId),basis=planeBasis(face.plane,loops.outer[0]),clip=clipRegion2ToFace(s,supportFaceId,basis,region.map(p=>toPlane2(p,basis)));return {supportFaceId,components:clip.components.map(c=>({outer:c.outer.map(p=>fromPlane2(p,basis)),holes:c.holes.map(h=>h.map(p=>fromPlane2(p,basis))) }))};},
  textFaceFrame(s:Solid,faceId:FaceId):PlaneBasis{return textFaceFrame(s,faceId);},
  previewFaceText(s:Solid,faceId:FaceId,parameters:FaceTextParameters):FaceTextLayout{return faceTextLayout(s,faceId,parameters);},
  faceTextWrapPoint(layout:FaceTextLayout,faceId:FaceId,uv:Vec2,depth:number):Vec3{const patch=layout.wrap,field=patch?.context.fields.get(faceId);if(!patch||!field)throw Error('Wrapped preview face is missing.');return roundTextPoint(uv,field,depth);},
  faceTextCylinderPoint(layout:FaceTextLayout,faceId:FaceId,uv:Vec2,depth:number):Vec3{const patch=layout.cylinder,field=patch?.context.fields.get(faceId);if(!patch||!field)throw Error('Cylinder preview face is missing.');return cylinderTextPointOffset(uv,field,patch.context,depth);},
  checkFaceTextPlacement(s:Solid,faceId:FaceId,layout:FaceTextLayout):FaceTextPlacementCheck{return checkFaceTextFits(s,faceId,layout);},
  faceText(s:Solid,faceId:FaceId,parameters:FaceTextParameters):GeometryDissolveResult{const solid=applyFaceTextSolid(s,faceId,parameters);return {solid,faceId:null,topology:topologyMapByGeometry(s,solid)};},
  faceTextAsync(s:Solid,faceId:FaceId,parameters:FaceTextParameters,onProgress?:(update:ModelingProgressUpdate)=>void):GeometryPreparedJob{return edgeFeatureWorkerJob(s,{type:'face-text',solid:s,faceId,parameters:structuredClone(parameters)},'Text generation cancelled.',onProgress);},
  previewSurfaceTexture(s:Solid,faceId:FaceId,parameters:SurfaceTextureParameters):SurfaceTexturePreview{return profiler.measure('preview','Surface texture layout',()=>previewSurfaceTexture(s,faceId,parameters),{faceId,type:parameters.type,operation:parameters.operation});},
  surfaceTexture(s:Solid,faceId:FaceId,parameters:SurfaceTextureParameters):SurfaceTextureResult{return profiler.measure('geometry','Surface texture',()=>{const r=applySurfaceTextureSolid(s,faceId,parameters);return {...r,topology:topologyMapByGeometry(s,r.solid)};},{faceId,type:parameters.type,operation:parameters.operation,spacing:parameters.spacing,size:parameters.size,depth:parameters.depth,margin:parameters.margin});},
  previewSurfaceTextureFaces(s:Solid,faceIds:readonly FaceId[],parameters:SurfaceTextureParameters):SurfaceTexturePatchPreview{return profiler.measure('preview','Surface texture area',()=>previewSurfaceTextureFaces(s,faceIds,parameters),{faceCount:faceIds.length});},
  surfaceTextureFaces(s:Solid,faceIds:readonly FaceId[],parameters:SurfaceTextureParameters):SurfaceTextureResult{return profiler.measure('geometry','Surface texture area',()=>{const r=applySurfaceTextureFacesSolid(s,faceIds,parameters);return {...r,topology:topologyMapByGeometry(s,r.solid)};},{faceCount:faceIds.length,type:parameters.type,operation:parameters.operation});},
  surfaceTextureFacesAsync(s:Solid,faceIds:readonly FaceId[],parameters:SurfaceTextureParameters,onProgress?:(update:ModelingProgressUpdate)=>void,onDiagnostic?:(event:ModelingDiagnosticEvent)=>void):GeometryPreparedJob{return edgeFeatureWorkerJob(s,{type:'surface-texture',solid:s,faceIds:[...faceIds],parameters:structuredClone(parameters)},'Texture generation cancelled.',onProgress,onDiagnostic);},
  textureBandFaces(s:Solid,faceIds:readonly FaceId[],parameters:SurfaceTextureParameters,wholeRing:boolean):FaceId[]{return textureBandSelection(s,faceIds,textureValidatedParameters(parameters),wholeRing);},
  textureProjectionFrame(s:Solid,faceId:FaceId,parameters:SurfaceTextureParameters):PlaneBasis{return texturePatternBasis(s,faceId,textureValidatedParameters(parameters));},
  textureFaceNeighbors(s:Solid,faceIds:readonly FaceId[]):FaceId[]{const ids=new Set(faceIds),neighbors=new Set<FaceId>();for(const id of ids){const face=s.faces.get(id);if(!face)continue;for(const lid of [face.outerLoop,...face.innerLoops])for(const he of loopHalfEdges(s,lid)){const neighbor=s.halfEdges.get(he.twin)?.face;if(neighbor&&!ids.has(neighbor))neighbors.add(neighbor);}}return [...neighbors];},
  carveOut(s:Solid,faceId:FaceId,parameters:CarveOutParameters):GeometryDissolveResult{const result=profiler.measure('geometry','Carve Out',()=>carveOutSolid(s,faceId,parameters),{faceId,wallThickness:parameters.wallThickness,minimumInnerDetail:parameters.minimumInnerDetail});return {solid:result.solid,faceId:null,topology:topologyMapByGeometry(s,result.solid)};},
  carveOutAsync(s:Solid,faceId:FaceId,parameters:CarveOutParameters,onProgress?:(update:ModelingProgressUpdate)=>void,onDiagnostic?:(event:ModelingDiagnosticEvent)=>void):GeometryPreparedJob{return carveOutWorkerJob(s,faceId,parameters,onProgress,onDiagnostic);},
  moveFace(s:Solid,faceId:FaceId,distance:number):SolidEditResult{return moveFace(s,faceId,distance);},
  previewMoveFace(s:Solid,faceId:FaceId,distance:number):SolidEditResult{return moveFacePreview(s,faceId,distance);},
  twistFace(s:Solid,faceId:FaceId,distance:number,angleDeg:number):SolidEditResult{const result=twistFaceSweep(s,faceId,distance,angleDeg);return {...result,topology:topologyMapByGeometry(s,result.solid)};},
  previewTwistFace(s:Solid,faceId:FaceId,distance:number,angleDeg:number):TwistSweepPreview{return previewTwistSweep(s,faceId,distance,angleDeg);},
  twistFaceAsync(s:Solid,faceId:FaceId,distance:number,angleDeg:number,onProgress?:(update:ModelingProgressUpdate)=>void):GeometryPreparedJob{return edgeFeatureWorkerJob(s,{type:'face-twist',solid:s,faceId,distance,angleDeg},'Twisted Push/Pull cancelled.',onProgress);},
  taperFace(s:Solid,faceId:FaceId,distance:number,angleDeg:number,twistAngleDeg=0,taperMode:TaperMode='edge-angle'):SolidEditResult{const result=taperFaceSweep(s,faceId,distance,angleDeg,undefined,twistAngleDeg,taperMode);return {...result,topology:topologyMapByGeometry(s,result.solid)};},
  previewTaperFace(s:Solid,faceId:FaceId,distance:number,angleDeg:number,twistAngleDeg=0,taperMode:TaperMode='edge-angle'):TaperSweepPreview{return previewTaperSweep(s,faceId,distance,angleDeg,twistAngleDeg,taperMode);},
  taperFaceAsync(s:Solid,faceId:FaceId,distance:number,angleDeg:number,onProgress?:(update:ModelingProgressUpdate)=>void,twistAngleDeg=0,taperMode:TaperMode='edge-angle'):GeometryPreparedJob{return edgeFeatureWorkerJob(s,{type:'face-taper',solid:s,faceId,distance,angleDeg,twistAngleDeg,taperMode},'Tapered Push/Pull cancelled.',onProgress);},
  previewGroundTaper(outer:Vec2[],holes:Vec2[][],height:number,angleDeg:number,twistAngleDeg=0,taperMode:TaperMode='edge-angle'):TaperSweepPreview{const source=groundTwistSource(outer,holes,height);return previewGroundTaper(source.solid,source.faceId,height,angleDeg,twistAngleDeg,taperMode);},
  taperGroundPrismAsync(outer:Vec2[],holes:Vec2[][],height:number,angleDeg:number,onProgress?:(update:ModelingProgressUpdate)=>void,twistAngleDeg=0,taperMode:TaperMode='edge-angle'):GeometryPreparedJob{const source=groundTwistSource(outer,holes,height);return edgeFeatureWorkerJob(source.solid,{type:'ground-taper',solid:source.solid,faceId:source.faceId,distance:height,angleDeg,twistAngleDeg,taperMode},'Ground Taper cancelled.',onProgress);},
  unionMany(request:UnionManyRequest,onProgress?:(update:ModelingProgressUpdate)=>void):BooleanUnionResult{return unionManySolids(request,onProgress);},
  unionManyAsync(request:UnionManyRequest,onProgress?:(update:ModelingProgressUpdate)=>void):GeometryUnionJob{return edgeFeatureWorkerJob(null,request,'Combine cancelled.',onProgress);},
  union(a:Solid,aTransform:Transform,b:Solid,bTransform:Transform,id?:string):BooleanUnionResult{return unionSolids(a,aTransform,b,bTransform,id);},
  splitBySurface(request:SplitSurfaceRequest):SplitSurfaceResult{return splitSolidBySurface(request);},
  splitBySurfaceAsync(request:SplitSurfaceRequest,onProgress?:(update:ModelingProgressUpdate)=>void):GeometrySplitSurfaceJob{return edgeFeatureWorkerJob(request.solid,request,'Curved split cancelled.',onProgress);},
  splitByPlane(s:Solid,origin:Vec3,normal:Vec3):GeometryPlaneSplitResult{return profiler.measure('geometry','Split solid by plane',()=>splitSolidByPlane(s,origin,normal),{faces:s.faces.size});},
  normalize(s:Solid):Solid{return profiler.measure('geometry','Normalize solid',()=>normalizeSolid(s),{faces:s.faces.size});},
  findCoplanarFaceContaining(s:Solid,plane:Plane,p:Vec3):FaceId|null{return findCoplanarFaceContaining(s,plane,p);},
  sketchDeleteCandidate(s:Solid,faceId:FaceId,halfEdgeId?:HalfEdgeId):FaceId|null{
    // A face sketch is a coplanar subdivision. The query follows the existing
    // dissolve preconditions; it neither constructs a preview nor mutates geometry.
    const ids=[faceId];
    if(halfEdgeId&&s.halfEdges.has(halfEdgeId)){const edge=this.edge(s,halfEdgeId);if(edge.coplanar)ids.push(edge.faceA,edge.faceB);}
    for(const id of new Set(ids)){const face=s.faces.get(id);if(face?.provenance?.kind!=='split'||face.provenance.label==='Support face')continue;if(this.faceTopologyEdges(s,id).some(edge=>edge.coplanar))return id;}
    return null;
  },
  dissolveCoplanarBoundary(s:Solid,faceId:FaceId):GeometryBoundaryDissolveResult{const r=dissolveFaceGeometry(s,faceId);return {solid:r.solid,faceId:r.faceId,topology:r.topology};},
  dissolveFace(s:Solid,faceId:FaceId):GeometryDissolveResult{return profiler.measure('geometry','Dissolve face',()=>dissolveFaceGeometry(s,faceId),{faceId});},
  dissolveEdge(s:Solid,halfEdgeId:HalfEdgeId):GeometryDissolveResult{return profiler.measure('geometry','Dissolve edge',()=>dissolveEdgeGeometry(s,halfEdgeId),{halfEdgeId});},
  canDissolveVertex(s:Solid,vertexId:VertexId):boolean{return vertexIsDissolvable(s,vertexId);},
  dissolveVertex(s:Solid,vertexId:VertexId):GeometryDissolveResult{return profiler.measure('geometry','Dissolve point',()=>dissolveVertexGeometry(s,vertexId),{vertexId});},
  deleteFeatureCandidate(s:Solid,halfEdgeId:HalfEdgeId):GeometryDeleteFeatureCandidate|null{return prismaticDeleteCandidate(s,halfEdgeId);},
  deletePrismaticFeature(s:Solid,halfEdgeId:HalfEdgeId):GeometryDeleteFeatureResult{return profiler.measure('geometry','Delete recognized feature',()=>healPrismaticDeleteFeature(s,halfEdgeId),{halfEdgeId});},
  chamferEdge(s:Solid,halfEdgeId:HalfEdgeId,distance:number,angleDeg=45,operation:ChamferOperation='cut'):GeometryDissolveResult{const ids=chamferEdgeChainCandidate(s,halfEdgeId,operation),out=profiler.measure('geometry','Chamfer straight side',()=>chamferEdgesSolid(s,ids,distance,angleDeg,operation),{halfEdgeId,edgeCount:ids.length,distance,angleDeg});return {solid:out,faceId:null,topology:topologyMapByGeometry(s,out)};},
  roundedChamferEdge(s:Solid,halfEdgeId:HalfEdgeId,distance:number,angleDeg:number=45,segments:number=ROUNDED_CHAMFER_POLICY.defaultSegments,operation:ChamferOperation='cut'):GeometryDissolveResult{const ids=chamferEdgeChainCandidate(s,halfEdgeId,operation),out=profiler.measure('geometry','Rounded Chamfer straight side',()=>roundedChamferEdgesSolid(s,ids,distance,angleDeg,segments,undefined,undefined,operation),{halfEdgeId,edgeCount:ids.length,distance,angleDeg,segments,otherDistance:distance*Math.tan(angleDeg*Math.PI/180)});return {solid:out,faceId:null,topology:topologyMapByGeometry(s,out)};},
  roundedChamferEdgeAsync(s:Solid,halfEdgeId:HalfEdgeId,distance:number,angleDeg:number=45,segments:number=ROUNDED_CHAMFER_POLICY.defaultSegments,onProgress?:(update:ModelingProgressUpdate)=>void,onDiagnostic?:(event:ModelingDiagnosticEvent)=>void,operation:ChamferOperation='cut'):GeometryPreparedJob{return roundedChamferEdgeWorkerJob(s,halfEdgeId,distance,angleDeg,segments,onProgress,onDiagnostic,operation);},
  roundedChamferStraightEdgesAsync(s:Solid,halfEdgeIds:readonly HalfEdgeId[],distance:number,angleDeg:number,segments:number,onProgress?:(update:ModelingProgressUpdate)=>void,onDiagnostic?:(event:ModelingDiagnosticEvent)=>void,operation:ChamferOperation='cut'):GeometryPreparedJob{
    const ids=this.chamferStraightSelectionEdges(s,halfEdgeIds,operation);
    if(!ids.length)throw Error('No Rounded Chamfer edges were selected.');
    return edgeFeatureWorkerJob(s,{type:'rounded-chamfer',solid:s,halfEdgeId:ids[0],halfEdgeIds:ids,distance,angleDeg,segments,operation},'Rounded Chamfer generation cancelled.',onProgress,onDiagnostic);
  },
  threadRim(s:Solid,halfEdgeId:HalfEdgeId):ThreadRimInfo|null{return threadRimInfo(s,halfEdgeId);},
  threadEdge(s:Solid,halfEdgeId:HalfEdgeId,pitch:number,depth:number,length:number,profileAngleDeg=60,direction:ThreadDirection='right',operation:ThreadOperation='add'):GeometryDissolveResult{const info=threadRimInfo(s,halfEdgeId);if(!info)throw Error('Thread requires a circular hole rim or circular outer cylinder rim with a straight wall.');const label=`${operation==='add'?'Add':'Cut'} ${info.kind==='internal'?'hole':'cylinder'} thread`;const out=profiler.measure('geometry',label,()=>threadEdgeSolid(s,info.halfEdgeId,pitch,depth,length,profileAngleDeg,direction,operation),{halfEdgeId:info.halfEdgeId,kind:info.kind,operation,pitch,depth,length,profileAngleDeg,rimSegments:info.rimSegments,direction,sampling:'rim-aligned'});return {solid:out,faceId:null,topology:topologyMapByGeometry(s,out)};},
  threadEdgeAsync(s:Solid,halfEdgeId:HalfEdgeId,pitch:number,depth:number,length:number,profileAngleDeg=60,direction:ThreadDirection='right',operation:ThreadOperation='add',onProgress?:(update:ModelingProgressUpdate)=>void,onDiagnostic?:(event:ModelingDiagnosticEvent)=>void):GeometryPreparedJob{return threadEdgeWorkerJob(s,halfEdgeId,pitch,depth,length,profileAngleDeg,direction,operation,onProgress,onDiagnostic);},
  chamferCandidateEdges(s:Solid,halfEdgeId:HalfEdgeId,operation:ChamferOperation='cut'):HalfEdgeId[]{return chamferEdgeChainCandidate(s,halfEdgeId,operation);},
  chamferCurveCandidateEdges(s:Solid,halfEdgeId:HalfEdgeId,operation:ChamferOperation='cut'):HalfEdgeId[]|null{return chamferCurveChainCandidate(s,halfEdgeId,operation);},
  chamferStraightCandidateEdges(s:Solid,halfEdgeId:HalfEdgeId,operation:ChamferOperation='cut'):HalfEdgeId[]|null{
    const ids=chamferEdgeChainCandidate(s,halfEdgeId,operation);if(!ids.length)return null;
    const seed=edgeView(s,halfEdgeId),direction=V.unit(V.sub(seed.b,seed.a));
    // Match the existing logical-side classifier. A complete circular/hole rim
    // is a separate single-click operation, never a straight-side batch.
    return ids.every(id=>{const e=edgeView(s,id);return !!chamferCornerFrame(s,s.halfEdges.get(id)!,operation)&&Math.abs(V.dot(direction,V.unit(V.sub(e.b,e.a))))>CHAMFER_STRAIGHT_SELECTION_POLICY.minimumParallelDot;})?ids:null;
  },
  chamferStraightSelectionEdges(s:Solid,halfEdgeIds:readonly HalfEdgeId[],operation:ChamferOperation='cut'):HalfEdgeId[]{
    const seen=new Set<HalfEdgeId>(),ids:HalfEdgeId[]=[];
    // Keep the historical API name for callers. Shift may supply exact curved
    // members; never expand those into an unrelated complete automatic rim.
    for(const id of halfEdgeIds){const he=s.halfEdges.get(id);if(!he||!chamferCornerFrame(s,he,operation))throw Error('Multi-edge Chamfer requires eligible edges.');const key=he.id<he.twin?he.id:he.twin;if(!seen.has(key)){seen.add(key);ids.push(id);}}
    return ids;
  },
  chamferStraightEdges(s:Solid,halfEdgeIds:readonly HalfEdgeId[],distance:number,angleDeg=45,operation:ChamferOperation='cut'):GeometryDissolveResult{
    const ids=this.chamferStraightSelectionEdges(s,halfEdgeIds,operation),out=profiler.measure('geometry','Chamfer selected edges',()=>chamferEdgesSolid(s,ids,distance,angleDeg,operation),{edgeCount:ids.length,distance,angleDeg});
    validateSolid(out);return {solid:out,faceId:null,topology:topologyMapByGeometry(s,out)};
  },
  resizePlanarRegion(s:Solid,faceId:FaceId,width:number,height:number,label='Sketch'):GeometryRegionResizeResult{
    if(width<.1||height<.1)throw Error('Width and height must be at least 0.1 mm.');
    const view=this.face(s,faceId),p2=view.outer.map(p=>toPlane2(p,view.basis)),cx=p2.reduce((sum,p)=>sum+p[0],0)/p2.length,cy=p2.reduce((sum,p)=>sum+p[1],0)/p2.length,xs=p2.map(p=>p[0]),ys=p2.map(p=>p[1]),ow=Math.max(...xs)-Math.min(...xs),oh=Math.max(...ys)-Math.min(...ys);
    if(ow<TOL.minimumEdge||oh<TOL.minimumEdge)throw Error('The face is too small to scale.');
    const resized=p2.map(p=>[cx+(p[0]-cx)*width/ow,cy+(p[1]-cy)*height/oh] as Vec2),out=normalizeSolid(s),support=findCoplanarFaceContaining(out,view.plane,view.centroid);if(!support)throw Error('Could not find the support face after normalization.');
    return splitFaceWithRegion(out,support,resized.map(p=>fromPlane2(p,view.basis)),label);
  },
  bounds(s:Solid):Bounds3{
    const pts=[...s.vertices.values()].map(v=>v.position);if(!pts.length)return {min:[0,0,0],max:[0,0,0]};const min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];for(const p of pts)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}return {min,max};
  },
  scaleToDimensions(s:Solid,dims:Vec3):Solid{
    if(dims.some(x=>!Number.isFinite(x)||x<.1||x>10000))throw Error('Object dimensions must be between 0.1 and 10,000 mm.');
    const out=cloneSolid(s),b=this.bounds(out),old=V.sub(b.max,b.min);if(old.some(x=>x<TOL.minimumEdge))throw Error('The object has invalid extents.');const center=V.mul(V.add(b.min,b.max),.5),scale:[number,number,number]=[dims[0]/old[0],dims[1]/old[1],dims[2]/old[2]];
    for(const v of out.vertices.values()){const d=V.sub(v.position,center);v.position=[center[0]+d[0]*scale[0],center[1]+d[1]*scale[1],center[2]+d[2]*scale[2]];}
    for(const f of out.faces.values()){const pl=planeFromPoints(faceLoopPoints(out,f.id).outer);if(V.dot(pl.normal,f.plane.normal)<0){pl.normal=V.mul(pl.normal,-1);pl.offset=-pl.offset;}f.plane=pl;}
    validateSolid(out);return out;
  },
  reflectThroughOrigin(s:Solid,normal:Vec3):Solid{
    const length=Math.hypot(...normal);
    if(!Number.isFinite(length)||length===0)throw Error('Reflection requires a finite nonzero normal.');
    // Sources are canonical command inputs. Detach them without re-validating
    // the unchanged source; the normal command validates the reflected result.
    const n=normal.map(value=>value/length) as Vec3,out:Solid=structuredClone(s);
    const reflect=(point:Vec3):Vec3=>V.sub(point,V.mul(n,2*V.dot(n,point)));
    for(const vertex of out.vertices.values())vertex.position=reflect(vertex.position);
    for(const face of out.faces.values())face.plane.normal=reflect(face.plane.normal);
    // A reflection reverses handedness. Reversing all outer/hole cycles keeps
    // outward normals and twin adjacency; IDs still identify the same entities.
    for(const edge of out.halfEdges.values()){
      const source=s.halfEdges.get(edge.id)!;
      edge.origin=s.halfEdges.get(source.next)!.origin;edge.next=source.prev;edge.prev=source.next;
    }
    // The document command performs complete validation once before commit.
    return out;
  },
  scaleUniformFromOrigin(s:Solid,factor:number):Solid{
    if(!Number.isFinite(factor)||factor<=0||factor>100)throw Error('Scale factor must be greater than 0 and at most 100.');
    const b=this.bounds(s),dims=V.mul(V.sub(b.max,b.min),factor);if(dims.some(x=>x<.1||x>10000))throw Error('Scaled object dimensions must stay between 0.1 and 10,000 mm.');
    const out=cloneSolid(s);for(const v of out.vertices.values())v.position=V.mul(v.position,factor);
    for(const f of out.faces.values()){const pl=planeFromPoints(faceLoopPoints(out,f.id).outer);if(V.dot(pl.normal,f.plane.normal)<0){pl.normal=V.mul(pl.normal,-1);pl.offset=-pl.offset;}f.plane=pl;}
    validateSolid(out);return out;
  },
  faceEdges(s:Solid,faceId:FaceId):{a:Vec3;b:Vec3}[]{
    const out:{a:Vec3;b:Vec3}[]=[],f=s.faces.get(faceId);if(!f)return out;for(const lid of [f.outerLoop,...f.innerLoops])for(const he of loopHalfEdges(s,lid)){const next=s.halfEdges.get(he.next);if(!next)continue;out.push({a:[...s.vertices.get(he.origin)!.position] as Vec3,b:[...s.vertices.get(next.origin)!.position] as Vec3});}return out;
  },
  edges(s:Solid):{halfEdgeId:HalfEdgeId;a:Vec3;b:Vec3}[]{
    const out:{halfEdgeId:HalfEdgeId;a:Vec3;b:Vec3}[]=[];for(const he of s.halfEdges.values()){if(he.twin&&he.id>he.twin)continue;const next=s.halfEdges.get(he.next);if(!next)continue;out.push({halfEdgeId:he.id,a:[...s.vertices.get(he.origin)!.position] as Vec3,b:[...s.vertices.get(next.origin)!.position] as Vec3});}return out;
  }
});
