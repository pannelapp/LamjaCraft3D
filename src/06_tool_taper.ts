// The Taper setting belongs to the existing Push/Pull interaction, not a tool.
function pushTaperModeValue():TaperMode {
  const mode=$('pushTaperMode').value;if(mode==='proportional'||mode==='edge-angle')return mode;
  throw Error('Choose Proportional or Edge angle for Taper.');
}
function pushTaperAngleValue():number {
  const angle=Number($('pushTaperAngle').value);
  if(!Number.isFinite(angle)||Math.abs(angle)>geometryApi.maximumTaperAngleDeg)throw Error('Taper angle must be between -85° and 85°.');
  return angle;
}
function commitTaperedFaceFromUI(object:ModelObject,faceId:FaceId,distance:number,angleDeg:number):void {
  if(modelingOperationBusy||!allowObjectEdit(object))return;
  if(groupForObjectId(object.id)){toast('Ungroup the object before tapered Push/Pull.');return;}
  const source=object.solid,revision=modelRevision,sourceTransform=structuredClone(object.transform);let twistAngleDeg:number,taperMode:TaperMode;
  try{twistAngleDeg=pushTwistAngleValue();taperMode=pushTaperModeValue();geometryApi.previewTaperFace(source,faceId,distance,angleDeg,twistAngleDeg,taperMode);}catch(error){toast(errorMessage(error));return;}
  pointer=null;debugPreviewSolid=null;clearToolNumericEntry();let cancelled=false;
  const job=geometryApi.taperFaceAsync(source,faceId,distance,angleDeg,update=>updateModelingOperation(update.progress,update.message),twistAngleDeg,taperMode);
  beginModelingOperation('Preparing tapered Push/Pull…',{progress:0,onCancel:()=>{cancelled=true;job.cancel();}});
  void job.promise.then(result=>{
    if(cancelled)return;
    if(pushTaperModeValue()!==taperMode||pushTaperAngleValue()!==angleDeg||pushTwistAngleValue()!==twistAngleDeg||JSON.stringify(object.transform)!==JSON.stringify(sourceTransform))throw Error('The Taper settings changed. Apply the operation again.');
    applyPreparedTaperedFaceMove(object.id,source,revision,faceId,distance,angleDeg,result,twistAngleDeg,taperMode);toast(`Push/Pull · ${fmt(distance)} mm · taper ${fmt(angleDeg)}°${twistAngleDeg?` · twist ${fmt(twistAngleDeg)}°`:""}`);
  }).catch(error=>{if(!cancelled)toast(errorMessage(error));}).finally(()=>{endModelingOperation();updateUI();requestRender();});
}
function refreshPushSweepParameters():void {
  const object=current();$('maxInsetBtn').disabled=modelingOperationBusy||(object!==null&&isObjectLocked(object))||Number($('pushTwistAngle').value)!==0||Number($('pushTaperAngle').value)!==0;
  if(modelingOperationBusy)return;
  if(isGroundExtrusionPointer(pointer))previewGroundHeight(pointer.height);
  else if(pointer?.type==='push')previewPushDistance(pointer.requestedDistance??pointer.distance??0);
  requestRender();
}
$('pushTaperAngle').value='0';
$('pushTaperAngle').addEventListener('input',refreshPushSweepParameters);
$('pushTaperMode').value='proportional';
$('pushTaperMode').addEventListener('change',refreshPushSweepParameters);
