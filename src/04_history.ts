// History owns geometry versions; document/file snapshots remain independent.
const historyGeometry=geometryApi.createHistoryStore();
function captureHistoryObject(o:ModelObject):HistoryModelObject{const solid=historyGeometry.capture(o.solid);sceneGeometry.rememberHistory(o,solid);return {...serializeObjectProperties(o),solid};}
function captureHistoryDocumentState(historyObjects=objects.map(captureHistoryObject)):HistoryDocumentState {
  return {kind:'document-history',buildPlates:buildPlates.map(cloneBuildPlate),nextBuildPlateId,objects:historyObjects,groups:groups.map(serializeGroup),guides:guides.map(serializeGuide),dimensions:dimensions.map(serializeDimension),selection:cloneEntityRef(modelDocument.selection),objectSelection:selectedObjectIds(),projectName:String($('projectName')?.value||'LamjaCraft 3D'),nextObjectId,nextGroupId,nextGuideId,nextDimensionId};
}
function invalidateHistoryGeometryChanges(before:HistoryDocumentState,after:HistoryDocumentState):void {
  const previous=new Map(before.objects.map(o=>[o.id,o])),currentIds=new Set(after.objects.map(o=>o.id));
  for(const o of after.objects){const old=previous.get(o.id);if(!old||old.solid!==o.solid||derivedTransformKey(old.transform)!==derivedTransformKey(o.transform))sceneGeometry.invalidateObject(o.id);}
  for(const o of before.objects)if(!currentIds.has(o.id))sceneGeometry.invalidateObject(o.id);
}
function restoreHistoryDocumentState(state:HistoryDocumentState,refresh=true,rememberCurrent=true):void {
  // Retain the outgoing rendered version before rebinding any document object.
  if(rememberCurrent)for(const o of objects)captureHistoryObject(o);
  const currentObjects=new Map(objects.map(o=>[o.id,o])),next:ModelObject[]=[];
  for(const saved of state.objects){
    const existing=currentObjects.get(saved.id),sameSolid=!!existing&&historyGeometry.matches(existing.solid,saved.solid);
    if(!sameSolid||!existing||derivedTransformKey(existing.transform)!==derivedTransformKey(saved.transform))sceneGeometry.invalidateObject(saved.id);
    const solid=sameSolid?existing!.solid:historyGeometry.restore(saved.solid);
    const properties={id:saved.id,name:saved.name,kind:saved.kind,hidden:saved.hidden===true,locked:saved.locked===true,color:saved.color,shininess:saved.shininess||0,transform:{position:[...saved.transform.position] as Vec3,rotation:[...saved.transform.rotation] as Vec3},solid};
    // Keep identity for unchanged objects and their disposable snap/mesh caches.
    const object=existing?Object.assign(existing,properties):properties;next.push(object);sceneGeometry.reuseHistory(object,saved.solid);currentObjects.delete(saved.id);
  }
  for(const id of currentObjects.keys())sceneGeometry.invalidateObject(id);
  replaceObjects(next);replaceBuildPlates(state.buildPlates||[]);nextBuildPlateId=state.nextBuildPlateId??inferredNextBuildPlateId();
  replaceGroups(state.groups.map(deserializeGroup));replaceGuides(state.guides.map(deserializeGuide));replaceDimensions(state.dimensions.map(deserializeDimension));
  nextObjectId=state.nextObjectId;nextGroupId=state.nextGroupId;nextGuideId=state.nextGuideId;nextDimensionId=state.nextDimensionId;
  modelDocument.selection=normalizeSelection(cloneEntityRef(state.selection));modelDocument.objectSelection=[...state.objectSelection];syncObjectSelectionToPrimary();
  clearHover();surfaceSketch=null;if($('projectName'))$('projectName').value=state.projectName;modelRevision++;
  if(refresh){requestRender();updateUI();}
}
