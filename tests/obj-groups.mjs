import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),code=fs.readFileSync(resolve(root,'build/modeling-worker-bundle.js'),'utf8'),context={console,performance,structuredClone,TextEncoder,TextDecoder,postMessage(){}};
vm.createContext(context);vm.runInContext(code,context);const run=text=>vm.runInContext(text,context);
const cube=run("(()=>{const m=solidMeshExportLocal(primitivePrism([[0,0],[8,0],[8,8],[0,8]],8,'cube'));return m.triangles.map(t=>t.map(i=>m.vertices[i]));})()");
const shift=(ts,p)=>ts.map(t=>t.map(v=>v.map((x,a)=>x+p[a])));
const obj=(ts,head='g Parts',offset=0)=>head+'\n'+ts.flat().map(p=>'v '+p.join(' ')).join('\n')+'\n'+ts.map((_,i)=>'f '+[offset+i*3+1,offset+i*3+2,offset+i*3+3].join(' ')).join('\n')+'\n';
const prepare=(text,extras={})=>{context.events=[];context.request={type:'mesh-import',format:'obj',name:'Sample',buffer:new TextEncoder().encode(text).buffer,materials:[],scale:1,repairOpenings:false,...extras};return run('prepareMeshImport(request,undefined,e=>events.push(e))');};
const volume=item=>{context.solid=item.solid;return run('validateSolid(solid).volume');};
// Group-only OBJ files preserve each declared region before positional welding.
const acrossGroups=prepare(obj(cube,'g Shared')+obj(shift(cube,[8,8,0]),'g Shared',36));assert.equal(acrossGroups.items.length,2);assert.ok(acrossGroups.items.every(i=>i.name==='Shared'));assert.ok(Math.abs(acrossGroups.items.reduce((n,i)=>n+volume(i),0)-1024)<1e-7);
// A single declared object may also contain edge-touching closed parts. Closure
// is proven on each part before any reconstruction; no cap or triangle loss.
for(const header of ['o Edge contact','g Edge contact']){
 const source=[...cube,...shift(cube,[8,8,0])],result=prepare(obj(source,header));assert.equal(result.items.length,2);assert.equal(result.items.reduce((n,i)=>n+i.triangleCount,0),24);assert.ok(Math.abs(result.items.reduce((n,i)=>n+volume(i),0)-1024)<1e-7);assert.ok(context.events.some(e=>e.event==='obj-edge-contact-parts'&&e.data.parts===2));
}
// Declared objects own their faces; group labels inside one explicit object
// do not split or rename it, including labels before the first object record.
const parsed=run(`parseOBJ(${JSON.stringify('g Before\n'+obj(cube,'o Actual').replace('f 1 2 3','g Detail\nf 1 2 3'))},1,'Default')`);assert.equal(parsed.parts.length,1);assert.equal(parsed.parts[0].name,'Actual');
// Repeated group labels collect limited sheets without welding their checked
// vertex identities together, avoiding thousands of tiny document objects.
const sheet=[[[20,0,0],[24,0,0],[24,4,0]],[[20,0,0],[24,4,0],[20,4,0]]];
const grouped=prepare(obj(sheet,'g Panels')+obj(shift(sheet,[0,0,2]),'g Panels',6));assert.equal(grouped.items.length,1);assert.equal(grouped.items[0].kind,'surface');assert.equal(grouped.items[0].solid.faces.size,2);assert.equal(grouped.items[0].triangleCount,4);assert.equal(grouped.items[0].name,'Panels open surface');
const triangles=Array.from({length:1100},(_,i)=>[[i*2,0,0],[i*2+1,0,0],[i*2,1,0]]),many=prepare(obj(triangles,'g Decoration'));assert.equal(many.items.length,1);assert.equal(many.items[0].solid.faces.size,1100);assert.equal(many.items[0].triangleCount,1100);
// Branching open sheets, face contacts and duplicate faces are not proven
// closed contact parts, so the original rejection remains authoritative.
const branch=[[[0,0,0],[8,0,0],[0,4,0]],[[8,0,0],[0,0,0],[0,-4,0]],[[0,0,0],[8,0,0],[0,0,4]]];
for(const ts of [branch,[...cube,...cube],[...cube,...shift(cube,[8,0,0])]])assert.throws(()=>prepare(obj(ts,'o Unsafe')),/non-manifold|closed manifold/);
assert.equal(run('MESH_IMPORT_POLICY.maximumObjects'),1000);
console.log('OBJ groups passed: group-only boundaries, explicit-object ownership, repeated surface collections, >1000 source sheets, independently closed edge contacts, exact triangles/volume and retained branching/duplicate/face-contact rejection.');
