import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
import {ModelingWorker} from './modeling-worker-fixture.mjs';
const root=resolve(process.env.LAMJACRAFT_SHORT_EDGE_ROOT||resolve(import.meta.dirname,'..')),{sandbox,get}=createAppFixture(root,ModelingWorker),run=c=>vm.runInContext(c,sandbox),plain=x=>JSON.parse(JSON.stringify(x));
const report={shortEdges:0,projectedCommits:0,holeOrientations:0,sourceUnchanged:true,exactHistory:true};
run(`var parent=primitivePrism([[-10,-10],[10,-10],[10,10],[-10,10]],20,'small-edge-source'),parentEdge=[...parent.halfEdges.values()].find(e=>{const a=parent.vertices.get(e.origin).position,b=parent.vertices.get(parent.halfEdges.get(e.next).origin).position;return Math.hypot(a[0]-10,a[1]-10,b[0]-10,b[1]-10)<1e-7;}),shortSource=roundedChamferEdgesSolid(parent,[parentEdge.id],2.65,45,32),shortCap=[...shortSource.faces.values()].find(f=>f.plane.normal[2]>.99),shortEdges=loopHalfEdges(shortSource,shortCap.outerLoop).filter(e=>{const a=shortSource.vertices.get(e.origin).position,b=shortSource.vertices.get(shortSource.halfEdges.get(e.next).origin).position;return V.len(V.sub(b,a))<.14;});var shortSeed=shortEdges[16];`);
const sourceBefore=run('JSON.stringify(serializeSolid(shortSource))');assert.equal(run('validateSolid(shortSource,false).ok'),true);
for(const id of plain(run('shortEdges.map(e=>e.id)'))){
 sandbox.shortId=id;const length=run('geometryApi.edge(shortSource,shortId)');assert.ok(Math.abs(Math.hypot(...length.b.map((v,i)=>v-length.a[i]))-.13)<.001,'Match the reported 0.13 mm scale');
 assert.equal(run('!!chamferCornerFrame(shortSource,shortSource.halfEdges.get(shortId))'),true,'A short convex material edge must remain eligible');
 assert.ok(run('geometryApi.chamferStraightCandidateEdges(shortSource,shortId)?.includes(shortId)'),'Ctrl admits the short edge');assert.ok(run('geometryApi.chamferCurveCandidateEdges(shortSource,shortId)?.includes(shortId)'),'Shift admits the short edge');
 assert.ok(run('chamferCornerFrame(shortSource,shortSource.halfEdges.get(shortSource.halfEdges.get(shortId).twin))'),'Twin orientation remains eligible');report.shortEdges++;
}
assert.equal(report.shortEdges,32);
// Independent direction witness: material lies toward the prism center, even
// when both old fixed-distance probes classify as fuzzy boundary points.
run(`var shortFrame=chamferCornerFrame(shortSource,shortSeed),shortMid=V.lerp(shortFrame.a,shortFrame.b,.5),shortDirection=edgeInteriorDirection(shortSource,shortCap.id,shortFrame.a,shortFrame.b);`);
assert.ok(run('V.dot(shortDirection,V.unit([-shortMid[0],-shortMid[1],0]))>.99'));
// Production passes the known half-edge and must never query fuzzy face domains.
run('var shortSavedDomain=pointInsideFaceDomain;pointInsideFaceDomain=()=>{throw Error("Unexpected Chamfer domain probe");};');assert.equal(run('!!chamferCornerFrame(shortSource,shortSeed)'),true);run('pointInsideFaceDomain=shortSavedDomain');
function verify(solid,label){sandbox.shortResult=solid;const v=run('validateSolid(shortResult,false)');assert.equal(v.ok,true,label+': '+v.errors.join('; '));assert.deepEqual(plain(run('triangleMeshEdgeStats(solidMeshExportLocal(shortResult))')),{boundary:0,nonManifold:0});assert.equal(run('connectedSolidFaceComponents(shortResult).length'),1);assert.equal(run('JSON.stringify(serializeProjectSolid(deserializeProjectSolid(serializeProjectSolid(shortResult))))'),run('JSON.stringify(serializeProjectSolid(shortResult))'));return v.volume;}
function setup(mode){sandbox.mode=mode;run(`cancelGesture();replaceObjects([]);replaceGroups([]);replaceGuides([]);replaceDimensions([]);var shortObject=makeObject('box');shortObject.solid=shortSource;shortObject.transform={position:[3,-5,7],rotation:[90,0,0]};objects.push(shortObject);clearSelection(false);undoStack=[];redoStack=[];setTool(mode);setDirtyState(false);camera.orthographic=true;camera.yaw=-Math.PI/2;camera.pitch=0;camera.target=transformPoint(shortMid,shortObject.transform);camera.distance=.5;cameraBasis();var inside=V.add(shortMid,V.mul(V.unit([-shortMid[0],-shortMid[1],0]),.001)),shortScreen=project(transformPoint(inside,shortObject.transform));`);for(const [id,value] of Object.entries({chamferDistance:'.02',chamferAngle:'45',roundedChamferRadius:'.02',roundedChamferAngle:'45',roundedChamferSegments:'6'}))get(id).value=value;}
async function idle(){const start=performance.now();while(run('modelingOperationBusy')){assert.ok(performance.now()-start<60000,'Short-edge worker timeout');await new Promise(r=>setTimeout(r,10));}}
try{
 for(const mode of ['chamfer','roundchamfer'])for(const gesture of ['direct','ctrl','shift']){
  setup(mode);const before=run('snapshot()'),workers=ModelingWorker.instances.length,[x,y]=plain(run('shortScreen'));sandbox.x=x;sandbox.y=y;
  const pick=run('topologyEdgeAt(x,y,hitTest(x,y))');assert.equal(pick?.kind,'edge','Real projected topology pick');sandbox.pick=pick;assert.equal(run('pick.halfEdgeId===shortSeed.id||pick.halfEdgeId===shortSeed.twin'),true,'Pick the short edge, not an adjacent long side');
  if(mode==='chamfer')run('updateToolHoverFeedback(chamferToolController,x,y)');
  const hover=run('chamferHover?.previewResult||null');sandbox.pointerEvent={button:0,pointerId:1,clientX:x,clientY:y,ctrlKey:gesture==='ctrl',shiftKey:gesture==='shift'};
  run('dispatchToolPointerDown(pointerEvent)');
  let preview=null;
  if(gesture!=='direct'){
   assert.equal(run('snapshot()'),before,'Held modifier does not mutate the model');assert.equal(ModelingWorker.instances.length,workers,'Selection does not start a worker');
   assert.ok(run('chamferEdgeSelection?.sides.flatMap(side=>side.halfEdgeIds).some(id=>id===shortSeed.id||id===shortSeed.twin)'),`${mode}/${gesture} selects the short member`);
   if(gesture==='shift')assert.ok(run('chamferEdgeSelection.sides.flatMap(side=>side.halfEdgeIds).length')>=32,'Shift follows the complete short curved chain');
   preview=run('chamferEdgeSelection.previewResult');run(`dispatchToolKeyUp({key:${JSON.stringify(gesture==='ctrl'?'Control':'Shift')},ctrlKey:false,shiftKey:false})`);
  }
  await idle();assert.equal(run('undoStack.length'),1,`${mode}/${gesture} commits once`);verify(run('shortObject.solid'),`${mode}/${gesture}`);
  if(mode==='chamfer'){sandbox.expectedShort=(gesture==='direct'?hover:preview)?.solid;assert.ok(sandbox.expectedShort,'Checked preview exists');assert.equal(run('JSON.stringify(serializeSolid(shortObject.solid))'),run('JSON.stringify(serializeSolid(expectedShort))'));}else assert.equal(run('lastRoundedChamferDiagnosticLog.outcome'),'success',run('lastRoundedChamferDiagnosticLog.error'));
  const after=run('snapshot()');run('undo()');assert.equal(run('snapshot()'),before);run('redo()');assert.equal(run('snapshot()'),after);report.projectedCommits++;
 }
 setup('roundchamfer');const beforeCancel=run('snapshot()');run('startRoundedChamfer(shortObject,shortSeed.id,.02,45,6);cancelModelingOperation()');await idle();assert.equal(run('snapshot()'),beforeCancel);assert.equal(run('undoStack.length'),0);
}finally{await ModelingWorker.closeAll();}
assert.equal(run('JSON.stringify(serializeSolid(shortSource))'),sourceBefore);
// Hole loops have the opposite winding but still keep material on the left.
// Their short rim edges remain convex Cut candidates with an outward cap ray.
run(`var smallHole=prismRegion([[-1,-1],[1,-1],[1,1],[-1,1]],[Array.from({length:16},(_,i)=>[.05*Math.cos(i*Math.PI/8),.05*Math.sin(i*Math.PI/8)])],2,'small-hole'),holeCap=[...smallHole.faces.values()].find(f=>f.plane.normal[2]>.99),holeEdges=loopHalfEdges(smallHole,holeCap.innerLoops[0]);`);
for(const id of plain(run('holeEdges.map(e=>e.id)'))){sandbox.holeId=id;assert.ok(run('chamferCornerFrame(smallHole,smallHole.halfEdges.get(holeId))'),'Short hole rim eligibility');assert.ok(run('(()=>{const e=smallHole.halfEdges.get(holeId),a=smallHole.vertices.get(e.origin).position,b=smallHole.vertices.get(smallHole.halfEdges.get(e.next).origin).position,d=edgeInteriorDirection(smallHole,holeCap.id,a,b),m=V.lerp(a,b,.5);return V.dot(d,[m[0],m[1],0])>0;})()'),'Hole material points away from its center');report.holeOrientations++;}
for(const rounded of [false,true]){sandbox.rounded=rounded;verify(run('rounded?roundedChamferEdgesSolid(smallHole,holeEdges.map(e=>e.id),.01,45,4):chamferEdgesSolid(smallHole,holeEdges.map(e=>e.id),.01,45)'),'Small hole rim');}
// Keep the existing material angle and convexity limits. Length eligibility
// must not make a concave Cut or a >178-degree edge admissible.
assert.ok(run('[...shortSource.halfEdges.values()].some(e=>{const tw=shortSource.halfEdges.get(e.twin),fa=shortSource.faces.get(e.face),fb=shortSource.faces.get(tw.face),angle=180-Math.acos(Math.max(-1,Math.min(1,V.dot(fa.plane.normal,fb.plane.normal))))*180/Math.PI;return angle>178&&angle<179&&!chamferCornerFrame(shortSource,e);})'));
run(`var valley=primitivePrism([[0,0],[10,0],[10,4],[4,4],[4,10],[0,10]],.13,'short-concave'),valleyEdge=[...valley.halfEdges.values()].find(e=>{const a=valley.vertices.get(e.origin).position,b=valley.vertices.get(valley.halfEdges.get(e.next).origin).position;return Math.hypot(a[0]-4,a[1]-4,b[0]-4,b[1]-4)<1e-7;});`);assert.equal(run('chamferCornerFrame(valley,valleyEdge)'),null);assert.ok(run('chamferCornerFrame(valley,valleyEdge,"extend")'));
const folder=resolve(root,'docs/verification/v164');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(resolve(folder,'short-edges.json'),JSON.stringify(report,null,2)+'\n');
console.log(`R265 short Chamfer edges passed: ${report.shortEdges} convex edges around 0.13 mm, ${report.projectedCommits} real projected direct/Ctrl/Shift commits in both modes, ${report.holeOrientations} short hole orientations, zero domain probes, exact preview/Undo/Redo, actual worker/cancel and unchanged angle/convexity guards.`);
