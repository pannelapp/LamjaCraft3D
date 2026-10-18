import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
import {ModelingWorker} from './modeling-worker-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root,ModelingWorker),run=s=>vm.runInContext(s,sandbox),plain=v=>JSON.parse(JSON.stringify(v));
const fixtures=['round-text-short-edge','round-text-offset-corner'].map(name=>JSON.parse(fs.readFileSync(resolve(root,'tests/fixtures',name+'.json'),'utf8')));
let cases=0;
function load(fixture,operation='cut',around=0,surface=0){sandbox.rsFixture=fixture;sandbox.rsAround=around;sandbox.rsSurface=surface;sandbox.rsOperation=operation;run(`var rsSource=deserializeSolid(rsFixture.source),rsBefore=JSON.stringify(serializeSolid(rsSource)),rsParameters={...rsFixture.parameters,operation:rsOperation,wrap:{...rsFixture.parameters.wrap,offset:[rsFixture.parameters.wrap.offset[0]+rsAround,rsSurface]}},rsLayout=faceTextLayout(rsSource,rsFixture.seed,rsParameters);`);}
function verify(){
 const validation=plain(run('validateSolid(rsResult,false)'));assert.equal(validation.ok,true,validation.errors.join('; '));assert.equal(run('connectedSolidFaceComponents(rsResult).length'),1);
 assert.equal(run('JSON.stringify(serializeSolid(rsSource))'),run('rsBefore'));assert.equal(run('JSON.stringify(serializeSolid(deserializeSolid(serializeSolid(rsResult))))'),run('JSON.stringify(serializeSolid(rsResult))'));
 // Signed boundary fans integrate planar roofs independently of the production
 // triangulation. Collinear footprint nodes may be real corners after offset.
 run(`var rsExpectedDelta=(()=>{const depth=rsParameters.depth*(rsParameters.operation==='cut'?-1:1),triangle=(a,b,c)=>V.dot(a,V.cross(b,c))/6,fan=p=>{let n=0;for(let i=1;i<p.length-1;i++)n+=triangle(p[0],p[i],p[i+1]);return n;};let change=0;for(const face of rsLayout.wrap.faces){const field=rsLayout.wrap.context.fields.get(face.faceId),point=(q,z)=>roundTextPoint(q,field,z);for(const region of face.regions)for(const loop of [region.outer,...region.holes]){const floor=loop.map(q=>point(q,0)),roof=loop.map(q=>point(q,depth));change+=fan(roof)-fan(floor);for(let i=0;i<loop.length;i++){const j=(i+1)%loop.length;change+=triangle(floor[i],floor[j],roof[j])+triangle(floor[i],roof[j],roof[i]);}for(const q of loop){const p=geometryApi.faceTextWrapPoint(rsLayout,face.faceId,q,depth),plane=rsSource.faces.get(face.faceId).plane;if(Math.abs(V.dot(plane.normal,p)-plane.offset-depth)>1e-7)throw Error('Normal depth changed');}}}return change;})();`);
 const expected=run('validateSolid(rsSource,false).volume+rsExpectedDelta');assert.ok(Math.abs(validation.volume-expected)<1e-5,`Requested signed boundary volume ${validation.volume} differs from ${expected}`);assert.equal(Math.sign(run('rsExpectedDelta')),sandbox.rsOperation==='cut'?-1:1);
 assert.deepEqual(plain(run('triangleMeshEdgeStats(solidMeshExportLocal(rsResult))')),{boundary:0,nonManifold:0});
 const bytes=Buffer.from(run('prepareBinarySTL([{solid:rsResult,transform:{position:[0,0,0],rotation:[0,0,0]}}])')),edges=new Map();
 for(let i=0;i<bytes.readUInt32LE(80);i++){const p=[0,1,2].map(j=>[0,1,2].map(k=>bytes.readFloatLE(84+i*50+12+j*12+k*4)).join(','));assert.equal(new Set(p).size,3,'Float32 triangle collapsed');for(let j=0;j<3;j++){const a=p[j],b=p[(j+1)%3],key=a<b?a+'|'+b:b+'|'+a,v=edges.get(key)||[0,0];v[0]++;v[1]+=a<b?1:-1;edges.set(key,v);}}for(const v of edges.values())assert.deepEqual(v,[2,0],'STL seam must have two opposite incident triangles');cases++;
}
async function wait(){const stop=performance.now()+30000;while(run('modelingOperationBusy')&&performance.now()<stop)await new Promise(r=>setTimeout(r,5));assert.equal(run('modelingOperationBusy'),false);}
try{
 // Original failing locations and tiny two-dimensional moves, both depth signs.
 // No retry, positional jitter, dropped glyph or depth adjustment is allowed.
 for(const fixture of fixtures)for(const operation of ['cut','add'])for(const offset of [[0,0],[.00001,-.00001],[-.001,.001]]){load(fixture,operation,...offset);assert.equal(run('rsLayout.wrap.placement.ok'),true);try{run('var rsResult=applyFaceTextSolid(rsSource,rsFixture.seed,rsParameters)');verify();}catch(error){throw Error(`${fixture.parameters.surface} ${operation} offset ${offset}: ${error.message}`,{cause:error});}}
 // More letters and independent full-turn spacing preserve the same invariant.
 for(const fixture of fixtures){load(fixture);run(`rsParameters.text='Long text ÆØÅ 0123456789 around';rsParameters.height=1.5;rsParameters.angleDeg=0;rsParameters.wrap.fitAround=true;rsLayout=faceTextLayout(rsSource,rsFixture.seed,rsParameters);rsResult=applyFaceTextSolid(rsSource,rsFixture.seed,rsParameters)`);verify();}
 // Commit the longer original sphere reproducer through the actual shipped
 // worker and controller, with exact one-command Undo/Redo and unchanged settings.
 load(fixtures[1]);const p=sandbox.rsFixture.parameters;
 for(const [id,value] of Object.entries({textContent:p.text,textMapping:p.surface,textFont:p.font,textLineSpacing:'1.8',textCylinderAxis:'z',textOperation:'cut',textHeight:String(p.height),textDepth:String(p.depth),textAngle:String(p.angleDeg),textOffsetX:String(p.wrap.offset[0]),textOffsetY:'0'}))get(id).value=value;get('textFitAround').checked=false;
 run(`var rsObject=makeObject('box');rsObject.solid=rsSource;replaceDocumentContents('Wrapped text seams',[rsObject],[],[],'load-project','Open project',false);undoStack=[];redoStack=[];setTool('text');chooseFaceText(objects[0],rsFixture.seed,transformPoint(fromPlane2(rsParameters.center,textFaceFrame(rsSource,rsFixture.seed)),objects[0].transform));`);
 assert.equal(get('applyTextBtn').disabled,false,get('textStatus').textContent);const state=()=>run('JSON.stringify(projectData())'),before=state();run('drawFaceTextPreview()');assert.equal(state(),before);run('commitFaceTextFromUI()');await wait();assert.equal(run('undoStack.length'),1,get('textStatus').textContent);assert.equal(run('validateSolid(objects[0].solid,false).ok'),true);const after=state();run('undo()');assert.equal(state(),before);run('redo()');assert.equal(state(),after);
 console.log(`R244 round-text seams passed: ${cases} long/rotated cone/sphere Add/Cut placements, micron offset perturbations, full-turn lettering, independent signed boundary volume and exact normal depth, closed canonical/Float32 STL/native and actual worker/controller/Undo/Redo.`);
}finally{await ModelingWorker.closeAll();}
