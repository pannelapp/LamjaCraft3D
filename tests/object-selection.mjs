import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root),run=code=>vm.runInContext(code,sandbox),plain=value=>JSON.parse(JSON.stringify(value));
assert.equal(run('objectSelectionMode()'),'object-group');
assert.match(readFileSync(resolve(root,'src/template.html'),'utf8'),/<option selected value="object-group">Objects and Groups<\/option>/);
run(`(()=>{
 const rear=objects[0];rear.name='Rear';rear.color='#e02030';rear.transform.position=[0,0,0];
 const front=makeObject('box');front.color='#2040e0';front.transform.position=[0,0,35];objects.push(front);
 const hidden=makeObject('box');hidden.hidden=true;hidden.transform.position=[0,0,60];objects.push(hidden);
 const side=makeObject('box');side.transform.position=[65,0,0];objects.push(side);
 const offscreen=makeObject('box');offscreen.transform.position=[5000,0,0];objects.push(offscreen);
 camera.target=[0,0,20];camera.distance=180;setView('top');cameraBasis();clearSelection();
})()`);
const [rear,front,hidden,side]=plain(run('objects.map(o=>o.id)'));
const document=run('JSON.stringify(projectData())'),history=run('undoStack.length'),geometry=run('JSON.stringify(objects.map(o=>({solid:serializeSolid(o.solid),transform:o.transform,color:o.color})))');
const event=(x,y,extra={})=>({button:0,buttons:1,pointerId:1,clientX:x,clientY:y,...extra});
function dispatch(name,x,y,extra={}){sandbox.ev=event(x,y,extra);run(`${name}(ev)`);}
function drag(a,b,extra={}){dispatch('dispatchToolPointerDown',...a,extra);dispatch('dispatchToolPointerMove',...b,extra);dispatch('dispatchToolPointerUp',...b,{...extra,buttons:0});}
const center=plain(run('project([0,0,20]).slice(0,2)'));
assert.equal(run('hitTest(W/2,H/2).id'),front);
// Through selection intersects triangle interiors even with no vertex in frame.
for(const sx of [-1,1])for(const sy of [-1,1]){
 drag([center[0]-sx*8,center[1]-sy*8],[center[0]+sx*8,center[1]+sy*8]);
 assert.deepEqual(plain(run('selectedObjectIds()')),[rear,front]);assert.equal(run('pointer'),null);
}
// Clicks still choose only the frontmost object and small motion stays a click.
dispatch('dispatchToolPointerDown',...center);assert.equal(run('modelDocument.selection.kind'),'object');assert.deepEqual(plain(run('selectedObjectIds()')),[front]);dispatch('dispatchToolPointerUp',center[0]+1,center[1]+1,{buttons:0});assert.deepEqual(plain(run('selectedObjectIds()')),[front]);
const sideCenter=plain(run('project([65,0,10]).slice(0,2)'));
for(const modifier of ['shiftKey','ctrlKey','metaKey']){
 run('setObjectSelection([objects[3].id])');drag([center[0]-8,center[1]-8],[center[0]+8,center[1]+8],{[modifier]:true});
 assert.deepEqual(plain(run('selectedObjectIds()')),[side,rear,front]);
 dispatch('dispatchToolPointerDown',...sideCenter,{[modifier]:true});dispatch('dispatchToolPointerUp',...sideCenter,{buttons:0});assert.deepEqual(plain(run('selectedObjectIds()')),[rear,front]);
}
// Objects mode selects visible group members without expanding their siblings.
get('selectionMode').value='object';
run('setObjectSelection([objects[0].id,objects[2].id]);objects[2].hidden=false;setObjectSelection([objects[0].id,objects[2].id]);createGroupFromSelection();objects[2].hidden=true;sceneGeometry.invalidateAll();');
drag([center[0]-8,center[1]-8],[center[0]+8,center[1]+8]);assert.deepEqual(plain(run('selectedObjectIds()')),[rear,front]);assert.equal(run('selectedGroup()'),null);assert.ok(!plain(run('selectedObjectIds()')).includes(hidden));
// Save/restore selection snapshots must not promote a frame's object to a group.
run('restoreDocumentState(captureDocumentState(),false)');assert.deepEqual(plain(run('selectedObjectIds()')),[rear,front]);
run('setSelection(selectionForObjectId(objects[0].id))');assert.ok(run('selectedGroup()'));assert.ok(plain(run('selectedObjectIds()')).includes(hidden),'Ordinary group click semantics changed');
run('ungroupById(groups[0].id);clearSelection();');
// Cancellation restores selection, clears the rectangle, and creates no history.
run('setObjectSelection([objects[3].id])');const cancelHistory=run('undoStack.length');
dispatch('dispatchToolPointerDown',...center);dispatch('dispatchToolPointerMove',center[0]+25,center[1]+25);assert.equal(run('objectSelectionPointer().dragging'),true);run('drawObjectSelectionMarquee();handleToolEscape()');assert.equal(run('pointer'),null);assert.deepEqual(plain(run('selectedObjectIds()')),[side]);assert.equal(run('undoStack.length'),cancelHistory);
for(const kind of ['mode','tool','cancel','capture']){
 dispatch('dispatchToolPointerDown',...center);dispatch('dispatchToolPointerMove',center[0]+25,center[1]+25);
 if(kind==='mode'){get('selectionMode').value='object-group';get('selectionMode').listeners.change.forEach(handler=>handler());get('selectionMode').value='object';}
 if(kind==='tool')run("setTool('move');setTool('select')");
 if(kind==='cancel')get('scene').listeners.pointercancel.forEach(handler=>handler());
 if(kind==='capture')get('scene').listeners.lostpointercapture.forEach(handler=>handler());
 assert.equal(run('pointer'),null);assert.deepEqual(plain(run('selectedObjectIds()')),[side]);
}
// Navigation preserves an in-progress frame; a camera release must not commit it.
dispatch('dispatchToolPointerDown',center[0]-10,center[1]-10);dispatch('dispatchToolPointerMove',center[0]+10,center[1]+10);dispatch('dispatchToolPointerDown',...center,{button:1});assert.equal(run('pointer.type'),'pan-camera');dispatch('dispatchToolPointerUp',...center,{button:1,buttons:0});assert.equal(run('pointer.type'),'object-selection');run('cancelGesture()');assert.deepEqual(plain(run('selectedObjectIds()')),[side]);
get('selectionMode').value='object-group';
// Clicking annotations retains priority; dragging from them still makes a frame.
run("guides.push({id:'selection-guide',kind:'point',point:[0,0,20]});$('showGuides').checked=true");
dispatch('dispatchToolPointerDown',...center);assert.equal(run('modelDocument.selection.kind'),'guide');dispatch('dispatchToolPointerUp',...center,{buttons:0});
drag(center,[center[0]+15,center[1]+15]);assert.deepEqual(plain(run('selectedObjectIds()')),[rear,front]);run('guides.pop()');
// Screen clipping excludes offscreen geometry even with an out-of-canvas release.
drag([-1000,-1000],[1800,1600]);assert.deepEqual(plain(run('selectedObjectIds()')),[rear,front,side]);
drag([1,1],[12,12]);assert.deepEqual(plain(run('selectedObjectIds()')),[]);
// Selection modes all retain frames. Dedicated point/edge picking is covered
// independently by application smoke and the affected editing tool suites.
for(const mode of ['object-group','object','group']){get('selectionMode').value=mode;dispatch('dispatchToolPointerDown',...center);assert.ok(run('objectSelectionPointer()'));dispatch('dispatchToolPointerUp',...center,{buttons:0});}
get('selectionMode').value='object-group';
// Query uses triangles, not object bounding boxes: holes, corner misses, camera
// depth clipping, crossing segments and screen containment are independent cases.
run(`(()=>{
 const mesh=sceneGeometry.mesh,object=objects[0],rect={left:4,top:4,right:6,bottom:6};
 const query=vertices=>{sceneGeometry.mesh=()=>({vertices,triangles:[[0,1,2]],edges:[],face:['test']});return sceneObjectsInScreenRect([object],rect,p=>p,.1,100);};
 try{
  globalThis.queryResults=[query([[0,0,1],[10,0,1],[0,10,1]]),query([[0,0,1],[10,0,1],[0,2,1]]),query([[0,5,1],[10,5,1],[10,5.1,1]]),query([[0,0,-2],[10,0,-2],[0,10,-2]]),query([[0,0,200],[10,0,200],[0,10,200]]),query([[0,0,-1],[10,0,1],[0,10,1]])];
 }finally{sceneGeometry.mesh=mesh;}
})()`);
const queryResults=plain(sandbox.queryResults);assert.deepEqual(queryResults,[[rear],[],[rear],[],[],[rear]]);
// Stronger tint/lightening stays render-only and legible across varied colors.
for(const hex of ['#000000','#ffffff','#ff0000','#00ff00','#0000ff','#b7cec9']){
 sandbox.hex=hex;const result=plain(run('(()=>{const base=rgb(hex),selected=selectionDisplayColor(base,true);return {base,selected,normal:selectionDisplayColor(base,false)};})()'));
 assert.deepEqual(result.normal,result.base);assert.ok(result.selected.every(v=>v>=0&&v<=1));assert.notDeepEqual(result.selected,result.base);assert.ok(result.selected.reduce((a,b)=>a+b,0)>=result.base.reduce((a,b)=>a+b,0)||hex==='#ffffff');
}
// Verify actual renderer output: selected red/blue objects brighten, while an
// unselected neighbor's triangle colors and all stored geometry stay identical.
run(`(()=>{const upload=gl.bufferData,previousTool=tool;let buffers=[];gl.bufferData=(_target,data)=>buffers.push(Array.from(data));try{tool='move';clearSelection(false);clearHover();sceneKey='';ensureScene();globalThis.unselectedTriangles=buffers[0];buffers=[];setObjectSelection([objects[0].id,objects[1].id],null,false,false);sceneKey='';ensureScene();globalThis.selectedTriangles=buffers[0];}finally{gl.bufferData=upload;tool=previousTool;}})()`);
const beforeTriangles=sandbox.unselectedTriangles,afterTriangles=sandbox.selectedTriangles;
const offset=run('sceneGeometry.mesh(objects[0]).triangles.length*18+sceneGeometry.mesh(objects[1]).triangles.length*18');
assert.deepEqual(afterTriangles.slice(offset),beforeTriangles.slice(offset),'Unselected neighbor changed');
let brightnessBefore=0,brightnessAfter=0;for(let i=0;i<offset;i++)if(i%6>=3){brightnessBefore+=beforeTriangles[i];brightnessAfter+=afterTriangles[i];}assert.ok(brightnessAfter>brightnessBefore);
assert.equal(run('JSON.stringify(objects.map(o=>({solid:serializeSolid(o.solid),transform:o.transform,color:o.color})))'),geometry);
assert.equal(run('objects[0].color'),'#e02030');assert.equal(run('objects[1].color'),'#2040e0');
assert.equal(run('undoStack.length'),history+2,'Selection gestures added modeling history (only Group/Ungroup should add commands)');
assert.equal(run('projectData().version'),JSON.parse(document).version);
console.log('R210 object selection passed: object/group default, stronger render-only highlight, through frames in four directions, modifiers, hidden/group exclusions, click filtering and dedicated topology-picking compatibility, viewport/depth/triangle clipping, cancellation and navigation.');
