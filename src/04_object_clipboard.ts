// Session clipboard: immutable copied geometry and group membership. Placement
// objects stay outside ModelDocument until one paste command is committed.
interface ObjectClipboardSnapshot {objects:ModelObject[];groups:ObjectGroup[];}
interface PastePlacementDraft {
  objects:ModelObject[];groups:ObjectGroup[];sourceRevision:number;
  positions:Vec3[];
}
// Match the native format's existing 80-character names and 300-group bound.
const OBJECT_CLIPBOARD_POLICY=Object.freeze({maximumNameLength:80,maximumGroups:300,copySuffix:' copy',previewIdPrefix:'paste-preview-'});
function clipboardCopyName(name:string):string{return name.slice(0,OBJECT_CLIPBOARD_POLICY.maximumNameLength-OBJECT_CLIPBOARD_POLICY.copySuffix.length)+OBJECT_CLIPBOARD_POLICY.copySuffix;}
function assertPasteCapacity(content:ObjectClipboardSnapshot):void{
  assertProjectObjectCapacity(content.objects.length,'Pasting');
  if(groups.length+content.groups.length>OBJECT_CLIPBOARD_POLICY.maximumGroups)throw Error(`Pasting would exceed the project limit of ${OBJECT_CLIPBOARD_POLICY.maximumGroups} groups.`);
}
let objectClipboard:ObjectClipboardSnapshot|null=null;
let pastePlacement:PastePlacementDraft|null=null;
let pastePreviewRevision=0;
function copySelectedObjects():number{
  const ids=new Set(selectedObjectIds());
  if(!ids.size)return 0;
  // A complete group selection copies its hidden members as well.
  // A partial frame selection remains individual ungrouped copies.
  const copiedGroups=groups.filter(group=>group.objectIds.every(id=>ids.has(id)));
  for(const group of copiedGroups)for(const id of group.objectIds)ids.add(id);
  objectClipboard={objects:objects.filter(object=>ids.has(object.id)).map(cloneObject),groups:copiedGroups.map(cloneGroup)};
  return objectClipboard.objects.length;
}
function createPastePlacement():PastePlacementDraft{
  if(!objectClipboard?.objects.length)throw Error('Copy one or more objects or groups first.');
  assertPasteCapacity(objectClipboard);
  let previewPrefix=OBJECT_CLIPBOARD_POLICY.previewIdPrefix;
  while(objects.some(object=>object.id.startsWith(previewPrefix)))previewPrefix='_'+previewPrefix;
  const mapping=new Map<ObjectId,ObjectId>(),copies=objectClipboard.objects.map((source,index)=>{
    const copy=cloneObject(source);copy.id=`${previewPrefix}${index}`;mapping.set(source.id,copy.id);copy.solid.id='s_'+copy.id;copy.locked=false;copy.name=clipboardCopyName(source.name);return copy;
  });
  const copiedGroups=objectClipboard.groups.map((group,index)=>({id:`paste-group-preview-${index}`,name:clipboardCopyName(group.name),objectIds:group.objectIds.map(id=>mapping.get(id)!)}));
  return {objects:copies,groups:copiedGroups,sourceRevision:modelRevision,positions:copies.map(object=>[...object.transform.position] as Vec3)};
}
function pastePreviewObjects():ModelObject[]{return pastePlacement?pastePlacement.objects.filter(isObjectVisible):[];}
function cancelPastePlacement():void{
  if(!pastePlacement)return;
  for(const object of pastePlacement.objects)sceneGeometry.invalidateObject(object.id);
  pastePlacement=null;pastePreviewRevision++;updateUI();requestRender();
}
function applyPastePlacementDelta(delta:Vec3):void{
  const draft=pastePlacement;if(!draft)return;
  for(let index=0;index<draft.objects.length;index++){
    const object=draft.objects[index];object.transform.position=V.add(draft.positions[index],delta);sceneGeometry.invalidateObject(object.id);
  }
  pastePreviewRevision++;requestRender();
}
function commitPastePlacement(draft:PastePlacementDraft):ModelObject[]{
  if(draft.sourceRevision!==modelRevision)throw Error('The project changed during paste placement. Paste again.');
  assertPasteCapacity(draft);
  return executeDocumentCommand<ModelObject[]>({type:'paste-objects',label:'Paste objects',parameters:{objectCount:draft.objects.length,groupCount:draft.groups.length},execute(){
    const mapping=new Map<ObjectId,ObjectId>(),made=draft.objects.map(source=>{
      const copy=cloneObject(source);copy.id='o'+nextObjectId++;copy.solid.id='s_'+copy.id;mapping.set(source.id,copy.id);return copy;
    });
    const madeGroups=draft.groups.map(group=>({id:'grp'+nextGroupId++,name:group.name,objectIds:group.objectIds.map(id=>mapping.get(id)!)}));
    objects.push(...made);groups.push(...madeGroups);
    const primary=made.find(isObjectVisible)||made[0],primaryGroup=madeGroups.find(group=>group.objectIds.includes(primary.id));
    return {value:made,selection:primaryGroup?{kind:'group',groupId:primaryGroup.id}:{kind:'object',objectId:primary.id},objectSelection:made.map(object=>object.id),surfaceSketch:null};
  }});
}
