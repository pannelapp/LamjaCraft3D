// Tool state machines. These controllers own pointer lifecycle and transient
// preview state. The renderer still reads `pointer` as a view-only projection
// of the active tool state; persistent edits go through document commands.

const TOOL_PARAMETERS = {
  none: [] as readonly ToolParameterSpec[],
  rectangle: [
    {id:'width',label:'Width',unit:'mm' as const},
    {id:'height',label:'Height',unit:'mm' as const},
  ] as readonly ToolParameterSpec[],
  circle: [{id:'radius',label:'Radius',unit:'mm' as const}] as readonly ToolParameterSpec[],
  push: [{id:'distance',label:'Distance',unit:'mm' as const,signed:true}] as readonly ToolParameterSpec[],
  move: [{id:'distance',label:'Distance',unit:'mm' as const,signed:true}] as readonly ToolParameterSpec[],
  rotate: [{id:'angle',label:'Angle',unit:'deg' as const,signed:true}] as readonly ToolParameterSpec[],
  guide: [{id:'distance',label:'Offset',unit:'mm' as const,signed:true}] as readonly ToolParameterSpec[],
  guidecircle: [{id:'radius',label:'Radius',unit:'mm' as const}] as readonly ToolParameterSpec[],
};

let numericEntry:{tool:ToolName;buffer:string}|null=null;

function clearToolNumericEntry(){numericEntry=null;const el=$('numericEntry');if(el){el.textContent='';el.classList.add('hidden');}}
function numericUnitLabel(specs:readonly ToolParameterSpec[]){const units=[...new Set(specs.map(s=>s.unit))];return units.length===1?(units[0]==='deg'?'°':units[0]==='mm'?' mm':''):'';}
function updateToolNumericHUD(){
  const el=$('numericEntry');if(!el)return;
  if(!numericEntry){el.textContent='';el.classList.add('hidden');return;}
  const specs=activeToolParameters(),labels=specs.map(s=>s.label).join(' × '),unit=numericUnitLabel(specs),shown=numericEntry.buffer||'…';
  el.textContent=`${labels}: ${shown}${unit} · Enter`;
  el.classList.remove('hidden');
}
function parseNumericEntry(buffer:string,specs:readonly ToolParameterSpec[]):Record<string,number>|null{
  if(!buffer||!specs.length)return null;
  const parts=specs.length===1?[buffer]:buffer.split(/[xX;]/);
  if(parts.length!==specs.length||parts.some(p=>!p.trim()))return null;
  const out:Record<string,number>={};
  for(let i=0;i<specs.length;i++){
    const raw=parts[i].trim().replace(',','.');
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw))return null;
    const n=Number(raw);if(!Number.isFinite(n))return null;
    if(!specs[i].signed&&n<0)return null;
    out[specs[i].id]=n;
  }
  return out;
}
function canStartNumericEntry(controller:ToolController):boolean{
  if(!controller.parameters.length||!controller.numericPreview||!controller.numericCommit)return false;
  return controller.numericSeed?controller.numericSeed():true;
}
function updateNumericPreview(){
  if(!numericEntry)return;
  const controller=activeToolController();if(controller.name!==numericEntry.tool)return;
  const values=parseNumericEntry(numericEntry.buffer,controller.parameters);if(values)controller.numericPreview?.(values);
  updateToolNumericHUD();requestRender();
}
function dispatchToolNumericKey(event:any):boolean{
  const controller=activeToolController(),specs=controller.parameters;
  if(!specs.length)return false;
  const key=String(event.key||'');
  const baseChar=/^[0-9.,+\-]$/.test(key),separatorChar=!!numericEntry&&specs.length>1&&/^[xX;]$/.test(key),isChar=baseChar||separatorChar;
  if(!numericEntry&&baseChar){if(!canStartNumericEntry(controller))return false;numericEntry={tool:controller.name,buffer:''};}
  if(!numericEntry||numericEntry.tool!==controller.name)return false;
  if(key==='Escape'){clearToolNumericEntry();requestRender();return true;}
  if(key==='Backspace'){event.preventDefault?.();numericEntry.buffer=numericEntry.buffer.slice(0,-1);updateNumericPreview();return true;}
  if(key==='Enter'){
    event.preventDefault?.();const values=parseNumericEntry(numericEntry.buffer,specs);
    if(!values){toast(specs.length>1?'Enter values such as 20x10.':'Enter a valid number.');return true;}
    const ok=controller.numericCommit?.(values);if(ok!==false)clearToolNumericEntry();requestRender();return true;
  }
  if(isChar){
    event.preventDefault?.();
    // x/X/; are separators only for multi-value tools. Comma remains a Norwegian decimal separator.
    if(specs.length===1&&/[xX;]/.test(key))return true;
    numericEntry.buffer+=key;updateNumericPreview();return true;
  }
  return false;
}

function beginCameraPointer(event:any,x:number,y:number,controller:ToolController):boolean{
  if(event.button===2||event.button===1||controller.navigation==='orbit'){
    const suspendedPointer=pointer?.type==='orbit-camera'||pointer?.type==='pan-camera'?pointer.suspendedPointer:pointer;
    pointer={type:event.shiftKey||event.button===1?'pan-camera':'orbit-camera',x,y,yaw:camera.yaw,pitch:camera.pitch,target:[...camera.target],suspendedPointer};
    return true;
  }
  return false;
}
function resumeAfterCameraPointer(x:number,y:number):void {
  pointer=pointer?.suspendedPointer||null;
  resumeRotatePointer(x,y);
  resumePasteMovePointer(x,y);
  resumeMovePointPointer(x,y);
  resumePushPointer(x,y);
  if(isGroundExtrusionPointer(pointer)){
    cameraBasis();const scale=groundExtrudeScreenScale(pointer.type==='ground-extrude'?pointer.profile:pointer.profiles.flat());
    Object.assign(pointer,scale,{startX:x-pointer.height*scale.ux*scale.pxPerMm,startY:y-pointer.height*scale.uy*scale.pxPerMm});
  }
  requestRender();
}

function cancelTransformPreview(){
  if(pointer?.type==='move-object'&&pointer.pasteDraft){cancelPastePlacement();return;}
  if(pointer?.type==='move-object'||pointer?.type==='rotate-object'){
    restoreCapturedTransforms(capturedTransformStates(pointer));modelRevision++;requestRender();
  }
}
