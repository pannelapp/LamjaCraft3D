// Direct face Push/Pull controller and snapping.

function endpointSnapPriority(kind:SnapKind):number{return kind==='Corner'?4:kind==='Intersection'?3:kind==='Center'?2:kind==='Midpoint'?1:0;}
interface PushSnapExclusion {accepts:(world:Vec3,kind:SnapKind,source?:SnapSource)=>boolean;acceptsEdge:(edge:SnapEdge)=>boolean;}
const pushSnapExclusionCache=new WeakMap<SnapEdge[],{centers:SnapPointCandidate[];exclusion:PushSnapExclusion}>();
function pushSnapExclusion(object:ModelObject,faceId:FaceId):PushSnapExclusion{
  const edges=faceSnapEdges(object,faceId),centers=faceSnapCenters(object,faceId),cached=edges.length?pushSnapExclusionCache.get(edges):undefined;
  if(cached?.centers===centers)return cached.exclusion;
  const boundary=geometryApi.faceTopologyEdges(object.solid,faceId),edgeIds=new Set(boundary.flatMap(edge=>[edge.id,edge.twinId]));
  const points=boundary.flatMap(edge=>[edge.a,edge.b,V.mul(V.add(edge.a,edge.b),.5)]).map(point=>transformPoint(point,object.transform));
  points.push(...centers.map(center=>center.point));
  const containsPoint=snapPointMembership(points,TOL.snapGeometry);
  const accepts=(world:Vec3,_kind:SnapKind,source?:SnapSource)=>!source||!('objectId' in source)||source.objectId!==object.id||!containsPoint(world);
  const acceptsEdge=(edge:SnapEdge)=>edge.source?.kind!=='edge'||edge.source.objectId!==object.id||!edgeIds.has(edge.source.halfEdgeId);
  const exclusion={accepts,acceptsEdge};if(edges.length)pushSnapExclusionCache.set(edges,{centers,exclusion});return exclusion;
}
function pushFeatureSnapAt(x:number,y:number):SnapResult|null{
  if(pointer?.type!=='push'||(!geometrySnapEnabled()&&!guideSnapEnabled()))return null;
  const exclusion=pushSnapExclusion(pointer.object,pointer.face),edges=allWorldEdges(),points=allWorldCenters();if(!edges.length&&!points.length&&!guides.length){debugSnapCandidates=[];return null;}
  const rawWorld=pointer.pushOriginWorld||(edges.find(exclusion.acceptsEdge)?.a)||([0,0,0] as Vec3),visible=createSnapVisibilityCheck();
  const result=bestSnapCandidate({x,y,rawWorld,edges,points,guides,project,spatial:snapSpatialQuery(edges,points),acceptEdge:exclusion.acceptsEdge,radiusPx:SNAP_RADIUS_PX,geometryEnabled:geometrySnapEnabled(),guideEnabled:guideSnapEnabled(),inferenceEnabled:false,acceptCandidate:(world,kind,source)=>exclusion.accepts(world,kind,source)&&visible(world,kind,source)});
  debugSnapCandidates=result.candidates;
  const features=result.candidates.filter(c=>(c.kind==='Corner'||c.kind==='Center'||c.kind==='Midpoint'||c.kind==='Intersection')&&c.distance<=SNAP_RADIUS_PX).sort((a,b)=>{
    if(Math.abs(a.distance-b.distance)>1e-6)return a.distance-b.distance;
    return endpointSnapPriority(b.kind)-endpointSnapPriority(a.kind);
  });
  return features[0]||null;
}
function pushSnapDistance(snap:SnapResult):number|null{
  if(pointer?.type!=='push'||!pointer.pushOriginWorld||!pointer.pushNormalWorld)return null;
  return clean(V.dot(V.sub(snap.world,pointer.pushOriginWorld),pointer.pushNormalWorld),1e6);
}
function pushTwistAngleValue():number {
  const angle=Number($('pushTwistAngle').value);
  if(!Number.isFinite(angle)||Math.abs(angle)>geometryApi.maximumTwistAngleDeg)throw Error('Twist angle must be between -360° and 360°.');
  return angle;
}
function commitTwistedFaceFromUI(object:ModelObject,faceId:FaceId,distance:number,angleDeg:number){
  if(!allowObjectEdit(object))return;
  if(modelingOperationBusy)return;
  const source=object.solid,objectId=object.id;
  if(groupForObjectId(objectId)){toast('Ungroup the object before twisted Push/Pull.');return;}
  pointer=null;debugPreviewSolid=null;clearToolNumericEntry();
  let cancelled=false;
  const job=geometryApi.twistFaceAsync(source,faceId,distance,angleDeg,update=>updateModelingOperation(update.progress,update.message));
  beginModelingOperation('Preparing twisted Push/Pull…',{progress:0,onCancel:()=>{cancelled=true;job.cancel();}});
  void job.promise.then(result=>{if(cancelled)return;applyPreparedTwistedFaceMove(objectId,source,faceId,distance,angleDeg,result);toast(`Push/Pull · ${fmt(distance)} mm · twist ${fmt(angleDeg)}°`);})
    .catch(error=>{if(!cancelled)toast(errorMessage(error));})
    .finally(()=>{endModelingOperation();requestRender();});
}
function previewPushDistance(distance:number):boolean{
  if(pointer?.type!=='push')return false;pointer.requestedDistance=clean(distance,1e6);
  let angle:number,taper:number,taperMode:TaperMode;
  try{angle=pushTwistAngleValue();taper=pushTaperAngleValue();taperMode=pushTaperModeValue();}catch(error){pointer.valid=false;pointer.twistPreview=null;pointer.taperPreview=null;pointer.previewResult=null;pointer.previewError=errorMessage(error);debugPreviewSolid=null;toast(errorMessage(error));requestRender();return false;}
  pointer.twistAngleDeg=angle;pointer.taperAngleDeg=taper;pointer.taperMode=taperMode;
  if(taper!==0){
    pointer.twistPreview=null;pointer.previewResult=null;debugPreviewSolid=null;pointer.distance=pointer.requestedDistance;
    try{pointer.taperPreview=Math.abs(pointer.requestedDistance)<TOL.minimumEdge?null:geometryApi.previewTaperFace(pointer.object.solid,pointer.face,pointer.requestedDistance,taper,angle,taperMode);pointer.valid=true;pointer.previewError=null;}
    catch(error){pointer.taperPreview=null;pointer.valid=false;pointer.previewError=errorMessage(error);}
    requestRender();return pointer.valid;
  }
  pointer.taperPreview=null;
  if(angle!==0){
    pointer.previewResult=null;debugPreviewSolid=null;pointer.distance=pointer.requestedDistance;
    try{
      pointer.twistPreview=Math.abs(pointer.requestedDistance)<TOL.minimumEdge?null:geometryApi.previewTwistFace(pointer.object.solid,pointer.face,pointer.requestedDistance,angle);
      pointer.valid=true;pointer.previewError=null;
    }catch(error){pointer.twistPreview=null;pointer.valid=false;pointer.previewError=errorMessage(error);}
    requestRender();return pointer.valid;
  }
  pointer.twistPreview=null;
  try{const r=pushOrMoveFace(pointer.object,pointer.face,pointer.requestedDistance,true);pointer.valid=true;pointer.distance=r.distance;pointer.previewResult=r;debugPreviewSolid=r.solid;}
  catch{
    // Keep the last valid visual candidate, but never rewrite the user's current
    // requested distance. Crossing a topology event may temporarily make live
    // preview unavailable; commit must still evaluate the actual pointer/numeric
    // distance instead of silently committing the last drawable preview.
    if(pointer.previewResult){pointer.valid=true;debugPreviewSolid=pointer.previewResult.solid;}else{pointer.valid=false;debugPreviewSolid=null;}
  }
  requestRender();return pointer.valid;
}
function seedPushNumericDirection():boolean{
  if(pointer?.type!=='push')return false;
  const distance=pointer.requestedDistance??pointer.distance??0;
  pointer.numericDirectionSign=distance < -TOL.minimumEdge?-1:1;return true;
}
function previewPushNumericDistance(distance:number):boolean{
  if(pointer?.type!=='push'||!Number.isFinite(distance))return false;
  if(pointer.numericDirectionSign===undefined)seedPushNumericDirection();
  return previewPushDistance(distance*pointer.numericDirectionSign);
}
function commitPushPointer():boolean{
  if(pointer?.type!=='push')return false;const p=pointer;pointer=null;debugPreviewSolid=null;
  if(!p.valid){toast('Invalid position. The preview stopped before commit.');requestRender();return true;}
  try{
    const angle=pushTwistAngleValue(),taper=pushTaperAngleValue();
    if(taper!==0){commitTaperedFaceFromUI(p.object,p.face,p.requestedDistance??p.distance,taper);return true;}
    if(angle!==0){commitTwistedFaceFromUI(p.object,p.face,p.requestedDistance??p.distance,angle);return true;}
    const requested=p.requestedDistance??p.distance,previewMatches=!!p.previewResult&&Math.abs((p.previewResult.distance??p.distance)-requested)<=Math.max(TOL.coplanarDistance*8,Math.abs(requested)*1e-9);
    previewMatches?commitFaceMoveResult(p.object,p.face,p.previewResult,requested):applyFaceMove(p.object,p.face,requested);
  }catch(err){toast(errorMessage(err));}return true;
}
function resumePushPointer(x:number,y:number):void{
  if(pointer?.type!=='push'||pointer.numericOnly)return;
  snapIndicator=null;pointer.targetSnapWorld=null;pointer.targetSnapKind=null;debugSnapCandidates=[];
  cameraBasis();const scale=screenNormalScale(pointer.object,pointer.face),distance=pointer.requestedDistance??pointer.distance??0;
  Object.assign(pointer,scale,{startX:x-distance*scale.ux*scale.pxPerMm,startY:y-distance*scale.uy*scale.pxPerMm});
}
const pushToolController:ToolController={
  name:'push',parameters:TOOL_PARAMETERS.push,
  pointerDown({x,y,hit}){
    // Push/pull supports both press-drag-release and click-move-click. Once a
    // face owns an active push gesture, the placement click belongs to that
    // gesture even when the cursor is currently over a different face. Do not
    // let the hit under the placement click replace the active pointer before
    // it has been committed.
    if(pointer?.type==='push'){
      const d=pointer.requestedDistance??pointer.distance??0;
      if(Math.abs(d)>=TOL.minimumEdge||pointer.previewResult){clearToolNumericEntry();return commitPushPointer();}
      pointer=null;debugPreviewSolid=null;clearToolNumericEntry();
    }
    if(!hit)return true;const o=objects.find(o=>o.id===hit.id)!;if(!allowObjectEdit(o))return true;setSelectedFace(o,hit.face,hit.point);const sc=screenNormalScale(o,hit.face),wp=faceWorldPlane(o,hit.face);pointer={type:'push',object:o,face:hit.face,startX:x,startY:y,...sc,distance:0,valid:true,pushOriginWorld:wp?.point||hit.point,pushNormalWorld:wp?V.unit(wp.normal):null};return true;
  },
  pointerMove({x,y}){if(pointer?.type!=='push')return false;if(numericEntry?.tool==='push')return true;pointer.numericDirectionSign=undefined;let d=((x-pointer.startX)*pointer.ux+(y-pointer.startY)*pointer.uy)/pointer.pxPerMm;const feature=pushFeatureSnapAt(x,y),sd=feature?pushSnapDistance(feature):null;if(feature&&sd!==null){d=sd;snapIndicator=feature;pointer.targetSnapWorld=[...feature.world] as Vec3;pointer.targetSnapKind=feature.kind;}else{snapIndicator=null;pointer.targetSnapWorld=null;pointer.targetSnapKind=null;if($('snap')?.checked)d=Math.round(d/Number($('snapStep').value||1))*Number($('snapStep').value||1);}previewPushDistance(d);return true;},
  pointerUp(){if(pointer?.type!=='push')return false;if(numericEntry?.tool==='push')return true;if(Math.abs(pointer.requestedDistance??pointer.distance??0)<TOL.minimumEdge)return true;return commitPushPointer();},
  numericSeed(){if(pointer?.type==='push')return seedPushNumericDirection();const sf=selectedFaceRef(),o=current();if(!o||!sf||sf.objectId!==o.id||!geometryApi.hasFace(o.solid,sf.faceId)||!allowObjectEdit(o))return false;const sc=screenNormalScale(o,sf.faceId),wp=faceWorldPlane(o,sf.faceId);pointer={type:'push',object:o,face:sf.faceId,startX:0,startY:0,...sc,distance:0,valid:true,numericOnly:true,pushOriginWorld:wp?.point||transformPoint(geometryApi.faceCentroid(o.solid,sf.faceId),o.transform),pushNormalWorld:wp?V.unit(wp.normal):null};return seedPushNumericDirection();},
  numericPreview(values){return previewPushNumericDistance(values.distance);},
  numericCommit(values){if(!previewPushNumericDistance(values.distance)){toast('This distance produces invalid geometry.');return false;}return commitPushPointer();},
  cancel(){if(pointer?.type==='push')pointer=null;}
};
