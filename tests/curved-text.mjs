import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
import {ModelingWorker} from './modeling-worker-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root,ModelingWorker),run=code=>vm.runInContext(code,sandbox);
const plain=value=>JSON.parse(JSON.stringify(value));
function verify(solid,label){
 sandbox.curveChecked=solid;
 assert.equal(run('validateSolid(curveChecked,false).ok'),true,label+' B-rep');
 assert.equal(run('connectedSolidFaceComponents(curveChecked).length'),1,label+' connected shell');
 assert.deepEqual(plain(run('triangleMeshEdgeStats(solidMeshExportLocal(curveChecked))')),{boundary:0,nonManifold:0},label+' closed STL');
 assert.equal(run('JSON.stringify(serializeProjectSolid(deserializeProjectSolid(serializeProjectSolid(curveChecked))))'),run('JSON.stringify(serializeProjectSolid(curveChecked))'),label+' native round trip');
}
function setup(kind,segments=24,profileSegments=12){
 sandbox.curveKind=kind;sandbox.curveSegments=segments;sandbox.curveProfiles=profileSegments;
 run(`var curveSource=geometryApi.createPrimitive({...geometryApi.primitiveDefaults(curveKind),radius:20,tubeRadius:10,height:40,width:40,depth:32,segments:curveSegments,profileSegments:curveProfiles},'curve-source'),curveSeed=[...curveSource.faces.values()].filter(f=>Math.abs(f.plane.normal[2])<.4).sort((a,b)=>b.plane.normal[1]-a.plane.normal[1])[0].id,curveBasis=geometryApi.textFaceFrame(curveSource,curveSeed),curvePoints=faceLoopPoints(curveSource,curveSeed).outer,curveCenter=toPlane2(V.mul(curvePoints.reduce((a,b)=>V.add(a,b),[0,0,0]),1/curvePoints.length),curveBasis),curveBefore=JSON.stringify(serializeSolid(curveSource));`);
}
const params=(text='ABO',operation='add',angleDeg=0)=>({text,height:5,depth:.4,operation,angleDeg,center:plain(run('curveCenter')),surface:'curved'});
const wait=async()=>{for(let i=0;run('modelingOperationBusy')&&i<1500;i++)await new Promise(r=>setTimeout(r,10));assert.equal(run('modelingOperationBusy'),false);};
let cases=0;
try{
for(const kind of ['cylinder','sphere','ellipsoid','frustum','capsule','torus'])for(const angle of [0,33])for(const operation of ['add','cut']){
 setup(kind);sandbox.curveP=params('ABO',operation,angle);
 try{run('var curveLayout=geometryApi.previewFaceText(curveSource,curveSeed,curveP),curveResult=geometryApi.faceText(curveSource,curveSeed,curveP).solid');}catch(error){throw Error(kind+' '+operation+' '+angle+': '+error.message,{cause:error});}
 verify(run('curveResult'),kind+' '+operation+' '+angle);
 assert.ok(run('curveLayout.curved.faces.length>1'),'lettering spans source facets');
 const delta=run('validateSolid(curveResult,false).volume-validateSolid(curveSource,false).volume'),expected=run('curveLayout.area*curveP.depth')*(operation==='add'?1:-1);
 assert.ok(Math.abs(delta-expected)<1e-5,'projected area × exact signed requested depth');
 assert.equal(run('JSON.stringify(serializeSolid(curveSource))'),run('curveBefore'),'source immutable');
 // Preview/commit share exactly the same clipped footprint and cap plane.
 assert.equal(run(`curvedTextFeatureFaces(curveSource,curveLayout,curveP.depth*(curveP.operation==='add'?1:-1)).filter(f=>f.planeHint).every(f=>f.points.every(p=>Math.abs(V.dot(f.planeHint.normal,p)-f.planeHint.offset)<TOL.plane))`),true,'preview top vertices equal commit cap planes');
 assert.ok(run('curveLayout.curved.faces.some(f=>Math.abs(V.dot(curveSource.faces.get(f.faceId).plane.normal,curveLayout.basis.normal))<.99)'),'source curvature retained');
 cases++;
}
// Odd/coarse facets and offset charts exercise shared seams independently of
// primitive segment indexing or provenance. The ordinary reconstructed input
// has no retained parametric feature to help the text operation.
for(const segments of [9,17,31]){
 setup('sphere',segments,9);run(`curveSource=csgToSolid(solidToCsg(curveSource),'rebuilt',{kind:'import',label:'Rebuilt'});curveSeed=[...curveSource.faces.values()].sort((a,b)=>b.plane.normal[1]-a.plane.normal[1])[0].id;curveBasis=geometryApi.textFaceFrame(curveSource,curveSeed);curveCenter=toPlane2(V.mul(faceLoopPoints(curveSource,curveSeed).outer.reduce((a,b)=>V.add(a,b),[0,0,0]),1/faceLoopPoints(curveSource,curveSeed).outer.length),curveBasis);`);
 sandbox.curveP=params('ÆØÅ æøå','cut',21);sandbox.curveP.height=3;
 run('curveResult=geometryApi.faceText(curveSource,curveSeed,curveP).solid');verify(run('curveResult'),'rebuilt odd sphere '+segments);cases++;
}
setup('cylinder');sandbox.curveP=params('BØå');
run('curveLayout=geometryApi.previewFaceText(curveSource,curveSeed,curveP)');
assert.equal(run('curveLayout.regions.reduce((n,r)=>n+r.holes.length,0)'),6,'counters preserved before clipping');
for(const change of [{surface:'invalid'},{center:[1000,0]},{height:200},{depth:50,operation:'cut'}]){sandbox.curveP={...params(),...change};assert.throws(()=>run('geometryApi.faceText(curveSource,curveSeed,curveP)'));assert.equal(run('JSON.stringify(serializeSolid(curveSource))'),run('curveBefore'));}
// The same patch rules respect holes. An opening inside O's counter remains;
// an opening inside H's material must be rejected before geometry generation.
run(`var curveHole=prismRegion([[-15,-15],[15,-15],[15,15],[-15,15]],[[[-.1,-.1],[-.1,.1],[.1,.1],[.1,-.1]]],4),curveHoleFace=[...curveHole.faces.values()].find(f=>f.plane.normal[2]>.99).id;`);
sandbox.curveP={...params('O'),center:[0,0]};run('curveResult=geometryApi.faceText(curveHole,curveHoleFace,curveP).solid');verify(run('curveResult'),'face opening in counter');
sandbox.curveP={...params('H'),center:[0,0]};assert.throws(()=>run('geometryApi.faceText(curveHole,curveHoleFace,curveP)'),/fit on/);
// Depth cannot skip through a thin wall or affect an unrelated inner surface.
run(`var curveRing=textureRegularPolygon(0,0,20,32),curveInner=textureRegularPolygon(0,0,19,32).reverse(),curveTube=prismRegion(curveRing,[curveInner],30),curveTubeFace=[...curveTube.faces.values()].filter(f=>Math.abs(f.plane.normal[2])<.01).sort((a,b)=>b.plane.offset-a.plane.offset||b.plane.normal[1]-a.plane.normal[1])[0].id,curveTubeFrame=geometryApi.textFaceFrame(curveTube,curveTubeFace),curveTubeCenter=toPlane2(V.mul(faceLoopPoints(curveTube,curveTubeFace).outer.reduce((a,b)=>V.add(a,b),[0,0,0]),.25),curveTubeFrame);`);
sandbox.curveP={...params('H','cut'),center:plain(run('curveTubeCenter')),depth:2};assert.throws(()=>run('geometryApi.faceText(curveTube,curveTubeFace,curveP)'),/crosses another|surface layer/);
sandbox.curveP.depth=.2;run('curveResult=geometryApi.faceText(curveTube,curveTubeFace,curveP).solid');verify(run('curveResult'),'thin curved tube');
// A local skin may not finish exactly against an unrelated retained wall.
// The cap and roof can be coincident with no strictly crossing edges; graph
// validation alone would accept two overlapping internal skins.
run(`var touchFloor=prismRegion([[-10,-5],[10,-5],[10,5],[-10,5]],[],1),touchPillar=prismRegion([[8,-5],[10,-5],[10,5],[8,5]],[],2),touchRoof=prismRegion([[-10,-5],[8,-5],[8,5],[-10,5]],[],1);for(const v of touchPillar.vertices.values())v.position[2]+=1;for(const f of touchPillar.faces.values())f.plane.offset+=f.plane.normal[2];for(const v of touchRoof.vertices.values())v.position[2]+=1.4;for(const f of touchRoof.faces.values())f.plane.offset+=f.plane.normal[2]*1.4;var touchSource=csgToSolid(csgUnionOwned(csgUnionOwned(solidToCsg(touchFloor),solidToCsg(touchPillar)),solidToCsg(touchRoof)),'touch',{kind:'boolean',label:'Overhang'}),touchFace=[...touchSource.faces.values()].find(f=>f.plane.normal[2]>.99&&Math.abs(f.plane.offset-1)<1e-7).id,touchBefore=JSON.stringify(serializeSolid(touchSource)),touchParameters={text:'H',height:4,depth:.2,angleDeg:0,operation:'add',center:[0,0],surface:'curved'};`);
run('curveResult=geometryApi.faceText(touchSource,touchFace,touchParameters).solid');verify(run('curveResult'),'raised text under roof with clearance');
for(const depth of [.4,.6]){sandbox.touchDepth=depth;assert.throws(()=>run('geometryApi.faceText(touchSource,touchFace,{...touchParameters,depth:touchDepth})'),/touches.*surface/);assert.equal(run('JSON.stringify(serializeSolid(touchSource))'),run('touchBefore'));}
// A hard corner is a chart boundary, not permission to wrap onto the cap.
setup('cylinder');sandbox.curveP=params('H');sandbox.curveP.center[1]=39;assert.throws(()=>run('geometryApi.faceText(curveSource,curveSeed,curveP)'),/fit on/);
// Face mode remains the original conservative one-face operation.
sandbox.curveP={...params('Wide text'),surface:'planar'};assert.throws(()=>run('geometryApi.faceText(curveSource,curveSeed,curveP)'),/fit inside/);
// Automatic placement preserves planar CSG semantics, including through-cuts
// on thin sheets and text spanning a coplanar sketch subdivision.
run(`var autoSheet=prismRegion([[-20,-10],[20,-10],[20,10],[-20,10]],[],.005),autoFace=[...autoSheet.faces.values()].find(f=>f.plane.normal[2]>.99).id,autoSplit=splitFaceWithRegion(autoSheet,autoFace,[[-.7,-7,.005],[.7,-7,.005],[.7,7,.005],[-.7,7,.005]]);`);
for(const split of [false,true])for(const operation of ['add','cut']){
 sandbox.autoSplitEnabled=split;sandbox.autoOperation=operation;
 run(`var autoSource=autoSplitEnabled?autoSplit.solid:autoSheet,autoSeed=autoSplitEnabled?autoSplit.regionFaceId:autoFace,autoP={text:'H',height:5,depth:.4,angleDeg:0,operation:autoOperation,center:[0,0],surface:'auto'},autoLayout=geometryApi.previewFaceText(autoSource,autoSeed,autoP),autoResult=geometryApi.faceText(autoSource,autoSeed,autoP).solid;`);
 assert.equal(run('!!autoLayout.curved'),split,'expand only when one face does not contain the lettering');
 if(split)assert.equal(run('curvedTextPatchIsPlanar(autoSource,autoLayout)'),true,'coplanar subdivisions preserve the planar operation');
 verify(run('autoResult'),'automatic thin sheet '+split+' '+operation);
 const expected=run('autoLayout.area')*(operation==='add'?.4:-.005),actual=run('validateSolid(autoResult,false).volume-validateSolid(autoSource,false).volume');
 assert.ok(Math.abs(actual-expected)<1e-7,'automatic mode preserves requested depth and clips through-cuts to actual sheet thickness');
}
for(const kind of ['cylinder','sphere']){
 setup(kind);sandbox.autoP={...params('ABO'),surface:'auto'};
 run('autoLayout=geometryApi.previewFaceText(curveSource,curveSeed,autoP);autoResult=geometryApi.faceText(curveSource,curveSeed,autoP).solid');
 assert.ok(run('autoLayout.curved.faces.length>1'));assert.equal(run('curvedTextPatchIsPlanar(curveSource,autoLayout)'),false,'genuinely curved footprint');verify(run('autoResult'),'automatic '+kind);
 assert.ok(Math.abs(run('validateSolid(autoResult,false).volume-validateSolid(curveSource,false).volume-autoLayout.area*autoP.depth'))<1e-5,'automatic curved footprint/depth volume');
}
// Restore the cylinder target used by the transformed controller checks.
setup('cylinder');
for(const [id,value] of Object.entries({textContent:'ABO',textOperation:'add',textHeight:'5',textDepth:'.4',textAngle:'0',textOffsetX:'0',textOffsetY:'0'}))get(id).value=value;
run(`cancelGesture();replaceObjects([{id:'curve-object',name:'Curved text',kind:'solid',color:'#69b6a6',solid:curveSource,transform:{position:[7,13,5],rotation:[.2,-.1,.3]}}]);replaceGroups([]);replaceDimensions([]);replaceGuides([]);undoStack=[];redoStack=[];modelRevision++;setTool('text');var curveWorld=transformPoint(fromPlane2(curveCenter,curveBasis),objects[0].transform);chooseFaceText(objects[0],curveSeed,curveWorld);`);
assert.equal(get('applyTextBtn').disabled,false);assert.equal(run('textPreviewState.parameters.surface'),'auto');assert.ok(run('textPreviewState.layout.curved.faces.length>1'));
const strokes=[];sandbox.curveStrokes=strokes;run('ctx.stroke=()=>curveStrokes.push(1);drawFaceTextPreview()');assert.ok(strokes.length>10);
const document=()=>run('JSON.stringify(projectData())'),before=document();
run('commitFaceTextFromUI()');assert.equal(run('modelingOperationBusy'),true);await wait();assert.equal(run('undoStack.length'),1);verify(run('objects[0].solid'),'curved real worker');const after=document();assert.notEqual(after,before);run('undo()');assert.equal(document(),before);run('redo()');assert.equal(document(),after);run('undo()');
run('chooseFaceText(objects[0],curveSeed,curveWorld);commitFaceTextFromUI();modelingOperationCancel()');await wait();assert.equal(document(),before);assert.equal(run('undoStack.length'),0);
run('chooseFaceText(objects[0],curveSeed,curveWorld);commitFaceTextFromUI()');get('textDepth').value='.5';await wait();assert.equal(document(),before);assert.match(get('toast').textContent,/settings changed/);
get('textDepth').value='.4';for(const listener of get('textDepth').listeners.input)listener({target:get('textDepth')});assert.equal(get('applyTextBtn').disabled,false);
run('handleToolEscape()');assert.equal(run('textTarget'),null);assert.equal(run('tool'),'text');
sandbox.curveP=params('A');const failed=run('geometryApi.faceTextAsync(curveSource,curveSeed,{...curveP,center:[1000,0]})');await assert.rejects(failed.promise,/fit on/);
console.log(`R234 curved text passed: ${cases} curved/rebuilt geometry cases, projected exact volume and seam/depth preview, holes/counters/clearance/exact terminal contacts, closed STL/native, transformed real-worker commits, automatic flat/subdivided/curved routing, cancellation/stale settings and atomic Undo/Redo.`);
}finally{await ModelingWorker.closeAll();}
