// Object edit protection, independent of visibility and group organization.
function isObjectLocked(object:ModelObject):boolean{return object.locked===true;}

function lockedObjectsIn(ids:Iterable<ObjectId>):ModelObject[]{const wanted=new Set(ids);return objects.filter(o=>wanted.has(o.id)&&isObjectLocked(o));}
function objectLockMessage(object:Pick<ModelObject,'name'>):string{return `“${object.name}” is locked. Unlock it in Objects before editing.`;}
function assertObjectsEditable(ids:Iterable<ObjectId>):void{const locked=lockedObjectsIn(ids);if(locked.length)throw Error(objectLockMessage(locked[0]));}
function allowObjectEdit(object:ModelObject,wholeGroup=false):boolean{
  const group=wholeGroup?groupForObjectId(object.id):null,locked=lockedObjectsIn(group?group.objectIds:[object.id]);
  if(!locked.length)return true;
  toast(objectLockMessage(locked[0]));return false;
}
const OBJECT_EDIT_COMMANDS=new Set([
  'edit-object-properties','set-object-color','set-object-shininess','move-object','rotate-object','scale-object','put-on-ground',
  'move-group','rotate-group','move-objects','rotate-objects','mirror-objects','scale-group','put-group-on-ground','delete-group','delete-object','delete-objects',
  'move-face','move-point','delete-point','dissolve-face','dissolve-edge','dissolve-vertex','trim-edge',
  'delete-recognized-feature','resize-sketch-region','merge-faces','carve-out','chamfer-edge','rounded-chamfer-edge',
  'thread-edge','surface-texture','face-text','combine-objects','subtract-objects','split-object-plane',
  'split-object-surface','split-face-open-contour','split-face-region','split-face-region-with-holes','split-face-regions','insert-editor-sketch',
]);
function assertCommandTargetsEditable<T>(command:DocumentCommand<T>):void{
  if(!OBJECT_EDIT_COMMANDS.has(command.type))return;
  const p=command.parameters,ids:ObjectId[]=[];
  if(typeof p.objectId==='string')ids.push(p.objectId);
  if(Array.isArray(p.objectIds))for(const id of p.objectIds)if(typeof id==='string')ids.push(id);
  if(typeof p.groupId==='string')ids.push(...(groupById(p.groupId)?.objectIds||[]));
  if(command.type==='subtract-objects'){
    if(typeof p.targetId==='string')ids.push(p.targetId);
    if(p.keepCutter!==true){
      if(typeof p.cutterId==='string')ids.push(p.cutterId);
      if(Array.isArray(p.cutterIds))for(const id of p.cutterIds)if(typeof id==='string')ids.push(id);
    }
  }
  assertObjectsEditable(ids);
  const geometryOperations=new Set([...OBJECT_EDIT_COMMANDS].filter(type=>!new Set(['edit-object-properties','set-object-color','set-object-shininess','move-object','rotate-object','move-objects','rotate-objects','put-on-ground','move-group','rotate-group','put-group-on-ground','delete-group','delete-object','delete-objects']).has(type)));
  if(geometryOperations.has(command.type))for(const id of ids){
    const surface=objects.find(o=>o.id===id&&o.kind==='surface');
    if(surface)throw Error(`“${surface.name}” is an open surface. Convert it into a closed solid before using solid editing tools.`);
  }
}

function assertObjectLockInvariant(before:HistoryDocumentState,commandType:string):void{
  // New/Open intentionally replace the document. Undo/Redo restore snapshots directly.
  if(['new-project','load-project','replace-document'].includes(commandType))return;
  const currentObjects=new Map(objects.map(o=>[o.id,o]));
  for(const previous of before.objects){
    const current=currentObjects.get(previous.id);
    if(current&&commandType!=='set-objects-locked'&&isObjectLocked(current)!==(previous.locked===true))throw Error('Change object locks through the Objects panel.');
    if(!previous.locked)continue;
    if(!current||current.name!==previous.name||current.color!==previous.color||objectShininess(current)!==objectShininess(previous)||JSON.stringify(current.transform)!==JSON.stringify(previous.transform)||!historyGeometry.matches(current.solid,previous.solid))throw Error(objectLockMessage(previous));
  }
}
function setObjectsLocked(ids:readonly ObjectId[],locked:boolean):void{
  if(modelingOperationBusy)return;
  // Restore transform previews before the lock command captures its Undo state.
  prepareToolForDocumentChange();clearSurfaceTextureTarget();carveTarget=null;clearHover();
  chamferHover=null;roundedChamferHover=null;threadHover=null;deleteFeatureHover=null;deleteObjectHoverId=null;
  debugPickHit=null;debugSnapCandidates=[];hoverGround=null;
  const targets=[...new Set(ids)].map(requireObject).filter(o=>isObjectLocked(o)!==locked);
  if(!targets.length){updateUI();requestRender();return;}
  executeDocumentCommand<void>({type:'set-objects-locked',label:locked?'Lock objects':'Unlock objects',parameters:{objectIds:targets.map(o=>o.id),locked},execute(){for(const target of targets)requireObject(target.id).locked=locked;return {}; }},{validateChangedSolids:false});
}
