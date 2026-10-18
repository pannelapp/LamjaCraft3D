import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..');
for(const orthographic of [false,true])for(const rotated of [false,true]){
 const {sandbox,get}=createAppFixture(root),run=s=>vm.runInContext(s,sandbox);Object.assign(sandbox,{testOrtho:orthographic,testRotated:rotated});
 run(`(()=>{replaceObjects([]);replaceGuides([]);replaceDimensions([]);const o=makeObject('box');o.solid=geometryApi.createPrism([[-10,-10],[10,-10],[10,10],[-10,10]],10,'visible-snap');o.transform={position:[17,-8,3],rotation:testRotated?[23,19,37]:[0,0,0]};objects.push(o);testObject=o;testTop=[...o.solid.faces.values()].find(f=>f.plane.normal[2]>.99).id;
 const direction=V.unit(transformDir([.3,-.2,1],o.transform));camera.target=transformPoint([0,0,5],o.transform);camera.distance=100;camera.yaw=Math.atan2(direction[1],direction[0]);camera.pitch=Math.asin(direction[2]);camera.orthographic=testOrtho;cameraBasis();})()`);
 get('geomSnap').checked=true;get('guideSnap').checked=false;get('snap').checked=false;get('showGuides').checked=true;get('pushTwistAngle').value='0';
 const state=run('JSON.stringify(projectData())'),history=run('undoStack.length');
 assert.equal(run(`snapCandidateVisible(transformPoint([0,0,10],testObject.transform),'Center')`),true,'surface center is visible');
 assert.equal(run(`snapCandidateVisible(transformPoint([0,0,0],testObject.transform),'Center')`),false,'back surface is hidden by the same object');
 assert.equal(run(`snapCandidateVisible(transformPoint([-10,-10,10],testObject.transform),'Corner')`),true,'surface corner survives depth tolerance');
 assert.equal(run(`snapCandidateVisible(transformPoint([0,-10,10],testObject.transform),'Midpoint')`),true,'surface midpoint survives depth tolerance');
 // A foreground object hides the point even though its source object is shown.
 run(`(()=>{const o=makeObject('box');o.solid=geometryApi.createPrism([[-4,-4],[4,-4],[4,4],[-4,4]],5,'occluder');o.transform={position:transformPoint([0,0,15],testObject.transform),rotation:[...testObject.transform.rotation]};objects.push(o);testCover=o;})()`);
 assert.equal(run(`snapCandidateVisible(transformPoint([0,0,10],testObject.transform),'Center')`),false);
 run('testCover.hidden=true');assert.equal(run(`snapCandidateVisible(transformPoint([0,0,10],testObject.transform),'Center')`),true,'hidden solids do not occlude');run('objects.splice(1)');
 // At the same pixel, reject the deeper candidate and rank the visible one.
 run(`(()=>{const front=transformPoint([0,0,10],testObject.transform),r=ray(...project(front).slice(0,2)),back=V.add(front,V.mul(r.dir,5));testWorld=front;testBack=back;testScreen=project(front);})()`);
 assert.equal(run(`V.len(V.sub(bestWorldEdgeSnap(testScreen[0],testScreen[1],testWorld,[],undefined,[],false,[{point:testBack,kind:'Center',source:{kind:'face',objectId:testObject.id,faceId:testTop}},{point:testWorld,kind:'Center',source:{kind:'face',objectId:testObject.id,faceId:testTop}}]).world,testWorld))`),0);
 run(`setTool('push');pointer={type:'push',object:testObject,face:testTop,startX:400,startY:300,...screenNormalScale(testObject,testTop),distance:0,valid:true,pushOriginWorld:transformPoint([0,0,10],testObject.transform),pushNormalWorld:transformDir([0,0,1],testObject.transform)};`);
 assert.equal(run('pushFeatureSnapAt(testScreen[0],testScreen[1])'),null,'active face and hidden backing geometry cannot snap');
 // Live solid preview is the displayed occluder; it never changes the document.
 run(`pointer.previewResult={solid:geometryApi.createPrism([[-10,-10],[10,-10],[10,10],[-10,10]],20,'preview')};`);
 get('livePushPreview').checked=true;assert.equal(run(`snapCandidateVisible(testWorld,'Midpoint')`),false,'raised live preview occludes original surface');get('livePushPreview').checked=false;assert.equal(run(`snapCandidateVisible(testWorld,'Midpoint')`),true);run('pointer=null');
 // Geometry behind the camera, beyond clipping, or outside the viewport is unavailable.
 assert.equal(run(`snapCandidateVisible(V.sub(basis.eye,basis.forward),'Corner')`),false);
 assert.equal(run(`snapCandidateVisible(V.add(basis.eye,V.mul(basis.forward,CAMERA_PROJECTION_POLICY.nearPlane/2)),'Corner')`),false);
 assert.equal(run(`snapCandidateVisible(V.add(basis.eye,V.mul(basis.forward,CAMERA_PROJECTION_POLICY.farPlane+1)),'Corner')`),false);
 assert.equal(run(`snapCandidateVisible(V.add(camera.target,V.mul(basis.right,1000)),'Corner')`),false);
 // Dedicated Move, profile placement, Guide offset and Guide Circle adapters use the same visibility rule.
 assert.equal(run(`moveFeatureSnapAt(testScreen[0],testScreen[1],[],[{point:testBack,kind:'Center',source:{kind:'circle-center',objectId:testObject.id,faceId:testTop}}])`),null);
 assert.equal(run(`preferredPlacementFeatureSnap(testScreen[0],testScreen[1],testWorld,[],undefined,[{point:testBack,kind:'Center',source:{kind:'circle-center',objectId:testObject.id,faceId:testTop}}])`),null);
 run(`testBottom=[...testObject.solid.faces.values()].find(f=>f.plane.normal[2]<-.99).id;testHiddenMid=transformPoint([0,10,0],testObject.transform);testHiddenScreen=project(testHiddenMid);startGuideOffset(testHiddenMid,transformDir([0,1,0],testObject.transform),transformDir([0,0,1],testObject.transform),undefined,{objectId:testObject.id,faceId:testBottom});`);
 assert.equal(run(`guideOffsetMidpointSnapAt(testHiddenScreen[0],testHiddenScreen[1],testHiddenMid)`),null);
 run(`pointer={type:'guide-circle',centerWorld:testHiddenMid,normal:transformDir([0,0,1],testObject.transform)};`);
 assert.equal(run(`guideCirclePointerPoint(testHiddenScreen[0],testHiddenScreen[1]).distance`),Infinity);
 run('pointer=null');
 // Guide snapping follows display controls and the explicit through-solids mode.
 run(`replaceGuides([{kind:'point',id:'visibility-guide',point:testBack,label:'Guide point'}]);`);get('guideSnap').checked=true;
 assert.equal(run(`snapCandidateVisible(testBack,'Guide point',{kind:'guide',guideId:guides[0].id})`),false);
 get('guideThroughSolids').checked=true;assert.equal(run(`snapCandidateVisible(testBack,'Guide point',{kind:'guide',guideId:guides[0].id})`),true);get('showGuides').checked=false;assert.equal(run(`snapCandidateVisible(testBack,'Guide point',{kind:'guide',guideId:guides[0].id})`),false);
 run('replaceGuides([])');assert.equal(run('JSON.stringify(projectData())'),state,'visibility queries and previews must not mutate the document');
 assert.equal(run('undoStack.length'),history);
}
// Real wheel event: requested depth is continuous; subsequent motion uses the new scale.
for(const orthographic of [false,true])for(const initialDepth of [3,-3]){
 const {sandbox,get}=createAppFixture(root),run=s=>vm.runInContext(s,sandbox);Object.assign(sandbox,{testOrtho:orthographic,testDepth:initialDepth});
 get('geomSnap').checked=false;get('guideSnap').checked=false;get('snap').checked=false;get('pushTwistAngle').value='0';
 run(`(()=>{replaceObjects([]);replaceGuides([]);replaceDimensions([]);const o=makeObject('box');o.solid=geometryApi.createPrism([[-10,-10],[10,-10],[10,10],[-10,10]],10,'navigation');objects.push(o);testObject=o;testTop=[...o.solid.faces.values()].find(f=>f.plane.normal[2]>.99).id;camera.target=[0,0,5];camera.distance=100;camera.yaw=-1;camera.pitch=.5;camera.orthographic=testOrtho;cameraBasis();setTool('push');pushToolController.pointerDown({event:{},x:400,y:300,hit:{id:o.id,face:testTop,point:[0,0,10]},rawHit:null});testX=400+pointer.ux*pointer.pxPerMm*testDepth;testY=300+pointer.uy*pointer.pxPerMm*testDepth;pushToolController.pointerMove({event:{},x:testX,y:testY,hit:null,rawHit:null});})()`);
 const doc=run('JSON.stringify(projectData())'),history=run('undoStack.length'),depth=run('pointer.requestedDistance'),oldScale=run('pointer.pxPerMm');assert.equal(depth,initialDepth);
 get('scene').listeners.wheel[0]({preventDefault(){},clientX:run('testX'),clientY:run('testY'),deltaY:-500});
 assert.equal(run('pointer.requestedDistance'),depth);assert.ok(run('pointer.pxPerMm')>oldScale);
 run('pushToolController.pointerMove({event:{},x:testX,y:testY,hit:null,rawHit:null})');assert.equal(run('pointer.requestedDistance'),depth,'zoom must not jump at the same cursor');
 const zoomedScale=run('pointer.pxPerMm');get('scene').listeners.wheel[0]({preventDefault(){},clientX:run('testX'),clientY:run('testY'),deltaY:250});assert.ok(run('pointer.pxPerMm')<zoomedScale);run('pushToolController.pointerMove({event:{},x:testX,y:testY,hit:null,rawHit:null})');assert.equal(run('pointer.requestedDistance'),depth,'zoom out also preserves depth');
 run('testX+=pointer.ux*pointer.pxPerMm*2;testY+=pointer.uy*pointer.pxPerMm*2;pushToolController.pointerMove({event:{},x:testX,y:testY,hit:null,rawHit:null})');assert.equal(run('pointer.requestedDistance'),initialDepth+2,'continued motion uses current scale');
 // Orbit and pan suspend and rebase the same gesture, preserving its depth.
 for(const button of [2,1]){
  run(`beginCameraPointer({button:${button}},testX,testY,pushToolController);camera.yaw+=.2;camera.pitch+=.1;camera.target=V.add(camera.target,[2,-1,0]);resumeAfterCameraPointer(testX,testY);pushToolController.pointerMove({event:{},x:testX,y:testY,hit:null,rawHit:null});`);
  assert.equal(run('pointer.requestedDistance'),initialDepth+2);
 }
 assert.equal(run('JSON.stringify(projectData())'),doc);assert.equal(run('undoStack.length'),history);
 run('commitPushPointer()');assert.equal(run('undoStack.length'),history+1);assert.equal(run('geometryApi.validate(testObject.solid,false).ok'),true);const committed=run('JSON.stringify(projectData())');run('undo()');assert.equal(run('JSON.stringify(projectData())'),doc);run('redo()');assert.equal(run('JSON.stringify(projectData())'),committed);
}
console.log('R202 visible snapping/navigation passed: perspective/orthographic and oblique models, self/foreground occlusion, hidden occluders, visible surface corners/midpoints, ranking, active sketch, live preview, camera clipping, guide controls, Move/profile/guide adapters, signed depth and zoom-in/zoom-out/orbit/pan continuity, current mouse scale, valid commit and exact Undo/Redo.');
