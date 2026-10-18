// Tool registry and shared pointer/key dispatch. Gesture-specific behavior lives
// across the responsibility-focused 06_tool_* controller files; numeric/camera input helpers live in 06_tool_input.ts.

const toolControllers:Record<ToolName,ToolController>={
  sketcheditor:sketchEditorToolController,
  shapes:primitiveToolController,
  select:selectToolController,
  rect:rectangleToolController,
  circle:circleToolController,
  gear:gearToolController,
  rack:rackToolController,
  slot:slotToolController,
  arcslot:arcSlotToolController,
  boltcircle:boltCircleToolController,
  arc:arcToolController,
  poly:contourToolController,
  push:pushToolController,
  move:moveToolController,
  rotate:rotateToolController,
  mirror:mirrorToolController,
  guide:guideToolController,
  guidecircle:guideCircleToolController,
  splitplane:splitPlaneToolController,
  measure:measureToolController,
  delete:deleteToolController,
  chamfer:chamferToolController,
  roundchamfer:roundedChamferToolController,
  thread:threadToolController,
  texture:surfaceTextureToolController,
  text:faceTextToolController,
  mergefaces:mergeFacesToolController,
  carve:carveOutToolController,
  orbit:orbitToolController,
};

function activeToolController():ToolController{return isGroundExtrusionPointer(pointer)?groundExtrusionToolController:toolControllers[tool];}
function activeToolParameters():readonly ToolParameterSpec[]{return activeToolController().parameters;}
const GROUP_GEOMETRY_EDIT_TOOLS=new Set<ToolName>(['sketcheditor','rect','circle','gear','rack','slot','arcslot','boltcircle','arc','poly','push','chamfer','roundchamfer','thread','texture','text','mergefaces','carve']);

function toolPointerInput(event:any,x:number,y:number,rawHit:HitResult|null,controller:ToolController):ToolPointerInput{
  const hit=controller.sketchHover&&!pointer?sketchHoverHit(x,y,rawHit):rawHit;
  return {event,x,y,rawHit,hit};
}


function chamferChainPreviewKey(kind:'chamfer'|'roundchamfer',objectId:ObjectId,halfEdgeIds:readonly HalfEdgeId[],...parameters:(number|string)[]):string{
  // The selected member of a logical side/rim must not invalidate an otherwise
  // identical preview. Circular rims can contain dozens of pickable segments.
  const chain=[...halfEdgeIds].sort();
  return [modelRevision,kind,objectId,chain.join(','),...parameters,chamferOperationValue()].join(':');
}

function updateToolHoverFeedback(controller:ToolController,x:number,y:number){
  if(controller.name==='sketcheditor'&&updateSketchEditorPlacement(x,y))return;
  let picked=false,cachedHit:HitResult|null=null;
  const hoverPick=():HitResult|null=>{if(!picked){cachedHit=hitTest(x,y);picked=true;}return cachedHit;};
  if(controller.name==='shapes'){updatePrimitivePlacement(x,y);return;}
  if(controller.name==='mirror'){
    const hit=hoverPick();debugPickHit=hit;debugPreviewSolid=null;snapIndicator=null;
    if(hit){setHoverEntity({kind:'face',objectId:hit.id,faceId:hit.face},hit);$('coordinates').textContent=mirrorPlaneMode==='face'?'Click to choose this face as the mirror plane':'Click to select a mirror target';}else clearHover();
    requestRender();return;
  }
  // Clear a hover-only Text outline before shared lock/group rejection can
  // return early. A frozen placement belongs to its explicit source instead.
  if(controller.name==='text'&&!textTarget){textHoverTarget=null;textPreviewState=null;}
  if(showObjectLockHover(controller,x,y,hoverPick))return;
  if((GROUP_GEOMETRY_EDIT_TOOLS.has(controller.name)||controller.name==='move'&&moveTargetMode==='point')){const gh=hoverPick(),gg=gh?groupForObjectId(gh.id):null;if(gg){debugPickHit=gh;debugPreviewSolid=null;snapIndicator=null;chamferHover=null;roundedChamferHover=null;threadHover=null;setHoverEntity({kind:'group',groupId:gg.id},gh);$('coordinates').textContent=`${gg.name} · grouped · ungroup to edit geometry`;requestRender();return;}}
  if(controller.name==='delete'){updateDeleteToolHover(x,y);return;}
  if(controller.name==='splitplane'){
    debugPreviewSolid=null;snapIndicator=null;const active=activeSplitPlane();
    if(splitPlaneCreateNext||!active){
      if(splitPlaneCreationMode==='two-point'){
        const picked=splitPlanePickPoint(x,y);if(picked){if(picked.hit){const o=objects.find(v=>v.id===picked.hit!.id);if(o)setHoverEntity({kind:'face',objectId:o.id,faceId:picked.hit.face},picked.hit);}else clearHover();$('coordinates').textContent=`Point 1 · ${picked.kind?picked.kind+' · ':''}${picked.world.map(fmt).join(', ')} mm`;}else clearHover();requestRender();return;
      }
      const h=hoverPick();debugPickHit=h;if(h){const o=objects.find(v=>v.id===h.id)!;setHoverEntity({kind:'face',objectId:o.id,faceId:h.face},h);$('coordinates').textContent=`${faceLabel(o,h.face)} · click to create split plane from this face`;}else{clearHover();const p=ground(x,y,false);if(p)$('coordinates').textContent=`Ground · click to create XY split plane at X ${fmt(p[0])}, Y ${fmt(p[1])}`;}requestRender();return;
    }
    const handle=splitPlaneGizmoHit(x,y,active);if(handle){debugPickHit=null;setHoverEntity({kind:'guide',guideId:active.id});$('coordinates').textContent=handle==='move'?'Drag green handle · move plane along the selected axis':'Drag orange handle · tilt / rotate plane around the selected axis';requestRender();return;}
    const gid=hitTestGuide(x,y),plane=guidePlaneById(gid);if(plane){debugPickHit=null;setHoverEntity({kind:'guide',guideId:plane.id});$('coordinates').textContent=`${plane.label||'Split plane'} · click to select`;requestRender();return;}
    const h=hoverPick();debugPickHit=h;if(h){const o=objects.find(v=>v.id===h.id)!,g=groupForObjectId(o.id);if(g){setHoverEntity({kind:'group',groupId:g.id},h);$('coordinates').textContent=`${g.name} · grouped · ungroup before splitting`;}else{setHoverEntity({kind:'object',objectId:o.id},h);$('coordinates').textContent=`${o.name} · click to split with ${active.label||active.id}`;}}else clearHover();requestRender();return;
  }
  if(controller.name==='mergefaces'){
    debugPreviewSolid=null;snapIndicator=null;const h=hoverPick();debugPickHit=h;
    if(h){setHoverEntity({kind:'face',objectId:h.id,faceId:h.face},h);$('coordinates').textContent=mergeFacesPreviewVisible?'Result preview · click to return to selection':'Merge Faces · click to add / remove face';}else clearHover();requestRender();return;
  }
  if(controller.name==='text'){updateFaceTextHover(x,y,hoverPick());return;}
  if(controller.name==='texture'){
    debugPreviewSolid=null;
    if(textureReferencePickMode){const h=hoverPick();debugPickHit=h;const point=textureReferencePickPoint(x,y,h);if(h){const o=objects.find(v=>v.id===h.id);if(o)setHoverEntity({kind:'face',objectId:o.id,faceId:h.face},h);}else clearHover();if(point)$('coordinates').textContent=`Texture origin · ${snapIndicator?.kind?snapIndicator.kind+' · ':''}${point.map(fmt).join(', ')} mm`;requestRender();return;}
    snapIndicator=null;const h=hoverPick();debugPickHit=h;if(h){const o=objects.find(v=>v.id===h.id)!;const g=groupForObjectId(o.id);if(g){setHoverEntity({kind:'group',groupId:g.id},h);$('coordinates').textContent=`${g.name} · grouped · ungroup before texturing`;}else{setHoverEntity({kind:'face',objectId:o.id,faceId:h.face},h);$('coordinates').textContent=`${faceLabel(o,h.face)} · click to add / remove texture face`;}}else clearHover();requestRender();return;
  }
  if(controller.name==='carve'){
    debugPreviewSolid=null;snapIndicator=null;const h=hoverPick();debugPickHit=h;if(h){const o=objects.find(v=>v.id===h.id)!;const g=groupForObjectId(o.id);if(g){setHoverEntity({kind:'group',groupId:g.id},h);$('coordinates').textContent=`${g.name} · grouped · ungroup before Carve Out`;}else{setHoverEntity({kind:'face',objectId:o.id,faceId:h.face},h);$('coordinates').textContent=`${faceLabel(o,h.face)} · click to use as Carve Out opening`;}}else clearHover();requestRender();return;
  }
  if(controller.name==='chamfer'){
    const previous=chamferHover,h=hoverPick();debugPickHit=h;debugPreviewSolid=null;snapIndicator=null;const edge=h?topologyEdgeAt(x,y,h):null;
    if(chamferEdgeSelection){chamferHover=null;setHoverEntity(edge,h);$('coordinates').textContent=chamferSelectionStatus();requestRender();return;}
    if(edge?.kind==='edge'){const o=objects.find(v=>v.id===edge.objectId);if(o){let edgeId=edge.halfEdgeId;try{const ev=geometryApi.edge(o.solid,edgeId);if(h&&ev.faceA!==h.face&&ev.faceB===h.face)edgeId=ev.twinId;}catch{}const distance=chamferDistanceValue(),angle=chamferAngleValue(),ids=geometryApi.chamferCandidateEdges(o.solid,edgeId,chamferOperationValue()),previewKey=chamferChainPreviewKey('chamfer',o.id,ids,distance,angle),sourceSolid=o.solid;let previewResult:GeometryDissolveResult|null=null,previewSolid:Solid|null=null,error:string|null=null;
      if(previous?.previewKey===previewKey&&previous.sourceSolid===sourceSolid){previewResult=previous.previewResult;previewSolid=previous.previewSolid;error=previous.error;}else try{previewResult=geometryApi.chamferEdge(sourceSolid,edgeId,distance,angle,chamferOperationValue());previewSolid=previewResult.solid;}catch(err){error=errorMessage(err);}
      chamferHover={objectId:o.id,halfEdgeId:edgeId,halfEdgeIds:ids,sourceSolid,previewResult,previewSolid,previewKey,error};setHoverEntity(edge,h);const side=h?faceLabel(o,h.face):'edge';$('coordinates').textContent=error?`Chamfer preview unavailable · ${error}`:`Preview · ${chamferOperationValue()} · ${fmt(distance)} mm · ${fmt(angle)}° · from ${side}`;requestRender();return;}}
    chamferHover=null;clearHover();requestRender();return;
  }
  if(controller.name==='roundchamfer'){
    const h=hoverPick();debugPickHit=h;debugPreviewSolid=null;snapIndicator=null;const edge=h?topologyEdgeAt(x,y,h):null;
    if(chamferEdgeSelection){roundedChamferHover=null;setHoverEntity(edge,h);$('coordinates').textContent=chamferSelectionStatus();requestRender();return;}
    if(edge?.kind==='edge'){const o=objects.find(v=>v.id===edge.objectId);if(o){let edgeId=edge.halfEdgeId;try{const ev=geometryApi.edge(o.solid,edgeId);if(h&&ev.faceA!==h.face&&ev.faceB===h.face)edgeId=ev.twinId;}catch{}const radius=roundedChamferRadiusValue(),angle=roundedChamferAngleValue(),other=radius*Math.tan(angle*Math.PI/180),segments=roundedChamferSegmentsValue(),ids=geometryApi.chamferCandidateEdges(o.solid,edgeId,chamferOperationValue()),previewKey=chamferChainPreviewKey('roundchamfer',o.id,ids,radius,angle,segments);
      roundedChamferHover={objectId:o.id,halfEdgeId:edgeId,halfEdgeIds:ids,previewSolid:null,previewKey,error:null};setHoverEntity(edge,h);const side=h?faceLabel(o,h.face):'edge';$('coordinates').textContent=`${chamferOperationValue()==='extend'?'Rounded Extension':'Rounded Chamfer'} · ${fmt(radius)} / ${fmt(other)} mm · ${fmt(angle)}° · ${segments} segments · from ${side} · click to apply`;requestRender();return;}}
    roundedChamferHover=null;clearHover();requestRender();return;
  }
  if(controller.name==='thread'){
    const h=hoverPick();debugPickHit=h;debugPreviewSolid=null;snapIndicator=null;const edge=h?topologyEdgeAt(x,y,h):null;
    if(edge?.kind==='edge'){const o=objects.find(v=>v.id===edge.objectId);if(o){const info=geometryApi.threadRim(o.solid,edge.halfEdgeId);if(info){threadHover={objectId:o.id,halfEdgeId:info.halfEdgeId,halfEdgeIds:info.halfEdgeIds,kind:info.kind,radius:info.radius,maxLength:info.maxLength};syncThreadPresetForKind(info.kind);setHoverEntity(edge,h);const operation=threadOperationValue(),aligned=` · ${info.rimSegments} rim-aligned segments/turn`,depth=` · depth ${fmt(threadDepthValue(info.kind))} mm`;$('coordinates').textContent=`${operation==='add'?'Add':'Cut'} thread · ${info.kind==='internal'?'hole':'cylinder'} · Ø${fmt(info.radius*2)} mm${depth}${aligned} · max ${fmt(info.maxLength)} mm · click to apply`;requestRender();return;}}}
    threadHover=null;clearHover();requestRender();return;
  }
  if(controller.name==='move'){
    if(moveTargetMode==='point'){updateMovePointHover(x,y);return;}
    const h=hoverPick();debugPickHit=h;debugPreviewSolid=null;setHoverFaceHit(h);
    snapIndicator=null;
    if(h){const o=objects.find(o=>o.id===h.id)!;const snap=moveFeatureSnapAt(x,y,moveObjectWorldEdges(o));if(snap){snapIndicator=snap;$('coordinates').textContent=`${snap.kind} · ${snap.world.map(fmt).join(', ')} mm`;}else $('coordinates').textContent=`${faceLabel(o,h.face)} · ${h.point.map(fmt).join(', ')} mm`;}
    else{const p=ground(x,y,false);if(p)$('coordinates').textContent=`X ${fmt(p[0])} · Y ${fmt(p[1])} mm`;}
    requestRender();return;
  }
  if(controller.name==='select'){
    if(objectSelectionMode()==='object-group'){
      const did=hitTestDimension(x,y);if(did){debugPickHit=null;debugPreviewSolid=null;setHoverEntity({kind:'dimension',dimensionId:did});const d=dimensions.find(v=>v.id===did);$('coordinates').textContent=d?`Dimension ${fmt(dimensionValue(d))} mm`:'Dimension';requestRender();return;}
      const gid=hitTestGuide(x,y);if(gid){debugPickHit=null;debugPreviewSolid=null;setHoverEntity({kind:'guide',guideId:gid});$('coordinates').textContent='Construction geometry · '+gid;requestRender();return;}
    }
    const h=hoverPick();debugPickHit=h;debugPreviewSolid=null;const ref=objectSelectionEntityAt(h);setHoverEntity(ref,h,false);
    if(ref?.kind==='object')$('coordinates').textContent=requireObject(ref.objectId).name;
    else if(ref?.kind==='group')$('coordinates').textContent=groupById(ref.groupId)?.name||'Group';
    else{const p=ground(x,y,false);if(p)$('coordinates').textContent=`X ${fmt(p[0])} · Y ${fmt(p[1])} mm`;}
    snapIndicator=null;requestRender();return;
  }
  let h=hoverPick();debugPickHit=h;debugPreviewSolid=null;
  if(controller.sketchHover)h=sketchHoverHit(x,y,h);
  setHoverFaceHit(h);
  if(controller.sketchHover){
    if(h){const o=objects.find(o=>o.id===h.id)!;const q=onFacePoint(x,y,o,h.face,true);if(q){$('coordinates').textContent=`${faceLabel(o,h.face)} · ${q.world.map(fmt).join(', ')} mm`;if(controller.name==='measure'&&measure.length===1)measurePreview=q.world;}else snapIndicator=null;}
    else if(controller.name!=='arc'){const p=snappedGroundPoint(x,y);if(p){$('coordinates').textContent=`X ${fmt(p[0])} · Y ${fmt(p[1])} mm`;if(controller.name==='measure'&&measure.length===1)measurePreview=p;}}
  }else{
    snapIndicator=null;
    if(h){const o=objects.find(o=>o.id===h.id)!;$('coordinates').textContent=`${faceLabel(o,h.face)} · ${h.point.map(fmt).join(', ')} mm`;}
    else{const p=ground(x,y,false);if(p)$('coordinates').textContent=`X ${fmt(p[0])} · Y ${fmt(p[1])} mm`;}
  }
  requestRender();
}

function dispatchToolPointerDown(event:any){
  const [x,y]=eventXY(event);debugPointerXY=[x,y];cameraBasis();scene.setPointerCapture?.(event.pointerId);
  const controller=activeToolController();
  if(beginCameraPointer(event,x,y,controller))return;
  if(event.button!==0)return;
  if(pointer?.type==='ground-extrude'){commitGroundExtrusionPointer();return;}
  if(pointer?.type==='ground-extrude-pattern'){commitGroundPatternExtrusionPointer();return;}
  const rawHit=hitTest(x,y);debugPickHit=rawHit;
  if(rawHit&&(GROUP_GEOMETRY_EDIT_TOOLS.has(controller.name)||controller.name==='move'&&moveTargetMode==='point')&&!(controller.name==='texture'&&textureReferencePickMode)){const g=groupForObjectId(rawHit.id);if(g){setGroupSelection(g);toast(`“${g.name}” is grouped. Ungroup it before editing faces or features.`);return;}}
  if(!pointer&&rawHit&&lockProtectedTool(controller)){
    const object=requireObject(rawHit.id);
    if(object.kind==='surface'&&controller.name!=='move'&&controller.name!=='rotate'&&controller.name!=='delete'){
      selectObject(object);toast('Open surface: solid editing is disabled. Move, rotate, duplicate, recolor or save this object.');return;
    }
    if(!allowObjectEdit(object,controller.name==='move'||controller.name==='rotate'))return;
  }
  controller.pointerDown?.(toolPointerInput(event,x,y,rawHit,controller));
}

function dispatchToolPointerMove(event:any){
  const [x,y]=eventXY(event);debugPointerXY=[x,y];debugSnapCandidates=[];cameraBasis();$('coordinates').textContent='';
  if(pointer?.type==='orbit-camera'){camera.yaw=pointer.yaw-(x-pointer.x)*.008;camera.pitch=clamp(pointer.pitch+(y-pointer.y)*.008,-Math.PI/2+.02,Math.PI/2-.02);requestRender();return;}
  if(pointer?.type==='pan-camera'){const scale=camera.distance/H*1.5;camera.target=V.add(pointer.target,V.add(V.mul(basis.right,-(x-pointer.x)*scale),V.mul(basis.up,(y-pointer.y)*scale)));requestRender();return;}
  const controller=activeToolController();
  if(pointer?.type==='ground-extrude'){updateGroundExtrusionPointer(x,y);return;}
  if(pointer?.type==='ground-extrude-pattern'){updateGroundPatternExtrusionPointer(x,y);return;}
  // Active gestures already own their support face/object and should not pay for a BVH hit test on every frame.
  if(pointer&&controller.pointerMove?.({event,x,y,rawHit:null,hit:null}))return;
  updateToolHoverFeedback(controller,x,y);
}

function dispatchToolPointerUp(event:any){
  const [x,y]=eventXY(event);debugPointerXY=[x,y];debugPreviewSolid=null;
  if(pointer?.type==='orbit-camera'||pointer?.type==='pan-camera'){resumeAfterCameraPointer(x,y);return;}
  const controller=activeToolController();
  controller.pointerUp?.({event,x,y,rawHit:null,hit:null});
}

function dispatchToolKeyDown(event:any):boolean{return !!activeToolController().keyDown?.(event);}
function dispatchToolKeyUp(event:KeyboardEvent):void{activeToolController().keyUp?.(event);}

function cancelGesture(){
  clearToolNumericEntry();
  if(pointer?.type==='orbit-camera'||pointer?.type==='pan-camera')pointer=pointer.suspendedPointer||null;
  activeToolController().cancel?.();
  pointer=null;snapIndicator=null;transientSolid=null;debugPreviewSolid=null;requestRender();
}

// Escape cancels the innermost transient step. Choosing another toolbar tool
// instead performs a complete cancellation; there is no saved tool stack.
function handleToolEscape():void {
  if(numericEntry){clearToolNumericEntry();requestRender();return;}
  if(pointer?.type==='orbit-camera'||pointer?.type==='pan-camera'){resumeAfterCameraPointer(...(debugPointerXY||[W/2,H/2]));return;}
  if(isGroundExtrusionPointer(pointer)){const returnTool=pointer.returnTool as ToolName||tool;cancelGesture();setTool(returnTool);return;}
  if(activeToolController().cancelStep?.())return;
  if(pointer){cancelGesture();updateUI();return;}
  setTool('select');
}
function prepareToolForDocumentChange():void {
  const pending=pointer?.suspendedPointer||pointer,retained=isGroundExtrusionPointer(pending)?pending.returnTool as ToolName||tool:tool;
  cancelGesture();activateTool(retained);
}

function lockProtectedTool(controller:ToolController):boolean{return (GROUP_GEOMETRY_EDIT_TOOLS.has(controller.name)||controller.name==='move'||controller.name==='rotate')&&!(controller.name==='texture'&&textureReferencePickMode);}
function showObjectLockHover(controller:ToolController,x:number,y:number,pick:()=>HitResult|null=()=>hitTest(x,y)):boolean{
  if(!lockProtectedTool(controller)||!objects.some(isObjectLocked))return false;
  const hit=pick(),object=hit?objects.find(o=>o.id===hit.id):null;if(!object)return false;
  const group=controller.name==='move'||controller.name==='rotate'?groupForObjectId(object.id):null,locked=lockedObjectsIn(group?group.objectIds:[object.id]);if(!locked.length)return false;
  debugPickHit=hit;debugPreviewSolid=null;snapIndicator=null;chamferHover=null;roundedChamferHover=null;threadHover=null;
  setHoverEntity(group?{kind:'group',groupId:group.id}:{kind:'object',objectId:object.id},hit);$('coordinates').textContent=objectLockMessage(locked[0]);requestRender();return true;
}
