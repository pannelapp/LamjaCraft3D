import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
import {ModelingWorker} from './modeling-worker-fixture.mjs';

const root=resolve(import.meta.dirname,'..'),code=fs.readFileSync(resolve(root,'build/modeling-worker-bundle.js'),'utf8'),kernel={console,performance,structuredClone,TextEncoder,TextDecoder,postMessage(){}};
vm.createContext(kernel);vm.runInContext(code,kernel);
const run=text=>vm.runInContext(text,kernel),encoder=new TextEncoder();
const cube=run("(()=>{const m=solidMeshExportLocal(primitivePrism([[0,0],[8,0],[8,8],[0,8]],8,'cube'));return m.triangles.map(t=>t.map(i=>m.vertices[i]));})()");
const sheet=[[[20,0,0],[24,0,0],[24,4,0]],[[20,0,0],[24,4,0],[20,4,0]]];
const folded=structuredClone(sheet);folded[1][2][2]=2;
const ringPoints=[[40,0,0],[50,0,0],[50,10,0],[40,10,0],[43,3,0],[47,3,0],[47,7,0],[43,7,0]];
const ring=[[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]].map(t=>t.map(i=>ringPoints[i]));
const binary=ts=>{const b=new ArrayBuffer(84+50*ts.length),v=new DataView(b);v.setUint32(80,ts.length,true);ts.forEach((t,i)=>t.flat().forEach((x,j)=>v.setFloat32(84+i*50+12+j*4,x,true)));return b;};
const ascii=ts=>encoder.encode('solid sample\n'+ts.map(t=>'facet normal 0 0 0\nouter loop\n'+t.map(p=>'vertex '+p.join(' ')).join('\n')+'\nendloop\nendfacet').join('\n')+'\nendsolid sample').buffer;
const obj=ts=>encoder.encode('mtllib palette.mtl\no Panel\nusemtl red\n'+ts.flat().map(p=>'v '+p.join(' ')).join('\n')+'\n'+ts.map((_,i)=>'f '+[i*3+1,i*3+2,i*3+3].join(' ')).join('\n')).buffer;
const variants=[{format:'obj',encode:obj},{format:'stl',encode:binary},{format:'stl',encode:ascii}];
const prepare=(variant,ts,extras={})=>{
 kernel.request={type:'mesh-import',format:variant.format,name:'Sample',buffer:variant.encode(ts),materials:variant.format==='obj'?[{name:'palette.mtl',text:'newmtl red\nKd 1 0 0\n'}]:[],scale:1,repairOpenings:false,keepTouchingPartsSeparate:true,...extras};
 kernel.events=[];const before=Buffer.from(kernel.request.buffer).toString('hex'),result=run('prepareMeshImport(request,undefined,e=>events.push(e))');assert.equal(Buffer.from(kernel.request.buffer).toString('hex'),before);return result;
};
const area=ts=>ts.reduce((sum,[a,b,c])=>{const u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]);return sum+Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;},0);
const surfaceArea=solid=>{kernel.solid=solid;return area(run('(()=>{const m=solidMeshLocal(solid);return m.triangles.map(t=>t.map(i=>m.vertices[i]));})()'));};
for(const variant of variants){
 for(const ts of [[sheet[0]],sheet,folded,ring,cube.slice(2)])for(const reverse of [false,true]){
  const source=reverse?ts.map(t=>t.slice().reverse()):ts,result=prepare(variant,source);
  assert.equal(result.items.length,1);const item=result.items[0];assert.equal(item.kind,'surface');assert.equal(result.repairedOpenings,0);
  assert.ok(Math.abs(surfaceArea(item.solid)-area(source))<1e-7,'Open-surface area and holes must survive');
  const points=new Set(source.flat().map(p=>JSON.stringify(p)));for(const v of item.solid.vertices.values())assert.ok(points.has(JSON.stringify(v.position)),'Source positions must not move');
  kernel.solid=item.solid;assert.equal(run('deserializeProjectSurface(serializeProjectSurface(solid)).faces.size'),item.solid.faces.size);
  if(variant.format==='obj'){assert.equal(item.name,'Panel');assert.equal(item.color,'#ff0000');assert.ok([...item.solid.faces.values()].every(f=>f.provenance.label==='OBJ open surface'));}
 }
 const hole=prepare(variant,ring).items[0].solid;assert.equal(hole.faces.size,1);assert.equal([...hole.faces.values()][0].innerLoops.length,1);
 const scaled=prepare(variant,sheet,{scale:25.4});assert.ok(Math.abs(surfaceArea(scaled.items[0].solid)/area(sheet)-25.4**2)<1e-6);
 const mixed=prepare(variant,[...cube,...sheet,...folded.map(t=>t.map(p=>[p[0]+40,p[1],p[2]]))]);
 assert.equal(mixed.items.filter(i=>i.kind==='surface').length,2);assert.equal(mixed.items.filter(i=>i.kind!=='surface').length,1);
 const diagnostic=kernel.events.find(e=>e.event==='check-complete');assert.equal(diagnostic.data.solids,1);assert.equal(diagnostic.data.openSurfaces,2);
 kernel.solid=mixed.items.find(i=>i.kind!=='surface').solid;assert.ok(Math.abs(run('validateSolid(solid).volume')-512)<1e-7);
 const filtered=prepare(variant,[...cube,...sheet],{ignoreIsolatedOpenSurfaces:true});assert.equal(filtered.items.length,1);assert.ok(filtered.warnings.some(w=>w.includes('omitted by request')));
 assert.throws(()=>prepare(variant,sheet,{ignoreIsolatedOpenSurfaces:true}),/No solid geometry remains/);
 assert.throws(()=>prepare(variant,sheet,{ignoreIsolatedOpenSurfaces:'yes'}),/boolean option/);
 const repaired=prepare(variant,cube.slice(2),{repairOpenings:true});assert.equal(repaired.items.length,1);assert.notEqual(repaired.items[0].kind,'surface');assert.equal(repaired.repairedOpenings,1);
 const unchangedHole=prepare(variant,ring,{repairOpenings:true});assert.equal(unchangedHole.items[0].kind,'surface');assert.equal(unchangedHole.repairedOpenings,0);assert.ok(Math.abs(surfaceArea(unchangedHole.items[0].solid)-84)<1e-7);
 // Branches cannot be silently converted to a limited manifold surface.
 assert.throws(()=>prepare(variant,[[[0,0,0],[8,0,0],[0,4,0]],[[8,0,0],[0,0,0],[0,-4,0]],[[0,0,0],[8,0,0],[0,0,4]]]),/non-manifold|closed manifold/);
 const counts=kernel.events.find(e=>e.event==='check-complete');assert.equal(counts,undefined,'Rejected geometry must not report a successful check');
}
// Separate OBJ objects, including entirely open named parts, are processed
// independently; omission must not reject a later closed named part.
const openText=new TextDecoder().decode(obj(sheet)),closedText=new TextDecoder().decode(obj(cube));
kernel.request={type:'mesh-import',format:'obj',name:'Named',buffer:encoder.encode(openText+'\n'+closedText.replace('o Panel','o Closed').replace(/^(f )(.*)$/gm,(_,prefix,ids)=>prefix+ids.split(' ').map(id=>Number(id)+6).join(' '))).buffer,materials:[],scale:1,repairOpenings:false};
let named=run('prepareMeshImport(request)');assert.deepEqual(JSON.parse(JSON.stringify(named.items.map(i=>i.name))),['Panel','Closed']);kernel.request.ignoreIsolatedOpenSurfaces=true;named=run('prepareMeshImport(request)');assert.equal(named.items.length,1);assert.equal(named.items[0].name,'Closed');
// Classification preserves original triangle indices for material ownership,
// even when open geometry precedes the solid inside one named OBJ object.
const onePart=openText+'\n'+closedText.replace('o Panel\n','').replace('usemtl red','usemtl blue').replace(/^(f )(.*)$/gm,(_,prefix,ids)=>prefix+ids.split(' ').map(id=>Number(id)+6).join(' '));
kernel.request={...kernel.request,buffer:encoder.encode(onePart).buffer,ignoreIsolatedOpenSurfaces:false,materials:[{name:'palette.mtl',text:'newmtl red\nKd 1 0 0\nnewmtl blue\nKd 0 0 1\n'}]};
const coloured=run('prepareMeshImport(request)');assert.equal(coloured.items.find(i=>i.kind==='surface').color,'#ff0000');assert.equal(coloured.items.find(i=>i.kind!=='surface').color,'#0000ff');
// Exercise limited-object ceilings in an isolated worker with reduced limits,
// without allocating million-face fixtures or altering production policy.
for(const [key,limit,source,message] of [['maxEditableVerticesPerShell',3,sheet,/vertex budget/],['maxEditableFacesPerShell',1,folded,/face budget/]]){
 const fault={console,performance,structuredClone,TextEncoder,TextDecoder,postMessage(){},source};vm.createContext(fault);
 const pattern=new RegExp(key+': 1000000,');assert.match(code,pattern);vm.runInContext(code.replace(pattern,key+': '+limit+','),fault);
 assert.throws(()=>vm.runInContext('stlBuildLimitedSurface(source,0)',fault),message);
}
// Full threaded Check -> Import -> native save/reopen and atomic history.
const {sandbox,get}=createAppFixture(root,ModelingWorker),app=text=>vm.runInContext(text,sandbox);
get('projectName').value=app('modelDocument.name');
try{
 for(const variant of variants){
  const buffer=variant.encode([...cube,...sheet]),name='Mixed.'+variant.format;
  sandbox.files=[{name,size:buffer.byteLength,arrayBuffer:async()=>buffer},...(variant.format==='obj'?[{name:'palette.mtl',size:30,text:async()=>'newmtl red\nKd 1 0 0\n'}]:[])];
  await app('selectImportFiles(files)');assert.equal(get('importIgnoreOpenSurfaces').checked,false);
  assert.equal(get('stlContactSettings').classList.contains('hidden'),variant.format==='obj');
  const original=app('JSON.stringify(projectData())'),history=app('undoStack.length');await app('checkPendingImport()');
  assert.equal(app('JSON.stringify(projectData())'),original);assert.equal(app('undoStack.length'),history);assert.equal(get('commitImport').disabled,false,get('importError').textContent);assert.match(get('importSummary').textContent,/1 editable solid.*1 limited open surface/);
  app('commitCheckedImport()');assert.equal(app('objects.at(-1).kind'),'surface');assert.equal(app('projectData().version'),9);assert.equal(app('undoStack.length'),history+1);const imported=app('JSON.stringify(projectData())');
  app('undo()');assert.equal(app('JSON.stringify(projectData())'),original);app('redo()');assert.equal(app('JSON.stringify(projectData())'),imported);
  app('loadProject(projectData())');assert.equal(app('objects.at(-1).kind'),'surface');app('undo();undo()');assert.equal(app('JSON.stringify(projectData())'),original);
  await app('selectImportFiles(files)');get('importIgnoreOpenSurfaces').checked=true;get('importIgnoreOpenSurfaces').onchange();await app('checkPendingImport()');assert.equal(app('checkedImport.result.items.length'),1);assert.equal(app('importDiagnosticLogs.at(-1).input.ignoreIsolatedOpenSurfaces'),true);
  get('importIgnoreOpenSurfaces').checked=false;app('commitCheckedImport()');assert.equal(app('checkedImport'),null);assert.match(get('importError').textContent,/settings changed/);assert.equal(app('JSON.stringify(projectData())'),original);
 }
}finally{await ModelingWorker.closeAll();}
console.log('OBJ/STL open objects passed: planar/folded/holed/incomplete sheets, source positions/area/winding/scale, named parts and materials, mixed solids, optional repair/omission, branching rejection, actual worker Check/Import, native format-9 reopening, settings identity and atomic Undo/Redo.');
