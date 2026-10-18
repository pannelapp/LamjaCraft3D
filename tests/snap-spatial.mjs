import assert from 'node:assert/strict';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root,undefined,{Map,Set,Math}),run=code=>vm.runInContext(code,sandbox),plain=value=>JSON.parse(JSON.stringify(value));
// Exact tolerance membership, including grid boundaries, unsafe magnitudes and invalid points.
run(`let membershipSeed=154;const membershipRandom=()=>{membershipSeed=(Math.imul(membershipSeed,1664525)+1013904223)>>>0;return membershipSeed/4294967296;};
const membershipPoints=Array.from({length:700},()=>[(membershipRandom()-.5)*20,(membershipRandom()-.5)*20,(membershipRandom()-.5)*20]);
membershipPoints.push([0,0,0],[TOL.snapGeometry,0,0],[TOL.snapGeometry*2,0,0],[1e10,1e10,1e10],[1e30,0,0],[NaN,0,0]);
const membershipContains=snapPointMembership(membershipPoints,TOL.snapGeometry),membershipReference=p=>membershipPoints.some(point=>V.len(V.sub(point,p))<=TOL.snapGeometry);
const membershipQueries=[];for(const point of membershipPoints)for(const d of [0,.999999999,1,1.000000001,-1])membershipQueries.push(V.add(point,[d*TOL.snapGeometry,0,0]));
membershipQueries.push([Infinity,0,0],[NaN,0,0],[1e30,1,0]);`);
assert.equal(run('membershipQueries.every(p=>membershipContains(p)===membershipReference(p))'),true,'spatial membership changed the exact tolerance rule');
run(`let spatialSeed=255;const spatialRandom=()=>{spatialSeed=(Math.imul(spatialSeed,1664525)+1013904223)>>>0;return spatialSeed/4294967296;};
const spatialEdges=Array.from({length:1600},(_,i)=>{const p=[(spatialRandom()-.5)*500,(spatialRandom()-.5)*500,(spatialRandom()-.5)*60];return {a:p,b:V.add(p,[(spatialRandom()-.5)*25,(spatialRandom()-.5)*25,(spatialRandom()-.5)*10]),source:{kind:'edge',objectId:'spatial',halfEdgeId:String(i)}};});
// Long segments, perspective poles, degenerate points, duplicates and source ties.
spatialEdges.push({a:[-1000,0,5],b:[1000,0,5],source:{kind:'edge',objectId:'long',halfEdgeId:'1'}},{a:[1,1,-1],b:[1,1,1]},{a:[0,0,0],b:[0,0,0]},{a:[0,0,5],b:[0,0,5],source:{kind:'edge',objectId:'first',halfEdgeId:'1'}},{a:[0,0,5],b:[0,0,5],source:{kind:'edge',objectId:'second',halfEdgeId:'1'}});
const spatialPoints=Array.from({length:600},()=>({point:[(spatialRandom()-.5)*300,(spatialRandom()-.5)*300,(spatialRandom()-.5)*40],kind:'Center'}));
spatialPoints.push({point:[0,0,5],kind:'Center',source:{kind:'circle-center',objectId:'first-center',faceId:'f'}},{point:[0,0,5],kind:'Center',source:{kind:'circle-center',objectId:'second-center',faceId:'f'}});
let spatialOffset=[0,0],spatialZoom=2,spatialProjectionCalls=0;
const spatialAffine=p=>{spatialProjectionCalls++;return [400+p[0]*spatialZoom+spatialOffset[0],300+p[1]*spatialZoom+spatialOffset[1],p[2]];};
const spatialPerspective=p=>{spatialProjectionCalls++;return [400+p[0]*20/p[2]+spatialOffset[0],300+p[1]*20/p[2]+spatialOffset[1],p[2]];};
let spatialQuery={x:400,y:300,rawWorld:[0,0,5],edges:spatialEdges,points:spatialPoints,guides:[],project:spatialAffine,radiusPx:16,geometryEnabled:true,guideEnabled:false,spatial:{projection:'affine',edges:true,points:true}};
const spatialAccept=(world,_kind,source)=>spatialQuery.project(world).every(Number.isFinite)&&source?.objectId!=='first-center';spatialQuery.acceptCandidate=spatialAccept;
`);
let compared=0;
function equalQuery(label){
 const linear=plain(run('bestSnapCandidate({...spatialQuery,spatial:undefined})'));
 const indexed=plain(run('bestSnapCandidate(spatialQuery)'));
 assert.deepEqual(indexed,linear,label);compared++;
}
for(const projection of ['affine','perspective'])for(const radius of [0,1,16,37])for(let i=0;i<12;i++){
 sandbox.spatialMode=projection;sandbox.spatialRadius=radius;sandbox.spatialI=i;
 run(`spatialQuery.project=spatialMode==='affine'?spatialAffine:spatialPerspective;spatialQuery.spatial.projection=spatialMode;spatialQuery.radiusPx=spatialRadius;spatialQuery.x=330+(spatialI%4)*47;spatialQuery.y=240+Math.floor(spatialI/4)*61;spatialQuery.rawWorld=[spatialI-5,spatialI%3,5];spatialQuery.plane=spatialI%3===0?{point:[0,0,5],normal:[0,0,1]}:undefined;`);
 equalQuery(`${projection} radius ${radius} position ${i}`);
}
// Reuse the same world index across zoom/pan and affine/perspective changes.
run('const spatialOriginalIndex=snapEdgeSpatialCache.get(spatialEdges);spatialOffset=[73,-31];spatialZoom=9;spatialQuery.plane=undefined;');equalQuery('camera changed');assert.equal(run('snapEdgeSpatialCache.get(spatialEdges)===spatialOriginalIndex'),true);
// Guide spans need remote boundary crossings even when both endpoints are off-screen.
run(`const spatialSpanEdges=[{a:[-100,-2,0],b:[-100,2,0],source:{kind:'edge',objectId:'span',halfEdgeId:'left'}},{a:[100,-2,0],b:[100,2,0],source:{kind:'edge',objectId:'span',halfEdgeId:'right'}},...Array.from({length:500},(_,i)=>({a:[1000+i,30,0],b:[1000+i,31,0]}))];
spatialOffset=[0,0];spatialZoom=2;spatialQuery={x:400,y:300,rawWorld:[0,0,0],edges:spatialSpanEdges,points:[],guides:[{kind:'line',id:'span-guide',point:[0,0,0],direction:[1,0,0]}],plane:{point:[0,0,0],normal:[0,0,1]},project:spatialAffine,radiusPx:16,geometryEnabled:true,guideEnabled:true,spatial:{projection:'affine',edges:true}};`);
equalQuery('off-screen guide span boundaries');assert.ok(run("collectSnapCandidates(spatialQuery).some(c=>c.source?.kind==='guide-segment'&&V.len(c.world)===0)"));
run("spatialQuery.acceptEdge=e=>e.source?.halfEdgeId!=='left'");equalQuery('guide/geometry edge predicate');
assert.deepEqual(plain(run('bestSnapCandidate(spatialQuery)')),plain(run('bestSnapCandidate({...spatialQuery,spatial:undefined,edges:spatialSpanEdges.filter(spatialQuery.acceptEdge),acceptEdge:undefined})')));
run(`spatialQuery.acceptEdge=undefined;spatialQuery.inferenceEnabled=true;spatialQuery.inference={origin:[0,0,0],referenceDirections:[[1,0,0],[0,1,0]],alignmentPoints:[[8,2,0],[-5,3,0]],axes:[[1,0,0],[0,1,0]]};`);equalQuery('full inference directions/anchors');
// Rounding at large translations and exact candidate-radius boundaries.
run(`const spatialLarge=1e10,spatialLargeEdges=Array.from({length:600},(_,i)=>({a:[spatialLarge+i-300,spatialLarge+(i%7),5],b:[spatialLarge+i-299.5,spatialLarge+(i%7)+.5,5]}));
spatialQuery={x:400,y:300,rawWorld:[spatialLarge,spatialLarge,5],edges:spatialLargeEdges,points:[],guides:[],project:p=>[400+(p[0]-spatialLarge)*20,300+(p[1]-spatialLarge)*20,p[2]],radiusPx:16,geometryEnabled:true,guideEnabled:false,spatial:{projection:'affine',edges:true}};`);
for(const x of [400,428,428+1e-7,372,500]){sandbox.spatialX=x;run('spatialQuery.x=spatialX');equalQuery('large coordinates / radius boundary');}
// Non-finite inputs fail open, and disabling geometry must not build an index.
run(`const spatialInvalid=[...spatialSpanEdges,{a:[NaN,0,0],b:[Infinity,0,0]}];spatialQuery={x:400,y:300,rawWorld:[0,0,0],edges:spatialInvalid,guides:[],project:spatialAffine,radiusPx:16,geometryEnabled:true,guideEnabled:false,acceptCandidate:p=>p.every(Number.isFinite),spatial:{projection:'affine',edges:true}};`);equalQuery('non-finite endpoint bounds');
for(const radius of [-1,Infinity,NaN]){sandbox.spatialRadius=radius;run('spatialQuery.radiusPx=spatialRadius');equalQuery('unindexable query radius');}
run('const spatialDisabled=[...spatialSpanEdges];spatialQuery={...spatialQuery,edges:spatialDisabled,geometryEnabled:false,radiusPx:16};collectSnapCandidates(spatialQuery)');assert.equal(run('snapEdgeSpatialCache.has(spatialDisabled)'),false);equalQuery('geometry disabled');
// Verify a useful reduction on a deterministic sparse workload.
run(`const spatialSparse=Array.from({length:20000},(_,i)=>({a:[(i%200)*10,Math.floor(i/200)*10,10],b:[(i%200)*10+1,Math.floor(i/200)*10+1,10]}));spatialOffset=[0,0];spatialZoom=1;spatialQuery={x:400,y:300,rawWorld:[0,0,10],edges:spatialSparse,guides:[],project:spatialAffine,radiusPx:16,geometryEnabled:true,guideEnabled:false,spatial:{projection:'affine',edges:true}};collectSnapCandidates(spatialQuery);spatialProjectionCalls=0;`);
equalQuery('sparse indexed workload');run('spatialProjectionCalls=0;collectSnapCandidates(spatialQuery)');assert.ok(run('spatialProjectionCalls')<2000,'warm index still projected most geometry');
// Real application camera, immutable snapshots, visible hover and source replacement.
run(`cancelGesture();clearSelection(false);replaceGroups([]);replaceObjects([]);const spatialObject=makeObject('box');spatialObject.solid=geometryApi.createPrism(Array.from({length:320},(_,i)=>[20*Math.cos(i*Math.PI/160),20*Math.sin(i*Math.PI/160)]),10,'spatial_ui');replaceObjects([spatialObject]);
const spatialTop=[...spatialObject.solid.faces.values()].find(f=>f.plane.normal[2]>.99).id;fit();cameraBasis();
const spatialDoc=JSON.stringify(projectData()),spatialHistory=undoStack.length;
const spatialUIEdges=faceSnapEdges(spatialObject,spatialTop),spatialUIPoints=faceSnapCenters(spatialObject,spatialTop);`);
get('geomSnap').checked=true;get('guideSnap').checked=false;get('snap').checked=false;
for(const ortho of [false,true])for(const pitch of [.2,.8,1.55]){
 sandbox.spatialOrtho=ortho;sandbox.spatialPitch=pitch;
 run(`camera.orthographic=spatialOrtho;camera.pitch=spatialPitch;cameraBasis();var spatialScreen=project([0,0,10]);spatialQuery={x:spatialScreen[0],y:spatialScreen[1],rawWorld:[0,0,10],edges:spatialUIEdges,points:spatialUIPoints,guides:[],project,radiusPx:16,geometryEnabled:true,guideEnabled:false,spatial:snapSpatialQuery(spatialUIEdges,spatialUIPoints),acceptCandidate:snapCandidateVisible};`);equalQuery('real camera / visibility');
}
run(`const spatialUIIndex=snapEdgeSpatialCache.get(spatialUIEdges),spatialExclusion=pushSnapExclusion(spatialObject,spatialTop);`);assert.equal(run('pushSnapExclusion(spatialObject,spatialTop)===spatialExclusion'),true);
run('spatialObject.transform.position[0]+=5');assert.notEqual(run('pushSnapExclusion(spatialObject,spatialTop)'),run('spatialExclusion'));run('spatialObject.transform.position[0]-=5');
run('const spatialOldSolid=spatialObject.solid;spatialObject.solid=cloneSolidFast(spatialOldSolid)');assert.notEqual(run('faceSnapEdges(spatialObject,spatialTop)'),run('spatialUIEdges'));run('spatialObject.solid=spatialOldSolid');
for(const tool of ['rect','circle','push']){run(`{setTool('${tool}');cameraBasis();const xy=project([0,0,10]);dispatchToolPointerMove({clientX:xy[0],clientY:xy[1]});}`);}
assert.equal(run('JSON.stringify(projectData())'),run('spatialDoc'));assert.equal(run('undoStack.length'),run('spatialHistory'));
run('spatialObject.hidden=true');assert.deepEqual(plain(run('faceSnapEdges(spatialObject,spatialTop)')),[]);run('spatialObject.hidden=false');
console.log(`R255 spatial snapping passed: ${compared} exact indexed/linear comparisons, affine/perspective/poles/roundoff/long and degenerate edges/source ties, point centers, full guide spans and inference, edge predicates, fallback/disabled inputs, sparse work reduction, real camera/visibility/hover, source/transform/exclusion-cache invalidation and read-only document/history.`);
