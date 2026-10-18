import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
import {ModelingWorker} from './modeling-worker-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root,ModelingWorker),run=c=>vm.runInContext(c,sandbox);
const plain=x=>JSON.parse(JSON.stringify(x));
const defaults={type:'hex',operation:'cut',spacing:2.8,size:1.5,depth:.2,angleDeg:0,margin:.35,offsetX:.3,offsetY:.17,band:{axis:'z',repeats:12,rows:3}};
function bowl(facets=8){sandbox.facets=facets;run(`var source=buildSolidFromPolygons(primitiveRevolution([[0,0],[4,1],[7,3],[9,6],[10,9],[8.8,9],[7.8,6],[5.8,3],[0,1.5]],facets,false,'Band bowl'),'band-bowl');var ids=[...source.faces.values()].filter(f=>{const pts=faceLoopPoints(source,f.id).outer,c=V.mul(pts.reduce((s,q)=>V.add(s,q),[0,0,0]),1/pts.length);return c[2]>1.5&&V.dot(f.plane.normal,V.unit([c[0],c[1],0]))>.2;}).map(f=>f.id);`);}
function verify(solid,label){sandbox.checked=solid;const v=run('validateSolid(checked,false)');assert.equal(v.ok,true,label+': '+v.errors.join('; '));const mesh=run('triangleMeshEdgeStats(solidMeshExportLocal(checked))');assert.equal(mesh.boundary,0,label+' open STL mesh');assert.equal(mesh.nonManifold,0,label+' non-manifold STL mesh');assert.equal(run('connectedSolidFaceComponents(checked).length'),1,label+' disconnected material');assert.deepEqual(plain(run('serializeProjectSolid(deserializeProjectSolid(serializeProjectSolid(checked)))')),plain(run('serializeProjectSolid(checked)')),label+' canonical reopen');return v.volume;}
let cases=0;
function apply(p,label){sandbox.p=p;const before=run('JSON.stringify(serializeSolid(source))'),volume=run('validateSolid(source,false).volume'),preview=run('geometryApi.previewSurfaceTextureFaces(source,ids,p)'),result=run('geometryApi.surfaceTextureFaces(source,ids,p)');assert.equal(preview.components,result.components);assert.equal(preview.instances,result.instances);assert.equal(preview.band.rows,p.band.rows);assert.ok(preview.components>0);const changed=verify(result.solid,label);assert.ok(p.operation==='cut'?changed<volume:changed>volume,label+' volume direction');assert.equal(run('JSON.stringify(serializeSolid(source))'),before,label+' mutated source');cases++;return result;}

// Removing a corner and its near-collinear subdivision together invents a
// diagonal. Exercise cyclic starts, winding and an oblique translated plane.
run(`var cornerLoop=[[0,0,0],[1,0,0],[1,.0000004,0],[1,1,0],[0,1,0]];`);
for(let start=0;start<5;start++)for(const reversed of [false,true]){sandbox.start=start;sandbox.reversed=reversed;run(`var loop=cornerLoop.slice(start).concat(cornerLoop.slice(0,start));if(reversed)loop.reverse();var simplified=simplifyCollinearLoop3(loop);`);assert.ok(Math.abs(run('v2.area(simplified.map(q=>[q[0],q[1]]))'))>.999999);}
run(`var obliqueFrame=planeBasis({normal:V.unit([.3,-.4,.8]),offset:0},[1234.5,-876.4,357.2]),obliqueLoop=cornerLoop.map(q=>fromPlane2([q[0],q[1]],obliqueFrame));`);
assert.ok(Math.abs(run('v2.area(simplifyCollinearLoop3(obliqueLoop).map(q=>toPlane2(q,obliqueFrame)))'))>.999999);

// A dense boundary must retain every real corner while simplifying long
// subdivisions. This also exercises bounded neighbour work on a large loop.
run(`var denseBoundary=Array.from({length:20000},(_,i)=>{const side=Math.floor(i/5000),t=(i%5000)/5000;return side===0?[t,0,0]:side===1?[1,t,0]:side===2?[1-t,1,0]:[0,1-t,0];}),denseSimplified=simplifyCollinearLoop3(denseBoundary);`);
assert.equal(run('denseSimplified.length'),4);assert.equal(run('v2.area(denseSimplified.map(q=>[q[0],q[1]]))'),1);

// A valid face may depart from its representative plane within TOL.plane.
// Derived tessellation must retain the shared canonical boundary coordinates.
run(`var nearPlanar=primitivePrism([[0,0],[2,0],[2,2],[0,2]],2,'near-planar'),corner=[...nearPlanar.vertices.values()].find(v=>v.position[0]===2&&v.position[1]===2&&v.position[2]===2);corner.position[2]+=.0000005;var nearTop=[...nearPlanar.faces.values()].find(f=>f.plane.normal[2]>.999),nearMesh=triangulateFaceLocal(nearPlanar,nearTop.id,undefined,'canonical');`);
assert.equal(run('validateSolid(nearPlanar,false).ok'),true);assert.equal(run('nearMesh.flat().some(q=>V.len(V.sub(q,corner.position))<1e-12)'),true);assert.deepEqual(plain(run('triangleMeshEdgeStats(solidMeshExportLocal(nearPlanar))')),{boundary:0,nonManifold:0});

bowl();const types=['lines','dots','hex','squares','diamonds','triangles','stars','slots','chevrons'];
for(const type of types)for(const operation of ['cut','add'])apply({...defaults,type,operation},type+' '+operation);
console.log('R196 all nine wrapped motifs passed Add/Cut, closed STL and canonical reopen.');

// Exact periodic coordinates, radius-proportional width, unchanged row heights
// and face-normal depth are independent mathematical checks, not snapshots.
sandbox.p=defaults;run(`var context=createTextureBandContext(source,ids,p),middle=ids.find(id=>{const b=textureBandFaceBounds(source,id,context,context.period);return b[1]>2.9&&b[1]<3.1;}),bounds=textureBandFaceBounds(source,middle,context,context.period),theta=(bounds[0]+bounds[2])*.5,plane=source.faces.get(middle).plane,low=textureBandPoint([theta,4],plane,context),high=textureBandPoint([theta,5.5],plane,context),widthLow=V.len(V.sub(textureBandPoint([theta-.4,4],plane,context),textureBandPoint([theta+.4,4],plane,context))),widthHigh=V.len(V.sub(textureBandPoint([theta-.4,5.5],plane,context),textureBandPoint([theta+.4,5.5],plane,context)));`);
assert.ok(Math.abs(run('widthLow/widthHigh-textureBandRadius(low,context)/textureBandRadius(high,context)'))<1e-12);assert.ok(run('widthLow<widthHigh'));assert.ok(run('V.len(V.sub(textureBandPoint([theta+context.period,4],plane,context),low))')<1e-12);assert.equal(run('low[2]'),4);assert.equal(run('high[2]'),5.5);
run(`var seamErrors=[];for(const id of ids){const f=source.faces.get(id);for(const e of loopHalfEdges(source,f.outerLoop)){const twin=source.halfEdges.get(e.twin);if(!ids.includes(twin.face))continue;const a=source.vertices.get(e.origin).position,b=source.vertices.get(source.halfEdges.get(e.next).origin).position,q=V.lerp(a,b,.37),field=context.fields.get(id),other=context.fields.get(twin.face),d=textureBandDirection(toPlane2(q,field.basis),field),dn=textureBandDirection(toPlane2(q,other.basis),other);seamErrors.push(V.len(V.sub(d,dn)),Math.abs(V.dot(f.plane.normal,d)-1));}}`);
assert.ok(run('Math.max(...seamErrors)')<1e-9);

for(const facets of [7,11,16])for(const rows of [2,3]){
 bowl(facets);for(const operation of ['cut','add'])apply({...defaults,operation,size:1.2,spacing:2.1,depth:.12,angleDeg:19,offsetX:-.37,offsetY:-.2,margin:.25,band:{axis:'z',repeats:17,rows}},`Odd/even facets ${facets}, ${rows} rows, ${operation}`);
 run('ids.reverse();source.faces=new Map([...source.faces].reverse());');apply({...defaults,size:1.2,depth:.12,band:{axis:'z',repeats:17,rows}},`Reversed traversal ${facets}/${rows}`);
}
bowl(48);for(const operation of ['cut','add'])apply({...defaults,operation,size:1.2,spacing:2.1,depth:.12,angleDeg:19,band:{axis:'z',repeats:36,rows:3}},`Dense 48-facet band ${operation}`);
bowl();run(`ids=[...source.faces.values()].filter(f=>{const pts=faceLoopPoints(source,f.id).outer,c=V.mul(pts.reduce((s,q)=>V.add(s,q),[0,0,0]),1/pts.length);return pts.every(q=>Math.hypot(q[0],q[1])>.02)&&c[2]>1.5&&V.dot(f.plane.normal,V.unit([c[0],c[1],0]))<-.2;}).map(f=>f.id);`);for(const operation of ['cut','add'])apply({...defaults,operation,size:1.2,spacing:2.1,depth:.12,band:{axis:'z',repeats:17,rows:2}},`Inner side band ${operation}`);
console.log('R196 varied facet counts, phase, rotation, two/three rows and reversed traversal passed.');

// Cylinder and tapered frustum; transform canonical coordinates to local X/Y,
// including an off-origin centre. Object placement remains separate.
for(const tapered of [false,true])for(const axis of ['x','y','z']){
 sandbox.tapered=tapered;sandbox.bandTestAxis=axis;run(`var raw=buildSolidFromPolygons(primitiveRevolution([[0,0],[6,0],[tapered?10:6,10],[0,10]],11,false,'Round band'),'round-band'),rotation=bandTestAxis==='x'?[0,90,0]:bandTestAxis==='y'?[-90,0,0]:[0,0,0];source=buildSolidFromPolygons([...raw.faces.keys()].flatMap(id=>triangulateFaceLocal(raw,id).map(points=>({points:points.map(q=>V.add(transformPoint(q,{position:[0,0,0],rotation}),[5,-3,1]))}))),'round-axis');ids=[...source.faces.values()].filter(f=>Math.abs(f.plane.normal[bandTestAxis==='x'?0:bandTestAxis==='y'?1:2])<.8).map(f=>f.id);`);
 apply({...defaults,size:1.2,depth:.12,band:{axis,repeats:13,rows:3}},`${tapered?'Frustum':'Cylinder'} local ${axis}`);
}

bowl();sandbox.p=defaults;
for(const [patch,message] of [[{band:{axis:'z',repeats:2,rows:3}},/3–256/],[{band:{axis:'z',repeats:12,rows:0}},/1–16/],[{type:'crosshatch'},/Planar patch/],[{type:'pyramids'},/Planar patch/],[{type:'beveltiles'},/Planar patch/],[{type:'rooftiles'},/Planar patch/],[{type:'lines',angleDeg:20},/rotation 0/],[{size:2.79},/smaller than spacing/]]){sandbox.p={...defaults,...patch};assert.throws(()=>run('previewSurfaceTextureFaces(source,ids,p)'),message);}
sandbox.p=defaults;run('var cap=[...source.faces.values()].find(f=>Math.abs(f.plane.normal[2])>.999);');assert.throws(()=>run('previewSurfaceTextureFaces(source,[cap.id],p)'),/side faces|axis|caps/);
sandbox.p={...defaults,depth:3};const unchanged=run('JSON.stringify(serializeSolid(source))');assert.throws(()=>run('applySurfaceTextureFacesSolid(source,ids,p)'),/crosses another surface|surface layer/);assert.equal(run('JSON.stringify(serializeSolid(source))'),unchanged);

// Actual tool controls and shipped embedded worker on a separate thread.
const inputs={textureMapping:'band',textureBandAxis:'z',textureBandRepeats:12,textureBandRows:3,textureType:'hex',textureOperation:'cut',textureSpacing:2.8,textureSize:1.5,textureDepth:.2,textureAngle:0,textureMargin:.35,textureOffsetX:.3,textureOffsetY:.17};for(const [id,value] of Object.entries(inputs))get(id).value=String(value);get('textureMultiple').checked=true;get('textureUseReference').checked=true;
run(`var object=makeObject('box');object.solid=source;object.transform={position:[12,-7,4],rotation:[17,-21,33]};replaceDocumentContents('Wrapped band',[object],[],[],'load-project','Open project',false);setTool('texture');chooseSurfaceTextureFace(objects[0],middle=ids.find(id=>textureBandFaceBounds(source,id,textureBandFrame(source,'z'),1)[1]>2.9));`);
assert.equal(get('applyTextureBtn').disabled,false,get('textureStatus').textContent);assert.equal(get('texturePlanarOrigin').classList.contains('hidden'),true);assert.equal(run('surfaceTextureParametersFromUI(objects[0],middle).projection'),undefined);assert.equal(run('surfaceTextureParametersFromUI(objects[0],middle).referencePoint'),undefined);
const historyBefore=run('undoStack.length'),before=run('snapshot()'),transform=plain(run('objects[0].transform'));
get('textureRingBtn').onclick();assert.equal(run('textureTarget.faceIds.length'),8);get('textureNeighborsBtn').onclick();assert.equal(run('textureTarget.faceIds.length'),24);assert.equal(run('undoStack.length'),historyBefore);
const untilDone=async()=>{for(let i=0;i<1000;i++){if(!run('modelingOperationBusy'))return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Texture worker did not finish');};
run('commitSurfaceTextureFromUI()');await untilDone();assert.equal(run('textureDiagnosticLogs.at(-1).outcome'),'success',run('textureDiagnosticLogs.at(-1).error'));assert.equal(run('undoStack.length'),historyBefore+1);assert.equal(run('lastCommandEntry().type'),'surface-texture');assert.deepEqual(plain(run('objects[0].transform')),transform);verify(run('objects[0].solid'),'Worker committed band');const after=run('snapshot()');run('undo()');assert.equal(run('snapshot()'),before);run('redo()');assert.equal(run('snapshot()'),after);
assert.ok(run(`textureDiagnosticLogs.at(-1).events.some(e=>e.event==='band-mapping'&&e.data.repeats===12)`));assert.ok(run(`textureDiagnosticLogs.at(-1).events.some(e=>e.event==='band-surface-validated')`));

// Read-only actual worker STL, decoded independently at the Float32 boundary.
const exportBefore=run('JSON.stringify({state:captureDocumentState(),undo:undoStack,redo:redoStack,revision:modelRevision,dirty})'),bytes=Buffer.from(await run('geometryApi.exportSTLAsync(objects).promise')),edges=new Map(),count=bytes.readUInt32LE(80);assert.equal(bytes.length,84+count*50);let volume=0;
for(let i=0;i<count;i++){const offset=84+i*50,normal=[0,1,2].map(a=>bytes.readFloatLE(offset+4*a)),ps=[0,1,2].map(j=>[0,1,2].map(a=>bytes.readFloatLE(offset+12+12*j+4*a)));assert.ok([...normal,...ps.flat()].every(Number.isFinite));assert.ok(Math.abs(Math.hypot(...normal)-1)<1e-6);for(let j=0;j<3;j++){const key=[ps[j].join(','),ps[(j+1)%3].join(',')].sort().join('|');edges.set(key,(edges.get(key)||0)+1);}const [a,b,c]=ps;volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;}
assert.ok([...edges.values()].every(n=>n===2));assert.ok(Math.abs(volume-run('validateSolid(objects[0].solid,false).volume'))<.005);assert.equal(run('JSON.stringify({state:captureDocumentState(),undo:undoStack,redo:redoStack,revision:modelRevision,dirty})'),exportBefore);
run('undo();chooseSurfaceTextureFace(objects[0],ids[0]);addSurfaceTextureNeighbors(true);addSurfaceTextureNeighbors();');const cancelBefore=run('JSON.stringify({state:captureDocumentState(),undo:undoStack,redo:redoStack,revision:modelRevision,dirty})');run('commitSurfaceTextureFromUI();cancelModelingOperation()');await untilDone();assert.equal(run('textureDiagnosticLogs.at(-1).outcome'),'cancelled');assert.equal(run('JSON.stringify({state:captureDocumentState(),undo:undoStack,redo:redoStack,revision:modelRevision,dirty})'),cancelBefore);
get('textureMapping').value='planar';run('changeSurfaceTextureMapping()');assert.equal(get('textureBandControls').classList.contains('hidden'),true);assert.equal(get('texturePlanarOrigin').classList.contains('hidden'),false);
const html=fs.readFileSync(resolve(root,'dist/LamjaCraft-3D.html'),'utf8');for(const id of ['textureMapping','textureBandAxis','textureBandRepeats','textureBandRows','textureRingBtn'])assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
await ModelingWorker.closeAll();console.log(`R196 wrapped band passed ${cases} kernel cases: periodic seam/taper, nine motifs Add/Cut, facets/rows/phase/rotation/order, local axes/off-origin circles, exact shared depth, surface clearance/rejections, preview/source preservation, controls/ring/neighbours, actual worker/history/Undo/Redo/cancel/diagnostics and ${count} closed Float32 STL triangles.`);
