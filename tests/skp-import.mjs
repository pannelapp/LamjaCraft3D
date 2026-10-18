import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..');
const {sandbox,get}=createAppFixture(root,undefined,{DecompressionStream,Response});
const run=code=>vm.runInContext(code,sandbox);
const primitive=run(`(()=>{const s=primitivePrism([[0,0],[1,0],[1,1],[0,1]],1,'test');const vertices=[...s.vertices.values()],mapping=new Map(vertices.map((v,i)=>[v.id,i+1]));return {vertices:vertices.map(v=>v.position),faces:[...s.faces.values()].map(f=>({outer:loopVertexIds(s,f.outerLoop).map(id=>mapping.get(id)),holes:f.innerLoops.map(loop=>loopVertexIds(s,loop).map(id=>mapping.get(id)))}))};})()`);
const id=v=>{let n=v;const out=[];do{out.push(n&255);n=Math.floor(n/256);}while(n);return Buffer.from(out);};
const r=(tag,...children)=>{const b=Buffer.concat(children.map(x=>Buffer.isBuffer(x)?x:Buffer.from(x))),h=Buffer.alloc(6);h.writeUInt16LE(tag,0);h.writeUInt32LE(b.length,2);return Buffer.concat([h,b]);};
const nums=list=>{const b=Buffer.alloc(8*list.length);list.forEach((v,i)=>b.writeDoubleLE(v,8*i));return b;};
const draw=n=>r(0x07d0,r(0x05dc,r(0x05de,id(n))));
const entity=n=>r(0x05dc,r(0x05de,id(n)));
const vertices=primitive.vertices.map((p,i)=>r(0x09c4,entity(i+1),r(0x09c5,nums(p))));
const edges=new Map(),edgeRecords=[];let nextEdgeId=100;
for(const face of primitive.faces)for(const ring of [face.outer,...face.holes])for(let i=0;i<ring.length;i++){
 const a=ring[i],b=ring[(i+1)%ring.length],key=[a,b].sort((x,y)=>x-y).join('-');
 if(edges.has(key))continue;const eid=nextEdgeId++;edges.set(key,{a,b,id:eid});edgeRecords.push(r(0x0bb8,draw(eid),r(0x0bb9,id(a)),r(0x0bba,id(b))));
}
const faces=primitive.faces.map((face,i)=>r(0x0dac,draw(i+1000),r(0x0dae,...[face.outer,...face.holes].map(ring=>r(0x1194,r(0x1195,...ring.map((a,j)=>{const b=ring[(j+1)%ring.length],edge=edges.get([a,b].sort((x,y)=>x-y).join('-'));return r(0x0fa0,r(0x0fa1,id(edge.id)),r(0x0fa2,Buffer.from([edge.a===a?1:0])));})))))));
const rootGeometry=r(0x1388,draw(5000),r(0x1389,...vertices),r(0x138a,...edgeRecords),r(0x138b,...faces));
function fileZip(entries,compressed=true){let data=[],directory=[],offset=0;for(const [name,raw] of entries){const nameBytes=Buffer.from(name),deflated=compressed?deflateRawSync(raw):raw,method=compressed?8:0,local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(method,8);local.writeUInt32LE(deflated.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(nameBytes.length,26);data.push(local,nameBytes,deflated);const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(method,10);central.writeUInt32LE(deflated.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(nameBytes.length,28);central.writeUInt32LE(offset,42);directory.push(central,nameBytes);offset+=local.length+nameBytes.length+deflated.length;}
 const cd=Buffer.concat(directory),eocd=Buffer.alloc(22);eocd.writeUInt32LE(0x06054b50,0);eocd.writeUInt16LE(entries.length,8);eocd.writeUInt16LE(entries.length,10);eocd.writeUInt32LE(cd.length,12);eocd.writeUInt32LE(offset,16);return Buffer.concat([...data,cd,eocd]);}
const header=Buffer.concat([Buffer.from([255,254,255,14]),Buffer.from('SketchUp Model','utf16le'),Buffer.from([255,254,255,8]),Buffer.from('{26.2.0}','utf16le'),Buffer.from('VFF magic padding')]);
const model=r(0x01f4,r(0x01f6,rootGeometry)),makeFile=(compressed=true)=>Buffer.concat([header,fileZip([['model.dat',model]],compressed)]);
async function parse(contents){sandbox.skp=contents.buffer.slice(contents.byteOffset,contents.byteOffset+contents.byteLength);return await run('prepareSKPImport(skp,"cube.skp")');}
for(const compressed of [false,true]){
 const result=await parse(makeFile(compressed));assert.equal(result.format,'skp');assert.equal(result.items.length,1);assert.equal(result.items[0].solid.faces.size,6);assert.equal(result.items[0].solid.vertices.size,8);
 sandbox.solid=result.items[0].solid;const volume=run('validateSolid(solid,false).volume');assert.ok(Math.abs(volume-25.4**3)<1e-6,'one-inch source geometry is not converted to millimetres');
 const project=run('serializeProjectSolid(solid)');assert.equal(project.faces.length,6);assert.equal(project.schema,'poly-brep-1');
}
// SketchUp may store a closed solid with independently reversed face normals.
// Imported solids must be made consistently oriented, not silently discarded.
// This checks the actual half-edge B-rep path, using no STL triangulation.
sandbox.skewedCube=primitive;
const orientationResult=run(`(()=>{
 const source=skewedCube;
 const body={id:1,vertices:new Map(source.vertices.map((p,i)=>[i+1,p])),edges:new Map(),
  faces:source.faces.map(face=>({outer:[...face.outer],holes:face.holes.map(h=>[...h])})),instances:[]};
 const imported=()=>skpSplitClosedSolids(body,skpIdentity(),'Winding regression',new Set(),0.001);
 body.faces[0].outer.reverse();
 const fixed=imported(),fixedValidation=validateSolid(fixed[0].solid,false);
 body.faces[0].outer.reverse();
 for(const face of body.faces)face.outer.reverse();
 const inward=imported(),inwardValidation=validateSolid(inward[0].solid,false);
 const mirror=[-1,0,0,0,1,0,0,0,1,5,0,0,1];
 const mirrored=skpSplitClosedSolids(body,mirror,'Mirrored winding regression',new Set(),0.001);
 const mirroredValidation=validateSolid(mirrored[0].solid,false);
 // A missing side is genuinely open and must still be rejected.
 body.faces.pop();
 const open=imported();
 return {fixed:fixed.length,fixedValidation,inward:inward.length,inwardValidation,
   mirrored:mirrored.length,mirroredValidation,open:open.length,openKind:open[0]?.kind};
})()`);
assert.equal(orientationResult.fixed,1,'an inconsistently wound but closed shell must be repaired');
assert.equal(orientationResult.fixedValidation.ok,true,'repaired shell must pass half-edge validation');
assert.equal(orientationResult.inward,1,'an entirely inward shell must be reversed');
assert.equal(orientationResult.inwardValidation.ok,true,'outward-reversed shell must pass validation');
assert.equal(orientationResult.mirrored,1,'mirrored inward shells must import');
assert.equal(orientationResult.mirroredValidation.ok,true,'mirrored shell must pass validation');
assert.equal(orientationResult.open,1,'an actually open shell must be retained as a limited surface');
assert.equal(orientationResult.openKind,'surface','open faces must never silently become editable solids');
// A slightly skewed SketchUp polygon remains closed but not planar.
// Preserve every original 3D vertex, split only affected polygon faces and
// still return a watertight, editable, independently validated B-rep.
sandbox.warpedCube=primitive;
const warped=run(`(()=>{
 const body={id:2,vertices:new Map(warpedCube.vertices.map((p,i)=>[i+1,[...p]])),edges:new Map(),
  faces:warpedCube.faces.map(face=>({outer:[...face.outer],holes:face.holes.map(h=>[...h])})),instances:[]};
 body.vertices.get(8)[2]+=0.02;
 const warnings=new Set(),parts=skpSplitClosedSolids(body,skpIdentity(),'Slightly warped polygons',warnings,0.001);
 return {count:parts.length,faces:parts[0]?.solid.faces.size,valid:parts[0]&&validateSolid(parts[0].solid,false),warnings:[...warnings]};
})()`);
assert.equal(warped.count,1,'non-planar but watertight SketchUp polygons must not discard an entire solid');
assert.equal(warped.valid.ok,true,'repaired face triangles must remain a valid editable half-edge B-rep');
assert.ok(warped.faces>6,'slightly non-planar polygons must be subdivided rather than projected/moved');
assert.match(warped.warnings.join(' '),/Triangulated .* non-planar SKP face/);
// Separate entity containers may contain repeated geometry pools rather than
// a single vertex/edge/face record. Read every pool before resolving faces.
const splitPoolsModel=r(0x01f4,r(0x01f6,r(0x1388,draw(5000),
 r(0x1389,...vertices.slice(0,4)),r(0x1389,...vertices.slice(4)),
 r(0x138a,...edgeRecords.slice(0,edgeRecords.length/2)),r(0x138a,...edgeRecords.slice(edgeRecords.length/2)),
 r(0x138b,...faces.slice(0,3)),r(0x138b,...faces.slice(3))
)));
const splitPools=await parse(Buffer.concat([header,fileZip([['model.dat',splitPoolsModel]])]));
assert.equal(splitPools.items.length,1,'all geometry pools must be read');
assert.equal(splitPools.items[0].solid.faces.size,6,'later face pools must not disappear');
// Component definitions are placed with their native 13-double matrices.
const identity=[1,0,0,0,1,0,0,0,1,2,3,4,1],mirror=[-1,0,0,0,1,0,0,0,1,5,0,0,1];
const instance=(n,t)=>r(0x1964,draw(8000+n),r(0x1965,Buffer.from('Instance'+n)),r(0x1966,nums(t)),r(0x1967,id(6000)));
const defEntity=r(0x1388,draw(6000),r(0x1389,...vertices),r(0x138a,...edgeRecords),r(0x138b,...faces));
const placedDef=r(0x157c,defEntity,r(0x157e,Buffer.from('Cube definition')));
const groupModel=r(0x01f4,r(0x01f9,r(0x1770,r(0x1771,placedDef))),r(0x01f6,r(0x1388,draw(5001),r(0x138c,instance(1,identity),instance(2,mirror)))));
const grouped=await parse(Buffer.concat([header,fileZip([['model.dat',groupModel]])]));
assert.equal(grouped.items.length,2,'two SKP component placements must become two editable objects');
assert.ok(grouped.items.every(item=>item.solid.faces.size===6));
assert.ok(Math.abs(grouped.items[0].solid.vertices.values().next().value.position[0]-50.8)<1e-6,'component translation must be converted to mm');
assert.ok(grouped.items[1].solid.faces.size===6,'mirrored components must keep reversed solid winding');
// Some model writers split repeated component placements into multiple
// instance pools. Read every pool and both reusable component/group placements.
const repeated=(n,t)=>r(0x1964,draw(8500+n),r(0x1965,Buffer.from('Shared part')),r(0x1966,nums(t)),r(0x1967,id(6000)));
const repeatedPoolsModel=r(0x01f4,r(0x01f9,r(0x1770,r(0x1771,placedDef))),r(0x01f6,r(0x1388,draw(5001),
  r(0x138c,repeated(1,identity)),
  r(0x138c,repeated(2,[1,0,0,0,1,0,0,0,1,8,0,0,1])),
  r(0x138d,r(0x1d4c,repeated(3,[1,0,0,0,1,0,0,0,1,16,0,0,1])))
)));
const sharedParts=await parse(Buffer.concat([header,fileZip([['model.dat',repeatedPoolsModel]])]));
assert.equal(sharedParts.items.length,3,'all shared-definition instances, including later pools and groups, must be imported');
assert.equal(sharedParts.items.map(item=>item.name).join(' / '),'Shared part / Shared part (copy 2) / Shared part (copy 3)');
assert.match(sharedParts.warnings.join(' '),/2 reused definition placement/);
assert.equal(new Set(sharedParts.items.map(item=>Math.round(item.solid.vertices.values().next().value.position[0]))).size,3,'copies must retain distinct world transforms');
assert.equal(new Set(sharedParts.items.map(item=>item.solid)).size,3,'copies must have independent editable solids');
// Regression: real SketchUp groups can own inline entity collections, with
// repeated definitions inside them. Copied outer groups must multiply every
// nested occurrence, not only the first component or first nesting level.
const translate=(x,y,z)=>[1,0,0,0,1,0,0,0,1,x,y,z,1];
const groupRef=(n,def,t)=>r(0x1964,draw(n),r(0x1965,Buffer.from('Nested group')),r(0x1966,nums(t)),r(0x1967,id(def)));
const nestedGroupBody=r(0x1388,draw(9100),r(0x138c,
  repeated(301,translate(0,0,0)),repeated(302,translate(2,0,0))
));
const inlineNestedBody=r(0x1388,draw(9200),r(0x138d,
  r(0x1d4c,groupRef(9210,9999,translate(0,4,0)),nestedGroupBody),
  r(0x1d4c,groupRef(9220,9999,translate(0,8,0)),nestedGroupBody)
));
const inlineGroupsModel=r(0x01f4,r(0x01f9,r(0x1770,r(0x1771,placedDef))),r(0x01f6,
  r(0x1388,draw(5001),r(0x138d,
    r(0x1d4c,groupRef(9230,9999,translate(0,0,0)),inlineNestedBody),
    r(0x1d4c,groupRef(9240,9999,translate(25,0,0)),inlineNestedBody)
  ))));
const nestedInline=await parse(Buffer.concat([header,fileZip([['model.dat',inlineGroupsModel]])]));
assert.equal(nestedInline.items.length,8,'copied outer groups must preserve all deeply nested copies');
assert.equal(new Set(nestedInline.items.map(item=>item.solid)).size,8,'nested copies must remain independent editable objects');
assert.equal(new Set(nestedInline.items.map(item=>{
  const v=item.solid.vertices.values().next().value.position;
  return [Math.round(v[0]/25.4),Math.round(v[1]/25.4)].join(':');
})).size,8,'nested copy transforms must accumulate through both group levels');
assert.match(nestedInline.warnings.join(' '),/6 group placement\(s\) \(6 inline\)/);
// Also accept group entity collections serialized without a separate placement.
const directInlineGroupModel=r(0x01f4,r(0x01f9,r(0x1770,r(0x1771,placedDef))),r(0x01f6,
 r(0x1388,draw(5001),r(0x138d,r(0x1d4c,nestedGroupBody)))));
const directInline=await parse(Buffer.concat([header,fileZip([['model.dat',directInlineGroupModel]])]));
assert.equal(directInline.items.length,2,'groups that store their entities directly must not be skipped');
// The editor supports 1,000 objects; the old SKP-specific 256-object cap
// should not reject a document with several hundred component placements.
function manyInstances(count){
 const components=Array.from({length:count},(_,i)=>instance(i+1,[1,0,0,0,1,0,0,0,1,(i%40)*2,Math.floor(i/40)*2,0,1]));
 const bigModel=r(0x01f4,r(0x01f9,r(0x1770,r(0x1771,placedDef))),r(0x01f6,r(0x1388,draw(5001),r(0x138c,...components))));
 return Buffer.concat([header,fileZip([['model.dat',bigModel]])]);
}
const batch=await parse(manyInstances(260));
assert.equal(batch.items.length,260,'SKP reader must support more than 256 objects');
assert.match(batch.warnings.join(' '),/260 candidate closed shell/);
// Capacity and SKP preview counters belong to one import attempt, never to
// all files opened since app launch. Exercise the real New -> Import path.
get('newBtn').onclick();assert.equal(run('objects.length'),0);
const bulkFile=manyInstances(600),bulkBuffer=bulkFile.buffer.slice(bulkFile.byteOffset,bulkFile.byteOffset+bulkFile.byteLength);
sandbox.bulkFiles=[{name:'600.skp',size:bulkBuffer.byteLength,arrayBuffer:async()=>bulkBuffer}];
await run('selectImportFiles(bulkFiles)');
get('skpScaleMode').value='0.001';run('importSettingsChanged()');
await run('checkPendingImport()');
assert.equal(get('commitImport').disabled,false,get('importError').textContent);
assert.equal(run('checkedImport.result.items.length'),600);
run('commitCheckedImport()');
assert.equal(run('objects.length'),600);
assert.equal(run('new Set(objects.map(o=>o.id)).size'),600);
get('newBtn').onclick();
assert.equal(run('objects.length'),0,'New must remove all objects');
assert.equal(run('importSource'),null,'New must discard old SKP input');
assert.equal(run('checkedImport'),null,'New must discard old import preview');
await run('selectImportFiles(bulkFiles)');
get('skpScaleMode').value='0.001';run('importSettingsChanged()');
await run('checkPendingImport()');
assert.equal(get('commitImport').disabled,false,get('importError').textContent);
assert.equal(run('checkedImport.result.items.length'),600,'New + same SKP must not accumulate preflight candidates');
run('commitCheckedImport()');
assert.equal(run('objects.length'),600,'second import into empty project must produce 600 objects, not 1200');
get('newBtn').onclick();
assert.equal(run('objects.length'),0);
await assert.rejects(()=>parse(manyInstances(1001)),/approximately 1,001 closed geometry shells.*1,001 visible component placements.*limit is 1,000/);

// UI: SKP must commit as editable native geometry in one Undo, without STL/OBJ worker.
const contents=makeFile(),buffer=contents.buffer.slice(contents.byteOffset,contents.byteOffset+contents.byteLength);
sandbox.skpFiles=[{name:'cube.skp',size:buffer.byteLength,arrayBuffer:async()=>buffer}];
const before=run('JSON.stringify(projectData())'),history=run('undoStack.length');
await run('selectImportFiles(skpFiles)');assert.equal(get('skpImportNote').classList.contains('hidden'),false);assert.equal(get('meshImportSettings').classList.contains('hidden'),true);assert.equal(get('commitImport').disabled,true);
await run('checkPendingImport()');assert.equal(get('commitImport').disabled,false,get('importError').textContent);assert.match(get('importSummary').textContent,/25.4/);
run('commitCheckedImport()');assert.equal(run('lastCommandEntry().type'),'import-skp');assert.equal(run('undoStack.length'),history+1);assert.equal(run('current().solid.faces.size'),6);
run('undo()');assert.equal(run('JSON.stringify(projectData())'),before);
// Old legacy containers and corrupt archives refuse cleanly and cannot affect document.
await assert.rejects(()=>parse(Buffer.concat([Buffer.from([255,254,255,14]),Buffer.from('SketchUp Model','utf16le'),Buffer.alloc(64)])),/no valid ZIP/);
await assert.rejects(()=>parse(Buffer.concat([header,fileZip([['not-model.dat',model]])])),/No model.dat/);
// A real SketchUp root collection can omit its own persistent id, unlike the
// component/edge/face records. Missing root IDs must not reject valid SKP geometry.
const missingRootIdModel=r(0x01f4,r(0x01f6,r(0x1388,r(0x1389,...vertices),r(0x138a,...edgeRecords),r(0x138b,...faces))));
const rootWithoutId=await parse(Buffer.concat([header,fileZip([['model.dat',missingRootIdModel]])]));
assert.equal(rootWithoutId.items.length,1);
assert.equal(rootWithoutId.items[0].solid.faces.size,6);
// STL coordinates carry no units. A user may explicitly request 0.001x so an
// STL exported in metres and opened as mm has identical numeric dimensions.
const fullSize=await parse(makeFile());
const scaleFixture=makeFile();
sandbox.skp=scaleFixture.buffer.slice(scaleFixture.byteOffset,scaleFixture.byteOffset+scaleFixture.byteLength);
const scaled=await run('prepareSKPImport(skp,"cube.skp",undefined,0.001)');
assert.equal(scaled.items.length,1);
sandbox.solidScaled=scaled.items[0].solid;
assert.ok(Math.abs(run('validateSolid(solidScaled,false).volume')-0.0254**3)<1e-8);
// Import preview must be invalidated by a scale switch, and the setting must
// survive through canonical import and one undoable command.
await run('selectImportFiles(skpFiles)');
assert.equal(get('skpScaleSettings').classList.contains('hidden'),false);
assert.equal(get('skpScaleMode').value,'1');
get('skpScaleMode').value='0.001';run('importSettingsChanged()');
await run('checkPendingImport()');
assert.equal(get('commitImport').disabled,false,get('importError').textContent);
assert.equal(run('checkedImport.scale'),0.001);
run('commitCheckedImport()');
assert.equal(run('current().solid.faces.size'),6);
assert.ok(Math.abs(run('validateSolid(current().solid,false).volume')-0.0254**3)<1e-8);
run('undo()');
console.log('SKP import: stored/deflated, real-world root-ID variation, unit-scale choice, direct B-rep, UI commit/Undo, and legacy rejection passed.');
