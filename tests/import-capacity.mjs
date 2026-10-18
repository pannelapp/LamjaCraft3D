import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';

const root=resolve(import.meta.dirname,'..');
const {sandbox,get}=createAppFixture(root);
const run=code=>vm.runInContext(code,sandbox);
// A closed radially perturbed sphere gives >100,000 distinct planar faces.
// Perturbation is deterministic and avoids coplanar UV bands hiding capacity.
const around=240,bands=211,vertices=[[0,0,100]];
for(let j=1;j<bands;j++)for(let i=0;i<around;i++){
  const theta=Math.PI*j/bands,phi=2*Math.PI*i/around;
  const radius=100+.2*Math.sin(i*12.9898+j*78.233);
  vertices.push([radius*Math.sin(theta)*Math.cos(phi),radius*Math.sin(theta)*Math.sin(phi),radius*Math.cos(theta)]);
}
const bottom=vertices.length;vertices.push([0,0,-100]);
const at=(j,i)=>1+(j-1)*around+(i+around)%around,triangles=[];
for(let i=0;i<around;i++)triangles.push([0,at(1,i),at(1,i+1)]);
for(let j=1;j<bands-1;j++)for(let i=0;i<around;i++){
  triangles.push([at(j,i),at(j+1,i),at(j+1,i+1)],[at(j,i),at(j+1,i+1),at(j,i+1)]);
}
for(let i=0;i<around;i++)triangles.push([at(bands-1,i),bottom,at(bands-1,i+1)]);
const buffer=new ArrayBuffer(84+50*triangles.length),view=new DataView(buffer);view.setUint32(80,triangles.length,true);
let offset=84;for(const triangle of triangles){offset+=12;for(const index of triangle)for(const coordinate of vertices[index]){view.setFloat32(offset,coordinate,true);offset+=4;}offset+=2;}
sandbox.capacityRequest={type:'mesh-import',format:'stl',name:'Detailed sphere',buffer,materials:[],scale:1,repairOpenings:false};
const started=performance.now();
const imported=run('prepareMeshImport(capacityRequest)');
assert.equal(imported.items.length,1);const solid=imported.items[0].solid;
assert.ok(solid.faces.size>100000,`Fixture must exceed old face cap; got ${solid.faces.size}`);
sandbox.capacitySolid=solid;
assert.equal(run('geometryApi.validate(capacitySolid).ok'),true);
const object={id:'capacity-object',name:'Detailed sphere',kind:'solid',solid,color:'#b7cec9',transform:{position:[0,0,0],rotation:[0,0,0]}};
sandbox.capacityObject=object;
const encoded=JSON.stringify(run('serializeProjectObject(capacityObject)'),null,2);
assert.ok(Buffer.byteLength(encoded)>20*1024*1024,'Detailed saved fixture must exceed the old file budget');
const raw=JSON.parse(encoded);sandbox.capacityRaw=raw;
const originalVolume=run('validateSolid(capacitySolid,false).volume');
const restored=run('validateProjectObject(capacityRaw,0)');
assert.equal(restored.solid.faces.size,solid.faces.size);
sandbox.restoredSolid=restored.solid;
assert.ok(Math.abs(run('validateSolid(restoredSolid,false).volume')/originalVolume-1)<1e-10);
// Exercise both sides of the new binary triangle boundary without allocating
// a million-face B-rep. At the ceiling parsing proceeds to payload validation.
for(const [count,message] of [[1000000,/truncated/],[1000001,/maximum 1,000,000/]]){
  const header=new ArrayBuffer(84);new DataView(header).setUint32(80,count,true);sandbox.capacityHeader=header;
  assert.throws(()=>run("stlTrianglePoints(capacityHeader,'binary')"),message);
}
// A small closed cube padded beyond the old per-file limit must still reach
// real binary parsing, reconstruction and validation in the shared importer.
const cubeBuffer=run("binarySTL([{id:'cube',name:'Cube',kind:'solid',solid:primitivePrism([[0,0],[2,0],[2,2],[0,2]],2,'capacity-cube'),color:'#b7cec9',transform:{position:[0,0,0],rotation:[0,0,0]}}])");
const padded=new ArrayBuffer(21*1024*1024);new Uint8Array(padded).set(new Uint8Array(cubeBuffer));
sandbox.capacityPadded={...sandbox.capacityRequest,buffer:padded};
assert.equal(run('prepareMeshImport(capacityPadded).items[0].solid.faces.size'),6);
sandbox.capacityOversized={...sandbox.capacityRequest,buffer:{byteLength:257*1024*1024}};
assert.throws(()=>run('prepareMeshImport(capacityOversized)'),/256 MB import budget/);
// Reject oversized persisted geometry before constructing its B-rep.
sandbox.capacityTooLarge={...raw,solid:{...raw.solid,faces:new Array(1000001)}};
assert.throws(()=>run('validateProjectObject(capacityTooLarge,0)'),/too large/);
// File-open guard must let a project beyond the former 20 MB ceiling reach the
// format reader (invalid contents are still rejected without changing state).
get('fileInput').value='capacity.json';let read=false;
await get('fileInput').onchange({target:{files:[{size:21*1024*1024,text:async()=>{read=true;return '{}';}}],value:'capacity.json'}});
assert.equal(read,true);
read=false;
await get('fileInput').onchange({target:{files:[{size:513*1024*1024,text:async()=>{read=true;return '{}';}}],value:'capacity.json'}});
assert.equal(read,false);
console.log(`R183 import capacity passed: ${triangles.length} binary triangles -> ${solid.faces.size} validated editable faces, canonical project reload/volume, triangle upper boundary and project file guards (${((performance.now()-started)/1000).toFixed(1)} s).`);
