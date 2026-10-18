import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createAppFixture} from './app-fixture.mjs';
const root=resolve(import.meta.dirname,'..'),workerCode=fs.readFileSync(resolve(root,'build/edge-feature-worker.js'),'utf8');
// Every palette tool must inherit the shared button typography and line-icon styling.
for(const file of ['src/template.html','dist/LamjaCraft-3D.html']){
  const markup=fs.readFileSync(resolve(root,file),'utf8');
  const buttons=Array.from(markup.matchAll(/<button\b([^>]*\bdata-tool="([^"]+)"[^>]*)>(.*?)<\/button>/gs));
  assert.ok(buttons.length>0,file+' tool palette');
  for(const [,attributes,tool,content] of buttons){
    const classes=attributes.match(/\bclass="([^"]*)"/)?.[1].split(/\s+/)||[];
    assert.ok(classes.includes('tool'),file+' '+tool+' shared button style');
    const svg=content.match(/<svg\b([^>]*)>/)?.[1]||'';
    assert.match(svg,/\bfill="none"/,file+' '+tool+' unfilled icon');
    assert.match(svg,/\bstroke="currentColor"/,file+' '+tool+' inherited icon color');
    assert.match(svg,/\bstroke-width="1\.6"/,file+' '+tool+' shared icon stroke');
    assert.match(svg,/\bviewbox="0 0 24 24"/i,file+' '+tool+' shared icon scale');
  }
}
class ControlledWorker {
  static last;
  constructor(){ControlledWorker.last=this;this.onmessage=null;this.onerror=null;this.terminated=false;}
  postMessage(request){this.request=structuredClone(request);}
  terminate(){this.terminated=true;}
  complete(){const context={console,performance,structuredClone,TextEncoder,TextDecoder,postMessage:message=>this.onmessage?.({data:message})};vm.createContext(context);vm.runInContext(workerCode,context);context.onmessage({data:this.request});}
}
const {sandbox,get}=createAppFixture(root,ControlledWorker),run=code=>vm.runInContext(code,sandbox);
get('projectName').value=run('modelDocument.name');
const key=(value,extra={})=>{sandbox.keyEvent={key:value,preventDefault(){},...extra};run('handleApplicationKeyDown(keyEvent)');};
const escape=()=>key('Escape'),flush=()=>new Promise(resolve=>setImmediate(resolve));
const document=()=>run('JSON.stringify(projectData())');
const input=id=>{for(const listener of get(id).listeners?.input||[])listener({target:get(id)});};
const reset=()=>run("cancelGesture();replaceObjects([]);replaceGroups([]);replaceGuides([]);replaceDimensions([]);objects.push(makeObject('box'));selectObject(objects[0]);undoStack.length=0;redoStack.length=0;setTool('select');cameraBasis();");
reset();
// Idle Escape returns to Select; active pointer cancellation consumes one press.
for(const tool of Array.from(run('Object.keys(toolControllers)'))){
  sandbox.kind=tool;run('setTool(kind)');const before=document();escape();assert.equal(run('tool'),'select',tool+' idle Escape');assert.equal(document(),before);
}
for(const [tool,type] of [['rect','draw-ground'],['circle','circle-ground'],['gear','gear-ground'],['rack','rack-ground'],['slot','slot-ground'],['arcslot','arcslot-ground'],['boltcircle','boltcircle-ground'],['poly','poly-ground'],['arc','arc-face'],['guide','guide-line'],['guidecircle','guide-circle'],['push','push'],['shapes','shape-place'],['splitplane','split-plane-two-point']]){
  sandbox.kind=tool;sandbox.pointerType=type;run('setTool(kind);pointer={type:pointerType}');const before=document();escape();assert.equal(run('tool'),tool,type);assert.equal(run('pointer'),null);escape();assert.equal(run('tool'),'select');assert.equal(document(),before);
}
// Direct numeric entry cancels before its underlying gesture, including focused fields.
run("setTool('circle');pointer={type:'circle-ground',center:[50,50],segments:24,numericRadius:5};numericEntry={tool:'circle',buffer:'12'}");escape();assert.equal(run('numericEntry'),null);assert.equal(run('pointer.type'),'circle-ground');assert.equal(run('tool'),'circle');escape();assert.equal(run('pointer'),null);assert.equal(run('tool'),'circle');escape();assert.equal(run('tool'),'select');
sandbox.document.activeElement=get('shapeRadius');get('shapeRadius').tagName='INPUT';let blurred=0;get('shapeRadius').blur=()=>{blurred++;sandbox.document.activeElement={tagName:'BODY'};};run("setTool('shapes');pointer={type:'shape-place'}");escape();assert.equal(blurred,1);assert.equal(run('pointer'),null);assert.equal(run('tool'),'shapes');escape();assert.equal(run('tool'),'select');

// All ground-drawing families use one temporary Push/Pull height contract.
for(const source of ['rect','circle','gear','rack','slot','arcslot','boltcircle','poly']){
  reset();sandbox.sourceTool=source;const before=document(),history=run('undoStack.length');
  run('setTool(sourceTool);beginGroundExtrusion([[50,50],[60,50],[60,60],[50,60]],[],"Workflow shape")');
  assert.equal(run('tool'),'push');assert.equal(run('pointer.returnTool'),source);assert.equal(get('groundExtrudeControls').classList.contains('hidden'),false);assert.equal(get('pushFaceControls').classList.contains('hidden'),true);assert.equal(run('activeToolParameters()[0].id'),'height');assert.equal(document(),before);
  key('9');key('Enter');assert.equal(run('tool'),source);assert.equal(run('pointer'),null);assert.equal(run('objects.length'),2);assert.equal(run('undoStack.length'),history+1);assert.equal(run('objects[1].solid.faces.size'),6);assert.equal(get('groundExtrudeControls').classList.contains('hidden'),true);
  const after=document();run('undo()');assert.equal(run('tool'),source);assert.equal(document(),before);run('redo()');assert.equal(run('tool'),source);assert.equal(document(),after);
  run('beginGroundExtrusion([[70,50],[80,50],[80,60],[70,60]],[],"Second shape");previewGroundHeight(5);commitGroundHeight()');assert.equal(run('tool'),source);assert.equal(run('objects.length'),3);
}
reset();run("setTool('boltcircle');beginGroundPatternExtrusion([[[50,50],[52,50],[52,52],[50,52]],[[55,50],[57,50],[57,52],[55,52]]],'Bolt')");get('groundHeight').value='7.5';input('groundHeight');get('applyGroundHeight').onclick();assert.equal(run('tool'),'boltcircle');assert.equal(run('objects.length'),3);assert.equal(run('lastCommandEntry().type'),'add-ground-prism-pattern');
reset();const untouched=document();run("setTool('rect');beginGroundExtrusion([[50,50],[60,50],[60,60],[50,60]])");key('1');escape();assert.equal(run('tool'),'push');assert.equal(run('pointer.type'),'ground-extrude');escape();assert.equal(run('tool'),'rect');assert.equal(run('pointer'),null);escape();assert.equal(run('tool'),'select');assert.equal(document(),untouched);
run("setTool('circle');beginGroundExtrusion([[50,50],[60,50],[60,60],[50,60]]);previewGroundHeight(0);commitGroundHeight()");assert.equal(run('tool'),'push');assert.equal(run('pointer.type'),'ground-extrude');assert.equal(document(),untouched);
key('m');assert.equal(run('tool'),'move');assert.equal(run('pointer'),null);escape();assert.equal(run('tool'),'select');

// A rejected height commit keeps both the draft and its source tool for retry.
reset();run("while(objects.length<1000)objects.push(makeObject('box'));setTool('boltcircle');beginGroundPatternExtrusion([[[50,50],[52,50],[52,52],[50,52]],[[55,50],[57,50],[57,52],[55,52]]]);previewGroundHeight(5)");const fullBefore=document(),fullHistory=run('undoStack.length');run('commitGroundHeight()');assert.equal(run('tool'),'push');assert.equal(run('pointer.type'),'ground-extrude-pattern');assert.equal(run('pointer.returnTool'),'boltcircle');assert.equal(document(),fullBefore);assert.equal(run('undoStack.length'),fullHistory);escape();assert.equal(run('tool'),'boltcircle');

// Real sketch commit helpers: face work keeps its tool; ground gets the temporary height step.
reset();get('circleSegments').value='24';
run("setTool('circle');(()=>{const o=objects[0],f=[...o.solid.faces.values()].find(f=>f.plane.normal[2]>.999),basis=faceBasisLocal(o,f.id);pointer={type:'circle-face',object:o,face:f.id,basis,center:toPlane2([0,0,20],basis),numericRadius:4,segments:24};commitCirclePointer(4);})()");assert.equal(run('tool'),'circle');assert.equal(run('pointer'),null);assert.equal(run('lastCommandEntry().type'),'split-face-region');
run('undo()');run("setTool('rect');(()=>{const o=objects[0],f=[...o.solid.faces.values()].find(f=>f.plane.normal[2]>.999),basis=faceBasisLocal(o,f.id);pointer={type:'draw-face',shape:'rect',object:o,face:f.id,basis,start:toPlane2([-5,-5,20],basis),previewPoints:[[-5,-5],[5,-5],[5,5],[-5,5]].map(p=>toPlane2([p[0],p[1],20],basis))};commitRectanglePointer();})()");assert.equal(run('tool'),'rect');assert.equal(run('pointer'),null);
reset();run("setTool('circle');pointer={type:'circle-ground',center:[50,50],numericRadius:4,segments:24};commitCirclePointer(4)");assert.equal(run('tool'),'push');assert.equal(run('pointer.returnTool'),'circle');run('previewGroundHeight(6);commitGroundHeight()');assert.equal(run('tool'),'circle');

// Camera navigation preserves pending data; resuming height does not jump.
reset();run("setTool('rect');beginGroundExtrusion([[50,50],[60,50],[60,60],[50,60]]);previewGroundHeight(8)");const draft=run('pointer');sandbox.draft=draft;run('beginCameraPointer({button:2},400,300,activeToolController());camera.yaw+=.3;cameraBasis();resumeAfterCameraPointer(410,310)');assert.equal(run('pointer'),draft);assert.equal(run('pointer.height'),8);run('updateGroundExtrusionPointer(410,310)');assert.ok(Math.abs(run('pointer.height')-8)<1e-8);
run('beginCameraPointer({button:1},400,300,activeToolController())');escape();assert.equal(run('pointer'),draft);assert.equal(run('tool'),'push');escape();assert.equal(run('tool'),'rect');escape();assert.equal(run('tool'),'select');
reset();run("setTool('move');setAxis('x');moveToolController.numericSeed();previewMoveDistance(10)");const original=run('pointer.position.slice()');run('beginCameraPointer({button:2},400,300,activeToolController());setTool("circle")');assert.deepEqual(Array.from(run('objects[0].transform.position')),Array.from(original));assert.equal(run('pointer'),null);assert.equal(run('tool'),'circle');

reset();run("setTool('move');setAxis('x');moveToolController.numericSeed();previewMoveDistance(10)");const moveBefore=Array.from(run('pointer.position'));escape();assert.equal(run('tool'),'move');assert.equal(run('pointer'),null);assert.deepEqual(Array.from(run('objects[0].transform.position')),moveBefore);escape();assert.equal(run('tool'),'select');

// Non-pointer steps: measurement endpoint, texture origin then area, carve target.
reset();run("setTool('measure');measure=[[1,2,0]];measureAnchors=[{kind:'world',point:[1,2,0]}]");escape();assert.equal(run('tool'),'measure');assert.equal(run('measure.length'),0);escape();assert.equal(run('tool'),'select');
run("setTool('measure');measure=[[1,2,0]];measureAnchors=[{kind:'world',point:[1,2,0]}];setTool('rect')");assert.equal(run('measure.length'),0);assert.equal(run('measureAnchors.length'),0);
const textureSettings={textureType:'lines',textureOperation:'add',textureSpacing:'8',textureSize:'1',textureDepth:'.5',textureAngle:'0',textureMargin:'1',textureOffsetX:'0',textureOffsetY:'0',textureReferenceX:'0',textureReferenceY:'0',textureReferenceZ:'0'};
for(const [id,value] of Object.entries(textureSettings))get(id).value=value;
get('textureUseReference').checked=true;
const chooseTexture=()=>run("setTool('texture');chooseSurfaceTextureFace(objects[0],[...objects[0].solid.faces.values()].find(f=>f.plane.normal[2]>.999).id)");
chooseTexture();run('beginTextureReferencePick()');escape();assert.equal(run('tool'),'texture');assert.equal(run('textureReferencePickMode'),false);assert.ok(run('textureTarget'));escape();assert.equal(run('tool'),'texture');assert.equal(run('textureTarget'),null);escape();assert.equal(run('tool'),'select');
chooseTexture();run('beginTextureReferencePick();setTool("rect")');assert.equal(run('textureReferencePickMode'),false);assert.equal(run('textureTarget'),null);
get('carveWallThickness').value='2';get('carveMinimumDetail').value='.5';run("setTool('carve');chooseCarveOpening(objects[0],[...objects[0].solid.faces.values()].find(f=>f.plane.normal[2]>.999).id)");escape();assert.equal(run('tool'),'carve');assert.equal(run('carveTarget'),null);escape();assert.equal(run('tool'),'select');

// Completed asynchronous tools stay active and release consumed targets.
reset();chooseTexture();let before=document();run('commitSurfaceTextureFromUI()');assert.equal(run('modelingOperationBusy'),true);ControlledWorker.last.complete();await flush();assert.equal(run('modelingOperationBusy'),false);assert.equal(run('tool'),'texture');assert.equal(run('textureTarget'),null);assert.notEqual(document(),before);run('undo()');assert.equal(run('tool'),'texture');assert.equal(document(),before);
run("setTool('carve');chooseCarveOpening(objects[0],[...objects[0].solid.faces.values()].find(f=>f.plane.normal[2]>.999).id)");before=document();run('commitCarveOutFromUI()');ControlledWorker.last.complete();await flush();assert.equal(run('modelingOperationBusy'),false);assert.equal(run('tool'),'carve');assert.equal(run('carveTarget'),null);assert.notEqual(document(),before);run('undo()');assert.equal(run('tool'),'carve');assert.equal(document(),before);

// Busy Escape cancels a job only; history is blocked until settlement.
chooseTexture();before=document();run('commitSurfaceTextureFromUI()');const h=run('undoStack.length');key('Escape');run('undo();redo()');assert.equal(run('tool'),'texture');assert.equal(run('undoStack.length'),h);assert.equal(document(),before);await flush();assert.equal(run('modelingOperationBusy'),false);assert.equal(document(),before);

// Undo/Redo discards stale drafts and preserves the source drawing tool.
reset();run("addObject('box');setTool('circle');beginGroundExtrusion([[50,50],[60,50],[60,60],[50,60]]);previewGroundHeight(10);undo()");assert.equal(run('tool'),'circle');assert.equal(run('pointer'),null);assert.equal(run('objects.length'),1);run('redo()');assert.equal(run('tool'),'circle');assert.equal(run('pointer'),null);assert.equal(run('objects.length'),2);
reset();run("setTool('shapes');commitPrimitiveFromUI();commitPrimitiveFromUI()");assert.equal(run('tool'),'shapes');assert.equal(run('objects.length'),3);escape();assert.equal(run('tool'),'select');

// Native dialogs own Escape; no tool step is consumed underneath them.
run("setTool('circle');pointer={type:'circle-ground'}");const query=sandbox.document.querySelector;sandbox.document.querySelector=()=>({open:true});escape();assert.equal(run('tool'),'circle');assert.equal(run('pointer.type'),'circle-ground');sandbox.document.querySelector=query;escape();assert.equal(run('tool'),'circle');
const template=fs.readFileSync(resolve(root,'src/template.html'),'utf8');assert.match(template,/id="groundHeight"/);assert.match(template,/id="applyGroundHeight"/);assert.match(template,/Tools stay active after an operation/);
// Chamfer has one UI entry, with two existing operation paths behind its Rounded option.
reset();run("setTool('chamfer')");get('chamferDistance').value='3.5';get('chamferAngle').value='60';
const chamferBefore=document(),chamferHistory=run('undoStack.length');
get('chamferRounded').checked=true;run('changeChamferMode()');assert.equal(run('tool'),'roundchamfer');assert.equal(get('toolPanelTitle').textContent,'Chamfer');assert.equal(get('roundedChamferRadius').value,'3.5');assert.equal(get('roundedChamferAngle').value,'60');assert.equal(get('chamferFamilyToolOptions').classList.contains('hidden'),false);assert.equal(get('chamferToolOptions').classList.contains('hidden'),true);assert.equal(get('roundedChamferToolOptions').classList.contains('hidden'),false);
get('roundedChamferRadius').value='2.75';get('roundedChamferAngle').value='45';get('roundedChamferSegments').value='8';key('h');assert.equal(run('tool'),'chamfer');assert.equal(get('chamferRounded').checked,false);assert.equal(get('chamferDistance').value,'2.75');assert.equal(get('chamferAngle').value,'45');key('u');assert.equal(run('tool'),'roundchamfer');assert.equal(get('chamferRounded').checked,true);assert.equal(get('roundedChamferSegments').value,'8');run("setTool('select');selectChamferTool()");assert.equal(run('tool'),'roundchamfer');assert.equal(document(),chamferBefore);assert.equal(run('undoStack.length'),chamferHistory);
run('modelingOperationBusy=true');get('chamferRounded').checked=false;run('changeChamferMode()');assert.equal(run('tool'),'roundchamfer');assert.equal(get('chamferRounded').checked,true);run('modelingOperationBusy=false');
// Both choices still commit real geometry with one undo step.
for(const rounded of [false,true]){
 reset();sandbox.roundedMode=rounded;get('chamferDistance').value='2';get('chamferAngle').value='45';get('roundedChamferRadius').value='2';get('roundedChamferAngle').value='45';get('roundedChamferSegments').value='4';
 run("setTool('chamfer')");get('chamferRounded').checked=rounded;run('changeChamferMode()');
 run(`(()=>{const o=objects[0],top=[...o.solid.faces.values()].find(f=>f.plane.normal[2]>.999),edge=loopHalfEdges(o.solid,top.outerLoop)[0];workflowChamferEdge={kind:'edge',objectId:o.id,halfEdgeId:edge.id};workflowChamferHit={id:o.id,face:top.id,point:[0,0,20],localPoint:[0,0,20],t:1};})()`);
 const savedTopologyPicker=run('topologyEdgeAt');sandbox.workflowSavedPicker=savedTopologyPicker;run('topologyEdgeAt=()=>workflowChamferEdge');const before=document(),history=run('undoStack.length');run('activeToolController().pointerDown({event:{button:0},x:400,y:300,hit:workflowChamferHit,rawHit:workflowChamferHit})');
 if(rounded){assert.equal(run('modelingOperationBusy'),true);ControlledWorker.last.complete();await flush();assert.equal(run('modelingOperationBusy'),false);}
 assert.equal(run('geometryApi.validate(objects[0].solid,false).ok'),true);assert.equal(run('undoStack.length'),history+1);const after=document();assert.notEqual(after,before);run('undo()');assert.equal(document(),before);run('redo()');assert.equal(document(),after);run('topologyEdgeAt=workflowSavedPicker');
}
// R212: letter tool/axis/Fit shortcuts require no modifiers. Dedicated document
// commands retain their explicitly documented modifier patterns.
reset();
const shortcutTools={v:'select',r:'rect',c:'circle',i:'gear',k:'rack',s:'slot',b:'boltcircle',a:'arc',l:'poly',p:'push',m:'move',q:'rotate',g:'guide',j:'guidecircle',t:'measure',d:'delete',h:'chamfer',u:'roundchamfer',n:'thread',o:'orbit'};
const modifiers=Array.from({length:15},(_,i)=>({ctrlKey:!!((i+1)&1),metaKey:!!((i+1)&2),altKey:!!((i+1)&4),shiftKey:!!((i+1)&8)}));
sandbox.shortcutCommandCalls=[];
run("globalThis.shortcutSavedCommands={saveProject,undo,redo,duplicateObject,fit,copyObjectsFromUI,pasteObjectsFromUI};saveProject=()=>shortcutCommandCalls.push('save');undo=()=>shortcutCommandCalls.push('undo');redo=()=>shortcutCommandCalls.push('redo');duplicateObject=()=>shortcutCommandCalls.push('duplicate');fit=()=>shortcutCommandCalls.push('fit');copyObjectsFromUI=()=>{shortcutCommandCalls.push('copy');return true;};pasteObjectsFromUI=()=>{shortcutCommandCalls.push('paste');return true;}");
const fileClick=get('fileInput').click;get('fileInput').click=()=>sandbox.shortcutCommandCalls.push('open');
for(const [letter,expected] of Object.entries(shortcutTools)){
 run("setTool('select')");key(letter);assert.equal(run('tool'),expected);
 run("setTool('select')");key(letter.toUpperCase());assert.equal(run('tool'),expected,'Caps Lock should still allow unmodified shortcuts');
 for(const flags of modifiers){
  run("setTool('select');shortcutCommandCalls.length=0");const before=document(),history=run('undoStack.length');let prevented=false;
  sandbox.keyEvent={key:flags.shiftKey?letter.toUpperCase():letter,...flags,preventDefault(){prevented=true;}};run('handleApplicationKeyDown(keyEvent)');
  assert.equal(run('tool'),'select',`Modified ${letter} changed the tool`);assert.equal(document(),before);assert.equal(run('undoStack.length'),history);
  const command=(flags.ctrlKey||flags.metaKey)&&!flags.altKey&&!flags.shiftKey?{s:'save',o:'open',d:'duplicate',c:'copy',v:'paste'}[letter]:undefined;
  assert.deepEqual(Array.from(sandbox.shortcutCommandCalls),command?[command]:[]);assert.equal(prevented,!!command,'Unhandled modifier combination was intercepted');
 }
}
for(const letter of ['f','x','y','z','a']){
 run("setTool('move');setAxis('z')");
 for(const flags of modifiers){key(letter,flags);assert.equal(run('tool'),'move');assert.equal(run('axis'),'z','Modified letter changed the move axis');}
}
for(const modifier of ['ctrlKey','metaKey']){
 for(const [letter,extra,expected] of [['s',{},'save'],['o',{},'open'],['d',{},'duplicate'],['c',{},'copy'],['v',{},'paste'],['z',{},'undo'],['z',{shiftKey:true},'redo'],['y',{},'redo']]){
  run('shortcutCommandCalls.length=0');key(letter,{[modifier]:true,...extra});assert.deepEqual(Array.from(sandbox.shortcutCommandCalls),[expected]);
 }
}
run("shortcutCommandCalls.length=0;setTool('select')");key('f');assert.deepEqual(Array.from(sandbox.shortcutCommandCalls),['fit']);
// Browser combinations preserve an unfinished gesture and never start numeric
// entry. Shift-required numeric characters still belong to the active tool.
run("setTool('circle');pointer={type:'circle-ground',center:[50,50],numericRadius:4,segments:24}");const pending=run('pointer');
for(const flags of modifiers){key('c',flags);assert.equal(run('pointer'),pending);assert.equal(run('tool'),'circle');}
key('1',{ctrlKey:true});key('2',{altKey:true});assert.equal(run('numericEntry'),null);
key('c',{isComposing:true});assert.equal(run('pointer'),pending);
key('+',{shiftKey:true});key('5');assert.equal(run('numericEntry.buffer'),'+5');escape();escape();
run("setTool('rect');pointer={type:'draw-ground',start:[50,50],end:[60,60]};numericEntry={tool:'rect',buffer:'20'}");key('X',{shiftKey:true});assert.equal(run('numericEntry.buffer'),'20X');escape();escape();
run('saveProject=shortcutSavedCommands.saveProject;undo=shortcutSavedCommands.undo;redo=shortcutSavedCommands.redo;duplicateObject=shortcutSavedCommands.duplicateObject;fit=shortcutSavedCommands.fit;copyObjectsFromUI=shortcutSavedCommands.copyObjectsFromUI;pasteObjectsFromUI=shortcutSavedCommands.pasteObjectsFromUI');get('fileInput').click=fileClick;
console.log('R212 shortcut modifiers passed: all tool letters/15 modifier combinations, browser default ownership, exact Save/Open/Undo/Redo/Duplicate/Copy/Paste commands, Caps Lock, Move axes/Fit, gesture preservation, composition and Shift numeric symbols/separators.');
console.log('R182 tool workflow passed: repeated use, idle/gesture/numeric/context Escape, focused inputs/dialogs/busy jobs, all ground-tool returns, exact numeric/panel height, face-tool retention, click/drag families, navigation preservation/height rebasing, full tool-switch cleanup, Texture/Carve completion and cancellation, restored transform previews and Undo/Redo without stale drafts.');
