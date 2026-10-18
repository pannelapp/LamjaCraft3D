// Self-contained MFC CArchive records for the 7 layout. The real-file
// opt-in regression is separate so private user models are not redistributed.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..');
import {PrePIDWriter} from './skp-pre-pid-writer.mjs';
class Writer extends PrePIDWriter{constructor(){super({version:7,jpegThumbnail:true,groupPlacement:true});}}
const {sandbox,get}=createAppFixture(root,undefined,{DecompressionStream,Response});
for(const [variant,defs,layers,dimension,expected,mirror=false] of [['root-only',false,false,false,1],['root-dimension',false,false,true,1],['components-and-layers',true,true,false,2],['mirrored-components',true,false,false,2,true]]){
  sandbox.legacy7=new Writer().generate(defs,layers,dimension,mirror);
  const result=await vm.runInContext(`prepareSKPImport(legacy7,'${variant}.skp')`,sandbox);
  assert.equal(result.items.length,expected,`${variant}: number of editable solids`);
  assert.equal(result.items.reduce((sum,item)=>sum+item.solid.faces.size,0),6*expected);
  assert.equal(vm.runInContext('objects.length',sandbox)>=0,true);
  sandbox.current7=result;
  const serialized=vm.runInContext('current7.items.map(x=>serializeProjectSolid(x.solid))',sandbox);
  const points=serialized.flatMap(s=>s.vertices.map(v=>v.position));
  const mins=points.reduce((m,p)=>m.map((x,i)=>Math.min(x,p[i])),[Infinity,Infinity,Infinity]);
  const maxs=points.reduce((m,p)=>m.map((x,i)=>Math.max(x,p[i])),[-Infinity,-Infinity,-Infinity]);
  assert.deepEqual(mins,[0,0,0]);assert.deepEqual(maxs,[defs?(mirror?76.19999999999999:101.6):25.4,25.4,25.4]);
  assert.equal(vm.runInContext('current7.items.every(x=>validateSolid(x.solid,false).ok)',sandbox),true);
  const count=vm.runInContext('objects.length',sandbox);
  assert.equal(vm.runInContext('addImportedMeshItems(current7).length',sandbox),expected);
  assert.equal(vm.runInContext('objects.length',sandbox),count+expected);
  vm.runInContext('undo()',sandbox);assert.equal(vm.runInContext('objects.length',sandbox),count);
  console.log(`7 ${variant}: ${expected} canonical editable box(es), placements/scale/Undo verified.`);
}
// Nested group definitions preserve composition, not just each local transform.
sandbox.nested7=new PrePIDWriter({version:7,jpegThumbnail:true,groupPlacement:true,nestedPlacement:true}).generate(true,true);
sandbox.nestedResult=await vm.runInContext("prepareSKPImport(nested7,'nested.skp')",sandbox);
assert.equal(sandbox.nestedResult.items.length,2);
assert.equal(vm.runInContext('nestedResult.items.every(x=>validateSolid(x.solid,false).ok)',sandbox),true);
const xs=vm.runInContext('nestedResult.items.flatMap(x=>[...x.solid.vertices.values()].map(v=>v.position[0]))',sandbox);
assert.ok(Math.abs(Math.min(...xs)-50.8)<1e-9);assert.ok(Math.abs(Math.max(...xs)-152.4)<1e-9);
assert.ok(sandbox.nestedResult.warnings.some(w=>w.includes('maximum nesting depth 2')));
// Exercise the actual staged UI path and the existing explicit scale option.
sandbox.files=[{name:'components.skp',size:sandbox.legacy7.byteLength,arrayBuffer:async()=>sandbox.legacy7}];
const before=vm.runInContext('JSON.stringify(projectData())',sandbox);
await vm.runInContext('selectImportFiles(files)',sandbox);
get('skpScaleMode').value='0.001';vm.runInContext('importSettingsChanged()',sandbox);
await vm.runInContext('checkPendingImport()',sandbox);
assert.equal(get('commitImport').disabled,false,get('importError').textContent);
assert.equal(vm.runInContext('checkedImport.scale',sandbox),0.001);
assert.ok(vm.runInContext('checkedImport.result.items.every(x=>Math.abs(validateSolid(x.solid,false).volume-0.0254**3)<1e-12)',sandbox));
assert.equal(vm.runInContext('JSON.stringify(projectData())',sandbox),before,'Check must not mutate the project');
vm.runInContext('commitCheckedImport()',sandbox);
assert.equal(vm.runInContext('lastCommandEntry().type',sandbox),'import-skp');
assert.equal(vm.runInContext('projectData().objects.slice(-2).every(o=>o.solid.faces.length===6)',sandbox),true);
assert.equal(vm.runInContext('validateProject(projectData()).objects.length===objects.length',sandbox),true);
const committed=vm.runInContext('JSON.stringify(projectData())',sandbox);
vm.runInContext('undo()',sandbox);assert.equal(vm.runInContext('JSON.stringify(projectData())',sandbox),before);
vm.runInContext('redo()',sandbox);assert.equal(vm.runInContext('JSON.stringify(projectData())',sandbox),committed);
// Reject adjacent legacy generations rather than interpreting their bodies as 13.
const unsupported=new Writer();unsupported.str('SketchUp Model');unsupported.str('{6.0.0}');unsupported.raw(new Uint8Array(64));
sandbox.unsupported=Uint8Array.from(unsupported.bytes).buffer;
await assert.rejects(vm.runInContext("prepareSKPImport(unsupported,'2006.skp')",sandbox),/unverified legacy archive layout/);
const truncated=new Writer().generate(true,true).slice(0,-100);
sandbox.truncated=truncated;
await assert.rejects(vm.runInContext("prepareSKPImport(truncated,'truncated.skp')",sandbox),/truncated|out-of-range|string record/);
console.log('SketchUp 7 legacy generation regression passed.');
