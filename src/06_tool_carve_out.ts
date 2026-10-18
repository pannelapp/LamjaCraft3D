// Carve Out / Hollow tool. The viewport only shows a lightweight same-face
// opening inset; the actual inner shell is still generated only after Apply in a worker.

let carveTarget:{objectId:ObjectId;faceId:FaceId}|null=null;

function carveParametersFromUI():CarveOutParameters{
  const wallThickness=Number(($('carveWallThickness') as HTMLInputElement|null)?.value||2),minimumInnerDetail=Number(($('carveMinimumDetail') as HTMLInputElement|null)?.value||.5);
  if(!Number.isFinite(wallThickness)||wallThickness<CARVE_OUT_POLICY.minimumWall)throw Error(`Wall thickness must be at least ${CARVE_OUT_POLICY.minimumWall} mm.`);
  if(!Number.isFinite(minimumInnerDetail)||minimumInnerDetail<CARVE_OUT_POLICY.minimumDetailFloor)throw Error(`Minimum inner detail must be at least ${CARVE_OUT_POLICY.minimumDetailFloor} mm.`);
  return {wallThickness,minimumInnerDetail};
}
function carveStatus(message:string,error=false){const el=$('carveStatus');if(!el)return;el.textContent=message;el.classList.toggle('warning',error);}
function clearCarveTarget(){carveTarget=null;carveOpeningGuideCache=null;const apply=$('applyCarveBtn') as HTMLButtonElement|null;if(apply)apply.disabled=true;carveStatus('Click one planar face to use as the opening.');requestRender();}
function carveSelectedStatus(o:ModelObject,faceId:FaceId){const wall=Number(($('carveWallThickness') as HTMLInputElement|null)?.value);return `${faceLabel(o,faceId)} selected as opening${Number.isFinite(wall)&&wall>=CARVE_OUT_POLICY.minimumWall?` · opening inset ${fmt(wall)} mm`:''}.`;}
function chooseCarveOpening(o:ModelObject,faceId:FaceId){
  if(groupForObjectId(o.id))throw Error('Ungroup the object before using Carve Out.');const view=geometryApi.face(o.solid,faceId);if(view.holes.length)throw Error('Carve Out currently requires an opening face without holes.');
  carveTarget={objectId:o.id,faceId};setSelection({kind:'face',objectId:o.id,faceId},false);const apply=$('applyCarveBtn') as HTMLButtonElement|null;if(apply)apply.disabled=false;carveStatus(carveSelectedStatus(o,faceId));updateUI();requestRender();
}
function commitCarveOutFromUI(){
  if(!carveTarget){toast('Click the opening face first.');return;}const target={...carveTarget},o=objects.find(v=>v.id===target.objectId);if(!o){clearCarveTarget();return;}let parameters:CarveOutParameters;try{parameters=carveParametersFromUI();}catch(error){carveStatus(errorMessage(error),true);return;}
  if(!allowObjectEdit(o))return;
  const sourceSolid=o.solid,diagnostics:ModelingDiagnosticEvent[]=[];let cancelled=false;
  const job=geometryApi.carveOutAsync(sourceSolid,target.faceId,parameters,update=>updateModelingOperation(update.progress,update.message),event=>diagnostics.push(event));
  beginModelingOperation('Carving out object…',{progress:0,onCancel:()=>{cancelled=true;job.cancel();}});requestRender();
  void job.promise.then(result=>{
    if(cancelled)return;updateModelingOperation(99,'Committing Carve Out…');applyPreparedCarveOut(o,sourceSolid,result,target.faceId,parameters);clearCarveTarget();carveStatus('Carve Out complete. Select another opening face to hollow another object.');toast(`Carve Out complete · wall ${fmt(parameters.wallThickness)} mm`);
  }).catch(error=>{
    const message=errorMessage(error);if(cancelled||message==='Carve Out cancelled.'){toast('Carve Out cancelled. The object was not changed.');carveStatus('Cancelled. The object was not changed.');return;}carveStatus(message,true);toast(message);
  }).finally(()=>{endModelingOperation();requestRender();});
}

const carveOutToolController:ToolController={
  name:'carve',parameters:TOOL_PARAMETERS.none,
  pointerDown({hit}){if(modelingOperationBusy)return true;if(!hit)return true;const o=objects.find(v=>v.id===hit.id);if(!o)return true;try{chooseCarveOpening(o,hit.face);}catch(error){carveStatus(errorMessage(error),true);toast(errorMessage(error));}return true;},
  cancelStep(){if(!carveTarget)return false;clearCarveTarget();return true;},
  cancel(){clearCarveTarget();}
};
