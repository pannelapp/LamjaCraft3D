import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),plain=value=>JSON.parse(JSON.stringify(value));
const near=(a,b)=>assert.ok(Math.hypot(...a.map((x,i)=>x-b[i]))<1e-7,`${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const rotate=(point,pivot,axis,angle)=>{
 const n=axis.map(x=>x/Math.hypot(...axis)),v=point.map((x,i)=>x-pivot[i]),c=Math.cos(angle*Math.PI/180),s=Math.sin(angle*Math.PI/180),dot=v.reduce((sum,x,i)=>sum+x*n[i],0),cross=[n[1]*v[2]-n[2]*v[1],n[2]*v[0]-n[0]*v[2],n[0]*v[1]-n[1]*v[0]];
 return pivot.map((x,i)=>x+v[i]*c+cross[i]*s+n[i]*dot*(1-c));
};
function fixture(mode){
 const f=createAppFixture(root),run=s=>vm.runInContext(s,f.sandbox);f.sandbox.testMode=mode;
 run(`objects.splice(0);groups.splice(0);for(let i=0;i<8;i++){const o=makeObject('box');o.name='Part '+i;o.transform={position:[i*27-70,i%2?31:-19,i*3+2],rotation:[i*7-20,i*3-13,i*11+5]};objects.push(o);}
 objects[6].kind='surface';objects[6].solid=deserializeProjectSurface({schema:'poly-brep-1',id:'sheet',metadata:{},vertices:[{id:'a',position:[0,0,0]},{id:'b',position:[8,0,0]},{id:'c',position:[8,6,0]},{id:'d',position:[0,6,0]}],faces:[{id:'f1',outer:['a','b','c','d'],holes:[]}]});
 groups.push({id:'grp1',name:'First',objectIds:objects.slice(0,2).map(o=>o.id)},{id:'grp2',name:'Second',objectIds:objects.slice(2,4).map(o=>o.id)});
 if(testMode==='objects')setObjectSelection([objects[4].id,objects[5].id],objects[4].id);
 if(testMode==='group-extra'){objects[1].hidden=true;setGroupSelection(groups[0],[objects[4].id,objects[6].id]);}
 if(testMode==='groups')setGroupSelection(groups[1],[...groups[0].objectIds,objects[4].id]);
 if(testMode==='partial'){objects[1].locked=true;setObjectSelection([objects[0].id,objects[2].id],objects[0].id,true,false);}
 if(testMode==='surface')setObjectSelection([objects[4].id,objects[6].id],objects[4].id);
 camera.target=[0,0,10];camera.distance=200;camera.orthographic=true;setView('top');cameraBasis();undoStack=[];redoStack=[];dirty=false;`);
 for(const id of ['snap','geomSnap','guideSnap'])f.get(id).checked=false;
 const state=()=>run('snapshot()'),geometry=()=>run('JSON.stringify(objects.map(o=>serializeSolid(o.solid)))'),selection=()=>run('JSON.stringify([modelDocument.selection,selectedObjectIds(),groups])');
 const transforms=()=>plain(run('objects.map(o=>({id:o.id,...structuredClone(o.transform)}))'));
 const vertices=()=>plain(run('objects.map(o=>[...o.solid.vertices.values()].map(v=>transformPoint(v.position,o.transform)))'));
 const ids=plain(run('selectedObjectIds()')),targetIndices=plain(run('objects.map((o,i)=>isObjectSelected(o.id)?i:-1).filter(i=>i>=0)'));
 const anchor=targetIndices[0];f.sandbox.anchorIndex=anchor;
 const hit=()=>plain(run('(()=>{const o=objects[anchorIndex],face=[...o.solid.faces.keys()][0];return {id:o.id,face,point:transformPoint(geometryApi.faceCentroid(o.solid,face),o.transform)};})()'));
 const assertMove=(before,delta)=>{const after=transforms();after.forEach((o,i)=>{near(o.position,before[i].position.map((x,a)=>x+(targetIndices.includes(i)?delta[a]:0)));near(o.rotation,before[i].rotation);});};
 const assertRotation=(before,pivot,axis,angle)=>{const after=vertices();for(let i=0;i<after.length;i++)for(let v=0;v<after[i].length;v++)near(after[i][v],targetIndices.includes(i)?rotate(before[i][v],pivot,axis,angle):before[i][v]);};
 const history=(before,type,selected,brep)=>{assert.equal(run('undoStack.length'),1);assert.equal(run('lastCommandEntry().type'),type);assert.equal(selection(),selected);assert.equal(geometry(),brep);const after=state();run('undo()');assert.equal(state(),before);run('redo()');assert.equal(state(),after);assert.equal(selection(),selected);};
 return {...f,run,state,geometry,selection,transforms,vertices,ids,targetIndices,hit,assertMove,assertRotation,history};
}
const modes=['objects','group-extra','groups','partial','surface'];
// Actual click/place and drag/release use the same complete frozen target set.
for(const mode of modes)for(const route of ['click','drag']){
 const f=fixture(mode),{run,sandbox,ids}=f;run("setTool('move');setAxis('free')");const before=f.state(),starts=f.transforms(),selected=f.selection(),brep=f.geometry();sandbox.hit=f.hit();run('moveToolController.pointerDown({x:400,y:300,hit})');assert.equal(f.selection(),selected);assert.deepEqual(plain(run('[...pointerMovingIds()]')),ids);
 const delta=[12.75,-7.25,0];sandbox.delta=delta;const end=plain(run('project(V.add(pointer.start,delta))'));sandbox.xy=end;run('moveToolController.pointerMove({x:xy[0],y:xy[1]})');f.assertMove(starts,delta);assert.equal(run('undoStack.length'),0);
 run(route==='click'?'moveToolController.pointerDown({x:xy[0],y:xy[1],hit:null})':'moveToolController.pointerUp({x:xy[0],y:xy[1]})');assert.equal(run('pointer'),null);f.assertMove(starts,delta);f.history(before,'move-objects',selected,brep);
}
// Numeric seeding needs no viewport click for a chosen world axis, including
// groups with extras, complete hidden membership and selected open surfaces.
for(const mode of modes)for(const axis of ['x','y','z'])for(const sign of [-1,1]){
 const f=fixture(mode),{run,get}=f;run(`setTool('move');setAxis('${axis}')`);get('snap').checked=true;get('snapStep').value='50';const before=f.state(),starts=f.transforms(),selected=f.selection(),brep=f.geometry();assert.equal(run('moveToolController.numericSeed()'),true);assert.equal(f.selection(),selected);
 run(`moveToolController.numericPreview({distance:${sign*11.25}})`);const delta=['x','y','z'].map(a=>a===axis?sign*11.25:0);f.assertMove(starts,delta);assert.equal(run('undoStack.length'),0);run(`moveToolController.numericCommit({distance:${sign*11.25}})`);f.assertMove(starts,delta);f.history(before,'move-objects',selected,brep);
}
// World modes use the union of the selected geometry bounds, including hidden
// members of complete groups. Expected vertices use independent Rodrigues math.
const axes={'world-xy':[0,0,1],'world-xz':[0,1,0],'world-yz':[1,0,0]};
for(const mode of modes)for(const plane of Object.keys(axes))for(const route of ['numeric','panel','drag','click']){
 const f=fixture(mode),{run,sandbox,get}=f;run(`setTool('rotate');rotationPlaneMode='${plane}'`);const before=f.state(),source=f.vertices(),selected=f.selection(),brep=f.geometry(),points=f.targetIndices.flatMap(i=>source[i]);
 const pivot=[0,1,2].map(a=>(Math.min(...points.map(p=>p[a]))+Math.max(...points.map(p=>p[a])))/2),angle=route==='drag'||route==='click'?37:-27.5;
 if(route==='numeric'){assert.equal(run('rotateToolController.numericSeed()'),true);near(plain(run('pointer.rotationPivot')),pivot);run('rotateToolController.numericPreview({angle:-27.5})');f.assertRotation(source,pivot,axes[plane],angle);assert.equal(run('undoStack.length'),0);run('rotateToolController.numericCommit({angle:-27.5})');}
 else if(route==='panel'){get('rotateAngle').value=String(angle);get('applyRotateAngle').onclick();}
 else {sandbox.hit=f.hit();run('rotateToolController.pointerDown({x:400,y:300,hit})');near(plain(run('pointer.rotationPivot')),pivot);run('rotateToolController.pointerMove({x:474,y:300})');f.assertRotation(source,pivot,axes[plane],angle);assert.equal(run('undoStack.length'),0);run(route==='drag'?'rotateToolController.pointerUp({x:474,y:300})':'rotateToolController.pointerDown({x:474,y:300,hit:null})');}
 f.assertRotation(source,pivot,axes[plane],angle);f.history(before,'rotate-objects',selected,brep);
}
// A selected picked face supplies one axis/pivot for every selected object;
// picking it cannot discard other objects, additional groups or hidden members.
for(const mode of modes){
 const f=fixture(mode),{run,sandbox}=f;run("setTool('rotate');rotationPlaneMode='face'");const before=f.state(),source=f.vertices(),selected=f.selection(),brep=f.geometry();sandbox.hit=f.hit();run('rotateToolController.pointerDown({x:400,y:300,hit})');assert.equal(f.selection(),selected);const pivot=plain(run('pointer.rotationPivot')),axis=plain(run('pointer.rotationAxis'));near(pivot,sandbox.hit.point);
 run('rotateToolController.numericPreview({angle:43})');f.assertRotation(source,pivot,axis,43);assert.equal(run('undoStack.length'),0);run('rotateToolController.numericCommit({angle:43})');f.assertRotation(source,pivot,axis,43);f.history(before,'rotate-objects',selected,brep);
}
for(const mode of modes)for(const tool of ['move','rotate'])for(const cancel of ['escape','toolbar','camera-toolbar']){
 const f=fixture(mode),{run,sandbox}=f;run(`setTool('${tool}');setAxis('x');rotationPlaneMode='world-xy'`);const before=f.state(),selected=f.selection();assert.equal(run(`${tool}ToolController.numericSeed()`),true);run(tool==='move'?'previewMoveDistance(9)':'previewRotateAngle(41)');
 if(cancel==='escape'){sandbox.event={key:'Escape',preventDefault(){}};run('handleApplicationKeyDown(event)');}
 else {if(cancel==='camera-toolbar')run('beginCameraPointer({button:2},400,300,activeToolController())');run("setTool('rect')");}
 assert.equal(f.state(),before);assert.equal(f.selection(),selected);assert.equal(run('undoStack.length'),0);assert.equal(run('dirty'),false);assert.equal(run('pointer'),null);
}
// Any locked selected target blocks the entire action before preview. Locked
// siblings of an explicitly partial group selection remain outside the action.
for(const tool of ['move','rotate']){
 const f=fixture('group-extra'),{run,sandbox}=f;run(`setTool('${tool}');setAxis('x');rotationPlaneMode='world-xy';objects[4].locked=true`);const before=f.state();sandbox.hit=f.hit();run(`${tool}ToolController.pointerDown({x:400,y:300,hit})`);assert.equal(run('pointer'),null);assert.equal(run(`${tool}ToolController.numericSeed()`),false);assert.equal(f.state(),before);assert.equal(run('undoStack.length'),0);
 const partial=fixture('partial');partial.run(`setTool('${tool}');setAxis('x');rotationPlaneMode='world-xy'`);assert.equal(partial.run(`${tool}ToolController.numericSeed()`),true);partial.run(tool==='move'?'moveToolController.numericCommit({distance:7})':'rotateToolController.numericCommit({angle:12})');assert.equal(partial.run('undoStack.length'),1);
 const mid=fixture('objects');mid.run(`setTool('${tool}');setAxis('x');rotationPlaneMode='world-xy'`);const originalTransforms=mid.transforms();assert.equal(mid.run(`${tool}ToolController.numericSeed()`),true);mid.run(tool==='move'?'previewMoveDistance(4)':'previewRotateAngle(24)');mid.run('objects[5].locked=true');mid.run(tool==='move'?'commitMovePointer()':'commitRotatePointer()');assert.deepEqual(mid.transforms(),originalTransforms);assert.equal(mid.run('undoStack.length'),0);
 const busy=fixture('objects');busy.run(`setTool('${tool}');setAxis('x');rotationPlaneMode='world-xy';modelingOperationBusy=true`);assert.equal(busy.run(`${tool}ToolController.numericSeed()`),false);assert.equal(busy.run('pointer'),null);assert.equal(busy.run('undoStack.length'),0);
}
// Clicking outside the selection deliberately starts a new target selection.
for(const tool of ['move','rotate']){const f=fixture('objects');f.run(`setTool('${tool}');setAxis('x');rotationPlaneMode='world-xy';${tool}ToolController.pointerDown({x:400,y:300,hit:{id:objects[7].id,face:[...objects[7].solid.faces.keys()][0],point:[0,0,0]}})`);assert.deepEqual(plain(f.run('selectedObjectIds()')),[f.run('objects[7].id')]);f.run('cancelGesture()');}
// A 1,000-object selection still produces one command per operation, retaining
// all IDs and relative placement without touching the B-rep.
{
 const f=fixture('objects'),{run}=f;run('groups.splice(0);while(objects.length<1000)objects.push(makeObject("box"));setObjectSelection(objects.map(o=>o.id));setTool("move");setAxis("z")');const geometry=f.geometry();assert.equal(run('moveToolController.numericSeed()'),true);run('moveToolController.numericCommit({distance:5.25})');assert.equal(run('undoStack.length'),1);assert.equal(run('lastCommandEntry().parameters.objectIds.length'),1000);assert.equal(f.geometry(),geometry);run("setTool('rotate');rotationPlaneMode='world-yz'");assert.equal(run('rotateToolController.numericSeed()'),true);run('rotateToolController.numericCommit({angle:90})');assert.equal(run('undoStack.length'),2);assert.equal(run('selectedObjectIds().length'),1000);assert.equal(f.geometry(),geometry);
}
console.log('Multi-object transforms passed: complete mixed selections/groups/hidden members/surfaces and partial groups, actual Move click/drag/numeric axes, common world/face Rotate pivots with independent Rodrigues vertices, panel/numeric/click/drag, one-command selection-preserving Undo/Redo, snapping target exclusion, locks/busy/cancel/camera/tool changes and 1000-object geometry-preserving transforms.');
