interface ShininessInputSession {key:string;revision:number;entry:HistoryEntry|null;valid:boolean;selectionRevision:number;}
const shininessSessions=new Map<string,ShininessInputSession>();
function shininessDescription(value:number):string{return `${value} · ${value===0?'Matte':value<35?'Soft sheen':value<75?'Satin':'Glossy'}`;}
function shininessInputTargets(id:string):ObjectId[]{const ids=selectedObjectIds();return id==='selectionShininess'?(ids.length>1?ids:[]):!selectedGroup()&&ids.length===1?ids:[];}
function updateShininessUI():void {
  for(const id of ['objShininess','selectionShininess']){
    const targets=shininessInputTargets(id).map(requireObject),session=shininessSessions.get(id),key=objectColorTargetKey(targets.map(o=>o.id));
    if(session&&(session.key!==key||session.selectionRevision!==objectSelectionRevision))session.valid=false;
    const disabled=modelingOperationBusy||!!pastePlacement||!targets.length||targets.some(isObjectLocked);$(id).disabled=disabled;
    const value=targets.length?objectShininess(targets[0]):0,mixed=targets.some(o=>objectShininess(o)!==value);$(id).value=String(value);
    $(id+'Status').textContent=targets.some(isObjectLocked)?'Unlock all selected objects to change shininess.':mixed?'Mixed shininess — choose one for all':shininessDescription(value);
    $(id).setAttribute('aria-valuetext',mixed?'Mixed shininess':shininessDescription(value));
  }
}
function beginShininessInput(id:string):void{shininessSessions.set(id,{key:objectColorTargetKey(shininessInputTargets(id)),revision:modelRevision,entry:null,valid:true,selectionRevision:objectSelectionRevision});}
function applyShininessInput(id:string):void {
  const ids=shininessInputTargets(id);if(!ids.length||modelingOperationBusy||pastePlacement)return;
  if(!shininessSessions.has(id))beginShininessInput(id);const session=shininessSessions.get(id)!;
  if(!session.valid||session.key!==objectColorTargetKey(ids)||session.selectionRevision!==objectSelectionRevision){toast('The selection changed. Choose shininess again.');updateUI();return;}
  const revision=modelRevision,coalesce=!!session.entry&&session.entry===lastCommandEntry()&&session.revision===revision;
  try{setObjectsShininess(ids,Number($(id).value),coalesce);if(modelRevision!==revision){session.entry=lastCommandEntry();session.revision=modelRevision;}}catch(error){toast(errorMessage(error));updateUI();}
}
for(const id of ['objShininess','selectionShininess']){
  $(id).addEventListener('focus',()=>beginShininessInput(id));$(id).addEventListener('pointerdown',()=>beginShininessInput(id));$(id).addEventListener('input',()=>applyShininessInput(id));
  const finish=()=>{applyShininessInput(id);shininessSessions.delete(id);};
  $(id).addEventListener('change',finish);$(id).addEventListener('pointerup',(event:PointerEvent)=>{if(event.button===0)finish();});
  $(id).addEventListener('keyup',(event:KeyboardEvent)=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key))finish();});
  $(id).addEventListener('pointercancel',()=>shininessSessions.delete(id));$(id).addEventListener('blur',()=>shininessSessions.delete(id));
}
