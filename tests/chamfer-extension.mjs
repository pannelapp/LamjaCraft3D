import vm from 'node:vm';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
import {ModelingWorker} from './modeling-worker-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root,ModelingWorker),run=c=>vm.runInContext(c,sandbox),plain=x=>JSON.parse(JSON.stringify(x));
let cases=0;
function verify(s,label){sandbox.result=s;const v=run('validateSolid(result,false)');assert.equal(v.ok,true,label+': '+v.errors.join('; '));assert.deepEqual(plain(run('triangleMeshEdgeStats(solidMeshExportLocal(result))')),{boundary:0,nonManifold:0},label+' export');assert.equal(run('connectedSolidFaceComponents(result).length'),1,label+' connectivity');assert.deepEqual(plain(run('serializeProjectSolid(deserializeProjectSolid(serializeProjectSolid(result)))')),plain(run('serializeProjectSolid(result)')),label+' reopen');cases++;return v.volume;}
function extend(round,d=.6,bias=45){sandbox.round=round;sandbox.d=d;sandbox.bias=bias;const before=run('JSON.stringify(serializeSolid(source))'),volume=run('validateSolid(source,false).volume'),r=run("round?geometryApi.roundedChamferEdge(source,edge.id,d,bias,8,'extend'):geometryApi.chamferEdge(source,edge.id,d,bias,'extend')");const after=verify(r.solid,`Extend ${round}/${d}/${bias}`);assert.ok(after>volume,'Extension must add material');assert.equal(run('JSON.stringify(serializeSolid(source))'),before,'Immutable source');return {added:after-volume,result:r};}
for(const phi of [30,65,90,115,150])for(const bias of [30,45,60]){
 sandbox.phi=phi;run(`var source=primitivePrism([[0,0],[20,0],[20*Math.cos(phi*Math.PI/180),20*Math.sin(phi*Math.PI/180)]],12,'angle-wedge'),edge=[...source.halfEdges.values()].find(e=>{const a=source.vertices.get(e.origin).position,b=source.vertices.get(source.halfEdges.get(e.next).origin).position;return Math.hypot(a[0],a[1],b[0],b[1])<1e-8&&edgeInteriorDirection(source,e.face,a,b)?.[0]>.99;});`);
 const straight=extend(false,.6,bias),rounded=extend(true,.6,bias),expected=.5*.6*(.6*Math.tan(bias*Math.PI/180))*Math.sin(phi*Math.PI/180)*12;
 assert.ok(Math.abs(straight.added-expected)<1e-6,'Independent added triangular cross-section');assert.ok(rounded.added<straight.added,'Concave arc adds less than straight bevel');
 assert.ok(run('Math.min(...[...result.vertices.values()].map(v=>v.position[2]))')>=-1e-8,'No endpoint overrun');assert.ok(run('Math.max(...[...result.vertices.values()].map(v=>v.position[2]))')<=12+1e-8,'No endpoint overrun');
}
// A free inside corner uses both face-interior rays, not an outward flip.
run(`source=primitivePrism([[0,0],[10,0],[10,4],[4,4],[4,10],[0,10]],12,'inside-corner');edge=[...source.halfEdges.values()].find(e=>{const a=source.vertices.get(e.origin).position,b=source.vertices.get(source.halfEdges.get(e.next).origin).position;return Math.abs(a[0]-4)+Math.abs(a[1]-4)+Math.abs(b[0]-4)+Math.abs(b[1]-4)<1e-8;});`);
assert.throws(()=>run('geometryApi.chamferEdge(source,edge.id,.6,45)'),/convex edge/);assert.ok(Math.abs(extend(false).added-.5*.6*.6*12)<1e-6);extend(true);
// Outer bottom/top, hole rim and concave bowl floor share the same rim rule.
for(const facets of [8,24,48])for(const name of ['bottom','top','hole','floor']){
 sandbox.facets=facets;sandbox.rimName=name;run(`source=buildSolidFromPolygons(primitiveRevolution([[0,0],[10,0],[10,12],[8,12],[8,2],[0,2]],facets,false,'bowl'),'bowl');var top=[...source.faces.values()].find(f=>f.plane.normal[2]>.99&&Math.abs(f.plane.offset-12)<1e-8),bottom=[...source.faces.values()].find(f=>f.plane.normal[2]<-.99),floor=[...source.faces.values()].find(f=>f.plane.normal[2]>.99&&Math.abs(f.plane.offset-2)<1e-8);var rims={bottom:loopHalfEdges(source,bottom.outerLoop)[0],top:loopHalfEdges(source,top.outerLoop)[0],hole:loopHalfEdges(source,top.innerLoops[0])[0],floor:loopHalfEdges(source,floor.outerLoop)[0]};edge=rims[rimName];`);
 assert.equal(run("geometryApi.chamferCandidateEdges(source,edge.id,'extend').length"),facets);
 for(const round of [false,true]){
  const direct=extend(round,.4,45);sandbox.round=round;const wall=run("round?geometryApi.roundedChamferEdge(source,edge.twin,.4,45,8,'extend'):geometryApi.chamferEdge(source,edge.twin,.4,45,'extend')");assert.ok(Math.abs(verify(wall.solid,'Wall pick')-verify(direct.result.solid,'Cap pick'))<1e-6,'Rim support is independent of picked wall');
  if(name==='bottom'){sandbox.direct=direct.result.solid;assert.ok(Math.abs(run('Math.max(...[...direct.vertices.values()].map(v=>Math.hypot(v.position[0],v.position[1])))')-(10+.4/Math.cos(Math.PI/facets)))<1e-6,'Outward foot width');assert.ok(run('Math.min(...[...direct.vertices.values()].map(v=>v.position[2]))')>=-1e-8,'Foot stays on bottom plane');}
 }
}
// Sloped rims retain exact signed side-plane setbacks.
for(const facets of [8,16])for(const name of ['bottom','outer','inner']){
 sandbox.facets=facets;sandbox.rimName=name;run(`source=buildSolidFromPolygons(primitiveRevolution([[0,0],[8,0],[13,10],[11,10],[6,2],[0,2]],facets,false,'sloped bowl'),'sloped');var top=[...source.faces.values()].find(f=>f.plane.normal[2]>.99&&Math.abs(f.plane.offset-10)<1e-6),bottom=[...source.faces.values()].find(f=>f.plane.normal[2]<-.99);var rims={outer:loopHalfEdges(source,top.outerLoop)[0],inner:loopHalfEdges(source,top.innerLoops[0])[0],bottom:loopHalfEdges(source,bottom.outerLoop)[0]};edge=rims[rimName];`);
 for(const round of [false,true])extend(round,.25,35);
}
// Tool mode, prepared preview, history, mode invalidation and actual worker.
get('chamferOperation').value='extend';get('chamferDistance').value='.4';get('chamferAngle').value='45';
run(`var object=makeObject('box');object.solid=source;replaceDocumentContents('Extension',[object],[],[],'load-project','Open project',false);setTool('chamfer');var prepared=geometryApi.chamferEdge(source,edge.id,.4,45,'extend'),chain=geometryApi.chamferCandidateEdges(source,edge.id,'extend');chamferHover={objectId:object.id,halfEdgeId:edge.id,halfEdgeIds:chain,sourceSolid:source,previewResult:prepared,previewSolid:prepared.solid,previewKey:chamferChainPreviewKey('chamfer',object.id,chain,.4,45),error:null};topologyEdgeAt=()=>({kind:'edge',objectId:objects[0].id,halfEdgeId:edge.id});var saved=geometryApi.chamferEdge;geometryApi.chamferEdge=()=>{throw Error('Prepared extension was recomputed');};`);
const before=run('snapshot()'),history=run('undoStack.length');run('chamferToolController.pointerDown({x:0,y:0,hit:{face:edge.face}});geometryApi.chamferEdge=saved;');assert.equal(run('undoStack.length'),history+1);assert.deepEqual(plain(run('serializeSolid(objects[0].solid)')),plain(run('serializeSolid(prepared.solid)')));const after=run('snapshot()');run('undo()');assert.equal(run('snapshot()'),before);run('redo()');assert.equal(run('snapshot()'),after);run('undo()');
get('roundedChamferRadius').value='.4';get('roundedChamferAngle').value='45';get('roundedChamferSegments').value='8';run("setTool('roundchamfer')");
const click=()=>run('roundedChamferToolController.pointerDown({x:0,y:0,hit:{face:edge.face}})'),wait=async()=>{const start=performance.now();while(run('modelingOperationBusy')){if(performance.now()-start>60000)throw Error('Worker timeout');await new Promise(r=>setTimeout(r,10));}};
click();await wait();assert.equal(run('lastRoundedChamferDiagnosticLog.outcome'),'success',run('lastRoundedChamferDiagnosticLog.error'));assert.equal(run('lastRoundedChamferDiagnosticLog.input.operation'),'extend');assert.ok(run("lastRoundedChamferDiagnosticLog.events.some(e=>e.event==='boolean-complete'&&e.data.operation==='union')"));verify(run('objects[0].solid'),'Actual worker extension');const workerAfter=run('snapshot()');run('undo()');assert.equal(run('snapshot()'),before);run('redo()');assert.equal(run('snapshot()'),workerAfter);run('undo()');
click();run('cancelModelingOperation()');await wait();assert.equal(run('snapshot()'),before);assert.equal(run('lastRoundedChamferDiagnosticLog.outcome'),'cancelled');assert.equal(run('undoStack.length'),history);
// Multi-side extension commits the exact combined preview or one worker result.
function boxSetup(mode){sandbox.mode=mode;run(`source=makeObject('box').solid;var o=makeObject('box');o.solid=source;replaceDocumentContents('Multi extension',[o],[],[],'load-project','Open project',false);var ids=[...source.halfEdges.keys()].filter(id=>{const e=geometryApi.edge(source,id);return e.id<e.twinId;});setTool(mode);`);}
get('chamferDistance').value='.4';get('chamferAngle').value='45';
for(const mode of ['chamfer','roundchamfer']){
 boxSetup(mode);const beforeBatch=run('snapshot()'),historyBatch=run('undoStack.length');run(`toggleChamferEdgeSelection(objects[0],ids[0],mode);toggleChamferEdgeSelection(objects[0],ids[1],mode);`);assert.equal(run('chamferEdgeSelection.sides.length'),2);
 const preview=run('chamferEdgeSelection.previewResult');run(`handleChamferModifierKeyUp({key:'Control',ctrlKey:false,shiftKey:false});`);await wait();assert.equal(run('undoStack.length'),historyBatch+1);verify(run('objects[0].solid'),'Multi extension');if(preview){sandbox.batchPreview=preview.solid;assert.deepEqual(plain(run('serializeSolid(objects[0].solid)')),plain(run('serializeSolid(batchPreview)')));}
 run('undo()');assert.equal(run('snapshot()'),beforeBatch);
}
boxSetup('chamfer');run(`toggleChamferEdgeSelection(objects[0],ids[0]);`);const modeBefore=run('snapshot()'),modeHistory=run('undoStack.length');get('chamferOperation').value='cut';get('chamferOperation').listeners.change[0]();assert.equal(run('chamferEdgeSelection'),null);assert.equal(run('snapshot()'),modeBefore);assert.equal(run('undoStack.length'),modeHistory);
get('chamferOperation').value='extend';boxSetup('roundchamfer');const staleHistory=run('undoStack.length');run(`startRoundedChamfer(objects[0],ids[0],.4,45,8);`);get('chamferOperation').value='cut';await wait();assert.equal(run('lastRoundedChamferDiagnosticLog.outcome'),'error');assert.equal(run('undoStack.length'),staleHistory);assert.deepEqual(plain(run('serializeSolid(objects[0].solid)')),plain(run('serializeSolid(source)')),'Stale operation result cannot commit');
const html=fs.readFileSync(resolve(root,'dist/LamjaCraft-3D.html'),'utf8');assert.ok(html.includes('id="chamferOperation"'));assert.ok(html.includes('Extend · add material'));
await ModelingWorker.closeAll();console.log(`Chamfer extension passed ${cases} validated solids, independent added volume, concave corners, complete rims up to 48 facets, prepared preview, actual worker, history, cancellation and native reopen.`);
