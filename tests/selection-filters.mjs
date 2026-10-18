import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root),run=s=>vm.runInContext(s,sandbox),read=s=>JSON.parse(run(`JSON.stringify(${s})`));
const reset=()=>run(`cancelGesture();replaceObjects([]);replaceGroups([]);replaceGuides([]);replaceDimensions([]);nextObjectId=1;for(let i=0;i<6;i++){const o=makeObject('box');o.transform.position=[i*55-110,0,0];objects.push(o);}groups.push({id:'one',name:'First',objectIds:[objects[0].id,objects[1].id]},{id:'two',name:'Second',objectIds:[objects[2].id,objects[3].id]});objects[1].hidden=true;objects[1].locked=true;camera.target=[25,0,10];camera.distance=300;setView('top');cameraBasis();clearSelection();activateTool('select');undoStack=[];redoStack=[];`);
const ids=()=>read('selectedObjectIds()');
const mode=value=>{get('selectionMode').value=value;for(const f of get('selectionMode').listeners.change)f();};
const event=(index,extra={})=>{sandbox.index=index;const p=read('project(transformPoint([0,0,10],objects[index].transform))');return {clientX:p[0],clientY:p[1],pointerId:1,button:0,...extra};};
const click=(index,extra={})=>{sandbox.ev=event(index,extra);run('dispatchToolPointerDown(ev);dispatchToolPointerUp(ev)');};
const frame=(index,extra={})=>{const p=event(index);sandbox.a={clientX:p.clientX-8,clientY:p.clientY-8,button:0,pointerId:2,...extra};sandbox.b={clientX:p.clientX+8,clientY:p.clientY+8,button:0,pointerId:2,...extra};run('dispatchToolPointerDown(a);dispatchToolPointerMove(b);dispatchToolPointerUp(b)');};
const markup=fs.readFileSync(resolve(root,'src/template.html'),'utf8'),nav=markup.split('<nav aria-label="Modeling tools" class="tools">')[1].split('</nav>')[0],groups={};
for(const [,name,content] of nav.matchAll(/<div class="tool-group-title">([^<]+)<\/div>(.*?)(?=<div class="tool-group-title">|$)/gs))groups[name]=Array.from(content.matchAll(/<button[^>]*(?:data-tool|id)="([^"]+)"/g),m=>m[1]);
assert.deepEqual(groups,{Edit:['select','copyObjectsBtn','pasteObjectsBtn','delete','move','rotate'],Reference:['guide','guidecircle','measure'],Sketch:['rect','circle','arc','poly','sketcheditor'],Mechanical:['gear','rack','boltcircle','slot','arcslot','thread'],Solid:['shapes','photoAiBtn'],Modify:['push','chamfer','text','texture','mergefaces','carve','splitplane','mirror'],Help:['helpBtn','aboutBtn']});
const options=markup.split('id="selectionMode">')[1].split('</select>')[0];assert.deepEqual(Array.from(options.matchAll(/value="([^"]+)">([^<]+)/g),m=>[m[1],m[2]]),[['object-group','Objects and Groups'],['object','Objects'],['group','Groups']]);assert.match(nav,/<span>Objects\/<br>Groups<\/span><\/button>/);assert.match(nav,/>Editor<\/button>/);
reset();assert.equal(run('objectSelectionMode()'),'object-group');const objects=read('objects.map(o=>o.id)'),before=run('JSON.stringify(projectData())');
for(const kind of ['object-group','object','group']){
 reset();mode(kind);click(0);assert.deepEqual(ids(),kind==='object'?[objects[0]]:[objects[0],objects[1]]);assert.equal(run('modelDocument.selection.kind'),kind==='object'?'object':'group');
 click(4);assert.deepEqual(ids(),kind==='group'?[]:[objects[4]]);
 frame(0);assert.deepEqual(ids(),kind==='object'?[objects[0]]:[objects[0],objects[1]]);
 frame(4);assert.deepEqual(ids(),kind==='group'?[]:[objects[4]]);
 // Hover and click resolve exactly the same unit, without group promotion in
 // Objects mode. Other tool hover promotion is left intact.
 sandbox.ev=event(0);run('dispatchToolPointerMove(ev)');assert.equal(run('modelDocument.hover.kind'),kind==='object'?'object':'group');
 sandbox.ev=event(4);run('dispatchToolPointerMove(ev)');assert.equal(run('modelDocument.hover?.kind||null'),kind==='group'?null:'object');
 assert.equal(run('undoStack.length'),0);assert.equal(run('JSON.stringify(projectData())'),before);
}
for(const modifier of ['ctrlKey','shiftKey','metaKey'])for(const kind of ['object-group','object','group']){
 reset();mode(kind);click(0);click(2,{[modifier]:true});assert.deepEqual(ids(),kind==='object'?[objects[0],objects[2]]:[objects[0],objects[1],objects[2],objects[3]]);
 click(0,{[modifier]:true});assert.deepEqual(ids(),kind==='object'?[objects[2]]:[objects[2],objects[3]]);
 click(2,{[modifier]:true});assert.deepEqual(ids(),[]);
 click(4);click(0,{[modifier]:true});assert.deepEqual([...ids()].sort(),[...(kind==='group'?[]:[objects[4]]),objects[0],...(kind==='object'?[]:[objects[1]])].sort());
 frame(2,{[modifier]:true});assert.ok(ids().includes(objects[2]));assert.equal(ids().includes(objects[3]),kind!=='object');
}
// Changing the filter reinterprets model selections, cancels a pending frame,
// keeps group membership untouched and creates no modeling history.
reset();mode('object');click(0);mode('object-group');assert.deepEqual(ids(),[objects[0],objects[1]]);mode('object');assert.deepEqual(ids(),[objects[0]]);click(4,{ctrlKey:true});mode('group');assert.deepEqual(ids(),[objects[0],objects[1]]);
sandbox.a=event(2);sandbox.b={...sandbox.a,clientX:sandbox.a.clientX+20,clientY:sandbox.a.clientY+20};run('dispatchToolPointerDown(a);dispatchToolPointerMove(b)');mode('object');assert.equal(run('pointer'),null);assert.deepEqual(ids(),[objects[0]]);
assert.equal(run('JSON.stringify(projectData())'),before);assert.equal(run('undoStack.length'),0);
// Partial member deletion and Move use the existing exact selected-ID commands;
// a whole-group action remains protected by its hidden locked member.
reset();mode('object');click(0);run("setTool('move');setAxis('x');moveToolController.numericSeed();moveToolController.numericCommit({distance:7})");assert.equal(run('objects[0].transform.position[0]'),-103);assert.equal(run('objects[1].transform.position[0]'),-55);run('undo()');assert.equal(run('objects[0].transform.position[0]'),-110);assert.deepEqual(ids(),[objects[0]]);
run("setTool('select')");click(0);run('removeSelectedEntity()');assert.equal(run('objects.length'),5);assert.ok(run('objects.some(o=>o.id===groups[0]?.objectIds?.[0])')||run('groups.length')===1);run('undo()');assert.equal(run('objects.length'),6);assert.equal(run('objects[1].hidden&&objects[1].locked'),true);
run("setTool('select')");mode('object-group');click(0);run("setTool('move');setAxis('x')");assert.equal(run('moveToolController.numericSeed()'),false);assert.equal(run('objects[0].transform.position[0]'),-110);
// Reference inspection remains available in the default mode. Groups-only
// cannot accidentally pick a guide or dimension above an ungrouped object.
reset();run("guides.push({id:'filter-guide',kind:'point',point:transformPoint([0,0,10],objects[4].transform)});$('showGuides').checked=true");mode('object-group');click(4);assert.equal(run('modelDocument.selection.kind'),'guide');mode('group');click(4);assert.equal(run('modelDocument.selection'),null);
console.log('R272 selection filters and palette passed: exact complete menu order/labels, default mixed mode, direct/frame/hover units, individual grouped objects, complete hidden membership, strict Groups filter, all modifiers and group toggling, filter transitions/frame cancellation, unchanged geometry/history, partial-member Move/Delete/Undo and whole-group locks.');
