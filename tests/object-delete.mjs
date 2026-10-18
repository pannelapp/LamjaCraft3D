import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..');
function fixture(){
 const f=createAppFixture(root),run=code=>vm.runInContext(code,f.sandbox),plain=value=>JSON.parse(JSON.stringify(value));
 run(`(()=>{
  for(let i=0;i<5;i++){const o=makeObject('box');o.transform.position=[i*65,0,i===0?35:0];objects.push(o);}
  objects[2].hidden=true;
  const vertex=i=>({kind:'vertex',objectId:objects[i].id,vertexId:[...objects[i].solid.vertices.keys()][0],fallback:[1,2,3]});
  dimensions.push({id:'linked',kind:'linear',a:vertex(0),b:vertex(3)},
   {id:'kept',kind:'linear',a:vertex(4),b:vertex(5)},
   {id:'world',kind:'linear',a:{kind:'world',point:[0,0,0]},b:{kind:'world',point:[10,0,0]}});
  guides.push({id:'independent',kind:'point',point:[250,250,0]});createBuildPlate();
  undoStack=[];redoStack=[];camera.target=[0,0,20];camera.distance=180;setView('top');cameraBasis();clearSelection();
 })()`);
 const ids=plain(run('objects.map(o=>o.id)')),state=()=>run('snapshot()');
 const key=(key,extra={})=>{f.sandbox.ev={key,preventDefault(){},...extra};run('handleApplicationKeyDown(ev)');};
 const select=indices=>{f.sandbox.ids=indices.map(i=>ids[i]);run('setObjectSelection(ids,null,true,false)');};
 const dispatch=(name,x,y,extra={})=>{f.sandbox.ev={button:0,buttons:1,pointerId:1,clientX:x,clientY:y,...extra};run(`${name}(ev)`);};
 const checkHistory=before=>{assert.equal(run('undoStack.length'),1);assert.equal(run('lastCommandEntry().type'),'delete-objects');const after=state();assert.deepEqual(plain(run('validateProject(projectData()).groups')),plain(run('groups')));assert.equal(state(),after);run('undo()');assert.equal(state(),before);run('redo()');assert.equal(state(),after);};
 return {...f,run,plain,ids,state,key,select,dispatch,checkHistory};
}
// Reproduce the actual through-frame selection and keyboard path, including an
// occluded visible object and an unselected hidden sibling in the same group.
{
 const f=fixture(),{run,plain,ids,dispatch,key,state,checkHistory}=f;
 f.get("selectionMode").value="object";
 run("groups.push({id:'grp1',name:'Assembly',objectIds:[objects[0].id,objects[2].id]})");
 const [x,y]=plain(run('project([0,0,20]).slice(0,2)'));
 dispatch('dispatchToolPointerDown',x-8,y-8);dispatch('dispatchToolPointerMove',x+8,y+8);dispatch('dispatchToolPointerUp',x+8,y+8,{buttons:0});
 assert.deepEqual(plain(run('selectedObjectIds()')),[ids[0],ids[1]]);
 assert.equal(f.get('multipleSelectionActions').classList.contains('hidden'),false);
 assert.equal(f.get('properties').classList.contains('hidden'),true);
 const before=state(),survivors=run('JSON.stringify(objects.slice(2).map(serializeObject))');
 key('Delete');assert.deepEqual(plain(run('objects.map(o=>o.id)')),ids.slice(2));
 assert.equal(run('JSON.stringify(objects.map(serializeObject))'),survivors);
 assert.deepEqual(plain(run('dimensions.map(d=>d.id)')),['kept','world']);assert.equal(run('groups.length'),0);
 assert.equal(run('guides.length'),1);assert.equal(run('buildPlates.length'),1);
 assert.equal(run('modelDocument.selection'),null);assert.deepEqual(plain(run('selectedObjectIds()')),[]);
 assert.equal(f.get('multipleSelectionActions').classList.contains('hidden'),true);
 checkHistory(before);key('Delete');assert.equal(run('undoStack.length'),1,'Empty selection must not create a command');
}
// Modifier selection, Backspace and the visible sidebar button all use the
// same atomic command; selected IDs may span partially selected groups.
for(const action of ['Backspace','button']){
 const f=fixture(),{run,plain,ids,select,state,key,checkHistory}=f;
 run("groups.push({id:'grp1',name:'A',objectIds:[objects[0].id,objects[2].id,objects[3].id,objects[4].id]},{id:'grp2',name:'B',objectIds:[objects[1].id,objects[5].id]})");
 select([0,1]);const before=state();
 if(action==='button')f.get('deleteSelectedObjectsBtn').onclick();else key(action);
 assert.deepEqual(plain(run('objects.map(o=>o.id)')),ids.slice(2));
 assert.deepEqual(plain(run('groups')), [{id:'grp1',name:'A',objectIds:ids.slice(2,5)}]);
 checkHistory(before);
}
for(const modifier of ['shiftKey','ctrlKey','metaKey']){
 const {run,plain,ids,key,state,checkHistory,get}=fixture();
 const button=id=>get('objectList').children.map(row=>row.children[0]).find(b=>b.dataset.objectId===id);
 button(ids[0]).onclick({});button(ids[1]).onclick({[modifier]:true});
 assert.deepEqual(plain(run('selectedObjectIds()')),[ids[0],ids[1]]);
 const before=state();key('Delete');assert.deepEqual(plain(run('objects.map(o=>o.id)')),ids.slice(2));checkHistory(before);
}
// Explicit whole-group selection includes hidden members and selected extras.
{
 const f=fixture(),{run,plain,ids,state,checkHistory}=f;
 run("groups.push({id:'grp1',name:'Assembly',objectIds:[objects[0].id,objects[2].id]});setGroupSelection(groups[0],[objects[1].id])");
 assert.equal(f.get('multipleSelectionActions').classList.contains('hidden'),false);
 const before=state();f.get('deleteSelectedObjectsBtn').onclick();
 assert.deepEqual(plain(run('objects.map(o=>o.id)')),ids.slice(3));assert.equal(run('groups.length'),0);checkHistory(before);
}
// Even a single member explicitly selected by a frame must not delete its group.
{
 const {run,plain,ids,select,key,state,checkHistory}=fixture();
 run("groups.push({id:'grp1',name:'Assembly',objectIds:[objects[0].id,objects[1].id,objects[2].id]})");select([0]);
 const before=state();key('Delete');assert.deepEqual(plain(run('groups[0].objectIds')),[ids[1],ids[2]]);checkHistory(before);
}
// Delete all visible objects, leaving hidden geometry, then explicit whole group
// deletion retains the existing single-group command semantics.
{
 const {run,plain,ids,select,key,state,checkHistory}=fixture();select([0,1,3,4,5]);
 const before=state();key('Delete');assert.deepEqual(plain(run('objects.map(o=>o.id)')),[ids[2]]);checkHistory(before);
 run('undo();objects[2].hidden=false;setObjectSelection(objects.map(o=>o.id),null,true,false);undoStack=[];redoStack=[]');
 const all=state();key('Delete');assert.equal(run('objects.length'),0);assert.deepEqual(plain(run('dimensions.map(d=>d.id)')),['world']);checkHistory(all);
}
{
 const {run,plain,ids,key,state}=fixture();run("groups.push({id:'grp1',name:'Assembly',objectIds:[objects[0].id,objects[2].id]});setGroupSelection(groups[0])");
 const before=state();key('Delete');assert.equal(run('lastCommandEntry().type'),'delete-group');assert.deepEqual(plain(run('objects.map(o=>o.id)')),ids.filter((_,i)=>i!==0&&i!==2));run('undo()');assert.equal(state(),before);
}
// Busy, focused fields, open dialogs, composition and OS shortcuts do not delete.
{
 const f=fixture(),{run,select,key,state}=f;select([0,1]);const before=state();
 run('modelingOperationBusy=true;updateUI()');assert.equal(f.get('deleteSelectedObjectsBtn').disabled,true);key('Delete');f.get('deleteSelectedObjectsBtn').onclick();run('modelingOperationBusy=false');assert.equal(state(),before);
 f.sandbox.document.activeElement.tagName='INPUT';key('Delete');key('Backspace');f.sandbox.document.activeElement.tagName='DIV';
 f.sandbox.document.querySelector=()=>({});key('Delete');f.sandbox.document.querySelector=()=>null;
 for(const extra of [{isComposing:true},{ctrlKey:true},{metaKey:true},{altKey:true}])key('Delete',extra);
 assert.equal(state(),before);assert.equal(run('undoStack.length'),0);
}
// A live object Move preview must be cancelled before Delete's history snapshot.
{
 const f=fixture(),{run,plain,select,dispatch,state,key,checkHistory}=f;
 run("setTool('move')");const [x,y]=plain(run('project([0,0,45]).slice(0,2)'));
 dispatch('dispatchToolPointerDown',x,y);assert.equal(run('pointer.type'),'move-object');select([0,1]);
 const before=state();run('applyMoveDelta([15,5,0])');assert.notEqual(state(),before);
 key('Delete');assert.equal(run('pointer'),null);checkHistory(before);
}
const template=readFileSync(resolve(root,'src/template.html'),'utf8');
assert.match(template,/id="multipleSelectionActions"[^>]*>[\s\S]*?id="deleteSelectedObjectsBtn"/);
assert.match(template,/One Undo restores every object/);
console.log('R221 object deletion passed: real through frame, multiple/partial groups, hidden siblings, group extras, keyboard/sidebar, dimensions, empty/no-op, live Move cancellation, busy/focus guards and exact one-command Undo/Redo.');
