import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root),run=code=>vm.runInContext(code,sandbox);
const array=value=>Array.from(value),doc=()=>run('JSON.stringify(projectData())');
assert.equal(run('rotationPlaneMode'),'face','Picked face must be the initial mode');
assert.equal(get('rotatePlaneMode').value,'face');
const near=(a,b,tolerance=1e-8)=>assert.ok(Math.hypot(...array(a).map((value,i)=>value-b[i]))<tolerance,`${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const chooseMode=mode=>{get('rotatePlaneMode').value=mode;get('rotatePlaneMode').onchange();assert.equal(run('rotationPlaneMode'),mode);};
const reset=(group=false)=>{
  run(`cancelGesture();replaceDocumentContents('Rotate fixture',[{id:'a',name:'A',kind:'solid',solid:primitivePrism([[-4,-3],[4,-3],[4,3],[-4,3]],6,'a-solid'),color:'#b7cec9',transform:{position:[12,-7,11],rotation:[21,-36,48]}},${group?"{id:'b',name:'B',kind:'solid',solid:primitivePrism([[-2,-2],[2,-2],[2,2],[-2,2]],4,'b-solid'),color:'#cc8844',transform:{position:[30,9,14],rotation:[-27,13,79]}}":''}]);undoStack.length=0;redoStack.length=0;selectObject(objects[0]);${group?'toggleObjectSelection(objects[1]);createGroupFromSelection();undoStack.length=0;':''}setTool('rotate');`);
  chooseMode('face');get('snap').checked=false;
  run(`testFace=geometryApi.faceIds(objects[0].solid).find(id=>geometryApi.face(objects[0].solid,id).plane.normal[0]>.99);`);
};
// Independent quaternion-based expectation for transform composition. Test
// basis vectors instead of Euler values, which are not unique at gimbal lock.
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const rotated=(point,axis,angle)=>{
  const length=Math.hypot(...axis),n=axis.map(v=>v/length),half=angle*Math.PI/360,q=n.map(v=>v*Math.sin(half)),w=Math.cos(half),c=cross(q,point);
  return add(point,c.map((v,i)=>2*w*v+2*cross(q,c)[i]));
};
for(let i=0;i<180;i++){
  const t={position:[i%7,-i%11,3],rotation:[i*13.7-170,i%6===0?90:i%6===1?-90:(i*9.3)%180-90,i*17.1-250]},axis=[Math.sin(i+.1),Math.cos(i*1.7+.2),Math.sin(i*.3+.4)],pivot=[-3,7,12],angle=i*7.1-630;
  sandbox.testTransform=t;sandbox.testAxis=axis;sandbox.testPivot=pivot;sandbox.testAngle=angle;
  const result=run('rotateTransformAroundAxis(testTransform,testPivot,testAxis,testAngle)');
  near(result.position,add(pivot,rotated(sub(t.position,pivot),axis,angle)),1e-9);
  sandbox.testResult=result;
  for(const basis of [[1,0,0],[0,1,0],[0,0,1]]){sandbox.testBasis=basis;near(run('rotate(testBasis,testResult.rotation)'),rotated(array(run('rotate(testBasis,testTransform.rotation)')),axis,angle));}
}
for(const angle of [90,-90,89.999999999,-89.999999999]){
  sandbox.testAngle=angle;
  const result=run('rotateTransformAroundAxis({position:[0,0,0],rotation:[0,0,0]},[0,0,0],[0,1,0],testAngle)');sandbox.testResult=result;
  for(const basis of [[1,0,0],[0,1,0],[0,0,1]]){sandbox.testBasis=basis;near(run('rotate(testBasis,testResult.rotation)'),rotated(basis,[0,1,0],angle));}
}
const beginNumeric=()=>run('beginRotatePointer(objects[0],0,true,testFace)');
const worldVertices=()=>run('objects.map(o=>[...o.solid.vertices.values()].map(v=>transformPoint(v.position,o.transform)))');
for(const grouped of [false,true])for(const angle of [37,-62,270]){
  reset(grouped);const before=doc(),local=run('objects.map(o=>JSON.stringify(serializeProjectSolid(o.solid)))'),vertices=worldVertices();
  assert.equal(beginNumeric(),true);const p=run('activeRotatePointer()'),pivot=array(p.rotationPivot),axis=array(p.rotationAxis),history=run('undoStack.length');
  run(`previewRotateAngle(${angle})`);const preview=worldVertices();
  for(let oi=0;oi<vertices.length;oi++)for(let vi=0;vi<vertices[oi].length;vi++)near(preview[oi][vi],add(pivot,rotated(sub(array(vertices[oi][vi]),pivot),axis,angle)));
  assert.equal(run('undoStack.length'),history,'Preview changed history');
  near(run('transformPoint(geometryApi.faceCentroid(objects[0].solid,testFace),objects[0].transform)'),pivot);
  near(run('transformDir(geometryApi.face(objects[0].solid,testFace).plane.normal,objects[0].transform)'),axis);
  run('cameraBasis();drawRotatePlanePreview()');
  assert.equal(run('commitRotatePointer()'),true);const after=doc();assert.notEqual(after,before);assert.equal(run('undoStack.length'),history+1);assert.equal(run('lastCommandEntry().type'),grouped?'rotate-group':'rotate-object');
  assert.equal(run('tool'),'rotate');assert.equal(run('pointer'),null);
  assert.deepEqual(Array.from(run('objects.map(o=>JSON.stringify(serializeProjectSolid(o.solid)))')),Array.from(local));
  const committed=worldVertices();for(let oi=0;oi<preview.length;oi++)for(let vi=0;vi<preview[oi].length;vi++)near(committed[oi][vi],preview[oi][vi]);
  assert.equal(run('validateProject(JSON.parse(JSON.stringify(projectData()))).objects.length'),grouped?2:1);
  run('undo()');assert.equal(doc(),before);assert.equal(run('tool'),'rotate');run('redo()');assert.equal(doc(),after);
  // Preview is always recomputed from the original transform, without drift.
  assert.equal(beginNumeric(),true);const cancelBefore=doc();run('previewRotateAngle(13);previewRotateAngle(-13);previewRotateAngle(13);handleToolEscape()');assert.equal(doc(),cancelBefore);assert.equal(run('tool'),'rotate');run('handleToolEscape()');assert.equal(run('tool'),'select');
}
// Preselected face, panel input and direct numeric entry share the same command.
reset();run("setSelection({kind:'face',objectId:'a',faceId:testFace});setTool('rotate')");get('rotateAngle').value='23.5';get('applyRotateAngle').onclick();assert.equal(run('lastCommandEntry().type'),'rotate-object');assert.equal(run('tool'),'rotate');
reset();const idle=doc();get('rotateAngle').value='23';get('applyRotateAngle').onclick();assert.equal(doc(),idle);assert.equal(run('pointer'),null);assert.match(get('toast').textContent,/Click a face/);
reset();beginNumeric();get('snap').checked=true;assert.equal(run('rotateToolController.numericPreview({angle:37})'),true);assert.equal(run('activeRotatePointer().numericAngle'),37);run('rotateToolController.numericCommit({angle:37})');assert.equal(run('lastCommandEntry().type'),'rotate-object');
// Real ray/plane pointer interaction, including click-place, drag, center
// acquisition, angle unwrapping, 15-degree snap and camera resume rebasing.
const mouseSetup=(center=false)=>{
  reset();run(`(()=>{const o=objects[0],f=geometryApi.face(o.solid,testFace),n=V.unit(transformDir(f.plane.normal,o.transform)),pivot=transformPoint(f.centroid,o.transform);testFrame=planeBasis({normal:n,offset:V.dot(n,pivot)},pivot);camera.target=pivot;camera.distance=80;camera.yaw=Math.atan2(n[1],n[0]);camera.pitch=Math.asin(n[2]);camera.orthographic=true;cameraBasis();})()`);
  const xy=run(`project(${center?'testFrame.origin':'fromPlane2([1.5,0],testFrame)'})`);
  run(`dispatchToolPointerDown({button:0,clientX:${xy[0]},clientY:${xy[1]},pointerId:1})`);
  assert.equal(run('pointer.type'),'rotate-object');assert.equal(run('pointer.planeMode'),'face');return xy;
};
const mouseAt=angle=>run(`project(fromPlane2([1.5*Math.cos(${angle}*Math.PI/180),1.5*Math.sin(${angle}*Math.PI/180)],testFrame))`);
const move=angle=>{const xy=mouseAt(angle);run(`dispatchToolPointerMove({clientX:${xy[0]},clientY:${xy[1]},pointerId:1})`);return xy;};
const up=xy=>run(`dispatchToolPointerUp({clientX:${xy[0]},clientY:${xy[1]},pointerId:1})`);
let xy=mouseSetup();up(xy);assert.equal(run('pointer.type'),'rotate-object');xy=move(22);assert.ok(Math.abs(run('pointer.numericAngle')-22)<1e-8);const preview=doc();run(`dispatchToolPointerDown({button:0,clientX:${xy[0]},clientY:${xy[1]},pointerId:1})`);assert.equal(run('pointer'),null);assert.equal(doc(),preview);assert.equal(run('undoStack.length'),1);
xy=mouseSetup();xy=move(90);up(xy);assert.equal(run('pointer'),null);assert.equal(run('undoStack.length'),1);
mouseSetup();for(const angle of [60,120,180,240,270])move(angle);assert.ok(Math.abs(run('pointer.numericAngle')-270)<1e-8);run('handleToolEscape()');assert.equal(run('undoStack.length'),0);
xy=mouseSetup(true);assert.equal(run('pointer.lastRadial'),null);move(0);assert.equal(run('pointer.numericAngle'),0);move(60);assert.ok(Math.abs(run('pointer.numericAngle')-60)<1e-8);run('handleToolEscape()');
mouseSetup();get('snap').checked=true;move(22);assert.equal(run('pointer.numericAngle'),15);run('handleToolEscape()');
xy=mouseSetup();xy=move(30);const beforeOrbit=doc();run(`beginCameraPointer({button:2},${xy[0]},${xy[1]},activeToolController());camera.yaw+=.2;cameraBasis();resumeAfterCameraPointer(${xy[0]},${xy[1]});updateRotatePointer(${xy[0]},${xy[1]})`);assert.equal(doc(),beforeOrbit);assert.ok(Math.abs(run('pointer.numericAngle')-30)<1e-8);run('handleToolEscape()');
// Mode changes, invalid panel values, busy state and zero angles cannot commit.
reset(true);const untouched=doc();beginNumeric();run('previewRotateAngle(40)');chooseMode('world-xy');assert.equal(doc(),untouched);assert.equal(run('pointer'),null);assert.equal(run('undoStack.length'),0);
run("beginRotatePointer(objects[0],0,true);previewRotateAngle(-30)");assert.ok(Math.abs(run('objects[0].transform.rotation[2]')-18)<1e-8);run('handleToolEscape()');assert.equal(doc(),untouched);
get('rotateAngle').value='';get('applyRotateAngle').onclick();assert.equal(doc(),untouched);assert.match(get('toast').textContent,/finite/);
run("beginModelingOperation('Busy')");get('rotateAngle').value='40';get('applyRotateAngle').onclick();get('rotatePlaneMode').value='face';get('rotatePlaneMode').onchange();assert.equal(run('rotationPlaneMode'),'world-xy');assert.equal(doc(),untouched);run('endModelingOperation()');
run('beginRotatePointer(objects[0],0,true);previewRotateAngle(0);commitRotatePointer()');assert.equal(run('undoStack.length'),0);assert.equal(doc(),untouched);
// R185: each world-plane preset fixes the correct positive global normal,
// uses the original object/group pivot and composes one rigid world rotation.
for(const [mode,axis,label] of [['world-xy',[0,0,1],'World XY'],['world-xz',[0,1,0],'World XZ'],['world-yz',[1,0,0],'World YZ']])for(const grouped of [false,true])for(const angle of [41,-90]){
  reset(grouped);chooseMode(mode);const before=doc(),vertices=worldVertices(),pivot=array(run(grouped?'groupPivot(selectedGroup())':'objects[0].transform.position'));
  assert.equal(run('rotateToolController.numericSeed()'),true);near(run('pointer.rotationAxis'),axis);near(run('pointer.rotationPivot'),pivot);
  run(`previewRotateAngle(${angle})`);assert.match(get('rotateStatus').textContent,new RegExp(label));
  const preview=worldVertices();for(let oi=0;oi<vertices.length;oi++)for(let vi=0;vi<vertices[oi].length;vi++)near(preview[oi][vi],add(pivot,rotated(sub(array(vertices[oi][vi]),pivot),axis,angle)));
  run('commitRotatePointer()');const after=doc();assert.equal(run('undoStack.length'),1);assert.equal(run('lastCommandEntry().type'),grouped?'rotate-group':'rotate-object');
  run('undo()');assert.equal(doc(),before);run('redo()');assert.equal(doc(),after);
  // All world planes retain horizontal pointer rotation and camera rebasing.
  run('beginRotatePointer(objects[0],10,false,null,20);updateRotatePointer(70,20)');assert.equal(run('pointer.numericAngle'),30);
  const beforeResume=doc();run('resumeRotatePointer(100,40);updateRotatePointer(100,40)');assert.equal(doc(),beforeResume);run('handleToolEscape()');
}
// Template and shared help integration keep instructions behind the Tool ?.
const template=fs.readFileSync(resolve(root,'src/template.html'),'utf8');assert.match(template,/id="rotatePlaneMode"/);assert.match(template,/<option value="face" selected>Picked face<\/option>/);assert.match(template,/value="world-xz">World XZ/);assert.match(template,/value="world-yz">World YZ/);assert.match(template,/data-axis="free">XY<\/button>/);assert.doesNotMatch(template,/data-axis="free">Free<\/button>/);assert.match(run('TOOL_INFO.move[1]'),/XY\/X\/Y\/Z/);assert.match(template,/id="rotateToolOptionsHelp" class="sidebar-help-source" hidden/);assert.equal(run('TOOL_OPTION_PANELS.rotate'),'rotateToolOptions');assert.equal(get('rotateToolOptions').classList.contains('hidden'),false);run("setTool('move')");assert.equal(get('rotateToolOptions').classList.contains('hidden'),true);
console.log('R184 face-plane Rotate passed: independent rigid-transform/gimbal checks, oblique object/group axes, fixed face center/normal, preserved B-reps, exact preview/commit/Undo/Redo/JSON, actual ray/plane click/drag/center/snap/multi-turn gestures, numeric/panel entry, camera resume, mode/Escape/busy/zero guards and contextual help.');
console.log('R185 presets passed: Picked face initial state, XY Move label/help, all three global-plane axes on oblique objects/groups, signed numeric/pointer transforms, pivots, camera rebasing and exact Undo/Redo.');
