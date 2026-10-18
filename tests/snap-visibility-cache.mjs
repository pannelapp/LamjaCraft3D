import assert from 'node:assert/strict';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root,undefined,{Map,Set,Math}),run=code=>vm.runInContext(code,sandbox),plain=v=>JSON.parse(JSON.stringify(v));
run(`cancelGesture();clearSelection(false);replaceGroups([]);replaceObjects([]);replaceGuides([]);
const visObject=makeObject('box');visObject.solid=geometryApi.createPrism([[-10,-10],[10,-10],[10,10],[-10,10]],10,'visibility_cache');replaceObjects([visObject]);
camera.target=[0,0,5];camera.distance=100;camera.yaw=-1;camera.pitch=.8;cameraBasis();
const visFront=[0,0,10],visBack=[0,0,0],visTop=[...visObject.solid.faces.values()].find(f=>f.plane.normal[2]>.99).id;
const visSavedPointVisible=sceneGeometry.pointVisible;let visRays=0;
sceneGeometry.pointVisible=(...args)=>{visRays++;return visSavedPointVisible(...args);};
const visState=JSON.stringify(projectData()),visHistory=undoStack.length;
const visSources=[undefined,{kind:'edge',objectId:visObject.id,halfEdgeId:'any'},{kind:'circle-center',objectId:'independent',faceId:'cap'}];
const visGuideSources=[{kind:'guide',guideId:'g'},{kind:'guide-intersection',guideIds:['g','h']},{kind:'guide-edge-intersection',guideId:'g'},{kind:'guide-segment',guideId:'g',boundaryEdges:[]}];`);
get('showGuides').checked=true;get('guideThroughSolids').checked=false;
// Both accepted and occluded coordinates reuse their exact query-local result.
run(`const visCheck=createSnapVisibilityCheck();visRays=0;`);
for(const point of ['visFront','visBack']){
 const expected=run(`snapCandidateVisible(${point},'Center')`);run('visRays=0');
 sandbox.visExpected=expected;
 assert.equal(run(`visSources.every(source=>['Corner','Midpoint','Center','On edge'].every(kind=>visCheck([...${point}],kind,source)===visExpected))`),true);
 assert.equal(run('visRays'),1,'same exact coordinate repeated a visibility ray');
}
// Coordinate keys do not quantize by snap tolerance or by screen position.
run(`const visExact=createSnapVisibilityCheck();visRays=0;visExact(visFront,'Center');visExact([1e-8,0,10],'Center');visExact(visBack,'Center');`);assert.equal(run('visRays'),3);
// Guide display policy stays separate from ordinary geometry, at the same point.
get('guideThroughSolids').checked=true;
run('const visGuideCheck=createSnapVisibilityCheck();visRays=0');assert.equal(run("visGuideCheck(visBack,'Center')"),false);
assert.equal(run("visGuideSources.every(source=>visGuideCheck(visBack,'Center',source))"),true);assert.equal(run('visRays'),1);
get('showGuides').checked=false;assert.equal(run("createSnapVisibilityCheck()(visBack,'Center',visGuideSources[0])"),false);
get('showGuides').checked=true;get('guideThroughSolids').checked=false;assert.equal(run("createSnapVisibilityCheck()(visBack,'Center',visGuideSources[0])"),false);
// No cache survives a new query, camera change, visibility change or live preview.
run('visObject.hidden=true');assert.equal(run("createSnapVisibilityCheck()(visBack,'Center')"),true);run('visObject.hidden=false');assert.equal(run("createSnapVisibilityCheck()(visBack,'Center')"),false);
run('camera.yaw+=.4;camera.pitch=.4;cameraBasis()');assert.equal(run("createSnapVisibilityCheck()(visFront,'Center')"),run("snapCandidateVisible(visFront,'Center')"));
get('livePushPreview').checked=true;run("pointer={type:'push',object:visObject,face:visTop,previewResult:{solid:geometryApi.createPrism([[-10,-10],[10,-10],[10,10],[-10,10]],20,'visibility_preview')}}");
assert.equal(run("createSnapVisibilityCheck()(visFront,'Center')"),false);run('pointer=null');assert.equal(run("createSnapVisibilityCheck()(visFront,'Center')"),true);
get('livePushPreview').checked=false;
// Viewport/clipping checks are unchanged, including points sharing screen XY at different depths.
for(const p of ['V.sub(basis.eye,basis.forward)','V.add(basis.eye,V.mul(basis.forward,cameraClip.nearPlane/2))','V.add(basis.eye,V.mul(basis.forward,cameraClip.farPlane+1))','V.add(camera.target,V.mul(basis.right,1000))'])assert.equal(run(`createSnapVisibilityCheck()(${p},'Corner')`),false);
// Duplicate candidate sources must still resolve to the first accepted source,
// and tool-specific exclusions remain outside visibility memoization.
run(`const visScreen=project(visFront),visDuplicateEdges=Array.from({length:100},(_,i)=>({a:visFront,b:[2,0,10],source:{kind:'edge',objectId:i?'allowed':'excluded',halfEdgeId:String(i)}}));
const visQuery={x:visScreen[0],y:visScreen[1],rawWorld:visFront,edges:visDuplicateEdges,points:[{point:visBack,kind:'Center'}],guides:[],project,radiusPx:16,geometryEnabled:true,guideEnabled:false};`);
const baseline=plain(run('bestSnapCandidate({...visQuery,acceptCandidate:(world,kind,source)=>source?.objectId!=="excluded"&&snapCandidateVisible(world,kind,source)})'));
run('const visCached=createSnapVisibilityCheck();visRays=0');assert.deepEqual(plain(run('bestSnapCandidate({...visQuery,acceptCandidate:(world,kind,source)=>source?.objectId!=="excluded"&&visCached(world,kind,source)})')),baseline);assert.ok(run('visRays')<10);
// Actual adapters must create fresh callbacks for each query; verify their ray reuse.
get('geomSnap').checked=true;get('guideSnap').checked=false;get('snap').checked=false;
for(const adapter of ['bestWorldEdgeSnap(visScreen[0],visScreen[1],visFront,visDuplicateEdges,undefined,[],false)', 'moveFeatureSnapAt(visScreen[0],visScreen[1],visDuplicateEdges)', 'preferredPlacementFeatureSnap(visScreen[0],visScreen[1],visFront,visDuplicateEdges,undefined)']){
 run('visRays=0');run(adapter);const rays=run('visRays');assert.ok(rays>0&&rays<10,adapter+' did not reuse visibility within its query');
 run('visRays=0');run(adapter);assert.equal(run('visRays'),rays,'adapter reused stale visibility across queries');
}
// Push self-exclusion continues to run before the memoized physical visibility.
run(`pointer={type:'push',object:visObject,face:visTop,pushOriginWorld:visFront,pushNormalWorld:[0,0,1]};`);
const pushBefore=plain(run('pushFeatureSnapAt(visScreen[0],visScreen[1])'));run('visRays=0');assert.deepEqual(plain(run('pushFeatureSnapAt(visScreen[0],visScreen[1])')),pushBefore);run('pointer=null');
assert.equal(run('JSON.stringify(projectData())'),run('visState'));assert.equal(run('undoStack.length'),run('visHistory'));run('sceneGeometry.pointVisible=visSavedPointVisible');
console.log('R256 query-local snap visibility passed: exact visible/hidden point reuse, owner/kind independence, guide-policy isolation, no coordinate quantization, fresh camera/hidden/preview/clip state, unchanged source-aware candidates/winners, actual adapter lifetimes, Push exclusion and read-only document/history.');
