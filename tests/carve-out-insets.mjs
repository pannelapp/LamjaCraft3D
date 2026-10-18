import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';import {ModelingWorker} from './modeling-worker-fixture.mjs';import {clippedUnionArea} from './planar-area-fixture.mjs';
const root=resolve(process.env.LAMJACRAFT_CARVE_ROOT||resolve(import.meta.dirname,'..')),{sandbox,get}=createAppFixture(root,ModelingWorker),run=c=>vm.runInContext(c,sandbox),plain=x=>JSON.parse(JSON.stringify(x));
run(`function testSingleCarveInset2(input,distance){const insets=carveInsetConcaveProfiles2(input,distance);return insets?.length===1?insets[0]:null;}`);
const add=(a,b)=>a.map((x,i)=>x+b[i]),sub=(a,b)=>a.map((x,i)=>x-b[i]),mul=(a,k)=>a.map(x=>x*k),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),cross=(a,b)=>a[0]*b[1]-a[1]*b[0],unit=a=>mul(a,1/Math.hypot(...a)),area=p=>Math.abs(p.reduce((sum,a,i)=>sum+cross(a,p[(i+1)%p.length]),0)/2);
const policy={clearanceTolerance:2e-5,volumeTolerance:2e-4};
function points(facets=48,sweep=Math.PI/2){const p=[[-40,-30],[40,-30],[40,0]];for(let i=1;i<=facets;i++){const a=-Math.PI/2-i*sweep/facets;p.push([40+30*Math.cos(a),30+30*Math.sin(a)]);}p.push([-40,p.at(-1)[1]]);return p;}
// Independent mitered-wall reference: finite side strips plus the reflex-corner
// quadrilaterals form the wall region. Clip their UNION to the original source
// with a test-only arrangement sweep. This has no offset pruning/cavity/CSG path
// in common with the product and accounts for overlap without double counting.
function expectedInsetArea(poly,wall){
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
 const expected=expectedInsetArea(poly,wall);assert.ok(Math.abs(area(inset)-expected)<policy.volumeTolerance,`Independent mitered inset area ${area(inset)} != ${expected}`);return expected;
}
function install(poly,placed=false){sandbox.input=poly;sandbox.placed=placed;run(`var carveTransform={position:[13,-7,5],rotation:[19,-27,31]},carveSource=primitivePrism(input,30,'carve-inset-source');if(placed)carveSource=buildSolidFromPolygons([...carveSource.faces.values()].reverse().map(f=>({points:faceLoopPoints(carveSource,f.id).outer.map(p=>transformPoint(p,carveTransform))})),'placed-carve-inset');var carveOpening=[...carveSource.faces.values()].find(f=>V.dot(f.plane.normal,placed?transformDir([0,0,1],carveTransform):[0,0,1])>.99);`);}
function verify(solid,label){sandbox.carveResult=solid;const v=run('validateSolid(carveResult,false)');assert.equal(v.ok,true,label+': '+v.errors.join('; '));assert.deepEqual(plain(run('triangleMeshEdgeStats(solidMeshExportLocal(carveResult))')),{boundary:0,nonManifold:0},label+' watertight export');assert.equal(run('connectedSolidFaceComponents(carveResult).length'),1);assert.equal(run('JSON.stringify(serializeProjectSolid(deserializeProjectSolid(serializeProjectSolid(carveResult))))'),run('JSON.stringify(serializeProjectSolid(carveResult))'));return v.volume;}
let cases=0,collapsedCases=0;
for(const facets of [48,24,12])for(const wall of [1.65,3,6,18]){
 const poly=points(facets);install(poly);sandbox.wall=wall;const inset=plain(run('testSingleCarveInset2(input,wall)')),expectedArea=checkInset(poly,inset,wall);if(inset.length<poly.length)collapsedCases++;
 const before=run('JSON.stringify(serializeSolid(carveSource))'),result=run('carveOutSolid(carveSource,carveOpening.id,{wallThickness:wall,minimumInnerDetail:.5})'),volume=verify(result.solid,`Facets ${facets} wall ${wall}`);
 assert.ok(Math.abs(volume-(area(poly)*30-expectedArea*(30-wall)))<policy.volumeTolerance,'Independent cavity/floor volume');assert.equal(result.stats.cavityPlanes,inset.length+2,'Diagnostics must count the surviving inner planes');assert.equal(run('JSON.stringify(serializeSolid(carveSource))'),before);cases++;
}
for(const poly of [points(24,Math.PI),[[-10,-10],[10,-10],[10,-2],[2,-2],[2,10],[-10,10]],[[0,0],[60,0],[2,20]],[[0,0],[60,0],[60,20],[30,20],[29.8,19.8],[29.6,20],[0,20]]]){
 const wall=2;sandbox.input=poly;sandbox.wall=wall;checkInset(poly,plain(run('testSingleCarveInset2(input,wall)')),wall);cases++;
}
// Cyclic starts/reversal must not make event handling depend on loop numbering.
const poly=points(48);sandbox.input=poly;const expected=checkInset(poly,plain(run('testSingleCarveInset2(input,6)')),6);
for(const shift of [3,17,30])for(const reverse of [false,true]){const moved=[...poly.slice(shift),...poly.slice(0,shift)];if(reverse)moved.reverse();sandbox.input=moved;checkInset(poly,plain(run('testSingleCarveInset2(input,6)')),6);}
install(poly,true);const placed=run('carveOutSolid(carveSource,carveOpening.id,{wallThickness:6,minimumInnerDetail:.5})');assert.ok(Math.abs(verify(placed.solid,'Rigid opening')-(area(poly)*30-expected*24))<policy.volumeTolerance);cases++;
// True exhaustion, narrow bridges/split cavities and invalid parameters stay
// rejected. A small phantom inset must not reappear after global collapse.
for(const wall of [5,6,20]){sandbox.wall=wall;assert.equal(run('testSingleCarveInset2([[-5,-5],[5,-5],[5,5],[-5,5]],wall)'),null);}
for(const wall of [NaN,Infinity,0,-1]){sandbox.wall=wall;assert.equal(run('testSingleCarveInset2([[-5,-5],[5,-5],[5,5],[-5,5]],wall)'),null);}
const neck=[[-20,-10],[-2,-10],[-2,-1],[2,-1],[2,-10],[20,-10],[20,10],[2,10],[2,1],[-2,1],[-2,10],[-20,10]];sandbox.input=neck;assert.equal(run('testSingleCarveInset2(input,2)'),null,'Do not silently choose one branch of a split inset');
// Exact-source, wall and transform keys cache both valid and unavailable guides.
install(poly);run(`cancelGesture();replaceObjects([]);replaceGroups([]);replaceGuides([]);replaceDimensions([]);var carveObject=makeObject('box');carveObject.solid=carveSource;carveObject.transform={position:[4,-7,11],rotation:[21,17,-13]};objects.push(carveObject);clearSelection(false);undoStack=[];redoStack=[];setTool('carve');chooseCarveOpening(carveObject,carveOpening.id);testInset=carveInsetConcaveProfiles2;testInsetCalls=0;carveInsetConcaveProfiles2=(...args)=>{testInsetCalls++;return testInset(...args)};`);
get('carveWallThickness').value='6';get('carveMinimumDetail').value='.5';const before=run('snapshot()');
try{
 run('cameraBasis();for(let i=0;i<20;i++){camera.yaw+=.01;cameraBasis();drawCarveOpeningPreview();}');assert.equal(run('testInsetCalls'),1,'Camera redraws must reuse the planar guide');assert.equal(run('snapshot()'),before);
 get('carveWallThickness').value='18';run('drawCarveOpeningPreview()');assert.equal(run('testInsetCalls'),2);assert.ok(run('carveOpeningGuideCache.insets[0].length<carveOpeningGuideCache.outer.length'));
 run('carveObject.transform.position[0]++;drawCarveOpeningPreview()');assert.equal(run('testInsetCalls'),3);
 run('carveObject.solid=cloneSolid(carveObject.solid);drawCarveOpeningPreview()');assert.equal(run('testInsetCalls'),4);
 get('carveWallThickness').value='100';run('for(let i=0;i<10;i++)drawCarveOpeningPreview()');assert.equal(run('testInsetCalls'),5);assert.equal(run('carveOpeningGuideCache.insets'),null);
 run("handleToolEscape()");assert.equal(run('carveOpeningGuideCache'),null);assert.equal(run('tool'),'carve');
}finally{run('carveInsetConcaveProfiles2=testInset');}
// Actual face picking and the shipped worker, including progress, prepared
// commit/Undo/Redo, source staleness and cancellation at the newly valid wall.
try{
 run(`chooseCarveOpening(carveObject,carveOpening.id);clearCarveTarget();var n=V.unit(transformDir(carveOpening.plane.normal,carveObject.transform));camera.target=transformPoint([-20,0,30],carveObject.transform);camera.distance=140;camera.yaw=Math.atan2(n[1],n[0]);camera.pitch=Math.asin(n[2]);camera.orthographic=true;cameraBasis();dispatchToolPointerDown({button:0,clientX:W/2,clientY:H/2,pointerId:1});`);assert.equal(run('carveTarget.faceId'),run('carveOpening.id'));
 get('carveWallThickness').value='18';const commandBefore=run('snapshot()');get('applyCarveBtn').onclick();assert.equal(run('modelingOperationBusy'),true);assert.equal(run('snapshot()'),commandBefore);
 const wait=async()=>{const start=performance.now();while(run('modelingOperationBusy')){assert.ok(performance.now()-start<60000,'Carve worker timeout');await new Promise(r=>setTimeout(r,10));}};await wait();assert.equal(run('undoStack.length'),1,get('carveStatus').textContent);assert.equal(run('tool'),'carve');assert.equal(run('carveTarget'),null);assert.equal(run('carveOpeningGuideCache'),null);
 const expectedArea=expectedInsetArea(poly,18);assert.ok(Math.abs(verify(run('carveObject.solid'),'Worker carve')-(area(poly)*30-expectedArea*12))<policy.volumeTolerance);const after=run('snapshot()');run('undo()');assert.equal(run('snapshot()'),commandBefore);run('redo()');assert.equal(run('snapshot()'),after);run('undo()');
 run('chooseCarveOpening(carveObject,carveOpening.id)');get('applyCarveBtn').onclick();run('cancelModelingOperation()');await wait();assert.equal(run('snapshot()'),commandBefore);assert.equal(run('undoStack.length'),0);
 get('applyCarveBtn').onclick();run('carveObject.solid=cloneSolid(carveObject.solid);modelRevision++');await wait();assert.equal(run('snapshot()'),commandBefore);assert.equal(run('undoStack.length'),0);assert.match(get('carveStatus').textContent,/changed|stale/i);
}finally{await ModelingWorker.closeAll();}
const folder=resolve(root,'docs/verification/v169');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(resolve(folder,'carve-insets.json'),JSON.stringify({cases,collapsedCases,independentWallBandArea:true,cameraRedraws:20,guideDerivations:1,closedExport:true,nativeRoundTrip:true,actualWorker:true},null,2)+'\n');
console.log(`R268 Carve Out insets passed: ${cases} independent miter-wall area/volume cases, ${collapsedCases} local edge collapses, acute/concave/curved/semicircular/cyclic/reversed/placed profiles, full-segment wall clearance, real exhaustion/split rejection, bounded guide cache/invalidation, actual picking/worker and exact Undo/Redo/stale/cancellation.`);
