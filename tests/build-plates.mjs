import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..');
let acceptReplacement=true,confirmCount=0;
const {sandbox,get,downloads,shaderSources}=createAppFixture(root,undefined,{confirm(){confirmCount++;return acceptReplacement;}});
const run=code=>vm.runInContext(code,sandbox),plain=value=>JSON.parse(JSON.stringify(value)),state=()=>run('JSON.stringify(projectData())');
get('newBtn').onclick();
assert.equal(run('buildPlates.length'),0);assert.equal(run('projectData().references'),undefined);
const history=run('undoStack.length');
get('buildPlatesBtn').onclick();assert.equal(get('buildPlateDialog').open,true);assert.equal(get('buildPlateApply').disabled,true);
get('buildPlateAdd').onclick();get('buildPlateAdd').onclick();
assert.equal(run('undoStack.length'),history+2);assert.equal(run('lastCommandEntry().type'),'add-build-plate');assert.equal(run('dirty'),true);
const plates=plain(run('buildPlates'));
assert.deepEqual(plates.map(p=>[p.width,p.depth,p.x,p.y,p.opacity]),[[220,220,0,0,.35],[220,220,240,0,.35]]);
assert.equal(new Set(plates.map(p=>p.id)).size,2);
get('buildPlateSelect').value=plates[0].id;get('buildPlateSelect').onchange();
for(const [id,value] of Object.entries({buildPlateName:'My printer',buildPlateWidth:'256',buildPlateDepth:'180',buildPlateX:'-80',buildPlateY:'55',buildPlateColor:'#ba7638',buildPlateOpacity:'42'}))get(id).value=value;
get('buildPlateVisible').checked=true;get('buildPlateApply').onclick();
assert.deepEqual(plain(run('buildPlateCorners(buildPlates[0])')),[[-208,-35,0],[48,-35,0],[48,145,0],[-208,145,0]]);
assert.equal(run('buildPlates[0].opacity'),.42);assert.equal(run('buildPlates[0].color'),'#ba7638');
assert.equal(run('undoStack.length'),history+3);
const edited=state(),editHistory=run('undoStack.length');get('buildPlateApply').onclick();assert.equal(run('undoStack.length'),editHistory,'Unchanged Apply created history');
get('buildPlateX').value='';get('buildPlateApply').onclick();assert.equal(state(),edited,'Blank number changed the plate');assert.match(get('buildPlateError').textContent,/Center X must be a finite number/);assert.equal(get('buildPlateError').classList.contains('hidden'),false);
get('buildPlateWidth').value='-1';get('buildPlateApply').onclick();assert.equal(state(),edited,'Invalid size changed the plate');
run('updateBuildPlateUI()');get('buildPlateName').value='Discarded draft';get('buildPlateClose').onclick();get('buildPlatesBtn').onclick();assert.equal(get('buildPlateName').value,'My printer');
run('undo()');assert.equal(run('buildPlates[0].width'),220);run('redo()');assert.equal(state(),edited);
get('buildPlateDelete').onclick();assert.equal(run('buildPlates.length'),1);run('undo()');assert.equal(state(),edited);run('redo()');assert.equal(run('buildPlates.length'),1);run('undo()');
get('saveBtn').onclick();const saved=JSON.parse(await downloads.at(-1).text());
assert.equal(saved.version,7);assert.deepEqual(saved.references.buildPlates,plain(run('buildPlates')));assert.equal(run('dirty'),false);
sandbox.saved=saved;run('loadProject(saved)');assert.equal(state(),JSON.stringify(saved));
const original=state(),badPlate={...saved.references.buildPlates[0]};
for(const patch of [{width:0},{depth:-1},{x:Infinity},{y:NaN},{width:1e100},{opacity:1.01},{opacity:-.1},{opacity:'0.5'},{color:'red'},{visible:'false'},{name:5},{id:''}]){
 sandbox.bad={...saved,references:{buildPlates:[{...badPlate,...patch}]}};
 assert.throws(()=>run('loadProject(bad)'));assert.equal(state(),original,'Invalid project partially replaced the document');
}
for(const references of [null,[],{buildPlates:null},{buildPlates:[badPlate,badPlate]},{buildPlates:Array.from({length:129},(_,i)=>({...badPlate,id:'p'+i}))}]){
 sandbox.bad={...saved,references};assert.throws(()=>run('loadProject(bad)'));assert.equal(state(),original);
}
const legacy={...saved};delete legacy.references;sandbox.legacy=legacy;run('loadProject(legacy)');assert.equal(run('buildPlates.length'),0);run('undo()');assert.equal(state(),original);
// Imported IDs cannot overflow allocation or trap Add in a repeated ID loop.
sandbox.largeIds={...saved,references:{buildPlates:[{...badPlate,id:'bp'+'9'.repeat(400)},{...badPlate,id:'bp9007199254740990'}]}};
run('loadProject(largeIds);createBuildPlate();createBuildPlate()');assert.equal(run('new Set(buildPlates.map(p=>p.id)).size'),4);
run('loadProject(saved)');
const onlyPlates=state();acceptReplacement=false;const beforeConfirm=confirmCount;get('newBtn').onclick();assert.equal(confirmCount,beforeConfirm+1);assert.equal(state(),onlyPlates);
acceptReplacement=true;get('newBtn').onclick();assert.equal(run('buildPlates.length'),0);run('undo()');assert.equal(state(),onlyPlates);
// A failed document operation rolls reference state and ID allocation back.
const rollback=state(),counter=run('nextBuildPlateId'),rollbackHistory=run('undoStack.length');
assert.throws(()=>run("executeDocumentCommand({type:'fixture-failure',label:'Failure',execute(){buildPlates.splice(0);nextBuildPlateId=987;throw Error('Expected rollback');}})"),/Expected rollback/);
assert.equal(state(),rollback);assert.equal(run('nextBuildPlateId'),counter);assert.equal(run('undoStack.length'),rollbackHistory);
run("beginModelingOperation('Busy');updateUI()");assert.equal(get('buildPlateApply').disabled,true);assert.equal(get('buildPlateAdd').disabled,true);
for(const id of ['buildPlateAdd','buildPlateApply','buildPlateDelete'])get(id).onclick();assert.equal(state(),rollback);assert.throws(()=>run('createBuildPlate()'),/Wait/);run('endModelingOperation()');
// Plates are not model entities: actual geometry, picking, snapping, camera Fit
// and all export scopes must remain identical even with a very distant plate.
get('newBtn').onclick();run("addObject('box');setView('top');fit();setTool('move')");
const query=`JSON.stringify({objects:objects.map(serializeProjectObject),groups,selection:modelDocument.selection,objectSelection:modelDocument.objectSelection,tool,edges:allWorldEdges(),centers:allWorldCenters(),hit:hitTest(W/2,H/2),snap:bestWorldEdgeSnap(W/2,H/2,camera.target,allWorldEdges(),undefined,[],true,allWorldCenters())})`;
const geometryBefore=run(query),fitBefore=run('JSON.stringify(camera)'),modelSTL=Buffer.from(run('binarySTL(exportObjects())'));
const modelHistory=run('undoStack.length');run("createBuildPlate({width:600,depth:400,x:100000,y:-100000});createBuildPlate({width:220,depth:200,x:0,y:0});fit()");
assert.equal(run(query),geometryBefore);assert.equal(run('JSON.stringify(camera)'),fitBefore);
assert.deepEqual(Buffer.from(run('binarySTL(exportObjects())')),modelSTL);assert.equal(run('exportObjects().length'),1);
get('exportScope').value='selected';assert.equal(run('exportObjects().length'),1);get('exportScope').value='all';
assert.equal(run('undoStack.length'),modelHistory+2);
const withPlates=state();run('duplicateObject();undo()');assert.equal(state(),withPlates,'Model undo lost references');
// Opening a document-editing dialog restores an unfinished Move preview
// before plate commands capture history, and retains the explicitly chosen tool.
get('buildPlateClose').onclick();
const committed=state(),committedHistory=run('undoStack.length');
run("setTool('move');setAxis('x');moveToolController.numericSeed();previewMoveDistance(10)");
assert.notEqual(state(),committed);get('buildPlatesBtn').onclick();
assert.equal(state(),committed);assert.equal(run('pointer'),null);assert.equal(run('tool'),'move');assert.equal(run('undoStack.length'),committedHistory);
get('buildPlateAdd').onclick();run('undo()');assert.equal(state(),committed,'Plate Undo captured a temporary transform');
// Observe real render calls: alpha blending before solids, zero plate depth
// writes, exact rectangular draw counts, and restored state for model draws.
const gl=run('gl'),alphaLocation=run('uniform.opacity'),fill=run('buildPlateFillBuffer'),outline=run('buildPlateOutlineBuffer'),modelBuffer=run('triangleBuffer');
Object.assign(gl,{BLEND:1,SRC_ALPHA:2,ONE_MINUS_SRC_ALPHA:3,TRIANGLES:4,LINES:5});
let bound,depthWrite=true,alpha=1,blending=false;const draws=[],blends=[];
gl.bindBuffer=(_kind,buffer)=>{bound=buffer;};gl.depthMask=value=>{depthWrite=value;};gl.uniform1f=(location,value)=>{if(location===alphaLocation)alpha=value;};
gl.enable=kind=>{if(kind===gl.BLEND)blending=true;};gl.disable=kind=>{if(kind===gl.BLEND)blending=false;};gl.blendFunc=(...args)=>blends.push(args);
gl.drawArrays=(kind,offset,count)=>draws.push({bound,kind,offset,count,depthWrite,alpha,blending});
run('render()');
const plateDraws=draws.filter(d=>d.bound===fill||d.bound===outline),modelDraws=draws.filter(d=>d.bound===modelBuffer);
assert.equal(plateDraws.length,4);assert.deepEqual(plateDraws.map(d=>[d.kind,d.offset,d.count,d.alpha]),[[4,0,6,.35],[5,0,8,1],[4,6,6,.35],[5,8,8,1]]);
assert.ok(plateDraws.every(d=>!d.depthWrite&&d.blending));assert.ok(modelDraws.length&&modelDraws.every(d=>d.depthWrite&&!d.blending&&d.alpha===1));
assert.ok(draws.indexOf(plateDraws.at(-1))<draws.indexOf(modelDraws[0]));assert.deepEqual(blends[0],[2,3]);assert.equal(depthWrite,true);assert.equal(alpha,1);assert.equal(blending,false);
assert.ok(shaderSources.some(s=>s.includes('vec4(lit,opacity)')));
run('updateBuildPlate(buildPlates[0].id,{...buildPlates[0],visible:false});updateBuildPlate(buildPlates[1].id,{...buildPlates[1],opacity:0})');draws.length=0;run('render()');assert.equal(draws.filter(d=>d.bound===fill||d.bound===outline).length,0);
get('newBtn').onclick();run('createBuildPlate()');assert.equal(run('hitTest(W/2,H/2)'),null);assert.equal(run('allWorldEdges().length'),0);assert.equal(run('allWorldCenters().length'),0);assert.equal(run('exportObjects().length'),0);run('ensureScene()');assert.equal(run('triCount'),0);
const html=fs.readFileSync(resolve(root,'dist/LamjaCraft-3D.html'),'utf8');assert.match(html,/id="buildPlatesBtn"[^>]+aria-controls="buildPlateDialog"/);assert.match(html,/id="buildPlateDialog"/);assert.match(html,/Build plates/);
console.log('Build plates passed: R203 multiple dimensions/ground placement, dialog validation/preview cancellation, exact command history/rollback/Undo/Redo, native round-trip and legacy compatibility, malformed-file/capacity/ID guards, plate-only New confirmation, busy guards, geometry/picking/snapping/Fit/STL isolation, render alpha/depth/state ordering and hidden references.');
