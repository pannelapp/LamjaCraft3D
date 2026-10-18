// Mesh import evidence is transient. Keep the beginning and a rolling tail so
// a long run cannot displace either its settings or its final failure/stack.
const IMPORT_DIAGNOSTIC_POLICY=Object.freeze({retainedRuns:4,maximumEvents:1000,preservedFirstEvents:24,maximumArrayItems:64,maximumStringLength:1024,maximumDepth:8});
interface ImportDiagnosticLog {
  debugFormat:'lamjacraft-3d-import-diagnostic';formatVersion:1;appVersion:string;runId:number;
  startedAt:string;finishedAt?:string;outcome:'running'|'success'|'error'|'cancelled';error?:string;
  environment:{userAgent:string;hardwareConcurrency:number|null};
  input:{fileName:string;format:'obj'|'stl'|'skp';bytes:number;materials:{name:string;characters:number}[];units:string;scaleField:string;scale?:number;repairOpenings:boolean;keepTouchingPartsSeparate:boolean;ignoreIsolatedOpenSurfaces:boolean};
  context:{revision:number;objects:number;undoDepth:number;redoDepth:number};
  events:ModelingDiagnosticEvent[];droppedEvents:number;lastStage:string;
}
const importDiagnosticLogs:ImportDiagnosticLog[]=[];
let importDiagnosticRunId=0;
function importDiagnosticValue(value:unknown,depth=0):unknown {
  if(typeof value==='string')return value.length>IMPORT_DIAGNOSTIC_POLICY.maximumStringLength?value.slice(0,IMPORT_DIAGNOSTIC_POLICY.maximumStringLength)+'… [truncated]':value;
  if(value===null||typeof value!=='object')return value;
  if(depth>=IMPORT_DIAGNOSTIC_POLICY.maximumDepth)return '[depth limit]';
  if(Array.isArray(value)){const result=value.slice(0,IMPORT_DIAGNOSTIC_POLICY.maximumArrayItems).map(item=>importDiagnosticValue(item,depth+1));if(value.length>result.length)result.push({omittedItems:value.length-result.length});return result;}
  const result:Record<string,unknown>={};for(const [key,item] of Object.entries(value))result[key]=importDiagnosticValue(item,depth+1);return result;
}
function appendImportDiagnostic(log:ImportDiagnosticLog,event:ModelingDiagnosticEvent):void {
  const copy:ModelingDiagnosticEvent={...event,data:importDiagnosticValue(event.data) as Record<string,unknown>};
  if(log.events.length>=IMPORT_DIAGNOSTIC_POLICY.maximumEvents){log.events.splice(IMPORT_DIAGNOSTIC_POLICY.preservedFirstEvents,1);log.droppedEvents++;}
  log.events.push(copy);if(event.category==='import'&&!['check-error','cancel-requested','commit-complete','commit-rejected'].includes(event.event))log.lastStage=event.event;refreshImportDiagnosticUI();
}
function importDiagnosticNote(log:ImportDiagnosticLog,event:string,data:Record<string,unknown>={}):void {
  appendImportDiagnostic(log,{category:'import',event,elapsedMs:Date.now()-Date.parse(log.startedAt),data});
}
function startImportDiagnostic(source:MeshImportSource):ImportDiagnosticLog {
  const log:ImportDiagnosticLog={debugFormat:'lamjacraft-3d-import-diagnostic',formatVersion:1,appVersion:appRuntimeVersion(),runId:++importDiagnosticRunId,startedAt:new Date().toISOString(),outcome:'running',environment:{userAgent:typeof navigator==='undefined'?'unknown':navigator.userAgent,hardwareConcurrency:typeof navigator==='undefined'?null:navigator.hardwareConcurrency||null},input:{fileName:source.fileName,format:source.format,bytes:source.buffer.byteLength,materials:source.materials.map(file=>({name:file.name,characters:file.text.length})),units:source.format==='skp'?'skp-native-inch':$('importUnits').value,scaleField:source.format==='skp'?$('skpScaleMode').value:$('importScale').value,repairOpenings:!!$('importRepair').checked,keepTouchingPartsSeparate:source.format==='stl'&&!!$('importKeepTouchingSeparate').checked,ignoreIsolatedOpenSurfaces:source.format!=='skp'&&!!$('importIgnoreOpenSurfaces').checked},context:{revision:modelRevision,objects:objects.length,undoDepth:undoStack.length,redoDepth:redoStack.length},events:[],droppedEvents:0,lastStage:'check-start'};
  importDiagnosticLogs.push(log);if(importDiagnosticLogs.length>IMPORT_DIAGNOSTIC_POLICY.retainedRuns)importDiagnosticLogs.shift();
  importDiagnosticNote(log,'check-start');return log;
}
function finishImportDiagnostic(log:ImportDiagnosticLog,outcome:'success'|'error'|'cancelled',error?:unknown):void {
  log.outcome=outcome;log.finishedAt=new Date().toISOString();if(error!==undefined){log.error=errorMessage(error);importDiagnosticNote(log,'check-error',{message:log.error,stack:error instanceof Error?error.stack||null:null,failedStage:log.lastStage});}
  refreshImportDiagnosticUI();
}
function refreshImportDiagnosticUI():void {
  const last=importDiagnosticLogs.at(-1),status=$('importDiagnosticStatus');
  for(const id of ['downloadImportDiagnostic','downloadImportDiagnostics'])$(id).disabled=!last;
  $('clearImportDiagnostics').disabled=!last||importDiagnosticLogs.some(log=>log.outcome==='running');
  if(status)status.textContent=last?`${last.outcome==='success'?'Check passed':last.outcome==='error'?'Failed':last.outcome==='cancelled'?'Cancelled':'Running'} · ${importDiagnosticLogs.length}/${IMPORT_DIAGNOSTIC_POLICY.retainedRuns} runs · ${last.events.length} events${last.droppedEvents?' · older events truncated':''}`:'No run recorded';
  $('importDiagnosticStage').textContent=last?`Last stage: ${last.lastStage}${last.error?'\n'+last.error:''}`:'';
}
function downloadImportDiagnostics(recent:boolean):void {
  const last=importDiagnosticLogs.at(-1);if(!last){toast('No Import diagnostic log is available yet.');return;}
  const data=recent?{debugFormat:'lamjacraft-3d-import-diagnostics',formatVersion:1,capturedAt:new Date().toISOString(),retainedLimit:IMPORT_DIAGNOSTIC_POLICY.retainedRuns,runs:importDiagnosticLogs}:last,text=JSON.stringify(data,null,2),stamp=(last.finishedAt||last.startedAt).replace(/[:.]/g,'-');
  download(new Blob([text],{type:'application/json'}),`LamjaCraft-import-${recent?'diagnostics':'diagnostic'}-${stamp}.json`);toast('Import log downloaded. Attach the original source file as well.');
}
$('downloadImportDiagnostic').onclick=()=>downloadImportDiagnostics(false);
$('downloadImportDiagnostics').onclick=()=>downloadImportDiagnostics(true);
$('clearImportDiagnostics').onclick=()=>{if(importDiagnosticLogs.some(log=>log.outcome==='running'))return;importDiagnosticLogs.length=0;refreshImportDiagnosticUI();};
refreshImportDiagnosticUI();
