import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox,get,shaderSources,viewButtons}=createAppFixture(root),run=code=>vm.runInContext(code,sandbox);
// Evaluate the scalar depth expressions captured from the application's
// vertex shader; an independent contract requires near=-1, far=+1 and
// monotonically increasing depth for WebGL's LEQUAL comparison.
const vertex=shaderSources.find(source=>source.includes('uniform float aspect,focal,ortho,span'));
assert.ok(vertex,'The application did not compile its model vertex shader');
// Shader clip range must come from the same per-camera near/far values used
// by picking and guide/image clipping, rather than fixed 10 m constants.
assert.ok(vertex.includes('uniform float aspect,focal,ortho,span,nearPlane,farPlane;'));
const declarations=[...vertex.matchAll(/float (A|B)=([^;]+);/g)].map(m=>'const '+m[1]+'='+m[2]+';').join('');
const positions=[...vertex.matchAll(/gl_Position=vec4\(([^;]+)\);/g)].map(m=>m[1].split(','));assert.equal(positions.length,2);
const depth=positions.map(parts=>new Function('z','nearPlane','farPlane',declarations+'return ('+parts[2]+')/('+parts[3]+');'));
const policy=run('CAMERA_PROJECTION_POLICY'),epsilon=1e-12;
for(const [i,label] of ['orthographic','perspective'].entries()){
 for(const [nearPlane,farPlane] of [[policy.nearPlane,policy.farPlane],[25,40000],[500,300000]]){
  assert.ok(Math.abs(depth[i](nearPlane,nearPlane,farPlane)+1)<epsilon,label+' near plane does not map to -1');
  assert.ok(Math.abs(depth[i](farPlane,nearPlane,farPlane)-1)<epsilon,label+' far plane does not map to +1');
  for(const [near,far] of [[nearPlane*2,nearPlane*3],[farPlane*.2,farPlane*.7]])assert.ok(depth[i](near,nearPlane,farPlane)<depth[i](far,nearPlane,farPlane),label+' draws a farther surface in front');
  assert.ok(depth[i](nearPlane/2,nearPlane,farPlane)<-1);
  assert.ok(depth[i](farPlane*2,nearPlane,farPlane)>1);
 }
}
run(`(()=>{const solid=primitivePrism([[-12,-8],[12,-8],[12,8],[-12,8]],10,'camera-view-fixture');objects.splice(0,objects.length,{id:'camera-view-object',name:'View fixture',kind:'solid',color:'#336699',solid,transform:{position:[0,0,0],rotation:[0,0,0]}});camera.target=[0,0,5];camera.distance=50;})()`);
const before=run('JSON.stringify(projectData())'),history=run('undoStack.length');
const cases={top:{normal:[0,0,1],near:[0,0,10],far:[0,0,0],horizontal:[1,0,0],vertical:[0,1,0]},front:{normal:[0,-1,0],near:[0,-8,5],far:[0,8,5],horizontal:[1,0,0],vertical:[0,0,1]},right:{normal:[1,0,0],near:[12,0,5],far:[-12,0,5],horizontal:[0,1,0],vertical:[0,0,1]}};
for(const [name,test] of Object.entries(cases)){
 viewButtons.find(button=>button.dataset.view===name).onclick();assert.equal(run('camera.orthographic'),true);
 assert.deepEqual(viewButtons.filter(button=>button.classList.contains('active')).map(button=>button.dataset.view),[name]);
 sandbox.expectedNormal=test.normal;assert.ok(run('cameraBasis();V.dot(V.mul(basis.forward,-1),expectedNormal)')>1-1e-6,name+' camera is on the wrong side');
 const hit=run('hitTest(W/2,H/2)');assert.ok(hit,name+' center ray missed the object');sandbox.hit=hit;
 assert.ok(run('V.dot(objects[0].solid.faces.get(hit.face).plane.normal,expectedNormal)')>1-1e-6,name+' selects the wrong surface');
 sandbox.nearPoint=test.near;sandbox.farPoint=test.far;const distances=run('[project(nearPoint)[2],project(farPoint)[2]]');
 assert.ok(depth[0](distances[0],policy.nearPlane,policy.farPlane)<depth[0](distances[1],policy.nearPlane,policy.farPlane),name+' renders the opposite face over the picked face');
 sandbox.horizontal=test.horizontal;sandbox.vertical=test.vertical;
 const screen=run('[project(camera.target),project(V.add(camera.target,horizontal)),project(V.add(camera.target,vertical))]');
 assert.ok(screen[1][0]>screen[0][0]&&screen[2][1]<screen[0][1],name+' screen axes are reversed');
 const guides=run(`(()=>{const make=z=>({id:'guide',kind:'line',point:V.add(basis.eye,V.mul(basis.forward,z)),direction:basis.right});return [guideLineViewSegment(make(CAMERA_PROJECTION_POLICY.nearPlane/2)),guideLineViewSegment(make(camera.distance)),guideLineViewSegment(make(CAMERA_PROJECTION_POLICY.farPlane*2))];})()`);
 assert.equal(guides[0],null,name+' guide behind the near plane was not clipped');assert.ok(guides[1]);assert.equal(guides[2],null);
 // Depth ordering must choose the same near surface regardless of submission order.
 for(const order of [[0,1],[1,0]])assert.equal(order.reduce((chosen,i)=>depth[0](distances[i],policy.nearPlane,policy.farPlane)<depth[0](distances[chosen],policy.nearPlane,policy.farPlane)?i:chosen,order[0]),0);
}
viewButtons.find(button=>button.dataset.view==='iso').onclick();assert.equal(run('camera.orthographic'),false);assert.deepEqual(viewButtons.filter(button=>button.classList.contains('active')).map(button=>button.dataset.view),['iso']);
assert.equal(run('JSON.stringify(projectData())'),before,'Camera preset changed project geometry/state');assert.equal(run('undoStack.length'),history);
console.log('Camera views passed: R174 actual shader depth/clipping, Top/Front/Right orientation/visible-face picking/screen axes/guide clipping, active presets and read-only state.');

// R198: Fit must enclose the actual projected model and use the available
// screen extent, independently of aspect ratio, world orientation or scale.
const fitShapes=[
 {name:'wide',profile:[[-160,-5],[160,-5],[160,5],[-160,5]],height:8,rotation:[0,0,0]},
 {name:'tall',profile:[[-5,-5],[5,-5],[5,5],[-5,5]],height:320,rotation:[0,0,0]},
 {name:'small',profile:[[-.25,-.15],[.25,-.15],[.25,.15],[-.25,.15]],height:.3,rotation:[0,0,0]},
 {name:'rotated slender',profile:[[-120,-3],[120,-3],[120,3],[-120,3]],height:5,rotation:[29,41,37]},
 {name:'asymmetric',profile:[[-60,-20],[80,-20],[30,45],[-20,70]],height:90,rotation:[19,-23,43]}
];
let fittedCases=0;
for(const dimensions of [[1200,650],[480,1000],[800,800]])for(const shape of fitShapes)for(const view of ['iso','top','front','right']){
 sandbox.fitShape=shape;sandbox.fitDimensions=dimensions;
 run(`(()=>{
   W=fitDimensions[0];H=fitDimensions[1];
   const solid=primitivePrism(fitShape.profile,fitShape.height,'fit-fixture');
   const object={id:'fit-object',name:'Fit fixture',kind:'solid',color:'#336699',solid,transform:{position:[130,-80,55],rotation:fitShape.rotation}};
   const hidden={...object,id:'fit-hidden',hidden:true,transform:{position:[50000,40000,-30000],rotation:[0,0,0]}};
   objects.splice(0,objects.length,object,hidden);
 })()`);
 viewButtons.find(button=>button.dataset.view===view).onclick();
 const documentBefore=run('JSON.stringify(projectData())'),historyBefore=run('undoStack.length');
 const orientation=run('[camera.yaw,camera.pitch,camera.orthographic]');
 get('fitBtn').onclick();
 // Use canonical world vertices as an independent oracle, not the Fit mesh
 // or its distance formula. Planar model triangles stay inside these bounds.
 const projected=run('objects.filter(o=>!o.hidden).flatMap(o=>[...o.solid.vertices.values()].map(v=>project(transformPoint(v.position,o.transform))))');
 const [width,height]=dimensions;
 for(const p of projected){
   assert.ok(p.every(Number.isFinite),shape.name+' produced a non-finite projection');
   assert.ok(p[0]>=width*.059&&p[0]<=width*.941&&p[1]>=height*.059&&p[1]<=height*.941,`${shape.name}/${view}/${dimensions} exceeds its framing margin`);
   assert.ok(p[2]>policy.nearPlane,shape.name+' crosses the near plane');
 }
 const occupancy=Math.max(...projected.flatMap(p=>[Math.abs(2*p[0]/width-1),Math.abs(2*p[1]/height-1)]));
 assert.ok(occupancy>.87&&occupancy<.89,`${shape.name}/${view}/${dimensions} wastes the available viewport (${occupancy})`);
 assert.deepEqual(run('[camera.yaw,camera.pitch,camera.orthographic]'),orientation,'Fit changed the chosen view');
 assert.equal(run('JSON.stringify(projectData())'),documentBefore,'Fit changed document state');assert.equal(run('undoStack.length'),historyBefore);
 const fittedCamera=run('JSON.stringify(camera)');
 run('camera.distance*=3;handleApplicationKeyDown({key:"f",preventDefault(){}})');
 assert.equal(run('JSON.stringify(camera)'),fittedCamera,'F differs from the Fit button');
 const fittedDistance=run('camera.distance');
 run('zoomCameraTowardCursor(W/2,H/2,-30);cameraBasis()');
 assert.ok(run('camera.distance')<fittedDistance&&run('camera.distance')>fittedDistance*.95,'Zoom jumps away from a small fitted model');
 if(view!=='iso'){
   run('camera.yaw+=.7;camera.pitch-=.2;cameraBasis()');
   assert.ok(run('objects.filter(o=>!o.hidden).every(o=>[...o.solid.vertices.values()].every(v=>project(transformPoint(v.position,o.transform))[2]>CAMERA_PROJECTION_POLICY.nearPlane))'),'Orthographic orbit moves the fitted model behind the eye');
 }
 fittedCases++;
}
// Several separated visible objects share one frame; a hidden outlier does not.
run(`(()=>{
  W=1100;H=600;objects[1].hidden=false;objects[1].transform.position=[-150,130,25];
  objects.push({...objects[0],id:'fit-hidden-outlier',hidden:true,transform:{position:[100000,100000,100000],rotation:[0,0,0]}});
  setView('iso');fit();
})()`);
const multiple=run('objects.filter(o=>!o.hidden).flatMap(o=>[...o.solid.vertices.values()].map(v=>project(transformPoint(v.position,o.transform))))');
assert.ok(multiple.every(p=>p[0]>=0&&p[0]<=1100&&p[1]>=0&&p[1]<=600&&p[2]>policy.nearPlane));
run('objects.forEach(o=>o.hidden=true);fit()');assert.ok(run('camera.target.every(Number.isFinite)&&Number.isFinite(camera.distance)&&camera.distance>0'));
console.log(`Camera Fit passed: R198 ${fittedCases} projected-bounds cases, portrait/landscape/square, wide/tall/small/rotated/asymmetric models, perspective/orthographic, F/button equality, smooth small-model zoom, orthographic orbit clearance, multiple/hidden/empty objects and read-only document/history.`);

// R209: Multi-metre solids remain in the same WebGL frustum when zooming
// beyond the old 10,000 mm far limit. The policy is shared by viewport,
// screenshot rendering, guide clipping, and screen-selection visibility.
let largeCases=0;
for(const orthographic of [false,true])for(const distance of [6500,12000,35000,95000]){
 run(`(()=>{replaceObjects([]);const o=makeObject('large-object');o.solid=geometryApi.createPrism([[-3000,-2500],[3000,-2500],[3000,2500],[-3000,2500]],4000,'large-camera-fixture');objects.push(o);camera.target=[0,0,2000];camera.distance=${distance};camera.yaw=-Math.PI/3;camera.pitch=Math.PI/5;camera.orthographic=${orthographic};delete camera.orthographicEyeDistance;cameraBasis();})()`);
 const clip=run('cameraClip'),depths=run('sceneGeometry.mesh(objects[0]).vertices.map(p=>project(p)[2])');
 assert.ok(clip.farPlane>policy.farPlane,`far clip did not adapt at distance ${distance}`);
 assert.ok(depths.every(z=>z>=clip.nearPlane&&z<=clip.farPlane),`large model disappeared at distance ${distance}`);
 assert.ok(clip.nearPlane>=policy.nearPlane&&clip.nearPlane<Math.min(...depths));
 // A distant view gets a deeper near plane, preserving depth-buffer precision.
 if(distance>=12000)assert.ok(clip.nearPlane>policy.nearPlane);
 for(const z of depths)assert.ok(depth[orthographic?0:1](z,clip.nearPlane,clip.farPlane)>=-1-1e-9&&depth[orthographic?0:1](z,clip.nearPlane,clip.farPlane)<=1+1e-9);
 assert.ok(run('guideLineViewSegment({id:"far-guide",kind:"line",point:camera.target,direction:basis.right})')!==null);
 const pngSegment=run('imageClippedSegment(V.add(camera.target,V.mul(basis.right,-500)),V.add(camera.target,V.mul(basis.right,500)),{camera,viewportWidth:800,viewportHeight:600},basis,cameraClip)');
 assert.ok(pngSegment,`PNG line segment disappeared at distance ${distance}`);
 assert.ok(run('sceneObjectsInScreenRect(objects,{left:0,top:0,right:800,bottom:600},project,cameraClip.nearPlane,cameraClip.farPlane)').length>0,`screen-area selection lost the large model at distance ${distance}`);
 largeCases++;
}
// A model farther away than the camera target must still be in range.
run('objects[0].transform.position=V.mul(basis.forward,180000);camera.distance=2000;camera.orthographic=false;cameraBasis()');
assert.ok(run('cameraClip.farPlane>180000'));
// Zooming close must retain fine near-plane navigation and avoid clipping.
run('objects[0].transform.position=[0,0,0];camera.distance=250;cameraBasis()');
assert.equal(run('cameraClip.nearPlane'),policy.nearPlane);
console.log(`Camera dynamic depth passed: R209 ${largeCases} far-zoom large-object cases in perspective/orthographic, conservative distant bounds, guide/selection depth consistency and close-up precision.`);
