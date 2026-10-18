// Appearance values never change canonical geometry or its derived caches.


function captureObjectShininessHistory(targets:readonly ModelObject[]):ObjectShininessHistoryState {
  return {kind:'object-shininess',values:targets.map(o=>({objectId:o.id,shininess:objectShininess(o)})),selection:cloneEntityRef(modelDocument.selection),objectSelection:selectedObjectIds()};
}
function assignObjectShininess(object:ModelObject,value:number):void{if(value===0)delete object.shininess;else object.shininess=value;}
function restoreObjectShininessHistory(state:ObjectShininessHistoryState):void {
  const targets=state.values.map(item=>({object:requireObject(item.objectId),value:item.shininess}));
  for(const target of targets)assignObjectShininess(target.object,target.value);
  modelDocument.selection=normalizeSelection(cloneEntityRef(state.selection));modelDocument.objectSelection=[...state.objectSelection];syncObjectSelectionToPrimary();
  clearHover();surfaceSketch=null;modelRevision++;requestRender();updateUI();
}
function setObjectsShininess(ids:readonly ObjectId[],value:number,coalesce=false):void {
  if(modelingOperationBusy)throw Error('Finish or cancel the current operation before changing shininess.');
  const next=deserializeObjectShininess(value),targetIds=[...new Set(ids)].sort(),targets=targetIds.map(requireObject);if(!targets.length)return;
  assertObjectsEditable(targetIds);if(targets.every(o=>objectShininess(o)===next))return;
  prepareToolForDocumentChange();
  const previous=coalesce?lastCommandEntry():null,previousIds=Array.isArray(previous?.parameters.objectIds)?previous!.parameters.objectIds.filter((id):id is ObjectId=>typeof id==='string'):[];
  const canMerge=previous?.type==='set-object-shininess'&&objectColorTargetKey(previousIds)===objectColorTargetKey(targetIds);
  const parameters={objectIds:targetIds,shininess:next};
  const command:DocumentCommand<void>={type:'set-object-shininess',label:targets.length===1?'Change object shininess':'Change selected object shininess',parameters,execute(){for(const target of targets)assignObjectShininess(target,next);return {};}};
  profiler.measure('command',command.label,()=>{
    const before=captureObjectShininessHistory(targets);applyCommandExecution(command.execute());const after=captureObjectShininessHistory(targets);
    if(canMerge){previous!.after=after;previous!.parameters=cloneCommandParameters(parameters);redoStack=[];}else recordHistory(command,before,after);
    modelRevision++;requestRender();setDirtyState(true);updateUI();
  },{type:command.type,...parameters});
}
