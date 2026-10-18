// Flat object groups. Groups never contain groups; each object can belong to at most one group.

let nextGroupId=1;
const groups:ObjectGroup[]=modelDocument.groups;

function cloneGroup(g:ObjectGroup):ObjectGroup{return {id:g.id,name:g.name,objectIds:[...g.objectIds]};}
function serializeGroup(g:ObjectGroup):SerializedObjectGroup{return cloneGroup(g);}
function deserializeGroup(x:any):ObjectGroup{
  const id=String(x?.id||''),name=String(x?.name||'Group').slice(0,80),objectIds=Array.isArray(x?.objectIds)?x.objectIds.map((v:any)=>String(v)):[];
  if(!id)throw Error('Group is missing an ID.');
  if(objectIds.length<2)throw Error(`Group ${id} must contain at least two objects.`);
  if(new Set(objectIds).size!==objectIds.length)throw Error(`Group ${id} contains a duplicate object.`);
  return {id,name,objectIds};
}
function replaceGroups(next:ObjectGroup[]){groups.splice(0,groups.length,...next.map(cloneGroup));}
function inferredNextGroupId(list=groups):number{return Math.max(0,...list.map(g=>Number(String(g.id).replace(/\D/g,''))||0))+1;}
function groupById(id:GroupId|null|undefined):ObjectGroup|null{return id?groups.find(g=>g.id===id)||null:null;}
function groupForObjectId(objectId:ObjectId):ObjectGroup|null{return groups.find(g=>g.objectIds.includes(objectId))||null;}
function selectedGroupId():GroupId|null{return modelDocument.selection?.kind==='group'?modelDocument.selection.groupId:null;}
function selectedGroup():ObjectGroup|null{return groupById(selectedGroupId());}
function groupMemberObjects(g:ObjectGroup):ModelObject[]{const wanted=new Set(g.objectIds);return objects.filter(o=>wanted.has(o.id));}
// Complete group selections retain hidden members, including groups added to
// another primary group. Partial through-frame selections stay individual.
function completeGroupMemberIds(ids:readonly ObjectId[]):Set<ObjectId>{
  const selected=new Set(ids),members=new Set<ObjectId>();
  for(const group of groups)if(group.objectIds.every(id=>selected.has(id)))for(const id of group.objectIds)members.add(id);
  return members;
}
function groupSelectionIds(g:ObjectGroup,extras:ObjectId[]=[]):ObjectId[]{const existing=new Set(objects.map(o=>o.id)),complete=completeGroupMemberIds([...g.objectIds,...extras]),out:ObjectId[]=[];for(const id of [...g.objectIds,...extras])if(existing.has(id)&&(g.objectIds.includes(id)||complete.has(id)||objects.some(o=>o.id===id&&isObjectVisible(o)))&&!out.includes(id))out.push(id);return out;}
function selectedGroupExtraIds():ObjectId[]{const g=selectedGroup();if(!g)return [];const own=new Set(g.objectIds),complete=completeGroupMemberIds(modelDocument.objectSelection);return modelDocument.objectSelection.filter(id=>!own.has(id)&&objects.some(o=>o.id===id&&(isObjectVisible(o)||complete.has(id))));}
function selectionForObjectId(objectId:ObjectId):EntityRef{const g=groupForObjectId(objectId);return g?{kind:'group',groupId:g.id}:{kind:'object',objectId};}
function setGroupSelection(g:ObjectGroup,extras:ObjectId[]=[],refresh=true){if(!groupMemberObjects(g).some(isObjectVisible)){clearSelection(refresh);return;}objectSelectionRevision++;modelDocument.selection={kind:'group',groupId:g.id};modelDocument.objectSelection=groupSelectionIds(g,extras);if(refresh){updateUI();requestRender();}}
// Add a complete group while retaining already selected objects and groups.
// The primary group owns its properties; additional groups retain membership.
function addGroupToSelection(g:ObjectGroup,refresh=true){
  if(selectedGroupId()===g.id)return;
  const extras=selectedObjectIds().filter(id=>!g.objectIds.includes(id));
  setGroupSelection(g,extras,refresh);
}
function groupWorldBounds(g:ObjectGroup):Bounds3{return sceneBounds(groupMemberObjects(g));}
function groupPivot(g:ObjectGroup):Vec3{const b=groupWorldBounds(g);return V.mul(V.add(b.min,b.max),.5);}
function groupScalePivot(g:ObjectGroup,pivotObjectId:ObjectId|null=null):Vec3{if(pivotObjectId){const anchor=groupMemberObjects(g).find(o=>o.id===pivotObjectId);if(!anchor)throw Error('The selected scale-origin object is not a member of this group.');return objectWorldOrigin(anchor);}return groupPivot(g);}
function snapshotObjectTransforms(ids:readonly ObjectId[]):ObjectTransformState[]{return [...new Set(ids)].map(id=>{const o=requireObject(id);return {id,position:[...o.transform.position] as Vec3,rotation:[...o.transform.rotation] as Vec3};});}
function setObjectsTransforms(items:readonly ObjectTransformState[],commandType:'move-objects'|'rotate-objects'):void{
  if(modelingOperationBusy)throw Error('Wait for the modeling operation before transforming objects.');
  const ids=items.map(item=>item.id);if(!ids.length)return;if(new Set(ids).size!==ids.length)throw Error('A transform contains duplicate object targets.');
  const values=items.map(item=>{requireObject(item.id);if(item.position.length!==3||item.rotation.length!==3||[...item.position,...item.rotation].some(value=>!Number.isFinite(value)))throw Error('Object transforms must contain finite position and rotation values.');return {id:item.id,position:[...item.position] as Vec3,rotation:[...item.rotation] as Vec3};});
  executeDocumentCommand<void>({type:commandType,label:commandType==='rotate-objects'?'Rotate selected objects':'Move selected objects',parameters:{objectIds:ids},execute(){for(const value of values){const o=requireObject(value.id);o.transform={position:[...value.position],rotation:[...value.rotation]};}return {};}});
}

function createGroupFromSelection():ObjectGroup{
  const ids=selectedObjectIds();if(ids.length<2)throw Error('Select at least two ungrouped objects to create a group.');
  if(ids.some(id=>groupForObjectId(id)))throw Error('Ungroup grouped objects before creating another group. Groups cannot contain groups.');
  return executeDocumentCommand<ObjectGroup>({type:'create-group',label:'Group objects',parameters:{objectIds:[...ids]},execute(){
    const g:ObjectGroup={id:'grp'+nextGroupId++,name:`Group ${nextGroupId-1}`,objectIds:[...ids]};groups.push(g);return {value:g,selection:{kind:'group',groupId:g.id},objectSelection:[...g.objectIds],surfaceSketch:null};
  }});
}
function addSelectedObjectsToGroup(groupId:GroupId):ObjectGroup{
  const g=groupById(groupId);if(!g)throw Error('The group does not exist.');const own=new Set(g.objectIds),extras=selectedObjectIds().filter(id=>!own.has(id));
  if(!extras.length)throw Error('Shift/Ctrl/Cmd-click one or more ungrouped objects to add them.');
  for(const id of extras){const other=groupForObjectId(id);if(other)throw Error(`“${objects.find(o=>o.id===id)?.name||id}” already belongs to ${other.name}. Ungroup it first.`);}
  return executeDocumentCommand<ObjectGroup>({type:'add-to-group',label:'Add objects to group',parameters:{groupId,objectIds:[...extras]},execute(){const target=groupById(groupId);if(!target)throw Error('The group does not exist.');target.objectIds.push(...extras);return {value:target,selection:{kind:'group',groupId:target.id},objectSelection:[...target.objectIds]};}});
}
function ungroupById(groupId:GroupId):ObjectId[]{const g=groupById(groupId);if(!g)throw Error('The group does not exist.');const memberIds=[...g.objectIds];return executeDocumentCommand<ObjectId[]>({type:'ungroup',label:'Ungroup objects',parameters:{groupId,objectIds:memberIds},execute(){const i=groups.findIndex(v=>v.id===groupId);if(i>=0)groups.splice(i,1);const first=memberIds.find(id=>objects.some(o=>o.id===id&&isObjectVisible(o)));return {value:memberIds,selection:first?{kind:'object',objectId:first}:null,objectSelection:memberIds.filter(id=>objects.some(o=>o.id===id))};}});}
function renameGroup(groupId:GroupId,name:string){const cleanName=String(name||'Group').trim().slice(0,80)||'Group';return executeDocumentCommand<void>({type:'rename-group',label:'Rename group',parameters:{groupId,name:cleanName},execute(){const g=groupById(groupId);if(!g)throw Error('The group does not exist.');g.name=cleanName;return {selection:{kind:'group',groupId:g.id},objectSelection:[...g.objectIds]};}});}
function setGroupTransforms(groupId:GroupId,items:{id:ObjectId;position:Vec3;rotation:Vec3}[],commandType:'move-group'|'rotate-group'){
  const targetIds=new Set(groupById(groupId)?.objectIds||[]);if(!targetIds.size)throw Error('The group does not exist.');const values=items.map(v=>({id:v.id,position:[...v.position] as Vec3,rotation:[...v.rotation] as Vec3}));
  return executeDocumentCommand<void>({type:commandType,label:commandType==='rotate-group'?'Rotate group':'Move group',parameters:{groupId,objectIds:[...targetIds]},execute(){const g=groupById(groupId);if(!g)throw Error('The group does not exist.');for(const item of values){if(!targetIds.has(item.id))continue;const o=requireObject(item.id);o.transform.position=[...item.position];o.transform.rotation=[...item.rotation];}return {selection:{kind:'group',groupId:g.id},objectSelection:[...g.objectIds]};}});
}
function scaleGroupUniform(groupId:GroupId,factor:number,pivotObjectId:ObjectId|null=null){if(!Number.isFinite(factor)||factor<=0||factor>100)throw Error('Group scale factor must be greater than 0 and at most 100.');if(Math.abs(factor-1)<1e-10)return;const g=groupById(groupId);if(!g)throw Error('The group does not exist.');const pivot=groupScalePivot(g,pivotObjectId);
  return executeDocumentCommand<void>({type:'scale-group',label:'Scale group',parameters:{groupId,factor,pivot,pivotObjectId},execute(){const target=groupById(groupId);if(!target)throw Error('The group does not exist.');for(const o of groupMemberObjects(target)){applyUniformScaleToObject(o,factor);o.transform.position=V.add(pivot,V.mul(V.sub(o.transform.position,pivot),factor));}return {selection:{kind:'group',groupId:target.id},objectSelection:[...target.objectIds],surfaceSketch:null};}});
}
function putGroupOnGround(groupId:GroupId){const g=groupById(groupId);if(!g)return;const delta=-groupWorldBounds(g).min[2];return executeDocumentCommand<void>({type:'put-group-on-ground',label:'Place group on ground plane',parameters:{groupId,distance:delta},execute(){const target=groupById(groupId);if(!target)throw Error('The group does not exist.');for(const o of groupMemberObjects(target))o.transform.position[2]+=delta;return {selection:{kind:'group',groupId:target.id},objectSelection:[...target.objectIds]};}});}
function duplicateGroup(groupId:GroupId):ObjectGroup{const source=groupById(groupId);if(!source)throw Error('The group does not exist.');return executeDocumentCommand<ObjectGroup>({type:'duplicate-group',label:'Duplicate group',parameters:{groupId,offset:[5,5,0]},execute(){const sourceNow=groupById(groupId);if(!sourceNow)throw Error('The group does not exist.');if(objects.length+sourceNow.objectIds.length>PROJECT_CAPACITY_POLICY.maximumObjects)throw Error(`Duplicating the group would exceed the project limit of ${PROJECT_CAPACITY_POLICY.maximumObjects} objects.`);const made:ModelObject[]=[];for(const id of sourceNow.objectIds){const o=requireObject(id),n=cloneObject(o);n.id='o'+nextObjectId++;n.locked=false;n.name=o.name+' copy';n.transform.position=V.add(n.transform.position,[5,5,0]);n.solid.id='s_'+n.id;objects.push(n);made.push(n);}const g:ObjectGroup={id:'grp'+nextGroupId++,name:sourceNow.name+' copy',objectIds:made.map(o=>o.id)};groups.push(g);return {value:g,selection:{kind:'group',groupId:g.id},objectSelection:[...g.objectIds]};}});}
function removeGroupById(groupId:GroupId){const source=groupById(groupId);if(!source)return;const ids=[...source.objectIds],idSet=new Set(ids);return executeDocumentCommand<void>({type:'delete-group',label:'Delete group',parameters:{groupId,objectIds:ids},execute(){for(let i=objects.length-1;i>=0;i--)if(idSet.has(objects[i].id))objects.splice(i,1);for(let i=dimensions.length-1;i>=0;i--)if(ids.some(id=>dimensionReferencesObject(dimensions[i],id)))dimensions.splice(i,1);const gi=groups.findIndex(g=>g.id===groupId);if(gi>=0)groups.splice(gi,1);const first=objects[0];return {selection:first?selectionForObjectId(first.id):dimensions[0]?{kind:'dimension',dimensionId:dimensions[0].id}:null,surfaceSketch:null};}});}
