interface ObjectSubtractSource {
  targetId:ObjectId;cutterId:ObjectId;target:Solid;cutter:Solid;targetTransform:Transform;cutterTransform:Transform;revision:number;
}
function captureObjectSubtractSource(targetId:ObjectId,cutterId:ObjectId):ObjectSubtractSource {
  if(targetId===cutterId)throw Error('Select two different objects to subtract.');
  if([targetId,cutterId].some(id=>requireObject(id).kind==='surface'))throw Error('Open surfaces cannot be used for boolean subtraction.');
  const target=requireObject(targetId),cutter=requireObject(cutterId);
  if(groupForObjectId(targetId)||groupForObjectId(cutterId))throw Error('Ungroup objects before subtracting them.');
  if(!isObjectVisible(target)||!isObjectVisible(cutter))throw Error('Show both objects before subtracting them.');
  return {targetId,cutterId,target:target.solid,cutter:cutter.solid,targetTransform:structuredClone(target.transform),cutterTransform:structuredClone(cutter.transform),revision:modelRevision};
}
interface GroupSubtractSource {
  targetId:ObjectId;target:Solid;targetTransform:Transform;revision:number;
  group:ObjectGroup;cutters:{id:ObjectId;solid:Solid;transform:Transform;visible:boolean}[];
}
function captureGroupSubtractSource(targetId:ObjectId,groupId:GroupId):GroupSubtractSource {
  const target=requireObject(targetId),group=groupById(groupId);
  if(target.kind==='surface'||(group&&groupMemberObjects(group).some(o=>o.kind==='surface')))throw Error('Open surfaces cannot be used for boolean subtraction.');
  if(!group)throw Error('The cutter group no longer exists.');
  if(groupForObjectId(targetId))throw Error('Choose an ungrouped object as the subtraction target.');
  if(!isObjectVisible(target)||!groupMemberObjects(group).some(isObjectVisible))throw Error('Show the target and at least one cutter group member before subtracting.');
  return {targetId,target:target.solid,targetTransform:structuredClone(target.transform),revision:modelRevision,group:cloneGroup(group),
    cutters:group.objectIds.map(id=>{const object=requireObject(id);return {id,solid:object.solid,transform:structuredClone(object.transform),visible:isObjectVisible(object)};})};
}
function applyPreparedObjectSubtract(source:ObjectSubtractSource,result:BooleanSubtractResult,keepCutter:boolean):boolean {
  const cutter=requireObject(source.cutterId);
  if(cutter.solid!==source.cutter||JSON.stringify(cutter.transform)!==JSON.stringify(source.cutterTransform)||groupForObjectId(cutter.id)||!isObjectVisible(cutter))throw Error('The objects or project changed during subtraction. Run Subtract again.');
  return commitPreparedSubtraction(source,[cutter],null,result,keepCutter);
}
function applyPreparedGroupSubtract(source:GroupSubtractSource,result:BooleanSubtractResult,keepCutter:boolean):boolean {
  const group=groupById(source.group.id);
  if(!group||JSON.stringify(group)!==JSON.stringify(source.group))throw Error('The cutter group changed during subtraction. Run Subtract again.');
  const cutters=source.cutters.map(snapshot=>{
    const object=requireObject(snapshot.id);
    if(object.solid!==snapshot.solid||JSON.stringify(object.transform)!==JSON.stringify(snapshot.transform)||isObjectVisible(object)!==snapshot.visible||groupForObjectId(object.id)?.id!==group.id)throw Error('The cutter group changed during subtraction. Run Subtract again.');
    return object;
  });
  return commitPreparedSubtraction(source,cutters,group,result,keepCutter);
}
function commitPreparedSubtraction(source:Pick<ObjectSubtractSource,'targetId'|'target'|'targetTransform'|'revision'>,cutters:ModelObject[],group:ObjectGroup|null,result:BooleanSubtractResult,keepCutter:boolean):boolean {
  const target=requireObject(source.targetId);
  if(modelRevision!==source.revision||target.solid!==source.target||JSON.stringify(target.transform)!==JSON.stringify(source.targetTransform)||groupForObjectId(target.id)||!isObjectVisible(target))throw Error('The objects or project changed during subtraction. Run Subtract again.');
  if(result.status==='invalid')throw Error(result.message);
  if(result.status==='unchanged')return false;
  if(result.status==='changed'&&(!result.solids.length||objects.length+result.solids.length-1-(keepCutter?0:cutters.length)>PROJECT_CAPACITY_POLICY.maximumObjects))throw Error(`Subtraction would exceed the project limit of ${PROJECT_CAPACITY_POLICY.maximumObjects} objects or produced no solids.`);
  return executeDocumentCommand<boolean>({type:'subtract-objects',label:group?'Subtract group from object':'Subtract objects',parameters:{targetId:target.id,cutterId:cutters[0].id,cutterIds:cutters.map(cutter=>cutter.id),cutterGroupId:group?.id,keepCutter,removedVolume:result.removedVolume,empty:result.status==='empty',resultObjects:result.status==='changed'?result.solids.length:0},execute(){
    freezeDimensionAnchorsForObjects(new Set([target.id,...(keepCutter?[]:cutters.map(cutter=>cutter.id))]));
    const removedIds=new Set<ObjectId>([...(result.status==='empty'?[target.id]:[]),...(keepCutter?[]:cutters.map(cutter=>cutter.id))]);
    for(let i=objects.length-1;i>=0;i--)if(removedIds.has(objects[i].id))objects.splice(i,1);
    if(group&&!keepCutter)groups.splice(groups.indexOf(group),1);
    const parts=result.status==='changed'?replaceObjectWithSplitSolids(target,result.solids):[];
    const remaining=parts[0]||(keepCutter?cutters.find(isObjectVisible):null)||visibleObjects()[0];
    return {value:true,selection:remaining?{kind:'object',objectId:remaining.id}:null,objectSelection:parts.length?parts.map(part=>part.id):remaining?[remaining.id]:[],surfaceSketch:null};
  }});
}
