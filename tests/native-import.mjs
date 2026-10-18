import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..');
let workers=0;
class UnexpectedWorker{constructor(){workers++;throw Error('Native import must use the native reader, not mesh conversion');}}
const {sandbox,get}=createAppFixture(root,UnexpectedWorker),run=code=>vm.runInContext(code,sandbox),plain=value=>JSON.parse(JSON.stringify(value)),state=()=>run('JSON.stringify(projectData())'),history=()=>run('undoStack.length');
run("addObject('box');createBuildPlate();groups.push({id:'grp1',name:'Existing group',objectIds:objects.map(o=>o.id)});guides.push({id:'g1',kind:'point',point:[30,40,0]});dimensions.push({id:'d1',kind:'linear',a:{kind:'world',point:[0,0,0]},b:{kind:'world',point:[10,0,0]}})");get('projectName').value='Keep this project';
const source=plain(run('photoAiExample()'));source.name='Imported source';
source.objects[0].name='Hidden part';source.objects[0].hidden=true;source.objects[0].color='#993366';
source.objects.push({...structuredClone(source.objects[0]),id:'o2',name:'Visible part',hidden:false,color:'#336699',transform:{position:[15,-20,7],rotation:[.2,-.3,.4]}});source.objects[1].solid.id='s_o2';
source.groups=[{id:'grp1',name:'Source group',objectIds:['o1','o2']}];
source.construction.guides=[{id:'g1',kind:'point',point:[3,4,0],label:'Source guide'},{id:'g2',kind:'line',point:[0,0,0],direction:[1,0,0]},{id:'g3',kind:'circle',center:[10,20,0],normal:[0,0,1],radius:5}];
source.annotations.dimensions=[{id:'d1',kind:'linear',a:{kind:'vertex',objectId:'o2',vertexId:'v1',fallback:[15,-20,7]},b:{kind:'vertex',objectId:'external-object',vertexId:'v1',fallback:[30,40,5]},label:'Source dimension'}];
source.references={buildPlates:[{id:'bp1',name:'Imported bed',width:256,depth:180,x:-200,y:30,color:'#336699',opacity:.4,visible:false}]};
const file=(value,name='part.lamjacraft.json')=>{const text=typeof value==='string'?value:JSON.stringify(value);return {name,size:Buffer.byteLength(text),text:async()=>text};};
const select=async(value,name)=>{sandbox.files=[file(value,name)];await run('selectImportFiles(files)');};
const check=async()=>{await run('checkPendingImport()');};
const original=state(),initialHistory=history(),sourceBefore=JSON.stringify(source);
get('importUnits').value='m';get('importScale').value='0';get('importRepair').checked=true;
await select(source);assert.equal(get('importDialog').open,true);assert.equal(get('meshImportSettings').classList.contains('hidden'),true);assert.equal(get('nativeImportNote').classList.contains('hidden'),false);assert.equal(get('checkImport').textContent,'Check project');assert.equal(get('commitImport').textContent,'Import project');assert.equal(get('commitImport').disabled,true);
await check();assert.equal(state(),original);assert.equal(history(),initialHistory);assert.equal(workers,0);assert.equal(get('commitImport').disabled,false);assert.match(get('importSummary').textContent,/2 objects.*1 groups.*3 guides.*1 dimensions.*1 build plates/);
run('commitCheckedImport()');assert.equal(history(),initialHistory+1);assert.equal(run('lastCommandEntry().type'),'import-project');assert.equal(get('projectName').value,'Keep this project');assert.equal(get('importDialog').open,false);assert.equal(run('dirty'),true);
const added=plain(run('projectData()')),originalData=JSON.parse(original),parts=added.objects.slice(originalData.objects.length);
assert.equal(parts.length,2);assert.deepEqual(added.objects.slice(0,originalData.objects.length),originalData.objects);assert.deepEqual(added.groups.slice(0,1),originalData.groups);assert.deepEqual(added.references.buildPlates.slice(0,1),originalData.references.buildPlates);
for(const [i,part] of parts.entries()){
 assert.notEqual(part.id,source.objects[i].id);assert.equal(part.name,source.objects[i].name);assert.equal(part.color,source.objects[i].color);assert.equal(!!part.hidden,!!source.objects[i].hidden);
 for(const field of ['position','rotation'])part.transform[field].forEach((n,j)=>assert.ok(Math.abs(n-source.objects[i].transform[field][j])<1e-12));
 assert.deepEqual(part.solid.vertices,source.objects[i].solid.vertices);assert.deepEqual(part.solid.faces,source.objects[i].solid.faces);
 sandbox.id=part.id;assert.equal(run('geometryApi.validate(requireObject(id).solid,false).ok'),true);
}
assert.deepEqual(added.groups.at(-1).objectIds,parts.map(p=>p.id));assert.notEqual(added.groups.at(-1).id,'grp1');assert.equal(run('selectedGroup().name'),'Source group');
assert.equal(added.annotations.dimensions.at(-1).a.objectId,parts[1].id);assert.deepEqual(added.annotations.dimensions.at(-1).b,{kind:'world',point:[30,40,5]});
assert.deepEqual(added.construction.guides.slice(originalData.construction.guides.length).map(g=>g.kind),['point','line','circle']);
const bed=added.references.buildPlates.at(-1);assert.notEqual(bed.id,'bp1');assert.deepEqual({...bed,id:'bp1'},source.references.buildPlates[0]);
for(const items of [added.objects,added.groups,added.construction.guides,added.annotations.dimensions,added.references.buildPlates])assert.equal(new Set(items.map(x=>x.id)).size,items.length);
assert.equal(JSON.stringify(source),sourceBefore);const merged=state();run('undo()');assert.equal(state(),original);run('redo()');assert.equal(state(),merged);sandbox.merged=JSON.parse(merged);run('loadProject(merged)');assert.equal(state(),merged);run('undo()');run('undo()');assert.equal(state(),original);
// Reference-only projects append and keep the model selection and camera.
const references={...structuredClone(source),objects:[],groups:[],construction:{guides:[]},annotations:{dimensions:[]}};
const selection=run('JSON.stringify(modelDocument.selection)'),referenceCamera=run('JSON.stringify(camera)'),referenceHistory=history();await select(references);await check();run('commitCheckedImport()');assert.equal(history(),referenceHistory+1);assert.equal(run('JSON.stringify(modelDocument.selection)'),selection);assert.equal(run('objects.length'),originalData.objects.length);assert.equal(run('JSON.stringify(camera)'),referenceCamera);assert.equal(run('buildPlates.length'),2);run('undo()');assert.equal(state(),original);
// Import accepts only the current project identity, even with a generic JSON filename.
for(const format of ['doodlelab-3d','formverk']){await select({...source,format},'renamed.json');await check();assert.equal(get('commitImport').disabled,true);assert.match(get('importError').textContent,/Import requires a LamjaCraft 3D project/);assert.equal(state(),original);assert.equal(history(),initialHistory);get('cancelImport').onclick();}
// Invalid topology/references, stale data and capacity never partially commit.
for(const bad of ['{broken',{...source,version:6},{...source,objects:[source.objects[0],source.objects[0]]},{...source,construction:{guides:[{id:'g1',kind:'point',point:['bad',0,0]}]}},{...source,objects:[],groups:[],construction:{guides:[]},annotations:{dimensions:[]},references:undefined}]){
 await select(bad);await check();assert.equal(get('commitImport').disabled,true);assert.ok(get('importError').textContent);assert.equal(state(),original);
}
let reads=0;sandbox.files=[{name:'huge.json',size:run('PROJECT_READ_POLICY.maximumFileBytes')+1,text:async()=>{reads++;throw Error('Must reject size before read');}}];await run('selectImportFiles(files)');assert.equal(reads,0);assert.equal(run('importSource'),null);assert.equal(get('checkImport').disabled,true);
sandbox.files=[file(source),{name:'other.obj',size:0,arrayBuffer:async()=>{reads++;}}];await run('selectImportFiles(files)');assert.equal(reads,0);assert.equal(run('importSource'),null);assert.equal(state(),original);
let finishRead;sandbox.files=[{name:'slow.json',size:1,text:()=>new Promise(resolve=>{finishRead=resolve;})}];let reading=run('selectImportFiles(files)');get('cancelImport').onclick();finishRead(JSON.stringify(source));await reading;assert.equal(run('importSource'),null);assert.equal(get('importDialog').open,false);
sandbox.files=[{name:'slow.json',size:1,text:()=>new Promise(resolve=>{finishRead=resolve;})}];reading=run('selectImportFiles(files)');await select(source,'new.json');finishRead('{broken');await reading;assert.equal(run('importSource.name'),'new.json');await check();assert.equal(get('commitImport').disabled,false);
run('modelRevision++');run('commitCheckedImport()');assert.equal(state(),original);assert.equal(get('commitImport').disabled,true);assert.match(get('importError').textContent,/changed/);
await select(source);const checking=run('checkPendingImport()');run('cancelModelingOperation()');await checking;assert.equal(run('modelingOperationBusy'),false);assert.equal(get('commitImport').disabled,true);assert.match(get('importSummary').textContent,/cancelled/);assert.equal(state(),original);
sandbox.plateTemplate=source.references.buildPlates[0];run("replaceBuildPlates(Array.from({length:128},(_,i)=>({...plateTemplate,id:'existing'+i})))");const atCapacity=state();await select(source);await check();assert.equal(get('commitImport').disabled,true);assert.match(get('importError').textContent,/limit of 128 build plates/);assert.equal(state(),atCapacity);run('replaceBuildPlates([])');
// A pending preview must be restored before plate/model history capture.
get('cancelImport').onclick();run("setTool('move');setAxis('x');moveToolController.numericSeed()");const committed=state();run('previewMoveDistance(10)');assert.notEqual(state(),committed);await select(source);assert.equal(state(),committed);assert.equal(run('pointer'),null);assert.equal(run('tool'),'move');await check();run('commitCheckedImport();undo()');assert.equal(state(),committed);
sandbox.source=source;run('loadProject(source)');assert.equal(run('objects.length'),2);assert.equal(get('projectName').value,'Imported source');assert.equal(run('buildPlates.length'),1);
const html=fs.readFileSync(resolve(root,'dist/LamjaCraft-3D.html'),'utf8');assert.match(html,/Import adds contents; Open replaces the project/);assert.match(html,/id="meshImportSettings"/);
console.log('R204 native import passed: read/check/append, fresh IDs and group/anchor remapping, name/content/mm/visibility preservation, guides/dimensions/build plates, exact Undo/Redo/reopen, reference-only selection/camera, current format only, validation/size/mixed files, read/cancel/stale/capacity guards, preview teardown and Open replacement.');
