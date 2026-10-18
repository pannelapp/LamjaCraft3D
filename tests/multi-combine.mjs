import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
import {ModelingWorker} from './modeling-worker-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),workerCode=fs.readFileSync(resolve(root,'build/modeling-worker-bundle.js'),'utf8');
const kernel={console,performance,structuredClone,TextEncoder,TextDecoder,postMessage:()=>{}};vm.createContext(kernel);vm.runInContext(workerCode,kernel);const geometry=code=>vm.runInContext(code,kernel);
geometry(`const identity={position:[0,0,0],rotation:[0,0,0]},box=(x,w=10)=>({solid:primitivePrism([[x,0],[x+w,0],[x+w,10],[x,10]],10),transform:identity}),bridgeInputs=[box(0),box(20),box(8,14)];`);
function check(result,volume,label){assert.equal(result.ok,true,label+': '+result.message);kernel.solid=result.solid;assert.equal(geometry('checkObjectSolid(solid).status'),'passed',label);assert.ok(Math.abs(geometry('validateSolid(solid,false).volume')-volume)<1e-5,label+' volume');assert.equal(geometry('splitConnectedSolidShells(solid).length'),1);const edges=geometry('triangleMeshEdgeStats(solidMeshExportLocal(solid))');assert.equal(edges.boundary,0);assert.equal(edges.nonManifold,0);assert.equal(geometry('checkObjectSolid(deserializeSolid(serializeSolid(solid))).status'),'passed');}
for(const order of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]){
 kernel.order=order;const before=geometry('JSON.stringify(bridgeInputs.map(input=>[serializeSolid(input.solid),input.transform]))');check(geometry(`unionManySolids({type:'object-union',inputs:order.map(i=>bridgeInputs[i])})`),3000,'bridge-last/order');assert.equal(geometry('JSON.stringify(bridgeInputs.map(input=>[serializeSolid(input.solid),input.transform]))'),before);
}
check(geometry(`(()=>{const common={position:[234,-87,11],rotation:[21,33,47]};return unionManySolids({type:'object-union',inputs:bridgeInputs.map(input=>({...input,transform:common}))});})()`),3000,'common rigid frame');
check(geometry(`unionManySolids({type:'object-union',inputs:Array.from({length:32},(_,i)=>box(i*5))})`),16500,'32 overlapping objects');
check(geometry(`unionManySolids({type:'object-union',inputs:[box(0),box(0),box(10)]})`),2000,'duplicate coverage / full face contact');
for(const inputs of ['[box(0),box(30)]','[box(0),{...box(0),transform:{position:[10,10,0],rotation:[0,0,0]}}]','[box(0),{...box(0),transform:{position:[10,10,10],rotation:[0,0,0]}}]'])assert.equal(geometry(`unionManySolids({type:'object-union',inputs:${inputs}}).ok`),false,'disconnected/edge/point contact');
for(const bad of ['inputs[2].solid.faces.clear()','inputs[2].transform.position[0]=NaN']){kernel.bad=bad;assert.equal(geometry(`(()=>{const inputs=structuredClone(bridgeInputs);${bad};return unionManySolids({type:'object-union',inputs}).ok;})()`),false,'complete preflight');}
check(geometry(`(()=>{const outer=box(0),inner=primitivePrism([[4,4],[6,4],[6,6],[4,6]],2),cut=subtractSolids({type:'object-subtract',target:outer.solid,targetTransform:identity,cutter:inner,cutterTransform:{position:[0,0,4],rotation:[0,0,0]}});if(cut.status!=='changed')throw Error('Cavity setup failed');return unionManySolids({type:'object-union',inputs:[{solid:cut.solids[0],transform:identity},{solid:primitivePrism([[8,3],[12,3],[12,7],[8,7]],4),transform:{position:[0,0,3],rotation:[0,0,0]}}]});})()`),1024,'retained sealed cavity');assert.equal(geometry('solidShellCount(solid)'),2);
// Actual Float32 output has paired, oppositely directed edges.
const bytes=geometry("prepareBinarySTL([{id:'union',name:'Union',solid,transform:identity}])"),view=new DataView(bytes),edges=new Map();
for(let i=0;i<view.getUint32(80,true);i++){const points=Array.from({length:3},(_,j)=>[0,1,2].map(axis=>view.getFloat32(84+i*50+12+j*12+axis*4,true)).join(','));assert.equal(new Set(points).size,3);for(let j=0;j<3;j++){const a=points[j],b=points[(j+1)%3],key=a<b?a+'|'+b:b+'|'+a,row=edges.get(key)||[0,0];row[0]++;row[1]+=a<b?1:-1;edges.set(key,row);}}for(const row of edges.values())assert.deepEqual(row,[2,0]);
class ControlledWorker{
 static instances=[];constructor(){this.onmessage=null;this.onerror=null;this.terminated=false;ControlledWorker.instances.push(this);}postMessage(request){this.request=structuredClone(request);}terminate(){this.terminated=true;}
 complete(){const context={console,performance,structuredClone,TextEncoder,TextDecoder,postMessage:data=>this.onmessage?.({data})};vm.createContext(context);vm.runInContext(workerCode,context);context.onmessage({data:this.request});}
}
const {sandbox,get}=createAppFixture(root,ControlledWorker),run=code=>vm.runInContext(code,sandbox);get('projectName').value=run('modelDocument.name');
const setup=(mode='group')=>{sandbox.mode=mode;return run(`(()=>{
 replaceObjects([]);replaceGroups([]);replaceDimensions([]);const specs=[[0,10],[20,10],[8,14],[28,10]];
 for(const [i,[x,w]] of specs.entries()){const object=makeObject('box');object.name='Input '+i;object.color=i===0?'#123456':'#abcdef';object.solid=geometryApi.createPrism([[x,0],[x+w,0],[x+w,10],[x,10]],10);objects.push(object);}
 if(mode==='plain'){selectObject(objects[0]);toggleObjectSelection(objects[1]);toggleObjectSelection(objects[2]);}
 else{objects[1].hidden=true;const group={id:'combine-group',name:'Assembly',objectIds:[objects[1].id,objects[0].id,objects[2].id,...(mode==='partial'?[objects[3].id]:[])]};groups.push(group);if(mode==='partial')setObjectSelection([objects[0].id,objects[2].id],objects[0].id,true,false);else{setGroupSelection(group);if(mode==='extra')toggleObjectSelection(objects[3]);}}
 dimensions.push({id:'combine-dimension',kind:'linear',a:{kind:'vertex',objectId:objects[0].id,vertexId:[...objects[0].solid.vertices.keys()][0],fallback:[0,0,0]},b:{kind:'vertex',objectId:objects[1].id,vertexId:[...objects[1].solid.vertices.keys()][0],fallback:[20,0,0]}});updateUI();return objects.map(object=>object.id);
})()`);};
const state=()=>run('JSON.stringify(projectData())');
for(const mode of ['plain','group','extra','partial']){
 const ids=setup(mode),before=state(),history=run('undoStack.length');assert.equal(get('combineBtn').disabled,false);const pending=run('runObjectCombineFromUI()'),worker=ControlledWorker.instances.at(-1);assert.equal(worker.request.type,'object-union');assert.equal(worker.request.inputs.length,mode==='extra'?4:mode==='partial'?2:3);assert.equal(state(),before);worker.complete();await pending;
 assert.equal(worker.terminated,true);assert.equal(run('undoStack.length'),history+1);assert.equal(run('lastCommandEntry().type'),'combine-objects');assert.equal(run('current().id'),ids[0]);assert.equal(run('current().color'),'#123456');assert.equal(run('current().name'),'Input 0');assert.equal(run('groupForObjectId(current().id)'),null);assert.equal(run('objects.length'),mode==='extra'?1:mode==='partial'?3:2);assert.equal(run('groups.length'),mode==='partial'?1:0);
 assert.equal(run('dimensions[0].a.kind'),'world');assert.equal(run('dimensions[0].b.kind'),mode==='partial'?'vertex':'world');kernel.solid=run('current().solid');check({ok:true,solid:kernel.solid},mode==='extra'?3800:mode==='partial'?2200:3000,mode);assert.equal(run('validateProject(projectData()).objects.length'),run('objects.length'));const after=state();run('undo()');assert.equal(state(),before);run('redo()');assert.equal(state(),after);
}
setup();run('objects[1].locked=true;updateUI()');assert.equal(get('combineBtn').disabled,true);let before=state(),count=ControlledWorker.instances.length;await run('runObjectCombineFromUI()');assert.equal(state(),before);assert.equal(ControlledWorker.instances.length,count,'hidden lock must block before worker');
setup();before=state();let history=run('undoStack.length'),pending=run('runObjectCombineFromUI()'),worker=ControlledWorker.instances.at(-1),late=worker.onmessage;run('cancelModelingOperation()');await pending;late({data:{type:'object-union-result',result:{ok:false,reason:'disconnected',message:'late'}}});assert.equal(state(),before);assert.equal(run('undoStack.length'),history);assert.equal(worker.terminated,true);
for(const change of ['modelRevision++','objects[2].transform.position[0]+=1','objects[1].hidden=false','groups[0].objectIds.reverse()','groups[0].name="Changed"','objects[0].solid=geometryApi.clone(objects[0].solid)','clearSelection()','objects[1].locked=true']){
 setup();pending=run('runObjectCombineFromUI()');worker=ControlledWorker.instances.at(-1);run(change);before=state();history=run('undoStack.length');worker.complete();await pending;assert.equal(state(),before,change);assert.equal(run('undoStack.length'),history,change);
}
setup();run('objects[2].transform.position=[100,0,0]');before=state();history=run('undoStack.length');pending=run('runObjectCombineFromUI()');ControlledWorker.instances.at(-1).complete();await pending;assert.equal(state(),before);assert.equal(run('undoStack.length'),history);
setup();before=state();pending=run('runObjectCombineFromUI()');ControlledWorker.instances.at(-1).onerror({message:'Test Combine worker failure'});await pending;assert.equal(state(),before);assert.equal(run('modelingOperationBusy'),false);
// The actual embedded worker/controller performs the same atomic commit.
const real=createAppFixture(root,ModelingWorker),realRun=code=>vm.runInContext(code,real.sandbox);real.get('projectName').value=realRun('modelDocument.name');real.sandbox.inputs=geometry('bridgeInputs');
try{
 realRun(`replaceObjects([]);replaceGroups([]);for(const [i,input] of inputs.entries()){const object=makeObject('box');object.solid=input.solid;object.transform=input.transform;objects.push(object);}groups.push({id:'real-combine',name:'Assembly',objectIds:objects.map(object=>object.id)});setGroupSelection(groups[0]);`);
 const before=realRun('JSON.stringify(projectData())'),history=realRun('undoStack.length');pending=realRun('runObjectCombineFromUI()');assert.equal(realRun('JSON.stringify(projectData())'),before);await pending;assert.equal(realRun('objects.length'),1);assert.equal(realRun('groups.length'),0);assert.equal(realRun('undoStack.length'),history+1);assert.equal(ModelingWorker.instances.at(-1).terminated,true);assert.ok(ModelingWorker.instances.at(-1).messages.some(message=>message.type==='progress'));realRun('undo()');assert.equal(realRun('JSON.stringify(projectData())'),before);
 const cancelled=realRun('runObjectCombineFromUI()');realRun('cancelModelingOperation()');await cancelled;assert.equal(realRun('JSON.stringify(projectData())'),before);
}finally{await ModelingWorker.closeAll();}
console.log('R238 multi-object Combine passed: arbitrary bridge order, 32-input stress, transforms/coverage/face-contact/cavity, complete preflight and immutable inputs, closed Float32 STL/native, groups/hidden/extras/exact partial members, identity/dimensions/one-command Undo/Redo, locks/cancel/stale/failure and actual worker/controller.');
