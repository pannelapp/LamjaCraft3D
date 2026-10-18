// Construction-guide and passive measurement controllers.

function guidePointerPoint(x:number,y:number):{world:Vec3;kind:SnapKind|null}|null{
  if(pointer?.type!=='guide-line')return null;
  if(pointer.support==='face'){
    const o=objects.find(v=>v.id===pointer.objectId);if(!o||!geometryApi.hasFace(o.solid,pointer.faceId))return null;
    // A guide that starts from a discrete feature (corner/midpoint) is a true
    // two-point guide. Keep the starting face as its support plane, but allow
    // the second point to snap to matching geometry on any coplanar object.
    if(pointer.pointAnchor){
      const plane=faceWorldPlane(o,pointer.faceId);if(!plane)return null;const raw=intersectPlaneWorld(x,y,pointer.startWorld,plane.normal);if(!raw)return null;
      const snap=bestWorldEdgeSnap(x,y,raw,allWorldEdges(),plane,[],false);if(snap){snapIndicator=snap;return {world:[...snap.world] as Vec3,kind:snap.kind};}
      snapIndicator=null;return {world:raw,kind:null};
    }
    const q=onFacePoint(x,y,o,pointer.faceId,true);return q?{world:q.world,kind:snapIndicator?.kind||null}:null;
  }
  const p=snappedGroundPoint(x,y);return p?{world:p,kind:snapIndicator?.kind||null}:null;
}
function fallbackGuidePlaneNormal(direction:Vec3):Vec3{const d=V.unit(direction),axes:Vec3[]=[[0,0,1],[0,1,0],[1,0,0]];for(const a of axes){const n=V.cross(d,a);if(V.len(n)>1e-7)return V.unit(n);}return [0,0,1];}
const GUIDE_OFFSET_SNAP_POLICY={perpendicularDotTolerance:1e-4} as const;
function guideOffsetFrame(point:Vec3,direction0:Vec3,normal0:Vec3){const direction=V.unit(direction0),normal=V.unit(normal0);if(V.len(direction)<1e-9||V.len(normal)<1e-9||Math.abs(V.dot(direction,normal))>1e-5)throw Error('Could not determine a valid offset plane.');const offsetDir=V.unit(V.cross(normal,direction));if(V.len(offsetDir)<1e-9)throw Error('Could not determine the offset direction.');return {point:[...point] as Vec3,direction,planeNormal:normal,offsetDir};}
function startGuideOffset(point:Vec3,direction:Vec3,planeNormal:Vec3,source?:EntityRef,support?:{objectId:ObjectId;faceId:FaceId}){const f=guideOffsetFrame(point,direction,planeNormal);pointer={type:'guide-offset',sourcePoint:f.point,sourceDirection:f.direction,planeNormal:f.planeNormal,offsetDir:f.offsetDir,previewPoint:f.point,distance:0,sideSign:1,source,supportObjectId:support?.objectId,supportFaceId:support?.faceId};snapIndicator=null;requestRender();}
function guideOffsetMidpointSnapAt(x:number,y:number,rawWorld:Vec3):SnapResult|null{
  if(pointer?.type!=='guide-offset'||!pointer.supportObjectId||!pointer.supportFaceId||!geometrySnapEnabled())return null;
  const o=objects.find(v=>v.id===pointer.supportObjectId);if(!o||!geometryApi.hasFace(o.solid,pointer.supportFaceId))return null;
  const plane=faceWorldPlane(o,pointer.supportFaceId);if(!plane)return null;
  const edges=faceSnapEdges(o,pointer.supportFaceId),result=bestSnapCandidate({x,y,rawWorld,edges,guides:[],plane,project,spatial:snapSpatialQuery(edges),radiusPx:SNAP_RADIUS_PX,geometryEnabled:true,guideEnabled:false,inferenceEnabled:false,acceptCandidate:createSnapVisibilityCheck()});debugSnapCandidates=result.candidates;
  let best:SnapResult|null=null;
  for(const c of result.candidates){
    if(c.kind!=='Midpoint'||c.distance>SNAP_RADIUS_PX)continue;const src=c.source;if(!src||!('objectId' in src)||src.kind!=='edge'||src.objectId!==o.id)continue;
    const e=geometryApi.edge(o.solid,src.halfEdgeId),a=transformPoint(e.a,o.transform),b=transformPoint(e.b,o.transform),d=V.unit(V.sub(b,a));
    if(Math.abs(V.dot(d,pointer.sourceDirection))>GUIDE_OFFSET_SNAP_POLICY.perpendicularDotTolerance)continue;
    if(!best||c.distance<best.distance)best=c;
  }
  return best;
}
function guideOffsetDistanceAt(x:number,y:number):number|null{if(pointer?.type!=='guide-offset')return null;const p=intersectPlaneWorld(x,y,pointer.sourcePoint,pointer.planeNormal);if(!p)return null;const midpoint=guideOffsetMidpointSnapAt(x,y,p);if(midpoint){snapIndicator=midpoint;return clean(V.dot(V.sub(midpoint.world,pointer.sourcePoint),pointer.offsetDir),1e6);}snapIndicator=null;let d=V.dot(V.sub(p,pointer.sourcePoint),pointer.offsetDir);if($('snap')?.checked)d=Math.round(d/Number($('snapStep').value||1))*Number($('snapStep').value||1);return clean(d,1e6);}
function previewGuideOffsetDistance(distance:number,rememberSide=false):boolean{if(pointer?.type!=='guide-offset'||!Number.isFinite(distance))return false;pointer.distance=clean(distance,1e6);if(rememberSide&&Math.abs(pointer.distance)>=TOL.minimumEdge)pointer.sideSign=pointer.distance<0?-1:1;pointer.previewPoint=V.add(pointer.sourcePoint,V.mul(pointer.offsetDir,pointer.distance));requestRender();return true;}
function previewGuideOffsetNumeric(distance:number):boolean{if(pointer?.type!=='guide-offset')return false;const actual=distance<0?distance:Math.abs(distance)*(pointer.sideSign||1);return previewGuideOffsetDistance(actual,false);}
function commitGuideOffset():boolean{if(pointer?.type!=='guide-offset')return false;const p=pointer;if(Math.abs(p.distance)<TOL.minimumEdge){toast('Offset must be greater than 0 mm.');return false;}pointer=null;try{addGuideLineFromPointDirection(p.previewPoint,p.sourceDirection,p.planeNormal,'Offset guide line');snapIndicator=null;toast(`Guide line created · ${fmt(p.distance)} mm offset.`);}catch(e){toast(errorMessage(e));}requestRender();return true;}
const guideToolController:ToolController={
  name:'guide',sketchHover:true,parameters:TOOL_PARAMETERS.guide,
  pointerDown({x,y,hit}){
    if(pointer?.type==='guide-offset'){const d=guideOffsetDistanceAt(x,y);if(d!==null)previewGuideOffsetDistance(d,true);return commitGuideOffset();}
    if(pointer?.type==='guide-line'){
      const q=guidePointerPoint(x,y);if(!q)return true;if(V.len(V.sub(q.world,pointer.startWorld))<TOL.minimumEdge){toast('Choose a different point for the direction.');return true;}
      try{addGuideLine(pointer.startWorld,q.world,'Guide line',pointer.planeNormal);pointer=null;snapIndicator=null;toast('Guide line created.');}catch(e){toast(errorMessage(e));}requestRender();return true;
    }
    const guideId=hitTestGuide(x,y),sourceGuide=guideId?guides.find(g=>g.id===guideId):null;
    if(sourceGuide?.kind==='line'){
      const normal=sourceGuide.planeNormal||fallbackGuidePlaneNormal(sourceGuide.direction);try{startGuideOffset(sourceGuide.point,sourceGuide.direction,normal,{kind:'guide',guideId:sourceGuide.id});}catch(e){toast(errorMessage(e));}return true;
    }
    // Corners and edge midpoints are explicit point anchors. They take
    // precedence over edge-offset picking, so a click close to an edge end or
    // midpoint starts a two-point guide instead of a parallel offset guide.
    if(hit&&(snapIndicator?.kind==='Corner'||snapIndicator?.kind==='Midpoint')){
      const o=objects.find(v=>v.id===hit.id)!,q=onFacePoint(x,y,o,hit.face,true),wp=faceWorldPlane(o,hit.face);if(!q||!wp)return true;const startKind=snapIndicator?.kind||null;pointer={type:'guide-line',support:'face',objectId:o.id,faceId:hit.face,startWorld:q.world,previewWorld:q.world,startSnapKind:startKind,planeNormal:wp.normal,pointAnchor:true};requestRender();return true;
    }
    const edgeRef=topologyEdgeAt(x,y,hit,10);
    if(edgeRef?.kind==='edge'){
      const o=objects.find(v=>v.id===edgeRef.objectId),wp=hit&&o?faceWorldPlane(o,hit.face):null;if(o&&wp&&hit){const e=geometryApi.edge(o.solid,edgeRef.halfEdgeId),a=transformPoint(e.a,o.transform),b=transformPoint(e.b,o.transform);try{startGuideOffset(a,V.sub(b,a),wp.normal,edgeRef,{objectId:o.id,faceId:hit.face});}catch(err){toast(errorMessage(err));}return true;}
    }
    if(hit){const o=objects.find(o=>o.id===hit.id)!,q=onFacePoint(x,y,o,hit.face,true),wp=faceWorldPlane(o,hit.face);if(!q||!wp)return true;pointer={type:'guide-line',support:'face',objectId:o.id,faceId:hit.face,startWorld:q.world,previewWorld:q.world,startSnapKind:snapIndicator?.kind||null,planeNormal:wp.normal,pointAnchor:false};}
    else{const p=snappedGroundPoint(x,y);if(!p)return true;pointer={type:'guide-line',support:'ground',startWorld:p,previewWorld:p,startSnapKind:snapIndicator?.kind||null,planeNormal:[0,0,1]};}
    requestRender();return true;
  },
  pointerMove({x,y}){if(pointer?.type==='guide-offset'){const d=guideOffsetDistanceAt(x,y);if(d!==null)previewGuideOffsetDistance(d,true);return true;}if(pointer?.type!=='guide-line')return false;const q=guidePointerPoint(x,y);if(q){pointer.previewWorld=q.world;requestRender();}return true;},
  numericSeed(){return pointer?.type==='guide-offset';},
  numericPreview(values){return previewGuideOffsetNumeric(values.distance);},
  numericCommit(values){if(!previewGuideOffsetNumeric(values.distance))return false;return commitGuideOffset();},
  cancel(){if(pointer?.type==='guide-line'||pointer?.type==='guide-offset')pointer=null;}
};

function anchorFromSnapPoint(world:Vec3,snap:SnapResult|null):GeometryAnchor{
  const src=snap?.source;if(src&&'objectId' in src&&src.kind==='edge'){
    const o=objects.find(v=>v.id===src.objectId);if(o&&geometryApi.hasHalfEdge(o.solid,src.halfEdgeId)){const e=geometryApi.edge(o.solid,src.halfEdgeId),aw=transformPoint(e.a,o.transform),bw=transformPoint(e.b,o.transform);if(snap?.kind==='Corner'){const vertexId=V.len(V.sub(world,aw))<=V.len(V.sub(world,bw))?e.originVertexId:e.destVertexId;return {kind:'vertex',objectId:o.id,vertexId,fallback:[...world] as Vec3};}const ab=V.sub(bw,aw),l2=V.dot(ab,ab),t=l2>1e-12?clamp(V.dot(V.sub(world,aw),ab)/l2,0,1):0;return {kind:'edge',objectId:o.id,vertexA:e.originVertexId,vertexB:e.destVertexId,t,fallback:[...world] as Vec3};}}
  return {kind:'world',point:[...world] as Vec3};
}
function measurePoint(x:number,y:number,hit:HitResult|null):{world:Vec3;anchor:GeometryAnchor}|null{if(hit){const o=objects.find(v=>v.id===hit.id);if(!o)return null;const q=onFacePoint(x,y,o,hit.face,true);if(!q)return null;return {world:q.world,anchor:anchorFromSnapPoint(q.world,snapIndicator)};}const p=snappedGroundPoint(x,y);if(!p)return null;return {world:p,anchor:anchorFromSnapPoint(p,snapIndicator)};}

function guideCircleDiameterValue():number{const value=Number(($('guideCircleDiameter') as HTMLInputElement|null)?.value||20);return Number.isFinite(value)?Math.max(TOL.minimumEdge*2,value):20;}
function previewGuideCircleRadius(radius:number):boolean{if(pointer?.type!=='guide-circle'||!Number.isFinite(radius)||radius<TOL.minimumEdge)return false;pointer.radius=clean(radius,1e6);if($('guideCircleDiameter'))$('guideCircleDiameter').value=String(clean(pointer.radius*2,1e6));requestRender();return true;}
function guideCirclePointerPoint(x:number,y:number):SnapResult|null{if(pointer?.type!=='guide-circle')return null;const plane:SnapPlane={point:pointer.centerWorld,normal:pointer.normal},raw=intersectPlaneWorld(x,y,pointer.centerWorld,pointer.normal);if(!raw)return null;const edges=allWorldEdges(),points=allWorldCenters(),result=bestSnapCandidate({x,y,rawWorld:raw,edges,points,guides,plane,project,spatial:snapSpatialQuery(edges,points),radiusPx:SNAP_RADIUS_PX,geometryEnabled:geometrySnapEnabled(),guideEnabled:guideSnapEnabled(),inferenceEnabled:false,acceptCandidate:createSnapVisibilityCheck()});debugSnapCandidates=result.candidates;return result.best||{point:[0,0],world:raw,kind:'On line',distance:Infinity};}
function commitGuideCircle():boolean{if(pointer?.type!=='guide-circle')return false;const p=pointer;if(p.radius<TOL.minimumEdge){toast('Guide circle radius must be greater than 0 mm.');return true;}pointer=null;snapIndicator=null;try{addGuideCircle(p.centerWorld,p.normal,p.radius,'Guide circle');toast(`Guide circle created · Ø ${fmt(p.radius*2)} mm.`);}catch(e){toast(errorMessage(e));}requestRender();return true;}
function refreshActiveGuideCircleDiameter():boolean{if(pointer?.type!=='guide-circle')return false;return previewGuideCircleRadius(guideCircleDiameterValue()/2);}
const guideCircleToolController:ToolController={
  name:'guidecircle',sketchHover:true,parameters:TOOL_PARAMETERS.guidecircle,
  pointerDown({x,y,hit}){
    if(pointer?.type==='guide-circle')return commitGuideCircle();
    if(hit){const o=objects.find(v=>v.id===hit.id),q=o?onFacePoint(x,y,o,hit.face,true):null,wp=o?faceWorldPlane(o,hit.face):null;if(!q||!wp)return true;pointer={type:'guide-circle',centerWorld:q.world,normal:V.unit(wp.normal),radius:guideCircleDiameterValue()/2,startSnapKind:snapIndicator?.kind||null};}
    else{const center=snappedGroundPoint(x,y);if(!center)return true;pointer={type:'guide-circle',centerWorld:center,normal:[0,0,1],radius:guideCircleDiameterValue()/2,startSnapKind:snapIndicator?.kind||null};}
    requestRender();return true;
  },
  pointerMove({x,y}){if(pointer?.type!=='guide-circle')return false;const q=guideCirclePointerPoint(x,y);if(!q)return true;const radius=V.len(V.sub(q.world,pointer.centerWorld));if(radius>=TOL.minimumEdge){previewGuideCircleRadius(radius);snapIndicator=q.distance<=SNAP_RADIUS_PX?q:null;$('coordinates').textContent=`Guide circle · Ø ${fmt(radius*2)} mm`;}return true;},
  numericSeed(){return pointer?.type==='guide-circle';},
  numericPreview(values){return previewGuideCircleRadius(values.radius);},
  numericCommit(values){if(!previewGuideCircleRadius(values.radius))return false;return commitGuideCircle();},
  cancel(){if(pointer?.type==='guide-circle')pointer=null;}
};

const measureToolController:ToolController={
  name:'measure',sketchHover:true,parameters:TOOL_PARAMETERS.none,
  pointerDown({x,y,hit}){const picked=measurePoint(x,y,hit);if(!picked)return true;if(measure.length>=1&&measureAnchors.length>=1){if(V.len(V.sub(picked.world,measure[0]))<TOL.minimumEdge){toast('Choose a different endpoint for the dimension.');return true;}measure.push(picked.world);measureAnchors.push(picked.anchor);try{addLinearDimension(measureAnchors[0],measureAnchors[1]);toast('Dimension created.');}catch(e){toast(errorMessage(e));}measure=[];measureAnchors=[];measurePreview=null;requestRender();return true;}measure=[picked.world];measureAnchors=[picked.anchor];measurePreview=picked.world;requestRender();return true;},
  pointerMove({x,y,hit}){if(measure.length!==1)return false;const picked=measurePoint(x,y,hit);if(picked){measurePreview=picked.world;requestRender();}return true;},
  cancelStep(){if(!measure.length)return false;measure=[];measureAnchors=[];measurePreview=null;requestRender();return true;},
  cancel(){measure=[];measureAnchors=[];measurePreview=null;requestRender();}
};
