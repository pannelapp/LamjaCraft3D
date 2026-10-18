type MoveTargetMode='object'|'point';
let moveTargetMode:MoveTargetMode='object',movePointViewRevision=0;
const MOVE_POINT_INTERACTION_POLICY=Object.freeze({dragThresholdPx:4,previewDelayMs:75,axisRayParallelTolerance:1e-8});
interface MovePointPointer {
  type:'move-point';object:ModelObject;prepared:PreparedPointMove;revision:number;transform:Transform;
  originWorld:Vec3;targetWorld:Vec3;lastDelta:Vec3;startWorld:Vec3|null;axisStart:number|null;
  downX:number;downY:number;lastX:number;lastY:number;numericOnly:boolean;
  preview:GeometryPointMoveResult|null;previewTimer:number|null;numericDirection?:Vec3;numericAxis?:AxisName;rawMoveDelta?:Vec3;
}
function activeMovePointPointer():MovePointPointer|null{const p=pointer?.type==='orbit-camera'||pointer?.type==='pan-camera'?pointer.suspendedPointer:pointer;return p?.type==='move-point'?p as MovePointPointer:null;}
function movePointPointerCurrent(p:MovePointPointer):boolean{return tool==='move'&&moveTargetMode==='point'&&!modelingOperationBusy&&objects.includes(p.object)&&p.object.solid===p.prepared.source&&modelRevision===p.revision&&JSON.stringify(p.object.transform)===JSON.stringify(p.transform)&&isObjectVisible(p.object)&&!isObjectLocked(p.object)&&!groupForObjectId(p.object.id);}
function updateMoveToolUI(){
  $('moveTargetObject').checked=moveTargetMode==='object';$('moveTargetPoint').checked=moveTargetMode==='point';
  if(tool!=='move')return;
  const p=activeMovePointPointer();if(p&&!movePointPointerCurrent(p)){if(p.previewTimer!==null)clearTimeout(p.previewTimer);clearToolNumericEntry();snapIndicator=null;pointer=null;movePointViewRevision++;sceneKey='';$('movePointStatus').textContent='The model changed. Pick the point again.';requestRender();return;}
  $('movePointStatus').textContent=moveTargetMode==='object'?'Move the whole object or group.':!p?'Pick one highlighted model corner. Ungroup before editing a member.':p.preview&&!p.preview.ok?p.preview.message:p.preview?.ok?`${p.prepared.vertexId} · ${p.targetWorld.map(fmt).join(', ')} mm · ${p.preview.result.splitFaceIds.length} warped faces triangulated`:'Checking point position…';
}
function setMoveTargetMode(mode:MoveTargetMode){if(modelingOperationBusy){updateMoveToolUI();return;}if(mode!==moveTargetMode){cancelGesture();moveTargetMode=mode;clearHover();snapIndicator=null;movePointViewRevision++;sceneKey='';}updateUI();requestRender();}
function movePointAxis():Vec3|null{return axis==='x'?[1,0,0]:axis==='y'?[0,1,0]:axis==='z'?[0,0,1]:null;}
function movePointAxisParameter(x:number,y:number,p:MovePointPointer):number|null {
  const direction=movePointAxis();if(!direction)return null;
  const r=ray(x,y),w=V.sub(p.originWorld,r.origin),b=V.dot(direction,r.dir),denominator=1-b*b;
  return denominator>MOVE_POINT_INTERACTION_POLICY.axisRayParallelTolerance?(b*V.dot(r.dir,w)-V.dot(direction,w))/denominator:null;
}
function resumeMovePointPointer(x:number,y:number){const p=activeMovePointPointer();if(!p)return;cameraBasis();const world=intersectPlaneWorld(x,y,p.originWorld,[0,0,1]);p.startWorld=world?V.sub(world,p.lastDelta):null;const scalar=movePointAxisParameter(x,y,p),dir=movePointAxis();p.axisStart=scalar!==null&&dir?scalar-V.dot(p.lastDelta,dir):null;p.lastX=x;p.lastY=y;}
function beginMovePointPointer(o:ModelObject,vertexId:VertexId,x:number,y:number,numericOnly=false):boolean {
  if(!allowObjectEdit(o))return false;
  if(modelingOperationBusy||!isObjectVisible(o)||groupForObjectId(o.id)){toast('Ungroup the object before moving a point.');return false;}
  const prepared=geometryApi.preparePointMove(o.solid,vertexId);if(!prepared.ok){toast(prepared.message);return false;}
  setSelection({kind:'vertex',objectId:o.id,vertexId});const world=transformPoint(geometryApi.vertex(o.solid,vertexId),o.transform);
  const p:MovePointPointer={type:'move-point',object:o,prepared:prepared.prepared,revision:modelRevision,transform:structuredClone(o.transform),originWorld:[...world],targetWorld:[...world],lastDelta:[0,0,0],startWorld:null,axisStart:null,downX:x,downY:y,lastX:x,lastY:y,numericOnly,preview:null,previewTimer:null};
  pointer=p;resumeMovePointPointer(x,y);previewMovePointDelta([0,0,0]);updateUI();return true;
}
function queueMovePointDelta(delta:Vec3):boolean {
  const p=activeMovePointPointer();if(!p||!movePointPointerCurrent(p))return false;
  if(delta.every((value,i)=>value===p.lastDelta[i])&&(p.preview||p.previewTimer!==null))return true;
  if(p.previewTimer!==null)clearTimeout(p.previewTimer);
  p.lastDelta=[...delta];p.targetWorld=V.add(p.originWorld,delta);p.preview=null;movePointViewRevision++;sceneKey='';
  // Dense imported caps measured hundreds of milliseconds. Debounce full
  // validation until a short pointer pause; source geometry and ghost edges
  // remain read-only, and commit always checks the latest requested position.
  p.previewTimer=setTimeout(()=>{p.previewTimer=null;if(activeMovePointPointer()===p&&movePointPointerCurrent(p))previewMovePointDelta(p.lastDelta);},MOVE_POINT_INTERACTION_POLICY.previewDelayMs);
  updateMoveToolUI();requestRender();return true;
}
function previewMovePointDelta(delta:Vec3):boolean {
  const p=activeMovePointPointer();if(!p||!movePointPointerCurrent(p))return false;
  if(p.previewTimer!==null){clearTimeout(p.previewTimer);p.previewTimer=null;}
  p.lastDelta=[...delta];p.targetWorld=V.add(p.originWorld,delta);
  p.preview=geometryApi.movePoint(p.prepared,inverseTransformPoint(p.targetWorld,p.transform));movePointViewRevision++;sceneKey='';updateMoveToolUI();requestRender();return p.preview.ok;
}
function movePointTargetSnapAt(x:number,y:number,p:MovePointPointer):SnapResult|null {
  const edges=allWorldEdges().filter(e=>{const src=e.source;if(!src||!('objectId' in src)||src.objectId!==p.object.id||src.kind!=='edge')return true;const edge=geometryApi.edge(p.prepared.source,src.halfEdgeId);return edge.originVertexId!==p.prepared.vertexId&&edge.destVertexId!==p.prepared.vertexId;});
  const centers=allWorldCenters().filter(c=>!c.source||!('objectId' in c.source)||c.source.objectId!==p.object.id);
  return moveFeatureSnapAt(x,y,edges,centers);
}
function updateMovePointPointer(x:number,y:number):boolean {
  const p=activeMovePointPointer();if(!p)return false;if(!movePointPointerCurrent(p)){updateMoveToolUI();return true;}p.lastX=x;p.lastY=y;
  if(numericEntry?.tool==='move')return true;p.numericDirection=undefined;
  if(axis==='free'){
    const snap=movePointTargetSnapAt(x,y,p);snapIndicator=snap;
    if(snap){queueMovePointDelta(V.sub(snap.world,p.originWorld));return true;}
    const world=intersectPlaneWorld(x,y,p.originWorld,[0,0,1]);if(world&&p.startWorld)queueMovePointDelta(moveGridDelta(V.sub(world,p.startWorld)));
  }else{snapIndicator=null;const scalar=movePointAxisParameter(x,y,p),dir=movePointAxis();if(scalar!==null&&p.axisStart!==null&&dir)queueMovePointDelta(moveGridDelta(V.mul(dir,scalar-p.axisStart)));}
  return true;
}
function movePointDirection():Vec3|null{const p=activeMovePointPointer();return p?moveGestureDirection(V.len(p.lastDelta)>TOL.minimumEdge?p.lastDelta:p.rawMoveDelta||p.lastDelta):null;}
function seedMovePointDirection():boolean{const p=activeMovePointPointer(),dir=movePointDirection();if(!p||!dir)return false;p.numericDirection=[...dir];p.numericAxis=axis;return true;}
function previewMovePointDistance(distance:number):boolean{
  const p=activeMovePointPointer();if(!p||!Number.isFinite(distance))return false;
  if(!p.numericDirection||p.numericAxis!==axis)if(!seedMovePointDirection())return false;
  return previewMovePointDelta(V.mul(p.numericDirection!,distance));
}
function commitMovePointPointer():boolean {
  const p=activeMovePointPointer();if(!p)return false;
  if(!movePointPointerCurrent(p)){updateMoveToolUI();toast('The model changed. Pick the point again.');return false;}
  if(!p.preview)previewMovePointDelta(p.lastDelta);
  if(!p.preview?.ok){toast(p.preview&&!p.preview.ok?p.preview.message:'Choose a valid point position first.');return false;}
  const result=p.preview.result;pointer=null;movePointViewRevision++;sceneKey='';snapIndicator=null;
  try{applyPreparedPointMove(p.object.id,p.prepared.source,result);}catch(error){toast(errorMessage(error));}updateUI();requestRender();return true;
}
function movePointPreviewSolidFor(o:ModelObject):Solid|null{const p=activeMovePointPointer();return p&&p.object===o&&movePointPointerCurrent(p)&&p.preview?.ok?p.preview.result.solid:null;}
function movePointDisplayColor(objectId:ObjectId,faceId:FaceId):number[]|null{const p=activeMovePointPointer();return p&&p.object.id===objectId&&movePointPointerCurrent(p)&&p.preview?.ok&&(p.preview.result.affectedFaceIds.includes(faceId)||p.preview.result.topology.createdFaces.includes(faceId))?[.22,.64,.46]:null;}
function drawMovePointPreview(){const p=activeMovePointPointer();if(!p||!movePointPointerCurrent(p))return;if(!p.preview)for(const e of geometryApi.edges(p.prepared.source)){const edge=geometryApi.edge(p.prepared.source,e.halfEdgeId);if(edge.originVertexId!==p.prepared.vertexId&&edge.destVertexId!==p.prepared.vertexId)continue;const a=edge.originVertexId===p.prepared.vertexId?p.targetWorld:transformPoint(edge.a,p.transform),b=edge.destVertexId===p.prepared.vertexId?p.targetWorld:transformPoint(edge.b,p.transform);path3([a,b],'#75848c',true,1.5);}path3([p.originWorld,p.targetWorld],p.preview?.ok?'#177568':!p.preview?'#75848c':'#a33',true,1.8);drawSnapMarker(p.targetWorld,'Corner',p.preview?.ok?'Move point':!p.preview?'Checking point position':'Invalid point position');}
function movePointPointerDown(x:number,y:number,hit:HitResult|null):boolean {
  if(activeMovePointPointer()){if(numericEntry?.tool==='move')return true;updateMovePointPointer(x,y);commitMovePointPointer();return true;}
  const ref=topologyVertexAt(x,y,hit);if(!ref){toast('Click a highlighted corner to move one point.');return true;}
  const o=objects.find(o=>o.id===ref.objectId);if(o)beginMovePointPointer(o,ref.vertexId,x,y);return true;
}
function movePointPointerUp(x:number,y:number):boolean {const p=activeMovePointPointer();if(!p)return false;if(numericEntry?.tool==='move')return true;if(x!==p.lastX||y!==p.lastY)updateMovePointPointer(x,y);if(!p.numericOnly&&Math.hypot(p.lastX-p.downX,p.lastY-p.downY)<MOVE_POINT_INTERACTION_POLICY.dragThresholdPx)return true;commitMovePointPointer();return true;}
function seedMovePointNumeric():boolean {
  if(activeMovePointPointer())return seedMovePointDirection();const ref=modelDocument.selection;if(ref?.kind!=='vertex'||axis==='free')return false;
  const o=objects.find(o=>o.id===ref.objectId);return !!o&&beginMovePointPointer(o,ref.vertexId,0,0,true)&&seedMovePointDirection();
}
function updateMovePointHover(x:number,y:number){const hit=hitTest(x,y),ref=topologyVertexAt(x,y,hit);debugPickHit=hit;snapIndicator=null;debugPreviewSolid=null;
  if(ref){setHoverEntity(ref,hit);$('coordinates').textContent='Point · '+transformPoint(geometryApi.vertex(objects.find(o=>o.id===ref.objectId)!.solid,ref.vertexId),objects.find(o=>o.id===ref.objectId)!.transform).map(fmt).join(', ')+' mm · click to move';}else{clearHover();$('coordinates').textContent='Point · hover a visible model corner';}requestRender();}
function cancelMovePoint(){const p=activeMovePointPointer();if(p){if(p.previewTimer!==null)clearTimeout(p.previewTimer);pointer=null;movePointViewRevision++;sceneKey='';snapIndicator=null;updateMoveToolUI();requestRender();}}
