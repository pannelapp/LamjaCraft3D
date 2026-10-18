interface CSGPolygon { vs: Vec3[]; plane: Plane; group?: string; provenance?: FaceProvenance; faceIdHint?: string; }

// BSP clipping can leave a microscopic T-seam where one planar boundary edge
// corresponds to two neighboring boundary edges. Repair only that already-open
// topology pattern; valid manifold CSG results are returned unchanged.
const CSG_REPAIR_POLICY=Object.freeze({
  // BSP clipping can accumulate a sub-micron-to-micron lateral drift along an otherwise
  // straight one-edge-versus-two-edge seam. Scale the allowed deviation modestly with
  // seam length, cap it tightly, and additionally require near-zero path-length excess.
  basePlanarSeamDeviation:6e-4,
  maximumRelativePlanarSeamDeviation:1e-3,
  maximumPlanarSeamDeviation:1e-3,
  maximumRelativePathExcess:2e-6,
  maximumPathExcessFromDeviationFactor:2.5,
  // A seam-chain vertex can lie very near an endpoint: in that configuration the
  // polyline length excess approaches the lateral deviation even though the whole
  // chain stays inside the same sub-micron repair tube. Keep a bounded allowance
  // for that endpoint case instead of rejecting it as a long detour.
  maximumEndpointPathExcessFromDeviationFactor:1.1,
  minimumPathExcessToleranceFactor:4,
  // Every successful repair consumes one open seam plus an opposing path with at
  // least two open edges. Derive the operation budget from that monotonic invariant
  // instead of stopping after an arbitrary fixed number of repairs.
  minimumOpenEdgesRemovedPerRepair:3,
  maximumRepairPathEdges:64,
  maximumRepairPathSearchStates:4096,
});

function csgSeamRepairLimits(seamLength:number):{maximumDeviation:number;maximumPathExcess:number}{
  const maximumDeviation=Math.min(CSG_REPAIR_POLICY.maximumPlanarSeamDeviation,Math.max(CSG_REPAIR_POLICY.basePlanarSeamDeviation,seamLength*CSG_REPAIR_POLICY.maximumRelativePlanarSeamDeviation));
  // A near-collinear seam with the allowed lateral drift necessarily has a tiny path-length
  // excess. Derive that allowance from the same deviation policy so short seams are not
  // rejected merely because the relative-only limit becomes smaller than the geometry permits.
  const deviationPathExcess=CSG_REPAIR_POLICY.maximumPathExcessFromDeviationFactor*maximumDeviation*maximumDeviation/Math.max(seamLength,TOL.minimumEdge);
  return {
    maximumDeviation,
    maximumPathExcess:Math.max(TOL.csg*CSG_REPAIR_POLICY.minimumPathExcessToleranceFactor,seamLength*CSG_REPAIR_POLICY.maximumRelativePathExcess,deviationPathExcess,maximumDeviation*CSG_REPAIR_POLICY.maximumEndpointPathExcessFromDeviationFactor),
  };
}

function csgOpenEdgeDiagnostics(s:Solid,limit=24):Record<string,unknown>{
  const open=[...s.halfEdges.values()].filter(he=>!he.twin),samples:Record<string,unknown>[]=[];
  for(const he of open.slice(0,limit)){
    const next=s.halfEdges.get(he.next),a=s.vertices.get(he.origin)?.position,b=next&&s.vertices.get(next.origin)?.position;if(!next||!a||!b)continue;
    const ab=V.sub(b,a),l2=V.dot(ab,ab);let nearest:{vertexId:VertexId;distance:number;t:number;point:Vec3}|null=null;
    if(l2>TOL.minimumEdge*TOL.minimumEdge)for(const v of s.vertices.values()){if(v.id===he.origin||v.id===next.origin)continue;const t=V.dot(V.sub(v.position,a),ab)/l2;if(t<=0||t>=1)continue;const point=V.lerp(a,b,t),distance=V.len(V.sub(v.position,point));if(!nearest||distance<nearest.distance)nearest={vertexId:v.id,distance,t,point:[...v.position] as Vec3};}
    samples.push({halfEdgeId:he.id,faceId:he.face,originId:he.origin,destinationId:next.origin,a:[...a],b:[...b],length:V.len(ab),nearestInteriorVertex:nearest});
  }
  return {count:open.length,samples,truncated:open.length>limit};
}

function csgShortEdgeDiagnostics(s:Solid,limit=24):Record<string,unknown>{
  const samples:Record<string,unknown>[]=[];let count=0;
  for(const he of s.halfEdges.values()){const next=s.halfEdges.get(he.next),a=s.vertices.get(he.origin)?.position,b=next&&s.vertices.get(next.origin)?.position;if(!next||!a||!b)continue;const length=V.len(V.sub(b,a));if(length>=TOL.minimumEdge)continue;count++;if(samples.length<limit)samples.push({halfEdgeId:he.id,faceId:he.face,originId:he.origin,destinationId:next.origin,a:[...a],b:[...b],length});}
  return {count,samples,truncated:count>limit,minimumEdge:TOL.minimumEdge};
}

interface CsgOpenSeamPath {
  edges:HalfEdge[];
  pathLength:number;
  pathExcess:number;
  maximumDeviation:number;
  maximumPlaneDistance:number;
}

function findCsgOpenSeamPath(s:Solid,seam:HalfEdge,openByOrigin:Map<VertexId,HalfEdge[]>):CsgOpenSeamPath|null{
  const destination=(he:HalfEdge)=>s.halfEdges.get(he.next)?.origin,aId=seam.origin,bId=destination(seam);if(!bId)return null;
  const a=s.vertices.get(aId)?.position,b=s.vertices.get(bId)?.position,face=s.faces.get(seam.face);if(!a||!b||!face)return null;
  const ab=V.sub(b,a),l2=V.dot(ab,ab);if(l2<=TOL.minimumEdge*TOL.minimumEdge)return null;
  const seamLength=Math.sqrt(l2),limits=csgSeamRepairLimits(seamLength);
  type SearchState={vertexId:VertexId;edges:HalfEdge[];t:number;pathLength:number;maximumDeviation:number;maximumPlaneDistance:number};
  const queue:SearchState[]=[{vertexId:bId,edges:[],t:1,pathLength:0,maximumDeviation:0,maximumPlaneDistance:0}];let states=0,best:CsgOpenSeamPath|null=null;
  while(queue.length&&states++<CSG_REPAIR_POLICY.maximumRepairPathSearchStates){
    const state=queue.shift()!;if(state.edges.length>=CSG_REPAIR_POLICY.maximumRepairPathEdges)continue;
    for(const edge of openByOrigin.get(state.vertexId)||[]){
      if(edge.id===seam.id||state.edges.some(e=>e.id===edge.id))continue;
      const nextId=destination(edge);if(!nextId)continue;const from=s.vertices.get(edge.origin)?.position,to=s.vertices.get(nextId)?.position;if(!from||!to)continue;
      const edgeLength=V.len(V.sub(to,from));if(edgeLength<=TOL.minimumEdge)continue;const pathLength=state.pathLength+edgeLength;if(pathLength>seamLength+limits.maximumPathExcess)continue;
      const edges=[...state.edges,edge];
      if(nextId===aId){
        if(edges.length<2)continue;const pathExcess=Math.max(0,pathLength-seamLength);if(pathExcess>limits.maximumPathExcess)continue;
        const candidate:CsgOpenSeamPath={edges,pathLength,pathExcess,maximumDeviation:state.maximumDeviation,maximumPlaneDistance:state.maximumPlaneDistance};
        if(!best||candidate.pathExcess<best.pathExcess-1e-15||(Math.abs(candidate.pathExcess-best.pathExcess)<=1e-15&&candidate.maximumDeviation<best.maximumDeviation-1e-15)||(Math.abs(candidate.pathExcess-best.pathExcess)<=1e-15&&Math.abs(candidate.maximumDeviation-best.maximumDeviation)<=1e-15&&candidate.edges.length<best.edges.length))best=candidate;
        continue;
      }
      const c=s.vertices.get(nextId)?.position;if(!c)continue;const planeDistance=Math.abs(V.dot(face.plane.normal,c)-face.plane.offset);if(planeDistance>TOL.plane)continue;
      const t=V.dot(V.sub(c,a),ab)/l2;if(t<=1e-8||t>=state.t-1e-8)continue;const deviation=V.len(V.sub(c,V.lerp(a,b,t)));if(deviation>limits.maximumDeviation)continue;
      queue.push({vertexId:nextId,edges,t,pathLength,maximumDeviation:Math.max(state.maximumDeviation,deviation),maximumPlaneDistance:Math.max(state.maximumPlaneDistance,planeDistance)});
    }
  }
  return best;
}

function nextCsgRepairHalfEdgeId(s:Solid):HalfEdgeId{let n=s.halfEdges.size+1,id=`he${n}`;while(s.halfEdges.has(id))id=`he${++n}`;return id;}

function applyCsgOpenSeamPath(s:Solid,seam:HalfEdge,path:CsgOpenSeamPath,diagnostic?:ModelingDiagnosticReporter,pass=1,openEdgesBefore=0):number{
  const oldNext=s.halfEdges.get(seam.next);if(!oldNext||path.edges.length<2)return 0;
  let previous=seam;const segmentIds:HalfEdgeId[]=[seam.id],splitVertexIds:VertexId[]=[];
  for(let k=0;k<path.edges.length;k++){
    const opposing=path.edges[path.edges.length-1-k];
    if(k===0){seam.twin=opposing.id;opposing.twin=seam.id;continue;}
    const origin=path.edges[path.edges.length-k].origin,id=nextCsgRepairHalfEdgeId(s),split:HalfEdge={id,origin,twin:opposing.id,next:oldNext.id,prev:previous.id,loop:seam.loop,face:seam.face};
    previous.next=id;opposing.twin=id;s.halfEdges.set(id,split);previous=split;segmentIds.push(id);splitVertexIds.push(origin);
  }
  previous.next=oldNext.id;oldNext.prev=previous.id;
  const destination=(he:HalfEdge)=>s.halfEdges.get(he.next)?.origin,a=s.vertices.get(seam.origin)?.position,bId=destination(previous),b=bId?s.vertices.get(bId)?.position:undefined,seamLength=a&&b?V.len(V.sub(b,a)):0,limits=csgSeamRepairLimits(seamLength);
  diagnostic?.('csg','seam-repair',{pass,seamHalfEdgeId:seam.id,segmentHalfEdgeIds:segmentIds,opposingHalfEdgeIds:path.edges.map(e=>e.id),splitVertexIds,pathEdgeCount:path.edges.length,seamLength,pathLength:path.pathLength,pathExcess:path.pathExcess,maximumPathExcess:limits.maximumPathExcess,deviation:path.maximumDeviation,maximumDeviation:limits.maximumDeviation,observedMaximumDeviation:path.maximumDeviation,maximumPlaneDistance:path.maximumPlaneDistance,openEdgesBefore});
  return 1;
}

function csgSeamRepairBudget(openEdges:number):number{
  return Math.max(0,Math.ceil(openEdges/CSG_REPAIR_POLICY.minimumOpenEdgesRemovedPerRepair));
}

function repairCsgOpenSeamChains(s:Solid,diagnostic?:ModelingDiagnosticReporter,repairBudget=csgSeamRepairBudget([...s.halfEdges.values()].filter(he=>!he.twin).length)):number{
  let repaired=0;
  for(let pass=0;pass<repairBudget;pass++){
    const open=[...s.halfEdges.values()].filter(he=>!he.twin);if(open.length<3)break;
    const byOrigin=new Map<VertexId,HalfEdge[]>();for(const he of open){if(!byOrigin.has(he.origin))byOrigin.set(he.origin,[]);byOrigin.get(he.origin)!.push(he);}
    let changed=false;
    for(const seam of open){const path=findCsgOpenSeamPath(s,seam,byOrigin);if(!path)continue;repaired+=applyCsgOpenSeamPath(s,seam,path,diagnostic,pass+1,open.length);changed=true;break;}
    if(!changed)break;
  }
  return repaired;
}

class CSGPlane {
  normal:Vec3; w:number;
  constructor(normal:Vec3,w:number){this.normal=normal;this.w=w;}
  flip(){this.normal=V.mul(this.normal,-1);this.w=-this.w;}
  splitPolygon(poly:CSGPolygon,coplanarFront:CSGPolygon[],coplanarBack:CSGPolygon[],front:CSGPolygon[],back:CSGPolygon[]){
    const COPLANAR=0,FRONT=1,BACK=2,SPANNING=3;let type=0;
    for(const v of poly.vs){const t=V.dot(this.normal,v)-this.w;type|=t<-TOL.csg?BACK:t>TOL.csg?FRONT:COPLANAR;}
    if(type===COPLANAR){(V.dot(this.normal,poly.plane.normal)>0?coplanarFront:coplanarBack).push(poly);return;}
    if(type===FRONT){front.push(poly);return;}if(type===BACK){back.push(poly);return;}
    const f:Vec3[]=[],b:Vec3[]=[];
    for(let i=0;i<poly.vs.length;i++){
      const j=(i+1)%poly.vs.length,vi=poly.vs[i],vj=poly.vs[j],di=V.dot(this.normal,vi)-this.w,dj=V.dot(this.normal,vj)-this.w,ti=di<-TOL.csg?BACK:di>TOL.csg?FRONT:COPLANAR,tj=dj<-TOL.csg?BACK:dj>TOL.csg?FRONT:COPLANAR;
      if(ti!==BACK)f.push(vi);if(ti!==FRONT)b.push(vi);
      if((ti|tj)===SPANNING){const den=V.dot(this.normal,V.sub(vj,vi)),t=(this.w-V.dot(this.normal,vi))/den,v=V.lerp(vi,vj,t);f.push(v);b.push(v);}
    }
    // Clipping changes a polygon's boundary, never its supporting plane.
    // Preserve that plane even when a fragment becomes nearly collinear.
    if(f.length>=3)front.push(csgClippedPolygon(f,poly));if(b.length>=3)back.push(csgClippedPolygon(b,poly));
  }
}
class CSGNode {
  plane:CSGPlane|null=null;front:CSGNode|null=null;back:CSGNode|null=null;polygons:CSGPolygon[]=[];
  constructor(polys:CSGPolygon[]=[]){if(polys.length)this.build(polys);}
  invert(){for(const p of this.polygons)flipCsgPoly(p);this.plane?.flip();this.front?.invert();this.back?.invert();[this.front,this.back]=[this.back,this.front];}
  clipPolygons(polys:CSGPolygon[]):CSGPolygon[]{if(!this.plane)return polys;let front:CSGPolygon[]=[],back:CSGPolygon[]=[];for(const p of polys)this.plane.splitPolygon(p,front,back,front,back);if(this.front)front=this.front.clipPolygons(front);if(this.back)back=this.back.clipPolygons(back);else back.length=0;for(const p of back)front.push(p);return front;}
  clipTo(bsp:CSGNode){this.polygons=bsp.clipPolygons(this.polygons);this.front?.clipTo(bsp);this.back?.clipTo(bsp);}
  private appendPolygons(out:CSGPolygon[]){for(const p of this.polygons)out.push(p);this.front?.appendPolygons(out);this.back?.appendPolygons(out);}
  allPolygons():CSGPolygon[]{const out:CSGPolygon[]=[];this.appendPolygons(out);return out;}
  build(polys:CSGPolygon[]){if(!polys.length)return;if(!this.plane){const p=polys[0].plane;this.plane=new CSGPlane([...p.normal] as Vec3,p.offset);}const front:CSGPolygon[]=[],back:CSGPolygon[]=[];for(const p of polys)this.plane.splitPolygon(p,this.polygons,this.polygons,front,back);if(front.length){if(!this.front)this.front=new CSGNode();this.front.build(front);}if(back.length){if(!this.back)this.back=new CSGNode();this.back.build(back);}}
}
function csgPolygon(vs:Vec3[],source?:CSGPolygon):CSGPolygon{return {vs:dedupePolygon3(vs),plane:planeFromPoints(vs),group:source?.group,provenance:source?.provenance?{...source.provenance}:undefined,faceIdHint:source?.faceIdHint};}
function csgClippedPolygon(vs:Vec3[],source:CSGPolygon):CSGPolygon{return {vs:dedupePolygon3(vs),plane:{normal:[...source.plane.normal] as Vec3,offset:source.plane.offset},group:source.group,provenance:source.provenance?{...source.provenance}:undefined,faceIdHint:source.faceIdHint};}
function cloneCsgPoly(p:CSGPolygon):CSGPolygon{return {vs:p.vs.map(v=>[...v] as Vec3),plane:{normal:[...p.plane.normal] as Vec3,offset:p.plane.offset},group:p.group,provenance:p.provenance?{...p.provenance}:undefined,faceIdHint:p.faceIdHint};}
function flipCsgPoly(p:CSGPolygon){p.vs.reverse();p.plane={normal:V.mul(p.plane.normal,-1),offset:-p.plane.offset};}
function dedupePolygon3(vs:Vec3[]):Vec3[]{const out:Vec3[]=[];for(const p of vs)if(!out.length||!V.near(out[out.length-1],p,TOL.csg))out.push(p);if(out.length>2&&V.near(out[0],out[out.length-1],TOL.csg))out.pop();return out;}
// Owned variants may mutate polygon winding/plane objects while the BSP operation runs.
// Use them only with fresh, disposable polygon lists. The public wrappers below preserve
// the previous non-destructive CSG contract by making lightweight structural clones.
function csgUnionOwned(a:CSGPolygon[],b:CSGPolygon[]):CSGPolygon[]{let A=new CSGNode(a),B=new CSGNode(b);A.clipTo(B);B.clipTo(A);B.invert();B.clipTo(A);B.invert();A.build(B.allPolygons());return A.allPolygons();}
function csgSubtractOwned(a:CSGPolygon[],b:CSGPolygon[]):CSGPolygon[]{let A=new CSGNode(a),B=new CSGNode(b);A.invert();A.clipTo(B);B.clipTo(A);B.invert();B.clipTo(A);B.invert();A.build(B.allPolygons());A.invert();return A.allPolygons();}
function csgIntersectOwned(a:CSGPolygon[],b:CSGPolygon[]):CSGPolygon[]{let A=new CSGNode(a),B=new CSGNode(b);A.invert();B.clipTo(A);B.invert();A.clipTo(B);B.clipTo(A);A.build(B.allPolygons());A.invert();return A.allPolygons();}
function csgUnion(a:CSGPolygon[],b:CSGPolygon[]):CSGPolygon[]{return csgUnionOwned(a.map(cloneCsgPoly),b.map(cloneCsgPoly));}
function csgSubtract(a:CSGPolygon[],b:CSGPolygon[]):CSGPolygon[]{return csgSubtractOwned(a.map(cloneCsgPoly),b.map(cloneCsgPoly));}
function csgIntersect(a:CSGPolygon[],b:CSGPolygon[]):CSGPolygon[]{return csgIntersectOwned(a.map(cloneCsgPoly),b.map(cloneCsgPoly));}
function solidToCsg(s:Solid,preserveFaceGroups=false):CSGPolygon[]{const out:CSGPolygon[]=[];for(const f of s.faces.values())for(const tri of triangulateFaceLocal(s,f.id)){const p=csgPolygon(tri);if(preserveFaceGroups&&f.boundaryGroup){p.group=f.boundaryGroup;p.provenance=f.provenance?{...f.provenance}:undefined;p.faceIdHint=f.id;}out.push(p);}return out;}
function csgToSolid(polys:CSGPolygon[],id?:string,provenance:FaceProvenance={kind:'pushpull'},preserveFaceGroups=false,diagnostic?:ModelingDiagnosticReporter):Solid {
  const inputs:PolyFaceInput[]=polys.filter(p=>p.vs.length>=3).map(p=>({points:p.vs,planeHint:p.plane,group:preserveFaceGroups?p.group:undefined,provenance:preserveFaceGroups&&p.provenance?p.provenance:provenance,faceIdHint:preserveFaceGroups?p.faceIdHint:undefined}));diagnostic?.('csg','brep-rebuild-start',{polygons:polys.length,inputPolygons:inputs.length,preserveFaceGroups});
  let s:Solid;try{s=buildSolidFromPolygons(inputs,id,{resolveShortBoundaryEdges:true});}catch(error){diagnostic?.('brep','build-error',{message:errorMessage(error)});throw error;}
  const openBefore=[...s.halfEdges.values()].filter(he=>!he.twin).length;diagnostic?.('brep','build-complete',{vertices:s.vertices.size,halfEdges:s.halfEdges.size,loops:s.loops.size,faces:s.faces.size,openEdges:openBefore});
  const repairBudget=csgSeamRepairBudget(openBefore),repaired=repairCsgOpenSeamChains(s,diagnostic,repairBudget),openAfter=[...s.halfEdges.values()].filter(he=>!he.twin).length;diagnostic?.('csg','seam-repair-summary',{openEdgesBefore:openBefore,repairBudget,repaired,openEdgesAfter:openAfter,policy:CSG_REPAIR_POLICY});
  if(openAfter)diagnostic?.('brep','open-edge-snapshot',csgOpenEdgeDiagnostics(s));
  const validation=validateSolid(s,false);if(!validation.ok){diagnostic?.('brep','validation-error',{message:validation.errors[0]||'Invalid solid',errors:validation.errors.slice(0,32),errorCount:validation.errors.length,volume:validation.volume,openEdges:openAfter});if(validation.errors.some(error=>error.startsWith('Short edge')))diagnostic?.('brep','short-edge-snapshot',csgShortEdgeDiagnostics(s));throw Error(validation.errors[0]||'Invalid solid.');}
  diagnostic?.('brep','validation-ok',{volume:validation.volume,vertices:s.vertices.size,halfEdges:s.halfEdges.size,faces:s.faces.size});return s;
}
function csgPolygonsInReference(s:Solid,source:Transform,reference:Transform):CSGPolygon[]{return solidToCsg(s).map(poly=>csgPolygon(poly.vs.map(p=>inverseTransformPoint(transformPoint(p,source),reference)),poly));}
function solidShellCount(s:Solid):number {
  const pending=new Set<FaceId>(s.faces.keys());let count=0;
  while(pending.size){const seed=pending.values().next().value as FaceId;pending.delete(seed);count++;const queue=[seed];for(let i=0;i<queue.length;i++){const face=s.faces.get(queue[i]);if(!face)continue;for(const lid of [face.outerLoop,...face.innerLoops])for(const he of loopHalfEdges(s,lid)){const twin=s.halfEdges.get(he.twin);if(twin&&pending.delete(twin.face))queue.push(twin.face);}}}
  return count;
}
function unionSolids(a:Solid,aTransform:Transform,b:Solid,bTransform:Transform,id=a.id):BooleanUnionResult {
  let polygons:CSGPolygon[];
  try{polygons=profiler.measure('geometry','Boolean union',()=>csgUnionOwned(solidToCsg(a),csgPolygonsInReference(b,bTransform,aTransform)),{aFaces:a.faces.size,bFaces:b.faces.size});}
  catch(error){return {ok:false,reason:'invalid',message:errorMessage(error)};}
  if(!polygons.length)return {ok:false,reason:'empty',message:'The Boolean union produced no polygons.'};
  let out:Solid;
  try{out=profiler.measure('geometry','Union CSG -> B-rep',()=>csgToSolid(polygons,id,{kind:'boolean',label:'Union'}),{polygons:polygons.length});}
  catch(error){return {ok:false,reason:'invalid',message:errorMessage(error)};}
  if(solidShellCount(out)!==1)return {ok:false,reason:'disconnected',message:'The selected objects do not form one connected solid.'};
  return {ok:true,solid:out};
}
function regionOnNormal(points:Vec3[],normal:Vec3):Vec3[]{const n=normal;const pl=planeFromPoints(points);return V.dot(pl.normal,n)>=0?[...points]:[...points].reverse();}
function topologyMapAllNew(before:Solid,after:Solid):TopologyMap {const vertices=new Map<VertexId,VertexId|null>();for(const id of before.vertices.keys())vertices.set(id,null);const faces=new Map<FaceId,FaceId|null>();for(const id of before.faces.keys())faces.set(id,null);return {vertices,edges:new Map(),faces,createdFaces:[...after.faces.keys()]};}
function topologyMapStableIds(before:Solid,after:Solid):TopologyMap {const vertices=new Map<VertexId,VertexId|null>();for(const id of before.vertices.keys())vertices.set(id,after.vertices.has(id)?id:null);const faces=new Map<FaceId,FaceId|null>();for(const id of before.faces.keys())faces.set(id,after.faces.has(id)?id:null);const createdFaces=[...after.faces.keys()].filter(id=>!before.faces.has(id));return {vertices,edges:new Map(),faces,createdFaces};}
function topologyIdentity(s:Solid):TopologyMap {return {vertices:new Map([...s.vertices.keys()].map(id=>[id,id])),edges:new Map(),faces:new Map([...s.faces.keys()].map(id=>[id,id])),createdFaces:[]};}
