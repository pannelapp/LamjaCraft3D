import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
import {ModelingWorker} from './modeling-worker-fixture.mjs';

const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root,ModelingWorker),run=code=>vm.runInContext(code,sandbox),plain=value=>JSON.parse(JSON.stringify(value));
const concave=[[-40,-30],[40,-30],[40,0]];
for(let i=1;i<=12;i++){const a=-Math.PI/2-i*Math.PI/24;concave.push([40+30*Math.cos(a),30+30*Math.sin(a)]);}
concave.push([-40,30]);
const convex=[[-30,-20],[25,-20],[35,-5],[32,20],[0,30],[-25,20]],height=20;
const profile=(distance,bias,segments)=>{const depth=distance*Math.tan(bias*Math.PI/180);return segments===null?[[distance,0],[0,depth]]:Array.from({length:segments+1},(_,i)=>[distance*(1-Math.sin(Math.PI*i/(2*segments))),depth*(1-Math.cos(Math.PI*i/(2*segments)))]);};
// Independent parallel-polygon area integration: A(x)=A-P*x+S*x^2,
// S=sum(tan(signed turn/2)). Integrate each linear faceted profile exactly.
function removedVolume(points,section,extend=false){
 const directions=points.map((p,i)=>{const q=points[(i+1)%points.length],length=Math.hypot(q[0]-p[0],q[1]-p[1]);return [(q[0]-p[0])/length,(q[1]-p[1])/length,length];});
 const perimeter=directions.reduce((sum,d)=>sum+d[2],0),sumTurns=directions.reduce((sum,d,i)=>{const p=directions[(i+directions.length-1)%directions.length];return sum+(p[0]*d[1]-p[1]*d[0])/(1+p[0]*d[0]+p[1]*d[1]);},0);
 return section.slice(1).reduce((sum,[b,zb],i)=>{const [a,za]=section[i];return sum+(zb-za)*(perimeter*(a+b)/2+(extend?1:-1)*sumTurns*(a*a+a*b+b*b)/3);},0);
}
function source(points){sandbox.input=points;run("var joinedSource=primitivePrism(input,20,'connected-profile'),joinedFace=[...joinedSource.faces.values()].find(f=>f.plane.normal[2]>.99),joinedIds=loopHalfEdges(joinedSource,joinedFace.outerLoop).map(e=>e.id)");}
function verify(solid,label){sandbox.joinedResult=solid;const checked=run('validateSolid(joinedResult,false)');assert.equal(checked.ok,true,label+': '+checked.errors.join('; '));assert.deepEqual(plain(run('triangleMeshEdgeStats(solidMeshExportLocal(joinedResult))')),{boundary:0,nonManifold:0},label+' closed export');assert.equal(run('connectedSolidFaceComponents(joinedResult).length'),1);assert.equal(run('JSON.stringify(serializeProjectSolid(deserializeProjectSolid(serializeProjectSolid(joinedResult))))'),run('JSON.stringify(serializeProjectSolid(joinedResult))'),label+' native round-trip');return checked.volume;}
let cases=0;
for(const points of [convex,concave])for(const bias of [30,45,60])for(const segments of [null,2,6,12]){
 source(points);sandbox.bias=bias;sandbox.segments=segments;
 const before=run('JSON.stringify(serializeSolid(joinedSource))'),volume=run('validateSolid(joinedSource,false).volume');
 const result=run("segments===null?geometryApi.chamferStraightEdges(joinedSource,joinedIds,1,bias):{solid:roundedChamferEdgesSolid(joinedSource,joinedIds,1,bias,segments)}");
 const expected=removedVolume(points,profile(1,bias,segments)),actual=volume-verify(result.solid,`Connected closed ${points===concave?'concave':'convex'}/${bias}/${segments}`);
 assert.ok(Math.abs(actual-expected)<1e-5,`Independent mitered profile volume ${actual} vs ${expected}`);
 assert.equal(run('JSON.stringify(serializeSolid(joinedSource))'),before,'Canonical source remains unchanged');
 sandbox.joinedExpected=result.solid;
 const reversed=run('segments===null?chamferEdgesSolid(joinedSource,[...joinedIds].reverse(),1,bias):roundedChamferEdgesSolid(joinedSource,[...joinedIds].reverse(),1,bias,segments)');
 sandbox.joinedReversed=reversed;assert.equal(run('JSON.stringify(serializeSolid(joinedReversed))'),run('JSON.stringify(serializeSolid(joinedExpected))'));
 cases++;
}
// Both cap- and wall-picked extensions retain independent volume expectations.
for(const points of [convex,concave])for(const segments of [null,6])for(const bias of [35,45]){
 source(points);sandbox.segments=segments;sandbox.bias=bias;
 const original=run('validateSolid(joinedSource,false).volume');
 const extended=run("segments===null?chamferEdgesSolid(joinedSource,joinedIds,.7,bias,'extend'):roundedChamferEdgesSolid(joinedSource,joinedIds,.7,bias,segments,undefined,undefined,'extend')");
 const added=verify(extended,'Connected outward extension')-original;
 assert.ok(Math.abs(added-removedVolume(points,profile(.7,bias,segments),true))<1e-5,'Independent joined outward extension volume');
 const wall=run("segments===null?chamferEdgesSolid(joinedSource,joinedIds.map(id=>joinedSource.halfEdges.get(id).twin),.7,bias,'extend'):roundedChamferEdgesSolid(joinedSource,joinedIds.map(id=>joinedSource.halfEdges.get(id).twin),.7,bias,segments,undefined,undefined,'extend')");
 const wallAdded=verify(wall,'Connected wall-picked extension')-original;assert.ok(Math.abs(wallAdded-removedVolume(points,profile(.7*Math.tan(bias*Math.PI/180),90-bias,segments)))<1e-5,'Independent joined wall extension volume');assert.ok([...wall.vertices.values()].some(v=>v.position[2]>height),'Wall-picked extension stays above the cap');
 assert.ok([...extended.vertices.values()].every(v=>v.position[2]<=height+1e-6),'Cap-picked extension stays below the cap');cases++;
}
source(concave);
run('var openIds=joinedIds.slice(2,-1),openEdges=openIds.map(id=>joinedSource.halfEdges.get(id));');
const ordered=plain(run('openEdges.map(e=>joinedSource.vertices.get(e.origin).position).concat([joinedSource.vertices.get(joinedSource.halfEdges.get(openEdges.at(-1).next).origin).position])'));
function sharedStations(solid,distance,bias,segments,pathPoints=ordered){
 const vertices=[...solid.vertices.values()].map(v=>Array.from(v.position)),section=profile(distance,bias,segments);let checked=0;
 for(let i=1;i<pathPoints.length-1;i++){
  const p=pathPoints[i],normal=(a,b)=>{const length=Math.hypot(b[0]-a[0],b[1]-a[1]);return [-(b[1]-a[1])/length,(b[0]-a[0])/length];},a=normal(pathPoints[i-1],p),b=normal(p,pathPoints[i+1]),denominator=1+a[0]*b[0]+a[1]*b[1],miter=[(a[0]+b[0])/denominator,(a[1]+b[1])/denominator];
  for(const [inset,depth] of section){const q=[p[0]+miter[0]*inset,p[1]+miter[1]*inset,height-depth];assert.ok(vertices.some(v=>Math.hypot(...v.map((x,j)=>x-q[j]))<1e-5),`Missing shared profile station ${q}`);checked++;}
 }
 return checked;
}
const open=run('roundedChamferEdgesSolid(joinedSource,openIds,1,35,8)');verify(open,'Connected open concave arc');const stations=sharedStations(open,1,35,8);
const symmetric=run('roundedChamferEdgesSolid(joinedSource,joinedIds,1,45,6)');sandbox.joinedExpected=symmetric;
const twins=run('roundedChamferEdgesSolid(joinedSource,joinedIds.map(id=>joinedSource.halfEdges.get(id).twin),1,45,6)');sandbox.joinedTwins=twins;assert.equal(run('JSON.stringify(serializeSolid(joinedTwins))'),run('JSON.stringify(serializeSolid(joinedExpected))'));
const wall=run('roundedChamferEdgesSolid(joinedSource,joinedIds.map(id=>joinedSource.halfEdges.get(id).twin),1,35,6)');
const wallLoss=run('validateSolid(joinedSource,false).volume')-verify(wall,'Joined wall-side unequal setbacks');
assert.ok(Math.abs(wallLoss-removedVolume(concave,profile(Math.tan(35*Math.PI/180),55,6)))<1e-5,'Wall-side picks must exchange physical setbacks, not silently change their bias');
try{
 run("var joinedJob=geometryApi.roundedChamferStraightEdgesAsync(joinedSource,openIds,1,35,8)");
 const prepared=await run('joinedJob.promise');sandbox.workerResult=prepared.solid;sandbox.openExpected=open;
 assert.equal(run('JSON.stringify(serializeSolid(workerResult))'),run('JSON.stringify(serializeSolid(openExpected))'));
 run("cancelGesture();replaceObjects([]);replaceGroups([]);replaceGuides([]);replaceDimensions([]);var joinedObject=makeObject('box');joinedObject.solid=joinedSource;joinedObject.transform={position:[3,-5,8],rotation:[23,41,-17]};objects.push(joinedObject);clearSelection(false);undoStack=[];redoStack=[];setTool('roundchamfer');");
 get('roundedChamferRadius').value='1';get('roundedChamferAngle').value='35';get('roundedChamferSegments').value='8';
 const before=run('snapshot()'),workers=ModelingWorker.instances.length;
 for(const id of plain(run('openIds'))){sandbox.pick=id;run("topologyEdgeAt=()=>({kind:'edge',objectId:joinedObject.id,halfEdgeId:pick});roundedChamferToolController.pointerDown({event:{ctrlKey:true},x:0,y:0,hit:{id:joinedObject.id,face:joinedFace.id}})");}
 assert.equal(run('snapshot()'),before);assert.equal(ModelingWorker.instances.length,workers,'Selecting does not start workers');
 run("dispatchToolKeyUp({key:'Control',ctrlKey:false,shiftKey:false})");
 const started=performance.now();while(run('modelingOperationBusy')){assert.ok(performance.now()-started<60000,'Joined worker timeout');await new Promise(r=>setTimeout(r,10));}
 assert.equal(run('lastRoundedChamferDiagnosticLog.outcome'),'success',run('lastRoundedChamferDiagnosticLog.error'));
 assert.equal(run('undoStack.length'),1);assert.equal(run('JSON.stringify(serializeSolid(joinedObject.solid))'),run('JSON.stringify(serializeSolid(openExpected))'));
 assert.ok(run("lastRoundedChamferDiagnosticLog.events.some(e=>e.event==='corner-geometry'&&e.data.kind==='connected-path')"));
 const after=run('snapshot()');run('undo()');assert.equal(run('snapshot()'),before);run('redo()');assert.equal(run('snapshot()'),after);
 run('undo();var joinedCancelled=geometryApi.roundedChamferStraightEdgesAsync(joinedSource,openIds,1,35,8);joinedCancelled.cancel()');await assert.rejects(run('joinedCancelled.promise'),/cancelled/);assert.equal(run('snapshot()'),before);
}finally{await ModelingWorker.closeAll();}
for(const facets of [18,24]){
 const points=[[-40,-30],[60,-30],[60,0],[40,0]];
 for(let i=1;i<=facets;i++){const a=-Math.PI/2-i*Math.PI/(2*facets);points.push([40+30*Math.cos(a),30+30*Math.sin(a)]);}points.push([10,50],[-40,50]);source(points);
 const original=run('validateSolid(joinedSource,false).volume'),closed=run('roundedChamferEdgesSolid(joinedSource,joinedIds,3,45,8)');
 const loss=original-verify(closed,'Dense closed shared shell');assert.ok(Math.abs(loss-removedVolume(points,profile(3,45,8)))<1e-5,'Independent dense joined volume');
 const ids=plain(run('joinedIds.slice(2,-1)'));sandbox.denseIds=ids;
 const open=run('roundedChamferEdgesSolid(joinedSource,denseIds,3,45,8)');verify(open,'Dense open shared shell');
 const pathPoints=plain(run('denseIds.map(id=>joinedSource.vertices.get(joinedSource.halfEdges.get(id).origin).position).concat([joinedSource.vertices.get(joinedSource.halfEdges.get(joinedSource.halfEdges.get(denseIds.at(-1)).next).origin).position])'));
 sharedStations(open,3,45,8,pathPoints);cases++;
}
const sharp=[[-40,-30],[40,-30],[40,0]];for(let i=1;i<=18;i++){const a=-Math.PI/2-i*Math.PI/36;sharp.push([40+30*Math.cos(a),30+30*Math.sin(a)]);}sharp.push([-40,30]);source(sharp);
// A mixed convex/concave transition used to be rejected as exhausted material.
// Its folded local miter now uses the exact joined-run Boolean envelope; R267
// independently integrates this newly supported profile. Keep true guards below.
const sharpBefore=run('JSON.stringify(serializeSolid(joinedSource))'),sharpVolume=run('validateSolid(joinedSource,false).volume');
const sharpJoined=run('roundedChamferEdgesSolid(joinedSource,joinedIds.slice(2,-1),3,45,8)');assert.ok(verify(sharpJoined,'Mixed-turn joined envelope')<sharpVolume);assert.equal(run('JSON.stringify(serializeSolid(joinedSource))'),sharpBefore);cases++;
source([[0,0],[100,0],[100,1]]);const rejected=run('JSON.stringify(serializeSolid(joinedSource))');assert.throws(()=>run('roundedChamferEdgesSolid(joinedSource,joinedIds,1,45,6)'),/unstable corner/);assert.equal(run('JSON.stringify(serializeSolid(joinedSource))'),rejected);
source([[-5,-5],[5,-5],[5,5],[-5,5]]);assert.throws(()=>run('roundedChamferEdgesSolid(joinedSource,joinedIds,6,45,6)'),/profile stations overlap/);
const folder=resolve(root,'docs/verification/v161');fs.mkdirSync(folder,{recursive:true});
fs.writeFileSync(resolve(folder,'connected-chamfer.json'),JSON.stringify({cases,sharedStations:stations,independentVolume:true,closedExport:true,nativeRoundTrip:true,realWorkerAndCtrlSelection:true,exactUndoRedo:true},null,2)+'\n');
console.log(`R261 connected Chamfer passed: ${cases} independent convex/concave volume cases, ${stations} shared open-arc profile stations, selection-order/twin invariance, closed export/native reopen, real worker/Ctrl release, one-command history, exact Undo/Redo and atomic cancellation/rejection.`);
