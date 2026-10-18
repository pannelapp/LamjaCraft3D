import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
import {ModelingWorker} from './modeling-worker-fixture.mjs';

const root=resolve(process.env.LAMJACRAFT_CHAMFER_END_ROOT||resolve(import.meta.dirname,'..'));
const {sandbox,get}=createAppFixture(root,ModelingWorker),run=code=>vm.runInContext(code,sandbox),plain=x=>JSON.parse(JSON.stringify(x));
const report={cases:0,terminalStations:0,independentVolume:true,sourceUnchanged:true};
const distance=3,height=12,length=30;
function section(bias,segments){const depth=distance*Math.tan(bias*Math.PI/180);return segments===null?[[distance,0],[0,depth]]:Array.from({length:segments+1},(_,i)=>[distance*(1-Math.sin(Math.PI*i/(2*segments))),depth*(1-Math.cos(Math.PI*i/(2*segments)))]);}
// At profile coordinates (u,v), terminal planes give an edge-parallel width
// L+2*k*u+2*m*v. Integrate its removed band independently of cutter geometry.
function expectedVolume(k,m,bias,segments){return section(bias,segments).slice(1).reduce((sum,[b,vb],i)=>{const [a,va]=section(bias,segments)[i],dv=vb-va;return sum+dv*(length*(a+b)/2+k*(a*a+a*b+b*b)/3+m*((2*va+vb)*a+(va+2*vb)*b)/3);},0);}
function source(k,m=0,placed=false){sandbox.k=k;sandbox.m=m;sandbox.placed=placed;sandbox.height=height;sandbox.length=length;run(`
 var lo=[[-length/2-m*height,0,0],[length/2+m*height,0,0],[length/2+10*k+m*height,10,0],[-length/2-10*k-m*height,10,0]],hi=lo.map(p=>[p[0]+(p[0]>0?-m*height:m*height),p[1],height]);
 var endpointSource=buildSolidFromPolygons([{points:[...lo].reverse()},{points:hi},...lo.map((p,i)=>({points:[p,lo[(i+1)%lo.length],hi[(i+1)%lo.length],hi[i]]}))],'flared-ends');
 var endpointTransform={position:[13,-7,5],rotation:[19,-27,31]};
 if(placed)endpointSource=buildSolidFromPolygons([...endpointSource.faces.values()].reverse().map(f=>({points:faceLoopPoints(endpointSource,f.id).outer.map(p=>transformPoint(p,endpointTransform))})),'placed-ends');
 var expectedA=placed?transformPoint([-length/2,0,height],endpointTransform):[-length/2,0,height],expectedB=placed?transformPoint([length/2,0,height],endpointTransform):[length/2,0,height];
 var endpointEdge=[...endpointSource.halfEdges.values()].find(e=>V.len(V.sub(endpointSource.vertices.get(e.origin).position,expectedA))<1e-7&&V.len(V.sub(endpointSource.vertices.get(endpointSource.halfEdges.get(e.next).origin).position,expectedB))<1e-7);
 `);assert.ok(run('endpointEdge'),'Find the selected top edge');assert.equal(run('validateSolid(endpointSource,false).ok'),true,'Validate the flared source');}
function verify(solid,label){sandbox.endpointResult=solid;const v=run('validateSolid(endpointResult,false)');assert.equal(v.ok,true,label+': '+v.errors.join('; '));assert.deepEqual(plain(run('triangleMeshEdgeStats(solidMeshExportLocal(endpointResult))')),{boundary:0,nonManifold:0},label+' closed export');assert.equal(run('connectedSolidFaceComponents(endpointResult).length'),1);assert.equal(run('JSON.stringify(serializeProjectSolid(deserializeProjectSolid(serializeProjectSolid(endpointResult))))'),run('JSON.stringify(serializeProjectSolid(endpointResult))'),label+' reopen');return v.volume;}
for(const angle of [45,65,90,115,140,155,165,175,178])for(const bias of [30,45,60])for(const segments of [null,8]){
 const k=Math.tan((angle-90)*Math.PI/180);source(k);sandbox.bias=bias;sandbox.segments=segments;
 const before=run('JSON.stringify(serializeSolid(endpointSource))'),volume=run('validateSolid(endpointSource,false).volume');
 const result=run('segments===null?geometryApi.chamferStraightEdges(endpointSource,[endpointEdge.id],3,bias):geometryApi.roundedChamferEdge(endpointSource,endpointEdge.id,3,bias,segments)');
 const removed=volume-verify(result.solid,`Terminal ${angle}/${bias}/${segments}`),expected=expectedVolume(k,0,bias,segments);
 assert.ok(Math.abs(removed-expected)<1e-5,`Terminal ${angle}/${bias}/${segments}: uncut lip, removed ${removed}, expected ${expected}`);
 assert.equal(run('JSON.stringify(serializeSolid(endpointSource))'),before);report.cases++;
}
// Bounds must account for both profile rays, independently flared 3D terminal
// planes, picked-side setback ownership, and rigid placement/face ordering.
for(const [k,m] of [[0,4],[4,2],[1,5]])for(const bias of [30,60])for(const segments of [null,8])for(const placed of [false,true]){
 source(k,m,placed);sandbox.bias=bias;sandbox.segments=segments;
 const volume=run('validateSolid(endpointSource,false).volume'),result=run('segments===null?chamferEdgesSolid(endpointSource,[endpointEdge.id],3,bias):roundedChamferEdgesSolid(endpointSource,[endpointEdge.id],3,bias,segments)');
 const checkedVolume=verify(result,'Oblique 3D end plane'),removed=volume-checkedVolume;assert.ok(Math.abs(removed-expectedVolume(k,m,bias,segments))<1e-5,'Both terminal profile rays must clear the oblique end plane');
 const reversed=run('segments===null?chamferEdgesSolid(endpointSource,[endpointEdge.twin],3*Math.tan(bias*Math.PI/180),90-bias):roundedChamferEdgesSolid(endpointSource,[endpointEdge.twin],3*Math.tan(bias*Math.PI/180),90-bias,segments)');
 assert.ok(Math.abs(verify(reversed,'Twin-picked physical setbacks')-checkedVolume)<1e-5);
 // Compare against the independent expectation too (verify updates endpointResult).
 assert.ok(Math.abs(volume-run('validateSolid(endpointResult,false).volume')-expectedVolume(k,m,bias,segments))<1e-5);report.cases++;
}
// A genuinely bent open path must meet its terminal faces at every profile
// station. These exact intersections expose a short end cap even when the
// solid remains a manifold. Collinear subdivisions exercise vertex fans too.
for(const bend of [0,1])for(const segments of [null,8]){
 sandbox.bend=bend;sandbox.segments=segments;run(`
 var points=[[-15,0],[0,-bend],[15,0],[55,10],[-55,10]];
 endpointSource=primitivePrism(points,height,'bent-flared-ends');
 var cap=[...endpointSource.faces.values()].find(f=>f.plane.normal[2]>.99),front=loopHalfEdges(endpointSource,cap.outerLoop).filter(e=>{const a=endpointSource.vertices.get(e.origin).position,b=endpointSource.vertices.get(endpointSource.halfEdges.get(e.next).origin).position;return a[1]<=0&&b[1]<=0;});
 if(!bend){const edge=front[0],tw=endpointSource.halfEdges.get(edge.twin),next=endpointSource.halfEdges.get(edge.next),tn=endpointSource.halfEdges.get(tw.next),mid=V.lerp(endpointSource.vertices.get(edge.origin).position,endpointSource.vertices.get(tw.origin).position,.5),e2={...edge,id:'he_end_subdivision_A',origin:'v_end_subdivision',prev:edge.id,twin:tw.id},t2={...tw,id:'he_end_subdivision_B',origin:'v_end_subdivision',prev:tw.id,twin:edge.id};endpointSource.vertices.set('v_end_subdivision',{id:'v_end_subdivision',position:mid});endpointSource.halfEdges.set(e2.id,e2);endpointSource.halfEdges.set(t2.id,t2);edge.next=e2.id;edge.twin=t2.id;next.prev=e2.id;tw.next=t2.id;tw.twin=e2.id;tn.prev=t2.id;front=[edge,e2];}
 var path=chamferSelectedPaths(endpointSource,front.map(e=>e.id),45,'cut')[0];
 var bentResult=segments===null?chamferEdgesSolid(endpointSource,front.map(e=>e.id),3,45):roundedChamferEdgesSolid(endpointSource,front.map(e=>e.id),3,45,segments);
 `);verify(run('bentResult'),'Open path flared endpoints');assert.ok(run('front.length')>=2,'The open path must retain both selected edges');
 const checks=run(`(()=>{let checked=0;const profile=segments===null?[[3,0],[0,3]]:roundedChamferProfile(3,45,segments);for(const start of [true,false]){const e=start?path.edges[0]:path.edges.at(-1),f=chamferCornerFrame(endpointSource,e),point=start?f.a:f.b,outward=V.mul(f.t,start?-1:1),neighbor=endpointSource.faces.get(endpointSource.halfEdges.get(endpointSource.halfEdges.get(start?e.prev:e.next).twin).face).plane;for(const [a,b] of profile){const base=V.add(point,V.add(V.mul(f.da,a),V.mul(f.db,b))),delta=(neighbor.offset-V.dot(neighbor.normal,base))/V.dot(neighbor.normal,outward),expected=V.add(base,V.mul(outward,delta));if(![...bentResult.vertices.values()].some(v=>V.len(V.sub(v.position,expected))<1e-5))throw Error('Missing terminal profile intersection '+expected);checked++;}}return checked;})()`);
 report.terminalStations+=checks;report.cases++;
}
// Actual prepared preview/release and embedded rounded worker must commit the
// checked shape once and retain exact Undo/Redo, placement, and cancellation.
try{
 for(const mode of ['chamfer','roundchamfer']){
  source(4,2);sandbox.mode=mode;
  run("replaceObjects([]);replaceGroups([]);replaceGuides([]);replaceDimensions([]);var endpointObject=makeObject('box');endpointObject.solid=endpointSource;endpointObject.transform={position:[4,-7,11],rotation:[21,17,-13]};objects.push(endpointObject);clearSelection(false);undoStack=[];redoStack=[];setTool(mode)");
  get('chamferDistance').value='3';get('chamferAngle').value='60';get('roundedChamferRadius').value='3';get('roundedChamferAngle').value='60';get('roundedChamferSegments').value='8';
  const before=run('snapshot()'),workers=ModelingWorker.instances.length;
  run('toggleChamferEdgeSelection(endpointObject,endpointEdge.id,mode)');assert.equal(run('snapshot()'),before);assert.equal(ModelingWorker.instances.length,workers);
  const preview=run('chamferEdgeSelection.previewResult');run("dispatchToolKeyUp({key:'Control',ctrlKey:false,shiftKey:false})");
  const wait=async()=>{const started=performance.now();while(run('modelingOperationBusy')){assert.ok(performance.now()-started<60000,'Endpoint worker timeout');await new Promise(r=>setTimeout(r,10));}};await wait();
  assert.equal(run('undoStack.length'),1);const volume=verify(run('endpointObject.solid'),'Endpoint controller commit');assert.ok(Math.abs(run('validateSolid(endpointSource,false).volume')-volume-expectedVolume(4,2,60,mode==='chamfer'?null:8))<1e-5);
  if(preview){sandbox.endpointPreview=preview.solid;assert.equal(run('JSON.stringify(serializeSolid(endpointObject.solid))'),run('JSON.stringify(serializeSolid(endpointPreview))'));}
  else assert.equal(run('lastRoundedChamferDiagnosticLog.outcome'),'success',run('lastRoundedChamferDiagnosticLog.error'));
  const after=run('snapshot()');run('undo()');assert.equal(run('snapshot()'),before);run('redo()');assert.equal(run('snapshot()'),after);run('undo()');
  if(mode==='roundchamfer'){run('startRoundedChamfer(endpointObject,endpointEdge.id,3,60,8);cancelModelingOperation()');await wait();assert.equal(run('snapshot()'),before);assert.equal(run('undoStack.length'),0);assert.equal(run('lastRoundedChamferDiagnosticLog.outcome'),'cancelled');}
 }
}finally{await ModelingWorker.closeAll();}
fs.mkdirSync(resolve(root,'docs/verification/v162'),{recursive:true});fs.writeFileSync(resolve(root,'docs/verification/v162/chamfer-endpoints.json'),JSON.stringify(report,null,2)+'\n');
console.log(`R263 Chamfer endpoints passed: ${report.cases} independent volume/placement/open-path cases, ${report.terminalStations} exact terminal profile stations, physical twin setbacks, native/export, prepared preview, actual worker and exact Undo/Redo/cancellation.`);
