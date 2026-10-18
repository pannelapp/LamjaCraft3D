import vm from 'node:vm';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..');let cases=0;
function fixture(){
 const f=createAppFixture(root),run=c=>vm.runInContext(c,f.sandbox),plain=x=>JSON.parse(JSON.stringify(x));
 for(const id of ['snap','geomSnap','guideSnap'])f.get(id).checked=false;
 run(`cancelGesture();replaceObjects([]);replaceGroups([]);replaceDimensions([]);replaceGuides([]);objectClipboard=null;camera.orthographic=true;camera.yaw=1;camera.pitch=.7;camera.distance=150;camera.target=[0,0,10];cameraBasis();`);
 const key=(key,extra={})=>{let prevented=false;f.sandbox.ev={key,preventDefault(){prevented=true;},...extra};run('handleApplicationKeyDown(ev)');return prevented;};
 const setup=(count=1)=>{f.sandbox.count=count;run(`for(let i=0;i<count;i++){const o=makeObject('box');o.name='Source '+i;o.color=i%2?'#2040e0':'#e02030';o.transform={position:[i*55-20,i*12-9,i*3+4],rotation:[i*11,17,-23]};objects.push(o);}setObjectSelection(objects.map(o=>o.id),null,true,false);undoStack=[];redoStack=[];setDirtyState(false);debugPointerXY=[340,260];`);};
 return {...f,run,plain,key,setup,state:()=>run('snapshot()')};
}
for(const count of [1,3]){
 const {run,plain,key,setup,state}=fixture();setup(count);const before=state(),ids=plain(run('objects.map(o=>o.id)')),originals=plain(run('objects.map(serializeObject)'));
 assert.equal(key('c',{ctrlKey:true}),true);assert.equal(state(),before);assert.equal(run('dirty'),false);assert.equal(run('undoStack.length'),0);
 assert.equal(key('v',{ctrlKey:true}),true);assert.equal(run('tool'),'move');assert.equal(run('moveTargetMode'),'object');assert.equal(run('pastePlacement.objects.length'),count);assert.equal(run('objects.length'),count);assert.equal(state(),before);assert.equal(run('dirty'),false);
 run('applyMoveDelta([23,-17,8])');const preview=plain(run('pastePlacement.objects.map(serializeObject)'));assert.equal(state(),before,'Preview cannot enter the persistent document');
 // Derived renderer must include the preview without changing document counts.
 const triCountBefore=run('sceneGeometry.triangleCount(visibleObjects())');run('ensureScene()');assert.equal(run('triCount/3'),triCountBefore*2);assert.equal(run('objects.length'),count);
 run('commitMovePointer()');assert.equal(run('objects.length'),count*2);assert.equal(run('undoStack.length'),1);assert.equal(run('lastCommandEntry().type'),'paste-objects');assert.equal(run('pastePlacement'),null);assert.equal(run('pointer'),null);assert.equal(run('dirty'),true);
 const made=plain(run(`objects.filter(o=>!${JSON.stringify(ids)}.includes(o.id)).map(serializeObject)`));
 for(let i=0;i<count;i++){assert.deepEqual(made[i].transform,preview[i].transform);assert.equal(made[i].color,originals[i].color);assert.deepEqual(made[i].solid.vertices,originals[i].solid.vertices);assert.ok(!ids.includes(made[i].id));assert.notEqual(made[i].locked,true);}
 assert.deepEqual(plain(run(`objects.filter(o=>${JSON.stringify(ids)}.includes(o.id)).map(serializeObject)`)),originals);
 assert.equal(new Set(plain(run('objects.map(o=>o.id)'))).size,count*2);assert.equal(run('selectedObjectIds().length'),count);
 const after=state();run('undo()');assert.equal(state(),before);run('redo()');assert.equal(state(),after);
 assert.equal(run('projectData().version'),7);run('var reopened=validateProject(projectData())');assert.equal(run('reopened.objects.length'),count*2);assert.equal(run('reopened.objects.every(o=>validateSolid(o.solid,false).ok)'),true);
 // Subsequent pastes start from the immutable original snapshot, not the last
 // pasted object's coordinates/name or a live reference to source geometry.
 run('objects[0].transform.position[0]+=777;objects[0].name="Edited source"');key('v',{ctrlKey:true});assert.equal(run('pastePlacement.objects[0].name'),'Source 0 copy');assert.equal(run('pastePlacement.positions[0][0]'),originals[0].transform.position[0]);key('Escape');assert.equal(run('pastePlacement'),null);cases++;
}
// Multiple complete groups retain separate memberships, names, hidden members,
// placement offsets, and ungrouped extras. Source locks do not lock copies.
{
 const {run,plain,key,setup,state}=fixture();setup(5);run(`groups.push({id:'a',name:'First',objectIds:[objects[0].id,objects[1].id]},{id:'b',name:'Second',objectIds:[objects[2].id,objects[3].id]});objects[1].hidden=true;objects[3].hidden=true;objects[0].locked=true;selectObject(objects[0]);toggleObjectSelection(objects[2]);toggleObjectSelection(objects[4]);`);
 assert.deepEqual(new Set(plain(run('selectedObjectIds()'))),new Set(plain(run('objects.map(o=>o.id)'))));const before=state();key('c',{ctrlKey:true});assert.equal(run('objectClipboard.groups.length'),2);assert.equal(run('objectClipboard.objects.length'),5);key('v',{ctrlKey:true});run('applyMoveDelta([80,30,-4]);commitMovePointer()');assert.equal(run('groups.length'),4);assert.equal(run('objects.length'),10);assert.equal(run('undoStack.length'),1);
 const groupData=plain(run('groups.slice(2)'));assert.equal(groupData[0].name,'First copy');assert.equal(groupData[1].name,'Second copy');assert.equal(new Set(groupData.flatMap(g=>g.objectIds)).size,4);assert.ok(groupData.every(g=>g.objectIds.length===2));assert.equal(run('objects.slice(5).filter(o=>o.hidden).length'),2);assert.equal(run('objects.slice(5).some(o=>o.locked)'),false);assert.equal(run('validateProject(projectData()).groups.length'),4);const after=state();run('undo()');assert.equal(state(),before);run('redo()');assert.equal(state(),after);cases++;
}
// Copying a partial frame selection does not silently include another member.
{
 const {run,key,setup}=fixture();setup(3);run(`groups.push({id:'pair',name:'Pair',objectIds:[objects[0].id,objects[1].id]});setObjectSelection([objects[0].id,objects[2].id],objects[0].id,true,false);`);key('c',{ctrlKey:true});assert.equal(run('objectClipboard.objects.length'),2);assert.equal(run('objectClipboard.groups.length'),0);run('objects[1].hidden=true;setObjectSelection([objects[0].id,objects[2].id],objects[0].id,true,false)');key('c',{ctrlKey:true});assert.equal(run('objectClipboard.objects.length'),2);assert.equal(run('objectClipboard.groups.length'),0);cases++;
}
// Native text shortcuts, Alt/Shift combinations, composition, dialogs and busy
// workers remain owned by the browser or existing UI.
for(const field of ['INPUT','TEXTAREA','SELECT','CONTENTEDITABLE']){
 const {sandbox,run,key,setup,state}=fixture();setup();sandbox.document.activeElement={tagName:field,isContentEditable:field==='CONTENTEDITABLE'};const before=state();for(const k of ['c','v'])assert.equal(key(k,{ctrlKey:true}),false);assert.equal(run('objectClipboard'),null);assert.equal(run('pastePlacement'),null);assert.equal(state(),before);cases++;
}
for(const flags of [{ctrlKey:true,altKey:true},{ctrlKey:true,shiftKey:true},{metaKey:true,shiftKey:true},{isComposing:true,ctrlKey:true}]){
 const {run,key,setup}=fixture();setup();for(const k of ['c','v'])assert.equal(key(k,flags),false);assert.equal(run('objectClipboard'),null);assert.equal(run('pastePlacement'),null);cases++;
}
for(const block of ['busy','dialog']){
 const {sandbox,run,key,setup}=fixture();setup();if(block==='busy')run('modelingOperationBusy=true');else sandbox.document.querySelector=()=>({open:true});for(const k of ['c','v'])assert.equal(key(k,{ctrlKey:true}),false);assert.equal(run('objectClipboard'),null);assert.equal(run('pastePlacement'),null);cases++;
}
// All normal transient teardown paths drop an uncommitted paste without IDs,
// extra objects, dirty state or history. Copy survives New/Open in this session.
for(const action of ['handleToolEscape()','setTool("select")','prepareToolForDocumentChange()','undo()','redo()','removeSelectedEntity()']){
 const {run,key,setup,state}=fixture();setup(2);key('c',{metaKey:true});const before=state(),next=run('nextObjectId');key('v',{metaKey:true});run(action);assert.equal(run('pastePlacement'),null);assert.equal(state(),before);assert.equal(run('nextObjectId'),next);assert.equal(run('undoStack.length'),0);assert.equal(run('dirty'),false);cases++;
}
{
 const {run,key,setup,state}=fixture();setup();key('c',{ctrlKey:true});run(`replaceDocumentContents('Other',[],[],[],'load-project','Open project',false);`);const before=state();key('v',{ctrlKey:true});assert.equal(run('pastePlacement.objects.length'),1);key('Escape');assert.equal(state(),before);cases++;
}
// Real pointer dispatch places the whole selection in one command, including
// free motion, locked axes, numeric entry and camera navigation rebasing.
for(const mode of ['pointer','numeric','camera','snap']){
 const {run,key,setup,state,sandbox}=fixture();setup(2);key('c',{ctrlKey:true});const before=state();key('v',{ctrlKey:true});
 if(mode==='numeric'){key('x');run('pointer.rawMoveDelta=[1,0,0];pointer.lastDelta=[1,0,0]');key('2');key('5');key('Enter');assert.equal(run('objects[2].transform.position[0]-objects[0].transform.position[0]'),25);}
 else{
  if(mode==='camera'){run('applyMoveDelta([20,10,0]);pointer.lastDelta=[20,10,0];var savedPositions=JSON.stringify(pastePlacement.objects.map(o=>o.transform.position));pointer={type:"orbit-camera",suspendedPointer:pointer};camera.yaw+=.4;camera.pitch+=.1;resumeAfterCameraPointer(340,260)');assert.equal(run('JSON.stringify(pastePlacement.objects.map(o=>o.transform.position))'),run('savedPositions'));run('updateMovePointer(340,260)');assert.equal(run('JSON.stringify(pastePlacement.objects.map(o=>o.transform.position))'),run('savedPositions'));}
  if(mode==='snap'){run(`var savedSnap=moveTargetFeatureSnapAt;moveTargetFeatureSnapAt=()=>({world:[120,80,30],kind:'Corner',distance:0,candidates:[]});updateMovePointer(340,260);var expectedAnchor=[...pointer.targetSnapWorld];moveTargetFeatureSnapAt=savedSnap;`);}
  if(mode==='pointer'){sandbox.pointerEvent={clientX:410,clientY:300,button:0,buttons:0,pointerId:1};run('dispatchToolPointerMove(pointerEvent)');}
  const expected=run('JSON.stringify(pastePlacement.objects.map(o=>o.transform))');
  if(mode==='snap')run('commitMovePointer()');else {sandbox.pointerEvent={clientX:mode==='camera'?340:410,clientY:mode==='camera'?260:300,button:0,buttons:1,pointerId:1};run('dispatchToolPointerDown(pointerEvent)');}
  assert.equal(run('JSON.stringify(objects.slice(2).map(o=>o.transform))'),expected);
 }
 assert.equal(run('objects.length'),4);assert.equal(run('undoStack.length'),1);const after=state();run('undo()');assert.equal(state(),before);run('redo()');assert.equal(state(),after);cases++;
}
// Capacity, stale results and no-source attempts are atomic failures.
{
 const {run,key,setup,state,get}=fixture();setup();key('v',{ctrlKey:true});assert.equal(run('tool'),'select');assert.equal(run('pastePlacement'),null);key('c',{ctrlKey:true});run('while(objects.length<1000)objects.push(makeObject("box"))');const before=state();key('v',{ctrlKey:true});assert.equal(run('pastePlacement'),null);assert.equal(state(),before);assert.match(get('toast').textContent,/1000/);cases++;
}
{
 const {run,key,setup,state,get}=fixture();setup();key('c',{ctrlKey:true});key('v',{ctrlKey:true});const before=state();run('modelRevision++;commitMovePointer()');assert.equal(run('pastePlacement'),null);assert.equal(state(),before);assert.equal(run('undoStack.length'),0);assert.match(get('toast').textContent,/project changed/);cases++;
}
// New groups must remain within the native format bound, and copy names must
// round-trip without being truncated by the native reader.
{
 const {run,key,setup,state,get}=fixture();setup(2);run(`groups.push({id:'original',name:'G'.repeat(80),objectIds:objects.map(o=>o.id)});objects[0].name='O'.repeat(80);setGroupSelection(groups[0]);`);key('c',{ctrlKey:true});key('v',{ctrlKey:true});run('commitMovePointer()');assert.equal(run('objects[2].name.length'),80);assert.equal(run('groups[1].name.length'),80);assert.equal(run('validateProject(projectData()).groups[1].name'),run('groups[1].name'));run('undo()');
 run(`for(let i=1;i<300;i++){const a=makeObject('box'),b=makeObject('box');objects.push(a,b);groups.push({id:'limit'+i,name:'Group',objectIds:[a.id,b.id]});}`);assert.equal(run('validateProject(projectData()).groups.length'),300);const before=state();key('v',{ctrlKey:true});assert.equal(run('pastePlacement'),null);assert.equal(state(),before);assert.match(get('toast').textContent,/300 groups/);cases++;
}
// Imported document IDs may use arbitrary strings. Preview IDs must not
// collide with them or interfere with document mesh/picking cache ownership.
{
 const {run,key,setup,state}=fixture();setup();run(`objects[0].id='paste-preview-0';selectObject(objects[0]);`);key('c',{ctrlKey:true});const before=state();key('v',{ctrlKey:true});assert.equal(run('pastePlacement.objects.some(o=>objects.some(source=>source.id===o.id))'),false);run('ensureScene()');assert.equal(state(),before);run('commitMovePointer()');assert.equal(run('validateProject(projectData()).objects.length'),2);run('undo()');assert.equal(state(),before);cases++;
}
// Toolbar actions share the same copy/paste path and selection/busy state.
{
 const {run,get,setup,state}=fixture();setup(2);run('updateUI()');assert.equal(get('copyObjectsBtn').disabled,false);assert.equal(get('pasteObjectsBtn').disabled,true);const before=state();get('copyObjectsBtn').onclick();assert.equal(get('pasteObjectsBtn').disabled,false);get('pasteObjectsBtn').onclick();assert.equal(run('tool'),'move');assert.equal(run('pastePlacement.objects.length'),2);assert.equal(get('properties').classList.contains('hidden'),true);assert.match(get('noSelection').textContent,/Paste placement/);assert.equal(state(),before);run('handleToolEscape();clearSelection();updateUI()');assert.equal(get('copyObjectsBtn').disabled,true);run('modelingOperationBusy=true;updateUI()');assert.equal(get('pasteObjectsBtn').disabled,true);cases++;
}
const html=fs.readFileSync(resolve(root,'dist/LamjaCraft-3D.html'),'utf8');assert.ok(html.includes('Ctrl/Cmd+C'));assert.ok(html.includes('Ctrl/Cmd+V'));
console.log(`Object clipboard passed ${cases} cases: immutable copies, multi-object/group placement, hidden members, unlocked copies, derived-only previews, native text/modifier guards, snapping/numeric/navigation, single Undo/Redo, capacity/stale/cancel guards and native reopening.`);
