// Visibility is document metadata. Geometry and exchange contents remain unchanged.
function isObjectVisible(o:ModelObject):boolean{return o.hidden!==true;}
function visibleObjects():ModelObject[]{return objects.filter(isObjectVisible);}

function isDimensionVisible(d:DimensionAnnotation):boolean{
  return [d.a,d.b].every(anchor=>anchor.kind==='world'||!objects.some(o=>o.id===anchor.objectId&&!isObjectVisible(o)));
}
function changeObjectVisibility(changes:readonly {objectId:ObjectId;visible:boolean}[],action:'hide-objects'|'show-objects'|'isolate-objects'){
  const targets=changes.map(change=>({...change,object:requireObject(change.objectId)}));
  if(!targets.some(target=>isObjectVisible(target.object)!==target.visible))return;
  return executeDocumentCommand<void>({type:action,label:action==='isolate-objects'?'Show only selected':action==='hide-objects'?'Hide objects':'Show objects',parameters:{objects:changes.map(change=>({...change}))},execute(){
    for(const target of targets)target.object.hidden=!target.visible;
    const selection=normalizeSelection(modelDocument.selection),objectSelection=selection?selectedObjectIds():[];
    return {selection,objectSelection,surfaceSketch:null};
  }});
}
function setObjectsVisible(objectIds:readonly ObjectId[],visible:boolean){
  const ids=[...new Set(objectIds)];return changeObjectVisibility(ids.map(objectId=>({objectId,visible})),visible?'show-objects':'hide-objects');
}
function isolateSelectedObjects(){
  const ids=new Set(selectedObjectIds());if(!ids.size)return;
  return changeObjectVisibility(objects.map(o=>({objectId:o.id,visible:ids.has(o.id)})),'isolate-objects');
}
function showAllObjects(){return setObjectsVisible(objects.map(o=>o.id),true);}
