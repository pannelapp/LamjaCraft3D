import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';

const {sandbox,get}=createAppFixture(resolve(import.meta.dirname,'..'));
const run=code=>vm.runInContext(code,sandbox),plain=value=>JSON.parse(JSON.stringify(value));
const box=get('objectList'),rowHeight=40,viewTop=101;
// Supply deterministic layout so the real list renderer and scroll logic run
// against an overflowing list, including browser-style scroll clamping.
let scroll=0;
box.clientHeight=230;box.clientTop=1;
Object.defineProperty(box,'scrollTop',{get:()=>scroll,set:value=>{scroll=Math.max(0,Math.min(Number(value)||0,box.children.length*rowHeight-box.clientHeight));}});
box.getBoundingClientRect=()=>({top:viewTop-1,bottom:viewTop+box.clientHeight+1});
const createElement=sandbox.document.createElement;
sandbox.document.createElement=(...args)=>{
 const element=createElement(...args);
 element.getBoundingClientRect=()=>{const top=viewTop+box.children.indexOf(element)*rowHeight-box.scrollTop;return {top,bottom:top+36};};
 element.focus=options=>{sandbox.document.activeElement=element;element.focusOptions=options;};
 return element;
};
run(`objects.splice(0);groups.splice(0);for(let i=0;i<32;i++){const o=makeObject('box');o.name='Part '+i;objects.push(o);}
 for(let i=0;i<8;i++)groups.push({id:'grp'+(i+1),name:'Assembly '+i,objectIds:objects.slice(i*2,i*2+2).map(o=>o.id)});
 nextGroupId=9;clearSelection(false);undoStack=[];redoStack=[];dirty=false;resetObjectListView();updateUI();`);
const ids=plain(run('objects.map(o=>o.id)')),groupIds=plain(run('groups.map(g=>g.id)'));
const buttons=()=>box.children.flatMap(row=>row.children);
const button=(key,id)=>buttons().find(b=>b.dataset[key]===id);
const toggle=id=>button('groupToggleId',id),member=id=>button('objectId',id);
const rowFor=(key,id)=>box.children.find(row=>row.children.some(b=>b.dataset[key]===id));
const visible=(key,id)=>{const r=rowFor(key,id)?.getBoundingClientRect();assert.ok(r,'Selected row must exist');assert.ok(r.top>=viewTop&&r.bottom<=viewTop+box.clientHeight,'Selected row must be fully visible');};
const invariant=()=>run('JSON.stringify({project:projectData(),selection:modelDocument.selection,ids:modelDocument.objectSelection,dirty,undo:undoStack.length,redo:redoStack.length,tool})');
assert.equal(box.children.length,24);assert.equal(member(ids[0]),undefined);
for(const id of groupIds){assert.equal(toggle(id).getAttribute('aria-expanded'),'false');assert.match(toggle(id).getAttribute('aria-label'),/Expand group:/);assert.equal(toggle(id).type,'button');}
// Disclosure is view state: no selection, document, history or tool mutation.
const initial=invariant();toggle(groupIds[0]).focus();toggle(groupIds[0]).onclick();
assert.equal(box.children.length,26);assert.ok(member(ids[0]));assert.equal(invariant(),initial);
assert.equal(sandbox.document.activeElement,toggle(groupIds[0]));assert.equal(toggle(groupIds[0]).focusOptions.preventScroll,true);
assert.equal(toggle(groupIds[0]).getAttribute('aria-expanded'),'true');assert.match(toggle(groupIds[0]).title,/Collapse group:/);
toggle(groupIds[0]).onclick();assert.equal(box.children.length,24);assert.equal(invariant(),initial);
// Only the inner list moves, and selection never steals focus.
get('objectsSection').scrollTop=77;
const focused=sandbox.document.activeElement;
run('selectObject(objects[31])');visible('objectId',ids[31]);assert.ok(box.scrollTop>0);
assert.equal(get('objectsSection').scrollTop,77);assert.equal(sandbox.document.activeElement,focused);
box.scrollTop=0;run('updateUI()');assert.equal(box.scrollTop,0,'Ordinary refresh must preserve manual browsing');
run('selectObject(objects[31])');visible('objectId',ids[31]);
box.scrollTop=0;run('setGroupSelection(groups[7])');visible('groupId',groupIds[7]);assert.equal(toggle(groupIds[7]).getAttribute('aria-expanded'),'false');
// Explicit partial frame selection reveals the member; ordinary group selection
// retains the existing expansion state and can be collapsed independently.
run('setObjectSelection([objects[14].id],objects[14].id,true,false)');
assert.equal(toggle(groupIds[7]).getAttribute('aria-expanded'),'true');visible('objectId',ids[14]);
const partial=invariant();toggle(groupIds[7]).onclick();assert.equal(invariant(),partial);assert.equal(member(ids[14]),undefined);
run('updateUI()');assert.equal(member(ids[14]),undefined,'Refresh must not reopen a manually collapsed group');
run('setObjectSelection([objects[14].id],objects[14].id,true,false)');visible('objectId',ids[14]);
// Adding a distant secondary object scrolls to the addition, retaining primary.
run('selectObject(objects[16])');box.scrollTop=0;run('toggleObjectSelection(objects[31])');
assert.equal(run('selectedObjectId()'),ids[16]);visible('objectId',ids[31]);
box.scrollTop=0;run('updateUI()');assert.equal(box.scrollTop,0);
// Collapsed group headers retain atomic visibility and locking controls.
const groupMembers=ids.slice(0,2).join(',');
button('lockIds',groupMembers).onclick();assert.equal(run('objects.slice(0,2).every(isObjectLocked)'),true);assert.equal(member(ids[0]),undefined);
button('lockIds',groupMembers).onclick();assert.equal(run('objects.slice(0,2).some(isObjectLocked)'),false);
button('visibilityIds',groupMembers).onclick();assert.equal(run('objects.slice(0,2).some(isObjectVisible)'),false);
button('visibilityIds',groupMembers).onclick();assert.equal(run('objects.slice(0,2).every(isObjectVisible)'),true);
toggle(groupIds[0]).onclick();run('setGroupSelection(groups[0]);renameGroup(groups[0].id,"Renamed assembly")');
assert.equal(toggle(groupIds[0]).getAttribute('aria-expanded'),'true');assert.match(toggle(groupIds[0]).title,/Renamed assembly/);
const beforeBusy=invariant();run("beginModelingOperation('Test');updateUI()");
assert.equal(toggle(groupIds[0]).disabled,true);toggle(groupIds[0]).onclick();assert.equal(invariant(),beforeBusy);assert.ok(member(ids[0]));run('endModelingOperation();updateUI()');
// Native Open clears view state even when the next project reuses group IDs.
const saved=plain(run('projectData()'));assert.ok(saved.groups.every(g=>!('expanded' in g)));sandbox.saved=saved;
run('loadProject(saved)');for(const id of groupIds)assert.equal(toggle(id).getAttribute('aria-expanded'),'false');
assert.equal(member(ids[0]),undefined);visible('groupId',groupIds[0]);
toggle(groupIds[0]).onclick();assert.ok(member(ids[0]));
const source=structuredClone(saved);source.objects=source.objects.slice(0,2);source.groups=source.groups.slice(0,1);
const text=JSON.stringify(source);sandbox.files=[{name:'assembly.lamjacraft.json',size:Buffer.byteLength(text),text:async()=>text}];
await run('selectImportFiles(files)');await run('checkPendingImport()');run('commitCheckedImport()');
const importedGroup=run('groups.at(-1).id');assert.notEqual(importedGroup,groupIds[0]);
assert.equal(toggle(groupIds[0]).getAttribute('aria-expanded'),'true','Append import preserves existing expansion');
assert.equal(toggle(importedGroup).getAttribute('aria-expanded'),'false');visible('groupId',importedGroup);
assert.equal(member(run('groups.at(-1).objectIds[0]')),undefined);
get('newBtn').onclick();assert.equal(box.children.length,0);assert.equal(box.scrollTop,0);
run('loadProject(saved)');for(const id of groupIds)assert.equal(toggle(id).getAttribute('aria-expanded'),'false');
// Removing and recreating an identity cannot inherit expansion from a stale row.
toggle(groupIds[0]).onclick();run('groups.shift();updateUI();groups.unshift(saved.groups[0]);updateUI()');
assert.equal(toggle(groupIds[0]).getAttribute('aria-expanded'),'false');
console.log('Object list passed: collapsed defaults, independent disclosure/focus, repeated and partial selection reveal, multi-selection navigation, manual scrolling, group visibility/locks, busy guards, native Open/import/New and transient state isolation.');
