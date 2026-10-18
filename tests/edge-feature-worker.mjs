import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..');
const source=fs.readFileSync(resolve(root,'build/edge-feature-worker.js'),'utf8');
const messages=[];
const sandbox={console,performance,structuredClone,Map,Set,Math,Number,String,Object,Array,Error,Infinity,postMessage:message=>messages.push(message)};
sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(source,sandbox);

// R163: inspect the actual graph without rebuilding or repairing it.
const objectCheckCases=vm.runInContext(`(()=>{
 const base=primitivePrism([[-5,-5],[5,-5],[5,5],[-5,5]],5,'object-check');
 const graph=s=>JSON.stringify({vertices:[...s.vertices],halfEdges:[...s.halfEdges],loops:[...s.loops],faces:[...s.faces],metadata:s.metadata});
 const cases=[];
 const probe=(label,solid)=>{const before=graph(solid);onmessage({data:{type:'object-check',solid}});cases.push({label,unchanged:before===graph(solid)});};
 probe('valid box',base);
 probe('valid through hole',prismRegion([[-5,-5],[5,-5],[5,5],[-5,5]],[ [[-1,-1],[-1,1],[1,1],[1,-1]] ],5,'object-check-hole'));
 const open=structuredClone(base);[...open.halfEdges.values()][0].twin='missing';probe('open edge',open);
 const chain=structuredClone(base);[...chain.halfEdges.values()][0].next='missing';probe('broken loop',chain);
 const warped=structuredClone(base);[...warped.vertices.values()][0].position[2]+=.1;probe('non-planar face',warped);
 const collapsed=structuredClone(base),edge=[...collapsed.halfEdges.values()][0];collapsed.vertices.get(collapsed.halfEdges.get(edge.next).origin).position=[...collapsed.vertices.get(edge.origin).position];probe('short edge',collapsed);
 const infinite=structuredClone(base);[...infinite.vertices.values()][0].position[0]=Infinity;probe('non-finite vertex',infinite);
 const normal=structuredClone(base);[...normal.faces.values()][0].plane.normal=[0,0,0];probe('non-unit normal',normal);
 const broken=structuredClone(base);[...broken.faces.values()][0].innerLoops=null;probe('incomplete graph',broken);
 return cases;
})()`,sandbox);
const objectCheckReports=messages.filter(message=>message.type==='object-check-result').map(message=>message.report);
assert.equal(objectCheckReports.length,objectCheckCases.length,'R163 every check must return a terminal report');
assert.ok(objectCheckCases.every(probe=>probe.unchanged),'R163 inspection mutated a source graph');
assert.ok(objectCheckReports.slice(0,2).every(report=>report.status==='passed'&&report.errors.length===0&&report.volume>0),'R163 valid box/hole failed');
const objectCheckExpected=['Open edge','Broken','Non-planar','Short edge','Non-finite','Non-unit'];
for(let i=0;i<objectCheckExpected.length;i++){
 assert.equal(objectCheckReports[i+2].status,'failed',`R163 ${objectCheckCases[i+2].label} falsely passed`);
 assert.ok(objectCheckReports[i+2].errors.some(error=>error.includes(objectCheckExpected[i])),`R163 ${objectCheckCases[i+2].label} missing diagnosis`);
}
assert.equal(objectCheckReports.at(-1).status,'incomplete','R163 an aborted check must never pass');
assert.equal(messages.filter(message=>message.type==='result').length,0,'R163 inspection must not return replacement geometry');
messages.length=0;

// R130: spatial welding must not materialize adjacent identical VertexIds as zero-length half-edges.
const postWeldCleanup=vm.runInContext(`(()=>{const s=buildSolidFromPolygons([{points:[[0,0,0],[1.2e-6,1.2e-6,0],[1,0,0],[0,1,0]]}],'r130-post-weld');return {vertices:s.vertices.size,halfEdges:s.halfEdges.size,short:csgShortEdgeDiagnostics(s)};})()`,sandbox);
assert.equal(postWeldCleanup.vertices,3,'R130 post-weld fixture did not weld the near-coincident vertices');
assert.equal(postWeldCleanup.halfEdges,3,'R130 post-weld cleanup still materialized a duplicate half-edge');
assert.equal(postWeldCleanup.short.count,0,'R130 post-weld cleanup left a zero/short half-edge');
const endpointSeamLimits=vm.runInContext(`csgSeamRepairLimits(0.075)`,sandbox);
assert.ok(endpointSeamLimits.maximumDeviation>=0.0005224,'R130 seam repair tube is too narrow for observed sub-micron CSG endpoint drift');
assert.ok(endpointSeamLimits.maximumPathExcess>=0.0002114,'R130 endpoint-local seam path is rejected solely by straight-edge path excess');

// R131: seam repair capacity must scale from the number of open edges rather than
// stop at the former fixed 64-pass ceiling. Each generated fixture needs one repair.
const repairBudgetStress=vm.runInContext(`(()=>{
  const vertices=new Map(),halfEdges=new Map(),loops=new Map(),faces=new Map();
  const count=65;
  for(let i=0;i<count;i++){
    const x=i*2,A='a'+i,B='b'+i,C='c'+i,fa='fa'+i,fb='fb'+i,la='la'+i,lb='lb'+i;
    vertices.set(A,{id:A,position:[x,0,0]});
    vertices.set(B,{id:B,position:[x+1,0,0]});
    vertices.set(C,{id:C,position:[x+.5,.0001,0]});
    faces.set(fa,{id:fa,plane:{normal:[0,0,1],offset:0},outerLoop:la,innerLoops:[]});
    faces.set(fb,{id:fb,plane:{normal:[0,0,1],offset:0},outerLoop:lb,innerLoops:[]});
    loops.set(la,{id:la,firstHalfEdge:'s'+i,kind:'outer'});
    loops.set(lb,{id:lb,firstHalfEdge:'p0_'+i,kind:'outer'});
    halfEdges.set('s'+i,{id:'s'+i,origin:A,twin:'',next:'db'+i,prev:'da'+i,loop:la,face:fa});
    halfEdges.set('db'+i,{id:'db'+i,origin:B,twin:'paired',next:'da'+i,prev:'s'+i,loop:la,face:fa});
    halfEdges.set('da'+i,{id:'da'+i,origin:A,twin:'paired',next:'s'+i,prev:'db'+i,loop:la,face:fa});
    halfEdges.set('p0_'+i,{id:'p0_'+i,origin:B,twin:'',next:'p1_'+i,prev:'pd'+i,loop:lb,face:fb});
    halfEdges.set('p1_'+i,{id:'p1_'+i,origin:C,twin:'',next:'pd'+i,prev:'p0_'+i,loop:lb,face:fb});
    halfEdges.set('pd'+i,{id:'pd'+i,origin:A,twin:'paired',next:'p0_'+i,prev:'p1_'+i,loop:lb,face:fb});
  }
  const solid={id:'r131',vertices,halfEdges,loops,faces,metadata:{}};
  const before=[...halfEdges.values()].filter(he=>!he.twin).length;
  const budget=csgSeamRepairBudget(before);
  const repaired=repairCsgOpenSeamChains(solid);
  const after=[...halfEdges.values()].filter(he=>!he.twin).length;
  return {before,budget,repaired,after};
})()`,sandbox);
assert.equal(repairBudgetStress.before,195,'R131 stress fixture does not contain 65 independent three-edge seams');
assert.equal(repairBudgetStress.budget,65,'R131 repair budget is not derived from the open-edge invariant');
assert.equal(repairBudgetStress.repaired,65,'R131 seam repair still stops at the former 64-pass ceiling');
assert.equal(repairBudgetStress.after,0,'R131 adaptive seam repair left generated open boundaries');

// R132: the boundary of coplanar polygons is their oriented edge sum. A near-degenerate sliver whose
// apex lies inside the edge-split tolerance of its base folds onto that base and must cancel itself;
// it must never cancel a same-direction segment of its neighbour. The former presence toggle did,
// which broke the traced loop, invented a closing edge, and dropped real face area (Rounded Chamfer
// after a long Thread failed with `Open edge`). The result must not depend on polygon order.
const orientedBoundary=vm.runInContext(`(()=>{
  const apex=[1+TOL.weld,.3,1],plane={normal:[0,0,1],offset:1},square=[[0,0,1],[1,0,1],[1,1,1],[0,1,1]],sliver=[[1,0,1],apex,[1,1,1]];
  const loops=polys=>boundaryLoopsFromPolygons(polys,plane).map(loop=>({points:loop.length,area:v2.area(loop.map(p=>[p[0],p[1]])),apex:loop.some(p=>V.near(p,apex))}));
  const walls=[[[0,0,0],[0,1,0],[1,1,0],[1,0,0]],[[0,0,0],[1,0,0],[1,0,1],[0,0,1]],[[0,1,0],[0,1,1],[1,1,1],[1,1,0]],[[0,0,0],[0,0,1],[0,1,1],[0,1,0]],[[1,0,0],[1,1,0],[1,1,1],apex,[1,0,1]]];
  const rebuild=top=>{const s=buildSolidFromPolygons([...walls,...top].map(points=>({points})),'r132-cube'),v=validateSolid(s,false);return {ok:v.ok,volume:v.volume,open:[...s.halfEdges.values()].filter(he=>!he.twin).length};};
  // Exact flank fragments from an exported M3 / 15 mm Thread + Rounded Chamfer failure: the last
  // polygon is a sliver whose apex lies 9.7e-8 mm from the shared diagonal of the previous one.
  const flank=${JSON.stringify([[[-8.751221248733053,-6.706091890693377,47.42049871593792],[-8.767736038388785,-6.831534171079108,47.489583333333336],[-8.970366530318989,-6.720455431223839,47.4485555812874]],[[-8.746070829328294,-6.6669705716488075,47.398953497293235],[-8.751221248733053,-6.706091890693377,47.42049871593792],[-8.970366530318989,-6.720455431223839,47.4485555812874],[-9.033109956425472,-6.686060505565213,47.435851561747754]],[[-8.738367644910191,-6.608459077419553,47.36672955988049],[-8.746070829328294,-6.6669705716488075,47.398953497293235],[-9.033109956425472,-6.686060505565213,47.435851561747754],[-9.423148567910298,-6.472247682796384,47.356878218259794]],[[-9.423148567910298,-6.472247682796384,47.356878218259794],[-9.422982034750515,-6.472280766315664,47.35688059141589],[-8.738367644910191,-6.608459077419553,47.36672955988049]]])};
  const flankPlane=planeFromPoints(flank[0]),basis=planeBasis(flankPlane,flank[0][0]),area2=poly=>v2.area(poly.map(p=>toPlane2(p,basis))),flankLoops=boundaryLoopsFromPolygons(flank,flankPlane);
  return {neighbourFirst:loops([square,sliver]),sliverFirst:loops([sliver,square]),cubeNeighbourFirst:rebuild([square,sliver]),cubeSliverFirst:rebuild([sliver,square]),flank:{loops:flankLoops.map(loop=>loop.length),area:flankLoops.reduce((sum,loop)=>sum+area2(loop),0),inputArea:flank.reduce((sum,poly)=>sum+area2(poly),0)}};
})()`,sandbox);
for(const order of ['neighbourFirst','sliverFirst']){
  const traced=orientedBoundary[order];
  assert.equal(traced.length,1,`R132 ${order} coplanar union did not trace exactly one boundary loop`);
  assert.equal(traced[0].points,5,`R132 ${order} boundary lost or duplicated a union vertex`);
  assert.ok(traced[0].apex,`R132 ${order} boundary skipped the sliver apex`);
  assert.ok(Math.abs(traced[0].area-1)<1e-6,`R132 ${order} boundary does not enclose the full union area`);
}
for(const order of ['cubeNeighbourFirst','cubeSliverFirst']){
  const cube=orientedBoundary[order];
  assert.equal(cube.open,0,`R132 ${order} reconstruction left open half-edges`);
  assert.ok(cube.ok,`R132 ${order} reconstruction is not a valid closed B-rep`);
  assert.ok(Math.abs(cube.volume-1)<1e-6,`R132 ${order} reconstruction changed the enclosed volume`);
}
assert.equal(orientedBoundary.flank.loops.length,1,'R132 exported Thread flank fragments did not trace one closed boundary');
assert.equal(orientedBoundary.flank.loops[0],8,'R132 exported Thread flank boundary lost the sliver apex or a split vertex');
assert.ok(Math.abs(orientedBoundary.flank.area-orientedBoundary.flank.inputArea)<1e-12,'R132 exported Thread flank boundary does not enclose the summed fragment area');

// R133: B-rep reconstruction accelerators are exact prefilters, never geometric decisions. The
// ordered split-candidate index must give splitEdgePoints the same accepted cuts in the same order
// as a direct scan (candidates on a shared x grid create exact parameter ties), the numeric weld
// grid must visit neighbour cells in the order of the former string-keyed grid, and offset-bucketed
// coplanar grouping must still join the first matching group in creation order, across buckets.
const exactAccelerators=vm.runInContext(`(()=>{
  let seed=133;const rnd=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648;};
  // Distant distractors make y the narrowest index axis, so an axis-ordered candidate list would
  // break those ties differently from the original order.
  const lateral=TOL.weld*3,points=[];for(let i=0;i<600;i++)points.push([Math.floor(rnd()*60)/6,(rnd()-.5)*2*lateral,(rnd()-.5)*2*lateral]);for(let i=0;i<2000;i++)points.push([rnd()*10,1+rnd(),(rnd()-.5)*2*lateral]);
  const index=orderedEdgeSplitIndex(points);let splitMismatches=0,ties=0,cuts=0;
  for(let n=0;n<400;n++){const a=[rnd()*3,0,0],b=[6+rnd()*4,0,0],direct=splitEdgePoints(a,b,points),indexed=splitEdgePoints(a,b,orderedEdgeSplitCandidates(index,a,b));if(JSON.stringify(direct)!==JSON.stringify(indexed))splitMismatches++;cuts+=direct.length-2;for(let i=1;i+1<direct.length;i++)if(direct[i][0]===direct[i+1][0])ties++;}
  const grid=weldGrid(TOL.topologyKey),legacy=new Map(),key=(x,y,z)=>x+','+y+','+z,cloud=[],nearby=[];let weldMismatches=0;
  for(let i=0;i<3000;i++){const p=[Math.floor(rnd()*12)*TOL.topologyKey*.9,Math.floor(rnd()*12)*TOL.topologyKey*.9,(rnd()-.5)*TOL.topologyKey*4],c=grid.cell(p),k=key(c[0],c[1],c[2]);grid.add(c,i);if(!legacy.has(k))legacy.set(k,[]);legacy.get(k).push(i);cloud.push(p);}
  for(const p of cloud){const c=grid.cell(p),expected=[];for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++)for(const i of legacy.get(key(c[0]+dx,c[1]+dy,c[2]+dz))||[])expected.push(i);if(JSON.stringify(grid.near(c,nearby))!==JSON.stringify(expected))weldMismatches++;}
  // Matching candidates must also satisfy the unchanged face planarity budget.
  // Keep each ambiguous match strictly inside it, avoiding a rounded equality.
  const bucket=BREP_REBUILD_POLICY.coplanarOffsetBucket,base=7*bucket,tri=(x,z)=>({points:[[x,0,z],[x+1,0,z],[x,1,z]]});
  const crossing=mergeCoplanarInputs([tri(0,base+bucket*.025),tri(2,base-bucket*.025)]).map(r=>r.plane.offset);
  // The third triangle matches both earlier groups; its bucket scan meets the later group first.
  const firstGroup=mergeCoplanarInputs([tri(0,base+bucket*1.06),tri(2,base+bucket*.94),tri(4,base+bucket*.98)]).map(r=>r.plane.offset);
  return {splitMismatches,ties,cuts,weldMismatches,crossing,firstGroup,bucket,base};
})()`,sandbox);
assert.equal(exactAccelerators.splitMismatches,0,'R133 indexed split candidates changed splitEdgePoints output');
assert.ok(exactAccelerators.cuts>100&&exactAccelerators.ties>0,'R133 split fixture does not exercise accepted cuts with exact parameter ties');
assert.equal(exactAccelerators.weldMismatches,0,'R133 numeric weld grid visits neighbour cells in a different order');
assert.equal(exactAccelerators.crossing.length,2,'R133 bucket-crossing fixture did not keep its two separate triangles');
assert.ok(exactAccelerators.crossing.every(offset=>offset===exactAccelerators.base+exactAccelerators.bucket*.025),'R133 coplanar grouping missed a group within tolerance in the adjacent offset bucket');
assert.equal(exactAccelerators.firstGroup.length,3,'R133 first-group fixture did not keep its three separate triangles');
assert.equal(exactAccelerators.firstGroup.filter(offset=>offset===exactAccelerators.base+exactAccelerators.bucket*.94).length,1,'R133 coplanar grouping assigned the first-group fixture triangles to the wrong groups');
assert.equal(exactAccelerators.firstGroup.filter(offset=>offset===exactAccelerators.base+exactAccelerators.bucket*1.06).length,2,'R133 coplanar grouping did not join the first matching group in creation order');

function takeResult(label){
  const updates=messages.filter(m=>m.type==='progress').map(m=>m.update),diagnostics=messages.filter(m=>m.type==='diagnostic').map(m=>m.event),progress=updates.map(update=>update.progress),result=messages.find(m=>m.type==='result'),failure=messages.find(m=>m.type==='error');
  assert.equal(failure,undefined,failure?.message);
  assert.ok(result?.solid,`${label} worker did not return a solid`);
  assert.ok(progress.length>=4&&progress[0]>=0&&progress.at(-1)===100,`${label} worker did not report staged progress through completion`);
  assert.ok(result.solid.faces.size>0&&result.solid.halfEdges.size>0,`${label} worker returned empty topology`);
  messages.length=0;
  return {solid:result.solid,progress,updates,diagnostics};
}

vm.runInContext(`
const workerThreadSolid=primitivePrism(cylinderProfile(6,6,16),4,'worker-thread');
let workerThreadInfo=null;
for(const he of workerThreadSolid.halfEdges.values()){const info=threadRimInfo(workerThreadSolid,he.id);if(info?.kind==='external'){workerThreadInfo=info;break;}}
if(!workerThreadInfo)throw Error('Worker thread fixture has no external circular rim');
onmessage({data:{type:'thread',solid:workerThreadSolid,halfEdgeId:workerThreadInfo.halfEdgeId,pitch:1,depth:.2,length:2.5,profileAngleDeg:60,direction:'right',operation:'add'}});
`,sandbox,{timeout:120000});
const thread=takeResult('Thread');

vm.runInContext(`
const workerSmallThreadSolid=primitivePrism(cylinderProfile(3,3,24),4,'worker-small-thread');
let workerSmallThreadInfo=null;
for(const he of workerSmallThreadSolid.halfEdges.values()){const info=threadRimInfo(workerSmallThreadSolid,he.id);if(info?.kind==='external'){workerSmallThreadInfo=info;break;}}
if(!workerSmallThreadInfo)throw Error('Small Thread fixture has no external circular rim');
onmessage({data:{type:'thread',solid:workerSmallThreadSolid,halfEdgeId:workerSmallThreadInfo.halfEdgeId,pitch:.5,depth:.225,length:2,profileAngleDeg:60,direction:'right',operation:'cut'}});
`,sandbox,{timeout:120000});
const smallThread=takeResult('Small Thread');
assert.ok(!smallThread.updates.some(update=>/retry/i.test(update.message||'')),'Small Thread still uses alignment retries instead of deterministic seam repair');
assert.ok(smallThread.diagnostics.some(event=>event.category==='thread'&&event.event==='rim'),'Small Thread diagnostic log is missing selected-rim data');
assert.ok(smallThread.diagnostics.some(event=>event.category==='csg'&&event.event==='seam-repair-summary'),'Small Thread diagnostic log is missing CSG seam-repair summary');
assert.ok(smallThread.diagnostics.some(event=>event.category==='brep'&&event.event==='validation-ok'),'Small Thread diagnostic log is missing B-rep validation outcome');

vm.runInContext(`
const workerScaledBase=primitivePrism([[-20,-15],[20,-15],[20,15],[-20,15]],20,'worker-scaled-seam-base');
const workerScaledPost=primitivePrism(cylinderProfile(11.313708499126328,11.313708499126328,48),17,'worker-scaled-seam-post');
const workerScaledUnion=unionSolids(workerScaledBase,{position:[0,0,0],rotation:[0,0,0]},workerScaledPost,{position:[-1,-2,20],rotation:[0,0,0]},'worker-scaled-seam-thread');
if(!workerScaledUnion.ok)throw Error('Scaled seam fixture union failed: '+workerScaledUnion.message);
const workerScaledSolid=workerScaledUnion.solid;
let workerScaledInfo=null;
for(const he of workerScaledSolid.halfEdges.values()){
  const info=threadRimInfo(workerScaledSolid,he.id);
  if(info?.kind==='external'&&Math.abs(info.radius-5.656854249563164)<1e-3&&info.maxLength>16){workerScaledInfo=info;break;}
}
if(!workerScaledInfo)throw Error('Scaled seam fixture has no expected external circular rim');
onmessage({data:{type:'thread',solid:workerScaledSolid,halfEdgeId:workerScaledInfo.halfEdgeId,pitch:.8,depth:.36,length:10,profileAngleDeg:60,direction:'right',operation:'add'}});
`,sandbox,{timeout:120000});
const scaledSeamThread=takeResult('Scaled seam Thread');
const scaledSummary=scaledSeamThread.diagnostics.find(event=>event.category==='csg'&&event.event==='seam-repair-summary');
assert.equal(scaledSummary?.data?.openEdgesAfter,0,'Scaled seam Thread left an open CSG boundary after repair');
const baseDeviation=Number(scaledSummary?.data?.policy?.basePlanarSeamDeviation||0);
const scaledRepair=scaledSeamThread.diagnostics.find(event=>event.category==='csg'&&event.event==='seam-repair');
assert.ok(scaledRepair,'Scaled seam Thread did not exercise deterministic CSG seam repair');
assert.ok(Number(scaledRepair.data.maximumDeviation)>=baseDeviation,'Scaled seam repair computed a deviation allowance below its base policy');
assert.ok(Number(scaledRepair.data.deviation)<=Number(scaledRepair.data.maximumDeviation),'Scaled seam repair exceeded its adaptive deviation limit');
assert.ok(Number(scaledRepair.data.pathExcess)<=Number(scaledRepair.data.maximumPathExcess),'Scaled seam repair exceeded its bounded path-excess policy');
assert.ok(scaledSeamThread.diagnostics.some(event=>event.category==='brep'&&event.event==='validation-ok'),'Scaled seam Thread did not validate after repair');

vm.runInContext(`
const workerRoundedSolid=primitivePrism([[-5,-5],[5,-5],[5,5],[-5,5]],10,'worker-rounded-chamfer');
let workerRoundedEdge=null;
for(const he of workerRoundedSolid.halfEdges.values()){
  const twin=workerRoundedSolid.halfEdges.get(he.twin),fa=workerRoundedSolid.faces.get(he.face),fb=twin&&workerRoundedSolid.faces.get(twin.face);
  if(twin&&fa&&fb&&he.id<he.twin&&Math.abs(V.dot(fa.plane.normal,fb.plane.normal))<1e-6){workerRoundedEdge=he;break;}
}
if(!workerRoundedEdge)throw Error('Worker Rounded Chamfer fixture has no 90-degree edge');
onmessage({data:{type:'rounded-chamfer',solid:workerRoundedSolid,halfEdgeId:workerRoundedEdge.id,distance:1,angleDeg:35,segments:4}});
`,sandbox,{timeout:120000});
const rounded=takeResult('Rounded Chamfer');
assert.ok(rounded.diagnostics.some(event=>event.category==='rounded-chamfer'&&event.event==='start'&&event.data?.angleDeg===35),'Rounded Chamfer diagnostic log is missing angle inputs');
assert.ok(rounded.diagnostics.some(event=>event.category==='csg'&&event.event==='seam-repair-summary'),'Rounded Chamfer diagnostic log is missing CSG seam-repair summary');
assert.ok(rounded.diagnostics.some(event=>event.category==='brep'&&event.event==='validation-ok'),'Rounded Chamfer diagnostic log is missing B-rep validation outcome');

vm.runInContext(`
const workerCarveSolid=primitivePrism(cylinderProfile(15,15,48),40,'worker-carve-out');
let workerCarveFace=null;for(const face of workerCarveSolid.faces.values())if(face.plane.normal[2]>.999&&Math.abs(face.plane.offset-40)<1e-6){workerCarveFace=face;break;}
if(!workerCarveFace)throw Error('Worker Carve Out fixture has no top opening face');
onmessage({data:{type:'carve-out',solid:workerCarveSolid,faceId:workerCarveFace.id,wallThickness:2,minimumInnerDetail:.5}});
`,sandbox,{timeout:120000});
const carve=takeResult('Carve Out');
assert.ok(carve.diagnostics.some(event=>event.category==='carve-out'&&event.event==='cavity-built'),'Carve Out diagnostic log is missing cavity construction data');
assert.ok(carve.diagnostics.some(event=>event.category==='carve-out'&&event.event==='complete'),'Carve Out diagnostic log is missing completion data');

// R161: Texture uses the same staged worker path, including areas above both old limits.
vm.runInContext(`
const workerTextureSolid=primitivePrism([[-36,-28],[36,-28],[36,28],[-36,28]],4,'worker-dense-texture'),workerTextureFace=[...workerTextureSolid.faces.values()].find(f=>f.plane.normal[2]>.999),workerTextureParameters={type:'squares',operation:'cut',spacing:2,size:.8,depth:.2,angleDeg:0,margin:.4,offsetX:0,offsetY:0,referencePoint:[0,0,4],referenceU:[1,0,0]},workerTextureBefore=JSON.stringify(serializeSolid(workerTextureSolid));
globalThis.workerTexturePreview=previewSurfaceTextureFaces(workerTextureSolid,[workerTextureFace.id],workerTextureParameters);
onmessage({data:{type:'surface-texture',solid:workerTextureSolid,faceIds:[workerTextureFace.id],parameters:workerTextureParameters}});
`,sandbox,{timeout:120000});
const texture=takeResult('Surface Texture');sandbox.workerTextureResult=texture.solid;
const textureValidation=vm.runInContext(`({validation:validateSolid(workerTextureResult,false),unchanged:JSON.stringify(serializeSolid(workerTextureSolid))===workerTextureBefore,volume:validateSolid(workerTextureSolid,false).volume})`,sandbox);
assert.ok(textureValidation.validation.ok,'R161 dense worker texture must validate');
assert.ok(textureValidation.unchanged,'R161 worker texture mutated its source');
assert.ok(sandbox.workerTexturePreview.instances>500&&sandbox.workerTexturePreview.components>900,'R161 dense fixture must exceed both old density limits');
assert.ok(textureValidation.validation.volume<textureValidation.volume,'R161 dense Cut must remove volume');
assert.ok(texture.progress.every((p,i)=>i===0||p>=texture.progress[i-1]),'R161 texture worker progress must be monotonic');
for(const type of ['pyramids','beveltiles','rooftiles']){
 sandbox.workerReliefType=type;
 vm.runInContext(`{const reliefSolid=primitivePrism([[-5,-5],[5,-5],[5,5],[-5,5]],3,'worker-relief'),reliefFace=[...reliefSolid.faces.values()].find(f=>f.plane.normal[2]>.999);onmessage({data:{type:'surface-texture',solid:reliefSolid,faceIds:[reliefFace.id],parameters:{type:workerReliefType,operation:'add',spacing:50,size:4,depth:.5,angleDeg:13,margin:.5,offsetX:0,offsetY:0,referencePoint:[0,0,3],referenceU:[1,0,0]}}});}`,sandbox);
 const relief=takeResult(type);sandbox.workerReliefResult=relief.solid;
 assert.ok(vm.runInContext('validateSolid(workerReliefResult,false).ok',sandbox),'R161 '+type+' worker relief must validate');
}
console.log(`Edge-feature worker passed: R130 post-weld/seam policy, R131 adaptive seam budget, Thread ${thread.solid.faces.size} faces/${thread.progress.length} progress updates; small Thread ${smallThread.solid.faces.size} faces without retries; scaled-seam Thread ${scaledSeamThread.solid.faces.size} faces with adaptive repair; Rounded Chamfer ${rounded.solid.faces.size} faces/${rounded.progress.length} progress updates; Carve Out ${carve.solid.faces.size} faces/${carve.progress.length} progress updates; Texture ${texture.solid.faces.size} faces/${texture.progress.length} progress updates, all three relief patterns.`);
