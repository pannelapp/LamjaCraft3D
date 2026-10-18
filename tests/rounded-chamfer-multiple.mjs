import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
import {ModelingWorker} from './modeling-worker-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),workerCode=readFileSync(resolve(root,'build/modeling-worker-bundle.js'),'utf8');
class ControlledWorker {
  static instances=[];
  constructor(){ControlledWorker.instances.push(this);this.onmessage=null;this.onerror=null;this.terminated=false;this.messages=[];}
  postMessage(request){this.request=structuredClone(request);}
  terminate(){this.terminated=true;}
  complete(){const context={console,performance,structuredClone,TextEncoder,TextDecoder,postMessage:message=>{this.messages.push(message);this.onmessage?.({data:message});}};vm.createContext(context);vm.runInContext(workerCode,context);context.onmessage({data:this.request});}
}
const windowEvents={},f=createAppFixture(root,ControlledWorker,{window:{addEventListener:(type,handler)=>{windowEvents[type]=handler;}}}),{sandbox,get}=f;
const run=code=>vm.runInContext(code,sandbox),plain=value=>JSON.parse(JSON.stringify(value)),flush=()=>new Promise(resolve=>setImmediate(resolve));
run('var originalPick=topologyEdgeAt');
const reset=()=>{
  assert.equal(run('modelingOperationBusy'),false);
  for(const [id,value]of Object.entries({roundedChamferRadius:'2',roundedChamferAngle:'45',roundedChamferSegments:'6'}))get(id).value=value;
  sandbox.document.activeElement.tagName='DIV';sandbox.document.querySelector=()=>null;
  run(`cancelGesture();replaceObjects([]);replaceGroups([]);replaceDimensions([]);replaceGuides([]);objects.push(makeObject('box'));var source=objects[0].solid,edgeIds=[...source.halfEdges.keys()].filter(id=>{const e=geometryApi.edge(source,id);return e.id<e.twinId;});undoStack=[];redoStack=[];setTool('roundchamfer');clearSelection();setDirtyState(false);`);
};
const click=(index,modifiers={ctrlKey:true},opposite=false,objectIndex=0)=>{
  sandbox.index=index;sandbox.mods=modifiers;sandbox.opposite=opposite;sandbox.objectIndex=objectIndex;
  run(`var pickedObject=objects[objectIndex],pickedEdge=geometryApi.edge(source,edgeIds[index]),pickedId=opposite?pickedEdge.twinId:pickedEdge.id;topologyEdgeAt=()=>({kind:'edge',objectId:pickedObject.id,halfEdgeId:pickedId});roundedChamferToolController.pointerDown({event:mods,x:0,y:0,hit:{id:pickedObject.id,face:opposite?pickedEdge.faceB:pickedEdge.faceA}});`);
};
const release=(key='Control',extra={})=>{sandbox.ev={key,ctrlKey:false,shiftKey:false,...extra};run('dispatchToolKeyUp(ev)');};
const state=()=>run('snapshot()'),lastWorker=()=>ControlledWorker.instances.at(-1);
function verify(solid,label){sandbox.checked=solid;assert.equal(run('validateSolid(checked,false).ok'),true,label);assert.deepEqual(plain(run('triangleMeshEdgeStats(solidMeshExportLocal(checked))')),{boundary:0,nonManifold:0},label+' closed Float32 STL');assert.equal(run('connectedSolidFaceComponents(checked).length'),1);assert.deepEqual(plain(run('serializeProjectSolid(deserializeProjectSolid(serializeProjectSolid(checked)))')),plain(run('serializeProjectSolid(checked)')),label+' native round-trip');}

// Unmodified clicks still immediately start the legacy single-edge worker.
reset();const singleBefore=state();click(0,{});assert.equal(run('modelingOperationBusy'),true);assert.equal(state(),singleBefore);assert.equal(lastWorker().request.halfEdgeIds,undefined);lastWorker().complete();await flush();assert.equal(run('undoStack.length'),1);assert.equal(run('modelingOperationBusy'),false);

// No geometry/worker work occurs while selecting; both modifiers must be released.
reset();run(`objects[0].transform={position:[3,-8,12],rotation:[.2,.5,.7]};var originalTransform=JSON.stringify(objects[0].transform);var vertices=[...source.vertices.keys()];dimensions.push({id:'linked',kind:'linear',a:{kind:'vertex',objectId:objects[0].id,vertexId:vertices[0],fallback:[0,0,0]},b:{kind:'vertex',objectId:objects[0].id,vertexId:vertices[1],fallback:[1,1,1]}});var savedRound=geometryApi.roundedChamferEdge;geometryApi.roundedChamferEdge=()=>{throw Error('Synchronous rounded selection computation');};`);
const before=state(),workers=ControlledWorker.instances.length;click(0,{ctrlKey:true,shiftKey:true});click(1,{ctrlKey:true,shiftKey:true});
assert.equal(state(),before);assert.equal(run('dirty'),false);assert.equal(run('undoStack.length'),0);assert.equal(run('modelingOperationBusy'),false);assert.equal(ControlledWorker.instances.length,workers);assert.match(get('roundedChamferSelectionStatus').textContent,/2 straight sides/);
run(`var lines=[],savedPath=path3;path3=(points,color)=>lines.push({points,color});drawRoundedChamferHover();path3=savedPath;`);assert.equal(run('lines.filter(line=>line.color==="#276a61").length'),2);assert.equal(state(),before);
release('Control',{shiftKey:true});assert.equal(ControlledWorker.instances.length,workers);release('Shift');assert.equal(ControlledWorker.instances.length,workers+1);assert.equal(run('chamferEdgeSelection'),null);assert.equal(run('modelingOperationBusy'),true);assert.equal(state(),before);assert.equal(lastWorker().request.halfEdgeIds.length,2);
lastWorker().complete();await flush();run('geometryApi.roundedChamferEdge=savedRound');assert.equal(run('modelingOperationBusy'),false);assert.equal(run('undoStack.length'),1);assert.equal(run('lastCommandEntry().type'),'rounded-chamfer-edge');assert.equal(run('lastCommandEntry().parameters.halfEdgeIds.length'),2);assert.equal(run('JSON.stringify(objects[0].transform)===originalTransform'),true);verify(run('objects[0].solid'),'Opposite rounded sides');
const expectedRemoved=80*4*(1-3*Math.sin(Math.PI/12));assert.ok(Math.abs(run('validateSolid(source,false).volume-validateSolid(objects[0].solid,false).volume')-expectedRemoved)<1e-6,'Independent faceted quarter-circle cut volume');
assert.equal(run('dimensions.every(d=>[d.a,d.b].every(a=>a.kind!=="vertex"||geometryApi.hasVertex(objects[0].solid,a.vertexId)))'),true);assert.equal(run('lastRoundedChamferDiagnosticLog.outcome'),'success');assert.equal(run('lastRoundedChamferDiagnosticLog.input.halfEdgeIds.length'),2);assert.ok(lastWorker().messages.some(m=>m.type==='progress'));assert.ok(lastWorker().messages.some(m=>m.type==='diagnostic'&&m.event.event==='corner-geometry'));
const after=state();run('undo()');assert.equal(state(),before);run('redo()');assert.equal(state(),after);assert.equal(run('tool'),'roundchamfer');

// Twin picks and empty selections do not accidentally start a worker.
for(const modifier of ['ctrlKey','shiftKey']){reset();const start=state(),count=ControlledWorker.instances.length;click(0,{[modifier]:true});click(0,{[modifier]:true},true);assert.equal(run('chamferEdgeSelection.sides.length'),0);release(modifier==='ctrlKey'?'Control':'Shift');assert.equal(state(),start);assert.equal(ControlledWorker.instances.length,count);}

// Combined cutters meet at shared corners, with independently selected setbacks.
let cases=0;
for(const bias of [30,45,60])for(const segments of [2,6,12])for(const indices of [[0,2,5],Array.from({length:12},(_,i)=>i)]){
  reset();get('roundedChamferRadius').value='.5';get('roundedChamferAngle').value=String(bias);get('roundedChamferSegments').value=String(segments);const start=state();for(const index of indices)click(index,{shiftKey:true});assert.equal(state(),start);release('Shift');lastWorker().complete();await flush();assert.equal(run('undoStack.length'),1,`${bias}/${segments}/${indices}`);verify(run('objects[0].solid'),`Shared rounded corners ${bias}/${segments}/${indices}`);cases++;
}
reset();get('roundedChamferAngle').value='35';click(0);run(`var faceEdge=geometryApi.edge(source,edgeIds[1]);topologyEdgeAt=()=>({kind:'edge',objectId:objects[0].id,halfEdgeId:faceEdge.id});roundedChamferToolController.pointerDown({event:{ctrlKey:true},x:0,y:0,hit:{id:objects[0].id,face:faceEdge.faceB}});`);assert.equal(run('chamferEdgeSelection.sides[1].halfEdgeIds[0]===faceEdge.twinId'),true);release();assert.ok(lastWorker().request.halfEdgeIds.includes(run('faceEdge.twinId')));lastWorker().complete();await flush();verify(run('objects[0].solid'),'Mixed picked-face biases');

// One collinear subdivision remains one selected side and is sent exactly once.
reset();run(`var edge=source.halfEdges.get(edgeIds[0]),tw=source.halfEdges.get(edge.twin),next=source.halfEdges.get(edge.next),tn=source.halfEdges.get(tw.next),mid=V.lerp(source.vertices.get(edge.origin).position,source.vertices.get(tw.origin).position,.5),e2={...edge,id:'he_sub_A',origin:'v_sub',prev:edge.id,twin:tw.id},t2={...tw,id:'he_sub_B',origin:'v_sub',prev:tw.id,twin:edge.id};source.vertices.set('v_sub',{id:'v_sub',position:mid});source.halfEdges.set(e2.id,e2);source.halfEdges.set(t2.id,t2);edge.next=e2.id;edge.twin=t2.id;next.prev=e2.id;tw.next=t2.id;tw.twin=e2.id;tn.prev=t2.id;edgeIds.push(tw.id);`);
click(0);assert.equal(run('chamferEdgeSelection.sides[0].halfEdgeIds.length'),2);click(12);assert.equal(run('chamferEdgeSelection.sides.length'),0);click(0);click(1);release();assert.equal(lastWorker().request.halfEdgeIds.length,3);lastWorker().complete();await flush();verify(run('objects[0].solid'),'Subdivided rounded side');

// Selection cancellation, stale references and blocked releases never start work.
for(const cancel of ['handleToolEscape()','setTool("chamfer")','prepareToolForDocumentChange()','blur','input','focused','dialog','busy','revision','source','hidden','grouped']){
  reset();click(0);click(1);const count=ControlledWorker.instances.length;
  if(cancel==='blur')windowEvents.blur();else if(cancel==='input'){get('roundedChamferSegments').value='8';get('roundedChamferSegments').listeners.input[0]();}else if(cancel==='focused')sandbox.document.activeElement.tagName='INPUT';else if(cancel==='dialog')sandbox.document.querySelector=()=>({open:true});else if(cancel==='busy')run('modelingOperationBusy=true');else if(cancel==='revision')run('modelRevision++');else if(cancel==='source')run('objects[0].solid=structuredClone(source)');else if(cancel==='hidden')run('objects[0].hidden=true');else if(cancel==='grouped')run('groups.push({id:"g",name:"Group",objectIds:[objects[0].id]})');else run(cancel);
  const unchanged=state();release();assert.equal(state(),unchanged,cancel);assert.equal(ControlledWorker.instances.length,count,cancel);assert.equal(run('undoStack.length'),0);assert.equal(run('chamferEdgeSelection'),null);run('modelingOperationBusy=false');if(cancel==='handleToolEscape()')assert.equal(run('tool'),'roundchamfer');
}
reset();run('objects.push(makeObject("box"))');click(0);click(1,{ctrlKey:true},false,1);assert.equal(run('chamferEdgeSelection.sides.length'),1);release();lastWorker().complete();await flush();assert.equal(run('objects[1].solid.faces.size'),6);
reset();run(`source=objects[0].solid=makeObject('cylinder').solid;edgeIds=[...source.halfEdges.keys()].filter(id=>{const e=geometryApi.edge(source,id);return Math.abs(e.a[2]-e.b[2])<TOL.minimumEdge;});`);const rim=state(),rimWorkers=ControlledWorker.instances.length;click(0);release();assert.equal(state(),rim);assert.equal(ControlledWorker.instances.length,rimWorkers);click(0,{});assert.equal(run('modelingOperationBusy'),true);run('cancelModelingOperation()');await flush();assert.equal(state(),rim);

// Worker cancellation, geometric failure and late stale results are atomic.
reset();click(0);click(1);const cancelled=state();release();run('cancelModelingOperation()');await flush();assert.equal(lastWorker().terminated,true);lastWorker().complete();await flush();assert.equal(state(),cancelled);assert.equal(run('undoStack.length'),0);assert.equal(run('lastRoundedChamferDiagnosticLog.outcome'),'cancelled');
reset();get('roundedChamferRadius').value='1000';click(0);click(1);const invalid=state();release();lastWorker().complete();await flush();assert.equal(state(),invalid);assert.equal(run('undoStack.length'),0);assert.equal(run('lastRoundedChamferDiagnosticLog.outcome'),'error');assert.equal(run('modelingOperationBusy'),false);
for(const stale of ['modelRevision++','objects[0].solid=structuredClone(source)','objects[0].hidden=true','groups.push({id:"g",name:"Group",objectIds:[objects[0].id]})']){reset();click(0);click(1);release();run(stale);const unchanged=state();lastWorker().complete();await flush();assert.equal(state(),unchanged,stale);assert.equal(run('undoStack.length'),0);assert.equal(run('lastRoundedChamferDiagnosticLog.outcome'),'error');}

// Use actual screen picking through shared pointer and controller key-up dispatch.
reset();run(`topologyEdgeAt=originalPick;setView('top');camera.target=[0,0,10];camera.distance=160;cameraBasis();var cap=[...source.faces.values()].find(f=>f.plane.normal[2]>.99),screenPicks=geometryApi.faceTopologyEdges(source,cap.id).slice(0,2).map(e=>project(V.lerp(V.lerp(e.a,e.b,.5),[0,0,20],.01)));`);
const actualBefore=state();for(const [clientX,clientY]of plain(run('screenPicks'))){sandbox.ev={button:0,pointerId:1,clientX,clientY,shiftKey:true};run('dispatchToolPointerDown(ev)');}assert.equal(run('chamferEdgeSelection.sides.length'),2);assert.equal(state(),actualBefore);release('Shift');lastWorker().complete();await flush();assert.equal(run('undoStack.length'),1);verify(run('objects[0].solid'),'Projected rounded picks');

// Run the shipped bundle on a real separate thread: progress and diagnostics
// stay responsive, and the explicit multi-edge request matches the kernel.
const live=createAppFixture(root,ModelingWorker),lr=code=>vm.runInContext(code,live.sandbox);
try{
  lr(`var liveSource=makeObject('box').solid,liveIds=[...liveSource.halfEdges.keys()].filter(id=>{const e=geometryApi.edge(liveSource,id);return e.id<e.twinId;}).slice(0,3),progress=[],diagnostics=[],job=geometryApi.roundedChamferStraightEdgesAsync(liveSource,[...liveIds,liveIds[0],geometryApi.edge(liveSource,liveIds[0]).twinId],.5,35,12,u=>progress.push(u),e=>diagnostics.push(e));`);
  const serialized=lr('JSON.stringify(serializeSolid(liveSource))');let ticks=0;const ticker=setInterval(()=>ticks++,1);let result;try{result=await lr('job.promise');}finally{clearInterval(ticker);}
  assert.ok(ticks>0,'Main thread remains responsive');assert.equal(ModelingWorker.instances.at(-1).request.halfEdgeIds.length,3);assert.equal(lr('JSON.stringify(serializeSolid(liveSource))'),serialized);assert.ok(lr('progress.length')>0);assert.ok(lr('diagnostics.some(e=>e.event==="corner-geometry")'));live.sandbox.result=result;assert.equal(lr('validateSolid(result.solid,false).ok'),true);assert.deepEqual(plain(lr('serializeSolid(result.solid)')),plain(lr('serializeSolid(roundedChamferEdgesSolid(liveSource,liveIds,.5,35,12))')));
  lr('var stopped=geometryApi.roundedChamferStraightEdgesAsync(liveSource,liveIds,1,45,32);stopped.cancel()');await assert.rejects(lr('stopped.promise'),/cancelled/);assert.equal(ModelingWorker.instances.at(-1).terminated,true);
}finally{await ModelingWorker.closeAll();}
console.log(`R227 Rounded Chamfer multi-selection passed ${cases} shared-corner/bias/segment cases, real shipped worker responsiveness/cancellation, legacy single clicks/rims, modifier/twin/collinear toggles, screen picks, picked-side orientation, history, closed export/native reopening and stale/failure guards.`);
