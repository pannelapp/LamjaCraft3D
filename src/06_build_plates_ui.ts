// Build-plate controls live in a dialog, never in the modeling selection/tools.
let selectedBuildPlateId:string|null=null;
const BUILD_PLATE_FIELD_IDS=['buildPlateName','buildPlateWidth','buildPlateDepth','buildPlateX','buildPlateY','buildPlateColor','buildPlateOpacity','buildPlateVisible'] as const;
function updateBuildPlateUI():void{
  const dialog=$('buildPlateDialog') as HTMLDialogElement;if(!dialog?.open)return;
  $('buildPlateError').textContent='';$('buildPlateError').classList.add('hidden');
  const select=$('buildPlateSelect') as HTMLSelectElement;
  if(!buildPlates.some(p=>p.id===selectedBuildPlateId))selectedBuildPlateId=buildPlates[0]?.id||null;
  select.replaceChildren();
  for(const p of buildPlates){const option=document.createElement('option');option.value=p.id;option.textContent=`${p.name} · ${fmt(p.width)} × ${fmt(p.depth)} mm${p.visible?'':' · hidden'}`;select.append(option);}
  select.value=selectedBuildPlateId||'';select.disabled=!buildPlates.length;
  const plate=buildPlates.find(p=>p.id===selectedBuildPlateId);
  for(const id of BUILD_PLATE_FIELD_IDS)($(id) as HTMLInputElement).disabled=!plate||modelingOperationBusy;
  for(const id of ['buildPlateApply','buildPlateDelete'])($(id) as HTMLButtonElement).disabled=!plate||modelingOperationBusy;
  ($('buildPlateAdd') as HTMLButtonElement).disabled=modelingOperationBusy||buildPlates.length>=BUILD_PLATE_POLICY.maximumPlates;
  $('buildPlateEmpty').classList.toggle('hidden',!!plate);
  if(!plate)return;
  for(const [id,value] of [['buildPlateName',plate.name],['buildPlateWidth',plate.width],['buildPlateDepth',plate.depth],['buildPlateX',plate.x],['buildPlateY',plate.y],['buildPlateColor',plate.color],['buildPlateOpacity',plate.opacity*100]] as const)($(id) as HTMLInputElement).value=String(value);
  ($('buildPlateVisible') as HTMLInputElement).checked=plate.visible;
}
function openBuildPlates():void{
  if(modelingOperationBusy)return;prepareToolForDocumentChange();
  const dialog=$('buildPlateDialog') as HTMLDialogElement;if(!dialog.open)dialog.showModal();updateBuildPlateUI();
}
function showBuildPlateError(error:unknown):void{$('buildPlateError').textContent=errorMessage(error);$('buildPlateError').classList.remove('hidden');}
function buildPlateNumberField(id:string,label:string):number{
  const text=($(id) as HTMLInputElement).value.trim(),value=Number(text);
  if(!text||!Number.isFinite(value))throw Error(`${label} must be a finite number.`);
  return value;
}
function applyBuildPlateFromUI():void{
  if(modelingOperationBusy||!selectedBuildPlateId)return;
  try{updateBuildPlate(selectedBuildPlateId,{name:($('buildPlateName') as HTMLInputElement).value,width:buildPlateNumberField('buildPlateWidth','Width'),depth:buildPlateNumberField('buildPlateDepth','Depth'),x:buildPlateNumberField('buildPlateX','Center X'),y:buildPlateNumberField('buildPlateY','Center Y'),color:($('buildPlateColor') as HTMLInputElement).value,opacity:buildPlateNumberField('buildPlateOpacity','Opacity')/100,visible:($('buildPlateVisible') as HTMLInputElement).checked});updateBuildPlateUI();}catch(error){showBuildPlateError(error);}
}
$('buildPlatesBtn').onclick=openBuildPlates;
$('buildPlateSelect').onchange=()=>{selectedBuildPlateId=($('buildPlateSelect') as HTMLSelectElement).value||null;updateBuildPlateUI();};
$('buildPlateAdd').onclick=()=>{if(modelingOperationBusy)return;try{selectedBuildPlateId=createBuildPlate().id;updateBuildPlateUI();}catch(error){showBuildPlateError(error);}};
$('buildPlateApply').onclick=applyBuildPlateFromUI;
$('buildPlateDelete').onclick=()=>{if(modelingOperationBusy||!selectedBuildPlateId)return;try{removeBuildPlate(selectedBuildPlateId);selectedBuildPlateId=null;updateBuildPlateUI();}catch(error){showBuildPlateError(error);}};
$('buildPlateClose').onclick=()=>($('buildPlateDialog') as HTMLDialogElement).close();
$('buildPlateDialog').addEventListener('close',()=>{$('buildPlatesBtn').focus();});
