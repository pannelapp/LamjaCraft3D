import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..');
const near=(a,b)=>assert.ok(Math.hypot(...Array.from(a,(v,i)=>v-b[i]))<1e-7,`${JSON.stringify(a)} != ${JSON.stringify(b)}`);
function fixture(){
 const f=createAppFixture(root),run=s=>vm.runInContext(s,f.sandbox),plain=v=>JSON.parse(JSON.stringify(v));
 run(`objects[0].transform={position:[0,0,0],rotation:[0,0,0]};camera.target=[0,0,10];camera.distance=150;camera.yaw=1;camera.pitch=.7;camera.orthographic=true;cameraBasis();undoStack=[];redoStack=[];`);
 for(const id of ['geomSnap','guideSnap','snap'])f.get(id).checked=false;f.get('pushTwistAngle').value='0';
 const key=key=>{f.sandbox.ev={key,preventDefault(){}};run('handleApplicationKeyDown(ev)');};
 const state=()=>run('snapshot()');
 const history=before=>{assert.equal(run('undoStack.length'),1);const after=state();run('undo()');assert.equal(state(),before);run('redo()');assert.equal(state(),after);};
 return {...f,run,plain,key,state,history};
}
// Actual mouse update -> global numeric keys -> Enter. Zero, intermediate minus,
// decimal comma and repeated negative previews cannot redefine the direction.
for(const mode of ['object','group','point'])for(const rotated of [false,true])for(const axis of ['x','y','z'])for(const side of [-1,1])for(const typedSign of [-1,1]){
 const {run,plain,key,history,sandbox}=fixture();Object.assign(sandbox,{testAxis:axis,testSide:side,testMode:mode,testRotated:rotated});
 run(`(()=>{
  const o=objects[0];if(testRotated)o.transform={position:[5,-3,7],rotation:[17,-22,31]};
  if(testMode==='group'){const other=makeObject('box');other.transform.position=[65,0,0];objects.push(other);groups.push({id:'grp1',name:'Pair',objectIds:objects.map(o=>o.id)});setGroupSelection(groups[0]);}
  setTool('move');setAxis(testAxis);testDirection=testAxis==='x'?[testSide,0,0]:testAxis==='y'?[0,testSide,0]:[0,0,testSide];
  if(testMode==='point'){
   setMoveTargetMode('point');testVertex=[...o.solid.vertices.values()].find(v=>v.position[0]===20&&v.position[1]===15&&v.position[2]===20).id;
   testOrigin=transformPoint(geometryApi.vertex(o.solid,testVertex),o.transform);const s=project(testOrigin);beginMovePointPointer(o,testVertex,s[0],s[1]);
   const target=project(V.add(testOrigin,V.mul(testDirection,.5)));moveToolController.pointerMove({x:target[0],y:target[1]});
  }else{
   const face=[...o.solid.faces.values()][0];moveToolController.pointerDown({x:400,y:300,hit:{id:o.id,face:face.id,point:transformPoint(geometryApi.faceCentroid(o.solid,face.id),o.transform)}});
   testOrigin=[...pointer.position];const target=project(V.add(pointer.start,V.mul(testDirection,.5)));
   moveToolController.pointerMove({x:testAxis==='z'?400:target[0],y:testAxis==='z'?300-testSide*.5*H/camera.distance:target[1]});
  }
  testRetained=JSON.stringify([...o.solid.vertices.values()].filter(v=>testMode!=='point'||v.id!==testVertex).map(v=>[v.id,v.position]));
 })()`);
 near(run('pointer.lastDelta'),plain(run('V.mul(testDirection,.5)')));
 // Preview transforms are temporary; the command history must start at the
 // original transforms, while Point has not changed the document at all.
 const before=run(`(()=>{const s=captureDocumentState();if(testMode!=='point'){for(const o of s.objects){const start=pointer.objectTransforms?.find(v=>v.id===o.id);if(start)o.transform.position=[...start.position];else if(o.id===pointer.object.id)o.transform.position=[...pointer.position];}}return JSON.stringify(s);})()`);
 key('0');near(run('pointer.lastDelta'),[0,0,0]);key('Backspace');if(typedSign<0)key('-');key('1');key(',');key('2');
 const expected=plain(run(`V.mul(testDirection,${typedSign}*1.2)`));near(run('pointer.lastDelta'),expected);
 // Moving the mouse while typing must preserve the typed candidate.
 run('moveToolController.pointerMove({x:50,y:50})');near(run('pointer.lastDelta'),expected);
 run('beginCameraPointer({button:2},400,300,activeToolController());camera.yaw+=.1;resumeAfterCameraPointer(400,300)');
 near(run('pointer.lastDelta'),expected);key('Enter');assert.equal(run('numericEntry'),null);assert.equal(run('pointer'),null);
 if(mode==='point'){near(run('transformPoint(geometryApi.vertex(objects[0].solid,testVertex),objects[0].transform)'),plain(run(`V.add(testOrigin,V.mul(testDirection,${typedSign}*1.2))`)));assert.equal(run('JSON.stringify([...objects[0].solid.vertices.values()].filter(v=>v.id!==testVertex).map(v=>[v.id,v.position]))'),run('testRetained'));}
 else near(run('objects[0].transform.position'),plain(run(`V.add(testOrigin,V.mul(testDirection,${typedSign}*1.2))`)));
 assert.equal(run('geometryApi.validate(objects[0].solid,false).ok'),true);history(before);
}
// Existing XY direction also remains stable across negative/zero entry edits.
for(const typedSign of [-1,1]){
 const {run,key,plain,history}=fixture();run(`setTool('move');setAxis('free');moveToolController.pointerDown({x:400,y:300,hit:{id:objects[0].id,face:[...objects[0].solid.faces.keys()][0],point:[0,0,0]}});const target=project(V.add(pointer.start,[3,4,0]));moveToolController.pointerMove({x:target[0],y:target[1]});`);
 const before=run('(()=>{const s=captureDocumentState();s.objects[0].transform.position=[...pointer.position];return JSON.stringify(s);})()');
 key('0');key('Backspace');if(typedSign<0)key('-');key('1');key('2');near(run('pointer.lastDelta'),[typedSign*7.2,typedSign*9.6,0]);key('Enter');near(run('objects[0].transform.position'),[typedSign*7.2,typedSign*9.6,0]);history(before);
}
// A rotated face follows its outward normal, not global Z. Push/Pull has an
// independently measured cuboid volume, with a fixed typed preview and one Undo.
for(const rotated of [false,true])for(const side of [-1,1])for(const typedSign of [-1,1]){
 const {run,key,state,history,sandbox}=fixture();Object.assign(sandbox,{testRotated:rotated,testSide:side});
 run(`(()=>{const o=objects[0];if(testRotated)o.transform={position:[7,-2,5],rotation:[17,-22,31]};testFace=[...o.solid.faces.values()].find(f=>f.plane.normal[2]>.999).id;setTool('push');const point=transformPoint(geometryApi.faceCentroid(o.solid,testFace),o.transform),s=project(point);pushToolController.pointerDown({x:s[0],y:s[1],hit:{id:o.id,face:testFace,point}});pushToolController.pointerMove({x:pointer.startX+testSide*.5*pointer.ux*pointer.pxPerMm,y:pointer.startY+testSide*.5*pointer.uy*pointer.pxPerMm});})()`);
 assert.ok(Math.abs(run('pointer.requestedDistance')-side*.5)<1e-6);const before=state();
 key('0');assert.ok(run('pointer.requestedDistance===0'));key('Backspace');if(typedSign<0)key('-');key('1');key('2');assert.equal(run('pointer.requestedDistance'),side*typedSign*12);
 run('pushToolController.pointerMove({x:50,y:50})');assert.equal(run('pointer.requestedDistance'),side*typedSign*12);
 run('beginCameraPointer({button:2},400,300,activeToolController());camera.pitch+=.05;resumeAfterCameraPointer(400,300)');
 assert.equal(run('pointer.requestedDistance'),side*typedSign*12);key('Enter');assert.equal(run('pointer'),null);assert.equal(run('numericEntry'),null);
 const z=Array.from(run('[...objects[0].solid.vertices.values()].map(v=>v.position[2])'));assert.ok(Math.abs(Math.max(...z)-(20+side*typedSign*12))<1e-7);assert.equal(Math.min(...z),0);
 assert.equal(run('geometryApi.validate(objects[0].solid,false).ok'),true);assert.equal(run('triangleMeshEdgeStats(solidMeshExportLocal(objects[0].solid)).boundary'),0);history(before);
}
// The requested sign takes priority over a stale drawable preview's distance.
{
 const {run,key}=fixture();run("setTool('push');setSelectedFace(objects[0],[...objects[0].solid.faces.values()].find(f=>f.plane.normal[2]>.999).id,[0,0,20]);pushToolController.numericSeed();pointer.requestedDistance=-2;pointer.distance=1");key('3');assert.equal(run('pointer.requestedDistance'),-3);key('Escape');key('Escape');assert.equal(run('undoStack.length'),0);
}
// Without a preceding mouse direction, existing positive-axis/outward entry
// still works. A numeric-only negative Move cannot flip on the second digit.
for(const tool of ['move','push']){
 const {run,key,state,history}=fixture();run(`setTool('${tool}');${tool==='move'?"setAxis('x')":"setSelectedFace(objects[0],[...objects[0].solid.faces.values()].find(f=>f.plane.normal[2]>.999).id,[0,0,20])"}`);
 const before=state();if(tool==='move')key('-');key('1');key('2');key('Enter');
 if(tool==='move')near(run('objects[0].transform.position'),[-12,0,0]);else assert.equal(run('Math.max(...[...objects[0].solid.vertices.values()].map(v=>v.position[2]))'),32);
 history(before);
}
// Leaving numeric entry and reversing with the mouse seeds a fresh direction.
{
 const {run,key}=fixture();run("setTool('push');setSelectedFace(objects[0],[...objects[0].solid.faces.values()].find(f=>f.plane.normal[2]>.999).id,[0,0,20]);pushToolController.numericSeed();previewPushDistance(-.5)");key('1');assert.equal(run('pointer.requestedDistance'),-1);key('Escape');run('previewPushDistance(.5)');key('2');assert.equal(run('pointer.requestedDistance'),2);key('Escape');key('Escape');assert.equal(run('undoStack.length'),0);
}
const template=readFileSync(resolve(root,'src/template.html'),'utf8');assert.match(template,/Positive typed distances continue/);
console.log('R222 numeric direction passed: 72 Object/Group/Point world-axis cases, rotated sources, zero/negative/decimal edits, stable mouse/camera input, XY compatibility, inward/outward rotated Push/Pull with independent heights, numeric-only defaults, reseeding, validated commits and exact one-command Undo/Redo.');
