import assert from 'node:assert/strict';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root,undefined,{Map,Set,Math}),run=code=>vm.runInContext(code,sandbox),plain=value=>JSON.parse(JSON.stringify(value));
run(`cancelGesture();clearSelection(false);replaceGroups([]);replaceObjects([]);
const sketchRound=makeObject('box'),sketchHoled=makeObject('box');
const sketchRing=Array.from({length:24},(_,i)=>[5*Math.cos(i*Math.PI/12),5*Math.sin(i*Math.PI/12)]);
sketchRound.solid=geometryApi.createPrism(sketchRing,12,'round_hover');sketchRound.transform.position=[-25,0,0];
sketchHoled.solid=geometryApi.createPrismRegion([[-15,-15],[15,-15],[15,15],[-15,15]],[sketchRing],10,'holed_hover');sketchHoled.transform.position=[25,0,0];
replaceObjects([sketchRound,sketchHoled]);sceneGeometry.invalidateAll();
const sketchFace=o=>[...o.solid.faces.values()].find(f=>f.plane.normal[2]>.999).id;
const sketchRoundFace=sketchFace(sketchRound),sketchHoleFace=sketchFace(sketchHoled);
const sketchExpected=objects.map(o=>{const f=sketchFace(o),view=geometryApi.face(o.solid,f);return [view.outer,...view.holes].map(circularLoopCenter).filter(Boolean).map(p=>transformPoint(p,o.transform));});
const sketchBefore=JSON.stringify(objects.map(serializeObject)),sketchHistory=undoStack.length;
const sketchSavedTri=triangulateFaceLocal,sketchSavedArea=faceAreaLocal,sketchSavedLoops=faceLoopPoints;let sketchLoopReads=0;
triangulateFaceLocal=()=>{throw Error('Cold sketch hover triangulated');};faceAreaLocal=()=>{throw Error('Sketch preparation computed unnecessary area');};faceLoopPoints=(...args)=>{sketchLoopReads++;return sketchSavedLoops(...args);};`);
for(let i=0;i<2;i++){
 sandbox.oi=i;
 assert.deepEqual(plain(run('faceSnapCenters(objects[oi],sketchFace(objects[oi])).map(c=>c.point)')),plain(run('sketchExpected[oi]')));
}
assert.equal(run('sketchLoopReads'),2);
run("setTool('rect');setTool('circle');faceSnapCenters(sketchHoled,sketchHoleFace);setTool('rect');faceSnapCenters(sketchRound,sketchRoundFace)");assert.equal(run('sketchLoopReads'),2,'Rectangle/Circle did not share local center data');
run('sketchHoled.transform.position[0]+=7');assert.deepEqual(plain(run('faceSnapCenters(sketchHoled,sketchHoleFace).map(c=>c.point)')),plain(run('sketchExpected[1].map(p=>V.add(p,[7,0,0]))')));
run('sketchHoled.hidden=true');assert.deepEqual(plain(run('faceSnapCenters(sketchHoled,sketchHoleFace)')),[]);run('sketchHoled.hidden=false;sketchHoled.transform.position[0]-=7');assert.equal(run('sketchLoopReads'),2);
run('const sketchOldSolid=sketchHoled.solid;sketchHoled.solid=cloneSolidFast(sketchOldSolid);faceSnapCenters(sketchHoled,sketchHoleFace)');assert.equal(run('sketchLoopReads'),3);run('sketchHoled.solid=sketchOldSolid;faceSnapCenters(sketchHoled,sketchHoleFace)');assert.equal(run('sketchLoopReads'),3);
// Ordinary selected faces do not need boundary/area data for a hidden panel.
run(`setSelection({kind:'face',objectId:sketchHoled.id,faceId:sketchHoleFace},false);const sketchReadsBefore=sketchLoopReads;updateSketchPanel(sketchHoled);`);assert.equal(run('sketchLoopReads'),run('sketchReadsBefore'));
// An actual sketch panel needs loops/basis only, and retains the same dimensions.
run(`const sketchProvenance=sketchRound.solid.faces.get(sketchRoundFace).provenance;sketchRound.solid.faces.get(sketchRoundFace).provenance={kind:'split',label:'Circle'};setSelection({kind:'face',objectId:sketchRound.id,faceId:sketchRoundFace},false);updateSketchPanel(sketchRound);`);
assert.equal(Number(get('featureWidth').value),10);assert.equal(Number(get('featureHeight').value),10);
run(`sketchRound.solid.faces.get(sketchRoundFace).provenance=sketchProvenance;clearSelection(false);triangulateFaceLocal=sketchSavedTri;faceAreaLocal=sketchSavedArea;faceLoopPoints=sketchSavedLoops;`);
// Real toolbar transitions retain static buffers for ordinary face-feedback tools.
run(`const sketchUpload=gl.bufferData,sketchBind=gl.bindBuffer;let sketchBound=null;const sketchUploads=[];
gl.bindBuffer=(target,buffer)=>{sketchBound=buffer;return sketchBind(target,buffer);};gl.bufferData=(target,data,usage)=>{sketchUploads.push({buffer:sketchBound,data:Array.from(data)});return sketchUpload(target,data,usage);};
const sketchBuffers=new Set([triangleBuffer,materialBuffer,lineBuffer,faceKeyBuffer]);
fit();cameraBasis();`);
for(const style of ['modeling','illustration','presentation']){
 get('viewStyle').value=style;run("setTool('push');sceneKey='';render();sketchUploads.length=0");
 for(const next of ['rect','circle','arc','poly','guide','select','push','circle','rect']){
  run(`setTool('${next}');render()`);
  assert.equal(run('sketchUploads.filter(x=>sketchBuffers.has(x.buffer)).length'),0,`${style} ${next} rebuilt compatible tool buffers`);
 }
}
// A live geometry preview must still be removed when switching to a sketch tool.
get('viewStyle').value='modeling';get('livePushPreview').checked=true;
run(`setTool('push');sceneKey='';render();const sketchCanonical=sketchUploads.filter(x=>x.buffer===triangleBuffer).at(-1).data;
pointer={type:'push',object:sketchRound,face:sketchRoundFace,distance:2,previewResult:geometryApi.previewMoveFace(sketchRound.solid,sketchRoundFace,2)};sketchUploads.length=0;render();`);
assert.ok(run('sketchUploads.some(x=>x.buffer===triangleBuffer)'));assert.notDeepEqual(plain(run('sketchUploads.find(x=>x.buffer===triangleBuffer).data')),plain(run('sketchCanonical')));
run("sketchUploads.length=0;setTool('rect');render()");assert.equal(run('pointer'),null);assert.ok(run('sketchUploads.some(x=>x.buffer===triangleBuffer)'));assert.deepEqual(plain(run('sketchUploads.find(x=>x.buffer===triangleBuffer).data')),plain(run('sketchCanonical')));
run('gl.bufferData=sketchUpload;gl.bindBuffer=sketchBind;');assert.equal(run('JSON.stringify(objects.map(serializeObject))'),run('sketchBefore'));assert.equal(run('undoStack.length'),run('sketchHistory'));
console.log('R253 sketch hover passed: identical cold circular centers without area/triangulation, Rectangle/Circle cache sharing, transforms/hidden/source replacement, lazy panel boundary access and exact sketch dimensions, zero static uploads across compatible toolbar transitions in three styles, canonical buffers restored after live Push cancellation, unchanged geometry/history.');
