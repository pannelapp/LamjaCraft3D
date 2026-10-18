import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root),run=s=>vm.runInContext(s,sandbox),html=fs.readFileSync(resolve(root,'src/template.html'),'utf8');
const options=run('Object.values(DELETE_TOOL_OPTIONS)');
assert.equal(options.length,10);
for(const option of options){assert.equal(get(option.id).checked,option.defaultEnabled);assert.equal(option.defaultEnabled,!['deleteObjects','deleteGroups','deleteTrimEdges','deletePoints'].includes(option.id));const input=html.match(new RegExp('<input[^>]*id="'+option.id+'"[^>]*>'))?.[0];assert.ok(input);assert.equal(/\bchecked\b/.test(input),option.defaultEnabled);}
run(`hitTestDimension=()=>testDimensionId;hitTestGuideLine=()=>testGuideId;hitTest=()=>testHit;topologyEdgeAt=()=>testEdge;`);
const setup=kind=>{
 Object.assign(sandbox,{testKind:kind,testHit:null,testEdge:null,testDimensionId:null,testGuideId:null});
 run(`(()=>{replaceObjects([]);replaceGroups([]);replaceGuides([]);replaceDimensions([]);clearSelection(false);clearHover();debugPointerXY=[400,300];
 for(const option of Object.values(DELETE_TOOL_OPTIONS))$(option.id).checked=option.defaultEnabled;
 const o=makeObject('box');objects.push(o);selectObject(o);
 if(['hole','pocket','boss'].includes(testKind)){
  const base=geometryApi.createPrism([[-20,-15],[20,-15],[20,15],[-20,15]],20,'delete-fixture'),top=[...base.faces.values()].find(f=>f.plane.normal[2]>.999),split=geometryApi.splitFaceRegion(base,top.id,[[-6,-5,20],[6,-5,20],[6,5,20],[-6,5,20]],'Sketch');
  o.solid=geometryApi.moveFace(split.solid,split.regionFaceId,testKind==='hole'?-30:testKind==='pocket'?-5:5).solid;
  const support=[...o.solid.faces.values()].find(f=>f.plane.normal[2]>.999&&Math.abs(f.plane.offset-20)<1e-5),edge=o.solid.loops.get(support.innerLoops[0]).firstHalfEdge;
  testEdge={kind:'edge',objectId:o.id,halfEdgeId:edge};
 }
 if(testKind==='group'){const b=makeObject('box');b.transform.position=[70,0,0];objects.push(b);setObjectSelection([o.id,b.id]);createGroupFromSelection();}
 if(testKind==='guide-line')testGuideId=addGuideLine([0,0,0],[10,0,0]).id;
 if(testKind==='guide-circle')testGuideId=addGuideCircle([0,0,0],[0,0,1],5).id;
 if(testKind==='dimension')testDimensionId=addLinearDimension({kind:'world',point:[0,0,0]},{kind:'world',point:[10,0,0]}).id;
 testHit={id:o.id,face:[...o.solid.faces.keys()][0],point:[0,0,20],localPoint:[0,0,20],t:1};
 setTool('delete');})()`);
};
const change=(id,value)=>{get(id).checked=value;for(const listener of get(id).listeners?.change||[])listener({target:get(id)});};
const hover=()=>run('updateToolHoverFeedback(deleteToolController,400,300)');
const click=()=>run('deleteToolController.pointerDown({event:{button:0},x:400,y:300,rawHit:testHit,hit:testHit})');
const state=()=>run('JSON.stringify(projectData())');
for(const [kind,id,command] of [['object','deleteObjects','delete-object'],['group','deleteGroups','delete-group'],['hole','deleteHoles','delete-recognized-feature'],['pocket','deletePockets','delete-recognized-feature'],['boss','deleteProtrusions','delete-recognized-feature'],['guide-line','deleteGuides','delete-guide'],['guide-circle','deleteGuides','delete-guide'],['dimension','deleteDimensions','delete-dimension']]){
 setup(kind);assert.equal(get('deleteToolOptions').classList.contains('hidden'),false);assert.equal(run('resolveDeleteToolTarget(400,300).kind'),kind.startsWith('guide')?'guide':['hole','pocket','boss'].includes(kind)?'feature':kind);
 // Permit objects to prove disabled feature/guide/dimension/group targets cannot fall through to an object.
 change('deleteObjects',true);change(id,true);hover();assert.notEqual(run('modelDocument.hover'),null,kind+' enabled hover');
 const before=state(),history=run('undoStack.length'),revision=run('modelRevision');change(id,false);assert.equal(run('modelDocument.hover'),null,kind+' stale hover');assert.equal(run('deleteObjectHoverId'),null);assert.equal(run('deleteFeatureHover'),null);click();assert.equal(state(),before,kind+' disabled mutation');assert.equal(run('undoStack.length'),history);assert.equal(run('modelRevision'),revision);
 change(id,true);hover();click();assert.equal(run('lastCommandEntry().type'),command);assert.equal(run('undoStack.length'),history+1);assert.equal(run('tool'),'delete');
 if(kind==='group')assert.equal(run('objects.length'),0);if(kind==='object')assert.equal(run('objects.length'),0);
 if(['hole','pocket','boss'].includes(kind)){assert.equal(run('objects.length'),1);assert.equal(run('geometryApi.validate(objects[0].solid,false).ok'),true);assert.ok(Math.abs(run('geometryApi.validate(objects[0].solid,false).volume')-24000)<1e-6);}
 const after=state();run('undo()');assert.equal(state(),before);run('redo()');assert.equal(state(),after);
}
// Default-off object deletion requires no state/history entry and has no destructive highlight.
setup('object');const before=state(),history=run('undoStack.length');hover();click();assert.equal(state(),before);assert.equal(run('undoStack.length'),history);assert.equal(run('deleteObjectHoverId'),null);
change('deletePockets',false);change('deleteObjects',true);run("setTool('select');setTool('delete')");assert.equal(get('deletePockets').checked,false);assert.equal(get('deleteObjects').checked,true);assert.equal(state(),before);assert.equal(run('undoStack.length'),history);
// A group is an explicit enabled category even though individual Objects is off.
setup('group');assert.equal(get('deleteObjects').checked,false);assert.equal(get('deleteGroups').checked,false);const groupedBefore=state(),groupedHistory=run('undoStack.length');hover();click();assert.equal(state(),groupedBefore);assert.equal(run('undoStack.length'),groupedHistory);assert.equal(run('modelDocument.hover'),null);change('deleteGroups',true);hover();assert.equal(run('modelDocument.hover.kind'),'group');click();assert.equal(run('objects.length'),0);
assert.match(html,/id="deleteToolOptionsHelp"/);assert.match(html,/Keyboard Delete and the property-panel Delete buttons/);
// Use real camera/ray/edge picking for flat sketches, not injected hit results.
for(const shape of ['rectangle','circle','open-contour']){
 const fixture=createAppFixture(root),k=fixture.sandbox,r=s=>vm.runInContext(s,k);k.testShape=shape;
 const faceId=r(`(()=>{replaceObjects([]);replaceGroups([]);replaceGuides([]);replaceDimensions([]);
  const o=makeObject('box');o.solid=geometryApi.createPrism([[-20,-15],[20,-15],[20,15],[-20,15]],20,'flat-sketch');objects.push(o);selectObject(o);
  const top=[...o.solid.faces.values()].find(f=>f.plane.normal[2]>.999),basis=geometryApi.face(o.solid,top.id).basis;
  if(testShape==='open-contour')return createOpenFaceContour(o,top.id,[[0,-15,20],[0,0,20],[0,15,20]].map(p=>toPlane2(p,basis)));
  const points=testShape==='circle'?circlePoints([0,0],[5,0],24):[[-6,-5],[6,-5],[6,5],[-6,5]];
  return createFaceSketch(o,top.id,points.map(p=>toPlane2([p[0],p[1],20],basis)),testShape==='circle'?'circle':'rectangle');})()`);
 k.testFaceId=faceId;
 assert.equal(r('geometryApi.sketchDeleteCandidate(current().solid,testFaceId)'),faceId);
 // Native reopening retains enough canonical face information to recognize the sketch.
 r("loadProject(JSON.parse(JSON.stringify(projectData())));setTool('delete')");fixture.viewButtons.find(b=>b.dataset.view==='top').onclick();r('fit();cameraBasis()');
 const center=r('project(transformPoint(geometryApi.face(objects[0].solid,testFaceId).centroid,objects[0].transform))');k.testX=center[0];k.testY=center[1];
 assert.equal(r('hitTest(testX,testY).face'),faceId,shape+' real face picking');
 r('updateToolHoverFeedback(deleteToolController,testX,testY)');assert.equal(r('modelDocument.hover.kind'),'face');assert.equal(r('modelDocument.hover.faceId'),faceId);
 // A support-side boundary click selects the sketch across its coplanar edge.
 if(shape!=='open-contour'){
  const boundary=r(`project([testShape==='circle'?5.05:6.05,0,20])`);k.boundaryX=boundary[0];k.boundaryY=boundary[1];
  assert.notEqual(r('hitTest(boundaryX,boundaryY).face'),faceId);
  assert.equal(r('resolveDeleteToolTarget(boundaryX,boundaryY).faceId'),faceId,shape+' support-side outline');
 }
 fixture.get('deleteObjects').checked=true;fixture.get('deleteSketches').checked=false;r('refreshDeleteToolOptions()');
 const before=r('JSON.stringify(projectData())'),history=r('undoStack.length');
 r('updateToolHoverFeedback(deleteToolController,testX,testY);deleteToolController.pointerDown({event:{button:0},x:testX,y:testY,rawHit:null,hit:hitTest(testX,testY)})');assert.equal(r('modelDocument.hover'),null);assert.equal(r('JSON.stringify(projectData())'),before);assert.equal(r('undoStack.length'),history);
 fixture.get('deleteSketches').checked=true;r('refreshDeleteToolOptions();updateToolHoverFeedback(deleteToolController,testX,testY);deleteToolController.pointerDown({event:{button:0},x:testX,y:testY,rawHit:null,hit:hitTest(testX,testY)})');
 assert.equal(r('lastCommandEntry().type'),'dissolve-face');assert.equal(r('objects.length'),1);assert.equal(r('objects[0].solid.faces.size'),6);assert.equal(r('geometryApi.validate(objects[0].solid,false).ok'),true);assert.ok(Math.abs(r('geometryApi.validate(objects[0].solid,false).volume')-24000)<1e-6);assert.equal(r('undoStack.length'),history+1);
 const after=r('JSON.stringify(projectData())');r('undo()');assert.equal(r('JSON.stringify(projectData())'),before);r('redo()');assert.equal(r('JSON.stringify(projectData())'),after);
}
// Shell faces and an extruded sketch cap must not be classified as flat sketches.
const guard=createAppFixture(root),g=s=>vm.runInContext(s,guard.sandbox);
assert.equal(g(`(()=>{const o=current(),top=[...o.solid.faces.values()].find(f=>f.plane.normal[2]>.999);return geometryApi.sketchDeleteCandidate(o.solid,top.id);})()`),null);
assert.equal(g(`(()=>{const o=current(),top=[...o.solid.faces.values()].find(f=>f.plane.normal[2]>.999),fid=createFaceSketch(o,top.id,[[-6,-5],[6,-5],[6,5],[-6,5]],'rectangle');applyFaceMove(o,fid,5);return geometryApi.sketchDeleteCandidate(o.solid,selectedFaceId());})()`),null);
console.log('R200 Delete options passed: ten defaults, eight existing target types, shared hover/click gating, immediate stale-highlight cleanup, no disabled-target fallback, session tool switching, existing commands/one-entry history/exact Undo/Redo valid healed features and real rectangle/circle/open-contour sketch picking, native reopening, preserved shape and shell/pushed-cap guards.');
