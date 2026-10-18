import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root,undefined,{Map,Set,Math}),run=code=>vm.runInContext(code,sandbox),plain=value=>JSON.parse(JSON.stringify(value));
run(`cancelGesture();clearSelection(false);replaceGroups([]);replaceObjects([]);tool='push';
const hoverBox=makeObject('box');hoverBox.transform.position=[-50,0,0];
const hoverHoled=makeObject('box');hoverHoled.solid=geometryApi.createPrismRegion([[-20,-20],[20,-20],[20,20],[-20,20]],[[[-5,-5],[-5,5],[5,5],[5,-5]]],12,'hover_holed');hoverHoled.transform.position=[35,0,0];
replaceObjects([hoverBox,hoverHoled]);sceneGeometry.invalidateAll();
const hoverFaces=objects.map(o=>[...o.solid.faces.keys()]);
const hoverExpectedLabels=objects.map(o=>[...o.solid.faces.keys()].map(id=>faceLabel(o,id)));
const hoverGeometryBefore=JSON.stringify(objects.map(o=>serializeObject(o))),hoverHistoryBefore=undoStack.length;
const hoverSavedLoops=faceLoopPoints,hoverSavedTriangulate=triangulateFaceLocal;
faceLoopPoints=()=>{throw Error('A face label walked boundary loops');};triangulateFaceLocal=()=>{throw Error('A face label triangulated');};`);
assert.deepEqual(plain(run('objects.map(o=>[...o.solid.faces.keys()].map(id=>faceLabel(o,id)))')),plain(run('hoverExpectedLabels')));
run(`const hoverMetadata=geometryApi.faceMetadata(hoverBox.solid,hoverFaces[0][0]);hoverMetadata.plane.normal[0]=99;if(geometryApi.faceMetadata(hoverBox.solid,hoverFaces[0][0]).plane.normal[0]===99)throw Error('Metadata exposed mutable canonical normals');faceLoopPoints=hoverSavedLoops;triangulateFaceLocal=hoverSavedTriangulate;`);
// Statistics cache canonical solids, not camera, visibility, transform or BVH age.
run(`const hoverSavedCounts=derivedSolidTopologyCounts;let hoverCountCalls=0;derivedSolidTopologyCounts=s=>{hoverCountCalls++;return hoverSavedCounts(s);};const hoverStats=topologyStats();`);
assert.equal(run('hoverCountCalls'),2);assert.equal(run('hoverStats.holes'),2);assert.equal(run('hoverStats.openEdges'),0);
assert.equal(run('hoverStats.bvhNodes'),0);assert.equal(run('topologyStats().faces'),run('hoverStats.faces'));assert.equal(run('hoverCountCalls'),2);
run('sceneGeometry.bvh(hoverHoled)');assert.ok(run('topologyStats().bvhNodes')>0,'Lazy BVH creation was invisible to cached statistics');
run(`const hoverBvh=sceneGeometry.entry(hoverHoled).bvh,hoverBvhLeft=hoverBvh.left;Object.defineProperty(hoverBvh,'left',{get(){throw Error('Warm statistics traversed BVH');},configurable:true});topologyStats();sceneGeometry.bvhNodeCount(objects);Object.defineProperty(hoverBvh,'left',{value:hoverBvhLeft,writable:true,configurable:true});`);
run('hoverHoled.hidden=true');assert.equal(run('topologyStats().holes'),0);run('hoverHoled.hidden=false;hoverHoled.transform.position[1]+=1;topologyStats()');assert.equal(run('hoverCountCalls'),2);
run(`const hoverOriginalSolid=hoverBox.solid;hoverBox.solid=geometryApi.createPrism([[-4,-4],[4,-4],[4,4],[-4,4]],7,'hover_replacement');topologyStats();`);assert.equal(run('hoverCountCalls'),3);
run('hoverBox.solid=hoverOriginalSolid;hoverHoled.transform.position[1]-=1;topologyStats();derivedSolidTopologyCounts=hoverSavedCounts;');assert.equal(run('hoverCountCalls'),3);
// A changing face highlight must upload none of the static scene buffers.
run(`const hoverUpload=gl.bufferData,hoverBind=gl.bindBuffer,hoverUniform1=gl.uniform1f,hoverUniform2=gl.uniform2f;
let hoverBound=null;const hoverUploads=[],hoverUniforms=new Map();
gl.bindBuffer=(target,buffer)=>{hoverBound=buffer;return hoverBind(target,buffer);};
gl.bufferData=(target,data,usage)=>{hoverUploads.push({buffer:hoverBound,data:Array.from(data)});return hoverUpload(target,data,usage);};
gl.uniform1f=(location,value)=>{hoverUniforms.set(location,value);return hoverUniform1(location,value);};
gl.uniform2f=(location,a,b)=>{hoverUniforms.set(location,[a,b]);return hoverUniform2(location,a,b);};
const hoverSet=(oi,fi)=>setHoverFaceHit({id:objects[oi].id,face:hoverFaces[oi][fi],point:[0,0,0],localPoint:[0,0,0],t:1});
const hoverStaticBuffers=new Set([triangleBuffer,materialBuffer,lineBuffer,faceKeyBuffer]);`);
for(const style of ['modeling','illustration','presentation']){
 get('viewStyle').value=style;run("sceneKey='';clearHover();render();hoverUploads.length=0;");
 for(const [oi,fi] of [[0,0],[1,0],[0,1],[1,1],[0,0]]){
  run(`hoverSet(${oi},${fi});render()`);
  assert.equal(run('hoverUploads.filter(x=>hoverStaticBuffers.has(x.buffer)).length'),0,`${style} hover uploaded static geometry`);
  assert.equal(run('hoverUniforms.get(uniform.faceHighlightEnabled)'),1);
  const key=run(`sceneFaceKeys.get(objects[${oi}].id).get(hoverFaces[${oi}][${fi}])`);
  assert.deepEqual(plain(run('hoverUniforms.get(uniform.faceHighlightKey)')),[key%4096,Math.floor(key/4096)]);
 }
 run('clearHover();render()');assert.equal(run('hoverUniforms.get(uniform.faceHighlightEnabled)'),0);
 run('setSelectedFace(hoverBox,hoverFaces[0][0],[0,0,0]);render();hoverUploads.length=0;hoverSet(1,0);render();clearHover();render();');
 assert.equal(run('hoverUploads.filter(x=>hoverStaticBuffers.has(x.buffer)).length'),0,'Hover/fallback rebuilt selected buffers');assert.equal(run('hoverUniforms.get(uniform.faceHighlightAmbient)'),run('SELECTION_VISUAL_POLICY.selectedAmbient'));
 run('clearSelection(false);');
}
// Explicit geometry preview colors keep precedence over a face highlight.
run(`const hoverMoveColor=movePointDisplayColor;movePointDisplayColor=(id,face)=>id===hoverBox.id&&face===hoverFaces[0][0]?[0,1,0]:null;sceneKey='';hoverSet(0,0);ensureScene();
const hoverKeys=hoverUploads.filter(x=>x.buffer===faceKeyBuffer).at(-1).data;const hoverMesh=sceneGeometry.mesh(hoverBox);
for(let i=0;i<hoverMesh.face.length;i++)if(hoverMesh.face[i]===hoverFaces[0][0]&&hoverKeys.slice(i*6,i*6+6).some(v=>v!==0))throw Error('Hover would overwrite an explicit preview color');
movePointDisplayColor=hoverMoveColor;sceneKey='';clearSelection(false);clearHover();`);
get('viewStyle').value='modeling';
run(`const hoverHitTest=hitTest;let hoverPicks=0;hitTest=(x,y)=>{hoverPicks++;return hoverHitTest(x,y);};fit();cameraBasis();const hoverXY=project(transformPoint([0,0,10],hoverBox.transform));`);
for(const locked of [false,true]){
 run(`hoverHoled.locked=${locked};hoverPicks=0;dispatchToolPointerMove({clientX:hoverXY[0],clientY:hoverXY[1]});`);assert.equal(run('hoverPicks'),1,'Push hover repeated the group/lock hit test');
}
run(`replaceGroups([{id:'hover_group',name:'Hover group',objectIds:[hoverBox.id,hoverHoled.id]}]);hoverPicks=0;dispatchToolPointerMove({clientX:hoverXY[0],clientY:hoverXY[1]});`);assert.equal(run('hoverPicks'),1);assert.equal(run('modelDocument.hover.kind'),'group');
run(`replaceGroups([]);hoverBox.locked=true;hoverPicks=0;dispatchToolPointerMove({clientX:hoverXY[0],clientY:hoverXY[1]});`);assert.equal(run('hoverPicks'),1);assert.equal(run('modelDocument.hover.kind'),'object');
run('hoverBox.locked=false;hoverHoled.locked=false;hitTest=hoverHitTest;clearHover();gl.bufferData=hoverUpload;gl.bindBuffer=hoverBind;gl.uniform1f=hoverUniform1;gl.uniform2f=hoverUniform2;');
assert.equal(run('JSON.stringify(objects.map(o=>serializeObject(o)))'),run('hoverGeometryBefore'));assert.equal(run('undoStack.length'),run('hoverHistoryBefore'));
// Emit application shader inputs for a real GLES2 raster check, including keys
// above 65,536, selected brightness, all styles, masks and disabled highlighting.
const cases=[];
for(const style of ['modeling','illustration','presentation'])for(const normal of [[0,0,1],[1,0,0],[-1,0,0]])for(const ambient of [.70,.82])for(const key of [1,4095,4096,65535,65536,112870]){
 sandbox.colorNormal=normal;sandbox.colorAmbient=ambient;sandbox.colorStyle=style;
 cases.push({style:style==='modeling'?0:style==='illustration'?1:2,normal,ambient,key,vertexKey:key,enabled:1,expected:plain(run("sceneLitColor([.96,.70,.32],colorNormal,colorStyle,colorAmbient,[0,0,1])"))});
}
for(const style of ['modeling','illustration','presentation']){
 sandbox.perspectiveStyle=style;
 const expected=plain(run(`(()=>{const a=[-.8,-.8,0],c=[.8,.8,0],eye=[0,0,2],t=(.03125+.8)/1.6;return sceneLitColor([.96,.70,.32],[0,0,1],perspectiveStyle,.82,V.unit(V.sub(eye,a))).map((v,i)=>v*(1-t)+sceneLitColor([.96,.70,.32],[0,0,1],perspectiveStyle,.82,V.unit(V.sub(eye,c)))[i]*t);})()`));
 cases.push({style:style==='modeling'?0:style==='illustration'?1:2,normal:[0,0,1],ambient:.82,key:112870,vertexKey:112870,enabled:1,ortho:0,expected});
}
for(const extra of [{vertexKey:65537,key:65536,enabled:1},{vertexKey:0,key:65536,enabled:1},{vertexKey:65536,key:65536,enabled:0},{vertexKey:0,key:65536,enabled:1,disableAttribute:true}])cases.push({style:0,normal:[0,0,1],ambient:.7,expected:[.2,.3,.4],...extra});
const directory=resolve(root,'docs/verification/v151');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(resolve(directory,'hover-shader-scene.json'),JSON.stringify({vertex:run('modelVertexShaderSource()'),fragment:run('modelFragmentShaderSource()'),cases},null,2)+'\n');
console.log('R252 hover performance passed: no face-label triangulation/loop copies, exact labels, isolated metadata, cached topology/BVH counts with lazy/hidden/replacement updates, zero static uploads for hover/fallback in three styles, preview-color precedence, one Push hover pick with groups/locks, unchanged canonical geometry/history.');
