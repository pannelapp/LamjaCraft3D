import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';import {ModelingWorker} from './modeling-worker-fixture.mjs';import {clippedUnionArea} from './planar-area-fixture.mjs';
const root=resolve(process.env.LAMJACRAFT_CARVE_ROOT||resolve(import.meta.dirname,'..')),{sandbox,get}=createAppFixture(root,ModelingWorker),run=c=>vm.runInContext(c,sandbox),plain=x=>JSON.parse(JSON.stringify(x));
// The adapter lets the unchanged previous release run this same invariant.
run(`function testCarveRegions2(poly,wall){if(typeof carveInsetConcaveProfiles2==='function')return carveInsetConcaveProfiles2(poly,wall);const p=carveInsetConcaveProfile2(poly,wall);return p?[p]:null;}`);
const add=(a,b)=>a.map((x,i)=>x+b[i]),sub=(a,b)=>a.map((x,i)=>x-b[i]),mul=(a,k)=>a.map(x=>x*k),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),cross=(a,b)=>a[0]*b[1]-a[1]*b[0],unit=a=>mul(a,1/Math.hypot(...a)),area=p=>Math.abs(p.reduce((sum,a,i)=>sum+cross(a,p[(i+1)%p.length]),0)/2);
const policy={clearanceTolerance:2e-5,volumeTolerance:2e-4};
function points(facets=48,sweep=Math.PI/2){const p=[[-40,-30],[40,-30],[40,0]];for(let i=1;i<=facets;i++){const a=-Math.PI/2-i*sweep/facets;p.push([40+30*Math.cos(a),30+30*Math.sin(a)]);}p.push([-40,p.at(-1)[1]]);return p;}
// Independent mitered-wall reference: finite side strips plus the reflex-corner
// quadrilaterals form the wall region. Clip their UNION to the original source
// with a test-only arrangement sweep. This has no offset pruning/cavity/CSG path
// in common with the product and accounts for overlap without double counting.
function expectedInsetArea(poly,wall){
 if(poly.reduce((sum,a,i)=>sum+cross(a,poly[(i+1)%poly.length]),0)<0)poly=[...poly].reverse();
 const directions=poly.map((a,i)=>unit(sub(poly[(i+1)%poly.length],a))),normals=directions.map(t=>[-t[1],t[0]]),bands=poly.map((a,i)=>{const b=poly[(i+1)%poly.length],n=mul(normals[i],wall);return [a,b,add(b,n),add(a,n)];});
 for(let i=0;i<poly.length;i++){
  const prev=(i+poly.length-1)%poly.length;if(cross(directions[prev],directions[i])>=0)continue;
  const p=poly[i],a=normals[prev],b=normals[i],m=mul(add(a,b),wall/(1+dot(a,b)));bands.push([p,add(p,mul(a,wall)),add(p,m),add(p,mul(b,wall))]);
 }
 return area(poly)-clippedUnionArea(poly,bands);
}
function segmentDistance(p,a,b){const v=sub(b,a),length=dot(v,v),t=length?Math.max(0,Math.min(1,dot(sub(p,a),v)/length)):0;return Math.hypot(...sub(p,add(a,mul(v,t))));}
function checkInset(poly,inset,wall){
 assert.ok(inset&&inset.length>=3,'A valid inset must survive short-edge collapse');
 for(let i=0;i<inset.length;i++)for(let j=0;j<poly.length;j++){
  const a=inset[i],b=inset[(i+1)%inset.length],c=poly[j],d=poly[(j+1)%poly.length];
  const ab=sub(b,a),cd=sub(d,c),den=cross(ab,cd);if(Math.abs(den)>1e-10){const q=sub(c,a),s=cross(q,cd)/den,t=cross(q,ab)/den;assert.ok(!(s>0&&s<1&&t>0&&t<1),'Inset may not cross the exterior');}
  const clearance=Math.min(segmentDistance(a,c,d),segmentDistance(b,c,d),segmentDistance(c,a,b),segmentDistance(d,a,b));assert.ok(clearance+policy.clearanceTolerance>=wall,`Full-segment clearance ${clearance} is below requested wall ${wall}`);
 }
 return area(inset);
}
function install(poly,placed=false){sandbox.input=poly;sandbox.placed=placed;run(`var carveTransform={position:[13,-7,5],rotation:[19,-27,31]},carveSource=primitivePrism(input,30,'carve-inset-source');if(placed)carveSource=buildSolidFromPolygons([...carveSource.faces.values()].reverse().map(f=>({points:faceLoopPoints(carveSource,f.id).outer.map(p=>transformPoint(p,carveTransform))})),'placed-carve-inset');var carveOpening=[...carveSource.faces.values()].find(f=>V.dot(f.plane.normal,placed?transformDir([0,0,1],carveTransform):[0,0,1])>.99);`);}
function verify(solid,label){sandbox.carveResult=solid;const v=run('validateSolid(carveResult,false)');assert.equal(v.ok,true,label+': '+v.errors.join('; '));assert.deepEqual(plain(run('triangleMeshEdgeStats(solidMeshExportLocal(carveResult))')),{boundary:0,nonManifold:0},label+' watertight export');assert.equal(run('connectedSolidFaceComponents(carveResult).length'),1);assert.equal(run('JSON.stringify(serializeProjectSolid(deserializeProjectSolid(serializeProjectSolid(carveResult))))'),run('JSON.stringify(serializeProjectSolid(carveResult))'));return v.volume;}

function contactProfile(facets,start=-30){const begin=start*Math.PI/180,end=-240*Math.PI/180,x=25+15*Math.cos(begin),y=15*Math.sin(begin),p=[[-40,-24],[x,-24],[x,y]];for(let i=1;i<=facets;i++){const a=begin+(end-begin)*i/facets;p.push([25+15*Math.cos(a),15*Math.sin(a)]);}p.push([-40,p.at(-1)[1]]);return p;}
function regions(poly,wall){sandbox.input=poly;sandbox.wall=wall;const insets=plain(run('testCarveRegions2(input,wall)'));assert.ok(insets?.length,'A valid cavity must survive nonadjacent wall contact and the disappearing terminal edge');for(const inset of insets)checkInset(poly,inset,wall);const expected=expectedInsetArea(poly,wall),actual=insets.reduce((sum,p)=>sum+area(p),0);assert.ok(Math.abs(actual-expected)<policy.volumeTolerance,`All pockets must remain: ${actual} != independent erosion area ${expected}`);return {insets,expected};}
function commit(poly,wall,placed=false){const {insets,expected}=regions(poly,wall);install(poly,placed);sandbox.wall=wall;const before=run('JSON.stringify(serializeSolid(carveSource))'),result=run('carveOutSolid(carveSource,carveOpening.id,{wallThickness:wall,minimumInnerDetail:.5})');assert.ok(Math.abs(verify(result.solid,'Contact carve')-(area(poly)*30-expected*(30-wall)))<policy.volumeTolerance,'Independent sum-of-pockets volume');assert.equal(run('JSON.stringify(serializeSolid(carveSource))'),before);assert.equal(result.stats.cavityPlanes,insets.reduce((n,p)=>n+p.length,2));return insets;}
let cases=0,twoPocketCases=0;const evidence=[];
for(const facets of [23,24,47,48])for(const wall of [4.25,4.4,4.6,5,5.4,6,10]){const insets=commit(contactProfile(facets),wall);assert.equal(insets.length,wall>=4.6&&wall<=5?2:1);if(insets.length===2)twoPocketCases++;evidence.push({facets,wall,pockets:insets.length,vertices:insets.map(p=>p.length)});cases++;}
for(const facets of [24,48])for(const wall of [5.2,5.25,5.3,5.35]){commit(contactProfile(facets),wall);cases++;}
// Independently solve the exact terminal event: an original arc support line,
// inset by wall, passes through the inset bottom/right corner. Probe both sides
// and the event itself; losing a zero-area pocket must retain the main cavity.
for(const facets of [24,48]){
 const p=contactProfile(facets),right=p[1][0],events=[];
 for(let i=2;i<p.length-2;i++){
  const a=p[i],b=p[i+1],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),nx=-dy/length,ny=dx/length,c=nx*a[0]+ny*a[1],wall=(nx*right-24*ny-c)/(1+nx-ny);
  if(!(wall>5&&wall<5.4))continue;const foot=[right-wall-nx*wall,-24+wall-ny*wall],t=((foot[0]-a[0])*dx+(foot[1]-a[1])*dy)/(length*length);if(t>=0&&t<=1)events.push(wall);
 }
 assert.equal(events.length,1,'The terminal event must have one supporting segment');
 const eventProbe=.001;for(const delta of [-eventProbe,0,eventProbe]){assert.equal(commit(p,events[0]+delta).length,delta<0?2:1);cases++;}
}
// Different junction angles exercise the same nonlocal contact, beyond the
// particular vertical edge and arc tessellation visible in the screenshot.
for(const start of [-80,-30,0])for(const wall of [4.25,4.6,6]){commit(contactProfile(36,start),wall);cases++;}
const poly=contactProfile(48);for(const wall of [4.6,6])for(const shift of [2,19,40])for(const reverse of [false,true]){let moved=[...poly.slice(shift),...poly.slice(0,shift)];if(reverse)moved.reverse();regions(moved,wall);}
for(const wall of [4.6,6]){commit(poly,wall,true);cases++;}
// A narrow neck really produces two pockets: preserve both and validate the
// connected surrounding solid, rather than silently picking the larger one.
const neck=[[-20,-10],[-2,-10],[-2,-1],[2,-1],[2,-10],[20,-10],[20,10],[2,10],[2,1],[-2,1],[-2,10],[-20,10]];assert.equal(commit(neck,2).length,2);cases++;
for(const wall of [5,6,20]){sandbox.wall=wall;assert.equal(run('testCarveRegions2([[-5,-5],[5,-5],[5,5],[-5,5]],wall)'),null);}
// The actual guide/worker must represent both pockets, then one, at the exact
// requested wall. Camera navigation reuses the complete cached region set.
install(poly);run(`cancelGesture();replaceObjects([]);replaceGroups([]);replaceGuides([]);replaceDimensions([]);var carveObject=makeObject('box');carveObject.solid=carveSource;objects.push(carveObject);clearSelection(false);undoStack=[];redoStack=[];setTool('carve');chooseCarveOpening(carveObject,carveOpening.id);var savedRegions=carveInsetConcaveProfiles2,derivations=0;carveInsetConcaveProfiles2=(...args)=>{derivations++;return savedRegions(...args)};`);get('carveMinimumDetail').value='.5';
try{
 const wait=async()=>{const start=performance.now();while(run('modelingOperationBusy')){assert.ok(performance.now()-start<60000);await new Promise(r=>setTimeout(r,10));}};
 for(const wall of [4.6,6]){
  get('carveWallThickness').value=String(wall);sandbox.wall=wall;run('drawCarveOpeningPreview()');assert.equal(run('carveOpeningGuideCache.insets.length'),wall===4.6?2:1);const count=run('derivations');run('for(let i=0;i<20;i++){camera.yaw+=.01;cameraBasis();drawCarveOpeningPreview()}');assert.equal(run('derivations'),count);
  const guide=plain(run('carveOpeningGuideCache.insets')),before=run('snapshot()'),expected=expectedInsetArea(poly,wall);assert.ok(Math.abs(guide.reduce((n,p)=>n+area(p),0)-expected)<policy.volumeTolerance);
  get('applyCarveBtn').onclick();assert.equal(run('modelingOperationBusy'),true);assert.equal(run('snapshot()'),before);await wait();assert.equal(run('undoStack.length'),1,get('carveStatus').textContent);assert.ok(Math.abs(verify(run('carveObject.solid'),'Contact worker')-(area(poly)*30-expected*(30-wall)))<policy.volumeTolerance);const after=run('snapshot()');run('undo()');assert.equal(run('snapshot()'),before);run('redo()');assert.equal(run('snapshot()'),after);run('undo()');run('chooseCarveOpening(carveObject,carveOpening.id)');
 }
}finally{run('carveInsetConcaveProfiles2=savedRegions');await ModelingWorker.closeAll();}
const folder=resolve(root,'docs/verification/v169');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(resolve(folder,'carve-contacts.json'),JSON.stringify({cases,twoPocketCases,independentAreaAndVolume:true,actualWorkerWalls:[4.6,6],evidence},null,2)+'\n');console.log(`R269 Carve Out contacts passed: ${cases} valid solids, ${twoPocketCases} two-pocket arc cases, nonlocal contact/terminal-edge disappearance, alternate angles, cyclic/reversed/placed profiles, independent complete wall-union area and volume, full clearance, watertight export/native round-trip, split-neck preservation, exact guide/worker/Undo/Redo and cache reuse.`);
