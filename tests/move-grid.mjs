import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),near=(a,b)=>assert.ok(Math.hypot(...Array.from(a,(v,i)=>v-b[i]))<1e-7,`${JSON.stringify(a)} != ${JSON.stringify(b)}`);
function fixture(mode,axis,step,enabled=true,rotated=false){
 const f=createAppFixture(root),run=s=>vm.runInContext(s,f.sandbox),plain=v=>JSON.parse(JSON.stringify(v));
 Object.assign(f.sandbox,{testMode:mode,testAxis:axis,testRotated:rotated});
 run(`(()=>{objects[0].transform={position:[.23,-.17,.31],rotation:testRotated?[21,-36,48]:[0,0,0]};if(testMode==='group'){const b=makeObject('box');b.transform.position=[80.43,20.67,.9];objects.push(b);groups.push({id:'grp1',name:'Pair',objectIds:objects.map(o=>o.id)});setGroupSelection(groups[0]);}setTool('move');setAxis(testAxis);camera.target=[0,0,10];camera.distance=180;camera.yaw=1;camera.pitch=.7;camera.orthographic=true;cameraBasis();undoStack=[];redoStack=[];})()`);
 f.get('snap').checked=enabled;f.get('snapStep').value=String(step);f.get('geomSnap').checked=false;f.get('guideSnap').checked=false;
 run(`(()=>{const o=objects[0];if(testMode==='point'){setMoveTargetMode('point');testVertex=[...o.solid.vertices.values()].find(v=>v.position[0]===20&&v.position[1]===15&&v.position[2]===20).id;testOrigin=transformPoint(geometryApi.vertex(o.solid,testVertex),o.transform);const s=project(testOrigin);beginMovePointPointer(o,testVertex,s[0],s[1]);}else{testOrigin=[...o.transform.position];moveToolController.pointerDown({x:400,y:300,hit:{id:o.id,face:[...o.solid.faces.keys()][0],point:[0,0,0]}});}})()`);
 const mouse=delta=>{
  f.sandbox.testDelta=delta;
  const [x,y]=plain(run(mode==='point'?'project(V.add(testOrigin,testDelta))':axis==='z'?'[pointer.startX,pointer.startY-testDelta[2]*H/camera.distance]':'project(V.add(pointer.start,testDelta))'));
  f.sandbox.ev={clientX:x,clientY:y,pointerId:1};run('dispatchToolPointerMove(ev)');return [x,y];
 };
 const key=key=>{f.sandbox.ev={key,preventDefault(){}};run('handleApplicationKeyDown(ev)');};
 const state=()=>run('snapshot()');
 const history=before=>{assert.equal(run('undoStack.length'),1);const after=state();run('undo()');assert.equal(state(),before);run('redo()');assert.equal(state(),after);};
 return {...f,run,plain,mouse,key,state,history};
}
for(const mode of ['object','group','point'])for(const axis of ['free','x','y','z'])for(const step of [.1,.5,1,5,10])for(const side of [-1,1]){
 const {run,plain,mouse,state,history}=fixture(mode,axis,step),before=state(),positions=plain(run('objects.map(o=>o.transform.position)'));
 const raw=axis==='free'?[side*.64*step,-side*1.36*step,0]:['x','y','z'].map(a=>a===axis?side*.64*step:0),expected=axis==='free'?[side*step,-side*step,0]:['x','y','z'].map(a=>a===axis?side*step:0);
 const release=mouse(raw);near(run('pointer.lastDelta'),expected);
 if(mode==='point'){assert.equal(state(),before,'Point grid preview mutated the document');assert.equal(run('commitMovePointPointer()'),true);near(run('transformPoint(geometryApi.vertex(objects[0].solid,testVertex),objects[0].transform)'),plain(run(`V.add(testOrigin,${JSON.stringify(expected)})`)));}
 else{if(mode==='group')for(let i=0;i<positions.length;i++)near(run(`objects[${i}].transform.position`),positions[i].map((v,j)=>v+expected[j]));run(`dispatchToolPointerUp({clientX:${release[0]},clientY:${release[1]},pointerId:1})`);if(run('pointer'))run(`dispatchToolPointerDown({button:0,clientX:${release[0]},clientY:${release[1]},pointerId:1})`);assert.equal(run('pointer'),null);near(run('objects[0].transform.position'),positions[0].map((v,j)=>v+expected[j]));}
 assert.equal(run('geometryApi.validate(objects[0].solid,false).ok'),true);history(before);
}
// Disabled grid, rotated corners and all axes use world-coordinate movement.
for(const mode of ['object','group','point'])for(const axis of ['free','x','y','z']){
 const {run,mouse}=fixture(mode,axis,5,false,mode==='point'),raw=axis==='free'?[.37,-.62,0]:['x','y','z'].map(a=>a===axis?-.37:0);mouse(raw);near(run('pointer.lastDelta'),raw);run('cancelGesture()');assert.equal(run('undoStack.length'),0);
}
// Change the grid step during a gesture; recompute from its original origin.
for(const mode of ['object','point']){
 const {run,get,mouse,state}=fixture(mode,'x',1),before=state();mouse([1.4,0,0]);near(run('pointer.lastDelta'),[1,0,0]);get('snapStep').value='.5';mouse([1.4,0,0]);near(run('pointer.lastDelta'),[1.5,0,0]);get('snap').checked=false;mouse([1.4,0,0]);near(run('pointer.lastDelta'),[1.4,0,0]);run('cancelGesture()');assert.equal(state(),before);
}
// Snap-to-zero must retain the chosen direction, and exact numeric values must
// bypass the grid for Object/Group/Point and XY/X/Y/Z.
for(const mode of ['object','group','point'])for(const axis of ['free','x','y','z']){
 const {run,mouse,key,state,history}=fixture(mode,axis,10),before=state(),raw=axis==='free'?[-.3,-.4,0]:['x','y','z'].map(a=>a===axis?-.4:0);mouse(raw);near(run('pointer.lastDelta'),[0,0,0]);for(const k of ['1','.','2','3'])key(k);
 const expected=axis==='free'?[-.738,-.984,0]:['x','y','z'].map(a=>a===axis?-1.23:0);near(run('pointer.lastDelta'),expected);key('Enter');history(before);
}
// Geometry targets keep their exact off-grid coordinates, including height.
for(const mode of ['object','point']){
 const {run,get,plain,mouse,state}=fixture(mode,'free',10),before=state();
 run("(()=>{const b=makeObject('box');b.transform.position=[70.37,45.28,3.91];objects.push(b);camera.target=[40,20,10];camera.distance=300;cameraBasis();testTarget=transformPoint([20,15,20],b.transform);})()");get('geomSnap').checked=true;
 if(mode==='object')run('pointer.sourceAnchorWorld=transformPoint([20,15,20],objects[0].transform)');
 const [x,y]=plain(run('project(testTarget)'));run(`moveToolController.pointerMove({x:${x},y:${y}})`);
 assert.equal(run('snapIndicator.kind'),'Corner');near(run('pointer.lastDelta'),plain(run(mode==='point'?'V.sub(testTarget,testOrigin)':'V.sub(testTarget,pointer.sourceAnchorWorld)')));assert.equal(run('undoStack.length'),0);run('cancelGesture()');near(run('objects[0].transform.position'),[.23,-.17,.31]);
}
console.log('R224 Move grid passed: 120 signed Object/Group/Point XY/X/Y/Z grid-step cases, off-grid origins, actual mouse/release, world axes, step/on-off changes, exact feature/numeric priority, snap-to-zero direction, validated Point commits and exact one-command Undo/Redo.');
