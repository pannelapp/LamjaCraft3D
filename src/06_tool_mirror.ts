// A picked face is a read-only plane reference, independent of source selection.
type MirrorPlaneMode='face'|'world-xy'|'world-xz'|'world-yz';
interface MirrorSourceState {object:ModelObject;solid:Solid;transform:Transform;}
interface MirrorDraft {
  revision:number;selectionRevision:number;sources:MirrorSourceState[];
  reference:MirrorSourceState|null;plane:Plane;outlines:Vec3[][];center:Vec3;label:string;
}
const MIRROR_PREVIEW_POLICY=Object.freeze({minimumHalfSize:20,selectionExtentFactor:.6,lineWidth:2.5,labelOffsetPx:18});
const MIRROR_WORLD_PLANES:Record<Exclude<MirrorPlaneMode,'face'>,{normal:Vec3;label:string}>={
  'world-xy':{normal:[0,0,1],label:'World XY · Z = 0'},
  'world-xz':{normal:[0,1,0],label:'World XZ · Y = 0'},
  'world-yz':{normal:[1,0,0],label:'World YZ · X = 0'},
};
let mirrorPlaneMode:MirrorPlaneMode='face',mirrorKeepOriginal=true,mirrorDraft:MirrorDraft|null=null;
function mirrorSourceState(object:ModelObject):MirrorSourceState{return {object,solid:object.solid,transform:{position:[...object.transform.position],rotation:[...object.transform.rotation]}};}
function mirrorStateIsCurrent(state:MirrorSourceState):boolean{
  const object=objects.find(value=>value.id===state.object.id);
  return object===state.object&&object.solid===state.solid&&object.transform.position.every((value,index)=>value===state.transform.position[index])&&object.transform.rotation.every((value,index)=>value===state.transform.rotation[index]);
}
function mirrorDraftIsCurrent(draft:MirrorDraft):boolean{
  return draft.revision===modelRevision&&draft.selectionRevision===objectSelectionRevision&&draft.sources.every(mirrorStateIsCurrent)&&(!draft.reference||isObjectVisible(draft.reference.object)&&mirrorStateIsCurrent(draft.reference));
}
function clearMirrorDraft():void{mirrorDraft=null;requestRender();}
function stageMirrorPlane(hit:HitResult|null):boolean{
  if(modelingOperationBusy)return false;
  let ids=selectedObjectIds();
  if(!ids.length&&hit){const selection=prepareObjectTransformSelection(requireObject(hit.id));if(!selection)return false;ids=selection.starts.map(start=>start.id);}
  if(!ids.length){toast('Select one or more solid objects to mirror.');return false;}
  if(!allowTransformObjects(ids))return false;
  const sources=ids.map(id=>mirrorSourceState(requireObject(id)));
  if(sources.some(source=>source.object.kind==='surface')){toast('Mirror requires closed solid objects.');return false;}
  let plane:Plane,outlines:Vec3[][],center:Vec3,reference:MirrorSourceState|null=null,label:string;
  if(mirrorPlaneMode==='face'){
    if(!hit){toast('Click a face to choose the mirror plane.');return false;}
    const object=requireObject(hit.id),face=geometryApi.face(object.solid,hit.face);
    const normal=V.unit(transformDir(face.plane.normal,object.transform));
    center=transformPoint(face.centroid,object.transform);plane={normal,offset:V.dot(normal,center)};
    outlines=[face.outer,...face.holes].map(loop=>loop.map(point=>transformPoint(point,object.transform)));
    reference=mirrorSourceState(object);label=`Picked face · ${object.name}`;
  }else{
    const preset=MIRROR_WORLD_PLANES[mirrorPlaneMode];plane={normal:[...preset.normal],offset:0};label=preset.label;
    const bounds=sceneBounds(sources.map(source=>source.object));
    const midpoint=V.mul(V.add(bounds.min,bounds.max),.5);center=V.sub(midpoint,V.mul(plane.normal,V.dot(midpoint,plane.normal)));
    const halfSize=Math.max(MIRROR_PREVIEW_POLICY.minimumHalfSize,V.len(V.sub(bounds.max,bounds.min))*MIRROR_PREVIEW_POLICY.selectionExtentFactor),frame=planeBasis(plane,center);
    outlines=[[[-halfSize,-halfSize],[halfSize,-halfSize],[halfSize,halfSize],[-halfSize,halfSize]].map(point=>fromPlane2(point as Vec2,frame))];
  }
  mirrorDraft={revision:modelRevision,selectionRevision:objectSelectionRevision,sources,reference,plane,outlines,center,label};
  updateMirrorToolUI();requestRender();return true;
}
function updateMirrorToolUI():void{
  if(tool!=='mirror')return;
  if(mirrorDraft&&!mirrorDraftIsCurrent(mirrorDraft))clearMirrorDraft();
  $('mirrorPlaneMode').value=mirrorPlaneMode;$('mirrorKeepOriginal').checked=mirrorKeepOriginal;
  const count=selectedObjectIds().length;
  $('mirrorStatus').textContent=mirrorDraft?`${mirrorDraft.label} · ${mirrorDraft.sources.length} object(s) · ready to apply`:
    mirrorPlaneMode==='face'?`${count} selected · click a face to choose the mirror plane`:`${count} selected · ${MIRROR_WORLD_PLANES[mirrorPlaneMode].label}`;
  $('applyMirror').disabled=modelingOperationBusy||!count||mirrorPlaneMode==='face'&&!mirrorDraft;
}
function applyMirrorFromUI():void{
  if(modelingOperationBusy||tool!=='mirror')return;
  if(mirrorDraft&&!mirrorDraftIsCurrent(mirrorDraft)){clearMirrorDraft();updateMirrorToolUI();toast('The selection or model changed. Choose the mirror plane again.');return;}
  if(!mirrorDraft&&!stageMirrorPlane(null))return;
  const draft=mirrorDraft!;
  try{
    mirrorObjects(draft.sources.map(source=>source.object.id),draft.plane,mirrorKeepOriginal);
    clearMirrorDraft();clearHover();updateMirrorToolUI();toast(mirrorKeepOriginal?'Mirrored copies created.':'Objects mirrored.');
  }catch(error){clearMirrorDraft();updateMirrorToolUI();toast(errorMessage(error));}
}
const mirrorToolController:ToolController={
  name:'mirror',parameters:[],
  pointerDown({hit}){return stageMirrorPlane(hit);},
  keyDown(event){if(event.key==='Enter'){event.preventDefault();if(!event.repeat)applyMirrorFromUI();return true;}return false;},
  cancel(){clearMirrorDraft();},
  cancelStep(){if(!mirrorDraft)return false;clearMirrorDraft();updateMirrorToolUI();return true;},
};
$('mirrorPlaneMode').value=mirrorPlaneMode;$('mirrorKeepOriginal').checked=mirrorKeepOriginal;
$('mirrorPlaneMode').onchange=()=>{
  if(modelingOperationBusy){$('mirrorPlaneMode').value=mirrorPlaneMode;return;}
  const value=$('mirrorPlaneMode').value;
  if(value!=='face'&&value!=='world-xy'&&value!=='world-xz'&&value!=='world-yz')return;
  mirrorPlaneMode=value;clearMirrorDraft();clearHover();if(value!=='face'&&selectedObjectIds().length)stageMirrorPlane(null);updateMirrorToolUI();
};
$('mirrorKeepOriginal').onchange=()=>{if(modelingOperationBusy){$('mirrorKeepOriginal').checked=mirrorKeepOriginal;return;}mirrorKeepOriginal=$('mirrorKeepOriginal').checked;updateMirrorToolUI();};
$('applyMirror').onclick=applyMirrorFromUI;
