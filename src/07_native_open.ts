declare const NATIVE_OPEN_WORKER_SOURCE:string;
const NATIVE_OPEN_POLICY=Object.freeze({yieldBudgetMs:8});
class NativeOpenCancelledError extends Error{constructor(){super('Project opening cancelled.');}}
function yieldNativeOpen():Promise<void>{return new Promise(resolve=>setTimeout(resolve,0));}
interface NativeOpenControl {report:(progress:number,message:string)=>void;check:()=>void;registerCancel:(cancel:()=>void)=>void;}
async function prepareNativeOpen(file:File,control:NativeOpenControl):Promise<{project:ValidatedProject;prepared:NativeOpenPreparedObject[]}>{
  if(typeof Worker==='undefined'){
    // Cooperative compatibility path for environments without background workers.
    control.report(1,'Reading project file…');await yieldNativeOpen();control.check();
    const text=await file.text();control.check();control.report(5,'Reading project structure…');await yieldNativeOpen();control.check();
    const data:unknown=JSON.parse(text);validateProjectHeader(data);const source=data,prepared:NativeOpenPreparedObject[]=[];
    for(let i=0;i<source.objects.length;i++){
      control.report(10+60*i/source.objects.length,`Checking geometry · object ${i+1} of ${source.objects.length}…`);await yieldNativeOpen();control.check();
      const object=validateProjectObject(source.objects[i],i);control.report(10+60*(i+.5)/source.objects.length,`Preparing display · object ${i+1} of ${source.objects.length} · ${object.name}`);await yieldNativeOpen();control.check();
      const mesh=solidMeshWorld(object);prepared.push({object,snapshot:serializeObject(object),mesh,bounds:derivedMeshBounds(mesh),appearance:deriveSceneAppearance(mesh)});
    }
    control.report(70,'Checking groups, guides and project references…');await yieldNativeOpen();control.check();
    return {project:finishProjectValidation(source,prepared.map(p=>p.object)),prepared};
  }
  return new Promise((resolve,reject)=>{
    let worker:Worker|null=null,url:string|null=null,settled=false,metadata:NativeOpenMetadata|null=null;const prepared:NativeOpenPreparedObject[]=[];
    const finish=(error?:Error,project?:ValidatedProject)=>{if(settled)return;settled=true;worker?.terminate();if(url)URL.revokeObjectURL(url);if(error)reject(error);else resolve({project:project!,prepared});};
    control.registerCancel(()=>finish(new NativeOpenCancelledError()));
    try{
      control.check();url=URL.createObjectURL(new Blob([NATIVE_OPEN_WORKER_SOURCE],{type:'text/javascript'}));worker=new Worker(url);
      worker.onerror=event=>{event.preventDefault();finish(Error('The project reader stopped: '+event.message));};
      worker.onmessageerror=()=>finish(Error('The project reader returned unreadable data.'));
      worker.onmessage=async(event:MessageEvent<NativeOpenResponse>)=>{
        if(settled)return;
        try{
          control.check();const message=event.data;
          if(message.type==='error'){finish(Error(message.message));return;}
          if(message.type==='progress'){control.report(message.progress,message.message);return;}
          if(message.type==='ready'){metadata=message.metadata;}
          else if(message.type==='object'){
            if(message.index!==prepared.length)throw Error('The project reader returned an unexpected object.');prepared.push(message.prepared);
          }
          if(!metadata)throw Error('The project reader did not return its structure.');
          // Backpressure gives the UI a paint/input opportunity between object transfers.
          await yieldNativeOpen();if(settled)return;control.check();
          if(prepared.length<metadata.objects.length){worker!.postMessage({type:'next',index:prepared.length});return;}
          control.report(70,'Checking groups, guides and project references…');await yieldNativeOpen();if(settled)return;control.check();
          finish(undefined,finishProjectValidation(metadata,prepared.map(p=>p.object)));
        }catch(error){finish(error instanceof Error?error:Error(String(error)));}
      };
      worker.postMessage({type:'start',file});
    }catch(error){finish(error instanceof Error?error:Error(String(error)));}
  });
}
async function captureNativeOpenBefore(control:NativeOpenControl):Promise<HistoryDocumentState>{
  // Capture detached shared geometry versions, yielding between objects.
  const serialized:HistoryModelObject[]=[];
  for(let i=0;i<objects.length;i++){
    control.report(72+18*i/Math.max(1,objects.length),`Preparing Undo · object ${i+1} of ${objects.length}…`);await yieldNativeOpen();control.check();serialized.push(captureHistoryObject(objects[i]));
  }
  control.check();return captureHistoryDocumentState(serialized);
}
// Checked native Open is an atomic document command. Its solids and history were
// staged off-document; neither is deserialized or validated again at commit.
function commitPreparedNativeOpen(project:ValidatedProject,prepared:NativeOpenPreparedObject[],before:HistoryDocumentState):void{
  const first=project.objects.find(isObjectVisible),group=first?project.groups.find(g=>g.objectIds.includes(first.id)):undefined;
  const selection:EntityRef|null=group?{kind:'group',groupId:group.id}:first?{kind:'object',objectId:first.id}:project.guides[0]?{kind:'guide',guideId:project.guides[0].id}:project.dimensions[0]?{kind:'dimension',dimensionId:project.dimensions[0].id}:null;
  const after:HistoryDocumentState={kind:'document-history',buildPlates:project.buildPlates.map(cloneBuildPlate),objects:prepared.map(p=>captureHistoryObject(p.object)),groups:project.groups.map(serializeGroup),guides:project.guides.map(serializeGuide),dimensions:project.dimensions.map(serializeDimension),selection,objectSelection:group?[...group.objectIds]:first?[first.id]:[],projectName:project.name,nextObjectId:inferredNextObjectId(project.objects),nextGroupId:inferredNextGroupId(project.groups),nextGuideId:inferredNextGuideId(project.guides),nextDimensionId:inferredNextDimensionId(project.dimensions)};
  const command:DocumentCommand<void>={type:'load-project',label:'Open project',parameters:{name:project.name,objectCount:project.objects.length},execute(){replaceObjects(project.objects);replaceGroups(project.groups);replaceGuides(project.guides);replaceDimensions(project.dimensions);replaceBuildPlates(project.buildPlates);nextObjectId=after.nextObjectId;nextGroupId=after.nextGroupId;nextGuideId=after.nextGuideId;nextDimensionId=after.nextDimensionId;nextBuildPlateId=inferredNextBuildPlateId();after.nextBuildPlateId=nextBuildPlateId;$('projectName').value=project.name;return {selection,objectSelection:after.objectSelection,surfaceSketch:null};}};
  assertCommandTargetsEditable(command);applyCommandExecution(command.execute()||{});recordHistory(command,before,after);
  sceneGeometry.invalidateAll();for(const p of prepared)sceneGeometry.install(p.object,p.mesh,p.bounds,p.appearance);
  resetObjectListView();modelRevision++;setDirtyState(false);
}
async function openNativeProjectFile(file:File):Promise<void>{
  if(modelingOperationBusy)return;
  if(file.size>PROJECT_READ_POLICY.maximumFileBytes){toast(`The file is too large (maximum ${PROJECT_READ_POLICY.maximumFileBytes/(1024*1024)} MB).`);return;}
  if(dirty&&!confirm('Open the project and replace the current model?'))return;
  prepareToolForDocumentChange();const nameInput=$('projectName') as HTMLInputElement,previousReadOnly=nameInput.readOnly;nameInput.readOnly=true;const revision=modelRevision;let cancelled=false,cancelJob:(()=>void)|null=null,committed=false;
  const control:NativeOpenControl={report:updateModelingOperation,registerCancel:cancel=>{cancelJob=cancel;if(cancelled)cancel();},check:()=>{if(cancelled)throw new NativeOpenCancelledError();if(modelRevision!==revision&&!committed)throw Error('The project changed while opening the file. Open it again.');}};
  nativeOpenRenderSuspended=true;beginModelingOperation('Reading project file…',{progress:0,onCancel:()=>{cancelled=true;cancelJob?.();}});
  try{
    updateUI();await yieldNativeOpen();control.check();const {project,prepared}=await prepareNativeOpen(file,control);control.check();
    const before=await captureNativeOpenBefore(control);control.report(91,'Opening the checked project…');await yieldNativeOpen();control.check();
    // No cancellation or event-loop yield inside the actual document replacement.
    modelingOperationCancel=null;$('modelingBusyCancel').classList.add('hidden');commitPreparedNativeOpen(project,prepared,before);committed=true;activateTool('select');updateUI();fit();
    control.report(94,'Preparing the first view…');await yieldNativeOpen();await prepareNativeOpenScene();
    control.report(100,'Project ready.');await yieldNativeOpen();toast('Project opened.');
  }catch(error){if(error instanceof NativeOpenCancelledError||cancelled)toast('Project opening cancelled. The current project was kept.');else toast((committed?'The project opened, but its view could not be prepared: ':'Could not open the file: ')+errorMessage(error));}
  finally{nameInput.readOnly=previousReadOnly;nativeOpenRenderSuspended=false;endModelingOperation();updateUI();requestRender();}
}
