async function runObjectCombineFromUI(){
  if(modelingOperationBusy)return;
  let source:CombineSource;
  try{prepareToolForDocumentChange();source=captureCombineSource();}catch(error){toast(errorMessage(error));return;}
  let cancelled=false,job:GeometryUnionJob|null=null;
  beginModelingOperation('Combining objects…',{progress:0,onCancel:()=>{cancelled=true;job?.cancel();}});
  try{
    job=geometryApi.unionManyAsync(combineRequest(source),update=>updateModelingOperation(update.progress,update.message));
    const result=await job.promise;if(cancelled)return;
    applyPreparedCombine(source,result);toast(`${source.inputs.length} objects combined into one editable solid. One Undo restores the originals.`);
  }catch(error){toast(cancelled?'Combine cancelled. The originals were kept unchanged.':errorMessage(error));}
  finally{endModelingOperation();updateUI();requestRender();}
}
