import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..');let workers=0;
class UnexpectedWorker{constructor(){workers++;throw Error('A locked target must not start a worker');}}
function fixture(){
 const f=createAppFixture(root,UnexpectedWorker),run=code=>vm.runInContext(code,f.sandbox),plain=value=>JSON.parse(JSON.stringify(value));
 run("addObject('box');objects[1].transform.position=[70,0,0];addObject('box');objects[2].transform.position=[140,0,0];selectObject(objects[0]);undoStack=[];redoStack=[];setView('top');camera.target=[0,0,15];camera.distance=180;cameraBasis();updateUI()");
 const ids=plain(run('objects.map(o=>o.id)')),state=()=>run('JSON.stringify(projectData())'),history=()=>run('undoStack.length');
 const lock=(id=ids[0])=>f.get('objectList').children.flatMap(row=>row.children).find(button=>button.dataset.lockIds===id);
 const blocked=code=>{const before=state(),h=history();assert.throws(()=>run(code),/locked|object locks/);assert.equal(state(),before,code);assert.equal(history(),h,code);};
 const key=(key,extra={})=>{f.sandbox.ev={key,preventDefault(){},...extra};run('handleApplicationKeyDown(ev)');};
 return {...f,run,plain,ids,state,history,lock,blocked,key};
}
// Real panel controls, defaults, selection, Undo/Redo, properties and command protection.
{
 const {run,plain,get,ids,state,history,lock,blocked,key}=fixture();
 assert.equal(run('objects.some(isObjectLocked)'),false);assert.equal(lock().getAttribute('aria-pressed'),'false');assert.match(lock().title,/Lock object/);
 const solid=run('objects[0].solid'),before=state();lock().onclick();assert.equal(run('objects[0].solid'),solid);assert.equal(run('isObjectLocked(objects[0])'),true);assert.equal(history(),1);assert.equal(run('lastCommandEntry().type'),'set-objects-locked');assert.equal(lock().getAttribute('aria-pressed'),'true');assert.match(lock().innerHTML,/<svg/);assert.equal(get('objName').disabled,true);assert.equal(get('applyFace').disabled,true);get('pushTwistAngle').value='0';get('pushTwistAngle').listeners.input[0]();assert.equal(get('maxInsetBtn').disabled,true,'Changing transient Twist settings re-enabled a locked geometry action');assert.equal(get('groundBtn').disabled,true);assert.equal(get('deleteBtn').disabled,true);assert.equal(get('duplicateBtn').disabled,false);assert.equal(get('checkObjectBtn').disabled,false);assert.match(get('objectLockStatus').textContent,/Locked/);
 const after=state();run('undo()');assert.equal(state(),before);run('redo()');assert.equal(state(),after);
 for(const code of [
  "setObjectTransform(objects[0],{position:[2,3,4],rotation:[0,0,0]})",
  "setObjectTransform(objects[0],{position:[0,0,0],rotation:[0,0,30]},'rotate-object')",
  'scaleObjectUniform(objects[0],2)', 'putOnGround(objects[0])', "setObjectColor(objects[0],'#334455',true)",
  "applyObjectProperties(objects[0],{name:'Changed',dimensions:[20,20,20],position:[0,0,0],rotation:[0,0,0],color:'#123456'})",
  'removeObjectById(objects[0].id)', "applyFaceMove(objects[0],geometryApi.faceIds(objects[0].solid)[0],2)",
 ])blocked(code);
 // Future commands cannot bypass locks even without declared target parameters.
 for(const mutation of ["objects[0].name='Changed'", "objects[0].color='#111111'", 'objects[0].transform.position[0]=99', 'objects[0].solid.vertices.values().next().value.position[0]+=1', 'objects.splice(0,1)', 'objects[0].locked=false'])blocked(`executeDocumentCommand({type:'future-edit',label:'Future edit',parameters:{},execute(){${mutation};return {};}})`);
 run('selectObject(objects[0]);updateUI()');get('objColor').value='#765432';get('objColor').listeners.input[0]();assert.equal(state(),after);key('Delete');assert.equal(state(),after);assert.equal(history(),1);
 // Read-only input, visibility and duplication remain available.
 assert.equal(run('hitTest(W/2,H/2).id'),ids[0]);assert.ok(run('allWorldEdges().some(e=>e.source?.objectId===objects[0].id)'));assert.equal(run('geometryApi.validate(objects[0].solid,false).ok'),true);
 run("$('exportScope').value='selected'");assert.deepEqual(plain(run('exportObjects().map(o=>o.id)')),[ids[0]]);
 run('setObjectsVisible([objects[0].id],false)');assert.equal(run('objects[0].locked'),true);assert.equal(lock().disabled,false);lock().onclick();assert.equal(run('objects[0].locked'),false);run('undo();showAllObjects();selectObject(objects[0]);duplicateObject()');assert.equal(run('objects[0].locked'),true);assert.equal(run('objects.at(-1).locked'),false);assert.equal(run('objects.at(-1).solid===objects[0].solid'),false);
}
// Atomic mixed selection/group edits, including hidden members. Organization is permitted.
{
 const {run,plain,get,ids,state,history,lock,blocked,key}=fixture();
 run('setObjectSelection(objects.slice(0,2).map(o=>o.id));createGroupFromSelection();setObjectsLocked([objects[1].id],true)');
 const group=run('groups[0].id');assert.equal(lock(ids.slice(0,2).join(',')).getAttribute('aria-pressed'),'mixed');assert.equal(get('scaleGroupBtn').disabled,true);assert.equal(get('deleteGroupBtn').disabled,true);assert.equal(get('ungroupBtn').disabled,false);
 for(const code of ['scaleGroupUniform(groups[0].id,2)','putGroupOnGround(groups[0].id)','removeGroupById(groups[0].id)',"setGroupTransforms(groups[0].id,snapshotObjectTransforms(groups[0].objectIds).map(t=>({...t,position:[1,2,3]})),'move-group')"])blocked(code);
 run("dimensions.push({id:'lock-dimension',kind:'linear',a:{kind:'vertex',objectId:objects[1].id,vertexId:[...objects[1].solid.vertices.keys()][0],fallback:[70,0,0]},b:{kind:'world',point:[200,200,0]}});guides.push({id:'lock-guide',kind:'point',point:[200,200,0]});setObjectsVisible([objects[1].id],false);setGroupSelection(groups[0],[objects[2].id]);updateUI()");const before=state(),h=history();key('Delete');assert.equal(state(),before);assert.equal(history(),h);assert.equal(run('objects.length'),3);assert.equal(run('groups[0].objectIds.length'),2);
 run("setAxis('x')");assert.equal(run('moveToolController.numericSeed()'),false);assert.equal(run('pointer'),null);run("rotationPlaneMode='world-xy'");assert.equal(run('rotateToolController.numericSeed()'),false);
 run("renameGroup(groups[0].id,'Assembly');duplicateGroup(groups[0].id)");assert.equal(run('groupMemberObjects(groups[1]).some(isObjectLocked)'),false);assert.equal(run('groups[0].id'),group);
 run('setGroupSelection(groups[0]);ungroupById(groups[0].id)');assert.equal(run('objects[1].locked'),true);
 run('showAllObjects();setObjectSelection(objects.slice(0,3).map(o=>o.id));updateUI()');assert.equal(get('deleteSelectedObjectsBtn').disabled,true);blocked('removeSelectedObjects()');assert.equal(run('objects.length'),5);
 // A group button locks all in one command, then unlocks all in one command.
 run('setObjectSelection(objects.slice(0,2).map(o=>o.id));createGroupFromSelection()');const groupButton=()=>lock(ids.slice(0,2).join(','));const n=history();groupButton().onclick();assert.equal(history(),n+1);assert.equal(groupButton().getAttribute('aria-pressed'),'true');assert.deepEqual(plain(run('objects.slice(0,2).map(isObjectLocked)')),[true,true]);groupButton().onclick();assert.deepEqual(plain(run('objects.slice(0,2).map(isObjectLocked)')),[false,false]);run('undo()');assert.deepEqual(plain(run('objects.slice(0,2).map(isObjectLocked)')),[true,true]);
}
// Mouse, numeric, model previews, expensive jobs and pending-gesture cancellation.
{
 const {run,plain,sandbox,lock,state,history,get}=fixture();lock().onclick();const before=state(),h=history();
 const hit=plain(run('hitTest(W/2,H/2)'));assert.ok(hit);sandbox.hit=hit;
 const input={event:{button:0,buttons:1,pointerId:1,clientX:400,clientY:300},x:400,y:300,hit,rawHit:hit};sandbox.input=input;sandbox.ev=input.event;
 for(const name of ['move','rotate','push','rect','circle','gear','rack','slot','arcslot','boltcircle','arc','poly','chamfer','roundchamfer','thread','texture','mergefaces','carve']){
  sandbox.toolName=name;run('setTool(toolName);dispatchToolPointerDown(ev)');assert.equal(run('pointer'),null,name);assert.equal(state(),before,name);assert.equal(history(),h,name);run('updateToolHoverFeedback(activeToolController(),400,300)');assert.match(get('coordinates').textContent,/locked/,name);
 }
 run("setTool('move');setAxis('x')");assert.equal(run('moveToolController.numericSeed()'),false);run("setTool('rotate');rotationPlaneMode='world-xy'");assert.equal(run('rotateToolController.numericSeed()'),false);
 run("setTool('push');setSelectedFace(objects[0],hit.face)");assert.equal(run('pushToolController.numericSeed()'),false);run('pushToolController.pointerDown(input)');assert.equal(run('pointer'),null);
 run("setTool('move');setMoveTargetMode('point');setSelection({kind:'vertex',objectId:objects[0].id,vertexId:[...objects[0].solid.vertices.keys()][0]})");assert.equal(run('seedMovePointNumeric()'),false);
 run("setTool('roundchamfer');startRoundedChamfer(objects[0],[...objects[0].solid.halfEdges.keys()][0],1,45,4)");assert.equal(workers,0);assert.equal(run('modelingOperationBusy'),false);assert.equal(run('chamferEdgeSelection'),null);run('toggleChamferEdgeSelection(objects[0],[...objects[0].solid.halfEdges.keys()][0])');assert.equal(run('chamferEdgeSelection'),null);
 run("setTool('delete');$('deleteObjects').checked=true;deleteToolController.pointerDown(input);updateDeleteToolHover(400,300)");assert.equal(state(),before);assert.equal(history(),h);assert.match(get('coordinates').textContent,/locked/);assert.equal(run('deleteEdgePreview'),null);assert.equal(run('deletePointPreview'),null);
 // Unlock, begin a real numeric Move preview, then lock via the row button.
 lock().onclick();run("selectObject(objects[0]);setTool('move');setMoveTargetMode('object');setAxis('x');moveToolController.numericSeed();previewMoveDistance(17)");assert.equal(run('objects[0].transform.position[0]'),17);lock().onclick();assert.equal(run('pointer'),null);assert.equal(run('objects[0].transform.position[0]'),0);assert.equal(run('objects[0].locked'),true);run('undo()');assert.equal(run('objects[0].locked'),false);assert.equal(run('objects[0].transform.position[0]'),0);run('redo()');assert.equal(run('objects[0].transform.position[0]'),0);
 // Busy controls cannot cancel a running job or change lock state.
 const busy=state(),busyHistory=history();run("beginModelingOperation('Busy');updateUI()");assert.equal(lock().disabled,true);lock().onclick();assert.equal(state(),busy);assert.equal(history(),busyHistory);run('endModelingOperation();updateUI()');
 lock().onclick();run("setObjectTransform(objects[0],{position:[3,4,5],rotation:[0,0,0]})");assert.deepEqual(plain(run('objects[0].transform.position')),[3,4,5]);run('undo();redo()');assert.deepEqual(plain(run('objects[0].transform.position')),[3,4,5]);
}
// Locked cutters can be retained, but a target or consumed cutter must be editable.
{
 const {run,get,blocked,state,history}=fixture();
 run("setObjectsLocked([objects[1].id],true);setObjectSelection(objects.slice(0,2).map(o=>o.id));updateUI();openObjectSubtractDialog()");
 assert.equal(get('subtractBtn').disabled,false);assert.equal(get('applySubtractBtn').disabled,true);get('subtractKeepCutter').checked=true;get('subtractKeepCutter').listeners.change[0]();assert.equal(get('applySubtractBtn').disabled,false);
 run('swapObjectSubtractPair()');assert.equal(get('applySubtractBtn').disabled,true);run('swapObjectSubtractPair()');assert.equal(get('applySubtractBtn').disabled,false);
 const cutter=run('JSON.stringify(serializeObject(objects[1]))');
 blocked("applyPreparedObjectSubtract(captureObjectSubtractSource(objects[0].id,objects[1].id),{status:'empty',solids:[],removedVolume:100},false)");
 const n=history();run("applyPreparedObjectSubtract(captureObjectSubtractSource(objects[0].id,objects[1].id),{status:'empty',solids:[],removedVolume:100},true)");assert.equal(history(),n+1);assert.equal(run('JSON.stringify(serializeObject(objects[0]))'),cutter);run('undo()');assert.equal(run('objects.length'),3);assert.equal(run('objects[1].locked'),true);
 run('swapObjectSubtractPair()');const before=state(),h=history();await run('runObjectSubtractFromUI()');assert.equal(state(),before);assert.equal(history(),h);assert.equal(workers,0);
}
// Native persistence, legacy defaults, invalid flags and append/export compatibility.
{
 const {run,plain,sandbox,lock,state,history,downloads}=fixture();lock().onclick();run('setObjectsVisible([objects[0].id],false)');const saved=plain(run('projectData()'));assert.equal(saved.version,7);assert.equal(saved.objects[0].locked,true);assert.equal(saved.objects[1].locked,undefined);
 run('saveProject()');assert.equal(JSON.parse(await downloads.at(-1).text()).objects[0].locked,true);
 sandbox.saved=saved;run('loadProject(saved)');assert.equal(run('objects[0].locked'),true);assert.equal(run('objects[0].hidden'),true);assert.equal(state(),JSON.stringify(saved));assert.equal(run('deserializeObject(serializeObject(objects[0])).locked'),true);assert.equal(run('cloneObject(objects[0]).locked'),true);
 const legacy=structuredClone(saved);legacy.objects.forEach(o=>delete o.locked);sandbox.legacy=legacy;run('loadProject(legacy)');assert.equal(run('objects.some(isObjectLocked)'),false);
 for(const flag of [null,0,1,'false','true',{},[]]){const malformed=structuredClone(saved);malformed.objects[0].locked=flag;sandbox.bad=malformed;const before=state(),h=history();assert.throws(()=>run('loadProject(bad)'),/lock state must be a boolean/);assert.equal(state(),before);assert.equal(history(),h);}
 sandbox.saved=saved;run('loadProject(saved)');const exported=plain(run("(()=>{const e=snapshotNativeExport([objects[0]],true);return {...e.header,objects:e.objects.map(serializeProjectObject)};})()"));assert.equal(exported.objects[0].locked,true);assert.equal(exported.objects[0].hidden,true);
 sandbox.exported=exported;run("addImportedProject(validateProject(exported),modelRevision,'native')");assert.equal(run('objects.at(-1).locked'),true);assert.notEqual(run('objects.at(-1).id'),saved.objects[0].id);assert.equal(run('objects[0].locked'),true);run('undo()');assert.equal(run('objects.length'),3);run('redo()');assert.equal(run('objects.at(-1).locked'),true);
 // Document lifecycle intentionally replaces locked content, preserving ordinary history.
 run("$('newBtn').onclick()");assert.equal(run('objects.some(isObjectLocked)'),false);assert.equal(run('lastCommandEntry().type'),'new-project');run('undo()');assert.equal(run('objects.some(isObjectLocked)'),true);
}
{
 const {run}=fixture();run('setObjectSelection(objects.slice(0,3).map(o=>o.id));createGroupFromSelection();setObjectsLocked([objects[1].id],true);setObjectSelection([objects[0].id],null,true,false)');
 const protectedObject=run('JSON.stringify(serializeObject(objects[1]))');assert.equal(run('removeSelectedObjects()'),1);assert.equal(run('objects.length'),2);assert.equal(run('JSON.stringify(serializeObject(objects[0]))'),protectedObject);assert.equal(run('groups.length'),1);assert.equal(run('groups[0].objectIds.length'),2);run('undo()');assert.equal(run('objects.length'),3);assert.equal(run('objects[1].locked'),true);
}
assert.equal(workers,0);
console.log('Object locks passed: R228 panel/member/group SVG controls, mixed states, atomic transforms/deletion, hidden members, future-command invariant, properties/color, mouse/numeric/preview/job guards, gesture cancellation, busy/Undo/Redo, visibility/picking/snapping/export/duplication/organization, format-7 defaults/validation/round-trip/native append and New/Open.');
