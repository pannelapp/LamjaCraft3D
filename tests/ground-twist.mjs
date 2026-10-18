import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),workerCode=fs.readFileSync(resolve(root,'build/edge-feature-worker.js'),'utf8');
const kernel={console,performance,structuredClone,TextDecoder,TextEncoder};vm.createContext(kernel);vm.runInContext(workerCode,kernel);
const run=code=>vm.runInContext(code,kernel);
// Reuse the existing sweep geometry but verify an independent rotation and
// absolute ground height, rather than leaving a straight seed below the loft.
run(`(()=>{
 const profiles=[{outer:[[-5,-4],[5,-4],[5,4],[-5,4]],holes:[]},
 {outer:[[0,0],[8,0],[8,3],[3,3],[3,8],[0,8]],holes:[]},
 {outer:involuteGearProfile2({teeth:12,module:1,pressureAngleDeg:20,flankSegments:2}),holes:[Array.from({length:16},(_,i)=>[Math.cos(-2*Math.PI*i/16),Math.sin(-2*Math.PI*i/16)])]}];
 for(const {outer,holes} of profiles)for(const angle of [-24,24]){
  const height=7,source=groundTwistSource(outer,holes,height),before=JSON.stringify(serializeSolid(source.solid)),wire=previewGroundTwist(source.solid,source.faceId,height,angle),solid=buildGroundTwist(source.solid,source.faceId,height,angle);
  const report=validateSolid(solid,false);if(!report.ok)throw Error(report.errors.join(';'));
  if(JSON.stringify(serializeSolid(source.solid))!==before)throw Error('Ground twist changed its source');
  const points=[...solid.vertices.values()].map(v=>v.position),lo=Math.min(...points.map(p=>p[2])),hi=Math.max(...points.map(p=>p[2]));
  if(Math.abs(lo)>TOL.plane||Math.abs(hi-height)>TOL.plane)throw Error('Ground twist changed the requested absolute height');
  const loops=[outer,...holes];let area2=0,mx=0,my=0;
  for(const loop of loops)for(let i=0;i<loop.length;i++){const a=loop[i],b=loop[(i+1)%loop.length],cross=a[0]*b[1]-b[0]*a[1];area2+=cross;mx+=(a[0]+b[0])*cross;my+=(a[1]+b[1])*cross;}
  const center=[mx/(3*area2),my/(3*area2)],r=angle*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
  for(const loop of loops)for(const p of loop){const x=p[0]-center[0],y=p[1]-center[1],expected=[center[0]+x*c-y*s,center[1]+x*s+y*c,height];if(!points.some(q=>V.len(V.sub(q,expected))<TOL.plane))throw Error('Top cap does not match independent centroid rotation');if(!points.some(q=>V.len(V.sub(q,[p[0],p[1],0]))<TOL.plane))throw Error('Ground profile moved');}
  for(const path of wire.paths)for(const p of path)if(!points.some(q=>V.len(V.sub(q,p))<TOL.plane))throw Error('Preview and committed sections disagree');
  const top=[...solid.faces.values()].find(f=>f.plane.normal[2]>.999&&Math.abs(f.plane.offset-height)<TOL.plane);if(!top||top.innerLoops.length!==holes.length)throw Error('Twist lost a cap opening');
  if(Math.abs(report.volume-area2/2*height)>area2/2*height*.001)throw Error('Twisted volume contains a seed prism or has excessive facet error');
  const stats=triangleMeshEdgeStats(solidMeshExportLocal(solid));if(stats.boundary||stats.nonManifold)throw Error('Ground twist export is not manifold');
  const reopened=deserializeProjectSolid(serializeProjectSolid(solid));if(!validateSolid(reopened,false).ok||Math.abs(validateSolid(reopened,false).volume-report.volume)>1e-5)throw Error('Ground twist round-trip changed geometry');
 }
})()`);
class ControlledWorker {
 static workers=[];
 constructor(){this.onmessage=null;this.terminated=false;ControlledWorker.workers.push(this);}
 postMessage(request){this.request=structuredClone(request);}
 terminate(){this.terminated=true;}
 complete(){const k={console,performance,structuredClone,TextDecoder,TextEncoder,postMessage:m=>this.onmessage?.({data:m})};vm.createContext(k);vm.runInContext(workerCode,k);k.onmessage({data:this.request});}
}
const {sandbox,get}=createAppFixture(root,ControlledWorker),ui=code=>vm.runInContext(code,sandbox),flush=()=>new Promise(resolve=>setImmediate(resolve));
get('projectName').value=ui('modelDocument.name');
const input=id=>{for(const listener of get(id).listeners?.input||[])listener({target:get(id)});};
const key=(value,extra={})=>{sandbox.event={key:value,preventDefault(){},...extra};ui('handleApplicationKeyDown(event)');};
const data=()=>ui('JSON.stringify(projectData())');
const reset=()=>{ui("cancelGesture();replaceObjects([]);replaceGroups([]);replaceGuides([]);replaceDimensions([]);objects.push(makeObject('box'));selectObject(objects[0]);undoStack.length=0;redoStack.length=0;setTool('select');cameraBasis();");get('groundTwistAngle').value='0';};
for(const source of ['rect','circle','gear','rack','slot','arcslot','boltcircle','poly']){
 reset();sandbox.source=source;ui('setTool(source);beginGroundExtrusion([[50,50],[60,50],[60,58],[50,58]],[],"Ground twist")');const before=data(),history=ui('undoStack.length');
 get('groundTwistAngle').value=source==='gear'?'-24':'24';input('groundTwistAngle');key('7');
 assert.equal(get('groundExtrudeControls').classList.contains('hidden'),false);assert.equal(ui('pointer.twistPreviews.length'),1);ui('drawGroundExtrudePreview()');assert.equal(data(),before);
 key('Enter');assert.equal(ui('modelingOperationBusy'),true);assert.equal(data(),before);const worker=ControlledWorker.workers.at(-1);assert.equal(worker.request.type,'ground-twist');worker.complete();await flush();
 assert.equal(ui('modelingOperationBusy'),false);assert.equal(ui('tool'),source);assert.equal(ui('pointer'),null);assert.equal(ui('objects.length'),2);assert.equal(ui('undoStack.length'),history+1);assert.equal(ui('lastCommandEntry().parameters.twistAngleDeg'),Number(get('groundTwistAngle').value));assert.equal(ui('validateSolid(objects[1].solid,false).ok'),true);
 const after=data();ui('undo()');assert.equal(data(),before);assert.equal(ui('tool'),source);ui('redo()');assert.equal(data(),after);
}
// Real circle drawing enters the shared ground step; the panel creates it.
reset();ui("setTool('circle');pointer={type:'circle-ground',center:[50,50],numericRadius:4,segments:16};commitCirclePointer(4)");get('groundTwistAngle').value='18';input('groundTwistAngle');get('groundHeight').value='6';input('groundHeight');get('applyGroundHeight').onclick();ControlledWorker.workers.at(-1).complete();await flush();assert.equal(ui('tool'),'circle');assert.equal(ui('objects.length'),2);
// Bolt Circle profiles rotate around each profile's own centroid. They are
// staged sequentially, yet only one command commits the complete group.
reset();ui("setTool('boltcircle');beginGroundPatternExtrusion([[[50,50],[52,50],[52,52],[50,52]],[[60,50],[62,50],[62,52],[60,52]]],'Bolts')");get('groundTwistAngle').value='-30';input('groundTwistAngle');get('groundHeight').value='5';input('groundHeight');ui('drawGroundPatternExtrudePreview()');const patternBefore=data();get('applyGroundHeight').onclick();ControlledWorker.workers.at(-1).complete();await flush();assert.equal(data(),patternBefore);assert.equal(ui('modelingOperationBusy'),true);ControlledWorker.workers.at(-1).complete();await flush();assert.equal(ui('tool'),'boltcircle');assert.equal(ui('objects.length'),3);assert.equal(ui('undoStack.length'),1);assert.equal(ui('lastCommandEntry().type'),'add-ground-prism-pattern');ui('undo()');assert.equal(data(),patternBefore);ui('redo()');assert.equal(ui('objects.length'),3);
reset();ui("setTool('boltcircle');beginGroundPatternExtrusion([[[50,50],[52,50],[52,52],[50,52]],[[60,50],[62,50],[62,52],[60,52]]],'Bolts')");get('groundTwistAngle').value='12';input('groundTwistAngle');ui('previewGroundHeight(5)');const atomicBefore=data();ui('commitGroundHeight()');ControlledWorker.workers.at(-1).complete();await flush();ControlledWorker.workers.at(-1).onmessage({data:{type:'error',message:'Second profile failed'}});await flush();assert.equal(data(),atomicBefore);assert.equal(ui('undoStack.length'),0);assert.equal(ui('pointer.type'),'ground-extrude-pattern');
reset();ui("setTool('rect');beginGroundExtrusion([[50,50],[60,50],[60,58],[50,58]])");get('groundTwistAngle').value='20';input('groundTwistAngle');ui("dispatchToolPointerMove({clientX:pointer.startX+pointer.ux*pointer.pxPerMm*6,clientY:pointer.startY+pointer.uy*pointer.pxPerMm*6})");assert.ok(Math.abs(ui('pointer.height')-6)<1e-8);ui("dispatchToolPointerDown({button:0,pointerId:1,clientX:400,clientY:300})");ControlledWorker.workers.at(-1).complete();await flush();assert.equal(ui('tool'),'rect');assert.equal(ui('undoStack.length'),1);
// Cancellation, stale document/settings, transport errors and invalid angles
// preserve the draft and create no objects or command history.
for(const mode of ['cancel','stale','settings','error']){
 reset();ui("setTool('gear');beginGroundExtrusion([[50,50],[60,50],[60,58],[50,58]])");get('groundTwistAngle').value='24';input('groundTwistAngle');ui('previewGroundHeight(7)');const before=data();ui('commitGroundHeight()');const worker=ControlledWorker.workers.at(-1);
 if(mode==='cancel'){key('Escape');assert.equal(worker.terminated,true);}else if(mode==='stale'){ui('modelRevision++');worker.complete();}else if(mode==='settings'){ui('pointer.height=8');worker.complete();}else worker.onmessage({data:{type:'error',message:'Fixture generation failed'}});
 await flush();assert.equal(ui('modelingOperationBusy'),false);assert.equal(data(),before);assert.equal(ui('undoStack.length'),0);assert.equal(ui('tool'),'push');assert.equal(ui('pointer.type'),'ground-extrude');key('Escape');assert.equal(ui('tool'),'gear');key('Escape');assert.equal(ui('tool'),'select');
}
reset();ui("setTool('rect');beginGroundExtrusion([[50,50],[60,50],[60,58],[50,58]])");const before=data();for(const angle of ['361','-361','Infinity','bad']){get('groundTwistAngle').value=angle;input('groundTwistAngle');assert.equal(ui('previewGroundHeight(7)'),false);ui('commitGroundHeight()');assert.equal(data(),before);assert.equal(ui('modelingOperationBusy'),false);}
get('groundTwistAngle').value='0';input('groundTwistAngle');ui('previewGroundHeight(7);commitGroundHeight()');assert.equal(ui('tool'),'rect');assert.equal(ui('objects[1].solid.faces.size'),6);assert.equal(ui('undoStack.length'),1);
const template=fs.readFileSync(resolve(root,'src/template.html'),'utf8');assert.match(template,/id="groundTwistAngle"[^>]*min="-360"[^>]*max="360"/);
console.log('R189 ground Twist angle passed: shared facets/centroids, signed concave and holed gear rotation, exact ground/height, wire/commit agreement, manifold export/reopening, eight source tools, circle panel/numeric creation, sequential atomic Bolt Circle, zero twist, Cancel/Escape/return tools, stale/settings/error guards and exact Undo/Redo.');
