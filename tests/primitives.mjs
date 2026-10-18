import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root),run=code=>vm.runInContext(code,sandbox);
const template=fs.readFileSync(resolve(root,'src/template.html'),'utf8');
const kinds=['sphere','ellipsoid','cone','frustum','torus','capsule','box','cylinder'];
assert.deepEqual(Array.from(run('geometryApi.primitiveDefinitions'),d=>d.kind),kinds);
function verify(solid,torus=false){
  sandbox.solid=solid;assert.equal(run('validateSolid(solid,false).ok'),true);
  const stats=run('triangleMeshEdgeStats(solidMeshExportLocal(solid))');assert.equal(stats.boundary,0);assert.equal(stats.nonManifold,0);
  assert.equal(run('connectedSolidFaceComponents(solid).length'),1);
  assert.equal(run('solid.vertices.size-solid.halfEdges.size/2+solid.faces.size-[...solid.faces.values()].reduce((n,f)=>n+f.innerLoops.length,0)'),torus?0:2);
  assert.equal(run('JSON.stringify(serializeProjectSolid(deserializeProjectSolid(serializeProjectSolid(solid))))'),run('JSON.stringify(serializeProjectSolid(solid))'));
  assert.ok(run('[...solid.faces.values()].every(f=>f.provenance.kind==="primitive")'));
  assert.ok(Math.abs(run('Math.min(...[...solid.vertices.values()].map(v=>v.position[2]))'))<1e-9,'Base must touch local Z=0');
}
const analytic={sphere:4*Math.PI*15**3/3,ellipsoid:4*Math.PI*20*15*20/3,cone:Math.PI*15**2*40/3,frustum:Math.PI*40*(15**2+15*8+8**2)/3,torus:2*Math.PI**2*22*6**2,capsule:Math.PI*15**2*25+4*Math.PI*15**3/3,box:40*30*40,cylinder:Math.PI*15**2*40};
const metrics=[];
for(const kind of kinds){
  sandbox.kind=kind;const parameters=run('geometryApi.primitiveDefaults(kind)'),before=JSON.stringify(parameters);sandbox.parameters=parameters;
  const start=performance.now(),solid=run('geometryApi.createPrimitive(parameters,"test_shape")');verify(solid,kind==='torus');
  const volume=run('validateSolid(solid,false).volume');assert.ok(Math.abs(volume/analytic[kind]-1)<.04,kind+' faceted volume');assert.equal(JSON.stringify(parameters),before);
  metrics.push({kind,faces:solid.faces.size,ms:Math.round(performance.now()-start)});
}
// Deterministic varied scales and odd segment counts exercise the shared rule,
// including base contact and torus topology without seam/pole special patches.
for(let seed=0;seed<3;seed++)for(const kind of kinds){
  sandbox.kind=kind;sandbox.seed=seed;
  const solid=run('(()=>{const p=geometryApi.primitiveDefaults(kind),scale=[.1,1.3,3][seed];for(const key of ["width","depth","height","radius","topRadius","majorRadius","tubeRadius","straightHeight"])p[key]*=scale;p.segments=9+seed*7;p.profileSegments=5+seed*3;return geometryApi.createPrimitive(p);})()');verify(solid,kind==='torus');
}
for(const kind of ['sphere','torus','capsule']){
  sandbox.kind=kind;const solid=run('(()=>{const p=geometryApi.primitiveDefaults(kind);p.segments=64;p.profileSegments=32;return geometryApi.createPrimitive(p);})()');verify(solid,kind==='torus');assert.ok(solid.faces.size<=run('geometryApi.primitivePolicy.maximumFaces'));
}
const sameVolume=(a,b)=>assert.ok(Math.abs(a-b)<1e-7);
sameVolume(run('validateSolid(geometryApi.createPrimitive({...geometryApi.primitiveDefaults("capsule"),straightHeight:0}),false).volume'),run('validateSolid(geometryApi.createPrimitive(geometryApi.primitiveDefaults("sphere")),false).volume'));
sameVolume(run('validateSolid(geometryApi.createPrimitive({...geometryApi.primitiveDefaults("frustum"),topRadius:0}),false).volume'),run('validateSolid(geometryApi.createPrimitive(geometryApi.primitiveDefaults("cone")),false).volume'));
for(const change of ['radius:0','radius:NaN','segments:7','segments:12.5','segments:65','profileSegments:3','profileSegments:33'])assert.throws(()=>run(`geometryApi.createPrimitive({...geometryApi.primitiveDefaults('sphere'),${change}})`));
assert.throws(()=>run('geometryApi.createPrimitive({...geometryApi.primitiveDefaults("torus"),majorRadius:6,tubeRadius:6})'),/Ring radius/);
assert.throws(()=>run('geometryApi.createPrimitive({...geometryApi.primitiveDefaults("frustum"),topRadius:.01})'),/Top radius/);

// Actual model commands: independent solids, placement, unchanged neighbors,
// one command, exact Undo/Redo and atomic failure.
get('projectName').value=run('modelDocument.name');
for(const kind of kinds){
  sandbox.kind=kind;const before=run('JSON.stringify(projectData())'),count=run('objects.length'),history=run('undoStack.length');
  const object=run('addParametricObject(geometryApi.primitiveDefaults(kind),[12,-8,3])');verify(object.solid,kind==='torus');
  assert.deepEqual(Array.from(object.transform.position),[12,-8,3]);assert.equal(run('objects.length'),count+1);assert.equal(run('undoStack.length'),history+1);assert.equal(run('lastCommandEntry().type'),'add-parametric-object');assert.equal(run('selectedObjectIds().length'),1);
  assert.equal(run('objects[0].name'),'Box');
  const after=run('JSON.stringify(projectData())');run('undo()');assert.equal(run('JSON.stringify(projectData())'),before);run('redo()');assert.equal(run('JSON.stringify(projectData())'),after);run('undo()');
}
let before=run('JSON.stringify(projectData())'),history=run('undoStack.length');
assert.throws(()=>run('addParametricObject({...geometryApi.primitiveDefaults("sphere"),radius:0},[0,0,0])'));
assert.equal(run('JSON.stringify(projectData())'),before);assert.equal(run('undoStack.length'),history);
assert.throws(()=>run('addParametricObject(geometryApi.primitiveDefaults("sphere"),[0,NaN,0])'));
assert.equal(run('JSON.stringify(projectData())'),before);

// The real Shapes controller and fields share numeric/click/drag creation.
const input=id=>{for(const listener of get(id).listeners?.input||[])listener({target:get(id)});};
const choose=kind=>{get('shapeKind').value=kind;for(const listener of get('shapeKind').listeners?.change||[])listener({target:get('shapeKind')});};
run("setTool('shapes')");assert.equal(get('toolPanelTitle').textContent,'Shapes');assert.equal(get('shapeToolOptions').classList.contains('hidden'),false);
const help=template.match(/id="shapeToolOptionsHelp" hidden>([\s\S]*?)<\/div>/)[1];for(const p of help.matchAll(/<p>([\s\S]*?)<\/p>/g)){const node=sandbox.document.createElement('p');node.textContent=p[1].replace(/<[^>]+>/g,'');get('shapeToolOptionsHelp').append(node);}
const helpBefore=run('JSON.stringify(projectData())');get('toolHelpBtn').onclick();assert.equal(get('sidebarHelpTitle').textContent,'Shapes help');assert.match(get('sidebarHelpBody').children.map(p=>p.textContent).join(' '),/Ring radius/);get('closeSidebarHelpBtn').onclick();assert.equal(run('JSON.stringify(projectData())'),helpBefore);assert.equal(get('pushToolOptions').classList.contains('hidden'),true);assert.equal(run('primitivePreview.solid.faces.size'),512);assert.equal(run('JSON.stringify(projectData())'),before);
choose('torus');assert.equal(get('shapeMajorRadiusControl').classList.contains('hidden'),false);assert.equal(get('shapeHeightControl').classList.contains('hidden'),true);
get('shapeMajorRadius').value='28';input('shapeMajorRadius');get('shapeZ').value='2';input('shapeZ');const key=run('primitivePreview.key'),cached=run('primitivePreview.solid');input('shapeZ');assert.equal(run('primitivePreview.solid'),cached);assert.equal(run('primitivePreview.key'),key);
choose('sphere');get('shapeRadius').value='10';input('shapeRadius');choose('torus');assert.equal(get('shapeMajorRadius').value,'28');choose('sphere');assert.equal(get('shapeRadius').value,'10');
get('shapeX').value='8.5';get('shapeY').value='-3';get('shapeZ').value='4';input('shapeX');
run('cameraBasis();drawPrimitivePreview()');
const preview=run('JSON.stringify(serializeProjectSolid(primitivePreview.solid))');
get('createShapeBtn').onclick();assert.equal(run('tool'),'shapes');assert.equal(get('shapeToolOptions').classList.contains('hidden'),false);assert.deepEqual(Array.from(run('current().transform.position')),[8.5,-3,4]);
assert.equal(run('(()=>{const copy=geometryApi.clone(current().solid);copy.id="preview_shape";return JSON.stringify(serializeProjectSolid(copy));})()'),preview);
run('undo()');assert.equal(run('JSON.stringify(projectData())'),before);

// Real screen placement and event dispatch, including release coordinates.
const event=(x,y)=>({clientX:x,clientY:y,button:0,pointerId:1,preventDefault(){}});
run("setTool('shapes');cameraBasis()");get('shapeZ').value='0';
let screen=run('project([60,50,0])');sandbox.event=event(screen[0],screen[1]);run('dispatchToolPointerMove(event)');assert.ok(run('primitivePosition!==null'));const snapped=Array.from(run('primitivePosition'));history=run('undoStack.length');run('dispatchToolPointerDown(event)');assert.equal(run('objects.length'),1);run('dispatchToolPointerUp(event)');assert.equal(run('undoStack.length'),history+1);assert.deepEqual(Array.from(run('current().transform.position')),snapped);run('undo()');
run("setTool('shapes');cameraBasis()");screen=run('project([40,60,0])');sandbox.start=event(screen[0],screen[1]);screen=run('project([70,70,0])');sandbox.end=event(screen[0],screen[1]);run('dispatchToolPointerDown(start);dispatchToolPointerMove(end)');const released=Array.from(run('primitivePosition'));run('dispatchToolPointerUp(end)');assert.deepEqual(Array.from(run('current().transform.position')),released);assert.equal(run('objects.length'),2);run('undo()');assert.equal(run('JSON.stringify(projectData())'),before);
run("setTool('shapes');dispatchToolPointerDown(start);cancelGesture()");assert.equal(run('pointer'),null);assert.equal(run('primitivePosition'),null);assert.equal(run('JSON.stringify(projectData())'),before);
get('shapeRadius').value='';input('shapeRadius');assert.equal(get('createShapeBtn').disabled,true);assert.equal(run('primitivePreview'),null);assert.equal(run('commitPrimitiveFromUI()'),false);assert.equal(run('JSON.stringify(projectData())'),before);
get('shapeRadius').value='10';input('shapeRadius');run("beginModelingOperation('Test busy')");assert.equal(run('commitPrimitiveFromUI()'),false);assert.equal(run('JSON.stringify(projectData())'),before);run('endModelingOperation()');

// Ordinary geometry remains available after creation; no parametric owner locks.
run('addParametricObject(geometryApi.primitiveDefaults("frustum"),[0,0,0])');before=run('JSON.stringify(projectData())');run('(()=>{const object=current(),top=[...object.solid.faces.values()].find(f=>f.plane.normal[2]>.999).id;applyFaceMove(object,top,2);})()');assert.equal(run('validateSolid(current().solid,false).ok'),true);run('undo()');assert.equal(run('JSON.stringify(projectData())'),before);run('undo()');
run('while(objects.length<1000)objects.push(makeObject("box"))');before=run('JSON.stringify(projectData())');history=run('undoStack.length');assert.throws(()=>run('addParametricObject(geometryApi.primitiveDefaults("sphere"),[0,0,0])'),/1000 objects/);assert.equal(run('JSON.stringify(projectData())'),before);assert.equal(run('undoStack.length'),history);

assert.match(template,/data-tool="shapes"/);assert.match(template,/id="shapeToolOptionsHelp" hidden/);assert.match(template,/Settings affect the next shape/);assert.match(template,/ordinary editable solids/);
for(const id of ['shapeKind','shapeX','shapeY','shapeZ','createShapeBtn','shapeStatus'])assert.equal((template.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
console.log('R181 parametric shapes passed: eight forms, deterministic scales/odd/max counts, manifold/export/volume/topology/base contact, canonical persistence, primitive equivalences, guards, shared preview, remembered settings, exact placement, click/drag/Cancel, ordinary editing, busy/object limit and one-command Undo/Redo. '+JSON.stringify(metrics));
