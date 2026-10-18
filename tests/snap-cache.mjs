import assert from 'node:assert/strict';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root,undefined,{Map,Set,Math}),run=code=>vm.runInContext(code,sandbox),plain=value=>JSON.parse(JSON.stringify(value));
run(`cancelGesture();clearSelection(false);replaceGroups([]);replaceObjects([]);
const cacheRing=Array.from({length:24},(_,i)=>[5*Math.cos(i*Math.PI/12),5*Math.sin(i*Math.PI/12)]);
const cacheRound=makeObject('box'),cacheHole=makeObject('box');
cacheRound.solid=geometryApi.createPrism(cacheRing,10,'snap_cache_round');
cacheHole.solid=geometryApi.createPrismRegion([[-15,-15],[15,-15],[15,15],[-15,15]],[cacheRing],8,'snap_cache_hole');
cacheRound.transform.position=[-30,0,0];cacheHole.transform.position=[30,0,0];replaceObjects([cacheRound,cacheHole]);
const cacheTop=o=>[...o.solid.faces.values()].find(f=>f.plane.normal[2]>.99).id;
// Independent old-query references retain endpoint/source ordering and exact coordinates.
const cacheFreshFaceEdges=(o,id)=>geometryApi.faceTopologyEdges(o.solid,id).map(e=>({a:transformPoint(e.a,o.transform),b:transformPoint(e.b,o.transform),source:{kind:'edge',objectId:o.id,halfEdgeId:e.id}}));
const cacheFreshEdges=()=>visibleObjects().flatMap(o=>geometryApi.edges(o.solid).map(e=>({a:transformPoint(e.a,o.transform),b:transformPoint(e.b,o.transform),source:{kind:'edge',objectId:o.id,halfEdgeId:e.halfEdgeId}})));
const cacheFreshCenters=()=>visibleObjects().flatMap(o=>[...o.solid.faces.values()].flatMap(f=>{const loops=geometryApi.faceLoops(o.solid,f.id);return [loops.outer,...loops.holes].map(circularLoopCenter).filter(Boolean).map(local=>({point:transformPoint(local,o.transform),kind:'Center',source:{kind:'circle-center',objectId:o.id,faceId:f.id}}));}));
const cacheState=JSON.stringify(objects.map(serializeObject)),cacheHistory=undoStack.length;
const cacheSavedTransform=transformPoint,cacheSavedEdge=edgeView,cacheSavedLoops=faceLoopPoints;
let cacheTransforms=0,cacheEdges=0,cacheLoops=0;
transformPoint=(...args)=>{cacheTransforms++;return cacheSavedTransform(...args);};edgeView=(...args)=>{cacheEdges++;return cacheSavedEdge(...args);};faceLoopPoints=(...args)=>{cacheLoops++;return cacheSavedLoops(...args);};`);
function equalQueries(){
 assert.deepEqual(plain(run('allWorldEdges()')),plain(run('cacheFreshEdges()')));
 assert.deepEqual(plain(run('allWorldCenters()')),plain(run('cacheFreshCenters()')));
 for(let i=0;i<run('objects.length');i++){
  sandbox.cacheIndex=i;
  if(run('isObjectVisible(objects[cacheIndex])'))assert.deepEqual(plain(run('faceSnapEdges(objects[cacheIndex],cacheTop(objects[cacheIndex]))')),plain(run('cacheFreshFaceEdges(objects[cacheIndex],cacheTop(objects[cacheIndex]))')));
 }
 assert.deepEqual(plain(run('groundSnapGeometry().edges')),plain(run('cacheFreshEdges().filter(e=>Math.abs(e.a[2])<TOL.snapGeometry&&Math.abs(e.b[2])<TOL.snapGeometry)')));
 assert.deepEqual(plain(run('groundSnapGeometry().centers')),plain(run('cacheFreshCenters().filter(c=>Math.abs(c.point[2])<TOL.snapGeometry)')));
}
equalQueries();
run(`const cacheAllEdges=allWorldEdges(),cacheAllCenters=allWorldCenters(),cacheGround=groundSnapGeometry(),cacheFaceEdges=faceSnapEdges(cacheHole,cacheTop(cacheHole)),cacheFaceCenters=faceSnapCenters(cacheHole,cacheTop(cacheHole));cacheTransforms=cacheEdges=cacheLoops=0;`);
for(let i=0;i<20;i++)run('allWorldEdges();allWorldCenters();groundSnapGeometry();faceSnapEdges(cacheHole,cacheTop(cacheHole));faceSnapCenters(cacheHole,cacheTop(cacheHole))');
assert.equal(run('allWorldEdges()===cacheAllEdges&&allWorldCenters()===cacheAllCenters&&groundSnapGeometry()===cacheGround&&faceSnapEdges(cacheHole,cacheTop(cacheHole))===cacheFaceEdges&&faceSnapCenters(cacheHole,cacheTop(cacheHole))===cacheFaceCenters'),true);
assert.deepEqual(plain(run('[cacheTransforms,cacheEdges,cacheLoops]')),[0,0,0],'warm queries rebuilt derived geometry');
assert.equal(run('JSON.stringify(objects.map(serializeObject))'),run('cacheState'));assert.equal(run('undoStack.length'),run('cacheHistory'));
// In-place transform components, including preview and cancellation, invalidate only that object.
run('const cacheOtherEdges=objectWorldSnapEdges(cacheRound),cacheOtherCenters=objectWorldCenters(cacheRound);cacheHole.transform.position[0]+=7;cacheHole.transform.rotation[2]=.4;');equalQueries();
assert.equal(run('objectWorldSnapEdges(cacheRound)===cacheOtherEdges&&objectWorldCenters(cacheRound)===cacheOtherCenters'),true);
assert.notEqual(run('allWorldEdges()'),run('cacheAllEdges'));
run('cacheHole.transform.position[0]-=7;cacheHole.transform.rotation[2]=0');equalQueries();
// Visibility is checked at every face/scene lookup and preserves reusable local data.
run('cacheHole.hidden=true');equalQueries();assert.deepEqual(plain(run('faceSnapEdges(cacheHole,cacheTop(cacheHole))')),[]);assert.deepEqual(plain(run('faceSnapCenters(cacheHole,cacheTop(cacheHole))')),[]);assert.deepEqual(plain(run('objectWorldCenters(cacheHole)')),[]);
run('cacheHole.hidden=false');equalQueries();
run('const cacheSolid=cacheHole.solid;cacheHole.solid=cloneSolidFast(cacheSolid);');equalQueries();assert.equal(run('objectWorldSnapEdges(cacheRound)===cacheOtherEdges'),true);run('cacheHole.solid=cacheSolid');equalQueries();
// Reused IDs on replacement objects and object-ID changes cannot reuse stale sources.
run("const cacheReplacement=deserializeObject(serializeObject(cacheHole));cacheReplacement.transform.position[2]=20;replaceObjects([cacheRound,cacheReplacement]);");equalQueries();
run("cacheReplacement.id='snap_cache_replaced_id'");equalQueries();assert.ok(run("allWorldEdges().some(e=>e.source.objectId==='snap_cache_replaced_id')"));
run('replaceObjects([cacheReplacement,cacheRound]);');equalQueries();
run('replaceObjects([cacheRound,cacheHole]);');equalQueries();
// Appearance, selection and lock changes preserve snap coordinates and array ownership.
run("const cacheAppearanceEdges=allWorldEdges(),cacheAppearanceCenters=allWorldCenters();cacheHole.color='#123456';cacheHole.shininess=70;cacheHole.locked=true;setSelection({kind:'object',objectId:cacheHole.id},false);");
assert.equal(run('allWorldEdges()===cacheAppearanceEdges&&allWorldCenters()===cacheAppearanceCenters'),true);
run('cacheHole.locked=false;cacheHole.color=JSON.parse(cacheState)[1].color;delete cacheHole.shininess;clearSelection(false);');
// Actual Rectangle/Circle hover uses warm data; geometry and command history stay read-only.
get('geomSnap').checked=true;get('guideSnap').checked=false;get('snap').checked=false;
run(`fit();cameraBasis();const cacheFace=cacheTop(cacheHole),cacheWorld=transformPoint([12,12,8],cacheHole.transform),cacheXY=project(cacheWorld);faceSnapEdges(cacheHole,cacheFace);faceSnapCenters(cacheHole,cacheFace);`);
const state=run('JSON.stringify(projectData())'),history=run('undoStack.length');
for(const tool of ['rect','circle','rect']){
 run(`setTool('${tool}');dispatchToolPointerMove({clientX:cacheXY[0],clientY:cacheXY[1]});`);
 assert.equal(run('JSON.stringify(projectData())'),state);assert.equal(run('undoStack.length'),history);
}
// Commands and Undo/Redo replace object identities; caches must match the resulting model.
run('cancelGesture();clearSelection(false);executeDocumentCommand({type:"snap-cache-translate",label:"Move object",parameters:{},execute(){cacheHole.transform.position[0]+=3;return {selection:null};}});');equalQueries();
run('undo()');equalQueries();run('redo()');equalQueries();
run('replaceObjects([])');assert.deepEqual(plain(run('allWorldEdges()')),[]);assert.deepEqual(plain(run('allWorldCenters()')),[]);assert.deepEqual(plain(run('groundSnapGeometry()').edges),[]);
run('transformPoint=cacheSavedTransform;edgeView=cacheSavedEdge;faceLoopPoints=cacheSavedLoops;');
console.log('R254 snap geometry cache passed: exact ordered reference queries, zero warm transforms/boundary reads, face/global/ground sharing, per-object transform/source invalidation, visibility, replacement IDs/order, appearance/selection/locks, real Rectangle/Circle hover, read-only geometry/history and command Undo/Redo.');
