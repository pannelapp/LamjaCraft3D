import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';

const root=resolve(import.meta.dirname,'..');
let storageAccesses=0,acceptReplacement=true;
const confirms=[],windowListeners=new Map(),timers=[];
// Any recovery lookup would throw, just as unavailable browser storage can.
// Counting access also catches code that swallows the exception at startup.
const inaccessibleStorage=new Proxy({}, {get(){storageAccesses++;throw Error('Browser storage must not be accessed');}});
const {sandbox,get,downloads}=createAppFixture(root,undefined,{
  localStorage:inaccessibleStorage,
  window:{addEventListener(type,handler){windowListeners.set(type,handler);}},
  setTimeout(callback,delay){if(delay===0)return setTimeout(callback,0);timers.push({callback,delay});return timers.length;},
  clearTimeout(){},
  confirm(message){confirms.push(message);return acceptReplacement;},
});
const run=code=>vm.runInContext(code,sandbox),state=()=>run('JSON.stringify(projectData())');
const closing=()=>{let prevented=false;const event={preventDefault(){prevented=true;}};windowListeners.get('beforeunload')(event);return {prevented,event};};
assert.equal(storageAccesses,0,'Startup inspected a previous session');
assert.equal(run('dirty'),false);
assert.equal(closing().prevented,false);
const initialCount=run('objects.length'),initialHistory=run('undoStack.length');
run("addObject('box')");
assert.equal(run('objects.length'),initialCount+1);
assert.equal(run('undoStack.length'),initialHistory+1);
assert.equal(run('dirty'),true);
assert.equal(get('dirty').classList.contains('on'),true);
assert.equal(closing().prevented,true);
assert.equal(closing().event.returnValue,'');
const edited=state();
run('undo()');assert.equal(run('objects.length'),initialCount);assert.equal(run('dirty'),true);
run('redo()');assert.equal(state(),edited);assert.equal(run('dirty'),true);
get('projectName').value='Manual session';
for(const listener of get('projectName').listeners.change)listener({});
assert.equal(run('dirty'),true);
get('saveBtn').onclick();
assert.equal(downloads.length,1);
const savedText=await downloads[0].text(),saved=JSON.parse(savedText);
assert.equal(saved.format,'lamjacraft-3d');assert.equal(saved.version,7);
assert.equal(saved.name,'Manual session');
assert.equal(JSON.stringify(saved),state());
assert.equal(run('dirty'),false);assert.equal(get('dirty').classList.contains('on'),false);
assert.equal(get('saveStatus').textContent,'Project downloaded');assert.equal(closing().prevented,false);

// Ctrl+S remains explicit saving; it does not write a recovery snapshot.
run('duplicateObject()');
let preventedSave=false;
sandbox.saveKey={key:'s',ctrlKey:true,metaKey:false,preventDefault(){preventedSave=true;}};
run('handleApplicationKeyDown(saveKey)');
assert.equal(preventedSave,true);assert.equal(downloads.length,2);assert.equal(run('dirty'),false);
run("setDirtyState(true);setTool('move')");
const beforeNew=state();acceptReplacement=false;get('newBtn').onclick();
assert.equal(state(),beforeNew);assert.equal(run('dirty'),true);assert.equal(run('tool'),'move');
acceptReplacement=true;get('newBtn').onclick();
assert.equal(run('objects.length'),0);assert.equal(run('dirty'),false);assert.equal(run('tool'),'select');
assert.ok(confirms.some(message=>message.includes('Start an empty project')));

const open=async text=>{const target={files:[{size:Buffer.byteLength(text),text:async()=>text}],value:'selected'};await get('fileInput').onchange({target});assert.equal(target.value,'');};
await open(savedText);
assert.equal(state(),JSON.stringify(saved));assert.equal(run('dirty'),false);assert.equal(run('tool'),'select');
run('duplicateObject()');const beforeOpen=state();acceptReplacement=false;
await open(savedText);assert.equal(state(),beforeOpen);assert.equal(run('dirty'),true);
assert.ok(confirms.some(message=>message.includes('Open the project')));
acceptReplacement=true;await open(savedText);
assert.equal(state(),JSON.stringify(saved));assert.equal(run('dirty'),false);
await open('{broken json');assert.equal(state(),JSON.stringify(saved));
const invalid=structuredClone(saved);invalid.objects[0].solid.schema='invalid';
await open(JSON.stringify(invalid));assert.equal(state(),JSON.stringify(saved));

// Advance every queued callback, including delays beyond the former autosave.
for(const timer of timers.splice(0))timer.callback();
assert.equal(storageAccesses,0,'Editing/history/saving/opening accessed browser storage');
const app=fs.readFileSync(resolve(root,'build/app.js'),'utf8'),html=fs.readFileSync(resolve(root,'dist/LamjaCraft-3D.html'),'utf8');
assert.doesNotMatch(app,/\b(?:localStorage|sessionStorage|scheduleAutosave|autosaveTimer|recoveryData|LEGACY_STORAGE_KEYS)\b/);
assert.doesNotMatch(html,/(?:id="(?:recovery|restoreBtn|dismissRecovery)"|#(?:recovery|dismissRecovery)\b)/);
assert.match(html,/Use Save Project to keep your work; automatic recovery is disabled/);
console.log('Manual saving passed: R186 zero browser-storage access on startup/edits/history/timers, explicit Save/Ctrl+S and format-7 reopen, dirty/close guards, New/Open cancellation, invalid-file rejection and removed recovery UI/runtime.');
