import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
import {ModelingWorker} from './modeling-worker-fixture.mjs';

const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root,ModelingWorker);
const run=code=>vm.runInContext(code,sandbox),plain=value=>JSON.parse(JSON.stringify(value));
const near=(actual,expected,tolerance=1e-6)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
let glyphs=0,cases=0;
function setup(axis='z',segments=17){
  sandbox.ctAxis=axis;sandbox.ctSegments=segments;
  run(`var ctRotation=ctAxis==='x'?[0,90,0]:ctAxis==='y'?[-90,0,0]:[0,0,0],ctOriginal=primitivePrism(textureRegularPolygon(0,0,12,ctSegments),30,'cylinder');
    var ctSource=buildSolidFromPolygons([...ctOriginal.faces.keys()].flatMap(id=>triangulateFaceLocal(ctOriginal,id,undefined,'canonical').map(points=>({points:points.map(q=>V.add(rotate(q,ctRotation),[5,-3,7]))}))),'reconstructed-cylinder'),ctAxisVector=ctAxis==='x'?[1,0,0]:ctAxis==='y'?[0,1,0]:[0,0,1],ctSeed=[...ctSource.faces.values()].find(f=>Math.abs(V.dot(f.plane.normal,ctAxisVector))<1e-6).id,ctFrame=textFaceFrame(ctSource,ctSeed),ctLoop=faceLoopPoints(ctSource,ctSeed).outer,ctAnchor=V.mul(ctLoop.reduce((n,q)=>V.add(n,q),[0,0,0]),1/ctLoop.length),ctCenter=toPlane2(ctAnchor,ctFrame),ctBefore=JSON.stringify(serializeSolid(ctSource));`);
}
const parameters=(font='sans',operation='add',fitAround=false)=>({text:'BØ\nÅa',font,lineSpacing:1.8,height:2.5,depth:.25,angleDeg:0,operation,surface:'cylinder',cylinder:{axis:sandbox.ctAxis,fitAround},center:plain(run('ctCenter'))});
function verify(solid,label){
  sandbox.ctChecked=solid;const v=run('validateSolid(ctChecked,false)');assert.equal(v.ok,true,label+v.errors.join(';'));
  assert.equal(run('connectedSolidFaceComponents(ctChecked).length'),1,label+' connected');
  assert.deepEqual(plain(run('triangleMeshEdgeStats(solidMeshExportLocal(ctChecked))')),{boundary:0,nonManifold:0},label+' manifold mesh');
  assert.equal(run('JSON.stringify(serializeProjectSolid(deserializeProjectSolid(serializeProjectSolid(ctChecked))))'),run('JSON.stringify(serializeProjectSolid(ctChecked))'),label+' native reopening');
  return v.volume;
}
function actualExport(solid){
  sandbox.ctChecked=solid;const bytes=Buffer.from(run('prepareBinarySTL([{solid:ctChecked,transform:{position:[0,0,0],rotation:[0,0,0]}}])')),edges=new Map();
  for(let i=0;i<bytes.readUInt32LE(80);i++){
    const pts=[0,1,2].map(j=>[0,1,2].map(k=>bytes.readFloatLE(84+i*50+12+j*12+k*4))),keys=pts.map(p=>p.join(','));
    assert.equal(new Set(keys).size,3,'Float32 triangle retains area');
    for(let j=0;j<3;j++){const a=keys[j],b=keys[(j+1)%3],key=a<b?a+'|'+b:b+'|'+a,entry=edges.get(key)||[0,0];entry[0]++;entry[1]+=a<b?1:-1;edges.set(key,entry);}
  }
  for(const value of edges.values())assert.deepEqual(value,[2,0],'actual Float32 edges are paired with opposite incidence');
}
async function wait(){const deadline=performance.now()+30000;while(run('modelingOperationBusy')&&performance.now()<deadline)await new Promise(r=>setTimeout(r,5));assert.equal(run('modelingOperationBusy'),false,'worker finished');}

try{
// All bundled contour sets keep counters/accents and finite nonintersecting
// loops. This catches differences between fonts, not just selector plumbing.
run(`var ctPlate=primitivePrism([[-100,-100],[100,-100],[100,100],[-100,100]],8,'plate'),ctTop=[...ctPlate.faces.values()].find(f=>f.plane.normal[2]>.99).id;`);
for(const font of ['sans','serif','mono'])for(const ch of plain(run(`Object.keys(TEXT_FONTS.${font}.glyphs)`))){
  if(!ch.trim())continue;sandbox.ctFontP={text:ch,font,height:3,depth:.2,angleDeg:0,operation:'add',center:[0,0]};
  assert.equal(run(`(()=>{const l=faceTextLayout(ctPlate,ctTop,ctFontP);return l.area>0&&l.regions.every(r=>v2.area(r.outer)>0&&r.holes.every(h=>v2.area(h)<0)&&[r.outer,...r.holes].every(loop=>!polygonSelfIntersects(loop)));})()`),true,font+' '+ch);glyphs++;
}
const widths=['sans','serif','mono'].map(font=>{sandbox.ctFontP={text:'Wi',font,height:3,depth:.2,angleDeg:0,operation:'add',center:[0,0]};return run('faceTextLayout(ctPlate,ctTop,ctFontP).width');});assert.equal(new Set(widths).size,3,'three real font outlines');
// Multiline spacing is measured from identical glyph baselines, without
// changing cap height. Blank lines between text preserve their full pitch.
for(const font of ['sans','serif','mono']){
  sandbox.ctFontP={text:'H\n\nH',font,lineSpacing:2,height:3,depth:.2,angleDeg:17,operation:'add',center:[0,0]};
  run('var ctPlanar=faceTextLayout(ctPlate,ctTop,ctFontP),ctPlanarOut=applyFaceTextSolid(ctPlate,ctTop,ctFontP)');
  near(run('ctPlanar.height'),15);near(verify(run('ctPlanarOut'),font+' multiline'),run('validateSolid(ctPlate,false).volume+ctPlanar.area*.2'));cases++;
}
// The additional fonts and multiline layout also use the existing automatic
// local chart on a sphere; no cylinder mode is needed for doubly curved text.
for(const font of ['sans','serif','mono']){
  sandbox.ctFont=font;
  run(`var ctSphere=geometryApi.createPrimitive({...geometryApi.primitiveDefaults('sphere'),radius:20,segments:24,profileSegments:12},'sphere'),ctSphereSeed=[...ctSphere.faces.values()].sort((a,b)=>b.plane.normal[1]-a.plane.normal[1])[0].id,ctSphereFrame=textFaceFrame(ctSphere,ctSphereSeed),ctSphereLoop=faceLoopPoints(ctSphere,ctSphereSeed).outer,ctSphereCenter=toPlane2(V.mul(ctSphereLoop.reduce((n,q)=>V.add(n,q),[0,0,0]),1/ctSphereLoop.length),ctSphereFrame),ctSphereP={text:'BØ\\nÅa',font:ctFont,lineSpacing:1.8,height:2,depth:.2,angleDeg:9,operation:'cut',surface:'auto',center:ctSphereCenter},ctSphereLayout=faceTextLayout(ctSphere,ctSphereSeed,ctSphereP),ctSphereOut=applyFaceTextSolid(ctSphere,ctSphereSeed,ctSphereP);`);
  near(verify(run('ctSphereOut'),font+' multiline sphere'),run('validateSolid(ctSphere,false).volume-ctSphereLayout.area*.2'));cases++;
}
// Rebuilt cylinders on all local axes; full-turn and ordinary spacing,
// counters and two lines; independent frustum-strip volume integral.
for(const axis of ['x','y','z'])for(const font of ['sans','serif','mono'])for(const operation of ['add','cut']){
  setup(axis,axis==='x'?9:axis==='y'?17:32);sandbox.ctP=parameters(font,operation,font!=='sans');
  try{run('var ctLayout=faceTextLayout(ctSource,ctSeed,ctP),ctResult=applyFaceTextSolid(ctSource,ctSeed,ctP)');}catch(error){throw Error(`${axis} ${font} ${operation}: ${error.message}`,{cause:error});}
  assert.equal(run('ctLayout.cylinder.placement.ok'),true);
  near(run('ctLayout.cylinder.context.period'),2*12*sandbox.ctSegments*Math.sin(Math.PI/sandbox.ctSegments));
  const depth=operation==='add'?.25:-.25,apothem=12*Math.cos(Math.PI/sandbox.ctSegments),expected=run('validateSolid(ctSource,false).volume')+run('ctLayout.area')*(depth+depth*depth/(2*apothem));
  // A slanted outline edge makes a bilinear wall. Its two-triangle roof
  // approximation differs from the exact integral by at most half the
  // tetrahedron volume: d² |delta-along * delta-height| / (12 * apothem).
  const wallBound=run(`ctLayout.cylinder.faces.reduce((n,f)=>{const field=ctLayout.cylinder.context.fields.get(f.faceId);return n+f.regions.reduce((m,r)=>m+[r.outer,...r.holes].reduce((k,loop)=>{const chart=loop.map(q=>cylinderTextChartPoint(fromPlane2(q,f.basis),field,ctLayout.cylinder.context));return k+chart.reduce((v,a,i)=>{const b=chart[(i+1)%chart.length];return v+Math.abs((b[0]-a[0])*(b[1]-a[1]));},0);},0),0);},0)`)*depth*depth/(12*apothem);
  near(verify(run('ctResult'),`${axis} ${font} ${operation}`),expected,wallBound+2e-5);
  assert.equal(run('JSON.stringify(serializeSolid(ctSource))'),run('ctBefore'),'source unchanged');
  if(operation==='cut')actualExport(run('ctResult'));
  // The unfold maps exact millimetres on each facet and all shared edge
  // roofs satisfy both adjacent face-normal depth constraints.
  assert.equal(run(`(()=>{const c=ctLayout.cylinder.context;for(const f of c.fields.values()){const a=[f.panel.offset-c.originX+.2,0],b=[a[0]+.3,.4];if(Math.abs(V.len(V.sub(cylinderTextSurfacePoint(a,f,c),cylinderTextSurfacePoint(b,f,c)))-.5)>1e-8)return false;}return true;})()`),true,'isometric facet mapping');
  assert.equal(run(`cylinderTextFeatureFaces(ctSource,ctLayout,ctP.depth*(ctP.operation==='add'?1:-1)).filter(f=>f.planeHint).every(f=>f.points.every(p=>Math.abs(V.dot(f.planeHint.normal,p)-f.planeHint.offset)<TOL.plane))`),true,'preview and commit cap planes');cases++;
}
// Put a letter across the closure seam; shifting by one full perimeter must
// produce exactly the same canonical operation, not duplicated geometry.
setup('z',17);sandbox.ctP={...parameters('sans'),text:'BO',angleDeg:23};
run(`var ctSpacingP={...ctP,text:'HHH',font:'mono',angleDeg:0,cylinder:{axis:'z',fitAround:true}},ctSpacing=faceTextLayout(ctSource,ctSeed,ctSpacingP),ctH=faceTextLayout(ctSource,ctSeed,{...ctSpacingP,text:'H',cylinder:{axis:'z'}}),ctSpacingBounds=ctSpacing.regions.map(r=>textureBounds2(r.outer)).sort((a,b)=>a[0]-b[0]);`);
near(run('(ctSpacingBounds[1][0]+ctSpacingBounds[1][2]-ctSpacingBounds[0][0]-ctSpacingBounds[0][2])/2'),run('ctSpacing.cylinder.context.period/3'));
near(run('ctSpacingBounds[0][2]-ctSpacingBounds[0][0]'),run('ctH.width'));
run(`var ctCtx=cylinderTextContext(ctSource,ctSeed,'z',ctAnchor);ctP.cylinder.offset=[-ctCtx.originX,0];ctLayout=faceTextLayout(ctSource,ctSeed,ctP);ctResult=applyFaceTextSolid(ctSource,ctSeed,ctP);var ctShifted=applyFaceTextSolid(ctSource,ctSeed,{...ctP,cylinder:{...ctP.cylinder,offset:[ctP.cylinder.offset[0]+ctCtx.period,0]}});`);
near(verify(run('ctResult'),'seam rotation'),verify(run('ctShifted'),'whole-period translation'));actualExport(run('ctResult'));
assert.ok(run('ctLayout.cylinder.faces.some(f=>ctLayout.cylinder.context.fields.get(f.faceId).panel.offset===0)'),'first seam facet');
assert.ok(run('ctLayout.cylinder.faces.some(f=>ctLayout.cylinder.context.fields.get(f.faceId).panel.offset>ctCtx.period-ctCtx.period/17-.0001)'),'last seam facet');cases++;
// Rejection checks preserve source and reject caps, taper, nonround cross
// sections, excessive wrapping/line count, unsupported fonts and deep cuts.
for(const change of [{font:'invalid'},{text:'H\nH\nH\nH\nH'},{text:'x'.repeat(41)},{lineSpacing:1},{cylinder:{axis:'bad'}},{cylinder:{axis:'z',offset:[0,100]}},{height:200},{operation:'cut',depth:6}]){
  sandbox.ctP={...parameters(),...change};assert.throws(()=>run('applyFaceTextSolid(ctSource,ctSeed,ctP)'));assert.equal(run('JSON.stringify(serializeSolid(ctSource))'),run('ctBefore'));
}
run(`var ctCap=[...ctSource.faces.values()].find(f=>f.plane.normal[2]>.99).id,ctCone=geometryApi.createPrimitive({...geometryApi.primitiveDefaults('frustum'),radius:12,topRadius:7,height:30,segments:17},'cone'),ctConeSeed=[...ctCone.faces.values()].find(f=>Math.abs(f.plane.normal[2])<.9).id;`);
sandbox.ctP=parameters();assert.throws(()=>run('applyFaceTextSolid(ctSource,ctCap,ctP)'),/side face/);assert.throws(()=>run('applyFaceTextSolid(ctCone,ctConeSeed,ctP)'),/tapered/);
// Wrapping may not engrave through a thin tube, or finish exactly against its
// inner wall. A shallower depth remains a valid closed editable operation.
run(`var ctTube=prismRegion(textureRegularPolygon(0,0,12,32),[textureRegularPolygon(0,0,11.8,32).reverse()],30,'tube'),ctTubeSeed=[...ctTube.faces.values()].filter(f=>Math.abs(f.plane.normal[2])<1e-6).sort((a,b)=>b.plane.offset-a.plane.offset)[0].id,ctTubeFrame=textFaceFrame(ctTube,ctTubeSeed),ctTubeLoop=faceLoopPoints(ctTube,ctTubeSeed).outer,ctTubeCenter=toPlane2(V.mul(ctTubeLoop.reduce((n,q)=>V.add(n,q),[0,0,0]),1/ctTubeLoop.length),ctTubeFrame),ctTubeP={...ctP,text:'H',center:ctTubeCenter,operation:'cut',depth:.08},ctTubeOut=applyFaceTextSolid(ctTube,ctTubeSeed,ctTubeP);`);
verify(run('ctTubeOut'),'thin cylinder tube');actualExport(run('ctTubeOut'));cases++;
for(const depth of [.3,.2*Math.cos(Math.PI/32)]){sandbox.ctBadDepth=depth;assert.throws(()=>run('applyFaceTextSolid(ctTube,ctTubeSeed,{...ctTubeP,depth:ctBadDepth})'),/surface|layer/);}
// Real UI + shipped separate-thread worker; textarea Enter, settings capture,
// read-only preview, lock/stale/cancel guards and one-command Undo/Redo.
for(const [id,value] of Object.entries({textContent:'ÆØ\nåa',textMapping:'cylinder',textFont:'serif',textLineSpacing:'2',textCylinderAxis:'z',textOperation:'cut',textHeight:'2.5',textDepth:'.25',textAngle:'11',textOffsetX:'0',textOffsetY:'0'}))get(id).value=value;
get('textFitAround').checked=true;
run(`var ctObject=makeObject('box');ctObject.solid=ctSource;ctObject.transform={position:[11,-7,4],rotation:[19,-23,31]};replaceDocumentContents('Cylinder text',[ctObject],[],[],'load-project','Open project',false);undoStack=[];redoStack=[];setTool('text');chooseFaceText(objects[0],ctSeed,transformPoint(ctAnchor,objects[0].transform));updateFaceTextMappingUI();`);
assert.equal(get('applyTextBtn').disabled,false,get('textStatus').textContent);assert.equal(get('textCylinderControls').classList.contains('hidden'),false);
get('textContent').tagName='TEXTAREA';sandbox.document.activeElement=get('textContent');assert.equal(run('faceTextToolController.keyDown({key:"Enter"})'),false);run('handleApplicationKeyDown({key:"Enter",preventDefault(){throw Error("Textarea Enter consumed");}})');assert.equal(run('modelingOperationBusy'),false);sandbox.document.activeElement={tagName:'BODY'};
const data=()=>run('JSON.stringify(projectData())'),before=data();run('ctx.stroke=()=>{};drawFaceTextPreview()');assert.equal(data(),before,'preview read only');
run('commitFaceTextFromUI()');await wait();assert.equal(run('undoStack.length'),1);assert.equal(run('lastCommandEntry().parameters.font'),'serif');assert.equal(run('lastCommandEntry().parameters.surface'),'cylinder');verify(run('objects[0].solid'),'worker result');actualExport(run('objects[0].solid'));const after=data();run('undo()');assert.equal(data(),before);run('redo()');assert.equal(data(),after);
run('undo();chooseFaceText(objects[0],ctSeed,transformPoint(ctAnchor,objects[0].transform));commitFaceTextFromUI();cancelModelingOperation()');await wait();assert.equal(data(),before);assert.equal(run('undoStack.length'),0);
run('chooseFaceText(objects[0],ctSeed,transformPoint(ctAnchor,objects[0].transform));commitFaceTextFromUI()');get('textFont').value='mono';await wait();assert.equal(data(),before,'stale font rejected');assert.equal(run('undoStack.length'),0);
run('objects[0].locked=true;refreshFaceTextPreview()');assert.equal(get('applyTextBtn').disabled,true);run('objects[0].locked=false');
get('textMapping').value='auto';run('updateFaceTextMappingUI()');assert.equal(get('textCylinderControls').classList.contains('hidden'),true);
const markup=fs.readFileSync(resolve(root,'src/template.html'),'utf8');assert.match(markup,/<textarea id="textContent"/);for(const id of ['textMapping','textFont','textCylinderAxis','textFitAround','textLineSpacing'])assert.equal((markup.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
console.log(`R241 cylinder/multiline fonts passed: ${glyphs} glyphs; ${cases} geometry cases, exact surface-distance/full-turn/seam, independent volumes, counters, local axes/rebuilt sources, closed Float32 STL/native, preview and actual worker/UI/cancel/stale/lock/Undo/Redo.`);
}finally{await ModelingWorker.closeAll();}
