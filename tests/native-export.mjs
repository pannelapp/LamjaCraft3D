import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..');let workers=0;
class UnexpectedWorker{constructor(){workers++;throw Error('Native export must use canonical serializers, not mesh conversion');}}
const {sandbox,get,downloads}=createAppFixture(root,UnexpectedWorker),run=code=>vm.runInContext(code,sandbox),plain=value=>JSON.parse(JSON.stringify(value));
const filenames=[],createElement=sandbox.document.createElement;sandbox.document.createElement=tag=>{const element=createElement(tag);if(tag==='a')element.click=()=>filenames.push(element.download);return element;};
run(`(()=>{
 $('projectName').value='Reuse Ø parts';
 const a=objects[0];a.name='Red \\"bracket\\"';a.color='#de2233';a.transform={position:[-12,35,7],rotation:[20,35,60]};
 for(let i=0;i<5;i++){const object=makeObject('box');object.name='Part '+(i+2);object.color=i%2?'#2288cc':'#44aa55';object.transform={position:[40*i,5,3],rotation:[10*i,0,20*i]};objects.push(object);}
 objects[1].solid=geometryApi.createPrismRegion([[-10,-10],[10,-10],[10,10],[-10,10]],[[[-3,-3],[-3,3],[3,3],[3,-3]]],15,objects[1].solid.id);
 objects[2].hidden=true;objects[5].hidden=true;
 groups.push({id:'grp1',name:'First assembly',objectIds:objects.slice(0,3).map(o=>o.id)},{id:'grp2',name:'Second assembly',objectIds:objects.slice(3,5).map(o=>o.id)});
 const vertex=(i,index=0)=>({kind:'vertex',objectId:objects[i].id,vertexId:[...objects[i].solid.vertices.keys()][index],fallback:[5,6,7]});
 const edge=i=>({kind:'edge',objectId:objects[i].id,vertexA:[...objects[i].solid.vertices.keys()][0],vertexB:[...objects[i].solid.vertices.keys()][1],t:.25,fallback:[7,8,9]});
 dimensions.push({id:'d1',kind:'linear',a:vertex(0),b:vertex(1),label:'Inside selection'},{id:'d2',kind:'linear',a:edge(0),b:{kind:'world',point:[100,20,15]}},{id:'d3',kind:'linear',a:vertex(0),b:vertex(2)},{id:'d4',kind:'linear',a:vertex(5),b:{kind:'world',point:[5,5,0]}},{id:'d5',kind:'linear',a:{kind:'world',point:[0,0,0]},b:{kind:'world',point:[10,0,0]}});
 guides.push({id:'g1',kind:'point',point:[200,300,0],label:'Independent guide'});createBuildPlate();
 setObjectSelection([objects[0].id,objects[1].id,objects[3].id,objects[4].id],null,true,false);setDirtyState(true);
 $('exportFormat').value='lamjacraft';$('exportScope').value='selected';
})()`);
const ids=plain(run('objects.map(o=>o.id)'));
const state=()=>run('JSON.stringify(projectData())'),history=()=>run('JSON.stringify([undoStack,redoStack])'),selection=()=>run('JSON.stringify([modelDocument.selection,modelDocument.objectSelection])');
const original=state(),originalHistory=history(),originalSelection=selection(),revision=run('modelRevision'),dirty=run('dirty');
run('exportSummary()');assert.match(get('exportSummary').textContent,/4 objects.*faces/);assert.equal(get('downloadSTL').textContent,'Download LamjaCraft JSON');assert.match(get('exportFormatNote').textContent,/format 7.*\.lamjacraft\.json/);assert.equal(get('downloadSTL').disabled,false);
// The actual download path snapshots scoped objects and metadata, then yields.
await run('downloadExchange()');assert.equal(downloads.length,1);assert.equal(filenames[0],'Reuse Ø parts.lamjacraft.json');assert.equal(downloads[0].type,'application/json');
const selected=JSON.parse(await downloads[0].text());assert.equal(selected.format,'lamjacraft-3d');assert.equal(selected.version,7);assert.equal(selected.units,'mm');
assert.deepEqual(selected.objects.map(o=>o.id),[ids[0],ids[1],ids[3],ids[4]]);assert.deepEqual(selected.groups,[{id:'grp1',name:'First assembly',objectIds:[ids[0],ids[1]]},{id:'grp2',name:'Second assembly',objectIds:[ids[3],ids[4]]}]);
assert.deepEqual(selected.construction.guides,[]);assert.equal(selected.references,undefined);assert.deepEqual(selected.annotations.dimensions.map(d=>d.id),['d1','d2']);
const source=JSON.parse(original);assert.deepEqual(selected.objects,source.objects.filter(o=>selected.objects.some(e=>e.id===o.id)));assert.deepEqual(selected.annotations.dimensions,source.annotations.dimensions.slice(0,2));
assert.equal(state(),original);assert.equal(history(),originalHistory);assert.equal(selection(),originalSelection);assert.equal(run('dirty'),dirty);assert.equal(run('modelRevision'),revision);assert.equal(run('modelingOperationBusy'),false);
sandbox.exported=selected;run('validateProjectReferenceCoordinates(validateProject(exported))');
// Native import remaps collisions, group membership and both vertex/edge anchors,
// and adds the exported file once with exact Undo/Redo and source preservation.
sandbox.files=[{name:filenames[0],size:downloads[0].size,text:()=>downloads[0].text()}];await run('selectImportFiles(files);');await run('checkPendingImport()');assert.equal(get('commitImport').disabled,false);assert.equal(state(),original);run('commitCheckedImport()');assert.equal(run('objects.length'),10);assert.equal(run('groups.length'),4);assert.equal(run('dimensions.length'),7);
const imported=plain(run('objects.slice(6).map(serializeProjectObject)'));for(let i=0;i<imported.length;i++){assert.notEqual(imported[i].id,selected.objects[i].id);assert.deepEqual(imported[i].transform,selected.objects[i].transform);assert.equal(imported[i].color,selected.objects[i].color);assert.deepEqual(imported[i].solid.faces,selected.objects[i].solid.faces);}
const importedIds=imported.map(o=>o.id);assert.deepEqual(plain(run('groups.slice(2).map(g=>g.objectIds)')),[importedIds.slice(0,2),importedIds.slice(2)]);const importedDims=plain(run('dimensions.slice(5)'));assert.equal(importedDims[0].a.objectId,importedIds[0]);assert.equal(importedDims[0].b.objectId,importedIds[1]);assert.equal(importedDims[1].a.objectId,importedIds[0]);assert.equal(importedDims[1].a.kind,'edge');
const afterImport=state();run('undo()');assert.equal(state(),original);run('redo()');assert.equal(state(),afterImport);run('undo()');assert.equal(state(),original);
// Entire model matches ordinary Save Project data, including hidden objects,
// independent references and complete group relationships.
get('exportScope').value='all';run('exportSummary()');await run('downloadExchange()');const entire=JSON.parse(await downloads.at(-1).text());assert.deepEqual(entire,source);assert.equal(entire.objects.filter(o=>o.hidden).length,2);
// Group selection includes all members (including explicitly hidden members).
run('setGroupSelection(groups[0],[objects[3].id]);');get('exportScope').value='selected';await run('downloadExchange()');const group=JSON.parse(await downloads.at(-1).text());assert.deepEqual(group.objects.map(o=>o.id),ids.slice(0,4));assert.deepEqual(group.groups,[source.groups[0]]);assert.equal(group.objects[2].hidden,true);
// An individual member frame exports only that member and omits a singleton
// group rather than adding unselected members or writing an invalid group.
run('setObjectSelection([objects[0].id],null,true,false)');await run('downloadExchange()');const single=JSON.parse(await downloads.at(-1).text());assert.deepEqual(single.objects.map(o=>o.id),[ids[0]]);assert.deepEqual(single.groups,[]);assert.deepEqual(single.annotations.dimensions.map(d=>d.id),['d2']);sandbox.exported=single;run('validateProject(exported)');
// A face selection exports its owning object through the same scope resolver.
run("groups.splice(0);setSelection({kind:'face',objectId:objects[1].id,faceId:[...objects[1].solid.faces.keys()][0]})");await run('downloadExchange()');assert.deepEqual(JSON.parse(await downloads.at(-1).text()).objects.map(o=>o.id),[ids[1]]);
// Cancellation during the UI's first yield and between encoding objects leaves
// no partial download. The native reader's byte limit also bounds the writer.
run('setObjectSelection([objects[0].id,objects[1].id])');const cancelState=state(),cancelHistory=history(),count=downloads.length;
const pending=run('downloadExchange()');run('cancelModelingOperation()');await pending;assert.equal(downloads.length,count);assert.equal(run('modelingOperationBusy'),false);assert.equal(state(),cancelState);assert.equal(history(),cancelHistory);
let cancelled=false;const progress=[];sandbox.control={report:(p,m)=>{progress.push({p,m});if(p>0)cancelled=true;},isCancelled:()=>cancelled};await assert.rejects(run('nativeProjectFileAsync(snapshotNativeExport(exportObjects(),true),control)'),/cancelled/);assert.ok(progress.length>=2);assert.equal(state(),cancelState);
assert.equal(run('NATIVE_EXPORT_POLICY.maximumBytes'),run('PROJECT_READ_POLICY.maximumFileBytes'),'Native export could exceed its own reader limit');
run('checkNativeExportSize(NATIVE_EXPORT_POLICY.maximumBytes)');assert.throws(()=>run('checkNativeExportSize(NATIVE_EXPORT_POLICY.maximumBytes+1)'),/file exceeds/);
sandbox.control={report(){},isCancelled:()=>false};
// A snapshot retains its metadata/transforms/source-solid references after the
// live document changes. It still passes the strict native reader.
const snapshot=run('snapshotNativeExport(exportObjects(),true)');sandbox.snapshot=snapshot;const expectedSnapshot=plain(run('snapshot.objects.map(serializeProjectObject)'));run("objects[0].name='Changed later';objects[0].color='#ffffff';objects[0].transform.position=[999,888,777];objects[0].solid=geometryApi.createPrism([[-1,-1],[1,-1],[1,1],[-1,1]],2,objects[0].solid.id)");const snapshotBlob=await run('nativeProjectFileAsync(snapshot,control)');const snapshotData=JSON.parse(await snapshotBlob.text());assert.deepEqual(snapshotData.objects,expectedSnapshot);
sandbox.exported=snapshotData;run('validateProject(exported)');
// Failed native encoding retains an actionable error and downloads no file.
run('objects[0].transform.position[0]=NaN');const failureCount=downloads.length;await run('downloadExchange()');assert.equal(downloads.length,failureCount);assert.equal(get('exportDialog').open,true);assert.match(get('exportError').textContent,/non-finite/);assert.equal(run('modelingOperationBusy'),false);
run('clearSelection();exportSummary()');assert.equal(get('downloadSTL').disabled,true);assert.match(get('exportSummary').textContent,/Select/);await run('downloadExchange()');assert.equal(downloads.length,failureCount);
// Open accepts exactly the exported file and retains canonical editing data.
sandbox.exported=selected;run('loadProject(exported)');assert.deepEqual(plain(run('projectData()')),selected);assert.equal(run('tool'),'select');assert.equal(run('dirty'),false);
assert.equal(workers,0);const html=fs.readFileSync(resolve(root,'dist/LamjaCraft-3D.html'),'utf8');assert.match(html,/<option value="lamjacraft">LamjaCraft JSON/);assert.match(html,/<option selected value="stl">STL/);
console.log('R211 native export passed: selected objects/multiple and partial groups, hidden group members, face ownership, exact geometry/colors/transforms, contained anchors, entire-project equivalence, actual download/Import/Open/Undo/Redo, read-only history/dirty/selection, snapshots, progress/Cancel/size/errors and no mesh conversion.');
