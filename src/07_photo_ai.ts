// Clipboard handoff and staged native-project addition only.
// Users attach their reference photo directly to their chosen AI.
let photoAiSourceToken=0,photoAiWorking=false;
let checkedPhotoAi:{token:number;revision:number;text:string;project:ValidatedProject}|null=null;
function photoAiError(message:string):void {$('photoAiError').textContent=message;$('photoAiError').classList.toggle('hidden',!message);}
function invalidatePhotoAiCheck():void {
  checkedPhotoAi=null;$('photoAiAdd').disabled=true;$('photoAiSummary').textContent='Choose a result file or paste JSON, then check it.';photoAiError('');
}
function photoAiResultChanged():void {photoAiSourceToken++;photoAiWorking=false;$('photoAiCheck').disabled=false;invalidatePhotoAiCheck();$('photoAiFileInfo').textContent='Pasted JSON';}
function updatePhotoAiPrompt():void {$('photoAiPrompt').value=photoAiPrompt(String($('photoAiNotes').value||''));$('photoAiCopyStatus').textContent='';}
function closePhotoAiSession():void {
  photoAiSourceToken++;photoAiWorking=false;invalidatePhotoAiCheck();$('photoAiResult').value='';$('photoAiResultFile').value='';$('photoAiFileInfo').textContent='';$('photoAiCheck').disabled=false;
}
function openPhotoAi():void {
  if(modelingOperationBusy)return;prepareToolForDocumentChange();closePhotoAiSession();updatePhotoAiPrompt();$('photoAiDialog').showModal();
}
async function selectPhotoAiResultFile(file:File|undefined):Promise<void> {
  const token=++photoAiSourceToken;invalidatePhotoAiCheck();photoAiWorking=false;$('photoAiCheck').disabled=false;if(!file)return;
  $('photoAiResult').value='';$('photoAiFileInfo').textContent='Reading result…';$('photoAiCheck').disabled=true;
  try{
    if(file.size>PROJECT_READ_POLICY.maximumFileBytes)throw Error('The file exceeds the native project file-size limit.');
    const text=await file.text();if(token!==photoAiSourceToken)return;
    $('photoAiResult').value=text;$('photoAiFileInfo').textContent=file.name;
  }catch(error){if(token===photoAiSourceToken){$('photoAiFileInfo').textContent='Could not read the result.';photoAiError(errorMessage(error));}}
  finally{if(token===photoAiSourceToken)$('photoAiCheck').disabled=false;}
}
async function checkPhotoAiResult():Promise<void> {
  if(modelingOperationBusy||photoAiWorking||$('photoAiCheck').disabled)return;
  invalidatePhotoAiCheck();const token=photoAiSourceToken,revision=modelRevision,text=String($('photoAiResult').value||'');photoAiWorking=true;$('photoAiCheck').disabled=true;$('photoAiSummary').textContent='Checking native geometry and groups…';
  try{
    // Allow the status to paint before the ordinary native reader validates.
    await new Promise<void>(resolve=>setTimeout(resolve,0));if(token!==photoAiSourceToken)return;
    const project=parsePhotoAiProject(text);checkProjectAdditionCapacity(project);
    if(token!==photoAiSourceToken)return;if(revision!==modelRevision)throw Error('The project changed during the check. Check the result again.');
    const bounds=sceneBounds(project.objects),size=V.sub(bounds.max,bounds.min),faces=project.objects.reduce((total,object)=>total+geometryApi.faceIds(object.solid).length,0);
    checkedPhotoAi={token,revision,text,project};$('photoAiAdd').disabled=false;
    $('photoAiSummary').textContent=`Check passed · ${project.objects.length} object(s) · ${project.groups.length} group(s) · ${faces.toLocaleString('en-US')} faces · ${size.map(fmt).join(' × ')} mm${project.guides.length||project.dimensions.length?` · ${project.guides.length} guides · ${project.dimensions.length} dimensions`:''}. Ready to add.`;
  }catch(error){if(token===photoAiSourceToken){$('photoAiSummary').textContent='The result was not added.';photoAiError('Check failed: '+errorMessage(error));}}
  finally{if(token===photoAiSourceToken){photoAiWorking=false;$('photoAiCheck').disabled=false;}}
}
function addCheckedPhotoAiResult():void {
  if(modelingOperationBusy||photoAiWorking||!checkedPhotoAi)return;
  try{
    const checked=checkedPhotoAi;if(checked.token!==photoAiSourceToken||checked.revision!==modelRevision||checked.text!==String($('photoAiResult').value||'')){invalidatePhotoAiCheck();throw Error('The project or result changed. Check the result again.');}
    prepareToolForDocumentChange();
    // Teardown can restore a transient Move/Rotate preview and advance revision.
    // Its completion is safe only if the resulting model still matches the check.
    if(checked.revision!==modelRevision){invalidatePhotoAiCheck();throw Error('The pending tool operation changed the project. Check the result again.');}
    const imported=addImportedProject(checked.project,checked.revision);$('photoAiDialog').close();fit();$('saveStatus').textContent='Photo AI result added · save the project to keep it';toast(`Added ${imported.length} editable object(s). One Undo removes the addition.`);
  }catch(error){photoAiError(errorMessage(error));}
}
$('photoAiBtn').onclick=openPhotoAi;
$('photoAiDialog').addEventListener('close',closePhotoAiSession);
$('photoAiClose').onclick=()=>$('photoAiDialog').close();
$('photoAiNotes').oninput=updatePhotoAiPrompt;
$('photoAiCopy').onclick=async()=>{const copied=await writeDebugClipboard(String($('photoAiPrompt').value));$('photoAiCopyStatus').textContent=copied?'Prompt copied. Attach your photo separately.':'Clipboard blocked. Select and copy the prompt below.';};
$('photoAiResult').oninput=photoAiResultChanged;
$('photoAiResultFile').onchange=(event:Event)=>{const input=event.target as HTMLInputElement,file=input.files?.[0];input.value='';void selectPhotoAiResultFile(file);};
$('photoAiCheck').onclick=()=>{void checkPhotoAiResult();};
$('photoAiAdd').onclick=addCheckedPhotoAiResult;
