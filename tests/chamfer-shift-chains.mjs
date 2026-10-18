import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
import {ModelingWorker} from './modeling-worker-fixture.mjs';

const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root,ModelingWorker),run=s=>vm.runInContext(s,sandbox),plain=x=>JSON.parse(JSON.stringify(x));
run('var shiftOriginalPick=topologyEdgeAt');
const keys=ids=>{sandbox.ids=ids;return plain(run('ids.map(id=>{const e=shiftSource.halfEdges.get(id);return e.id<e.twin?e.id:e.twin;}).sort()'));};
const selected=()=>plain(run('chamferEdgeSelection?.sides.flatMap(side=>side.keys).sort()||[]'));
function install(code,mode='roundchamfer'){
 sandbox.mode=mode;run("cancelGesture();replaceObjects([]);replaceGroups([]);replaceGuides([]);replaceDimensions([]);"+code+";var shiftObject=makeObject('box');shiftObject.solid=shiftSource;objects.push(shiftObject);clearSelection(false);undoStack=[];redoStack=[];setTool(mode);setDirtyState(false)");
 for(const [id,value] of Object.entries({chamferDistance:'.5',chamferAngle:'45',roundedChamferRadius:'.5',roundedChamferAngle:'45',roundedChamferSegments:'6'}))get(id).value=value;
}
function pointer(id,modifiers={shiftKey:true}){sandbox.pick=id;sandbox.mods=modifiers;run("topologyEdgeAt=()=>({kind:'edge',objectId:shiftObject.id,halfEdgeId:pick});(tool==='roundchamfer'?roundedChamferToolController:chamferToolController).pointerDown({event:mods,x:0,y:0,hit:{id:shiftObject.id,face:shiftFace.id}})");}
const release=(key='Shift',extra={})=>{sandbox.releaseEvent={key,shiftKey:false,ctrlKey:false,...extra};run('dispatchToolKeyUp(releaseEvent)');};
async function idle(){const start=performance.now();while(run('modelingOperationBusy')){assert.ok(performance.now()-start<60000,'Shift worker timeout');await new Promise(r=>setTimeout(r,10));}}
function verify(solid,label){sandbox.shiftResult=solid;const report=run('validateSolid(shiftResult,false)');assert.equal(report.ok,true,label+': '+report.errors.join('; '));assert.deepEqual(plain(run('triangleMeshEdgeStats(solidMeshExportLocal(shiftResult))')),{boundary:0,nonManifold:0});assert.equal(run('connectedSolidFaceComponents(shiftResult).length'),1);assert.equal(run('JSON.stringify(serializeProjectSolid(deserializeProjectSolid(serializeProjectSolid(shiftResult))))'),run('JSON.stringify(serializeProjectSolid(shiftResult))'));return report.volume;}

// Local turn, not accumulated angle from the seed, controls continuation.
const arcCode="var arc=[[-40,-30],[40,-30],[40,0]];for(let i=1;i<=12;i++){const a=-Math.PI/2-i*Math.PI/24;arc.push([40+30*Math.cos(a),30+30*Math.sin(a)]);}arc.push([-40,30]);var shiftSource=primitivePrism(arc,20,'shift-arc'),shiftFace=[...shiftSource.faces.values()].find(f=>f.plane.normal[2]>.99),arcEdges=loopHalfEdges(shiftSource,shiftFace.outerLoop).slice(2,-2).map(e=>e.id)";
install(arcCode);
const arcIds=plain(run('arcEdges'));assert.equal(arcIds.length,12);
sandbox.seed=arcIds[5];assert.deepEqual(keys(plain(run('geometryApi.chamferCurveCandidateEdges(shiftSource,seed)'))),keys(arcIds));
const wall=plain(run('geometryApi.chamferCurveCandidateEdges(shiftSource,shiftSource.halfEdges.get(seed).twin)'));assert.deepEqual(keys(wall),keys(arcIds));assert.equal(run('geometryApi.chamferCurveCandidateEdges(shiftSource,"missing")'),null);
const before=run('snapshot()'),workers=ModelingWorker.instances.length;
pointer(arcIds[5],{ctrlKey:true});assert.equal(selected().length,1,'Ctrl keeps individual straight-side selection');
pointer(arcIds[5]);assert.deepEqual(selected(),keys(arcIds),'Shift adds only missing curve members');assert.equal(new Set(selected()).size,12);
pointer(arcIds[7],{ctrlKey:true});assert.equal(selected().length,11,'Ctrl can remove a member of a curved group');
pointer(arcIds[5]);assert.deepEqual(selected(),keys(arcIds));pointer(arcIds[5]);assert.equal(selected().length,0,'Repeat Shift removes the complete selected chain');
assert.equal(run('snapshot()'),before);assert.equal(ModelingWorker.instances.length,workers);release();assert.equal(run('undoStack.length'),0);

// Fixed threshold cases stop below/at/above the 45-degree boundary as stated.
let angleCases=0;
for(const angle of [5,30,44,44.999,45,45.001,60,90]){
 sandbox.angle=angle;install("var t=angle*Math.PI/180,p=[[-10,0],[0,0],[10,0],[10+10*Math.cos(t),10*Math.sin(t)],[30,35],[-10,35]];var shiftSource=primitivePrism(p,20,'turn'),shiftFace=[...shiftSource.faces.values()].find(f=>f.plane.normal[2]>.99),turnSeed=loopHalfEdges(shiftSource,shiftFace.outerLoop).find(e=>{const a=shiftSource.vertices.get(e.origin).position,b=shiftSource.vertices.get(shiftSource.halfEdges.get(e.next).origin).position;return Math.abs(a[1])+Math.abs(b[0]-10)+Math.abs(b[1])<1e-7;});");
 const ids=plain(run('geometryApi.chamferCurveCandidateEdges(shiftSource,turnSeed.id)'));
 assert.equal(ids.includes(run('turnSeed.next')),angle<45,`Turn ${angle}`);angleCases++;
}

const holeCode="var facets=16,radius=5,holes=[-12,12].map(cx=>Array.from({length:facets},(_,i)=>[cx+radius*Math.cos(i*2*Math.PI/facets),radius*Math.sin(i*2*Math.PI/facets)]));var shiftSource=prismRegion([[-30,-15],[30,-15],[30,15],[-30,15]],holes,12,'two-rims'),shiftFace=[...shiftSource.faces.values()].find(f=>f.plane.normal[2]>.99),rimIds=shiftFace.innerLoops.map(id=>loopHalfEdges(shiftSource,id).map(e=>e.id));";
// Independent annular profile integration for polygonal holes. The offset
// expands each empty hole, so the quadratic term has the opposite sign.
function holeLoss(round,distance=.5){const n=16,radius=5,perimeter=2*n*radius*Math.sin(Math.PI/n),turns=n*Math.tan(Math.PI/n),section=round?Array.from({length:7},(_,i)=>[distance*(1-Math.sin(Math.PI*i/12)),distance*(1-Math.cos(Math.PI*i/12))]):[[distance,0],[0,distance]];return section.slice(1).reduce((sum,[b,zb],i)=>{const [a,za]=section[i];return sum+(zb-za)*(perimeter*(a+b)/2+turns*(a*a+a*b+b*b)/3);},0);}
let applied=0;
try{
 for(const mode of ['chamfer','roundchamfer']){
  install(holeCode,mode);run('shiftObject.transform={position:[3,-5,8],rotation:[23,41,-17]}');const loops=plain(run('rimIds')),original=run('validateSolid(shiftSource,false).volume'),sourceState=run('snapshot()'),count=ModelingWorker.instances.length;
  for(const loop of loops){sandbox.seed=loop[3];assert.deepEqual(keys(plain(run('geometryApi.chamferCurveCandidateEdges(shiftSource,seed)'))),keys(loop));}
  pointer(loops[0][3],{ctrlKey:true,shiftKey:true});pointer(loops[1][5]);assert.equal(run('chamferEdgeSelection.sides.length'),2);assert.equal(selected().length,32);assert.match(get(mode==='chamfer'?'chamferSelectionStatus':'roundedChamferSelectionStatus').textContent,/2 edge groups/);
  pointer(loops[0][8]);assert.deepEqual(selected(),keys(loops[1]));pointer(loops[0][1]);assert.equal(selected().length,32);
  assert.equal(run('snapshot()'),sourceState);assert.equal(ModelingWorker.instances.length,count,'No background generation while Shift is held');assert.equal(run('undoStack.length'),0);
  release('Shift',{ctrlKey:true});assert.equal(run('snapshot()'),sourceState,'Last held modifier owns apply');assert.equal(ModelingWorker.instances.length,count);
  release('Control');await idle();assert.equal(run('undoStack.length'),1);assert.equal(ModelingWorker.instances.length,count+(mode==='roundchamfer'?1:0));
  const loss=original-verify(run('shiftObject.solid'),mode+' two complete Shift groups');assert.ok(Math.abs(loss-2*holeLoss(mode==='roundchamfer'))<1e-5,`${mode}: both rings must contribute (${loss})`);
  const after=run('snapshot()');run('undo()');assert.equal(run('snapshot()'),sourceState);run('redo()');assert.equal(run('snapshot()'),after);
  if(mode==='roundchamfer')assert.equal(run("lastRoundedChamferDiagnosticLog.events.filter(e=>e.event==='corner-geometry'&&e.data.kind==='closed-rim').length"),2);
  applied++;
 }
 // Explicit partial-rim requests cannot accidentally apply a complete rim.
 install(holeCode);const loops=plain(run('rimIds'));sandbox.one=loops[0][2];sandbox.all=loops[0];
 const original=run('validateSolid(shiftSource,false).volume'),partial=run('geometryApi.chamferStraightEdges(shiftSource,[one],.5,45).solid'),complete=run('geometryApi.chamferEdge(shiftSource,one,.5,45).solid');
 const partialLoss=original-verify(partial,'Explicit partial rim'),completeLoss=original-verify(complete,'Normal click full rim');assert.ok(partialLoss>0&&partialLoss<completeLoss/2,'A single explicit member must remain partial');assert.ok(Math.abs(completeLoss-holeLoss(false))<1e-5,'Normal click retains full-rim behavior');
 for(const cancel of ['handleToolEscape()','setTool("select")','prepareToolForDocumentChange()','modelRevision++','shiftObject.solid=structuredClone(shiftSource)','shiftObject.hidden=true','groups.push({id:"shift-g",name:"Group",objectIds:[shiftObject.id]})']){
  install(holeCode);const loops=plain(run('rimIds'));pointer(loops[0][0]);pointer(loops[1][0]);const count=ModelingWorker.instances.length;run(cancel);const state=run('snapshot()');release();await idle();assert.equal(run('snapshot()'),state,cancel);assert.equal(run('undoStack.length'),0);assert.equal(ModelingWorker.instances.length,count,cancel);
 }
 install(holeCode);const loopsAgain=plain(run('rimIds'));pointer(loopsAgain[0][0]);pointer(loopsAgain[1][0]);const state=run('snapshot()');release();run('cancelModelingOperation()');await idle();assert.equal(run('snapshot()'),state);assert.equal(run('undoStack.length'),0);
}finally{await ModelingWorker.closeAll();}
// Actual projected curve hit through shared pointer dispatch, without pick stubs.
install(arcCode);run('topologyEdgeAt=shiftOriginalPick;setView("top");camera.target=[5,0,10];camera.distance=160;cameraBasis();var screenEdge=geometryApi.edge(shiftSource,arcEdges[5]),screenMid=V.lerp(screenEdge.a,screenEdge.b,.5),screenInside=V.add(screenMid,V.mul(edgeInteriorDirection(shiftSource,shiftFace.id,screenEdge.a,screenEdge.b),.01)),shiftScreen=project(screenInside)');
const [clientX,clientY]=plain(run('shiftScreen'));sandbox.screenEvent={button:0,pointerId:1,clientX,clientY,shiftKey:true};const screenBefore=run('snapshot()');run('dispatchToolPointerDown(screenEvent)');assert.deepEqual(selected(),keys(plain(run('arcEdges'))),'Projected Shift selects the entire curved chain');assert.equal(run('snapshot()'),screenBefore);run('handleToolEscape()');release();assert.equal(run('snapshot()'),screenBefore);assert.equal(run('undoStack.length'),0);
const folder=resolve(root,'docs/verification/v161');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(resolve(folder,'shift-chains.json'),JSON.stringify({angleCases,arcMembers:12,groupedRingMembers:32,appliedModes:applied,independentRingVolume:true,exactHistory:true,partialRim:true},null,2)+'\n');
console.log(`R262 Shift Chamfer passed: ${angleCases} turn boundaries, cumulative curved arc, wall picks, Ctrl/Shift overlap and deduplication, two ring groups in both modes with independent volume, exact Undo/Redo, partial-rim scope, normal-click compatibility, real worker, last-modifier release and cancellation/stale guards.`);
