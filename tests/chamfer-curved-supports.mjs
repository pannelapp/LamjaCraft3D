import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
import {ModelingWorker} from './modeling-worker-fixture.mjs';

const root=resolve(process.env.LAMJACRAFT_CURVED_SUPPORT_ROOT||resolve(import.meta.dirname,'..')),{sandbox,get}=createAppFixture(root,ModelingWorker),run=c=>vm.runInContext(c,sandbox),plain=x=>JSON.parse(JSON.stringify(x));
const height=20,report={cases:0,endpointWitnesses:0,independentVolume:true};
const add=(a,b)=>a.map((x,i)=>x+b[i]),sub=(a,b)=>a.map((x,i)=>x-b[i]),mul=(a,k)=>a.map(x=>x*k),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),length=a=>Math.hypot(...a),unit=a=>mul(a,1/length(a)),cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const area=points=>Math.abs(points.reduce((s,a,i)=>s+cross(a,points[(i+1)%points.length]),0)/2);
function trace(points,index,step,distance){const path=[points[index]];for(let n=0;n<points.length-1;n++){const next=(index+step+points.length)%points.length,delta=sub(points[next],points[index]),span=length(delta),direction=unit(delta);if(distance<=span){path.push(add(points[index],mul(direction,distance)));return {path,end:path.at(-1),direction};}distance-=span;path.push(points[next]);index=next;}throw Error('Independent trace exhausted');}
function section(points,index,step,distance,bias,segments){
 const a=trace(points,index,step,distance),b=trace(points,index,-step,distance*Math.tan(bias*Math.PI/180));
 let profile=[a.end,b.end];
 if(segments!==null){
  // Independent rational conic: endpoints and their actual support tangents
  // define the control intersection. Circular-angle samples map to rational
  // parameters; no application profile/frame/cutter helper is used here.
  const factor=cross(sub(b.end,a.end),b.direction)/cross(a.direction,b.direction),control=add(a.end,mul(a.direction,factor)),alpha=Math.acos(Math.max(-1,Math.min(1,dot(a.direction,b.direction)))),turn=Math.PI-alpha,weight=Math.sin(alpha/2);
  profile=Array.from({length:segments+1},(_,i)=>{const left=Math.sin(i*turn/(2*segments)),right=Math.sin((segments-i)*turn/(2*segments)),t=left/(left+right),u=1-t,den=u*u+2*weight*t*u+t*t;return a.end.map((v,j)=>(u*u*v+2*weight*t*u*control[j]+t*t*b.end[j])/den);});
 }
 return {a,b,profile,removedArea:area([...a.path,...profile.slice(1),...b.path.slice(0,-1).reverse()])};
}
function fixture(facets,radius){const points=[[-60,-40],[50,-40],[50,0]];for(let i=1;i<=facets;i++){const a=-Math.PI/2-i*Math.PI/(2*facets);points.push([50+radius*Math.cos(a),radius+radius*Math.sin(a)]);}points.push([-60,radius]);return {points,corners:[[2,-1],[2+facets,1]]};}
function install(facets,radius,placed=false){const input=fixture(facets,radius);sandbox.input=input.points;sandbox.corners=input.corners;sandbox.placed=placed;run(`
 var curvedSource=primitivePrism(input,20,'curved-support-section'),curvedTransform={position:[13,-7,5],rotation:[19,-27,31]};
 if(placed)curvedSource=buildSolidFromPolygons([...curvedSource.faces.values()].reverse().map(f=>({points:faceLoopPoints(curvedSource,f.id).outer.map(p=>transformPoint(p,curvedTransform))})),'placed-curved-support');
 var curvedIds=corners.map(([index,step])=>{const point=input[index],neighbor=input[(index+step+input.length)%input.length],target=placed?transformPoint([point[0],point[1],0],curvedTransform):[point[0],point[1],0],ray=placed?transformDir([neighbor[0]-point[0],neighbor[1]-point[1],0],curvedTransform):[neighbor[0]-point[0],neighbor[1]-point[1],0];return [...curvedSource.halfEdges.values()].find(e=>{const a=curvedSource.vertices.get(e.origin).position,b=curvedSource.vertices.get(curvedSource.halfEdges.get(e.next).origin).position,f=chamferCornerFrame(curvedSource,e);return f&&Math.abs(V.len(V.sub(a,b))-20)<1e-6&&(V.len(V.sub(a,target))<1e-6||V.len(V.sub(b,target))<1e-6)&&V.dot(f.da,V.unit(ray))>1-TOL.coplanarAngle;}).id;});
 `);return input;}
function verify(solid,label){sandbox.curvedResult=solid;const checked=run('validateSolid(curvedResult,false)');assert.equal(checked.ok,true,label+': '+checked.errors.join('; '));assert.deepEqual(plain(run('triangleMeshEdgeStats(solidMeshExportLocal(curvedResult))')),{boundary:0,nonManifold:0},label+' closed export');assert.equal(run('connectedSolidFaceComponents(curvedResult).length'),1,label+' connected');assert.equal(run('JSON.stringify(serializeProjectSolid(deserializeProjectSolid(serializeProjectSolid(curvedResult))))'),run('JSON.stringify(serializeProjectSolid(curvedResult))'),label+' reopen');return checked.volume;}
function witnesses(expected,placed){
 const vertices=plain(run('[...curvedResult.vertices.values()].map(v=>placed?inverseTransformPoint(v.position,curvedTransform):v.position)'));
 for(const corner of expected)for(const point of corner.profile)for(const z of [0,height]){assert.ok(vertices.some(v=>Math.hypot(v[0]-point[0],v[1]-point[1],v[2]-z)<1e-5),`Missing actual curved-support profile endpoint/sample ${point}/${z}`);report.endpointWitnesses++;}
}
for(const facets of [12,24,48])for(const radius of [20,30])for(const distance of [3,6])for(const bias of [30,45,60])for(const segments of [null,8]){
 const input=install(facets,radius);sandbox.distance=distance;sandbox.bias=bias;sandbox.segments=segments;
 const expected=input.corners.map(([index,step])=>section(input.points,index,step,distance,bias,segments)),before=run('JSON.stringify(serializeSolid(curvedSource))');
 const result=run('segments===null?geometryApi.chamferStraightEdges(curvedSource,curvedIds,distance,bias):{solid:roundedChamferEdgesSolid(curvedSource,curvedIds,distance,bias,segments)}');
 const volume=verify(result.solid,`Curved supports ${facets}/${radius}/${distance}/${bias}/${segments}`),expectedVolume=(area(input.points)-expected.reduce((s,c)=>s+c.removedArea,0))*height;
 assert.ok(Math.abs(volume-expectedVolume)<1e-5,`Independent curved support volume ${volume} vs ${expectedVolume}`);witnesses(expected,false);assert.equal(run('JSON.stringify(serializeSolid(curvedSource))'),before);report.cases++;
}
// Both supports may cross smooth facets. Use independent polygon geometry
// instead of recognizing a circle or relying on an originating sketch/tool.
for(const segments of [null,4,12]){
 const points=[[-60,-60],[30,-60],[30,-30]];for(let i=1;i<=18;i++){const a=-Math.PI/2-i*Math.PI/36;points.push([30+30*Math.cos(a),30*Math.sin(a)]);}for(let i=1;i<=18;i++){const a=-Math.PI/2-i*Math.PI/36;points.push([30*Math.cos(a),30+30*Math.sin(a)]);}points.push([-60,30]);
 sandbox.input=points;sandbox.placed=false;run("curvedSource=primitivePrism(input,20,'two-curved-supports');var target=[...curvedSource.halfEdges.values()].find(e=>{const a=curvedSource.vertices.get(e.origin).position,b=curvedSource.vertices.get(curvedSource.halfEdges.get(e.next).origin).position,f=chamferCornerFrame(curvedSource,e);return f&&Math.hypot(a[0],a[1],b[0],b[1])<1e-7&&V.dot(f.da,V.unit([input[19][0],input[19][1],0]))>1-TOL.coplanarAngle;});curvedIds=[target.id]");sandbox.segments=segments;
 const expected=[section(points,20,-1,6,35,segments)],solid=run('segments===null?chamferEdgesSolid(curvedSource,curvedIds,6,35):roundedChamferEdgesSolid(curvedSource,curvedIds,6,35,segments)'),volume=verify(solid,'Two curved supports');assert.ok(Math.abs(volume-(area(points)-expected[0].removedArea)*height)<1e-5);witnesses(expected,false);report.cases++;
}
// A tangent ellipse that crosses intervening convex facets must reject rather
// than add material, leave ears, or silently shrink the requested setbacks.
{
 const points=Array.from({length:48},(_,i)=>[30*Math.cos(2*Math.PI*i/48),30*Math.sin(2*Math.PI*i/48)]);sandbox.input=points;run("curvedSource=primitivePrism(input,20,'folded-support-guard');var target=[...curvedSource.halfEdges.values()].find(e=>{const a=curvedSource.vertices.get(e.origin).position,b=curvedSource.vertices.get(curvedSource.halfEdges.get(e.next).origin).position;return Math.hypot(a[0]-30,a[1],b[0]-30,b[1])<1e-7;});curvedIds=[target.id]");
 const before=run('JSON.stringify(serializeSolid(curvedSource))');assert.throws(()=>run('roundedChamferEdgesSolid(curvedSource,curvedIds,6,35,4)'),/profile intersects|folds over/);assert.equal(run('JSON.stringify(serializeSolid(curvedSource))'),before);
}
for(const segments of [null,8]){
 const input=install(24,30,true);sandbox.segments=segments;const expected=input.corners.map(([i,step])=>section(input.points,i,step,6,35,segments));
 const original=run('segments===null?chamferEdgesSolid(curvedSource,curvedIds,6,35):roundedChamferEdgesSolid(curvedSource,curvedIds,6,35,segments)'),volume=verify(original,'Rigid support placement');assert.ok(Math.abs(volume-(area(input.points)-expected.reduce((s,c)=>s+c.removedArea,0))*height)<1e-5);witnesses(expected,true);
 const twin=run('segments===null?chamferEdgesSolid(curvedSource,[...curvedIds].reverse().map(id=>curvedSource.halfEdges.get(id).twin),6*Math.tan(35*Math.PI/180),55):roundedChamferEdgesSolid(curvedSource,[...curvedIds].reverse().map(id=>curvedSource.halfEdges.get(id).twin),6*Math.tan(35*Math.PI/180),55,segments)');assert.ok(Math.abs(verify(twin,'Twin physical curved setbacks')-volume)<1e-5);witnesses(expected,true);report.cases++;
}
// Actual modifier release, exact straight preview, embedded worker, one history
// entry, placed object, native persistence and cancellation remain shared.
try{
 for(const mode of ['chamfer','roundchamfer']){
  const input=install(24,30);sandbox.mode=mode;run("replaceObjects([]);replaceGroups([]);replaceGuides([]);replaceDimensions([]);var curvedObject=makeObject('box');curvedObject.solid=curvedSource;curvedObject.transform={position:[4,-7,11],rotation:[21,17,-13]};objects.push(curvedObject);clearSelection(false);undoStack=[];redoStack=[];setTool(mode)");
  get('chamferDistance').value='6';get('chamferAngle').value='45';get('roundedChamferRadius').value='6';get('roundedChamferAngle').value='45';get('roundedChamferSegments').value='8';
  const before=run('snapshot()'),workers=ModelingWorker.instances.length;run('for(const id of curvedIds)toggleChamferEdgeSelection(curvedObject,id,mode)');assert.equal(run('snapshot()'),before);assert.equal(ModelingWorker.instances.length,workers);const preview=run('chamferEdgeSelection.previewResult');run("dispatchToolKeyUp({key:'Control',ctrlKey:false,shiftKey:false})");
  const wait=async()=>{const started=performance.now();while(run('modelingOperationBusy')){assert.ok(performance.now()-started<60000,'Curved support worker timeout');await new Promise(r=>setTimeout(r,10));}};await wait();assert.equal(run('undoStack.length'),1);const volume=verify(run('curvedObject.solid'),'Curved support command');const expected=input.corners.map(([i,step])=>section(input.points,i,step,6,45,mode==='chamfer'?null:8));assert.ok(Math.abs(volume-(area(input.points)-expected.reduce((s,c)=>s+c.removedArea,0))*height)<1e-5);witnesses(expected,false);
  if(preview){sandbox.curvedPreview=preview.solid;assert.equal(run('JSON.stringify(serializeSolid(curvedObject.solid))'),run('JSON.stringify(serializeSolid(curvedPreview))'));}else{assert.equal(run('lastRoundedChamferDiagnosticLog.outcome'),'success',run('lastRoundedChamferDiagnosticLog.error'));assert.ok(run("lastRoundedChamferDiagnosticLog.events.some(e=>e.event==='corner-geometry'&&e.data.kind==='curved-support')"));}
  const after=run('snapshot()');run('undo()');assert.equal(run('snapshot()'),before);run('redo()');assert.equal(run('snapshot()'),after);run('undo()');
  if(mode==='roundchamfer'){run('startRoundedChamfer(curvedObject,curvedIds[0],6,45,8);cancelModelingOperation()');await wait();assert.equal(run('snapshot()'),before);assert.equal(run('undoStack.length'),0);assert.equal(run('lastRoundedChamferDiagnosticLog.outcome'),'cancelled');}
 }
}finally{await ModelingWorker.closeAll();}
const folder=resolve(root,'docs/verification/v163');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(resolve(folder,'curved-supports.json'),JSON.stringify(report,null,2)+'\n');
console.log(`R264 curved Chamfer supports passed: ${report.cases} independent section-volume cases, ${report.endpointWitnesses} actual support/profile witnesses, two curved supports, rigid/twin placement, immutable source, closed export/native reopen, exact preview/worker/Undo/Redo/cancel.`);
