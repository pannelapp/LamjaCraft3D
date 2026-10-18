import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),near=(a,b)=>assert.ok(Math.hypot(...Array.from(a,(v,i)=>v-b[i]))<1e-7,`${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const fixture=()=>{
 const f=createAppFixture(root),run=s=>vm.runInContext(s,f.sandbox),plain=v=>JSON.parse(JSON.stringify(v));
 run("objects[0].transform={position:[12,-7,11],rotation:[21,-36,48]};camera.orthographic=true;setTool('rotate');undoStack=[];redoStack=[];");f.get('snap').checked=false;
 const key=key=>{f.sandbox.ev={key,preventDefault(){}};run('handleApplicationKeyDown(ev)');};
 return {...f,run,plain,key};
};
{
 const {run,sandbox}=fixture();
 for(const [value,expected] of [[0,0],[-0,0],[359.5,359.5],[360,0],[360.5,.5],[720,0],[1080.25,.25],[-359.5,-359.5],[-360,0],[-360.5,-.5],[-720,0],[-1080.25,-.25],[12345678.25,198.25],[359.99999999,359.99999999],[360.00000001,.00000001]]){
  sandbox.angle=value;const actual=run('rotationDisplayAngle(angle)');assert.ok(Math.abs(actual-expected)<1e-9);assert.ok(Math.abs(actual)<360);assert.equal(Object.is(actual,-0),false);
 }
}
// Actual face-plane motion across four full turns in each direction. Keep the
// accumulated angle, preview transforms and numeric sign continuous; wrap only
// the status, panel and rendered angle label.
for(const grouped of [false,true])for(const side of [-1,1]){
 const {run,plain,get,key,sandbox}=fixture();Object.assign(sandbox,{testGrouped:grouped,testSide:side});
 run(`(()=>{
  const o=objects[0];if(testGrouped){const b=makeObject('box');b.transform.position=[30,50,14];objects.push(b);groups.push({id:'grp1',name:'Pair',objectIds:objects.map(o=>o.id)});setGroupSelection(groups[0]);}
  testFace=geometryApi.faceIds(o.solid).find(id=>geometryApi.face(o.solid,id).plane.normal[0]>.99);
  const face=geometryApi.face(o.solid,testFace),n=V.unit(transformDir(face.plane.normal,o.transform)),pivot=transformPoint(face.centroid,o.transform);testFrame=planeBasis({normal:n,offset:V.dot(n,pivot)},pivot);
  camera.target=pivot;camera.distance=130;camera.yaw=Math.atan2(n[1],n[0]);camera.pitch=Math.asin(n[2]);cameraBasis();const s=project(fromPlane2([5,0],testFrame));beginRotatePointer(o,s[0],false,testFace,s[1]);
 })()`);
 const before=run('snapshot()'),source=run('JSON.stringify(objects.map(o=>serializeProjectSolid(o.solid)))');
 for(let degree=30;degree<=1470;degree+=30){
  sandbox.angle=side*degree;const [x,y]=plain(run('project(fromPlane2([5*Math.cos(angle*Math.PI/180),5*Math.sin(angle*Math.PI/180)],testFrame))'));
  run(`dispatchToolPointerMove({clientX:${x},clientY:${y},pointerId:1})`);
  assert.ok(Math.abs(run('pointer.numericAngle')-side*degree)<1e-6);
  const shown=side*(degree%360);assert.ok(Math.abs(Number(get('rotateAngle').value)-shown)<1e-6);
  assert.match(get('rotateStatus').textContent,new RegExp(` · ${shown}°`));
  if(degree%360===30||degree%360===0){
   run("(()=>{const original=drawSnapMarker;testLabels=[];try{drawSnapMarker=(_point,_kind,label)=>testLabels.push(label);drawRotatePlanePreview();}finally{drawSnapMarker=original;}})()");assert.ok(plain(run('testLabels')).includes(`Rotate ${shown}°`));
  }
 }
 assert.equal(run('JSON.stringify(objects.map(o=>serializeProjectSolid(o.solid)))'),source);assert.equal(run('undoStack.length'),0);
 // 1470° and 30° have identical world geometry. Preview comparison uses every
 // vertex of both objects while the internal numeric total remains untouched.
 const actual=plain(run('objects.map(o=>[...o.solid.vertices.values()].map(v=>transformPoint(v.position,o.transform)))'));
 run('previewRotateAngle(testSide*30)');const expected=plain(run('objects.map(o=>[...o.solid.vertices.values()].map(v=>transformPoint(v.position,o.transform)))'));
 for(let oi=0;oi<actual.length;oi++)for(let vi=0;vi<actual[oi].length;vi++)near(actual[oi][vi],expected[oi][vi]);run('previewRotateAngle(testSide*1470)');
 key('2');key('7');assert.equal(run('pointer.numericAngle'),side*27);key('Enter');assert.equal(run('undoStack.length'),1);const after=run('snapshot()');run('undo()');assert.equal(run('snapshot()'),before);run('redo()');assert.equal(run('snapshot()'),after);
}
// World-plane display and a panel with active editing retain their contracts.
for(const mode of ['world-xy','world-xz','world-yz']){
 const {run,get}=fixture();run(`rotationPlaneMode='${mode}';beginRotatePointer(objects[0],400,false,null,300);updateRotatePointer(1900,300)`);assert.equal(run('pointer.numericAngle'),750);assert.equal(get('rotateAngle').value,'30');assert.match(get('rotateStatus').textContent,/ · 30°/);
 run('resumeRotatePointer(500,300);updateRotatePointer(500,300)');assert.equal(run('pointer.numericAngle'),750);assert.equal(get('rotateAngle').value,'30');run('cancelGesture()');assert.equal(run('undoStack.length'),0);
}
{
 const {run,get,sandbox}=fixture();run("rotationPlaneMode='world-xy';beginRotatePointer(objects[0],0,true)");sandbox.document.activeElement=get('rotateAngle');get('rotateAngle').value='720.5';run('previewRotateAngle(720.5)');assert.equal(get('rotateAngle').value,'720.5');assert.match(get('rotateStatus').textContent,/ · 0.5°/);run('cancelGesture()');assert.equal(run('undoStack.length'),0);
}
console.log('R225 rotation display passed: signed full-turn boundary/remainder values, four continuous turns on oblique objects/groups, wrapped panel/status/render labels, unchanged B-reps, equivalent world transforms, retained numeric direction, world-plane camera continuity, focused input and exact Undo/Redo.');
