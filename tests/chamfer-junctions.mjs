import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
import {ModelingWorker} from './modeling-worker-fixture.mjs';
const root=resolve(process.env.LAMJACRAFT_JUNCTION_ROOT||resolve(import.meta.dirname,'..')),{sandbox,get}=createAppFixture(root,ModelingWorker),run=c=>vm.runInContext(c,sandbox),plain=x=>JSON.parse(JSON.stringify(x));
const add=(a,b)=>a.map((x,i)=>x+b[i]),sub=(a,b)=>a.map((x,i)=>x-b[i]),mul=(a,k)=>a.map(x=>x*k),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),cross=(a,b)=>a[0]*b[1]-a[1]*b[0],unit=a=>mul(a,1/Math.hypot(...a));
const policy={coordinateEpsilon:1e-9,integrationTolerance:1e-7,maximumIntegrationDepth:18,volumeTolerance:2e-5,witnessTolerance:1e-5};
function fixture(facets=18,subdivide=false,sweep=Math.PI/2){
 const points=[[-40,-30],[40,-30],[40,0]];
 for(let i=1;i<=facets;i++){const a=-Math.PI/2-i*sweep/facets;points.push([40+30*Math.cos(a),30+30*Math.sin(a)]);}
 points.push([-40,points.at(-1)[1]]);
 if(subdivide)points.splice(3,0,mul(add(points[2],points[3]),.5));
 return points;
}
function install(points,scope='both',placed=false){sandbox.input=points;sandbox.scope=scope;sandbox.placed=placed;run(`
 var junctionTransform={position:[13,-7,5],rotation:[19,-27,31]},junctionSource=primitivePrism(input,20,'junction-source');
 if(placed)junctionSource=buildSolidFromPolygons([...junctionSource.faces.values()].reverse().map(f=>({points:faceLoopPoints(junctionSource,f.id).outer.map(p=>transformPoint(p,junctionTransform))})),'placed-junction');
 var junctionFace=[...junctionSource.faces.values()].find(f=>V.dot(f.plane.normal,placed?transformDir([0,0,1],junctionTransform):[0,0,1])>.99);
 var junctionEdges=loopHalfEdges(junctionSource,junctionFace.outerLoop),junctionIds=junctionEdges.filter(e=>{const a=junctionSource.vertices.get(e.origin).position,b=junctionSource.vertices.get(junctionSource.halfEdges.get(e.next).origin).position,p=placed?inverseTransformPoint(a,junctionTransform):a,q=placed?inverseTransformPoint(b,junctionTransform):b;return scope==='closed'||scope!=='right'&&Math.abs(p[0]-40)<1e-7&&Math.abs(q[0]-40)<1e-7||scope!=='left'&&Math.abs(p[1]-input.at(-1)[1])<1e-7&&Math.abs(q[1]-input.at(-1)[1])<1e-7||Math.abs(p[0]-q[0])>1e-7&&Math.abs(p[1]-q[1])>1e-7;}).map(e=>e.id);
 `);}
// Independent cross-section integration, without application frame, profile,
// cutter, Boolean or triangulation helpers. Parallel bands have fixed edge
// directions. A vertical arrangement sweep integrates their clipped union area
// exactly; adaptive Simpson integration handles setback topology events.
function band(points,inset){
 const directions=points.slice(1).map((p,i)=>unit(sub(p,points[i]))),normals=directions.map(t=>[-t[1],t[0]]),extended=points.map(p=>[...p]);
 const extension=1000;extended[0]=sub(extended[0],mul(directions[0],extension));extended[extended.length-1]=add(extended.at(-1),mul(directions.at(-1),extension));
 const offset=extended.map((p,i)=>{if(!i)return add(p,mul(normals[0],inset));if(i===extended.length-1)return add(p,mul(normals.at(-1),inset));const a=normals[i-1],b=normals[i];return add(p,mul(add(a,b),inset/(1+dot(a,b))));});
 return [...extended,...offset.reverse()];
}
function clippedUnionArea(source,cuts){
 const polygons=[source,...cuts],segments=polygons.flatMap(p=>p.map((a,i)=>[a,p[(i+1)%p.length]])),xs=polygons.flatMap(p=>p.map(q=>q[0]));
 for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
  const [a,b]=segments[i],[c,d]=segments[j],u=sub(b,a),v=sub(d,c),den=cross(u,v);if(Math.abs(den)<policy.coordinateEpsilon)continue;
  const delta=sub(c,a),s=cross(delta,v)/den,t=cross(delta,u)/den;if(s>0&&s<1&&t>0&&t<1)xs.push(a[0]+s*u[0]);
 }
 xs.sort((a,b)=>a-b);const unique=xs.filter((x,i)=>!i||x-xs[i-1]>policy.coordinateEpsilon);
 const intervals=(p,x)=>{const ys=[];for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];if(a[0]<=x&&b[0]>x||b[0]<=x&&a[0]>x)ys.push(a[1]+(x-a[0])*(b[1]-a[1])/(b[0]-a[0]));}ys.sort((a,b)=>a-b);const result=[];for(let i=0;i+1<ys.length;i+=2)result.push([ys[i],ys[i+1]]);return result;};
 let area=0;
 for(let i=0;i+1<unique.length;i++){
  const x=(unique[i]+unique[i+1])/2,inside=intervals(source,x);if(!inside.length)continue;
  const raw=cuts.flatMap(p=>intervals(p,x)).sort((a,b)=>a[0]-b[0]),union=[];
  for(const span of raw){const last=union.at(-1);if(last&&span[0]<=last[1])last[1]=Math.max(last[1],span[1]);else union.push([...span]);}
  let length=0;for(const a of inside)for(const b of union)length+=Math.max(0,Math.min(a[1],b[1])-Math.max(a[0],b[0]));area+=length*(unique[i+1]-unique[i]);
 }
 return area;
}
function integrate(f,a,b,epsilon,depth=policy.maximumIntegrationDepth){
 const m=(a+b)/2,fa=f(a),fm=f(m),fb=f(b),whole=(b-a)*(fa+4*fm+fb)/6;
 const recur=(lo,hi,left,mid,right,estimate,tolerance,remaining)=>{const center=(lo+hi)/2,lm=f((lo+center)/2),rm=f((center+hi)/2),l=(center-lo)*(left+4*lm+mid)/6,r=(hi-center)*(mid+4*rm+right)/6,delta=l+r-estimate;if(!remaining||Math.abs(delta)<15*tolerance)return l+r+delta/15;return recur(lo,center,left,lm,mid,l,tolerance/2,remaining-1)+recur(center,hi,mid,rm,right,r,tolerance/2,remaining-1);};
 return recur(a,b,fa,fm,fb,whole,epsilon,depth);
}
function expectedLoss(points,scope,distance,bias,segments){
 const arc=points.slice(2,-1),runs=scope==='closed'?[arc,[arc.at(-1),points.at(-1),points[0],points[1],points[2]]]:[...(scope!=='right'?[[points[1],points[2]]]:[]),arc,...(scope!=='left'?[[arc.at(-1),points.at(-1)]]:[])];
 const depth=distance*Math.tan(bias*Math.PI/180),profile=segments===null?[[distance,0],[0,depth]]:Array.from({length:segments+1},(_,i)=>[distance*(1-Math.sin(Math.PI*i/(2*segments))),depth*(1-Math.cos(Math.PI*i/(2*segments)))]);
 return profile.slice(1).reduce((sum,[b,db],i)=>{const [a,da]=profile[i];return sum+(db-da)*integrate(t=>clippedUnionArea(points,runs.map(run=>band(run,a+(b-a)*t))),0,1,policy.integrationTolerance);},0);
}
let cases=0,physicalWitnesses=0;
function verify(solid,label){sandbox.junctionResult=solid;const checked=run('validateSolid(junctionResult,false)');assert.equal(checked.ok,true,label+': '+checked.errors.join('; '));assert.deepEqual(plain(run('triangleMeshEdgeStats(solidMeshExportLocal(junctionResult))')),{boundary:0,nonManifold:0},label+' closed export');assert.equal(run('connectedSolidFaceComponents(junctionResult).length'),1,label+' connected');assert.equal(run('JSON.stringify(serializeProjectSolid(deserializeProjectSolid(serializeProjectSolid(junctionResult))))'),run('JSON.stringify(serializeProjectSolid(junctionResult))'),label+' native reopen');return checked.volume;}
const entries=[{facets:18,scope:'both',bias:45,segments:8},{facets:18,scope:'left',bias:45,segments:8},{facets:24,scope:'right',bias:35,segments:6},{facets:12,scope:'both',bias:60,segments:12},{facets:24,scope:'closed',bias:45,segments:6},{facets:18,scope:'both',bias:45,segments:null},{facets:24,scope:'right',bias:35,segments:null},{facets:18,scope:'both',bias:45,segments:8,subdivide:true},{facets:24,scope:'both',bias:35,segments:8,placed:true},{facets:24,scope:'left',bias:60,segments:6,sweep:Math.PI}];
for(const entry of entries){
 const {facets,scope,bias,segments,subdivide=false,placed=false,sweep=Math.PI/2}=entry,points=fixture(facets,subdivide,sweep);install(points,scope,placed);sandbox.bias=bias;sandbox.segments=segments;
 const before=run('JSON.stringify(serializeSolid(junctionSource))'),volume=run('validateSolid(junctionSource,false).volume');
 const solid=run('segments===null?chamferEdgesSolid(junctionSource,junctionIds,3,bias):roundedChamferEdgesSolid(junctionSource,junctionIds,3,bias,segments)');
 const loss=volume-verify(solid,JSON.stringify(entry)),expected=expectedLoss(points,scope,3,bias,segments);assert.ok(Math.abs(loss-expected)<policy.volumeTolerance,`Independent section union/integration ${loss} != ${expected} (${JSON.stringify(entry)})`);
 assert.equal(run('JSON.stringify(serializeSolid(junctionSource))'),before,'Source ownership');
 const twin=run('segments===null?chamferEdgesSolid(junctionSource,[...junctionIds].reverse().map(id=>junctionSource.halfEdges.get(id).twin),3*Math.tan(bias*Math.PI/180),90-bias):roundedChamferEdgesSolid(junctionSource,[...junctionIds].reverse().map(id=>junctionSource.halfEdges.get(id).twin),3*Math.tan(bias*Math.PI/180),90-bias,segments)');assert.ok(Math.abs(verify(twin,'Physical twin setbacks')-(volume-loss))<policy.volumeTolerance);
 // Deep material and the unselected bottom are unchanged; no lip/spike or
 // inverted disconnected fragment can substitute for the requested envelope.
 const vertices=plain(run('[...junctionResult.vertices.values()].map(v=>placed?inverseTransformPoint(v.position,junctionTransform):v.position)'));
 const boundaryEdges=plain(run('[...junctionResult.halfEdges.values()].map(e=>[junctionResult.vertices.get(e.origin).position,junctionResult.vertices.get(junctionResult.halfEdges.get(e.next).origin).position].map(p=>placed?inverseTransformPoint(p,junctionTransform):p))'));
 for(const point of points){const target=[...point,0];assert.ok(vertices.some(v=>Math.hypot(...sub(v,target))<policy.witnessTolerance)||boundaryEdges.some(([a,b])=>{const delta=sub(b,a),t=Math.max(0,Math.min(1,dot(sub(target,a),delta)/dot(delta,delta)));return Math.hypot(...sub(add(a,mul(delta,t)),target))<policy.witnessTolerance;}),'Unselected back boundary retained '+JSON.stringify(entry)+' / '+point);}
 physicalWitnesses+=points.length;cases++;
}
// Genuine exhaustion and unstable acute miters remain rejected, atomically.
install([[-5,-5],[5,-5],[5,5],[-5,5]],'closed');const guarded=run('JSON.stringify(serializeSolid(junctionSource))');assert.throws(()=>run('roundedChamferEdgesSolid(junctionSource,junctionIds,6,45,6)'),/profile stations overlap/);assert.equal(run('JSON.stringify(serializeSolid(junctionSource))'),guarded);
// Real Shift curved-chain plus Ctrl straight-side selection, deferred worker,
// exact prepared preview, one command, Undo/Redo, stale guard and cancellation.
try{
 for(const mode of ['chamfer','roundchamfer']){
  const points=fixture();install(points,'both');sandbox.mode=mode;run(`replaceObjects([]);replaceGroups([]);replaceGuides([]);replaceDimensions([]);var junctionObject=makeObject('box');junctionObject.solid=junctionSource;junctionObject.transform={position:[4,-7,11],rotation:[21,17,-13]};objects.push(junctionObject);clearSelection(false);undoStack=[];redoStack=[];setTool(mode);`);
  get('chamferDistance').value='3';get('chamferAngle').value='45';get('roundedChamferRadius').value='3';get('roundedChamferAngle').value='45';get('roundedChamferSegments').value='8';
  const before=run('snapshot()'),workers=ModelingWorker.instances.length;
  run(`var capNormal=V.unit(transformDir(junctionFace.plane.normal,junctionObject.transform));camera.target=transformPoint(faceCentroid(junctionSource,junctionFace.id),junctionObject.transform);camera.distance=140;camera.yaw=Math.atan2(capNormal[1],capNormal[0]);camera.pitch=Math.asin(capNormal[2]);camera.orthographic=true;cameraBasis();`);
  for(const [index,shiftKey,ctrlKey] of [[3,true,false],[0,true,true],[-1,true,true]]){
   sandbox.pickIndex=index;const xy=plain(run(`(()=>{const id=pickIndex<0?junctionIds.at(pickIndex):junctionIds[pickIndex],e=junctionSource.halfEdges.get(id),f=requireChamferCornerFrame(junctionSource,e);return project(transformPoint(V.add(V.lerp(f.a,f.b,.5),V.mul(f.da,.04)),junctionObject.transform));})()`));
   run(`dispatchToolPointerDown({button:0,clientX:${xy[0]},clientY:${xy[1]},pointerId:1,shiftKey:${shiftKey},ctrlKey:${ctrlKey}})`);
  }
  assert.equal(run('chamferEdgeSelection.sides.length'),3);assert.equal(run('chamferEdgeSelection.sides.flatMap(side=>side.halfEdgeIds).length'),run('junctionIds.length'));
  run("dispatchToolKeyUp({key:'Shift',ctrlKey:true,shiftKey:false})");
  assert.equal(run('snapshot()'),before);assert.equal(ModelingWorker.instances.length,workers);const preview=run('chamferEdgeSelection.previewResult');
  run("dispatchToolKeyUp({key:'Control',ctrlKey:false,shiftKey:false})");
  const wait=async()=>{const started=performance.now();while(run('modelingOperationBusy')){assert.ok(performance.now()-started<60000,'Junction worker timeout');await new Promise(r=>setTimeout(r,10));}};await wait();
  assert.equal(run('undoStack.length'),1,run('lastRoundedChamferDiagnosticLog?.error'));const expected=expectedLoss(points,'both',3,45,mode==='chamfer'?null:8);assert.ok(Math.abs(run('validateSolid(junctionSource,false).volume')-verify(run('junctionObject.solid'),'Junction controller')-expected)<policy.volumeTolerance);
  if(preview){sandbox.junctionPreview=preview.solid;assert.equal(run('JSON.stringify(serializeSolid(junctionObject.solid))'),run('JSON.stringify(serializeSolid(junctionPreview))'));}else{assert.equal(run('lastRoundedChamferDiagnosticLog.outcome'),'success');assert.ok(run("lastRoundedChamferDiagnosticLog.events.some(e=>e.event==='corner-geometry'&&e.data.kind==='mixed-turn-envelope')"));}
  const after=run('snapshot()');run('undo()');assert.equal(run('snapshot()'),before);run('redo()');assert.equal(run('snapshot()'),after);run('undo()');
  run("toggleChamferEdgeSelection(junctionObject,junctionIds[0],mode);modelRevision++;dispatchToolKeyUp({key:'Control',ctrlKey:false,shiftKey:false})");assert.equal(run('modelingOperationBusy'),false);assert.equal(run('snapshot()'),before);assert.equal(run('undoStack.length'),0);
  if(mode==='roundchamfer'){run('startRoundedChamfer(junctionObject,junctionIds[0],3,45,8);cancelModelingOperation()');await wait();assert.equal(run('snapshot()'),before);assert.equal(run('undoStack.length'),0);}
 }
}finally{await ModelingWorker.closeAll();}
const folder=resolve(root,'docs/verification/v166');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(resolve(folder,'junctions.json'),JSON.stringify({cases,physicalWitnesses,independentSectionIntegration:true,closedExport:true,nativeRoundTrip:true,realWorker:true,exactUndoRedo:true},null,2)+'\n');
console.log(`R267 Chamfer junctions passed: ${cases} independent section-union/integration cases, ${physicalWitnesses} retained boundary witnesses, straight/rounded/partial/closed/semicircular/subdivided/placed/twin profiles, manifold export/native reopen, genuine overlap rejection, modifier batching, actual worker and exact preview/Undo/Redo/cancellation.`);
