import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),{sandbox,get}=createAppFixture(root),run=code=>vm.runInContext(code,sandbox);
const template=fs.readFileSync(resolve(root,'src/template.html'),'utf8');
// Every palette command belongs to the same section in the main reference.
// Comparing independent public surfaces catches forgotten/moved tool entries.
const palette=template.split('<nav aria-label="Modeling tools" class="tools">')[1].split('</nav>')[0];
const commandHelp={copyObjectsBtn:'copy',pasteObjectsBtn:'paste',photoAiBtn:'photoai',helpBtn:'help',aboutBtn:'about'};
const paletteGroups=Array.from(palette.matchAll(/<div class="tool-group-title">([^<]+)<\/div>(.*?)(?=<div class="tool-group-title">|$)/gs),m=>[m[1],Array.from(m[2].matchAll(/<button[^>]*(?:data-tool|id)="([^"]+)"/g),b=>commandHelp[b[1]]||b[1])]);
const help=template.split('<dialog id="helpDialog"')[1].split('</dialog>')[0];
const helpSections=Array.from(help.matchAll(/<section class="help-tool-group" data-help-group="([^"]+)" aria-labelledby="([^"]+)">([\s\S]*?)<\/section>/g));
assert.deepEqual(helpSections.map(m=>[m[1],Array.from(m[3].matchAll(/data-help-tool="([^"]+)"/g),r=>r[1])]),paletteGroups);
for(const section of helpSections){assert.ok(help.includes(`href="#${section[2]}"`));assert.ok(section[3].includes(`<h4 id="${section[2]}">${section[1]}</h4>`));assert.match(section[3],/<th scope="col">Tool<\/th>/);}
const mainTopics=Array.from(help.matchAll(/data-help-tool="([^"]+)"/g),m=>m[1]);assert.equal(new Set(mainTopics).size,mainTopics.length);
for(const tool of run('Object.keys(TOOL_INFO)'))assert.ok(mainTopics.includes(tool==='roundchamfer'?'chamfer':tool),`Missing main help for ${tool}`);
const text=html=>html.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
// Populate the fixture with the template's hidden prose, retaining dynamic text IDs.
for(const match of template.matchAll(/<div id="([^"]+)" class="sidebar-help-source" hidden[^>]*>([\s\S]*?)<\/div>/g)){
 const source=get(match[1]);source.children=[];
 for(const paragraph of match[2].matchAll(/<p([^>]*)>([\s\S]*?)<\/p>/g)){
  const id=paragraph[1].match(/id="([^"]+)"/),node=id?get(id[1]):sandbox.document.createElement('p');node.textContent=text(paragraph[2]);source.append(node);
 }
}
run('updateUI()');
const copy=()=>get('sidebarHelpBody').children.map(p=>p.textContent).join('\n');
const document=run('JSON.stringify(projectData())'),history=run('undoStack.length'),revision=run('modelRevision');
get('textureSpacing').value='4.25';get('faceDistance').value='7.5';get('pushTwistAngle').value='23';
let focus=0;get('toolHelpBtn').focus=()=>{focus++;};
run("setTool('texture')");get('toolHelpBtn').onclick();assert.equal(get('sidebarHelpDialog').open,true);assert.equal(get('sidebarHelpTitle').textContent,'Surface Texture help');assert.match(copy(),/projection/);assert.match(copy(),/world coordinates/);assert.match(copy(),/sampled preview/);assert.doesNotMatch(copy(),/radial depth/);assert.ok(get('sidebarHelpBody').children.every(p=>!p.id),'Help copied source IDs');get('closeSidebarHelpBtn').onclick();assert.equal(get('sidebarHelpDialog').open,false);assert.equal(focus,1);
run("setTool('push')");get('toolHelpBtn').onclick();assert.equal(get('sidebarHelpTitle').textContent,'Push/Pull help');assert.match(copy(),/Positive\/negative reverses twist/);assert.doesNotMatch(copy(),/sampled preview/);get('sidebarHelpDialog').close();assert.equal(focus,2);assert.equal(get('faceDistance').value,'7.5');assert.equal(get('pushTwistAngle').value,'23');assert.equal(get('textureSpacing').value,'4.25');
run("setTool('splitplane')");get('toolHelpBtn').onclick();assert.equal(get('sidebarHelpTitle').textContent,'Split Plane help');assert.match(copy(),/Snap Point 1 and Point 2/);assert.match(copy(),/green move handle/);assert.match(copy(),/orange tilt handle/);get('sidebarHelpDialog').close();
run("setTool('thread')");get('toolHelpBtn').onclick();assert.match(copy(),/manufacturing tolerances/);assert.match(copy(),/Metric coarse presets/);get('sidebarHelpDialog').close();
run("setTool('sketcheditor')");get('toolHelpBtn').onclick();assert.equal(get('sidebarHelpTitle').textContent,'Sketch Editor help');assert.match(copy(),/Editor Undo\/Redo affects only the draft/);assert.match(copy(),/Escape during placement returns to editing/);assert.match(copy(),/Drafts, guides and measurements are not saved/);get('sidebarHelpDialog').close();
run("setTool('move')");get('toolHelpBtn').onclick();assert.match(copy(),/multiple groups and extra objects/);get('sidebarHelpDialog').close();
run("setTool('rotate')");get('toolHelpBtn').onclick();assert.match(copy(),/full selection bounds center/);assert.doesNotMatch(copy(),/select a face with Select/);get('sidebarHelpDialog').close();
get('helpBtn').onclick();assert.equal(get('helpDialog').open,true);get('helpDialog').close();
run("setTool('select')");get('objectHelpBtn').onclick();assert.equal(get('sidebarHelpTitle').textContent,'Object properties');assert.match(copy(),/Uniform scale/);assert.doesNotMatch(copy(),/split plane at a time/);get('sidebarHelpDialog').close();
get('objectHelpBtn').onclick();assert.match(copy(),/Shininess ranges from 0/);assert.match(copy(),/Presentation PNG/);assert.doesNotMatch(copy(),/a frame changes only explicitly selected members/);get('sidebarHelpDialog').close();
get('objectsHelpBtn').onclick();assert.match(copy(),/Shift\/Ctrl\/Cmd/);assert.match(copy(),/Entire model export includes hidden objects/);get('sidebarHelpDialog').close();
assert.equal(run('JSON.stringify(projectData())'),document);assert.equal(run('undoStack.length'),history);assert.equal(run('modelRevision'),revision);assert.equal(get('visibilityHint').classList.contains('hidden'),true);assert.equal(get('multiSelectHint').classList.contains('hidden'),true);
run("addObject('box');setObjectSelection(objects.map(o=>o.id));createGroupFromSelection();");get('objectHelpBtn').onclick();assert.equal(get('sidebarHelpTitle').textContent,'Group properties');assert.match(copy(),/move, rotate and scale together/);assert.match(copy(),/spacing between objects/);assert.match(get('groupStatus').textContent,/2 members/);get('sidebarHelpDialog').close();
run("addGuidePlane([0,0,0],[0,0,1]);");get('objectHelpBtn').onclick();assert.equal(get('sidebarHelpTitle').textContent,'Split plane properties');assert.match(copy(),/plane does not add geometry/);get('sidebarHelpDialog').close();
const after=run('JSON.stringify(projectData())'),afterHistory=run('undoStack.length');run("beginModelingOperation('Busy')");get('toolHelpBtn').onclick();assert.equal(get('sidebarHelpDialog').open,false);assert.equal(run('JSON.stringify(projectData())'),after);assert.equal(run('undoStack.length'),afterHistory);run('endModelingOperation()');
console.log('Sidebar help passed: R177 complete grouped main reference matching palette order, current editor/transform/appearance guidance, template-backed active-tool/object/group/plane instructions, source-ID isolation, read-only state/settings/history, modal close/focus and busy guard.');
