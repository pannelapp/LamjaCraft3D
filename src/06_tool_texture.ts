// Surface Texture tool: select a face area, preview a planar patch or periodic band,
// then commit geometric Add/Cut features in a single document command.

let textureTarget:{objectId:ObjectId;faceId:FaceId;faceIds:FaceId[];revision:number}|null=null;
let textureProjectionLocal:PlaneBasis|null=null;
let texturePreviewState:{objectId:ObjectId;patch:SurfaceTexturePatchPreview}|null=null;
let textureReferenceWorld:Vec3=[0,0,0];
let textureReferencePickMode=false;

function textureReferenceEnabled():boolean{return !!(($('textureUseReference') as HTMLInputElement|null)?.checked);}
function textureReferenceWorldFromUI():Vec3{
  const values=['textureReferenceX','textureReferenceY','textureReferenceZ'].map((id,i)=>Number(($(id) as HTMLInputElement|null)?.value||textureReferenceWorld[i]||0));
  if(values.some(v=>!Number.isFinite(v)))throw Error('Enter valid X, Y and Z values for the texture reference point.');return values as Vec3;
}
function setTextureReferenceWorld(point:Vec3){textureReferenceWorld=[clean(point[0],1e6),clean(point[1],1e6),clean(point[2],1e6)];for(const [id,v] of [['textureReferenceX',textureReferenceWorld[0]],['textureReferenceY',textureReferenceWorld[1]],['textureReferenceZ',textureReferenceWorld[2]]] as [string,number][]){const input=$(id) as HTMLInputElement|null;if(input)input.value=String(v);}refreshSurfaceTexturePreview();}
function textureStableWorldU(normal0:Vec3):Vec3{const n=V.unit(normal0),ref:Vec3=Math.abs(n[2])<.9?[0,0,1]:[1,0,0];return V.unit(V.cross(ref,n));}
function textureBandEnabled():boolean{return $('textureMapping').value==='band';}
function surfaceTextureParametersFromUI(o?:ModelObject,faceId?:FaceId):SurfaceTextureParameters{
  const parameters:SurfaceTextureParameters={
    type:(($('textureType') as HTMLSelectElement).value||'lines') as SurfaceTextureType,
    operation:(($('textureOperation') as HTMLSelectElement).value||'cut') as SurfaceTextureOperation,
    spacing:Number(($('textureSpacing') as HTMLInputElement).value||3),
    size:Number(($('textureSize') as HTMLInputElement).value||.6),
    depth:Number(($('textureDepth') as HTMLInputElement).value||.35),
    angleDeg:Number(($('textureAngle') as HTMLInputElement).value||0),
    margin:Number(($('textureMargin') as HTMLInputElement).value||1),
    offsetX:Number(($('textureOffsetX') as HTMLInputElement).value||0),
    offsetY:Number(($('textureOffsetY') as HTMLInputElement).value||0),
  };
  if(textureBandEnabled()){parameters.band={axis:($('textureBandAxis').value||'z') as TextureBandAxis,repeats:Number($('textureBandRepeats').value||24),rows:Number($('textureBandRows').value||3)};return parameters;}
  if(textureReferenceEnabled()&&o&&faceId){const worldReference=textureReferenceWorldFromUI(),plane=faceWorldPlane(o,faceId);if(plane){parameters.referencePoint=inverseTransformPoint(worldReference,o.transform);parameters.referenceU=V.unit(inverseRotate(textureStableWorldU(plane.normal),o.transform.rotation));}}
  if(o&&textureTarget?.objectId===o.id&&textureProjectionLocal)parameters.projection={...textureProjectionLocal,origin:parameters.referencePoint||textureProjectionLocal.origin};
  return parameters;
}
function textureReferencePickPoint(x:number,y:number,hit:HitResult|null):Vec3|null{if(hit){const o=objects.find(v=>v.id===hit.id);if(!o)return null;const q=onFacePoint(x,y,o,hit.face,true);return q?.world||null;}return snappedGroundPoint(x,y);}
function beginTextureReferencePick(){textureReferencePickMode=true;const button=$('texturePickReferenceBtn');if(button)button.classList.add('active');const status=$('textureStatus');if(status)status.textContent='Pick a snapped point for the shared texture origin. Esc cancels.';requestRender();}
function endTextureReferencePick(cancelled=false){textureReferencePickMode=false;const button=$('texturePickReferenceBtn');if(button)button.classList.remove('active');if(cancelled)refreshSurfaceTexturePreview();}

function textureMultipleEnabled():boolean{return !!(($('textureMultiple') as HTMLInputElement|null)?.checked);}
function updateTextureAreaControls(){
  const band=textureBandEnabled();$('textureBandControls').classList.toggle('hidden',!band);$('texturePlanarOrigin').classList.toggle('hidden',band);$('textureSpacingLabel').textContent=band?'Row spacing · mm':'Spacing · mm';$('textureSizeLabel').textContent=band?'Size at widest ring · mm':'Width / size · mm';$('textureAngleLabel').textContent=band?'Motif rotation · °':'Rotation · °';($('textureRingBtn') as HTMLButtonElement).disabled=!band||!textureTarget||!textureMultipleEnabled();
  ($('textureBandRepeats') as HTMLInputElement).disabled=band&&$('textureType').value==='lines';
  const types=$('textureType') as HTMLSelectElement;for(const option of Array.from(types.options||[]))option.disabled=band&&['crosshatch','pyramids','beveltiles','rooftiles'].includes(option.value);
  const count=textureTarget?.faceIds.length||0,summary=$('textureSelectionCount');if(summary)summary.textContent=`${count} face${count===1?'':'s'} selected`;
  const clear=$('textureClearFacesBtn') as HTMLButtonElement|null,neighbors=$('textureNeighborsBtn') as HTMLButtonElement|null;
  if(clear)clear.disabled=!count;if(neighbors)neighbors.disabled=!count||!textureMultipleEnabled();
}
function clearSurfaceTextureTarget(){
  textureTarget=null;textureProjectionLocal=null;texturePreviewState=null;textureReferencePickMode=false;$('texturePickReferenceBtn')?.classList.remove('active');
  const status=$('textureStatus');if(status)status.textContent='Click faces to add or remove them from the texture area.';
  const apply=$('applyTextureBtn') as HTMLButtonElement|null;if(apply)apply.disabled=true;
  updateTextureAreaControls();requestRender();
}
function refreshSurfaceTexturePreview():boolean{
  updateTextureAreaControls();const status=$('textureStatus'),apply=$('applyTextureBtn') as HTMLButtonElement|null;
  if(!textureTarget){texturePreviewState=null;if(status)status.textContent='Click faces to add or remove them from the texture area.';if(apply)apply.disabled=true;requestRender();return false;}
  const target=textureTarget,o=objects.find(v=>v.id===target.objectId);
  if(!o||target.revision!==modelRevision||target.faceIds.some(id=>!geometryApi.hasFace(o.solid,id))){clearSurfaceTextureTarget();return false;}
  try{
    const patch=geometryApi.previewSurfaceTextureFaces(o.solid,target.faceIds,surfaceTextureParametersFromUI(o,target.faceId));
    texturePreviewState={objectId:o.id,patch};
    if(status)status.textContent=`${target.faceIds.length} faces · ${patch.instances} pattern instances · ${patch.components} regions · ${patch.complexity} complexity${patch.band?` · ${patch.band.rows} rows · ${fmt(patch.band.spacingAround)} mm around at widest ring`:''}${patch.faces.some(f=>f.preview.previewTruncated)?' · Preview sampled; Apply includes every detail.':''}`;
    if(apply)apply.disabled=false;requestRender();return true;
  }catch(err){texturePreviewState=null;if(status)status.textContent=errorMessage(err);if(apply)apply.disabled=true;requestRender();return false;}
}
function chooseSurfaceTextureFace(o:ModelObject,faceId:FaceId){
  if(textureTarget&&textureTarget.objectId!==o.id&&textureMultipleEnabled()){toast('Select texture faces on one object. Clear the area to choose another object.');return;}
  if(!textureTarget||!textureMultipleEnabled()){
    textureProjectionLocal=null;textureTarget={objectId:o.id,faceId,faceIds:[faceId],revision:modelRevision};
    if(!textureBandEnabled())textureProjectionLocal=geometryApi.textureProjectionFrame(o.solid,faceId,surfaceTextureParametersFromUI(o,faceId));
  }else{
    const ids=textureTarget.faceIds,index=ids.indexOf(faceId);
    if(index>=0)ids.splice(index,1);else ids.push(faceId);
    if(!ids.length){clearSurfaceTextureTarget();return;}
    textureTarget.faceId=ids[0];
  }
  setSelection({kind:'face',objectId:o.id,faceId:textureTarget.faceId},false);refreshSurfaceTexturePreview();updateUI();
}
function addSurfaceTextureNeighbors(wholeRing=false){
  if(!textureTarget)return;const o=objects.find(v=>v.id===textureTarget!.objectId);if(!o)return;
  const parameters=surfaceTextureParametersFromUI(o,textureTarget.faceId),normal=parameters.projection?.normal;
  let neighbors:FaceId[];try{neighbors=textureBandEnabled()?geometryApi.textureBandFaces(o.solid,textureTarget.faceIds,parameters,wholeRing):geometryApi.textureFaceNeighbors(o.solid,textureTarget.faceIds).filter(id=>!normal||V.dot(geometryApi.face(o.solid,id).plane.normal,normal)>=SURFACE_TEXTURE_POLICY.minimumProjectionCosine);}catch(error){toast(errorMessage(error));return;}
  if(!neighbors.length){toast(textureBandEnabled()?'No more compatible band faces were found.':'No more neighboring faces face this texture projection.');return;}
  if(textureTarget.faceIds.length+neighbors.length>SURFACE_TEXTURE_POLICY.maximumSelectedFaces){toast(`Select no more than ${SURFACE_TEXTURE_POLICY.maximumSelectedFaces} faces.`);return;}
  textureTarget.faceIds.push(...neighbors);refreshSurfaceTexturePreview();
}
function changeSurfaceTextureMapping(){
  textureProjectionLocal=null;endTextureReferencePick();if(textureTarget&&!textureBandEnabled()){const o=objects.find(v=>v.id===textureTarget!.objectId);if(o)textureProjectionLocal=geometryApi.textureProjectionFrame(o.solid,textureTarget.faceId,surfaceTextureParametersFromUI(o,textureTarget.faceId));}refreshSurfaceTexturePreview();
}
function changeSurfaceTextureSelectionMode(){
  if(textureTarget&&!textureMultipleEnabled())textureTarget.faceIds=[textureTarget.faceId];refreshSurfaceTexturePreview();
}
function commitSurfaceTextureFromUI(){
  if(modelingOperationBusy)return;
  if(!textureTarget){toast('Click a planar face first.');return;}
  const target={...textureTarget,faceIds:[...textureTarget.faceIds]},o=objects.find(v=>v.id===target.objectId);if(!o){clearSurfaceTextureTarget();return;}
  if(!allowObjectEdit(o))return;
  const sourceSolid=o.solid,diagnostic=textureDiagnosticStart(o,sourceSolid,target.faceIds,target.revision),diagnosticStarted=profilerClock();
  const appendDiagnostic=(event:string,data:Record<string,unknown>={})=>appendTextureDiagnostic(diagnostic,{category:'texture',event,elapsedMs:profilerClock()-diagnosticStarted,data});
  let parameters:SurfaceTextureParameters;try{parameters=surfaceTextureParametersFromUI(o,target.faceId);diagnostic.input.parameters=structuredClone(parameters);}catch(err){const message=errorMessage(err);appendDiagnostic('input-error',{message});textureDiagnosticFinish(diagnostic,'error',message);toast(message);return;}
  appendDiagnostic('request',{faceIds:target.faceIds,parameters});let cancelled=false;
  const job=geometryApi.surfaceTextureFacesAsync(sourceSolid,target.faceIds,parameters,update=>{updateModelingOperation(update.progress,update.message);appendDiagnostic('progress',{...update});},event=>appendTextureDiagnostic(diagnostic,event));
  beginModelingOperation('Working… applying surface texture',{progress:0,onCancel:()=>{cancelled=true;appendDiagnostic('cancel-requested');textureDiagnosticFinish(diagnostic,'cancelled');job.cancel();}});requestRender();
  void job.promise.then(result=>{
    if(cancelled)return;appendDiagnostic('commit-start',{revision:modelRevision,sourceMatches:objects.find(object=>object.id===o.id)?.solid===sourceSolid});
    updateModelingOperation(99,'Committing surface texture…');applyPreparedSurfaceTextureFaces(o,sourceSolid,result,target.faceIds,parameters);
    appendDiagnostic('commit-complete',{revision:modelRevision,undoDepth:undoStack.length,redoDepth:redoStack.length,result:{vertices:result.solid.vertices.size,halfEdges:result.solid.halfEdges.size,loops:result.solid.loops.size,faces:result.solid.faces.size}});textureDiagnosticFinish(diagnostic,'success');clearSurfaceTextureTarget();
    toast(`${parameters.operation==='add'?'Raised':'Cut'} ${parameters.type} texture · ${target.faceIds.length} faces`);
  }).catch(err=>{if(!cancelled){const message=errorMessage(err);appendDiagnostic('main-thread-error',{message,stack:err instanceof Error?err.stack||null:null,revision:modelRevision});textureDiagnosticFinish(diagnostic,'error',message);}toast(cancelled?'Texture generation cancelled. The object was not changed.':errorMessage(err));refreshSurfaceTexturePreview();}).finally(()=>{endModelingOperation();refreshTextureDiagnosticUI();requestRender();});
}

const surfaceTextureToolController:ToolController={
  name:'texture',parameters:TOOL_PARAMETERS.none,
  pointerDown({x,y,hit}){
    if(textureReferencePickMode){const point=textureReferencePickPoint(x,y,hit);if(!point){toast('Choose a point on a face or the ground.');return true;}setTextureReferenceWorld(point);endTextureReferencePick(false);toast(`Texture origin · ${point.map(fmt).join(', ')} mm`);return true;}
    if(modelingOperationBusy)return true;
    if(!hit)return true;const o=objects.find(v=>v.id===hit.id);if(!o)return true;if(groupForObjectId(o.id)){toast('Ungroup the object before adding a surface texture.');return true;}chooseSurfaceTextureFace(o,hit.face);return true;
  },
  cancelStep(){if(textureReferencePickMode){endTextureReferencePick(true);requestRender();return true;}if(textureTarget){clearSurfaceTextureTarget();return true;}return false;},
  cancel(){if(textureReferencePickMode)endTextureReferencePick(true);clearSurfaceTextureTarget();}
};
