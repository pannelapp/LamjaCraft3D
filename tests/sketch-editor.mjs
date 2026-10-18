import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';

const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root),run=code=>vm.runInContext(code,sandbox);
const read=code=>JSON.parse(run(`JSON.stringify(${code})`));
const project=()=>run('JSON.stringify(projectData())');
const key=(key,extra={})=>{sandbox.keyEvent={key,preventDefault(){},...extra};run('handleApplicationKeyDown(keyEvent)');};
const fire=(type,event={})=>{const e={button:0,pointerId:1,preventDefault(){},shiftKey:false,...event};for(const handler of get('sketchEditorCanvas').listeners?.[type]||[])handler(e);};
const screen=p=>{sandbox.point=p;return read('sketchEditorScreen(point,sketchEditorDraft)');};
const pointer=(type,p,extra={})=>{const [clientX,clientY]=screen(p);fire(type,{clientX,clientY,...extra});};
const click=p=>{pointer('pointerdown',p);pointer('pointerup',p);};
const reset=()=>{
  run("cancelGesture();replaceObjects([]);replaceGroups([]);replaceGuides([]);replaceDimensions([]);objects.push(makeObject('box'));selectObject(objects[0]);undoStack.length=0;redoStack.length=0;activateTool('select');camera.yaw=Math.PI/4;camera.pitch=Math.PI/3;camera.distance=130;camera.target=[0,0,10];camera.orthographic=false;cameraBasis();");
  get('sketchEditorGrid').value='1';get('sketchEditorSnapGrid').checked=true;get('sketchEditorReference').checked=false;
};
const start=()=>run("setSelectedFace(objects[0],[...objects[0].solid.faces.values()].find(f=>f.plane.normal[2]>.999).id);setTool('sketcheditor')");
const loop=points=>{sandbox.sketchLoopInput=points;run("appendSketchEditorPath({kind:'line',points:[...sketchLoopInput,sketchLoopInput[0]]})");};
const valid=()=>run('geometryApi.validateSketchDraft(sketchEditorDraft.paths).ok');
const place=()=>run("(()=>{const d=sketchEditorDraft,p=project(transformPoint(d.frame.origin,d.object.transform));return updateSketchEditorPlacement(p[0],p[1])})()");
const docIsValid=()=>assert.equal(run('geometryApi.validate(objects[0].solid,false).ok'),true);

reset();const baseline=project(),camera=read('camera');start();
assert.equal(run('sketchEditorDraft.phase'),'editing');assert.equal(get('sketchEditorDialog').open,true);
assert.equal(project(),baseline);assert.deepEqual(read('camera'),camera);assert.equal(run('undoStack.length'),0);
// Continue a contour after ending a chain and switching tools. Pointer snapping
// joins its real endpoints; no draft or construction data enters the document.
click([-8,-5]);click([8,-5]);key('Escape');assert.equal(run('sketchEditorDraft.pending.length'),0);
run("setSketchEditorMode('guide')");click([-15,0]);click([15,0]);
run("setSketchEditorMode('measure')");click([-8,-5]);click([8,-5]);
assert.equal(valid(),false);assert.equal(run('returnFromSketchEditor()'),false);assert.equal(get('sketchEditorDialog').open,true);
assert.equal(run('sketchEditorDraft.problems.length'),2);
run("setSketchEditorMode('line')");click([8.06,-4.97]);click([8,5]);click([-8,5]);click([-8,-5]);
assert.equal(valid(),true);assert.equal(project(),baseline);assert.equal(run('undoStack.length'),0);
// Local keyboard history stays inside the editor and clears redo on a branch.
key('z',{ctrlKey:true});assert.equal(valid(),false);assert.equal(run('undoStack.length'),0);
key('z',{ctrlKey:true,shiftKey:true});assert.equal(valid(),true);
assert.equal(run('returnFromSketchEditor()'),true);assert.equal(get('sketchEditorDialog').open,false);
assert.equal(get('sketchPlacementBar').classList.contains('hidden'),false);assert.equal(project(),baseline);
key('Escape');assert.equal(run('sketchEditorDraft.phase'),'editing');assert.equal(get('sketchEditorDialog').open,true);
assert.equal(run('returnFromSketchEditor()'),true);place();assert.ok(run('sketchEditorDraft.placement'));
run("(()=>{const d=sketchEditorDraft,p=project(transformPoint(d.frame.origin,d.object.transform));dispatchToolPointerMove({clientX:p[0],clientY:p[1]});dispatchToolPointerDown({clientX:p[0],clientY:p[1],button:0,pointerId:2});dispatchToolPointerUp({clientX:p[0],clientY:p[1],button:0,pointerId:2})})()");assert.equal(run('sketchEditorDraft'),null);
assert.equal(run('objects[0].solid.faces.size'),7);assert.equal(run('undoStack.length'),1);docIsValid();
assert.equal(run('dimensions.length'),0);assert.equal(run('guides.length'),0);assert.equal(run('tool'),'sketcheditor');
const inserted=project();assert.doesNotMatch(inserted,/sketchEditor|"paths"|"pending"/);
run('undo()');assert.equal(project(),baseline);assert.equal(run('sketchEditorDraft'),null);assert.equal(get('sketchEditorDialog').open,false);
run('redo()');assert.equal(project(),inserted);assert.equal(run('sketchEditorDraft'),null);docIsValid();

// The validator accepts independently drawn/reversed segments, nested and
// disconnected loops, small contours and endpoints within the named tolerance.
const validate=paths=>{sandbox.paths=paths;return read('geometryApi.validateSketchDraft(paths)');};
const closed=points=>({kind:'line',points:[...points,points[0]]});
const square=[[-5,-5],[5,-5],[5,5],[-5,5]];
assert.equal(validate([{kind:'line',points:[[5,-5],[-5,-5]]},{kind:'line',points:[[-5,5],[5,5]]},{kind:'line',points:[[-5,-5],[-5,5]]},{kind:'line',points:[[5,5],[5,-5]]}]).ok,true);
for(const size of [.001,.01,1,100])assert.equal(validate([closed([[0,0],[size,0],[size,size],[0,size]])]).ok,true,'scale '+size);
assert.equal(validate([{kind:'line',points:[[0,0],[1,0],[1,1],[0,1],[0,.00005]]}]).ok,true);
assert.equal(validate([{kind:'line',points:[[0,0],[1,0],[1,1],[0,1],[0,.001]]}]).ok,false);
for(const paths of [
  [closed([[0,0],[5,5],[0,5],[5,0]])], // crossing
  [closed([[0,0],[5,0],[2,0],[2,5]])], // adjacent overlap
  [closed(square),{kind:'line',points:[[-5,-5],[5,-5]]}], // duplicate
  [closed(square),{kind:'line',points:[[0,-5],[0,0]]}], // branch
  [closed(square),closed([[5,5],[8,5],[8,8],[5,8]])], // touching loops
  [closed([[0,0],[10,0],[10,10],[5,0],[0,10]])], // nonadjacent endpoint touch
  [closed([[0,0],[1,0],[1,NaN]])],
  [{kind:'guide',points:[[0,0],[1,0]]},{kind:'measure',points:[[0,0],[1,1]]}],
])assert.equal(validate(paths).ok,false,JSON.stringify(paths));
assert.equal(validate([closed(square),closed([[-2,-2],[2,-2],[2,2],[-2,2]])]).loops.length,2);
const tooMany=Array.from({length:4098},(_,i)=>[Math.cos(i/4097*Math.PI*2)*100,Math.sin(i/4097*Math.PI*2)*100]);
assert.equal(validate([{kind:'line',points:tooMany}]).ok,false);

// Arc endpoints remain exact and can close against separate line strokes.
reset();start();run("setSketchEditorMode('arc');sketchEditorClick([-6,0]);sketchEditorClick([6,0]);sketchEditorClick([0,6]);setSketchEditorMode('line');sketchEditorClick([6,0]);sketchEditorClick([-6,0])");
assert.equal(valid(),true);assert.deepEqual(read('sketchEditorDraft.paths[0].points[0]'),[-6,0]);assert.deepEqual(read('sketchEditorDraft.paths[0].points.at(-1)'),[6,0]);
assert.equal(run('returnFromSketchEditor()'),true);place();assert.equal(run('commitSketchEditorPlacement()'),true);docIsValid();
// Numeric entry shares exactly the same stroke creation path as pointer input.
reset();start();run("setSketchEditorMode('rectangle');sketchEditorClick([-7,-4])");get('sketchEditorValueA').value='14';get('sketchEditorValueB').value='8';get('sketchEditorExact').onclick();assert.equal(valid(),true);
run("setSketchEditorMode('circle');sketchEditorClick([0,0])");get('sketchEditorValueA').value='2';get('sketchEditorExact').onclick();assert.equal(valid(),true);assert.equal(run('returnFromSketchEditor()'),true);place();assert.equal(run('commitSketchEditorPlacement()'),true);docIsValid();
assert.ok(run('[...objects[0].solid.faces.values()].some(f=>f.innerLoops.length===1&&geometryApi.faceArea(objects[0].solid,f.id)<112)'),'nested contours leave an annular face');
assert.equal(run('undoStack.length'),1);

// Select/drag moves every coincident endpoint and has one local undo step.
reset();start();run("setSketchEditorMode('line');sketchEditorClick([-5,-5]);sketchEditorClick([5,-5]);sketchEditorClick([5,5]);sketchEditorClick([-5,5]);sketchEditorClick([-5,-5]);setSketchEditorMode('select')");
const beforeDrag=read('sketchEditorDraft.paths');pointer('pointerdown',[5,5]);pointer('pointermove',[7,7]);pointer('pointermove',[8,8]);pointer('pointerup',[8,8]);
assert.equal(run('sketchEditorDraft.paths.flatMap(p=>p.points).filter(p=>p[0]===8&&p[1]===8).length'),2);assert.equal(valid(),true);
key('z',{ctrlKey:true});assert.deepEqual(read('sketchEditorDraft.paths'),beforeDrag);key('z',{ctrlKey:true,shiftKey:true});assert.equal(valid(),true);
pointer('pointerdown',[8,8]);pointer('pointermove',[9,9]);key('Escape');assert.equal(valid(),true);assert.equal(run('sketchEditorDraft.drag'),null);
pointer('pointerdown',[8,8]);pointer('pointermove',[9,9]);fire('pointercancel');assert.equal(valid(),true);
run('sketchEditorDraft.selected=0');key('Delete');assert.equal(valid(),false);key('z',{ctrlKey:true});assert.equal(valid(),true);
// Wheel zoom preserves the point under the cursor; pan does not change paths.
const strokes=read('sketchEditorDraft.paths');const p=screen([3,4]);sandbox.p=p;const beforeZoom=read('sketchEditorRaw(p[0],p[1],sketchEditorDraft)');fire('wheel',{clientX:p[0],clientY:p[1],deltaY:-300});const afterZoom=read('sketchEditorRaw(p[0],p[1],sketchEditorDraft)');assert.ok(Math.hypot(afterZoom[0]-beforeZoom[0],afterZoom[1]-beforeZoom[1])<1e-9);
fire('pointerdown',{button:2,clientX:100,clientY:100});fire('pointermove',{clientX:120,clientY:140});fire('pointerup');assert.deepEqual(read('sketchEditorDraft.paths'),strokes);

// Validate real commands on different support orientations and transformed
// objects. Read back B-rep geometry/volume and test actual model Push/Pull.
for(const normal of [[0,0,1],[1,0,0],[0,-1,0]]){
  reset();sandbox.normal=normal;run("objects[0].transform={position:[17,-9,4],rotation:[.2,-.3,.6]};setSelectedFace(objects[0],[...objects[0].solid.faces.values()].find(f=>V.dot(f.plane.normal,normal)>.999).id);setTool('sketcheditor')");
  const before=project(),volume=run('geometryApi.validate(objects[0].solid,false).volume');loop([[-4,-3],[4,-3],[4,3],[-4,3]]);run('returnFromSketchEditor();sketchEditorDraft.placement=[1,2]');assert.equal(run('commitSketchEditorPlacement()'),true,get('toast').textContent+' normal '+normal);docIsValid();assert.ok(Math.abs(run('geometryApi.validate(objects[0].solid,false).volume')-volume)<1e-7);
  const face=run('selectedFaceRef().faceId');sandbox.face=face;assert.ok(Math.abs(run('geometryApi.faceArea(objects[0].solid,face)')-48)<1e-7);
  run('applyFaceMove(objects[0],face,2)');docIsValid();assert.ok(Math.abs(run('geometryApi.validate(objects[0].solid,false).volume')-volume-96)<1e-6);run('undo();undo()');assert.equal(project(),before);
}

// Every loop commits atomically, including clipping, disjoint regions and
// rejection of a later loop after an earlier successful subdivision.
reset();start();loop([[-8,-4],[-2,-4],[-2,4],[-8,4]]);loop([[2,-4],[8,-4],[8,4],[2,4]]);run('returnFromSketchEditor();sketchEditorDraft.placement=[0,0]');assert.equal(run('commitSketchEditorPlacement()'),true);assert.equal(run('objects[0].solid.faces.size'),8);assert.equal(run('undoStack.length'),1);docIsValid();
reset();start();const preReject=project();loop([[-4,-4],[4,-4],[4,4],[-4,4]]);loop([[100,100],[110,100],[110,110],[100,110]]);run('returnFromSketchEditor();sketchEditorDraft.placement=[0,0]');assert.equal(run('commitSketchEditorPlacement()'),false);assert.equal(project(),preReject);assert.equal(run('undoStack.length'),0);assert.equal(run('sketchEditorCurrent(sketchEditorDraft)'),true);run('reopenSketchEditor();sketchEditorDraft.selected=1;deleteSketchEditorStroke();returnFromSketchEditor();sketchEditorDraft.placement=[0,0]');assert.equal(run('commitSketchEditorPlacement()'),true);docIsValid();
reset();start();loop([[-30,-4],[4,-4],[4,4],[-30,4]]);run('returnFromSketchEditor();sketchEditorDraft.placement=[0,0]');assert.equal(run('commitSketchEditorPlacement()'),true);docIsValid();

// Preparing an already selected face needs boundary data, never an area or
// triangulation. Preserve the usual sidebar update before instrumenting this.
reset();run(`setSelectedFace(objects[0],[...objects[0].solid.faces.values()].find(f=>f.plane.normal[2]>.999).id);activateTool('sketcheditor');
const editorEntryArea=faceAreaLocal,editorEntryTri=triangulateFaceLocal;faceAreaLocal=()=>{throw Error('Sketch entry computed unused face area');};triangulateFaceLocal=()=>{throw Error('Sketch entry triangulated');};
startSketchEditor(objects[0],selectedFaceRef().faceId);faceAreaLocal=editorEntryArea;triangulateFaceLocal=editorEntryTri;cancelSketchEditor();`);

// Placement uses the same world snaps/grid as ordinary face drawing while
// reusing the prepared support. Warm hover cannot read loops or triangulate.
reset();start();loop(square);run('returnFromSketchEditor()');place();
run(`const editorHoverDraft=sketchEditorDraft,editorHoverPixels=[[-3.1,2.2],[1.3,-2.7],[0,0]].map(p=>project(transformPoint(fromPlane2(p,editorHoverDraft.frame),editorHoverDraft.transform))),editorHoverExpected=editorHoverPixels.map(p=>toPlane2(onFacePoint(p[0],p[1],editorHoverDraft.object,editorHoverDraft.faceId,true).local,editorHoverDraft.frame));
const editorSavedLoops=faceLoopPoints,editorSavedArea=faceAreaLocal,editorSavedTri=triangulateFaceLocal;
faceLoopPoints=()=>{throw Error('Sketch placement walked boundary loops');};faceAreaLocal=()=>{throw Error('Sketch placement computed face area');};triangulateFaceLocal=()=>{throw Error('Sketch placement triangulated');};
for(let repeat=0;repeat<5;repeat++)for(let i=0;i<editorHoverPixels.length;i++){const p=editorHoverPixels[i];updateSketchEditorPlacement(p[0],p[1]);if(v2.dist(sketchEditorDraft.placement,editorHoverExpected[i])>TOL.weld)throw Error('Prepared placement changed the ordinary face snap');drawSketchEditorPlacement();}
faceLoopPoints=editorSavedLoops;faceAreaLocal=editorSavedArea;triangulateFaceLocal=editorSavedTri;cancelSketchEditor();`);

// Lock/group/stale support protections and full transient cleanup.
for(const change of ["objects[0].solid=geometryApi.clone(objects[0].solid)","objects[0].transform.position[0]+=1","objects[0].hidden=true","objects[0].locked=true","modelRevision++"]){
  reset();start();loop(square);run('returnFromSketchEditor();sketchEditorDraft.placement=[0,0]');run(change);assert.equal(run('commitSketchEditorPlacement()'),false);place();assert.equal(run('sketchEditorDraft'),null);
}
reset();run("objects[0].locked=true;setSelectedFace(objects[0],[...objects[0].solid.faces.keys()][0]);setTool('sketcheditor')");assert.equal(run('sketchEditorDraft'),null);
reset();start();loop(square);run('setTool("circle")');assert.equal(run('sketchEditorDraft'),null);assert.equal(get('sketchEditorDialog').open,false);assert.equal(get('sketchPlacementBar').classList.contains('hidden'),true);
reset();run("addObject('box')");start();loop(square);run('undo()');assert.equal(run('sketchEditorDraft'),null);assert.equal(run('tool'),'sketcheditor');assert.equal(get('sketchEditorDialog').open,false);
reset();start();loop(square);run('prepareToolForDocumentChange();activateTool("select")');assert.equal(run('sketchEditorDraft'),null);
// Starting without a face waits for an actual model pick. Editor keyboard
// routing never dispatches Save/tool shortcuts or Undo to the model underneath.
reset();run("setTool('sketcheditor')");assert.equal(run('sketchEditorDraft'),null);
run("(()=>{const f=[...objects[0].solid.faces.values()].find(f=>f.plane.normal[2]>.999),p=project(transformPoint(geometryApi.face(objects[0].solid,f.id).centroid,objects[0].transform));dispatchToolPointerDown({clientX:p[0],clientY:p[1],button:0,pointerId:2})})()");assert.equal(run('sketchEditorDraft.phase'),'editing');
key('Escape');assert.equal(run('sketchEditorDraft'),null);assert.equal(run('tool'),'sketcheditor');key('Escape');assert.equal(run('tool'),'select');
start();loop(square);const modelBeforeKeys=project();key('s',{ctrlKey:true});assert.equal(project(),modelBeforeKeys);assert.equal(run('tool'),'sketcheditor');
run('sketchEditorDraft.pending=[[0,0]]');get('sketchEditorValueA').tagName='INPUT';get('sketchEditorValueA').blur=()=>{sandbox.document.activeElement={tagName:'BODY'};};sandbox.document.activeElement=get('sketchEditorValueA');key('Escape');assert.ok(run('sketchEditorDraft'));assert.equal(run('sketchEditorDraft.pending.length'),1);key('Escape');assert.equal(run('sketchEditorDraft.pending.length'),0);
run('sketchEditorUndo();appendSketchEditorPath({kind:"line",points:[[0,0],[1,1]]})');assert.equal(run('sketchEditorDraft.redo.length'),0);assert.equal(project(),modelBeforeKeys);
run('cancelSketchEditor()');
assert.equal(project().includes('sketchEditor'),false);
console.log('R271 Sketch Editor passed: transient multi-step drafting, exact shapes, Arc/line closure, SnapEngine endpoint joining, local history, shared-point dragging, pan/zoom, scale-independent contour validation, nested/disjoint/clipped regions, planar placement on transformed objects, ordinary Push/Pull, one atomic model Undo, rollback/retry, lock/stale guards and cancellation.');
