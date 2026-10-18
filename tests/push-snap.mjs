import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..');
for(const shape of ['rectangle','circle'])for(const rotated of [false,true]){
 const {sandbox,get}=createAppFixture(root),run=s=>vm.runInContext(s,sandbox);Object.assign(sandbox,{testShape:shape,testRotated:rotated});
 run(`(()=>{replaceObjects([]);replaceGroups([]);replaceGuides([]);replaceDimensions([]);const o=makeObject('box');o.solid=geometryApi.createPrism([[-20,-15],[20,-15],[20,15],[-20,15]],20,'snap-source');o.transform={position:[17,-8,3],rotation:testRotated?[23,19,37]:[0,0,0]};objects.push(o);selectObject(o);
 const top=[...o.solid.faces.values()].find(f=>f.plane.normal[2]>.999),region=testShape==='circle'?circlePoints([0,0],[5,0],24).map(p=>[p[0],p[1],20]):[[-6,-5,20],[6,-5,20],[6,5,20],[-6,5,20]],split=geometryApi.splitFaceRegion(o.solid,top.id,region,'Sketch');o.solid=split.solid;testFace=split.regionFaceId;testSelfLocal=region[0];
 // This custom projector isolates source exclusion; real-camera visibility is covered in snap-visibility-navigation.mjs.
 snapCandidateVisible=()=>true;
 // Project in the active object's local frame so each rotation has the same pick distances.
 project=p=>{const local=inverseTransformPoint(p,o.transform);return [400+local[0]*10,300-local[1]*10,100-local[2]];};
 setTool('push');pointer={type:'push',object:o,face:testFace,startX:400,startY:370,ux:0,uy:-1,pxPerMm:10,distance:0,valid:true,pushOriginWorld:transformPoint([0,0,20],o.transform),pushNormalWorld:V.unit(rotate([0,0,1],o.transform.rotation))};})()`);
 get('geomSnap').checked=true;get('guideSnap').checked=false;get('snap').checked=false;get('pushTwistAngle').value='0';
 const state=run('JSON.stringify(projectData())'),history=run('undoStack.length');
 const targets=run(`(()=>{const o=objects[0],edges=geometryApi.faceTopologyEdges(o.solid,testFace);return [...edges.flatMap(e=>[e.a,V.mul(V.add(e.a,e.b),.5)]),...faceSnapCenters(o,testFace).map(c=>inverseTransformPoint(c.point,o.transform))].map(p=>transformPoint(p,o.transform));})()`);
 for(const world of targets){sandbox.selfWorld=world;const screen=run('project(selfWorld)');sandbox.testX=screen[0];sandbox.testY=screen[1];assert.equal(run('pushFeatureSnapAt(testX,testY)'),null,shape+' source feature must not snap');}
 const selfScreen=run('project(transformPoint(testSelfLocal,objects[0].transform))');sandbox.testX=selfScreen[0];sandbox.testY=selfScreen[1];const expected=run('((testX-pointer.startX)*pointer.ux+(testY-pointer.startY)*pointer.uy)/pointer.pxPerMm');assert.ok(Math.abs(expected)>1);run('pushToolController.pointerMove({event:{},x:testX,y:testY,rawHit:null,hit:null})');assert.equal(run('pointer.requestedDistance'),expected);assert.equal(run('snapIndicator'),null);assert.equal(run('JSON.stringify(projectData())'),state);assert.equal(run('undoStack.length'),history);
 // Other stationary geometry of the same object remains available.
 const bodyScreen=run('project(transformPoint([20,15,20],objects[0].transform))');sandbox.testX=bodyScreen[0];sandbox.testY=bodyScreen[1];assert.equal(run('pushFeatureSnapAt(testX,testY).kind'),'Corner');
 // Filtering before duplicate suppression preserves another object's coincident point.
 run(`(()=>{const source=objects[0],o=makeObject('box');o.solid=geometryApi.createPrism([[0,0],[1,0],[1,1],[0,1]],2,'snap-other');o.transform={position:transformPoint(V.sub(testSelfLocal,[0,0,2]),source.transform),rotation:[...source.transform.rotation]};objects.push(o);testOther=o.id;})()`);sandbox.testX=selfScreen[0];sandbox.testY=selfScreen[1];assert.equal(run('pushFeatureSnapAt(testX,testY).source.objectId'),run('testOther'));
 run('objects.splice(1);addGuideCircle(transformPoint(testSelfLocal,objects[0].transform),pointer.pushNormalWorld,1)');get('guideSnap').checked=true;assert.equal(run('pushFeatureSnapAt(testX,testY).source.kind'),'guide');
 // Removing a sketch edge from the query also prevents its guide-edge intersections.
 run('replaceGuides([]);addGuideLine(transformPoint([-30,-5,20],objects[0].transform),transformPoint([30,-5,20],objects[0].transform))');run('pushFeatureSnapAt(testX,testY)');assert.equal(run(`(()=>{const excluded=new Set(geometryApi.faceTopologyEdges(objects[0].solid,testFace).flatMap(e=>[e.id,e.twinId]));return debugSnapCandidates.some(c=>c.source?.kind==='guide-edge-intersection'&&c.source.edge?.kind==='edge'&&c.source.edge.objectId===objects[0].id&&excluded.has(c.source.edge.halfEdgeId));})()`),false);
}
console.log('R201 Push/Pull self-snap passed: rectangle/circle and oblique transforms, source corners/midpoints/centers and guide-edge crossings excluded, actual pointer distance/read-only previews, other same-object geometry, coincident independent objects and guide centers preserved.');
