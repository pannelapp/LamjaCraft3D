import assert from 'node:assert/strict';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const f=createAppFixture(resolve(import.meta.dirname,'..')),run=s=>vm.runInContext(s,f.sandbox);
function setup(){run(`cancelGesture();replaceGuides([]);setTool('splitplane');var g=createSplitSurfaceGuide(bendSplitSurface({width:100,height:80,columns:30,rows:30,heights:Array(900).fill(0)},465,5,25));activateSplitPlane(g.id);rotateGuidePlane(g.id,[1,1,0],21);splitSurfaceMode='split';undoStack=[];redoStack=[];cameraBasis();`);f.get('snap').checked=false;}
function close(a,b,msg){assert.ok(Math.hypot(...a.map((v,i)=>v-b[i]))<1e-6,msg);}
for(const kind of ['move','tilt'])for(const name of ['normal','u','v','x','y','z'])for(const sign of [-1,1]){
 setup();f.get('splitPlaneMoveAxis').value=kind==='move'?name:'normal';f.get('splitPlaneTiltAxis').value=kind==='tilt'?name:'u';const before=run('snapshot()'),shape=run('JSON.stringify(activeSplitPlane().surface)');
 run(`var g=activeSplitPlane(),frame=splitSurfaceGuideFrame(g),points=splitSurfaceWorldPoints(g.surface,frame),z=splitPlaneGizmoGeometry(g),q=project(z.${kind==='move'?'movePoint':'rotatePoint'});splitPlaneToolController.pointerDown({x:q[0],y:q[1],rawHit:null});`);
 assert.equal(run('pointer.type'),kind==='move'?'split-plane-move':'split-plane-rotate',kind+'/'+name);
 const motion=kind==='move'?`splitPlaneToolController.pointerMove({x:pointer.startX+pointer.screenDir[0]*pointer.pixelsPerMm*${sign*7},y:pointer.startY+pointer.screenDir[1]*pointer.pixelsPerMm*${sign*7}});`:`var target=project(V.add(g.origin,V.mul(rotateVectorAroundAxis(z.rotateRadial,z.axis,${sign*23}),z.rotateRadius)));splitPlaneToolController.pointerMove({x:target[0],y:target[1]});`;
 run(motion+'render();');assert.equal(run('undoStack.length'),0);
 if(kind==='move')close(run('activeSplitPlane().origin'),run(`V.add(frame.origin,V.mul(z.moveAxis,${sign*7}))`),name);
 else{
  assert.ok(Math.abs(run('pointer.angle')-sign*23)<1e-5,name+' signed angle');
  close(run('activeSplitPlane().normal'),run(`rotateVectorAroundAxis(frame.normal,z.axis,${sign*23})`),name+' normal');
  close(run('activeSplitPlane().axis'),run(`rotateVectorAroundAxis(frame.axis,z.axis,${sign*23})`),name+' stored frame');
  const actual=run('splitSurfaceWorldPoints(activeSplitPlane().surface,splitSurfaceGuideFrame(activeSplitPlane()))'),expected=run(`points.map(p=>V.add(frame.origin,rotateVectorAroundAxis(V.sub(p,frame.origin),z.axis,${sign*23})))`);for(let i=0;i<900;i++)close(actual[i],expected[i],name+' point '+i);
 }
 run('cancelGesture()');assert.equal(run('snapshot()'),before);
 run(`${kind==='move'?'beginSplitPlaneMoveDrag':'beginSplitPlaneRotateDrag'}(activeSplitPlane(),q[0],q[1]);`);
 run(kind==='move'?motion:'splitPlaneToolController.pointerMove({x:target[0],y:target[1]});');run('splitPlaneToolController.pointerUp();');assert.equal(run('undoStack.length'),1);assert.equal(run('JSON.stringify(activeSplitPlane().surface)'),shape);
 const after=run('snapshot()');run('undo()');assert.equal(run('snapshot()'),before);run('redo()');assert.equal(run('snapshot()'),after);
 run('var persisted=projectData();loadProject(persisted);');assert.equal(run('JSON.stringify(guides[0].surface)'),shape);close(run('guides[0].normal'),run('persisted.construction.guides[0].normal'),name+' reopen');
}
for(const name of ['u','v']){setup();run('activeSplitPlane().surface=undefined;activeSplitPlane().axis=undefined;');f.get('splitPlaneTiltAxis').value=name;run('beginSplitPlaneRotateDrag(activeSplitPlane(),0,0)');assert.equal(run('pointer.type'),'split-plane-rotate');run('cancelGesture()');assert.equal(run('activeSplitPlane().axis'),undefined);}
setup();const idle=run('snapshot()');run("beginSplitPlaneMoveDrag(activeSplitPlane(),0,0);updateSplitPlaneMoveDrag(30,20)");f.get('splitPlaneMoveAxis').value='x';f.get('splitPlaneMoveAxis').onchange();assert.equal(run('pointer'),null);assert.equal(run('snapshot()'),idle);assert.equal(run('undoStack.length'),0);
run('modelingOperationBusy=true;updateSplitSurfaceUI()');for(const id of ['splitPlaneMoveAxis','splitPlaneTiltAxis'])assert.equal(f.get(id).disabled,true);run('modelingOperationBusy=false;updateSplitSurfaceUI()');for(const id of ['splitPlaneMoveAxis','splitPlaneTiltAxis'])assert.equal(f.get(id).disabled,false);
console.log('R248 passed: both signed directions on six move and six rotate axes, actual handle picking, preview/cancel/commit, 900 rigid points, spin, exact Undo/Redo, reopen and legacy planes.');
