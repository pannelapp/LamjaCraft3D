function chamferOperationValue():ChamferOperation{return $('chamferOperation').value==='extend'?'extend':'cut';}
// Edge-feature controllers for Chamfer, Rounded Chamfer, and Thread.

function chamferDistanceValue():number{return Math.max(.01,Number(($('chamferDistance') as HTMLInputElement|null)?.value||2));}
function chamferAngleValue():number{return Math.max(1,Math.min(89,Number(($('chamferAngle') as HTMLInputElement|null)?.value||45)));}
interface ChamferEdgeSelection {
  mode:'chamfer'|'roundchamfer';segments:number|null;operation:ChamferOperation;
  objectId:ObjectId;sourceSolid:Solid;sourceRevision:number;
  sides:{halfEdgeIds:HalfEdgeId[];keys:HalfEdgeId[];curve?:boolean}[];
  distance:number;angleDeg:number;previewResult:GeometryDissolveResult|null;error:string|null;
}
let chamferEdgeSelection:ChamferEdgeSelection|null=null;
function chamferSelectionStatus():string{
  const draft=chamferEdgeSelection,count=draft?.sides.length||0;
  const label=draft?.sides.some(side=>side.curve)?`edge group${count===1?'':'s'}`:`straight side${count===1?'':'s'}`;
  return count?`${count} ${label} selected · click to toggle · release Ctrl/Shift to apply${draft?.error?' · '+draft.error:''}`:`Ctrl: straight sides · Shift: curved chains (turns under ${CHAMFER_CHAIN_SELECTION_POLICY.maximumTurnDeg}°). Keep held to add groups; release to apply. Escape cancels.`;
}
function updateChamferSelectionStatus():void{for(const id of ['chamferSelectionStatus','roundedChamferSelectionStatus'])$(id).textContent=chamferSelectionStatus();}
function cancelChamferEdgeSelection():void{chamferEdgeSelection=null;chamferHover=null;roundedChamferHover=null;updateChamferSelectionStatus();requestRender();}
function cancelChamferSelectionStep():boolean{if(!chamferEdgeSelection)return false;cancelChamferEdgeSelection();clearHover();return true;}
function chamferSelectionIsCurrent(draft:ChamferEdgeSelection):boolean{
  const o=objects.find(v=>v.id===draft.objectId);
  const parametersCurrent=draft.mode==='chamfer'?chamferDistanceValue()===draft.distance&&chamferAngleValue()===draft.angleDeg:roundedChamferRadiusValue()===draft.distance&&roundedChamferAngleValue()===draft.angleDeg&&roundedChamferSegmentsValue()===draft.segments;
  return tool===draft.mode&&!modelingOperationBusy&&modelRevision===draft.sourceRevision&&!!o&&o.solid===draft.sourceSolid&&isObjectVisible(o)&&!isObjectLocked(o)&&!groupForObjectId(o.id)&&parametersCurrent&&chamferOperationValue()===draft.operation;
}
function toggleChamferEdgeSelection(o:ModelObject,edgeId:HalfEdgeId,mode:'chamfer'|'roundchamfer'='chamfer',curve=false):void{
  if(!allowObjectEdit(o))return;
  if(chamferEdgeSelection&&!chamferSelectionIsCurrent(chamferEdgeSelection)){cancelChamferEdgeSelection();toast('The object or parameters changed. Select the edges again.');return;}
  if(chamferEdgeSelection&&chamferEdgeSelection.objectId!==o.id){toast('Select edges on the same object.');return;}
  const ids=curve?geometryApi.chamferCurveCandidateEdges(o.solid,edgeId,chamferOperationValue()):geometryApi.chamferStraightCandidateEdges(o.solid,edgeId,chamferOperationValue());
  if(!ids){toast(curve?'Choose an eligible edge chain.':'Choose an eligible straight side. Use Shift or a normal click for a complete rim.');return;}
  const keys=ids.map(id=>{const e=geometryApi.edge(o.solid,id);return e.id<e.twinId?e.id:e.twinId;});
  const rounded=mode==='roundchamfer',draft=chamferEdgeSelection||(chamferEdgeSelection={mode,operation:chamferOperationValue(),segments:rounded?roundedChamferSegmentsValue():null,objectId:o.id,sourceSolid:o.solid,sourceRevision:modelRevision,sides:[],distance:rounded?roundedChamferRadiusValue():chamferDistanceValue(),angleDeg:rounded?roundedChamferAngleValue():chamferAngleValue(),previewResult:null,error:null});
  const selected=new Set(draft.sides.flatMap(side=>side.keys)),requested=new Set(keys);
  if(keys.every(key=>selected.has(key))){
    draft.sides=draft.sides.flatMap(side=>{const keep=side.keys.map((key,i)=>({key,id:side.halfEdgeIds[i]})).filter(member=>!requested.has(member.key));return keep.length?[{...side,keys:keep.map(member=>member.key),halfEdgeIds:keep.map(member=>member.id)}]:[];});
  }else{
    const added=ids.map((id,i)=>({id,key:keys[i]})).filter(member=>!selected.has(member.key));
    const first=geometryApi.edge(o.solid,ids[0]),direction=V.unit(V.sub(first.b,first.a));
    const curved=curve&&ids.some(id=>{const e=geometryApi.edge(o.solid,id);return Math.abs(V.dot(direction,V.unit(V.sub(e.b,e.a))))<=CHAMFER_STRAIGHT_SELECTION_POLICY.minimumParallelDot;});
    draft.sides.push({halfEdgeIds:added.map(member=>member.id),keys:added.map(member=>member.key),curve:curved});
  }
  draft.previewResult=null;draft.error=null;chamferHover=null;roundedChamferHover=null;
  if(!rounded&&draft.sides.length)try{draft.previewResult=geometryApi.chamferStraightEdges(draft.sourceSolid,draft.sides.flatMap(side=>side.halfEdgeIds),draft.distance,draft.angleDeg,draft.operation);}catch(err){draft.error=errorMessage(err);}
  updateChamferSelectionStatus();$('coordinates').textContent=chamferSelectionStatus();requestRender();
}
function handleChamferModifierKeyUp(event:KeyboardEvent):void{
  if(!chamferEdgeSelection||!['Control','Shift'].includes(event.key)||event.ctrlKey||event.shiftKey)return;
  const draft=chamferEdgeSelection,o=objects.find(v=>v.id===draft.objectId);
  const blocked=document.querySelector('dialog[open]')||['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName||'')||event.isComposing||event.altKey||event.metaKey;
  const current=!blocked&&chamferSelectionIsCurrent(draft);
  cancelChamferEdgeSelection();clearHover();
  if(!current||!o||!draft.sides.length)return;
  if(draft.mode==='roundchamfer'){try{startRoundedChamfer(o,draft.sides[0].halfEdgeIds[0],draft.distance,draft.angleDeg,draft.segments!,draft.sides.flatMap(side=>side.halfEdgeIds),draft.sourceRevision,draft.operation);}catch(err){toast(errorMessage(err));}return;}
  if(!draft.previewResult){toast(draft.error||'Chamfer preview unavailable. No edges were changed.');return;}
  try{applyPreparedEdgesChamfer(o,draft.sourceSolid,draft.sourceRevision,draft.previewResult,draft.sides.flatMap(side=>side.halfEdgeIds),draft.distance,draft.angleDeg,draft.operation);const label=draft.sides.some(side=>side.curve)?'edge group':'straight side';toast(`Chamfer · ${draft.sides.length} ${label}${draft.sides.length===1?'':'s'} · ${fmt(draft.distance)} mm · ${fmt(draft.angleDeg)}°`);}catch(err){toast(errorMessage(err));}
}
const chamferToolController:ToolController={
  name:'chamfer',parameters:TOOL_PARAMETERS.none,
  keyUp:handleChamferModifierKeyUp,
  cancel:cancelChamferEdgeSelection,
  cancelStep:cancelChamferSelectionStep,
  pointerDown({x,y,hit,event}){
    if(modelingOperationBusy)return true;
    const h=hit||hitTest(x,y),edge=h?topologyEdgeAt(x,y,h):null;if(edge?.kind!=='edge')return true;const o=objects.find(v=>v.id===edge.objectId);if(!o)return true;let edgeId=edge.halfEdgeId;try{const ev=geometryApi.edge(o.solid,edgeId);if(h&&ev.faceA!==h.face&&ev.faceB===h.face)edgeId=ev.twinId;}catch{}
    if(groupForObjectId(o.id)||!isObjectVisible(o))return true;
    if(event?.ctrlKey||event?.shiftKey){try{toggleChamferEdgeSelection(o,edgeId,'chamfer',!!event.shiftKey);}catch(err){toast(errorMessage(err));}return true;}
    // Cancel an unfinished batch if its modifier key-up was lost.
    if(chamferEdgeSelection)cancelChamferEdgeSelection();
    const distance=chamferDistanceValue(),angle=chamferAngleValue(),ids=geometryApi.chamferCandidateEdges(o.solid,edgeId,chamferOperationValue()),previewKey=chamferChainPreviewKey('chamfer',o.id,ids,distance,angle),prepared=chamferHover?.objectId===o.id&&chamferHover.halfEdgeId===edgeId&&chamferHover.previewKey===previewKey&&chamferHover.sourceSolid===o.solid?chamferHover.previewResult:null;
    try{if(prepared)applyPreparedEdgeChamfer(o,o.solid,prepared,edgeId,distance,angle,chamferOperationValue());else applyEdgeChamfer(o,edgeId,distance,angle,chamferOperationValue());chamferHover=null;clearHover();toast(`${chamferOperationValue()==='extend'?'Extended Chamfer':'Chamfer'} ${fmt(distance)} mm · ${fmt(angle)}°`);}catch(err){toast(errorMessage(err));}return true;
  }
};

function roundedChamferRadiusValue():number{return Math.max(.01,Number(($('roundedChamferRadius') as HTMLInputElement|null)?.value||2));}
function roundedChamferAngleValue():number{return Math.max(1,Math.min(89,Number(($('roundedChamferAngle') as HTMLInputElement|null)?.value||45)));}
function roundedChamferSegmentsValue():number{return Math.max(ROUNDED_CHAMFER_POLICY.minimumSegments,Math.min(ROUNDED_CHAMFER_POLICY.maximumSegments,Math.round(Number(($('roundedChamferSegments') as HTMLInputElement|null)?.value||ROUNDED_CHAMFER_POLICY.defaultSegments))));}

interface RoundedChamferDiagnosticLog {
  debugFormat:'lamjacraft-3d-rounded-chamfer-diagnostic';
  formatVersion:1;
  appVersion:string;
  startedAt:string;
  finishedAt?:string;
  outcome:'running'|'success'|'error'|'cancelled';
  error?:string;
  environment:{userAgent:string;hardwareConcurrency:number|null};
  object:{id:ObjectId;name:string;kind:string;transform:Transform};
  input:{halfEdgeId:HalfEdgeId;halfEdgeIds:HalfEdgeId[];distance:number;angleDeg:number;otherDistance:number;segments:number;operation:ChamferOperation};
  sourceSolid:SerializedSolid;
  events:ModelingDiagnosticEvent[];
}
let lastRoundedChamferDiagnosticLog:RoundedChamferDiagnosticLog|null=null;
function roundedChamferDiagnosticStart(o:ModelObject,sourceSolid:Solid,halfEdgeId:HalfEdgeId,halfEdgeIds:HalfEdgeId[],distance:number,angleDeg:number,segments:number,operation:ChamferOperation):RoundedChamferDiagnosticLog{
  const log:RoundedChamferDiagnosticLog={debugFormat:'lamjacraft-3d-rounded-chamfer-diagnostic',formatVersion:1,appVersion:appRuntimeVersion(),startedAt:new Date().toISOString(),outcome:'running',environment:{userAgent:typeof navigator==='undefined'?'unknown':navigator.userAgent,hardwareConcurrency:typeof navigator==='undefined'?null:navigator.hardwareConcurrency||null},object:{id:o.id,name:o.name,kind:o.kind,transform:{position:[...o.transform.position] as Vec3,rotation:[...o.transform.rotation] as Vec3}},input:{halfEdgeId,halfEdgeIds:[...halfEdgeIds],distance,angleDeg,otherDistance:distance*Math.tan(angleDeg*Math.PI/180),segments,operation},sourceSolid:geometryApi.serialize(sourceSolid),events:[]};
  lastRoundedChamferDiagnosticLog=log;refreshRoundedChamferDiagnosticUI();return log;
}
function roundedChamferDiagnosticFinish(log:RoundedChamferDiagnosticLog,outcome:'success'|'error'|'cancelled',error?:string){log.outcome=outcome;log.finishedAt=new Date().toISOString();if(error)log.error=error;refreshRoundedChamferDiagnosticUI();}
function startRoundedChamfer(o:ModelObject,edgeId:HalfEdgeId,radius:number,angle:number,segments:number,selectedIds?:readonly HalfEdgeId[],sourceRevision=modelRevision,operation:ChamferOperation=chamferOperationValue()):void{
  if(!allowObjectEdit(o))return;
  const ids=selectedIds?[...selectedIds]:geometryApi.chamferCandidateEdges(o.solid,edgeId,operation),sourceSolid=o.solid;roundedChamferHover={objectId:o.id,halfEdgeId:edgeId,halfEdgeIds:ids,previewSolid:null,previewKey:chamferChainPreviewKey('roundchamfer',o.id,ids,radius,angle,segments),error:null};
    const diagnostic=roundedChamferDiagnosticStart(o,sourceSolid,edgeId,ids,radius,angle,segments,operation),diagnosticStarted=profilerClock(),appendDiagnostic=(category:ModelingDiagnosticCategory,event:string,data:Record<string,unknown>={})=>diagnostic.events.push({category,event,elapsedMs:profilerClock()-diagnosticStarted,data});
    const report=(update:ModelingProgressUpdate)=>updateModelingOperation(update.progress,update.message),reportDiagnostic=(event:ModelingDiagnosticEvent)=>diagnostic.events.push(event),job=selectedIds?geometryApi.roundedChamferStraightEdgesAsync(sourceSolid,ids,radius,angle,segments,report,reportDiagnostic,operation):geometryApi.roundedChamferEdgeAsync(sourceSolid,edgeId,radius,angle,segments,report,reportDiagnostic,operation);let cancelled=false;
    beginModelingOperation(operation==='extend'?'Working… generating Rounded Extension':'Working… generating Rounded Chamfer',{progress:0,onCancel:()=>{cancelled=true;appendDiagnostic('rounded-chamfer','cancel-requested');roundedChamferDiagnosticFinish(diagnostic,'cancelled');job.cancel();}});requestRender();
    void job.promise.then(result=>{if(cancelled)return;if(chamferOperationValue()!==operation)throw Error('The Chamfer operation changed during generation. Select the edge again.');appendDiagnostic('rounded-chamfer','commit-start');updateModelingOperation(99,'Committing Rounded Chamfer…');if(selectedIds)applyPreparedEdgesRoundedChamfer(o,sourceSolid,sourceRevision,result,ids,radius,angle,segments,operation);else applyPreparedEdgeRoundedChamfer(o,sourceSolid,result,edgeId,radius,angle,segments,operation);appendDiagnostic('rounded-chamfer','commit-complete',{faces:result.solid.faces.size,halfEdges:result.solid.halfEdges.size});roundedChamferDiagnosticFinish(diagnostic,'success');roundedChamferHover=null;clearHover();toast(`${operation==='extend'?'Rounded Extension':'Rounded Chamfer'} ${fmt(radius)} mm · ${fmt(angle)}° · ${segments} segments`);}).catch(err=>{const message=errorMessage(err);if(cancelled){roundedChamferHover=null;clearHover();toast('Rounded Chamfer generation cancelled.');}else{appendDiagnostic('rounded-chamfer','main-thread-error',{message});roundedChamferDiagnosticFinish(diagnostic,'error',message);toast(message);}}).finally(()=>{endModelingOperation();requestRender();});
}
const roundedChamferToolController:ToolController={
  name:'roundchamfer',parameters:TOOL_PARAMETERS.none,
  keyUp:handleChamferModifierKeyUp,cancel:cancelChamferEdgeSelection,cancelStep:cancelChamferSelectionStep,
  pointerDown({x,y,hit,event}){
    if(modelingOperationBusy)return true;
    const h=hit||hitTest(x,y),edge=h?topologyEdgeAt(x,y,h):null;if(edge?.kind!=='edge')return true;const o=objects.find(v=>v.id===edge.objectId);if(!o)return true;let edgeId=edge.halfEdgeId;try{const ev=geometryApi.edge(o.solid,edgeId);if(h&&ev.faceA!==h.face&&ev.faceB===h.face)edgeId=ev.twinId;}catch{}
    if(groupForObjectId(o.id)||!isObjectVisible(o))return true;
    if(event?.ctrlKey||event?.shiftKey){try{toggleChamferEdgeSelection(o,edgeId,'roundchamfer',!!event.shiftKey);}catch(err){toast(errorMessage(err));}return true;}
    if(chamferEdgeSelection)cancelChamferEdgeSelection();
    startRoundedChamfer(o,edgeId,roundedChamferRadiusValue(),roundedChamferAngleValue(),roundedChamferSegmentsValue());return true;
  }
};


interface ThreadDiagnosticLog {
  debugFormat:'lamjacraft-3d-thread-diagnostic';
  formatVersion:1;
  appVersion:string;
  startedAt:string;
  finishedAt?:string;
  outcome:'running'|'success'|'error'|'cancelled';
  error?:string;
  environment:{userAgent:string;hardwareConcurrency:number|null};
  object:{id:ObjectId;name:string;kind:string;transform:Transform};
  preset:{id:string;label:string};
  input:{halfEdgeId:HalfEdgeId;kind:'internal'|'external';radius:number;maxLength:number;rimSegments:number;pitch:number;depth:number;length:number;profileAngleDeg:number;direction:ThreadDirection;operation:ThreadOperation};
  sourceSolid:SerializedSolid;
  events:ModelingDiagnosticEvent[];
}
let lastThreadDiagnosticLog:ThreadDiagnosticLog|null=null;
function appRuntimeVersion():string{const text=document.querySelector('.revision')?.textContent||'',match=/V\s+([^\s]+)/.exec(text);return match?.[1]||'unknown';}
function threadDiagnosticStart(o:ModelObject,sourceSolid:Solid,info:ThreadRimInfo,pitch:number,depth:number,length:number,profileAngleDeg:number,direction:ThreadDirection,operation:ThreadOperation):ThreadDiagnosticLog{
  const presetId=(($('threadPreset') as HTMLSelectElement|null)?.value)||'custom',preset=THREAD_PRESETS[presetId];
  const log:ThreadDiagnosticLog={debugFormat:'lamjacraft-3d-thread-diagnostic',formatVersion:1,appVersion:appRuntimeVersion(),startedAt:new Date().toISOString(),outcome:'running',environment:{userAgent:typeof navigator==='undefined'?'unknown':navigator.userAgent,hardwareConcurrency:typeof navigator==='undefined'?null:navigator.hardwareConcurrency||null},object:{id:o.id,name:o.name,kind:o.kind,transform:{position:[...o.transform.position] as Vec3,rotation:[...o.transform.rotation] as Vec3}},preset:{id:presetId,label:preset?.label||'Custom'},input:{halfEdgeId:info.halfEdgeId,kind:info.kind,radius:info.radius,maxLength:info.maxLength,rimSegments:info.rimSegments,pitch,depth,length,profileAngleDeg,direction,operation},sourceSolid:geometryApi.serialize(sourceSolid),events:[]};
  lastThreadDiagnosticLog=log;refreshThreadDiagnosticUI();return log;
}
function threadDiagnosticFinish(log:ThreadDiagnosticLog,outcome:'success'|'error'|'cancelled',error?:string){log.outcome=outcome;log.finishedAt=new Date().toISOString();if(error)log.error=error;refreshThreadDiagnosticUI();}

interface ThreadPresetDefinition {label:string;nominalDiameter:number;pitch:number;}
const METRIC_EXTERNAL_THREAD_DEPTH_FACTOR=17*Math.sqrt(3)/48;
const METRIC_INTERNAL_THREAD_DEPTH_FACTOR=5*Math.sqrt(3)/16;
const THREAD_PRESETS:Record<string,ThreadPresetDefinition>={
  'm3':{label:'M3',nominalDiameter:3,pitch:.5},'m4':{label:'M4',nominalDiameter:4,pitch:.7},'m5':{label:'M5',nominalDiameter:5,pitch:.8},'m6':{label:'M6',nominalDiameter:6,pitch:1},'m8':{label:'M8',nominalDiameter:8,pitch:1.25},'m10':{label:'M10',nominalDiameter:10,pitch:1.5},'m12':{label:'M12',nominalDiameter:12,pitch:1.75},'m14':{label:'M14',nominalDiameter:14,pitch:2},'m16':{label:'M16',nominalDiameter:16,pitch:2},'m18':{label:'M18',nominalDiameter:18,pitch:2.5},'m20':{label:'M20',nominalDiameter:20,pitch:2.5},'m22':{label:'M22',nominalDiameter:22,pitch:2.5},'m24':{label:'M24',nominalDiameter:24,pitch:3},'m27':{label:'M27',nominalDiameter:27,pitch:3},'m30':{label:'M30',nominalDiameter:30,pitch:3.5},
};
const THREAD_PRESET_ORDER=Object.keys(THREAD_PRESETS);
function metricThreadDepth(pitch:number,kind:'external'|'internal'):number{return pitch*(kind==='external'?METRIC_EXTERNAL_THREAD_DEPTH_FACTOR:METRIC_INTERNAL_THREAD_DEPTH_FACTOR);}
function threadPresetDepth(preset:ThreadPresetDefinition,kind:'external'|'internal'):number{return metricThreadDepth(preset.pitch,kind);}
function threadRecommendedRimDiameter(preset:ThreadPresetDefinition,kind:'external'|'internal',operation:ThreadOperation):number{const startsBelowNominal=(kind==='external'&&operation==='add')||(kind==='internal'&&operation==='cut'),depth=threadPresetDepth(preset,kind);return preset.nominalDiameter-(startsBelowNominal?depth*2:0);}
function currentThreadPreset():ThreadPresetDefinition|null{const id=(($('threadPreset') as HTMLSelectElement|null)?.value)||'custom';return THREAD_PRESETS[id]||null;}
function setThreadPresetFieldsEditable(editable:boolean){for(const id of ['threadPitch','threadDepth','threadProfileAngle']){const input=$(id) as HTMLInputElement|null;if(input)input.readOnly=!editable;}}
function applyThreadPreset(kind:'external'|'internal'='external'){const p=currentThreadPreset();setThreadPresetFieldsEditable(!p);if(!p)return;const pitch=$('threadPitch') as HTMLInputElement|null,depth=$('threadDepth') as HTMLInputElement|null,angle=$('threadProfileAngle') as HTMLInputElement|null;if(pitch)pitch.value=String(Math.round(p.pitch*10000)/10000);if(depth)depth.value=String(Math.round(threadPresetDepth(p,kind)*10000)/10000);if(angle)angle.value='60';}
function syncThreadPresetForKind(kind:'external'|'internal'){if(currentThreadPreset())applyThreadPreset(kind);}
function threadPitchValue():number{const p=currentThreadPreset();return p?p.pitch:Math.max(THREAD_POLICY.minimumPitch,Number(($('threadPitch') as HTMLInputElement|null)?.value||1));}
function threadDepthValue(kind?:'external'|'internal'):number{const p=currentThreadPreset();if(p&&kind)return threadPresetDepth(p,kind);return Math.max(THREAD_POLICY.minimumDepth,Number(($('threadDepth') as HTMLInputElement|null)?.value||.45));}
function threadLengthValue():number{return Math.max(THREAD_POLICY.minimumLength,Number(($('threadLength') as HTMLInputElement|null)?.value||10));}
function threadProfileAngleValue():number{return currentThreadPreset()?60:Math.max(THREAD_POLICY.minimumProfileAngleDeg,Math.min(THREAD_POLICY.maximumProfileAngleDeg,Number(($('threadProfileAngle') as HTMLInputElement|null)?.value||60)));}
function threadDirectionValue():ThreadDirection{return (($('threadDirection') as HTMLSelectElement|null)?.value==='left'?'left':'right');}
function threadOperationValue():ThreadOperation{return (($('threadOperation') as HTMLSelectElement|null)?.value==='cut'?'cut':'add');}
const threadToolController:ToolController={
  name:'thread',parameters:TOOL_PARAMETERS.none,
  pointerDown({x,y,hit}){
    if(modelingOperationBusy)return true;const h=hit||hitTest(x,y),edge=h?topologyEdgeAt(x,y,h):null;if(edge?.kind!=='edge')return true;const o=objects.find(v=>v.id===edge.objectId);if(!o||!allowObjectEdit(o))return true;const info=geometryApi.threadRim(o.solid,edge.halfEdgeId);if(!info){toast('Thread requires a circular hole rim or circular outer cylinder rim.');return true;}
    const pitch=threadPitchValue(),depth=threadDepthValue(info.kind),length=threadLengthValue(),angle=threadProfileAngleValue(),direction=threadDirectionValue(),operation=threadOperationValue(),sourceSolid=o.solid;syncThreadPresetForKind(info.kind);threadHover={objectId:o.id,halfEdgeId:info.halfEdgeId,halfEdgeIds:info.halfEdgeIds,kind:info.kind,radius:info.radius,maxLength:info.maxLength};
    const diagnostic=threadDiagnosticStart(o,sourceSolid,info,pitch,depth,length,angle,direction,operation),diagnosticStarted=profilerClock(),appendDiagnostic=(category:ModelingDiagnosticCategory,event:string,data:Record<string,unknown>={})=>diagnostic.events.push({category,event,elapsedMs:profilerClock()-diagnosticStarted,data});
    const job=geometryApi.threadEdgeAsync(sourceSolid,info.halfEdgeId,pitch,depth,length,angle,direction,operation,update=>updateModelingOperation(update.progress,update.message),event=>diagnostic.events.push(event));let cancelled=false;
    beginModelingOperation('Working… generating thread',{progress:0,onCancel:()=>{cancelled=true;appendDiagnostic('thread','cancel-requested');threadDiagnosticFinish(diagnostic,'cancelled');job.cancel();}});requestRender();
    void job.promise.then(result=>{if(cancelled)return;appendDiagnostic('thread','commit-start');updateModelingOperation(99,'Committing thread…');applyPreparedEdgeThread(o,sourceSolid,result,info.halfEdgeId,pitch,depth,length,angle,direction,operation);appendDiagnostic('thread','commit-complete',{faces:result.solid.faces.size,halfEdges:result.solid.halfEdges.size});threadDiagnosticFinish(diagnostic,'success');threadHover=null;clearHover();toast(`${operation==='add'?'Add':'Cut'} thread · ${info.kind==='internal'?'hole':'cylinder'} · ${info.rimSegments} aligned segments/turn · pitch ${fmt(pitch)} mm`);}).catch(err=>{const message=errorMessage(err);if(cancelled){threadHover=null;clearHover();toast('Thread generation cancelled.');}else{appendDiagnostic('thread','main-thread-error',{message});threadDiagnosticFinish(diagnostic,'error',message);toast(message);}}).finally(()=>{endModelingOperation();requestRender();});return true;
  }
};
