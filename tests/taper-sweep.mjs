import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
import {ModelingWorker} from './modeling-worker-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),code=fs.readFileSync(resolve(root,'build/edge-feature-worker.js'),'utf8');
const kernel={console,performance,structuredClone,TextEncoder,TextDecoder};vm.createContext(kernel);vm.runInContext(code,kernel);
const run=s=>vm.runInContext(s,kernel);
const evidence=run(`(()=>{
 const demand=(v,m)=>{if(!v)throw Error(m);},near=(a,b)=>demand(Math.abs(a-b)<1e-5,'Independent volume mismatch: '+a+' / '+b),top=s=>[...s.faces.values()].find(f=>f.plane.normal[2]>.999).id;
 const volume=s=>{const r=validateSolid(s,false);demand(r.ok,r.errors.join(';'));return r.volume;};
 const box=primitivePrism([[-5,-10],[5,-10],[5,10],[-5,10]],20,'taper-box'),fid=top(box),original=JSON.stringify(serializeSolid(box));
 const swept=(d,a)=>{const r=Math.abs(d)*Math.tan(a*Math.PI/180);return Math.abs(d)*(200-30*r+4*r*r/3);};
 let checked=0;
 for(const distance of [-3,3])for(const angle of [-10,10]){
  const result=taperFaceSweep(box,fid,distance,angle),expected=4000+(distance>0?swept(distance,angle):angle>0?-swept(distance,angle):-600);near(volume(result.solid),expected);
  demand(JSON.stringify(serializeSolid(box))===original,'Source changed');demand(result.distance===distance&&!result.limited,'Requested distance changed');
  if(distance>0){const cap=faceLoopPoints(result.solid,fid).outer,r=3*Math.tan(angle*Math.PI/180);for(const p of cap){near(Math.abs(p[0]),5-r);near(Math.abs(p[1]),10-r);near(p[2],23);}demand(result.solid.faces.get(fid).plane.offset===23,'Cap identity lost');}
  const stats=triangleMeshEdgeStats(solidMeshExportLocal(result.solid));demand(!stats.boundary&&!stats.nonManifold,'STL mesh is open');near(volume(deserializeProjectSolid(serializeProjectSolid(result.solid))),expected);checked++;
 }
 const attachStart=performance.now(),attached=taperFaceSweep(box,fid,3,10),attachmentMs=performance.now()-attachStart,booleanStart=performance.now(),closed=taperSweepFaces(box,taperSweepLayout(box,fid,3,10),true).map(input=>({...csgPolygon(input.points),group:input.group,faceIdHint:input.faceIdHint,provenance:input.provenance})),generic=csgToSolid(csgUnion(solidToCsg(box,true),closed),box.id,{kind:'pushpull'},true),booleanMs=performance.now()-booleanStart;
 near(volume(attached.solid),volume(generic));for(const vertex of attached.solid.vertices.values())demand([...generic.vertices.values()].some(v=>V.len(V.sub(v.position,vertex.position))<TOL.plane),'Supporting-plane Add differs from Boolean union');
 const repeated=taperFaceSweep(attached.solid,fid,2,-8);demand(repeated.solid.faces.get(fid)?.plane.offset===25,'Repeated Taper stole cap identity');demand(volume(repeated.solid)>volume(attached.solid),'Repeated Taper failed');
 // Every normal, including a genuinely oblique B-rep, uses the same perpendicular edge offset.
 const oblique=buildSolidFromPolygons([...box.faces.values()].map(f=>({points:faceLoopPoints(box,f.id).outer.map(p=>V.add(rotate(p,[19,-23,31]),[7,-4,3])),faceIdHint:f.id,group:f.id})),box.id);
 for(const source of [box,oblique])for(const face of source.faces.values())for(const angle of [-8,8]){
  const area=faceAreaLocal(source,face.id),perimeter=faceLoopPoints(source,face.id).outer.reduce((sum,p,i,pts)=>sum+V.len(V.sub(pts[(i+1)%pts.length],p)),0),r=2*Math.tan(angle*Math.PI/180),expected=4000+2*(area-perimeter*r/2+4*r*r/3),result=taperFaceSweep(source,face.id,2,angle);
  near(volume(result.solid),expected);for(const p of previewTaperSweep(source,face.id,2,angle).paths.flat())demand([...result.solid.vertices.values()].some(v=>V.len(V.sub(v.position,p))<TOL.plane),'Preview endpoint missing');checked++;
 }
 for(const n of [3,12,48])for(const angle of [-10,10]){
  const profile=Array.from({length:n},(_,i)=>[10*Math.cos(2*Math.PI*i/n),10*Math.sin(2*Math.PI*i/n)]),source=groundTwistSource(profile,[],4),wire=previewGroundTaper(source.solid,source.faceId,4,angle),solid=buildGroundTaper(source.solid,source.faceId,4,angle),ratio=1-4*Math.tan(angle*Math.PI/180)/(10*Math.cos(Math.PI/n)),a0=v2.area(profile);
  near(volume(solid),4*a0/3*(1+ratio+ratio*ratio));const points=[...solid.vertices.values()].map(v=>v.position);near(Math.min(...points.map(p=>p[2])),0);near(Math.max(...points.map(p=>p[2])),4);
  for(const p of profile)demand(points.some(q=>V.len(V.sub(q,[...p,0]))<TOL.plane),'Ground base moved');for(const p of wire.paths.flat())demand(points.some(q=>V.len(V.sub(q,p))<TOL.plane),'Ground preview differs');checked++;
 }
 // Sketch regions, pockets and a non-supporting floor use the general clipped Boolean path.
 const split=splitFaceWithRegion(box,fid,[[-2,-3,20],[2,-3,20],[2,3,20],[-2,3,20]],'Sketch'),cut=taperFaceSweep(split.solid,split.regionFaceId,-2,10),r=2*Math.tan(Math.PI/18),toolVolume=2*(24-10*r+4*r*r/3);near(volume(cut.solid),4000-toolVolume);
 const boss=moveFace(split.solid,split.regionFaceId,2).solid,floor=[...boss.faces.values()].find(f=>f.plane.normal[2]>.999&&Math.abs(f.plane.offset-20)<TOL.plane),second=splitFaceWithRegion(boss,floor.id,[[3,-3,20],[4,-3,20],[4,3,20],[3,3,20]],'Sketch'),added=taperFaceSweep(second.solid,second.regionFaceId,2,-8);demand(volume(added.solid)>volume(second.solid),'Non-supporting Add failed');
 const collinear=primitivePrism([[-5,-4],[0,-4],[5,-4],[5,4],[-5,4]],3,'collinear');demand(volume(taperFaceSweep(collinear,top(collinear),2,10).solid)>volume(collinear),'Collinear boundary rejected');
 const concave=primitivePrism([[0,0],[8,0],[8,3],[3,3],[3,8],[0,8]],4,'concave'),holed=prismRegion([[-5,-5],[5,-5],[5,5],[-5,5]],[[[-1,-1],[-1,1],[1,1],[1,-1]]],4,'holed');
 for(const s of [concave,holed]){demand(JSON.stringify(serializeSolid(taperFaceSweep(s,top(s),2,0).solid))===JSON.stringify(serializeSolid(moveFace(s,top(s),2).solid)),'Zero taper differs from ordinary Push/Pull');demand(volume(taperFaceSweep(s,top(s),2,10).solid)>volume(s),'Concave/holed Taper did not add material');}
 for(const [d,a] of [[0,10],[1,NaN],[1,86],[1,-86],[100,10],[30,45]]){let rejected=false;try{taperFaceSweep(box,fid,d,a);}catch{rejected=true;}demand(rejected,'Invalid/collapsed profile accepted');demand(JSON.stringify(serializeSolid(box))===original,'Rejected sweep changed source');}
 const sharp=primitivePrism([[0,0],[100,0],[100,.01]],2,'sharp');let rejected=false;try{taperSweepLayout(sharp,top(sharp),1,-10);}catch{rejected=true;}demand(rejected,'Unstable miter accepted');
 const dense=primitivePrism(Array.from({length:513},(_,i)=>[10*Math.cos(2*Math.PI*i/513),10*Math.sin(2*Math.PI*i/513)]),2,'dense');rejected=false;try{taperSweepLayout(dense,top(dense),1,10);}catch{rejected=true;}demand(rejected,'Profile budget ignored');
 return {independentVolumeAndPreviewCases:checked,clippedCut:true,nonSupportingAdd:true,roundTripAndManifold:true,attachmentMs,booleanMs};
})()`);
class ControlledWorker {
 static instances=[];
 constructor(){ControlledWorker.instances.push(this);this.onmessage=null;this.terminated=false;}
 postMessage(request){this.request=structuredClone(request);}
 terminate(){this.terminated=true;}
 complete(){const k={console,performance,structuredClone,TextEncoder,TextDecoder,postMessage:m=>this.onmessage?.({data:m})};vm.createContext(k);vm.runInContext(code,k);k.onmessage({data:this.request});}
}
function fixture(WorkerClass=ControlledWorker){
 const f=createAppFixture(root,WorkerClass),ui=s=>vm.runInContext(s,f.sandbox);
 ui("cancelGesture();replaceObjects([]);replaceGroups([]);replaceGuides([]);replaceDimensions([]);objects.push(makeObject('box'));objects[0].transform={position:[7,-2,5],rotation:[17,-22,31]};selectObject(objects[0]);undoStack.length=0;redoStack.length=0;cameraBasis();setTool('push');testFace=[...objects[0].solid.faces.values()].find(f=>f.plane.normal[2]>.999).id;setSelectedFace(objects[0],testFace,transformPoint([0,0,20],objects[0].transform));");
 f.get('projectName').value=ui('modelDocument.name');f.get('pushTaperMode').value='edge-angle';for(const id of ['geomSnap','guideSnap','snap'])f.get(id).checked=false;
 f.get('pushTwistAngle').value='0';f.get('groundTwistAngle').value='0';assert.equal(f.get('pushTaperAngle').value,'0');
 const input=(id,value)=>{f.get(id).value=String(value);for(const listener of f.get(id).listeners?.input||[])listener({target:f.get(id)});};
 const key=value=>{f.sandbox.event={key:value,preventDefault(){}};ui('handleApplicationKeyDown(event)');};
 const data=()=>ui('JSON.stringify(projectData())');
 const history=before=>{assert.equal(ui('undoStack.length'),1);const after=data();ui('undo()');assert.equal(data(),before);ui('redo()');assert.equal(data(),after);};
 return {...f,ui,input,key,data,history};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
for(const side of [-1,1])for(const typedSign of [-1,1]){
 const {ui,input,key,data,history,get}=fixture();input('pushTaperAngle',10);assert.equal(get('maxInsetBtn').disabled,true);
 ui(`pushToolController.numericSeed();previewPushDistance(${side}*.5)`);const before=data();assert.equal(ui('pointer.taperPreview.paths.length'),5);assert.equal(ui('pointer.previewResult'),null);ui('drawPushPreview()');assert.equal(data(),before);
 key('0');key('Backspace');if(typedSign<0)key('-');key('3');assert.equal(ui('pointer.requestedDistance'),side*typedSign*3);
 ui('beginCameraPointer({button:2},400,300,activeToolController());camera.pitch+=.05;resumeAfterCameraPointer(400,300)');assert.equal(ui('pointer.requestedDistance'),side*typedSign*3);
 key('Enter');assert.equal(ui('modelingOperationBusy'),true);assert.equal(data(),before);const worker=ControlledWorker.instances.at(-1);assert.equal(worker.request.type,'face-taper');assert.equal(worker.request.distance,side*typedSign*3);worker.complete();await flush();assert.equal(ui('modelingOperationBusy'),false);assert.equal(ui('validateSolid(objects[0].solid,false).ok'),true);assert.equal(ui('lastCommandEntry().parameters.taperAngleDeg'),10);history(before);
}
// Parameter refresh accepts combined sweeps; zero retains the old live path.
{
 const {ui,input,data,get}=fixture();ui('pushToolController.numericSeed();previewPushDistance(3)');const before=data();input('pushTaperAngle',10);assert.ok(ui('pointer.taperPreview'));input('pushTwistAngle',12);assert.equal(ui('pointer.valid'),true);assert.ok(ui('pointer.taperPreview'));assert.equal(data(),before);assert.equal(ui('modelingOperationBusy'),false);
 input('pushTwistAngle',0);input('pushTaperAngle',0);ui('pushToolController.numericSeed();previewPushDistance(3)');assert.equal(get('maxInsetBtn').disabled,false);assert.equal(ui('pointer.valid'),true);assert.ok(ui('pointer.previewResult'));input('pushTaperAngle',86);assert.equal(ui('pointer.valid'),false);assert.equal(ui('undoStack.length'),0);
}
for(const mode of ['cancel','revision','settings','error','lock']){
 const {ui,input,key,data}=fixture();input('pushTaperAngle',10);const before=data();ui('commitTaperedFaceFromUI(objects[0],testFace,3,10)');const worker=ControlledWorker.instances.at(-1);
 if(mode==='cancel'){key('Escape');assert.equal(worker.terminated,true);}else if(mode==='revision'){ui('modelRevision++');worker.complete();}else if(mode==='settings'){input('pushTaperAngle',12);worker.complete();}else if(mode==='lock'){ui('objects[0].locked=true');worker.complete();}else worker.onmessage({data:{type:'error',message:'Fixture failure'}});
 await flush();if(mode==='lock')ui('objects[0].locked=false');assert.equal(ui('modelingOperationBusy'),false);assert.equal(data(),before);assert.equal(ui('undoStack.length'),0);
}
// Panel and pointer creation share the command; lock/group guards do not launch a worker.
for(const mode of ['panel','pointer','locked','grouped']){
 const {ui,input,data,get}=fixture();input('pushTaperAngle',-10);const before=data(),count=ControlledWorker.instances.length;
 if(mode==='locked')ui('objects[0].locked=true');if(mode==='grouped')ui("groups.push({id:'g',name:'Group',objectIds:[objects[0].id]})");
 if(mode==='pointer'){ui('pushToolController.numericSeed();previewPushDistance(3);pushToolController.pointerDown({x:400,y:300})');}else{get('faceDistance').value='3';get('applyFace').onclick();}
 if(mode==='locked'||mode==='grouped'){assert.equal(ControlledWorker.instances.length,count);assert.equal(ui('undoStack.length'),0);continue;}
 ControlledWorker.instances.at(-1).complete();await flush();historyCheck();function historyCheck(){assert.equal(ui('undoStack.length'),1);ui('undo()');assert.equal(data(),before);}
}
for(const pattern of [false,true])for(const angle of [-10,10]){
 const {ui,input,data,history,get}=fixture();ui(pattern?"setTool('boltcircle');beginGroundPatternExtrusion([[[50,50],[60,50],[60,58],[50,58]],[[70,50],[80,50],[80,58],[70,58]]],'Bolts')":"setTool('rect');beginGroundExtrusion([[50,50],[60,50],[60,58],[50,58]])");input('pushTaperAngle',angle);input('groundHeight',5);assert.equal(ui('pointer.taperPreviews.length'),pattern?2:1);ui(pattern?'drawGroundPatternExtrudePreview()':'drawGroundExtrudePreview()');const before=data();get('applyGroundHeight').onclick();
 const first=ControlledWorker.instances.at(-1);assert.equal(first.request.type,'ground-taper');first.complete();await flush();if(pattern){assert.equal(data(),before);ControlledWorker.instances.at(-1).complete();await flush();}
 assert.equal(ui('tool'),pattern?'boltcircle':'rect');assert.equal(ui('objects.length'),pattern?3:2);assert.equal(ui('Math.min(...[...objects[1].solid.vertices.values()].map(v=>v.position[2]))'),0);assert.equal(ui('Math.max(...[...objects[1].solid.vertices.values()].map(v=>v.position[2]))'),5);history(before);
}
for(const mode of ['cancel','error','settings','invalid','invalid-twist']){
 const {ui,input,key,data}=fixture();ui("setTool('boltcircle');beginGroundPatternExtrusion([[[50,50],[60,50],[60,58],[50,58]],[[70,50],[80,50],[80,58],[70,58]]],'Bolts')");input('pushTaperAngle',10);input('groundHeight',5);const before=data(),count=ControlledWorker.instances.length;
 if(mode==='invalid'){ui('pointer.profiles[1]=[[0,0],[.1,0],[.1,1],[0,1]]');ui('commitGroundHeight()');assert.equal(ControlledWorker.instances.length,count);}
 else if(mode==='invalid-twist'){input('groundTwistAngle',361);ui('commitGroundHeight()');assert.equal(ControlledWorker.instances.length,count);}
 else{ui('commitGroundHeight()');ControlledWorker.instances.at(-1).complete();await flush();const worker=ControlledWorker.instances.at(-1);if(mode==='cancel')key('Escape');else if(mode==='settings'){input('pushTaperAngle',12);worker.complete();}else worker.onmessage({data:{type:'error',message:'Second profile failed'}});await flush();}
 assert.equal(data(),before);assert.equal(ui('undoStack.length'),0);assert.equal(ui('modelingOperationBusy'),false);assert.equal(ui('pointer.type'),'ground-extrude-pattern');
}
// Real separate-thread execution of the exact embedded worker, not only a VM transport.
try{
 const {ui,input,data,history}=fixture(ModelingWorker);input('pushTaperAngle',10);const before=data();let ticks=0;const timer=setInterval(()=>ticks++,1);ui('commitTaperedFaceFromUI(objects[0],testFace,3,10)');const worker=ModelingWorker.instances.at(-1);
 const deadline=performance.now()+15000;while(ui('modelingOperationBusy')&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));clearInterval(timer);
 assert.equal(ui('modelingOperationBusy'),false);assert.ok(ticks>0);assert.ok(worker.messages.some(m=>m.type==='progress'));assert.ok(worker.messages.some(m=>m.type==='result'));assert.equal(ui('validateSolid(objects[0].solid,false).ok'),true);history(before);
}finally{await ModelingWorker.closeAll();}
const template=fs.readFileSync(resolve(root,'src/template.html'),'utf8');assert.match(template,/id="pushTaperAngle"[^>]*min="-85"[^>]*max="85"/);
console.log('R229 tapered Push/Pull passed:',JSON.stringify(evidence),'signed numeric/pointer/panel paths, shared ground and atomic patterns, zero/live compatibility, invalid angle/collapse guards, source/settings/lock guards, worker progress/responsiveness/cancel, manifold native roundtrip and exact Undo/Redo.');
