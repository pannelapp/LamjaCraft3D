// Text owns a placement step (not a drag gesture), followed by explicit Apply.
interface FaceTextTarget {objectId:ObjectId;faceId:FaceId;center:Vec2;revision:number;source:Solid;transform:ModelObject['transform'];}
let textTarget:FaceTextTarget|null=null;
let textHoverTarget:FaceTextTarget|null=null;
let textPreviewState:{target:FaceTextTarget;layout:FaceTextLayout;parameters:FaceTextParameters;error:string|null}|null=null;

function faceTextParametersFromUI(center:Vec2):FaceTextParameters {
  const offset:Vec2=[Number($('textOffsetX').value),Number($('textOffsetY').value)];
  const mode=$('textMapping').value,wrapped=mode==='cylinder'||mode==='cone'||mode==='sphere';
  return {surface:wrapped?mode as 'cylinder'|'cone'|'sphere':'auto',text:$('textContent').value,font:($('textFont').value||'sans') as TextFontId,lineSpacing:Number($('textLineSpacing').value||TEXT_POLICY.defaultLineSpacing),height:Number($('textHeight').value),depth:Number($('textDepth').value),angleDeg:Number($('textAngle').value),operation:$('textOperation').value as 'add'|'cut',center:wrapped?[...center]:[center[0]+offset[0],center[1]+offset[1]],...(wrapped?{[mode==='cylinder'?'cylinder':'wrap']:{axis:($('textCylinderAxis').value||'z') as TextureBandAxis,offset,fitAround:$('textFitAround').checked}}:{})};
}
function updateFaceTextMappingUI():void {
  const mode=$('textMapping').value,wrapped=mode==='cylinder'||mode==='cone'||mode==='sphere';$('textCylinderControls').classList.toggle('hidden',!wrapped);
  $('textOffsetXLabel').textContent=wrapped?'Around offset · mm':'Offset U · mm';
  $('textOffsetYLabel').textContent=mode==='cone'||mode==='sphere'?'Surface offset · mm':wrapped?'Axis offset · mm':'Offset V · mm';
}
function clearFaceTextTarget():void {
  textTarget=null;textHoverTarget=null;textPreviewState=null;
  $('textStatus').textContent='Hover a face to preview. Click to place the text center.';
  $('applyTextBtn').disabled=true;$('clearTextBtn').disabled=true;requestRender();
}
function faceTextTargetCurrent(target:FaceTextTarget):ModelObject|null {
  const o=objects.find(v=>v.id===target.objectId);
  return o&&target.revision===modelRevision&&target.source===o.solid&&JSON.stringify(target.transform)===JSON.stringify(o.transform)&&isObjectVisible(o)&&!groupForObjectId(o.id)?o:null;
}
function refreshFaceTextPreview():boolean {
  const target=textTarget||textHoverTarget;const apply=$('applyTextBtn');apply.disabled=true;$('clearTextBtn').disabled=!textTarget;
  if(!target){textPreviewState=null;$('textStatus').textContent='Hover a face to preview. Click to place the text center.';requestRender();return false;}
  const o=faceTextTargetCurrent(target);if(!o){clearFaceTextTarget();return false;}
  textPreviewState=null;
  try{
    const parameters=faceTextParametersFromUI(target.center),layout=geometryApi.previewFaceText(o.solid,target.faceId,parameters);
    textPreviewState={target,layout,parameters,error:null};
    const placement=geometryApi.checkFaceTextPlacement(o.solid,target.faceId,layout);
    if(!placement.ok){textPreviewState.error=placement.message;$('textStatus').textContent=placement.message;requestRender();return false;}
    if(isObjectLocked(o))throw Error(objectLockMessage(o));
    $('textStatus').textContent=`${fmt(layout.width)} × ${fmt(layout.height)} mm · ${layout.vertices} points${layout.wrap?' · '+fmt(layout.wrap.context.period)+' mm around · '+layout.wrap.context.kind:layout.cylinder?' · '+fmt(layout.cylinder.context.period)+' mm around':layout.curved?' · '+layout.curved.faces.length+' surface faces':''} · ${textTarget?'Click again to reposition, or Apply Text.':'Click to place the text center.'}`;
    apply.disabled=!textTarget||modelingOperationBusy;requestRender();return true;
  }catch(error){const message=errorMessage(error);if(textPreviewState)textPreviewState.error=message;$('textStatus').textContent=message;requestRender();return false;}
}
function faceTextTargetAt(o:ModelObject,faceId:FaceId,world:Vec3):FaceTextTarget {
  const frame=geometryApi.textFaceFrame(o.solid,faceId),center=toPlane2(inverseTransformPoint(world,o.transform),frame);
  return {objectId:o.id,faceId,center,revision:modelRevision,source:o.solid,transform:structuredClone(o.transform)};
}
function chooseFaceText(o:ModelObject,faceId:FaceId,world:Vec3):void {
  if(!allowObjectEdit(o)||groupForObjectId(o.id))return;
  textTarget=faceTextTargetAt(o,faceId,world);textHoverTarget=null;
  setSelection({kind:'face',objectId:o.id,faceId},false);refreshFaceTextPreview();updateUI();
}
function updateFaceTextHover(x:number,y:number,hit:HitResult|null):void {
  debugPreviewSolid=null;debugPickHit=hit;
  if(textTarget){if(!faceTextTargetCurrent(textTarget))clearFaceTextTarget();else{snapIndicator=null;setHoverFaceHit(hit);requestRender();return;}}
  textHoverTarget=null;
  if(hit){const o=objects.find(v=>v.id===hit.id);if(o&&!groupForObjectId(o.id)){const q=onFacePoint(x,y,o,hit.face,true);if(q){textHoverTarget=faceTextTargetAt(o,hit.face,q.world);setHoverEntity({kind:'face',objectId:o.id,faceId:hit.face},hit);}}}
  if(!textHoverTarget){clearHover();snapIndicator=null;}
  refreshFaceTextPreview();
}
function commitFaceTextFromUI():void {
  if(modelingOperationBusy||!textTarget||!refreshFaceTextPreview()||!textPreviewState)return;
  const target=textTarget,o=faceTextTargetCurrent(target);if(!o||!allowObjectEdit(o))return;
  const parameters=structuredClone(textPreviewState.parameters);let cancelled=false;
  const job=geometryApi.faceTextAsync(target.source,target.faceId,parameters,update=>updateModelingOperation(update.progress,update.message));
  beginModelingOperation('Working… generating text',{progress:0,onCancel:()=>{cancelled=true;job.cancel();}});
  void job.promise.then(result=>{
    if(cancelled)return;
    if(textTarget!==target||tool!=='text'||JSON.stringify(faceTextParametersFromUI(target.center))!==JSON.stringify(parameters))throw Error('Text placement or settings changed during generation. Apply Text again.');
    applyPreparedFaceText(target.objectId,target.source,target.revision,target.transform,result,target.faceId,parameters);
    clearFaceTextTarget();toast(parameters.operation==='add'?'Raised text created.':'Engraved text created.');
  }).catch(error=>{toast(cancelled?'Text generation cancelled. The object was not changed.':errorMessage(error));}).finally(()=>{endModelingOperation();refreshFaceTextPreview();requestRender();});
}
function drawFaceTextPreview():void {
  if(!ctx||tool!=='text'||!textPreviewState)return;
  const state=textPreviewState,o=faceTextTargetCurrent(state.target);if(!o)return;
  const {basis,regions}=state.layout,color=state.error?'#b84d4d':state.parameters.operation==='add'?'#177568':'#b97723',
    height=state.parameters.operation==='add'?state.parameters.depth:-state.parameters.depth,
    point=(uv:Vec2,z:number)=>transformPoint(V.add(fromPlane2(uv,basis),V.mul(basis.normal,z)),o.transform);
  if(state.layout.wrap?.faces.length){
    for(const face of state.layout.wrap.faces)for(const region of face.regions)for(const loop of [region.outer,...region.holes]){
      const surface=(uv:Vec2,z:number)=>transformPoint(geometryApi.faceTextWrapPoint(state.layout,face.faceId,uv,z),o.transform),base=loop.map(uv=>surface(uv,TEXT_POLICY.overlayLift)),top=loop.map(uv=>surface(uv,height));
      path3([...base,base[0]],color,false,1.5);path3([...top,top[0]],color,true,1);
      for(let i=0;i<loop.length;i+=TEXT_POLICY.overlaySampleStride)path3([base[i],top[i]],color,true,1);
    }
  }else if(state.layout.cylinder?.faces.length){
    const patch=state.layout.cylinder;
    for(const face of patch.faces){for(const region of face.regions)for(const loop of [region.outer,...region.holes]){
      const surface=(uv:Vec2,z:number)=>transformPoint(geometryApi.faceTextCylinderPoint(state.layout,face.faceId,uv,z),o.transform),base=loop.map(uv=>surface(uv,TEXT_POLICY.overlayLift)),top=loop.map(uv=>surface(uv,height));
      path3([...base,base[0]],color,false,1.5);path3([...top,top[0]],color,true,1);
      for(let i=0;i<loop.length;i+=TEXT_POLICY.overlaySampleStride)path3([base[i],top[i]],color,true,1);
    }}
  }else if(state.layout.curved?.faces.length){
    for(const face of state.layout.curved.faces)for(const region of face.regions)for(const loop of [region.outer,...region.holes]){
      const surface=(uv:Vec2,z:number)=>transformPoint(V.add(fromPlane2(uv,face.basis),V.mul(basis.normal,z)),o.transform),base=loop.map(uv=>surface(uv,TEXT_POLICY.overlayLift)),top=loop.map(uv=>surface(uv,height));
      path3([...base,base[0]],color,false,1.5);path3([...top,top[0]],color,true,1);
      for(let i=0;i<loop.length;i+=TEXT_POLICY.overlaySampleStride)path3([base[i],top[i]],color,true,1);
    }
  }else for(const r of regions)for(const loop of [r.outer,...r.holes]){
    const base=loop.map(uv=>point(uv,TEXT_POLICY.overlayLift)),top=loop.map(uv=>point(uv,height));
    path3([...base,base[0]],color,false,1.5);path3([...top,top[0]],color,true,1);
    for(let i=0;i<loop.length;i+=TEXT_POLICY.overlaySampleStride)path3([base[i],top[i]],color,true,1);
  }
  drawSnapMarker(state.layout.wrap?transformPoint(state.layout.wrap.center,o.transform):state.layout.cylinder?transformPoint(state.layout.cylinder.center,o.transform):state.layout.curved?transformPoint(V.add(state.layout.curved.center,V.mul(basis.normal,TEXT_POLICY.overlayLift)),o.transform):point(state.parameters.center,TEXT_POLICY.overlayLift),null,'Text center');
}
const faceTextToolController:ToolController={
  name:'text',parameters:TOOL_PARAMETERS.none,
  pointerDown({x,y,hit}){
    if(modelingOperationBusy||!hit)return true;
    const o=objects.find(v=>v.id===hit.id);if(!o)return true;const q=onFacePoint(x,y,o,hit.face,true);
    if(q)chooseFaceText(o,hit.face,q.world);return true;
  },
  keyDown(event){if(event.key==='Enter'&&textTarget&&!['BUTTON','TEXTAREA'].includes(document.activeElement?.tagName||'')){commitFaceTextFromUI();return true;}return false;},
  cancelStep(){if(!textTarget)return false;clearFaceTextTarget();return true;},
  cancel(){clearFaceTextTarget();},
};
