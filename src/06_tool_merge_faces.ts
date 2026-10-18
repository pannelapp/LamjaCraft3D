// Tool-local face selection and a validated, disposable result preview.
interface MergeFacesTarget {objectId:ObjectId;source:Solid;revision:number;faceIds:FaceId[];}
let mergeFacesTarget:MergeFacesTarget|null=null;
let mergeFacesCandidate:{result:MergeFacesEdit & {topology:TopologyMap};parameters:MergeFacesParameters}|null=null;
let mergeFacesPreviewVisible=false,mergeFacesViewRevision=0;
function mergeFacesParametersFromUI():MergeFacesParameters {
  return {referenceFaceId:String($('mergeReferenceFace').value||'')||undefined,adjustNeighbors:!!$('mergeAdjustNeighbors').checked,maximumAdjustment:String($('mergeMaximumAdjustment').value).trim()?Number($('mergeMaximumAdjustment').value):NaN};
}
function invalidateMergeFacesPreview(){mergeFacesCandidate=null;mergeFacesPreviewVisible=false;mergeFacesViewRevision++;sceneKey='';requestRender();}
function mergeFacesStatus(message:string){$('mergeFacesStatus').textContent=message;}
function updateMergeFacesButtons(){
  const stale=!!mergeFacesTarget&&!mergeFacesTargetIsCurrent();
  if(stale){if(mergeFacesCandidate||mergeFacesPreviewVisible)invalidateMergeFacesPreview();mergeFacesStatus('The model changed. Clear the faces and select the area again.');}
  $('mergeFacesCount').textContent=`${mergeFacesTarget?.faceIds.length||0} faces selected`;
  $('mergeFacesPreviewBtn').disabled=modelingOperationBusy||stale||(mergeFacesTarget?.faceIds.length||0)<2;
  $('applyMergeFacesBtn').disabled=modelingOperationBusy||!mergeFacesCandidate;
  $('mergeFacesClearBtn').disabled=modelingOperationBusy||!mergeFacesTarget;
  $('mergeFacesPreviewBtn').textContent=mergeFacesPreviewVisible?'Back to selection':'Preview';
}
function clearMergeFacesTarget(){
  mergeFacesTarget=null;invalidateMergeFacesPreview();
  const select=$('mergeReferenceFace') as HTMLSelectElement;select.replaceChildren();const option=document.createElement('option');option.value='';option.textContent='Largest selected face (automatic)';select.append(option);
  mergeFacesStatus('Click neighboring faces to add or remove them.');updateMergeFacesButtons();
}
function mergeFacesTargetIsCurrent():boolean {
  const target=mergeFacesTarget,o=target&&objects.find(v=>v.id===target.objectId);
  return !!target&&!!o&&o.solid===target.source&&modelRevision===target.revision&&!groupForObjectId(o.id)&&o.hidden!==true&&target.faceIds.every(id=>geometryApi.hasFace(o.solid,id));
}
function toggleMergeFacesFace(o:ModelObject,faceId:FaceId){
  if(modelingOperationBusy||groupForObjectId(o.id)||o.hidden===true)return;
  if(mergeFacesTarget&&!mergeFacesTargetIsCurrent())clearMergeFacesTarget();
  if(mergeFacesTarget&&mergeFacesTarget.objectId!==o.id){toast('Select faces on one object. Clear the selection before choosing another object.');return;}
  if(!mergeFacesTarget)mergeFacesTarget={objectId:o.id,source:o.solid,revision:modelRevision,faceIds:[]};
  const ids=mergeFacesTarget.faceIds,index=ids.indexOf(faceId);
  if(index>=0)ids.splice(index,1);else {if(ids.length>=geometryApi.mergeFacesPolicy.maximumSelectedFaces){toast('The face-selection limit has been reached.');return;}ids.push(faceId);}
  invalidateMergeFacesPreview();
  if(!ids.length){clearMergeFacesTarget();return;}
  const select=$('mergeReferenceFace') as HTMLSelectElement,previous=select.value;select.replaceChildren();const auto=document.createElement('option');auto.value='';auto.textContent='Largest selected face (automatic)';select.append(auto);
  for(const id of ids){const option=document.createElement('option');option.value=id;option.textContent=`${faceLabel(o,id)} · ${id} · ${fmt(geometryApi.faceArea(o.solid,id))} mm²`;select.append(option);}
  select.value=ids.includes(previous)?previous:'';
  setSelection({kind:'face',objectId:o.id,faceId:ids[ids.length-1]},false);
  mergeFacesStatus('Preview to check the merged face and surrounding adjustments.');updateMergeFacesButtons();updateUI();requestRender();
}
async function previewMergeFacesFromUI(){
  if(modelingOperationBusy||tool!=='mergefaces')return;
  if(!mergeFacesTargetIsCurrent()){clearMergeFacesTarget();return;}
  if(mergeFacesPreviewVisible){mergeFacesPreviewVisible=false;mergeFacesViewRevision++;sceneKey='';updateMergeFacesButtons();requestRender();return;}
  const target=mergeFacesTarget!,parameters=mergeFacesParametersFromUI();
  invalidateMergeFacesPreview();
  const ids=[...target.faceIds];
  beginModelingOperation('Checking the merged face and surrounding geometry…');updateMergeFacesButtons();
  let candidate:GeometryMergeFacesResult;
  try {
    await new Promise<void>(resolve=>setTimeout(resolve,0));
    if(!mergeFacesTargetIsCurrent()||ids.join('|')!==mergeFacesTarget!.faceIds.join('|')||JSON.stringify(parameters)!==JSON.stringify(mergeFacesParametersFromUI())){mergeFacesStatus('The model or selection changed. Preview again.');return;}
    candidate=geometryApi.mergeFaces(target.source,ids,parameters);
  }catch(error){mergeFacesStatus(errorMessage(error));return;}
  finally{endModelingOperation();updateMergeFacesButtons();}

  if(!candidate.ok){mergeFacesStatus(candidate.message);updateMergeFacesButtons();return;}
  mergeFacesCandidate={result:candidate.result,parameters};mergeFacesPreviewVisible=true;mergeFacesViewRevision++;sceneKey='';
  const result=candidate.result,delta=result.volumeAfter-result.volumeBefore;
  mergeFacesStatus(`${target.faceIds.length} faces → 1 · ${result.movedVertices.length} points adjusted · ${result.affectedFaceIds.length} neighboring faces · max movement ${result.maximumMovement.toPrecision(6)} mm · volume change ${delta.toPrecision(6)} mm³. Green: merged face; amber: adjusted neighbors.`);
  updateMergeFacesButtons();requestRender();
}
function changeMergeFacesParameters(){
  invalidateMergeFacesPreview();mergeFacesStatus('Settings changed. Preview again before applying.');updateMergeFacesButtons();
}
function commitMergeFacesFromUI(){
  if(modelingOperationBusy||tool!=='mergefaces'||!mergeFacesCandidate)return;
  if(!mergeFacesTargetIsCurrent()||JSON.stringify(mergeFacesCandidate.parameters)!==JSON.stringify(mergeFacesParametersFromUI())){invalidateMergeFacesPreview();mergeFacesStatus('The model or settings changed. Preview the selection again.');updateMergeFacesButtons();return;}
  const target=mergeFacesTarget!,candidate=mergeFacesCandidate;
  try{applyPreparedMergeFaces(target.objectId,target.source,candidate.result,candidate.parameters);clearMergeFacesTarget();toast(`${target.faceIds.length} faces merged into one editable face.`);}
  catch(error){invalidateMergeFacesPreview();mergeFacesStatus(errorMessage(error));updateMergeFacesButtons();}
}
function mergeFacesPreviewSolidFor(o:ModelObject):Solid|null {
  return tool==='mergefaces'&&mergeFacesPreviewVisible&&mergeFacesCandidate&&mergeFacesTarget?.objectId===o.id&&mergeFacesTargetIsCurrent()?mergeFacesCandidate.result.solid:null;
}
function mergeFacesDisplayColor(objectId:ObjectId,faceId:FaceId):number[]|null {
  if(tool!=='mergefaces'||mergeFacesTarget?.objectId!==objectId||!mergeFacesTargetIsCurrent())return null;
  if(mergeFacesPreviewVisible&&mergeFacesCandidate){if(faceId===mergeFacesCandidate.result.faceId)return [.38,.82,.58];if(mergeFacesCandidate.result.affectedFaceIds.includes(faceId))return [.96,.70,.32];return null;}
  return mergeFacesTarget.faceIds.includes(faceId)?[.96,.70,.32]:null;
}
const mergeFacesToolController:ToolController={
  name:'mergefaces',parameters:TOOL_PARAMETERS.none,
  pointerDown({rawHit}){
    if(mergeFacesPreviewVisible){mergeFacesPreviewVisible=false;mergeFacesViewRevision++;sceneKey='';updateMergeFacesButtons();requestRender();toast('Back to selection. Click a face to add or remove it.');return true;}
    if(rawHit){const o=objects.find(v=>v.id===rawHit.id);if(o)toggleMergeFacesFace(o,rawHit.face);}return true;
  },
  cancel:clearMergeFacesTarget,
  cancelStep(){if(!mergeFacesTarget)return false;clearMergeFacesTarget();return true;},
};
