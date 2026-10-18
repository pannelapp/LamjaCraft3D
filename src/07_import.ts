type MeshImportSource={kind:'mesh';fileName:string;format:'stl'|'obj'|'skp'}&Omit<MeshImportRequest,'type'|'format'|'scale'|'repairOpenings'|'keepTouchingPartsSeparate'|'ignoreIsolatedOpenSurfaces'>;
type NativeImportSource={kind:'project';name:string;text:string};
type ImportSource=MeshImportSource|NativeImportSource;
let importSource:ImportSource|null=null,importSourceToken=0;
let checkedImport:({kind:'mesh';token:number;revision:number;scale:number;repairOpenings:boolean;keepTouchingPartsSeparate:boolean;ignoreIsolatedOpenSurfaces:boolean;result:MeshImportResult;diagnostic:ImportDiagnosticLog}|{kind:'project';token:number;revision:number;project:ValidatedProject})|null=null;
function showImportError(message:string){$('importError').textContent=message;$('importError').classList.remove('hidden');}
function clearImportError(){$('importError').textContent='';$('importError').classList.add('hidden');}
function invalidateImportCheck(){checkedImport=null;$('commitImport').disabled=true;$('importSummary').textContent=importSource?.kind==='project'?'Check the native project, then add it to this project.':importSource?'Choose scale, then check geometry.':'';$('importWarnings').textContent='';clearImportError();}
function updateImportSourceUI():void{const native=importSource?.kind==='project',skp=importSource?.kind==='mesh'&&importSource.format==='skp';$('stlContactSettings').classList.toggle('hidden',importSource?.kind!=='mesh'||importSource.format!=='stl');$('meshImportSettings').classList.toggle('hidden',native||skp);$('skpScaleSettings').classList.toggle('hidden',!skp);$('nativeImportNote').classList.toggle('hidden',!native);$('skpImportNote').classList.toggle('hidden',!skp);$('checkImport').textContent=native?'Check project':'Check geometry';$('commitImport').textContent=native?'Import project':'Import objects';}
function clearImportSession(){importSourceToken++;importSource=null;invalidateImportCheck();updateImportSourceUI();}
function importScaleValue():number{if(importSource?.kind==='mesh'&&importSource.format==='skp')return importScale(Number($('skpScaleMode').value));const unit=$('importUnits').value;return importScale(unit==='m'?1000:unit==='in'?25.4:unit==='custom'?Number($('importScale').value):1);}
function importSettingsChanged(){if(!importSource||importSource.kind==='project')return;if(importSource.format!=='skp')$('importScale').disabled=$('importUnits').value!=='custom';importSourceToken++;invalidateImportCheck();}
async function selectImportFiles(files:readonly File[]){
  if(modelingOperationBusy)return;const token=++importSourceToken;importSource=null;invalidateImportCheck();updateImportSourceUI();if(!files.length)return;
  $('importDialog').showModal();$('importFileInfo').textContent='Reading selected files…';$('checkImport').disabled=true;
  try{
    if(files.length===1&&/\.json$/i.test(files[0].name)){await selectNativeImportFile(files[0],token);return;}
    const geometryFiles=files.filter(file=>/\.(obj|stl|skp)$/i.test(file.name)),materials=files.filter(file=>/\.mtl$/i.test(file.name));
    if(geometryFiles.length!==1||geometryFiles.length+materials.length!==files.length)throw Error('Select one OBJ or STL with optional OBJ materials, one SKP, or one .lamjacraft.json project. Extract OBJ ZIP files first.');
    if(files.some(file=>file.size>MESH_IMPORT_POLICY.maximumFileBytes)||files.reduce((sum,file)=>sum+file.size,0)>MESH_IMPORT_POLICY.maximumBatchBytes)throw Error(`Import supports at most ${MESH_IMPORT_POLICY.maximumFileBytes/(1024*1024)} MB per file and ${MESH_IMPORT_POLICY.maximumBatchBytes/(1024*1024)} MB in total.`);
    const geometry=geometryFiles[0],format=/\.skp$/i.test(geometry.name)?'skp':/\.obj$/i.test(geometry.name)?'obj':'stl';if(format!=='obj'&&materials.length)throw Error('MTL files can only accompany an OBJ file.');
    const buffer=await geometry.arrayBuffer(),materialData=await Promise.all(materials.map(async file=>({name:file.name,text:await file.text()})));if(token!==importSourceToken)return;
    importSource={kind:'mesh',fileName:geometry.name,format,name:geometry.name.replace(/\.(obj|stl|skp)$/i,'').trim().slice(0,72)||'Imported object',buffer,materials:materialData};$('importUnits').value='mm';$('importScale').value='1';$('skpScaleMode').value='1';$('importScale').disabled=true;$('importRepair').checked=false;$('importKeepTouchingSeparate').checked=true;$('importIgnoreOpenSurfaces').checked=false;
    $('importFileInfo').textContent=`${geometry.name} · ${format.toUpperCase()}${materials.length?` · ${materials.length} material file${materials.length===1?'':'s'}`:''}`;$('checkImport').disabled=false;invalidateImportCheck();updateImportSourceUI();
  }catch(error){if(token!==importSourceToken)return;$('importFileInfo').textContent='The selected files could not be prepared.';showImportError(errorMessage(error));}
}
async function checkPendingImport(){
  if(modelingOperationBusy||!importSource)return;if(importSource.kind==='project'){await checkPendingNativeImport();return;}if(importSource.format==='skp'){await checkPendingSKPImport();return;}invalidateImportCheck();const diagnostic=startImportDiagnostic(importSource);let scale:number;try{scale=importScaleValue();diagnostic.input.scale=scale;}catch(error){finishImportDiagnostic(diagnostic,'error',error);showImportError(errorMessage(error));return;}
  const token=importSourceToken,revision=modelRevision,repairOpenings=!!$('importRepair').checked,keepTouchingPartsSeparate=importSource.format==='stl'&&!!$('importKeepTouchingSeparate').checked,ignoreIsolatedOpenSurfaces=!!$('importIgnoreOpenSurfaces').checked,request:MeshImportRequest={format:importSource.format,name:importSource.name,buffer:importSource.buffer,materials:importSource.materials,type:'mesh-import',scale,repairOpenings,keepTouchingPartsSeparate,ignoreIsolatedOpenSurfaces};let cancelled=false,job:GeometryImportJob|null=null;
  $('importDialog').close();beginModelingOperation('Checking import geometry…',{progress:0,onCancel:()=>{cancelled=true;importDiagnosticNote(diagnostic,'cancel-requested');job?.cancel();}});
  try{
    job=geometryApi.prepareImportAsync(request,update=>updateModelingOperation(update.progress,update.message),event=>appendImportDiagnostic(diagnostic,event));const result=await job.promise;
    if(cancelled){finishImportDiagnostic(diagnostic,'cancelled');return;}if(token!==importSourceToken||revision!==modelRevision)throw Error('The import settings or project changed during the check. Check geometry again.');
    if(objects.length+result.items.length>PROJECT_CAPACITY_POLICY.maximumObjects)throw Error(`Import would exceed the project limit of ${PROJECT_CAPACITY_POLICY.maximumObjects} objects.`);
    if(!result.items.length)throw Error('No valid import geometry was produced.');
    const bounds=result.items.map(item=>geometryApi.bounds(item.solid)),size=[0,1,2].map(axis=>Math.max(...bounds.map(b=>b.max[axis]))-Math.min(...bounds.map(b=>b.min[axis]))),faces=result.items.reduce((sum,item)=>sum+geometryApi.faceIds(item.solid).length,0);
    const surfaceCount=result.items.filter(item=>item.kind==='surface').length,solidCount=result.items.length-surfaceCount;importDiagnosticNote(diagnostic,'check-accepted',{solids:solidCount,openSurfaces:surfaceCount,faces,sizeMM:size,triangles:result.triangleCount,repairedOpenings:result.repairedOpenings,warnings:result.warnings});finishImportDiagnostic(diagnostic,'success');
    checkedImport={kind:'mesh',token,revision,scale,repairOpenings,keepTouchingPartsSeparate,ignoreIsolatedOpenSurfaces,result,diagnostic};$('commitImport').disabled=false;$('importSummary').textContent=`Geometry check passed · ${solidCount} editable solid${solidCount===1?'':'s'} · ${surfaceCount} limited open surface${surfaceCount===1?'':'s'} · ${faces.toLocaleString('en-US')} faces · ${size.map(fmt).join(' × ')} mm`;
    $('importWarnings').textContent=[result.repairedOpenings?`Repair: ${result.repairedOpenings} planar opening${result.repairedOpenings===1?'':'s'} closed.`:'',...result.warnings].filter(Boolean).join('\n');
  }catch(error){finishImportDiagnostic(diagnostic,cancelled?'cancelled':'error',cancelled?undefined:error);if(cancelled){$('importSummary').textContent='Geometry check cancelled. No objects were imported.';}else showImportError('Geometry check failed: '+errorMessage(error)+' Import log available in Debug.');}
  finally{endModelingOperation();if(token===importSourceToken&&!$('importDialog').open)$('importDialog').showModal();}
}
async function checkPendingSKPImport():Promise<void>{
  if(modelingOperationBusy||!importSource||importSource.kind!=='mesh'||importSource.format!=='skp')return;
  invalidateImportCheck();const source=importSource,diagnostic=startImportDiagnostic(source),token=importSourceToken,revision=modelRevision;let cancelled=false;
  $('importDialog').close();beginModelingOperation('Checking SKP geometry…',{progress:0,onCancel:()=>{cancelled=true;importDiagnosticNote(diagnostic,'cancel-requested');}});
  try{
    // Native SKP geometry is in inches; the parser converts directly to mm, then applies
    // an explicit optional rescale for STL exports written as unitless metres. No STL buffer or external library is used.
    const scale=importScaleValue();diagnostic.input.scale=scale;
    await new Promise<void>(resolve=>setTimeout(resolve,0));
    const result=await prepareSKPImport(source.buffer,source.fileName,(progress,message)=>updateModelingOperation(progress,message),scale);
    if(cancelled){finishImportDiagnostic(diagnostic,'cancelled');return;}
    if(token!==importSourceToken||revision!==modelRevision)throw Error('The project changed during SKP import. Please check again.');
    if(objects.length+result.items.length>PROJECT_CAPACITY_POLICY.maximumObjects)throw Error(`The current project has ${objects.length} object(s); this SKP would add ${result.items.length}. The project limit is ${PROJECT_CAPACITY_POLICY.maximumObjects}. Use New for an empty project.`);
    const bounds=result.items.map(item=>geometryApi.bounds(item.solid)),size=[0,1,2].map(axis=>Math.max(...bounds.map(b=>b.max[axis]))-Math.min(...bounds.map(b=>b.min[axis]))),faces=result.items.reduce((n,item)=>n+item.solid.faces.size,0),surfaceCount=result.items.filter(item=>item.kind==='surface').length,solidCount=result.items.length-surfaceCount;
    importDiagnosticNote(diagnostic,'check-accepted',{format:'skp',solids:solidCount,openSurfaces:surfaceCount,faces,sizeMM:size,warnings:result.warnings});finishImportDiagnostic(diagnostic,'success');
    checkedImport={kind:'mesh',token,revision,scale,repairOpenings:false,keepTouchingPartsSeparate:false,ignoreIsolatedOpenSurfaces:false,result,diagnostic};
    $('commitImport').disabled=false;$('importSummary').textContent=`SKP check passed · ${solidCount} editable solid${solidCount===1?'':'s'} · ${surfaceCount} limited open surface${surfaceCount===1?'':'s'} · ${faces.toLocaleString('en-US')} polygon faces · ${size.map(fmt).join(' × ')} mm`;
    $('importWarnings').textContent=result.warnings.join('\n');
  }catch(error){finishImportDiagnostic(diagnostic,cancelled?'cancelled':'error',cancelled?undefined:error);if(cancelled)$('importSummary').textContent='SKP check cancelled. Nothing imported.';else showImportError('SKP geometry check failed: '+errorMessage(error)+' Import log available in Debug.');}
  finally{endModelingOperation();if(token===importSourceToken&&!$('importDialog').open)$('importDialog').showModal();}
}
function commitCheckedImport(){
  if(modelingOperationBusy||!checkedImport)return;if(checkedImport.kind==='project'){commitCheckedNativeImport();return;}
  const diagnostic=checkedImport.diagnostic;
  try{const checked=checkedImport;if(checked.token!==importSourceToken||checked.revision!==modelRevision||checked.scale!==importScaleValue()||checked.repairOpenings!==!!$('importRepair').checked||checked.keepTouchingPartsSeparate!==(importSource?.kind==='mesh'&&importSource.format==='stl'&&!!$('importKeepTouchingSeparate').checked)||checked.ignoreIsolatedOpenSurfaces!==(importSource?.kind==='mesh'&&importSource.format!=='skp'&&!!$('importIgnoreOpenSurfaces').checked)){invalidateImportCheck();throw Error('The project or import settings changed. Check geometry again.');}
    prepareToolForDocumentChange();const imported=addImportedMeshItems(checked.result);importDiagnosticNote(diagnostic,'commit-complete',{objectsAdded:imported.length,revision:modelRevision});$('importDialog').close();clearImportSession();fit();$('saveStatus').textContent='Geometry imported · save the project to keep it';toast(`Imported ${imported.filter(o=>o.kind==='solid').length} editable solid(s) and ${imported.filter(o=>o.kind==='surface').length} limited open surface(s). One Undo removes the import.`);
  }catch(error){importDiagnosticNote(diagnostic,'commit-rejected',{message:errorMessage(error)});showImportError(errorMessage(error));}
}
$('stlInput').onchange=(event:Event)=>{const input=event.target as HTMLInputElement,files=Array.from(input.files||[]);input.value='';void selectImportFiles(files);};
$('importSTLBtn').onclick=()=>{if(!modelingOperationBusy)$('stlInput').click();};$('importUnits').onchange=importSettingsChanged;$('skpScaleMode').onchange=importSettingsChanged;$('importScale').oninput=importSettingsChanged;$('importRepair').onchange=importSettingsChanged;$('importKeepTouchingSeparate').onchange=importSettingsChanged;$('importIgnoreOpenSurfaces').onchange=importSettingsChanged;
$('checkImport').onclick=()=>{void checkPendingImport();};$('commitImport').onclick=commitCheckedImport;$('cancelImport').onclick=()=>{clearImportSession();$('importDialog').close();};$('importDialog').addEventListener('cancel',clearImportSession);
