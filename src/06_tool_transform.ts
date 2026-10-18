// Move and Rotate apply one rigid transform to the complete captured selection.

const MOVE_INTERACTION_POLICY=Object.freeze({dragThresholdPx:4});
function allowTransformObjects(ids:readonly ObjectId[]):boolean{
  if(modelingOperationBusy)return false;
  try{for(const id of ids)requireObject(id);assertObjectsEditable(ids);return true;}catch(error){toast(errorMessage(error));return false;}
}
function prepareObjectTransformSelection(o:ModelObject):{starts:ObjectTransformState[];groupId:GroupId|null}|null{
  const alreadySelected=isObjectSelected(o.id),group=groupForObjectId(o.id),ids=alreadySelected?selectedObjectIds():group?[...group.objectIds]:[o.id];
  if(!allowTransformObjects(ids))return null;
  if(!alreadySelected)selectObject(o,false);
  const activeGroup=selectedGroup(),pureGroup=activeGroup&&ids.length===activeGroup.objectIds.length&&activeGroup.objectIds.every(id=>ids.includes(id));
  return {starts:snapshotObjectTransforms(ids),groupId:pureGroup?activeGroup.id:null};
}
function transformSelectionAnchor():ModelObject|null{const primary=current();return primary&&isObjectSelected(primary.id)?primary:selectedObjectIds().map(requireObject).find(isObjectVisible)||null;}
function capturedTransformStates(p:{object:ModelObject;position:Vec3;rotation:Vec3;objectTransforms?:ObjectTransformState[]|null}):ObjectTransformState[]{return p.objectTransforms||[{id:p.object.id,position:[...p.position],rotation:[...p.rotation]}];}
function restoreCapturedTransforms(starts:readonly ObjectTransformState[]):void{for(const start of starts){const o=objects.find(object=>object.id===start.id);if(o){o.transform={position:[...start.position],rotation:[...start.rotation]};sceneGeometry.invalidateObject(o.id);}}}
function commitCapturedTransforms(starts:readonly ObjectTransformState[],groupId:GroupId|null,kind:'move'|'rotate'):void{
  // Restore before the command snapshot; Undo must never record a preview.
  const final=starts.map(start=>{const o=requireObject(start.id);return {id:start.id,position:[...o.transform.position] as Vec3,rotation:[...o.transform.rotation] as Vec3};});
  restoreCapturedTransforms(starts);
  if(modelingOperationBusy)throw Error('Wait for the modeling operation before transforming objects.');
  if(groupId)setGroupTransforms(groupId,final,kind==='move'?'move-group':'rotate-group');
  else if(final.length===1)setObjectTransform(requireObject(final[0].id),final[0],kind==='move'?'move-object':'rotate-object');
  else setObjectsTransforms(final,kind==='move'?'move-objects':'rotate-objects');
}

function moveObjectWorldEdges(o:ModelObject):SnapEdge[]{return geometryApi.edges(o.solid).map(e=>({a:transformPoint(e.a,o.transform),b:transformPoint(e.b,o.transform),source:{kind:'edge',objectId:o.id,halfEdgeId:e.halfEdgeId}}));}
function moveFeatureSnapAt(x:number,y:number,edges:SnapEdge[],points:SnapPointCandidate[]=[],allowGuideOnly=true):SnapResult|null{
  if(!geometrySnapEnabled()&&!guideSnapEnabled())return null;if(!edges.length&&!points.length&&!guides.length)return null;
  const rawWorld=edges[0]?.a||points[0]?.point||([0,0,0] as Vec3),result=bestSnapCandidate({x,y,rawWorld,edges,points,guides,project,spatial:snapSpatialQuery(edges,points),radiusPx:SNAP_RADIUS_PX,geometryEnabled:geometrySnapEnabled(),guideEnabled:guideSnapEnabled(),inferenceEnabled:false,acceptCandidate:createSnapVisibilityCheck()});
  debugSnapCandidates=result.candidates;
  const features=result.candidates.filter(c=>{
    if(c.distance>SNAP_RADIUS_PX||!(c.kind==='Corner'||c.kind==='Center'||c.kind==='Midpoint'||c.kind==='Intersection'))return false;
    if(allowGuideOnly)return true;
    const src=c.source;if(!src)return c.kind!=='Intersection';
    if('objectId' in src)return true;
    return src.kind==='guide-edge-intersection'||src.kind==='guide-segment';
  }).sort((a,b)=>{if(Math.abs(a.distance-b.distance)>1e-6)return a.distance-b.distance;return endpointSnapPriority(b.kind)-endpointSnapPriority(a.kind);});
  return features[0]||null;
}
function moveSourceAnchorAt(x:number,y:number,o:ModelObject,hit:HitResult):{world:Vec3;kind:SnapKind|null}{
  const snap=moveFeatureSnapAt(x,y,moveObjectWorldEdges(o),objectWorldCenters(o),false);
  if(snap){snapIndicator=snap;return {world:[...snap.world] as Vec3,kind:snap.kind};}
  snapIndicator=null;return {world:[...hit.point] as Vec3,kind:null};
}
function moveTargetFeatureSnapAt(x:number,y:number,movingObjectIds:Set<ObjectId>):SnapResult|null{
  const edges=allWorldEdges().filter(e=>!(e.source&&'objectId' in e.source&&movingObjectIds.has(e.source.objectId)));
  const points=allWorldCenters().filter(p=>!(p.source&&'objectId' in p.source&&movingObjectIds.has(p.source.objectId)));return moveFeatureSnapAt(x,y,edges,points);
}
function pointerMovingIds():Set<ObjectId>{if(pointer?.type!=='move-object')return new Set();if(pointer.pasteDraft)return new Set((pointer.pasteDraft as PastePlacementDraft).objects.map(object=>object.id));return new Set(capturedTransformStates(pointer).map(start=>start.id));}
function invalidateTransformPreview(ids:Iterable<ObjectId>){for(const id of ids)sceneGeometry.invalidateObject(id);modelRevision++;requestRender();}
function applyMoveDelta(delta:Vec3):boolean{if(pointer?.type!=='move-object')return false;if(pointer.pasteDraft){applyPastePlacementDelta(delta);return true;}const starts=capturedTransformStates(pointer);if(!allowTransformObjects(starts.map(start=>start.id)))return false;for(const start of starts)requireObject(start.id).transform.position=V.add(start.position,delta);invalidateTransformPreview(starts.map(start=>start.id));return true;}

// Numeric distance follows the mouse-defined direction, including locked axes.
// With no meaningful motion an axis retains its positive world direction.
function moveGestureDirection(delta:Vec3):Vec3|null{
  const dir=movePointAxis();if(dir){const component=V.dot(delta,dir);return component < -TOL.minimumEdge?V.mul(dir,-1):dir;}
  const length=V.len(delta);return length>TOL.minimumEdge?V.mul(delta,1/length):null;
}
// Keep the unsnapped direction for numeric entry while a grid step still shows
// zero movement. Grid steps measure displacement from the gesture start.
function moveGridDelta(delta:Vec3):Vec3 {
  if(pointer&&V.len(delta)>TOL.minimumEdge)pointer.rawMoveDelta=[...delta];
  return $('snap')?.checked?delta.map(value=>snapValue(value)) as Vec3:delta;
}
function moveDirectionFromPointer():Vec3|null{
  if(pointer?.type!=='move-object')return null;
  const delta=pointer.lastDelta||V.sub(pointer.object.transform.position,pointer.position);
  return moveGestureDirection(V.len(delta)>TOL.minimumEdge?delta:pointer.rawMoveDelta||delta);
}
function seedMoveNumericDirection():boolean{
  const dir=moveDirectionFromPointer();if(!dir)return false;
  pointer.numericDirection=[...dir];pointer.numericAxis=axis;return true;
}
function updateMovePointer(x:number,y:number):boolean{
  if(pointer?.type!=='move-object')return false;
  pointer.lastX=x;pointer.lastY=y;if(numericEntry?.tool==='move')return true;pointer.numericDirection=null;
  if(axis==='free'&&pointer.sourceAnchorWorld){
    const target=moveTargetFeatureSnapAt(x,y,pointerMovingIds());
    if(target){
      const delta=V.sub(target.world,pointer.sourceAnchorWorld) as Vec3;pointer.lastDelta=delta;applyMoveDelta(delta);pointer.targetSnapWorld=[...target.world] as Vec3;snapIndicator=target;return true;
    }
    pointer.targetSnapWorld=null;snapIndicator=null;
  }
  const p=ground(x,y,false);if(!p&&axis!=='z')return true;
  const d=p?V.sub(p,pointer.start):[0,0,0] as Vec3;let delta:Vec3=[d[0],d[1],0];
  if(axis==='x')delta=[d[0],0,0];if(axis==='y')delta=[0,d[1],0];if(axis==='z')delta=[0,0,-(y-pointer.startY)*camera.distance/H];
  delta=moveGridDelta(delta);pointer.lastDelta=delta;applyMoveDelta(delta);return true;
}
function movePointerDragDistancePx():number{
  if(pointer?.type!=='move-object'||pointer.numericOnly)return Infinity;
  return Math.hypot((pointer.lastX??pointer.startX)-pointer.startX,(pointer.lastY??pointer.startY)-pointer.startY);
}
function previewMoveDistance(distance:number):boolean{
  if(pointer?.type!=='move-object'||!Number.isFinite(distance))return false;
  if(!pointer.numericDirection||pointer.numericAxis!==axis)if(!seedMoveNumericDirection())return false;
  const dir=pointer.numericDirection as Vec3;
  const delta=V.mul(dir,distance);pointer.numericDistance=distance;pointer.lastDelta=delta;return applyMoveDelta(delta);
}
function commitMovePointer():boolean{
  if(pointer?.type!=='move-object')return false;const p=pointer;pointer=null;
  if(p.pasteDraft){const draft=p.pasteDraft as PastePlacementDraft;cancelPastePlacement();snapIndicator=null;try{const made=commitPastePlacement(draft);toast(`${made.length} object${made.length===1?'':'s'} pasted.`);}catch(error){toast(errorMessage(error));}return true;}
  try{commitCapturedTransforms(capturedTransformStates(p),p.groupId||null,'move');}catch(error){restoreCapturedTransforms(capturedTransformStates(p));toast(errorMessage(error));updateUI();requestRender();}return true;
}
function beginMovePointerForObject(o:ModelObject,x:number,y:number,hit:HitResult|null,numericOnly=false):boolean{const selection=prepareObjectTransformSelection(o);if(!selection)return false;const gp=numericOnly?([0,0,0] as Vec3):ground(x,y,false),anchor=numericOnly||!hit?{world:[...o.transform.position] as Vec3,kind:null}:moveSourceAnchorAt(x,y,o,hit);pointer={type:'move-object',object:o,groupId:selection.groupId,objectTransforms:selection.starts,start:gp||hit?.point||o.transform.position,startX:x,startY:y,lastX:x,lastY:y,position:[...o.transform.position],rotation:[...o.transform.rotation],lastDelta:[0,0,0],sourceAnchorWorld:anchor.world,sourceAnchorKind:anchor.kind,targetSnapWorld:null,numericOnly};updateUI();return true;}
const moveToolController:ToolController={
  name:'move',parameters:TOOL_PARAMETERS.move,
  pointerDown({x,y,hit}){
    if(modelingOperationBusy)return true;
    if(moveTargetMode==='point')return movePointPointerDown(x,y,hit);
    if(pointer?.type==='move-object'){updateMovePointer(x,y);return commitMovePointer();}
    if(!hit)return true;const o=objects.find(o=>o.id===hit.id)!;beginMovePointerForObject(o,x,y,hit,false);return true;
  },
  pointerMove({x,y}){return moveTargetMode==='point'?updateMovePointPointer(x,y):updateMovePointer(x,y);},
  pointerUp({x,y}){if(moveTargetMode==='point')return movePointPointerUp(x,y);if(pointer?.type!=='move-object')return false;if(numericEntry?.tool==='move')return true;if(movePointerDragDistancePx()<MOVE_INTERACTION_POLICY.dragThresholdPx)return true;return commitMovePointer();},
  keyDown(event:any){const k=event.key.toLowerCase();if(!['x','y','z','a'].includes(k))return false;setAxis(k==='a'?'free':k as AxisName);if(activeMovePointPointer())resumeMovePointPointer(pointer.lastX,pointer.lastY);return true;},
  numericSeed(){if(moveTargetMode==='point')return seedMovePointNumeric();if(pointer?.type==='move-object')return seedMoveNumericDirection();const o=transformSelectionAnchor();if(!o||axis==='free'||!beginMovePointerForObject(o,0,0,null,true))return false;pointer.lastDelta=axis==='x'?[1,0,0]:axis==='y'?[0,1,0]:[0,0,1];return seedMoveNumericDirection();},
  numericPreview(values){return moveTargetMode==='point'?previewMovePointDistance(values.distance):previewMoveDistance(values.distance);},
  numericCommit(values){if(moveTargetMode==='point'){if(!previewMovePointDistance(values.distance))return false;return commitMovePointPointer();}if(!previewMoveDistance(values.distance)){toast(axis==='free'?'Drag first to define a direction, or lock X/Y/Z.':'Could not determine the move direction.');return false;}return commitMovePointer();},
  cancel(){if(activeMovePointPointer()){cancelMovePoint();return;}if(pointer?.type==='move-object'){cancelTransformPreview();pointer=null;}}
};

type RotationPlaneMode='world-xy'|'world-xz'|'world-yz'|'face';
const WORLD_ROTATION_PLANES:Readonly<Record<Exclude<RotationPlaneMode,'face'>,{label:string;normal:Vec3}>>=Object.freeze({
  'world-xy':{label:'World XY',normal:[0,0,1]},
  'world-xz':{label:'World XZ',normal:[0,1,0]},
  'world-yz':{label:'World YZ',normal:[1,0,0]},
});
interface RotateObjectPointer {
  type:'rotate-object';object:ModelObject;groupId:GroupId|null;
  objectTransforms:ObjectTransformState[];
  startX:number;startY:number;lastX:number;lastY:number;position:Vec3;rotation:Vec3;numericOnly:boolean;
  planeMode:RotationPlaneMode;rotationAxis:Vec3;rotationPivot:Vec3;
  faceLoops:Vec3[][];ringRadius:number;
  lastRadial:Vec3|null;rawAngle:number;numericAngle:number;numericDirectionSign?:number;lastPointerDirectionSign?:number;
}
const ROTATE_INTERACTION_POLICY=Object.freeze({dragThresholdPx:4,centerDeadZonePx:3,worldDegreesPerPixel:.5,snapAngleDeg:15,minimumCommitAngleDeg:1e-9,ringSegments:64});
let rotationPlaneMode:RotationPlaneMode='face';
function activeRotatePointer():RotateObjectPointer|null{return pointer?.type==='rotate-object'?pointer as RotateObjectPointer:null;}
// Wrap only the displayed angle. Keep gesture accumulation and signed numeric
// input continuous so crossing a full turn does not change the chosen direction.
function rotationDisplayAngle(angle:number):number {
  const value=clean(angle%360);return value===0||Math.abs(value)===360?0:value;
}
function rotateStatusText():string {
  const p=activeRotatePointer();
  return p?`${p.planeMode==='face'?'Face plane':WORLD_ROTATION_PLANES[p.planeMode].label} · ${fmt(rotationDisplayAngle(p.numericAngle))}°${p.objectTransforms.length>1?` · ${p.objectTransforms.length} objects together`:''}`:rotationPlaneMode==='face'?'Click a face to set its plane and center.':'Click an object or enter an angle.';
}
function updateRotateToolUI(){if(tool!=='rotate')return;$('rotatePlaneMode').value=rotationPlaneMode;$('rotateStatus').textContent=rotateStatusText();}
function rotationRadialAt(x:number,y:number,p:RotateObjectPointer):Vec3|null {
  const center=project(p.rotationPivot);if(Math.hypot(x-center[0],y-center[1])<ROTATE_INTERACTION_POLICY.centerDeadZonePx)return null;
  const point=intersectPlaneWorld(x,y,p.rotationPivot,p.rotationAxis);if(!point)return null;
  const delta=V.sub(point,p.rotationPivot);return V.len(delta)>TOL.minimumEdge?V.unit(delta):null;
}
function previewRotateAngle(angle:number):boolean {
  const p=activeRotatePointer();if(!p||!Number.isFinite(angle)||!allowTransformObjects(p.objectTransforms.map(start=>start.id)))return false;p.numericAngle=angle;
  for(const start of p.objectTransforms)requireObject(start.id).transform=rotateTransformAroundAxis(start,p.rotationPivot,p.rotationAxis,angle);
  invalidateTransformPreview(p.objectTransforms.map(start=>start.id));
  if(document.activeElement!==$('rotateAngle'))$('rotateAngle').value=String(rotationDisplayAngle(angle));updateRotateToolUI();return true;
}
function updateRotatePointer(x:number,y:number):boolean {
  const p=activeRotatePointer();if(!p)return false;p.lastX=x;p.lastY=y;if(numericEntry?.tool==='rotate')return true;p.numericDirectionSign=undefined;
  let angle:number;
  if(p.planeMode==='face'){
    const radial=rotationRadialAt(x,y,p);if(!radial){p.lastRadial=null;return true;}
    if(!p.lastRadial){p.lastRadial=radial;return true;}
    const increment=signedAxisAngleDeg(p.lastRadial,radial,p.rotationAxis);
    p.rawAngle+=increment;p.lastRadial=radial;angle=p.rawAngle;
  }else angle=(x-p.startX)*ROTATE_INTERACTION_POLICY.worldDegreesPerPixel;
  p.rawAngle=angle;if(Math.abs(angle)>=ROTATE_INTERACTION_POLICY.minimumCommitAngleDeg)p.lastPointerDirectionSign=angle<0?-1:1;
  if($('snap')?.checked)angle=Math.round(angle/ROTATE_INTERACTION_POLICY.snapAngleDeg)*ROTATE_INTERACTION_POLICY.snapAngleDeg;
  return previewRotateAngle(angle);
}
function seedRotateNumericDirection():boolean {
  const p=activeRotatePointer();if(!p)return false;
  // Snapping may still display 0° after the mouse has defined a direction.
  const angle=Math.abs(p.numericAngle)>=ROTATE_INTERACTION_POLICY.minimumCommitAngleDeg?p.numericAngle:p.rawAngle;
  p.numericDirectionSign=Math.abs(angle)>=ROTATE_INTERACTION_POLICY.minimumCommitAngleDeg?(angle<0?-1:1):p.lastPointerDirectionSign||1;return true;
}
function previewRotateNumericAngle(angle:number):boolean {
  const p=activeRotatePointer();if(!p||!Number.isFinite(angle))return false;
  if(p.numericDirectionSign===undefined)seedRotateNumericDirection();
  return previewRotateAngle(angle*p.numericDirectionSign!);
}
function commitRotatePointer():boolean {
  const p=activeRotatePointer();if(!p)return false;
  pointer=null;
  if(Math.abs(p.numericAngle||0)<ROTATE_INTERACTION_POLICY.minimumCommitAngleDeg){restoreCapturedTransforms(p.objectTransforms);updateUI();requestRender();return true;}
  try{commitCapturedTransforms(p.objectTransforms,p.groupId,'rotate');}catch(error){restoreCapturedTransforms(p.objectTransforms);toast(errorMessage(error));updateUI();requestRender();}
  return true;
}
function beginRotatePointer(o:ModelObject,startX:number,numericOnly=false,faceId:FaceId|null=null,startY=0):boolean {
  if(rotationPlaneMode==='face'&&(!faceId||!geometryApi.hasFace(o.solid,faceId))){toast('Click a face to choose the rotation plane first.');return false;}
  const selection=prepareObjectTransformSelection(o);if(!selection)return false;
  const view=rotationPlaneMode==='face'&&faceId?geometryApi.face(o.solid,faceId):null,bounds=selection.starts.length>1?sceneBounds(selection.starts.map(start=>requireObject(start.id))):null;
  const pivot=view?transformPoint(view.centroid,o.transform):bounds?V.mul(V.add(bounds.min,bounds.max),.5):[...o.transform.position] as Vec3;
  const axis:Vec3=view?V.unit(transformDir(view.plane.normal,o.transform)):rotationPlaneMode==='face'?[0,0,1]:[...WORLD_ROTATION_PLANES[rotationPlaneMode].normal];
  const loops=view?[view.outer,...view.holes].map(loop=>loop.map(point=>transformPoint(point,o.transform))):[];
  const radius=loops[0]?.reduce<number>((value,point)=>Math.max(value,V.len(V.sub(point,pivot))),TOL.minimumEdge)||0;
  const p:RotateObjectPointer={type:'rotate-object',object:o,groupId:selection.groupId,objectTransforms:selection.starts,startX,startY,lastX:startX,lastY:startY,position:[...o.transform.position],rotation:[...o.transform.rotation],numericOnly,planeMode:rotationPlaneMode,rotationAxis:axis,rotationPivot:pivot,faceLoops:loops,ringRadius:radius,lastRadial:null,rawAngle:0,numericAngle:0};
  pointer=p;
  if(!numericOnly&&view)p.lastRadial=rotationRadialAt(startX,startY,p);
  $('rotateAngle').value='0';updateUI();requestRender();return true;
}
function resumeRotatePointer(x:number,y:number):void {
  const p=activeRotatePointer();if(!p)return;cameraBasis();
  if(p.planeMode==='face'){p.lastRadial=rotationRadialAt(x,y,p);p.rawAngle=p.numericAngle;}
  else p.startX=x-p.numericAngle/ROTATE_INTERACTION_POLICY.worldDegreesPerPixel;
  p.startY=y;p.lastX=x;p.lastY=y;requestRender();
}
const rotateToolController:ToolController={
  name:'rotate',parameters:TOOL_PARAMETERS.rotate,
  pointerDown({x,y,hit}){
    if(activeRotatePointer()){if(numericEntry?.tool==='rotate')return true;updateRotatePointer(x,y);return commitRotatePointer();}
    if(!hit)return true;const o=objects.find(object=>object.id===hit.id);if(!o)return true;beginRotatePointer(o,x,false,hit.face,y);return true;
  },
  pointerMove({x,y}){return updateRotatePointer(x,y);},
  pointerUp({x,y}){
    const p=activeRotatePointer();if(!p)return false;if(numericEntry?.tool==='rotate')return true;updateRotatePointer(x,y);
    if(!p.numericOnly&&Math.hypot(p.lastX-p.startX,p.lastY-p.startY)<ROTATE_INTERACTION_POLICY.dragThresholdPx)return true;
    if(Math.abs(p.numericAngle)<ROTATE_INTERACTION_POLICY.minimumCommitAngleDeg)return true;return commitRotatePointer();
  },
  numericSeed(){
    if(activeRotatePointer())return seedRotateNumericDirection();const sf=selectedFaceRef(),o=sf?objects.find(object=>object.id===sf.objectId):transformSelectionAnchor();
    return !!o&&beginRotatePointer(o,0,true,sf?.faceId||null)&&seedRotateNumericDirection();
  },
  numericPreview(values){return previewRotateNumericAngle(values.angle);},
  numericCommit(values){if(!previewRotateNumericAngle(values.angle))return false;return commitRotatePointer();},
  cancel(){if(activeRotatePointer()){cancelTransformPreview();pointer=null;updateRotateToolUI();}}
};
$('rotatePlaneMode').value=rotationPlaneMode;
$('rotatePlaneMode').onchange=()=>{
  if(modelingOperationBusy){$('rotatePlaneMode').value=rotationPlaneMode;return;}
  const value=$('rotatePlaneMode').value;
  const mode:RotationPlaneMode=value==='world-xy'||value==='world-xz'||value==='world-yz'?value:'face';
  cancelGesture();rotationPlaneMode=mode;updateUI();requestRender();
};
$('applyRotateAngle').onclick=()=>{
  if(modelingOperationBusy)return;const raw=String($('rotateAngle').value).trim(),angle=Number(raw);
  if(!raw||!Number.isFinite(angle)){toast('Enter a finite rotation angle.');return;}
  if(!activeRotatePointer()&&!rotateToolController.numericSeed?.())return;
  clearToolNumericEntry();if(previewRotateAngle(angle))commitRotatePointer();
};
