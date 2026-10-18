import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),windowEvents={};
const {sandbox,get}=createAppFixture(root,undefined,{window:{addEventListener:(type,handler)=>{windowEvents[type]=handler;}}});
const run=code=>vm.runInContext(code,sandbox),plain=value=>JSON.parse(JSON.stringify(value));
run('var originalPick=topologyEdgeAt');
const reset=()=>{
  get('chamferDistance').value='2';get('chamferAngle').value='45';sandbox.document.activeElement.tagName='DIV';sandbox.document.querySelector=()=>null;
  run(`cancelGesture();replaceObjects([]);replaceGroups([]);replaceDimensions([]);replaceGuides([]);objects.push(makeObject('box'));var source=objects[0].solid;var edgeIds=[...source.halfEdges.keys()].filter(id=>{const e=geometryApi.edge(source,id);return e.id<e.twinId;});undoStack=[];redoStack=[];setTool('chamfer');clearSelection();setDirtyState(false);`);
};
const click=(index,modifiers={ctrlKey:true},opposite=false,objectIndex=0)=>{
  sandbox.index=index;sandbox.mods=modifiers;sandbox.opposite=opposite;sandbox.objectIndex=objectIndex;
  run(`var pickedObject=objects[objectIndex],pickedEdge=geometryApi.edge(source,edgeIds[index]),pickedId=opposite?pickedEdge.twinId:pickedEdge.id;topologyEdgeAt=()=>({kind:'edge',objectId:pickedObject.id,halfEdgeId:pickedId});chamferToolController.pointerDown({event:mods,x:0,y:0,hit:{id:pickedObject.id,face:opposite?pickedEdge.faceB:pickedEdge.faceA}});`);
};
const release=(key='Control',extra={})=>{sandbox.ev={key,ctrlKey:false,shiftKey:false,...extra};run('dispatchToolKeyUp(ev)');};
const state=()=>run('snapshot()');
function verify(solid,label){
  sandbox.checked=solid;assert.equal(run('validateSolid(checked,false).ok'),true,label);
  assert.deepEqual(plain(run('triangleMeshEdgeStats(solidMeshExportLocal(checked))')),{boundary:0,nonManifold:0},label+' closed Float32 export');
  assert.equal(run('connectedSolidFaceComponents(checked).length'),1,label+' single shell');
  assert.deepEqual(plain(run('serializeProjectSolid(deserializeProjectSolid(serializeProjectSolid(checked)))')),plain(run('serializeProjectSolid(checked)')),label+' native round-trip');
}

// Unmodified click still commits immediately and reuses its exact hover result.
reset();run(`var single=geometryApi.chamferEdge(source,edgeIds[0],2,45),chain=geometryApi.chamferCandidateEdges(source,edgeIds[0]);chamferHover={objectId:objects[0].id,halfEdgeId:edgeIds[0],halfEdgeIds:chain,sourceSolid:source,previewResult:single,previewSolid:single.solid,previewKey:chamferChainPreviewKey('chamfer',objects[0].id,chain,2,45),error:null};var savedSingle=geometryApi.chamferEdge;geometryApi.chamferEdge=()=>{throw Error('Repeated single-edge generation');};`);
click(0,{});assert.equal(run('undoStack.length'),1);assert.equal(run('objects[0].solid===single.solid'),true);assert.equal(run('chamferEdgeSelection'),null);run('geometryApi.chamferEdge=savedSingle');

// Both modifiers may be held. Only the last release applies one atomic result.
reset();run(`objects[0].transform={position:[3.25,-7.5,11],rotation:[.2,.4,.7]};var originalTransform=JSON.stringify(objects[0].transform);var vertices=[...source.vertices.keys()];dimensions.push({id:'linked',kind:'linear',a:{kind:'vertex',objectId:objects[0].id,vertexId:vertices[0],fallback:[0,0,0]},b:{kind:'vertex',objectId:objects[0].id,vertexId:vertices[1],fallback:[1,1,1]}});`);
const before=state();click(0,{ctrlKey:true,shiftKey:true});click(1,{ctrlKey:true,shiftKey:true});
assert.equal(state(),before);assert.equal(run('dirty'),false);assert.equal(run('undoStack.length'),0);
assert.equal(run('chamferEdgeSelection.sides.length'),2);assert.match(get('chamferSelectionStatus').textContent,/2 straight sides/);
run(`var selectionLines=[],savedPath3=path3;path3=(points,color)=>selectionLines.push({points,color});drawChamferHover();path3=savedPath3;`);
assert.equal(run('selectionLines.filter(line=>line.color==="#276a61").length'),2,'Selected source edges remain highlighted');assert.equal(state(),before,'Overlay is read-only');
const preview=plain(run('serializeSolid(chamferEdgeSelection.previewResult.solid)'));
run('var selectedResult=chamferEdgeSelection.previewResult;var savedBatch=geometryApi.chamferStraightEdges;geometryApi.chamferStraightEdges=()=>{throw Error("Repeated batch generation");};');
release('Control',{shiftKey:true});assert.equal(state(),before);release('Shift');
assert.equal(run('undoStack.length'),1);assert.equal(run('lastCommandEntry().type'),'chamfer-edge');assert.equal(run('lastCommandEntry().parameters.halfEdgeIds.length'),2);
assert.deepEqual(plain(run('serializeSolid(objects[0].solid)')),preview);assert.equal(run('JSON.stringify(objects[0].transform)===originalTransform'),true);
assert.ok(Math.abs(run('validateSolid(source,false).volume-validateSolid(objects[0].solid,false).volume')-160)<1e-6,'Independent disjoint-edge volume');
verify(run('objects[0].solid'),'Opposite edges');
assert.equal(run('dimensions.every(d=>[d.a,d.b].every(a=>a.kind!=="vertex"||geometryApi.hasVertex(objects[0].solid,a.vertexId)))'),true,'No dangling dimension anchors');
const after=state();run('geometryApi.chamferStraightEdges=savedBatch;undo()');assert.equal(state(),before);run('redo()');assert.equal(state(),after);assert.equal(run('tool'),'chamfer');

// Twin-edge clicks toggle one side rather than double-cutting it. Empty release is a no-op.
for(const modifier of ['ctrlKey','shiftKey']){
  reset();const start=state();click(0,{[modifier]:true});click(0,{[modifier]:true},true);
  assert.equal(run('chamferEdgeSelection.sides.length'),0);release(modifier==='ctrlKey'?'Control':'Shift');assert.equal(state(),start);assert.equal(run('undoStack.length'),0);
}

// The picked face controls the base setback independently for every side.
reset();get('chamferAngle').value='35';click(0);
run(`var faceEdge=geometryApi.edge(source,edgeIds[1]);topologyEdgeAt=()=>({kind:'edge',objectId:objects[0].id,halfEdgeId:faceEdge.id});chamferToolController.pointerDown({event:{ctrlKey:true},x:0,y:0,hit:{id:objects[0].id,face:faceEdge.faceB}});`);
assert.equal(run('chamferEdgeSelection.sides[1].halfEdgeIds[0]===faceEdge.twinId'),true,'Each picked face retains its setback side');release();assert.equal(run('undoStack.length'),1);verify(run('objects[0].solid'),'Mixed face orientations');

// Adjacent cutters meet at shared corners; orientation and setback bias survive batching.
let cases=0;
for(const bias of [30,45,60])for(const indices of [[0,1],[0,2],[0,2,5],[2,6,8,4],Array.from({length:12},(_,i)=>i)]){
  reset();get('chamferDistance').value='.5';get('chamferAngle').value=String(bias);const start=state();
  for(const index of indices)click(index,{shiftKey:true});assert.equal(state(),start);
  assert.equal(run('chamferEdgeSelection.error'),null,`${indices} / ${bias}`);const result=plain(run('serializeSolid(chamferEdgeSelection.previewResult.solid)'));release('Shift');
  assert.equal(run('undoStack.length'),1);assert.deepEqual(plain(run('serializeSolid(objects[0].solid)')),result);verify(run('objects[0].solid'),`Shared corners ${indices} / ${bias}`);cases++;
}
// Distinct non-orthogonal convex corners use the existing general cutter frame.
for(const phi of [30,60,120,150]){
  reset();sandbox.phi=phi;run(`source=primitivePrism([[0,0],[20,0],[20*Math.cos(phi*Math.PI/180),20*Math.sin(phi*Math.PI/180)]],12,'Batch wedges');objects[0].solid=source;edgeIds=[...source.halfEdges.keys()].filter(id=>{const e=geometryApi.edge(source,id);return e.id<e.twinId&&Math.abs(e.a[2]-e.b[2])>11;});`);
  get('chamferDistance').value='.1';get('chamferAngle').value='35';for(let i=0;i<3;i++)click(i);release();assert.equal(run('undoStack.length'),1);verify(run('objects[0].solid'),`Wedge ${phi}`);cases++;
}

// Collinear B-rep subdivisions remain one side even when picked from its twin.
reset();run(`var edge=source.halfEdges.get(edgeIds[0]),tw=source.halfEdges.get(edge.twin),next=source.halfEdges.get(edge.next),tn=source.halfEdges.get(tw.next),mid=V.lerp(source.vertices.get(edge.origin).position,source.vertices.get(tw.origin).position,.5),e2={...edge,id:'he_sub_A',origin:'v_sub',prev:edge.id,twin:tw.id},t2={...tw,id:'he_sub_B',origin:'v_sub',prev:tw.id,twin:edge.id};source.vertices.set('v_sub',{id:'v_sub',position:mid});source.halfEdges.set(e2.id,e2);source.halfEdges.set(t2.id,t2);edge.next=e2.id;edge.twin=t2.id;next.prev=e2.id;tw.next=t2.id;tw.twin=e2.id;tn.prev=t2.id;`);
assert.equal(run('validateSolid(source,false).ok'),true);click(0);assert.equal(run('chamferEdgeSelection.sides[0].halfEdgeIds.length'),2);run('edgeIds.push(tw.id)');click(12);assert.equal(run('chamferEdgeSelection.sides.length'),0);click(0);click(1);release();verify(run('objects[0].solid'),'Split straight side');assert.equal(run('undoStack.length'),1);

// An unsupported second target cannot change object scope or add rim members.
reset();run('objects.push(makeObject("box"))');click(0);click(1,{ctrlKey:true},false,1);assert.equal(run('chamferEdgeSelection.sides.length'),1);release();assert.equal(run('undoStack.length'),1);assert.equal(run('objects[1].solid.faces.size'),6);
reset();run(`objects[0].solid=source=makeObject('cylinder').solid;edgeIds=[...source.halfEdges.keys()].filter(id=>{const e=geometryApi.edge(source,id);return Math.abs(e.a[2]-e.b[2])<TOL.minimumEdge;});`);const rimBefore=state();click(0);assert.equal(run('chamferEdgeSelection'),null);release();assert.equal(state(),rimBefore);

// Cancellation and stale references never apply geometry on a later key-up.
for(const cancel of ['handleToolEscape()','setTool("select")','prepareToolForDocumentChange()','blur','input','focused','dialog','busy','revision','source','hidden','grouped']){
  reset();click(0);click(1);const start=state();
  if(cancel==='blur')windowEvents.blur();
  else if(cancel==='input'){get('chamferDistance').value='3';get('chamferDistance').listeners.input[0]();}
  else if(cancel==='focused')sandbox.document.activeElement.tagName='INPUT';
  else if(cancel==='dialog')sandbox.document.querySelector=()=>({open:true});
  else if(cancel==='busy')run('modelingOperationBusy=true');
  else if(cancel==='revision')run('modelRevision++');
  else if(cancel==='source')run('objects[0].solid=structuredClone(source)');
  else if(cancel==='hidden')run('objects[0].hidden=true');
  else if(cancel==='grouped')run('groups.push({id:"g",name:"Group",objectIds:[objects[0].id]})');
  else run(cancel);
  const unchanged=state();release();assert.equal(state(),unchanged,cancel);assert.equal(run('undoStack.length'),0,cancel);assert.equal(run('chamferEdgeSelection'),null,cancel);run('modelingOperationBusy=false');
  if(!['hidden','grouped'].includes(cancel))assert.equal(state(),start,cancel+' document');
  if(cancel==='handleToolEscape()')assert.equal(run('tool'),'chamfer','Escape consumes the batch before leaving the tool');
}

// Invalid combined geometry produces no partial edit and no Undo entry.
reset();get('chamferDistance').value='40';const rejected=state();click(0);click(1);assert.equal(run('chamferEdgeSelection.previewResult'),null);assert.ok(run('chamferEdgeSelection.error'));release();assert.equal(state(),rejected);assert.equal(run('undoStack.length'),0);assert.match(get('toast').textContent,/volume/i);

// Command validation still rolls back the entire replacement if a prepared
// result is corrupted. Selection never grants permission for a partial edit.
reset();click(0);click(1);const rollback=state();run('chamferEdgeSelection.previewResult.solid.faces.clear()');release();assert.equal(state(),rollback);assert.equal(run('undoStack.length'),0);

// Exercise real projected hit testing and shared pointer dispatch, without pick stubs.
reset();run(`topologyEdgeAt=originalPick;setView('top');camera.target=[0,0,10];camera.distance=160;cameraBasis();var topFace=[...source.faces.values()].find(f=>f.plane.normal[2]>.99),topEdges=geometryApi.faceTopologyEdges(source,topFace.id),screenPicks=topEdges.slice(0,2).map(e=>{const mid=V.lerp(e.a,e.b,.5),inside=V.lerp(mid,[0,0,20],.01);return project(inside);});`);
const picks=plain(run('screenPicks'));const realBefore=state();for(const [clientX,clientY] of picks){sandbox.ev={button:0,pointerId:1,clientX,clientY,ctrlKey:true};run('dispatchToolPointerDown(ev)');}
assert.equal(run('chamferEdgeSelection.sides.length'),2);assert.equal(state(),realBefore);release();assert.equal(run('undoStack.length'),1);verify(run('objects[0].solid'),'Real screen picks');
console.log(`R226 multiple Chamfer passed ${cases} corner/bias combinations, projected pointer picks, modifier toggles/release, preview equivalence, one-command history, closed export/native round-trip and cancellation guards.`);
