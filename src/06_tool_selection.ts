// Selection is transient document state; only modeling edits create commands.
const OBJECT_SELECTION_POLICY={dragThresholdPx:5,fill:'rgba(55,133,235,0.13)',stroke:'#4389df',lineWidth:1.5} as const;
interface ObjectSelectionPointer {
  type:'object-selection';startX:number;startY:number;x:number;y:number;
  dragging:boolean;additive:boolean;selection:EntityRef|null;ids:ObjectId[];mode:ObjectSelectionMode;
}
function objectSelectionMode():ObjectSelectionMode{const value=String($('selectionMode')?.value||'object-group');return value==='object'||value==='group'?value:'object-group';}
function objectSelectionEntityAt(hit:HitResult|null):EntityRef|null{
  if(!hit)return null;const object=objects.find(o=>o.id===hit.id);if(!object||!isObjectVisible(object))return null;
  const mode=objectSelectionMode(),group=mode==='object'?null:groupForObjectId(object.id);
  return group?{kind:'group',groupId:group.id}:mode==='group'?null:{kind:'object',objectId:object.id};
}
function filteredObjectSelectionIds(ids:readonly ObjectId[],mode:ObjectSelectionMode):ObjectId[]{
  const result=new Set<ObjectId>();
  for(const id of ids){const object=objects.find(o=>o.id===id);if(!object||!isObjectVisible(object))continue;const group=mode==='object'?null:groupForObjectId(id);
    if(group)for(const member of group.objectIds)result.add(member);else if(mode!=='group')result.add(id);
  }
  return [...result];
}
function applyObjectSelectionIds(ids:readonly ObjectId[],mode:ObjectSelectionMode,primaryId?:ObjectId|null):void{
  const filtered=filteredObjectSelectionIds(ids,mode),primary=mode==='object'?primaryId:filtered.find(id=>id===primaryId&&groupForObjectId(id))||filtered.find(id=>groupForObjectId(id))||primaryId;
  setObjectSelection(filtered,primary,true,mode!=='object');
}
function changeObjectSelectionMode():void{
  if(tool==='select')cancelGesture();clearHover();
  if(modelDocument.selection?.kind==='object'||modelDocument.selection?.kind==='group')applyObjectSelectionIds(selectedObjectIds(),objectSelectionMode(),selectedObjectId());
  else if(objectSelectionMode()==='group')clearSelection();
  requestRender();
}
function objectSelectionPointer():ObjectSelectionPointer|null{return pointer?.type==='object-selection'?pointer:null;}
function objectSelectionRect(p:ObjectSelectionPointer):ScreenSelectionRect{return {
  left:Math.max(0,Math.min(W,p.startX,p.x)),right:Math.min(W,Math.max(0,p.startX,p.x)),
  top:Math.max(0,Math.min(H,p.startY,p.y)),bottom:Math.min(H,Math.max(0,p.startY,p.y)),
};}
function restorePointerSelection(p:ObjectSelectionPointer){modelDocument.selection=p.selection;modelDocument.objectSelection=[...p.ids];updateUI();requestRender();}
function selectEntityClick(rawHit:HitResult|null,additive:boolean){
  const ref=objectSelectionEntityAt(rawHit),mode=objectSelectionMode();
  if(!ref){if(!additive)clearSelection();return;}
  const ids=ref.kind==='group'?groupById(ref.groupId)!.objectIds:'objectId' in ref?[ref.objectId]:[];
  if(!additive){applyObjectSelectionIds(ids,mode,ids[0]);return;}
  const previous=filteredObjectSelectionIds(selectedObjectIds(),mode),remove=ids.every(id=>previous.includes(id)),targets=new Set(ids);
  applyObjectSelectionIds(remove?previous.filter(id=>!targets.has(id)):[...previous,...ids],mode,selectedObjectId());
}
function updateObjectSelectionPointer(p:ObjectSelectionPointer,x:number,y:number){
  p.x=x;p.y=y;
  if(!p.dragging&&Math.hypot(x-p.startX,y-p.startY)>=OBJECT_SELECTION_POLICY.dragThresholdPx){p.dragging=true;restorePointerSelection(p);clearHover();}
  requestRender();
}
function drawObjectSelectionMarquee(){
  const p=objectSelectionPointer();if(!ctx||!p?.dragging)return;
  const rect=objectSelectionRect(p);ctx.save();ctx.fillStyle=OBJECT_SELECTION_POLICY.fill;ctx.strokeStyle=OBJECT_SELECTION_POLICY.stroke;ctx.lineWidth=OBJECT_SELECTION_POLICY.lineWidth;
  ctx.fillRect(rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top);ctx.strokeRect(rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top);ctx.restore();
}
const selectToolController:ToolController={
  name:'select',parameters:TOOL_PARAMETERS.none,
  pointerDown({event,x,y,rawHit}){
    if(objectSelectionPointer())this.cancel?.();
    const additive=!!(event?.shiftKey||event?.ctrlKey||event?.metaKey);
    pointer={type:'object-selection',startX:x,startY:y,x,y,dragging:false,additive,selection:modelDocument.selection,ids:[...modelDocument.objectSelection],mode:objectSelectionMode()} satisfies ObjectSelectionPointer;
    if(objectSelectionMode()==='object-group'&&(!additive||!rawHit)){const dimensionId=hitTestDimension(x,y);if(dimensionId){setSelection({kind:'dimension',dimensionId});return true;}const guideId=hitTestGuide(x,y);if(guideId){setSelection({kind:'guide',guideId});return true;}}
    selectEntityClick(rawHit,additive);return true;
  },
  pointerMove({x,y}){const p=objectSelectionPointer();if(!p)return false;updateObjectSelectionPointer(p,x,y);return true;},
  pointerUp({event,x,y}){
    if(event?.button!==undefined&&event.button!==0)return false;
    const p=objectSelectionPointer();if(!p)return false;updateObjectSelectionPointer(p,x,y);pointer=null;
    if(p.dragging){cameraBasis();const ids=sceneObjectsInScreenRect(objects,objectSelectionRect(p),project,cameraClip.nearPlane,cameraClip.farPlane);applyObjectSelectionIds(p.additive?[...p.ids,...ids]:ids,p.mode);clearHover();}
    requestRender();return true;
  },
  cancel(){const p=objectSelectionPointer();if(p){pointer=null;restorePointerSelection(p);}},
};
