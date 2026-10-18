import assert from 'node:assert/strict';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..');
const {sandbox}=createAppFixture(root);
const run=(code)=>vm.runInContext(code,sandbox);
const project={schema:'poly-brep-1',id:'surface',metadata:{name:'Roof panel'},vertices:[
 {id:'v1',position:[0,0,0]},{id:'v2',position:[10,0,0]},{id:'v3',position:[10,10,0]},{id:'v4',position:[0,10,0]}
],faces:[{id:'f1',outer:['v1','v2','v3','v4'],holes:[]}]};
sandbox.openProject=project;
assert.equal(run('deserializeProjectSurface(openProject).faces.size'),1);
assert.throws(()=>run('deserializeProjectSolid(openProject)'),/Open or non-manifold edge/);
const before=run('objects.length');
run(`addImportedMeshItems({format:'skp',items:[{kind:'surface',solid:deserializeProjectSurface(openProject),name:'Roof panel',color:'#b7cec9',triangleCount:0}],triangleCount:1,warnings:[],repairedOpenings:0})`);
assert.equal(run('objects.length'),before+1);
assert.equal(run('objects.at(-1).kind'),'surface');
assert.equal(run('sceneGeometry.mesh(objects.at(-1)).triangles.length'),2,'one quad produces two derived render triangles, but retains one source polygon');
assert.equal(run('sceneGeometry.pick([objects.at(-1)],{origin:[5,5,10],dir:[0,0,-1]}).id'),run('objects.at(-1).id'));
const saved=run('projectData()');sandbox.saved=saved;
assert.equal(saved.version,9);
assert.equal(saved.objects.at(-1).solid.faces[0].outer.length,4);
assert.equal(run('validateProject(saved).objects.at(-1).kind'),'surface');
assert.equal(run('validateProject(saved).objects.at(-1).solid.faces.size'),1);
assert.equal(run('deserializeSnapshotSurface(serializeObject(objects.at(-1)).solid).faces.size'),1);
assert.throws(()=>run("applyFaceMove(objects.at(-1),'f1',3)"),/open surface/i);
assert.throws(()=>run('scaleObjectUniform(objects.at(-1),2)'),/open surface/i);
run('selectObject(objects.at(-1))');
run('duplicateObject()');
assert.equal(run('objects.at(-1).kind'),'surface');
run('undo()');
assert.equal(run('objects.length'),before+1);
run("applyObjectProperties(objects.at(-1),{name:'Panel 2',dimensions:[10,10,0],position:[6,0,0],rotation:[0,0,90],color:'#aa5500'})");
assert.equal(run('objects.at(-1).name'),'Panel 2');
assert.equal(run('objects.at(-1).transform.position[0]'),6);
assert.equal(run('objects.at(-1).color'),'#aa5500');
run('undo()');
assert.equal(run('objects.at(-1).name'),'Roof panel');
run('undo()');
assert.equal(run('objects.length'),before);
console.log('Open surfaces verified: polygon fidelity, picking, limited editing, native format-9 round-trip, duplicate, properties and Undo.');

// Warped SketchUp hole rims remain native polygons when all outer vertices
// are planar and the inner rim deviates only by sub-micron numeric roundoff.
const rim={schema:'poly-brep-1',id:'hole-sheet',metadata:{name:'Opening'},vertices:[
 {id:'a',position:[0,0,0]},{id:'b',position:[10,0,0]},{id:'c',position:[10,10,0]},{id:'d',position:[0,10,0]},
 {id:'e',position:[3,3,0.00005]},{id:'f',position:[3,7,0]},{id:'g',position:[7,7,0]},{id:'h',position:[7,3,0]}],
 faces:[{id:'outer',outer:['a','b','c','d'],holes:[['e','f','g','h']]}]};
sandbox.rim=rim;
assert.throws(()=>run('skpTriangulateNonPlanarFaces(rim)'),/holes cannot be safely split/);
assert.equal(run('skpTriangulateNonPlanarFaces(rim,true).retainedHoleRims'),1);
assert.equal(run('deserializeProjectSurface(skpTriangulateNonPlanarFaces(rim,true).project).faces.size'),1);
assert.equal(run('skpTriangulateNonPlanarFaces(rim,true).project.faces[0].holes[0].length'),4);
// If a severely warped hole cannot be retained, reject just that source face,
// preserving an unrelated good polygon in the same limited surface object.
const damaged=structuredClone(rim);
damaged.vertices.find(v=>v.id==='e').position[2]=1;
damaged.faces.push({id:'valid',outer:['a','b','c'],holes:[]});sandbox.damaged=damaged;
assert.equal(run('skpTriangulateNonPlanarFaces(damaged,true).skipped.length'),1);
assert.equal(run('skpTriangulateNonPlanarFaces(damaged,true).project.faces.length'),1);
assert.equal(run('deserializeProjectSurface(skpTriangulateNonPlanarFaces(damaged,true).project).faces.size'),1);
console.log('SKP open-surface recovery passed: original hole boundary, selective unsafe-face isolation, no fabricated vertices.');
