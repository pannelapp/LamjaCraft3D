import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root),run=code=>vm.runInContext(code,sandbox);
const plain=value=>JSON.parse(JSON.stringify(value)),doc=()=>run('JSON.stringify(projectData())');
const near=(a,b,tolerance=1e-8)=>assert.ok(Math.hypot(...Array.from(a,(v,i)=>v-b[i]))<tolerance,`${a} != ${b}`);
const reflect=(point,plane)=>{const length=Math.hypot(...plane.normal),n=plane.normal.map(v=>v/length),distance=point.reduce((sum,v,i)=>sum+v*n[i],0)-plane.offset/length;return point.map((v,i)=>v-2*distance*n[i]);};
const world=object=>{sandbox.testObject=object;return plain(run('[...testObject.solid.vertices.values()].map(vertex=>({id:vertex.id,point:transformPoint(vertex.position,testObject.transform)}))'));};
function reset(group=false){
  run(`cancelGesture();replaceDocumentContents('Mirror fixture',[
    {id:'a',name:'Perforated',kind:'solid',color:'#b7cec9',shininess:.7,transform:{position:[12,-7,11],rotation:[21,-36,48]},solid:prismRegion([[-8,-8],[8,-8],[8,8],[-8,8]],[[[-2,-2],[-2,2],[2,2],[2,-2]]],5,'a-solid')},
    {id:'b',name:'Reference',kind:'solid',color:'#cc8844',transform:{position:[32,9,14],rotation:[-27,13,79]},solid:primitivePrism([[-2,-3],[2,-3],[2,3],[-2,3]],4,'b-solid')}
  ]);selectObject(objects[0]);${group?"toggleObjectSelection(objects[1]);createGroupFromSelection();":''}undoStack.length=0;redoStack.length=0;setTool('mirror');mirrorPlaneMode='face';mirrorKeepOriginal=true;updateMirrorToolUI();`);
}
assert.equal(run('mirrorPlaneMode'),'face');assert.equal(get('mirrorKeepOriginal').checked,true);
// Independent world-space reflection across axes, oblique/offset planes and
// scaled plane equations. Stable topology, material and source ownership remain.
for(const grouped of [false,true])for(const plane of [{normal:[1,0,0],offset:0},{normal:[0,1,0],offset:0},{normal:[0,0,1],offset:0},{normal:[2,-3,5],offset:17},{normal:[-.4,.6,-1],offset:-3.4}])for(const keep of [false,true]){
  reset(grouped);sandbox.testPlane=plane;const before=doc(),count=grouped?2:1,sourceObjects=Array.from(run(`objects.slice(0,${count})`)),sourceSnapshots=sourceObjects.map(world),volumes=plain(run(`objects.slice(0,${count}).map(o=>validateSolid(o.solid).volume)`));
  run(`objects[0].solid.faces.values().next().value.material='gold';objects[0].solid.metadata.name='Perforated metadata'`);const original=run('JSON.stringify(serializeProjectObject(objects[0]))');
  const commandBefore=doc();const made=Array.from(run(`mirrorObjects(selectedObjectIds(),testPlane,${keep})`));
  assert.equal(made.length,count);assert.equal(run('undoStack.length'),1);assert.equal(run('tool'),'mirror');
  for(let index=0;index<count;index++){
    const result=world(made[index]);for(let i=0;i<result.length;i++){assert.equal(result[i].id,sourceSnapshots[index][i].id);near(result[i].point,reflect(sourceSnapshots[index][i].point,plane));}
    sandbox.testObject=made[index];const volume=run('validateSolid(testObject.solid).volume');assert.ok(Math.abs(volume-volumes[index])<1e-6);
    assert.ok(run('[...testObject.solid.halfEdges.values()].every(e=>testObject.solid.halfEdges.get(e.twin).twin===e.id)'));
  }
  sandbox.testObject=made[0];assert.equal(run('testObject.solid.metadata.name'),'Perforated metadata');assert.equal(run('testObject.solid.faces.values().next().value.material'),'gold');assert.equal(made[0].shininess,.7);
  if(keep){assert.equal(run('JSON.stringify(serializeProjectObject(objects[0]))'),original);assert.notEqual(made[0].solid,sourceObjects[0].solid);assert.equal(run('groups.length'),grouped?2:0);}
  const after=doc();assert.equal(run('validateProject(JSON.parse(JSON.stringify(projectData()))).objects.length'),keep?2+count:2);
  run('undo()');assert.equal(doc(),commandBefore);run('redo()');assert.equal(doc(),after);assert.notEqual(after,before);
}
// A double reflection restores topology directions and coordinates. Hole loops
// and cavities must retain positive material volume and exporter shell winding.
reset();run(`testSource=cloneSolid(objects[0].solid);testMirror=geometryApi.reflectThroughOrigin(testSource,[1,2,-3]);testTwice=geometryApi.reflectThroughOrigin(testMirror,[1,2,-3]);validateSolid(testMirror);validateSolid(testTwice);`);
assert.equal(run('JSON.stringify([...testSource.halfEdges])'),run('JSON.stringify([...testTwice.halfEdges])'));
for(const vertex of run('[...testSource.vertices.values()]')){sandbox.testVertex=vertex;near(run('testTwice.vertices.get(testVertex.id).position'),vertex.position);}
run(`testOuter=primitivePrism([[-10,-10],[10,-10],[10,10],[-10,10]],20,'outer');testInner=primitivePrism([[-3,-3],[3,-3],[3,3],[-3,3]],6,'inner');testCavity=csgToSolid(csgSubtract(solidToCsg(testOuter),csgPolygonsInReference(testInner,{position:[0,0,5],rotation:[0,0,0]},{position:[0,0,0],rotation:[0,0,0]})),'cavity');testReflectedCavity=geometryApi.reflectThroughOrigin(testCavity,[1,2,3]);`);
assert.ok(Math.abs(run('validateSolid(testCavity).volume')-run('validateSolid(testReflectedCavity).volume'))<1e-6);
const control={report(){},isCancelled:()=>false};sandbox.testControl=control;
run(`testExports=[{...objects[0],solid:testMirror},{...objects[1],id:'cavity',solid:testReflectedCavity}]`);
const step=await run('stepFileAsync(testExports,"mirror.step",testControl)');assert.match(await step.text(),/BREP_WITH_VOIDS/);
const stl=run('prepareBinarySTL(testExports)');assert.ok(stl.byteLength>84);
// Dimension anchors follow stable vertices, including an interior edge point.
reset();run(`testVertexIds=[...objects[0].solid.vertices.keys()];testAnchors=[{kind:'vertex',objectId:'a',vertexId:testVertexIds[0],fallback:[0,0,0]},{kind:'edge',objectId:'a',vertexA:testVertexIds[0],vertexB:testVertexIds[1],t:.3,fallback:[0,0,0]}];testAnchorPoints=testAnchors.map(resolveGeometryAnchor);mirrorObjects(['a'],{normal:[1,2,3],offset:7},false)`);
for(let i=0;i<2;i++)near(run(`resolveGeometryAnchor(testAnchors[${i}])`),reflect(plain(run(`testAnchorPoints[${i}]`)),{normal:[1,2,3],offset:7}));
// Complete groups preserve hidden members; partial selections stay individual.
reset(true);run('objects[1].hidden=true;mirrorObjects(selectedObjectIds(),{normal:[1,0,0],offset:0},true)');assert.equal(run('objects.length'),4);assert.equal(run('groups.length'),2);assert.equal(run('selectedObjectIds().length'),2);assert.equal(run('objects[3].hidden'),true);
reset(true);run("setObjectSelection(['a'],null,true,false);mirrorObjects(selectedObjectIds(),{normal:[1,0,0],offset:0},true)");assert.equal(run('objects.length'),3);assert.equal(run('groups.length'),1);assert.equal(run('groupForObjectId(objects[2].id)'),null);
// Real projected picking of another, locked object's oblique face leaves the
// source selection intact. Staging never changes the document or computes solids.
reset();run(`objects[1].locked=true;testFace=geometryApi.faceIds(objects[1].solid).find(id=>geometryApi.face(objects[1].solid,id).plane.normal[0]>.99);testFaceView=geometryApi.face(objects[1].solid,testFace);testNormal=V.unit(transformDir(testFaceView.plane.normal,objects[1].transform));testCenter=transformPoint(testFaceView.centroid,objects[1].transform);camera.target=testCenter;camera.distance=80;camera.yaw=Math.atan2(testNormal[1],testNormal[0]);camera.pitch=Math.asin(testNormal[2]);camera.orthographic=true;cameraBasis();testXY=project(testCenter);`);
const pickBefore=doc(),xy=plain(run('testXY'));run(`dispatchToolPointerDown({button:0,clientX:${xy[0]},clientY:${xy[1]},pointerId:1})`);
assert.equal(doc(),pickBefore);assert.equal(run('mirrorDraft.reference.object.id'),'b');assert.deepEqual(plain(run('selectedObjectIds()')),['a']);assert.equal(get('applyMirror').disabled,false);
near(run('mirrorDraft.plane.normal'),run('testNormal'));assert.ok(Math.abs(run('mirrorDraft.plane.offset')-run('V.dot(testNormal,testCenter)'))<1e-9);
run('drawMirrorPlanePreview()');const draft=run('mirrorDraft');run('beginCameraPointer({button:2},400,300,activeToolController());handleToolEscape()');assert.equal(run('mirrorDraft'),draft);
get('applyMirror').onclick();assert.equal(run('objects.length'),3);assert.equal(run('objects[1].locked'),true);assert.equal(run('undoStack.length'),1);assert.equal(run('mirrorDraft'),null);assert.equal(run('tool'),'mirror');run('undo()');assert.equal(doc(),pickBefore);assert.equal(run('mirrorDraft'),null);
// No selection captures the clicked group; Escape/tool/selection/model changes
// consume only transient state and do not enter history.
reset(true);run(`clearSelection();stageMirrorPlane({id:'a',face:[...objects[0].solid.faces.keys()][0]});`);assert.equal(run('mirrorDraft.sources.length'),2);run('handleToolEscape()');assert.equal(run('mirrorDraft'),null);assert.equal(run('tool'),'mirror');assert.equal(run('undoStack.length'),0);run('handleToolEscape()');assert.equal(run('tool'),'select');
for(const change of ["selectObject(objects[1])","modelRevision++","objects[0].transform.position[0]++","objects[1].hidden=true","objects[1].solid=cloneSolid(objects[1].solid)"]){reset();run(`stageMirrorPlane({id:'b',face:[...objects[1].solid.faces.keys()][0]});${change};`);const before=doc();get('applyMirror').onclick();assert.equal(doc(),before);assert.equal(run('undoStack.length'),0);assert.equal(run('mirrorDraft'),null);}
reset();run("stageMirrorPlane({id:'a',face:[...objects[0].solid.faces.keys()][0]});setTool('move')");assert.equal(run('mirrorDraft'),null);assert.equal(run('undoStack.length'),0);
// Global planes reflect about zero, rather than the object's/group's center.
for(const [mode,normal] of [['world-xy',[0,0,1]],['world-xz',[0,1,0]],['world-yz',[1,0,0]]]){
  reset(true);get('mirrorPlaneMode').value=mode;get('mirrorPlaneMode').onchange();assert.equal(run('mirrorPlaneMode'),mode);assert.equal(run('mirrorDraft.plane.offset'),0);near(run('mirrorDraft.plane.normal'),normal);
  get('mirrorKeepOriginal').checked=false;get('mirrorKeepOriginal').onchange();const points=world(run('objects[0]'));const before=doc();get('applyMirror').onclick();assert.equal(run('objects.length'),2);const after=world(run('objects[0]'));after.forEach((vertex,i)=>near(vertex.point,reflect(points[i].point,{normal,offset:0})));run('undo()');assert.equal(doc(),before);
}
// Enter owns its browser default (including a focused Apply button), and a
// held key cannot create repeated copies in a world-plane mode.
reset();get('mirrorPlaneMode').value='world-xy';get('mirrorPlaneMode').onchange();run(`testPrevented=0;testKey={key:'Enter',repeat:false,preventDefault(){testPrevented++}};handleApplicationKeyDown(testKey);testKey.repeat=true;handleApplicationKeyDown(testKey);`);assert.equal(run('testPrevented'),2);assert.equal(run('objects.length'),3);assert.equal(run('undoStack.length'),1);
// Guard invalid planes, locked sources, open surfaces, busy state and capacity.
for(const expression of ["mirrorObjects(['a'],{normal:[0,0,0],offset:0},true)","mirrorObjects(['a'],{normal:[NaN,0,1],offset:0},true)","mirrorObjects(['a'],{normal:[0,0,1],offset:Infinity},true)","mirrorObjects([], {normal:[1,0,0],offset:0},true)","mirrorObjects(['missing'],{normal:[1,0,0],offset:0},true)","objects[0].locked=true;mirrorObjects(['a'],{normal:[1,0,0],offset:0},true)","objects[0].kind='surface';mirrorObjects(['a'],{normal:[1,0,0],offset:0},false)"]){
  reset();const history=run('undoStack.length');assert.throws(()=>run(expression));assert.equal(run('undoStack.length'),history);assert.equal(run('objects.length'),2);
}
reset();run("beginModelingOperation('Busy')");const busyBefore=doc();assert.throws(()=>run("mirrorObjects(['a'],{normal:[1,0,0],offset:0},true)"),/Wait/);get('applyMirror').onclick();assert.equal(doc(),busyBefore);run('endModelingOperation()');
reset();run(`while(objects.length<PROJECT_CAPACITY_POLICY.maximumObjects)objects.push({...objects[1],id:'capacity'+objects.length});`);assert.throws(()=>run("mirrorObjects(['a'],{normal:[1,0,0],offset:0},true)"),/limit/);assert.equal(run('undoStack.length'),0);
reset(true);run(`while(groups.length<MIRROR_POLICY.maximumGroups){const ids=[0,1].map(index=>{const id='capacity-member'+objects.length;objects.push({...objects[index],id});return id;});groups.push({id:'capacity-group'+groups.length,name:'Capacity',objectIds:ids});}`);assert.throws(()=>run("mirrorObjects(['a','b'],{normal:[1,0,0],offset:0},true)"),/limit/);
// The complete command validates each changed result exactly once, and does not
// re-validate unchanged sources or re-triangulate solely for the first display.
reset(true);run(`testValidate=validateSolid;testValidationCalls=[];validateSolid=(...args)=>{testValidationCalls.push(args[0]);return testValidate(...args)};`);
try{run("testMade=mirrorObjects(selectedObjectIds(),{normal:[1,2,3],offset:7},true)");assert.equal(run('testValidationCalls.length'),2);assert.equal(run('testValidationCalls.every(solid=>testMade.some(object=>object.solid===solid))'),true);run('testMade.forEach(object=>sceneGeometry.mesh(object))');assert.equal(run('testValidationCalls.length'),2);}finally{run('validateSolid=testValidate');}
// Inject a second-result validation failure to verify rollback after every
// target has been replaced/appended, including group IDs, counters and selection.
for(const keepOriginal of [false,true]){
  reset(true);const before=doc();run(`testValidate=validateSolid;testValidationCount=0;validateSolid=(...args)=>{if(++testValidationCount===2)throw Error('Injected second-result validation failure.');return testValidate(...args)};`);
  try{assert.throws(()=>run(`mirrorObjects(selectedObjectIds(),{normal:[1,0,0],offset:0},${keepOriginal})`),/Injected/);}finally{run('validateSolid=testValidate');}
  assert.equal(doc(),before);assert.equal(run('undoStack.length'),0);assert.equal(run('groups.length'),1);
}
// Native reopen reads the reflected canonical graph with no new schema/scale.
reset(true);run("mirrorObjects(selectedObjectIds(),{normal:[2,-3,5],offset:17},true);testSaved=JSON.parse(JSON.stringify(projectData()))");const saved=doc();run('loadProject(testSaved)');assert.equal(doc(),saved);run('objects.forEach(object=>validateSolid(object.solid))');
const template=fs.readFileSync(resolve(root,'src/template.html'),'utf8');assert.match(template,/data-tool="mirror"/);assert.match(template,/id="mirrorToolOptionsHelp" class="sidebar-help-source" hidden/);assert.equal(run('TOOL_OPTION_PANELS.mirror'),'mirrorToolOptions');
console.log('R266 Mirror passed: independent world reflection, oblique/scaled planes, hole/cavity winding and export, metadata/IDs, detached copies, groups/hidden/partial selections, dimension anchors, projected locked-reference picking, plane-only staging, presets, cancellation/staleness/guards, atomic rollback and exact Undo/Redo/native validation.');
