import assert from 'node:assert/strict';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),f=createAppFixture(root),run=s=>vm.runInContext(s,f.sandbox);
const emit=(id,event,value)=>{const element=f.get(id);if(value!==undefined)element.value=value;for(const fn of element.listeners?.[event]||[])fn({target:element});};
// A warmed complex scene must recolor and undo without copying canonical solids
// or discarding geometry-derived data, even with unrelated locked objects.
run(`cancelGesture();replaceGroups([]);replaceObjects(Array.from({length:120},(_,i)=>{const o=makeObject('cylinder');o.transform.position=[(i%12)*70,Math.floor(i/12)*70,0];o.locked=i>60;return o;}));selectObject(objects[0]);undoStack=[];redoStack=[];sceneGeometry.invalidateAll();
const colorCached=objects.map(o=>({object:o,solid:o.solid,entry:sceneGeometry.entry(o),mesh:sceneGeometry.mesh(o),bvh:sceneGeometry.bvh(o),exportMesh:sceneGeometry.exportMesh(o),appearance:sceneGeometry.appearance(sceneGeometry.mesh(o))}));
const colorOriginalProject=JSON.stringify(projectData()),colorOriginalSelection=JSON.stringify([modelDocument.selection,selectedObjectIds()]);
const colorOriginalSerialize=serializeSolid,colorOriginalDerive=solidMeshWorld,colorOriginalInvalidate=sceneGeometry.invalidateAll;
serializeSolid=()=>{throw Error('Color copied canonical geometry');};solidMeshWorld=()=>{throw Error('Color rederived geometry');};sceneGeometry.invalidateAll=()=>{throw Error('Color discarded geometry');};
const colorUploads=[];gl.bufferData=(_target,data)=>colorUploads.push(data);ensureScene();colorUploads.length=0;`);
emit('objColor','focus');emit('objColor','input','#ff0000');emit('objColor','input','#00ff00');emit('objColor','change','#0000ff');
assert.equal(run('objects[0].color'),'#0000ff');assert.equal(run('undoStack.length'),1);assert.equal(run('undoStack[0].before.kind'),'object-colors');assert.equal(run('undoStack[0].before.colors.length'),1);assert.equal(run("'objects' in undoStack[0].before"),false);
run(`ensureScene();if(!colorUploads[0].some((v,i)=>i%6===5&&v>colorUploads[0][i-1]))throw Error('New blue color was not uploaded');
function assertColorCaches(){for(let i=0;i<objects.length;i++){const o=objects[i],cached=colorCached[i];if(o!==cached.object||o.solid!==cached.solid||sceneGeometry.entry(o)!==cached.entry||sceneGeometry.mesh(o)!==cached.mesh||sceneGeometry.bvh(o)!==cached.bvh||sceneGeometry.exportMesh(o)!==cached.exportMesh||sceneGeometry.appearance(sceneGeometry.mesh(o))!==cached.appearance)throw Error('Color replaced a geometry cache');}}
assertColorCaches();undo();ensureScene();assertColorCaches();redo();ensureScene();assertColorCaches();`);
assert.equal(run('objects[0].color'),'#0000ff');assert.equal(run('JSON.stringify([modelDocument.selection,selectedObjectIds()])'),run('colorOriginalSelection'));
run("undo();setObjectSelection(objects.slice(0,3).map(o=>o.id),null,true,false)");emit('selectionColor','focus');emit('selectionColor','input','#abcdef');emit('selectionColor','change','#fedcba');run('ensureScene();assertColorCaches();undo();ensureScene();assertColorCaches();redo();ensureScene();assertColorCaches();undo();selectObject(objects[0]);serializeSolid=colorOriginalSerialize;solidMeshWorld=colorOriginalDerive;sceneGeometry.invalidateAll=colorOriginalInvalidate;');assert.equal(run('JSON.stringify(projectData())'),run('colorOriginalProject'));assert.equal(run('dirty'),true);
// Color history resolves stable IDs across full-snapshot Move/Delete restores.
run(`replaceObjects(objects.slice(0,3));selectObject(objects[0]);undoStack=[];redoStack=[];const mixedOriginal=snapshot();setObjectsColor([objects[0].id,objects[1].id],'#123456');const mixedColored=snapshot();setObjectTransform(objects[0],{position:[7,0,0],rotation:[0,0,0]});const mixedMoved=snapshot();setObjectsColor([objects[0].id],'#654321');const mixedRecolored=snapshot();removeObjectById(objects[0].id);const mixedDeleted=snapshot();`);
for(const state of ['mixedRecolored','mixedMoved','mixedColored','mixedOriginal']){run('undo()');assert.equal(run('snapshot()'),run(state));}
for(const state of ['mixedColored','mixedMoved','mixedRecolored','mixedDeleted']){run('redo()');assert.equal(run('snapshot()'),run(state));}
// Coalescing at the history cap must retain the original color and oldest entry.
run(`undo();undoStack=[];redoStack=[];for(let i=0;i<100;i++)setObjectsColor([objects[0].id],i%2?'#111111':'#222222');const capOldest=undoStack[0];setObjectsColor([objects[0].id],'#333333',true);setObjectsColor([objects[0].id],'#444444',true);`);
assert.equal(run('undoStack.length'),100);assert.equal(run('undoStack[0]===capOldest'),true);run('undo()');assert.equal(run('objects[0].color'),'#222222');run("setObjectsColor([objects[0].id],'#abcdef')");assert.equal(run('redoStack.length'),0);
console.log('R245 color performance passed: 120 cylinders/6,000 faces, live single palette, no B-rep copy/derive/invalidation, identical mesh/BVH/export/normal caches, actual updated GPU color buffers, locked unrelated objects, exact mixed color/Move/Delete history by stable ID, capped coalescing and redo-branch clearing.');
