import assert from 'node:assert/strict';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox}=createAppFixture(root,undefined,{Map,Set,Math}),run=code=>vm.runInContext(code,sandbox),plain=v=>JSON.parse(JSON.stringify(v));
// The opaque geometry service owns detached copies, including metadata and map order.
run(`const hsStore=geometryApi.createHistoryStore(),hsSolid=geometryApi.createPrism([[0,0],[4,0],[4,4],[0,4]],4,'history-store'),hsVersion=hsStore.capture(hsSolid),hsOriginal=JSON.stringify(serializeSolid(hsSolid));`);
assert.equal(run('hsStore.capture(hsSolid)===hsVersion'),true);
assert.deepEqual(plain(run('hsVersion')),{kind:'history-solid-version'});
assert.throws(()=>run("hsStore.restore({kind:'history-solid-version'})"),/Unknown history/);
assert.throws(()=>run('geometryApi.createHistoryStore().restore(hsVersion)'),/Unknown history/);
for(const mutation of [
 "s.id+='changed'",'s.vertices.values().next().value.position[0]+=1',"s.metadata={nested:{value:[1,2,3]}}",
 "s.halfEdges.values().next().value.next='changed'","s.loops.values().next().value.kind='hole'",
 's.faces.values().next().value.plane.normal[0]=.1','s.faces.values().next().value.plane.offset+=1',
 "s.faces.values().next().value.innerLoops.push('extra')","s.faces.values().next().value.material='new'",
 "s.faces.values().next().value.boundaryGroup='new'","s.faces.values().next().value.provenance={kind:'split',label:'New'}",
 'const first=s.vertices.entries().next().value;s.vertices.delete(first[0]);s.vertices.set(...first)',
]){
 sandbox.hsMutation=mutation;
 run(`{const s=hsStore.restore(hsVersion);eval(hsMutation);if(hsStore.matches(s,hsVersion))throw Error('Missed in-place geometry change: '+hsMutation);const version=hsStore.capture(s);if(version===hsVersion)throw Error('Reused a changed version');}`);
 assert.equal(run('JSON.stringify(serializeSolid(hsStore.restore(hsVersion)))'),run('hsOriginal'));
}
run(`cancelGesture();replaceObjects([]);replaceGroups([]);replaceGuides([]);replaceDimensions([]);replaceBuildPlates([]);clearSelection(false);undoStack=[];redoStack=[];
const hsA=makeObject('box'),hsB=makeObject('cylinder'),hsSurface=makeObject('box');hsSurface.kind='surface';hsSurface.solid=deserializeProjectSurface({schema:'poly-brep-1',id:'surface-history',metadata:{name:'surface'},vertices:[{id:'a',position:[0,0,0]},{id:'b',position:[2,0,0]},{id:'c',position:[0,2,0]}],faces:[{id:'face',outer:['a','b','c'],holes:[]}]});hsB.transform.position=[100,0,0];hsSurface.transform.position=[-100,0,0];replaceObjects([hsA,hsB,hsSurface]);setSelection({kind:'object',objectId:hsA.id},false);
const hsBMesh=sceneGeometry.mesh(hsB),hsBBvh=sceneGeometry.bvh(hsB),hsSurfaceMesh=sceneGeometry.mesh(hsSurface),hsSources=objects.map(o=>o.solid);
let hsCopies=0,hsSerializations=0,hsValidations=0,hsAllInvalidations=0;const hsClone=structuredClone,hsSerialize=serializeSolid,hsValidate=validateSolid,hsInvalidate=sceneGeometry.invalidateAll;
structuredClone=(value,...rest)=>{if(value?.vertices?.size!==undefined&&value?.halfEdges?.size!==undefined)hsCopies++;return hsClone(value,...rest);};serializeSolid=(...args)=>{hsSerializations++;return hsSerialize(...args);};validateSolid=(...args)=>{hsValidations++;return hsValidate(...args);};sceneGeometry.invalidateAll=(...args)=>{hsAllInvalidations++;return hsInvalidate(...args);};
const hsFirst=captureHistoryDocumentState();`);
assert.equal(run('hsCopies'),3);
run('hsCopies=0;const hsSecond=captureHistoryDocumentState()');assert.equal(run('hsCopies'),0);
assert.equal(run('hsFirst.objects.every((o,i)=>o.solid===hsSecond.objects[i].solid)'),true);
run('const hsBefore=JSON.stringify(projectData());hsSerializations=hsValidations=0;setObjectTransform(hsA,{position:[1,2,3],rotation:[10,20,30]});const hsAfter=JSON.stringify(projectData());hsSerializations=hsValidations=0;undo()');
assert.equal(run('hsValidations'),0);assert.equal(run('JSON.stringify(projectData())'),run('hsBefore'));
run('hsSerializations=hsValidations=0;redo()');assert.equal(run('hsSerializations'),0);assert.equal(run('hsValidations'),0);assert.equal(run('JSON.stringify(projectData())'),run('hsAfter'));
assert.equal(run('hsCopies'),0);assert.equal(run('hsAllInvalidations'),0);
assert.equal(run('objects.every((o,i)=>o.solid===hsSources[i])'),true);
assert.equal(run('objects[0]===hsA&&objects[1]===hsB&&objects[2]===hsSurface'),true);
assert.equal(run('sceneGeometry.mesh(hsB)===hsBMesh&&sceneGeometry.bvh(hsB)===hsBBvh&&sceneGeometry.mesh(hsSurface)===hsSurfaceMesh'),true);
// Keep one private geometry version per unchanged source across long transform history.
run('for(let i=0;i<110;i++)setObjectTransform(hsA,{position:[i,2,3],rotation:[0,0,0]})');assert.equal(run('undoStack.length'),100);
assert.equal(run('new Set(undoStack.flatMap(e=>[...e.before.objects,...e.after.objects].map(o=>o.solid))).size'),3);
assert.equal(run('hsCopies'),0);
// Geometry replacement copies only that source; later live mutation cannot corrupt either side.
run(`const hsGeometryBefore=JSON.stringify(projectData()),hsGeometryMeshBefore=sceneGeometry.mesh(hsA),hsGeometryBvhBefore=sceneGeometry.bvh(hsA);hsCopies=0;
executeDocumentCommand({type:'history-replace-test',label:'Replace one test solid',parameters:{},execute(){hsA.solid=geometryApi.createPrism([[-20,-15],[20,-15],[20,15],[-20,15]],25,hsA.solid.id);return {};}});
const hsGeometryAfter=JSON.stringify(projectData()),hsGeometryMeshAfter=sceneGeometry.mesh(hsA),hsGeometryBvhAfter=sceneGeometry.bvh(hsA);captureHistoryDocumentState();hsA.solid.metadata.nested={values:[1,2,3]};undo();`);
assert.equal(run('JSON.stringify(projectData())'),run('hsGeometryBefore'));assert.equal(run('sceneGeometry.mesh(hsA)===hsGeometryMeshBefore&&sceneGeometry.bvh(hsA)===hsGeometryBvhBefore'),true);
run('redo()');assert.equal(run('JSON.stringify(projectData())'),run('hsGeometryAfter'));assert.equal(run('sceneGeometry.mesh(hsA)===hsGeometryMeshAfter&&sceneGeometry.bvh(hsA)===hsGeometryBvhAfter'),true);
assert.equal(run('sceneGeometry.mesh(hsB)===hsBMesh&&sceneGeometry.bvh(hsB)===hsBBvh'),true);
// Roll back in-place mutations, organization, deletion, counters and selection atomically.
run(`const hsRollback=JSON.stringify(captureDocumentState()),hsUndoDepth=undoStack.length,hsRedoDepth=redoStack.length;`);
assert.throws(()=>run(`executeDocumentCommand({type:'history-failure-test',label:'Fail test command',parameters:{},execute(){hsA.solid.vertices.values().next().value.position[0]+=1;hsA.name='Changed';hsA.transform.position[0]=999;objects.pop();guides.push({id:'bad',kind:'point',point:[1,2,3]});nextObjectId+=7;clearSelection(false);throw Error('Expected test failure');}})`),/Expected test failure/);
assert.equal(run('JSON.stringify(captureDocumentState())'),run('hsRollback'));
assert.equal(run('undoStack.length'),run('hsUndoDepth'));assert.equal(run('redoStack.length'),run('hsRedoDepth'));
assert.equal(run('sceneGeometry.mesh(hsB)===hsBMesh'),true);
// Ordinary state remains detached and serializable; lightweight color history still composes.
run("const hsDetached=captureDocumentState();hsDetached.objects[0].solid.vertices[0].position[0]+=1000;const hsColorBefore=JSON.stringify(projectData());setObjectColor(objects[0],'#123456',true);setObjectColor(objects[0],'#654321',true);const hsColorAfter=JSON.stringify(projectData());undo()");assert.equal(run('JSON.stringify(projectData())'),run('hsColorBefore'));run('redo()');assert.equal(run('JSON.stringify(projectData())'),run('hsColorAfter'));
run("undo();setObjectTransform(objects[0],{position:[0,0,0],rotation:[0,0,0]})");assert.equal(run('redoStack.length'),0);
// Serialized legacy history still restores through the fully checked compatibility path.
run("const hsLegacy=captureDocumentState();recordHistory({type:'legacy-test',label:'Legacy snapshot',parameters:{},execute(){return {}}},hsLegacy,hsLegacy);undo();redo()");assert.equal(run('JSON.stringify(captureDocumentState())'),run('JSON.stringify(hsLegacy)'));
console.log('R257 shared Undo geometry passed: opaque/detached versions, all canonical fields and map order, in-place edits, warm zero-copy transforms, exact Undo/Redo and object identities, unchanged surface/mesh/BVH reuse, 100-entry structural sharing, replacement isolation, atomic failed-command rollback, independent serialization, color coalescing, redo branching and checked legacy snapshots.');

// Exercise actual eviction policy with small budgets and real mesh records.
run(`const hsLru=createSceneHistoryCache({maximumTriangles:24,maximumEntries:2,maximumTransformsPerVersion:2}),hsLruRecord={mesh:hsGeometryMeshBefore,bounds:derivedMeshBounds(hsGeometryMeshBefore),bvh:hsGeometryBvhBefore,transformKey:'a'},hsLruVersions=[hsStore.capture(hsStore.restore(hsVersion)),hsStore.capture(hsStore.restore(hsVersion)),hsStore.capture(hsStore.restore(hsVersion))];`);
// capture of restored unchanged versions intentionally returns the same handle; use independent solids.
run(`for(let i=0;i<3;i++)hsLruVersions[i]=hsStore.capture(geometryApi.createPrism([[0,0],[4,0],[4,4],[0,4]],4,'lru-'+i));hsLru.remember(hsLruVersions[0],hsLruRecord);hsLru.remember(hsLruVersions[1],hsLruRecord);hsLru.get(hsLruVersions[0],'a');hsLru.remember(hsLruVersions[2],hsLruRecord);`);
assert.equal(run("hsLru.get(hsLruVersions[1],'a')"),null);assert.equal(run('hsLru.stats().entries'),2);assert.equal(run('hsLru.stats().triangles'),24);
run("hsLru.remember(hsLruVersions[0],{...hsLruRecord,transformKey:'b'});hsLru.remember(hsLruVersions[0],{...hsLruRecord,transformKey:'c'})");assert.equal(run("hsLru.get(hsLruVersions[0],'a')"),null);
run('const hsTiny=createSceneHistoryCache({maximumTriangles:1,maximumEntries:1,maximumTransformsPerVersion:1});hsTiny.remember(hsLruVersions[0],hsLruRecord)');assert.equal(run('hsTiny.stats().entries'),0);
console.log('R257 history display cache passed: exact prior replacement mesh/BVH reuse, LRU touch/eviction, triangle/entry/transform budgets and oversized-entry fallback.');
