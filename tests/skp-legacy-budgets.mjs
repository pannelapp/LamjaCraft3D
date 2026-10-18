import assert from 'node:assert/strict';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
import {PrePIDWriter} from './skp-pre-pid-writer.mjs';
const {sandbox}=createAppFixture(resolve(import.meta.dirname,'..'),undefined,{DecompressionStream,Response});
const run=code=>vm.runInContext(code,sandbox);
const archivePolicy=run('LEGACY_SKP_ARCHIVE_POLICY'),importPolicy=run('SKP_IMPORT_POLICY');
function prefix(count,definitions=false,slotStart=40){
 const w=new PrePIDWriter({slotStart});w.str('SketchUp Model');w.str('{13.0.4812}');w.raw(new Uint8Array(16));w.str('');w.dword(2);
 w.dword(1);w.layer('layer','Layer0');w.ref('layer');w.dword(definitions?1:0);if(definitions)w.definition();w.dword(count);return w;
}
const finish=w=>{w.dword(0);w.null();return Uint8Array.from(w.bytes).buffer;};
// Many distinct geometric records are not many component placements or solids.
const rootCount=importPolicy.maxInstances+1,looseEdges=rootCount-18,w=prefix(rootCount);
w.cube('root','layer');for(let i=0;i<looseEdges;i++)w.edge('loose'+i,0,1,[[0,0,0],[1,0,0]],'layer');
sandbox.dense=finish(w);sandbox.result=await run("prepareSKPImport(dense,'dense-records.skp')");
assert.equal(sandbox.result.items.length,1);assert.equal(sandbox.result.items[0].solid.faces.size,6);
assert.equal(run('validateSolid(result.items[0].solid,false).ok'),true);
assert.ok(sandbox.result.warnings.some(x=>x.includes(`${rootCount} root entities, 0 visible placements`)));
// Large store-map indices must retain their own graph budget and wide encoding.
sandbox.highSlots=new PrePIDWriter({slotStart:300001}).generate(true,true);
sandbox.highResult=await run("prepareSKPImport(highSlots,'large-archive-index.skp')");
assert.equal(sandbox.highResult.items.length,2);assert.equal(run('highResult.items.every(x=>validateSolid(x.solid,false).ok)'),true);
// Keep both actual placement and output-solid guards independent of root records.
for(const [count,message] of [[importPolicy.maxInstances+1,/component-placement limit/],[importPolicy.maxOutputSolids+1,/object import limit/]]){
 const placements=prefix(count,true);for(let i=0;i<count;i++)placements.instance('copy'+i,i*3);sandbox.tooManyPlacements=finish(placements);
 await assert.rejects(run("prepareSKPImport(tooManyPlacements,'placements.skp')"),message);
}
sandbox.tooManyRecords=finish(prefix(archivePolicy.maxRootEntities+1));
await assert.rejects(run("prepareSKPImport(tooManyRecords,'oversized-root.skp')"),/200001 top-level entity records.*200000 archive limit/);
const node=new PrePIDWriter({slotStart:archivePolicy.maxObjects+1});node.vertex('vertex',[0,0,0]);sandbox.nodeBuffer=Uint8Array.from(node.bytes).buffer;
assert.throws(()=>run('new LegacySKPArchive(nodeBuffer,0,LEGACY_SKP_ARCHIVE_POLICY.maxObjects+1,40,13).pointer()'),/safe object graph limit/);
console.log('Legacy budgets passed: >5000 root geometric records retain one solid, >300000 archive indices preserve wide references, root/graph bounds remain enforced, and actual placement/1000-output limits remain separate.');
