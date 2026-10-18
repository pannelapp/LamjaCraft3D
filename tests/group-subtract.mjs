import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
import {ModelingWorker} from './modeling-worker-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),workerCode=fs.readFileSync(resolve(root,'build/modeling-worker-bundle.js'),'utf8');
const kernel={console,performance,structuredClone,TextEncoder,TextDecoder,postMessage:()=>{}};
vm.createContext(kernel);vm.runInContext(workerCode,kernel);const run=code=>vm.runInContext(code,kernel);
const cases=run(`(()=>{
 const identity={position:[0,0,0],rotation:[0,0,0]},target=primitivePrism([[0,0],[20,0],[20,10],[0,10]],10,'target');
 const box=(x,y,w,d,h=12,z=-1)=>({solid:primitivePrism([[x,y],[x+w,y],[x+w,y+d],[x,y+d]],h,'cutter'),transform:{position:[0,0,z],rotation:[0,0,0]}});
 const request=cutters=>({type:'group-subtract',target,targetTransform:identity,cutters});
 const holes=request([box(2,2,2,2),box(14,2,2,2),box(50,50,2,2)]);
 const cavities=request([box(2,2,4,4,4,3),box(12,2,4,4,4,3)]);
 const split=request([box(5,-1,2,12),box(12,-1,2,12)]);
 const overlap=request([box(2,2,4,4),box(4,2,4,4)]);
 const coverage=request([box(-1,-1,12,12),box(10,-1,12,12)]);
 const transformed=structuredClone(holes);transformed.targetTransform={position:[35,-25,10],rotation:[20,10,35]};for(const cutter of transformed.cutters)cutter.transform={position:transformPoint(cutter.transform.position,transformed.targetTransform),rotation:[...transformed.targetTransform.rotation]};
 return [
 ['separated cutters / hidden-equivalent and disjoint member',holes,'changed',1920,1],
 ['overlapping cutter union counted once',overlap,'changed',1760,1],
 ['two closed cavities',cavities,'changed',1872,1],
 ['three independent material pieces',split,'changed',1600,3],
 ['transformed target and cutters',transformed,'changed',1920,1],
 ['no overlap or face/edge tangency',request([box(20,0,2,2),box(20,10,2,2),box(50,50,2,2)]),'unchanged'],
 ['combined full coverage',coverage,'empty'],
 ['empty cutter list',request([]),'invalid'],
 ['project cutter budget',request(Array.from({length:301},()=>box(2,2,2,2))),'invalid'],
 ['100 separated through-cutters',{...request(Array.from({length:100},(_,i)=>box(3+5*(i%10),3+5*Math.floor(i/10),2,2))),target:primitivePrism([[0,0],[60,0],[60,60],[0,60]],4,'large-target')},'changed',12800,1,14400]
 ];
})()`);
for(const [name,request,status,volume,count,originalVolume=2000] of cases){
 kernel.request=request;const before=run('JSON.stringify([serializeSolid(request.target),...request.cutters.map(c=>serializeSolid(c.solid)),request.targetTransform,request.cutters.map(c=>c.transform)])');
 const updates=[];kernel.report=update=>updates.push(update);const result=run('subtractGroupSolids(request,report)');assert.equal(result.status,status,`${name}: ${result.message}`);
 assert.equal(run('JSON.stringify([serializeSolid(request.target),...request.cutters.map(c=>serializeSolid(c.solid)),request.targetTransform,request.cutters.map(c=>c.transform)])'),before,name+' preserves sources');
 if(status==='changed'){
  assert.equal(result.solids.length,count,name);assert.ok(Math.abs(result.removedVolume-(originalVolume-volume))<1e-6,name);let total=0;
  for(const solid of result.solids){kernel.solid=solid;const check=run('checkObjectSolid(solid)');assert.equal(check.status,'passed',name);total+=check.volume;
   const edges=run('triangleMeshEdgeStats(solidMeshExportLocal(solid))');assert.equal(edges.boundary,0);assert.equal(edges.nonManifold,0);
   assert.equal(run('checkObjectSolid(deserializeSolid(serializeSolid(solid))).status'),'passed');}
  assert.ok(Math.abs(total-volume)<1e-6,name);assert.equal(updates.at(-1).progress,100);assert.ok(updates.some(u=>/cutter 2/.test(u.message)));
 }
}
// All cutters are checked, even after full coverage or when they cannot intersect.
for(const bad of ['cutters[1].transform.position[0]=NaN','cutters[1].solid.faces.clear()']){
 kernel.base=structuredClone(cases[6][1]);kernel.base.cutters[0]={solid:structuredClone(kernel.base.target),transform:structuredClone(kernel.base.targetTransform)};kernel.bad=bad;const result=run(`(()=>{const request=structuredClone(base);${bad.replaceAll('cutters','request.cutters')};return subtractGroupSolids(request);})()`);assert.equal(result.status,'invalid');
}
class ControlledWorker {
 static instances=[];constructor(){this.onmessage=null;this.onerror=null;this.terminated=false;ControlledWorker.instances.push(this);}
 postMessage(request){this.request=structuredClone(request);}terminate(){this.terminated=true;}
 complete(){const context={console,performance,structuredClone,TextEncoder,TextDecoder,postMessage:data=>this.onmessage?.({data})};vm.createContext(context);vm.runInContext(workerCode,context);context.onmessage({data:this.request});}
}
const {sandbox,get}=createAppFixture(root,ControlledWorker),ui=code=>vm.runInContext(code,sandbox);get('projectName').value=ui('modelDocument.name');
const setup=()=>ui(`(()=>{
 replaceObjects([]);replaceGroups([]);replaceDimensions([]);
 const target=makeObject('box');target.name='Target <one>';target.color='#123456';target.solid=geometryApi.createPrism([[0,0],[20,0],[20,10],[0,10]],10,'target');target.transform={position:[35,-25,10],rotation:[20,10,35]};objects.push(target);
 const cutters=[[2,2],[14,2],[50,50]].map(([x,y],index)=>{const cutter=makeObject('box');cutter.name=index===1?'Hidden <cutter>':'Cutter '+index;cutter.solid=geometryApi.createPrism([[x,y],[x+2,y],[x+2,y+2],[x,y+2]],12,'cutter'+index);cutter.transform={position:transformPoint([0,0,-1],target.transform),rotation:[...target.transform.rotation]};if(index===1)cutter.hidden=true;objects.push(cutter);return cutter;});
 const group={id:'grp-cutters',name:'Tools <group>',objectIds:cutters.map(c=>c.id)};groups.push(group);selectObject(target);toggleObjectSelection(cutters[0]);updateUI();
 dimensions.push({id:'group-dimension',kind:'linear',a:{kind:'vertex',objectId:target.id,vertexId:[...target.solid.vertices.keys()][0],fallback:[0,0,0]},b:{kind:'vertex',objectId:cutters[1].id,vertexId:[...cutters[1].solid.vertices.keys()][0],fallback:[0,0,0]}});
 return {targetId:target.id,groupId:group.id,cutterIds:[...group.objectIds]};
})()`);
const state=()=>ui('JSON.stringify(projectData())');
for(const keep of [false,true]){
 const ids=setup(),before=state(),history=ui('undoStack.length'),dimension=ui('dimensionValue(dimensions[0])'),placement=ui('JSON.stringify(objects[0].transform)');
 assert.equal(get('subtractBtn').disabled,false);get('subtractBtn').onclick();assert.equal(get('objectSubtractDialog').open,true);assert.equal(get('subtractTargetName').textContent,'Target <one>');assert.equal(get('subtractCutterName').textContent,'Tools <group> · 3 objects');assert.match(get('subtractGroupSummary').textContent,/including 1 hidden/);assert.match(get('subtractGroupMembers').textContent,/Hidden <cutter> · hidden/);assert.equal(get('swapSubtractBtn').disabled,true);get('swapSubtractBtn').onclick();assert.equal(get('subtractTargetName').textContent,'Target <one>');get('subtractKeepCutter').checked=keep;
 const pending=ui('runObjectSubtractFromUI()'),worker=ControlledWorker.instances.at(-1);assert.equal(worker.request.type,'group-subtract');assert.equal(worker.request.cutters.length,3);assert.equal(state(),before);worker.complete();await pending;
 assert.equal(worker.terminated,true);assert.equal(ui('modelingOperationBusy'),false);assert.equal(ui('undoStack.length'),history+1);assert.equal(ui('lastCommandEntry().type'),'subtract-objects');assert.equal(ui('lastCommandEntry().parameters.cutterIds.length'),3);assert.equal(ui('objects.length'),keep?4:1);assert.equal(ui('groups.length'),keep?1:0);assert.equal(ui('current().id'),ids.targetId);assert.equal(ui('current().name'),'Target <one>');assert.equal(ui('current().color'),'#123456');assert.equal(ui('JSON.stringify(current().transform)'),placement);assert.ok(Math.abs(ui('checkObjectSolid(current().solid).volume')-1920)<1e-6);
 assert.equal(ui('dimensions[0].a.kind'),'world');assert.equal(ui('dimensions[0].b.kind'),keep?'vertex':'world');assert.ok(Math.abs(ui('dimensionValue(dimensions[0])')-dimension)<1e-8);if(keep)assert.equal(ui('objects[2].hidden'),true);
 const after=state();assert.equal(ui('validateProject(projectData()).objects.length'),keep?4:1);assert.equal(ui('validateProject(projectData()).groups.length'),keep?1:0);ui('undo()');assert.equal(state(),before);ui('redo()');assert.equal(state(),after);
}
// A locked hidden member blocks consuming the complete group, but can be kept read-only.
setup();ui('objects[2].locked=true;updateUI()');assert.equal(get('subtractBtn').disabled,false);get('subtractBtn').onclick();assert.equal(get('applySubtractBtn').disabled,true);get('subtractKeepCutter').checked=true;ui('refreshObjectSubtractDialog()');assert.equal(get('applySubtractBtn').disabled,false);let before=state(),history=ui('undoStack.length'),pending=ui('runObjectSubtractFromUI()'),worker=ControlledWorker.instances.at(-1);worker.complete();await pending;assert.equal(ui('objects[2].locked'),true);assert.equal(ui('groups.length'),1);ui('undo()');assert.equal(state(),before);
ui(`(()=>{const source=captureGroupSubtractSource(objects[0].id,groups[0].id);try{applyPreparedGroupSubtract(source,{status:'empty',removedVolume:2000},false);}catch(error){if(!/locked/.test(errorMessage(error)))throw error;return;}throw Error('Consumption should be blocked.');})()`);assert.equal(state(),before);assert.equal(ui('undoStack.length'),history);
// Cancellation, stale snapshots and late/failed worker replies are atomic.
setup();get('subtractBtn').onclick();before=state();history=ui('undoStack.length');pending=ui('runObjectSubtractFromUI()');worker=ControlledWorker.instances.at(-1);let late=worker.onmessage;ui('cancelModelingOperation()');await pending;assert.equal(worker.terminated,true);late({data:{type:'object-subtract-result',result:{status:'empty',removedVolume:2000}}});assert.equal(state(),before);assert.equal(ui('undoStack.length'),history);
for(const change of ['modelRevision++','objects[1].transform.position[0]+=1','objects[1].solid=geometryApi.clone(objects[1].solid)','objects[2].hidden=false','groups[0].name="Changed"','groups[0].objectIds.reverse()','groups.splice(0,1)','objects[2].transform.position[0]+=1','objects[0].hidden=true','objects[0].transform.position[0]+=1','objects[0].locked=true']){
 setup();get('subtractBtn').onclick();pending=ui('runObjectSubtractFromUI()');worker=ControlledWorker.instances.at(-1);ui(change);before=state();history=ui('undoStack.length');worker.complete();await pending;assert.equal(state(),before,change);assert.equal(ui('undoStack.length'),history,change);
}
setup();get('subtractBtn').onclick();before=state();history=ui('undoStack.length');pending=ui('runObjectSubtractFromUI()');ControlledWorker.instances.at(-1).onerror({message:'Test group subtraction failure'});await pending;assert.equal(state(),before);assert.equal(ui('undoStack.length'),history);assert.equal(ui('modelingOperationBusy'),false);
// No overlap never consumes even hidden/disjoint group members.
setup();ui('for(const cutter of objects.slice(1))cutter.transform.position[0]+=100');get('subtractBtn').onclick();before=state();history=ui('undoStack.length');pending=ui('runObjectSubtractFromUI()');ControlledWorker.instances.at(-1).complete();await pending;assert.equal(state(),before);assert.equal(ui('undoStack.length'),history);
for(const keep of [false,true]){
 setup();ui('objects[1].solid=geometryApi.clone(objects[0].solid);objects[1].transform=structuredClone(objects[0].transform)');get('subtractBtn').onclick();get('subtractKeepCutter').checked=keep;before=state();pending=ui('runObjectSubtractFromUI()');ControlledWorker.instances.at(-1).complete();await pending;assert.equal(ui('objects.length'),keep?3:0);assert.equal(ui('groups.length'),keep?1:0);ui('undo()');assert.equal(state(),before);
}
// Capacity is net after consuming ALL members; additional pieces remain independently selected.
sandbox.splitRequest=cases[3][1];
const setupSplit=()=>{setup();ui('objects[0].solid=splitRequest.target;for(let i=0;i<2;i++)objects[i+1].solid=splitRequest.cutters[i].solid;while(objects.length<1000)objects.push(makeObject("box"));updateUI()');};
setupSplit();get('subtractBtn').onclick();get('subtractKeepCutter').checked=true;before=state();history=ui('undoStack.length');pending=ui('runObjectSubtractFromUI()');ControlledWorker.instances.at(-1).complete();await pending;assert.equal(state(),before);assert.equal(ui('undoStack.length'),history);assert.match(get('toast').textContent,/project limit/);
get('subtractBtn').onclick();pending=ui('runObjectSubtractFromUI()');ControlledWorker.instances.at(-1).complete();await pending;assert.equal(ui('objects.length'),999);assert.equal(ui('groups.length'),0);assert.equal(ui('selectedObjectIds().length'),3);assert.equal(ui('selectedObjectIds().map(id=>requireObject(id).color).every(c=>c==="#123456")'),true);for(const id of ui('selectedObjectIds()')){sandbox.id=id;assert.equal(ui('checkObjectSolid(requireObject(id).solid).status'),'passed');}ui('undo()');assert.equal(state(),before);
// Only a complete active group with one ungrouped extra is accepted.
setup();ui('setGroupSelection(groups[0]);updateUI()');assert.equal(get('subtractBtn').disabled,true);
ui('toggleObjectSelection(objects[0]);toggleObjectSelection(objects[3]);updateUI()');assert.equal(get('subtractBtn').disabled,false); // grouped click keeps the active group
ui('objects.push(makeObject("box"));toggleObjectSelection(objects.at(-1));updateUI()');assert.equal(get('subtractBtn').disabled,true);
setup();ui('setObjectSelection([objects[0].id,objects[1].id],objects[0].id);updateUI()');assert.equal(get('subtractBtn').disabled,true);
setup();ui('objects[0].locked=true;updateUI()');assert.equal(get('subtractBtn').disabled,true);
// Exercise the shipped worker on a separate thread and its termination path.
const real=createAppFixture(root,ModelingWorker),realUi=code=>vm.runInContext(code,real.sandbox);real.get('projectName').value=realUi('modelDocument.name');real.sandbox.request=cases[0][1];
try{
 const job=realUi('geometryApi.subtractGroupAsync(request)'),result=await job.promise;assert.equal(result.status,'changed');assert.equal(ModelingWorker.instances.at(-1).terminated,true);assert.ok(ModelingWorker.instances.at(-1).messages.some(message=>message.type==='progress'));
 const cancelled=realUi('geometryApi.subtractGroupAsync(request)');cancelled.cancel();await assert.rejects(cancelled.promise,/cancelled/);assert.equal(ModelingWorker.instances.at(-1).terminated,true);
}finally{await ModelingWorker.closeAll();}
const html=fs.readFileSync(resolve(root,'dist/LamjaCraft-3D.html'),'utf8');assert.match(html,/id="subtractGroupMembers"/);assert.match(html,/select one ungrouped target first/);assert.match(html,/including hidden members/);
console.log('R235 group subtraction passed: disconnected/overlapping cutters, 100-member stress, cavities/splits/transforms, all-member validation and source integrity, closed export/native solids, complete hidden/disjoint membership, locks/Keep, dimensions/capacity, safe direction, real worker/Cancel/stale/errors, exact one-command Undo/Redo and selection guards.');
