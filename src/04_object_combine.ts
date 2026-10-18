interface CombineSource {
  primaryId:ObjectId;revision:number;selection:string;
  inputs:{id:ObjectId;solid:Solid;transform:Transform;hidden:boolean}[];
  groups:ObjectGroup[];
}
function captureCombineSource():CombineSource {
  const ids=selectedObjectIds();
  if(ids.length<2)throw Error('Select at least two objects or a complete group to combine.');
  assertObjectsEditable(ids);
  const list=ids.map(requireObject),primary=list.find(isObjectVisible);if(list.some(o=>o.kind==='surface'))throw Error('Open surfaces cannot be combined with solids.');
  if(!primary)throw Error('Show at least one selected object before combining.');
  const ordered=[primary,...list.filter(object=>object.id!==primary.id)],selected=new Set(ids);
  return {primaryId:primary.id,revision:modelRevision,selection:JSON.stringify([modelDocument.selection,modelDocument.objectSelection]),
    inputs:ordered.map(object=>({id:object.id,solid:object.solid,transform:structuredClone(object.transform),hidden:!isObjectVisible(object)})),
    groups:groups.filter(group=>group.objectIds.some(id=>selected.has(id))).map(cloneGroup)};
}
function combineRequest(source:CombineSource):UnionManyRequest {return {type:'object-union',inputs:source.inputs.map(input=>({solid:input.solid,transform:input.transform})),id:source.inputs[0].solid.id};}
function applyPreparedCombine(source:CombineSource,result:BooleanUnionResult):ModelObject {
  if(modelRevision!==source.revision||JSON.stringify([modelDocument.selection,modelDocument.objectSelection])!==source.selection)throw Error('The selection or project changed during Combine. Run Combine again.');
  for(const input of source.inputs){const object=requireObject(input.id);if(object.solid!==input.solid||JSON.stringify(object.transform)!==JSON.stringify(input.transform)||!isObjectVisible(object)!==input.hidden)throw Error('An input changed during Combine. Run Combine again.');}
  const ids=source.inputs.map(input=>input.id),selected=new Set(ids);
  const currentGroups=groups.filter(group=>group.objectIds.some(id=>selected.has(id)));
  if(JSON.stringify(currentGroups)!==JSON.stringify(source.groups))throw Error('The groups changed during Combine. Run Combine again.');
  assertObjectsEditable(ids);
  if(!result.ok)throw Error(result.reason==='disconnected'||result.reason==='empty'?'The selected objects do not touch or overlap, so they cannot be combined into one connected solid. The originals were kept unchanged.':`Combine could not reconstruct a valid solid. The originals were kept unchanged. ${result.message}`);
  return executeDocumentCommand<ModelObject>({type:'combine-objects',label:'Combine objects',parameters:{objectIds:ids,operation:'union'},execute(){
    const primary=requireObject(source.primaryId);freezeDimensionAnchorsForObjects(selected);
    primary.solid=result.solid;primary.solid.metadata={...primary.solid.metadata,name:primary.name};
    for(let i=objects.length-1;i>=0;i--)if(selected.has(objects[i].id)&&objects[i].id!==primary.id)objects.splice(i,1);
    // The new solid is independent. Preserve unselected group siblings exactly;
    // dissolve records with fewer than two remaining members.
    for(let i=groups.length-1;i>=0;i--){const group=groups[i];if(!group.objectIds.some(id=>selected.has(id)))continue;group.objectIds=group.objectIds.filter(id=>!selected.has(id));if(group.objectIds.length<2)groups.splice(i,1);}
    return {value:primary,selection:{kind:'object',objectId:primary.id},objectSelection:[primary.id],surfaceSketch:null};
  }});
}
// Synchronous document API shares the same capture/commit as the worker UI.
function combineSelectedObjects():ModelObject {
  if(modelingOperationBusy)throw Error('Wait for the current operation before combining.');
  prepareToolForDocumentChange();const source=captureCombineSource();return applyPreparedCombine(source,geometryApi.unionMany(combineRequest(source)));
}
