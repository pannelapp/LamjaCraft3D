import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),workerCode=fs.readFileSync(resolve(root,'build/edge-feature-worker.js'),'utf8'),encoder=new TextEncoder();
const kernel={console,performance,structuredClone,TextDecoder,TextEncoder,postMessage(){}};vm.createContext(kernel);vm.runInContext(workerCode,kernel);
const geometry=vm.runInContext(`(()=>{
 const box=primitivePrism([[0,0],[2,0],[2,2],[0,2]],2,'obj-cube'),concave=primitivePrism([[0,0],[8,0],[8,3],[3,3],[3,8],[0,8]],4,'obj-concave'),outer=primitivePrism([[-10,-10],[10,-10],[10,10],[-10,10]],20,'outer'),inner=primitivePrism([[-3,-3],[3,-3],[3,3],[-3,3]],6,'inner'),cavity=csgToSolid(csgSubtract(solidToCsg(outer),csgPolygonsInReference(inner,{position:[0,0,5],rotation:[0,0,0]},{position:[0,0,0],rotation:[0,0,0]})),'obj-cavity');
 const polygon=s=>{const vertices=[...s.vertices.values()],index=new Map(vertices.map((v,i)=>[v.id,i+1]));return {vertices:vertices.map(v=>v.position),faces:[...s.faces.values()].map(f=>loopVertexIds(s,f.outerLoop).map(id=>index.get(id)))};};
 const mesh=solidMeshLocal(cavity);return {box:polygon(box),concave:polygon(concave),cavity:{vertices:mesh.vertices,faces:mesh.triangles.map(t=>t.map(i=>i+1))},cavityVolume:validateSolid(cavity,false).volume};
})()`,kernel);
const obj=(shape,name='Cube',negative=false,slash='')=>'mtllib palette.mtl\no '+name+'\nusemtl red\n'+shape.vertices.map(p=>'v '+p.join(' ')).join('\n')+'\nvt 0 0\nvn 0 0 1\n'+shape.faces.map(f=>'f '+f.map(i=>(negative?i-shape.vertices.length-1:i)+slash).join(' ')).join('\n')+'\n';
const cube=obj(geometry.box,'Cube Ø'),mtl='newmtl red\nKd 0.8 0.2 0.1\n';
const request=(text,scale=1,extras={})=>({type:'mesh-import',format:'obj',name:'Import',buffer:encoder.encode(text).buffer,materials:[{name:'palette.mtl',text:mtl}],scale,repairOpenings:false,...extras});
const prepare=req=>{kernel.request=req;return vm.runInContext('prepareMeshImport(request)',kernel);};
const volume=solid=>{kernel.solid=solid;return vm.runInContext('validateSolid(solid,false).volume',kernel);};
for(const slash of ['', '/-1', '//-1','/-1/-1']){const result=prepare(request(obj(geometry.box,'Quad cube',true,slash)));assert.equal(result.items.length,1);assert.equal(result.items[0].solid.faces.size,6);assert.ok([...result.items[0].solid.faces.values()].every(face=>face.provenance.label==='OBJ'));assert.equal(result.items[0].color,'#cc331a');assert.ok(Math.abs(volume(result.items[0].solid)-8)<1e-8);}
const spaced=prepare(request(cube.replace('palette.mtl','palette space.mtl'),1,{materials:[{name:'palette space.mtl',text:mtl}]}));assert.equal(spaced.items[0].color,'#cc331a');
assert.equal(prepare(request(cube.replace('o Cube Ø','o Import\ng Subgroup'))).items[0].name,'Import');
const concave=prepare(request(obj(geometry.concave)));assert.ok(Math.abs(volume(concave.items[0].solid)-156)<1e-6);
const cavity=prepare(request(obj(geometry.cavity,'Cavity')));assert.equal(cavity.items.length,1);assert.ok(Math.abs(volume(cavity.items[0].solid)-geometry.cavityVolume)<1e-5,'Nested cavity was filled or imported as another solid');
for(const scale of [1000,25.4,.1]){const result=prepare(request(cube,scale));assert.ok(Math.abs(volume(result.items[0].solid)/(8*scale**3)-1)<1e-8,'Import scale changed volume incorrectly');}
const second={vertices:geometry.box.vertices.map(p=>[p[0]+10,p[1],p[2]]),faces:geometry.box.faces.map(f=>f.map(i=>i+geometry.box.vertices.length))};
const multi=cube+'o Second\n'+second.vertices.map(p=>'v '+p.join(' ')).join('\n')+'\n'+second.faces.map(f=>'f '+f.join(' ')).join('\n');assert.equal(prepare(request(multi)).items.length,2);
const open=obj({...geometry.box,faces:geometry.box.faces.slice(1)});const limited=prepare(request(open));assert.equal(limited.items.length,1);assert.equal(limited.items[0].kind,'surface');assert.equal(limited.items[0].solid.faces.size,5);assert.equal(limited.repairedOpenings,0);const repaired=prepare(request(open,1,{repairOpenings:true}));assert.equal(repaired.repairedOpenings,1);assert.ok(Math.abs(volume(repaired.items[0].solid)-8)<1e-8);
assert.ok(prepare(request(cube,1,{materials:[]})).warnings.some(text=>text.includes('not selected')));
for(const text of [cube.replace('f 1','f 0'),cube.replace('v 0 0 0','v NaN 0 0'),cube+'f 999 1 2\n',cube+'curv 0 1 1 2\n',cube.replace('f 1','f 1/999'),cube+'f 1 2 3\n'])assert.throws(()=>prepare(request(text)),'Bad OBJ must fail before commit');
for(const scale of [0,-1,Infinity,NaN])assert.throws(()=>prepare(request(cube,scale)),/scale/);
const mixed=cube.replace(/(^f [^\n]+)$/m,'usemtl blue\n$1\nusemtl red');const mixedResult=prepare(request(mixed,1,{materials:[{name:'palette.mtl',text:mtl+'newmtl blue\nKd 0 0 1\n'}]}));assert.ok(mixedResult.warnings.some(text=>text.includes('multiple face materials')));
// Removed formats are rejected at the worker boundary before bytes are decoded.
for(const format of ['step','stp','unknown']){
 const rejected=request(cube,1,{format});assert.throws(()=>prepare(rejected),/Unsupported mesh import format/);
 const messages=[],context={console,performance,structuredClone,TextDecoder,TextEncoder,postMessage:message=>messages.push(message)};
 vm.createContext(context);vm.runInContext(workerCode,context);context.onmessage({data:rejected});
 assert.equal(messages.some(message=>message.type==='mesh-import-result'),false);assert.ok(messages.some(message=>/Unsupported mesh import format/.test(message.message||message.error||'')));
}
// Actual worker transport and UI, controlled completion/cancellation for deterministic races.
class ControlledWorker {
 static instances=[];
 constructor(){this.onmessage=null;this.onerror=null;this.terminated=false;ControlledWorker.instances.push(this);}
 postMessage(req){this.request=structuredClone(req);}
 terminate(){this.terminated=true;}
 complete(){const receive=this.onmessage,context={console,performance,structuredClone,TextDecoder,TextEncoder,postMessage:message=>receive?.({data:message})};vm.createContext(context);vm.runInContext(workerCode,context);context.onmessage({data:this.request});}
}
const {sandbox,get}=createAppFixture(root,ControlledWorker),run=code=>vm.runInContext(code,sandbox);
const file=(name,text)=>({name,size:encoder.encode(text).length,text:async()=>text,arrayBuffer:async()=>encoder.encode(text).buffer});sandbox.files=[file('cube.obj',cube),file('palette.mtl',mtl)];
get('projectName').value=run('modelDocument.name');
const original=run('JSON.stringify(projectData())'),history=run('undoStack.length');await run('selectImportFiles(files)');assert.equal(get('commitImport').disabled,true);assert.equal(run('JSON.stringify(projectData())'),original);get('importUnits').value='m';run('importSettingsChanged()');
let pending=run('checkPendingImport()');let worker=ControlledWorker.instances.at(-1);worker.complete();await pending;assert.equal(worker.terminated,true);assert.equal(get('commitImport').disabled,false);assert.match(get('importSummary').textContent,/2,000/);assert.equal(run('undoStack.length'),history);assert.equal(run('JSON.stringify(projectData())'),original);
run('commitCheckedImport()');assert.equal(run('undoStack.length'),history+1);assert.equal(run('lastCommandEntry().type'),'import-obj');assert.equal(run('current().name'),'Cube Ø');assert.equal(run('current().color'),'#cc331a');run('undo()');assert.equal(run('JSON.stringify(projectData())'),original);run('redo()');assert.equal(run('current().name'),'Cube Ø');run('undo()');
await run('selectImportFiles(files)');pending=run('checkPendingImport()');worker=ControlledWorker.instances.at(-1);const late=worker.onmessage;run('cancelModelingOperation()');await pending;assert.equal(worker.terminated,true);late({data:{type:'mesh-import-result',result:cavity}});assert.equal(get('commitImport').disabled,true);assert.equal(run('JSON.stringify(projectData())'),original);
await run('selectImportFiles(files)');pending=run('checkPendingImport()');worker=ControlledWorker.instances.at(-1);worker.complete();await pending;get('importUnits').value='in';run('importSettingsChanged()');assert.equal(get('commitImport').disabled,true);run('commitCheckedImport()');assert.equal(run('JSON.stringify(projectData())'),original);
pending=run('checkPendingImport()');worker=ControlledWorker.instances.at(-1);run('modelRevision++');worker.complete();await pending;assert.equal(get('commitImport').disabled,true);assert.match(get('importError').textContent,/changed/);
sandbox.files=[file('broken.obj',cube+'f 1 2 3\n')];await run('selectImportFiles(files)');pending=run('checkPendingImport()');worker=ControlledWorker.instances.at(-1);worker.complete();await pending;assert.equal(get('commitImport').disabled,true);assert.match(get('importError').textContent,/failed/);assert.equal(run('modelingOperationBusy'),false);
// STL shares scale/check/commit UI and retains the legacy kernel importer.
const binary=run('binarySTL([current()])');sandbox.files=[{name:'cube.stl',size:binary.byteLength,arrayBuffer:async()=>binary}];await run('selectImportFiles(files)');pending=run('checkPendingImport()');worker=ControlledWorker.instances.at(-1);worker.complete();await pending;assert.equal(get('commitImport').disabled,false);run('commitCheckedImport()');assert.equal(run('lastCommandEntry().type'),'import-stl');run('undo()');
// Removing a format also invalidates a previously checked import without document changes.
sandbox.files=[file('cube.obj',cube)];await run('selectImportFiles(files)');pending=run('checkPendingImport()');worker=ControlledWorker.instances.at(-1);worker.complete();await pending;assert.equal(get('commitImport').disabled,false);
for(const extension of ['step','stp']){
 let reads=0;const workerCount=ControlledWorker.instances.length,before=run('JSON.stringify(projectData())'),beforeHistory=run('undoStack.length');
 sandbox.files=[{name:'removed.'+extension,size:0,arrayBuffer:async()=>{reads++;throw Error('Unsupported geometry must not be read.');}}];
 await run('selectImportFiles(files)');await run('checkPendingImport()');run('commitCheckedImport()');
 assert.equal(reads,0);assert.equal(ControlledWorker.instances.length,workerCount);assert.equal(run('importSource'),null);assert.equal(get('checkImport').disabled,true);assert.equal(get('commitImport').disabled,true);assert.match(get('importError').textContent,/Select one OBJ or STL/);assert.equal(run('JSON.stringify(projectData())'),before);assert.equal(run('undoStack.length'),beforeHistory);
}
// Audit both readable distribution aliases and the embedded offline worker.
const runtime=fs.readFileSync(resolve(root,'dist/LamjaCraft-3D.html'),'utf8'),index=fs.readFileSync(resolve(root,'dist/index.html'),'utf8');
assert.equal(index,runtime);assert.equal(fs.existsSync(resolve(root,'dist/LamjaCraft-3D-compact.html')),false);
assert.doesNotMatch(runtime,/LamjaCraft compact bundle|const p="[A-Za-z0-9+/=]{100,}"/);
for(const code of [runtime,index,fs.readFileSync(resolve(root,'build/modeling-worker-bundle.js'),'utf8')])assert.doesNotMatch(code,/STEP_READER|occtimportjs|ReadStepFile|prepareSTEPImport|stepDetail|stepImportOptions/);
assert.equal(fs.existsSync(resolve(root,'vendor')),false);assert.equal(fs.existsSync(resolve(root,'THIRD_PARTY_NOTICES.md')),true);assert.match(fs.readFileSync(resolve(root,'THIRD_PARTY_NOTICES.md'),'utf8'),/DejaVu/);assert.match(runtime,/function stepFileAsync/);assert.match(index,/function stepFileAsync/);assert.match(runtime,/accept="\.skp,\.stl,\.obj,\.mtl,\.json,\.lamjacraft\.json"/);
// Complete actual OBJ/MTL exporter -> importer round-trip on a detailed helical gear.
const helical=run(`(()=>{const solid=prismRegion(involuteGearProfile2({teeth:12,module:1,pressureAngleDeg:20,flankSegments:2}),[Array.from({length:12},(_,i)=>[1.2*Math.cos(-2*Math.PI*i/12),1.2*Math.sin(-2*Math.PI*i/12)])],.5,'import-gear'),top=[...solid.faces.values()].find(f=>f.plane.normal[2]>.999).id;return twistFaceSweep(solid,top,4,8).solid;})()`);
sandbox.helical=helical;const packageBlob=await run("objPackageAsync([{id:'gear',name:'Gear',kind:'solid',solid:helical,color:'#336699',transform:{position:[7,11,3],rotation:[10,20,30]}}],{report(){},isCancelled:()=>false})"),zip=Buffer.from(await packageBlob.arrayBuffer()),entries={};
let offset=0;while(zip.readUInt32LE(offset)===0x04034b50){const size=zip.readUInt32LE(offset+18),length=zip.readUInt16LE(offset+26),extra=zip.readUInt16LE(offset+28),name=zip.subarray(offset+30,offset+30+length).toString(),start=offset+30+length+extra;entries[name]=zip.subarray(start,start+size).toString('utf8');offset=start+size;}
const roundtrip=prepare(request(entries['model.obj'],1,{materials:[{name:'model.mtl',text:entries['model.mtl']}]}));assert.equal(roundtrip.items.length,1);assert.equal(roundtrip.items[0].color,'#336699');assert.ok(Math.abs(volume(roundtrip.items[0].solid)-volume(helical))<1e-5,'Helical OBJ round-trip changed volume');
console.log('Mesh import passed: R175 removed STEP UI/worker rejection, stale check invalidation and offline bundle audit; R170 OBJ polygons/indices/names/MTL/scale/closed topology/cavities, R171 import worker/check/Cancel/stale settings/single command/Undo/Redo/STL.');
