import {ModelingWorker} from './modeling-worker-fixture.mjs';
import {createAppFixture} from './app-fixture.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),evidenceDir=process.env.EXCHANGE_EVIDENCE_DIR||resolve(root,'build/exchange-fixtures');
fs.mkdirSync(evidenceDir,{recursive:true});
const {sandbox,get,downloads}=createAppFixture(root,ModelingWorker);
const fixtures=vm.runInContext(`(()=>{
 const object=(solid,name,color,position=[0,0,0],rotation=[0,0,0])=>({id:solid.id,kind:'solid',name,color,solid,transform:{position,rotation}});
 const box=object(primitivePrism([[-5,-4],[5,-4],[5,4],[-5,4]],6,'exchange-box'),"Box Ø ' \\uD83D\\uDE80",'#cc6633',[31,-11,8],[20,35,60]);
 const annulus=object(prismRegion([[-8,-8],[8,-8],[8,8],[-8,8]],[[[-2,-2],[-2,2],[2,2],[2,-2]]],5,'exchange-hole'),'Through hole','#3377cc',[-20,5,1]);
 const outer=primitivePrism([[-10,-10],[10,-10],[10,10],[-10,10]],20,'exchange-outer'),inner=primitivePrism([[-3,-3],[3,-3],[3,3],[-3,3]],6,'exchange-inner');
 const innerPolygons=csgPolygonsInReference(inner,{position:[0,0,5],rotation:[0,0,0]},{position:[0,0,0],rotation:[0,0,0]});
 const cavity=object(csgToSolid(csgSubtract(solidToCsg(outer),innerPolygons),'exchange-cavity'), 'Sealed cavity','#77bb55');
 const gear=prismRegion(involuteGearProfile2({teeth:12,module:1,pressureAngleDeg:20,flankSegments:2}),[Array.from({length:12},(_,i)=>[1.2*Math.cos(-2*Math.PI*i/12),1.2*Math.sin(-2*Math.PI*i/12)])],.5,'exchange-gear'),top=[...gear.faces.values()].find(f=>f.plane.normal[2]>.999).id;
 const twist=object(twistFaceSweep(gear,top,4,8).solid,'Helical gear','#bb7799',[0,30,0]);
 const concave=object(primitivePrism([[0,0],[8,0],[8,3],[3,3],[3,8],[0,8]],4,'exchange-concave'),'Concave','#777777');
 return [box,annulus,cavity,twist,concave];
})()`,sandbox);
sandbox.fixtures=fixtures;
const before=vm.runInContext('JSON.stringify(fixtures.map(serializeProjectObject))',sandbox);
const progress=[],control={report:(p,m)=>progress.push({p,m}),isCancelled:()=>false};sandbox.control=control;
const expected=vm.runInContext('fixtures.map(o=>({name:o.name,volume:validateSolid(o.solid,false).volume,faces:o.solid.faces.size,points:[...o.solid.vertices.values()].map(v=>transformPoint(v.position,o.transform))}))',sandbox);
fs.writeFileSync(resolve(evidenceDir,'expected.json'),JSON.stringify(expected));
for(let i=0;i<fixtures.length;i++){
 sandbox.fixtureIndex=i;
 const blob=await vm.runInContext('stepFileAsync([fixtures[fixtureIndex]],"fixture.step",control)',sandbox);
 fs.writeFileSync(resolve(evidenceDir,`shape-${i}.step`),Buffer.from(await blob.arrayBuffer()));
}
const step=await vm.runInContext('stepFileAsync(fixtures,"assembly.step",control)',sandbox),stepText=await step.text();fs.writeFileSync(resolve(evidenceDir,'assembly.step'),stepText);
assert.equal((stepText.match(/PRODUCT\(/g)||[]).length,fixtures.length);assert.match(stepText,/SI_UNIT\(\.MILLI\.,\.METRE\.\)/);assert.match(stepText,/BREP_WITH_VOIDS/);assert.match(stepText,/FACE_BOUND/);assert.match(stepText,/\\X2\\/);
// Every STEP reference resolves, and exported faces retain source counts rather than triangles.
const entities=new Map([...stepText.matchAll(/^#(\d+)=(.*);$/gm)].map(m=>[m[1],m[2]]));
for(const [,entity] of entities)for(const ref of entity.matchAll(/#(\d+)/g))assert.ok(entities.has(ref[1]),'STEP has dangling entity reference');
assert.equal([...entities.values()].filter(e=>e.startsWith('ADVANCED_FACE(')).length,expected.reduce((n,o)=>n+o.faces,0));
const obj=await vm.runInContext('objPackageAsync(fixtures,control)',sandbox);const zip=Buffer.from(await obj.arrayBuffer());fs.writeFileSync(resolve(evidenceDir,'model-obj.zip'),zip);
// Independent ZIP local-entry decoder and CRC verifies both files without using the writer.
const crc=bytes=>{let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=value&1?(value>>>1)^0xedb88320:value>>>1;}return (value^0xffffffff)>>>0;};
const files=new Map();let offset=0;while(zip.readUInt32LE(offset)===0x04034b50){const size=zip.readUInt32LE(offset+18),nameLength=zip.readUInt16LE(offset+26),extraLength=zip.readUInt16LE(offset+28),name=zip.subarray(offset+30,offset+30+nameLength).toString('utf8'),start=offset+30+nameLength+extraLength,data=zip.subarray(start,start+size);assert.equal(crc(data),zip.readUInt32LE(offset+14));files.set(name,data.toString('utf8'));offset=start+size;}
assert.deepEqual([...files.keys()],['model.obj','model.mtl']);assert.equal(zip.readUInt32LE(offset),0x02014b50);assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);
const lines=files.get('model.obj').split('\n'),vertices=[],normals=[],parts=[];let part;
for(const line of lines){const [kind,...values]=line.split(' ');if(kind==='v')vertices.push(values.map(Number));if(kind==='vn')normals.push(values.map(Number));if(kind==='o'){part={name:values.join(' '),triangles:[],material:''};parts.push(part);}if(kind==='usemtl')part.material=values[0];if(kind==='f'){const indices=values.map(value=>{const [vertex,,normal]=value.split('/').map(Number);assert.ok(vertex>0&&vertex<=vertices.length&&normal>0&&normal<=normals.length);return vertex-1;});part.triangles.push(indices);}}
assert.equal(parts.length,fixtures.length);assert.ok(vertices.every(p=>p.length===3&&p.every(Number.isFinite)));assert.ok(normals.every(n=>Math.abs(Math.hypot(...n)-1)<1e-9));
for(let i=0;i<parts.length;i++){
 const edges=new Map();let volume=0;for(const t of parts[i].triangles){const [a,b,c]=t.map(j=>vertices[j]);volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;for(let j=0;j<3;j++){const edge=[t[j],t[(j+1)%3]].sort((a,b)=>a-b).join(':');edges.set(edge,(edges.get(edge)||0)+1);}}
 assert.ok([...edges.values()].every(count=>count===2),'OBJ must be watertight');assert.ok(Math.abs(volume-expected[i].volume)<1e-5,'OBJ changed volume');assert.match(files.get('model.mtl'),new RegExp(`newmtl ${parts[i].material}\\nKd `));const expectedColour=[1,3,5].map(start=>parseInt(fixtures[i].color.slice(start,start+2),16)/255).join(' ');assert.ok(files.get('model.mtl').includes(`newmtl ${parts[i].material}\nKd ${expectedColour}\n`),'OBJ material changed colour');
}
assert.equal(vm.runInContext('JSON.stringify(fixtures.map(serializeProjectObject))',sandbox),before,'Exchange changed source geometry');assert.ok(progress.some(x=>x.p===100));
// Mid-write cancellation returns no file and keeps sources intact.
for(const format of ['obj','step']){
 let cancelled=false;const cancelledControl={report:p=>{if(p>2)cancelled=true;},isCancelled:()=>cancelled};sandbox.cancelledControl=cancelledControl;
 await assert.rejects(vm.runInContext(format==='obj'?'objPackageAsync(fixtures,cancelledControl)':'stepFileAsync(fixtures,"cancel.step",cancelledControl)',sandbox),/cancelled/);
}
// UI selection, one download, read-only history, cancellation, and persistent errors.
vm.runInContext(`objects.splice(0,objects.length,...fixtures);groups.splice(0);setObjectSelection([fixtures[0].id,fixtures[1].id],fixtures[0].id);$('exportScope').value='selected';if(exportObjects().length!==2)throw Error('R169 multi-selection export omitted objects');const g=createGroupFromSelection();toggleObjectSelection(fixtures[2]);if(exportObjects().length!==3)throw Error('R169 group plus additional selection export omitted objects');`,sandbox);
const historyBefore=vm.runInContext('undoStack.length',sandbox),documentBefore=vm.runInContext('JSON.stringify(projectData())',sandbox),dirtyBefore=vm.runInContext('dirty',sandbox);
for(const format of ['stl','obj','step']){
 get('exportFormat').value=format;vm.runInContext('exportSummary()',sandbox);assert.equal(get('downloadSTL').disabled,false);assert.match(get('exportSummary').textContent,/3 objects/);
 const downloadBefore=downloads.length;await vm.runInContext('downloadExchange()',sandbox);assert.equal(downloads.length,downloadBefore+1,'UI must issue exactly one download');assert.equal(vm.runInContext('modelingOperationBusy',sandbox),false);
 assert.equal(vm.runInContext('undoStack.length',sandbox),historyBefore);assert.equal(vm.runInContext('JSON.stringify(projectData())',sandbox),documentBefore);assert.equal(vm.runInContext('dirty',sandbox),dirtyBefore);
 const cancelBefore=downloads.length,pending=vm.runInContext('downloadExchange()',sandbox);vm.runInContext('cancelModelingOperation()',sandbox);await pending;assert.equal(downloads.length,cancelBefore,'Cancelled UI export downloaded a file');assert.equal(vm.runInContext('modelingOperationBusy',sandbox),false);
}
vm.runInContext(`clearSelection();exportSummary();`,sandbox);assert.equal(get('downloadSTL').disabled,true);assert.match(get('exportSummary').textContent,/Select/);
vm.runInContext(`const broken={...fixtures[0],solid:geometryApi.clone(fixtures[0].solid)};broken.solid.vertices.values().next().value.position[0]=NaN;objects.splice(0,objects.length,broken);groups.splice(0);clearSelection();$('exportScope').value='all';$('exportFormat').value='step';`,sandbox);
const failedBefore=downloads.length;await vm.runInContext('downloadExchange()',sandbox);assert.equal(downloads.length,failedBefore);assert.equal(get('exportDialog').open,true);assert.match(get('exportError').textContent,/Export failed:/);assert.equal(vm.runInContext('modelingOperationBusy',sandbox),false);
console.log('Exchange tests passed: R167 OBJ/MTL/ZIP/closed meshes/colours, R168 STEP shared topology/holes/cavities/names/units, R169 selection/read-only exports/progress/Cancel/errors.');

await ModelingWorker.closeAll();
