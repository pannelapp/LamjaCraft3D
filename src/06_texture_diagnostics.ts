// Transient Texture diagnostics. Source snapshots are debug evidence, never
// document state; Undo/Redo must not discard evidence of a failed attempt.
const TEXTURE_DIAGNOSTIC_POLICY=Object.freeze({retainedRuns:4,maximumEvents:2000,recentCommands:12});
type TextureDiagnosticOutcome='running'|'success'|'error'|'cancelled';
interface TextureDiagnosticLog {
  debugFormat:'lamjacraft-3d-texture-diagnostic';
  formatVersion:1;
  appVersion:string;
  runId:number;
  startedAt:string;
  finishedAt?:string;
  outcome:TextureDiagnosticOutcome;
  error?:string;
  environment:{userAgent:string;hardwareConcurrency:number|null};
  object:{id:ObjectId;name:string;kind:string;transform:Transform};
  input:{faceIds:FaceId[];parameters?:SurfaceTextureParameters;fields:Record<string,string>;multiple:boolean;sharedOrigin:boolean;projection:PlaneBasis|null};
  context:{revision:number;targetRevision:number;undoDepth:number;redoDepth:number;recentCommands:{type:string;label:string;parameters:Record<string,unknown>}[]};
  preview:{instances:number;components:number;estimatedFaces:number;complexity:string;sampled:boolean}|null;
  sourceSolid:SerializedSolid;
  // serializeSolid sorts entity IDs. Retain actual Map traversal order as well:
  // CSG visits faces in runtime order, which can differ after Undo/reconstruction.
  sourceOrder:{vertices:VertexId[];halfEdges:HalfEdgeId[];loops:LoopId[];faces:FaceId[]};
  events:ModelingDiagnosticEvent[];
  droppedEvents:number;
}
const textureDiagnosticLogs:TextureDiagnosticLog[]=[];
let textureDiagnosticRunId=0;
function appendTextureDiagnostic(log:TextureDiagnosticLog,event:ModelingDiagnosticEvent){
  if(log.events.length<TEXTURE_DIAGNOSTIC_POLICY.maximumEvents)log.events.push(structuredClone(event));
  else log.droppedEvents++;
}
function textureDiagnosticStart(o:ModelObject,sourceSolid:Solid,faceIds:FaceId[],targetRevision:number):TextureDiagnosticLog {
  const fields:Record<string,string>={};
  for(const id of ['textureMapping','textureBandAxis','textureBandRepeats','textureBandRows','textureType','textureOperation','textureSpacing','textureSize','textureDepth','textureAngle','textureMargin','textureOffsetX','textureOffsetY','textureReferenceX','textureReferenceY','textureReferenceZ'])fields[id]=String(($(id) as HTMLInputElement|null)?.value??'');
  const patch=texturePreviewState?.objectId===o.id?texturePreviewState.patch:null;
  const log:TextureDiagnosticLog={
    debugFormat:'lamjacraft-3d-texture-diagnostic',formatVersion:1,appVersion:appRuntimeVersion(),runId:++textureDiagnosticRunId,startedAt:new Date().toISOString(),outcome:'running',
    environment:{userAgent:typeof navigator==='undefined'?'unknown':navigator.userAgent,hardwareConcurrency:typeof navigator==='undefined'?null:navigator.hardwareConcurrency||null},
    object:{id:o.id,name:o.name,kind:o.kind,transform:structuredClone(o.transform)},
    input:{faceIds:[...faceIds],fields,multiple:textureMultipleEnabled(),sharedOrigin:textureReferenceEnabled(),projection:textureProjectionLocal?structuredClone(textureProjectionLocal):null},
    context:{revision:modelRevision,targetRevision,undoDepth:undoStack.length,redoDepth:redoStack.length,recentCommands:undoStack.slice(-TEXTURE_DIAGNOSTIC_POLICY.recentCommands).map(entry=>({type:entry.type,label:entry.label,parameters:structuredClone(entry.parameters)}))},
    preview:patch?{instances:patch.instances,components:patch.components,estimatedFaces:patch.estimatedFaces,complexity:patch.complexity,sampled:patch.faces.some(face=>!!face.preview.previewTruncated)}:null,
    sourceSolid:geometryApi.serialize(sourceSolid),sourceOrder:{vertices:[...sourceSolid.vertices.keys()],halfEdges:[...sourceSolid.halfEdges.keys()],loops:[...sourceSolid.loops.keys()],faces:[...sourceSolid.faces.keys()]},events:[],droppedEvents:0
  };
  textureDiagnosticLogs.push(log);
  if(textureDiagnosticLogs.length>TEXTURE_DIAGNOSTIC_POLICY.retainedRuns)textureDiagnosticLogs.shift();
  refreshTextureDiagnosticUI();return log;
}
function textureDiagnosticFinish(log:TextureDiagnosticLog,outcome:Exclude<TextureDiagnosticOutcome,'running'>,error?:string){
  log.outcome=outcome;log.finishedAt=new Date().toISOString();if(error)log.error=error;refreshTextureDiagnosticUI();
}
