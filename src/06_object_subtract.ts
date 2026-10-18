// Direction is explicit in a modal before starting the cancellable worker job.
type SubtractSelection={targetId:ObjectId;cutterId:ObjectId}|{targetId:ObjectId;cutterGroupId:GroupId};
let objectSubtractPair:SubtractSelection|null=null;
function selectedSubtractInputs():SubtractSelection|null {
  const group=selectedGroup(),ids=selectedObjectIds();
  if(group){const extras=selectedGroupExtraIds();return extras.length===1&&!groupForObjectId(extras[0])?{targetId:extras[0],cutterGroupId:group.id}:null;}
  return ids.length===2&&!ids.some(id=>groupForObjectId(id))?{targetId:ids[0],cutterId:ids[1]}:null;
}
function subtractSelectionAvailable():boolean {
  if(modelingOperationBusy)return false;
  const inputs=selectedSubtractInputs();if(!inputs)return false;
  // Locked cutters can be used read-only with Keep cutter. Object pairs can swap.
  return 'cutterGroupId' in inputs?!isObjectLocked(requireObject(inputs.targetId)):lockedObjectsIn([inputs.targetId,inputs.cutterId]).length<2;
}
function subtractInputCutterIds(inputs:SubtractSelection):ObjectId[] {
  if('cutterId' in inputs)return [inputs.cutterId];
  const group=groupById(inputs.cutterGroupId);if(!group)throw Error('The cutter group no longer exists.');
  return [...group.objectIds];
}
function refreshObjectSubtractDialog(){
  if(!objectSubtractPair)return;
  const pair=objectSubtractPair,ids=subtractInputCutterIds(pair),group='cutterGroupId' in pair?groupById(pair.cutterGroupId):null;
  $('subtractTargetName').textContent=requireObject(pair.targetId).name;
  $('subtractCutterName').textContent=group?`${group.name} · ${ids.length} objects`:requireObject(ids[0]).name;
  $('swapSubtractBtn').disabled=!!group;$('swapSubtractBtn').classList.toggle('hidden',!!group);
  $('subtractGroupInfo').classList.toggle('hidden',!group);
  $('subtractGroupMembers').textContent=group?ids.map(id=>{const object=requireObject(id);return `${object.name}${isObjectVisible(object)?'':' · hidden'}${isObjectLocked(object)?' · locked':''}`;}).join('\n'):'';
  const hidden=ids.filter(id=>!isObjectVisible(requireObject(id))).length;
  $('subtractGroupSummary').textContent=group?`All ${ids.length} group members are cutters, including ${hidden} hidden. Keep cutter preserves the complete group; otherwise the complete group is consumed.`:'';
  const locked=lockedObjectsIn([pair.targetId,...($('subtractKeepCutter').checked?[]:ids)])[0];
  $('applySubtractBtn').disabled=!!locked;$('subtractError').textContent=locked?objectLockMessage(locked):'';$('subtractError').classList.toggle('hidden',!locked);
}
function openObjectSubtractDialog(){
  if(modelingOperationBusy)return;
  try{
    const inputs=selectedSubtractInputs();if(!inputs)throw Error('Select an ungrouped target first, then Shift/Ctrl/Cmd-click the cutter object or group.');
    if('cutterGroupId' in inputs)captureGroupSubtractSource(inputs.targetId,inputs.cutterGroupId);
    else captureObjectSubtractSource(inputs.targetId,inputs.cutterId);
    objectSubtractPair=inputs;$('subtractKeepCutter').checked=false;refreshObjectSubtractDialog();$('objectSubtractDialog').showModal();
  }catch(error){toast(errorMessage(error));}
}
function swapObjectSubtractPair(){
  if(modelingOperationBusy||!objectSubtractPair||!('cutterId' in objectSubtractPair))return;
  const pair=objectSubtractPair;objectSubtractPair={targetId:pair.cutterId,cutterId:pair.targetId};refreshObjectSubtractDialog();
}
async function runObjectSubtractFromUI(){
  if(modelingOperationBusy||!objectSubtractPair)return;
  const pair=objectSubtractPair,keepCutter=!!$('subtractKeepCutter').checked;
  let source:ObjectSubtractSource|GroupSubtractSource;
  try{
    prepareToolForDocumentChange();assertObjectsEditable([pair.targetId,...(keepCutter?[]:subtractInputCutterIds(pair))]);
    source='cutterGroupId' in pair?captureGroupSubtractSource(pair.targetId,pair.cutterGroupId):captureObjectSubtractSource(pair.targetId,pair.cutterId);
  }catch(error){$('subtractError').textContent=errorMessage(error);$('subtractError').classList.remove('hidden');return;}
  let cancelled=false,job:GeometrySubtractJob|null=null;
  $('objectSubtractDialog').close();
  beginModelingOperation('Subtracting objects…',{progress:0,onCancel:()=>{cancelled=true;job?.cancel();}});
  try{
    const progress=(update:ModelingProgressUpdate)=>updateModelingOperation(update.progress,update.message);
    job='group' in source?geometryApi.subtractGroupAsync({type:'group-subtract',target:source.target,targetTransform:source.targetTransform,cutters:source.cutters.map(cutter=>({solid:cutter.solid,transform:cutter.transform}))},progress):geometryApi.subtractAsync({type:'object-subtract',target:source.target,cutter:source.cutter,targetTransform:source.targetTransform,cutterTransform:source.cutterTransform},progress);
    const result=await job.promise;if(cancelled)return;
    const changed='group' in source?applyPreparedGroupSubtract(source,result,keepCutter):applyPreparedObjectSubtract(source,result,keepCutter);
    toast(!changed?'No overlapping volume. The originals were kept unchanged.':result.status==='empty'?'The cutters removed the entire target. One Undo restores the originals.':result.status==='changed'&&result.solids.length>1?`Subtraction complete · ${result.solids.length} separate objects. One Undo restores the originals.`:'Subtraction complete. One Undo restores the originals.');
  }catch(error){toast(cancelled?'Subtraction cancelled. The originals were kept unchanged.':errorMessage(error));}
  finally{endModelingOperation();updateUI();requestRender();}
}
$('subtractBtn').onclick=openObjectSubtractDialog;
$('swapSubtractBtn').onclick=swapObjectSubtractPair;
$('applySubtractBtn').onclick=()=>{void runObjectSubtractFromUI();};
$('subtractKeepCutter').addEventListener('change',refreshObjectSubtractDialog);
