// Self-contained MFC CArchive records for the 2015 layout. The real-file
// opt-in regression is separate so private user models are not redistributed.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..');
import {PrePIDWriter} from './skp-pre-pid-writer.mjs';
class Writer extends PrePIDWriter{constructor(options={}){super({version:15,...options});}}
const {sandbox,get}=createAppFixture(root,undefined,{DecompressionStream,Response});
for(const [variant,defs,layers,dimension,expected,mirror=false] of [['root-only',false,false,false,1],['root-dimension',false,false,true,1],['components-and-layers',true,true,false,2],['mirrored-components',true,false,false,2,true]]){
  sandbox.legacy15=new Writer().generate(defs,layers,dimension,mirror);
  const result=await vm.runInContext(`prepareSKPImport(legacy15,'${variant}.skp')`,sandbox);
  assert.equal(result.items.length,expected,`${variant}: number of editable solids`);
  assert.equal(result.items.reduce((sum,item)=>sum+item.solid.faces.size,0),6*expected);
  assert.equal(vm.runInContext('objects.length',sandbox)>=0,true);
  sandbox.current15=result;
  const serialized=vm.runInContext('current15.items.map(x=>serializeProjectSolid(x.solid))',sandbox);
  const points=serialized.flatMap(s=>s.vertices.map(v=>v.position));
  const mins=points.reduce((m,p)=>m.map((x,i)=>Math.min(x,p[i])),[Infinity,Infinity,Infinity]);
  const maxs=points.reduce((m,p)=>m.map((x,i)=>Math.max(x,p[i])),[-Infinity,-Infinity,-Infinity]);
  assert.deepEqual(mins,[0,0,0]);assert.deepEqual(maxs,[defs?(mirror?76.19999999999999:101.6):25.4,25.4,25.4]);
  assert.equal(vm.runInContext('current15.items.every(x=>validateSolid(x.solid,false).ok)',sandbox),true);
  const count=vm.runInContext('objects.length',sandbox);
  assert.equal(vm.runInContext('addImportedMeshItems(current15).length',sandbox),expected);
  assert.equal(vm.runInContext('objects.length',sandbox),count+expected);
  vm.runInContext('undo()',sandbox);assert.equal(vm.runInContext('objects.length',sandbox),count);
  console.log(`2015 ${variant}: ${expected} canonical editable box(es), placements/scale/Undo verified.`);
}
// Nested group definitions preserve composition, not just each local transform.
sandbox.nested15=new Writer({groupPlacement:true,nestedPlacement:true}).generate(true,true);
sandbox.nestedResult=await vm.runInContext("prepareSKPImport(nested15,'nested.skp')",sandbox);
assert.equal(sandbox.nestedResult.items.length,2);
assert.equal(vm.runInContext('nestedResult.items.every(x=>validateSolid(x.solid,false).ok)',sandbox),true);
const xs=vm.runInContext('nestedResult.items.flatMap(x=>[...x.solid.vertices.values()].map(v=>v.position[0]))',sandbox);
assert.ok(Math.abs(Math.min(...xs)-50.8)<1e-9);assert.ok(Math.abs(Math.max(...xs)-152.4)<1e-9);
assert.ok(sandbox.nestedResult.warnings.some(w=>w.includes('maximum nesting depth 2')));
// Wide object and class pointers must work on both sides of the 15-bit limit,
// including layer bootstrap, drawing metadata and the definition active layer.
for(const slotStart of [0x7ffc,0x8000])for(const multiLayer of [false,true])for(const drawingLayerAtEnd of [false,true]){
 sandbox.wide15=new Writer({slotStart,drawingLayerAtEnd,groupPlacement:true}).generate(true,multiLayer);
 sandbox.wideResult=await vm.runInContext("prepareSKPImport(wide15,'wide.skp')",sandbox);
 assert.equal(sandbox.wideResult.items.length,2);
 assert.equal(vm.runInContext('wideResult.items.every(x=>validateSolid(x.solid,false).ok)',sandbox),true);
 assert.equal(sandbox.wideResult.items.reduce((n,x)=>n+x.solid.faces.size,0),12);
}
console.log('2015 wide-reference boundary: object/class, one/multiple layers, both drawing metadata pointer fields and active-definition layer passed.');
// Exercise the actual staged UI path and the existing explicit scale option.
sandbox.files=[{name:'components.skp',size:sandbox.legacy15.byteLength,arrayBuffer:async()=>sandbox.legacy15}];
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
// Reject adjacent legacy generations rather than interpreting their bodies as 15.
const unsupported=new Writer();unsupported.str('SketchUp Model');unsupported.str('{16.0.0}');unsupported.raw(new Uint8Array(64));
sandbox.unsupported=Uint8Array.from(unsupported.bytes).buffer;
await assert.rejects(vm.runInContext("prepareSKPImport(unsupported,'2016.skp')",sandbox),/unverified legacy archive layout/);
// A 13 body mislabeled as 15 must not be accepted by skipping its missing GUIDs.
const mislabeled=new PrePIDWriter().generate(true,true),badHeader=new Uint8Array(mislabeled);
badHeader[40]='5'.charCodeAt(0);sandbox.mislabeled=mislabeled;
assert.equal(vm.runInContext('legacySKPCheckHeader(mislabeled).version',sandbox),15);
await assert.rejects(vm.runInContext("prepareSKPImport(mislabeled,'wrong-layout.skp')",sandbox),/unsupported CComponentInstance schema 4/);
const truncated=new Writer().generate(true,true).slice(0,-100);
sandbox.truncated=truncated;
await assert.rejects(vm.runInContext("prepareSKPImport(truncated,'truncated.skp')",sandbox),/truncated|out-of-range|string record/);
console.log('SketchUp 2015 legacy generation regression passed.');
