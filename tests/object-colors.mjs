import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..');
function fixture(){const f=createAppFixture(root),run=s=>vm.runInContext(s,f.sandbox),plain=x=>JSON.parse(JSON.stringify(x)),emit=(id,event,value)=>{const e=f.get(id);if(value!==undefined)e.value=value;for(const fn of e.listeners?.[event]||[])fn({target:e});};run("cancelGesture();replaceGroups([]);while(objects.length<4)addObject('box');objects.forEach((o,i)=>{o.color=['#112233','#445566','#778899','#aabbcc'][i];o.transform.position=[i*50,0,0];});setObjectSelection(objects.slice(0,3).map(o=>o.id),null,true,false);undoStack=[];redoStack=[];setDirtyState(false)");const state=()=>run('JSON.stringify(projectData())'),colors=()=>plain(run('objects.map(o=>o.color)')),history=()=>run('undoStack.length'),geometry=()=>run('JSON.stringify(objects.map(o=>({id:o.id,name:o.name,solid:serializeSolid(o.solid),transform:o.transform,locked:isObjectLocked(o),hidden:!isObjectVisible(o)})))');return {...f,run,plain,emit,state,colors,history,geometry};}
// Actual panel handlers update the complete set, preserving all other model
// state and original mixed colors in one palette-session Undo step.
{
 const {run,get,emit,state,colors,history,geometry,plain}=fixture(),before=state(),beforeGeometry=geometry(),selection=plain(run('selectedObjectIds()')),camera=run('JSON.stringify(camera)'),solids=run('objects.map(o=>o.solid)');
 assert.equal(get('selectionColorProperties').classList.contains('hidden'),false);assert.equal(get('properties').classList.contains('hidden'),true);assert.equal(get('selectionColor').disabled,false);assert.match(get('selectionColorStatus').textContent,/3 objects.*Mixed colors/);
 emit('objColor','input','#ffffff');assert.equal(state(),before,'Hidden single-object palette changed one member of a multi-selection');emit('selectionColor','focus');emit('selectionColor','input','#ABCDEF');emit('selectionColor','input','#123456');emit('selectionColor','change','#654321');assert.deepEqual(colors(),['#654321','#654321','#654321','#aabbcc']);assert.equal(history(),1);assert.equal(run('lastCommandEntry().type'),'set-object-color');assert.deepEqual(plain(run('lastCommandEntry().parameters.objectIds')),selection.slice().sort());assert.equal(geometry(),beforeGeometry);assert.equal(run('JSON.stringify(camera)'),camera);assert.deepEqual(plain(run('selectedObjectIds()')),selection);for(let i=0;i<solids.length;i++)assert.equal(run(`objects[${i}].solid`),solids[i]);assert.match(get('selectionColorStatus').textContent,/Same color/);
 const after=state();run('undo()');assert.equal(state(),before);assert.deepEqual(colors(),['#112233','#445566','#778899','#aabbcc']);run('redo()');assert.equal(state(),after);assert.deepEqual(plain(run('validateProject(projectData()).objects.map(o=>o.color)')),colors());
 // A fresh interaction never joins the previous finished palette session,
 // including an initial no-op that chooses the existing common color.
 emit('selectionColor','focus');emit('selectionColor','input','#654321');assert.equal(history(),1);emit('selectionColor','input','#667788');emit('selectionColor','change','#667788');assert.equal(history(),2);run('undo()');assert.deepEqual(colors(),['#654321','#654321','#654321','#aabbcc']);
 run('clearSelection()');assert.equal(get('selectionColorProperties').classList.contains('hidden'),true);run('selectObject(objects[0])');assert.equal(get('selectionColorProperties').classList.contains('hidden'),true);assert.equal(get('properties').classList.contains('hidden'),false);emit('objColor','focus');emit('objColor','input','#ff0000');emit('objColor','change','#00ff00');assert.equal(run('objects[0].color'),'#00ff00');assert.equal(history(),2);run('undo()');assert.equal(run('objects[0].color'),'#654321');
}
// Group membership, hidden members, extra objects and explicit frame members
// follow exactly the existing selected-object resolver without group expansion.
{
 const {run,get,emit,colors,history,geometry,plain}=fixture();run("groups.push({id:'color-group',name:'Parts',objectIds:objects.slice(0,3).map(o=>o.id)});objects[1].hidden=true;setGroupSelection(groups[0],[objects[3].id]);undoStack=[];redoStack=[]");const before=geometry(),groups=run('JSON.stringify(groups)'),selection=plain(run('selectedObjectIds()'));assert.equal(selection.length,4);assert.equal(get('selectionColor').disabled,false);emit('selectionColor','pointerdown');emit('selectionColor','change','#2468ac');assert.deepEqual(colors(),['#2468ac','#2468ac','#2468ac','#2468ac']);assert.equal(history(),1);assert.equal(geometry(),before);assert.equal(run('JSON.stringify(groups)'),groups);run('undo()');assert.deepEqual(colors(),['#112233','#445566','#778899','#aabbcc']);assert.deepEqual(plain(run('selectedObjectIds()')),selection);
 run('setObjectSelection([objects[0].id,objects[2].id],null,true,false);undoStack=[];redoStack=[]');assert.equal(run('selectedGroup()'),null);emit('selectionColor','focus');emit('selectionColor','change','#abcdef');assert.deepEqual(colors(),['#abcdef','#445566','#abcdef','#aabbcc']);assert.equal(history(),1);assert.equal(run('JSON.stringify(groups)'),groups);
}
// Every member is preflighted, including an unchanged-color locked member.
// Invalid IDs/colors and busy operations cannot partially recolor the set.
{
 const {run,get,emit,state,history}=fixture();run('setObjectsLocked([objects[1].id],true);undoStack=[];redoStack=[]');const before=state();assert.equal(get('selectionColor').disabled,true);assert.match(get('selectionColorStatus').textContent,/Unlock all selected/);emit('selectionColor','input','#445566');assert.equal(state(),before);assert.equal(history(),0);assert.throws(()=>run("setObjectsColor(selectedObjectIds(),'#445566')"),/locked/);assert.equal(state(),before);
 run('setObjectsLocked([objects[1].id],false);undoStack=[];redoStack=[]');const unlocked=state();for(const code of ["setObjectsColor([objects[0].id,'missing'],'#ffffff')","setObjectsColor(selectedObjectIds(),'blue')"]){assert.throws(()=>run(code));assert.equal(state(),unlocked);assert.equal(history(),0);}
 run("beginModelingOperation('Test');updateUI()");assert.equal(get('selectionColor').disabled,true);emit('selectionColor','input','#777777');assert.equal(state(),unlocked);assert.throws(()=>run("setObjectsColor(selectedObjectIds(),'#777777')"),/current operation/);run('endModelingOperation();updateUI()');assert.equal(history(),0);
 run("setObjectsColor([],'#ffffff');setObjectsColor([objects[0].id,objects[0].id,objects[1].id],'#010203')");assert.equal(history(),1);assert.equal(run('lastCommandEntry().parameters.objectIds.length'),2);
}
// Late picker events, unrelated commands and Undo/Redo cannot absorb another
// selection or command into an earlier color entry.
{
 const {run,emit,state,history,colors}=fixture();emit('selectionColor','focus');emit('selectionColor','input','#111111');run('setObjectSelection([objects[2].id,objects[3].id],null,true,false)');const changed=state();emit('selectionColor','input','#222222');assert.equal(state(),changed);assert.equal(history(),1);emit('selectionColor','focus');emit('selectionColor','change','#333333');assert.equal(history(),2);assert.deepEqual(colors(),['#111111','#111111','#333333','#333333']);
 emit('selectionColor','focus');emit('selectionColor','input','#444444');assert.equal(history(),3);run('undo();redo()');emit('selectionColor','input','#555555');assert.equal(history(),4);run('undo()');assert.deepEqual(colors(),['#111111','#111111','#444444','#444444']);emit('selectionColor','blur');
 emit('selectionColor','focus');emit('selectionColor','input','#666666');const colorCount=history();run('setObjectsVisible([objects[0].id],false)');emit('selectionColor','change','#777777');assert.equal(history(),colorCount+2);run('undo()');assert.equal(run('objects[2].color'),'#666666');assert.equal(run('objects[0].hidden'),true);run('undo()');assert.equal(run('objects[0].hidden'),false);
}
// Color capture restores a pending transform before its Undo snapshot so an
// appearance edit cannot accidentally commit transient Move geometry.
{
 const {run,geometry,history}=fixture();run('selectObject(objects[0]);setTool("move");setAxis("x")');const before=geometry();run('moveToolController.numericSeed();moveToolController.numericPreview({distance:9});setObjectSelection([objects[0].id,objects[1].id],null,true,false)');assert.notEqual(geometry(),before);run("setObjectsColor(selectedObjectIds(),'#abcdef')");assert.equal(geometry(),before);assert.equal(run('pointer'),null);assert.equal(run('tool'),'move');assert.equal(history(),1);run('undo()');assert.equal(geometry(),before);
}
const template=fs.readFileSync(resolve(root,'src/template.html'),'utf8');assert.match(template,/<input id="selectionColor" type="color" aria-describedby="selectionColorStatus">/);assert.match(template,/<div id="selectionColorProperties" class="hidden">/);
console.log('R232 object colors passed: actual multi/single palette handlers, mixed colors, one-session Undo/Redo, immutable geometry/transforms/selection, group/hidden/extra and partial-member scope, native colors, full-set lock/busy/invalid guards, duplicate/no-op targets, stale selection, unrelated commands and Undo/Redo session separation, and pending Move restoration.');
