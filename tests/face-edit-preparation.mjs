import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox}=createAppFixture(root,undefined,{Map,Set,Math}),run=code=>vm.runInContext(code,sandbox),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
run(fs.readFileSync(resolve(root,'tests/fixtures/triangulation-bridged-reference.js'),'utf8'));
run(`const feSolid=geometryApi.createPrism([[-5,-4],[5,-4],[5,4],[-5,4]],10,'edit-preparation'),feTop=[...feSolid.faces.values()].find(f=>f.plane.normal[2]>.99).id,feSource=JSON.stringify(serializeSolid(feSolid));let feTriangulations=0;const feTriangulate=triangulateFaceLocal;triangulateFaceLocal=(...args)=>{feTriangulations++;return feTriangulate(...args);};`);
for(const distance of [0,.25,-.25,-10,-12]){
 sandbox.feDistance=distance;const expected=run('legacyPlanarFaceReceivingEvent(feSolid,feTop,feDistance)');run('feTriangulations=0');const actual=run('planarFaceReceivingEvent(feSolid,feTop,feDistance)');assert.equal(hash(actual),hash(expected),'receiving-plane semantics at '+distance);
 assert.equal(run('feTriangulations'),distance===-10||distance===-12?1:0,'unneeded receiver witnesses at '+distance);
}
// Receiver witnesses remain authoritative once a plane can actually be reached.
run("triangulateFaceLocal=()=>{throw Error('Required receiver witness failure')}");assert.throws(()=>run('planarFaceReceivingEvent(feSolid,feTop,-10)'),/Required receiver witness failure/);assert.equal(run('planarFaceReceivingEvent(feSolid,feTop,.5)'),null);run('triangulateFaceLocal=feTriangulate');
assert.equal(run('JSON.stringify(serializeSolid(feSolid))'),run('feSource'));
// Default shell cloning is independent; explicit connected reuse avoids a discarded copy.
assert.equal(run('geometryApi.splitConnectedShells(feSolid)[0]===feSolid'),false);assert.equal(run('geometryApi.splitConnectedShells(feSolid,{reuseConnected:true})[0]===feSolid'),true);
const regular=run('geometryApi.validate(feSolid,false)'),prepared=run('geometryApi.validateWithMesh(feSolid)');assert.equal(hash(prepared.validation),hash(regular));assert.ok(prepared.mesh.vertices.length>0);
run('const feBad=cloneSolidFast(feSolid);feBad.halfEdges.values().next().value.twin="missing"');assert.equal(hash(run('geometryApi.validateWithMesh(feBad).validation')),hash(run('geometryApi.validate(feBad,false)')));
// A command validates exactly once and reuses that exact tessellation for display.
run(`cancelGesture();replaceGroups([]);replaceObjects([]);clearSelection(false);const feObject=makeObject();feObject.solid=feSolid;feObject.transform={position:[13,-7,5],rotation:[23,41,-17]};replaceObjects([feObject]);setSelection({kind:'object',objectId:feObject.id},false);undoStack=[];redoStack=[];const feBefore=JSON.stringify(captureDocumentState()),feOldMesh=sceneGeometry.mesh(feObject);let feMeshes=0,feValidations=0;const feMeshLocal=solidMeshLocal,feValidate=validateSolid;solidMeshLocal=(...args)=>{feMeshes++;return feMeshLocal(...args);};validateSolid=(...args)=>{feValidations++;return feValidate(...args);};
const feReplacement=geometryApi.createPrism([[-5,-4],[5,-4],[5,4],[-5,4]],11,'edit-preparation');feMeshes=feValidations=0;
executeDocumentCommand({type:'test-geometry-replacement',label:'Replace test geometry',parameters:{},execute(){feObject.solid=feReplacement;return {};}});const feAfter=JSON.stringify(captureDocumentState()),feMeshCallsAfterCommand=feMeshes,feCachedMesh=sceneGeometry.mesh(feObject);`);
assert.equal(run('feValidations'),1);assert.equal(run('feMeshCallsAfterCommand'),1);assert.equal(run('feMeshes'),1,'first display repeated validated triangulation');assert.equal(hash(run('feCachedMesh')),hash(run('solidMeshWorld(feObject)')),'transformed validation/display equivalence');
run('undo()');assert.equal(run('JSON.stringify(captureDocumentState())'),run('feBefore'));assert.equal(run('sceneGeometry.mesh(feObject)===feOldMesh'),true);run('redo()');assert.equal(run('JSON.stringify(captureDocumentState())'),run('feAfter'));assert.equal(run('sceneGeometry.mesh(feObject)===feCachedMesh'),true);
// Failed validation installs no new view or history state and preserves rollback.
run('const feFailedBefore=JSON.stringify(captureDocumentState()),feFailedDepth=undoStack.length,feFailedMesh=sceneGeometry.mesh(feObject)');assert.throws(()=>run("executeDocumentCommand({type:'test-invalid-replacement',label:'Invalid geometry',parameters:{},execute(){feObject.solid=feBad;return {}}})"),/invalid solid/);assert.equal(run('JSON.stringify(captureDocumentState())'),run('feFailedBefore'));assert.equal(run('undoStack.length'),run('feFailedDepth'));assert.equal(run('sceneGeometry.mesh(feObject)===feFailedMesh'),true);
run('solidMeshLocal=feMeshLocal;validateSolid=feValidate');
console.log('R259 face-edit preparation passed: exact receiving-event queries, zero irrelevant triangulation, required witness failures, detached/default and explicit connected reuse, identical valid/invalid validation reports, one checked mesh per command, transformed display equivalence, exact cached Undo/Redo and atomic failed-validation rollback.');
