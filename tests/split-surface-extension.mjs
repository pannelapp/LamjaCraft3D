import assert from 'node:assert/strict';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
import {ModelingWorker} from './modeling-worker-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),f=createAppFixture(root),run=s=>vm.runInContext(s,f.sandbox);
function closed(solid){f.sandbox.extensionSolid=solid;const bytes=Buffer.from(run('prepareBinarySTL([{id:"cut",name:"Cut",solid:extensionSolid,transform:{position:[0,0,0],rotation:[0,0,0]}}])')),edges=new Map();for(let i=0;i<bytes.readUInt32LE(80);i++){const ps=[0,1,2].map(j=>[0,1,2].map(k=>bytes.readFloatLE(84+i*50+12+j*12+k*4)).join(','));assert.equal(new Set(ps).size,3);for(let j=0;j<3;j++){const a=ps[j],b=ps[(j+1)%3],key=a<b?a+'|'+b:b+'|'+a,e=edges.get(key)||[0,0];e[0]++;e[1]+=a<b?1:-1;edges.set(key,e);}}for(const e of edges.values())assert.deepEqual(e,[2,0]);}
const integral=80*(2*1+3+4+2*8)/6+32*8*(1+4)/2+18*8*(3+8)/2+13*10*(1+3)/2+19*10*(4+8)/2+32*13*1+18*13*3+32*19*4+18*19*8;
for(const sign of [-1,1])for(const rotated of [false,true]){
 run(`var source=primitivePrism([[-30,-20],[30,-20],[30,20],[-30,20]],20),grid={width:10,height:8,columns:2,rows:2,heights:[${[1,3,4,8].map(h=>h*sign)}]},frame={origin:[7,-3,10],normal:[0,0,1],axis:[1,0,0]};`);
 if(rotated)run('var pose={position:[91,-34,12],rotation:[21,32,47]};source=csgToSolid(solidToCsg(source).map(p=>csgPolygon(p.vs.map(v=>transformPoint(v,pose)))),source.id);frame={origin:transformPoint(frame.origin,pose),normal:rotate(frame.normal,pose.rotation),axis:rotate(frame.axis,pose.rotation)};');
 const original=run('JSON.stringify(serializeSolid(source))'),shape=run('JSON.stringify(grid)');
 const result=run("geometryApi.splitBySurface({type:'split-surface',solid:source,grid,frame})");
 for(const [name,expected] of [['negative',24000+sign*integral],['positive',24000-sign*integral]]){f.sandbox.extensionSolid=result[name];assert.equal(run('validateSolid(extensionSolid,false).ok'),true);assert.ok(Math.abs(run('validateSolid(extensionSolid,false).volume')-expected)<1e-4,`${sign}/${rotated}/${name} independent edge/corner volume`);closed(result[name]);}
 assert.equal(run('JSON.stringify(serializeSolid(source))'),original);assert.equal(run('JSON.stringify(grid)'),shape);
}
// A grid completely outside the target still extends its nearest corner level.
run('var source=primitivePrism([[-30,-20],[30,-20],[30,20],[-30,20]],20),grid={width:10,height:8,columns:2,rows:2,heights:[1,3,4,8]},frame={origin:[70,60,10],normal:[0,0,1],axis:[1,0,0]};var cut=geometryApi.splitBySurface({type:"split-surface",solid:source,grid,frame});');assert.ok(Math.abs(run('validateSolid(cut.negative,false).volume')-26400)<1e-5);closed(run('cut.negative'));closed(run('cut.positive'));
// Nonrectangular targets and oblique cutter frames use the same closed extension.
for(const sourceCode of ["prismRegion([[-10,-10],[10,-10],[10,10],[-10,10]],[[[-2,-2],[-2,2],[2,2],[2,-2]]],20)","primitivePrism([[-10,-10],[10,-10],[10,0],[0,0],[0,10],[-10,10]],20)"]){
 run(`var source=${sourceCode},grid=bendSplitSurface({width:6,height:8,columns:5,rows:5,heights:Array(25).fill(0)},12,2,5),frame={origin:[0,0,10],normal:[.5,0,Math.sqrt(.75)],axis:[Math.sqrt(.75),0,-.5]},cut=geometryApi.splitBySurface({type:'split-surface',solid:source,grid,frame});`);
 assert.ok(Math.abs(run('validateSolid(cut.positive,false).volume+validateSolid(cut.negative,false).volume-validateSolid(source,false).volume'))<1e-5);for(const side of ['positive','negative']){assert.equal(run(`validateSolid(cut.${side},false).ok`),true);closed(run(`cut.${side}`));}
}
// Existing grid nodes are kept exactly: extension only adds repeated rim heights.
for(const n of [2,9,30]){run(`var grid={width:10,height:8,columns:${n},rows:${n},heights:Array.from({length:${n*n}},(_,i)=>i%${n}+Math.floor(i/${n})*2)},copy=JSON.stringify(grid),extended=extendSplitSurfaceForTarget(grid,[[-37,-17,0],[23,23,20]]);`);assert.equal(run('JSON.stringify(grid)'),run('copy'));assert.equal(run('extended.columns'),n+2);assert.equal(run('extended.rows'),n+2);run(`for(var y=0;y<${n};y++)for(var x=0;x<${n};x++)if(extended.heights[(y+1)*extended.columns+x+1]!==grid.heights[y*${n}+x])throw Error('Original grid node changed');`);}
// Real worker/controller commit uses the same automatic extension and history.
const worker=createAppFixture(root,ModelingWorker),wr=s=>vm.runInContext(s,worker.sandbox);wr('cancelGesture();replaceGroups([]);replaceGuides([]);replaceObjects([makeObject("box")]);selectObject(objects[0]);setTool("splitplane");var g=createSplitSurfaceGuide(bendSplitSurface({width:10,height:8,columns:30,rows:30,heights:Array(900).fill(0)},465,2,5));activateSplitPlane(g.id);splitSurfaceMode="split";undoStack=[];redoStack=[];var volume=validateSolid(objects[0].solid,false).volume;');const before=wr('snapshot()');await wr('runSplitSurfaceFromUI(objects[0],activeSplitPlane())');assert.equal(wr('objects.length'),2);assert.equal(wr('undoStack.length'),1);assert.equal(wr('guides.length'),0);assert.equal(wr('objects.every(o=>validateSolid(o.solid,false).ok)'),true);assert.ok(Math.abs(wr('objects.reduce((s,o)=>s+validateSolid(o.solid,false).volume,0)')-wr('volume'))<1e-5);const after=wr('snapshot()');wr('undo()');assert.equal(wr('snapshot()'),before);wr('redo()');assert.equal(wr('snapshot()'),after);
console.log('R249 passed: automatic edge and corner extensions, independent asymmetric volumes for both signs and rigid placement, grid outside target, unchanged source/grid, 30x30 nodes, closed Float32 STL and real worker/controller Undo/Redo.');
