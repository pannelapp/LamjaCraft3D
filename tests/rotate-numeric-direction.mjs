import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),near=(a,b)=>assert.ok(Math.hypot(...Array.from(a,(v,i)=>v-b[i]))<1e-7,`${JSON.stringify(a)} != ${JSON.stringify(b)}`);
// Independent Rodrigues rotation, rather than the implementation's Euler math.
const rotatePoint=(point,pivot,axis,angle)=>{
 const n=axis.map(v=>v/Math.hypot(...axis)),v=point.map((x,i)=>x-pivot[i]),c=Math.cos(angle*Math.PI/180),s=Math.sin(angle*Math.PI/180),dot=v.reduce((sum,x,i)=>sum+x*n[i],0),cross=[n[1]*v[2]-n[2]*v[1],n[2]*v[0]-n[0]*v[2],n[0]*v[1]-n[1]*v[0]];
 return pivot.map((x,i)=>x+v[i]*c+cross[i]*s+n[i]*dot*(1-c));
};
function fixture(mode,grouped=false){
 const f=createAppFixture(root),run=s=>vm.runInContext(s,f.sandbox),plain=v=>JSON.parse(JSON.stringify(v));
 Object.assign(f.sandbox,{testMode:mode,testGrouped:grouped});
 run(`(()=>{
  const o=objects[0];o.transform={position:[12,-7,11],rotation:[21,-36,48]};
  if(testGrouped){const b=makeObject('box');b.transform={position:[30,50,14],rotation:[-27,13,79]};objects.push(b);groups.push({id:'grp1',name:'Pair',objectIds:objects.map(o=>o.id)});setGroupSelection(groups[0]);}
  setTool('rotate');rotationPlaneMode=testMode;undoStack=[];redoStack=[];
  testFace=geometryApi.faceIds(o.solid).find(id=>geometryApi.face(o.solid,id).plane.normal[0]>.99);
  const face=geometryApi.face(o.solid,testFace),normal=V.unit(transformDir(face.plane.normal,o.transform)),pivot=transformPoint(face.centroid,o.transform);
  testFrame=planeBasis({normal,offset:V.dot(normal,pivot)},pivot);
  camera.target=pivot;camera.distance=130;camera.yaw=Math.atan2(normal[1],normal[0]);camera.pitch=Math.asin(normal[2]);camera.orthographic=true;cameraBasis();
 })()`);
 f.get('snap').checked=false;
 const mouse=angle=>{
  f.sandbox.testMouseAngle=angle;
  const [x,y]=plain(run(mode==='face'?'project(fromPlane2([5*Math.cos(testMouseAngle*Math.PI/180),5*Math.sin(testMouseAngle*Math.PI/180)],testFrame))':'[400+testMouseAngle/ROTATE_INTERACTION_POLICY.worldDegreesPerPixel,300]'));
  f.sandbox.ev={clientX:x,clientY:y,pointerId:1};run('dispatchToolPointerMove(ev)');return [x,y];
 };
 const begin=()=>{
  const [x,y]=plain(run(mode==='face'?'project(fromPlane2([5,0],testFrame))':'[400,300]'));
  f.sandbox.testX=x;f.sandbox.testY=y;run('rotateToolController.pointerDown({x:testX,y:testY,hit:{id:objects[0].id,face:testFace,point:transformPoint(geometryApi.faceCentroid(objects[0].solid,testFace),objects[0].transform)}})');
 };
 const key=key=>{f.sandbox.ev={key,preventDefault(){}};run('handleApplicationKeyDown(ev)');};
 const state=()=>run('snapshot()'),vertices=()=>plain(run('objects.map(o=>[...o.solid.vertices.values()].map(v=>transformPoint(v.position,o.transform)))'));
 const history=before=>{assert.equal(run('undoStack.length'),1);assert.equal(run('lastCommandEntry().type'),grouped?'rotate-group':'rotate-object');const after=state();run('undo()');assert.equal(state(),before);run('redo()');assert.equal(state(),after);};
 return {...f,run,plain,mouse,begin,key,state,vertices,history};
}
// All four plane modes, both directions and both typed signs on oblique objects
// and groups. The typed angle is total rotation from the gesture's start.
for(const mode of ['face','world-xy','world-xz','world-yz'])for(const grouped of [false,true])for(const side of [-1,1])for(const typedSign of [-1,1]){
 const {run,plain,mouse,begin,key,state,vertices,history}=fixture(mode,grouped);begin();
 const before=state(),sourceVertices=vertices(),sourceGeometry=run('JSON.stringify(objects.map(o=>serializeProjectSolid(o.solid)))'),axis=plain(run('pointer.rotationAxis')),pivot=plain(run('pointer.rotationPivot'));
 mouse(side*30);assert.ok(Math.abs(run('pointer.numericAngle')-side*30)<1e-7);
 key('0');assert.ok(run('pointer.numericAngle===0'));key('Backspace');if(typedSign<0)key('-');key('2');key('7');key(',');key('5');
 const expectedAngle=side*typedSign*27.5;assert.ok(Math.abs(run('pointer.numericAngle')-expectedAngle)<1e-7);
 mouse(-side*80);assert.ok(Math.abs(run('pointer.numericAngle')-expectedAngle)<1e-7,'Mouse replaced the typed angle');
 run('beginCameraPointer({button:2},400,300,activeToolController());camera.yaw+=.1;cameraBasis();resumeAfterCameraPointer(400,300)');
 assert.ok(Math.abs(run('pointer.numericAngle')-expectedAngle)<1e-7);
 const preview=vertices();for(let oi=0;oi<preview.length;oi++)for(let vi=0;vi<preview[oi].length;vi++)near(preview[oi][vi],rotatePoint(sourceVertices[oi][vi],pivot,axis,expectedAngle));
 assert.equal(run('undoStack.length'),0);key('Enter');assert.equal(run('numericEntry'),null);assert.equal(run('pointer'),null);
 const committed=vertices();for(let oi=0;oi<preview.length;oi++)for(let vi=0;vi<preview[oi].length;vi++)near(committed[oi][vi],preview[oi][vi]);
 assert.equal(run('JSON.stringify(objects.map(o=>serializeProjectSolid(o.solid)))'),sourceGeometry);assert.equal(run('validateProject(projectData()).objects.length'),grouped?2:1);history(before);
}
// A small unsnapped motion defines a sign even while 15° Snap displays zero.
for(const mode of ['face','world-xy','world-xz','world-yz'])for(const side of [-1,1]){
 const {run,get,begin,mouse,key,state,history}=fixture(mode);begin();const before=state();get('snap').checked=true;mouse(side*2);assert.ok(run('pointer.numericAngle===0'));assert.ok(Math.abs(run('pointer.rawAngle')-side*2)<1e-7);run('beginCameraPointer({button:2},400,300,activeToolController());camera.yaw+=.1;cameraBasis();resumeAfterCameraPointer(400,300)');key('3');key('7');assert.equal(run('pointer.numericAngle'),side*37);key('Enter');history(before);
}
// Numeric-only input uses the plane's normal, while zero commits no history.
for(const mode of ['face','world-xy','world-xz','world-yz'])for(const typedSign of [-1,1]){
 const {run,plain,key,state,vertices,history}=fixture(mode);if(mode==='face')run("setSelection({kind:'face',objectId:objects[0].id,faceId:testFace})");assert.equal(run('rotateToolController.numericSeed()'),true);assert.equal(run('pointer.numericOnly'),true);
 const before=state(),source=vertices();if(typedSign<0)key('-');key('1');key('2');assert.equal(run('pointer.numericAngle'),typedSign*12);const axis=plain(run('pointer.rotationAxis')),pivot=plain(run('pointer.rotationPivot'));key('Enter');
 const final=vertices();for(let oi=0;oi<final.length;oi++)for(let vi=0;vi<final[oi].length;vi++)near(final[oi][vi],rotatePoint(source[oi][vi],pivot,axis,typedSign*12));history(before);
}
{
 const {run,begin,key,state}=fixture('world-xy');begin();const before=state();key('0');key('Enter');assert.equal(state(),before);assert.equal(run('undoStack.length'),0);
}
// A new entry after Escape/mouse reversal captures a fresh direction. Plane
// changes or Escape restore every preview transform without creating a command.
for(const mode of ['face','world-xy']){
 const {run,get,begin,mouse,key,state}=fixture(mode,true);begin();const before=state();mouse(-30);key('2');assert.equal(run('pointer.numericAngle'),-2);key('Escape');mouse(40);key('3');assert.equal(run('pointer.numericAngle'),3);key('Escape');key('Escape');assert.equal(state(),before);assert.equal(run('undoStack.length'),0);
 begin();mouse(-30);key('2');get('rotatePlaneMode').value='world-yz';get('rotatePlaneMode').onchange();assert.equal(state(),before);assert.equal(run('pointer'),null);assert.equal(run('undoStack.length'),0);
}
const template=readFileSync(resolve(root,'src/template.html'),'utf8');assert.match(template,/Positive typed angles continue/);
console.log('R223 Rotate numeric direction passed: 32 signed object/group plane cases with independent Rodrigues world vertices, zero/minus/decimal editing, fixed mouse/camera previews, 8 snap-to-zero signs, numeric-only defaults, zero no-op, reseeding/cancellation and exact one-command Undo/Redo with unchanged B-reps/native validation.');
