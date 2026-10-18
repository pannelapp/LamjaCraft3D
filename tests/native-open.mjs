import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {Worker as ThreadWorker} from 'node:worker_threads';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),workerSource=fs.readFileSync(resolve(root,'build/native-open-worker.js'),'utf8');
let created=0,terminated=0,requested=0,afterTerminate=0;
class OpenWorker {
 constructor(){
  created++;this.dead=false;
  this.worker=new ThreadWorker(`const {parentPort}=require('node:worker_threads');globalThis.postMessage=message=>parentPort.postMessage(message);${workerSource}\nparentPort.on('message',data=>globalThis.onmessage({data}));`,{eval:true});
  this.worker.on('message',data=>{if(this.dead){afterTerminate++;return;}this.onmessage?.({data});});
  this.worker.on('error',error=>this.onerror?.({message:error.message,preventDefault(){}}));
 }
 postMessage(data){requested++;this.worker.postMessage(data);}
 terminate(){if(this.dead)return;this.dead=true;terminated++;void this.worker.terminate();}
}
const fixture=(WorkerClass=OpenWorker)=>{
 const {sandbox,get}=createAppFixture(root,WorkerClass,{Map,Set}),run=code=>vm.runInContext(code,sandbox);
 get('viewStyle').value='presentation';const stages=[],original=sandbox.document.getElementById;
 // Observe real progress writes without replacing the opening/validation pipeline.
 const el=get('modelingBusyText');let status='';Object.defineProperty(el,'textContent',{get:()=>status,set:value=>{status=value;stages.push({message:value,progress:get('modelingBusyProgress').value});sandbox.nativeOpenStatusHook?.(value);}});
 return {sandbox,get,run,stages,state:()=>run('JSON.stringify(projectData())'),open:async(value,name='model.lamjacraft.json')=>{sandbox.file=new File([typeof value==='string'?value:JSON.stringify(value)],name,{type:'application/json'});await run('openNativeProjectFile(file)');}};
};
const f=fixture(),{run,get,sandbox,open,state,stages}=f;
run("addObject('box');setTool('move')");get('projectName').value='Keep this project';const original=state(),history=run('undoStack.length');
const source=JSON.parse(run('JSON.stringify(photoAiExample())'));source.name='Progress test';source.version=10;source.objects[0].shininess=75;
source.objects.push({...structuredClone(source.objects[0]),id:'o2',name:'Hidden member',hidden:true,locked:true,transform:{position:[40,20,-5],rotation:[.2,.3,.4]}});source.objects[1].solid.id='s_o2';source.groups=[{id:'grp9',name:'Test group',objectIds:['o1','o2']}];
source.construction.guides=[{id:'g1',kind:'circle',center:[1,2,3],normal:[0,0,1],radius:4}];source.annotations={dimensions:[{id:'d1',kind:'linear',a:{kind:'vertex',objectId:'o1',vertexId:'v1',fallback:[0,0,0]},b:{kind:'world',point:[2,3,4]}}]};source.references={buildPlates:[{id:'bp1',name:'Bed',width:220,depth:220,x:0,y:0,opacity:.35,color:'#336699',visible:true}]};

const sheet=structuredClone(source.objects[0]);sheet.id='o3';sheet.name='Open sheet';sheet.kind='surface';sheet.solid.id='s_o3';sheet.solid.faces=sheet.solid.faces.slice(0,1);const sheetVertices=new Set(sheet.solid.faces[0].outer);sheet.solid.vertices=sheet.solid.vertices.filter(v=>sheetVertices.has(v.id));source.objects.push(sheet);
sandbox.source=source;const expected=run("JSON.stringify((()=>{const p=validateProject(source);return {...source,objects:p.objects.map(serializeProjectObject),construction:{guides:p.guides.map(serializeGuide)},annotations:{dimensions:p.dimensions.map(serializeDimension)}};})())");
const sourceText=JSON.stringify(source);let ticks=0,ticker=setInterval(()=>ticks++,1);await open(source);clearInterval(ticker);
assert.equal(get('toast').textContent,'Project opened.');assert.equal(run('modelingOperationBusy'),false);assert.equal(run('nativeOpenRenderSuspended'),false);assert.equal(get('modelingBusyProgress').value,100);assert.equal(run('tool'),'select');assert.equal(run('dirty'),false);assert.equal(run('undoStack.length'),history+1);assert.equal(run('lastCommandEntry().type'),'load-project');assert.equal(run('selectedGroup().id'),'grp9');assert.equal(run('expandedObjectGroups.size'),0);
assert.deepEqual(JSON.parse(state()),JSON.parse(expected));assert.equal(JSON.stringify(source),sourceText);assert.ok(ticks>5,'Input/event-loop work must run while the file opens');
for(const phrase of ['Reading project file','Reading project structure','Checking geometry','Preparing display','Checking groups','Preparing Undo','Opening the checked project','Preparing the first view','Project ready'])assert.ok(stages.some(x=>x.message.includes(phrase)),phrase);
const progress=stages.map(x=>Number(x.progress)||0);assert.ok(progress.every((p,i)=>i===0||p>=progress[i-1]),'Progress must not go backward');
assert.equal(created,1);assert.equal(terminated,1);assert.equal(requested,4,'Request exactly one object at a time');
// No re-triangulation or appearance derivation after the prepared scene is installed.
const opened=state();run("const savedLocalMesh=solidMeshLocal,savedAppearance=deriveSceneAppearance;solidMeshLocal=()=>{throw Error('Mesh rebuilt on first display');};deriveSceneAppearance=()=>{throw Error('Appearance rebuilt on first display');};ensureScene();solidMeshLocal=savedLocalMesh;deriveSceneAppearance=savedAppearance;");
run('undo()');assert.equal(state(),original);run('redo()');assert.equal(state(),opened);
// Rejection and cancellation preserve committed data, history and dirty state.
for(const bad of ['{broken',{...source,objects:[source.objects[0],source.objects[0]]},{...source,groups:[{id:'grp1',name:'Bad',objectIds:['o1','missing']}]},{...source,version:9},{...source,objects:[{...source.objects[0],solid:{...source.objects[0].solid,faces:[]}}]}]){
 const before=state(),h=run('undoStack.length');await open(bad);assert.equal(state(),before);assert.equal(run('undoStack.length'),h);assert.match(get('toast').textContent,/Could not open/);assert.equal(run('modelingOperationBusy'),false);
}
const beforeCancel=state(),cancelHistory=run('undoStack.length');sandbox.file=new File([sourceText],'cancel.json');const pending=run('openNativeProjectFile(file)');run('cancelModelingOperation()');await pending;assert.equal(state(),beforeCancel);assert.equal(run('undoStack.length'),cancelHistory);assert.match(get('toast').textContent,/cancelled.*kept/);
// Cancel during heavy worker geometry and reject an externally stale revision.
class PausedWorker extends OpenWorker {postMessage(data){super.postMessage(data);if(data.type==='next')setTimeout(()=>c.run('cancelModelingOperation()'),0);}}
const c=fixture(PausedWorker);c.run("addObject('box')");const old=c.state();await c.open(source);assert.equal(c.state(),old);assert.match(c.get('toast').textContent,/cancelled/);
class StaleWorker extends OpenWorker {postMessage(data){super.postMessage(data);if(data.type==='next')setTimeout(()=>s.run('modelRevision++'),0);}}
const s=fixture(StaleWorker);s.run("addObject('box')");const stale=s.state();await s.open(source);assert.equal(s.state(),stale);assert.match(s.get('toast').textContent,/project changed/);
const fallback=fixture(undefined);delete fallback.sandbox.Worker;await fallback.open(source);assert.deepEqual(JSON.parse(fallback.state()),JSON.parse(opened));
// All native generations, legacy identities, curved guides and empty/reference-only documents use the same reader.
const matte=structuredClone(source);matte.version=7;matte.objects=matte.objects.filter(o=>o.kind==='solid');for(const object of matte.objects)delete object.shininess;
for(const format of ['lamjacraft-3d','doodlelab-3d','formverk']){await fallback.open({...matte,format});assert.equal(fallback.get('toast').textContent,'Project opened.');assert.equal(fallback.run('nativeProjectVersion()'),7);}
const curved=JSON.parse(fs.readFileSync(resolve(root,'examples/curved-split-surface.lamjacraft.json'),'utf8'));await fallback.open(curved);assert.equal(fallback.get('toast').textContent,'Project opened.');assert.equal(fallback.run('nativeProjectVersion()'),8);
const surface=structuredClone(source);surface.version=9;for(const object of surface.objects)delete object.shininess;await fallback.open(surface);assert.equal(fallback.get('toast').textContent,'Project opened.');assert.equal(fallback.run('nativeProjectVersion()'),9);
const references={...matte,objects:[],groups:[],construction:{guides:[]},annotations:{dimensions:[]}};await open(references);assert.equal(run('objects.length'),0);assert.equal(run('buildPlates.length'),1);assert.equal(run('modelDocument.selection'),null);
await open(source);const preparingHistory=state(),preparingHistoryCount=run('undoStack.length');sandbox.nativeOpenStatusHook=message=>{if(message.startsWith('Preparing Undo'))run('cancelModelingOperation()');};await open(matte);delete sandbox.nativeOpenStatusHook;assert.equal(state(),preparingHistory);assert.equal(run('undoStack.length'),preparingHistoryCount);assert.match(get('toast').textContent,/cancelled/);
// Guard size, existing busy operations, and declined replacement before any read.
let reads=0;sandbox.file={size:run('PROJECT_READ_POLICY.maximumFileBytes')+1,text:async()=>{reads++;return sourceText;}};await run('openNativeProjectFile(file)');assert.equal(reads,0);
run('modelingOperationBusy=true');sandbox.file={size:1,text:async()=>{reads++;return sourceText;}};await run('openNativeProjectFile(file)');assert.equal(reads,0);run('modelingOperationBusy=false;setDirtyState(true)');sandbox.confirm=()=>false;await run('openNativeProjectFile(file)');assert.equal(reads,0);sandbox.confirm=()=>true;
assert.equal(created,terminated);assert.equal(afterTerminate,0);
console.log('R251 native Open passed: actual isolated reader worker, staged geometry/display/history, monotonic progress, live event loop, backpressure, exact grouped/hidden/locked/glossy/reference round-trip, one Undo/Redo, collapsed groups, reused mesh/appearance, invalid/stale/size/busy/decline/cancel guards, cooperative compatibility path, worker cleanup.');
export {fixture};
