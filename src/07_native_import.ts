// The native reader and document merge are shared with Open and Photo AI.
// This adapter stages an addition; it never replaces the current document.
async function selectNativeImportFile(file:File,token:number):Promise<void>{
  if(file.size>PROJECT_READ_POLICY.maximumFileBytes)throw Error(`The project file exceeds ${PROJECT_READ_POLICY.maximumFileBytes/(1024*1024)} MB.`);
  const text=await file.text();if(token!==importSourceToken)return;
  prepareToolForDocumentChange();
  importSource={kind:'project',name:file.name,text};$('importFileInfo').textContent=`${file.name} · LamjaCraft project · millimeters`;
  $('checkImport').disabled=false;invalidateImportCheck();updateImportSourceUI();
}
async function checkPendingNativeImport():Promise<void>{
  if(modelingOperationBusy||importSource?.kind!=='project')return;
  const source=importSource,token=importSourceToken,revision=modelRevision;let cancelled=false;
  invalidateImportCheck();$('importDialog').close();beginModelingOperation('Checking native project…',{progress:0,onCancel:()=>{cancelled=true;}});
  try{
    // Paint the status first; use the same strict format-7/8/9/10 reader as Open.
    await new Promise<void>(resolve=>setTimeout(resolve,0));if(cancelled||token!==importSourceToken)return;
    const data:unknown=JSON.parse(source.text);
    if(typeof data!=='object'||data===null||!('format' in data)||data.format!=='lamjacraft-3d')throw Error('Import requires a LamjaCraft 3D project (.lamjacraft.json).');
    const project=validateProject(data);validateProjectReferenceCoordinates(project);checkProjectAdditionCapacity(project,'native');
    if(cancelled)return;if(token!==importSourceToken||revision!==modelRevision)throw Error('The project or import source changed. Check the project again.');
    checkedImport={kind:'project',token,revision,project};$('commitImport').disabled=false;
    const counts=[`${project.objects.length} objects`,`${project.groups.length} groups`,`${project.guides.length} guides`,`${project.dimensions.length} dimensions`,`${project.buildPlates.length} build plates`];
    $('importSummary').textContent='Project check passed · '+counts.join(' · ')+'. Ready to add.';
    $('importWarnings').textContent='Coordinates are preserved in millimeters. Imported objects may overlap existing objects; they remain separate.';
  }catch(error){if(token===importSourceToken)showImportError('Project check failed: '+errorMessage(error));}
  finally{
    if(cancelled&&token===importSourceToken)$('importSummary').textContent='Project check cancelled. No contents were imported.';
    endModelingOperation();if(token===importSourceToken&&!$('importDialog').open)$('importDialog').showModal();
  }
}
function commitCheckedNativeImport():void{
  if(modelingOperationBusy||checkedImport?.kind!=='project')return;
  try{
    const checked=checkedImport;
    if(importSource?.kind!=='project'||checked.token!==importSourceToken||checked.revision!==modelRevision){invalidateImportCheck();throw Error('The project or import source changed. Check the project again.');}
    prepareToolForDocumentChange();
    if(checked.revision!==modelRevision){invalidateImportCheck();throw Error('The pending tool operation changed the project. Check the project again.');}
    const imported=addImportedProject(checked.project,checked.revision,'native');$('importDialog').close();clearImportSession();if(imported.length)fit();
    $('saveStatus').textContent='Project contents imported · save the project to keep them';toast('Project contents added. One Undo removes the import.');
  }catch(error){showImportError(errorMessage(error));}
}
