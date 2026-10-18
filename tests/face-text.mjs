import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
import {ModelingWorker} from './modeling-worker-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root,ModelingWorker),run=code=>vm.runInContext(code,sandbox);
const plain=value=>JSON.parse(JSON.stringify(value));
const parameters=(text='ABO',operation='add',angleDeg=0)=>({text,height:5,depth:.5,operation,angleDeg,center:[0,0]});
function verifySolid(solid,label){
 sandbox.checked=solid;assert.equal(run('validateSolid(checked,false).ok'),true,label+' B-rep');
 assert.equal(run('connectedSolidFaceComponents(checked).length'),1,label+' connected material');
 const mesh=run('triangleMeshEdgeStats(solidMeshExportLocal(checked))');
 assert.equal(mesh.boundary,0,label+' closed STL');assert.equal(mesh.nonManifold,0,label+' manifold STL');
 assert.equal(run('JSON.stringify(serializeProjectSolid(deserializeProjectSolid(serializeProjectSolid(checked))))'),run('JSON.stringify(serializeProjectSolid(checked))'),label+' native reopen');
}
try{
run(`var textSource=prismRegion([[-80,-30],[80,-30],[80,30],[-80,30]],[],8,'text-box'),textFace=[...textSource.faces.values()].find(f=>f.plane.normal[2]>.99).id,textBefore=JSON.stringify(serializeSolid(textSource)),textVolume=validateSolid(textSource,false).volume;`);
// One curve/nesting converter handles every glyph in the embedded font subset.
let converted=0;
for(const glyph of Array.from(run('Object.keys(TEXT_FONT_GLYPHS)'))){
 if(!glyph.trim())continue;sandbox.p=parameters(glyph);
 run('var glyphLayout=geometryApi.previewFaceText(textSource,textFace,p)');assert.ok(run('glyphLayout.area>0'),glyph+' area');
 assert.equal(run('glyphLayout.regions.every(r=>v2.area(r.outer)>0&&r.holes.every(h=>v2.area(h)<0)&&[r.outer,...r.holes].every(loop=>!polygonSelfIntersects(loop)))'),true,glyph+' nested contours');converted++;
}
for(const text of ['A','B','O','Ø','æøå','ÆØÅ','Åij','Text 123'])for(const angleDeg of [0,37])for(const operation of ['add','cut']){
 sandbox.p=parameters(text,operation,angleDeg);run('var layout=geometryApi.previewFaceText(textSource,textFace,p),textResult=geometryApi.faceText(textSource,textFace,p)');
 verifySolid(run('textResult.solid'),text+' '+operation+' '+angleDeg);
 const expected=run('textVolume+(p.operation==="add"?1:-1)*layout.area*p.depth');
 assert.ok(Math.abs(run('validateSolid(textResult.solid,false).volume')-expected)<1e-5,text+' footprint/depth volume');
 assert.equal(run('JSON.stringify(serializeSolid(textSource))'),run('textBefore'),'source not mutated');
}
for(const [text,holes] of [['A',1],['B',2],['O',1],['Ø',2]]){sandbox.p=parameters(text);assert.equal(run('geometryApi.previewFaceText(textSource,textFace,p).regions.reduce((n,r)=>n+r.holes.length,0)'),holes,text+' counters');}
sandbox.p=parameters('Å');const normal=plain(run('geometryApi.previewFaceText(textSource,textFace,p)'));
sandbox.p=parameters('A\u030a');assert.deepEqual(plain(run('geometryApi.previewFaceText(textSource,textFace,p)')),normal,'NFC accents');
sandbox.p=parameters('H');assert.ok(Math.abs(run('geometryApi.previewFaceText(textSource,textFace,p).height')-5)<1e-8,'capital height in mm');
run(`var sideFace=[...textSource.faces.values()].find(f=>f.plane.normal[1]>.99).id;`);
sandbox.p={...parameters('AB'),height:3,center:[0,4]};run('var sideResult=geometryApi.faceText(textSource,sideFace,p)');verifySolid(run('sideResult.solid'),'vertical face');
// A genuinely oblique support plane exercises transformed construction normals.
run(`var obliqueFrame={origin:[20,-40,80],u:V.unit([1,1,0]),normal:V.unit([1,-1,1])};obliqueFrame.v=V.cross(obliqueFrame.normal,obliqueFrame.u);var tilted=csgToSolid(solidToCsg(textSource).map(poly=>csgPolygon(poly.vs.map(q=>V.add(obliqueFrame.origin,V.add(V.add(V.mul(obliqueFrame.u,q[0]),V.mul(obliqueFrame.v,q[1])),V.mul(obliqueFrame.normal,q[2])))))),'tilted',{kind:'primitive',label:'Tilted'}),tiltedFace=[...tilted.faces.values()].find(f=>V.dot(f.plane.normal,obliqueFrame.normal)>.99).id,tiltedBasis=geometryApi.textFaceFrame(tilted,tiltedFace);`);
sandbox.p={...parameters('Ø'),center:plain(run('toPlane2(V.add(obliqueFrame.origin,V.mul(obliqueFrame.normal,8)),tiltedBasis)'))};run('var tiltedResult=geometryApi.faceText(tilted,tiltedFace,p)');verifySolid(run('tiltedResult.solid'),'oblique plane');
for(const p of [{...parameters(),text:'😀'},{...parameters(),text:'\n'},{...parameters(),text:' '},{...parameters(),text:'x'.repeat(41)},{...parameters(),height:0},{...parameters(),depth:-1},{...parameters(),angleDeg:NaN},{...parameters(),center:[1000,0]}]){
 sandbox.p=p;assert.throws(()=>run('geometryApi.faceText(textSource,textFace,p)'));assert.equal(run('JSON.stringify(serializeSolid(textSource))'),run('textBefore'));
}
// Vertex-only containment misses a notch crossed by an edge or an opening
// enclosed by glyph material; both must fail without modifying the source.
run(`var notch=prismRegion([[-8,-8],[8,-8],[8,8],[1,8],[1,0],[-1,0],[-1,8],[-8,8]],[],4,'notch'),notchFace=[...notch.faces.values()].find(f=>f.plane.normal[2]>.99).id;`);
sandbox.p={...parameters('H'),height:8,center:[0,2]};assert.throws(()=>run('geometryApi.faceText(notch,notchFace,p)'),/fit inside/);
run(`var holed=prismRegion([[-20,-20],[20,-20],[20,20],[-20,20]],[[[-.1,-.1],[-.1,.1],[.1,.1],[.1,-.1]]],6,'holed'),holedFace=[...holed.faces.values()].find(f=>f.plane.normal[2]>.99).id;`);
sandbox.p=parameters('H');assert.throws(()=>run('geometryApi.faceText(holed,holedFace,p)'),/fit inside/);
sandbox.p=parameters('O');run('var holedResult=geometryApi.faceText(holed,holedFace,p)');verifySolid(run('holedResult.solid'),'opening inside glyph counter');
// Exact plane ownership: a stability overlap must never extend raised
// letters through a thin sheet or engrave an unrelated overhanging surface.
run(`var thinSheet=prismRegion([[-10,-6],[10,-6],[10,6],[-10,6]],[],.005,'thin-sheet'),thinFace=[...thinSheet.faces.values()].find(f=>f.plane.normal[2]>.99).id;`);
sandbox.p=parameters('H');run('var thinLayout=geometryApi.previewFaceText(thinSheet,thinFace,p),thinRaised=geometryApi.faceText(thinSheet,thinFace,p).solid');verifySolid(run('thinRaised'),'thin sheet Add');assert.ok(Math.abs(run('validateSolid(thinRaised,false).volume-validateSolid(thinSheet,false).volume-thinLayout.area*p.depth'))<1e-7,'Add never grows below its starting plane');
sandbox.p=parameters('H','cut');run('var thinCut=geometryApi.faceText(thinSheet,thinFace,p).solid');verifySolid(run('thinCut'),'thin sheet Cut');assert.ok(Math.abs(run('validateSolid(thinSheet,false).volume-validateSolid(thinCut,false).volume-thinLayout.area*.005'))<1e-7,'Cut is clipped to existing material');
run(`var floor=prismRegion([[-10,-5],[10,-5],[10,5],[-10,5]],[],1,'floor'),pillar=prismRegion([[8,-5],[10,-5],[10,5],[8,5]],[],2,'pillar'),roof=prismRegion([[-10,-5],[8,-5],[8,5],[-10,5]],[],1,'roof');for(const v of pillar.vertices.values())v.position[2]+=1;for(const f of pillar.faces.values())f.plane.offset+=f.plane.normal[2];for(const v of roof.vertices.values())v.position[2]+=1.01;for(const f of roof.faces.values())f.plane.offset+=f.plane.normal[2]*1.01;var overhang=csgToSolid(csgUnionOwned(csgUnionOwned(solidToCsg(floor),solidToCsg(pillar)),solidToCsg(roof)),'overhang',{kind:'boolean',label:'Overhang'}),floorFace=[...overhang.faces.values()].find(f=>f.plane.normal[2]>.99&&Math.abs(f.plane.offset-1)<1e-7).id,overhangLayout=geometryApi.previewFaceText(overhang,floorFace,p),overhangCut=geometryApi.faceText(overhang,floorFace,p).solid;`);
verifySolid(run('overhangCut'),'overhanging roof Cut');assert.ok(Math.abs(run('validateSolid(overhang,false).volume-validateSolid(overhangCut,false).volume-overhangLayout.area*p.depth'))<1e-7,'Cut never crosses outward through its starting plane');

for(const [id,value] of Object.entries({textContent:'ABO æøå',textOperation:'add',textHeight:'5',textDepth:'.5',textAngle:'0',textOffsetX:'0',textOffsetY:'0'}))get(id).value=value;
run(`cancelGesture();replaceObjects([{id:'text-model',name:'Text target',kind:'solid',color:'#69b6a6',solid:textSource,transform:{position:[10,20,30],rotation:[.1,.2,.3]}}]);replaceGroups([]);replaceDimensions([]);replaceGuides([]);undoStack=[];redoStack=[];modelRevision++;setTool('text');var textObject=objects[0],placementWorld=transformPoint([0,0,8],textObject.transform);chooseFaceText(textObject,textFace,placementWorld);`);
assert.equal(get('applyTextBtn').disabled,false);assert.ok(run('V.len(V.sub(fromPlane2(textPreviewState.parameters.center,textPreviewState.layout.basis),[0,0,8]))')<1e-8,'transformed placement');
const drawCalls=[];sandbox.drawCalls=drawCalls;run('ctx.stroke=()=>drawCalls.push("stroke");drawFaceTextPreview()');assert.ok(drawCalls.length>10,'wire preview draws glyph walls and counters');
const document=()=>run('JSON.stringify(projectData())'),before=document();
// Enter on a native button belongs to that button, rather than Text's
// viewport shortcut (especially Clear placement or another palette tool).
sandbox.document.activeElement=get('clearTextBtn');get('clearTextBtn').tagName='BUTTON';assert.equal(run('faceTextToolController.keyDown({key:"Enter"})'),false);assert.equal(run('modelingOperationBusy'),false);assert.ok(run('textTarget'));sandbox.document.activeElement={tagName:'BODY'};

run('commitFaceTextFromUI()');assert.equal(run('modelingOperationBusy'),true);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(run('modelingOperationBusy'),true,'host responds during kernel computation');
for(let i=0;run('modelingOperationBusy')&&i<1000;i++)await new Promise(resolve=>setTimeout(resolve,10));
assert.equal(run('modelingOperationBusy'),false);assert.equal(run('undoStack.length'),1);assert.equal(run('lastCommandEntry().type'),'face-text');assert.notEqual(document(),before);assert.equal(run('textTarget'),null);assert.equal(run('tool'),'text');verifySolid(run('objects[0].solid'),'worker commit');
const after=document();run('undo()');assert.equal(document(),before);assert.equal(run('tool'),'text');run('redo()');assert.equal(document(),after);run('undo()');
run('textObject=objects[0];chooseFaceText(textObject,textFace,placementWorld);commitFaceTextFromUI();modelingOperationCancel()');await new Promise(resolve=>setImmediate(resolve));assert.equal(run('modelingOperationBusy'),false);assert.equal(document(),before);assert.equal(run('undoStack.length'),0,'cancel creates no history');
// Changing live settings while a job is running invalidates its result.
run('chooseFaceText(objects[0],textFace,placementWorld);commitFaceTextFromUI()');get('textContent').value='Changed';
for(let i=0;run('modelingOperationBusy')&&i<1000;i++)await new Promise(resolve=>setTimeout(resolve,10));
assert.equal(run('modelingOperationBusy'),false);assert.equal(document(),before);assert.equal(run('undoStack.length'),0);assert.match(get('toast').textContent,/settings changed/);
get('textContent').value='ABO æøå';run('refreshFaceTextPreview()');
// Actual viewport dispatch uses a snapped face point, and never freezes
// hover-only lettering into the document before explicit placement/Apply.
run('clearFaceTextTarget();camera.target=[10,20,38];setView("top");cameraBasis();var hitTextPoint=project(placementWorld)');
sandbox.hitTextXY=plain(run('hitTextPoint'));
run('updateToolHoverFeedback(faceTextToolController,hitTextXY[0],hitTextXY[1])');
assert.ok(run('textHoverTarget'));assert.equal(run('textTarget'),null);assert.equal(get('applyTextBtn').disabled,true);
run('objects[0].locked=true;updateToolHoverFeedback(faceTextToolController,hitTextXY[0],hitTextXY[1])');assert.equal(run('textPreviewState'),null,'locked hover removes previous unplaced text');run('objects[0].locked=false;updateToolHoverFeedback(faceTextToolController,hitTextXY[0],hitTextXY[1])');assert.ok(run('textPreviewState'));

run('dispatchToolPointerDown({clientX:hitTextXY[0],clientY:hitTextXY[1],button:0,pointerId:1})');assert.ok(run('textTarget'));assert.equal(document(),before);assert.equal(get('applyTextBtn').disabled,false);
run('setTool("rect")');assert.equal(run('textPreviewState'),null);assert.equal(run('textTarget'),null);run('setTool("text");chooseFaceText(objects[0],textFace,placementWorld)');
get('textContent').value='😀';for(const listener of get('textContent').listeners.input)listener({target:get('textContent')});assert.equal(run('textPreviewState'),null);assert.equal(get('applyTextBtn').disabled,true);assert.match(get('textStatus').textContent,/does not support/);
get('textContent').value='Text';run('refreshFaceTextPreview();handleToolEscape()');assert.equal(run('textTarget'),null);assert.equal(run('tool'),'text');run('handleToolEscape()');assert.equal(run('tool'),'select');
// Prepared commits refuse locked, grouped or stale objects before mutation.
sandbox.p=parameters('A');run('var commitSource=objects[0].solid,ready=geometryApi.faceText(commitSource,textFace,p),revision=modelRevision,sourceTransform=structuredClone(objects[0].transform);objects[0].locked=true;');
assert.throws(()=>run("applyPreparedFaceText('text-model',commitSource,revision,sourceTransform,ready,textFace,p)"),/locked/);assert.equal(run('undoStack.length'),0);run('objects[0].locked=false;modelRevision++');
assert.throws(()=>run("applyPreparedFaceText('text-model',commitSource,revision,sourceTransform,ready,textFace,p)"),/changed/);assert.equal(document(),before);
run('revision=modelRevision;objects[0].transform.position[0]+=1');assert.throws(()=>run("applyPreparedFaceText('text-model',commitSource,revision,sourceTransform,ready,textFace,p)"),/changed/);run('objects[0].transform.position[0]-=1');
run("replaceGroups([{id:'text-group',name:'Grouped',objectIds:['text-model']}]);");assert.throws(()=>run("applyPreparedFaceText('text-model',commitSource,revision,sourceTransform,ready,textFace,p)"),/changed/);run('replaceGroups([])');
const failure=run(`geometryApi.faceTextAsync(textSource,textFace,{...p,center:[1000,0]})`);await assert.rejects(failure.promise,/fit inside/);
const cancelled=run('geometryApi.faceTextAsync(textSource,textFace,p)');cancelled.cancel();await assert.rejects(cancelled.promise,/cancelled/);
console.log(`R233 planar text passed: ${converted} glyphs, counters/Unicode/depth/rotation/oblique and holed support, closed exports and reopen, real worker responsiveness/cancel/error, atomic history, lock/group/stale guards and controller preview.`);
}finally{await ModelingWorker.closeAll();}
