interface FaceSweepCandidate { solid:Solid; topology:TopologyMap; targetAlive:boolean; }
interface SweepCandidateSuccess { ok:true; candidate:FaceSweepCandidate; }
interface SweepCandidateFailure { ok:false; reason:string; error?:unknown; }
type SweepCandidateAttempt=SweepCandidateSuccess|SweepCandidateFailure;
interface SweepResolutionSuccess { ok:true; result:SolidEditResult; }
interface SweepResolutionFailure { ok:false; reason:string; error?:unknown; }
type SweepResolutionAttempt=SweepResolutionSuccess|SweepResolutionFailure;
function sweepCandidateFailure(reason:string,error?:unknown):SweepCandidateFailure{return error===undefined?{ok:false,reason}:{ok:false,reason,error};}
function sweepResolutionFailure(reason:string,error?:unknown):SweepResolutionFailure{return error===undefined?{ok:false,reason}:{ok:false,reason,error};}
type SweepTerminalClass='alive'|'shell-ahead'|'terminal';
const SWEEP_POLICY={
  zeroDistance:1e-12,
  eventSearchIterations:44,
  directEventMaxTransitions:16,
  minimumEventFraction:1e-7,
  eventSnapScales:[1,2,4] as const,
  eventSnapAcceptanceFactor:1.5,
  previewExactEventMaxFaces:48,
  previewExactEventMaxHalfEdges:320,
  relativeDistanceTolerance:1e-9,
  distanceToleranceCoplanarFactor:8,
  coplanarPlaneDistanceFactor:4,
  parallelFaceAngleFactor:8,
  directFacePlanarityFactor:8,
  directLoopTargetAgreementFactor:2,
  directLoopPlaneAgreementFactor:4,
  terminalShiftCoplanarFactor:2,
  planeIntersectionDeterminantEpsilon:1e-10,
  shellRayParallelEpsilon:1e-10,
  receivingParallelEpsilon:1e-12,
  receivingNearFaceMinimumEdgeFactor:2,
  toleranceFactors:{
    shell:{minimumEdge:2,coplanarDistance:16,csg:64},
    regularization:{minimumEdge:4,coplanarDistance:16,csg:64},
    directLoopEvent:{minimumEdge:2,coplanarDistance:16},
    directCollapseMargin:{minimumEdge:4,coplanarDistance:16},
    embeddedContact:{minimumEdge:2,coplanarDistance:8},
    receivingRequestMargin:{minimumEdge:4,coplanarDistance:16},
  },
};
function sweepShellTolerance():number{const f=SWEEP_POLICY.toleranceFactors.shell;return Math.max(TOL.minimumEdge*f.minimumEdge,TOL.coplanarDistance*f.coplanarDistance,TOL.csg*f.csg);}
function sweepRegularizationDistance():number{const f=SWEEP_POLICY.toleranceFactors.regularization;return Math.max(TOL.minimumEdge*f.minimumEdge,TOL.coplanarDistance*f.coplanarDistance,TOL.csg*f.csg);}
function directLoopEventTolerance():number{const f=SWEEP_POLICY.toleranceFactors.directLoopEvent;return Math.max(TOL.minimumEdge*f.minimumEdge,TOL.coplanarDistance*f.coplanarDistance);}
function directCollapseMargin():number{const f=SWEEP_POLICY.toleranceFactors.directCollapseMargin;return Math.max(TOL.minimumEdge*f.minimumEdge,TOL.coplanarDistance*f.coplanarDistance);}
function embeddedContactTolerance():number{const f=SWEEP_POLICY.toleranceFactors.embeddedContact;return Math.max(TOL.minimumEdge*f.minimumEdge,TOL.coplanarDistance*f.coplanarDistance);}
function receivingRequestMargin():number{const f=SWEEP_POLICY.toleranceFactors.receivingRequestMargin;return Math.max(TOL.minimumEdge*f.minimumEdge,TOL.coplanarDistance*f.coplanarDistance);}
function sweepDistanceTolerance(requested:number):number{return Math.max(TOL.coplanarDistance*SWEEP_POLICY.distanceToleranceCoplanarFactor,Math.abs(requested)*SWEEP_POLICY.relativeDistanceTolerance);}
function sweepTerminalResult(candidate:FaceSweepCandidate,distance:number,requested:number):SolidEditResult {
  const limited=Math.abs(distance-requested)>sweepDistanceTolerance(requested);
  return {solid:candidate.solid,distance,limited,reason:limited?'face terminated at shell':undefined,topology:candidate.topology};
}
function planesCoplanarSame(a:Plane,b:Plane):boolean {return V.dot(a.normal,b.normal)>1-TOL.coplanarAngle&&Math.abs(a.offset-b.offset)<=TOL.coplanarDistance*SWEEP_POLICY.coplanarPlaneDistanceFactor;}
function directOffsetTouchedFaces(s:Solid,face:Face):Set<FaceId>{
  const out=new Set<FaceId>([face.id]);
  for(const lid of [face.outerLoop,...face.innerLoops])for(const he of loopHalfEdges(s,lid)){const tw=s.halfEdges.get(he.twin);if(tw)out.add(tw.face);}
  return out;
}
function loopSupportsDirectPlanarOffset(s:Solid,face:Face,loopId:LoopId):boolean {
  for(const he of loopHalfEdges(s,loopId)){
    const prev=s.halfEdges.get(he.prev),twOut=s.halfEdges.get(he.twin),twPrev=prev&&s.halfEdges.get(prev.twin);if(!prev||!twOut||!twPrev)return false;const a=s.faces.get(twPrev.face),b=s.faces.get(twOut.face);if(!a||!b||planesCoplanarSame(face.plane,a.plane)||planesCoplanarSame(face.plane,b.plane))return false;
    // The direct plane-intersection fast path is only semantically identical
    // to a sweep when the sweep direction lies in every adjacent face plane.
    // Otherwise (for example a chamfer face between two box sides) a true
    // sweep creates new side faces, while intersecting the old neighbour
    // planes merely grows/shrinks the chamfer and changes the operation.
    // Keep those cases on the general sweep path instead of optimizing them
    // into a different result.
    if(Math.abs(V.dot(a.plane.normal,face.plane.normal))>TOL.coplanarAngle*SWEEP_POLICY.parallelFaceAngleFactor||Math.abs(V.dot(b.plane.normal,face.plane.normal))>TOL.coplanarAngle*SWEEP_POLICY.parallelFaceAngleFactor)return false;
    if(Math.abs(V.dot(face.plane.normal,V.cross(a.plane.normal,b.plane.normal)))<SWEEP_POLICY.planeIntersectionDeterminantEpsilon)return false;
  }
  return true;
}
function faceSupportsDirectPlanarOffset(s:Solid,faceId:FaceId):boolean {
  const f=s.faces.get(faceId);if(!f)return false;
  return [f.outerLoop,...f.innerLoops].every(lid=>loopSupportsDirectPlanarOffset(s,f,lid));
}
function loopHasCoplanarSupport(s:Solid,face:Face,loopId:LoopId):boolean|null {
  const boundary=loopHalfEdges(s,loopId);if(!boundary.length)return null;let coplanar:boolean|null=null;
  for(const he of boundary){const tw=s.halfEdges.get(he.twin),other=tw&&s.faces.get(tw.face);if(!other)return null;const here=planesCoplanarSame(face.plane,other.plane);if(coplanar===null)coplanar=here;else if(coplanar!==here)return null;}
  return coplanar;
}
function coplanarSupportSweepLoops(s:Solid,faceId:FaceId):{coplanar:LoopId[];direct:LoopId[]}|null {
  const face=s.faces.get(faceId);if(!face||faceIsEmbeddedCoplanarRegion(s,faceId))return null;const coplanar:LoopId[]=[],direct:LoopId[]=[];
  for(const lid of [face.outerLoop,...face.innerLoops]){const kind=loopHasCoplanarSupport(s,face,lid);if(kind===null)return null;if(kind)coplanar.push(lid);else if(loopSupportsDirectPlanarOffset(s,face,lid))direct.push(lid);else return null;}
  // A support face with coplanar islands is the complementary case to an
  // embedded sketch region: the selected face moves, while each coplanar
  // island stays on the original plane and receives a new vertical wall.
  return coplanar.length?{coplanar,direct}:null;
}
function validateDirectOffsetFaces(s:Solid,faceIds:Set<FaceId>):string|null{
  for(const fid of faceIds){
    const f=s.faces.get(fid);if(!f)return 'A neighbouring face disappeared during direct face offset.';const lp=faceLoopPoints(s,fid),basis=planeBasis(f.plane,lp.outer[0]);
    const loops=[lp.outer,...lp.holes];for(const loop of loops){if(loop.length<3)return 'A face collapsed during direct face offset.';for(let i=0;i<loop.length;i++){const p=loop[i],q=loop[(i+1)%loop.length];if(!Number.isFinite(p[0]+p[1]+p[2])||Math.abs(V.dot(f.plane.normal,p)-f.plane.offset)>TOL.plane*SWEEP_POLICY.directFacePlanarityFactor)return 'A face became non-planar during direct face offset.';if(V.len(V.sub(p,q))<TOL.minimumEdge)return 'An edge collapsed during direct face offset.';}}
    const outer2=lp.outer.map(p=>toPlane2(p,basis)),oa=v2.area(outer2);if(oa<=TOL.minimumFaceArea||polygonSelfIntersects(outer2))return 'A face collapsed during direct face offset.';
    for(const h of lp.holes){const h2=h.map(p=>toPlane2(p,basis)),ha=v2.area(h2);if(ha>=-TOL.minimumFaceArea||polygonSelfIntersects(h2)||!pointInPolygon2(h2[0],outer2))return 'A hole collapsed during direct face offset.';}
  }
  return null;
}
function directPlanarFaceOffsetCandidate(s:Solid,faceId:FaceId,distance:number):SweepCandidateAttempt {
  const face=s.faces.get(faceId);if(!face)return sweepCandidateFailure('The face does not exist.');const out=cloneSolidFast(s),target:Plane={normal:[...face.plane.normal] as Vec3,offset:face.plane.offset+distance},moved=new Set<VertexId>(),touched=directOffsetTouchedFaces(s,face);
  for(const lid of [face.outerLoop,...face.innerLoops])for(const he of loopHalfEdges(s,lid)){
    if(moved.has(he.origin))continue;const prev=s.halfEdges.get(he.prev),twOut=s.halfEdges.get(he.twin),twPrev=prev&&s.halfEdges.get(prev.twin);if(!prev||!twOut||!twPrev)return sweepCandidateFailure('Open boundary during direct face offset.');
    const a=s.faces.get(twPrev.face),b=s.faces.get(twOut.face);if(!a||!b||a.id===faceId||b.id===faceId)return sweepCandidateFailure('Invalid neighbouring topology during direct face offset.');
    const p=solve3Rows(target.normal,a.plane.normal,b.plane.normal,[target.offset,a.plane.offset,b.plane.offset]);if(!p)return sweepCandidateFailure('The neighbouring planes do not define a unique moved corner.');const movedVertex=out.vertices.get(he.origin);if(!movedVertex)return sweepCandidateFailure('A moved vertex disappeared during direct face offset.');movedVertex.position=p;moved.add(he.origin);
  }
  const movedFace=out.faces.get(faceId);if(!movedFace)return sweepCandidateFailure('The moved face disappeared during direct face offset.');movedFace.plane=target;const validationError=validateDirectOffsetFaces(out,touched);if(validationError)return sweepCandidateFailure(validationError);
  const vertices=new Map<VertexId,VertexId|null>();for(const id of s.vertices.keys())vertices.set(id,id);const faces=new Map<FaceId,FaceId|null>();for(const id of s.faces.keys())faces.set(id,id);
  return {ok:true,candidate:{solid:out,topology:{vertices,edges:new Map(),faces,createdFaces:[]},targetAlive:true}};
}
interface DirectLoopEndEvent { loopId:LoopId; kind:'absorb-hole'|'collapse-outer'; distance:number; targetFaceId:FaceId; sideFaceIds:FaceId[]; }
function directLoopEndEvent(s:Solid,faceId:FaceId,loopId:LoopId,requested:number):DirectLoopEndEvent|null {
  const face=s.faces.get(faceId),loopRec=s.loops.get(loopId);if(!face||!loopRec||Math.abs(requested)<SWEEP_POLICY.zeroDistance)return null;const boundary=loopHalfEdges(s,loopId);if(boundary.length<3)return null;const sign=Math.sign(requested),eps=directLoopEventTolerance(),sideFaceIds:FaceId[]=[],targets:{faceId:FaceId;distance:number}[]=[];
  for(const he of boundary){
    const tw=s.halfEdges.get(he.twin);if(!tw||tw.face===faceId)return null;const side=s.faces.get(tw.face);if(!side)return null;sideFaceIds.push(side.id);
    let best:{faceId:FaceId;distance:number}|null=null;
    for(const lid of [side.outerLoop,...side.innerLoops])for(const e of loopHalfEdges(s,lid)){
      const en=s.halfEdges.get(e.next),et=s.halfEdges.get(e.twin);if(!en||!et||et.face===faceId||et.face===side.id)continue;const pa=s.vertices.get(e.origin)?.position,pb=s.vertices.get(en.origin)?.position;if(!pa||!pb)continue;const da=V.dot(face.plane.normal,pa)-face.plane.offset,db=V.dot(face.plane.normal,pb)-face.plane.offset;if(Math.abs(da-db)>eps||Math.abs(da)<=eps||Math.sign(da)!==sign)continue;
      if(!best||Math.abs(da)<Math.abs(best.distance))best={faceId:et.face,distance:(da+db)/2};
    }
    if(!best)return null;targets.push(best);
  }
  const targetId=targets[0].faceId,distance=targets[0].distance;if(targets.some(t=>t.faceId!==targetId||Math.abs(t.distance-distance)>eps*SWEEP_POLICY.directLoopTargetAgreementFactor))return null;if(Math.abs(distance)>Math.abs(requested)+eps)return null;
  const target=s.faces.get(targetId);if(!target)return null;const den=V.dot(target.plane.normal,face.plane.normal);if(Math.abs(Math.abs(den)-1)>TOL.coplanarAngle*SWEEP_POLICY.parallelFaceAngleFactor)return null;const planeDistance=target.plane.offset/den-face.plane.offset;if(Math.abs(planeDistance-distance)>eps*SWEEP_POLICY.directLoopPlaneAgreementFactor)return null;
  // Only accept a clean ring ending in one complete cap. This is a topology
  // relation, not a shape rule: rectangle, circle and arbitrary polygon loops
  // all follow the same test.
  if(target.innerLoops.length)return null;const targetBoundary=loopHalfEdges(s,target.outerLoop);if(targetBoundary.length!==boundary.length)return null;const sideSet=new Set(sideFaceIds),targetSideSet=new Set<FaceId>();for(const e of targetBoundary){const tw=s.halfEdges.get(e.twin);if(!tw)return null;targetSideSet.add(tw.face);}if(targetSideSet.size!==sideSet.size||[...sideSet].some(id=>!targetSideSet.has(id)))return null;
  if(loopRec.kind==='hole'&&den>0)return {loopId,kind:'absorb-hole',distance:planeDistance,targetFaceId:targetId,sideFaceIds:[...sideSet]};
  if(loopRec.kind==='outer'&&den<0)return {loopId,kind:'collapse-outer',distance:planeDistance,targetFaceId:targetId,sideFaceIds:[...sideSet]};
  return null;
}
function nearestDirectLoopEvent(s:Solid,faceId:FaceId,requested:number):DirectLoopEndEvent|null {
  const face=s.faces.get(faceId);if(!face)return null;let best:DirectLoopEndEvent|null=null;for(const lid of [face.outerLoop,...face.innerLoops]){const e=directLoopEndEvent(s,faceId,lid,requested);if(e&&(!best||Math.abs(e.distance)<Math.abs(best.distance)))best=e;}return best;
}
function removeFaceTopology(out:Solid,faceId:FaceId){const f=out.faces.get(faceId);if(!f)return;for(const lid of [f.outerLoop,...f.innerLoops]){for(const he of loopHalfEdges(out,lid))out.halfEdges.delete(he.id);out.loops.delete(lid);}out.faces.delete(faceId);}
function pruneUnusedVertices(out:Solid){const used=new Set<VertexId>();for(const he of out.halfEdges.values())used.add(he.origin);for(const id of [...out.vertices.keys()])if(!used.has(id))out.vertices.delete(id);}
function directAbsorbHoleEvent(s:Solid,faceId:FaceId,event:DirectLoopEndEvent):SweepCandidateAttempt {
  const face=s.faces.get(faceId);if(!face||event.kind!=='absorb-hole'||!face.innerLoops.includes(event.loopId))return sweepCandidateFailure('Invalid hole-merge event.');const out=cloneSolidFast(s),target:Plane={normal:[...face.plane.normal] as Vec3,offset:face.plane.offset+event.distance};
  // Move every surviving boundary vertex to the event plane by intersecting
  // the same neighboring planes used by the ordinary direct offset. The ring
  // that disappears is deliberately skipped because its vertices are removed.
  for(const lid of [face.outerLoop,...face.innerLoops])if(lid!==event.loopId)for(const he of loopHalfEdges(s,lid)){
    const prev=s.halfEdges.get(he.prev),twOut=s.halfEdges.get(he.twin),twPrev=prev&&s.halfEdges.get(prev.twin);if(!prev||!twOut||!twPrev)return sweepCandidateFailure('Open boundary during hole merge.');const a=s.faces.get(twPrev.face),b=s.faces.get(twOut.face);if(!a||!b)return sweepCandidateFailure('Missing neighbouring face during hole merge.');const p=solve3Rows(target.normal,a.plane.normal,b.plane.normal,[target.offset,a.plane.offset,b.plane.offset]);if(!p)return sweepCandidateFailure('The neighbouring planes collapse during hole merge.');const movedVertex=out.vertices.get(he.origin);if(!movedVertex)return sweepCandidateFailure('A moved vertex disappeared during hole merge.');movedVertex.position=p;
  }
  const movedFace=out.faces.get(faceId);if(!movedFace)return sweepCandidateFailure('The moved face disappeared during hole merge.');movedFace.plane=target;movedFace.innerLoops=movedFace.innerLoops.filter(id=>id!==event.loopId);
  for(const he of loopHalfEdges(out,event.loopId))out.halfEdges.delete(he.id);out.loops.delete(event.loopId);
  for(const sid of event.sideFaceIds)removeFaceTopology(out,sid);removeFaceTopology(out,event.targetFaceId);pruneUnusedVertices(out);const validation=validateSolid(out,false);if(!validation.ok)return sweepCandidateFailure(validation.errors[0]||'The hole merge produced an invalid solid.');
  const vertices=new Map<VertexId,VertexId|null>();for(const id of s.vertices.keys())vertices.set(id,out.vertices.has(id)?id:null);const faces=new Map<FaceId,FaceId|null>();for(const id of s.faces.keys())faces.set(id,out.faces.has(id)?id:null);
  return {ok:true,candidate:{solid:out,topology:{vertices,edges:new Map(),faces,createdFaces:[]},targetAlive:true}};
}
function planarFaceReceivingEvent(s:Solid,faceId:FaceId,requested:number):PlanarReceivingEvent|null {
  const face=s.faces.get(faceId);if(!face||Math.abs(requested)<SWEEP_POLICY.zeroDistance)return null;const sign=Math.sign(requested),eps=sweepShellTolerance(),anchor=faceCentroid(s,faceId);let samples:Vec3[]|null=null,best:PlanarReceivingEvent|null=null;
  for(const other of s.faces.values()){
    if(other.id===faceId||V.dot(other.plane.normal,face.plane.normal)>-1+TOL.coplanarAngle*SWEEP_POLICY.parallelFaceAngleFactor)continue;const den=V.dot(other.plane.normal,face.plane.normal);if(Math.abs(den)<SWEEP_POLICY.receivingParallelEpsilon)continue;const t=(other.plane.offset-V.dot(other.plane.normal,anchor))/den;if(Math.sign(t)!==sign||Math.abs(t)<=eps||Math.abs(t)>Math.abs(requested)+eps)continue;
    // Region witnesses matter only after an opposing plane is in the sweep range.
    if(!samples){const lp=faceLoopPoints(s,faceId);samples=[...lp.outer,...lp.holes.flat(),...triangulateFaceLocal(s,faceId).map(triangleCentroid)];}
    let inside=true;for(const p of samples){const q=V.add(p,V.mul(face.plane.normal,t));if(!pointInsideFaceDomain(s,other.id,q)){inside=false;break;}}if(!inside)continue;if(!best||Math.abs(t)<Math.abs(best.distance))best={distance:t,targetFaceId:other.id};
  }
  return best;
}
function regularizedPlanarCollapse(s:Solid,faceId:FaceId,requested:number,event:PlanarReceivingEvent):SolidEditResult|null {
  const probeDistance=event.distance+Math.sign(event.distance)*sweepRegularizationDistance();
  // Evaluate on the far side of the receiving shell with the semantic CSG
  // path. The local offset path cannot represent the exact topology change:
  // the moving support region vanishes while any material inside its holes
  // may remain as independent shells. CSG supplies that canonical post-event
  // topology without shape- or loop-count-specific rules.
  const attempt=tryGeneralFaceSweepCandidate(s,faceId,probeDistance);if(!attempt.ok)return null;const candidate=attempt.candidate;if(!candidate.solid.faces.size)return null;const validation=validateSolid(candidate.solid,false);if(!validation.ok)return null;return sweepTerminalResult(candidate,event.distance,requested);
}
function tryDirectPlanarMove(s:Solid,faceId:FaceId,requested:number):SolidEditResult|null {
  const face=s.faces.get(faceId);if(!face||faceIsEmbeddedCoplanarRegion(s,faceId))return null;
  // Terminal contact must be recognized before choosing between the ordinary
  // direct offset and the coplanar-support fast path. Both representations can
  // reach the same receiving shell, and both need the same canonical topology
  // event instead of leaving a microscopic residual cap.
  const receiver=planarFaceReceivingEvent(s,faceId,requested);if(receiver){const collapsed=regularizedPlanarCollapse(s,faceId,requested,receiver);if(collapsed)return collapsed;}
  if(!faceSupportsDirectPlanarOffset(s,faceId))return null;let current=s,remaining=requested,total=0;
  for(let guard=0;guard<SWEEP_POLICY.directEventMaxTransitions&&Math.abs(remaining)>SWEEP_POLICY.zeroDistance;guard++){
    const event=nearestDirectLoopEvent(current,faceId,remaining);
    if(!event){const attempt=profiler.measure('geometry','Direct planar offset',()=>directPlanarFaceOffsetCandidate(current,faceId,remaining),{faceId,distance:remaining});if(!attempt.ok)return null;const c=attempt.candidate;return {solid:c.solid,distance:requested,limited:false,topology:topologyMapStableIds(s,c.solid)};}
    if(event.kind==='collapse-outer'){
      const margin=directCollapseMargin(),d=event.distance-Math.sign(event.distance)*margin;if(Math.abs(d)<TOL.minimumEdge)return null;
      const attempt=profiler.measure('geometry','Direct planar offset',()=>directPlanarFaceOffsetCandidate(current,faceId,d),{faceId,distance:d,event:'collapse'});if(!attempt.ok)return null;const c=attempt.candidate,moved=total+d;return {solid:c.solid,distance:moved,limited:true,reason:'geometric limit',topology:topologyMapStableIds(s,c.solid)};
    }
    const attempt=profiler.measure('geometry','Direct topology merge',()=>directAbsorbHoleEvent(current,faceId,event),{faceId,distance:event.distance,targetFaceId:event.targetFaceId});if(!attempt.ok)return null;current=attempt.candidate.solid;total+=event.distance;remaining=requested-total;
  }
  if(Math.abs(remaining)<=SWEEP_POLICY.zeroDistance)return {solid:current,distance:requested,limited:false,topology:topologyMapStableIds(s,current)};return null;
}
function faceIsEmbeddedCoplanarRegion(s:Solid,faceId:FaceId):boolean {
  const f=s.faces.get(faceId);if(!f)return false;const lids=[f.outerLoop,...f.innerLoops];let count=0;
  for(const lid of lids)for(const he of loopHalfEdges(s,lid)){const twin=s.halfEdges.get(he.twin),nf=twin&&s.faces.get(twin.face);if(!nf||!planesCoplanarSame(f.plane,nf.plane))return false;count++;}
  return count>=3;
}
function sweptEmbeddedRegionMayMeetShell(s:Solid,faceId:FaceId,distance:number,ignoreFaces:Set<FaceId>=new Set()):boolean {
  const f=s.faces.get(faceId);if(!f)return true;const loops=faceLoopPoints(s,faceId),pts=[...loops.outer,...loops.holes.flat()],delta=V.mul(f.plane.normal,distance),all=pts.concat(pts.map(p=>V.add(p,delta)));
  const min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];for(const p of all)for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}
  const eps=embeddedContactTolerance(),overlaps=(a0:number,a1:number,b0:number,b1:number)=>Math.min(a1,b1)>=Math.max(a0,b0)-eps;
  // A local Euler extrusion is only exact while the swept prism is isolated
  // from every other shell face. The coplanar support around an embedded
  // sketch is intentionally ignored; a terminal receiving cap can be ignored
  // explicitly by its caller. Any other possible contact is a topology event
  // and must go through the general regularized boolean path so overlapping
  // voids/cuts are merged instead of leaving artificial internal walls.
  for(const other of s.faces.values()){if(other.id===faceId||ignoreFaces.has(other.id)||planesCoplanarSame(f.plane,other.plane))continue;const lp=faceLoopPoints(s,other.id),op=[...lp.outer,...lp.holes.flat()];const omin:[number,number,number]=[Infinity,Infinity,Infinity],omax:[number,number,number]=[-Infinity,-Infinity,-Infinity];for(const p of op)for(let k=0;k<3;k++){omin[k]=Math.min(omin[k],p[k]);omax[k]=Math.max(omax[k],p[k]);}if(overlaps(min[0],max[0],omin[0],omax[0])&&overlaps(min[1],max[1],omin[1],omax[1])&&overlaps(min[2],max[2],omin[2],omax[2]))return true;}
  return false;
}
function canUseDirectEmbeddedSweep(s:Solid,faceId:FaceId,distance:number):boolean {
  return faceIsEmbeddedCoplanarRegion(s,faceId)&&!sweptEmbeddedRegionMayMeetShell(s,faceId,distance);
}
function cloneSolidFast(s:Solid):Solid {
  return {id:s.id,vertices:new Map([...s.vertices].map(([id,v])=>[id,{id:v.id,position:[...v.position] as Vec3}])),halfEdges:new Map([...s.halfEdges].map(([id,h])=>[id,{...h}])),loops:new Map([...s.loops].map(([id,l])=>[id,{...l}])),faces:new Map([...s.faces].map(([id,f])=>[id,{...f,plane:{normal:[...f.plane.normal] as Vec3,offset:f.plane.offset},innerLoops:[...f.innerLoops],provenance:f.provenance?{...f.provenance}:undefined}])),metadata:structuredClone(s.metadata||{})};
}
function directEmbeddedFaceSweepCandidate(s:Solid,faceId:FaceId,distance:number):FaceSweepCandidate {
  const face=s.faces.get(faceId);if(!face)throw Error('The face does not exist.');const n=face.plane.normal,delta=V.mul(n,distance),out=cloneSolidFast(s),serial=`mv${topologySerial++}`;
  const selected=out.faces.get(faceId)!;selected.plane={normal:[...n] as Vec3,offset:face.plane.offset+distance};
  const boundary:HalfEdge[]=[];for(const lid of [face.outerLoop,...face.innerLoops])boundary.push(...loopHalfEdges(s,lid));
  const movedVertex=new Map<VertexId,VertexId>();let vi=1,fi=1,li=1,hi=1;
  for(const he of boundary)if(!movedVertex.has(he.origin)){const ov=s.vertices.get(he.origin)!;const id=`v_${serial}_${vi++}`;movedVertex.set(he.origin,id);out.vertices.set(id,{id,position:V.add(ov.position,delta)});}
  // Move only the selected face's half-edge origins to duplicated vertices.
  // The original vertices remain on the coplanar support face, so the old
  // boundary becomes one rim of the new side shell.
  for(const he of boundary)out.halfEdges.get(he.id)!.origin=movedVertex.get(he.origin)!;
  const openVertical:{id:HalfEdgeId,a:VertexId,b:VertexId}[]=[];const createdFaces:FaceId[]=[];
  for(const he of boundary){
    const next=s.halfEdges.get(he.next)!,twin=out.halfEdges.get(he.twin)!;const oldA=he.origin,oldB=next.origin,newA=movedVertex.get(oldA)!,newB=movedVertex.get(oldB)!;
    const fid=`f_${serial}_${fi++}`,lid=`l_${serial}_${li++}`,ids=[`he_${serial}_${hi++}`,`he_${serial}_${hi++}`,`he_${serial}_${hi++}`,`he_${serial}_${hi++}`];
    const a=s.vertices.get(oldA)!.position,b=s.vertices.get(oldB)!.position,be=out.vertices.get(newB)!.position;
    out.faces.set(fid,{id:fid,plane:planeFromPoints([a,b,be]),outerLoop:lid,innerLoops:[],provenance:{kind:'pushpull'}});out.loops.set(lid,{id:lid,kind:'outer',firstHalfEdge:ids[0]});createdFaces.push(fid);
    const origins=[oldA,oldB,newB,newA];for(let i=0;i<4;i++)out.halfEdges.set(ids[i],{id:ids[i],origin:origins[i],twin:'',next:ids[(i+1)%4],prev:ids[(i+3)%4],loop:lid,face:fid});
    const e0=out.halfEdges.get(ids[0])!,e2=out.halfEdges.get(ids[2])!,sel=out.halfEdges.get(he.id)!;e0.twin=twin.id;twin.twin=e0.id;e2.twin=sel.id;sel.twin=e2.id;
    openVertical.push({id:ids[1],a:oldB,b:newB},{id:ids[3],a:newA,b:oldA});
  }
  const pairs=new Map<string,{id:HalfEdgeId,a:VertexId,b:VertexId}[]>();for(const e of openVertical){const k=e.a<e.b?`${e.a}|${e.b}`:`${e.b}|${e.a}`;if(!pairs.has(k))pairs.set(k,[]);pairs.get(k)!.push(e);}
  for(const [k,list] of pairs){if(list.length!==2)throw Error('Incomplete side edge during face sweep: '+k);const a=out.halfEdges.get(list[0].id)!,b=out.halfEdges.get(list[1].id)!;a.twin=b.id;b.twin=a.id;}
  const vertices=new Map<VertexId,VertexId|null>();for(const id of s.vertices.keys())vertices.set(id,id);const faces=new Map<FaceId,FaceId|null>();for(const id of s.faces.keys())faces.set(id,id);
  return {solid:out,topology:{vertices,edges:new Map(),faces,createdFaces},targetAlive:true};
}
interface PlanarReceivingEvent { distance:number; targetFaceId:FaceId; }
function directCoplanarSupportFaceSweepCandidate(s:Solid,faceId:FaceId,distance:number,loops:{coplanar:LoopId[];direct:LoopId[]}):FaceSweepCandidate {
  const face=s.faces.get(faceId);if(!face)throw Error('The face does not exist.');const n=face.plane.normal,target:Plane={normal:[...n] as Vec3,offset:face.plane.offset+distance},delta=V.mul(n,distance),out=cloneSolidFast(s),serial=`support${topologySerial++}`;
  const selected=out.faces.get(faceId)!;selected.plane=target;const moved=new Set<VertexId>(),touched=new Set<FaceId>([faceId]);
  // Boundaries backed by ordinary side faces keep their topology and move by
  // intersecting the target plane with the two neighbouring side planes.
  for(const lid of loops.direct)for(const he of loopHalfEdges(s,lid)){
    if(moved.has(he.origin))continue;const prev=s.halfEdges.get(he.prev),twOut=s.halfEdges.get(he.twin),twPrev=prev&&s.halfEdges.get(prev.twin);if(!prev||!twOut||!twPrev)throw Error('Open boundary during support-face sweep.');const a=s.faces.get(twPrev.face),b=s.faces.get(twOut.face);if(!a||!b)throw Error('Missing neighbouring face during support-face sweep.');const p=solve3Rows(target.normal,a.plane.normal,b.plane.normal,[target.offset,a.plane.offset,b.plane.offset]);if(!p)throw Error('The neighbouring planes do not define a unique moved corner.');const v=out.vertices.get(he.origin);if(!v)throw Error('A moved vertex disappeared during support-face sweep.');v.position=p;moved.add(he.origin);touched.add(a.id);touched.add(b.id);
  }
  // Coplanar islands stay on the source plane. Duplicate only the selected
  // side of each boundary and bridge old/new rims with a watertight side shell.
  const openVertical:{id:HalfEdgeId;a:VertexId;b:VertexId}[]=[],createdFaces:FaceId[]=[];let vi=1,fi=1,li=1,hi=1;
  for(const lid0 of loops.coplanar){const boundary=loopHalfEdges(s,lid0),movedVertex=new Map<VertexId,VertexId>();
    for(const he of boundary)if(!movedVertex.has(he.origin)){const ov=s.vertices.get(he.origin);if(!ov)throw Error('Missing support-face boundary vertex.');const id=`v_${serial}_${vi++}`;movedVertex.set(he.origin,id);out.vertices.set(id,{id,position:V.add(ov.position,delta)});}
    for(const he of boundary){const sel=out.halfEdges.get(he.id);if(!sel)throw Error('Missing selected boundary half-edge.');sel.origin=movedVertex.get(he.origin)!;}
    for(const he of boundary){
      const next=s.halfEdges.get(he.next),twin=out.halfEdges.get(he.twin);if(!next||!twin)throw Error('Open coplanar support boundary.');const oldA=he.origin,oldB=next.origin,newA=movedVertex.get(oldA)!,newB=movedVertex.get(oldB)!,fid=`f_${serial}_${fi++}`,lid=`l_${serial}_${li++}`,ids=[`he_${serial}_${hi++}`,`he_${serial}_${hi++}`,`he_${serial}_${hi++}`,`he_${serial}_${hi++}`];
      const a=s.vertices.get(oldA)!.position,b=s.vertices.get(oldB)!.position,be=out.vertices.get(newB)!.position;out.faces.set(fid,{id:fid,plane:planeFromPoints([a,b,be]),outerLoop:lid,innerLoops:[],provenance:{kind:'pushpull'}});out.loops.set(lid,{id:lid,kind:'outer',firstHalfEdge:ids[0]});createdFaces.push(fid);
      const origins=[oldA,oldB,newB,newA];for(let i=0;i<4;i++)out.halfEdges.set(ids[i],{id:ids[i],origin:origins[i],twin:'',next:ids[(i+1)%4],prev:ids[(i+3)%4],loop:lid,face:fid});
      const oldRim=out.halfEdges.get(ids[0])!,newRim=out.halfEdges.get(ids[2])!,sel=out.halfEdges.get(he.id)!;oldRim.twin=twin.id;twin.twin=oldRim.id;newRim.twin=sel.id;sel.twin=newRim.id;openVertical.push({id:ids[1],a:oldB,b:newB},{id:ids[3],a:newA,b:oldA});
    }
  }
  const pairs=new Map<string,{id:HalfEdgeId;a:VertexId;b:VertexId}[]>();for(const e of openVertical){const k=e.a<e.b?`${e.a}|${e.b}`:`${e.b}|${e.a}`;if(!pairs.has(k))pairs.set(k,[]);pairs.get(k)!.push(e);}for(const [k,list] of pairs){if(list.length!==2)throw Error('Incomplete side edge during support-face sweep: '+k);const a=out.halfEdges.get(list[0].id)!,b=out.halfEdges.get(list[1].id)!;a.twin=b.id;b.twin=a.id;}
  const localError=validateDirectOffsetFaces(out,touched);if(localError)throw Error(localError);const validation=validateSolid(out,false);if(!validation.ok)throw Error(validation.errors[0]||'The support-face sweep produced an invalid solid.');
  const vertices=new Map<VertexId,VertexId|null>();for(const id of s.vertices.keys())vertices.set(id,id);const faces=new Map<FaceId,FaceId|null>();for(const id of s.faces.keys())faces.set(id,id);return {solid:out,topology:{vertices,edges:new Map(),faces,createdFaces},targetAlive:true};
}

function findEmbeddedReceivingEvent(s:Solid,faceId:FaceId,requested:number):PlanarReceivingEvent|null {
  if(requested>=0||!faceIsEmbeddedCoplanarRegion(s,faceId))return null;const f=s.faces.get(faceId)!;if(f.innerLoops.length)return null;const loop=faceLoopPoints(s,faceId).outer,c=faceCentroid(s,faceId);let best:PlanarReceivingEvent|null=null;
  const samples=[...loop,...triangulateFaceLocal(s,faceId).map(triangleCentroid)];
  for(const other of s.faces.values()){
    if(other.id===faceId||V.dot(other.plane.normal,f.plane.normal)>-1+TOL.coplanarAngle*SWEEP_POLICY.parallelFaceAngleFactor)continue;const den=V.dot(other.plane.normal,f.plane.normal);if(Math.abs(den)<SWEEP_POLICY.receivingParallelEpsilon)continue;const t=(other.plane.offset-V.dot(other.plane.normal,c))/den;if(t>=-TOL.minimumEdge*SWEEP_POLICY.receivingNearFaceMinimumEdgeFactor||t<requested-receivingRequestMargin())continue;
    let inside=true;for(const p of samples){const q=V.add(p,V.mul(f.plane.normal,t));if(!pointInsideFaceDomain(s,other.id,q)){inside=false;break;}}if(!inside)continue;if(!best||Math.abs(t)<Math.abs(best.distance))best={distance:t,targetFaceId:other.id};
  }
  return best;
}
function findPlanarReceivingEvent(s:Solid,faceId:FaceId,requested:number):PlanarReceivingEvent|null {
  const best=findEmbeddedReceivingEvent(s,faceId,requested);
  if(best&&sweptEmbeddedRegionMayMeetShell(s,faceId,best.distance,new Set<FaceId>([best.targetFaceId])))return null;
  return best;
}
function directEmbeddedTerminalSweep(s:Solid,faceId:FaceId,event:PlanarReceivingEvent):FaceSweepCandidate {
  const face=s.faces.get(faceId),target=s.faces.get(event.targetFaceId);if(!face||!target||face.innerLoops.length)throw Error('Invalid terminal face sweep.');const out=cloneSolidFast(s),delta=V.mul(face.plane.normal,event.distance),serial=`term${topologySerial++}`;
  const boundary=loopHalfEdges(s,face.outerLoop);if(boundary.length<3)throw Error('The terminal contour is invalid.');const newVertex=new Map<VertexId,VertexId>();let vi=1,fi=1,li=1,hi=1;
  for(const he of boundary){const ov=s.vertices.get(he.origin)!;const id=`v_${serial}_${vi++}`;newVertex.set(he.origin,id);out.vertices.set(id,{id,position:V.add(ov.position,delta)});}
  // Remove the moving cap. Its original coplanar twins stay on the support
  // face and become the top rim of the tunnel.
  for(const lid of [face.outerLoop,...face.innerLoops]){for(const he of loopHalfEdges(s,lid))out.halfEdges.delete(he.id);out.loops.delete(lid);}out.faces.delete(faceId);
  // Add the translated contour as a real hole loop on the receiving shell.
  // Because the receiving normal is opposite the moving face normal, keeping
  // the selected outer-loop order gives the correct hole orientation.
  const holeId=`l_${serial}_target`,holeHE=boundary.map(()=>`he_${serial}_${hi++}`),targetOut=out.faces.get(target.id)!;out.loops.set(holeId,{id:holeId,kind:'hole',firstHalfEdge:holeHE[0]});targetOut.innerLoops=[...targetOut.innerLoops,holeId];
  for(let i=0;i<boundary.length;i++){const oldA=boundary[i].origin,newA=newVertex.get(oldA)!;out.halfEdges.set(holeHE[i],{id:holeHE[i],origin:newA,twin:'',next:holeHE[(i+1)%holeHE.length],prev:holeHE[(i+holeHE.length-1)%holeHE.length],loop:holeId,face:target.id});}
  const openVertical:{id:HalfEdgeId,a:VertexId,b:VertexId}[]=[],createdFaces:FaceId[]=[];
  for(let i=0;i<boundary.length;i++){
    const he=boundary[i],next=s.halfEdges.get(he.next)!,supportTwin=out.halfEdges.get(he.twin)!;const oldA=he.origin,oldB=next.origin,newA=newVertex.get(oldA)!,newB=newVertex.get(oldB)!,fid=`f_${serial}_${fi++}`,lid=`l_${serial}_${li++}`,ids=[`he_${serial}_${hi++}`,`he_${serial}_${hi++}`,`he_${serial}_${hi++}`,`he_${serial}_${hi++}`];
    const a=s.vertices.get(oldA)!.position,b=s.vertices.get(oldB)!.position,be=out.vertices.get(newB)!.position;out.faces.set(fid,{id:fid,plane:planeFromPoints([a,b,be]),outerLoop:lid,innerLoops:[],provenance:{kind:'pushpull'}});out.loops.set(lid,{id:lid,kind:'outer',firstHalfEdge:ids[0]});createdFaces.push(fid);
    const origins=[oldA,oldB,newB,newA];for(let k=0;k<4;k++)out.halfEdges.set(ids[k],{id:ids[k],origin:origins[k],twin:'',next:ids[(k+1)%4],prev:ids[(k+3)%4],loop:lid,face:fid});
    const topEdge=out.halfEdges.get(ids[0])!,bottomEdge=out.halfEdges.get(ids[2])!,targetHole=out.halfEdges.get(holeHE[i])!;topEdge.twin=supportTwin.id;supportTwin.twin=topEdge.id;bottomEdge.twin=targetHole.id;targetHole.twin=bottomEdge.id;openVertical.push({id:ids[1],a:oldB,b:newB},{id:ids[3],a:newA,b:oldA});
  }
  const pairs=new Map<string,{id:HalfEdgeId,a:VertexId,b:VertexId}[]>();for(const e of openVertical){const k=e.a<e.b?`${e.a}|${e.b}`:`${e.b}|${e.a}`;if(!pairs.has(k))pairs.set(k,[]);pairs.get(k)!.push(e);}for(const [k,list] of pairs){if(list.length!==2)throw Error('Incomplete terminal side edge: '+k);const a=out.halfEdges.get(list[0].id)!,b=out.halfEdges.get(list[1].id)!;a.twin=b.id;b.twin=a.id;}
  const vertices=new Map<VertexId,VertexId|null>();for(const id of s.vertices.keys())vertices.set(id,id);const faces=new Map<FaceId,FaceId|null>();for(const id of s.faces.keys())faces.set(id,id===faceId?null:id);return {solid:out,topology:{vertices,edges:new Map(),faces,createdFaces},targetAlive:false};
}
function regularizedEmbeddedReceivingEvent(s:Solid,faceId:FaceId,requested:number,event:PlanarReceivingEvent,requestedCandidate?:FaceSweepCandidate):SweepResolutionAttempt {
  const probeDistance=event.distance+Math.sign(event.distance)*sweepRegularizationDistance();
  const probe=tryFaceSweepCandidate(s,faceId,probeDistance);
  const candidate=probe.ok?probe.candidate:requestedCandidate;
  if(!candidate)return sweepResolutionFailure('Could not regularize the through-cut at the receiving face.','error' in probe?probe.error:undefined);
  return {ok:true,result:sweepTerminalResult(candidate,event.distance,requested)};
}
function makeFaceSweepTool(s:Solid,faceId:FaceId,distance:number):{polygons:CSGPolygon[];tris:Vec3[][]} {
  const face=s.faces.get(faceId);if(!face)throw Error('The face does not exist.');
  const tris=triangulateFaceLocal(s,faceId);if(!tris.length)throw Error('The face has no valid area.');
  const n=face.plane.normal,sign=distance>=0?1:-1,e=V.mul(n,sign),delta=V.mul(n,distance),polygons:CSGPolygon[]=[];
  // Build one watertight prism for the complete logical face domain. Caps are
  // triangulated (so concave faces and holes stay valid); loop edges create the
  // side shell. This replaces the old N-triangle/N-boolean path with one CSG
  // operation regardless of how many segments the selected face has.
  for(const tri0 of tris){
    const tri=regionOnNormal(tri0,e),end=tri.map(p=>V.add(p,delta));
    polygons.push(csgPolygon([...tri].reverse()));
    polygons.push(csgPolygon(end));
  }
  const loops=faceLoopPoints(s,faceId),all=[loops.outer,...loops.holes];
  for(const loop0 of all){
    const loop=sign>0?loop0:[...loop0].reverse();
    for(let i=0;i<loop.length;i++){const j=(i+1)%loop.length,a=loop[i],b=loop[j],ae=V.add(a,delta),be=V.add(b,delta);polygons.push(csgPolygon([a,b,be,ae]));}
  }
  return {polygons,tris};
}
function generalFaceSweepCandidate(s:Solid,faceId:FaceId,distance:number):FaceSweepCandidate {
  const face=s.faces.get(faceId);if(!face)throw Error('The face does not exist.');
  const tool=profiler.measure('geometry','Build sweep solid',()=>makeFaceSweepTool(s,faceId,distance),{faceId,distance}),n=face.plane.normal,base=profiler.measure('geometry','B-rep -> CSG',()=>solidToCsg(s,true),{faces:s.faces.size});
  // One semantic operation for every planar face: sweep the complete logical
  // face domain along its outward normal. The boolean result is regularized
  // back into B-rep. A moved face is allowed to disappear when it terminates
  // exactly on an existing shell; that is a topological event, not an error.
  const result=profiler.measure('geometry','CSG boolean',()=>distance>0?csgUnionOwned(base,tool.polygons):csgSubtractOwned(base,tool.polygons),{basePolygons:base.length,toolPolygons:tool.polygons.length,operation:distance>0?'union':'subtract'});
  const out=profiler.measure('geometry','CSG -> B-rep',()=>csgToSolid(result,s.id,{kind:'pushpull'},true),{polygons:result.length});
  const target:Plane={normal:[...n] as Vec3,offset:face.plane.offset+distance};
  const witnesses=tool.tris.map(t=>V.add(triangleCentroid(t),V.mul(n,distance)));
  const targetAlive=profiler.measure('geometry','Classify sweep result',()=>witnesses.some(p=>!!findCoplanarFaceContaining(out,target,p)),{witnesses:witnesses.length});
  return {solid:out,topology:topologyMapAllNew(s,out),targetAlive};
}
function tryGeneralFaceSweepCandidate(s:Solid,faceId:FaceId,distance:number):SweepCandidateAttempt {
  try{return {ok:true,candidate:generalFaceSweepCandidate(s,faceId,distance)};}catch(e){return sweepCandidateFailure(errorMessage(e));}
}
function faceSweepCandidate(s:Solid,faceId:FaceId,distance:number):FaceSweepCandidate {
  const face=s.faces.get(faceId);if(!face)throw Error('The face does not exist.');
  // A face region whose complete boundary is paired with coplanar support
  // faces can be swept by local B-rep reconstruction alone. This is a generic
  // topological fast path (not shape/provenance specific) and keeps dense
  // circles/contours interactive without invoking BSP.
  if(canUseDirectEmbeddedSweep(s,faceId,distance))return profiler.measure('geometry','Local B-rep sweep',()=>directEmbeddedFaceSweepCandidate(s,faceId,distance),{faceId,distance});
  const supportLoops=coplanarSupportSweepLoops(s,faceId);
  if(supportLoops)return profiler.measure('geometry','Local support-face sweep',()=>directCoplanarSupportFaceSweepCandidate(s,faceId,distance,supportLoops),{faceId,distance,coplanarLoops:supportLoops.coplanar.length});
  return generalFaceSweepCandidate(s,faceId,distance);
}
function tryFaceSweepCandidate(s:Solid,faceId:FaceId,distance:number):SweepCandidateAttempt {
  // CSG/B-rep construction still uses exceptions internally. Convert them once
  // at this adapter boundary; sweep orchestration itself uses explicit results.
  try{return {ok:true,candidate:faceSweepCandidate(s,faceId,distance)};}
  catch(error){return sweepCandidateFailure(error instanceof Error?error.message:'Sweep candidate construction failed.',error);}
}
function farthestEmbeddedShellDistance(s:Solid,faceId:FaceId,requested:number):number|null {
  if(requested>=0||!faceIsEmbeddedCoplanarRegion(s,faceId))return null;
  const face=s.faces.get(faceId);if(!face)return null;const sign=Math.sign(requested),eps=sweepShellTolerance();
  const lp=faceLoopPoints(s,faceId),samples:Vec3[]=[...lp.outer,...lp.holes.flat(),...triangulateFaceLocal(s,faceId).map(triangleCentroid)];let far:number|null=null;
  // For an embedded subtractive sweep, the real terminal distance is the last
  // shell crossing reached by any representative ray through the swept face.
  // Internal cavities may create earlier enter/exit crossings; those must not
  // clamp the operation. We only use this after the requested candidate has
  // already passed all remaining shell (faceSweepEndHasShellAhead == false).
  for(const p of samples)for(const other of s.faces.values()){
    if(other.id===faceId||planesCoplanarSame(face.plane,other.plane))continue;const den=V.dot(other.plane.normal,face.plane.normal);if(Math.abs(den)<SWEEP_POLICY.shellRayParallelEpsilon)continue;
    const t=(other.plane.offset-V.dot(other.plane.normal,p))/den;if(Math.sign(t)!==sign||Math.abs(t)<=eps||Math.abs(t)>Math.abs(requested)+eps)continue;
    const q=V.add(p,V.mul(face.plane.normal,t));if(!pointInsideFaceDomain(s,other.id,q))continue;if(far===null||Math.abs(t)>Math.abs(far))far=t;
  }
  return far;
}
function finalEmbeddedTerminalFromCandidate(s:Solid,faceId:FaceId,requested:number,c:FaceSweepCandidate):SolidEditResult|null {
  if(c.targetAlive||faceSweepEndHasShellAhead(s,faceId,requested))return null;
  const terminal=farthestEmbeddedShellDistance(s,faceId,requested);
  return terminal===null?null:sweepTerminalResult(c,terminal,requested);
}
function faceSweepEndHasShellAhead(s:Solid,faceId:FaceId,distance:number):boolean {
  const face=s.faces.get(faceId);if(!face||Math.abs(distance)<SWEEP_POLICY.zeroDistance)return false;
  const sign=Math.sign(distance),dir=V.mul(face.plane.normal,sign),delta=V.mul(face.plane.normal,distance),eps=sweepShellTolerance();
  // A disappearing moving cap is not necessarily a terminal event. When a cut
  // enters an existing void (or crosses an air gap in a non-convex solid), the
  // cap can vanish temporarily and reappear when the sweep reaches material
  // again. Probe the *original* shell ahead of representative points on the
  // moving face. Any forward shell hit means there is still topology for this
  // sweep to encounter, so the current cap disappearance must not clamp it.
  const lp=faceLoopPoints(s,faceId),witnesses:Vec3[]=[...lp.outer,...lp.holes.flat(),...triangulateFaceLocal(s,faceId).map(triangleCentroid)];
  for(const w0 of witnesses){
    const w=V.add(w0,delta);
    for(const other of s.faces.values()){
      const den=V.dot(other.plane.normal,dir);if(Math.abs(den)<SWEEP_POLICY.shellRayParallelEpsilon)continue;
      const t=(other.plane.offset-V.dot(other.plane.normal,w))/den;if(t<=eps)continue;
      const q=V.add(w,V.mul(dir,t));if(pointInsideFaceDomain(s,other.id,q))return true;
    }
  }
  return false;
}
function classifySweepCandidate(s:Solid,faceId:FaceId,distance:number,candidate:FaceSweepCandidate):SweepTerminalClass {
  if(candidate.targetAlive)return 'alive';
  return faceSweepEndHasShellAhead(s,faceId,distance)?'shell-ahead':'terminal';
}
function requestedSweepResult(candidate:FaceSweepCandidate,requested:number):SolidEditResult {
  return {solid:candidate.solid,distance:requested,limited:false,topology:candidate.topology};
}
function terminalSweepEventImpl(s:Solid,faceId:FaceId,requested:number,requestedCandidate:FaceSweepCandidate):SweepResolutionAttempt {
  // Find the first point at which the swept face no longer exists. Candidate
  // construction can fail inside the narrow numerical transition; the failure
  // is represented explicitly instead of using an exception as event control.
  let lo=0,hi=1;
  for(let i=0;i<SWEEP_POLICY.eventSearchIterations;i++){
    const m=(lo+hi)/2,d=requested*m,attempt=tryFaceSweepCandidate(s,faceId,d);
    if(attempt.ok&&classifySweepCandidate(s,faceId,d,attempt.candidate)!=='terminal')lo=m;
    else hi=m;
  }
  if(hi<SWEEP_POLICY.minimumEventFraction)return sweepResolutionFailure('The face cannot move in this direction without collapsing the solid.');
  const eventDistance=requested*hi;

  // Build the committed topology just on the far side of the event. Evaluating
  // at an almost-coplanar distance can itself create microscopic CSG edges, so
  // use a small regularization step. The user-visible distance stays exact.
  const regularize=sweepRegularizationDistance(),remaining=Math.abs(requested-eventDistance);
  let event=requestedCandidate;
  if(remaining>regularize){
    const d=eventDistance+Math.sign(requested)*regularize,attempt=tryFaceSweepCandidate(s,faceId,d);
    if(attempt.ok&&!attempt.candidate.targetAlive)event=attempt.candidate;
  }
  return {ok:true,result:sweepTerminalResult(event,eventDistance,requested)};
}
function terminalSweepEvent(s:Solid,faceId:FaceId,requested:number,requestedCandidate:FaceSweepCandidate):SweepResolutionAttempt {
  return profiler.measure('geometry','Find topological event',()=>terminalSweepEventImpl(s,faceId,requested,requestedCandidate),{faceId,requested});
}
function nearbyTerminalSweepEvent(s:Solid,faceId:FaceId,requested:number):SolidEditResult|null {
  // Topology events have a numerically narrow transition band where the
  // pre-event solid can contain a microscopic cap or even fail validation.
  // Probe just beyond the requested position and canonicalize a nearby terminal
  // event before falling back to a generic last-valid clamp.
  const eventSnap=sweepShellTolerance();
  for(const scale of SWEEP_POLICY.eventSnapScales){
    const probeDistance=requested+Math.sign(requested)*eventSnap*scale,attempt=tryFaceSweepCandidate(s,faceId,probeDistance);
    if(!attempt.ok||classifySweepCandidate(s,faceId,probeDistance,attempt.candidate)!=='terminal')continue;
    const eventAttempt=terminalSweepEvent(s,faceId,probeDistance,attempt.candidate);if(!eventAttempt.ok)continue;const event=eventAttempt.result;
    if(Math.abs(event.distance-requested)<=eventSnap*scale*SWEEP_POLICY.eventSnapAcceptanceFactor){
      const shifted=Math.abs(event.distance-requested)>TOL.coplanarDistance*SWEEP_POLICY.terminalShiftCoplanarFactor;
      return {...event,limited:shifted,reason:shifted?'face terminated at shell':undefined};
    }
  }
  return null;
}
function resolveTerminalSweepCandidate(s:Solid,faceId:FaceId,requested:number,candidate:FaceSweepCandidate):SweepResolutionAttempt {
  const finalEmbedded=finalEmbeddedTerminalFromCandidate(s,faceId,requested,candidate);
  if(finalEmbedded)return {ok:true,result:finalEmbedded};
  const receiving=findEmbeddedReceivingEvent(s,faceId,requested);
  if(receiving)return regularizedEmbeddedReceivingEvent(s,faceId,requested,receiving,candidate);
  return terminalSweepEvent(s,faceId,requested,candidate);
}
function clampInvalidSweepRequest(s:Solid,faceId:FaceId,requested:number):SweepResolutionAttempt {
  let lo=0,hi=1,best:FaceSweepCandidate|null=null;
  for(let i=0;i<SWEEP_POLICY.eventSearchIterations;i++){
    const m=(lo+hi)/2,attempt=tryFaceSweepCandidate(s,faceId,requested*m);
    if(attempt.ok){best=attempt.candidate;lo=m;}else hi=m;
  }
  if(lo<SWEEP_POLICY.minimumEventFraction||!best)return sweepResolutionFailure('The face cannot move in this direction without collapsing the solid.');

  // If the last valid candidate has already crossed a real terminal event,
  // prefer that canonical event to a microscopic last-valid sliver.
  if(classifySweepCandidate(s,faceId,requested*lo,best)==='terminal'){
    const event=terminalSweepEvent(s,faceId,requested,best);if(event.ok)return event;
  }
  return {ok:true,result:{solid:best.solid,distance:requested*lo,limited:true,reason:'geometric limit',topology:best.topology}};
}
function fastEmbeddedTerminalResult(s:Solid,faceId:FaceId,requested:number,event:PlanarReceivingEvent):SolidEditResult {
  return sweepTerminalResult(directEmbeddedTerminalSweep(s,faceId,event),event.distance,requested);
}
function resolveRequestedSweepCandidate(s:Solid,faceId:FaceId,requested:number,candidate:FaceSweepCandidate):SweepResolutionAttempt {
  const classification=classifySweepCandidate(s,faceId,requested,candidate);
  if(classification==='alive'){
    const snapped=nearbyTerminalSweepEvent(s,faceId,requested);
    return {ok:true,result:snapped??requestedSweepResult(candidate,requested)};
  }
  // A missing moving cap while there is shell ahead is a valid intermediate
  // state, for example while a subtractive sweep crosses an existing void.
  if(classification==='shell-ahead')return {ok:true,result:requestedSweepResult(candidate,requested)};
  return resolveTerminalSweepCandidate(s,faceId,requested,candidate);
}
function resolveInvalidSweepRequest(s:Solid,faceId:FaceId,requested:number):SweepResolutionAttempt {
  // The exact requested coordinate can sit inside the narrow numerical band
  // around a real topology event. Prefer that canonical event before using a
  // generic last-valid clamp.
  const snapped=nearbyTerminalSweepEvent(s,faceId,requested);
  return snapped?{ok:true,result:snapped}:clampInvalidSweepRequest(s,faceId,requested);
}
function sweepResolutionOrThrow(attempt:SweepResolutionAttempt):SolidEditResult {
  if(attempt.ok)return attempt.result;
  throw Error('reason' in attempt?attempt.reason:'Sweep resolution failed.');
}
function moveFaceImpl(s:Solid,faceId:FaceId,requested:number):SolidEditResult {
  if(Math.abs(requested)<SWEEP_POLICY.zeroDistance)return {solid:cloneSolid(s),distance:0,limited:false,topology:topologyIdentity(s)};

  const direct=tryDirectPlanarMove(s,faceId,requested);
  if(direct)return direct;

  const fastTerminal=findPlanarReceivingEvent(s,faceId,requested);
  if(fastTerminal)return fastEmbeddedTerminalResult(s,faceId,requested,fastTerminal);

  const requestedAttempt=tryFaceSweepCandidate(s,faceId,requested);
  if(!requestedAttempt.ok)return sweepResolutionOrThrow(resolveInvalidSweepRequest(s,faceId,requested));

  const resolved=resolveRequestedSweepCandidate(s,faceId,requested,requestedAttempt.candidate);
  if(resolved.ok)return resolved.result;
  return sweepResolutionOrThrow(resolveInvalidSweepRequest(s,faceId,requested));
}
function moveFace(s:Solid,faceId:FaceId,requested:number):SolidEditResult{return profiler.measure('geometry','Move face / sweep',()=>moveFaceImpl(s,faceId,requested),{faceId,requested});}
function prismRegion(outer:Vec2[],holes:Vec2[][],height:number,id?:string):Solid {
  if(!Number.isFinite(height)||height<=TOL.minimumEdge)throw Error('Extrusion height must be greater than 0.');
  let solid=primitivePrism(outer,height,id);
  const topFace=():FaceId=>{let best:FaceId|null=null,bestArea=-Infinity;for(const f of solid.faces.values()){if(f.plane.normal[2]<1-TOL.coplanarAngle||Math.abs(f.plane.offset-height)>TOL.coplanarDistance*8)continue;const area=faceAreaLocal(solid,f.id);if(area>bestArea){best=f.id;bestArea=area;}}if(!best)throw Error('Could not find the top face of the extrusion.');return best;};
  for(const holeInput of holes){const hole=normalizeLoop2(holeInput);if(hole.length<3)continue;const support=topFace(),region=hole.map(p=>[p[0],p[1],height] as Vec3),split=splitFaceWithRegion(solid,support,region,'Hole');solid=split.solid;const cut=moveFace(solid,split.regionFaceId,-height);solid=cut.solid;}
  validateSolid(solid);return solid;
}
function moveFacePreviewImpl(s:Solid,faceId:FaceId,requested:number):SolidEditResult {
  if(Math.abs(requested)<SWEEP_POLICY.zeroDistance)return {solid:cloneSolid(s),distance:0,limited:false,topology:topologyIdentity(s)};
  const direct=tryDirectPlanarMove(s,faceId,requested);
  if(direct)return direct;
  const fastTerminal=findPlanarReceivingEvent(s,faceId,requested);
  if(fastTerminal)return fastEmbeddedTerminalResult(s,faceId,requested,fastTerminal);

  // Interactive preview deliberately evaluates exactly one general CSG
  // candidate. Commit may regularize or bisect a difficult topology event; the
  // preview instead lets the tool keep its previous valid state when this one
  // candidate cannot be constructed.
  const candidate=faceSweepCandidate(s,faceId,requested),classification=classifySweepCandidate(s,faceId,requested,candidate);
  if(classification==='alive'||classification==='shell-ahead')return requestedSweepResult(candidate,requested);

  const finalEmbedded=finalEmbeddedTerminalFromCandidate(s,faceId,requested,candidate);
  if(finalEmbedded)return finalEmbedded;
  const receiving=findEmbeddedReceivingEvent(s,faceId,requested);
  if(receiving)return sweepResolutionOrThrow(regularizedEmbeddedReceivingEvent(s,faceId,requested,receiving,candidate));

  // Exact terminal preview is intentionally bounded: on large solids this
  // search can require dozens of full CSG -> B-rep rebuilds per pointer move.
  if(s.faces.size<=SWEEP_POLICY.previewExactEventMaxFaces&&s.halfEdges.size<=SWEEP_POLICY.previewExactEventMaxHalfEdges){
    return sweepResolutionOrThrow(terminalSweepEvent(s,faceId,requested,candidate));
  }
  throw Error('Topological event requires commit.');
}
function moveFacePreview(s:Solid,faceId:FaceId,requested:number):SolidEditResult{return profiler.measure('geometry','Move face preview candidate',()=>moveFacePreviewImpl(s,faceId,requested),{faceId,requested});}
