// A shared command for single and multiple targets; color never edits topology.
function objectColorTargetKey(ids:readonly ObjectId[]):string{return JSON.stringify([...new Set(ids)].sort());}
function captureObjectColorHistory(targets:readonly ModelObject[]):ObjectColorHistoryState {
  return {kind:'object-colors',colors:targets.map(o=>({objectId:o.id,color:o.color})),selection:cloneEntityRef(modelDocument.selection),objectSelection:selectedObjectIds()};
}
function restoreObjectColorHistory(state:ObjectColorHistoryState):void {
  // Resolve stable IDs first: a preceding geometry Undo may replace object instances.
  const targets=state.colors.map(item=>({object:requireObject(item.objectId),color:item.color}));
  for(const target of targets)target.object.color=target.color;
  modelDocument.selection=normalizeSelection(cloneEntityRef(state.selection));
  modelDocument.objectSelection=[...state.objectSelection];syncObjectSelectionToPrimary();
  clearHover();surfaceSketch=null;modelRevision++;requestRender();updateUI();
}
function setObjectsColor(ids:readonly ObjectId[],color:string,coalesce=false):void {
  if(modelingOperationBusy)throw Error('Finish or cancel the current operation before changing colors.');
  const next=String(color||'').toLowerCase();if(!/^#[\da-f]{6}$/.test(next))throw Error('Choose a valid object color.');
  const targetIds=[...new Set(ids)].sort(),targets=targetIds.map(requireObject);if(!targets.length)return;
  // Protect every requested target, including members already using this color.
  assertObjectsEditable(targetIds);if(targets.every(o=>o.color.toLowerCase()===next))return;
  prepareToolForDocumentChange();
  const previous=coalesce?lastCommandEntry():null,p=previous?.parameters;
  const previousIds=typeof p?.objectId==='string'?[p.objectId]:Array.isArray(p?.objectIds)?p.objectIds.filter((id):id is ObjectId=>typeof id==='string'):[];
  const canMerge=previous?.type==='set-object-color'&&objectColorTargetKey(previousIds)===objectColorTargetKey(targetIds);
  const parameters:Record<string,unknown>=targetIds.length===1?{objectId:targetIds[0],color:next}:{objectIds:targetIds,color:next};
  const command:DocumentCommand<void>={type:'set-object-color',label:targetIds.length===1?'Change object color':'Change selected object colors',parameters,execute(){for(const target of targets)target.color=next;return {};}};
  // This command's complete mutation is the preflighted color assignment above.
  // Avoid full B-rep snapshots and invalidation: color does not change any mesh,
  // bounds, BVH, export mesh, smoothed normals or shadow-map input.
  profiler.measure('command',command.label,()=>{
    const before=captureObjectColorHistory(targets);
    applyCommandExecution(command.execute());
    const after=captureObjectColorHistory(targets);
    if(canMerge){previous!.after=after;previous!.parameters=cloneCommandParameters(parameters);redoStack=[];}
    else recordHistory(command,before,after);
    modelRevision++;requestRender();setDirtyState(true);updateUI();
  },{type:command.type,...parameters});
}
function setObjectColor(o:ModelObject,color:string,coalesce=false):void{setObjectsColor([o.id],color,coalesce);}
